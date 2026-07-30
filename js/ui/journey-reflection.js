import { safeHtml } from './helpers.js';
import { AppJourneyReflection } from '../modules/journey-reflection.js';

const JOURNEY_CARD_CLASS = 'dashboard-journey-card';
const JOURNEY_ENERGY_CLASSES = [
    'journey-energy-energized',
    'journey-energy-steady',
    'journey-energy-mixed',
    'journey-energy-drained'
];

const normalizeEnergyTheme = (value) => {
    const safe = String(value ?? '').trim();
    return ['energized', 'steady', 'mixed', 'drained'].includes(safe) ? safe : 'steady';
};

const escapeSelectorValue = (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const renderProgressDots = (state) => {
    const dates = [];
    const start = new Date(`${state.weekStartKey}T00:00:00`);
    const map = new Map((state.records || []).map((row) => [row.date, row]));
    for (let i = 0; i < 7; i += 1) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        const dateKey = date.toISOString().split('T')[0];
        dates.push({
            key: dateKey,
            active: !!map.get(dateKey)?.note
        });
    }
    return dates.map((item) => `
        <span class="journey-progress-dot ${item.active ? 'is-active' : ''}" title="${safeHtml(item.key)}"></span>
    `).join('');
};

const renderEnergyOptions = (selected = 'steady') => {
    return AppJourneyReflection.JOURNEY_REFLECTION_ENERGY_OPTIONS.map((option) => `
        <option value="${safeHtml(option.value)}" ${option.value === selected ? 'selected' : ''}>${safeHtml(option.label)}</option>
    `).join('');
};

const renderComposer = (state) => {
    if (!state.canEdit) {
        return `
            <div class="journey-readonly-note">Reflection is private to the staff member.</div>
        `;
    }

    const noteValue = safeHtml(state.noteDraft || '');
    return `
        <div class="journey-composer">
            <label class="journey-field">
                <span>Reflection note</span>
                <textarea class="journey-textarea" data-journey-field="note" placeholder="${safeHtml(state.prompt)}">${noteValue}</textarea>
            </label>
            <div class="journey-composer-row">
                <label class="journey-field journey-field-inline">
                    <span>Energy</span>
                    <select class="journey-select" data-journey-field="energy">
                        ${renderEnergyOptions(state.energyDraft || 'steady')}
                    </select>
                </label>
                <label class="journey-field journey-field-inline">
                    <span>Prompt</span>
                    <div class="journey-prompt-chip">${safeHtml(state.prompt)}</div>
                </label>
            </div>
            <div class="journey-composer-actions">
                <button type="button" class="journey-btn journey-btn-ghost" data-journey-action="close-popout">Close</button>
                <button type="button" class="journey-btn journey-btn-primary" data-journey-action="save">Save reflection</button>
            </div>
        </div>
    `;
};

const renderPopoutBody = (state) => {
    if (state.hasTodayReflection) {
        return `
            <div class="journey-state journey-state-success">
                <div class="journey-state-copy">
                    <div class="journey-state-title">Reflection saved</div>
                    <div class="journey-state-text">${safeHtml(state.weeklySummary.latestPreview || state.summaryLine)}</div>
                </div>
            </div>
            ${renderComposer(state)}
        `;
    }

    if (!state.canEdit) {
        return `
            <div class="journey-state journey-state-muted">
                <div class="journey-state-copy">
                    <div class="journey-state-title">View only</div>
                    <div class="journey-state-text">Reflection remains private for this staff member.</div>
                </div>
            </div>
        `;
    }

    if (state.dismissedToday) {
        return `
            <div class="journey-state journey-state-muted">
                <div class="journey-state-copy">
                    <div class="journey-state-title">Snoozed for today</div>
                    <div class="journey-state-text">${safeHtml(state.encouragement)}</div>
                </div>
            </div>
            ${renderComposer(state)}
        `;
    }

    return `
        <div class="journey-state journey-state-reminder">
            <div class="journey-state-copy">
                <div class="journey-state-title">No reflection yet today</div>
                <div class="journey-state-text">${safeHtml(state.encouragement)}</div>
            </div>
            <div class="journey-state-actions">
                <button type="button" class="journey-btn journey-btn-ghost" data-journey-action="dismiss-reminder">Not now</button>
            </div>
        </div>
        <div class="journey-reminder-note">Prompt: ${safeHtml(state.prompt)}</div>
        ${renderComposer(state)}
    `;
};

