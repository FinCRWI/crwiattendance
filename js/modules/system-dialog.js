/**
 * System dialog helpers: alert, confirm, prompt and mandatory-rejection prompt.
 *
 * These replace the native `window.alert` with a styled modal and provide
 * promise-based `appAlert`, `appConfirm` and `appPrompt` helpers.
 */

import { escapeDialogHtml, renderDialogMessage } from '../utils/html-escape.js';

export function appSystemDialog({
    title = 'Notice',
    message = '',
    mode = 'alert',
    defaultValue = '',
    confirmText = 'OK',
    cancelText = 'Cancel',
    placeholder = ''
} = {}) {
    return new Promise((resolve) => {
        const modalId = `system-dialog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const inputId = `${modalId}-input`;
        const isPrompt = mode === 'prompt';
        const isConfirm = mode === 'confirm' || mode === 'prompt';
        const html = `
                <div class="modal-overlay app-system-dialog-overlay" id="${modalId}" style="display:flex;">
                    <div class="modal-content app-system-dialog">
                        <div class="app-system-dialog-head">
                            <h3>${escapeDialogHtml(title)}</h3>
                            <button type="button" class="app-system-dialog-close" aria-label="Close dialog">&times;</button>
                        </div>
                        <div class="app-system-dialog-body">
                            <p>${renderDialogMessage(message)}</p>
                            ${isPrompt ? `<input id="${inputId}" class="app-system-dialog-input" type="text" value="${escapeDialogHtml(defaultValue)}" placeholder="${escapeDialogHtml(placeholder)}" autocomplete="off">` : ''}
                        </div>
                        <div class="app-system-dialog-actions">
                            ${isConfirm ? `<button type="button" class="action-btn secondary app-system-dialog-cancel">${escapeDialogHtml(cancelText)}</button>` : ''}
                            <button type="button" class="action-btn app-system-dialog-confirm">${escapeDialogHtml(confirmText)}</button>
                        </div>
                    </div>
                </div>
            `;

        // Mount system dialogs at top-level body so they always appear above active screens.
        (document.body || document.getElementById('modal-container')).insertAdjacentHTML('beforeend', html);

        const modalEl = document.getElementById(modalId);
        if (!modalEl) {
            resolve(isPrompt ? null : false);
            return;
        }
        modalEl.style.zIndex = '20000';
        const confirmBtn = modalEl.querySelector('.app-system-dialog-confirm');
        const cancelBtn = modalEl.querySelector('.app-system-dialog-cancel');
        const closeBtn = modalEl.querySelector('.app-system-dialog-close');
        const inputEl = isPrompt ? modalEl.querySelector(`#${inputId}`) : null;

        const cleanup = (result) => {
            modalEl.remove();
            resolve(result);
        };

        confirmBtn?.addEventListener('click', () => {
            cleanup(isPrompt ? (inputEl ? inputEl.value : '') : true);
        });
        cancelBtn?.addEventListener('click', () => cleanup(isPrompt ? null : false));
        closeBtn?.addEventListener('click', () => cleanup(isPrompt ? null : false));
        modalEl.addEventListener('click', (ev) => {
            if (ev.target === modalEl) cleanup(isPrompt ? null : false);
        });
        modalEl.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') cleanup(isPrompt ? null : false);
            if (ev.key === 'Enter') {
                ev.preventDefault();
                cleanup(isPrompt ? (inputEl ? inputEl.value : '') : true);
            }
        });

        if (inputEl) {
            inputEl.focus();
            inputEl.select();
        } else {
            confirmBtn?.focus();
        }
    });
}

export const appAlert = (message, title = 'Notice') => appSystemDialog({ title, message, mode: 'alert', confirmText: 'OK' });
export const appConfirm = (message, title = 'Please Confirm') => appSystemDialog({ title, message, mode: 'confirm', confirmText: 'Confirm', cancelText: 'Cancel' });
export const appPrompt = (message, defaultValue = '', opts = {}) => appSystemDialog({
    title: opts.title || 'Enter Details',
    message,
    mode: 'prompt',
    defaultValue,
    confirmText: opts.confirmText || 'Save',
    cancelText: opts.cancelText || 'Cancel',
    placeholder: opts.placeholder || ''
});

export async function appRequestMandatoryRejectionReason({
    title = 'Reject Item',
    message = 'Please enter the rejection reason.',
    confirmText = 'Submit Reason'
} = {}) {
    while (true) {
        const reason = await window.appPrompt(message, '', { title, confirmText });
        if (reason === null) return null;
        const trimmed = String(reason || '').trim();
        if (trimmed) return trimmed;
        await window.appAlert('A rejection reason is required to continue.', 'Reason Required');
    }
}

if (typeof window !== 'undefined') {
    window.app_systemDialog = appSystemDialog;
    window.appAlert = appAlert;
    window.appConfirm = appConfirm;
    window.appPrompt = appPrompt;
    window.app_requestMandatoryRejectionReason = appRequestMandatoryRejectionReason;
    window.alert = (message) => appAlert(message);
}
