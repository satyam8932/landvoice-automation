import type { ProxyConfiguration } from 'apify';

export interface Account {
    email: string;
    password: string;
    label?: string;
}

export interface Input {
    email?: string;
    password?: string;
    accounts?: Partial<Account>[];
    concurrency?: number;
    maxRetries?: number;
    timeoutSecs?: number;
    failOnAnyError?: boolean;
    headless?: boolean;
    proxyConfiguration?: { useApifyProxy?: boolean; proxyUrls?: string[] };
}

export interface RunOptions {
    timeoutMs: number;
    proxy?: ProxyConfiguration;
}

export type AttemptOutcome = { status: 'LOGGED_IN' };

export type AccountResult = (AttemptOutcome | { status: 'FAILED' }) & {
    email: string;
    label: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    screenshotKey?: string | null;
    attempts: number;
    durationMs: number;
};
