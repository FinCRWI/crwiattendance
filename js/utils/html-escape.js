/**
 * HTML / attribute escaping helpers used across the app.
 */

/**
 * Escape a value for safe insertion into HTML text or attribute values.
 */
export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escape a value for use inside a single-quoted JavaScript string literal
 * (e.g. inline `onclick="..."` handlers).
 */
export function escapeJsSingleQuote(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

/**
 * Alias kept for compatibility with dialog markup. Same as `escapeHtml`.
 */
export const escapeDialogHtml = escapeHtml;

/**
 * Escape a dialog message and preserve line breaks as `<br>` tags.
 */
export function renderDialogMessage(message) {
    return escapeHtml(message).replace(/\n/g, '<br>');
}

if (typeof window !== 'undefined') {
    window.app_escapeHtml = escapeHtml;
    window.app_escapeJsSingleQuote = escapeJsSingleQuote;
}
