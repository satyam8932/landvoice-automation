import type { ProxyConfiguration } from 'apify';
import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright';
import { BLOCKED_RESOURCE_TYPES, BLOCKED_URL, HIDE_OVERLAYS_CSS } from './config.js';
import type { RunOptions } from './types.js';

/** Isolated, lean browser context: own cookies, no media/trackers, consent banner suppressed. */
export async function createContext(
    browser: Browser,
    { timeoutMs, proxy }: RunOptions,
    sessionId: string,
): Promise<BrowserContext> {
    const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1366, height: 900 },
        proxy: proxy ? await stickyProxy(proxy, sessionId) : undefined,
    });
    context.setDefaultTimeout(timeoutMs);

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

/** One proxy session per account so all its requests share an IP. */
async function stickyProxy(proxy: ProxyConfiguration, sessionId: string): Promise<BrowserContextOptions['proxy']> {
    const raw = await proxy.newUrl(sessionId.replace(/\W/g, '_').slice(0, 50));
    if (!raw) return undefined;
    const url = new URL(raw);
    return {
        server: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
    };
}
