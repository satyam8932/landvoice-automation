import { Actor, log } from 'apify';
import { chromium, type Browser } from 'playwright';
import { processAccount } from './landvoice.js';
import type { Account, AccountResult, Input, RunOptions } from './types.js';
import { ERR, LvError, maskEmail, runPool, toLvError, withRetry } from './utils.js';

await Actor.init();

let browser: Browser | undefined;
let failed = false;
try {
    const input = (await Actor.getInput<Input>()) ?? {};
    const accounts = parseAccounts(input);
    const concurrency = input.concurrency ?? 3;
    const maxRetries = input.maxRetries ?? 2;
    const opts: RunOptions = {
        timeoutMs: (input.timeoutSecs ?? 30) * 1000,
        proxy: input.proxyConfiguration?.useApifyProxy || input.proxyConfiguration?.proxyUrls?.length
            ? await Actor.createProxyConfiguration(input.proxyConfiguration)
            : undefined,
    };
    log.info(`Processing ${accounts.length} account(s), concurrency ${concurrency}`);

    browser = await chromium.launch({
        headless: input.headless ?? true,
        args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox'],
    });

    const results: AccountResult[] = [];
    await runPool(accounts, concurrency, async (account, i) => {
        results[i] = await runAccount(browser!, account, opts, maxRetries);
        await Actor.pushData(results[i]); // pushed immediately so partial results survive an abort
    });

    const count = (status: AccountResult['status']) => results.filter((r) => r.status === status).length;
    const summary = {
        total: results.length,
        loggedIn: count('LOGGED_IN'),
        failed: count('FAILED'),
        results,
    };
    await Actor.setValue('OUTPUT', summary);
    log.info(`Done: ${summary.loggedIn} logged in, ${summary.failed} failed`);
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

async function runAccount(browser: Browser, account: Account, opts: RunOptions, maxRetries: number): Promise<AccountResult> {
    const started = Date.now();
    let attempts = 0;
    const meta = () => ({ email: account.email, label: account.label ?? null, attempts, durationMs: Date.now() - started });
    try {
        const outcome = await withRetry(
            (attempt) => processAccount(browser, account, opts, (attempts = attempt)),
            maxRetries,
            (err, attempt) => log.warning(`[${maskEmail(account.email)}] attempt ${attempt} failed (${err.code}), retrying`),
        );
        return { ...outcome, errorCode: null, errorMessage: null, ...meta() };
    } catch (raw) {
        const err = toLvError(raw);
        log.error(`[${maskEmail(account.email)}] ${err.code}: ${err.message}`);
        return {
            status: 'FAILED',
            errorCode: err.code,
            errorMessage: err.message,
            screenshotKey: err.screenshotKey ?? null,
            ...meta(),
        };
    }
}

function parseAccounts(input: Input): Account[] {
    const list = input.accounts?.length ? input.accounts : input.email ? [{ email: input.email, password: input.password }] : [];
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
