/**
 * Minutes UI Component
 * Handles rendering of meeting minutes, action items, and approval workflows.
 *
 * Improvements over original:
 *  - Module-scoped state instead of window._minutesUiState
 *  - Handlers registered once (initMinutesHandlers) not on every render
 *  - Toast notifications replace every alert() / confirm()
 *  - Async buttons show loading state; never leave UI frozen
 *  - sanitizeMinutesHtml walker fixed: moved children are re-walked
 *  - parseMinuteDate used consistently (no raw `new Date(dateString)`)
 *  - getMinuteSearchText does single allUsers.find() per user
 *  - filterMinutes visible-count split between list/calendar correctly
 *  - CSS extracted from the HTML return value into injectMinutesStyles()
 *    called once, not on every render
 *  - Render split into focused helpers: renderMinuteCard, renderCalendarView,
 *    renderListView, renderNewMinuteForm, renderDetailModal
 *  - Inline styles replaced with CSS classes wherever possible
 */

import { safeHtml, safeAttr } from './helpers.js';
import { renderYearlyPlan } from './team-schedule.js';

// ---------------------------------------------------------------------------
// Module-scoped state  (survives re-renders, resets on explicit init)
// ---------------------------------------------------------------------------

const _state = {
    viewMode: 'list',
    searchQuery: '',
    monthKey: '',          // set in init()
    handlersRegistered: false,
    stylesInjected: false,
    selectedAttendeeIds: new Set(),
    allUsers: [],          // cached after first load
    isDirty: false,        // true when user is in form/edit mode
    formSnapshot: null,    // captured form state for restore after re-render
};

// ---------------------------------------------------------------------------
// Form state capture / restore
// ---------------------------------------------------------------------------

function captureNewMinuteFormState() {
    const form = document.getElementById('new-minute-form');
    if (!form || form.style.display === 'none') return null;

    const title = document.getElementById('new-minute-title')?.value || '';
    const date = document.getElementById('new-minute-date')?.value || '';
    const editor = document.getElementById('new-minute-content-editor');
    const contentHtml = editor ? editor.innerHTML : '';
    const actionItems = Array.from(document.querySelectorAll('.action-item-row-card')).map((row) => ({
        task: row.querySelector('.action-task')?.value || '',
        assignee: row.querySelector('.action-assignee')?.value || '',
        due: row.querySelector('.action-due')?.value || '',
    }));

    return {
        title,
        date,
        contentHtml,
        attendeeIds: new Set(_state.selectedAttendeeIds),
        actionItems,
    };
}

