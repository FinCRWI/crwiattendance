/**
 * Dashboard Card Mode — Tile / Original / Fullscreen overlay system
 * Extracted from dashboard.js for separation of concerns.
 */

export const DASHBOARD_CARD_MODE_TILE = 'tile';
export const DASHBOARD_CARD_MODE_ORIGINAL = 'original';
export const DASHBOARD_CARD_MODE_FULLSCREEN = 'fullscreen';
export const DASHBOARD_CARD_MODES = new Set([DASHBOARD_CARD_MODE_TILE, DASHBOARD_CARD_MODE_ORIGINAL, DASHBOARD_CARD_MODE_FULLSCREEN]);
export const DASHBOARD_CARD_CONTROL_EXCLUDED_CLASSES = ['dashboard-hero-card', 'dashboard-journey-card'];
export const DASHBOARD_MAX_OVERLAY_ID = 'dashboard-card-max-overlay';
export const DASHBOARD_MAX_TITLE_ID = 'dashboard-card-max-title';
export const DASHBOARD_MAX_BODY_ID = 'dashboard-card-max-body';
export const DASHBOARD_MAX_RENDER_DELAY_MS = 0;

const markPerf = (name) => {
    try { if (window?.performance?.mark) window.performance.mark(name); } catch { /* ignore */ }
};
const measurePerf = (name, startMark, endMark) => {
    try { if (window?.performance?.measure) window.performance.measure(name, startMark, endMark); } catch { /* ignore */ }
};

function ensureDashboardMaxOverlay() {
    let overlay = document.getElementById(DASHBOARD_MAX_OVERLAY_ID);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = DASHBOARD_MAX_OVERLAY_ID;
        overlay.className = 'dashboard-max-overlay';
        overlay.innerHTML = `
            <div class="dashboard-max-window" role="dialog" aria-modal="true" aria-labelledby="${DASHBOARD_MAX_TITLE_ID}">
                <div class="dashboard-max-header">
                    <h2 id="${DASHBOARD_MAX_TITLE_ID}"></h2>
                    <button type="button" class="dashboard-max-close" data-ts-action="close-maximize" aria-label="Close maximized card">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div id="${DASHBOARD_MAX_BODY_ID}" class="dashboard-max-body"></div>
            </div>
        `;
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) window.app_closeDashboardCardMaximize?.();
        });
        document.body.appendChild(overlay);
    }
    return overlay;
}

function setDashboardBodyScrollLock(locked) {
    if (!document?.body) return;
    document.body.classList.toggle('dashboard-max-open', !!locked);
}

export function closeDashboardCardMaxOverlay() {
    const closingCardId = window._dashboardMaxCardId ? String(window._dashboardMaxCardId) : '';
    window._dashboardMaxRenderToken = 0;
    const overlay = document.getElementById(DASHBOARD_MAX_OVERLAY_ID);
    if (overlay) {
        overlay.classList.remove('open');
        overlay.remove();
    }
    const body = document.getElementById(DASHBOARD_MAX_BODY_ID);
    if (body) body.innerHTML = '';
    setDashboardBodyScrollLock(false);
    if (document?.body) document.body.style.overflow = '';
    const trigger = window._dashboardMaxTriggerEl;
    window._dashboardMaxTriggerEl = null;
    window._dashboardMaxCardId = null;
    if (closingCardId) {
        const cardEl = getDashboardCardElementById(closingCardId);
        if (cardEl) {
            setDashboardCardModeClass(cardEl, DASHBOARD_CARD_MODE_TILE);
            cardEl.dataset.dashboardCardMode = DASHBOARD_CARD_MODE_TILE;
        }
        if (window._dashboardCardModeState) {
            window._dashboardCardModeState[closingCardId] = DASHBOARD_CARD_MODE_TILE;
        }
    }
    if (trigger && typeof trigger.focus === 'function') {
        try { trigger.focus(); } catch { /* ignore */ }
    }
}

