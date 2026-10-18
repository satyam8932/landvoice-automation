export const LOGIN_URL = 'https://app.landvoice.com/signin';

export const SEL = {
    email: 'input[placeholder="Username" i]',
    password: 'input[type="password"]',
    submit: 'button:has-text("Login")',
    loggedIn: 'button:has-text("Actions")',
    loginError: 'text=/Invalid username or password/i',
    loginBlocked: 'iframe[src*="captcha"], :text-matches("verification code|account (is )?locked", "i")',
};

// HubSpot consent banner, chat widget and trackers never load.
export const BLOCKED_URL =
    /hs-banner\.com|hubspot|hs-scripts|hs-analytics|hsforms|usemessages\.com|google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|clarity\.ms/i;
export const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

// Fallback in case the consent banner is ever served from another host.
export const HIDE_OVERLAYS_CSS = '#hs-eu-cookie-confirmation{display:none!important}';
