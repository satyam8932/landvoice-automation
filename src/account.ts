import { log as rootLog } from 'apify';
import type { Browser } from 'playwright';
import { createContext } from './browser.js';
import type { LeadList } from './config.js';
import { LandvoiceSession } from './session.js';
import { saveCsv, saveScreenshot } from './storage.js';
import type { Account, ListExport, RunOptions } from './types.js';
import { maskEmail, toLvError } from './utils.js';

/**
 * One attempt for one account: log in once, then export each injected list in order.
 * Every finished list is reported through `onListDone` right away, so a retry can skip it.
 */
export async function exportAccount(
    browser: Browser,
    account: Account,
    lists: readonly LeadList[],
    opts: RunOptions,
    attempt: number,
    onListDone: (result: ListExport) => void,
): Promise<void> {
    const log = rootLog.child({ prefix: `[${maskEmail(account.email)}#${attempt}]` });
    const name = account.label || account.email;
    const context = await createContext(browser, opts, account.email);
    const session = new LandvoiceSession(await context.newPage(), opts.timeoutMs, log);

    try {
        await session.login(account);
        for (const list of lists) {
            const outcome = await session.exportList(list);
            if ('download' in outcome) {
                const csv = await saveCsv(outcome.download, `landvoice-${name}-${list.name}`);
                log.info(`${list.name}: exported ${outcome.entries} entries -> ${csv.csvKey}`);
                onListDone({ list: list.name, status: 'EXPORTED', entries: outcome.entries, ...csv });
            } else {
                log.info(`${list.name}: no entries`);
                onListDone({ list: list.name, status: 'NO_ENTRIES', entries: 0 });
            }
        }
    } catch (raw) {
        const err = toLvError(raw);
        const shot = await session.screenshot();
        if (shot) err.screenshotKey = await saveScreenshot(shot, `error-${name}-a${attempt}`).catch(() => undefined);
        throw err;
    } finally {
        await context.close().catch(() => {});
    }
}
