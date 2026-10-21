import type { ProxyConfiguration } from 'apify';
import type { LeadListName } from './config.js';

export interface Account {
    email: string;
    password: string;
    label?: string;
}

export interface Input {
    email?: string;
    password?: string;
    label?: string;
    accounts?: Partial<Account>[];
    lists?: string[];
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

export interface CsvFile {
    csvKey: string;
    csvUrl: string;
}

export type ListExport = { list: LeadListName } & (
    | { status: 'NO_ENTRIES'; entries: 0 }
    | ({ status: 'EXPORTED'; entries: number } & CsvFile)
);

/**
 * Per-list output fields, e.g. isExportExpireds / expiredsCount / expiredsCsvUrl / expiredsCsvKey.
 * isExport* is true = CSV exported, false = checked but no entries, null = not checked.
 */
export type ListFields = { [K in LeadListName as `isExport${Capitalize<K>}`]: boolean | null } & {
    [K in LeadListName as `${K}Count`]: number | null;
} & { [K in LeadListName as `${K}CsvUrl`]: string | null } & { [K in LeadListName as `${K}CsvKey`]: string | null };

/** One dataset item per account; `email` is the key to map results back in n8n. */
export type AccountResult = {
    email: string;
    label: string | null;
    status: 'EXPORTED' | 'NO_ENTRIES' | 'FAILED';
    errorCode: string | null;
    errorMessage: string | null;
} & ListFields & {
    screenshotKey: string | null;
    attempts: number;
    durationMs: number;
    finishedAt: string;
};
