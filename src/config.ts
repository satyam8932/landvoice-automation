export const BASE_URL = 'https://app.landvoice.com';
export const LOGIN_URL = `${BASE_URL}/signin`;
export const DOWNLOAD_TIMEOUT_MS = 180_000;
export const DATE_RANGE = 'Today';
export const EXPORT_TEMPLATE = 'Everything';

interface LeadListSpec {
    name: string;
    /** Page path; matched case-insensitively as a prefix (/expireds also matches /expireds/search). */
    path: string;
    /** Listing endpoint the page calls; its `total_records` decides whether to export. */
    api: string;
}

/**
 * Every exportable tab. They share one UI, so adding a tab is one entry here
 * (the key must equal `name`; output fields like isExport<Name> are derived from it).
 */
export const LEAD_LISTS = {
    expireds: { name: 'expireds', path: '/expireds', api: '/api/expired/listing' },
    fsbo: { name: 'fsbo', path: '/fsbo', api: '/api/fsbo/listing' },
    preforeclosure: { name: 'preforeclosure', path: '/Preforeclosure', api: '/api/preforeclosure/listing' },
} as const satisfies Record<string, LeadListSpec>;

export type LeadListName = keyof typeof LEAD_LISTS;
export type LeadList = (typeof LEAD_LISTS)[LeadListName];

export const SEL = {
    email: 'input[placeholder="Username" i]',
    password: 'input[type="password"]',
    submit: 'button:has-text("Login")',
    loggedIn: 'button:has-text("Actions")',
    loginError: 'text=/Invalid username or password/i',
    loginBlocked: 'iframe[src*="captcha"], :text-matches("verification code|account (is )?locked", "i")',

    tourFinish: 'button:has-text("Finish")',
    listCount: 'text=/Showing \\d+ to \\d+ of [\\d,]+/i',
    noResults: 'text=/reset\\s*your\\s*filters/i',
    resultCard: '.search-result-card',
    drawerClose: 'button:has(svg.lucide-x)',
};

// HubSpot consent banner, chat widget and trackers never load.
export const BLOCKED_URL =
    /hs-banner\.com|hubspot|hs-scripts|hs-analytics|hsforms|usemessages\.com|inspectlet|google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|clarity\.ms/i;
export const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

// Fallback in case the consent banner is ever served from another host.
export const HIDE_OVERLAYS_CSS = '#hs-eu-cookie-confirmation{display:none!important}';
