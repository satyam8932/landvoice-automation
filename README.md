# Landvoice CSV Exporter (Apify Actor)

Logs into each Landvoice account and exports the leads CSV, but only when the account has entries. It's built to be called from n8n.

## How it works
- One Chromium process runs **one isolated context per account** (no cookie bleed). Accounts run in parallel up to `concurrency`.
- **No fixed sleeps.** Every wait is Playwright auto-wait, or `raceVisible()`, which resolves on whichever outcome appears first: dashboard vs. login error vs. captcha, or rows vs. "no results".
- Images, fonts, media and trackers are blocked to save bandwidth and CPU.
- Transient errors (timeouts, network) are retried with backoff. Bad credentials and captcha/MFA are **not** retried.
- Results are pushed to the dataset as each account finishes, so a timeout or abort still keeps partial results.

## Before the first run: fill in selectors
Everything site-specific lives in `src/config.js` (marked `TODO`). To capture the real selectors:
```bash
npx playwright codegen https://www.landvoice.com
```

## Local run
```bash
npm install
npx playwright install chromium
npm i -g apify-cli
# edit storage/key_value_stores/default/INPUT.json
apify run --purge
```

## Deploy
```bash
apify login
apify push
```

## Input
```json
{ "email": "a@b.com", "password": "..." }
```
or a batch:
```json
{ "accounts": [{ "email": "a@b.com", "password": "...", "label": "office-1" }], "concurrency": 3 }
```
Optional settings: `maxRetries`, `navigationTimeoutSecs`, `actionTimeoutSecs`, `downloadTimeoutSecs`, `includeCsvContent`, `screenshotOnError`, `failOnAnyError`, `proxyConfiguration`, `headless`.

## Output
Each account adds one dataset item:

| field | meaning |
|---|---|
| `status` | `EXPORTED` \| `NO_ENTRIES` \| `FAILED` |
| `entries`, `csvRows`, `csvBytes` | counts |
| `csvUrl` / `csvKey` | CSV in the run's key-value store |
| `csvContent` | raw CSV text (only if `includeCsvContent`) |
| `errorCode` | `LOGIN_FAILED`, `LOGIN_BLOCKED`, `TIMEOUT`, `NAVIGATION`, `EXPORT_FAILED`, `UNKNOWN` |
| `screenshotKey` | failure screenshot in the key-value store |

The `OUTPUT` record in the key-value store holds the totals plus all results.

## Calling from n8n
- **Apify node**: choose *Run Actor and get dataset items*, with the input JSON above. One n8n item comes back per account.
- **HTTP Request**: `POST https://api.apify.com/v2/acts/<user>~landvoice-csv-exporter/run-sync-get-dataset-items?token=<TOKEN>` with the input as the JSON body. Sync runs are capped at 300s, so for large batches start the run asynchronously (`/runs`) and poll it, or use a webhook.
- To fetch the CSV, either GET `csvUrl` (append `?token=` if the store isn't public) or set `includeCsvContent: true`.
- Branch on `status` / `errorCode`. With `failOnAnyError: false` (the default), the run succeeds and n8n receives every per-account result, including failures.

## Cost and speed tips
- Use memory of about 1 GB for `concurrency` 2–3, and about 2 GB for 4–6.
- Use `proxyConfiguration` only if Landvoice blocks datacenter IPs.