const renderBanner = (state) => {
    const bannerToneClass = state.hasTodayReflection
        ? 'journey-banner-saved'
        : state.dismissedToday
            ? 'journey-banner-snoozed'
            : 'journey-banner-reminder';
    const bannerLabel = state.hasTodayReflection
        ? 'Saved'
        : state.dismissedToday
            ? 'Snoozed'
            : 'Reminder';
    const bannerAction = state.hasTodayReflection
        ? (state.canEdit ? 'Review' : 'Open')
        : state.canEdit ? 'Write' : 'Open';
    const bannerCount = state.hasTodayReflection ? 'S' : state.reminderVisible ? 'R' : 'Z';

    return `
        <button type="button" class="journey-banner ${bannerToneClass}" data-journey-action="toggle-popout" aria-expanded="false">
            <div class="journey-banner-badge" aria-hidden="true">${safeHtml(bannerCount)}</div>
            <div class="journey-banner-copy">
                <div class="journey-banner-heading">Journey Reflection</div>
                <div class="journey-banner-title-row">
                    <h4 class="journey-title">${safeHtml(state.ownerLabel || 'Quick note')}</h4>
                    <span class="journey-banner-status">${safeHtml(bannerLabel)}</span>
                </div>
                <div class="journey-subtitle">${safeHtml(state.summaryLine || 'Tap to open a quick note. The color follows your energy level.')}</div>
            </div>
            <div class="journey-banner-meta">
                <span class="journey-banner-cta">${safeHtml(bannerAction)}</span>
            </div>
        </button>
    `;
};

