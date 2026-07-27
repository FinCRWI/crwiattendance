/**
 * Date formatting helpers used across the app.
 */

/**
 * Return a local YYYY-MM-DD string for a date (default now).
 * Mirrors the legacy `getLocalISO` helper previously in app.js.
 */
export function getLocalISO(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

if (typeof window !== 'undefined') {
    window.app_getLocalISO = getLocalISO;
}