export function openDashboardCardMaxOverlay(cardId, triggerEl = null) {
    closeDashboardCardMaxOverlay();
    const template = (window._dashboardCardTemplates || {})[cardId];
    if (!template) return;
    const overlay = ensureDashboardMaxOverlay();
    const title = document.getElementById(DASHBOARD_MAX_TITLE_ID);
    const body = document.getElementById(DASHBOARD_MAX_BODY_ID);
    if (!title || !body) return;
    const renderToken = Date.now() + Math.random();
    title.textContent = template.title || 'Dashboard Card';
    body.innerHTML = `
        <div class="dashboard-max-shell">
            <div class="dashboard-max-loading">
                <span class="dashboard-max-loading-dot"></span>
                <span class="dashboard-max-loading-dot"></span>
                <span class="dashboard-max-loading-dot"></span>
            </div>
        </div>
    `;
    window._dashboardMaxTriggerEl = triggerEl;
    window._dashboardMaxCardId = cardId;
    window._dashboardMaxRenderToken = renderToken;
    setDashboardBodyScrollLock(true);
    overlay.classList.add('open');
    const closeBtn = overlay.querySelector('.dashboard-max-close');
    if (closeBtn) {
        try { closeBtn.focus(); } catch { /* ignore */ }
    }
    markPerf(`dashboard:max:${cardId}:shell`);
    const renderBody = () => {
        if (window._dashboardMaxRenderToken !== renderToken) return;
        const currentBody = document.getElementById(DASHBOARD_MAX_BODY_ID);
        if (!currentBody) return;
        const html = template.expandedHtml || template.originalHtml || template.tileHtml || '';
        currentBody.innerHTML = `<div class="dashboard-max-card-content">${html}</div>`;
        if (cardId === 'hero-week' && typeof window.app_updateHeroExpandedOverlay === 'function') {
            window.app_updateHeroExpandedOverlay();
        }
        if (cardId === 'staff-performance' && typeof window.app_updatePerfExpandedOverlay === 'function') {
            window.app_updatePerfExpandedOverlay();
        }
        markPerf(`dashboard:max:${cardId}:content`);
        measurePerf(`dashboard:max:${cardId}`, `dashboard:max:${cardId}:shell`, `dashboard:max:${cardId}:content`);
    };
    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
            if (DASHBOARD_MAX_RENDER_DELAY_MS > 0) {
                setTimeout(renderBody, DASHBOARD_MAX_RENDER_DELAY_MS);
            } else {
                renderBody();
            }
        });
    } else {
        setTimeout(renderBody, DASHBOARD_MAX_RENDER_DELAY_MS);
    }
}

export function getDashboardCardElementById(cardId) {
    if (!cardId) return null;
    return document.querySelector(`.dashboard-staff-view .card[data-dashboard-card-id="${cardId}"]`);
}

export function setDashboardCardModeClass(cardEl, mode) {
    if (!cardEl) return;
    cardEl.classList.remove('dashboard-card-mode-tile', 'dashboard-card-mode-original');
    if (mode === DASHBOARD_CARD_MODE_ORIGINAL) {
        cardEl.classList.add('dashboard-card-mode-original');
        if (cardEl.dataset.dashboardOriginalFullWidth === '1') {
            cardEl.classList.add('full-width');
        }
    } else {
        cardEl.classList.add('dashboard-card-mode-tile');
        cardEl.classList.remove('full-width');
    }
}

export function applyDashboardCardMode(cardId, mode, triggerEl = null) {
    if (!DASHBOARD_CARD_MODES.has(mode)) return;
    const cards = document.querySelectorAll('.dashboard-staff-view .card[data-dashboard-card-id]');
    if (!cards.length) return;
    cards.forEach((card) => {
        const isTarget = card.dataset.dashboardCardId === String(cardId);
        const nextMode = isTarget ? mode : DASHBOARD_CARD_MODE_TILE;
        setDashboardCardModeClass(card, nextMode);
        card.dataset.dashboardCardMode = nextMode;
    });
    window._dashboardCardModeState = window._dashboardCardModeState || {};
    window._dashboardCardModeState[cardId] = mode;
    window._dashboardActiveCardModeId = cardId;
    if (mode === DASHBOARD_CARD_MODE_FULLSCREEN) {
        openDashboardCardMaxOverlay(cardId, triggerEl || getDashboardCardElementById(cardId));
    } else {
        closeDashboardCardMaxOverlay();
    }
}
