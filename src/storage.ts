import { readFile } from 'node:fs/promises';
import { Actor } from 'apify';
import type { Download } from 'playwright';
import type { CsvFile } from './types.js';
import { ERR, LvError } from './utils.js';

/** Waits for the download to finish and stores it in the run's key-value store. */
export async function saveCsv(download: Download, name: string): Promise<CsvFile> {
    const failure = await download.failure();
    if (failure) throw new LvError(ERR.EXPORT_FAILED, `Download failed: ${failure}`);
    const buf = await readFile(await download.path());
    if (!buf.length) throw new LvError(ERR.EXPORT_FAILED, 'Downloaded file is empty');

    const key = `${kvKey(name, timestamp())}.csv`;
    await Actor.setValue(key, buf, { contentType: 'text/csv; charset=utf-8' });
    const store = await Actor.openKeyValueStore();
    return { csvKey: key, csvUrl: store.getPublicUrl(key) };
}

export async function saveScreenshot(jpeg: Buffer, name: string): Promise<string> {
    const key = kvKey(name, Date.now());
    await Actor.setValue(key, jpeg, { contentType: 'image/jpeg' });
    return key;
}

function kvKey(...parts: (string | number)[]): string {
    return parts.join('-').replace(/[^a-zA-Z0-9!\-_.'()]/g, '_').slice(0, 250);
}

function timestamp(): string {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}
