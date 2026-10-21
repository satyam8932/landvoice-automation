import { Actor, log } from 'apify';
import { chromium, type Browser } from 'playwright';
import { exportAccount } from './account.js';
import { LEAD_LISTS, type LeadList, type LeadListName } from './config.js';
import type { Account, AccountResult, Input, ListExport, ListFields, RunOptions } from './types.js';
import { ERR, LvError, maskEmail, runPool, toLvError, withRetry } from './utils.js';

await Actor.init();

let browser: Browser | undefined;
let failed = false;
try {
    const input = (await Actor.getInput<Input>()) ?? {};
    const accounts = parseAccounts(input);
    const lists = parseLists(input.lists);
    const concurrency = input.concurrency ?? 1;
    const maxRetries = input.maxRetries ?? 2;
    const opts: RunOptions = {
        timeoutMs: (input.timeoutSecs ?? 30) * 1000,
        proxy: input.proxyConfiguration?.useApifyProxy || input.proxyConfiguration?.proxyUrls?.length
            ? await Actor.createProxyConfiguration(input.proxyConfiguration)
            : undefined,
    };
    log.info(`Exporting [${lists.map((l) => l.name).join(', ')}] for ${accounts.length} account(s), concurrency ${concurrency}`);

    browser = await chromium.launch({
        headless: input.headless ?? true,
        args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox'],
    });

    const results: AccountResult[] = [];
    await runPool(accounts, concurrency, async (account, i) => {
        results[i] = await runAccount(browser!, account, lists, opts, maxRetries);
        await Actor.pushData(results[i]); // pushed immediately so partial results survive an abort
    });

    const count = (status: AccountResult['status']) => results.filter((r) => r.status === status).length;
    const summary = {
        total: results.length,
        exported: count('EXPORTED'),
        noEntries: count('NO_ENTRIES'),
        failed: count('FAILED'),
        results,
    };
    await Actor.setValue('OUTPUT', summary);
    log.info(`Done: ${summary.exported} exported, ${summary.noEntries} empty, ${summary.failed} failed`);
    failed = summary.failed > 0 && Boolean(input.failOnAnyError);
} catch (raw) {
    const err = toLvError(raw);
    log.exception(err, `Fatal: ${err.code}`);
    await Actor.setValue('OUTPUT', { fatal: true, errorCode: err.code, errorMessage: err.message });
    failed = true;
} finally {
    await browser?.close().catch(() => {});
}

await (failed ? Actor.fail() : Actor.exit());

/** Runs an account with retries; lists finished in a failed attempt are not redone. */
async function runAccount(
    browser: Browser,
    account: Account,
    lists: readonly LeadList[],
    opts: RunOptions,
    maxRetries: number,
): Promise<AccountResult> {
    const started = Date.now();
    const exports: ListExport[] = [];
    let attempts = 0;
    let status: AccountResult['status'] = 'FAILED';
    let error: LvError | null = null;

    try {
        await withRetry(
            (attempt) => {
                attempts = attempt;
                const pending = lists.filter((list) => !exports.some((e) => e.list === list.name));
                return exportAccount(browser, account, pending, opts, attempt, (done) => exports.push(done));
            },
            maxRetries,
            (err, attempt) => log.warning(`[${maskEmail(account.email)}] attempt ${attempt} failed (${err.code}: ${err.message.split('\n')[0]}), retrying`),
        );
        status = exports.some((e) => e.status === 'EXPORTED') ? 'EXPORTED' : 'NO_ENTRIES';
    } catch (raw) {
        error = toLvError(raw);
        log.error(`[${maskEmail(account.email)}] ${error.code}: ${error.message}`);
    }

    return {
        email: account.email,
        label: account.label ?? null,
        status,
        errorCode: error?.code ?? null,
        errorMessage: error?.message ?? null,
        ...toListFields(exports),
        screenshotKey: error?.screenshotKey ?? null,
        attempts,
        durationMs: Date.now() - started,
        finishedAt: new Date().toISOString(),
    };
}

/** Flattens per-list results into isExport<Name> / <name>Count / <name>CsvUrl / <name>CsvKey fields. */
function toListFields(exports: readonly ListExport[]): ListFields {
    const fields: Record<string, boolean | number | string | null> = {};
    for (const name of Object.keys(LEAD_LISTS) as LeadListName[]) {
        const result = exports.find((e) => e.list === name);
        const exported = result?.status === 'EXPORTED' ? result : null;
        fields[`isExport${name[0]!.toUpperCase()}${name.slice(1)}`] = result ? Boolean(exported) : null;
        fields[`${name}Count`] = result?.entries ?? null;
        fields[`${name}CsvUrl`] = exported?.csvUrl ?? null;
        fields[`${name}CsvKey`] = exported?.csvKey ?? null;
    }
    return fields as ListFields;
}

function parseLists(names: string[] | undefined): LeadList[] {
    if (!names?.length) return Object.values(LEAD_LISTS);
    return names.map((name) => {
        const list = LEAD_LISTS[name as LeadListName];
        if (!list) throw new LvError(ERR.INVALID_INPUT, `Unknown list "${name}". Valid: ${Object.keys(LEAD_LISTS).join(', ')}`);
        return list;
    });
}

function parseAccounts(input: Input): Account[] {
    const list = input.accounts?.length ? input.accounts : input.email ? [{ email: input.email, password: input.password, label: input.label }] : [];
    if (!list.length) throw new LvError(ERR.INVALID_INPUT, 'Provide "email" + "password" or a non-empty "accounts" array');

    const seen = new Set<string>();
    return list.map((a, i) => {
        const email = a.email?.trim() ?? '';
        if (!email || !a.password) throw new LvError(ERR.INVALID_INPUT, `accounts[${i}] needs email and password`);
        if (seen.has(email.toLowerCase())) throw new LvError(ERR.INVALID_INPUT, `Duplicate account: ${email}`);
        seen.add(email.toLowerCase());
        return { email, password: a.password, label: a.label };
    });
}
