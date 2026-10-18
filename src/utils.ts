import type { Page } from 'playwright';

export const ERR = {
    INVALID_INPUT: 'INVALID_INPUT',
    LOGIN_FAILED: 'LOGIN_FAILED',
    LOGIN_BLOCKED: 'LOGIN_BLOCKED',
    TIMEOUT: 'TIMEOUT',
    NAVIGATION: 'NAVIGATION',
    UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ERR)[keyof typeof ERR];

const NON_RETRYABLE = new Set<ErrorCode>([ERR.INVALID_INPUT, ERR.LOGIN_FAILED, ERR.LOGIN_BLOCKED]);

export class LvError extends Error {
    override name = 'LvError';
    screenshotKey?: string;

    constructor(readonly code: ErrorCode, message: string, options?: { cause?: unknown }) {
        super(message, options);
    }

    get retryable(): boolean {
        return !NON_RETRYABLE.has(this.code);
    }
}

export function toLvError(err: unknown): LvError {
    if (err instanceof LvError) return err;
    const msg = err instanceof Error ? err.message : String(err);
    if ((err instanceof Error && err.name === 'TimeoutError') || /timeout/i.test(msg)) {
        return new LvError(ERR.TIMEOUT, msg, { cause: err });
    }
    if (/net::|ERR_|Navigation|Target (page|closed)|has been closed/i.test(msg)) {
        return new LvError(ERR.NAVIGATION, msg, { cause: err });
    }
    return new LvError(ERR.UNKNOWN, msg, { cause: err });
}

/**
 * Waits for whichever selector becomes visible first and returns its key.
 * A single combined wait (locator.or) instead of parallel waits, so overlay handlers fire once.
 */
export async function raceVisible<K extends string>(page: Page, selectors: Record<K, string>, timeout: number): Promise<K> {
    const entries = (Object.entries(selectors) as [K, string][]).map(([key, sel]) => [key, page.locator(sel).first()] as const);
    const anyOf = entries.map(([, loc]) => loc).reduce((a, b) => a.or(b));
    try {
        await anyOf.first().waitFor({ state: 'visible', timeout });
    } catch {
        throw new LvError(ERR.TIMEOUT, `None of [${entries.map(([k]) => k).join(', ')}] appeared within ${timeout}ms`);
    }
    for (const [key, loc] of entries) if (await loc.isVisible()) return key;
    throw new LvError(ERR.UNKNOWN, 'Matched element disappeared before it could be identified');
}

export async function withRetry<T>(
    fn: (attempt: number) => Promise<T>,
    retries: number,
    onRetry: (err: LvError, attempt: number) => void,
): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await fn(attempt);
        } catch (raw) {
            const err = toLvError(raw);
            if (!err.retryable || attempt > retries) throw err;
            onRetry(err, attempt);
            await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 5000)));
        }
    }
}

export async function runPool<T>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
    let next = 0;
    const runner = async () => {
        while (next < items.length) {
            const i = next++;
            await worker(items[i]!, i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

export function kvKey(...parts: (string | number)[]): string {
    return parts.join('-').replace(/[^a-zA-Z0-9!\-_.'()]/g, '_').slice(0, 250);
}

export function maskEmail(email: string): string {
    const [user = '', domain] = email.split('@');
    return domain ? `${user.slice(0, 2)}***@${domain}` : '***';
}