function restoreNewMinuteFormState(snapshot) {
    if (!snapshot) return;

    const form = document.getElementById('new-minute-form');
    if (!form) return;

    form.style.display = 'block';

    const titleEl = document.getElementById('new-minute-title');
    if (titleEl) titleEl.value = snapshot.title;

    const dateEl = document.getElementById('new-minute-date');
    if (dateEl) dateEl.value = snapshot.date;

    const editor = document.getElementById('new-minute-content-editor');
    if (editor) editor.innerHTML = snapshot.contentHtml;

    _state.selectedAttendeeIds = snapshot.attendeeIds;
    window.app_refreshAttendeeChips?.();

    document.querySelectorAll('.attendee-item-modern input[type="checkbox"]').forEach((cb) => {
        cb.checked = _state.selectedAttendeeIds.has(cb.value);
    });

    const container = document.getElementById('action-items-container');
    if (container && snapshot.actionItems.length) {
        container.innerHTML = '';
        snapshot.actionItems.forEach((item) => {
            window.app_addActionItemRow?.();
            const rows = document.querySelectorAll('.action-item-row-card');
            const lastRow = rows[rows.length - 1];
            if (lastRow) {
                const taskInput = lastRow.querySelector('.action-task');
                if (taskInput) taskInput.value = item.task;
                const assigneeSelect = lastRow.querySelector('.action-assignee');
                if (assigneeSelect) assigneeSelect.value = item.assignee;
                const dueInput = lastRow.querySelector('.action-due');
                if (dueInput) dueInput.value = item.due;
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function parseMinuteDate(value) {
    if (!value) return null;
    // yyyy-mm-dd  →  treat as local midnight to avoid UTC off-by-one
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00`);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatMinuteDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
    const parsed = parseMinuteDate(value);
    return parsed ? parsed.toLocaleDateString(undefined, options) : 'Date not set';
}

function todayIsoDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthKeyToDate(key) {
    const fallback = currentMonthKey();
    const [year, month] = String(key || fallback).split('-').map(Number);
    if (!year || !month) {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    return new Date(year, month - 1, 1);
}

// ---------------------------------------------------------------------------
// HTML sanitiser  (fixed: re-walk moved children)
// ---------------------------------------------------------------------------

function sanitizeMinutesHtml(rawHtml = '') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${rawHtml || ''}</div>`, 'text/html');
    const wrapper = doc.body.firstElementChild;
    if (!wrapper) return '';

    const ALLOWED_TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'A']);
    const ALLOWED_ATTRS = { A: new Set(['href', 'target', 'rel']) };

    function walk(node) {
        if (!node || !node.childNodes) return;
        // snapshot so mutations don't affect iteration
        const children = Array.from(node.childNodes);
        children.forEach((child) => {
            if (child.nodeType !== Node.ELEMENT_NODE) return;

            if (!ALLOWED_TAGS.has(child.tagName)) {
                // unwrap: move children before the disallowed element
                const moved = Array.from(child.childNodes);
                moved.forEach((c) => node.insertBefore(c, child));
                if (child.parentNode === node) {
                    node.removeChild(child);
                }
                // re-walk moved children so nested disallowed tags are caught
                moved.forEach((c) => walk(c));
                return;
            }

            // strip disallowed attributes
            Array.from(child.attributes).forEach((attr) => {
                const allowed = ALLOWED_ATTRS[child.tagName];
                if (!allowed || !allowed.has(attr.name.toLowerCase())) {
                    child.removeAttribute(attr.name);
                }
            });

            // anchor safety
            if (child.tagName === 'A') {
                const href = (child.getAttribute('href') || '').trim();
                if (/^(https?:|mailto:|#)/i.test(href)) {
                    child.setAttribute('target', '_blank');
                    child.setAttribute('rel', 'noopener noreferrer');
                } else {
                    child.removeAttribute('href');
                }
            }

            walk(child);
        });
    }

    walk(wrapper);
    return wrapper.innerHTML.trim();
}

function htmlToPlainText(html = '') {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return (div.innerText || div.textContent || '').replace(/\r/g, '').trim();
}

function plainTextToRichHtml(text = '') {
    return safeHtml(text || '').replace(/\n/g, '<br>');
}

function renderSafeRichContent(html = '', textFallback = '') {
    const safeRich = sanitizeMinutesHtml(html || '');
    if (safeRich) return safeRich;
    return plainTextToRichHtml(textFallback || '');
}

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

function hasMinuteDetailAccess(m, user) {
    if (!m || !user) return false;
    if (window.app_hasPerm('minutes', 'view', user)) return true;
    if (m.createdBy === user.id) return true;
    if ((m.attendeeIds || []).includes(user.id)) return true;
    if ((m.allowedViewers || []).includes(user.id)) return true;
    if ((m.actionItems || []).some((a) => a.assignedTo === user.id)) return true;
    return false;
}

function getMinuteRequestStatus(m, userId) {
    const req = (m.accessRequests || []).find((r) => r.userId === userId);
    return req ? req.status : '';
}

// ---------------------------------------------------------------------------
// Search text  (single find per user)
// ---------------------------------------------------------------------------

function getMinuteSearchText(minute) {
    const attendeeNames = (minute.attendeeIds || [])
        .map((id) => {
            const u = _state.allUsers.find((u) => u.id === id);
            return u?.name || u?.username || '';
        })
        .join(' ');
    return [minute.title, minute.date, minute.content, attendeeNames].join(' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// Rich editor helpers
// ---------------------------------------------------------------------------

function getRichContentPayload(editorId, fallbackTextId = '') {
    const editor = document.getElementById(editorId);
    const rawHtml = editor ? editor.innerHTML : '';
    const html = sanitizeMinutesHtml(rawHtml);
    let text = htmlToPlainText(html);
    if (!text && fallbackTextId) {
        const fallback = document.getElementById(fallbackTextId);
        text = (fallback?.value || '').trim();
    }
    return { html, text };
}

// ---------------------------------------------------------------------------
// Toast notification system  (replaces all alert() calls)
// ---------------------------------------------------------------------------

function ensureToastContainer() {
    let container = document.getElementById('minutes-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'minutes-toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
        document.body.appendChild(container);
    }
    return container;
}

function showToast(message, type = 'info', duration = 4000) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `minutes-toast minutes-toast--${type}`;

    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
    toast.innerHTML = `
        <i class="fa-solid ${icons[type] || icons.info}"></i>
        <span>${safeHtml(message)}</span>
        <button class="minutes-toast__close" aria-label="Dismiss">&times;</button>
    `;

    toast.querySelector('.minutes-toast__close').addEventListener('click', () => dismissToast(toast));
    container.appendChild(toast);

    // trigger entrance animation
    requestAnimationFrame(() => toast.classList.add('minutes-toast--visible'));

    if (duration > 0) setTimeout(() => dismissToast(toast), duration);
    return toast;
}

function dismissToast(toast) {
    toast.classList.remove('minutes-toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
}

// ---------------------------------------------------------------------------
// Confirmation modal  (replaces confirm() for destructive actions)
// ---------------------------------------------------------------------------

function showConfirm(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'minutes-confirm-overlay';
        overlay.innerHTML = `
            <div class="minutes-confirm-dialog" role="dialog" aria-modal="true">
                <p class="minutes-confirm-msg">${safeHtml(message)}</p>
                <div class="minutes-confirm-actions">
                    <button class="action-btn secondary" id="minutes-confirm-cancel">Cancel</button>
                    <button class="action-btn danger" id="minutes-confirm-ok">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('minutes-confirm-overlay--visible'));

        const cleanup = (result) => {
            overlay.classList.remove('minutes-confirm-overlay--visible');
            overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
            resolve(result);
        };

        overlay.querySelector('#minutes-confirm-cancel').addEventListener('click', () => cleanup(false));
        overlay.querySelector('#minutes-confirm-ok').addEventListener('click', () => cleanup(true));
    });
}

// ---------------------------------------------------------------------------
// Async button loading state helper
// ---------------------------------------------------------------------------

function withButtonLoading(btn, label = 'Working…') {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${safeHtml(label)}`;
    return () => {
        btn.disabled = false;
        btn.innerHTML = original;
    };
}

// ---------------------------------------------------------------------------
// CSS injection  (called once; never injected inside HTML return strings)
// ---------------------------------------------------------------------------

function injectMinutesStyles() {
    if (_state.stylesInjected) return;
    _state.stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'minutes-ui-styles';
    style.textContent = `
        /* ── Design tokens ──────────────────────────────────────────────── */
        :root {
            --minutes-primary:   #4f46e5;
            --minutes-secondary: #6366f1;
            --minutes-bg:        #f8fafc;
            --minutes-card-bg:   #ffffff;
            --minutes-text:      #1e293b;
            --minutes-muted:     #64748b;
            --minutes-border:    #e2e8f0;
            --minutes-success:   #10b981;
            --minutes-danger:    #ef4444;
            --minutes-warning:   #f59e0b;
            --minutes-shadow:    0 10px 15px -3px rgba(0,0,0,.05), 0 4px 6px -2px rgba(0,0,0,.02);
        }

        /* ── Layout ─────────────────────────────────────────────────────── */
        .minutes-container {
            padding: 0.5rem;
            color: var(--minutes-text);
            font-family: 'Manrope', sans-serif;
        }

        .minutes-header-section {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-bottom: 2.5rem;
            border-bottom: 1px solid var(--minutes-border);
            padding-bottom: 1.5rem;
        }

        .minutes-header-info h2 {
            font-family: 'Sora', sans-serif;
            font-size: 1.875rem;
            font-weight: 700;
            color: #0f172a;
            margin-bottom: 0.5rem;
        }

        .minutes-header-info p {
            color: var(--minutes-muted);
            font-size: 0.95rem;
        }

        /* ── Buttons ────────────────────────────────────────────────────── */
        .btn-record-meeting {
            background: var(--minutes-primary);
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 12px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
            box-shadow: 0 4px 6px -1px rgba(79,70,229,0.2);
        }
        .btn-record-meeting:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 15px -3px rgba(79,70,229,0.3);
            background: var(--minutes-secondary);
        }
        .btn-record-meeting:disabled {
            opacity: 0.65;
            cursor: not-allowed;
            transform: none;
        }

        .btn-secondary-modern {
            background: #f1f5f9;
            color: var(--minutes-muted);
            border: none;
            padding: 0.75rem 2rem;
            border-radius: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-secondary-modern:hover { background: #e2e8f0; color: var(--minutes-text); }

        .btn-add-task {
            background: #f1f5f9;
            color: var(--minutes-primary);
            border: 2px dashed var(--minutes-primary);
            padding: 0.75rem;
            border-radius: 12px;
            width: 100%;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }
        .btn-add-task:hover { background: #eef2ff; border-style: solid; }

        .mini-btn {
            border: 1.5px solid var(--minutes-border);
            background: white;
            color: var(--minutes-text);
            border-radius: 8px;
            padding: 0.3rem 0.75rem;
            font-size: 0.78rem;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.15s;
        }
        .mini-btn:hover { border-color: var(--minutes-primary); color: var(--minutes-primary); }
        .mini-btn.success { border-color: var(--minutes-success); color: var(--minutes-success); }
        .mini-btn.success:hover { background: #ecfdf5; }
        .mini-btn.danger  { border-color: var(--minutes-danger);  color: var(--minutes-danger); }
        .mini-btn.danger:hover  { background: #fef2f2; }
        .mini-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .action-btn {
            padding: 0.6rem 1.4rem;
            border-radius: 10px;
            font-weight: 700;
            font-size: 0.9rem;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
            background: var(--minutes-primary);
            color: white;
        }
        .action-btn:hover   { background: var(--minutes-secondary); }
        .action-btn.wide    { width: 100%; }
        .action-btn.secondary { background: #f1f5f9; color: var(--minutes-muted); }
        .action-btn.secondary:hover { background: #e2e8f0; color: var(--minutes-text); }
        .action-btn.danger  { background: #fef2f2; color: var(--minutes-danger); border: 1px solid #fecaca; }
        .action-btn.danger:hover  { background: #fee2e2; }
        .action-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        /* ── View toggle ────────────────────────────────────────────────── */
        .minutes-view-controls {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            flex-wrap: wrap;
        }

        .minutes-toggle-group {
            display: inline-flex;
            padding: 0.3rem;
            border-radius: 14px;
            background: #eef2ff;
            border: 1px solid #c7d2fe;
        }

        .minutes-toggle-btn {
            border: none;
            background: transparent;
            color: #4338ca;
            padding: 0.65rem 1rem;
            border-radius: 10px;
            font-weight: 800;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 0.55rem;
            transition: all 0.2s;
        }
        .minutes-toggle-btn.active {
            background: #fff;
            color: #1e1b4b;
            box-shadow: 0 8px 18px rgba(79,70,229,0.12);
        }

        /* ── New meeting form ───────────────────────────────────────────── */
        .form-glass-card {
            background: rgba(255,255,255,0.8);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(226,232,240,0.8);
            border-radius: 20px;
            padding: 2.5rem;
            margin-bottom: 3rem;
            box-shadow: var(--minutes-shadow);
            animation: minutes-slideDown 0.4s ease-out;
        }

        @keyframes minutes-slideDown {
            from { opacity: 0; transform: translateY(-20px); }
            to   { opacity: 1; transform: translateY(0); }
        }

        .form-section-header {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .form-section-header h3 { font-size: 1.25rem; font-weight: 800; color: #0f172a; }

        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
            margin-bottom: 2rem;
        }

        .field-group { display: flex; flex-direction: column; gap: 0.5rem; }

        .field-label {
            font-size: 0.875rem;
            font-weight: 700;
            color: var(--minutes-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .input-premium {
            background: white;
            border: 2px solid var(--minutes-border);
            border-radius: 12px;
            padding: 0.875rem 1rem;
            font-size: 1rem;
            transition: border-color 0.2s;
            outline: none;
            width: 100%;
            box-sizing: border-box;
        }
        .input-premium:focus { border-color: var(--minutes-primary); }

        /* ── Attendee picker ────────────────────────────────────────────── */
        .attendee-picker-container {
            background: #f1f5f9;
            border-radius: 12px;
            padding: 0.9rem;
            margin-bottom: 2rem;
        }

        .attendee-chips-wrapper {
            display: flex;
            flex-wrap: wrap;
            gap: 0.35rem;
            margin-bottom: 1rem;
            min-height: 28px;
        }

        .chip-modern {
            background: var(--minutes-primary);
            color: white;
            padding: 0.2rem 0.55rem;
            border-radius: 999px;
            font-size: 0.78rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            box-shadow: 0 4px 6px -1px rgba(79,70,229,0.2);
            animation: minutes-fadeIn 0.2s ease-out;
        }
        .chip-modern i { cursor: pointer; opacity: 0.8; transition: opacity 0.2s; }
        .chip-modern i:hover { opacity: 1; }

        @keyframes minutes-fadeIn {
            from { opacity: 0; transform: scale(0.9); }
            to   { opacity: 1; transform: scale(1); }
        }

        .search-staff-input {
            width: 100%;
            background: white;
            border: 1px solid var(--minutes-border);
            border-radius: 10px;
            padding: 0.45rem 0.7rem 0.45rem 2.2rem;
            margin-bottom: 1rem;
            font-size: 0.82rem;
            box-sizing: border-box;
        }

        .attendee-search-wrapper { position: relative; }
        .attendee-search-wrapper i {
            position: absolute;
            left: 0.75rem;
            top: 0.55rem;
            color: var(--minutes-muted);
            pointer-events: none;
        }

        .attendee-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(165px, 1fr));
            gap: 0.5rem;
            max-height: 150px;
            overflow-y: auto;
            padding-right: 0.5rem;
        }

        .attendee-item-modern {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            background: white;
            padding: 0.48rem 0.6rem;
            border-radius: 10px;
            border: 1px solid var(--minutes-border);
            cursor: pointer;
            transition: all 0.2s;
            user-select: none;
        }
        .attendee-item-modern:hover { border-color: var(--minutes-secondary); background: #f8fafc; }
        .attendee-item-modern input { width: 15px; height: 15px; cursor: pointer; }
        .attendee-item-modern span  { font-size: 0.82rem; font-weight: 500; color: var(--minutes-text); }

        /* ── Discussion / rich editor ───────────────────────────────────── */
        .discussion-area { margin-bottom: 2rem; }

        .textarea-premium {
            width: 100%;
            min-height: 180px;
            background: white;
            border: 2px solid var(--minutes-border);
            border-radius: 12px;
            padding: 1.25rem;
            font-size: 1rem;
            line-height: 1.6;
            outline: none;
            resize: vertical;
            transition: border-color 0.2s;
            box-sizing: border-box;
        }
        .textarea-premium:focus { border-color: var(--minutes-primary); }

        .rich-editor-shell { border: 2px solid var(--minutes-border); border-radius: 12px; background: #fff; overflow: hidden; }
        .rich-editor-toolbar {
            display: flex;
            flex-wrap: wrap;
            gap: 0.35rem;
            padding: 0.65rem;
            border-bottom: 1px solid var(--minutes-border);
            background: #f8fafc;
        }
        .rich-editor-btn {
            border: 1px solid #cbd5e1;
            background: #fff;
            color: #0f172a;
            border-radius: 8px;
            min-width: 34px;
            height: 32px;
            padding: 0 0.55rem;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
        }
        .rich-editor-btn:hover { border-color: var(--minutes-primary); color: var(--minutes-primary); }

        .rich-editor-area {
            min-height: 180px;
            padding: 1rem;
            outline: none;
            line-height: 1.6;
            font-size: 0.95rem;
        }
        .rich-editor-area:empty::before { content: attr(data-placeholder); color: #94a3b8; }

        .rich-editor-area h2, .rich-minutes-content h2 { font-size: 1.2rem;  margin: 0.55rem 0; }
        .rich-editor-area h3, .rich-minutes-content h3 { font-size: 1.05rem; margin: 0.45rem 0; }
        .rich-editor-area ul, .rich-editor-area ol,
        .rich-minutes-content ul, .rich-minutes-content ol { margin: 0.45rem 0 0.45rem 1.1rem; }
        .rich-minutes-content p { margin: 0.4rem 0; }

        /* ── Action items ───────────────────────────────────────────────── */
        .action-items-section { margin-bottom: 2.5rem; }

        .action-item-row-card {
            display: grid;
            grid-template-columns: 1fr 200px 160px auto;
            gap: 1rem;
            background: white;
            padding: 1rem;
            border-radius: 12px;
            border: 1px solid var(--minutes-border);
            margin-bottom: 0.75rem;
            align-items: center;
            animation: minutes-slideRight 0.3s ease-out;
        }
        @keyframes minutes-slideRight {
            from { opacity: 0; transform: translateX(-10px); }
            to   { opacity: 1; transform: translateX(0); }
        }

        .icon-btn-danger {
            background: #fee2e2;
            color: #ef4444;
            border: none;
            width: 40px;
            height: 40px;
            border-radius: 10px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        .icon-btn-danger:hover { background: #fecaca; }

        .form-footer-modern {
            display: flex;
            justify-content: flex-end;
            gap: 1rem;
            border-top: 1px solid var(--minutes-border);
            padding-top: 2rem;
        }

        /* ── Minutes list ───────────────────────────────────────────────── */
        .minutes-list-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            margin-top: 2rem;
        }

        .minutes-list-header h3 {
            margin: 0;
            font-family: 'Sora', sans-serif;
            font-weight: 800;
            color: #0f172a;
        }

        .minutes-search-wrapper {
            position: relative;
            width: 300px;
        }
        .minutes-search-wrapper i {
            position: absolute;
            left: 1rem;
            top: 50%;
            transform: translateY(-50%);
            color: var(--minutes-muted);
            pointer-events: none;
        }
        .minutes-search-wrapper .input-premium {
            padding-left: 2.75rem;
            padding-top: 0.6rem;
            padding-bottom: 0.6rem;
            font-size: 0.9rem;
        }

        .minutes-list-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.25rem;
        }

        /* ── Meeting card ───────────────────────────────────────────────── */
        .minute-card-modern {
            background: var(--minutes-card-bg);
            border-radius: 20px;
            border: 1px solid var(--minutes-border);
            padding: 1.75rem;
            transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
            display: flex;
            flex-direction: column;
            position: relative;
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,.05);
        }
        .minute-card-modern.clickable { cursor: pointer; }
        .minute-card-modern:hover {
            transform: translateY(-5px);
            box-shadow: 0 20px 25px -5px rgba(0,0,0,.1);
            border-color: var(--minutes-primary);
        }

        .minute-card-status { position: absolute; top: 1.5rem; right: 1.5rem; }

        .status-badge {
            padding: 0.25rem 0.75rem;
            border-radius: 999px;
            font-size: 0.75rem;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
        }
        .status-badge--locked { background: #dcfce7; color: #166534; }
        .status-badge--open   { background: #fff7ed; color: #9a3412; }

        .card-date-badge {
            display: inline-block;
            background: #f1f5f9;
            color: var(--minutes-muted);
            padding: 0.35rem 0.75rem;
            border-radius: 8px;
            font-size: 0.8rem;
            font-weight: 700;
            margin-bottom: 1rem;
        }

        .card-title-modern {
            font-size: 1.25rem;
            font-weight: 800;
            color: #0f172a;
            margin-bottom: 1rem;
            line-height: 1.4;
        }

        .card-metrics {
            display: flex;
            gap: 1.25rem;
            margin-top: auto;
            padding-top: 1.5rem;
            border-top: 1px solid #f1f5f9;
        }
        .metric-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.85rem;
            color: var(--minutes-muted);
            font-weight: 600;
        }
        .metric-item i { color: var(--minutes-primary); }

        .restricted-tag {
            background: #fef2f2;
            color: #991b1b;
            padding: 1rem;
            border-radius: 12px;
            font-size: 0.875rem;
            text-align: center;
            margin-top: 1.5rem;
            font-weight: 600;
        }
        .restricted-tag__pending  { margin-top: 0.5rem; font-size: 0.7rem; color: #f59e0b; }
        .restricted-tag__rejected { margin-top: 0.5rem; font-size: 0.7rem; color: #ef4444; }

        .empty-state-modern {
            grid-column: 1 / -1;
            padding: 5rem;
            text-align: center;
            background: white;
            border-radius: 20px;
            border: 2px dashed var(--minutes-border);
        }
        .empty-state-modern i    { font-size: 4rem; color: var(--minutes-border); margin-bottom: 1.5rem; }
        .empty-state-modern h4   { font-size: 1.5rem; color: var(--minutes-muted); font-weight: 700; }

        /* ── Calendar view ──────────────────────────────────────────────── */
        .minutes-calendar-shell {
            background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
            border: 1px solid var(--minutes-border);
            border-radius: 24px;
            padding: 1.25rem;
            box-shadow: var(--minutes-shadow);
        }

        .minutes-calendar-toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1rem;
            flex-wrap: wrap;
        }
        .minutes-calendar-month {
            font-family: 'Sora', sans-serif;
            font-size: 1.3rem;
            font-weight: 800;
            color: #0f172a;
        }
        .minutes-calendar-toolbar-sub { font-size: 0.85rem; color: var(--minutes-muted); }

        .minutes-month-actions { display: flex; align-items: center; gap: 0.65rem; }
        .minutes-month-btn {
            width: 40px; height: 40px;
            border: 1px solid #cbd5e1;
            background: #fff;
            border-radius: 12px;
            cursor: pointer;
            color: #334155;
            transition: all 0.15s;
        }
        .minutes-month-btn:hover { border-color: var(--minutes-primary); color: var(--minutes-primary); }

        .minutes-calendar-grid {
            display: grid;
            grid-template-columns: repeat(7, minmax(0, 1fr));
            gap: 0.75rem;
        }
        .minutes-calendar-weekday {
            text-align: center;
            font-size: 0.78rem;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--minutes-muted);
            padding: 0.35rem 0;
        }

        .minutes-calendar-day {
            min-height: 150px;
            padding: 0.85rem;
            border-radius: 18px;
            border: 1px solid #dbe4f0;
            background: #fff;
            display: flex;
            flex-direction: column;
            gap: 0.65rem;
        }
        .minutes-calendar-day.is-outside-month { background: #f8fafc; opacity: 0.65; }
        .minutes-calendar-day.is-today         { border-color: #818cf8; box-shadow: 0 0 0 2px rgba(99,102,241,.12); }
        .minutes-calendar-day.has-visible-meeting { background: linear-gradient(180deg,#ffffff 0%,#eef2ff 100%); }

        .minutes-calendar-dayhead {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.5rem;
        }
        .minutes-calendar-date  { font-weight: 800; color: #0f172a; }
        .minutes-calendar-count { font-size: 0.72rem; color: var(--minutes-muted); }

        .minutes-calendar-items { display: flex; flex-direction: column; gap: 0.5rem; }

        .minutes-calendar-entry {
            border: 1px solid #c7d2fe;
            background: rgba(238,242,255,0.9);
            border-radius: 14px;
            padding: 0.65rem;
            display: flex;
            flex-direction: column;
            gap: 0.35rem;
        }
        .minutes-calendar-entry.clickable { cursor: pointer; }

        .minutes-calendar-entry-title {
            font-size: 0.84rem;
            font-weight: 800;
            color: #312e81;
            line-height: 1.35;
        }
        .minutes-calendar-entry-meta {
            display: flex;
            justify-content: space-between;
            gap: 0.5rem;
            font-size: 0.72rem;
            color: #475569;
        }

        .minutes-calendar-restricted {
            margin-top: 0.2rem;
            border: none;
            background: #fff;
            color: #991b1b;
            border-radius: 10px;
            padding: 0.45rem 0.55rem;
            font-size: 0.72rem;
            font-weight: 700;
            cursor: pointer;
        }

        .minutes-no-results {
            margin-top: 1rem;
            padding: 1rem 1.25rem;
            border-radius: 16px;
            background: #fff7ed;
            border: 1px solid #fed7aa;
            color: #9a3412;
            font-weight: 700;
            display: none;
        }

        /* ── Detail modal (scoped to avoid overriding global .modal-overlay / .modal-content) ── */
        .minutes-overlay {
            position: fixed; inset: 0;
            background: rgba(15,23,42,0.55);
            backdrop-filter: blur(6px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 1.5rem;
        }

        .minutes-modal-content {
            background: white;
            border-radius: 24px;
            width: 100%;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 25px 50px -12px rgba(0,0,0,.25);
            overflow: hidden;
        }
        .minutes-detail-wide { max-width: 1000px; }

        .minutes-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding: 2rem 2rem 1.5rem;
            border-bottom: 1px solid var(--minutes-border);
            flex-shrink: 0;
        }
        .minutes-modal-body   { flex: 1; overflow-y: auto; padding: 2rem; }
        .minutes-modal-footer {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1.5rem 2rem;
            border-top: 1px solid var(--minutes-border);
            flex-shrink: 0;
        }

        .close-modal-btn {
            background: none; border: none; font-size: 1.75rem;
            color: var(--minutes-muted); cursor: pointer; line-height: 1;
            padding: 0.25rem; border-radius: 8px; transition: all 0.15s;
        }
        .close-modal-btn:hover { background: #f1f5f9; color: var(--minutes-text); }

        .detail-date {
            font-size: 0.8rem;
            font-weight: 700;
            color: var(--minutes-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            display: block;
            margin-bottom: 0.35rem;
        }
        .detail-meta { font-size: 0.78rem; color: #64748b; margin-top: 0.35rem; }

        .detail-grid {
            display: grid;
            grid-template-columns: 1fr 300px;
            gap: 2rem;
        }

        .main-column section, .side-column section {
            margin-bottom: 2rem;
        }
        .main-column section label, .side-column section label {
            font-size: 0.8rem;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: var(--minutes-muted);
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 0.85rem;
        }

        .content-text { font-size: 0.95rem; line-height: 1.7; color: var(--minutes-text); }

        .detail-action-item {
            display: flex;
            align-items: flex-start;
            gap: 0.85rem;
            padding: 0.85rem 1rem;
            border-radius: 12px;
            background: #f8fafc;
            border: 1px solid var(--minutes-border);
            margin-bottom: 0.6rem;
        }

        .action-status-dot {
            width: 10px; height: 10px;
            border-radius: 50%;
            margin-top: 5px;
            flex-shrink: 0;
        }
        .action-status-dot.pending   { background: var(--minutes-warning); }
        .action-status-dot.accepted  { background: var(--minutes-primary); }
        .action-status-dot.completed { background: var(--minutes-success); }

        .action-main { flex: 1; }
        .action-meta { font-size: 0.78rem; color: var(--minutes-muted); display: block; margin-top: 0.2rem; }
        .action-btns { display: flex; flex-direction: column; gap: 0.35rem; }

        .approvals-stack { display: flex; flex-direction: column; gap: 0.5rem; }
        .approval-chip {
            display: flex;
            align-items: center;
            gap: 0.6rem;
            padding: 0.55rem 0.85rem;
            border-radius: 10px;
            font-size: 0.85rem;
            font-weight: 600;
        }
        .approval-chip.approved { background: #f0fdf4; color: #166534; }
        .approval-chip.pending  { background: #fff7ed; color: #9a3412; }

        .owner-only { background: #fffbeb; border-radius: 16px; padding: 1.25rem; }

        .access-requests-list { display: flex; flex-direction: column; gap: 0.5rem; overflow-y: auto; max-height: 230px; }
        .access-request-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            background: white;
            padding: 0.65rem 0.85rem;
            border-radius: 10px;
            border: 1px solid var(--minutes-border);
            font-size: 0.85rem;
        }
        .req-btns { display: flex; gap: 0.5rem; }

        .status-locked-msg {
            font-size: 0.82rem;
            color: #166534;
            background: #dcfce7;
            padding: 0.4rem 0.9rem;
            border-radius: 999px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }

        .history-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            background: white;
            padding: 0.65rem 0.85rem;
            border-radius: 10px;
            border: 1px solid var(--minutes-border);
        }
        .history-row__user  { font-size: 0.82rem; font-weight: 700; }
        .history-row__action{ font-size: 0.75rem; color: #64748b; }
        .history-row__time  { font-size: 0.74rem; color: #64748b; white-space: nowrap; }

        .empty { color: var(--minutes-muted); font-size: 0.88rem; font-style: italic; }

        /* ── NGO plans section ──────────────────────────────────────────── */
        .ngo-plans-section { margin-bottom: 2rem; }
        .minutes-calendar-widget-wrapper { margin-top: 1rem; }

        /* ── Toast system ───────────────────────────────────────────────── */
        #minutes-toast-container {
            position: fixed;
            bottom: 1.5rem;
            right: 1.5rem;
            z-index: 9000;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            pointer-events: none;
        }

        .minutes-toast {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            background: #1e293b;
            color: white;
            padding: 0.85rem 1.1rem;
            border-radius: 14px;
            font-size: 0.9rem;
            font-weight: 600;
            box-shadow: 0 10px 25px rgba(0,0,0,.2);
            pointer-events: all;
            opacity: 0;
            transform: translateY(12px);
            transition: opacity 0.3s, transform 0.3s;
            max-width: 380px;
        }
        .minutes-toast--visible { opacity: 1; transform: translateY(0); }
        .minutes-toast--success { border-left: 4px solid var(--minutes-success); }
        .minutes-toast--error   { border-left: 4px solid var(--minutes-danger);  }
        .minutes-toast--warning { border-left: 4px solid var(--minutes-warning); }
        .minutes-toast--info    { border-left: 4px solid var(--minutes-primary); }
        .minutes-toast i        { flex-shrink: 0; font-size: 1rem; }
        .minutes-toast span     { flex: 1; }
        .minutes-toast__close {
            background: none; border: none; color: rgba(255,255,255,0.6);
            cursor: pointer; font-size: 1.1rem; line-height: 1; padding: 0;
            flex-shrink: 0;
        }
        .minutes-toast__close:hover { color: white; }

        /* ── Confirm dialog ─────────────────────────────────────────────── */
        .minutes-confirm-overlay {
            position: fixed; inset: 0;
            background: rgba(15,23,42,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9100;
            opacity: 0;
            transition: opacity 0.2s;
        }
        .minutes-confirm-overlay--visible { opacity: 1; }

        .minutes-confirm-dialog {
            background: white;
            border-radius: 20px;
            padding: 2rem;
            max-width: 420px;
            width: 100%;
            box-shadow: 0 25px 50px -12px rgba(0,0,0,.25);
        }
        .minutes-confirm-msg { font-size: 1rem; color: var(--minutes-text); margin-bottom: 1.5rem; line-height: 1.5; }
        .minutes-confirm-actions { display: flex; justify-content: flex-end; gap: 0.75rem; }

        /* ── Responsive ─────────────────────────────────────────────────── */
        @media (max-width: 768px) {
            .form-row                  { grid-template-columns: 1fr; gap: 1rem; }
            .form-glass-card           { padding: 1rem; }
            .action-item-row-card      { grid-template-columns: 1fr; padding: 1rem; }
            .minutes-header-section    { flex-direction: column; align-items: flex-start; gap: 1rem; }
            .btn-record-meeting        { width: 100%; justify-content: center; }
            .minutes-view-controls     { width: 100%; }
            .minutes-toggle-group      { width: 100%; justify-content: space-between; }
            .minutes-toggle-btn        { flex: 1; justify-content: center; }
            .rich-editor-toolbar       { gap: 0.25rem; padding: 0.45rem; }
            .rich-editor-btn           { min-width: 30px; height: 30px; font-size: 0.78rem; }
            .rich-editor-area          { font-size: 0.88rem; min-height: 140px; }
            .attendee-grid             { grid-template-columns: 1fr; max-height: 170px; }
            .minutes-list-header       { flex-direction: column; align-items: stretch; gap: 1rem; }
            .minutes-search-wrapper    { width: 100%; }
            .minutes-calendar-grid     { gap: 0.5rem; }
            .minutes-calendar-day      { min-height: 130px; padding: 0.7rem; }
            .detail-grid               { grid-template-columns: 1fr; }
            .minutes-modal-body        { padding: 1rem; }
            .minutes-modal-header      { padding: 1.25rem 1rem 1rem; }
            .minutes-modal-footer      { padding: 1rem; flex-wrap: wrap; }
        }
    `;
    document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Partial renderers
// ---------------------------------------------------------------------------

function renderRichToolbar(editorId) {
    return `
        <div class="rich-editor-toolbar">
            <button type="button" class="rich-editor-btn" onclick="window.app_minutesExec('${editorId}','bold')"><i class="fa-solid fa-bold"></i></button>
            <button type="button" class="rich-editor-btn" onclick="window.app_minutesExec('${editorId}','italic')"><i class="fa-solid fa-italic"></i></button>
            <button type="button" class="rich-editor-btn" onclick="window.app_minutesFormatBlock('${editorId}','H2')">H2</button>
            <button type="button" class="rich-editor-btn" onclick="window.app_minutesFormatBlock('${editorId}','H3')">H3</button>
            <button type="button" class="rich-editor-btn" onclick="window.app_minutesExec('${editorId}','insertUnorderedList')"><i class="fa-solid fa-list-ul"></i></button>
            <button type="button" class="rich-editor-btn" onclick="window.app_minutesExec('${editorId}','insertOrderedList')"><i class="fa-solid fa-list-ol"></i></button>
        </div>
    `;
}

function renderMinuteCard(m, currentUser) {
    const hasAccess = hasMinuteDetailAccess(m, currentUser);
    const reqStatus = getMinuteRequestStatus(m, currentUser.id);

    const statusBadge = m.locked
        ? `<span class="status-badge status-badge--locked"><i class="fa-solid fa-lock"></i>Locked</span>`
        : `<span class="status-badge status-badge--open">Open</span>`;

    let restrictedBlock = '';
    if (!hasAccess) {
        if (reqStatus === 'pending') {
            restrictedBlock = `
                <div class="restricted-tag">
                    <i class="fa-solid fa-shield-halved" style="margin-right:0.5rem;"></i>
                    Access Restricted
                    <div class="restricted-tag__pending">Request Pending Review</div>
                </div>`;
        } else if (reqStatus === 'rejected') {
            restrictedBlock = `
                <div class="restricted-tag">
                    <i class="fa-solid fa-shield-halved" style="margin-right:0.5rem;"></i>
                    Access Restricted
                    <div class="restricted-tag__rejected">Access Denied</div>
                </div>`;
        } else {
            restrictedBlock = `
                <div class="restricted-tag">
                    <i class="fa-solid fa-shield-halved" style="margin-right:0.5rem;"></i>
                    Access Restricted
                    <button class="mini-btn" style="margin-top:0.75rem; width:100%; border-color:#991b1b; color:#991b1b;"
                        onclick="event.stopPropagation(); window.app_requestMinuteAccess('${m.id}')">
                        Request View Access
                    </button>
                </div>`;
        }
    }

    return `
        <div class="minute-card-modern ${hasAccess ? 'clickable' : ''}"
             data-search-text="${safeAttr(getMinuteSearchText(m))}"
             ${hasAccess ? `onclick="window.app_openMinuteDetails('${m.id}')"` : ''}>
            <div class="card-date-badge">${formatMinuteDate(m.date)}</div>
            <div class="minute-card-status">${statusBadge}</div>
            <h4 class="card-title-modern">${safeHtml(m.title)}</h4>
            <div class="card-metrics">
                <div class="metric-item">
                    <i class="fa-solid fa-users"></i>
                    ${m.attendeeIds?.length || 0} Attendees
                </div>
                <div class="metric-item">
                    <i class="fa-solid fa-check-circle"></i>
                    ${m.actionItems?.length || 0} Tasks
                </div>
            </div>
            ${restrictedBlock}
        </div>
    `;
}

function renderListView(sortedMinutes, currentUser) {
    return `
        <div class="minutes-list-container">
            ${sortedMinutes.length
                ? sortedMinutes.map((m) => renderMinuteCard(m, currentUser)).join('')
                : `<div class="empty-state-modern">
                        <i class="fa-solid fa-file-invoice"></i>
                        <h4>No Meeting Minutes Recorded Yet</h4>
                        <p style="color:var(--minutes-muted); margin-top:0.5rem;">Click "Record Meeting" to document your first session.</p>
                   </div>`
            }
        </div>
        <div id="minutes-list-empty-state" class="minutes-no-results">No meetings match this search.</div>
    `;
}

function renderCalendarView(sortedMinutes, currentUser, monthKey) {
    const now = new Date();
    const currentMonthDate = monthKeyToDate(monthKey);
    const currentMonthLabel = currentMonthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const monthStart = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth(), 1);
    const calendarStart = new Date(monthStart);
    calendarStart.setDate(monthStart.getDate() - monthStart.getDay());

    const calendarDays = Array.from({ length: 42 }, (_, i) => {
        const d = new Date(calendarStart);
        d.setDate(calendarStart.getDate() + i);
        return d;
    });

    const minutesByDate = sortedMinutes.reduce((acc, minute) => {
        const parsed = parseMinuteDate(minute.date);
        if (!parsed) return acc;
        const key = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(minute);
        return acc;
    }, {});

    const dayCells = calendarDays.map((day) => {
        const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        const dayMinutes = minutesByDate[dayKey] || [];
        const isCurrentMonth = day.getMonth() === currentMonthDate.getMonth();
        const isToday = day.toDateString() === now.toDateString();

        const entries = dayMinutes.map((m) => {
            const hasAccess = hasMinuteDetailAccess(m, currentUser);
            const reqStatus = getMinuteRequestStatus(m, currentUser.id);
            const restrictedBtn = !hasAccess
                ? `<button class="minutes-calendar-restricted"
                       onclick="event.stopPropagation(); window.app_requestMinuteAccess('${m.id}')">
                       ${reqStatus === 'pending' ? 'Access Pending' : reqStatus === 'rejected' ? 'Access Denied' : 'Request Access'}
                   </button>`
                : '';
            return `
                <div class="minutes-calendar-entry ${hasAccess ? 'clickable' : ''}"
                     data-search-text="${safeAttr(getMinuteSearchText(m))}"
                     ${hasAccess ? `onclick="window.app_openMinuteDetails('${m.id}')"` : ''}>
                    <div class="minutes-calendar-entry-title">${safeHtml(m.title)}</div>
                    <div class="minutes-calendar-entry-meta">
                        <span>${m.attendeeIds?.length || 0} attendees</span>
                        <span>${m.locked ? 'Locked' : 'Open'}</span>
                    </div>
                    ${restrictedBtn}
                </div>
            `;
        }).join('');

        const countText = dayMinutes.length
            ? `${dayMinutes.length} meeting${dayMinutes.length === 1 ? '' : 's'}`
            : '';

        return `
            <div class="minutes-calendar-day
                        ${isCurrentMonth ? '' : 'is-outside-month'}
                        ${isToday ? 'is-today' : ''}
                        ${dayMinutes.length ? 'has-visible-meeting' : ''}">
                <div class="minutes-calendar-dayhead">
                    <span class="minutes-calendar-date">${day.getDate()}</span>
                    <span class="minutes-calendar-count">${countText}</span>
                </div>
                <div class="minutes-calendar-items">${entries}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="minutes-calendar-shell">
            <div class="minutes-calendar-toolbar">
                <div>
                    <div class="minutes-calendar-month">${currentMonthLabel}</div>
                    <div class="minutes-calendar-toolbar-sub">Browse every meeting record in a monthly calendar format.</div>
                </div>
                <div class="minutes-month-actions">
                    <button class="minutes-month-btn" onclick="window.app_shiftMinutesMonth(-1)" aria-label="Previous month">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <button class="minutes-month-btn" onclick="window.app_shiftMinutesMonth(1)" aria-label="Next month">
                        <i class="fa-solid fa-chevron-right"></i>
                    </button>
                </div>
            </div>
            <div class="minutes-calendar-grid">
                ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                    .map((d) => `<div class="minutes-calendar-weekday">${d}</div>`).join('')}
                ${dayCells}
            </div>
            <div id="minutes-calendar-empty-state" class="minutes-no-results">
                No meetings match this search in ${currentMonthLabel}.
            </div>
        </div>
    `;
}

function renderNewMinuteForm(allUsers, calendarPlans) {
    return `
        <div id="new-minute-form" class="form-glass-card" style="display:none;">
            <div class="form-section-header">
                <div style="background:var(--minutes-primary); color:white; width:40px; height:40px; border-radius:12px; display:flex; align-items:center; justify-content:center;">
                    <i class="fa-solid fa-microphone-lines"></i>
                </div>
                <h3>Record New Meeting Details</h3>
            </div>

            <div class="form-row">
                <div class="field-group">
                    <label class="field-label">Meeting Title</label>
                    <input type="text" id="new-minute-title" class="input-premium" placeholder="e.g. Monthly Strategy Review">
                </div>
                <div class="field-group">
                    <label class="field-label">Date</label>
                    <input type="date" id="new-minute-date" class="input-premium" value="${todayIsoDate()}">
                </div>
            </div>

            <div class="field-group" style="margin-bottom:2rem;">
                <label class="field-label">Required Approvers & Attendees</label>
                <div class="attendee-picker-container">
                    <div id="minutes-attendee-chips" class="attendee-chips-wrapper"></div>
                    <div class="attendee-search-wrapper">
                        <i class="fa-solid fa-search"></i>
                        <input type="text" placeholder="Search staff members..."
                               oninput="window.app_filterAttendees(this.value)"
                               class="search-staff-input">
                    </div>
                    <div class="attendee-grid">
                        ${allUsers.map((u) => `
                            <label class="attendee-item-modern" data-name="${safeAttr(u.name || u.username)}">
                                <input type="checkbox" value="${u.id}" onchange="window.app_toggleAttendeePick(this)">
                                <span>${safeHtml(u.name || u.username)}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            </div>

            <div class="discussion-area">
                <label class="field-label" style="margin-bottom:0.75rem; display:block;">Discussion & Key Decisions</label>
                <textarea id="new-minute-content" class="textarea-premium"
                          placeholder="Summarize what was discussed…" style="display:none;"></textarea>
                <div class="rich-editor-shell">
                    ${renderRichToolbar('new-minute-content-editor')}
                    <div id="new-minute-content-editor" class="rich-editor-area" contenteditable="true"
                         data-placeholder="Summarize what was discussed and the final decisions made…"></div>
                </div>
            </div>

            <div class="action-items-section">
                <label class="field-label" style="margin-bottom:1rem; display:block;">Action Items & Accountability</label>
                <div id="action-items-container"></div>
                <button type="button" onclick="window.app_addActionItemRow()" class="btn-add-task">
                    <i class="fa-solid fa-plus-circle"></i>
                    Add New Action Item
                </button>
            </div>

            <div class="ngo-plans-section">
                <div class="form-section-header">
                    <i class="fa-solid fa-calendar-star" style="color:#db2777; font-size:1.5rem;"></i>
                    <h3>Schedule NGO Activities</h3>
                </div>
                <div class="minutes-calendar-widget-wrapper">
                    ${renderYearlyPlan(calendarPlans)}
                </div>
            </div>

            <div class="form-footer-modern">
                <button class="btn-secondary-modern" onclick="window.app_toggleNewMinuteForm()">Dismiss</button>
                <button id="btn-submit-minutes" class="btn-record-meeting" onclick="window.app_submitNewMinutes()">
                    Create Meeting Record
                </button>
            </div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Detail modal renderer  (called imperatively, not from main HTML return)
// ---------------------------------------------------------------------------

function buildDetailModalHtml(m, allUsers, currentUser) {
    const isAttendee = (m.attendeeIds || []).includes(currentUser.id);
    const hasApproved = m.approvals && m.approvals[currentUser.id];
    const isOwner = m.createdBy === currentUser.id;
    const isAdmin = window.app_hasPerm('minutes', 'admin', currentUser);
    const canEdit = (isOwner || isAdmin) && !m.locked;

    const createdByName = m.createdByName || allUsers.find((u) => u.id === m.createdBy)?.name || 'Unknown';
    const lastEditedByName = m.lastEditedByName || createdByName;
    const lastEditedAt = m.lastEditedAt || m.createdAt;
    const initialContentHtml = sanitizeMinutesHtml(m.contentHtml || plainTextToRichHtml(m.content || ''));

    const attendeeApprovals = (m.attendeeIds || []).map((uid) => {
        const user = allUsers.find((u) => u.id === uid);
        const approved = m.approvals && m.approvals[uid];
        return `
            <div class="approval-chip ${approved ? 'approved' : 'pending'}">
                <i class="fa-solid fa-${approved ? 'check-circle' : 'clock'}"></i>
                ${safeHtml(user?.name || 'Unknown')}
            </div>
        `;
    }).join('');

    const actions = (m.actionItems || []).map((a, idx) => {
        const assignee = allUsers.find((u) => u.id === a.assignedTo);
        const isAssignedToMe = a.assignedTo === currentUser.id;
        return `
            <div class="detail-action-item">
                <div class="action-status-dot ${a.status || 'pending'}"></div>
                <div class="action-main">
                    <strong>${safeHtml(a.task)}</strong>
                    <span class="action-meta">
                        Assigned: ${safeHtml(assignee?.name || 'Unassigned')} | Due: ${a.dueDate || 'N/A'}
                    </span>
                </div>
                ${isAssignedToMe && a.status !== 'completed' ? `
                    <div class="action-btns">
                        ${a.status === 'pending'
                            ? `<button class="mini-btn" onclick="window.app_handleActionItemStatus('${m.id}',${idx},'accepted')">Accept</button>`
                            : ''}
                        <button class="mini-btn success"
                                onclick="window.app_handleActionItemStatus('${m.id}',${idx},'completed')">Complete</button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    const accessRequests = (m.accessRequests || [])
        .filter((r) => r.status === 'pending')
        .map((r) => `
            <div class="access-request-row">
                <span>${safeHtml(r.userName)}</span>
                <div class="req-btns">
                    <button class="mini-btn success"
                            onclick="window.app_handleAccessDecision('${m.id}','${r.userId}','approved')">Approve</button>
                    <button class="mini-btn danger"
                            onclick="window.app_handleAccessDecision('${m.id}','${r.userId}','rejected')">Deny</button>
                </div>
            </div>
        `).join('');

    const historyRows = (m.auditLog || []).slice().reverse().map((entry) => `
        <div class="history-row">
            <div>
                <div class="history-row__user">${safeHtml(entry.userName || 'Unknown')}</div>
                <div class="history-row__action">${safeHtml(entry.action || 'Updated')}</div>
            </div>
            <span class="history-row__time">
                ${entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '-'}
            </span>
        </div>
    `).join('');

    const editableContentSection = canEdit ? `
        <div style="display:grid; gap:0.6rem; margin-top:0.55rem;">
            <input id="minute-edit-title" class="input-premium" value="${safeAttr(m.title || '')}" />
            <input id="minute-edit-date" class="input-premium" type="date" value="${safeAttr(m.date || '')}" />
            <textarea id="minute-edit-content" class="textarea-premium" style="display:none;">${safeHtml(m.content || '')}</textarea>
            <div class="rich-editor-shell">
                ${renderRichToolbar('minute-edit-content-editor')}
                <div id="minute-edit-content-editor" class="rich-editor-area"
                     contenteditable="true">${initialContentHtml}</div>
            </div>
        </div>
    ` : `<div class="content-text rich-minutes-content">${renderSafeRichContent(m.contentHtml, m.content)}</div>`;

    // Use parseMinuteDate consistently (no raw `new Date(m.date)`)
    const displayDate = formatMinuteDate(m.date);

    return `
        <div class="minutes-overlay" id="minute-detail-modal" style="display:flex;">
            <div class="minutes-modal-content minutes-detail-wide">
                <div class="minutes-modal-header">
                    <div>
                        <span class="detail-date">${displayDate}</span>
                        <h2 style="margin:0; color:#1e1b4b;">${safeHtml(m.title)}</h2>
                        <div class="detail-meta">
                            Created by ${safeHtml(createdByName)}
                            on ${m.createdAt ? new Date(m.createdAt).toLocaleString() : '-'}
                        </div>
                        <div class="detail-meta">
                            Last edited by ${safeHtml(lastEditedByName)}
                            on ${lastEditedAt ? new Date(lastEditedAt).toLocaleString() : '-'}
                        </div>
                    </div>
                    <button onclick="document.getElementById('minute-detail-modal').remove()"
                            class="close-modal-btn" aria-label="Close">&times;</button>
                </div>

                <div class="minutes-modal-body">
                    <div class="detail-grid">
                        <div class="main-column">
                            <section>
                                <label><i class="fa-solid fa-file-lines"></i> Discussion & Decisions</label>
                                ${editableContentSection}
                            </section>
                            ${actions ? `
                                <section>
                                    <label><i class="fa-solid fa-list-check"></i> Action Items</label>
                                    <div class="action-items-list">${actions}</div>
                                </section>
                            ` : ''}
                            <section>
                                <label><i class="fa-solid fa-clock-rotate-left"></i> Edit History</label>
                                <div class="access-requests-list">
                                    ${historyRows || '<p class="empty">No edit history yet.</p>'}
                                </div>
                            </section>
                        </div>

                        <div class="side-column">
                            <section>
                                <label><i class="fa-solid fa-users-check"></i> Approvals</label>
                                <div class="approvals-stack">
                                    ${attendeeApprovals || '<p class="empty">No attendees defined</p>'}
                                </div>
                                ${isAttendee && !hasApproved && !m.locked ? `
                                    <button class="action-btn wide"
                                            id="btn-approve-minute"
                                            onclick="window.app_handleMinuteApproval('${m.id}')"
                                            style="margin-top:1rem;">
                                        Approve Minutes
                                    </button>
                                ` : ''}
                            </section>
                            ${(isOwner || isAdmin) && accessRequests ? `
                                <section class="owner-only">
                                    <label><i class="fa-solid fa-key"></i> Access Requests</label>
                                    <div class="access-requests-list">${accessRequests}</div>
                                </section>
                            ` : ''}
                        </div>
                    </div>
                </div>

                <div class="minutes-modal-footer">
                    ${m.locked ? '<span class="status-locked-msg"><i class="fa-solid fa-lock"></i> Record Locked (All approved)</span>' : ''}
                    <div style="flex:1"></div>
                    <button class="action-btn secondary"
                            onclick="document.getElementById('minute-detail-modal').remove()">Close</button>
                    ${canEdit ? `<button class="action-btn" id="btn-save-minute-edits"
                                         onclick="window.app_saveMinuteEdits('${m.id}')">Save Changes</button>` : ''}
                    ${(isOwner || isAdmin) ? `<button class="action-btn danger" id="btn-delete-minute"
                                                      onclick="window.app_deleteMinute('${m.id}')">Delete</button>` : ''}
                </div>
            </div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Handler registration  (called ONCE from renderMinutes)
// ---------------------------------------------------------------------------

function initMinutesHandlers() {
    if (_state.handlersRegistered) return;
    _state.handlersRegistered = true;

    // ── Form toggle ──────────────────────────────────────────────────────────
    window.app_toggleNewMinuteForm = () => {
        const form = document.getElementById('new-minute-form');
        if (!form) return;
        const isHidden = form.style.display === 'none';
        form.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
            _state.selectedAttendeeIds = new Set();
            window.app_refreshAttendeeChips();
            document.querySelectorAll('.attendee-grid input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
            const container = document.getElementById('action-items-container');
            if (container) { container.innerHTML = ''; window.app_addActionItemRow(); }
            const editor = document.getElementById('new-minute-content-editor');
            if (editor) editor.innerHTML = '';
            if (window.AppMinutes?.setMinutesDirtyState) window.AppMinutes.setMinutesDirtyState(true);
        } else {
            if (window.AppMinutes?.setMinutesDirtyState) window.AppMinutes.setMinutesDirtyState(false);
        }
    };

    // ── View refresh ─────────────────────────────────────────────────────────
    window.app_refreshMinutesView = async () => {
        const page = document.getElementById('page-content');
        if (page) {
            page.innerHTML = await renderMinutes();
            // filter is applied inside renderMinutes via setTimeout; nothing more needed
        }
    };

    // ── Rich editor commands ─────────────────────────────────────────────────
    window.app_minutesExec = (editorId, command, value = null) => {
        const editor = document.getElementById(editorId);
        if (!editor) return;
        editor.focus();
        document.execCommand(command, false, value);
    };

    window.app_minutesFormatBlock = (editorId, tagName) => {
        window.app_minutesExec(editorId, 'formatBlock', tagName);
    };

    // ── Attendee picker ──────────────────────────────────────────────────────
    window.app_filterAttendees = (query) => {
        const q = (query || '').toLowerCase();
        document.querySelectorAll('.attendee-item-modern').forEach((item) => {
            item.style.display = (item.dataset.name || '').toLowerCase().includes(q) ? 'flex' : 'none';
        });
    };

    window.app_toggleAttendeePick = (checkbox) => {
        if (checkbox.checked) _state.selectedAttendeeIds.add(checkbox.value);
        else _state.selectedAttendeeIds.delete(checkbox.value);
        window.app_refreshAttendeeChips();
    };

    window.app_refreshAttendeeChips = () => {
        const container = document.getElementById('minutes-attendee-chips');
        if (!container) return;
        container.innerHTML = Array.from(_state.selectedAttendeeIds).map((id) => {
            const user = _state.allUsers.find((u) => u.id === id);
            return `
                <div class="chip-modern">
                    <span>${safeHtml(user?.name || user?.username || 'Unknown')}</span>
                    <i class="fa-solid fa-circle-xmark" onclick="window.app_removeAttendee('${id}')"></i>
                </div>
            `;
        }).join('');
    };

    window.app_removeAttendee = (id) => {
        _state.selectedAttendeeIds.delete(id);
        const checkbox = document.querySelector(`.attendee-item-modern input[value="${id}"]`);
        if (checkbox) checkbox.checked = false;
        window.app_refreshAttendeeChips();
    };

    // ── Action item rows ─────────────────────────────────────────────────────
    window.app_addActionItemRow = () => {
        const container = document.getElementById('action-items-container');
        if (!container) return;
        const row = document.createElement('div');
        row.className = 'action-item-row-card';
        row.innerHTML = `
            <div class="field-group">
                <input type="text" placeholder="What needs to be done?" class="input-premium action-task">
            </div>
            <div class="field-group">
                <select class="input-premium action-assignee">
                    <option value="">Assignee…</option>
                    ${_state.allUsers.map((u) => `<option value="${u.id}">${safeHtml(u.name || u.username)}</option>`).join('')}
                </select>
            </div>
            <div class="field-group">
                <input type="date" class="input-premium action-due" value="${todayIsoDate()}">
            </div>
            <button type="button" onclick="this.parentElement.remove()" class="icon-btn-danger" aria-label="Remove action item">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `;
        container.appendChild(row);
    };

    // ── Search / filter ──────────────────────────────────────────────────────
    window.app_filterMinutes = (query) => {
        _state.searchQuery = query || '';
        const q = _state.searchQuery.toLowerCase().trim();
        let listVisible = 0;
        let calendarVisible = 0;

        document.querySelectorAll('.minute-card-modern').forEach((card) => {
            const match = !q || (card.dataset.searchText || '').toLowerCase().includes(q);
            card.style.display = match ? 'flex' : 'none';
            if (match) listVisible++;
        });

        document.querySelectorAll('.minutes-calendar-entry').forEach((entry) => {
            const match = !q || (entry.dataset.searchText || '').toLowerCase().includes(q);
            entry.style.display = match ? 'flex' : 'none';
        });

        document.querySelectorAll('.minutes-calendar-day').forEach((day) => {
            const entries = Array.from(day.querySelectorAll('.minutes-calendar-entry'));
            const visibleEntries = entries.filter((e) => e.style.display !== 'none');
            day.classList.toggle('has-visible-meeting', visibleEntries.length > 0);
            const countEl = day.querySelector('.minutes-calendar-count');
            if (countEl) {
                const n = visibleEntries.length;
                countEl.textContent = n ? `${n} meeting${n === 1 ? '' : 's'}` : '';
            }
            if (visibleEntries.length) calendarVisible++;
        });

        const listEmpty = document.getElementById('minutes-list-empty-state');
        if (listEmpty) listEmpty.style.display = listVisible === 0 ? 'block' : 'none';
        const calendarEmpty = document.getElementById('minutes-calendar-empty-state');
        if (calendarEmpty) calendarEmpty.style.display = calendarVisible === 0 ? 'block' : 'none';
    };

    // ── View mode ────────────────────────────────────────────────────────────
    window.app_setMinutesView = (viewMode) => {
        _state.viewMode = viewMode === 'calendar' ? 'calendar' : 'list';
        window.app_refreshMinutesView();
    };

    window.app_shiftMinutesMonth = (offset) => {
        const cursor = monthKeyToDate(_state.monthKey);
        cursor.setMonth(cursor.getMonth() + Number(offset || 0));
        _state.monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
        window.app_refreshMinutesView();
    };

    // ── Submit new minutes ───────────────────────────────────────────────────
    window.app_submitNewMinutes = async () => {
        const btn = document.getElementById('btn-submit-minutes');
        const title = document.getElementById('new-minute-title')?.value.trim();
        const date  = document.getElementById('new-minute-date')?.value;
        const richContent = getRichContentPayload('new-minute-content-editor', 'new-minute-content');

        if (!title || !richContent.text) {
            showToast('Title and content are required.', 'warning');
            return;
        }

        const attendeeIds = Array.from(_state.selectedAttendeeIds);
        const actionItems = Array.from(document.querySelectorAll('.action-item-row-card'))
            .map((row) => ({
                task: row.querySelector('.action-task').value.trim(),
                assignedTo: row.querySelector('.action-assignee').value,
                dueDate: row.querySelector('.action-due').value,
                status: 'pending',
            }))
            .filter((a) => a.task);

        const restore = btn ? withButtonLoading(btn, 'Saving…') : () => {};
        try {
            await window.AppMinutes.addMinute({
                title,
                date,
                content: richContent.text,
                contentHtml: richContent.html,
                attendeeIds,
                actionItems,
            });
            showToast('Meeting minutes recorded!', 'success');
            window.app_refreshMinutesView();
        } catch (err) {
            showToast('Error saving: ' + err.message, 'error');
        } finally {
            restore();
        }
    };

    // ── Request access ───────────────────────────────────────────────────────
    window.app_requestMinuteAccess = async (id) => {
        try {
            await window.AppMinutes.requestAccess(id);
            showToast('Access request sent!', 'info');
            window.app_refreshMinutesView();
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    };

    // ── Approve minutes ──────────────────────────────────────────────────────
    window.app_handleMinuteApproval = async (id) => {
        const confirmed = await showConfirm(
            'Are you sure you want to approve these minutes? This will lock the record if you are the last attendee to sign.'
        );
        if (!confirmed) return;

        const btn = document.getElementById('btn-approve-minute');
        const restore = btn ? withButtonLoading(btn, 'Approving…') : () => {};
        try {
            await window.AppMinutes.approveMinute(id);
            showToast('Minutes approved!', 'success');
            window.app_openMinuteDetails(id);
            window.app_refreshMinutesView();
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        } finally {
            restore();
        }
    };

    // ── Action item status ───────────────────────────────────────────────────
    window.app_handleActionItemStatus = async (id, index, status) => {
        try {
            await window.AppMinutes.updateActionItemStatus(id, index, status);
            showToast(`Task marked as ${status}.`, 'success');
            window.app_openMinuteDetails(id);
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    };

    // ── Access decision (owner/admin) ────────────────────────────────────────
    window.app_handleAccessDecision = async (id, userId, status) => {
        try {
            await window.AppMinutes.handleAccessRequest(id, userId, status);
            showToast(`Request ${status}.`, status === 'approved' ? 'success' : 'info');
            window.app_openMinuteDetails(id);
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    };

    // ── Save edits ───────────────────────────────────────────────────────────
    window.app_saveMinuteEdits = async (id) => {
        const btn = document.getElementById('btn-save-minute-edits');
        const restore = btn ? withButtonLoading(btn, 'Saving…') : () => {};
        try {
            const minutesList = await window.AppMinutes.getMinutes();
            const m = minutesList.find((item) => item.id === id);
            if (!m) { showToast('Minute not found.', 'error'); return; }

            const currentUser = window.AppAuth.getUser();
            const isOwner = m.createdBy === currentUser.id;
            const isAdmin = window.app_hasPerm('minutes', 'admin', currentUser);
            if (!isOwner && !isAdmin) {
                showToast('Only the owner or an admin can edit these minutes.', 'warning');
                return;
            }
            if (m.locked) {
                showToast('This record is locked after final approvals.', 'warning');
                return;
            }

            const titleEl = document.getElementById('minute-edit-title');
            const dateEl  = document.getElementById('minute-edit-date');
            const richContent = getRichContentPayload('minute-edit-content-editor', 'minute-edit-content');

            const nextTitle   = (titleEl?.value || '').trim();
            const nextDate    = (dateEl?.value  || '').trim();
            const nextContent = richContent.text;

            if (!nextTitle || !nextContent) {
                showToast('Title and content are required.', 'warning');
                return;
            }

            await window.AppMinutes.updateMinute(
                id,
                { title: nextTitle, date: nextDate || m.date, content: nextContent, contentHtml: richContent.html },
                'Edited meeting details'
            );

            showToast('Minutes updated successfully.', 'success');
            window.app_openMinuteDetails(id);
            window.app_refreshMinutesView();
        } catch (err) {
            showToast('Error updating minutes: ' + err.message, 'error');
        } finally {
            restore();
        }
    };

    // ── Open detail modal ────────────────────────────────────────────────────
    window.app_openMinuteDetails = async (id) => {
        const minutesList = await window.AppMinutes.getMinutes();
        const m = minutesList.find((item) => item.id === id);
        if (!m) return;

        const currentUser = window.AppAuth.getUser();
        if (!hasMinuteDetailAccess(m, currentUser)) {
            showToast('Access restricted. Please request access from the list view.', 'warning');
            return;
        }

        const freshUsers = window.AppDB?.getAll ? await window.AppDB.getAll('users') : _state.allUsers;
        _state.allUsers = freshUsers;

        let container = document.getElementById('modal-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'modal-container';
            document.body.appendChild(container);
        }
        container.innerHTML = buildDetailModalHtml(m, freshUsers, currentUser);

        const isOwner = m.createdBy === currentUser.id;
        const isAdmin = window.app_hasPerm('minutes', 'admin', currentUser);
        const canEdit = (isOwner || isAdmin) && !m.locked;
        if (canEdit && window.AppMinutes?.setMinutesDirtyState) {
            window.AppMinutes.setMinutesDirtyState(true);
        }

        const modal = document.getElementById('minute-detail-modal');
        if (modal) {
            const originalRemove = modal.remove.bind(modal);
            modal.remove = () => {
                if (window.AppMinutes?.setMinutesDirtyState) window.AppMinutes.setMinutesDirtyState(false);
                originalRemove();
            };
        }
    };

    // ── Delete minute ────────────────────────────────────────────────────────
    window.app_deleteMinute = async (id) => {
        const btn = document.getElementById('btn-delete-minute');
        const confirmed = await showConfirm('Are you sure you want to permanently delete these minutes? This cannot be undone.');
        if (!confirmed) return;

        const restore = btn ? withButtonLoading(btn, 'Deleting…') : () => {};
        try {
            await window.AppMinutes.deleteMinute(id);
            document.getElementById('minute-detail-modal')?.remove();
            showToast('Meeting minutes deleted.', 'info');
            window.app_refreshMinutesView();
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        } finally {
            restore();
        }
    };
}

// ---------------------------------------------------------------------------
// Main render function  (entry point)
// ---------------------------------------------------------------------------

export async function renderMinutes() {
    const formSnapshot = captureNewMinuteFormState();

    injectMinutesStyles();

    const minutes    = await window.AppMinutes.getMinutes();
    const allUsers   = window.AppDB?.getAll ? await window.AppDB.getAll('users') : [];
    const currentUser = window.AppAuth.getUser();
    const calendarPlans = window.AppCalendar
        ? await window.AppCalendar.getPlans()
        : { leaves: [], events: [], work: [] };

    _state.allUsers = allUsers;

    if (!_state.monthKey) _state.monthKey = currentMonthKey();

    initMinutesHandlers();

    const sortedMinutes = [...minutes].sort((a, b) => {
        const aTime = parseMinuteDate(a.date)?.getTime() || 0;
        const bTime = parseMinuteDate(b.date)?.getTime() || 0;
        return bTime - aTime;
    });

    window.setTimeout(() => {
        window.app_filterMinutes(_state.searchQuery || '');
        if (formSnapshot) restoreNewMinuteFormState(formSnapshot);
    }, 0);

    const isCalendar = _state.viewMode === 'calendar';

    return `
        <div class="minutes-container">
            <div class="minutes-header-section">
                <div class="minutes-header-info">
                    <h2>Meeting Minutes</h2>
                    <p>Document decisions and track team accountability.</p>
                </div>
                <div class="minutes-view-controls">
                    <div class="minutes-toggle-group">
                        <button class="minutes-toggle-btn ${!isCalendar ? 'active' : ''}"
                                onclick="window.app_setMinutesView('list')">
                            <i class="fa-solid fa-table-list"></i>
                            List View
                        </button>
                        <button class="minutes-toggle-btn ${isCalendar ? 'active' : ''}"
                                onclick="window.app_setMinutesView('calendar')">
                            <i class="fa-solid fa-calendar-days"></i>
                            Month View
                        </button>
                    </div>
                    <button class="btn-record-meeting" onclick="window.app_toggleNewMinuteForm()">
                        <i class="fa-solid fa-plus-circle"></i>
                        Record Meeting
                    </button>
                </div>
            </div>

            ${renderNewMinuteForm(allUsers, calendarPlans)}

            <div class="minutes-list-header">
                <h3>${isCalendar ? 'Monthly Meeting Calendar' : 'Recent Meetings'}</h3>
                <div class="minutes-search-wrapper">
                    <i class="fa-solid fa-search"></i>
                    <input type="text"
                           placeholder="Search meetings…"
                           value="${safeAttr(_state.searchQuery || '')}"
                           oninput="window.app_filterMinutes(this.value)"
                           class="input-premium">
                </div>
            </div>

            ${isCalendar
                ? renderCalendarView(sortedMinutes, currentUser, _state.monthKey)
                : renderListView(sortedMinutes, currentUser)
            }
        </div>
    `;
}

export default renderMinutes;
