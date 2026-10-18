import { Actor, log as rootLog, type ProxyConfiguration } from 'apify';
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';
import { BLOCKED_RESOURCE_TYPES, BLOCKED_URL, HIDE_OVERLAYS_CSS, LOGIN_URL, SEL } from './config.js';
import type { Account, AttemptOutcome, RunOptions } from './types.js';
import { ERR, kvKey, LvError, maskEmail, raceVisible, toLvError } from './utils.js';

type Log = typeof rootLog;

export async function processAccount(
    browser: Browser,
    account: Account,
    opts: RunOptions,
    attempt: number,
): Promise<AttemptOutcome> {
    const log = rootLog.child({ prefix: `[${maskEmail(account.email)}#${attempt}]` });
    const context = await createContext(browser, account, opts);
    const page = await context.newPage();

    try {
        await login(page, account, opts.timeoutMs, log);
        return { status: 'LOGGED_IN' };
    } catch (raw) {
        const err = toLvError(raw);
        if (!page.isClosed()) err.screenshotKey = await saveScreenshot(page, account, attempt);
        throw err;
    } finally {
        await context.close().catch(() => {});
    }
}

async function createContext(browser: Browser, account: Account, opts: RunOptions): Promise<BrowserContext> {
    const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1366, height: 900 },
        proxy: opts.proxy ? await stickyProxy(opts.proxy, account.email) : undefined,
    });
    context.setDefaultTimeout(opts.timeoutMs);
    await context.route('**/*', (route) => {
        const req = route.request();
        return BLOCKED_RESOURCE_TYPES.has(req.resourceType()) || BLOCKED_URL.test(req.url())
            ? route.abort()
            : route.continue();
    });
    await context.addInitScript((css) => {
        document.addEventListener('DOMContentLoaded', () => {
            const style = document.createElement('style');
            style.textContent = css;
            document.head.append(style);
        });
    }, HIDE_OVERLAYS_CSS);
    return context;
}

async function login(page: Page, { email, password }: Account, timeoutMs: number, log: Log): Promise<void> {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await page.locator(SEL.email).fill(email);
    await page.locator(SEL.password).fill(password);
    await page.locator(SEL.submit).click();

    const outcome = await raceVisible(
        page,
        { ok: SEL.loggedIn, error: SEL.loginError, blocked: SEL.loginBlocked },
        timeoutMs,
    );
    if (outcome === 'error') {
        const text = await page.locator(SEL.loginError).first().innerText().catch(() => '');
        throw new LvError(ERR.LOGIN_FAILED, text.trim() || 'Invalid username or password');
    }
    if (outcome === 'blocked') throw new LvError(ERR.LOGIN_BLOCKED, 'Captcha, MFA or account lock detected');
    log.info(`Logged in -> ${new URL(page.url()).pathname}`);
}

async function saveScreenshot(page: Page, account: Account, attempt: number): Promise<string | undefined> {
    const key = kvKey('error', account.email, `a${attempt}`, Date.now());
    try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true, timeout: 5000 });
        await Actor.setValue(key, buf, { contentType: 'image/jpeg' });
        return key;
    } catch {
        return undefined;
    }
}

/** One proxy session per account so all requests share an IP. */
async function stickyProxy(proxy: ProxyConfiguration, email: string): Promise<BrowserContextOptions['proxy']> {
    const raw = await proxy.newUrl(email.replace(/\W/g, '_').slice(0, 50));
    if (!raw) return undefined;
    const url = new URL(raw);
    return {
        server: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
    };
}