export function renderJourneyReflectionCard(state = {}) {
    if (!state || !state.ownerId) return '';

    syncJourneyReflectionFeed(state);

    const cardClass = [
        'card',
        'full-width',
        JOURNEY_CARD_CLASS,
        state.hasTodayReflection ? 'has-reflection' : 'needs-reflection',
        state.dismissedToday ? 'is-snoozed' : '',
        state.canEdit ? 'can-edit' : 'read-only',
        state.reminderVisible ? 'needs-attention' : '',
        `journey-energy-${normalizeEnergyTheme(state.energyDraft || state.todayReflection?.energy || 'steady')}`
    ].filter(Boolean).join(' ');

    return `
        <section class="${cardClass}" data-journey-owner-id="${safeHtml(state.ownerId)}" data-journey-date-key="${safeHtml(state.todayKey)}" data-journey-energy="${safeHtml(normalizeEnergyTheme(state.energyDraft || state.todayReflection?.energy || 'steady'))}">
            <div class="journey-shell">
                ${renderBanner(state)}

                <div class="journey-popout" aria-hidden="true">
                    <div class="journey-popout-panel">
                        <div class="journey-popout-head">
                            <div class="journey-popout-head-copy">
                                <div class="journey-kicker">${safeHtml(state.canEdit ? 'Daily reflection popout' : 'Reflection details')}</div>
                                <h5 class="journey-popout-title">${safeHtml(state.canEdit ? 'Capture a small note' : 'Reflection snapshot')}</h5>
                            </div>
                            <button type="button" class="journey-btn journey-btn-ghost journey-popout-close" data-journey-action="close-popout">Close</button>
                        </div>

                        <div class="journey-progress">
                            <div class="journey-progress-track" aria-hidden="true">
                                ${renderProgressDots(state)}
                            </div>
                            <div class="journey-progress-copy">
                                <strong>${safeHtml(state.weeklySummary.progressCopy || 'No reflections yet this week.')}</strong>
                                <span>${safeHtml(state.weeklySummary.count > 0 ? `Most common energy: ${state.weeklySummary.dominantEnergyLabel}` : 'Your weekly pattern will appear here.')}</span>
                            </div>
                        </div>

                        <div class="journey-body ${state.hasTodayReflection ? 'is-complete' : 'is-reminder'} ${state.dismissedToday ? 'is-muted' : ''}">
                            ${renderPopoutBody(state)}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

const getCardElement = (ownerId) => {
    if (!ownerId) return null;
    return document.querySelector(`.${JOURNEY_CARD_CLASS}[data-journey-owner-id="${escapeSelectorValue(ownerId)}"]`);
};

const getFieldValue = (cardEl, field) => {
    return cardEl?.querySelector(`[data-journey-field="${field}"]`)?.value || '';
};

const getBannerButton = (cardEl) => cardEl?.querySelector('[data-journey-action="toggle-popout"]') || null;

const getPopoutElement = (cardEl) => cardEl?.querySelector('.journey-popout') || null;

const applyJourneyEnergyTheme = (card, energy) => {
    if (!card) return;
    const nextEnergy = normalizeEnergyTheme(energy);
    card.dataset.journeyEnergy = nextEnergy;
    JOURNEY_ENERGY_CLASSES.forEach((className) => card.classList.remove(className));
    card.classList.add(`journey-energy-${nextEnergy}`);
};

const refreshDashboard = async () => {
    if (typeof window.app_refreshDashboard === 'function') {
        await window.app_refreshDashboard();
    }
};

const JOURNEY_REFLECTION_SYNC_STATE = {
    ownerId: '',
    todayKey: '',
    signature: '',
    unsubscribe: null,
    refreshPending: false
};

const isDashboardVisible = () => {
    try {
        const page = String(window.location.hash || '#dashboard').replace('#', '').trim() || 'dashboard';
        if (page === 'dashboard') return true;
        return !!document.querySelector('.dashboard-staff-view, .dashboard-admin-view');
    } catch {
        return false;
    }
};

const buildReflectionSignature = (rows = []) => {
    return (Array.isArray(rows) ? rows : [])
        .map((row) => [
            String(row?.id || ''),
            String(row?.date || ''),
            String(row?.updatedAt || ''),
            String(row?.createdAt || ''),
            String(row?.note || ''),
            String(row?.energy || '')
        ].join('|'))
        .sort()
        .join('~');
};

const queueJourneyReflectionRefresh = async () => {
    if (JOURNEY_REFLECTION_SYNC_STATE.refreshPending) return;
    JOURNEY_REFLECTION_SYNC_STATE.refreshPending = true;
    try {
        if (isDashboardVisible()) {
            await refreshDashboard();
        }
    } finally {
        JOURNEY_REFLECTION_SYNC_STATE.refreshPending = false;
    }
};

const syncJourneyReflectionFeed = (state = {}) => {
    const ownerId = String(state.ownerId || '').trim();
    const todayKey = String(state.todayKey || '').trim();
    const canListen = !!window.AppDB?.listenQuery && !!ownerId;

    if (!canListen) {
        if (typeof JOURNEY_REFLECTION_SYNC_STATE.unsubscribe === 'function') {
            JOURNEY_REFLECTION_SYNC_STATE.unsubscribe();
        }
        JOURNEY_REFLECTION_SYNC_STATE.ownerId = '';
        JOURNEY_REFLECTION_SYNC_STATE.todayKey = '';
        JOURNEY_REFLECTION_SYNC_STATE.signature = '';
        JOURNEY_REFLECTION_SYNC_STATE.unsubscribe = null;
        return;
    }

    if (JOURNEY_REFLECTION_SYNC_STATE.ownerId === ownerId && JOURNEY_REFLECTION_SYNC_STATE.todayKey === todayKey) {
        return;
    }

    if (typeof JOURNEY_REFLECTION_SYNC_STATE.unsubscribe === 'function') {
        JOURNEY_REFLECTION_SYNC_STATE.unsubscribe();
    }

    JOURNEY_REFLECTION_SYNC_STATE.ownerId = ownerId;
    JOURNEY_REFLECTION_SYNC_STATE.todayKey = todayKey;
    JOURNEY_REFLECTION_SYNC_STATE.signature = '';
    
    let isInitialSnapshot = true;
    JOURNEY_REFLECTION_SYNC_STATE.unsubscribe = window.AppDB.listenQuery(
        AppJourneyReflection.JOURNEY_REFLECTION_COLLECTION,
        [{ field: 'userId', operator: '==', value: ownerId }],
        { silentPermissionDenied: true },
        (rows) => {
            const nextSignature = buildReflectionSignature(rows);
            if (!JOURNEY_REFLECTION_SYNC_STATE.signature) {
                JOURNEY_REFLECTION_SYNC_STATE.signature = nextSignature;
                // Trigger refresh on initial snapshot to load old reflections
                if (isInitialSnapshot && rows.length > 0) {
                    console.log(`Initial Journey Reflection snapshot: ${rows.length} records for user ${ownerId}`);
                    isInitialSnapshot = false;
                    void queueJourneyReflectionRefresh();
                }
                isInitialSnapshot = false;
                return;
            }
            if (nextSignature === JOURNEY_REFLECTION_SYNC_STATE.signature) return;
            JOURNEY_REFLECTION_SYNC_STATE.signature = nextSignature;
            void queueJourneyReflectionRefresh();
        }
    );
};

const setPopoutOpen = (ownerId, isOpen) => {
    const card = getCardElement(ownerId);
    if (!card) return;
    card.classList.toggle('is-popout-open', !!isOpen);
    const banner = getBannerButton(card);
    if (banner) banner.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    const popout = getPopoutElement(card);
    if (popout) popout.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
};

const focusJourneyTextarea = (card) => {
    const textarea = card?.querySelector('[data-journey-field="note"]');
    if (textarea && typeof textarea.focus === 'function') {
        try {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        } catch {
            /* ignore */
        }
    }
};

window.app_openJourneyReflectionComposer = function (ownerId) {
    const card = getCardElement(ownerId);
    if (!card) return;
    setPopoutOpen(ownerId, true);
    focusJourneyTextarea(card);
};

window.app_closeJourneyReflectionComposer = function (ownerId) {
    setPopoutOpen(ownerId, false);
};

window.app_openJourneyReflectionPopout = function (ownerId) {
    const card = getCardElement(ownerId);
    if (!card) return;
    setPopoutOpen(ownerId, true);
    focusJourneyTextarea(card);
};

window.app_closeJourneyReflectionPopout = function (ownerId) {
    setPopoutOpen(ownerId, false);
};

window.app_toggleJourneyReflectionPopout = function (ownerId) {
    const card = getCardElement(ownerId);
    if (!card) return;
    const isOpen = card.classList.contains('is-popout-open');
    setPopoutOpen(ownerId, !isOpen);
    if (!isOpen) {
        focusJourneyTextarea(card);
    }
};

window.app_dismissJourneyReflectionReminder = async function (ownerId, dateKey) {
    AppJourneyReflection.dismissJourneyReflectionReminder(ownerId, dateKey);
    await refreshDashboard();
};

window.app_saveJourneyReflection = async function (ownerId, dateKey) {
    const card = getCardElement(ownerId);
    if (!card) return;
    const note = getFieldValue(card, 'note');
    const energy = getFieldValue(card, 'energy') || 'steady';
    const prompt = card.querySelector('.journey-prompt-chip')?.textContent || '';
    const user = window.AppAuth?.getUser?.();
    const targetUser = ownerId || user?.id || '';

    if (!String(note || '').trim()) {
        window.app_showSyncToast?.('Add a short reflection before saving.');
        return;
    }

    const saveBtn = card.querySelector('[data-journey-action="save"]');
    if (saveBtn) saveBtn.disabled = true;
    try {
        await AppJourneyReflection.saveJourneyReflection({
            userId: targetUser,
            userName: user?.name || '',
            dateKey,
            note,
            energy,
            prompt,
            updatedBy: user?.id || '',
            source: 'dashboard'
        });
        card.classList.remove('is-popout-open');
        window.app_showSyncToast?.('Reflection saved.');
        await refreshDashboard();
    } catch (err) {
        console.error('Failed to save journey reflection:', err);
        window.app_showSyncToast?.(err?.message || 'Could not save reflection.');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
};

export function initJourneyReflectionUI() {
    if (window.__journeyReflectionUiBound) return;
    window.__journeyReflectionUiBound = true;

    document.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-journey-action]');
        if (!trigger) return;
        const action = String(trigger.dataset.journeyAction || '').trim();
        const card = trigger.closest(`.${JOURNEY_CARD_CLASS}`);
        const ownerId = card?.dataset?.journeyOwnerId || '';
        const dateKey = card?.dataset?.journeyDateKey || '';

        if (action === 'toggle-popout') {
            window.app_toggleJourneyReflectionPopout?.(ownerId);
            return;
        }
        if (action === 'open-popout' || action === 'open-composer') {
            window.app_openJourneyReflectionPopout?.(ownerId);
            return;
        }
        if (action === 'close-popout' || action === 'close-composer') {
            window.app_closeJourneyReflectionPopout?.(ownerId);
            return;
        }
        if (action === 'dismiss-reminder') {
            void window.app_dismissJourneyReflectionReminder?.(ownerId, dateKey);
            return;
        }
        if (action === 'save') {
            void window.app_saveJourneyReflection?.(ownerId, dateKey);
        }
    });

    document.addEventListener('change', (event) => {
        const target = event.target;
        if (!target?.matches?.('[data-journey-field="energy"]')) return;
        const card = target.closest(`.${JOURNEY_CARD_CLASS}`);
        applyJourneyEnergyTheme(card, target.value);
    });
}

if (typeof window !== 'undefined') {
    initJourneyReflectionUI();
}

export default renderJourneyReflectionCard;
