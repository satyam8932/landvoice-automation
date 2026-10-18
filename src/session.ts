import type { log } from 'apify';
import type { Download, Page, Response } from 'playwright';
import { BASE_URL, DATE_RANGE, DOWNLOAD_TIMEOUT_MS, EXPORT_TEMPLATE, type LeadList, LOGIN_URL, SEL } from './config.js';
import type { Account } from './types.js';
import { ERR, LvError, raceVisible, toLvError } from './utils.js';

type Log = typeof log;

export type ListOutcome = { entries: 0 } | { entries: number; download: Download };

/** Drives one Landvoice browser tab. UI automation only; knows nothing about storage. */
export class LandvoiceSession {
    constructor(
        private readonly page: Page,
        private readonly timeoutMs: number,
        private readonly log: Log,
    ) {}

    async login({ email, password }: Account): Promise<void> {
        const { page } = this;
        await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
        await page.locator(SEL.email).fill(email);
        await page.locator(SEL.password).fill(password);
        await page.locator(SEL.submit).click();

        const outcome = await raceVisible(
            page,
            { ok: SEL.loggedIn, error: SEL.loginError, blocked: SEL.loginBlocked },
            this.timeoutMs,
        );
        if (outcome === 'error') {
            const text = await page.locator(SEL.loginError).first().innerText().catch(() => '');
            throw new LvError(ERR.LOGIN_FAILED, text.trim() || 'Invalid username or password');
        }
        if (outcome === 'blocked') throw new LvError(ERR.LOGIN_BLOCKED, 'Captcha, MFA or account lock detected');

        // Onboarding tour appears after login; dismissed only if it blocks a click.
        await page.addLocatorHandler(page.locator(SEL.tourFinish), (btn) => btn.click(), { noWaitAfter: true, times: 1 });
        this.log.info(`Logged in -> ${new URL(page.url()).pathname}`);
    }

    /** Opens the list, applies the date range and, if anything matches, downloads the CSV. */
    async exportList(list: LeadList): Promise<ListOutcome> {
        await this.open(list);
        const entries = await this.filterByDateRange(list);
        if (!entries) return { entries: 0 };
        return { entries, download: await this.downloadCsv() };
    }

    async screenshot(): Promise<Buffer | undefined> {
        if (this.page.isClosed()) return undefined;
        return this.page.screenshot({ type: 'jpeg', quality: 60, fullPage: true, timeout: 5000 }).catch(() => undefined);
    }

    private async open(list: LeadList): Promise<void> {
        const { page } = this;
        const alreadyThere = new URL(page.url()).pathname.toLowerCase().startsWith(list.path.toLowerCase());
        if (!alreadyThere) await page.goto(BASE_URL + list.path, { waitUntil: 'domcontentloaded' });
        // Initial results must settle first, or a late response could overwrite the filtered view.
        await raceVisible(page, { ready: SEL.listCount, empty: SEL.noResults }, this.timeoutMs);
    }

    /** Selects the date range in the Filters drawer and returns how many records match. */
    private async filterByDateRange(list: LeadList): Promise<number> {
        const { page } = this;
        await page.getByRole('button', { name: 'Filters', exact: true }).click();
        const drawer = page.getByRole('dialog').filter({ hasText: 'Date Range' });
        const rangeTab = drawer.getByRole('tab', { name: DATE_RANGE, exact: true });

        let total: number | null = null;
        if ((await rangeTab.getAttribute('aria-selected')) !== 'true') {
            const [response] = await Promise.all([
                page.waitForResponse((res) => isSingleDayListing(res, list), { timeout: this.timeoutMs }),
                rangeTab.click(),
            ]);
            total = ((await response.json()) as { total_records: number }).total_records;
        }

        await drawer.locator(SEL.drawerClose).click();
        await drawer.waitFor({ state: 'hidden' });

        if (total === null) {
            // Range was already selected, so no request fired: read the result from the page.
            const state = await raceVisible(page, { records: SEL.resultCard, empty: SEL.noResults }, this.timeoutMs);
            return state === 'empty' ? 0 : parseTotal(await page.locator(SEL.listCount).first().innerText());
        }
        if (total > 0) {
            // Act only once the page shows the filtered result.
            await page.getByText(new RegExp(`Showing \\d+ to \\d+ of ${total.toLocaleString('en-US')}$`)).first().waitFor();
        }
        return total;
    }

    private async downloadCsv(): Promise<Download> {
        const { page } = this;
        await page.getByRole('button', { name: 'Actions' }).click();
        await page.getByRole('menuitem', { name: /^Export/ }).click();

        const dialog = page.getByRole('dialog').filter({ hasText: /Export [\d,]+ propert/ });
        await dialog.getByRole('tab', { name: 'CSV' }).click();
        await dialog.getByRole('combobox').click();
        await page.getByRole('option', { name: EXPORT_TEMPLATE, exact: true }).click();

        // Listener is armed before the click so a fast download can't be missed.
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS }),
            dialog.getByRole('button', { name: 'Export', exact: true }).click(),
        ]).catch((err: unknown) => {
            throw new LvError(ERR.EXPORT_FAILED, `Download did not start: ${toLvError(err).message}`, { cause: err });
        });
        return download;
    }
}

/** The listing response for a single-day range that carries the record count. */
async function isSingleDayListing(res: Response, list: LeadList): Promise<boolean> {
    const url = new URL(res.url());
    if (url.pathname !== list.api || url.searchParams.get('from_date') !== url.searchParams.get('to_date')) return false;
    const body = (await res.json().catch(() => null)) as { total_records?: unknown } | null;
    return typeof body?.total_records === 'number';
}

/** "Showing 1 to 25 of 3,009" -> 3009 */
function parseTotal(text: string): number {
    const match = /of\s+([\d,]+)/i.exec(text);
    if (!match?.[1]) throw new LvError(ERR.UNKNOWN, `Could not read record count from "${text}"`);
    return Number(match[1].replace(/,/g, ''));
}
