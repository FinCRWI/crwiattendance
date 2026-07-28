import { AppConfig } from './config.js';
import './modules/auth.js';
import './modules/db.js';
import './modules/attendance.js';
import './modules/permissions.js';
import { APP_UNALLOCATED_BUDGET_HEAD } from './modules/budget-heads.js';
import './modules/budget-heads.js';
import './modules/system-dialog.js';
import { escapeHtml as app_escapeHtml, escapeJsSingleQuote as app_escapeJsSingleQuote, escapeDialogHtml } from './utils/html-escape.js';
import { getLocalISO } from './utils/date-helpers.js';
import AppUI from './ui.js';
import './modules/calendar.js';
import './modules/activity.js';
import './modules/tour.js';
import './modules/analytics.js';
import './modules/ai-context-feeder.js';

// Load secondary modules
import './modules/reports.js';
import './modules/leaves.js';
import './modules/rating.js';
import './modules/simulation.js';
import './modules/minutes.js';
import './modules/policies.js';
import './modules/admin-policies.js';
import './modules/day-plan.js';
import './modules/widget.js';
import './ui/site-announcement.js';

// Local aliases so legacy bare references inside this file keep working.
const app_normalizeBudgetHeadId = window.app_normalizeBudgetHeadId;

// ── Global async-button helper ────────────────────────────────
window.app_asyncButton = function(btn) {
  var el = typeof btn === 'string' ? document.querySelector(btn) : btn;
  if (!el) return function(){};
  var wasDisabled = el.disabled;
  el.disabled = true;
  el.classList.add('btn-loading');
  return function() {
    el.disabled = wasDisabled;
    el.classList.remove('btn-loading');
  };
};

// ── Auto-sync disabled buttons to loading spinner via CSS class ──
(function() {
  if (typeof window !== 'undefined' && window.MutationObserver) {
    var obs = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'attributes' && m.attributeName === 'disabled') {
          if (m.target.disabled) m.target.classList.add('btn-loading');
          else m.target.classList.remove('btn-loading');
        }
        if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var node = m.addedNodes[j];
            if (node.nodeType === 1) {
              if (node.disabled) node.classList.add('btn-loading');
              var disabledEls = node.querySelectorAll('button:disabled, .btn:disabled');
              for (var k = 0; k < disabledEls.length; k++) disabledEls[k].classList.add('btn-loading');
            }
          }
        }
      }
    });
    function attach() {
      if (document.body) obs.observe(document.body, { attributes: true, attributeFilter: ['disabled'], subtree: true, childList: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
    else attach();
  }
})();

/**
 * App State
 */
let timerInterval = null;
let adminListenerUnsubscribe = [];
let minutesListenerUnsubscribe = null;
let cachedLocation = null;
let lastLocationFetch = 0;
let attendanceActionInFlight = false;
let lastSyncedAttendanceStatus = null;
let userSyncRenderLock = false;
let suppressSyncToastUntil = 0;
let appServiceWorkerRegistration = null;
let releaseSignalUnsubscribe = null;
let releaseSignalPollTimer = null;
let releaseSignalListenerStarted = false;
let versionPollTimer = null;
let versionCheckInFlight = null;
const APP_BUILD_META = Object.freeze(typeof __APP_BUILD_META__ === 'object' && __APP_BUILD_META__
    ? __APP_BUILD_META__
    : {
        buildId: 'local',
        commitSha: '',
        builtAt: ''
    });
const UPDATE_MANIFEST_URL = '/version.json';
const UPDATE_CHECK_INTERVAL_MS = 60000;
const RELEASE_SIGNAL_DOC_ID = 'release_signal';
const RELEASE_META_COLLECTION = 'app_meta';
const RELEASE_SEEN_KEY = 'app_last_seen_release_id';
const releaseUpdateState = {
    active: false,
    releaseId: '',
    buildId: '',
    commitSha: '',
    deployedAt: '',
    notes: '',
    source: '',
    popupDismissed: false
};
const LOCATION_CACHE_TIME = 180000; // 3 minutes cache
const LOCATION_STALE_FALLBACK_TIME = 600000; // 10 minutes fallback when live lookup fails
const CHECKOUT_LOCATION_FRESH_MS = 120000; // Reuse GPS captured during the checkout modal for 2 minutes
let checkoutLocationSession = null;
window.app_annualYear = new Date().getFullYear();


const getStoredSeenReleaseId = () => {
    try {
        return localStorage.getItem(RELEASE_SEEN_KEY) || '';
    } catch (err) {
        void err;
        return '';
    }
};

const setStoredSeenReleaseId = (releaseId) => {
    try {
        localStorage.setItem(RELEASE_SEEN_KEY, String(releaseId || ''));
    } catch (err) {
        void err;
        // no-op
    }
};

const normalizeReleasePayload = (payload = {}, source = 'version') => {
    const buildId = String(payload.buildId || payload.releaseId || payload.commitSha || '').trim();
    if (!buildId) return null;

    return {
        releaseId: buildId,
        buildId,
        commitSha: String(payload.commitSha || '').trim(),
        deployedAt: String(payload.deployedAt || payload.builtAt || '').trim(),
        notes: String(payload.notes || '').trim(),
        source: String(source || payload.source || 'version').trim()
    };
};

const getReleaseUpdateSnapshot = () => {
    return {
        active: !!releaseUpdateState.active,
        releaseId: releaseUpdateState.releaseId || '',
        buildId: releaseUpdateState.buildId || '',
        commitSha: releaseUpdateState.commitSha || '',
        deployedAt: releaseUpdateState.deployedAt || '',
        notes: releaseUpdateState.notes || '',
        source: releaseUpdateState.source || '',
        popupDismissed: !!releaseUpdateState.popupDismissed,
        currentBuildId: APP_BUILD_META.buildId || '',
        currentCommitSha: APP_BUILD_META.commitSha || '',
        currentBuiltAt: APP_BUILD_META.builtAt || ''
    };
};

window.app_getReleaseUpdateState = () => getReleaseUpdateSnapshot();

const applyUpdateCtaState = () => {
    const state = getReleaseUpdateSnapshot();
    const btn = document.querySelector('.dashboard-refresh-link');
    if (!btn) return;
    if (state.active) {
        btn.classList.add('is-update-pending');
        btn.setAttribute('title', 'Update available. Click to refresh into the new version.');
        btn.textContent = 'System update available';
    } else {
        btn.classList.remove('is-update-pending');
        btn.setAttribute('title', 'Check for System Update (Ctrl+Shift+R)');
        btn.textContent = 'Check for System Update';
    }
};

window.app_applyUpdateCtaState = applyUpdateCtaState;

const broadcastReleaseUpdateState = () => {
    applyUpdateCtaState();
    if (window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('app:update-state', { detail: getReleaseUpdateSnapshot() }));
    }
};

const clearReleaseUpdateState = (markSeen = false) => {
    const currentRelease = releaseUpdateState.releaseId;
    releaseUpdateState.active = false;
    releaseUpdateState.releaseId = '';
    releaseUpdateState.buildId = '';
    releaseUpdateState.commitSha = '';
    releaseUpdateState.deployedAt = '';
    releaseUpdateState.notes = '';
    releaseUpdateState.source = '';
    releaseUpdateState.popupDismissed = false;
    releaseUpdateState.lastPopupReleaseId = '';
    if (markSeen && currentRelease) setStoredSeenReleaseId(currentRelease);
    broadcastReleaseUpdateState();
};

window.app_dismissReleaseUpdatePrompt = () => {
    if (!releaseUpdateState.active) return;
    if (releaseUpdateState.releaseId) {
        setStoredSeenReleaseId(releaseUpdateState.releaseId);
    }
    releaseUpdateState.popupDismissed = true;
    document.getElementById('system-update-modal')?.remove();
    broadcastReleaseUpdateState();
};

const activateReleaseUpdatePrompt = (payload, options = {}) => {
    const normalized = normalizeReleasePayload(payload, payload?.source || 'version');
    if (!normalized) return false;
    if (normalized.buildId === APP_BUILD_META.buildId) {
        clearReleaseUpdateState(false);
        return false;
    }

    const forcePopup = options.forcePopup === true;
    const lastSeen = getStoredSeenReleaseId();
    const isSameActiveRelease = releaseUpdateState.active && releaseUpdateState.releaseId === normalized.releaseId;

    releaseUpdateState.active = true;
    releaseUpdateState.releaseId = normalized.releaseId;
    releaseUpdateState.buildId = normalized.buildId;
    releaseUpdateState.commitSha = normalized.commitSha;
    releaseUpdateState.deployedAt = normalized.deployedAt;
    releaseUpdateState.notes = normalized.notes;
    releaseUpdateState.source = normalized.source;
    releaseUpdateState.popupDismissed = normalized.releaseId === lastSeen;

    if (!isSameActiveRelease) {
        window.app_showSyncToast('New version available.');
    }
    if (window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('app:update-available', { detail: getReleaseUpdateSnapshot() }));
    }
    broadcastReleaseUpdateState();

    const alreadyPopped = releaseUpdateState.lastPopupReleaseId === normalized.releaseId;
    if (!alreadyPopped && (forcePopup || !releaseUpdateState.popupDismissed)) {
        releaseUpdateState.popupDismissed = false;
        window.app_showSystemUpdatePopup();
    }

    return true;
};

const fetchDeployedVersionManifest = async ({ manual = false } = {}) => {
    try {
        const response = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, {
            cache: 'no-store',
            headers: {
                'cache-control': 'no-cache'
            }
        });
        if (!response.ok) {
            throw new Error(`Version check failed with ${response.status}`);
        }
        const payload = await response.json();
        return normalizeReleasePayload(payload, 'version');
    } catch (err) {
        console.warn('Unable to fetch deployed version manifest:', err);
        if (manual) {
            window.app_showSyncToast('Could not check for updates right now.');
        }
        return null;
    }
};

const checkForDeployedUpdate = async (options = {}) => {
    if (versionCheckInFlight) {
        return versionCheckInFlight;
    }

    versionCheckInFlight = (async () => {
        const payload = await fetchDeployedVersionManifest({ manual: options.manual === true });
        if (!payload) {
            return false;
        }
        return activateReleaseUpdatePrompt(payload, { forcePopup: options.forcePopup === true });
    })();

    try {
        return await versionCheckInFlight;
    } finally {
        versionCheckInFlight = null;
    }
};

const startRoutineUpdateChecks = () => {
    if (versionPollTimer) return;
    versionPollTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && window.AppAuth?.getUser()) {
            void checkForDeployedUpdate();
        }
    }, UPDATE_CHECK_INTERVAL_MS);
    void checkForDeployedUpdate();
};

const stopRoutineUpdateChecks = () => {
    if (versionPollTimer) {
        clearInterval(versionPollTimer);
        versionPollTimer = null;
    }
};

const pingForVisibleUpdate = () => {
    if (document.visibilityState !== 'visible') return;
    if (!window.AppAuth?.getUser()) return;
    void checkForDeployedUpdate();
};

const pingForFocusedUpdate = () => {
    if (!window.AppAuth?.getUser()) return;
    void checkForDeployedUpdate();
};

const handleReleaseSignalDoc = (doc) => {
    if (!doc || doc.id !== RELEASE_SIGNAL_DOC_ID) return;
    if (doc.active === false) return;
    activateReleaseUpdatePrompt({ ...doc, source: 'release-signal' }, { forcePopup: true });
};

const startReleaseSignalListener = () => {
    if (releaseSignalListenerStarted) return;
    releaseSignalListenerStarted = true;
    if (window.AppDB && typeof window.AppDB.listenDoc === 'function') {
        releaseSignalUnsubscribe = window.AppDB.listenDoc(RELEASE_META_COLLECTION, RELEASE_SIGNAL_DOC_ID, (doc) => {
            if (doc) handleReleaseSignalDoc(doc);
        });
        return;
    }
    // Fallback polling mode if realtime listener is unavailable.
    releaseSignalPollTimer = setInterval(async () => {
        try {
            const doc = await window.AppDB.get(RELEASE_META_COLLECTION, RELEASE_SIGNAL_DOC_ID);
            if (doc) handleReleaseSignalDoc(doc);
        } catch (err) {
            void err;
            // no-op
        }
    }, 30000);
};

const stopReleaseSignalListener = () => {
    if (typeof releaseSignalUnsubscribe === 'function') {
        releaseSignalUnsubscribe();
        releaseSignalUnsubscribe = null;
    }
    if (releaseSignalPollTimer) {
        clearInterval(releaseSignalPollTimer);
        releaseSignalPollTimer = null;
    }
    releaseSignalListenerStarted = false;
};

window.app_checkForSystemUpdate = async () => {
    if (releaseUpdateState.active) {
        window.app_showSystemUpdatePopup();
        return true;
    }

    const hasUpdate = await checkForDeployedUpdate({ manual: true, forcePopup: true });
    if (!hasUpdate) {
        window.app_showSyncToast('You are already using the latest version.');
    }
    return hasUpdate;
};



window.app_getReadTelemetry = () => {
    if (!window.AppDB || !window.AppDB.getReadTelemetry) return {};
    return window.AppDB.getReadTelemetry();
};

window.app_resetReadTelemetry = () => {
    if (!window.AppDB || !window.AppDB.clearReadTelemetry) return;
    window.AppDB.clearReadTelemetry();
};

// --- Navigation Section Management (Collapsible Categories) ---

/**
 * Get collapse state from localStorage
 */
window.app_getNavSectionCollapsed = (sectionName) => {
    try {
        const stored = localStorage.getItem(`nav_section_${sectionName}_collapsed`);
        if (stored === null) return false; // Default to expanded on first load
        return stored === 'true';
    } catch (err) {
        console.warn('Failed to get nav section collapsed state:', err);
        return false;
    }
};

/**
 * Set collapse state in localStorage
 */
window.app_setNavSectionCollapsed = (sectionName, isCollapsed) => {
    try {
        localStorage.setItem(`nav_section_${sectionName}_collapsed`, isCollapsed ? 'true' : 'false');
    } catch (err) {
        console.warn('Failed to set nav section collapsed state:', err);
    }
};

/**
 * Toggle a navigation section's collapse state
 */
window.app_toggleNavSection = (sectionName) => {
    const section = document.querySelector(`.nav-section[data-section="${sectionName}"]`);
    if (!section) return;

    const header = section.querySelector('.nav-section-header');
    if (!header) return;

    const isCurrentlyCollapsed = header.dataset.collapsed === 'true';
    const newCollapsedState = !isCurrentlyCollapsed;

    header.dataset.collapsed = newCollapsedState ? 'true' : 'false';
    window.app_setNavSectionCollapsed(sectionName, newCollapsedState);
    
    // Reset auto-collapse timer on user interaction
    window.app_resetAutoCollapseTimer();
};

/**
 * Initialize section toggle handlers and restore collapse states
 */
window.app_initSectionToggle = () => {
    const headers = document.querySelectorAll('.nav-section-header');
    headers.forEach(header => {
        const section = header.closest('.nav-section');
        if (!section) return;

        const sectionName = section.dataset.section;
        if (!sectionName) return;

        // Restore collapse state from localStorage
        const isCollapsed = window.app_getNavSectionCollapsed(sectionName);
        header.dataset.collapsed = isCollapsed ? 'true' : 'false';

        // Add click event listener only if not already added (check for data attribute)
        if (header.dataset.listenerAttached !== 'true') {
            header.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.app_toggleNavSection(sectionName);
            });
            header.dataset.listenerAttached = 'true';
        }
    });
    
    // Start auto-collapse timer on initialization
    window.app_startAutoCollapseTimer();
};

// Auto-collapse timer variable
let autoCollapseTimer = null;

/**
 * Start auto-collapse timer (5 minutes)
 */
window.app_startAutoCollapseTimer = () => {
    window.app_resetAutoCollapseTimer();
};

/**
 * Reset auto-collapse timer
 */
window.app_resetAutoCollapseTimer = () => {
    if (autoCollapseTimer) {
        clearTimeout(autoCollapseTimer);
    }
    
    autoCollapseTimer = setTimeout(() => {
        window.app_autoCollapseSections();
    }, 5 * 60 * 1000); // 5 minutes
};

/**
 * Auto-collapse all sections except CORE
 */
window.app_autoCollapseSections = () => {
    const sections = document.querySelectorAll('.nav-section');
    sections.forEach(section => {
        const sectionName = section.dataset.section;
        if (!sectionName) return;
        
        // Skip CORE section - keep it expanded
        if (sectionName === 'core') return;
        
        const header = section.querySelector('.nav-section-header');
        if (header) {
            header.dataset.collapsed = 'true';
            window.app_setNavSectionCollapsed(sectionName, true);
        }
    });
};

/**
 * Update navigation sections visibility and item visibility based on user permissions
 */
window.app_updateNavigationSections = (user = window.AppAuth?.getUser()) => {
    // allow this function to run even when `user` is not yet available
    if (!user) {
        user = window.AppAuth?.getUser();
    }

    // Determine what each user can see
    const overrideShowHiddenSheets = (window.app_getShowHiddenSheets && window.app_getShowHiddenSheets()) || false;
    const canSeeDashboard = window.app_hasPerm('dashboard', 'view', user);
    const canSeeLeaves = window.app_hasPerm('leaves', 'view', user);
    const canSeeUsers = window.app_hasPerm('users', 'view', user);
    // Attendance/master-sheet visibility can be overridden by the 'show hidden sheets' toggle
    const canSeeAttendance = window.app_hasPerm('attendance', 'view', user) || overrideShowHiddenSheets;
    const canSeeReports = window.app_hasPerm('reports', 'view', user) || overrideShowHiddenSheets;
    const canSeePoliciesAdmin = window.app_hasPerm('policies', 'view', user) || overrideShowHiddenSheets;
    const canSeeAdmin = window.app_canSeeAdminPanel(user) || overrideShowHiddenSheets;
    const canSeeBirthdayCalendar = window.app_canManageBirthdays(user) || overrideShowHiddenSheets;
    const canSeeLetterPad = window.app_canAccessLetterPad(user) || overrideShowHiddenSheets;
    const canSeeStaffAiMemory = window.app_canAccessStaffAiMemory(user) || overrideShowHiddenSheets;
    const canSeeMinutes = window.app_hasPerm('minutes', 'view', user) || overrideShowHiddenSheets;

    // Update individual item visibility
    const itemVisibility = [
        { selector: 'a[data-page="dashboard"]', canSee: canSeeDashboard },
        { selector: 'a[data-page="staff-directory"]', canSee: canSeeUsers },
        { selector: 'a[data-page="annual-plan"]', canSee: canSeeDashboard },
        { selector: 'a[data-page="team-activities"]', canSee: canSeeDashboard },
        { selector: 'a[data-page="timesheet"]', canSee: canSeeAttendance },
        { selector: 'a[data-page="policies"]', canSee: canSeePoliciesAdmin },
        { selector: 'a[data-page="birthday-calendar"]', canSee: canSeeBirthdayCalendar },
        { selector: 'a[data-page="admin"]', canSee: canSeeAdmin },
        { selector: 'a[data-page="master-sheet"]', canSee: canSeeAttendance },
        { selector: 'a[data-page="salary"]', canSee: canSeeReports },
        { selector: 'a[data-page="policy-test"]', canSee: canSeePoliciesAdmin },
        { selector: 'a[data-page="letter-pad"]', canSee: canSeeLetterPad },
        { selector: 'a[data-page="staff-ai-memory"]', canSee: canSeeStaffAiMemory },
        { selector: 'a[data-page="minutes"]', canSee: canSeeMinutes },
        { selector: 'a[data-page="widget"]', canSee: true } // Widget mode always available
    ];

    itemVisibility.forEach(({ selector, canSee }) => {
        document.querySelectorAll(selector).forEach(link => {
            if (canSee) {
                // remove any previously-applied important display rule
                try { link.style.removeProperty('display'); } catch (err) { void err; }
                link.style.display = 'flex';
            } else {
                link.style.setProperty('display', 'none', 'important');
            }
        });
    });

    // Determine section visibility based on whether they have access to ANY visible item in that section.
    // Keep the section present for the user even when only one item is allowed, so the sidebar remains useful.
    const visibleCoreItems = [canSeeDashboard, canSeeUsers];
    const visibleHrItems = [canSeeAttendance, canSeePoliciesAdmin, canSeeBirthdayCalendar];
    const visibleToolsItems = [canSeeMinutes, canSeeLetterPad, canSeeStaffAiMemory];
    const visibleAdminItems = [canSeeAdmin, canSeeReports, canSeePoliciesAdmin];

    const sectionVisiblity = {
        core: visibleCoreItems.some(Boolean),
        hr: visibleHrItems.some(Boolean),
        tools: visibleToolsItems.some(Boolean),
        admin: visibleAdminItems.some(Boolean)
    };

    // Update section visibility
    document.querySelectorAll('.nav-section').forEach(section => {
        const sectionName = section.dataset.section;
        if (!sectionName) return;

        const shouldBeVisible = sectionVisiblity[sectionName];
        if (shouldBeVisible === undefined) return;

        if (shouldBeVisible) {
            section.classList.remove('empty');
            section.style.display = '';
        } else {
            section.classList.add('empty');
            section.style.display = 'none';
        }
    });

    // Do the same for mobile nav sections
    document.querySelectorAll('.mobile-nav-section').forEach(section => {
        const sectionName = section.dataset.section;
        if (!sectionName) return;

        const shouldBeVisible = sectionVisiblity[sectionName];
        if (shouldBeVisible === undefined) return;

        if (shouldBeVisible) {
            section.classList.remove('empty');
        } else {
            section.classList.add('empty');
        }
    });
};

// --- Read Optimization: Filtered Mailbox ---
window.app_getMyMessages = async () => {
    const user = window.AppAuth.getUser();
    if (!user) return [];
    try {
        const [incoming, outgoing] = await Promise.all([
            window.AppDB.query('staff_messages', 'toId', '==', user.id),
            window.AppDB.query('staff_messages', 'fromId', '==', user.id)
        ]);
        // Merge and deduplicate by ID
        const map = new Map();
        (incoming || []).forEach(m => map.set(m.id, m));
        (outgoing || []).forEach(m => map.set(m.id, m));
        return Array.from(map.values());
    } catch (err) {
        console.warn("Message fetch failed, falling back to getAll", err);
        return window.AppDB.getAll('staff_messages');
    }
};

// DOM Elements - queried dynamically or once if available
const contentArea = document.getElementById('page-content');
const sidebar = document.querySelector('.sidebar');
const mobileHeader = document.querySelector('.mobile-header');
const mobileNav = document.querySelector('.mobile-nav');

// --- Theme Management ---
window.app_initTheme = () => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcons(savedTheme);
};

window.app_toggleTheme = () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcons(newTheme);
};

function updateThemeIcons(theme) {
    document.querySelectorAll('.theme-toggle i').forEach(icon => {
        if (theme === 'dark') {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        } else {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
        }
    });
}

// --- Show Hidden Sheets Toggle (Settings override)
window.app_getShowHiddenSheets = () => {
    try {
        return localStorage.getItem('show_hidden_sheets') === 'true';
    } catch (err) {
        return false;
    }
};

window.app_setShowHiddenSheets = (value) => {
    try {
        localStorage.setItem('show_hidden_sheets', value ? 'true' : 'false');
    } catch (err) {
        // ignore
    }
};

window.app_toggleShowHiddenSheets = () => {
    const next = !window.app_getShowHiddenSheets();
    window.app_setShowHiddenSheets(next);
    window.app_applyShowHiddenSheetsToggle();
    // Re-evaluate navigation visibility
    try { window.app_updateNavigationSections(); } catch (err) { void err; }
};

window.app_applyShowHiddenSheetsToggle = () => {
    const btn = document.getElementById('show-sheets-toggle');
    if (!btn) return;
    const icon = btn.querySelector('i');
    if (window.app_getShowHiddenSheets()) {
        btn.classList.add('active');
        if (icon) { icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye'); }
    } else {
        btn.classList.remove('active');
        if (icon) { icon.classList.remove('fa-eye'); icon.classList.add('fa-eye-slash'); }
    }
};

// Show last notification error if any (persisted across refresh)
window.addEventListener('load', () => {
    if (window.app_showLastNotifError) window.app_showLastNotifError();
}, { once: true });

// Ensure the Show Hidden Sheets toggle UI reflects persisted state on load
window.addEventListener('load', () => {
    try { window.app_applyShowHiddenSheetsToggle(); } catch (err) { void err; }
}, { once: true });

// Also apply toggle as early as DOMContentLoaded so nav visuals are correct sooner
document.addEventListener('DOMContentLoaded', () => {
    try { window.app_applyShowHiddenSheetsToggle(); } catch (err) { void err; }
    try { if (typeof window.app_initSectionToggle === 'function') window.app_initSectionToggle(); } catch (err) { void err; }
    // Also update navigation section visibility early so tests that set
    // `show_hidden_sheets` in localStorage before scripts run will take effect.
    try { if (typeof window.app_updateNavigationSections === 'function') window.app_updateNavigationSections(); } catch (err) { void err; }
}, { once: true });

function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    const host = String(window.location?.hostname || '').toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (isLocalHost) {
        console.log('ServiceWorker registration skipped on localhost');
        void (async () => {
            try {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (const reg of regs) {
                    await reg.unregister();
                }
                if ('caches' in window) {
                    const keys = await caches.keys();
                    for (const key of keys) {
                        await caches.delete(key);
                    }
                }
            } catch (err) {
                console.warn('Local dev service worker cleanup failed:', err);
            }
        })();
        return;
    }

    const runRegistration = async () => {
        try {
            appServiceWorkerRegistration = await navigator.serviceWorker.register('/sw.js');
            console.log('ServiceWorker registered');
        } catch (err) {
            console.log('ServiceWorker registration failed: ', err);
        }
    };

    if (document.readyState === 'complete') {
        void runRegistration();
        return;
    }

    window.addEventListener('load', () => {
        void runRegistration();
    }, { once: true });
}

// --- UI Helpers ---
window.app_showAttendanceNotice = (message) => {
    if (!message) return;
    const host = document.getElementById('page-content');
    if (!host) return;

    const existing = document.getElementById('attendance-policy-notice');
    if (existing) existing.remove();

    const notice = document.createElement('div');
    notice.id = 'attendance-policy-notice';
    notice.style.background = '#fff7ed';
    notice.style.border = '1px solid #fdba74';
    notice.style.color = '#9a3412';
    notice.style.padding = '0.85rem 1rem';
    notice.style.borderRadius = '10px';
    notice.style.marginBottom = '0.9rem';
    notice.style.fontSize = '0.9rem';
    notice.style.fontWeight = '600';
    notice.innerHTML = `<i class="fa-solid fa-circle-info" style="margin-right:0.45rem;"></i>${message}`;

    host.prepend(notice);
    setTimeout(() => {
        const el = document.getElementById('attendance-policy-notice');
        if (el) el.remove();
    }, 10000);
};

window.app_promptMissedCheckoutReason = (payload = {}) => {
    const { logId, date } = payload || {};
    if (!logId) return;
    if (document.getElementById('missed-checkout-reason-modal')) return;

    const dateLabel = date ? new Date(`${date}T00:00:00`).toLocaleDateString() : 'previous day';
    const html = `
        <div class="modal-overlay" id="missed-checkout-reason-modal" style="display:flex;">
            <div class="modal-content" style="max-width:560px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; margin-bottom:0.75rem;">
                    <div>
                        <h3 style="margin:0;">Missed Checkout</h3>
                        <p style="margin:0.35rem 0 0 0; font-size:0.85rem; color:#6b7280;">
                            Your session on ${escapeDialogHtml(dateLabel)} was auto-checked out and counted as a half day.
                        </p>
                    </div>
                    <button type="button" onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:1.2rem; cursor:pointer;">&times;</button>
                </div>
                <form onsubmit="window.app_submitMissedCheckoutReason(event, '${String(logId)}')">
                    <label style="display:block; font-size:0.85rem; margin-bottom:0.35rem;">Reason for not checking out</label>
                    <textarea name="reason" required placeholder="Share what happened..." style="width:100%; padding:0.75rem; border:1px solid #ddd; border-radius:8px; min-height:110px;"></textarea>
                    <div style="font-size:0.8rem; color:#92400e; margin-top:0.5rem;">
                        This will be sent to admin for verification.
                    </div>
                    <div style="display:flex; justify-content:flex-end; margin-top:1rem;">
                        <button type="submit" class="action-btn">Submit Reason</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    (document.body || document.getElementById('modal-container')).insertAdjacentHTML('beforeend', html);

    const modal = document.getElementById('missed-checkout-reason-modal');
    modal?.addEventListener('click', (ev) => {
        if (ev.target === modal) modal.remove();
    });
};

window.app_hasSubmittedCheckoutTasksForDate = async (userId, date) => {
    if (!window.AppDB || !userId || !date) return false;
    const attendanceLogs = await window.AppDB.getAll('attendance').catch(() => []);
    const targetUserId = String(userId);
    const targetDate = String(date);
    return (attendanceLogs || []).some((log) => {
        if (!log) return false;
        if (String(log.user_id || log.userId || '') !== targetUserId) return false;
        if (String(log.date || '') !== targetDate) return false;
        if (Array.isArray(log.taskUpdates) && log.taskUpdates.length > 0) return true;
        if (log.taskUpdatesSubmittedAt) return true;
        if (log.taskReconciliationSubmittedAt) return true;
        return false;
    });
};

window.app_openMissedCheckoutTaskReconciliation = async ({ logId, date }) => {
    if (!logId || !date) return false;
    if (document.getElementById('missed-checkout-task-modal')) return true;

    const currentUser = window.AppAuth.getUser();
    if (!currentUser) return false;
    if (await window.app_hasSubmittedCheckoutTasksForDate(currentUser.id, date)) return false;

    const workPlan = window.AppCalendar?.getWorkPlan
        ? await window.AppCalendar.getWorkPlan(currentUser.id, date, { includeAnnual: true, mergeAnnual: true })
        : null;

    const hasPersonalTasks = !!(workPlan && Array.isArray(workPlan.plans) && workPlan.plans.length);
    if (!hasPersonalTasks) return false;

    if (window.app_checkoutActionDate !== date) {
        window.app_checkoutActionDate = date;
        window.app_checkoutTaskActions = {};
        window.app_checkoutTaskDetails = {};
        window.app_checkoutTaskMeta = {};
        window.app_checkoutUserMap = {};
    }

    const modalContainer = document.getElementById('modal-container') || document.body;
    if (!modalContainer) return false;

    const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString();
    const modalHtml = `
        <div id="missed-checkout-task-modal" class="modal-overlay checkout-main-modal" style="display:flex;">
            <div class="modal-content checkout-main-content" style="width:100%; max-width:620px;">
                <h3 style="margin-bottom:0.75rem;">Task Reconciliation</h3>
                <p style="color:#6b7280; font-size:0.9rem; margin-bottom:1rem;">
                    Your checkout was missed for ${escapeDialogHtml(dateLabel)}. Please update the task outcomes that were still pending.
                </p>
                <form id="missed-checkout-task-form" novalidate>
                    <div id="checkout-task-checklist" style="margin-bottom: 1.5rem;">
                        <label style="display: block; font-size: 0.85rem; font-weight: 700; color: #4b5563; margin-bottom: 0.75rem;">Task Status</label>
                        <div id="checkout-task-list" style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 260px; overflow-y: auto; padding-right: 5px;"></div>
                    </div>
                    <div id="checkout-action-preview" style="margin-bottom: 1.5rem; display: none;">
                        <label style="display: block; font-size: 0.85rem; font-weight: 700; color: #4b5563; margin-bottom: 0.75rem;">Action Preview</label>
                        <div id="checkout-action-preview-list" class="checkout-action-preview-list"></div>
                    </div>
                    <div id="delegate-panel" style="display:none; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:1rem; margin-bottom:1.5rem;">
                        <h4 id="delegate-selected-task" style="font-size:0.8rem; color:#1e293b; margin-top:0; margin-bottom:0.75rem; line-height:1.4;"></h4>
                        <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:0.5rem;">Choose staff member:</label>
                        <div id="delegate-list" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:0.5rem; max-height:180px; overflow-y:auto; padding:2px;"></div>
                        <div style="margin-top:1rem; display:flex; justify-content:flex-end;">
                            <button type="button" onclick="window.app_handleChecklistAction(null, null, null)" class="action-btn secondary" style="font-size:0.75rem; padding:0.4rem 0.8rem;">Cancel Delegation</button>
                        </div>
                    </div>
                    <div style="display:flex; gap:1rem;">
                        <button type="button" onclick="document.getElementById('missed-checkout-task-modal')?.remove()" style="flex:1; padding:0.75rem; background:white; border:1px solid #d1d5db; border-radius:0.5rem; cursor:pointer;">Skip for Now</button>
                        <button type="submit" class="action-btn" style="flex:1; justify-content:center;">Save Task Updates</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    modalContainer.insertAdjacentHTML('beforeend', modalHtml);
    const modal = document.getElementById('missed-checkout-task-modal');
    if (!modal) return false;

    const taskListEl = document.getElementById('checkout-task-list');
    const delegatePanel = document.getElementById('delegate-panel');
    const delegateList = document.getElementById('delegate-list');
    const delegateSelTask = document.getElementById('delegate-selected-task');

    const allUsers = await window.AppDB.getAll('users').catch(() => []);
    window.app_checkoutUserMap = {};
    (allUsers || []).forEach((u) => {
        window.app_checkoutUserMap[String(u.id)] = u.name;
    });

    const candidates = (allUsers || []).filter((u) => String(u.id) !== String(currentUser.id));
    const renderTaskRows = () => {
        const rows = [];
        if (workPlan && Array.isArray(workPlan.plans) && workPlan.plans.length > 0) {
            workPlan.plans.forEach((p, idx) => {
                const details = (p.subPlans && p.subPlans.length) ? ` - ${p.subPlans.join(', ')}` : '';
                const text = `${p.task}${details}`;
                const planIdForTask = p._planId || workPlan.id;
                const taskIndexForTask = typeof p._taskIndex === 'number' ? p._taskIndex : idx;
                const status = window.AppCalendar.getSmartTaskStatus(p._planDate || workPlan.date, p.status);
                const actionKey = `${planIdForTask}:${taskIndexForTask}`;
                window.app_checkoutTaskMeta = window.app_checkoutTaskMeta || {};
                window.app_checkoutTaskMeta[actionKey] = {
                    text,
                    planId: planIdForTask,
                    taskIndex: taskIndexForTask
                };
                const rememberedAction = window.app_checkoutTaskActions && window.app_checkoutTaskActions[actionKey]
                    ? window.app_checkoutTaskActions[actionKey]
                    : '';
                const inferredAction = rememberedAction || (
                    (p.status === 'completed' || status === 'completed') ? 'complete' :
                        (p.status === 'postponed' ? 'postpone' : '')
                );
                const detailState = window.app_initCheckoutTaskDetails(planIdForTask, taskIndexForTask, p);
                const actionValue = detailState.action || inferredAction || '';
                if (actionValue && detailState.action !== actionValue) {
                    detailState.action = actionValue;
                    if (actionValue === 'complete') {
                        detailState.progressPercent = 100;
                        detailState.progressStatus = 'done';
                    }
                }
                if (window.app_checkoutTaskActions && actionValue) {
                    window.app_checkoutTaskActions[actionKey] = actionValue;
                }
                const statusLabel = status === 'completed' ? 'Completed'
                    : status === 'in-process' ? 'In Process'
                        : status === 'overdue' ? 'Overdue'
                            : status === 'to-be-started' ? 'To Be Started'
                                : (p.status || 'Pending');
                rows.push(`
                    <div class="checkout-task-row">
                        <div class="checkout-task-copy">
                            <div class="checkout-task-title">${window.app_formatTaskWithPostponeChip(text)}</div>
                            <div class="checkout-task-status">Status: ${statusLabel}</div>
                        </div>
                        <div class="checkout-task-controls">
                            <select onchange="window.app_handleChecklistAction('${planIdForTask}', ${taskIndexForTask}, this.value)" class="checkout-task-action-select">
                                <option value="" ${!actionValue ? 'selected' : ''}>Choose Action</option>
                                <option value="complete" ${actionValue === 'complete' ? 'selected' : ''}>Complete</option>
                                <option value="postpone" ${actionValue === 'postpone' ? 'selected' : ''}>Postpone</option>
                                <option value="delegate" ${actionValue === 'delegate' ? 'selected' : ''}>Delegate</option>
                            </select>
                            <button type="button" class="checkout-task-detail-btn" data-checkout-detail-key="${app_escapeHtml(actionKey)}" onclick="window.app_openCheckoutActionModal('${app_escapeJsSingleQuote(actionKey)}')" ${actionValue ? '' : 'disabled'}>Details</button>
                        </div>
                    </div>`);
            });
        }
        return rows.join('');
    };

    if (taskListEl) {
        if (hasPersonalTasks) {
            taskListEl.innerHTML = renderTaskRows();
            window.app_renderCheckoutActionPreview();
        } else {
            taskListEl.innerHTML = `<div style="font-size:0.8rem; color:#6b7280;">No tasks planned for this date.</div>`;
            window.app_renderCheckoutActionPreview();
        }
    }

    if (delegatePanel && delegateList && delegateSelTask) {
        delegatePanel.style.display = 'none';
        delegateList.innerHTML = candidates.map((u) => `
            <button type="button" data-user-id="${u.id}" class="delegate-user-btn">
                <img src="${u.avatar}" alt="${u.name}" class="delegate-user-avatar">
                <span style="flex:1;">${u.name}</span>
            </button>
        `).join('');
    }

    modal.addEventListener('click', (ev) => {
        if (ev.target === modal) modal.remove();
    });
    modal.querySelector('#missed-checkout-task-form')?.addEventListener('submit', async (event) => {
        await window.app_submitMissedCheckoutTaskReconciliation(event, logId, date);
    });
    return true;
};

window.app_submitMissedCheckoutReason = async (event, logId) => {
    event.preventDefault();
    const form = event.target;
    const reason = String(new FormData(form).get('reason') || '').trim();
    if (!reason) {
        alert('Please enter a reason.');
        return;
    }

    try {
        const currentUser = window.AppAuth.getUser();
        if (!currentUser) throw new Error('User not authenticated');

        const log = await window.AppDB.get('attendance', logId);
        if (!log) throw new Error('Attendance record not found.');

        const nowIso = new Date().toISOString();
        const updatedLog = {
            ...log,
            missedCheckoutReason: reason,
            missedCheckoutReasonSubmittedAt: nowIso,
            missedCheckoutReasonStatus: 'pending'
        };
        await window.AppDB.put('attendance', updatedLog);

        const staff = await window.AppDB.get('users', currentUser.id);
        if (staff) {
            if (!staff.notifications) staff.notifications = [];
            staff.notifications.unshift({
                id: `mcr_sub_${Date.now()}`,
                type: 'missed-checkout-reason-submitted',
                title: 'Missed checkout reason submitted',
                message: `Reason sent for ${log.date}. Awaiting admin verification.`,
                status: 'submitted',
                date: nowIso,
                read: true
            });
            await window.AppDB.put('users', staff);
            if (window.AppAuth?.getUser) Object.assign(window.AppAuth.getUser(), { notifications: staff.notifications });
        }

        const admins = (await window.AppDB.getAll('users')).filter(u => u.isAdmin || u.role === 'Administrator');
        await Promise.all(admins.map(async (admin) => {
            if (!admin.notifications) admin.notifications = [];
            admin.notifications.unshift({
                id: `mcr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                type: 'missed-checkout-reason',
                title: 'Missed checkout reason submitted',
                message: `${currentUser.name} submitted a reason for missed checkout on ${log.date}.`,
                description: reason,
                staffId: currentUser.id,
                staffName: currentUser.name,
                missedCheckoutDate: log.date,
                logId: String(log.id || ''),
                taggedById: currentUser.id,
                taggedByName: currentUser.name,
                taggedAt: nowIso,
                status: 'pending',
                date: nowIso,
                read: false
            });
            await window.AppDB.put('users', admin);
        }));

        document.getElementById('missed-checkout-reason-modal')?.remove();
        if (window.app_refreshNotificationBell) await window.app_refreshNotificationBell();
        window.app_showSyncToast('Reason submitted for admin verification.');
        setTimeout(() => {
            window.app_openMissedCheckoutTaskReconciliation({ logId, date: log.date });
        }, 0);
    } catch (err) {
        console.error('Missed checkout reason submit failed:', err);
        alert('Failed to submit reason: ' + err.message);
    }
};

window.app_submitMissedCheckoutTaskReconciliation = async (event, logId, date) => {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form?.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        const currentUser = window.AppAuth.getUser();
        if (!currentUser) throw new Error('User not authenticated');

        const log = await window.AppDB.get('attendance', logId);
        if (!log) throw new Error('Attendance record not found.');

        const detailKeys = Object.keys(window.app_checkoutTaskDetails || {});
        detailKeys.forEach((key) => window.app_clearCheckoutTaskError(key));
        const { updates: taskUpdates, errors: taskErrors } = window.app_collectCheckoutTaskUpdates();
        if (taskErrors.length > 0) {
            taskErrors.forEach((err) => window.app_setCheckoutTaskError(err.key, err.message));
            await window.app_showCheckoutValidationPopup(taskErrors.map((err) => err.message));
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Save Task Updates';
            }
            return;
        }

        const nowIso = new Date().toISOString();
        const updatedLog = {
            ...log,
            taskUpdates: taskUpdates.map((update) => ({
                planId: update.planId,
                taskIndex: update.taskIndex,
                action: update.action,
                progressPercent: update.progressPercent,
                progressStatus: update.progressStatus,
                progressNote: update.progressNote,
                budgetHeadId: app_normalizeBudgetHeadId(update.budgetHeadId),
                actionMeta: update.actionMeta || {},
                timestamp: update.timestamp
            })),
            taskUpdatesSubmittedAt: taskUpdates.length ? nowIso : (log.taskUpdatesSubmittedAt || nowIso),
            taskReconciliationSubmittedAt: nowIso,
            taskReconciliationCompleted: true
        };
        await window.AppDB.put('attendance', updatedLog);

        if (taskUpdates.length > 0) {
            await window.app_applyCheckoutTaskUpdates(taskUpdates, { effectiveDate: String(date || log.date || '') });
        }

        document.getElementById('missed-checkout-task-modal')?.remove();
        window.app_showSyncToast('Task updates saved.');
        if (window.app_refreshDashboard) await window.app_refreshDashboard();
    } catch (err) {
        console.error('Missed checkout task reconciliation failed:', err);
        alert('Failed to save task updates: ' + err.message);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Task Updates';
        }
    }
};

window.app_showSyncToast = (message = 'Status updated from another device.') => {
    const id = 'app-sync-toast';
    const old = document.getElementById(id);
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = id;
    el.style.position = 'fixed';
    el.style.top = '14px';
    el.style.right = '14px';
    el.style.zIndex = '10020';
    el.style.background = '#0f172a';
    el.style.color = '#f8fafc';
    el.style.padding = '0.7rem 0.9rem';
    el.style.borderRadius = '10px';
    el.style.fontSize = '0.82rem';
    el.style.fontWeight = '600';
    el.style.boxShadow = '0 8px 25px rgba(15, 23, 42, 0.3)';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => {
        const active = document.getElementById(id);
        if (active) active.remove();
    }, 2800);
};

const HOVER_HELP_SELECTOR = [
    'button',
    'a[href]',
    '[role="button"]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'label',
    '[tabindex]:not([tabindex="-1"])'
].join(', ');

const HOVER_HELP_PAGE_MESSAGES = Object.freeze({
    dashboard: 'Open the dashboard overview.',
    'team-activities': 'View recent team activity updates.',
    'staff-directory': 'Browse the staff directory.',
    policies: 'Read attendance and office policies.',
    'annual-plan': 'View the annual work plan.',
    'birthday-calendar': 'View or manage birthdays.',
    timesheet: 'Review attendance and work logs.',
    minutes: 'Open meeting notes and decisions.',
    admin: 'Open admin tools and reports.',
    'staff-ai-memory': 'Open the staff AI memory sheet.',
    'master-sheet': 'Review the attendance sheet.',
    salary: 'Open salary processing tools.',
    'policy-test': 'Open the policy test page.',
    widget: 'Open the compact widget view.',
    profile: 'Open your profile and settings.'
});

const HOVER_HELP_ACTIONS = [
    { pattern: /notification/i, message: 'Open notification history.' },
    { pattern: /toggle sidebar|menu/i, message: 'Show or hide the sidebar menu.' },
    { pattern: /sign out|logout/i, message: 'Sign out of the app.' },
    { pattern: /check[\s-]?in/i, message: 'Mark your check-in for the day.' },
    { pattern: /check[\s-]?out/i, message: 'Mark your check-out for the day.' },
    { pattern: /save/i, message: 'Save your changes.' },
    { pattern: /edit/i, message: 'Edit this item.' },
    { pattern: /delete|remove|trash/i, message: 'Remove this item.' },
    { pattern: /close|cancel/i, message: 'Close this panel.' },
    { pattern: /search/i, message: 'Search the current records.' },
    { pattern: /filter/i, message: 'Filter the current list.' },
    { pattern: /export|download/i, message: 'Export this data.' },
    { pattern: /approve/i, message: 'Approve this request.' },
    { pattern: /reject/i, message: 'Reject this request.' },
    { pattern: /message|chat/i, message: 'Open a message window.' },
    { pattern: /view|details|info/i, message: 'View more details.' },
    { pattern: /\bnext\b/i, message: 'Go to the next page.' },
    { pattern: /\bprev\b|\bprevious\b/i, message: 'Go to the previous page.' },
    { pattern: /add|new|create/i, message: 'Add a new item.' },
    { pattern: /submit/i, message: 'Submit this form.' },
    { pattern: /refresh|update/i, message: 'Check for the latest updates.' },
    { pattern: /\btoday\b/i, message: 'Jump to today.' }
];

let hoverHelpTooltipEl = null;
let hoverHelpActiveTarget = null;
let hoverHelpHideTimer = null;

const cleanHoverHelpText = (text = '') => {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .replace(/\s*[\r\n]+\s*/g, ' ')
        .replace(/[|•]+/g, ' ')
        .trim();
};

const toHoverHelpSentence = (text, prefix) => {
    const cleaned = cleanHoverHelpText(text).replace(/[.:!?]+$/, '');
    if (!cleaned) return '';
    const normalized = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
    return `${prefix} ${normalized}.`;
};

const getHoverHelpTextContent = (element) => {
    if (!element) return '';
    return cleanHoverHelpText(
        element.getAttribute?.('data-hover-help')
        || element.getAttribute?.('aria-label')
        || element.getAttribute?.('title')
        || element.innerText
        || element.textContent
        || ''
    );
};

const getHoverHelpFieldLabel = (element) => {
    if (!element) return '';

    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
        const combined = labelledBy
            .split(/\s+/)
            .map(id => document.getElementById(id))
            .filter(Boolean)
            .map(node => cleanHoverHelpText(node.textContent))
            .filter(Boolean)
            .join(' ');
        if (combined) return combined;
    }

    if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        const labelText = cleanHoverHelpText(label?.textContent || '');
        if (labelText) return labelText;
    }

    const wrappingLabel = element.closest('label');
    return cleanHoverHelpText(wrappingLabel?.textContent || '');
};

const getHoverHelpFieldMessage = (element) => {
    const labelText = getHoverHelpFieldLabel(element)
        || cleanHoverHelpText(element.getAttribute('placeholder') || '');
    const lowerLabel = labelText.replace(/[.:!?]+$/, '').trim().toLowerCase();

    if (element.matches('input[type="search"], [type="search"]')) {
        return lowerLabel ? `Search ${lowerLabel}.` : 'Search the current records.';
    }
    if (element.matches('input[type="date"]')) {
        return lowerLabel ? `Choose ${lowerLabel}.` : 'Choose a date.';
    }
    if (element.matches('input[type="time"]')) {
        return lowerLabel ? `Choose ${lowerLabel}.` : 'Choose a time.';
    }
    if (element.matches('input[type="checkbox"], input[type="radio"]')) {
        return lowerLabel ? `Select ${lowerLabel}.` : 'Select this option.';
    }
    if (element.tagName === 'SELECT') {
        return lowerLabel ? `Choose ${lowerLabel}.` : 'Choose an option.';
    }
    if (element.tagName === 'TEXTAREA') {
        return lowerLabel ? `Write ${lowerLabel}.` : 'Write your notes here.';
    }
    return lowerLabel ? `Enter ${lowerLabel}.` : 'Enter a value here.';
};

const getHoverHelpActionMessage = (text) => {
    const cleaned = cleanHoverHelpText(text);
    if (!cleaned) return '';
    const match = HOVER_HELP_ACTIONS.find(entry => entry.pattern.test(cleaned));
    return match ? match.message : '';
};

const getHoverHelpMessage = (element) => {
    if (!element || element.matches('[disabled], [aria-hidden="true"]')) return '';

    const explicit = cleanHoverHelpText(
        element.getAttribute('data-hover-help')
        || element.getAttribute('data-tooltip')
        || element.getAttribute('aria-description')
    );
    if (explicit) return explicit.endsWith('.') ? explicit : `${explicit}.`;

    const pageKey = cleanHoverHelpText(element.getAttribute('data-page') || '').toLowerCase();
    if (pageKey && HOVER_HELP_PAGE_MESSAGES[pageKey]) {
        return HOVER_HELP_PAGE_MESSAGES[pageKey];
    }

    if (element.matches('input:not([type="hidden"]), select, textarea')) {
        return getHoverHelpFieldMessage(element);
    }

    const text = getHoverHelpTextContent(element);
    const actionMessage = getHoverHelpActionMessage(text);
    if (actionMessage) return actionMessage;

    if (element.matches('a[href]') && text) {
        return toHoverHelpSentence(text, 'Open');
    }
    if (element.matches('button, [role="button"], label')) {
        if (text) return toHoverHelpSentence(text, 'Use');
        return 'Use this control.';
    }

    return text ? `${text.replace(/[.:!?]+$/, '')}.` : '';
};

const ensureHoverHelpTooltip = () => {
    if (hoverHelpTooltipEl) return hoverHelpTooltipEl;
    const el = document.createElement('div');
    el.id = 'app-hover-help-tooltip';
    el.className = 'app-hover-help-tooltip';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
    hoverHelpTooltipEl = el;
    return el;
};

const clearHoverHelpHideTimer = () => {
    if (!hoverHelpHideTimer) return;
    clearTimeout(hoverHelpHideTimer);
    hoverHelpHideTimer = null;
};

const restoreNativeTitle = (element) => {
    if (!element?.dataset?.hoverHelpNativeTitle) return;
    element.setAttribute('title', element.dataset.hoverHelpNativeTitle);
    delete element.dataset.hoverHelpNativeTitle;
};

const positionHoverHelpTooltip = (originEvent = null, target = hoverHelpActiveTarget) => {
    if (!hoverHelpTooltipEl || !target) return;

    const margin = 16;
    let left = margin;
    let top = margin;

    if (originEvent?.clientX != null && originEvent?.clientY != null) {
        left = originEvent.clientX - (hoverHelpTooltipEl.offsetWidth / 2);
        top = originEvent.clientY + 14;
    } else {
        const rect = target.getBoundingClientRect();
        left = rect.left + ((rect.width - hoverHelpTooltipEl.offsetWidth) / 2);
        top = rect.bottom + 14;
    }

    const tooltipRect = hoverHelpTooltipEl.getBoundingClientRect();
    if (left + tooltipRect.width > window.innerWidth - margin) {
        left = window.innerWidth - tooltipRect.width - margin;
    }
    if (top + tooltipRect.height > window.innerHeight - margin) {
        top = window.innerHeight - tooltipRect.height - margin;
    }
    if (top < margin) top = margin;
    if (left < margin) left = margin;

    hoverHelpTooltipEl.style.left = `${left}px`;
    hoverHelpTooltipEl.style.top = `${top}px`;
};

const hideHoverHelpTooltip = () => {
    clearHoverHelpHideTimer();
    restoreNativeTitle(hoverHelpActiveTarget);
    hoverHelpActiveTarget = null;
    if (!hoverHelpTooltipEl) return;
    hoverHelpTooltipEl.classList.remove('is-visible');
    hoverHelpTooltipEl.textContent = '';
};

const showHoverHelpTooltip = (target, originEvent = null) => {
    const message = getHoverHelpMessage(target);
    if (!message) {
        hideHoverHelpTooltip();
        return;
    }

    clearHoverHelpHideTimer();

    if (hoverHelpActiveTarget && hoverHelpActiveTarget !== target) {
        restoreNativeTitle(hoverHelpActiveTarget);
    }

    hoverHelpActiveTarget = target;
    const tooltip = ensureHoverHelpTooltip();
    if (tooltip.textContent !== message) {
        tooltip.textContent = message;
    }
    if (!tooltip.classList.contains('is-visible')) {
        tooltip.classList.add('is-visible');
    }

    if (target.hasAttribute('title') && !target.dataset.hoverHelpNativeTitle) {
        target.dataset.hoverHelpNativeTitle = target.getAttribute('title') || '';
        target.removeAttribute('title');
    }

    positionHoverHelpTooltip(originEvent, target);
};

const _initHoverHelp = () => {
    if (window.__appHoverHelpInitialized) return;
    window.__appHoverHelpInitialized = true;

    document.addEventListener('mouseover', (event) => {
        const source = event.target instanceof Element ? event.target : event.target?.parentElement;
        const target = source?.closest(HOVER_HELP_SELECTOR);
        if (!target || !document.body.contains(target)) return;
        if (target === hoverHelpActiveTarget) {
            clearHoverHelpHideTimer();
            positionHoverHelpTooltip(event, target);
            return;
        }
        showHoverHelpTooltip(target, event);
    });

    document.addEventListener('mousemove', (event) => {
        if (!hoverHelpActiveTarget) return;
        positionHoverHelpTooltip(event);
    });

    document.addEventListener('mouseout', (event) => {
        if (!hoverHelpActiveTarget) return;
        const source = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (source && !hoverHelpActiveTarget.contains(source) && source !== hoverHelpActiveTarget) return;
        const nextTarget = event.relatedTarget instanceof Element ? event.relatedTarget : null;
        if (nextTarget && hoverHelpActiveTarget.contains(nextTarget)) return;
        if (nextTarget && nextTarget.closest?.(HOVER_HELP_SELECTOR) === hoverHelpActiveTarget) return;
        clearHoverHelpHideTimer();
        hoverHelpHideTimer = setTimeout(() => {
            hideHoverHelpTooltip();
        }, 70);
    });

    document.addEventListener('focusin', (event) => {
        const source = event.target instanceof Element ? event.target : event.target?.parentElement;
        const target = source?.closest(HOVER_HELP_SELECTOR);
        if (!target) return;
        showHoverHelpTooltip(target);
    });

    document.addEventListener('focusout', () => {
        hideHoverHelpTooltip();
    });

    window.addEventListener('scroll', () => {
        if (!hoverHelpActiveTarget) return;
        positionHoverHelpTooltip(null, hoverHelpActiveTarget);
    }, true);

    window.addEventListener('resize', () => {
        if (!hoverHelpActiveTarget) return;
        positionHoverHelpTooltip(null, hoverHelpActiveTarget);
    });
};

const PAGE_USAGE_NOTES = Object.freeze({
    'team-activities': {
        title: 'How To Use This Page',
        why: 'This page helps you review what the team has been working on, track progress, and spot overdue or blocked work in one place.',
        how: 'Use the filters to narrow by date, type, status, or staff member. Open the records to review details, compare activity across people, and move through pages when the list is long.'
    },
    'staff-directory': {
        title: 'How To Use This Page',
        why: 'This page is for staff communication and quick follow-up. It keeps person-to-person messages and task discussions organized by staff member.',
        how: 'Choose a staff member from the list, read the conversation history, then send a message or review assigned tasks. Return here whenever you need to continue a discussion with someone on the team.'
    },
    policies: {
        title: 'How To Use This Page',
        why: 'This page explains attendance rules, holidays, working hours, and policy settings so everyone follows the same process.',
        how: 'Read the sections before taking action on attendance, leave, or office timing questions. Admin users can update policy values here, while staff should use it as the main reference page.'
    },
    'annual-plan': {
        title: 'How To Use This Page',
        why: 'This page gives a year-wide view of planned work so you can understand schedules, deadlines, and major activities across the calendar.',
        how: 'Switch between views, filter by staff, search the list, and jump to important dates. Open a day when you want to inspect or plan work for that specific date.'
    },
    'birthday-calendar': {
        title: 'How To Use This Page',
        why: 'This page keeps birthday records organized so the team can manage celebrations and maintain correct staff details.',
        how: 'Review upcoming birthdays, add missing entries, or update existing records when details change. Use it as the central place for birthday-related staff information.'
    },
    'staff-ai-memory': {
        title: 'How To Use This Page',
        why: 'This page shows the curated AI memory for one staff member at a time together with the report narration assistant.',
        how: 'Pick a staff member if you have staff-management access, review the generated memory, and use the narration panel to summarize the current source scope. Staff without management access will only see their own memory.'
    },
    timesheet: {
        title: 'How To Use This Page',
        why: 'This page is for checking attendance history, work duration, and day-by-day time records.',
        how: 'Use the available filters or date controls to inspect your logs, verify hours, and open details when something looks incorrect. It is the best page to review your past attendance entries.'
    },
    profile: {
        title: 'How To Use This Page',
        why: 'This page shows your personal staff profile, attendance summary, and leave-related information in one place.',
        how: 'Use it to review your details, check your current status, and look at summary numbers for attendance and leave. Admin users can also switch between staff profiles when needed.'
    },
    minutes: {
        title: 'How To Use This Page',
        why: 'This page is for recording meeting discussions, decisions, action items, and approvals so nothing important is lost after a meeting.',
        how: 'Create a meeting record, write the discussion summary, add action items with owners, and review approval or edit history. Use search to quickly find older meetings.'
    },
    admin: {
        title: 'How To Use This Page',
        why: 'This page gives administrators control over reports, staff management, attendance monitoring, and approval workflows.',
        how: 'Use the filters and admin tools to inspect records, approve requests, review trends, and take corrective actions. Changes here can affect multiple users, so review entries carefully before saving.'
    },
    'master-sheet': {
        title: 'How To Use This Page',
        why: 'This page provides a sheet-style attendance view so you can inspect staff presence, absences, holidays, and exceptions across many dates at once.',
        how: 'Scan rows and columns to compare attendance patterns quickly. Admin users can open cells for detailed review or corrections where needed.'
    },
    salary: {
        title: 'How To Use This Page',
        why: 'This page supports salary preparation by combining attendance-based calculations and payroll-related values in one working area.',
        how: 'Review staff rows carefully, check attendance-driven inputs, and update values before final processing. Use it when payroll needs to be prepared from attendance data.'
    },
    'policy-test': {
        title: 'How To Use This Page',
        why: 'This page helps verify whether policy logic and rules are behaving as expected before relying on them in day-to-day use.',
        how: 'Run the available checks, compare outcomes, and confirm that policy behavior matches the intended rules. It is mainly for validation and troubleshooting.'
    }
});

const createPageUsageNoteMarkup = (pageKey) => {
    const note = PAGE_USAGE_NOTES[pageKey];
    if (!note) return '';
    const title = escapeDialogHtml(note.title || 'How To Use This Page');
    const why = escapeDialogHtml(note.why || '');
    const how = escapeDialogHtml(note.how || '');
    return `
        <section class="page-usage-note" id="page-usage-note" data-page-key="${escapeDialogHtml(pageKey)}" aria-label="Page help note">
            <div class="page-usage-note-header">
                <i class="fa-solid fa-circle-info"></i>
                <h3>${title}</h3>
            </div>
            <p><strong>Why this page exists:</strong> ${why}</p>
            <p><strong>How to use it:</strong> ${how}</p>
        </section>
    `;
};

const applyPageUsageNote = () => {
    const host = document.getElementById('page-content');
    if (!host) return;

    const pageKey = String(window.location.hash || '').replace(/^#/, '') || 'dashboard';
    const existing = host.querySelector('#page-usage-note');

    if (pageKey === 'dashboard') {
        existing?.remove();
        return;
    }

    const markup = createPageUsageNoteMarkup(pageKey);
    if (!markup) {
        existing?.remove();
        return;
    }

    if (existing?.dataset.pageKey === pageKey) return;

    existing?.remove();
    host.insertAdjacentHTML('beforeend', markup);
};

const initPageUsageNotes = () => {
    if (window.__appPageUsageNotesInitialized) return;
    window.__appPageUsageNotesInitialized = true;

    const bindObserver = () => {
        const host = document.getElementById('page-content');
        if (!host || host.__pageUsageObserverBound) return;

        const observer = new MutationObserver(() => {
            if (host.dataset.applyingUsageNote === '1') return;
            host.dataset.applyingUsageNote = '1';
            try {
                applyPageUsageNote();
            } finally {
                delete host.dataset.applyingUsageNote;
            }
        });

        observer.observe(host, { childList: true });
        host.__pageUsageObserverBound = true;
        applyPageUsageNote();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindObserver, { once: true });
    } else {
        bindObserver();
    }

    window.addEventListener('hashchange', () => {
        requestAnimationFrame(() => {
            applyPageUsageNote();
        });
    });
};

const shouldShowCrossDeviceToast = () => {
    return !attendanceActionInFlight && Date.now() > suppressSyncToastUntil;
};

const markLocalAttendanceMutation = () => {
    suppressSyncToastUntil = Date.now() + 3500;
};

const handleUserSyncEvent = (ev) => {
    const syncedUser = ev.detail;
    if (!syncedUser) return;
    if (window.app_refreshNotificationBell) {
        window.app_refreshNotificationBell().catch(() => { });
    }

    const nextStatus = syncedUser.status || 'out';
    const statusChanged = lastSyncedAttendanceStatus !== null && nextStatus !== lastSyncedAttendanceStatus;

    // Always consider it a change if it's the first sync and we are 'in'
    const isFirstSyncChange = lastSyncedAttendanceStatus === null && nextStatus === 'in';

    lastSyncedAttendanceStatus = nextStatus;

    if (!(statusChanged || isFirstSyncChange) || userSyncRenderLock) return;

    const isDashboard = !window.location.hash || window.location.hash === '#dashboard';
    const checkoutModal = document.getElementById('checkout-modal');
    const isCheckoutOpen = !!(checkoutModal && checkoutModal.style.display === 'flex');

    if (nextStatus === 'out' && isCheckoutOpen) {
        checkoutModal.style.display = 'none';
    }

    if (!isDashboard) {
        if (shouldShowCrossDeviceToast()) window.app_showSyncToast('Status updated from another device.');
        return;
    }

    userSyncRenderLock = true;
    (async () => {
        try {
            const page = document.getElementById('page-content');
            if (page) {
                page.innerHTML = await AppUI.renderDashboard();
                if (window.setupDashboardEvents) window.setupDashboardEvents();
            }
            if (shouldShowCrossDeviceToast()) window.app_showSyncToast('Status updated from another device.');
        } catch (err) {
            console.warn('Realtime dashboard sync failed:', err);
        } finally {
            userSyncRenderLock = false;
        }
    })();
};

const reconcileCurrentUserAttendanceState = async () => {
    if (!window.AppAuth?.refreshCurrentUserFromDB) return;
    try {
        const latestUser = await window.AppAuth.refreshCurrentUserFromDB();
        if (!latestUser) return;
        window.dispatchEvent(new CustomEvent('app:user-sync', { detail: latestUser }));
    } catch (err) {
        console.warn('Current user attendance reconciliation failed:', err);
    }
};

const handleVisibilityAttendanceReconcile = () => {
    if (document.visibilityState !== 'visible') return;
    void reconcileCurrentUserAttendanceState();
};

window.app_reconcileCurrentUserAttendanceState = reconcileCurrentUserAttendanceState;
window.addEventListener('focus', () => {
    void reconcileCurrentUserAttendanceState();
});
document.addEventListener('visibilitychange', handleVisibilityAttendanceReconcile);

function toggleMobileSidebar(show) {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
        if (show) {
            sidebar.classList.add('open');
            overlay.classList.add('active');
        } else {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        }
    }
}

function cleanURL() {
    if (window.location.search) {
        const clean = window.location.protocol + "//" + window.location.host + window.location.pathname + window.location.hash;
        window.history.replaceState({ path: clean }, '', clean);
        console.log("Address bar cleaned of query parameters.");
    }
}

window.app_toggleSidebar = (forceCollapse = null) => {
    const sidebar = document.querySelector('.sidebar');
    const icon = document.querySelector('#desktop-sidebar-toggle i');
    if (!sidebar) return;

    const isCollapsing = forceCollapse !== null ? forceCollapse : !sidebar.classList.contains('collapsed');

    if (isCollapsing) {
        sidebar.classList.add('collapsed');
        if (icon) {
            icon.classList.remove('fa-angles-left');
            icon.classList.add('fa-angles-right');
        }
    } else {
        sidebar.classList.remove('collapsed');
        if (icon) {
            icon.classList.remove('fa-angles-right');
            icon.classList.add('fa-angles-left');
        }
    }
};

// Modal Helper to avoid overwriting modal-container
window.app_showModal = (html, id) => {
    const container = document.getElementById('modal-container');
    if (!container) return;
    // Remove existing modal with same ID if any
    const existing = document.getElementById(id);
    if (existing) existing.remove();

    container.insertAdjacentHTML('beforeend', html);
    const modalEl = document.getElementById(id);
    if (modalEl && (modalEl.classList.contains('modal-overlay') || modalEl.classList.contains('modal'))) {
        const overlays = Array.from(document.querySelectorAll('.modal-overlay, .modal'))
            .filter(el => el !== modalEl);
        const maxZ = overlays.reduce((acc, el) => {
            const z = Number.parseInt(window.getComputedStyle(el).zIndex, 10);
            return Number.isFinite(z) ? Math.max(acc, z) : acc;
        }, 1000);
        modalEl.style.zIndex = String(maxZ + 2);
    }
};

window.app_renderCarryForwardIssues = function (sortKey = 'date-desc') {
    const issues = Array.isArray(window.app_carryForwardIssues) ? window.app_carryForwardIssues : [];
    const maxRows = 200;
    const safeSortKey = String(sortKey || 'date-desc');

    const sorted = [...issues].sort((a, b) => {
        if (safeSortKey === 'date-asc') return String(a.planDate || '').localeCompare(String(b.planDate || ''));
        if (safeSortKey === 'owner-asc') return String(a.planUserName || '').localeCompare(String(b.planUserName || '')) || String(b.planDate || '').localeCompare(String(a.planDate || ''));
        if (safeSortKey === 'owner-desc') return String(b.planUserName || '').localeCompare(String(a.planUserName || '')) || String(b.planDate || '').localeCompare(String(a.planDate || ''));
        if (safeSortKey === 'origin-asc') return String(a.originDate || '').localeCompare(String(b.originDate || ''));
        if (safeSortKey === 'origin-desc') return String(b.originDate || '').localeCompare(String(a.originDate || ''));
        return String(b.planDate || '').localeCompare(String(a.planDate || ''));
    });

    const rows = sorted.slice(0, maxRows).map((issue) => {
        const flags = [
            issue.ownerMismatch ? 'Owner mismatch' : '',
            issue.assignedMismatch ? 'Assigned mismatch' : '',
            issue.isAutoForwarded ? 'Auto-forwarded' : ''
        ].filter(Boolean).join(', ') || '—';
        return `
            <tr>
                <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">${app_escapeHtml(issue.planDate || '')}</td>
                <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">${app_escapeHtml(issue.planUserName || issue.planUserId || '')}</td>
                <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">${app_escapeHtml(issue.taskText || '')}</td>
                <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">${app_escapeHtml(issue.originDate || '')}</td>
                <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">${app_escapeHtml(issue.rootToken || '')}</td>
                <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">${app_escapeHtml(flags)}</td>
            </tr>
        `;
    }).join('');

    const summaryNote = issues.length > maxRows
        ? `<div style="font-size:0.8rem; color:#94a3b8;">Showing first ${maxRows} of ${issues.length} items.</div>`
        : `<div style="font-size:0.8rem; color:#94a3b8;">Total items: ${issues.length}.</div>`;

    const html = `
        <div class="modal-overlay" id="carryforward-issues-modal" style="display:flex;">
            <div class="modal-content" style="max-width:960px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem;">
                    <h3 style="margin:0;">Auto-Forward Issues</h3>
                    <button type="button" onclick="window.app_closeModal(this)" class="day-plan-close-btn" title="Close">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div style="font-size:0.85rem; color:#64748b; margin-bottom:0.6rem;">
                    These are carry-forward tasks that look assigned to the wrong staff or plan owner.
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:0.6rem; align-items:center; margin-bottom:0.6rem;">
                    <label style="font-size:0.8rem; color:#64748b;">Sort by</label>
                    <select id="carryforward-issues-sort" class="app-select" style="padding:6px 8px; border-radius:8px; border:1px solid #e2e8f0;">
                        <option value="date-desc" ${safeSortKey === 'date-desc' ? 'selected' : ''}>Date (Newest)</option>
                        <option value="date-asc" ${safeSortKey === 'date-asc' ? 'selected' : ''}>Date (Oldest)</option>
                        <option value="owner-asc" ${safeSortKey === 'owner-asc' ? 'selected' : ''}>Owner (A-Z)</option>
                        <option value="owner-desc" ${safeSortKey === 'owner-desc' ? 'selected' : ''}>Owner (Z-A)</option>
                        <option value="origin-desc" ${safeSortKey === 'origin-desc' ? 'selected' : ''}>Origin (Newest)</option>
                        <option value="origin-asc" ${safeSortKey === 'origin-asc' ? 'selected' : ''}>Origin (Oldest)</option>
                    </select>
                    <button type="button" class="action-btn danger" onclick="window.app_removeCarryForwardIssues && window.app_removeCarryForwardIssues()">
                        <i class="fa-solid fa-trash"></i> Delete All Listed
                    </button>
                </div>
                ${summaryNote}
                <div style="margin-top:0.6rem; border:1px solid #e2e8f0; border-radius:10px; overflow:auto; max-height:60vh;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
                        <thead style="background:#f8fafc; position:sticky; top:0;">
                            <tr>
                                <th style="text-align:left; padding:8px; border-bottom:1px solid #e2e8f0;">Date</th>
                                <th style="text-align:left; padding:8px; border-bottom:1px solid #e2e8f0;">Plan Owner</th>
                                <th style="text-align:left; padding:8px; border-bottom:1px solid #e2e8f0;">Task</th>
                                <th style="text-align:left; padding:8px; border-bottom:1px solid #e2e8f0;">Origin Date</th>
                                <th style="text-align:left; padding:8px; border-bottom:1px solid #e2e8f0;">Root Token</th>
                                <th style="text-align:left; padding:8px; border-bottom:1px solid #e2e8f0;">Flags</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    window.app_showModal(html, 'carryforward-issues-modal');

    const sortSelect = document.getElementById('carryforward-issues-sort');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            const value = e.target?.value || 'date-desc';
            window.app_renderCarryForwardIssues(value);
        }, { once: true });
    }
};

window.app_removeCarryForwardIssues = async function () {
    try {
        const issues = Array.isArray(window.app_carryForwardIssues) ? window.app_carryForwardIssues : [];
        if (!issues.length) {
            alert('No items to remove.');
            return;
        }
        const confirmText = `Remove ${issues.length} task(s) so they stop carrying forward?`;
        const approved = window.appConfirm
            ? await window.appConfirm(confirmText)
            : window.confirm(confirmText);
        if (!approved) return;
        if (!window.AppCalendar?.removeTask) {
            alert('Remove action is not available.');
            return;
        }
        let removed = 0;
        let skipped = 0;
        let failed = 0;
        const currentUser = window.AppAuth?.getUser ? window.AppAuth.getUser() : null;
        for (const issue of issues) {
            if (!issue.planId) {
                skipped += 1;
                continue;
            }
            try {
                const plan = await window.AppDB.get('work_plans', issue.planId);
                if (!plan || !Array.isArray(plan.plans) || plan.plans.length === 0) {
                    skipped += 1;
                    continue;
                }
                let targetIndex = -1;
                const rootToken = String(issue.rootToken || '').trim();
                if (rootToken) {
                    targetIndex = plan.plans.findIndex(t =>
                        t
                        && (String(t.carryForwardRootId || '') === rootToken
                            || String(t.carriedForwardFromPlanId || '') === rootToken
                            || String(t.sourcePlanId || '') === rootToken)
                    );
                }
                if (targetIndex < 0 && Number.isInteger(issue.taskIndex)) {
                    targetIndex = issue.taskIndex;
                }
                if (targetIndex < 0 || !plan.plans[targetIndex]) {
                    skipped += 1;
                    continue;
                }
                plan.plans[targetIndex] = {
                    ...plan.plans[targetIndex],
                    status: 'not-completed',
                    isRemoved: true,
                    removedAt: new Date().toISOString(),
                    removedBy: currentUser?.id || ''
                };
                plan.updatedAt = new Date().toISOString();
                await window.AppDB.put('work_plans', plan);
                removed += 1;
            } catch (err) {
                failed += 1;
                console.warn('Carry-forward remove failed', { issue, err });
            }
        }
        const summary = `Removed: ${removed}. Skipped: ${skipped}. Failed: ${failed}.`;
        if (window.app_showSyncToast) {
            window.app_showSyncToast(summary);
        } else {
            alert(summary);
        }
        const refreshed = window.AppCalendar?.findCarryForwardIssues
            ? await window.AppCalendar.findCarryForwardIssues({ includeAssignedMismatch: true })
            : [];
        window.app_carryForwardIssues = refreshed;
        if (!refreshed.length) {
            window.app_renderCarryForwardIssues('date-desc');
            return;
        }
        window.app_renderCarryForwardIssues('date-desc');
    } catch (err) {
        console.error('Bulk remove carry-forward issues failed:', err);
        alert('Failed to remove carry-forward issues.');
    }
};

window.app_findCarryForwardIssues = async function () {
    try {
        if (!window.AppCalendar?.findCarryForwardIssues) {
            alert('Carry-forward scan is not available in this build.');
            return;
        }
        const issues = await window.AppCalendar.findCarryForwardIssues({ includeAssignedMismatch: true });
        if (!issues.length) {
            alert('No auto-forwarded tasks assigned to other staff were found.');
            return;
        }
        window.app_carryForwardIssues = issues;
        window.app_renderCarryForwardIssues('date-desc');
    } catch (err) {
        console.error('Carry-forward scan failed:', err);
        alert('Failed to scan carry-forward tasks. Please try again.');
    }
};

const toSafeNotifStatus = (notif) => String(notif?.status || 'pending').toLowerCase();
const isPendingNotif = (notif) => {
    if (notif?.type === 'birthday-reminder') {
        return notif?.read !== true;
    }
    return toSafeNotifStatus(notif) === 'pending';
};

const isAutoSystemPostponedNotification = (notif) => {
    if (!notif) return false;
    if (notif.autoPostponed === true || notif.isAutoForwarded === true) return true;
    const type = String(notif.type || '').toLowerCase();
    if (type.includes('auto-forward') || type.includes('carry-forward') || type.includes('system-postponed')) return true;
    const hay = `${notif.title || ''} ${notif.message || ''} ${notif.description || ''}`.toLowerCase();
    return /postponed from|auto[- ]?forward|carried forward|carry forward|system postponed/.test(hay);
};

const getNotifSource = (notif) => {
    if (notif?.type === 'birthday-reminder') return 'Birthday';
    if (notif?.type === 'minute-access-request') return 'Minutes';
    if (String(notif?.type || '').includes('missed-checkout')) return 'Attendance';
    if (notif?.type === 'task') return 'Task';
    if (notif?.type === 'tag' || notif?.type === 'mention') return 'Tag';
    if (notif?.type === 'reminder') return 'Reminder';
    return 'Notification';
};

const canRespondToNotification = (notif) => {
    if (!notif) return false;
    if (notif.type === 'minute-access-request') return true;
    if (String(notif.type || '').includes('missed-checkout')) return true;
    return notif.type === 'tag' || notif.type === 'mention';
};

const getNotifPreview = (notif) => {
    return String(
        notif?.description
        || notif?.message
        || notif?.title
        || ''
    ).trim();
};

const getNotifTimeLabel = (notif) => {
    const raw = notif?.respondedAt || notif?.taggedAt || notif?.date;
    const ts = new Date(raw).getTime();
    if (!ts) return 'Unknown time';
    const diffMins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    const age = diffMins < 1
        ? 'just now'
        : diffMins < 60
            ? `${diffMins} mins ago`
            : diffMins < 1440
                ? `${Math.floor(diffMins / 60)} hrs ago`
                : `${Math.floor(diffMins / 1440)} days ago`;
    return `${new Date(ts).toLocaleString()} (${age})`;
};

window.app_refreshNotificationBell = async () => {
    const buttons = document.querySelectorAll('.top-notification-btn');
    if (!buttons.length) return;

    const user = window.AppAuth.getUser();
    const notificationsRaw = Array.isArray(user?.notifications) ? user.notifications : [];
    const notifications = notificationsRaw.filter(n => !isAutoSystemPostponedNotification(n));
    const pendingCount = notifications.filter(isPendingNotif).length;
    if (user && notifications.length !== notificationsRaw.length) {
        try {
            const updatedUser = await window.AppDB.get('users', user.id).catch(() => null);
            if (updatedUser && Array.isArray(updatedUser.notifications)) {
                updatedUser.notifications = updatedUser.notifications.filter(n => !isAutoSystemPostponedNotification(n));
                await window.AppDB.put('users', updatedUser);
                Object.assign(user, { notifications: updatedUser.notifications });
            }
        } catch (err) {
            console.warn('Failed to clean postponed notifications during bell refresh:', err);
        }
    }

    buttons.forEach((btn) => {
        const badge = btn.querySelector('.top-notification-badge');
        if (!user) {
            btn.classList.remove('has-pending');
            if (badge) badge.style.display = 'none';
            return;
        }
        btn.classList.toggle('has-pending', pendingCount > 0);
        btn.setAttribute('title', pendingCount > 0
            ? `${pendingCount} pending notification${pendingCount > 1 ? 's' : ''}`
            : 'Notification history');
        if (badge) {
            if (pendingCount > 0) {
                badge.textContent = pendingCount > 99 ? '99+' : String(pendingCount);
                badge.style.display = '';
            } else {
                badge.style.display = 'none';
            }
        }
    });
};

window.app_closeNotificationHistory = () => {
    const drawer = document.getElementById('notification-history-modal');
    const backdrop = document.getElementById('notif-drawer-backdrop');
    if (drawer) drawer.classList.remove('notif-drawer-open');
    if (backdrop) backdrop.classList.remove('notif-drawer-backdrop-visible');
    setTimeout(() => document.getElementById('notif-drawer-root')?.remove(), 320);
};

window.app_recordNotifError = (err, context = {}) => {
    try {
        const payload = {
            message: String(err?.message || err || 'Unknown error'),
            time: new Date().toISOString(),
            context
        };
        localStorage.setItem('notif_last_error', JSON.stringify(payload));
    } catch {
        // no-op
    }
};

window.app_showLastNotifError = () => {
    try {
        const raw = localStorage.getItem('notif_last_error');
        if (!raw) return;
        localStorage.removeItem('notif_last_error');
        const data = JSON.parse(raw);
        const html = `
            <div class="modal-overlay" id="notif-error-modal" style="display:flex;">
                <div class="modal-content" style="max-width:560px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem;">
                        <h3 style="margin:0;">Notification Error</h3>
                        <button type="button" onclick="window.app_closeModal(this)" class="day-plan-close-btn" title="Close">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div style="font-size:0.85rem; color:#64748b; margin-bottom:0.6rem;">
                        The last notification action failed. Details below:
                    </div>
                    <div style="background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:0.65rem; border-radius:8px; font-size:0.85rem;">
                        ${escapeDialogHtml(data?.message || 'Unknown error')}
                    </div>
                    <div style="margin-top:0.6rem; font-size:0.78rem; color:#64748b;">
                        Time: ${escapeDialogHtml(data?.time || '')}
                    </div>
                </div>
            </div>
        `;
        window.app_showModal(html, 'notif-error-modal');
    } catch {
        // no-op
    }
};

window.app_markNotificationResponded = async (notifId, notifIndex, response) => {
    const user = window.AppAuth.getUser();
    if (!user) return false;
    const updatedUser = await window.AppDB.get('users', user.id).catch(() => null);
    if (!updatedUser || !Array.isArray(updatedUser.notifications)) return false;
    let notif = null;
    if (Number.isInteger(notifIndex) && notifIndex >= 0 && updatedUser.notifications[notifIndex]) {
        notif = updatedUser.notifications[notifIndex];
    } else if (notifId) {
        notif = updatedUser.notifications.find(n => String(n.id || '') === String(notifId));
    }
    if (!notif) return false;
    const nowIso = new Date().toISOString();
    notif.status = response;
    notif.respondedAt = nowIso;
    notif.read = true;
    notif.dismissedAt = nowIso;
    await window.AppDB.put('users', updatedUser);
    await window.app_refreshNotificationBell?.();
    return true;
};

window.app_respondNotificationFromHistory = async (notifIndex, notifId, action) => {
    const currentUser = window.AppAuth.getUser();
    if (!currentUser) return;

    const decision = action === 'approve' ? 'approve' : 'reject';
    const freshUser = await window.AppDB.get('users', currentUser.id);
    if (!freshUser || !Array.isArray(freshUser.notifications)) {
        alert('Notification not found.');
        return;
    }

    let notif = null;
    let resolvedIndex = -1;
    if (Number.isInteger(notifIndex) && notifIndex >= 0 && freshUser.notifications[notifIndex]) {
        notif = freshUser.notifications[notifIndex];
        resolvedIndex = notifIndex;
    }
    if (!notif && notifId) {
        resolvedIndex = freshUser.notifications.findIndex(n => String(n.id) === String(notifId));
        if (resolvedIndex >= 0) notif = freshUser.notifications[resolvedIndex];
    }
    if (!notif) {
        alert('This notification is no longer available.');
        return;
    }
    if (!isPendingNotif(notif)) {
        alert('This notification has already been responded.');
        await window.app_refreshNotificationBell();
        return;
    }

    window.app_closeNotificationHistory();

    try {
        if (notif.type === 'minute-access-request' && window.app_hasPerm('minutes', 'admin', currentUser)) {
            await window.app_reviewMinuteAccessFromNotification(resolvedIndex, notif.id, decision === 'approve' ? 'approved' : 'rejected');
            return;
        }
        if (notif.type === 'missed-checkout-reason' && (currentUser.isAdmin || currentUser.role === 'Administrator')) {
            await window.app_reviewMissedCheckoutReasonFromNotification(resolvedIndex, notif.id, decision === 'approve' ? 'approved' : 'rejected');
            return;
        }

        const taskIndex = Number(notif.taskIndex);
        if (notif.planId && Number.isInteger(taskIndex) && taskIndex >= 0) {
            await window.app_handleTagResponse(notif.planId, taskIndex, decision === 'approve' ? 'accepted' : 'rejected', resolvedIndex);
            return;
        }

        if (notif.id) {
            await window.app_handleTagDecision(notif.id, decision === 'approve' ? 'accepted' : 'rejected');
            return;
        }

        const fallbackUpdated = await window.app_markNotificationResponded(notif.id, resolvedIndex, decision === 'approve' ? 'accepted' : 'rejected');
        if (!fallbackUpdated) {
            alert('This notification cannot be approved or rejected from history.');
        }
    } catch (err) {
        console.error('Notification response error:', err);
        window.app_recordNotifError(err, { notifId: notif?.id || '', action: decision });
        const fallbackUpdated = await window.app_markNotificationResponded(notif?.id, resolvedIndex, decision === 'approve' ? 'accepted' : 'rejected');
        if (fallbackUpdated) {
            alert('Action recorded in notifications, but the full workflow failed. Please refresh.');
            return;
        }
        alert('Failed to process notification: ' + err.message);
    }
};

window.app_openNotificationHistory = async () => {
    const currentUser = window.AppAuth.getUser();
    if (!currentUser) return;

    const freshUser = await window.AppDB.get('users', currentUser.id).catch(() => currentUser);
    const notificationsRaw = Array.isArray(freshUser?.notifications) ? freshUser.notifications : [];
    const cleanedNotifications = notificationsRaw.filter(n => !isAutoSystemPostponedNotification(n));
    if (cleanedNotifications.length !== notificationsRaw.length && freshUser) {
        try {
            freshUser.notifications = cleanedNotifications;
            await window.AppDB.put('users', freshUser);
            if (window.AppAuth?.getUser) Object.assign(window.AppAuth.getUser(), { notifications: cleanedNotifications });
            if (window.app_refreshNotificationBell) await window.app_refreshNotificationBell();
        } catch (err) {
            console.warn('Failed to clean postponed notifications:', err);
        }
    }
    const notifications = cleanedNotifications;
    const tagHistory = Array.isArray(freshUser?.tagHistory) ? freshUser.tagHistory : [];
    const isAdmin = currentUser.isAdmin || currentUser.role === 'Administrator';

    const rows = [
        ...notifications.map((n, index) => ({ ...n, _source: 'live', _index: index })),
        ...tagHistory.map((h) => ({ ...h, _source: 'history', _index: -1 }))
    ];

    const getNotifTimeMs = (notif) => new Date(notif.respondedAt || notif.taggedAt || notif.date || 0).getTime() || 0;
    const normalizeText = (value) => String(value || '').trim().toLowerCase();
    const availableSources = Array.from(new Set(rows.map(r => getNotifSource(r)))).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const sourceOptionsHtml = ['<option value="all">All Sources</option>', ...availableSources.map(src => `<option value="${escapeDialogHtml(src.toLowerCase())}">${escapeDialogHtml(src)}</option>`)].join('');

    const drawerState = {
        search: '',
        status: 'all',
        source: 'all',
        sort: 'newest'
    };

    const renderRow = (row) => {
        const status = toSafeNotifStatus(row);
        const isPending = status === 'pending' && row._source === 'live';
        const source = getNotifSource(row);
        const sender = row.taggedByName || 'System';
        const title = row.title || `${source} from ${sender}`;
        const summary = getNotifPreview(row);
        const notifIdArg = app_escapeJsSingleQuote(String(row.id || ''));
        const statusColors = {
            pending: { bg: '#fff7ed', border: '#fdba74', badge: '#f97316' },
            accepted: { bg: '#f0fdf4', border: '#86efac', badge: '#16a34a' },
            rejected: { bg: '#fef2f2', border: '#fca5a5', badge: '#dc2626' },
            default: { bg: '#f8fafc', border: '#e2e8f0', badge: '#6b7280' }
        };
        const colors = statusColors[status] || statusColors.default;

        const approveRejectBtns = ((isPending && canRespondToNotification(row)) || (isAdmin && row.type === 'minute-access-request')) ? `
            <div class="notif-drawer-actions">
                <button type="button" class="notif-drawer-btn approve" onclick="window.app_respondNotificationFromHistory(${Number(row._index)}, '${notifIdArg}', 'approve')">
                    <i class="fa-solid fa-check"></i> Approve
                </button>
                <button type="button" class="notif-drawer-btn reject" onclick="window.app_respondNotificationFromHistory(${Number(row._index)}, '${notifIdArg}', 'reject')">
                    <i class="fa-solid fa-xmark"></i> Reject
                </button>
            </div>` : '';

        return `
            <div class="notif-drawer-item ${isPending ? 'is-pending' : ''}" style="border-color:${colors.border}; background:${colors.bg};" data-notif-id="${escapeDialogHtml(String(row.id || ''))}">
                <div class="notif-drawer-item-head">
                    <div class="notif-drawer-item-left">
                        <div class="notif-drawer-source-icon">
                            <i class="fa-solid ${row.type === 'tag' || row.type === 'mention'
                                ? 'fa-at'
                                : row.type === 'birthday-reminder'
                                    ? 'fa-cake-candles'
                                : row.type === 'task'
                                    ? 'fa-list-check'
                                    : row.type === 'minute-access-request'
                                        ? 'fa-file-lines'
                                        : String(row.type || '').includes('missed-checkout')
                                            ? 'fa-user-clock'
                                            : 'fa-bell'}"></i>
                        </div>
                        <div>
                            <div class="notif-drawer-title">${escapeDialogHtml(title)}</div>
                            <div class="notif-drawer-meta">${escapeDialogHtml(source)} • ${escapeDialogHtml(sender)} • ${escapeDialogHtml(getNotifTimeLabel(row))}</div>
                        </div>
                    </div>
                    <div class="notif-drawer-item-right">
                        <span class="notif-drawer-badge" style="background:${colors.badge}">${escapeDialogHtml(status)}</span>
                    </div>
                </div>
                ${summary ? `<div class="notif-drawer-text">${escapeDialogHtml(summary)}</div>` : ''}
                ${approveRejectBtns}
            </div>`;
    };

    const getFilteredRows = () => {
        const filtered = rows.filter((row) => {
            const status = toSafeNotifStatus(row);
            const source = getNotifSource(row);
            const sender = row.taggedByName || 'System';
            const title = row.title || `${source} from ${sender}`;
            const summary = getNotifPreview(row);
            const searchBlob = `${title} ${summary} ${source} ${sender} ${status}`;

            if (drawerState.status !== 'all' && status !== drawerState.status) return false;
            if (drawerState.source !== 'all' && normalizeText(source) !== drawerState.source) return false;
            if (drawerState.search && !normalizeText(searchBlob).includes(drawerState.search)) return false;
            return true;
        });

        if (drawerState.sort === 'oldest') {
            filtered.sort((a, b) => getNotifTimeMs(a) - getNotifTimeMs(b));
        } else if (drawerState.sort === 'pending') {
            filtered.sort((a, b) => {
                const pendingA = isPendingNotif(a) ? 1 : 0;
                const pendingB = isPendingNotif(b) ? 1 : 0;
                if (pendingA !== pendingB) return pendingB - pendingA;
                return getNotifTimeMs(b) - getNotifTimeMs(a);
            });
        } else {
            filtered.sort((a, b) => getNotifTimeMs(b) - getNotifTimeMs(a));
        }

        return filtered;
    };

    const unreadCount = notifications.filter(isPendingNotif).length;

    const html = `
        <div class="notif-drawer-backdrop" id="notif-drawer-backdrop" onclick="window.app_closeNotificationHistory()"></div>
        <div class="notif-drawer" id="notification-history-modal">
            <div class="notif-drawer-header">
                <div class="notif-drawer-header-left">
                    <i class="fa-solid fa-bell notif-drawer-header-icon"></i>
                    <div>
                        <div class="notif-drawer-header-title">Notifications</div>
                        <div class="notif-drawer-header-sub">${unreadCount > 0 ? `${unreadCount} pending action${unreadCount > 1 ? 's' : ''}` : 'All caught up'}</div>
                    </div>
                </div>
            </div>
            <div class="notif-drawer-tools">
                <div class="notif-drawer-search-wrap">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="search" id="notif-drawer-search" class="notif-drawer-search-input" placeholder="Search title, sender, message">
                </div>
                <div class="notif-drawer-controls">
                    <div class="notif-drawer-status-tabs" id="notif-drawer-status-tabs">
                        <button type="button" class="notif-drawer-status-tab is-active" data-notif-status="all">All</button>
                        <button type="button" class="notif-drawer-status-tab" data-notif-status="pending">Pending</button>
                        <button type="button" class="notif-drawer-status-tab" data-notif-status="accepted">Accepted</button>
                        <button type="button" class="notif-drawer-status-tab" data-notif-status="rejected">Rejected</button>
                    </div>
                    <div class="notif-drawer-selects">
                        <select id="notif-drawer-source">${sourceOptionsHtml}</select>
                        <select id="notif-drawer-sort">
                            <option value="newest">Newest First</option>
                            <option value="oldest">Oldest First</option>
                            <option value="pending">Pending First</option>
                        </select>
                    </div>
                </div>
                <div class="notif-drawer-results" id="notif-drawer-results"></div>
            </div>
            <div class="notif-drawer-list" id="notif-drawer-list"></div>
        </div>`;

    // Inject into body (not modal-container) so it can slide in from the right
    const wrapper = document.createElement('div');
    wrapper.id = 'notif-drawer-root';
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);
    // Trigger slide-in animation
    requestAnimationFrame(() => {
        const drawer = document.getElementById('notification-history-modal');
        if (drawer) drawer.classList.add('notif-drawer-open');
        const backdrop = document.getElementById('notif-drawer-backdrop');
        if (backdrop) backdrop.classList.add('notif-drawer-backdrop-visible');
    });

    const listEl = document.getElementById('notif-drawer-list');
    const resultsEl = document.getElementById('notif-drawer-results');
    const searchEl = document.getElementById('notif-drawer-search');
    const sourceEl = document.getElementById('notif-drawer-source');
    const sortEl = document.getElementById('notif-drawer-sort');
    const tabsEl = document.getElementById('notif-drawer-status-tabs');

    const renderFilteredList = () => {
        if (!listEl) return;
        const filteredRows = getFilteredRows();
        listEl.innerHTML = filteredRows.length
            ? filteredRows.map(renderRow).join('')
            : `<div class="notif-drawer-empty"><i class="fa-regular fa-bell-slash"></i><p>No notifications match your search/filter.</p></div>`;

        if (resultsEl) {
            resultsEl.textContent = `Showing ${filteredRows.length} of ${rows.length}`;
        }
    };

    searchEl?.addEventListener('input', (event) => {
        drawerState.search = normalizeText(event.target.value);
        renderFilteredList();
    });

    sourceEl?.addEventListener('change', (event) => {
        drawerState.source = normalizeText(event.target.value) || 'all';
        renderFilteredList();
    });

    sortEl?.addEventListener('change', (event) => {
        drawerState.sort = normalizeText(event.target.value) || 'newest';
        renderFilteredList();
    });

    tabsEl?.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-notif-status]');
        if (!btn) return;
        drawerState.status = normalizeText(btn.getAttribute('data-notif-status')) || 'all';
        tabsEl.querySelectorAll('.notif-drawer-status-tab').forEach(tab => tab.classList.remove('is-active'));
        btn.classList.add('is-active');
        renderFilteredList();
    });

    renderFilteredList();

    await window.app_refreshNotificationBell();
};

window.app_openBirthdayEditor = async (userId) => {
    const currentUser = window.AppAuth?.getUser?.();
    if (!window.app_canAdminBirthdays(currentUser)) {
        alert('You do not have permission to manage birthdays.');
        return;
    }
    const user = await window.AppDB.get('users', userId);
    if (!user) {
        alert('Staff member not found.');
        return;
    }
    const html = `
        <div class="modal-overlay" id="birthday-details-modal" style="display:flex;">
            <div class="modal-content" style="max-width:560px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; margin-bottom:1rem;">
                    <div>
                        <div style="font-size:0.78rem; font-weight:800; color:#9a3412; text-transform:uppercase; letter-spacing:0.08em;">Birthday Details</div>
                        <h3 style="margin:0.35rem 0 0.2rem 0;">${escapeDialogHtml(user.name || 'Staff')}</h3>
                        <div style="font-size:0.84rem; color:#64748b;">${escapeDialogHtml(user.role || 'Employee')} • ${escapeDialogHtml(user.dept || 'General')}</div>
                    </div>
                    <button type="button" onclick="document.getElementById('birthday-details-modal')?.remove()" style="background:none; border:none; font-size:1.25rem; cursor:pointer;">&times;</button>
                </div>
                <form id="birthday-details-form">
                    <input type="hidden" name="userId" value="${escapeDialogHtml(user.id)}">
                    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:0.75rem;">
                        <label>
                            <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Day</span>
                            <input type="number" name="birthDay" min="1" max="31" placeholder="DD" value="${escapeDialogHtml(user.birthDay || '')}" style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                        </label>
                        <label>
                            <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Month</span>
                            <input type="number" name="birthMonth" min="1" max="12" placeholder="MM" value="${escapeDialogHtml(user.birthMonth || '')}" style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                        </label>
                        <label>
                            <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Year</span>
                            <input type="number" name="birthYear" min="1900" max="2100" placeholder="YYYY" value="${escapeDialogHtml(user.birthYear || '')}" style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                        </label>
                    </div>
                    <div style="margin-top:0.65rem; font-size:0.8rem; color:#64748b;">Save one field, two fields, or all three. Reminders need day and month.</div>
                    <div style="display:flex; justify-content:flex-end; gap:0.75rem; margin-top:1.2rem;">
                        <button type="button" class="action-btn secondary" onclick="document.getElementById('birthday-details-modal')?.remove()">Cancel</button>
                        <button type="submit" class="action-btn">Save Birthday</button>
                    </div>
                </form>
            </div>
        </div>`;
    window.app_showModal(html, 'birthday-details-modal');
};

window.app_submitBirthdayDetails = async (event) => {
    event.preventDefault();
    const currentUser = window.AppAuth?.getUser?.();
    if (!window.app_canAdminBirthdays(currentUser)) {
        alert('You do not have permission to manage birthdays.');
        return;
    }
    const formData = new FormData(event.target);
    const userId = String(formData.get('userId') || '').trim();
    if (!userId) {
        alert('Missing staff record.');
        return;
    }
    try {
        const birthdayFields = app_extractBirthdayFields(formData);
        const existing = await window.AppDB.get('users', userId);
        if (!existing) throw new Error('Staff member not found.');
        const success = await window.AppAuth.updateUser({
            id: userId,
            birthDay: birthdayFields.birthDay,
            birthMonth: birthdayFields.birthMonth,
            birthYear: birthdayFields.birthYear
        });
        if (!success) throw new Error('Unable to save birthday details.');
        document.getElementById('birthday-details-modal')?.remove();
        window.app_showSyncToast(`Birthday details saved for ${existing.name || 'staff member'}.`);
        if ((window.location.hash.slice(1) || 'dashboard') === 'birthday-calendar') {
            const page = document.getElementById('page-content');
            if (page) page.innerHTML = await AppUI.renderBirthdayCalendar();
        } else if (window.app_refreshAdminPage) {
            await window.app_refreshAdminPage();
        }
    } catch (err) {
        alert(`Failed to save birthday details: ${err.message}`);
    }
};

window.app_submitBirthdayMonthForm = async (event, month) => {
    event.preventDefault();
    const currentUser = window.AppAuth?.getUser?.();
    if (!window.app_canAdminBirthdays(currentUser)) {
        alert('You do not have permission to manage birthdays.');
        return;
    }

    const targetMonth = Number(month || 0);
    if (!targetMonth || targetMonth < 1 || targetMonth > 12) {
        alert('Invalid birthday month.');
        return;
    }

    const formData = new FormData(event.target);
    const userId = String(formData.get('userId') || '').trim();
    if (!userId) {
        alert('Please select a staff member.');
        return;
    }

    try {
        const birthdayFields = app_extractBirthdayFields(formData);
        const existing = await window.AppDB.get('users', userId);
        if (!existing) throw new Error('Staff member not found.');

        const updatePayload = {
            id: userId,
            birthMonth: targetMonth,
            birthDay: birthdayFields.birthDay,
            birthYear: birthdayFields.birthYear
        };

        const success = await window.AppAuth.updateUser(updatePayload);
        if (!success) throw new Error('Unable to save birthday details.');

        event.target.reset();
        const page = document.getElementById('page-content');
        if (page) page.innerHTML = await AppUI.renderBirthdayCalendar();
        window.app_showSyncToast(`Birthday updated for ${existing.name || 'staff member'}.`);
    } catch (err) {
        alert(`Failed to save birthday details: ${err.message}`);
    }
};

window.app_syncBirthdayReminders = async () => {
    const currentUser = window.AppAuth?.getUser?.();
    if (!window.app_canManageBirthdays(currentUser)) return;

    const today = app_getISTNowDate();
    today.setHours(0, 0, 0, 0);
    const todayKey = app_toDateKey(today);
    const syncCacheKey = `birthday_sync_${String(currentUser?.id || 'unknown')}`;

    if (window._birthdaySyncDoneForKey === syncCacheKey && window._birthdaySyncDayKey === todayKey) {
        return;
    }
    try {
        if (localStorage.getItem(syncCacheKey) === todayKey) {
            window._birthdaySyncDoneForKey = syncCacheKey;
            window._birthdaySyncDayKey = todayKey;
            return;
        }
    } catch {
        // Ignore storage access issues and continue with sync.
    }

    const allUsers = await window.AppDB.getAll('users').catch(() => []);
    if (!Array.isArray(allUsers) || !allUsers.length) return;

    const recipients = allUsers.filter((user) => window.app_canManageBirthdays(user));
    if (!recipients.length) return;

    let currentUserNotifications = Array.isArray(currentUser?.notifications) ? [...currentUser.notifications] : [];

    for (const staff of allUsers) {
        const birthdayDate = app_getBirthdayOccurrence(staff, today);
        if (!birthdayDate) continue;
        const reminderDate = app_getPreviousWorkingDay(birthdayDate);
        const reminderKey = app_toDateKey(reminderDate);
        if (reminderKey !== todayKey) continue;

        const birthdayKey = app_toDateKey(birthdayDate);
        const reminderReason = app_getBirthdayReminderReason(birthdayDate, reminderDate);
        const title = `Upcoming Staff Birthday: ${staff.name || 'Staff'}`;
        const message = `${staff.name || 'Staff'} has a birthday on ${app_formatBirthdayDate(staff.birthDay, staff.birthMonth)}.`;

        for (const recipient of recipients) {
            const notifications = Array.isArray(recipient.notifications) ? [...recipient.notifications] : [];
            const exists = notifications.some((notif) =>
                notif?.type === 'birthday-reminder'
                && String(notif.birthdayStaffId || '') === String(staff.id || '')
                && String(notif.birthdayDate || '') === birthdayKey
                && String(notif.reminderDate || '') === reminderKey
            );
            if (exists) continue;

            notifications.unshift({
                id: `birthday_${birthdayKey}_${staff.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                type: 'birthday-reminder',
                title,
                message,
                description: `${reminderReason}. ${staff.role || 'Employee'} • ${staff.dept || 'General'}`,
                status: 'pending',
                date: new Date().toISOString(),
                read: false,
                taggedByName: 'Birthday Calendar',
                birthdayStaffId: staff.id,
                birthdayStaffName: staff.name || 'Staff',
                birthdayDate: birthdayKey,
                reminderDate: reminderKey,
                birthdayDisplay: app_formatBirthdayDate(staff.birthDay, staff.birthMonth, staff.birthYear),
                birthdayReason: reminderReason,
                role: staff.role || '',
                dept: staff.dept || ''
            });

            await window.AppDB.put('users', {
                ...recipient,
                notifications
            });

            if (currentUser && String(currentUser.id) === String(recipient.id)) {
                currentUserNotifications = notifications;
            }
        }
    }

    if (currentUser && Array.isArray(currentUserNotifications)) {
        currentUser.notifications = currentUserNotifications;
    }

    window._birthdaySyncDoneForKey = syncCacheKey;
    window._birthdaySyncDayKey = todayKey;
    try {
        localStorage.setItem(syncCacheKey, todayKey);
    } catch {
        // Ignore storage write issues.
    }
};

window.app_dismissBirthdayPopup = async ({ openCalendar = false } = {}) => {
    const currentUser = window.AppAuth?.getUser?.();
    if (!currentUser) return;
    const freshUser = await window.AppDB.get('users', currentUser.id).catch(() => currentUser);
    if (!freshUser || !Array.isArray(freshUser.notifications)) return;

    let changed = false;
    freshUser.notifications = freshUser.notifications.map((notif) => {
        if (notif?.type === 'birthday-reminder' && notif?.read !== true) {
            changed = true;
            return {
                ...notif,
                read: true,
                status: 'seen',
                dismissedAt: new Date().toISOString()
            };
        }
        return notif;
    });

    if (changed) {
        await window.AppAuth.updateUser(freshUser);
    }
    document.getElementById('birthday-reminder-modal')?.remove();
    if (window.app_refreshNotificationBell) {
        await window.app_refreshNotificationBell();
    }
    if (openCalendar) {
        window.location.hash = 'birthday-calendar';
    }
};

window.app_maybeOpenBirthdayPopup = async () => {
    const currentUser = window.AppAuth?.getUser?.();
    if (!window.app_canManageBirthdays(currentUser)) return;
    if (document.getElementById('birthday-reminder-modal')) return;

    const freshUser = await window.AppDB.get('users', currentUser.id).catch(() => currentUser);
    const birthdayRows = Array.isArray(freshUser?.notifications)
        ? freshUser.notifications.filter((notif) => notif?.type === 'birthday-reminder' && notif?.read !== true)
        : [];
    if (!birthdayRows.length) return;

    const cards = birthdayRows.map((notif) => `
        <div style="border:1px solid #fed7aa; background:linear-gradient(135deg, #fff7ed, #fffbeb); border-radius:16px; padding:1rem;">
            <div style="display:flex; justify-content:space-between; gap:0.75rem; align-items:flex-start;">
                <div>
                    <div style="font-size:0.78rem; font-weight:800; color:#9a3412; text-transform:uppercase; letter-spacing:0.08em;">Upcoming Staff Birthday</div>
                    <h4 style="margin:0.35rem 0 0.2rem 0; color:#7c2d12;">${escapeDialogHtml(notif.birthdayStaffName || 'Staff')}</h4>
                    <div style="font-size:0.84rem; color:#9a3412;">${escapeDialogHtml(notif.birthdayDisplay || notif.birthdayDate || '')}</div>
                    <div style="font-size:0.8rem; color:#7c2d12; margin-top:0.35rem;">${escapeDialogHtml(notif.birthdayReason || 'Upcoming birthday')}</div>
                    <div style="font-size:0.8rem; color:#92400e; margin-top:0.25rem;">${escapeDialogHtml(notif.role || 'Employee')} • ${escapeDialogHtml(notif.dept || 'General')}</div>
                </div>
                <button type="button" class="action-btn secondary" style="padding:0.45rem 0.7rem;" onclick="window.app_openBirthdayEditor('${escapeDialogHtml(notif.birthdayStaffId || '')}')">Edit Birthday Details</button>
            </div>
        </div>
    `).join('');

    const html = `
        <div class="modal-overlay" id="birthday-reminder-modal" style="display:flex;">
            <div class="modal-content" style="max-width:720px; border-radius:22px; padding:0; overflow:hidden;">
                <div style="padding:1.35rem 1.4rem; background:linear-gradient(135deg, #9a3412, #f97316); color:#fff;">
                    <div style="display:flex; justify-content:space-between; gap:1rem; align-items:flex-start;">
                        <div>
                            <div style="font-size:0.78rem; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; opacity:0.9;">Birthday Reminder</div>
                            <h3 style="margin:0.35rem 0 0.2rem 0;">Staff birthdays are coming up</h3>
                            <p style="margin:0; opacity:0.92;">Review the upcoming birthdays and update any missing details before the next working day.</p>
                        </div>
                        <button type="button" onclick="window.app_dismissBirthdayPopup()" style="background:none; border:none; color:#fff; font-size:1.3rem; cursor:pointer;">&times;</button>
                    </div>
                </div>
                <div style="padding:1.2rem 1.4rem; display:flex; flex-direction:column; gap:0.85rem; max-height:60vh; overflow:auto;">
                    ${cards}
                </div>
                <div style="display:flex; justify-content:flex-end; gap:0.75rem; padding:1rem 1.4rem 1.3rem; border-top:1px solid #e5e7eb; background:#fff;">
                    <button type="button" class="action-btn secondary" onclick="window.app_dismissBirthdayPopup()">Dismiss</button>
                    <button type="button" class="action-btn" onclick="window.app_dismissBirthdayPopup({ openCalendar: true })">View Birthday Calendar</button>
                </div>
            </div>
        </div>`;
    window.app_showModal(html, 'birthday-reminder-modal');
};

window.app_openBirthdayEditor = async (sourceOrId, maybeId) => {
    const currentUser = window.AppAuth?.getUser?.();
    if (!window.app_canAdminBirthdays(currentUser)) {
        alert('You do not have permission to manage birthdays.');
        return;
    }
    const source = maybeId ? sourceOrId : 'user';
    const recordId = maybeId || sourceOrId;
    const config = app_getBirthdaySourceConfig(source);
    const record = await window.AppDB.get(config.collection, recordId);
    if (!record) {
        alert(config.emptyMessage);
        return;
    }
    const editorMeta = app_getBirthdayEditorMeta(record, config.source);
    const extraFields = config.source === 'external' ? `
                    <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:0.75rem; margin-bottom:0.75rem;">
                        <label>
                            <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Name</span>
                            <input type="text" name="name" value="${escapeDialogHtml(record.name || '')}" placeholder="Full name" style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                        </label>
                        <label>
                            <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Position</span>
                            <input type="text" name="position" value="${escapeDialogHtml(record.position || '')}" placeholder="President / Trustee / etc." style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                        </label>
                    </div>
                    <label style="display:block; margin-bottom:0.75rem;">
                        <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Location</span>
                        <input type="text" name="location" value="${escapeDialogHtml(record.location || '')}" placeholder="City / Office / Campus" style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                    </label>
    ` : '';
    const html = `
        <div class="modal-overlay" id="birthday-details-modal" style="display:flex;">
            <div class="modal-content" style="max-width:560px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; margin-bottom:1rem;">
                    <div>
                        <div style="font-size:0.78rem; font-weight:800; color:#9a3412; text-transform:uppercase; letter-spacing:0.08em;">Birthday Details</div>
                        <h3 style="margin:0.35rem 0 0.2rem 0;">${escapeDialogHtml(editorMeta.title)}</h3>
                        <div style="font-size:0.84rem; color:#64748b;">${escapeDialogHtml(editorMeta.subtitle)}</div>
                    </div>
                    <button type="button" onclick="document.getElementById('birthday-details-modal')?.remove()" style="background:none; border:none; font-size:1.25rem; cursor:pointer;">&times;</button>
                </div>
                <form id="birthday-details-form">
                    <input type="hidden" name="birthdaySource" value="${escapeDialogHtml(config.source)}">
                    <input type="hidden" name="recordId" value="${escapeDialogHtml(record.id)}">
                    ${extraFields}
                    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:0.75rem;">
                        <label>
                            <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Day</span>
                            <input type="number" name="birthDay" min="1" max="31" placeholder="DD" value="${escapeDialogHtml(record.birthDay || '')}" style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                        </label>
                        <label>
                            <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Month</span>
                            <input type="number" name="birthMonth" min="1" max="12" placeholder="MM" value="${escapeDialogHtml(record.birthMonth || '')}" style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                        </label>
                        <label>
                            <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Year</span>
                            <input type="number" name="birthYear" min="1900" max="2100" placeholder="YYYY" value="${escapeDialogHtml(record.birthYear || '')}" style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                        </label>
                    </div>
                    <div style="margin-top:0.65rem; font-size:0.8rem; color:#64748b;">Save one field, two fields, or all three. Reminders need day and month.</div>
                    <div style="display:flex; justify-content:flex-end; gap:0.75rem; margin-top:1.2rem;">
                        <button type="button" class="action-btn secondary" onclick="document.getElementById('birthday-details-modal')?.remove()">Cancel</button>
                        <button type="submit" class="action-btn">Save Birthday</button>
                    </div>
                </form>
            </div>
        </div>`;
    window.app_showModal(html, 'birthday-details-modal');
};

window.app_submitBirthdayDetails = async (event) => {
    event.preventDefault();
    const currentUser = window.AppAuth?.getUser?.();
    if (!window.app_canAdminBirthdays(currentUser)) {
        alert('You do not have permission to manage birthdays.');
        return;
    }
    const formData = new FormData(event.target);
    const source = String(formData.get('birthdaySource') || 'user').trim().toLowerCase();
    const recordId = String(formData.get('recordId') || '').trim();
    const config = app_getBirthdaySourceConfig(source);
    if (!recordId) {
        alert(`Missing ${config.label.toLowerCase()} record.`);
        return;
    }
    try {
        const birthdayFields = app_extractBirthdayFields(formData);
        const existing = await window.AppDB.get(config.collection, recordId);
        if (!existing) throw new Error(config.emptyMessage);
        if (config.source === 'external') {
            const name = String(formData.get('name') || '').trim();
            if (!name) throw new Error('Name is required.');
            await window.AppDB.put(config.collection, {
                ...existing,
                name,
                position: String(formData.get('position') || '').trim(),
                location: String(formData.get('location') || '').trim(),
                birthDay: birthdayFields.birthDay,
                birthMonth: birthdayFields.birthMonth,
                birthYear: birthdayFields.birthYear,
                updatedAt: new Date().toISOString(),
                updatedById: currentUser?.id || ''
            });
        } else {
            const success = await window.AppAuth.updateUser({
                id: recordId,
                birthDay: birthdayFields.birthDay,
                birthMonth: birthdayFields.birthMonth,
                birthYear: birthdayFields.birthYear
            });
            if (!success) throw new Error('Unable to save birthday details.');
        }
        document.getElementById('birthday-details-modal')?.remove();
        window.app_showSyncToast(`Birthday details saved for ${existing.name || config.label.toLowerCase()}.`);
        if ((window.location.hash.slice(1) || 'dashboard') === 'birthday-calendar') {
            const page = document.getElementById('page-content');
            if (page) page.innerHTML = await AppUI.renderBirthdayCalendar();
        } else if (window.app_refreshAdminPage) {
            await window.app_refreshAdminPage();
        }
    } catch (err) {
        alert(`Failed to save birthday details: ${err.message}`);
    }
};

window.app_openExternalBirthdayPersonModal = async (defaultMonth = '') => {
    const currentUser = window.AppAuth?.getUser?.();
    if (!window.app_canAdminBirthdays(currentUser)) {
        alert('You do not have permission to manage birthdays.');
        return;
    }
    const html = `
        <div class="modal-overlay" id="birthday-external-modal" style="display:flex;">
            <div class="modal-content" style="max-width:620px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; margin-bottom:1rem;">
                    <div>
                        <div style="font-size:0.78rem; font-weight:800; color:#9a3412; text-transform:uppercase; letter-spacing:0.08em;">Person Not In System</div>
                        <h3 style="margin:0.35rem 0 0.2rem 0;">Add Birthday Person</h3>
                        <div style="font-size:0.84rem; color:#64748b;">Save birthdays for trustees, president, or any other person who is not a staff account.</div>
                    </div>
                    <button type="button" onclick="document.getElementById('birthday-external-modal')?.remove()" style="background:none; border:none; font-size:1.25rem; cursor:pointer;">&times;</button>
                </div>
                <form id="birthday-external-form">
                    <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:0.75rem; margin-bottom:0.75rem;">
                        <label>
                            <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Name</span>
                            <input type="text" name="name" required placeholder="Full name" style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                        </label>
                        <label>
                            <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Position</span>
                            <input type="text" name="position" placeholder="President / Trustee / etc." style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                        </label>
                    </div>
                    <label style="display:block; margin-bottom:0.75rem;">
                        <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Location</span>
                        <input type="text" name="location" placeholder="City / Office / Campus" style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                    </label>
                    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:0.75rem;">
                        <label>
                            <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Day</span>
                            <input type="number" name="birthDay" min="1" max="31" placeholder="DD" style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                        </label>
                        <label>
                            <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Month</span>
                            <input type="number" name="birthMonth" min="1" max="12" placeholder="MM" value="${escapeDialogHtml(defaultMonth || '')}" style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                        </label>
                        <label>
                            <span style="display:block; font-size:0.78rem; color:#64748b; margin-bottom:0.25rem;">Year</span>
                            <input type="number" name="birthYear" min="1900" max="2100" placeholder="YYYY" style="width:100%; padding:0.65rem; border:1px solid #ddd; border-radius:8px;">
                        </label>
                    </div>
                    <div style="margin-top:0.65rem; font-size:0.8rem; color:#64748b;">Name is required. Day, month, and year can be saved separately.</div>
                    <div style="display:flex; justify-content:flex-end; gap:0.75rem; margin-top:1.2rem;">
                        <button type="button" class="action-btn secondary" onclick="document.getElementById('birthday-external-modal')?.remove()">Cancel</button>
                        <button type="submit" class="action-btn">Save Person</button>
                    </div>
                </form>
            </div>
        </div>`;
    window.app_showModal(html, 'birthday-external-modal');
};

window.app_submitExternalBirthdayPerson = async (event) => {
    event.preventDefault();
    const currentUser = window.AppAuth?.getUser?.();
    if (!window.app_canAdminBirthdays(currentUser)) {
        alert('You do not have permission to manage birthdays.');
        return;
    }
    const formData = new FormData(event.target);
    const name = String(formData.get('name') || '').trim();
    if (!name) {
        alert('Please enter a name.');
        return;
    }
    try {
        const birthdayFields = app_extractBirthdayFields(formData);
        const person = {
            id: `birthday_person_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name,
            position: String(formData.get('position') || '').trim(),
            location: String(formData.get('location') || '').trim(),
            birthDay: birthdayFields.birthDay,
            birthMonth: birthdayFields.birthMonth,
            birthYear: birthdayFields.birthYear,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdById: currentUser?.id || '',
            updatedById: currentUser?.id || ''
        };
        await window.AppDB.put('birthday_people', person);
        document.getElementById('birthday-external-modal')?.remove();
        const page = document.getElementById('page-content');
        if (page && (window.location.hash.slice(1) || 'dashboard') === 'birthday-calendar') {
            page.innerHTML = await AppUI.renderBirthdayCalendar();
        }
        window.app_showSyncToast(`Birthday person saved for ${name}.`);
    } catch (err) {
        alert(`Failed to save birthday person: ${err.message}`);
    }
};

window.app_refreshBirthdayCalendar = async () => {
    if ((window.location.hash.slice(1) || 'dashboard') !== 'birthday-calendar') return;
    const page = document.getElementById('page-content');
    if (page) page.innerHTML = await AppUI.renderBirthdayCalendar();
};

window.app_setBirthdayCalendarView = async (view) => {
    const state = window.app_birthdayCalendarState || {};
    window.app_birthdayCalendarState = {
        ...state,
        view: String(view || 'month').toLowerCase() === 'year' ? 'year' : 'month'
    };
    await window.app_refreshBirthdayCalendar();
};

window.app_goToBirthdayCalendarMonth = async (month, year = null) => {
    const targetMonth = Number(month || 0);
    if (!targetMonth || targetMonth < 1 || targetMonth > 12) return;
    const now = app_getISTNowDate();
    const state = window.app_birthdayCalendarState || {};
    window.app_birthdayCalendarState = {
        ...state,
        selectedMonth: targetMonth,
        selectedYear: Number(year || state.selectedYear || now.getFullYear()),
        view: 'month'
    };
    await window.app_refreshBirthdayCalendar();
};

window.app_changeBirthdayCalendarMonth = async (delta) => {
    const step = Number(delta || 0);
    if (!step) return;
    const now = app_getISTNowDate();
    const state = window.app_birthdayCalendarState || {};
    const selectedMonth = Number(state.selectedMonth || now.getMonth() + 1);
    const selectedYear = Number(state.selectedYear || now.getFullYear());
    const cursor = new Date(selectedYear, selectedMonth - 1 + step, 1);
    window.app_birthdayCalendarState = {
        ...state,
        selectedMonth: cursor.getMonth() + 1,
        selectedYear: cursor.getFullYear(),
        view: 'month'
    };
    await window.app_refreshBirthdayCalendar();
};

window.app_syncBirthdayReminders = async () => {
    const currentUser = window.AppAuth?.getUser?.();
    if (!window.app_canManageBirthdays(currentUser)) return;

    const [allUsers, externalPeople] = await Promise.all([
        window.AppDB.getAll('users').catch(() => []),
        window.AppDB.getAll('birthday_people', { silentPermissionDenied: true }).catch(() => [])
    ]);
    const birthdayEntries = [
        ...(Array.isArray(allUsers) ? allUsers.map((user) => ({ ...user, birthdaySource: 'user' })) : []),
        ...(Array.isArray(externalPeople) ? externalPeople.map((person) => ({ ...person, birthdaySource: 'external' })) : [])
    ];
    if (!birthdayEntries.length) return;

    const today = app_getISTNowDate();
    today.setHours(0, 0, 0, 0);
    const todayKey = app_toDateKey(today);
    const recipients = allUsers.filter((user) => window.app_canManageBirthdays(user));
    if (!recipients.length) return;

    let currentUserNotifications = Array.isArray(currentUser?.notifications) ? [...currentUser.notifications] : [];

    for (const entry of birthdayEntries) {
        const birthdayDate = app_getBirthdayOccurrence(entry, today);
        if (!birthdayDate) continue;
        const reminderDate = app_getPreviousWorkingDay(birthdayDate);
        const reminderKey = app_toDateKey(reminderDate);
        if (reminderKey !== todayKey) continue;

        const birthdayKey = app_toDateKey(birthdayDate);
        for (const recipient of recipients) {
            const notifications = Array.isArray(recipient.notifications) ? [...recipient.notifications] : [];
            const exists = notifications.some((notif) =>
                notif?.type === 'birthday-reminder'
                && String(notif.birthdayStaffId || '') === String(entry.id || '')
                && String(notif.birthdaySource || 'user') === String(entry.birthdaySource || 'user')
                && String(notif.birthdayDate || '') === birthdayKey
                && String(notif.reminderDate || '') === reminderKey
            );
            if (exists) continue;

            notifications.unshift(app_buildBirthdayReminderPayload(entry, entry.birthdaySource || 'user', birthdayDate, reminderDate));

            await window.AppDB.put('users', {
                ...recipient,
                notifications
            });

            if (currentUser && String(currentUser.id) === String(recipient.id)) {
                currentUserNotifications = notifications;
            }
        }
    }

    if (currentUser && Array.isArray(currentUserNotifications)) {
        currentUser.notifications = currentUserNotifications;
    }
};

window.app_maybeOpenBirthdayPopup = async () => {
    const currentUser = window.AppAuth?.getUser?.();
    if (!window.app_canManageBirthdays(currentUser)) return;
    if (document.getElementById('birthday-reminder-modal')) return;

    const freshUser = await window.AppDB.get('users', currentUser.id).catch(() => currentUser);
    const birthdayRows = Array.isArray(freshUser?.notifications)
        ? freshUser.notifications.filter((notif) => notif?.type === 'birthday-reminder' && notif?.read !== true)
        : [];
    if (!birthdayRows.length) return;

    const cards = birthdayRows.map((notif) => `
        <div style="border:1px solid #fed7aa; background:linear-gradient(135deg, #fff7ed, #fffbeb); border-radius:16px; padding:1rem;">
            <div style="display:flex; justify-content:space-between; gap:0.75rem; align-items:flex-start;">
                <div>
                    <div style="font-size:0.78rem; font-weight:800; color:#9a3412; text-transform:uppercase; letter-spacing:0.08em;">Upcoming Birthday</div>
                    <h4 style="margin:0.35rem 0 0.2rem 0; color:#7c2d12;">${escapeDialogHtml(notif.birthdayStaffName || 'Staff')}</h4>
                    <div style="font-size:0.84rem; color:#9a3412;">${escapeDialogHtml(notif.birthdayDisplay || notif.birthdayDate || '')}</div>
                    <div style="font-size:0.8rem; color:#7c2d12; margin-top:0.35rem;">${escapeDialogHtml(notif.birthdayReason || 'Upcoming birthday')}</div>
                    <div style="font-size:0.8rem; color:#92400e; margin-top:0.25rem;">${escapeDialogHtml(notif.role || 'Employee')} • ${escapeDialogHtml(notif.dept || 'General')}</div>
                </div>
                <button type="button" class="action-btn secondary" style="padding:0.45rem 0.7rem;" onclick="window.app_openBirthdayEditor('${escapeDialogHtml(notif.birthdaySource || 'user')}', '${escapeDialogHtml(notif.birthdayStaffId || '')}')">Edit Birthday Details</button>
            </div>
        </div>
    `).join('');

    const html = `
        <div class="modal-overlay" id="birthday-reminder-modal" style="display:flex;">
            <div class="modal-content" style="max-width:720px; border-radius:22px; padding:0; overflow:hidden;">
                <div style="padding:1.35rem 1.4rem; background:linear-gradient(135deg, #9a3412, #f97316); color:#fff;">
                    <div style="display:flex; justify-content:space-between; gap:1rem; align-items:flex-start;">
                        <div>
                            <div style="font-size:0.78rem; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; opacity:0.9;">Birthday Reminder</div>
                            <h3 style="margin:0.35rem 0 0.2rem 0;">Birthdays are coming up</h3>
                            <p style="margin:0; opacity:0.92;">Review the upcoming birthdays and update any missing details before the next working day.</p>
                        </div>
                        <button type="button" onclick="window.app_dismissBirthdayPopup()" style="background:none; border:none; color:#fff; font-size:1.3rem; cursor:pointer;">&times;</button>
                    </div>
                </div>
                <div style="padding:1.2rem 1.4rem; display:flex; flex-direction:column; gap:0.85rem; max-height:60vh; overflow:auto;">
                    ${cards}
                </div>
                <div style="display:flex; justify-content:flex-end; gap:0.75rem; padding:1rem 1.4rem 1.3rem; border-top:1px solid #e5e7eb; background:#fff;">
                    <button type="button" class="action-btn secondary" onclick="window.app_dismissBirthdayPopup()">Dismiss</button>
                    <button type="button" class="action-btn" onclick="window.app_dismissBirthdayPopup({ openCalendar: true })">View Birthday Calendar</button>
                </div>
            </div>
        </div>`;
    window.app_showModal(html, 'birthday-reminder-modal');
};



// Initialize Global App Logic
// --- Yearly Plan / Calendar Logic ---
window.app_canManageHolidays = (user = window.AppAuth?.getUser()) => {
    if (!user) return false;
    return !!(
        window.app_isAdminUser?.(user)
        || user.role === 'Administrator'
        || window.app_canManageAttendanceSheet?.(user)
    );
};

window.app_openEventModal = () => {
    const user = window.AppAuth?.getUser?.();
    if (!window.app_canManageHolidays(user)) {
        alert('Only admin and attendance admin can add holidays.');
        return;
    }
    const html = `
            <div class="modal-overlay" id="event-modal" style="display:flex;">
                <div class="modal-content">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                        <h3 style="font-size: 1.1rem;">Add Shared Event</h3>
                        <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:1.1rem; cursor:pointer;">&times;</button>
                    </div>
                    <form onsubmit="window.app_submitEvent(event)">
                        <div style="display:flex; flex-direction:column; gap:0.75rem;">
                            <div>
                                <label style="display:block; font-size:0.8rem; margin-bottom:0.2rem;">Event Title</label>
                                <input type="text" id="event-title" required style="width:100%; padding:0.6rem; border:1px solid #ddd; border-radius:8px; font-size:0.9rem;">
                            </div>
                            <div>
                                <label style="display:block; font-size:0.8rem; margin-bottom:0.2rem;">Date</label>
                                <input type="date" id="event-date" required style="width:100%; padding:0.6rem; border:1px solid #ddd; border-radius:8px; font-size:0.9rem;">
                            </div>
                            <div>
                                <label style="display:block; font-size:0.8rem; margin-bottom:0.2rem;">Type</label>
                                <select id="event-type" style="width:100%; padding:0.6rem; border:1px solid #ddd; border-radius:8px; font-size:0.9rem;">
                                    <option value="holiday">Holiday</option>
                                    <option value="meeting">Meeting</option>
                                    <option value="event">Other Event</option>
                                </select>
                            </div>
                            <button type="submit" class="action-btn" style="width:100%; margin-top:0.5rem; padding: 0.75rem;">Save Event</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    window.app_showModal(html, 'event-modal');
};

window.app_submitEvent = async (e) => {
    e.preventDefault();
    const user = window.AppAuth?.getUser?.();
    if (!window.app_canManageHolidays(user)) {
        alert('Only admin and attendance admin can add holidays.');
        return;
    }
    const title = document.getElementById('event-title').value;
    const date = document.getElementById('event-date').value;
    const type = document.getElementById('event-type').value;

    try {
        await window.AppCalendar.addEvent({ title, date, type });
        alert("Event added successfully!");
        document.getElementById('event-modal')?.remove();
        // Refresh Dashboard
        const contentArea = document.getElementById('page-content');
        contentArea.innerHTML = await AppUI.renderDashboard();
        setupDashboardEvents();
    } catch (err) {
        alert("Error: " + err.message);
    }
};

const APP_WORK_PLAN_SCHEMA_MIGRATION_FLAG = 'work_plan_schema_v2_migrated';

const app_migrateLegacyWorkPlanSchema = async () => {
    try {
        if (!window.AppDB || typeof window.AppDB.getAll !== 'function' || typeof window.AppDB.put !== 'function') return;
        if (localStorage.getItem(APP_WORK_PLAN_SCHEMA_MIGRATION_FLAG) === 'true') return;

        const plans = await window.AppDB.getAll('work_plans');
        let updated = 0;

        for (const plan of plans) {
            if (!plan || Array.isArray(plan.plans)) continue;
            const legacyTask = typeof plan.plan === 'string' ? plan.plan.trim() : '';
            if (!legacyTask) continue;

            const migrated = {
                ...plan,
                plans: [{
                    task: legacyTask,
                    subPlans: Array.isArray(plan.subPlans) ? plan.subPlans : [],
                    tags: Array.isArray(plan.tags) ? plan.tags : [],
                    status: plan.status || null,
                    completedDate: plan.completedDate || null,
                    startDate: plan.startDate || plan.date,
                    endDate: plan.endDate || plan.startDate || plan.date
                }]
            };

            delete migrated.plan;
            delete migrated.subPlans;
            delete migrated.tags;
            delete migrated.status;
            delete migrated.completedDate;
            delete migrated.startDate;
            delete migrated.endDate;

            await window.AppDB.put('work_plans', migrated);
            updated += 1;
        }

        localStorage.setItem(APP_WORK_PLAN_SCHEMA_MIGRATION_FLAG, 'true');
        if (updated > 0) {
            console.log(`Work plan schema migration complete. Updated: ${updated}`);
        }
    } catch (error) {
        console.warn('Work plan schema migration failed:', error);
    }
};
// --- Original Login/Auth Logic ---
async function init() {
    window.app_initTheme();
    initPageUsageNotes();
    cleanURL();
    window.addEventListener('app:user-sync', handleUserSyncEvent);
    window.addEventListener('app:update-available', applyUpdateCtaState);
    window.addEventListener('app:update-state', applyUpdateCtaState);
    document.addEventListener('visibilitychange', pingForVisibleUpdate);
    window.addEventListener('focus', pingForFocusedUpdate);
    window.addEventListener('online', pingForFocusedUpdate);
    try {
        await window.AppAuth.init();
        const initialUser = window.AppAuth.getUser();
        if (initialUser) {
            lastSyncedAttendanceStatus = initialUser.status || 'out';
            startReleaseSignalListener();
            startRoutineUpdateChecks();
            window.AppSiteAnnouncement?.start?.();
        }
        registerSW();

        await app_migrateLegacyWorkPlanSchema();
        await window.app_refreshBudgetHeadsCache();

        // Ensure Activity Command Listener starts even if not checked in
        if (window.AppActivity) window.AppActivity.initCommandListener();
    } catch (e) {
        console.error("Initialization Failed:", e);
        if (contentArea) contentArea.innerHTML = `<div style="text-align:center; padding:2rem; color:red;">Failed to load application.<br><small>${e.message}</small></div>`;
    }

    // Global Toggles
    document.addEventListener('click', (e) => {
        if (e.target.id === 'sidebar-toggle' || e.target.closest('#sidebar-toggle')) {
            toggleMobileSidebar(true);
        } else if (e.target.id === 'sidebar-overlay') {
            toggleMobileSidebar(false);
        }
    });

    try { if (typeof window.app_initSectionToggle === 'function') window.app_initSectionToggle(); } catch (err) { void err; }

    window.addEventListener('hashchange', router);
    if (window.AppUI?.initDashboardSectionPage) {
        window.AppUI.initDashboardSectionPage();
    }
    router();

    // Trigger Tour if applicable
    const currentUser = window.AppAuth.getUser();
    if (currentUser && window.AppTour) {
        window.AppTour.init(currentUser);
    }
}

// Router
async function router() {
    const user = window.AppAuth.getUser();
    const rawHash = window.location.hash.slice(1) || 'dashboard';
    const isDashboardSectionRoute = rawHash.startsWith('dashboard-section/');
    const dashboardSectionKey = isDashboardSectionRoute ? rawHash.split('/')[1] : '';
    const hash = isDashboardSectionRoute ? 'dashboard-section' : rawHash;

    // Cleanup
    if (hash !== 'admin' && adminListenerUnsubscribe && adminListenerUnsubscribe.length > 0) {
        console.log("Cleaning up Admin Realtime Listener.");
        adminListenerUnsubscribe.forEach(u => typeof u === 'function' && u());
        adminListenerUnsubscribe = [];
    }
    if (hash !== 'minutes' && typeof minutesListenerUnsubscribe === 'function') {
        console.log("Cleaning up Minutes Realtime Listener.");
        minutesListenerUnsubscribe();
        minutesListenerUnsubscribe = null;
    }

    // AUTH GUARD
    if (!user) {
        stopReleaseSignalListener();
        stopRoutineUpdateChecks();
        window.AppSiteAnnouncement?.stop?.();
        clearReleaseUpdateState(false);
        // Keep sidebar visible if the developer has explicitly enabled the
        // 'show hidden sheets' preference so tests that set this early can
        // validate visibility without requiring authentication.
        const hideShell = !((window.app_getShowHiddenSheets && window.app_getShowHiddenSheets()) || false);
        if (sidebar && hideShell) sidebar.style.display = 'none';
        if (mobileHeader && hideShell) mobileHeader.style.display = 'none';
        if (mobileNav && hideShell) mobileNav.style.display = 'none';
        document.body.style.background = '#f3f4f6';
        if (contentArea) {
            try {
                // Prefer AppUI.renderLogin if available, otherwise keep existing markup
                if (window.AppUI && typeof window.AppUI.renderLogin === 'function') {
                    contentArea.innerHTML = AppUI.renderLogin();
                }
            } catch (err) {
                // leave existing content in place
                console.warn('renderLogin failed during unauthenticated mount', err);
            }
        }
        if (window.app_refreshNotificationBell) {
            await window.app_refreshNotificationBell();
        }
        return;
    }
    startReleaseSignalListener();
    startRoutineUpdateChecks();
    window.AppSiteAnnouncement?.start?.();

    // LOGGED IN
    // Clear mobile specific states on route change
    toggleMobileSidebar(false);

    if (sidebar) sidebar.style.display = '';
    if (mobileHeader) mobileHeader.style.display = '';
    if (mobileNav) mobileNav.style.display = '';

    // Update Side Profile
    const sideProfile = document.querySelector('.sidebar-footer .user-mini-profile');
    if (sideProfile) {
        sideProfile.innerHTML = `
                <img src="${user.avatar || 'https://ui-avatars.com/api/?name=User'}" alt="User">
                <div>
                    <p class="user-name">${user.name || 'Staff Member'}</p>
                </div>
                <i class="fa-solid fa-gear user-settings-icon"></i>
            `;
    }

    // Admin Link logic (Granular)
    // Apply any persisted 'show hidden sheets' toggle before updating navigation
    try { window.app_applyShowHiddenSheetsToggle(); } catch (err) { void err; }
    window.app_updateNavigationSections(user);
    window.app_initSectionToggle();

    // Active Nav
    const navLinks = document.querySelectorAll('.nav-item, .mobile-nav-item');
    navLinks.forEach(link => {
        const shouldActivateDashboard = isDashboardSectionRoute && link.dataset.page === 'dashboard';
        if (link.dataset.page === hash || shouldActivateDashboard) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    // Content Rendering
    try {
        // Render Modals into the central container if not already present
        const modalContainer = document.getElementById('modal-container');
        if (modalContainer && !document.getElementById('checkout-modal')) {
            modalContainer.insertAdjacentHTML('beforeend', AppUI.renderModals());
        }

        // Hide all open modals (except checkout-modal) on route change
        if (modalContainer) {
            modalContainer.querySelectorAll('.modal-overlay:not(.gm-hidden)').forEach((m) => {
                if (m.id !== 'checkout-modal') {
                    m.style.display = 'none';
                    m.classList.add('gm-hidden');
                }
            });
        }

        // Show skeleton loading state immediately
        if (contentArea) {
            const { showPageSkeleton } = await import('./ui/page-skeletons.js');
            const skeleton = hash === 'dashboard'
                ? (await import('./ui/dashboard-skeletons.js')).renderDashboardSkeletons()
                : showPageSkeleton(hash);
            if (skeleton) {
                contentArea.innerHTML = skeleton;
            } else {
                contentArea.innerHTML = '<div class="loading-spinner"></div>';
            }
        }

        if (hash === 'dashboard') {
            contentArea.innerHTML = await AppUI.renderDashboard();
            setupDashboardEvents();
        } else if (hash === 'dashboard-section') {
            contentArea.innerHTML = await AppUI.renderDashboardSectionPage(dashboardSectionKey || 'worklog');
            if (window.AppUI?.initDashboardSectionPage) {
                window.AppUI.initDashboardSectionPage(dashboardSectionKey || 'worklog');
            }
        } else if (hash === 'team-activities') {
            contentArea.innerHTML = await AppUI.renderTeamActivitiesPage();
            if (window.app_initTeamActivities) {
                await window.app_initTeamActivities();
            }
        } else if (hash === 'staff-directory') {
            contentArea.innerHTML = await AppUI.renderStaffDirectoryPage();
        } else if (hash === 'policies') {
            if (window.AppPolicies && typeof window.AppPolicies.render === 'function') {
                contentArea.innerHTML = await window.AppPolicies.render();
            } else {
                contentArea.innerHTML = `<div style="padding:1rem; color:#b91c1c;">Policies module failed to load.</div>`;
            }
        } else if (hash === 'annual-plan') {
            contentArea.innerHTML = await AppUI.renderAnnualPlan();
        } else if (hash === 'birthday-calendar') {
            if (!window.app_canManageBirthdays(user)) {
                window.location.hash = 'dashboard';
                return;
            }
            contentArea.innerHTML = await AppUI.renderBirthdayCalendar();
        } else if (hash === 'timesheet') {
            contentArea.innerHTML = await AppUI.renderTimesheet();
        } else if (hash === 'profile') {
            contentArea.innerHTML = await AppUI.renderProfile();
        } else if (hash === 'salary') {
            if (!window.app_hasPerm('reports', 'view', user)) {
                window.location.hash = 'dashboard';
                return;
            }
            contentArea.innerHTML = await AppUI.renderSalaryProcessing ? await AppUI.renderSalaryProcessing() : await AppUI.renderSalary();
        } else if (hash === 'policy-test') {
            if (!window.app_hasPerm('policies', 'view', user)) {
                window.location.hash = 'dashboard';
                return;
            }
            contentArea.innerHTML = await AppUI.renderPolicyTest();
        } else if (hash === 'master-sheet') {
            const canViewAttendance = window.app_hasPerm('attendance', 'view', user) || window.app_canManageAttendanceSheet(user);
            if (!canViewAttendance) {
                window.location.hash = 'dashboard';
                return;
            }
            contentArea.innerHTML = await AppUI.renderMasterSheet();
        } else if (hash === 'minutes') {
            contentArea.innerHTML = await AppUI.renderMinutes();
            startMinutesRealtimeListener();
        } else if (hash === 'letter-pad') {
            if (!window.app_canAccessLetterPad(user)) {
                window.location.hash = 'dashboard';
                return;
            }
            contentArea.innerHTML = await AppUI.renderLetterPad();
        } else if (hash === 'admin') {
            if (!window.app_canSeeAdminPanel(user)) {
                window.location.hash = 'dashboard';
                return;
            }
            contentArea.innerHTML = await AppUI.renderAdmin();
            window.AppAnalytics.initAdminCharts();
            startAdminRealtimeListener();
        } else if (hash === 'staff-ai-memory') {
            if (!window.app_canAccessStaffAiMemory(user)) {
                window.location.hash = 'dashboard';
                return;
            }
            contentArea.innerHTML = await AppUI.renderStaffAiMemorySheet();
        }
        await window.app_syncBirthdayReminders?.();
        if (window.app_updateStaffNavIndicator) {
            await window.app_updateStaffNavIndicator();
        }
        if (window.app_refreshNotificationBell) {
            await window.app_refreshNotificationBell();
        }
        await window.app_maybeOpenBirthdayPopup?.();
    } catch (e) {
        console.error("Render Error:", e);
        contentArea.innerHTML = `<div style="text-align:center; color:red; padding:2rem;">Error loading page: ${e.message}</div>`;
    }
}

// --- Admin Realtime Listener ---
function startAdminRealtimeListener() {
    // Clear previous listeners
    adminListenerUnsubscribe.forEach(u => typeof u === 'function' && u());
    adminListenerUnsubscribe = [];

    console.log("Starting Admin Realtime Listeners (Users & Audits)...");

    let refreshTimer = null;
    let refreshInFlight = false;
    const userSnapshotCache = new Map();
    let userSnapshotPrimed = false;
    const locationAuditSnapshotCache = new Map();
    let locationAuditSnapshotPrimed = false;

    const buildUserSignature = (user) => JSON.stringify({
        id: String(user?.id || ''),
        status: String(user?.status || ''),
        role: String(user?.role || ''),
        isAdmin: user?.isAdmin === true,
        permissions: user?.permissions || null,
        name: String(user?.name || ''),
        username: String(user?.username || ''),
        email: String(user?.email || ''),
        rating: Number.isFinite(Number(user?.rating)) ? Number(user.rating) : null,
        completionStats: user?.completionStats || null,
        lastCheckIn: user?.lastCheckIn || null,
        lastCheckOut: user?.lastCheckOut || null,
        canManageAttendanceSheet: !!user?.canManageAttendanceSheet,
        canManageBirthdays: !!user?.canManageBirthdays,
        canAccessStaffAiMemory: !!user?.canAccessStaffAiMemory
    });

    const shouldRefreshFromUsers = (rows = []) => {
        const nextCache = new Map();
        let changed = false;

        for (const row of (Array.isArray(rows) ? rows : [])) {
            const id = String(row?.id || '').trim();
            if (!id) continue;
            const signature = buildUserSignature(row);
            nextCache.set(id, signature);
            if (!userSnapshotPrimed) continue;
            if (userSnapshotCache.get(id) !== signature) {
                changed = true;
            }
        }

        if (userSnapshotPrimed) {
            for (const id of userSnapshotCache.keys()) {
                if (!nextCache.has(id)) {
                    changed = true;
                    break;
                }
            }
        }

        userSnapshotCache.clear();
        for (const [id, signature] of nextCache.entries()) {
            userSnapshotCache.set(id, signature);
        }
        userSnapshotPrimed = true;
        return changed;
    };

    const shouldRefreshFromAudits = (rows = []) => {
        const nextCache = new Map();
        let changed = false;

        for (const row of (Array.isArray(rows) ? rows : [])) {
            const id = String(row?.id || '').trim();
            if (!id) continue;
            const signature = JSON.stringify({
                id,
                timestamp: row?.timestamp || null,
                userId: String(row?.userId || row?.user_id || ''),
                slot: String(row?.slot || ''),
                status: String(row?.status || ''),
                lat: row?.lat ?? null,
                lng: row?.lng ?? null
            });
            nextCache.set(id, signature);
            if (!locationAuditSnapshotPrimed) continue;
            if (locationAuditSnapshotCache.get(id) !== signature) {
                changed = true;
            }
        }

        if (locationAuditSnapshotPrimed) {
            for (const id of locationAuditSnapshotCache.keys()) {
                if (!nextCache.has(id)) {
                    changed = true;
                    break;
                }
            }
        }

        locationAuditSnapshotCache.clear();
        for (const [id, signature] of nextCache.entries()) {
            locationAuditSnapshotCache.set(id, signature);
        }
        locationAuditSnapshotPrimed = true;
        return changed;
    };

    const queueAdminRefresh = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
            refreshTimer = null;
            if (refreshInFlight) return;
            refreshInFlight = true;
            try {
                await refreshAdminUI();
            } finally {
                refreshInFlight = false;
            }
        }, 600);
    };

    const refreshAdminUI = async () => {
        const currentHash = window.location.hash.slice(1);
        if (currentHash !== 'admin') return;

        const openModal = document.querySelector('.modal-overlay[style*="display: flex"], .modal[style*="display: flex"]');
        if (!openModal) {
            console.log("Admin Data Update Received (Realtime) - Refreshing UI");
            const contentArea = document.getElementById('page-content');
            if (contentArea) {
                // PRESERVE FILTERS
                const startDate = document.getElementById('audit-start')?.value;
                const endDate = document.getElementById('audit-end')?.value;

                contentArea.innerHTML = await AppUI.renderAdmin(startDate, endDate);
                if (window.AppAnalytics) window.AppAnalytics.initAdminCharts();
            }
        } else {
            console.log("Admin Update received but skipped because a modal is open.");
        }
    };

    const flags = (AppConfig && AppConfig.READ_OPT_FLAGS) || {};
    if (flags.FF_READ_OPT_TARGETED_REALTIME && window.AppDB.listenQuery) {
        // Users listener kept for status/login/logout changes; heartbeat writes are disabled by config.
        adminListenerUnsubscribe.push(window.AppDB.listenQuery('users', [
            { field: 'status', operator: 'in', value: ['in', 'out'] }
        ], { limit: 300 }, (rows) => {
            if (shouldRefreshFromUsers(rows)) queueAdminRefresh();
        }));

        const since = new Date();
        since.setDate(since.getDate() - 2);
        adminListenerUnsubscribe.push(window.AppDB.listenQuery('location_audits', [
            { field: 'timestamp', operator: '>=', value: since.getTime() }
        ], { orderBy: [{ field: 'timestamp', direction: 'desc' }], limit: 300 }, (rows) => {
            if (shouldRefreshFromAudits(rows)) queueAdminRefresh();
        }));
    } else {
        // Legacy mode
        adminListenerUnsubscribe.push(window.AppDB.listen('users', (rows) => {
            if (shouldRefreshFromUsers(rows)) queueAdminRefresh();
        }));
        adminListenerUnsubscribe.push(window.AppDB.listen('location_audits', (rows) => {
            if (shouldRefreshFromAudits(rows)) queueAdminRefresh();
        }));
    }
}

let minutesRealtimeDebounceTimer = null;
let minutesRealtimePending = false;

function startMinutesRealtimeListener() {
    if (!window.AppDB || !window.AppDB.listen) return;
    if (typeof minutesListenerUnsubscribe === 'function') {
        minutesListenerUnsubscribe();
        minutesListenerUnsubscribe = null;
    }

    const debouncedRefresh = () => {
        minutesRealtimePending = true;
        if (minutesRealtimeDebounceTimer) clearTimeout(minutesRealtimeDebounceTimer);
        minutesRealtimeDebounceTimer = setTimeout(async () => {
            minutesRealtimeDebounceTimer = null;
            if (!minutesRealtimePending) return;
            minutesRealtimePending = false;

            const currentHash = window.location.hash.slice(1) || 'dashboard';
            if (currentHash !== 'minutes') return;
            if (document.getElementById('minute-detail-modal')) return;

            if (typeof window.AppMinutes !== 'undefined' && window.AppMinutes.isMinutesDirtyState) {
                return;
            }

            const page = document.getElementById('page-content');
            if (!page) return;
            page.innerHTML = await AppUI.renderMinutes();
        }, 300);
    };

    const flags = (AppConfig && AppConfig.READ_OPT_FLAGS) || {};
    if (flags.FF_READ_OPT_TARGETED_REALTIME && window.AppDB.listenQuery) {
        minutesListenerUnsubscribe = window.AppDB.listenQuery(
            'minutes',
            [],
            { orderBy: [{ field: 'date', direction: 'desc' }], limit: 150 },
            debouncedRefresh
        );
    } else {
        minutesListenerUnsubscribe = window.AppDB.listen('minutes', debouncedRefresh);
    }
}

// --- Event Handlers ---

function startTimer(targetUser = null, readOnly = false) {
    if (timerInterval) clearInterval(timerInterval);

    const updateTimerUI = async () => {
        let status = 'out';
        let lastCheckIn = null;
        let isPaused = false;
        let pauseStartedAt = null;
        let totalPausedMs = 0;
        if (targetUser) {
            status = targetUser.status || 'out';
            lastCheckIn = targetUser.lastCheckIn || null;
            isPaused = targetUser.isPaused === true;
            pauseStartedAt = targetUser.pauseStartedAt || null;
            totalPausedMs = Number(targetUser.totalPausedMs) || 0;
        } else {
            const statusInfo = await window.AppAttendance.getStatus();
            status = statusInfo.status;
            lastCheckIn = statusInfo.lastCheckIn;
            isPaused = statusInfo.isPaused === true;
            pauseStartedAt = statusInfo.pauseStartedAt || null;
            totalPausedMs = Number(statusInfo.totalPausedMs) || 0;
        }
        const display = document.getElementById('timer-display');
        const countdownContainer = document.getElementById('countdown-container');
        const overtimeContainer = document.getElementById('overtime-container');
        const countdownValue = document.getElementById('countdown-value');
        const countdownProgress = document.getElementById('countdown-progress');
        const overtimeValue = document.getElementById('overtime-value');
        const timerLabel = document.getElementById('timer-label');

        if (status === 'in' && lastCheckIn) {
            // Determine Target Time (Example: 5:00 PM if Weekday)
            const checkInDate = new Date(lastCheckIn);
            const today = new Date();
            const checkInLocalDate = `${checkInDate.getFullYear()}-${String(checkInDate.getMonth() + 1).padStart(2, '0')}-${String(checkInDate.getDate()).padStart(2, '0')}`;
            const todayLocalDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const isStaleSession = checkInLocalDate !== todayLocalDate;

            // Build shift end target for a given day (recalculated in interval to handle midnight crossover)
            const getShiftEndForDay = (baseDate) => {
                const t = new Date(baseDate);
                const dow = t.getDay();
                if (dow === 6) t.setHours(13, 0, 0, 0);  // Saturday 1 PM
                else t.setHours(17, 0, 0, 0);             // Weekday/Sunday 5 PM
                return t;
            };

            const initialTarget = getShiftEndForDay(checkInDate);
            // The target time cannot be before (checkIn + 8h) — ensures overtime starts after 8h shift
            const minShiftEnd = new Date(checkInDate.getTime() + 8 * 60 * 60 * 1000);
            let targetTime = initialTarget.getTime() < minShiftEnd.getTime() ? minShiftEnd : initialTarget;

            // Timer Interval
            timerInterval = setInterval(() => {
                const now = Date.now();
                const pauseStartMs = Number(pauseStartedAt) || 0;
                const livePausedMs = (isPaused && pauseStartMs > 0) ? Math.max(0, now - pauseStartMs) : 0;
                const effectiveElapsedMs = Math.max(0, (now - lastCheckIn) - totalPausedMs - livePausedMs);

                // Recalculate target based on the current time's day-of-week
                // This handles midnight crossover (e.g., Friday 10PM → Saturday 1AM)
                const currentDayTarget = getShiftEndForDay(new Date());
                const currentMinShiftEnd = new Date(checkInDate.getTime() + 8 * 60 * 60 * 1000);
                targetTime = currentDayTarget.getTime() < currentMinShiftEnd.getTime() ? currentMinShiftEnd : currentDayTarget;

                // Format Elapsed (Main Timer)
                if (display) {
                    let hrs = Math.floor(effectiveElapsedMs / (1000 * 60 * 60));
                    let mins = Math.floor((effectiveElapsedMs / (1000 * 60)) % 60);
                    let secs = Math.floor((effectiveElapsedMs / 1000) % 60);

                    hrs = (hrs < 10) ? "0" + hrs : hrs;
                    mins = (mins < 10) ? "0" + mins : mins;
                    secs = (secs < 10) ? "0" + secs : secs;
                    display.textContent = `${hrs} : ${mins} : ${secs}`;
                }

                // If session started on a previous day, avoid confusing overtime UI.
                if (isStaleSession) {
                    if (countdownContainer) countdownContainer.style.display = 'none';
                    if (overtimeContainer) overtimeContainer.style.display = 'none';
                    if (display) display.style.color = '#b45309';
                    if (timerLabel) {
                        timerLabel.textContent = 'Session Carryover (Please Check Out)';
                        timerLabel.style.color = '#b45309';
                    }
                    return;
                }

                // Countdown / Overtime Logic
                const totalShiftDuration = Math.max(0, targetTime.getTime() - lastCheckIn);
                const remainingWorkMs = totalShiftDuration - effectiveElapsedMs;

                if (remainingWorkMs > 0) {
                    // Regular Work Time
                    if (countdownContainer) countdownContainer.style.display = 'block';
                    if (overtimeContainer) overtimeContainer.style.display = 'none';
                    if (timerLabel) {
                        timerLabel.textContent = isPaused ? 'Paused' : 'Elapsed Time';
                        timerLabel.style.color = isPaused ? '#b45309' : '#6b7280';
                    }
                    if (display) display.style.color = isPaused ? '#b45309' : '#1f2937';

                    // Calculate Remaining
                    let rHrs = Math.floor((remainingWorkMs / (1000 * 60 * 60)) % 24);
                    let rMins = Math.floor((remainingWorkMs / (1000 * 60)) % 60);
                    let rSecs = Math.floor((remainingWorkMs / 1000) % 60);

                    rHrs = (rHrs < 10) ? "0" + rHrs : rHrs;
                    rMins = (rMins < 10) ? "0" + rMins : rMins;
                    rSecs = (rSecs < 10) ? "0" + rSecs : rSecs;

                    // Avoid division by zero
                    const progress = totalShiftDuration > 0 ? Math.min(100, (effectiveElapsedMs / totalShiftDuration) * 100) : 100;

                    if (countdownValue) countdownValue.textContent = `${rHrs}:${rMins}:${rSecs}`;
                    if (countdownProgress) countdownProgress.style.width = `${progress}%`;
                    if (countdownProgress) countdownProgress.style.background = isPaused ? '#f59e0b' : 'var(--primary)';

                } else {
                    // Overtime
                    if (countdownContainer) countdownContainer.style.display = 'none';
                    if (overtimeContainer) overtimeContainer.style.display = 'block';

                    // Calculate Overtime Duration
                    const otDiff = Math.abs(remainingWorkMs);
                    let oHrs = Math.floor(otDiff / (1000 * 60 * 60));
                    let oMins = Math.floor((otDiff / (1000 * 60)) % 60);
                    let oSecs = Math.floor((otDiff / 1000) % 60);

                    oHrs = (oHrs < 10) ? "0" + oHrs : oHrs;
                    oMins = (oMins < 10) ? "0" + oMins : oMins;
                    oSecs = (oSecs < 10) ? "0" + oSecs : oSecs;

                    if (overtimeValue) overtimeValue.textContent = `+ ${oHrs}:${oMins}:${oSecs}`;

                    // Change Main Timer Color
                    if (display) display.style.color = isPaused ? '#b45309' : '#c2410c';
                    if (timerLabel) {
                        timerLabel.textContent = isPaused ? 'Paused (Overtime)' : 'Total Elapsed (Overtime)';
                        timerLabel.style.color = isPaused ? '#b45309' : '#c2410c';
                    }
                }

            }, 1000);

            // Start Activity Monitor
            if (!readOnly && window.AppActivity) {
                if (isPaused && window.AppActivity.stop) window.AppActivity.stop();
                else if (!isPaused && window.AppActivity.start) window.AppActivity.start();
            }

        } else {
            if (display) {
                display.textContent = "00 : 00 : 00";
                display.style.color = ''; // Reset
            }
            if (timerLabel) {
                timerLabel.textContent = 'Elapsed Time';
                timerLabel.style.color = '';
            }
            if (countdownContainer) countdownContainer.style.display = 'none';
            if (overtimeContainer) overtimeContainer.style.display = 'none';
            if (!readOnly && window.AppActivity && window.AppActivity.stop) window.AppActivity.stop();
        }
    };
    updateTimerUI();
}

window.getLocation = function getLocation(options = {}) {
    return new Promise((resolve, reject) => {
        (async () => {
            const forceFresh = options && options.forceFresh === true;
            const allowStaleFallback = !(options && options.allowStaleFallback === false);
            const host = (window.location && window.location.hostname) ? window.location.hostname : '';
            const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';

            // Dev/test bypass: add ?skipGeo to the URL to skip geolocation.
            // Used by Playwright tests that cannot provide GPS in headless Chrome.
            // Only works on localhost for safety.
            if (isLocalhost) {
                const urlParams = new URLSearchParams(window.location.search);
                if (urlParams.has('skipGeo')) {
                    const fakePos = { lat: 19.076, lng: 72.8777 };
                    cachedLocation = fakePos;
                    lastLocationFetch = Date.now();
                    console.log('getLocation: ?skipGeo detected, returning fake location');
                    resolve(fakePos);
                    return;
                }
            }
            if (!window.isSecureContext && !isLocalhost) {
                reject('Location requires HTTPS on mobile. Open this app using an HTTPS URL and allow location access.');
                return;
            }

            // Check Cache first
            const now = Date.now();
            if (!forceFresh && cachedLocation && (now - lastLocationFetch < LOCATION_CACHE_TIME)) {
                console.log("Using cached location (freshness: " + (now - lastLocationFetch) + "ms)");
                resolve(cachedLocation);
                return;
            }

            if (!navigator.geolocation) {
                reject('Geolocation is not supported by your browser.');
                return;
            }

            try {
                if (navigator.permissions && navigator.permissions.query) {
                    const perm = await navigator.permissions.query({ name: 'geolocation' });
                    if (perm && perm.state === 'denied') {
                        reject('Location permission is blocked. Enable location for this site in browser settings and try again.');
                        return;
                    }
                }
            } catch {
                // Ignore permissions API errors and continue to browser prompt flow.
            }

            const getPosition = (options) => {
                return new Promise((res, rej) => {
                    navigator.geolocation.getCurrentPosition(res, rej, options);
                });
            };

            try {
                // Attempt 1: Balanced quick lookup (usually much faster than strict GPS).
                console.log("Requesting Location: Quick/Low Accuracy...");
                const pQuick = await getPosition({
                    enableHighAccuracy: false,
                    timeout: 5000,
                    maximumAge: forceFresh ? 0 : 120000
                });
                const posQuick = { lat: pQuick.coords.latitude, lng: pQuick.coords.longitude };
                cachedLocation = posQuick;
                lastLocationFetch = Date.now();
                resolve(posQuick);
                return;
            } catch (quickErr) {
                console.warn("Quick location attempt failed:", quickErr.message);
            }

            try {
                // Attempt 2: High accuracy fallback (keep timeout moderate to avoid long UI stalls).
                console.log("Requesting Location: High Accuracy (GPS fallback)...");
                const pAccurate = await getPosition({
                    enableHighAccuracy: true,
                    timeout: 8000,
                    maximumAge: forceFresh ? 0 : 10000
                });
                const posAccurate = { lat: pAccurate.coords.latitude, lng: pAccurate.coords.longitude };
                cachedLocation = posAccurate;
                lastLocationFetch = Date.now();
                resolve(posAccurate);
                return;
            } catch (accurateErr) {
                console.warn("High accuracy fallback failed:", accurateErr.message);
            }

            // Final fallback: if we have a not-too-old cached location, use it rather than blocking action.
            if (allowStaleFallback && cachedLocation && (Date.now() - lastLocationFetch < LOCATION_STALE_FALLBACK_TIME)) {
                console.warn("Using stale cached location fallback.");
                resolve(cachedLocation);
                return;
            }

            reject('Location request timed out. Move to open sky or better network and try again.');
        })().catch((err) => {
            reject(err && err.message ? err.message : 'Unable to retrieve location.');
        });
    });
}

const app_hasValidPosition = (pos) => {
    const lat = Number(pos?.lat);
    const lng = Number(pos?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng);
};

async function app_getAttendanceLocation() {
    const pos = await window.getLocation({
        forceFresh: true,
        allowStaleFallback: false
    });
    if (!app_hasValidPosition(pos)) {
        throw new Error('Location capture returned invalid coordinates. Please enable location and try again.');
    }
    return {
        lat: Number(pos.lat),
        lng: Number(pos.lng)
    };
}

function app_formatCheckoutLocationElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function app_stopCheckoutLocationTimer() {
    if (checkoutLocationSession?.timerId) {
        clearInterval(checkoutLocationSession.timerId);
        checkoutLocationSession.timerId = null;
    }
}

function app_setCheckoutLocationProgress(message = 'Capturing location', active = true) {
    const loading = document.getElementById('checkout-location-loading');
    const messageEl = document.getElementById('checkout-location-message');
    const timerEl = document.getElementById('checkout-location-timer');
    if (!loading) return;

    loading.style.display = active ? 'flex' : 'none';
    if (messageEl) messageEl.textContent = message;
    if (!active) {
        app_stopCheckoutLocationTimer();
        if (timerEl) timerEl.textContent = '00:00';
        return;
    }

    const startedAt = checkoutLocationSession?.startedAt || Date.now();
    const updateTimer = () => {
        if (timerEl) timerEl.textContent = app_formatCheckoutLocationElapsed(Date.now() - startedAt);
    };
    updateTimer();
    app_stopCheckoutLocationTimer();
    if (checkoutLocationSession) {
        checkoutLocationSession.timerId = setInterval(updateTimer, 1000);
    }
}

function app_isCheckoutLocationFresh(session = checkoutLocationSession) {
    return !!(
        session
        && app_hasValidPosition(session.pos)
        && Number.isFinite(Number(session.capturedAt))
        && (Date.now() - Number(session.capturedAt)) <= CHECKOUT_LOCATION_FRESH_MS
    );
}

function app_resetCheckoutLocationSession() {
    app_stopCheckoutLocationTimer();
    checkoutLocationSession = null;
    app_setCheckoutLocationProgress('', false);
}
window.app_resetCheckoutLocationSession = app_resetCheckoutLocationSession;

function app_startCheckoutLocationCapture(message = 'Capturing location') {
    if (app_isCheckoutLocationFresh()) return Promise.resolve(checkoutLocationSession.pos);
    if (checkoutLocationSession?.promise) {
        app_setCheckoutLocationProgress(message, true);
        return checkoutLocationSession.promise;
    }

    checkoutLocationSession = {
        startedAt: Date.now(),
        capturedAt: 0,
        pos: null,
        error: null,
        promise: null,
        timerId: null
    };
    app_setCheckoutLocationProgress(message, true);

    checkoutLocationSession.promise = app_getAttendanceLocation()
        .then((pos) => {
            if (!checkoutLocationSession) return pos;
            checkoutLocationSession.pos = pos;
            checkoutLocationSession.capturedAt = Date.now();
            checkoutLocationSession.error = null;
            checkoutLocationSession.promise = null;
            app_setCheckoutLocationProgress('Location captured', false);
            return pos;
        })
        .catch((err) => {
            if (checkoutLocationSession) {
                checkoutLocationSession.error = err;
                checkoutLocationSession.promise = null;
            }
            app_setCheckoutLocationProgress('Location capture failed', false);
            throw err;
        });

    return checkoutLocationSession.promise;
}

async function app_getCheckoutSubmitLocation() {
    if (app_isCheckoutLocationFresh()) return checkoutLocationSession.pos;
    app_setCheckoutLocationProgress('Capturing location for checkout', true);
    const locationTimeoutMs = 9000;
    return Promise.race([
        app_startCheckoutLocationCapture('Capturing location for checkout'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Location request timed out.')), locationTimeoutMs))
    ]);
}

// --- Work Plan Logic ---

const app_isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const app_monthIndexMap = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};

const app_inferRangeFromText = (text = '') => {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const m = raw.match(/(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (!m) return null;
    const d1 = Number(m[1]);
    const d2 = Number(m[2]);
    const monthName = String(m[3] || '').toLowerCase();
    const year = Number(m[4]);
    const mi = app_monthIndexMap[monthName];
    if (!Number.isInteger(d1) || !Number.isInteger(d2) || !Number.isInteger(mi) || !Number.isInteger(year)) return null;
    const start = new Date(year, mi, d1);
    const end = new Date(year, mi, d2);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    if (endDate < startDate) return null;
    return { startDate, endDate };
};

const app_getTaskRangeBounds = (task, planDate, plansCtx = null) => {
    const safePlanDate = app_isIsoDate(planDate) ? String(planDate) : null;
    const rawStart = task?.startDate;
    const rawEnd = task?.endDate;
    const inferred = (!app_isIsoDate(rawStart) && !app_isIsoDate(rawEnd))
        ? app_inferRangeFromText(task?.task || '')
        : null;
    let startDate = app_isIsoDate(rawStart) ? String(rawStart) : (inferred?.startDate || safePlanDate);
    let endDate = app_isIsoDate(rawEnd) ? String(rawEnd) : (inferred?.endDate || startDate || safePlanDate);

    // Backward-compat: tagged copies may not store range; inherit from source plan task.
    if ((!app_isIsoDate(rawStart) || !app_isIsoDate(rawEnd)) && task?.sourcePlanId && plansCtx?.workPlans) {
        const sourcePlan = (plansCtx.workPlans || []).find(p => p.id === task.sourcePlanId);
        const srcIdx = Number.isInteger(task.sourceTaskIndex) ? task.sourceTaskIndex : Number(task.sourceTaskIndex);
        const sourceTask = sourcePlan && Array.isArray(sourcePlan.plans) && Number.isInteger(srcIdx)
            ? sourcePlan.plans[srcIdx]
            : null;
        if (sourceTask) {
            const srcStart = app_isIsoDate(sourceTask.startDate) ? sourceTask.startDate : (sourcePlan.date || startDate);
            const srcEnd = app_isIsoDate(sourceTask.endDate) ? sourceTask.endDate : (sourceTask.startDate || sourcePlan.date || endDate);
            if (!app_isIsoDate(rawStart)) startDate = srcStart;
            if (!app_isIsoDate(rawEnd)) endDate = srcEnd;
        }
    }
    if (startDate && endDate && endDate < startDate) {
        return { startDate, endDate: startDate };
    }
    return { startDate, endDate };
};

const app_taskAppliesOnDate = (task, planDate, dateStr, plansCtx = null) => {
    const { startDate, endDate } = app_getTaskRangeBounds(task, planDate, plansCtx);
    if (!startDate || !endDate) return planDate === dateStr;
    if (dateStr < startDate || dateStr > endDate) return false;
    if (task?.completedDate && task.completedDate < dateStr) return false;
    return true;
};

// opts can include: includeAuto (bool), dedupe (bool), userId (string|null)
// userId is used to filter personal work plans when showing popup details;
// admins bypass the filter. If not provided, behaviour is unchanged.
window.app_getDayEvents = (dateStr, plans, opts = {}) => {
    const includeAuto = opts.includeAuto !== false;
    const dedupe = opts.dedupe !== false;
    const filterUser = opts.userId || null;
    if (!plans) return [];
    if (Array.isArray(plans)) return plans.filter(p => p.date === dateStr);
    const dateObj = new Date(dateStr);

    const evs = [];

    // 1. Add Automatic Day Types (Saturdays, Sundays)
    if (includeAuto && window.AppAnalytics) {
        const dayType = window.AppAnalytics.getDayType(dateObj);
        if (dayType === 'Holiday') {
            evs.push({ title: 'Company Holiday (Weekend)', type: 'holiday', date: dateStr });
        } else if (dayType === 'Half Day') {
            evs.push({ title: 'Half Working Day (Sat)', type: 'event', date: dateStr });
        }
    }

    (plans.leaves || []).forEach(l => {
        if (dateStr >= l.startDate && dateStr <= l.endDate) {
            evs.push({ title: `${l.userName || 'Staff'} (Leave)`, type: 'leave', userId: l.userId, date: dateStr });
        }
    });
    (plans.events || []).forEach(e => {
        if (e.date === dateStr) evs.push({ title: e.title, type: e.type || 'event', date: dateStr });
    });
    (plans.workPlans || []).forEach(p => {
        if (p.date > dateStr) return;
        const tasks = Array.isArray(p.plans) ? p.plans : [];
        const activeTasks = tasks.filter(task => app_taskAppliesOnDate(task, p.date, dateStr, plans));
        if (!activeTasks.length) return;

        const isAnnualPlan = (p.planScope || 'personal') === 'annual';
        const titlePrefix = isAnnualPlan ? 'All Staff (Annual)' : (p.userName || 'Staff');
        const title = `${titlePrefix}: ${activeTasks.map(pl => pl.task).join('; ')}`;
        evs.push({ title, type: 'work', userId: p.userId, plans: activeTasks, date: dateStr, planScope: p.planScope || 'personal' });
    });

    // filter personal work entries if a userId filter is provided
    if (filterUser) {
        // leave and event types are unaffected
        const filtered = [];
        evs.forEach(ev => {
            if (ev.type !== 'work') {
                filtered.push(ev);
                return;
            }
            // allow annual plan entries always
            if ((ev.planScope || '').toLowerCase() === 'annual') {
                filtered.push(ev);
                return;
            }
            // allow if the event belongs to the user
            if (ev.userId === filterUser) {
                filtered.push(ev);
                return;
            }
            // allow if any tagged task names the user with accepted status
            if (Array.isArray(ev.plans)) {
                const hasTag = ev.plans.some(t => Array.isArray(t.tags) && t.tags.some(tag => tag.id === filterUser && tag.status === 'accepted'));
                if (hasTag) {
                    filtered.push(ev);
                    return;
                }
            }
            // otherwise drop
        });
        // replace evs with filtered result
        evs.length = 0;
        evs.push(...filtered);
    }
    if (!dedupe) return evs;
    const seen = new Set();
    return evs.filter(ev => {
        const type = ev.type || 'event';
        if (type !== 'holiday' && type !== 'event') return true;
        const key = `${type}|${ev.title || ''}|${ev.userId || ''}|${ev.date || dateStr}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const app_resolveTargetUserId = (targetUserId, currentUserId) => {
    const raw = String(targetUserId ?? '').trim();
    if (!raw || raw === 'undefined' || raw === 'null') return currentUserId;
    return raw;
};



const app_normalizeIsoDate = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const app_deriveEmployeeId = (joinDateRaw, userIdRaw) => {
    const joinDate = app_normalizeIsoDate(joinDateRaw);
    if (!joinDate) return 'NA';
    const compact = joinDate.replace(/-/g, '');
    const suffix = String(userIdRaw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(-3) || 'USR';
    return `EMP-${compact}-${suffix}`;
};

const app_getBirthdayFieldValue = (raw, min, max) => {
    const value = String(raw ?? '').trim();
    if (!value) return null;
    if (!/^\d+$/.test(value)) throw new Error('Birthday fields must be numeric.');
    const num = Number(value);
    if (!Number.isInteger(num) || num < min || num > max) {
        throw new Error(`Birthday value must be between ${min} and ${max}.`);
    }
    return num;
};

const app_daysInMonth = (year, month) => new Date(year, month, 0).getDate();

const app_extractBirthdayFields = (formData) => {
    const currentYear = new Date().getFullYear() + 1;
    const birthDay = app_getBirthdayFieldValue(formData.get('birthDay'), 1, 31);
    const birthMonth = app_getBirthdayFieldValue(formData.get('birthMonth'), 1, 12);
    const birthYear = app_getBirthdayFieldValue(formData.get('birthYear'), 1900, currentYear);

    if (birthDay && birthMonth) {
        const validationYear = birthYear || 2024;
        const maxDay = app_daysInMonth(validationYear, birthMonth);
        if (birthDay > maxDay) {
            throw new Error(`Birthday day is not valid for month ${birthMonth}.`);
        }
    }

    return { birthDay, birthMonth, birthYear };
};

const app_formatBirthdayDate = (birthDay, birthMonth, birthYear = null) => {
    const day = Number(birthDay || 0);
    const month = Number(birthMonth || 0);
    const year = Number(birthYear || 0);
    const monthLabel = month >= 1 && month <= 12
        ? new Date(2026, month - 1, 1).toLocaleString('en-US', { month: 'long' })
        : '--';
    const dayLabel = day ? String(day).padStart(2, '0') : '--';
    const yearLabel = year ? ` ${year}` : '';
    return `${dayLabel} ${monthLabel}${yearLabel}`.trim();
};

const app_getBirthdaySourceConfig = (source = 'user') => {
    const normalizedSource = String(source || 'user').trim().toLowerCase() === 'external' ? 'external' : 'user';
    return normalizedSource === 'external'
        ? {
            source: 'external',
            collection: 'birthday_people',
            label: 'Birthday Person',
            emptyMessage: 'Birthday person not found.',
            roleLabel: 'Position',
            deptLabel: 'Location'
        }
        : {
            source: 'user',
            collection: 'users',
            label: 'Staff',
            emptyMessage: 'Staff member not found.',
            roleLabel: 'Role',
            deptLabel: 'Department'
        };
};

const app_getBirthdayEditorMeta = (record, source = 'user') => {
    const config = app_getBirthdaySourceConfig(source);
    if (config.source === 'external') {
        return {
            title: record?.name || 'Birthday Person',
            subtitle: `${record?.position || 'Position not set'} • ${record?.location || 'Location not set'}`
        };
    }
    return {
        title: record?.name || 'Staff',
        subtitle: `${record?.role || 'Employee'} • ${record?.dept || 'General'}`
    };
};

const app_buildBirthdayReminderPayload = (record, source, birthdayDate, reminderDate) => {
    const config = app_getBirthdaySourceConfig(source);
    const birthdayKey = app_toDateKey(birthdayDate);
    const reminderKey = app_toDateKey(reminderDate);
    const reminderReason = app_getBirthdayReminderReason(birthdayDate, reminderDate);
    const isExternal = config.source === 'external';
    const role = isExternal ? (record?.position || '') : (record?.role || '');
    const dept = isExternal ? (record?.location || '') : (record?.dept || '');
    const label = isExternal ? 'Birthday Person' : 'Staff';
    return {
        id: `birthday_${config.source}_${birthdayKey}_${record.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'birthday-reminder',
        title: `Upcoming Birthday: ${record.name || label}`,
        message: `${record.name || label} has a birthday on ${app_formatBirthdayDate(record.birthDay, record.birthMonth)}.`,
        description: `${reminderReason}. ${role || (isExternal ? 'Position not set' : 'Employee')} • ${dept || (isExternal ? 'Location not set' : 'General')}`,
        status: 'pending',
        date: new Date().toISOString(),
        read: false,
        taggedByName: 'Birthday Calendar',
        birthdayStaffId: record.id,
        birthdayStaffName: record.name || label,
        birthdaySource: config.source,
        birthdayDate: birthdayKey,
        reminderDate: reminderKey,
        birthdayDisplay: app_formatBirthdayDate(record.birthDay, record.birthMonth, record.birthYear),
        birthdayReason: reminderReason,
        role,
        dept
    };
};

const app_getISTNowDate = () => {
    if (window.AppDB && typeof window.AppDB.getIstNow === 'function') {
        return window.AppDB.getIstNow();
    }
    return new Date();
};

const app_toDateKey = (dateObj) => {
    const d = dateObj instanceof Date ? new Date(dateObj) : new Date(dateObj);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const app_getBirthdayOccurrence = (user, baseDate = app_getISTNowDate()) => {
    const birthDay = Number(user?.birthDay || 0);
    const birthMonth = Number(user?.birthMonth || 0);
    if (!birthDay || !birthMonth) return null;

    const base = new Date(baseDate);
    const buildOccurrence = (year) => {
        const maxDay = app_daysInMonth(year, birthMonth);
        const safeDay = Math.min(birthDay, maxDay);
        return new Date(year, birthMonth - 1, safeDay);
    };

    let occurrence = buildOccurrence(base.getFullYear());
    occurrence.setHours(0, 0, 0, 0);
    const baseKey = app_toDateKey(base);
    if (app_toDateKey(occurrence) < baseKey) {
        occurrence = buildOccurrence(base.getFullYear() + 1);
        occurrence.setHours(0, 0, 0, 0);
    }
    return occurrence;
};

const app_isWorkingDay = (dateObj) => {
    const dayType = window.AppAnalytics?.getDayType?.(dateObj);
    return dayType !== 'Holiday';
};

const app_getPreviousWorkingDay = (dateObj) => {
    const cursor = new Date(dateObj);
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - 1);
    while (!app_isWorkingDay(cursor)) {
        cursor.setDate(cursor.getDate() - 1);
    }
    return cursor;
};

const app_getBirthdayReminderReason = (birthdayDate, reminderDate) => {
    const diffDays = Math.round((birthdayDate.getTime() - reminderDate.getTime()) / 86400000);
    return diffDays <= 1 ? 'Birthday is tomorrow' : 'Birthday is on the next working day';
};

const app_formatDateGb = (value, fallback = 'NA') => {
    if (value === null || value === undefined || value === '') return fallback;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return fallback;
    return d.toLocaleDateString('en-GB');
};

const app_formatDateTimeGb = (value, fallback = 'NA') => {
    if (value === null || value === undefined || value === '') return fallback;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return fallback;
    return d.toLocaleString('en-GB');
};

const app_formatMoneyInr = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN')}`;


const app_getTaskSummary = (taskText = '') => {
    const clean = String(taskText || '').replace(/\s+/g, ' ').trim();
    if (!clean) return 'New task';
    return clean.length > 72 ? `${clean.slice(0, 72)}...` : clean;
};

const app_renderNoCollaboratorsPlaceholder = () => `
        <div class="no-tags-placeholder day-plan-no-tags-placeholder">
            <p class="day-plan-no-tags-text">No collaborators yet</p>
        </div>
    `;

const app_buildCollaboratorChip = (userId, userName, status = 'pending') => `
        <div class="tag-chip day-plan-tag-chip" data-id="${app_escapeHtml(userId)}" data-name="${app_escapeHtml(userName)}" data-status="${app_escapeHtml(status)}">
            <span class="day-plan-tag-main">@${app_escapeHtml(userName)} <span class="day-plan-tag-pending">(${app_escapeHtml(status)})</span></span>
            <i class="fa-solid fa-times day-plan-remove-collab-btn" onclick="window.app_removeTagHint(this)"></i>
        </div>
    `;

window.app_refreshPlanBlockSummary = (block) => {
    if (!block) return;
    const taskInput = block.querySelector('.plan-task');
    const summaryEl = block.querySelector('.day-plan-task-summary');
    const scopeSelect = block.querySelector('.plan-scope');
    const scopePill = block.querySelector('.day-plan-scope-pill');
    const summary = app_getTaskSummary(taskInput ? taskInput.value : '');
    if (summaryEl) summaryEl.textContent = summary;
    if (scopePill && scopeSelect) scopePill.textContent = scopeSelect.value === 'annual' ? 'Annual Plan' : 'Personal Plan';
};

window.app_togglePlanBlockCollapse = (btn) => {
    const block = btn.closest('.plan-block');
    if (!block) return;
    block.classList.toggle('is-collapsed');
    const collapsed = block.classList.contains('is-collapsed');
    const icon = btn.querySelector('i');
    if (icon) {
        icon.classList.toggle('fa-chevron-down', !collapsed);
        icon.classList.toggle('fa-chevron-up', collapsed);
    }
    const label = btn.querySelector('.day-plan-collapse-label');
    if (label) label.textContent = collapsed ? 'Expand' : 'Minimize';
    window.app_refreshPlanBlockSummary(block);
};

window.app_toggleTaskCollaborator = (btn, userId, userName) => {
    const block = btn.closest('.plan-block');
    if (!block) return;
    const tagsContainer = block.querySelector('.tags-container');
    if (!tagsContainer) return;

    const escapedId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(userId) : userId.replace(/"/g, '\\"');
    const existing = tagsContainer.querySelector(`[data-id="${escapedId}"]`);
    if (existing) {
        existing.remove();
        btn.classList.remove('selected');
    } else {
        const placeholder = tagsContainer.querySelector('.no-tags-placeholder');
        if (placeholder) placeholder.remove();
        tagsContainer.insertAdjacentHTML('beforeend', app_buildCollaboratorChip(userId, userName, 'pending'));
        btn.classList.add('selected');
    }

    if (tagsContainer.querySelectorAll('.tag-chip').length === 0) {
        tagsContainer.innerHTML = app_renderNoCollaboratorsPlaceholder();
    }
};



window.app_getAnnualDayStaffPlans = (dateStr) => {
    const plans = window._currentPlans || {};
    const userMap = window._annualUserMap || {};
    const workPlans = (plans.workPlans || []).filter(p => p.date <= dateStr);
    const rows = workPlans.map(p => {
        const ownerName = userMap[p.userId] || p.userName || 'Staff';
        const ownerTaskMap = new Map();
        const normalizeTopicKey = (text) => {
            const raw = String(text || '').toLowerCase();
            const noDateRange = raw.replace(/\d{1,2}\s*-\s*\d{1,2}\s+[a-z]+\s+\d{4}/g, ' ');
            const noParens = noDateRange.replace(/\([^)]*\)/g, ' ');
            const alpha = noParens.replace(/[^a-z\s]/g, ' ');
            const words = alpha.split(/\s+/).filter(Boolean).slice(0, 8);
            return words.join(' ');
        };
        const upsertOwnerTask = (rawText, suffix = '') => {
            const base = String(rawText || 'Planned task').trim();
            if (!base) return;
            const norm = normalizeTopicKey(base) || base.toLowerCase().replace(/\s+/g, ' ');
            const candidate = `${base}${suffix || ''}`;
            if (!ownerTaskMap.has(norm)) {
                ownerTaskMap.set(norm, candidate);
                return;
            }
            const existing = ownerTaskMap.get(norm) || '';
            // Prefer richer marker text over plain duplicates.
            if (existing === base && candidate !== base) {
                ownerTaskMap.set(norm, candidate);
            }
        };
        const tasks = (Array.isArray(p.plans) ? p.plans : [])
            .filter(t => app_taskAppliesOnDate(t, p.date, dateStr, plans))
            .map(t => {
                const { startDate, endDate } = app_getTaskRangeBounds(t, p.date, plans);
                const isMultiDay = !!(startDate && endDate && startDate !== endDate);
                const isEndDate = endDate === dateStr;
                const isStartDate = startDate === dateStr;
                const endedEarly = t.completedDate && t.completedDate < endDate;
                const suffix = endedEarly && t.completedDate === dateStr
                    ? ` (Completed Early)`
                    : (isMultiDay && isEndDate)
                        ? ` (Ends Today)`
                        : (isMultiDay && isStartDate)
                            ? ` (Starts Today)`
                            : '';
                upsertOwnerTask(t.task || 'Planned task', suffix);
                return '';
            })
            .filter(Boolean);

        const dedupedTasks = Array.from(ownerTaskMap.values());
        if (!dedupedTasks.length && tasks.length) return { name: ownerName, tasks };
        if (!dedupedTasks.length) return null;
        return { name: ownerName, tasks: dedupedTasks };
    }).filter(Boolean);

    // Merge duplicate owner groups that can come from mixed legacy/new plan docs.
    const normalizeTopicKey = (text) => {
        const raw = String(text || '').toLowerCase();
        const noDateRange = raw.replace(/\d{1,2}\s*-\s*\d{1,2}\s+[a-z]+\s+\d{4}/g, ' ');
        const noParens = noDateRange.replace(/\([^)]*\)/g, ' ');
        const alpha = noParens.replace(/[^a-z\s]/g, ' ');
        const words = alpha.split(/\s+/).filter(Boolean).slice(0, 8);
        return words.join(' ');
    };
    const byOwner = new Map();
    rows.forEach(row => {
        const ownerKey = row.name || 'Staff';
        if (!byOwner.has(ownerKey)) {
            byOwner.set(ownerKey, new Map());
        }
        const bucket = byOwner.get(ownerKey);
        (row.tasks || []).forEach(t => {
            const topic = normalizeTopicKey(t) || String(t || '').toLowerCase();
            if (!bucket.has(topic)) bucket.set(topic, t);
            else {
                const existing = bucket.get(topic) || '';
                const candidate = String(t || '');
                if (existing.length < candidate.length) bucket.set(topic, candidate);
            }
        });
    });

    return Array.from(byOwner.entries()).map(([name, taskMap]) => ({
        name,
        tasks: Array.from(taskMap.values())
    }));
};

window.app_showAnnualHoverPreview = (event, dateStr) => {
    const modalId = 'annual-hover-preview';
    document.getElementById(modalId)?.remove();
    const dayPlans = window.app_getAnnualDayStaffPlans(dateStr);
    const body = dayPlans.length
        ? dayPlans.map(row => `
                <div style="margin-bottom:0.45rem;">
                    <div style="font-size:0.76rem; font-weight:700; color:#334155;">${row.name}</div>
                    <div style="font-size:0.72rem; color:#64748b;">${row.tasks.slice(0, 2).join(' | ')}${row.tasks.length > 2 ? ` (+${row.tasks.length - 2} more)` : ''}</div>
                </div>
            `).join('')
        : `<div style="font-size:0.74rem; color:#94a3b8;">No staff plans for this date</div>`;
    const html = `
            <div id="${modalId}" style="position:fixed; z-index:12000; left:${Math.min((event.clientX || 0) + 12, window.innerWidth - 290)}px; top:${Math.min((event.clientY || 0) + 12, window.innerHeight - 220)}px; width:280px; background:#fff; border:1px solid #dbeafe; border-radius:12px; box-shadow:0 12px 26px rgba(15,23,42,0.18); padding:0.65rem;">
                <div style="font-size:0.76rem; font-weight:800; color:#1e3a8a; margin-bottom:0.5rem;">${dateStr} Plans</div>
                ${body}
            </div>`;
    (document.getElementById('modal-container') || document.body).insertAdjacentHTML('beforeend', html);
};

window.app_hideAnnualHoverPreview = () => {
    document.getElementById('annual-hover-preview')?.remove();
};

window.app_openAnnualDayPlan = async (dateStr) => {
    window.app_hideAnnualHoverPreview();
    const modalId = `annual-day-click-${Date.now()}`;
    const dayPlans = window.app_getAnnualDayStaffPlans(dateStr);
    const body = dayPlans.length
        ? dayPlans.map(row => `
                <div style="border:1px solid #e2e8f0; border-radius:10px; padding:0.55rem; margin-bottom:0.45rem;">
                    <div style="font-size:0.8rem; font-weight:700; color:#334155; margin-bottom:0.25rem;">${row.name}</div>
                    <div style="font-size:0.76rem; color:#64748b;">${row.tasks.join(' | ')}</div>
                </div>
            `).join('')
        : `<div style="font-size:0.8rem; color:#94a3b8;">No plans yet for this date.</div>`;
    const html = `
            <div class="modal-overlay annual-v2-modal" id="${modalId}" style="display:flex;">
                <div class="modal-content annual-day-plan-content annual-v2-modal-content" style="max-width:560px;">
                    <div class="annual-day-plan-head annual-v2-modal-head" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.7rem;">
                        <h3 style="margin:0;">${dateStr}</h3>
                        <button type="button" class="app-system-dialog-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
                    </div>
                    <div class="annual-day-plan-list annual-v2-modal-list" style="max-height:46vh; overflow:auto; margin-bottom:0.75rem;">${body}</div>
                    <button type="button" class="action-btn" style="width:100%;" onclick="this.closest('.modal-overlay').remove(); window.app_openDayPlan('${dateStr}')">
                        <i class="fa-solid fa-pen-to-square"></i> Add / Edit Day Plan
                    </button>
                </div>
            </div>`;
    window.app_showModal(html, modalId);
};

window.app_addPlanBlockUI = async () => {
    const container = document.getElementById('plans-container');
    if (!container) return;
    const allUsers = await window.AppDB.getAll('users');
    const currentUser = window.AppAuth.getUser();
    const isAdmin = currentUser.role === 'Administrator' || currentUser.isAdmin;
    const targetId = app_resolveTargetUserId(window.app_currentDayPlanTargetId, currentUser.id);
    const defaultScope = container.dataset.defaultScope === 'annual' ? 'annual' : 'personal';
    const selectableCollaborators = allUsers.filter(u => u.id !== targetId);
    const collaboratorButtons = selectableCollaborators.map(u => `
            <button
                type="button"
                class="day-plan-collab-option"
                data-id="${app_escapeHtml(u.id)}"
                onclick="window.app_toggleTaskCollaborator(this, '${app_escapeJsSingleQuote(u.id)}', '${app_escapeJsSingleQuote(u.name)}')"
                title="Add or remove ${app_escapeHtml(u.name)}"
            >${app_escapeHtml(u.name)}</button>
        `).join('');
    const newBlock = document.createElement('div');
    newBlock.className = 'plan-block day-plan-block-shell';
    newBlock.innerHTML = `
            <div class="day-plan-block-head" style="display:flex; align-items:center; justify-content:space-between; gap:0.7rem; padding:0.62rem 0.8rem; border-bottom:1px solid #dbeafe; background:linear-gradient(90deg,#f7faff 0%,#ecf4ff 100%);">
                <div class="day-plan-block-head-main" style="display:flex; align-items:center; gap:0.55rem; min-width:0;">
                    <span class="day-plan-index-badge-step" style="background:#1d4ed8; color:#fff;">${container.querySelectorAll('.plan-block').length + 1}</span>
                    <span class="day-plan-task-summary">New task</span>
                    <span class="day-plan-scope-pill" style="background:#dbeafe; color:#1e3a8a; border-color:#bfdbfe;">${defaultScope === 'annual' ? 'Annual Plan' : 'Personal Plan'}</span>
                </div>
                <div class="day-plan-block-head-actions">
                    <button type="button" onclick="this.closest('.plan-block').remove()" title="Remove this task" class="day-plan-remove-task-btn"><i class="fa-solid fa-times"></i></button>
                    <button type="button" class="day-plan-collapse-btn" onclick="window.app_togglePlanBlockCollapse(this)" style="border-color:#bfdbfe; background:#fff;">
                        <i class="fa-solid fa-chevron-down"></i>
                        <span class="day-plan-collapse-label">Minimize</span>
                    </button>
                </div>
            </div>
            <div class="day-plan-block-body" style="padding:0.8rem;">
                <div class="day-plan-left-panel day-plan-main-panel">
                    <div style="display:flex; gap:0.6rem; align-items:center; justify-content:space-between; flex-wrap:wrap;">
                        <label class="day-plan-label" style="margin:0;">What will you work on?</label>
                        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center; justify-content:flex-end;">
                            <input type="date" class="plan-start-date day-plan-select" title="From Date">
                            <input type="date" class="plan-end-date day-plan-select" title="To Date">
                            <span style="font-size:0.72rem; color:#64748b; font-weight:700;">Optional range</span>
                        </div>
                    </div>
                    <p class="day-plan-help-text">Be specific. Pick collaborators here or use @ mention.</p>
                    <textarea class="plan-task day-plan-task-input" required placeholder="Describe your plan for the day..." style="min-height:104px;"></textarea>
                    <div class="day-plan-inline-work-controls" style="border:1px solid #dbeafe; background:#f8fbff; border-radius:12px; padding:0.6rem;">
                        <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
                            <label class="day-plan-mini-label" style="margin:0;">Plan Type</label>
                            <select class="plan-scope day-plan-select day-plan-scope-select">
                                <option value="personal" ${defaultScope === 'personal' ? 'selected' : ''}>Personal Plan</option>
                                <option value="annual" ${defaultScope === 'annual' ? 'selected' : ''}>Annual Plan</option>
                            </select>
                        </div>
                        <div class="day-plan-collab-inline" style="margin-top:0.42rem;">
                            <div class="day-plan-collab-head">
                                <span class="day-plan-mini-label">Collaborators</span>
                                <span class="day-plan-collab-hint">Click names to tag/un-tag.</span>
                            </div>
                            <div class="day-plan-collab-picker">
                                ${collaboratorButtons || '<span class="day-plan-collab-empty">No teammates available.</span>'}
                            </div>
                        </div>
                        <div class="tags-container day-plan-tags-inline">
                            ${app_renderNoCollaboratorsPlaceholder()}
                        </div>
                    </div>
                    <div class="day-plan-sub-section">
                        <label class="day-plan-mini-label">Break into steps (optional)</label>
                        <div class="sub-plans-list day-plan-sub-list"></div>
                        <button type="button" onclick="window.app_addSubPlanRow(this)" class="day-plan-add-step-btn"><i class="fa-solid fa-plus"></i> Add Step</button>
                    </div>
                </div>
            </div>
            <div class="day-plan-bottom-controls" style="padding:0 0.8rem 0.8rem 0.8rem;">
                <div style="display:flex; align-items:center; gap:0.6rem;">
                    <label class="day-plan-mini-label">Status</label>
                    <select class="plan-status day-plan-select">
                        <option value="" selected>Auto-Track (Recommended)</option>
                        <option value="completed">Completed</option>
                        <option value="not-completed">Not Completing</option>
                        <option value="in-process">In Progress</option>
                    </select>
                </div>
                ${isAdmin ? `
                    <div style="display:flex; align-items:center; gap:0.6rem;">
                        <label class="day-plan-mini-label">Assign To</label>
                        <select class="plan-assignee day-plan-select">
                            ${allUsers.map(u => `<option value="${u.id}" ${u.id === currentUser.id ? 'selected' : ''}>${u.name}</option>`).join('')}
                        </select>
                    </div>
                ` : ''}
            </div>
        `;
    container.appendChild(newBlock);
    const fromInput = newBlock.querySelector('.plan-start-date');
    const toInput = newBlock.querySelector('.plan-end-date');
    const dateMatch = document.querySelector('#day-plan-modal .day-plan-head p')?.textContent?.match(/\d{4}-\d{2}-\d{2}/);
    const defaultDate = dateMatch ? dateMatch[0] : '';
    if (fromInput) fromInput.value = defaultDate;
    if (toInput) toInput.value = defaultDate;
    const ta = newBlock.querySelector('.plan-task');
    window.app_refreshPlanBlockSummary(newBlock);
    if (ta) ta.focus();
};

window.app_addSubPlanRow = (btn) => {
    const list = btn.closest('.plan-block')?.querySelector('.sub-plans-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'sub-plan-row day-plan-sub-row';
    row.innerHTML = `
            <div class="day-plan-step-dot"></div>
            <input type="text" class="sub-plan-input day-plan-sub-input" placeholder="Add a step...">
            <button type="button" onclick="this.parentElement.remove()" title="Remove step" class="day-plan-remove-step-btn"><i class="fa-solid fa-circle-xmark"></i></button>
        `;
    list.appendChild(row);
    const input = row.querySelector('input');
    if (input) input.focus();
};

window.app_checkMentions = (textarea, users) => {
    const text = textarea.value;
    const cursorPos = textarea.selectionStart;
    const lastAt = text.lastIndexOf('@', cursorPos - 1);
    const dropdown = document.getElementById('mention-dropdown');
    if (!dropdown) return;

    if (lastAt !== -1 && !text.substring(lastAt, cursorPos).includes(' ')) {
        const query = text.substring(lastAt + 1, cursorPos).toLowerCase();
        const filtered = users.filter(u => u.name.toLowerCase().includes(query));
        if (!textarea.id) textarea.id = 'ta-' + Date.now();
        if (filtered.length > 0) {
            const rect = textarea.getBoundingClientRect();
            dropdown.innerHTML = filtered.map(u => `
                    <div onclick="window.app_applyMention('${textarea.id}', '${u.id}', '${u.name.replace(/'/g, "\\'")}', ${lastAt})" class="mention-item day-plan-mention-item">
                        <img src="${u.avatar}" class="day-plan-mention-avatar" />
                        <span>${u.name}</span>
                    </div>
                `).join('');
            dropdown.style.top = `${rect.bottom + 6}px`;
            dropdown.style.left = `${rect.left}px`;
            dropdown.style.display = 'block';
        } else {
            dropdown.style.display = 'none';
        }
    } else {
        dropdown.style.display = 'none';
    }
};

window.app_applyMention = (taId, userId, userName, atPos) => {
    const textarea = document.getElementById(taId);
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const before = textarea.value.substring(0, atPos);
    const after = textarea.value.substring(cursorPos);
    textarea.value = `${before}${userName} ${after}`;
    textarea.focus();

    const block = textarea.closest('.plan-block');
    const tagsContainer = block?.querySelector('.tags-container');
    if (!tagsContainer) return;

    const dropdown = document.getElementById('mention-dropdown');
    if (dropdown) dropdown.style.display = 'none';

    const existing = tagsContainer.querySelector(`[data-id="${userId}"]`);
    if (existing) return;

    const placeholder = tagsContainer.querySelector('.no-tags-placeholder');
    if (placeholder) placeholder.remove();

    tagsContainer.insertAdjacentHTML('beforeend', app_buildCollaboratorChip(userId, userName, 'pending'));
    const escapedId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(userId) : userId.replace(/"/g, '\\"');
    const pickerButton = block?.querySelector(`.day-plan-collab-option[data-id="${escapedId}"]`);
    if (pickerButton) pickerButton.classList.add('selected');
};

window.app_removeTagHint = (btn) => {
    const container = btn.closest('.tags-container');
    const chip = btn.closest('.tag-chip');
    const userId = chip ? chip.dataset.id : '';
    const block = btn.closest('.plan-block');
    btn.parentElement.remove();
    if (block && userId) {
        const escapedId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(userId) : userId.replace(/"/g, '\\"');
        const pickerButton = block.querySelector(`.day-plan-collab-option[data-id="${escapedId}"]`);
        if (pickerButton) pickerButton.classList.remove('selected');
    }
    if (container && container.querySelectorAll('.tag-chip').length === 0) {
        container.innerHTML = app_renderNoCollaboratorsPlaceholder();
    }
};

window.app_showStatusTooltip = () => { };



// === CHECKOUT FORM HELPER FUNCTIONS ===

// Hide checkout intro panel
window.app_hideCheckoutIntro = () => {
    const panel = document.getElementById('checkout-intro-panel');
    if (panel) {
        panel.style.display = 'none';
        localStorage.setItem('checkoutIntroSeen', 'true');
    }
};

// Update character counter in checkout textarea
window.app_updateCharCounter = (textarea) => {
    const counter = document.getElementById('char-counter');
    if (counter) {
        const length = textarea.value.length;
        counter.textContent = `${length} / 500 recommended`;

        // Visual feedback for length
        if (length > 500) {
            counter.style.color = '#f59e0b'; // Orange for long text
        } else if (length > 300) {
            counter.style.color = '#10b981'; // Green for good length
        } else {
            counter.style.color = '#94a3b8'; // Default gray
        }
    }
};

// Select location reason (quick button)
window.app_selectLocationReason = (reason) => {
    const textarea = document.getElementById('location-explanation');
    if (textarea) {
        // Clear previous selection styling
        document.querySelectorAll('.location-reason-btn').forEach(btn => {
            btn.style.background = '#e0f2fe';
            btn.style.borderColor = '#7dd3fc';
        });

        // Highlight selected button
        event.target.style.background = '#0ea5e9';
        event.target.style.borderColor = '#0ea5e9';
        event.target.style.color = 'white';

        // Set textarea value
        textarea.value = reason;
        textarea.focus();
    }
};

window.app_selectOvertimeReason = (buttonEl, reason, mode = 'overtime_work') => {
    const textarea = document.getElementById('checkout-overtime-explanation');
    const modeInput = document.getElementById('checkout-overtime-mode');

    document.querySelectorAll('.overtime-reason-btn').forEach(btn => {
        btn.style.background = '#fef3c7';
        btn.style.borderColor = '#fcd34d';
        btn.style.color = '#92400e';
    });

    if (buttonEl) {
        buttonEl.style.background = '#f59e0b';
        buttonEl.style.borderColor = '#f59e0b';
        buttonEl.style.color = 'white';
    }
    if (modeInput) modeInput.value = mode;
    if (textarea) {
        textarea.value = reason;
        textarea.focus();
    }
};

// Use work plan to fill checkout summary
window.app_useWorkPlan = () => {
    const planTextEl = document.getElementById('checkout-plan-text');
    const summaryTextarea = document.getElementById('checkout-work-summary');
    const rawText = planTextEl?.dataset?.rawText;

    if (rawText && summaryTextarea) {
        summaryTextarea.value = rawText;
        window.app_checkoutSummaryDraft = rawText;

        // Update character counter
        if (window.app_updateCharCounter) {
            window.app_updateCharCounter(summaryTextarea);
        }

        // Focus the textarea
        summaryTextarea.focus();

        // Visual feedback
        summaryTextarea.style.borderColor = '#8b5cf6';
        summaryTextarea.style.background = '#f5f3ff';
        setTimeout(() => {
            summaryTextarea.style.borderColor = '#e2e8f0';
            summaryTextarea.style.background = '#ffffff';
        }, 1000);
    }
};

const app_checkoutStatusLabels = {
    started: 'Started',
    half_done: 'Half Done',
    blocked: 'Blocked',
    waiting: 'Waiting',
    done: 'Done'
};

const app_escapeCssValue = (value) => {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return String(value || '').replace(/"/g, '\\"');
};

window.app_getCheckoutTaskKey = (planId, taskIndex) => `${planId}:${taskIndex}`;

window.app_parseCheckoutTaskKey = (key) => {
    const raw = String(key || '');
    const idx = raw.lastIndexOf(':');
    if (idx <= 0) return { planId: raw, taskIndex: -1 };
    const planId = raw.slice(0, idx);
    const taskIndex = Number(raw.slice(idx + 1));
    return { planId, taskIndex };
};

window.app_initCheckoutTaskDetails = (planId, taskIndex, task) => {
    window.app_checkoutTaskDetails = window.app_checkoutTaskDetails || {};
    const key = window.app_getCheckoutTaskKey(planId, taskIndex);
    if (!window.app_checkoutTaskDetails[key]) {
        const rawProgress = Number(task?.progressPercent);
        const progressPercent = Number.isFinite(rawProgress)
            ? Math.min(100, Math.max(0, rawProgress))
            : (task?.status === 'completed' ? 100 : 0);
        const progressStatus = task?.progressStatus
            || (progressPercent >= 100 ? 'done' : (progressPercent > 0 ? 'started' : 'waiting'));
        window.app_checkoutTaskDetails[key] = {
            action: '',
            progressPercent,
            progressStatus,
            progressNote: task?.progressNote || '',
            budgetHeadId: app_normalizeBudgetHeadId(task?.budgetHeadId || window.AppAuth.getUser()?.currentBudgetHeadId),
            actionMeta: {},
            lastUpdatedAt: null
        };
    }
    return window.app_checkoutTaskDetails[key];
};

window.app_markCheckoutTaskSaved = (key) => {
    const modal = document.querySelector(`.checkout-action-detail-modal[data-checkout-key="${app_escapeCssValue(key)}"]`);
    const badge = modal?.querySelector('[data-saved-indicator]');
    if (!badge) return;
    badge.classList.add('is-visible');
    clearTimeout(badge._hideTimeout);
    badge._hideTimeout = setTimeout(() => {
        badge.classList.remove('is-visible');
    }, 1400);
};

window.app_setCheckoutTaskStatus = (key, status) => {
    const details = window.app_checkoutTaskDetails?.[key];
    if (!details) return;
    details.progressStatus = status;
    details.lastUpdatedAt = new Date().toISOString();
    window.app_syncCheckoutTaskPanel(key);
    window.app_markCheckoutTaskSaved(key);
    window.app_renderCheckoutActionPreview();
};

window.app_updateCheckoutTaskProgress = (key, value) => {
    const details = window.app_checkoutTaskDetails?.[key];
    if (!details) return;
    const numeric = Math.min(100, Math.max(0, Number(value || 0)));
    details.progressPercent = numeric;
    if (numeric >= 100) details.progressStatus = 'done';
    details.lastUpdatedAt = new Date().toISOString();
    window.app_syncCheckoutTaskPanel(key);
    window.app_markCheckoutTaskSaved(key);
    window.app_renderCheckoutActionPreview();
};

window.app_updateCheckoutTaskNote = (key, value) => {
    const details = window.app_checkoutTaskDetails?.[key];
    if (!details) return;
    details.progressNote = String(value || '');
    details.lastUpdatedAt = new Date().toISOString();
    window.app_markCheckoutTaskSaved(key);
    window.app_renderCheckoutActionPreview();
};

window.app_updateCheckoutTaskActionMeta = (key, field, value) => {
    const details = window.app_checkoutTaskDetails?.[key];
    if (!details) return;
    details.actionMeta = details.actionMeta || {};
    details.actionMeta[field] = value;
    details.lastUpdatedAt = new Date().toISOString();
    window.app_markCheckoutTaskSaved(key);
    window.app_renderCheckoutActionPreview();
};

window.app_clearCheckoutTaskError = (key) => {
    const modal = document.querySelector(`.checkout-action-detail-modal[data-checkout-key="${app_escapeCssValue(key)}"]`);
    if (!modal) return;
    modal.classList.remove('has-error');
    const errorEl = modal.querySelector('[data-inline-error]');
    if (errorEl) errorEl.textContent = '';
};

window.app_setCheckoutTaskError = (key, message) => {
    const modal = document.querySelector(`.checkout-action-detail-modal[data-checkout-key="${app_escapeCssValue(key)}"]`);
    if (!modal) return;
    modal.classList.add('has-error');
    const errorEl = modal.querySelector('[data-inline-error]');
    if (errorEl) errorEl.textContent = message;
};

window.app_syncCheckoutTaskPanel = (key) => {
    const details = window.app_checkoutTaskDetails?.[key];
    const modal = document.querySelector(`.checkout-action-detail-modal[data-checkout-key="${app_escapeCssValue(key)}"]`);
    if (!modal || !details) return;
    const progressValue = modal.querySelector('[data-progress-value]');
    const progressInput = modal.querySelector('[data-progress-input]');
    if (progressInput) progressInput.value = details.progressPercent;
    if (progressValue) progressValue.textContent = `${details.progressPercent}%`;
    const progressNoteInput = modal.querySelector('[data-progress-note]');
    if (progressNoteInput && progressNoteInput.value !== details.progressNote) {
        progressNoteInput.value = details.progressNote || '';
    }
    modal.querySelectorAll('[data-status-chip]').forEach((chip) => {
        const status = chip.getAttribute('data-status-chip');
        chip.classList.toggle('is-selected', status === details.progressStatus);
    });
    modal.querySelectorAll('[data-action-panel-section]').forEach((section) => {
        const targetAction = section.getAttribute('data-action-panel-section');
        section.style.display = (details.action === targetAction) ? 'block' : 'none';
    });
    modal.querySelectorAll('[data-action-field]').forEach((fieldEl) => {
        const field = fieldEl.getAttribute('data-action-field');
        const nextValue = details.actionMeta?.[field] ?? '';
        if (fieldEl.value !== String(nextValue)) fieldEl.value = String(nextValue);
    });
};

window.app_collectCheckoutTaskUpdates = () => {
    const updates = [];
    const errors = [];
    const map = window.app_checkoutTaskDetails || {};
    Object.keys(map).forEach((key) => {
        const detail = map[key];
        if (!detail || !detail.action) return;
        const { planId, taskIndex } = window.app_parseCheckoutTaskKey(key);
        let error = '';
        if (detail.action === 'postpone') {
            const date = detail.actionMeta?.postponeDate;
            if (!date) error = 'Select a new date to postpone.';
        }
        if (detail.action === 'delegate') {
            const userId = String(detail.actionMeta?.delegateUserId || '').trim();
            if (!userId) error = 'Select a staff member to delegate.';
        }
        if (error) {
            errors.push({ key, message: error });
            return;
        }
        updates.push({
            key,
            planId,
            taskIndex,
            action: detail.action,
            progressPercent: detail.progressPercent,
            progressStatus: detail.progressStatus,
            progressNote: detail.progressNote,
            budgetHeadId: app_normalizeBudgetHeadId(detail.budgetHeadId),
            actionMeta: detail.actionMeta || {},
            timestamp: new Date().toISOString()
        });
    });
    return { updates, errors };
};

window.app_closeCheckoutActionModal = () => {
    document.getElementById('checkout-action-detail-modal')?.remove();
};

window.app_openCheckoutActionModal = (key) => {
    const details = window.app_checkoutTaskDetails?.[key];
    if (!details || !details.action) return;
    const meta = window.app_checkoutTaskMeta?.[key] || {};
    const userMap = window.app_checkoutUserMap || {};
    const currentUserId = window.AppAuth.getUser()?.id;
    const current = document.getElementById('checkout-action-detail-modal');
    if (current) current.remove();

    const actionLabel = details.action === 'complete'
        ? 'Complete'
        : details.action === 'postpone'
            ? 'Postpone'
            : details.action === 'delegate'
                ? 'Delegate'
                : 'Action';
    const chips = '';
    const postponeDate = app_escapeHtml(details.actionMeta?.postponeDate || new Date(Date.now() + 86400000).toISOString().split('T')[0]);
    const postponeReason = app_escapeHtml(details.actionMeta?.postponeReason || '');
    const completionNote = '';
    const delegateNote = app_escapeHtml(details.actionMeta?.delegateNote || '');
    const delegateUserId = app_escapeHtml(details.actionMeta?.delegateUserId || '');
    const progressNote = '';
    const candidateOptions = Object.keys(userMap).filter((userId) => String(userId) !== String(currentUserId)).map((userId) => {
        const selected = delegateUserId && delegateUserId === String(userId) ? 'selected' : '';
        return `<option value="${app_escapeHtml(userId)}" ${selected}>${app_escapeHtml(userMap[userId])}</option>`;
    }).join('');

    const modal = document.createElement('div');
    modal.id = 'checkout-action-detail-modal';
    modal.className = 'modal-overlay checkout-action-detail-modal';
    modal.setAttribute('data-checkout-key', key);
    modal.innerHTML = `
        <div class="modal-content checkout-action-detail-content">
            <div class="checkout-action-detail-header">
                <div>
                    <div class="checkout-action-detail-title">${app_escapeHtml(meta.text || 'Task')}</div>
                    <div class="checkout-action-detail-sub">${app_escapeHtml(actionLabel)} • ${details.progressPercent}% • ${app_escapeHtml(app_checkoutStatusLabels[details.progressStatus] || '')}</div>
                </div>
                <button type="button" class="checkout-action-detail-close" onclick="window.app_closeCheckoutActionModal()">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="checkout-task-panel-body">
                <div class="checkout-task-panel-header">
                    <span>Action Details</span>
                    <span class="checkout-task-saved" data-saved-indicator>Saved</span>
                </div>
                <div class="checkout-task-field">
                    <label>Progress <span class="checkout-task-progress-value" data-progress-value>${details.progressPercent}%</span></label>
                    <input type="range" min="0" max="100" value="${details.progressPercent}" data-progress-input oninput="window.app_updateCheckoutTaskProgress('${app_escapeJsSingleQuote(key)}', this.value)">
                </div>
                <div class="checkout-task-field">
                    <label>Status</label>
                    <div class="checkout-task-status-chips">
                        ${chips}
                    </div>
                </div>
                <div class="checkout-task-field">
                    <label>Note</label>
                    <textarea rows="2" data-progress-note placeholder="What changed? (optional)" oninput="window.app_updateCheckoutTaskNote('${app_escapeJsSingleQuote(key)}', this.value)">${progressNote}</textarea>
                </div>
                <div class="checkout-task-action-extra" data-action-panel-section="complete" style="display:${details.action === 'complete' ? 'block' : 'none'};">
                    <label>Completion Note</label>
                    <textarea rows="2" data-action-field="completionNote" placeholder="Optional details for completion." oninput="window.app_updateCheckoutTaskActionMeta('${app_escapeJsSingleQuote(key)}','completionNote', this.value)">${completionNote}</textarea>
                </div>
                <div class="checkout-task-action-extra" data-action-panel-section="postpone" style="display:${details.action === 'postpone' ? 'block' : 'none'};">
                    <label>New Date</label>
                    <input type="date" data-action-field="postponeDate" value="${postponeDate}" onchange="window.app_updateCheckoutTaskActionMeta('${app_escapeJsSingleQuote(key)}','postponeDate', this.value)">
                    <label>Reason</label>
                    <textarea rows="2" data-action-field="postponeReason" placeholder="Why postponed?" oninput="window.app_updateCheckoutTaskActionMeta('${app_escapeJsSingleQuote(key)}','postponeReason', this.value)">${postponeReason}</textarea>
                </div>
                <div class="checkout-task-action-extra" data-action-panel-section="delegate" style="display:${details.action === 'delegate' ? 'block' : 'none'};">
                    <label>Assign To</label>
                    <select data-action-field="delegateUserId" onchange="window.app_updateCheckoutTaskActionMeta('${app_escapeJsSingleQuote(key)}','delegateUserId', this.value)">
                        <option value="">Select staff</option>
                        ${candidateOptions}
                    </select>
                    <label>Handoff Note</label>
                    <textarea rows="2" data-action-field="delegateNote" placeholder="Handoff context (optional)." oninput="window.app_updateCheckoutTaskActionMeta('${app_escapeJsSingleQuote(key)}','delegateNote', this.value)">${delegateNote}</textarea>
                </div>
                <div class="checkout-task-inline-error" data-inline-error></div>
            </div>
            <div class="checkout-action-detail-footer">
                <button type="button" class="action-btn secondary" onclick="window.app_closeCheckoutActionModal()">Done</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    window.app_syncCheckoutTaskPanel(key);
};

window.app_renderCheckoutActionPreview = () => {
    const container = document.getElementById('checkout-action-preview');
    const list = document.getElementById('checkout-action-preview-list');
    if (!container || !list) return;
    const detailsMap = window.app_checkoutTaskDetails || {};
    const metaMap = window.app_checkoutTaskMeta || {};
    const userMap = window.app_checkoutUserMap || {};
    const items = Object.keys(detailsMap).map((key) => {
        const detail = detailsMap[key];
        if (!detail || !detail.action) return null;
        const meta = metaMap[key] || {};
        const title = meta.text || 'Task';
        const actionLabel = detail.action === 'complete'
            ? 'Complete'
            : detail.action === 'postpone'
                ? 'Postpone'
                : detail.action === 'delegate'
                    ? 'Delegate'
                    : detail.action;
        const statusLabel = app_checkoutStatusLabels[detail.progressStatus] || 'Waiting';
        const progressNote = String(detail.progressNote || '').trim();
        let extra = '';
        if (detail.action === 'postpone') {
            const date = app_normalizeIsoDate(detail.actionMeta?.postponeDate) || '—';
            const reason = String(detail.actionMeta?.postponeReason || '').trim();
            extra = `New date: ${app_escapeHtml(date)}${reason ? ` • Reason: ${app_escapeHtml(reason)}` : ''}`;
        }
        if (detail.action === 'delegate') {
            const userId = String(detail.actionMeta?.delegateUserId || '');
            const userName = userMap[userId] || '—';
            const note = String(detail.actionMeta?.delegateNote || '').trim();
            extra = `Assigned to: ${app_escapeHtml(userName)}${note ? ` • Note: ${app_escapeHtml(note)}` : ''}`;
        }
        if (detail.action === 'complete') {
            const note = String(detail.actionMeta?.completionNote || '').trim();
            extra = note ? `Completion note: ${app_escapeHtml(note)}` : '';
        }
        return `
            <div class="checkout-action-preview-item">
                <div class="checkout-action-preview-title">${app_escapeHtml(title)}</div>
                <div class="checkout-action-preview-meta">
                    <span class="checkout-action-preview-chip">${app_escapeHtml(actionLabel)}</span>
                    <span>${detail.progressPercent}% • ${app_escapeHtml(statusLabel)}</span>
                </div>
                ${progressNote ? `<div class="checkout-action-preview-note">${app_escapeHtml(progressNote)}</div>` : ''}
                ${extra ? `<div class="checkout-action-preview-extra">${extra}</div>` : ''}
            </div>
        `;
    }).filter(Boolean);
    if (items.length === 0) {
        container.style.display = 'none';
        list.innerHTML = '';
        return;
    }
    container.style.display = 'block';
    list.innerHTML = items.join('');
};

window.app_openCheckoutActionModal = (key) => {
    const details = window.app_checkoutTaskDetails?.[key];
    if (!details || !details.action) return;
    const meta = window.app_checkoutTaskMeta?.[key] || {};
    const userMap = window.app_checkoutUserMap || {};
    const currentUserId = window.AppAuth.getUser()?.id;
    document.getElementById('checkout-action-detail-modal')?.remove();

    const actionLabel = details.action === 'complete'
        ? 'Complete'
        : details.action === 'postpone'
            ? 'Postpone'
            : details.action === 'delegate'
                ? 'Delegate'
                : 'Action';
    const postponeDate = app_escapeHtml(details.actionMeta?.postponeDate || new Date(Date.now() + 86400000).toISOString().split('T')[0]);
    const postponeReason = app_escapeHtml(details.actionMeta?.postponeReason || '');
    const delegateNote = app_escapeHtml(details.actionMeta?.delegateNote || '');
    const delegateUserId = app_escapeHtml(details.actionMeta?.delegateUserId || '');
    const candidateOptions = Object.keys(userMap)
        .filter((userId) => String(userId) !== String(currentUserId))
        .map((userId) => {
            const selected = delegateUserId && delegateUserId === String(userId) ? 'selected' : '';
            return `<option value="${app_escapeHtml(userId)}" ${selected}>${app_escapeHtml(userMap[userId])}</option>`;
        }).join('');

    const modal = document.createElement('div');
    modal.id = 'checkout-action-detail-modal';
    modal.className = 'modal-overlay checkout-action-detail-modal';
    modal.setAttribute('data-checkout-key', key);
    modal.innerHTML = `
        <div class="modal-content checkout-action-detail-content">
            <div class="checkout-action-detail-header">
                <div>
                    <div class="checkout-action-detail-title">${app_escapeHtml(meta.text || 'Task')}</div>
                    <div class="checkout-action-detail-sub">${app_escapeHtml(actionLabel)} details</div>
                </div>
                <button type="button" class="checkout-action-detail-close" onclick="window.app_closeCheckoutActionModal()">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="checkout-task-panel-body">
                <div class="checkout-task-panel-header">
                    <span>${app_escapeHtml(actionLabel)}</span>
                    <span class="checkout-task-saved" data-saved-indicator>Saved</span>
                </div>
                <div class="checkout-task-action-extra" data-action-panel-section="complete" style="display:${details.action === 'complete' ? 'block' : 'none'};">
                    <div class="checkout-task-action-help">This task will be marked completed during check-out.</div>
                </div>
                <div class="checkout-task-action-extra" data-action-panel-section="postpone" style="display:${details.action === 'postpone' ? 'block' : 'none'};">
                    <label>New Date</label>
                    <input type="date" data-action-field="postponeDate" value="${postponeDate}" onchange="window.app_updateCheckoutTaskActionMeta('${app_escapeJsSingleQuote(key)}','postponeDate', this.value)">
                    <label>Reason</label>
                    <textarea rows="2" data-action-field="postponeReason" placeholder="Optional reason" oninput="window.app_updateCheckoutTaskActionMeta('${app_escapeJsSingleQuote(key)}','postponeReason', this.value)">${postponeReason}</textarea>
                </div>
                <div class="checkout-task-action-extra" data-action-panel-section="delegate" style="display:${details.action === 'delegate' ? 'block' : 'none'};">
                    <label>Assign To</label>
                    <select data-action-field="delegateUserId" onchange="window.app_updateCheckoutTaskActionMeta('${app_escapeJsSingleQuote(key)}','delegateUserId', this.value)">
                        <option value="">Select staff</option>
                        ${candidateOptions}
                    </select>
                    <label>Handoff Note</label>
                    <textarea rows="2" data-action-field="delegateNote" placeholder="Handoff context (optional)." oninput="window.app_updateCheckoutTaskActionMeta('${app_escapeJsSingleQuote(key)}','delegateNote', this.value)">${delegateNote}</textarea>
                </div>
                <div class="checkout-task-inline-error" data-inline-error></div>
            </div>
            <div class="checkout-action-detail-footer">
                <button type="button" class="action-btn secondary" onclick="window.app_closeCheckoutActionModal()">Done</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    window.app_syncCheckoutTaskPanel(key);
};

window.app_renderCheckoutActionPreview = () => {
    const container = document.getElementById('checkout-action-preview');
    const list = document.getElementById('checkout-action-preview-list');
    if (!container || !list) return;
    const detailsMap = window.app_checkoutTaskDetails || {};
    const metaMap = window.app_checkoutTaskMeta || {};
    const userMap = window.app_checkoutUserMap || {};
    const items = Object.keys(detailsMap).map((key) => {
        const detail = detailsMap[key];
        if (!detail || !detail.action) return null;
        const meta = metaMap[key] || {};
        const title = meta.text || 'Task';
        const actionLabel = detail.action === 'complete'
            ? 'Complete'
            : detail.action === 'postpone'
                ? 'Postpone'
                : detail.action === 'delegate'
                    ? 'Delegate'
                    : detail.action;
        let extra = '';
        if (detail.action === 'postpone') {
            const date = app_normalizeIsoDate(detail.actionMeta?.postponeDate) || '--';
            const reason = String(detail.actionMeta?.postponeReason || '').trim();
            extra = `New date: ${app_escapeHtml(date)}${reason ? ` • Reason: ${app_escapeHtml(reason)}` : ''}`;
        }
        if (detail.action === 'delegate') {
            const userId = String(detail.actionMeta?.delegateUserId || '');
            const userName = userMap[userId] || '--';
            const note = String(detail.actionMeta?.delegateNote || '').trim();
            extra = `Assigned to: ${app_escapeHtml(userName)}${note ? ` • Note: ${app_escapeHtml(note)}` : ''}`;
        }
        return `
            <div class="checkout-action-preview-item">
                <div class="checkout-action-preview-title">${app_escapeHtml(title)}</div>
                <div class="checkout-action-preview-meta">
                    <span class="checkout-action-preview-chip">${app_escapeHtml(actionLabel)}</span>
                </div>
                ${extra ? `<div class="checkout-action-preview-extra">${extra}</div>` : ''}
            </div>
        `;
    }).filter(Boolean);
    if (items.length === 0) {
        container.style.display = 'none';
        list.innerHTML = '';
        return;
    }
    container.style.display = 'block';
    list.innerHTML = items.join('');
};

window.app_applyCheckoutTaskUpdates = async (updates = [], options = {}) => {
    if (!Array.isArray(updates) || updates.length === 0) return;
    const currentUser = window.AppAuth.getUser();
    const updaterId = currentUser?.id || currentUser?.name || 'staff';
    const effectiveDate = String(options.effectiveDate || new Date().toISOString().split('T')[0]);
    const eventTimestamp = String(options.timestamp || new Date().toISOString());
    for (const update of updates) {
        const plan = await window.AppDB.get('work_plans', update.planId).catch(() => null);
        if (!plan || !Array.isArray(plan.plans)) continue;
        const task = plan.plans[update.taskIndex];
        if (!task) continue;
        task.progressPercent = update.progressPercent;
        task.progressStatus = update.progressStatus;
        task.progressNote = update.progressNote;
        task.budgetHeadId = app_normalizeBudgetHeadId(update.budgetHeadId || task.budgetHeadId);
        task.lastProgressUpdateAt = update.timestamp;
        task.lastProgressUpdateBy = updaterId;
        task.lastCheckoutAction = update.action;
        if (update.action === 'complete') {
            task.status = 'completed';
            if (!task.completedDate) task.completedDate = effectiveDate;
        }
        if (update.action === 'postpone') {
            task.status = 'postponed';
        }
        plan.updatedAt = new Date().toISOString();
        await window.AppDB.put('work_plans', plan);
        if (update.action === 'postpone') {
            const postponeDate = app_normalizeIsoDate(update.actionMeta?.postponeDate);
            if (postponeDate) {
                const detailSuffix = (task.subPlans && task.subPlans.length) ? ` - ${task.subPlans.join(', ')}` : '';
                const baseText = `${task.task}${detailSuffix}`;
                const fromDate = plan.date || effectiveDate;
                const cleanedText = baseText.replace(/\s*\(Postponed from [^)]+\)\s*$/i, '');
                const postponedText = `${cleanedText} (Postponed from ${fromDate})`;
                await window.AppCalendar.addWorkPlanTask(postponeDate, currentUser.id, postponedText, [], {
                    addedFrom: 'postponed',
                    sourcePlanId: update.planId,
                    sourceTaskIndex: update.taskIndex,
                    postponedFromDate: fromDate
                });
            }
        }
        if (update.action === 'delegate') {
            const delegateUserId = String(update.actionMeta?.delegateUserId || '').trim();
            if (delegateUserId) {
                await window.app_delegateTo(update.planId, update.taskIndex, delegateUserId, {
                    silent: true,
                    skipDashboardRefresh: true
                });
            }
        }
        await window.AppDB.add('task_activity_events', {
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            eventType: `task_${update.action}`,
            taskId: `${update.planId}:${update.taskIndex}`,
            planId: update.planId,
            taskIndex: update.taskIndex,
            userId: currentUser?.id || '',
            actorId: updaterId,
            budgetHeadId: app_normalizeBudgetHeadId(update.budgetHeadId || task.budgetHeadId),
            progressPercent: Number(update.progressPercent || 0),
            progressStatus: String(update.progressStatus || ''),
            note: String(update.progressNote || ''),
            timestamp: update.timestamp || eventTimestamp,
            effectiveDate
        }).catch(() => null);
    }
    if (window.AppStore && window.AppStore.invalidatePlans) {
        window.AppStore.invalidatePlans();
    }
};



window.app_deleteDayPlan = async (date, targetUserId = null, planScope = null) => {
    if (!await window.appConfirm("Are you sure you want to delete this work plan?")) return;
    const currentUser = window.AppAuth.getUser();
    const targetId = app_resolveTargetUserId(targetUserId, currentUser.id);

    try {
        const hasScope = planScope === 'personal' || planScope === 'annual';
        if (hasScope) {
            await window.AppCalendar.deleteWorkPlan(date, targetId, { planScope: planScope });
        } else {
            await Promise.all([
                window.AppCalendar.deleteWorkPlan(date, targetId, { planScope: 'personal' }),
                window.AppCalendar.deleteWorkPlan(date, targetId, { planScope: 'annual' })
            ]);
        }
        if (window.AppStore && window.AppStore.invalidatePlans) {
            window.AppStore.invalidatePlans(); // CACHE INVALIDATION
        }
        document.getElementById('day-plan-modal')?.remove();
        if (window.app_showSyncToast) {
            window.app_showSyncToast('Plan deleted!');
        } else {
            alert('Plan deleted!');
        }
    } catch (err) {
        console.error('Delete day plan failed:', err);
        if (window.app_showSyncToast) {
            window.app_showSyncToast('Failed to delete plan: ' + err.message);
        } else {
            alert(err.message);
        }
    }
};

window.app_saveDayPlan = async (e, date, targetUserId = null) => {
    e.preventDefault();
    const restore = typeof window.app_asyncButton === 'function' ? window.app_asyncButton(e.target.querySelector('.day-plan-save-btn')) : () => {};
    const currentUser = window.AppAuth.getUser();
    const targetId = app_resolveTargetUserId(targetUserId, currentUser.id);
    const form = e.target;
    const hadPersonal = form?.dataset?.hadPersonal === '1';
    const hadAnnual = form?.dataset?.hadAnnual === '1';
    let removedTasks = [];
    try {
        removedTasks = JSON.parse(form?.dataset?.removedTasks || '[]');
    } catch {
        removedTasks = [];
    }

    if (form && typeof form._dayPlanFlushPending === 'function') {
        form._dayPlanFlushPending();
    }

    const planBlocks = form ? form.querySelectorAll('.plan-block') : document.querySelectorAll('.plan-block');
    const plans = [];
    const personalPlans = [];
    const annualPlans = [];
    const planIdsByScope = {};
    let validationError = '';

    planBlocks.forEach(block => {
        const task = block.querySelector('.plan-task').value.trim();
        const subPlanInputs = block.querySelectorAll('.sub-plan-input');
        const subPlans = Array.from(subPlanInputs).map(input => input.value.trim()).filter(v => v !== '');
        const tagChips = block.querySelectorAll('.tag-chip');
        const tags = Array.from(tagChips).map(chip => ({
            id: chip.dataset.id,
            name: chip.dataset.name,
            status: chip.dataset.status || 'pending'
        }));
        const status = block.querySelector('.plan-status').value;
        const assigneeSelect = block.querySelector('.plan-assignee');
        const assignedTo = assigneeSelect ? assigneeSelect.value : targetId;
        const startDateInput = block.querySelector('.plan-start-date');
        const endDateInput = block.querySelector('.plan-end-date');
        const startDate = startDateInput ? String(startDateInput.value || '').trim() : '';
        const endDate = endDateInput ? String(endDateInput.value || '').trim() : '';
        const rootIdInput = block.querySelector('.plan-root-id');
        const carryForwardRootId = rootIdInput ? String(rootIdInput.value || '').trim() : '';
        const scopeSelect = block.querySelector('.plan-scope');
        const budgetHeadSelect = block.querySelector('.plan-budget-head');
        const taskScope = scopeSelect && scopeSelect.value === 'annual' ? 'annual' : 'personal';
        const budgetHeadId = String(budgetHeadSelect?.value || currentUser.currentBudgetHeadId || 'UNALLOCATED');

        if (task) {
            if ((startDate && !endDate) || (!startDate && endDate)) {
                validationError = 'Please select both From Date and To Date for ranged tasks.';
                return;
            }
            if (startDate && endDate && endDate < startDate) {
                validationError = 'To Date cannot be earlier than From Date.';
                return;
            }
            const taskStartDate = startDate || date;
            const taskEndDate = endDate || date;
            const planPayload = {
                task,
                subPlans,
                tags,
                status: status || null,
                assignedTo: assignedTo || null,
                budgetHeadId,
                startDate: taskStartDate,
                endDate: taskEndDate,
                planScope: taskScope,
                carryForwardRootId: carryForwardRootId || null,
                completedDate: status === 'completed' ? new Date().toISOString().split('T')[0] : null
            };
            plans.push(planPayload);
            if (taskScope === 'annual') annualPlans.push(planPayload);
            else personalPlans.push(planPayload);
        }
    });

    removedTasks.forEach((removedTask) => {
        const normalizedRootId = String(removedTask?.rootId || '').trim();
        const removedScope = removedTask?.scope === 'annual' ? 'annual' : 'personal';
        if (!normalizedRootId) return;
        const removedPayload = {
            task: '[Removed Task]',
            subPlans: [],
            tags: [],
            status: 'not-completed',
            assignedTo: targetId || null,
            budgetHeadId: currentUser.currentBudgetHeadId || 'UNALLOCATED',
            startDate: date,
            endDate: date,
            planScope: removedScope,
            carryForwardRootId: normalizedRootId,
            isRemoved: true,
            removedAt: new Date().toISOString()
        };
        plans.push(removedPayload);
        if (removedScope === 'annual') annualPlans.push(removedPayload);
        else personalPlans.push(removedPayload);
    });

    if (validationError) {
        alert(validationError);
        restore();
        return;
    }

    let skipSave = false;
    try {
        if (plans.length === 0) {
            if (!hadPersonal && !hadAnnual) {
                alert("Please add at least one task.");
                restore();
                return;
            }
            // No tasks to save. Delete existing plans once then skip to the UI refresh.
            const deletions = [];
            if (hadPersonal) deletions.push(window.AppCalendar.deleteWorkPlan(date, targetId, { planScope: 'personal' }));
            if (hadAnnual) deletions.push(window.AppCalendar.deleteWorkPlan(date, targetId, { planScope: 'annual' }));
            await Promise.all(deletions);
            // Skip the setWorkPlan / deleteWorkPlan branches below and go straight to refresh.
            skipSave = true;
            // (fall through to refresh, not re-delete)
        }

        if (!skipSave) {
            // Batch personal + annual writes into a single parallel Firestore call
            const activeScopes = [];
            if (personalPlans.length > 0) activeScopes.push('personal');
            if (annualPlans.length > 0) activeScopes.push('annual');

            if (activeScopes.length > 0) {
                // Merge both plan arrays so the single call writes all tasks
                const mergedPlans = [...personalPlans, ...annualPlans];
                await window.AppCalendar.setWorkPlan(date, mergedPlans, targetId, {
                    planScope: activeScopes,
                    skipCacheInvalidation: true  // we handle it once below
                });
            }

            // Delete scopes that had plans before but now have none
            if (hadPersonal && personalPlans.length === 0) {
                await window.AppCalendar.deleteWorkPlan(date, targetId, { planScope: 'personal' });
            }
            if (hadAnnual && annualPlans.length === 0) {
                await window.AppCalendar.deleteWorkPlan(date, targetId, { planScope: 'annual' });
            }

            // Cache invalidation — once, at the top level
            if (window.AppCalendar && window.AppCalendar.invalidateCarryForwardCache) {
                window.AppCalendar.invalidateCarryForwardCache();
            }
        }

        if (window.AppStore && window.AppStore.invalidatePlans) {
            window.AppStore.invalidatePlans();
        }

        // Build planIdsByScope for the background notification code below
        if (personalPlans.length > 0) {
            planIdsByScope.personal = window.AppCalendar.getWorkPlanId(date, targetId, 'personal');
        }
        if (annualPlans.length > 0) {
            planIdsByScope.annual = window.AppCalendar.getWorkPlanId(date, targetId, 'annual');
        }

        // Close modal and show non-blocking success toast — no more alert()
        document.getElementById('day-plan-modal')?.remove();
        if (window.app_showSyncToast) {
            window.app_showSyncToast("Plans saved successfully!");
        }

                // ── Background: notifications and tagged tasks ────────────────
        (async () => {
            try {
                // Notify the owner if edited by an admin
                if (targetId !== currentUser.id && (currentUser.role === 'Administrator' || currentUser.isAdmin)) {
                    const owner = await window.AppDB.get('users', targetId).catch(() => null);
                    if (owner) {
                        if (!owner.notifications) owner.notifications = [];
                        const lastNotif = owner.notifications[owner.notifications.length - 1];
                        if (!lastNotif || lastNotif.message !== `Admin ${currentUser.name} has edited your Work Plan for ${date}`) {
                            owner.notifications.push({
                                type: 'admin_edit',
                                message: `Admin ${currentUser.name} has edited your Work Plan for ${date}`,
                                date: new Date().toLocaleString(),
                                read: false
                            });
                            await window.AppDB.put('users', owner);
                        }
                    }
                }

                // 2. Send Notifications to newly tagged users (parallelized)
                const distinctTaggedUsers = new Set();
                plans.forEach(p => {
                    if (p.tags) p.tags.forEach(t => distinctTaggedUsers.add(t.id));
                });

                if (distinctTaggedUsers.size > 0) {
                    const notificationPromises = [];
                    for (const uid of distinctTaggedUsers) {
                        if (uid === currentUser.id) continue;
                        const targetUser = await window.AppDB.get('users', uid).catch(() => null);
                        if (!targetUser) continue;
                        if (!targetUser.notifications) targetUser.notifications = [];
                        plans.forEach((p, idx) => {
                            if (p.tags && p.tags.some(t => t.id === uid)) {
                                const scopeKey = p.planScope === 'annual' ? 'annual' : 'personal';
                                const scopedPlanId = planIdsByScope[scopeKey] || window.AppCalendar.getWorkPlanId(date, targetId, scopeKey);
                                if (!targetUser.notifications.some((n) => {
                                    const notifType = String(n?.type || '').toLowerCase();
                                    return (notifType === 'tag' || notifType === 'mention')
                                        && String(n.planId || '') === String(scopedPlanId || '')
                                        && Number(n.taskIndex) === Number(idx)
                                        && String(n.taggedById || '') === String(currentUser.id || '');
                                })) {
                                    targetUser.notifications.push({
                                        id: `tag_${Date.now()}_${uid}_${idx}`,
                                        type: 'tag',
                                        title: p.task || 'Tagged task',
                                        description: p.subPlans && p.subPlans.length > 0 ? p.subPlans.join(', ') : '',
                                        taggedById: currentUser.id,
                                        taggedByName: currentUser.name,
                                        taggedAt: new Date().toISOString(),
                                        status: 'pending',
                                        source: 'plan',
                                        planId: scopedPlanId,
                                        taskIndex: idx,
                                        message: `${currentUser.name} tagged you in: "${p.task}" for ${date}`,
                                        date: new Date().toLocaleString(),
                                        read: false
                                    });
                                }
                            }
                        });
                        notificationPromises.push(window.AppDB.put('users', targetUser));
                    }
                    await Promise.all(notificationPromises);

                    // 3. Create tagged work plan tasks
                    const tagTaskPromises = [];
                    for (let idx = 0; idx < plans.length; idx++) {
                        const p = plans[idx];
                        if (!p.tags) continue;
                        for (const t of p.tags) {
                            if (t.id === targetId) continue;
                            const recipient = await window.AppDB.get('users', t.id).catch(() => null);
                            if (!recipient || !window.AppCalendar) continue;
                            const scopeKey = p.planScope === 'annual' ? 'annual' : 'personal';
                            const scopedPlanId = planIdsByScope[scopeKey] || window.AppCalendar.getWorkPlanId(date, targetId, scopeKey);
                            const details = p.subPlans && p.subPlans.length > 0 ? ` - ${p.subPlans.join(', ')}` : '';
                            const taskText = `${p.task}${details} (Responsible: ${recipient.name})`;
                            tagTaskPromises.push(window.AppCalendar.addWorkPlanTask(
                                date, recipient.id, taskText,
                                [{ id: currentUser.id, name: currentUser.name, status: 'pending' }],
                                { addedFrom: 'tag', sourcePlanId: scopedPlanId, sourceTaskIndex: idx, taggedById: currentUser.id, taggedByName: currentUser.name, status: 'pending', subPlans: p.subPlans || [], startDate: p.startDate || date, endDate: p.endDate || p.startDate || date }
                            ));
                        }
                    }
                    if (tagTaskPromises.length > 0) await Promise.all(tagTaskPromises);
                }
            } catch (err) {
                console.warn('Background plan notifications failed:', err);
            }
        })();
    } catch (err) {
        console.error('Save day plan failed:', err);
        if (window.app_showSyncToast) {
            window.app_showSyncToast('Failed to save plans: ' + err.message);
        } else {
            alert(err.message);
        }
    } finally {
        restore();
    }
};

window.app_handleTagResponse = async (planId, taskIndex, response, notifIdx) => {
    const user = window.AppAuth.getUser();
    try {
        // 1. Fetch the original work plan
        const plan = planId ? await window.AppDB.get('work_plans', planId).catch(() => null) : null;

        // ── Graceful fallback ──────────────────────────────────────────────────
        // If the plan document doesn't exist anymore, or the taskIndex is invalid
        // (e.g. notification created for a direct tag without a work_plan backing it),
        // fall back to updating only the notification record via app_handleTagDecision.
        if (!plan || !plan.plans || !plan.plans[taskIndex]) {
            console.warn(`app_handleTagResponse: plan/task not found for planId=${planId}, taskIdx=${taskIndex}. Falling back to notification-only update.`);
            // Find the notification ID from notifIdx
            const freshUser = await window.AppDB.get('users', user.id).catch(() => null);
            const notifId = freshUser?.notifications?.[notifIdx]?.id || null;
            if (notifId || notifIdx >= 0) {
                await window.app_handleTagDecision(notifId || String(notifIdx), response);
            } else {
                // Minimal update: just mark the notification as read/dismissed
                if (freshUser?.notifications?.[notifIdx]) {
                    const nowIso = new Date().toISOString();
                    freshUser.notifications[notifIdx].status = response;
                    freshUser.notifications[notifIdx].respondedAt = nowIso;
                    freshUser.notifications[notifIdx].read = true;
                    freshUser.notifications[notifIdx].dismissedAt = nowIso;
                    await window.AppDB.put('users', freshUser);
                }
                const contentArea = document.getElementById('page-content');
                if (contentArea) {
                    contentArea.innerHTML = await AppUI.renderDashboard();
                    if (window.setupDashboardEvents) window.setupDashboardEvents();
                }
                alert(`You have ${response} the request.`);
            }
            return;
        }
        // ──────────────────────────────────────────────────────────────────────

        // 2. Update the tag status for the current user in the work plan
        const task = plan.plans[taskIndex];
        if (task.tags) {
            const myTag = task.tags.find(t => t.id === user.id);
            if (myTag) {
                myTag.status = response;
            }
        }

        // 3. Save the updated plan
        await window.AppDB.put('work_plans', plan);

        // 4. Update notification status (do not remove)
        const updatedUser = await window.AppDB.get('users', user.id);
        let rejectReason = '';
        if (response === 'rejected') {
            rejectReason = (await window.appPrompt('Optional: add a rejection reason', '', { title: 'Reject Task', confirmText: 'Submit Reason' })) || '';
        }
        if (updatedUser && updatedUser.notifications) {
            const notif = updatedUser.notifications[notifIdx];
            if (notif) {
                const nowIso = new Date().toISOString();
                notif.status = response;
                notif.respondedAt = nowIso;
                notif.read = true;
                notif.dismissedAt = nowIso;
                if (rejectReason) notif.rejectReason = rejectReason;
            }
            if (!updatedUser.tagHistory) updatedUser.tagHistory = [];
            updatedUser.tagHistory.unshift({
                id: `taghist_${Date.now()}`,
                type: 'tag_response',
                title: notif?.title || plan.plans[taskIndex].task || 'Tagged task',
                taggedByName: notif?.taggedByName || plan.userName || 'Staff',
                status: response,
                reason: rejectReason,
                date: new Date().toISOString()
            });
            await window.AppDB.put('users', updatedUser);
        }

        // 4b. Notify the tagger
        if (plan.userId) {
            const tagger = await window.AppDB.get('users', plan.userId);
            if (tagger) {
                if (!tagger.notifications) tagger.notifications = [];
                tagger.notifications.unshift({
                    id: `tagresp_${Date.now()}`,
                    type: 'tag_response',
                    message: `${user.name} ${response} your tag request.`,
                    title: plan.plans[taskIndex].task,
                    taggedByName: user.name,
                    status: response,
                    reason: rejectReason,
                    date: new Date().toISOString(),
                    read: false
                });
                await window.AppDB.put('users', tagger);
            }
        }

        // 5. Refresh UI
        if (window.AppStore && window.AppStore.invalidatePlans) {
            window.AppStore.invalidatePlans();
        }
        const contentArea = document.getElementById('page-content');
        if (contentArea) {
            contentArea.innerHTML = await AppUI.renderDashboard();
            if (window.setupDashboardEvents) window.setupDashboardEvents();
        }

        alert(`You have ${response} the collaboration request.`);
    } catch (err) {
        console.error('app_handleTagResponse error:', err);
        alert('Error processing your response. Please try again.');
    }
};


window.app_changeCalMonth = (delta) => {
    let newMonth = window.app_calMonth + delta;
    if (newMonth < 0) { window.app_calYear--; newMonth = 11; }
    if (newMonth > 11) { window.app_calYear++; newMonth = 0; }
    window.app_calMonth = newMonth;
    // Refresh Dashboard
    AppUI.renderDashboard().then(async html => {
        const contentArea = document.getElementById('page-content');
        contentArea.innerHTML = html;
        // Re-setup dashboard specific events (like attendance button)
        setupDashboardEvents();
    });
};

window.app_exportCalendar = async () => {
    const plans = window._currentPlans;
    const month = window.app_calMonth;
    const year = window.app_calYear;

    if (!plans) {
        alert("Calendar data not loaded yet.");
        return;
    }

    try {
        await window.AppReports.exportCalendarPlansCSV(plans, month, year);
    } catch (err) {
        alert("Export failed: " + err.message);
    }
};

// Meeting Minutes Handlers
window.app_newMeeting = async () => {
    const user = window.AppAuth.getUser();
    const newMeeting = {
        id: 'meeting_' + Date.now(),
        title: '',
        date: new Date().toISOString().split('T')[0],
        minutes: '',
        author: user.name,
        timestamp: new Date().toISOString()
    };

    await window.AppDB.put('meetings', newMeeting);
    window._selectedMeetingId = newMeeting.id;

    const contentArea = document.getElementById('page-content');
    contentArea.innerHTML = await AppUI.renderMinutes();
};

window.app_selectMeeting = async (id) => {
    window._selectedMeetingId = id;
    const contentArea = document.getElementById('page-content');
    contentArea.innerHTML = await AppUI.renderMinutes();
};

window.app_saveMeeting = async () => {
    const title = document.getElementById('meeting-title')?.value;
    const date = document.getElementById('meeting-date')?.value;
    const minutes = document.getElementById('meeting-minutes')?.value;

    if (!window._selectedMeetingId) {
        alert('No meeting selected');
        return;
    }

    const meeting = await window.AppDB.get('meetings', window._selectedMeetingId);
    if (!meeting) {
        alert('Meeting not found');
        return;
    }

    meeting.title = title;
    meeting.date = date;
    meeting.minutes = minutes;
    meeting.timestamp = new Date().toISOString();

    await window.AppDB.put('meetings', meeting);

    const contentArea = document.getElementById('page-content');
    contentArea.innerHTML = await AppUI.renderMinutes();

    alert('Meeting minutes saved successfully!');
};

window.app_deleteMeeting = async (id) => {
    if (!await window.appConfirm('Are you sure you want to delete this meeting?')) return;

    await window.AppDB.delete('meetings', id);
    window._selectedMeetingId = null;

    const contentArea = document.getElementById('page-content');
    contentArea.innerHTML = await AppUI.renderMinutes();
};


// Helper to postpone a task
window.app_postponeTask = async (planId, taskIndex, targetDate) => {
    if (!targetDate) return;
    try {
        await window.AppCalendar.updateTaskStatus(planId, taskIndex, 'postponed');
        const plan = await window.AppDB.get('work_plans', planId);
        const task = plan?.plans?.[taskIndex];
        const ownerUserId = String(plan?.userId || window.AppAuth.getUser()?.id || '').trim();
        if (!ownerUserId) throw new Error('Task owner not found.');
        const details = (task && task.subPlans && task.subPlans.length) ? ` - ${task.subPlans.join(', ')}` : '';
        const text = task ? `${task.task}${details}` : '';
        const fromDate = plan?.date || new Date().toISOString().split('T')[0];
        const cleanedText = text.replace(/\s*\(Postponed from [^)]+\)\s*$/i, '');
        const postponedText = `${cleanedText} (Postponed from ${fromDate})`;
        await window.AppCalendar.addWorkPlanTask(targetDate, ownerUserId, postponedText, [], {
            addedFrom: 'postponed',
            sourcePlanId: planId,
            sourceTaskIndex: taskIndex,
            postponedFromDate: fromDate
        });
        if (window.AppStore && window.AppStore.invalidatePlans) window.AppStore.invalidatePlans();
        alert(`Task postponed to ${targetDate}`);
        if (typeof handleAttendance === 'function') await handleAttendance();
    } catch (err) {
        alert("Failed to postpone task: " + err.message);
    }
};

window.app_openPostponeModal = function (planId, taskIndex) {
    const modalId = 'postpone-task-modal';
    document.getElementById(modalId)?.remove();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const html = `
            <div class="modal-overlay" id="${modalId}" style="display:flex;">
                <div class="modal-content" style="max-width:420px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem;">
                        <h3 style="margin:0; font-size:1.05rem;">Postpone Task</h3>
                        <button type="button" onclick="document.getElementById('${modalId}')?.remove()" style="background:none; border:none; font-size:1.1rem; cursor:pointer;">&times;</button>
                    </div>
                    <label for="postpone-date-input" style="display:block; margin-bottom:0.35rem; font-size:0.85rem; color:#475569; font-weight:600;">Select date</label>
                    <input id="postpone-date-input" type="date" value="${tomorrow}" style="width:100%; padding:0.6rem; border:1px solid #d1d5db; border-radius:8px;">
                    <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1rem;">
                        <button type="button" class="action-btn secondary" onclick="document.getElementById('${modalId}')?.remove()" style="padding:0.55rem 0.9rem;">Cancel</button>
                        <button type="button" class="action-btn" onclick="window.app_confirmPostponeTask('${planId}', ${taskIndex})" style="padding:0.55rem 0.9rem;">Confirm</button>
                    </div>
                </div>
            </div>`;
    window.app_showModal(html, modalId);
};

window.app_confirmPostponeTask = async function (planId, taskIndex) {
    const targetDate = document.getElementById('postpone-date-input')?.value;
    if (!targetDate) return alert('Please select a date.');
    document.getElementById('postpone-task-modal')?.remove();
    await window.app_postponeTask(planId, taskIndex, targetDate);
};

window.app_openDelegateModal = async function (planId, taskIndex) {
    const modalId = 'delegate-task-modal';
    document.getElementById(modalId)?.remove();
    const users = await window.AppDB.getAll('users').catch(() => []);
    const currentUser = window.AppAuth.getUser();
    const candidates = (users || []).filter(u => u.id !== currentUser.id);
    window.app_delegateModalContext = { planId, taskIndex, selectedUserId: '' };
    const list = candidates.map(u => `
            <button type="button" class="delegate-picker-item" data-user-id="${u.id}" data-name="${(u.name || '').toLowerCase()}" onclick="window.app_selectDelegateUser('${u.id}')">
                <img src="${u.avatar || ''}" alt="${u.name}" class="delegate-user-avatar">
                <span>${u.name}</span>
            </button>
        `).join('');
    const html = `
            <div class="modal-overlay" id="${modalId}" style="display:flex;">
                <div class="modal-content" style="max-width:480px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem;">
                        <h3 style="margin:0; font-size:1.05rem;">Delegate Task</h3>
                        <button type="button" onclick="document.getElementById('${modalId}')?.remove()" style="background:none; border:none; font-size:1.1rem; cursor:pointer;">&times;</button>
                    </div>
                    <input id="delegate-search-input" type="text" placeholder="Search staff..." oninput="window.app_filterDelegateUsers(this.value)" style="width:100%; padding:0.6rem; border:1px solid #d1d5db; border-radius:8px; margin-bottom:0.7rem;">
                    <div id="delegate-picker-list" class="delegate-picker-list">${list || '<div style="font-size:0.85rem; color:#64748b;">No staff available.</div>'}</div>
                    <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1rem;">
                        <button type="button" class="action-btn secondary" onclick="document.getElementById('${modalId}')?.remove()" style="padding:0.55rem 0.9rem;">Cancel</button>
                        <button type="button" id="delegate-confirm-btn" class="action-btn" onclick="window.app_confirmDelegateTask()" style="padding:0.55rem 0.9rem;" disabled>Delegate</button>
                    </div>
                </div>
            </div>`;
    window.app_showModal(html, modalId);
};

window.app_filterDelegateUsers = function (query) {
    const q = String(query || '').toLowerCase().trim();
    Array.from(document.querySelectorAll('#delegate-picker-list .delegate-picker-item')).forEach(item => {
        const name = item.getAttribute('data-name') || '';
        item.style.display = (!q || name.includes(q)) ? 'flex' : 'none';
    });
};

window.app_selectDelegateUser = function (userId) {
    if (!window.app_delegateModalContext) return;
    window.app_delegateModalContext.selectedUserId = userId;
    Array.from(document.querySelectorAll('#delegate-picker-list .delegate-picker-item')).forEach(item => {
        item.classList.toggle('selected', item.getAttribute('data-user-id') === userId);
    });
    const btn = document.getElementById('delegate-confirm-btn');
    if (btn) btn.disabled = !userId;
};

window.app_confirmDelegateTask = async function () {
    const ctx = window.app_delegateModalContext;
    if (!ctx || !ctx.selectedUserId) return alert('Please select a staff member.');
    document.getElementById('delegate-task-modal')?.remove();
    await window.app_delegateTo(ctx.planId, ctx.taskIndex, ctx.selectedUserId);
};

window.app_formatTaskWithPostponeChip = function (text) {
    const raw = String(text || '');
    const match = raw.match(/^(.*)\s+\(Postponed from ([^)]+)\)\s*$/i);
    if (!match) return raw;
    const base = match[1].trim();
    const fromDate = match[2].trim();
    return `${base} <span class="postponed-source-chip">Postponed from ${fromDate}</span>`;
};

window.app_appendCompletedTaskToSummary = async function (planId, taskIndex) {
    const plan = await window.AppDB.get('work_plans', planId);
    const task = plan?.plans?.[taskIndex];
    if (!task) return;
    const details = (task.subPlans && task.subPlans.length) ? ` (${task.subPlans.join(', ')})` : '';
    const line = `- ${task.task}${details}`;
    const summaryTextarea = document.getElementById('checkout-work-summary');
    const current = (summaryTextarea?.value || window.app_checkoutSummaryDraft || '').trim();
    const exists = current.split('\n').some(l => l.trim() === line.trim());
    const next = exists ? current : (current ? `${current}\n${line}` : line);
    window.app_checkoutSummaryDraft = next;
    if (summaryTextarea) {
        summaryTextarea.value = next;
        if (window.app_updateCharCounter) window.app_updateCharCounter(summaryTextarea);
    }
};

/* AI Assistant functions removed - AI panel safely removed from checkout
let checkoutAIAssistantModulePromise = null;
async function getCheckoutAIAssistant() {
    if (window.AppAIAssistant) return window.AppAIAssistant;
    if (!checkoutAIAssistantModulePromise) {
        checkoutAIAssistantModulePromise = import('./modules/ai-assistant.js').then((mod) => mod.AppAIAssistant || mod.default || window.AppAIAssistant);
    }
    return checkoutAIAssistantModulePromise;
}

const app_checkoutAiDefaultState = () => ({
    draft: null,
    snapshot: null,
    requestId: '',
    sourceScope: '',
    status: 'idle',
    reason: '',
    applied: false,
    loading: false
});

/* AI state management removed - AI panel safely removed from checkout
const app_getCheckoutAiState = () => {
    if (!window.app_checkoutAiDraftState) {
        window.app_checkoutAiDraftState = app_checkoutAiDefaultState();
    }
    return window.app_checkoutAiDraftState;
}; */

/* AI helper functions - kept for potential future use, commented out for safe removal
const app_checkoutCollectFormSnapshot = () => {
    const form = document.getElementById('checkout-form');
    if (!form) return null;
    return {
        description: String(form.description?.value || '').trim(),
        tomorrowGoal: String(form.tomorrowGoal?.value || '').trim(),
        tomorrowBudgetHeadId: app_normalizeBudgetHeadId(form.tomorrowBudgetHeadId?.value || APP_UNALLOCATED_BUDGET_HEAD.id)
    };
};

const app_checkoutSyncDraftStorage = () => {
    const snapshot = app_checkoutCollectFormSnapshot();
    if (!snapshot) return;
    window.app_checkoutSummaryDraft = snapshot.description;
    window.app_checkoutTomorrowGoalDraft = snapshot.tomorrowGoal;
    window.app_checkoutTomorrowBudgetHeadDraft = snapshot.tomorrowBudgetHeadId;
};

const app_checkoutCollectTaskChecklist = () => {
    const metaMap = window.app_checkoutTaskMeta || {};
    const detailsMap = window.app_checkoutTaskDetails || {};
    return Object.keys(metaMap).slice(0, 18).map((key) => {
        const meta = metaMap[key] || {};
        const detail = detailsMap[key] || {};
        return {
            key,
            label: String(meta.text || '').trim(),
            status: String(detail.progressStatus || '').trim() || String(detail.action || '').trim(),
            action: String(detail.action || '').trim(),
            progressPercent: Number(detail.progressPercent || 0),
            budgetHeadId: String(detail.budgetHeadId || '').trim(),
            note: String(detail.progressNote || '').trim()
        };
    }).filter((item) => item.label);
};

const app_checkoutGetBudgetHeadLabel = (budgetHeadId) => {
    const id = app_normalizeBudgetHeadId(budgetHeadId);
    const select = document.querySelector('select[name="tomorrowBudgetHeadId"]');
    const escapedId = (typeof CSS !== 'undefined' && CSS.escape)
        ? CSS.escape(id)
        : String(id).replace(/"/g, '\\"');
    const option = select?.querySelector(`option[value="${escapedId}"]`);
    return option ? option.textContent.trim() : id;
};

const app_checkoutBuildAiDescription = (draft = {}) => {
    const summary = String(draft.summary || '').trim();
    const suggestions = Array.isArray(draft.taskSuggestions)
        ? draft.taskSuggestions.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    if (!summary && !suggestions.length) return '';
    if (!suggestions.length) return summary;
    const suggestionBlock = suggestions.map((item) => `- ${item}`).join('\n');
    return [summary, 'Suggested follow-ups:', suggestionBlock].filter(Boolean).join('\n\n');
};

const app_checkoutRenderAiDraftPanel = () => {
    const state = app_getCheckoutAiState();
    const preview = document.getElementById('checkout-ai-preview');
    const statusEl = document.getElementById('checkout-ai-status');
    const applyBtn = document.getElementById('checkout-ai-apply-btn');
    const undoBtn = document.getElementById('checkout-ai-undo-btn');
    const discardBtn = document.getElementById('checkout-ai-discard-btn');
    if (statusEl) {
        const label = state.loading
            ? 'Drafting...'
            : state.status === 'applied'
                ? 'Applied'
                : state.status === 'fallback'
                    ? 'Manual draft only'
                    : state.draft
                        ? 'Draft ready'
                        : 'Ready';
        statusEl.textContent = label;
    }
    if (applyBtn) applyBtn.disabled = !state.draft || state.loading;
    if (undoBtn) undoBtn.disabled = !state.applied || !state.snapshot;
    if (discardBtn) discardBtn.disabled = (!state.draft && !state.applied) || state.loading;
    if (!preview) return;

    if (state.loading) {
        preview.innerHTML = '<div class="checkout-ai-empty"><i class="fa-solid fa-spinner fa-spin"></i> Drafting with AI...</div>';
        return;
    }

    if (!state.draft) {
        preview.innerHTML = state.status === 'fallback'
            ? `<div class="checkout-ai-empty">No AI suggestions available, please draft manually.${state.reason ? ` <span class="checkout-ai-reason">(${app_escapeHtml(state.reason)})</span>` : ''}</div>`
            : '<div class="checkout-ai-empty">AI suggestions will appear here after you draft with AI.</div>';
        return;
    }

    const summary = String(state.draft.summary || '').trim();
    const tomorrowGoal = String(state.draft.tomorrowGoal || '').trim();
    const suggestions = Array.isArray(state.draft.taskSuggestions) ? state.draft.taskSuggestions : [];
    const warnings = Array.isArray(state.draft.warnings) ? state.draft.warnings : [];
    const sourceScope = String(state.draft.sourceScope || state.sourceScope || '').trim();
    const budgetHeadLabel = state.draft.budgetHeadId ? app_checkoutGetBudgetHeadLabel(state.draft.budgetHeadId) : '';

    preview.innerHTML = `
        <div class="checkout-ai-editor">
            <div class="checkout-ai-field">
                <label for="checkout-ai-summary">Editable Summary</label>
                <textarea id="checkout-ai-summary" class="checkout-ai-summary" oninput="window.app_updateCheckoutAiDraftField?.('summary', this.value)">${app_escapeHtml(summary)}</textarea>
            </div>
            <div class="checkout-ai-field">
                <label for="checkout-ai-tomorrow-goal">Editable Tomorrow Goal</label>
                <textarea id="checkout-ai-tomorrow-goal" class="checkout-ai-tomorrow-goal" oninput="window.app_updateCheckoutAiDraftField?.('tomorrowGoal', this.value)">${app_escapeHtml(tomorrowGoal)}</textarea>
            </div>
            <div class="checkout-ai-field">
                <div class="checkout-ai-field-head">
                    <label>Task Suggestions</label>
                    <button type="button" class="checkout-ai-mini-btn" onclick="window.app_addCheckoutAiSuggestion?.()">Add suggestion</button>
                </div>
                <div class="checkout-ai-suggestion-list">
                    ${suggestions.length
                        ? suggestions.map((item, index) => `
                            <div class="checkout-ai-suggestion-row">
                                <input type="text" class="checkout-ai-suggestion-input" placeholder="Add a follow-up suggestion" value="${app_escapeHtml(item)}" oninput="window.app_updateCheckoutAiSuggestion?.(${index}, this.value)">
                                <button type="button" class="checkout-ai-suggestion-remove" title="Remove suggestion" onclick="window.app_removeCheckoutAiSuggestion?.(${index})">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                        `).join('')
                        : '<div class="checkout-ai-empty">No task suggestions were returned. You can still edit the summary and tomorrow goal.</div>'}
                </div>
            </div>
            <div class="checkout-ai-footer">
                ${budgetHeadLabel ? `<div class="checkout-ai-budget-chip"><strong>Budget Head:</strong> ${app_escapeHtml(budgetHeadLabel)}</div>` : ''}
                ${warnings.length ? `<div class="checkout-ai-warnings-inline">${warnings.map((item) => `<span class="checkout-ai-warning-chip">${app_escapeHtml(item)}</span>`).join('')}</div>` : ''}
                ${sourceScope ? `<div class="checkout-ai-source-chip"><strong>Source Scope:</strong> ${app_escapeHtml(sourceScope)}</div>` : ''}
            </div>
        </div>
    `;
};

const app_checkoutSyncFormFromDraftState = () => {
    const state = app_getCheckoutAiState();
    const form = document.getElementById('checkout-form');
    if (!form || !state.draft) return;
    const description = app_checkoutBuildAiDescription(state.draft);
    if (form.description) form.description.value = description;
    if (form.tomorrowGoal) form.tomorrowGoal.value = String(state.draft.tomorrowGoal || '').trim();
    if (form.tomorrowBudgetHeadId && state.draft.budgetHeadId) {
        const nextBudgetHeadId = app_normalizeBudgetHeadId(state.draft.budgetHeadId);
        if (nextBudgetHeadId && nextBudgetHeadId !== APP_UNALLOCATED_BUDGET_HEAD.id) {
            form.tomorrowBudgetHeadId.value = nextBudgetHeadId;
        }
    }
    if (window.app_updateCharCounter && form.description) window.app_updateCharCounter(form.description);
    app_checkoutSyncDraftStorage();
};

window.app_updateCheckoutAiDraftField = (field, value) => {
    const state = app_getCheckoutAiState();
    if (!state.draft) return;
    if (field === 'summary') {
        state.draft.summary = String(value || '');
    } else if (field === 'tomorrowGoal') {
        state.draft.tomorrowGoal = String(value || '');
    }
};

window.app_updateCheckoutAiSuggestion = (index, value) => {
    const state = app_getCheckoutAiState();
    if (!state.draft) return;
    const list = Array.isArray(state.draft.taskSuggestions) ? state.draft.taskSuggestions : [];
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return;
    list[idx] = String(value || '');
    state.draft.taskSuggestions = list;
};

/* AI window functions removed - AI panel safely removed from checkout
window.app_addCheckoutAiSuggestion = () => {
    const state = app_getCheckoutAiState();
    if (!state.draft) return;
    state.draft.taskSuggestions = Array.isArray(state.draft.taskSuggestions) ? state.draft.taskSuggestions : [];
    state.draft.taskSuggestions.push('');
    app_checkoutRenderAiDraftPanel();
};

window.app_removeCheckoutAiSuggestion = (index) => {
    const state = app_getCheckoutAiState();
    if (!state.draft) return;
    const list = Array.isArray(state.draft.taskSuggestions) ? [...state.draft.taskSuggestions] : [];
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    state.draft.taskSuggestions = list;
    app_checkoutRenderAiDraftPanel();
};

window.app_requestCheckoutAiDraft = async () => {
    const form = document.getElementById('checkout-form');
    const state = app_getCheckoutAiState();
    if (!form) {
        alert('Check-out form is not available. Please close and reopen the checkout window.');
        return;
    }
    const activeUser = window.AppAuth.getUser();
    const today = window.app_checkoutContextDate || getLocalISO();
    const sourceScope = `Checkout draft for ${today} (${activeUser?.isAdmin ? 'admin' : 'personal'})`;
    state.loading = true;
    state.status = 'loading';
    state.sourceScope = sourceScope;
    app_checkoutRenderAiDraftPanel();
    let aiAssistant = null;
    try {
        aiAssistant = await getCheckoutAIAssistant();
    } catch (err) {
        console.warn('Checkout AI assistant module failed to load:', err);
        state.status = 'fallback';
        state.draft = null;
        state.loading = false;
        app_checkoutRenderAiDraftPanel();
        return;
    }
    if (!aiAssistant?.requestAssistant) {
        state.status = 'fallback';
        state.draft = null;
        state.loading = false;
        app_checkoutRenderAiDraftPanel();
        return;
    }

    const taskChecklist = app_checkoutCollectTaskChecklist();
    const currentSummary = String(form.description?.value || window.app_checkoutSummaryDraft || '').trim();
    const tomorrowGoal = String(form.tomorrowGoal?.value || window.app_checkoutTomorrowGoalDraft || '').trim();
    const currentBudgetHeadId = app_normalizeBudgetHeadId(form.tomorrowBudgetHeadId?.value || window.app_checkoutTomorrowBudgetHeadDraft || activeUser?.currentBudgetHeadId);
    const workPlan = window.app_checkoutCurrentWorkPlan || {};
    const rawPlanText = String(window.app_checkoutPlanRawText || document.getElementById('checkout-plan-text')?.dataset?.rawText || '').trim();
    const currentPlan = {
        summary: currentSummary,
        tomorrowGoal,
        currentBudgetHeadId,
        taskChecklist,
        workPlan: {
            sourceScope: String(workPlan?.sourceScope || sourceScope).trim(),
            rawText: rawPlanText,
            planCount: Number(workPlan?.planCount || 0),
            completedCount: Number(workPlan?.completedCount || 0),
            pendingCount: Number(workPlan?.pendingCount || 0)
        }
    };
    const directStaffMemory = window.AppAIContextFeeder?.getStaffContextPack
        ? await window.AppAIContextFeeder.getStaffContextPack(activeUser, { force: false })
        : null;

    try {
        const result = await aiAssistant.requestAssistant({
            mode: 'checkout-summary',
            context: {
                date: today,
                currentSummary,
                tomorrowGoal,
                currentBudgetHeadId,
                taskChecklist,
                workPlan: currentPlan.workPlan,
                notes: 'Checkout draft should remain editable and privacy-safe. Do not include sensitive fields.',
                currentPlan,
                staffMemory: directStaffMemory ? {
                    sourceScope: directStaffMemory.sourceScope || '',
                    historyAvailable: directStaffMemory.historyAvailable === true,
                    summary: directStaffMemory.summary || {},
                    recentPersonalPlans: directStaffMemory.recentPersonalPlans || directStaffMemory.recentPlans || [],
                    recentTaskActivityHistory: directStaffMemory.recentTaskActivityHistory || directStaffMemory.recentActivities || [],
                    budgetHeadPatterns: directStaffMemory.budgetHeadPatterns || directStaffMemory.summary?.budgetHeads || [],
                    attendanceSummary: directStaffMemory.attendanceSummary || null,
                    tagHistorySummary: directStaffMemory.tagHistorySummary || [],
                    notificationSummary: directStaffMemory.notificationSummary || []
                } : null
            },
            user: activeUser,
            sourceScope
        });

        state.loading = false;
        state.requestId = result?.audit?.requestId || '';
        state.sourceScope = result?.sourceScope || sourceScope;
        state.reason = result?.audit?.reason || result?.warnings?.[0] || '';
        state.status = result?.ok === false || !result?.draft?.summary ? 'fallback' : 'ready';
        state.applied = false;

        if (state.status === 'fallback') {
            state.draft = null;
            app_checkoutRenderAiDraftPanel();
            return;
        }

        state.draft = {
            summary: String(result?.draft?.summary || result?.summary || '').trim(),
            tomorrowGoal: String(result?.draft?.tomorrowGoal || result?.tomorrowGoal || tomorrowGoal || '').trim(),
            taskSuggestions: Array.isArray(result?.draft?.taskSuggestions)
                ? result.draft.taskSuggestions.map((item) => String(item || '').trim()).filter(Boolean)
                : Array.isArray(result?.taskSuggestions)
                    ? result.taskSuggestions.map((item) => String(item || '').trim()).filter(Boolean)
                    : [],
            warnings: Array.isArray(result?.warnings) ? result.warnings.map((item) => String(item || '').trim()).filter(Boolean) : [],
            sourceScope: String(result?.sourceScope || sourceScope).trim(),
            budgetHeadId: String(result?.draft?.budgetHeadId || '').trim()
        };

        state.snapshot = app_checkoutCollectFormSnapshot();
        state.applied = true;
        state.status = 'applied';
        app_checkoutSyncFormFromDraftState();
        app_checkoutRenderAiDraftPanel();
    } catch (err) {
        console.warn('Checkout AI draft generation failed:', err);
        state.loading = false;
        state.status = 'fallback';
        state.reason = String(err?.message || err || 'assistant_unavailable');
        state.draft = null;
        app_checkoutRenderAiDraftPanel();
    }
};

window.app_applyCheckoutAiDraft = () => {
    const state = app_getCheckoutAiState();
    if (!state.draft) return;
    const form = document.getElementById('checkout-form');
    if (!form) return;
    if (!state.snapshot) {
        state.snapshot = app_checkoutCollectFormSnapshot();
    }
    state.applied = true;
    state.status = 'applied';
    app_checkoutSyncFormFromDraftState();
    app_checkoutRenderAiDraftPanel();
};

window.app_undoCheckoutAiDraft = () => {
    const state = app_getCheckoutAiState();
    if (!state.snapshot) return;
    const form = document.getElementById('checkout-form');
    if (!form) return;
    if (form.description) form.description.value = String(state.snapshot.description || '');
    if (form.tomorrowGoal) form.tomorrowGoal.value = String(state.snapshot.tomorrowGoal || '');
    if (form.tomorrowBudgetHeadId) form.tomorrowBudgetHeadId.value = app_normalizeBudgetHeadId(state.snapshot.tomorrowBudgetHeadId || APP_UNALLOCATED_BUDGET_HEAD.id);
    if (window.app_updateCharCounter && form.description) window.app_updateCharCounter(form.description);
    state.applied = false;
    state.status = state.draft ? 'ready' : 'idle';
    app_checkoutSyncDraftStorage();
    app_checkoutRenderAiDraftPanel();
};

window.app_discardCheckoutAiDraft = () => {
    const state = app_getCheckoutAiState();
    const form = document.getElementById('checkout-form');
    if (state.applied && state.snapshot && form) {
        if (form.description) form.description.value = String(state.snapshot.description || '');
        if (form.tomorrowGoal) form.tomorrowGoal.value = String(state.snapshot.tomorrowGoal || '');
        if (form.tomorrowBudgetHeadId) form.tomorrowBudgetHeadId.value = app_normalizeBudgetHeadId(state.snapshot.tomorrowBudgetHeadId || APP_UNALLOCATED_BUDGET_HEAD.id);
        if (window.app_updateCharCounter && form.description) window.app_updateCharCounter(form.description);
    }
    state.draft = null;
    state.snapshot = null;
    state.applied = false;
    state.loading = false;
    state.requestId = '';
    state.sourceScope = '';
    state.reason = '';
    state.status = 'idle';
    app_checkoutSyncDraftStorage();
    app_checkoutRenderAiDraftPanel();
}; */

window.app_handleChecklistAction = async function (planId, taskIndex, action) {
    const checklistSection = document.getElementById('checkout-task-checklist');
    const delegatePanel = document.getElementById('delegate-panel');
    window.app_checkoutTaskActions = window.app_checkoutTaskActions || {};
    const actionKey = `${planId}:${taskIndex}`;
    if (!action) {
        delete window.app_checkoutTaskActions[actionKey];
        if (window.app_checkoutTaskDetails) delete window.app_checkoutTaskDetails[actionKey];
        if (delegatePanel) delegatePanel.style.display = 'none';
        if (checklistSection) checklistSection.classList.remove('delegate-open');
        const modal = document.querySelector(`.checkout-action-detail-modal[data-checkout-key="${app_escapeCssValue(actionKey)}"]`);
        if (modal) modal.remove();
        const detailBtn = document.querySelector(`.checkout-task-detail-btn[data-checkout-detail-key="${app_escapeCssValue(actionKey)}"]`);
        if (detailBtn) detailBtn.disabled = true;
        window.app_renderCheckoutActionPreview();
        return;
    }
    window.app_checkoutTaskActions[actionKey] = action;
    window.app_checkoutTaskDetails = window.app_checkoutTaskDetails || {};
    const details = window.app_checkoutTaskDetails[actionKey] || {
        action: '',
        progressPercent: 0,
        progressStatus: 'waiting',
        progressNote: '',
        actionMeta: {}
    };
    details.action = action;
    if (action === 'complete') {
        details.progressPercent = 100;
        details.progressStatus = 'done';
        await window.app_appendCompletedTaskToSummary(planId, taskIndex);
    }
    if (action === 'postpone') {
        if (!details.actionMeta?.postponeDate) {
            details.actionMeta = details.actionMeta || {};
            details.actionMeta.postponeDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        }
    }
    window.app_checkoutTaskDetails[actionKey] = details;
    if (delegatePanel) delegatePanel.style.display = 'none';
    if (checklistSection) checklistSection.classList.remove('delegate-open');
    const detailBtn = document.querySelector(`.checkout-task-detail-btn[data-checkout-detail-key="${app_escapeCssValue(actionKey)}"]`);
    if (detailBtn) detailBtn.disabled = false;
    window.app_openCheckoutActionModal(actionKey);
    window.app_clearCheckoutTaskError(actionKey);
    window.app_renderCheckoutActionPreview();
};
// Mark task completed (updates status and credit score via AppRating)
window.app_markTaskCompleted = async function (planId, taskIndex) {
    try {
        const today = new Date().toISOString().split('T')[0];
        await window.AppCalendar.updateTaskStatus(planId, taskIndex, 'completed', today);
        if (window.AppStore && window.AppStore.invalidatePlans) {
            window.AppStore.invalidatePlans();
        }
        alert('Task marked as completed.');
        if (typeof handleAttendance === 'function') await handleAttendance();
    } catch (err) {
        alert('Failed to mark completed: ' + err.message);
    }
};

// Delegate task to another staff with acceptance and calendar entry
window.app_delegateTask = async function (planId, taskIndex) {
    try {
        const allUsers = await window.AppDB.getAll('users');
        const names = allUsers.map(u => u.name).join(', ');
        const chosen = await window.appPrompt(`Delegate to which staff? Enter name.\nAvailable: ${names}`, '', { title: 'Delegate Task', placeholder: 'Type staff name' });
        if (!chosen) return;
        const recipient = allUsers.find(u => u.name.toLowerCase() === chosen.toLowerCase());
        if (!recipient) {
            alert('Staff not found.');
            return;
        }
        await window.app_delegateTo(planId, taskIndex, recipient.id);
    } catch (err) {
        alert('Failed to delegate task: ' + err.message);
    }
};

window.app_delegateTo = async function (planId, taskIndex, userId, options = {}) {
    const delegateOptions = options && typeof options === 'object' ? options : {};
    try {
        const plan = await window.AppDB.get('work_plans', planId);
        if (!plan || !plan.plans || !plan.plans[taskIndex]) {
            alert('Task not found.');
            return;
        }
        const currentUser = window.AppAuth.getUser();
        const task = plan.plans[taskIndex];
        const details = (task.subPlans && task.subPlans.length) ? ` — ${task.subPlans.join(', ')}` : '';
        const text = `${task.task}${details}`;

        // Update original plan: add tag and mark as delegated (pending)
        if (!task.tags) task.tags = [];
        const users = await window.AppDB.getAll('users');
        const recipient = users.find(u => u.id === userId);
        if (!recipient) {
            alert('Staff not found.');
            return;
        }
        if (!task.tags.some(t => t.id === recipient.id)) {
            task.tags.push({ id: recipient.id, name: recipient.name, status: 'pending' });
        }
        task.status = task.status || 'pending';
        plan.updatedAt = new Date().toISOString();
        await window.AppDB.put('work_plans', plan);

        // Create task in recipient's calendar (same date) with pending status
        await window.AppCalendar.addWorkPlanTask(
            plan.date,
            recipient.id,
            text,
            [{ id: currentUser.id, name: currentUser.name, status: 'pending' }],
            {
                addedFrom: 'delegated',
                sourcePlanId: planId,
                sourceTaskIndex: taskIndex,
                taggedById: currentUser.id,
                taggedByName: currentUser.name,
                status: 'pending',
                subPlans: task.subPlans || []
            }
        );

        // Notify recipient
        const recUser = await window.AppDB.get('users', recipient.id);
        if (recUser) {
            if (!recUser.notifications) recUser.notifications = [];
            recUser.notifications.unshift({
                id: `task_${Date.now()}`,
                type: 'task',
                title: task.task || 'Delegated task',
                description: task.subPlans && task.subPlans.length > 0 ? task.subPlans.join(', ') : '',
                taggedById: currentUser.id,
                taggedByName: currentUser.name,
                taggedAt: new Date().toISOString(),
                status: 'pending',
                source: 'delegation',
                date: new Date().toLocaleString(),
                read: false
            });
            await window.AppDB.put('users', recUser);
        }

        if (window.AppStore && window.AppStore.invalidatePlans) {
            window.AppStore.invalidatePlans();
        }
        if (delegateOptions.silent !== true) {
            alert(`Task delegated to ${recipient.name}.`);
        }
        if (delegateOptions.skipDashboardRefresh !== true && typeof refreshDashboardAfterAttendance === 'function') {
            await refreshDashboardAfterAttendance();
        }
    } catch (err) {
        if (delegateOptions.silent === true) throw err;
        alert('Failed to delegate task: ' + err.message);
    }
};

// Helper to calculate distance in meters between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
    const earthRadiusMeters = 6371e3;
    const latRad1 = lat1 * Math.PI / 180;
    const latRad2 = lat2 * Math.PI / 180;
    const deltaLat = (lat2 - lat1) * Math.PI / 180;
    const deltaLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(latRad1) * Math.cos(latRad2) *
        Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMeters * c;
}

const BASE_SHIFT_MS = 8 * 60 * 60 * 1000;
const OVERTIME_PROMPT_THRESHOLD_MS = 9 * 60 * 60 * 1000; // 8h + 1h

const parseLogDateTime = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return null;
    const date = String(dateStr).trim();
    const time = String(timeStr).trim();
    if (!date || !time || time.toLowerCase().includes('active now')) return null;

    const dt = new Date(`${date}T${time}`);
    if (!Number.isNaN(dt.getTime())) return dt;

    const fallback = new Date(`${date} ${time}`);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const hasManualLogDuringRange = async (userId, rangeStartMs, rangeEndMs) => {
    if (!userId || !window.AppDB || rangeEndMs <= rangeStartMs) return false;
    const logs = await window.AppDB.getAll('attendance');
    const targetId = String(userId);

    return (logs || []).some((log) => {
        if (!log || String(log.user_id || '') !== targetId) return false;
        if (!log.isManualOverride) return false;

        const start = parseLogDateTime(log.date, log.checkIn);
        const end = parseLogDateTime(log.date, log.checkOut);
        if (!start || !end) return false;

        let startMs = start.getTime();
        let endMs = end.getTime();
        if (endMs <= startMs) endMs += 24 * 60 * 60 * 1000;

        const overlapStart = Math.max(rangeStartMs, startMs);
        const overlapEnd = Math.min(rangeEndMs, endMs);
        return overlapEnd > overlapStart;
    });
};

const evaluateCheckoutOvertimePrompt = async (user) => {
    const base = {
        showPrompt: false,
        hasManualLog: false,
        extraTimeMs: 0,
        requiresConfirmation: false,
        overtimeStartMs: null,
        overtimeEndMs: null
    };
    if (!user || !user.lastCheckIn) return base;

    const checkInMs = Number(user.lastCheckIn);
    if (!Number.isFinite(checkInMs)) return base;

    const nowMs = Date.now();
    const workedMs = nowMs - checkInMs;
    if (workedMs <= OVERTIME_PROMPT_THRESHOLD_MS) return base;

    const overtimeStartMs = checkInMs + BASE_SHIFT_MS;
    const extraTimeMs = Math.max(0, nowMs - overtimeStartMs);
    const requiresConfirmation = extraTimeMs > 2 * 60 * 60 * 1000;

    const hasManualLog = await hasManualLogDuringRange(user.id, overtimeStartMs, nowMs);
    if (hasManualLog) {
        return {
            showPrompt: false,
            hasManualLog: true,
            extraTimeMs,
            requiresConfirmation,
            overtimeStartMs,
            overtimeEndMs: nowMs
        };
    }

    return {
        showPrompt: true,
        hasManualLog: false,
        extraTimeMs,
        requiresConfirmation,
        overtimeStartMs,
        overtimeEndMs: nowMs
    };
};

window.app_prepareCheckoutOvertimeSection = async (user) => {
    const section = document.getElementById('checkout-extra-time-section');
    const allTextareas = document.querySelectorAll('textarea[name="extraTimeJustification"]');
    const firstTextarea = allTextareas[0];
    const hint = document.getElementById('checkout-extra-time-hint');
    const badge = document.getElementById('checkout-extra-time-badge');
    const slider = document.getElementById('checkout-extra-time-slider');
    const display = document.getElementById('checkout-extra-time-display');
    const maxDisplay = document.getElementById('checkout-extra-time-max');

    console.log('[Extra Time Debug] Section exists:', !!section, 'Textareas found:', allTextareas.length);

    window.app_checkoutOvertimeState = {
        showPrompt: false,
        hasManualLog: false,
        extraTimeMs: 0,
        requiresConfirmation: false
    };
    
    if (!section || !firstTextarea) {
        console.error('[Extra Time Debug] Extra time section or textarea not found in DOM.');
        return;
    }

    section.style.display = 'none';
    firstTextarea.required = false;
    // Clear all entry textareas
    allTextareas.forEach(ta => ta.value = '');
    
    // Reset radio buttons
    document.querySelectorAll('input[name="extraTimeMode"]').forEach(radio => {
        radio.checked = radio.value === 'full';
    });
    
    // Hide partial time container
    const partialContainer = document.getElementById('checkout-partial-time-container');
    if (partialContainer) partialContainer.style.display = 'none';

    try {
        const state = await evaluateCheckoutOvertimePrompt(user);
        console.log('[Extra Time Debug] Overtime state:', state);
        window.app_checkoutOvertimeState = state;
        
        // Only show section if extra time > 2 hours (requires confirmation)
        if (!state.requiresConfirmation) {
            console.log('[Extra Time Debug] No confirmation required (extra time ≤ 2 hours)');
            return;
        }

        const extraHours = Math.floor(state.extraTimeMs / (1000 * 60 * 60));
        const extraMinutes = Math.floor((state.extraTimeMs % (1000 * 60 * 60)) / (1000 * 60));
        
        console.log('[Extra Time Debug] Showing extra time section for:', extraHours, 'h', extraMinutes, 'm');
        
        if (hint) {
            hint.textContent = `You worked ${extraHours}h ${extraMinutes}m extra. Please confirm how much time was actually spent working.`;
        }
        
        if (badge) {
            badge.textContent = `+${extraHours}h ${extraMinutes}m`;
        }
        
        // Set slider max to total extra time (in minutes)
        const totalExtraMinutes = Math.floor(state.extraTimeMs / (1000 * 60));
        if (slider) {
            slider.max = totalExtraMinutes;
            slider.value = totalExtraMinutes;
        }
        
        if (display) {
            display.textContent = `${extraHours}h ${extraMinutes}m`;
        }
        
        if (maxDisplay) {
            maxDisplay.textContent = `${extraHours}h ${extraMinutes}m`;
        }
        
        section.style.display = 'block';
        firstTextarea.required = true;
    } catch (err) {
        console.warn('[Extra Time Debug] Extra time prompt check failed:', err);
    }
};

window.app_handleExtraTimeModeChange = (mode) => {
    const partialContainer = document.getElementById('checkout-partial-time-container');
    if (!partialContainer) return;
    
    if (mode === 'partial') {
        partialContainer.style.display = 'block';
    } else {
        partialContainer.style.display = 'none';
    }
};

window.app_updateExtraTimeDisplay = (minutes) => {
    const display = document.getElementById('checkout-extra-time-display');
    if (!display) return;
    
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    display.textContent = `${hours}h ${mins}m`;
};

// Debug function to test extra time UI without waiting for actual extra hours
window.app_addExtraTimeEntry = () => {
    const container = document.getElementById('checkout-extra-time-entries');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'checkout-extra-time-entry-row';
    row.innerHTML = `
        <textarea name="extraTimeJustification" class="checkout-extra-time-justification-input" placeholder="e.g., Prepared AGM reports, Handled urgent client call..."></textarea>
        <button type="button" class="checkout-extra-time-entry-remove" onclick="this.closest('.checkout-extra-time-entry-row').remove()"><i class="fa-solid fa-xmark"></i></button>
    `;
    container.appendChild(row);
    row.querySelector('textarea').focus();
};

window.app_testExtraTimeUI = (extraHours = 3, extraMinutes = 30) => {
    const section = document.getElementById('checkout-extra-time-section');
    const firstTextarea = document.querySelector('textarea[name="extraTimeJustification"]');
    const hint = document.getElementById('checkout-extra-time-hint');
    const badge = document.getElementById('checkout-extra-time-badge');
    const slider = document.getElementById('checkout-extra-time-slider');
    const display = document.getElementById('checkout-extra-time-display');
    const maxDisplay = document.getElementById('checkout-extra-time-max');

    if (!section || !firstTextarea) {
        console.error('Extra time section not found. Open checkout modal first.');
        return;
    }

    const totalExtraMinutes = extraHours * 60 + extraMinutes;
    
    if (hint) {
        hint.textContent = `TEST MODE: Simulating ${extraHours}h ${extraMinutes}m extra. Please confirm how much time was actually spent working.`;
    }
    
    if (badge) {
        badge.textContent = `+${extraHours}h ${extraMinutes}m`;
    }
    
    if (slider) {
        slider.max = totalExtraMinutes;
        slider.value = totalExtraMinutes;
    }
    
    if (display) {
        display.textContent = `${extraHours}h ${extraMinutes}m`;
    }
    
    if (maxDisplay) {
        maxDisplay.textContent = `${extraHours}h ${extraMinutes}m`;
    }
    
    firstTextarea.required = true;
    section.style.display = 'block';
    
    // Set test state
    window.app_checkoutOvertimeState = {
        showPrompt: true,
        hasManualLog: false,
        extraTimeMs: totalExtraMinutes * 60 * 1000,
        requiresConfirmation: true
    };
    
    console.log('Extra time UI test mode activated. Open checkout modal to see the UI.');
};

async function handleAttendance() {
    const btn = document.getElementById('attendance-btn');
    const locationText = document.getElementById('location-text');
    const { status } = await window.AppAttendance.getStatus();

    if (btn) btn.disabled = true;
    attendanceActionInFlight = true;

    try {
        if (status === 'out') {
            if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Locating...`;
            const pos = await app_getAttendanceLocation();
            const checkInAddress = `Lat: ${pos.lat.toFixed(4)}, Lng: ${pos.lng.toFixed(4)}`;
            if (locationText) locationText.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${checkInAddress}`;
            const checkInResult = await window.AppAttendance.checkIn(pos.lat, pos.lng, checkInAddress, {});
            if (checkInResult && checkInResult.conflict) {
                window.app_showSyncToast(checkInResult.message || 'Status updated from another device.');
                if (window.app_refreshDashboard) await window.app_refreshDashboard();
                return;
            }
            markLocalAttendanceMutation();
            if (window.app_refreshDashboard) await window.app_refreshDashboard();
            if (checkInResult && checkInResult.resolvedMissedCheckout && checkInResult.noticeMessage) {
                window.app_showAttendanceNotice(checkInResult.noticeMessage);
            }
            if (checkInResult && checkInResult.missedCheckoutReasonRequired && checkInResult.missedCheckoutLogId) {
                window.app_promptMissedCheckoutReason({
                    logId: checkInResult.missedCheckoutLogId,
                    date: checkInResult.missedCheckoutDate
                });
            }
            // Prompt to add plan if missing
            if (window.AppDayPlan && typeof window.AppDayPlan.openDayPlan === 'function') {
                await window.AppDayPlan.openDayPlan(getLocalISO(), null, null, {
                    hideAutoForwardedTasks: true,
                    skipCarryForwardSync: true,
                    skipCarryForwardCleanup: true
                });
            }
        } else {
            // Pre-fill Checkout Description from Work Plan
            const user = window.AppAuth.getUser();
            const today = getLocalISO();
            const workPlan = await window.AppCalendar.getWorkPlan(user.id, today, { includeAnnual: true, mergeAnnual: true });
            const collaborations = await window.AppCalendar.getCollaborations(user.id, today);
            if (window.app_checkoutSummaryDate !== today) {
                window.app_checkoutSummaryDate = today;
                window.app_checkoutSummaryDraft = '';
                window.app_checkoutTomorrowGoalDraft = '';
                window.app_checkoutTomorrowBudgetHeadDraft = '';
                window.app_checkoutPlanRawText = '';
                window.app_checkoutCurrentWorkPlan = null;
                window.app_checkoutCollaborations = [];
                window.app_checkoutContextDate = today;
                /* AI state initialization removed - AI panel safely removed from checkout
                window.app_checkoutAiDraftState = typeof app_checkoutAiDefaultState === 'function' ? app_checkoutAiDefaultState() : {
                    draft: null,
                    snapshot: null,
                    requestId: '',
                    sourceScope: '',
                    status: 'idle',
                    applied: false,
                    loading: false
                }; */
            }
            if (window.app_checkoutActionDate !== today) {
                window.app_checkoutActionDate = today;
                window.app_checkoutTaskActions = {};
                window.app_checkoutTaskDetails = {};
                window.app_checkoutTaskMeta = {};
                window.app_checkoutUserMap = {};
            }

            // Ensure persistent modals are present
            const modalContainer = document.getElementById('modal-container');
            if (modalContainer && !document.getElementById('checkout-modal')) {
                modalContainer.insertAdjacentHTML('beforeend', AppUI.renderModals());
            }

            // Show Check-Out Modal
            const modal = document.getElementById('checkout-modal');
            if (modal) {
                const planTextEl = document.getElementById('checkout-plan-text');
                const descArea = modal.querySelector('textarea[name="description"]');

                if (workPlan && (workPlan.plans || workPlan.plan)) {
                    let displayPlan = "";
                    let rawPlanText = "";
                    let aiPlanText = "";

                    if (workPlan.plans && workPlan.plans.length > 0) {
                        displayPlan = workPlan.plans.map((p, idx) => {
                            let txt = `<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; padding-bottom:12px; border-bottom:1px dashed #e9d5ff;">
                                    <div style="flex:1;">
                                        <div style="font-weight:600; color:#4c1d95;">${window.app_formatTaskWithPostponeChip(p.task)}</div>
                                        ${p.subPlans && p.subPlans.length > 0 ? `<div style="font-size:0.75rem; color:#7c3aed; margin-top:2px;">👣 ${p.subPlans.join(', ')}</div>` : ''}
                                    </div>
                                    <div style="display:flex; gap:6px; flex-shrink:0;">
                                        ${p.status === 'completed'
                                    ? '<span style="font-size:0.75rem; color:#059669; font-weight:700;">✅ Done</span>'
                                    : `<button type="button" onclick="window.app_postponeTask('${p._planId || workPlan.id}', ${typeof p._taskIndex === 'number' ? p._taskIndex : idx})" style="background:#f3e8ff; color:#7c3aed; border:1px solid #ddd6fe; border-radius:8px; padding:6px 12px; font-size:0.8rem; font-weight:600; cursor:pointer;" onmouseover="this.style.background='#ddd6fe'" onmouseout="this.style.background='#f3e8ff'">⌛ Postpone</button>`
                                }
                                    </div>
                                </div>`;
                            return txt;
                        }).join('');

                        const completedPlans = workPlan.plans.filter(p =>
                            window.AppCalendar.getSmartTaskStatus(workPlan.date, p.status) === 'completed'
                        );
                        aiPlanText = workPlan.plans.map((p) => {
                            const smartStatus = window.AppCalendar.getSmartTaskStatus(workPlan.date, p.status) || p.status || 'pending';
                            let txt = `- ${p.task}`;
                            if (p.subPlans && p.subPlans.length > 0) txt += ` (${p.subPlans.join(', ')})`;
                            txt += ` [${smartStatus}]`;
                            return txt;
                        }).join('\n');
                        rawPlanText = completedPlans.map(p => {
                            let txt = `• ${p.task}`;
                            if (p.subPlans && p.subPlans.length > 0) txt += ` (${p.subPlans.join(', ')})`;
                            return txt;
                        }).join('\n');

                    } else if (workPlan.plan) {
                        // Legacy
                        displayPlan = `<div style="font-weight:600; color:#4c1d95;">${workPlan.plan}</div>`;
                        rawPlanText = `• ${workPlan.plan}`;
                        if (workPlan.subPlans && workPlan.subPlans.length > 0) {
                            displayPlan += `<div style="font-size:0.75rem; color:#7c3aed; margin-top:2px;">👣 ${workPlan.subPlans.join(', ')}</div>`;
                            rawPlanText += ` (${workPlan.subPlans.join(', ')})`;
                        }
                    }

                    // Add Collaborations
                    if (collaborations && collaborations.length > 0) {
                        const collabText = collaborations.map(cp => {
                            return cp.plans.filter(p =>
                                p.tags && p.tags.some(t => t.id === user.id && t.status === 'accepted')
                            ).map(p => {
                                let txt = `🤝 [Collaborated with ${cp.userName}] ${p.task}`;
                                if (p.subPlans && p.subPlans.length > 0) {
                                    txt += '\n👣 Steps: ' + p.subPlans.join(', ');
                                }
                                return txt;
                            }).join('\n');
                        }).join('\n\n');

                        if (displayPlan) displayPlan += '\n\n' + collabText;
                        else displayPlan = collabText;

                        // Keep summary focused on completed checklist tasks only.
                    }

                    if (planTextEl) planTextEl.innerHTML = displayPlan;
                    // Store raw text for the action button
                    if (planTextEl) planTextEl.dataset.rawText = rawPlanText;
                    window.app_checkoutContextDate = today;
                    window.app_checkoutPlanRawText = aiPlanText || rawPlanText;
                    window.app_checkoutCurrentWorkPlan = {
                        id: workPlan.id || '',
                        date: workPlan.date || today,
                        planScope: workPlan.planScope || 'personal',
                        sourceScope: `Work plan for ${today}`,
                        rawText: aiPlanText || rawPlanText,
                        planCount: Array.isArray(workPlan.plans) ? workPlan.plans.length : 0,
                        completedCount: Array.isArray(workPlan.plans) ? workPlan.plans.filter((p) =>
                            window.AppCalendar.getSmartTaskStatus(workPlan.date, p.status) === 'completed'
                        ).length : 0,
                        pendingCount: Array.isArray(workPlan.plans)
                            ? workPlan.plans.filter((p) => window.AppCalendar.getSmartTaskStatus(workPlan.date, p.status) !== 'completed').length
                            : 0
                    };
                    window.app_checkoutCollaborations = collaborations || [];

                    // Do not auto-fill on open. Only preserve manual/complete-action draft if it exists.
                    if (descArea && !descArea.value.trim() && window.app_checkoutSummaryDraft) {
                        descArea.value = window.app_checkoutSummaryDraft;
                        if (window.app_updateCharCounter) window.app_updateCharCounter(descArea);
                    }
                    const tomorrowGoalArea = modal.querySelector('textarea[name="tomorrowGoal"]');
                    if (tomorrowGoalArea && !tomorrowGoalArea.value.trim() && window.app_checkoutTomorrowGoalDraft) {
                        tomorrowGoalArea.value = window.app_checkoutTomorrowGoalDraft;
                    }
                    const tomorrowBudgetSelect = modal.querySelector('select[name="tomorrowBudgetHeadId"]');
                    if (tomorrowBudgetSelect && window.app_checkoutTomorrowBudgetHeadDraft) {
                        const nextBudgetHeadId = app_normalizeBudgetHeadId(window.app_checkoutTomorrowBudgetHeadDraft);
                        if (nextBudgetHeadId) tomorrowBudgetSelect.value = nextBudgetHeadId;
                    }
                    // Populate checkout task checklist
                    const taskListEl = document.getElementById('checkout-task-list');
                    const delegatePanel = document.getElementById('delegate-panel');
                    const delegateList = document.getElementById('delegate-list');
                    const delegateSelTask = document.getElementById('delegate-selected-task');
                    if (taskListEl) {
                        if (workPlan && Array.isArray(workPlan.plans) && workPlan.plans.length > 0) {
                            const allUsers = await window.AppDB.getAll('users').catch(() => []);
                            window.app_checkoutUserMap = {};
                            (allUsers || []).forEach(u => {
                                window.app_checkoutUserMap[String(u.id)] = u.name;
                            });
                            const currentUser = window.AppAuth.getUser();
                            const candidates = (allUsers || []).filter(u => u.id !== currentUser.id);
                            const rows = workPlan.plans.map((p, idx) => {
                                const details = (p.subPlans && p.subPlans.length) ? ` — ${p.subPlans.join(', ')}` : '';
                                const text = `${p.task}${details}`;
                                const planIdForTask = p._planId || workPlan.id;
                                const taskIndexForTask = typeof p._taskIndex === 'number' ? p._taskIndex : idx;
                                const status = window.AppCalendar.getSmartTaskStatus(p._planDate || workPlan.date, p.status);
                                const actionKey = `${planIdForTask}:${taskIndexForTask}`;
                                window.app_checkoutTaskMeta = window.app_checkoutTaskMeta || {};
                                window.app_checkoutTaskMeta[actionKey] = {
                                    text,
                                    planId: planIdForTask,
                                    taskIndex: taskIndexForTask
                                };
                                const rememberedAction = window.app_checkoutTaskActions && window.app_checkoutTaskActions[actionKey]
                                    ? window.app_checkoutTaskActions[actionKey]
                                    : '';
                                const inferredAction = rememberedAction || (
                                    (p.status === 'completed' || status === 'completed') ? 'complete' :
                                        (p.status === 'postponed' ? 'postpone' : '')
                                );
                                const detailState = window.app_initCheckoutTaskDetails(planIdForTask, taskIndexForTask, p);
                                const actionValue = detailState.action || inferredAction || '';
                                if (actionValue && detailState.action !== actionValue) {
                                    detailState.action = actionValue;
                                    if (actionValue === 'complete') {
                                        detailState.progressPercent = 100;
                                        detailState.progressStatus = 'done';
                                    }
                                }
                                if (window.app_checkoutTaskActions) {
                                    if (actionValue) window.app_checkoutTaskActions[actionKey] = actionValue;
                                }
                                const statusLabel = status === 'completed' ? 'Completed' :
                                    status === 'in-process' ? 'In Process' :
                                        status === 'overdue' ? 'Overdue' :
                                            status === 'to-be-started' ? 'To Be Started' :
                                                (p.status || 'Pending');
                                return `
                                        <div class="checkout-task-row">
                                            <div class="checkout-task-copy">
                                                <div class="checkout-task-title">${window.app_formatTaskWithPostponeChip(text)}</div>
                                                <div class="checkout-task-status">Status: ${statusLabel}</div>
                                            </div>
                                            <div class="checkout-task-controls">
                                                <select onchange="window.app_handleChecklistAction('${planIdForTask}', ${taskIndexForTask}, this.value)" class="checkout-task-action-select">
                                                    <option value="" ${!actionValue ? 'selected' : ''}>Choose Action</option>
                                                    <option value="complete" ${actionValue === 'complete' ? 'selected' : ''}>Complete</option>
                                                    <option value="postpone" ${actionValue === 'postpone' ? 'selected' : ''}>Postpone</option>
                                                    <option value="delegate" ${actionValue === 'delegate' ? 'selected' : ''}>Delegate</option>
                                                </select>
                                                <button type="button" class="checkout-task-detail-btn" data-checkout-detail-key="${app_escapeHtml(actionKey)}" onclick="window.app_openCheckoutActionModal('${app_escapeJsSingleQuote(actionKey)}')" ${actionValue ? '' : 'disabled'}>Details</button>
                                            </div>
                                        </div>`;
                            }).join('');
                            taskListEl.innerHTML = rows;
                            window.app_renderCheckoutActionPreview();

                            if (delegatePanel && delegateList && delegateSelTask) {
                                delegatePanel.style.display = 'none';
                                const checklistSection = document.getElementById('checkout-task-checklist');
                                if (checklistSection) checklistSection.classList.remove('delegate-open');
                                delegateList.innerHTML = candidates.map(u => `
                                        <button type="button" data-user-id="${u.id}" class="delegate-user-btn">
                                            <img src="${u.avatar}" alt="${u.name}" class="delegate-user-avatar">
                                            <span style="flex:1;">${u.name}</span>
                                        </button>
                                    `).join('');
                            }
                        } else {
                            taskListEl.innerHTML = `<div style="font-size:0.8rem; color:#6b7280;">No tasks planned for today.</div>`;
                            window.app_renderCheckoutActionPreview();
                        }
                    }
                }

                await window.app_prepareCheckoutOvertimeSection(user);
                modal.style.display = 'flex';
                window.app_renderCheckoutAiDraftPanel?.();
                if (btn) btn.disabled = false;

                // Background Location Verification (Deferred)
                const mismatchDiv = document.getElementById('checkout-location-mismatch');

                if (mismatchDiv) mismatchDiv.style.display = 'none';

                // Use an async IIFE to not block the UI from showing the modal
                (async () => {
                    try {
                        const currentPos = await app_startCheckoutLocationCapture('Capturing location');
                        const checkInLoc = user.currentLocation || user.lastLocation;

                        if (checkInLoc && checkInLoc.lat && checkInLoc.lng) {
                            const dist = calculateDistance(currentPos.lat, currentPos.lng, checkInLoc.lat, checkInLoc.lng);
                            if (dist > 500) {
                                if (mismatchDiv) mismatchDiv.style.display = 'block';
                            } else {
                                if (mismatchDiv) mismatchDiv.style.display = 'none';
                            }
                        }
                    } catch (locErr) {
                        console.warn("Background location check failed:", locErr);
                    }
                })();
            } else {
                const pos = await app_getAttendanceLocation();
                const formattedAddress = `Lat: ${Number(pos.lat).toFixed(4)}, Lng: ${Number(pos.lng).toFixed(4)}`;
                const result = await window.AppAttendance.checkOut('', pos.lat, pos.lng, formattedAddress, false, '');
                if (result && !result.conflict) {
                    markLocalAttendanceMutation();
                }
                if (result && result.conflict) {
                    window.app_showSyncToast(result.message || 'Status updated from another device.');
                }
                await refreshDashboardAfterAttendance();
            }
        }
    } catch (err) {
        alert(err.message || err);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = status === 'out' ? 'Check-in <i class="fa-solid fa-fingerprint"></i>' : 'Check-out <i class="fa-solid fa-fingerprint"></i>';
        }
    } finally {
        attendanceActionInFlight = false;
    }
}

window.app_pauseSession = async function () {
    if (attendanceActionInFlight) return;
    attendanceActionInFlight = true;
    const attendanceBtn = document.getElementById('attendance-btn');
    const pauseBtn = document.getElementById('attendance-pause-btn');

    try {
        if (attendanceBtn) attendanceBtn.disabled = true;
        if (pauseBtn) {
            pauseBtn.disabled = true;
            pauseBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Pausing...`;
        }

        const result = await window.AppAttendance.pauseSession();
        if (result && result.conflict) {
            window.app_showSyncToast(result.message || 'Status updated from another device.');
            await refreshDashboardAfterAttendance();
            return;
        }
        if (result && result.ok) {
            if (window.AppActivity && window.AppActivity.stop) window.AppActivity.stop();
            markLocalAttendanceMutation();
            await refreshDashboardAfterAttendance();
        }
    } catch (err) {
        alert(err.message || err);
    } finally {
        attendanceActionInFlight = false;
    }
};

window.app_resumeSession = async function () {
    if (attendanceActionInFlight) return;
    attendanceActionInFlight = true;
    const attendanceBtn = document.getElementById('attendance-btn');
    const pauseBtn = document.getElementById('attendance-pause-btn');

    try {
        if (attendanceBtn) attendanceBtn.disabled = true;
        if (pauseBtn) {
            pauseBtn.disabled = true;
            pauseBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Resuming...`;
        }

        const result = await window.AppAttendance.resumeSession();
        if (result && result.conflict) {
            window.app_showSyncToast(result.message || 'Status updated from another device.');
            await refreshDashboardAfterAttendance();
            return;
        }
        if (result && result.ok) {
            if (window.AppActivity && window.AppActivity.start) window.AppActivity.start();
            markLocalAttendanceMutation();
            await refreshDashboardAfterAttendance();
        }
    } catch (err) {
        alert(err.message || err);
    } finally {
        attendanceActionInFlight = false;
    }
};

// New Function: Handle Check-Out Submission
window.app_triggerCheckoutFromButton = function (buttonEl) {
    const form = buttonEl?.closest ? buttonEl.closest('form') : document.getElementById('checkout-form');
    if (!form) {
        alert('Check-out form is not available. Please close and reopen the checkout window.');
        return;
    }
    return window.app_submitCheckOut({
        preventDefault: () => { },
        target: form,
        submitter: buttonEl || null
    });
};

window.app_showCheckoutValidationPopup = async function (messages = []) {
    const items = Array.isArray(messages)
        ? messages.map((msg) => String(msg || '').trim()).filter(Boolean)
        : [String(messages || '').trim()].filter(Boolean);
    if (!items.length) return;
    const body = items.map((msg, index) => `${index + 1}. ${msg}`).join('\n');
    if (window.appAlert) {
        await window.appAlert(body, 'Checkout Incomplete');
        return;
    }
    alert(body);
};

window.app_submitCheckOut = async function (event) {
    event.preventDefault();
    const form = event?.target?.tagName === 'FORM'
        ? event.target
        : (event?.submitter?.closest ? event.submitter.closest('form') : document.getElementById('checkout-form'));
    if (!form) {
        alert('Check-out form is not available. Please close and reopen the checkout window.');
        return;
    }
    const description = String(form.description?.value || '').trim();
    const activeUser = window.AppAuth.getUser();
    const budgetHeadId = app_normalizeBudgetHeadId(activeUser?.currentBudgetHeadId || 'UNALLOCATED');
    const submitBtn = event?.submitter || form.querySelector('button[type="submit"]') || form.querySelector('.action-btn');
    attendanceActionInFlight = true;

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Locating & Saving...`;
        }

        const detailKeys = Object.keys(window.app_checkoutTaskDetails || {});
        detailKeys.forEach((key) => window.app_clearCheckoutTaskError(key));
        const { updates: taskUpdates, errors: taskErrors } = window.app_collectCheckoutTaskUpdates();
        if (taskErrors.length > 0) {
            taskErrors.forEach(err => window.app_setCheckoutTaskError(err.key, err.message));
            const firstErrorKey = taskErrors[0]?.key;
            if (firstErrorKey) {
                const modal = document.querySelector(`.checkout-action-detail-modal[data-checkout-key="${app_escapeCssValue(firstErrorKey)}"]`);
                if (modal) modal.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            await window.app_showCheckoutValidationPopup(taskErrors.map((err) => err.message));
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Complete Check-Out';
            }
            return;
        }
        // Work summary is optional for checkout.
        const validationErrors = [];
        const unallocatedReason = String(activeUser?.currentBudgetHeadUnallocatedReason || '').trim();
        if (validationErrors.length > 0) {
            await window.app_showCheckoutValidationPopup(validationErrors);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Complete Check-Out';
            }
            return;
        }

        // Attendance checkout must save a freshly captured location.
        let pos = null;
        try {
            pos = await app_getCheckoutSubmitLocation();
        } catch (err) {
            const message = String(err?.message || err || 'Unable to capture location.');
            await window.app_showCheckoutValidationPopup(`Location is required for check-out. ${message}`);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Complete Check-Out';
            }
            return;
        }

        // Detect mismatch for saving
        let locationMismatched = false;
        const checkInLoc = window.AppAuth.getUser()?.currentLocation;

        if (checkInLoc && checkInLoc.lat && checkInLoc.lng && pos.lat && pos.lng) {
            const dist = calculateDistance(pos.lat, pos.lng, checkInLoc.lat, checkInLoc.lng);
            if (dist > 500) locationMismatched = true;
        }

        let explanation = form.locationExplanation ? form.locationExplanation.value.trim() : '';
        const extraTimeState = window.app_checkoutOvertimeState || {};
        const extraTimeTextareas = form.querySelectorAll('textarea[name="extraTimeJustification"]');
        const extraTimeEntries = Array.from(extraTimeTextareas).map(ta => ta.value.trim()).filter(Boolean);
        const extraTimeJustification = extraTimeEntries.join('\n');
        const extraTimeMode = form.extraTimeMode ? String(form.extraTimeMode.value || 'full') : 'full';
        const extraTimeSlider = form.extraTimeSlider ? Number(form.extraTimeSlider.value) : 0;
        const checkOutOptions = {};

        if (extraTimeState.requiresConfirmation) {
            if (!extraTimeJustification) {
                await window.app_showCheckoutValidationPopup('Please describe what was done during extra time before checkout.');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Complete Check-Out';
                }
                return;
            }
            
            checkOutOptions.extraTimePrompted = true;
            checkOutOptions.extraTimeJustification = extraTimeJustification;
            checkOutOptions.extraTimeMode = extraTimeMode;
            
            if (extraTimeMode === 'partial' && extraTimeSlider > 0) {
                checkOutOptions.extraTimeConfirmedMs = extraTimeSlider * 60 * 1000; // Convert minutes to ms
            } else if (extraTimeMode === 'full') {
                checkOutOptions.extraTimeConfirmedMs = extraTimeState.extraTimeMs;
            }
        } else if (extraTimeState.extraTimeMs > 0) {
            // Automatic allowance for ≤ 2 hours
            checkOutOptions.extraTimeAutoAllowed = true;
            checkOutOptions.extraTimeAutoAllowedMs = extraTimeState.extraTimeMs;
        }

        if (taskUpdates.length > 0) {
            checkOutOptions.taskUpdates = taskUpdates.map(update => ({
                planId: update.planId,
                taskIndex: update.taskIndex,
                action: update.action,
                progressPercent: update.progressPercent,
                progressStatus: update.progressStatus,
                progressNote: update.progressNote,
                budgetHeadId: app_normalizeBudgetHeadId(update.budgetHeadId || budgetHeadId),
                actionMeta: update.actionMeta || {},
                timestamp: update.timestamp
            }));
            checkOutOptions.taskUpdatesSubmittedAt = new Date().toISOString();
        }
        checkOutOptions.budgetHeadId = budgetHeadId;
        checkOutOptions.budgetHeadUnallocatedReason = unallocatedReason;
        checkOutOptions.validationStatus = validationErrors.length ? 'incomplete' : 'compliant';
        checkOutOptions.validationErrors = validationErrors;

        // Create formatted address string if no address available
        const formattedAddress = `Lat: ${Number(pos.lat).toFixed(4)}, Lng: ${Number(pos.lng).toFixed(4)}`;
        const tomorrowGoal = form.tomorrowGoal ? form.tomorrowGoal.value.trim() : '';
        const tomorrowBudgetHeadId = app_normalizeBudgetHeadId(
            form.tomorrowBudgetHeadId?.value || budgetHeadId
        );

        // 1. Save tomorrow's goal if provided
        if (tomorrowGoal) {
            const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
            await window.AppCalendar.addWorkPlanTask(tomorrow, window.AppAuth.getUser().id, tomorrowGoal, [], {
                budgetHeadId: tomorrowBudgetHeadId
            });
            console.log("Tomorrow's goal saved:", tomorrowGoal);
        }

        // 2. Save extra time justification entries as completed tasks for today
        if (extraTimeEntries.length > 0) {
            const todayStr = new Date().toISOString().split('T')[0];
            for (const entry of extraTimeEntries) {
                await window.AppCalendar.addWorkPlanTask(todayStr, window.AppAuth.getUser().id, entry, [], {
                    status: 'completed',
                    budgetHeadId: budgetHeadId
                });
            }
            console.log("Extra time tasks saved:", extraTimeEntries.length);
        }

        const checkOutResult = await window.AppAttendance.checkOut(
            description,
            pos ? pos.lat : null,
            pos ? pos.lng : null,
            formattedAddress,
            locationMismatched,
            explanation,
            checkOutOptions
        );

        if (checkOutResult && checkOutResult.conflict) {
            const modal = document.getElementById('checkout-modal');
            if (modal) modal.style.display = 'none';
            app_resetCheckoutLocationSession();
            window.app_showSyncToast(checkOutResult.message || 'Status updated from another device.');
            await refreshDashboardAfterAttendance();
            return;
        }
        markLocalAttendanceMutation();

        window.app_checkoutSummaryDraft = '';
        window.app_checkoutTomorrowGoalDraft = '';
        window.app_checkoutTomorrowBudgetHeadDraft = '';
        window.app_checkoutPlanRawText = '';
        window.app_checkoutCurrentWorkPlan = null;
        window.app_checkoutContextDate = '';
        window.app_checkoutCollaborations = [];
        window.app_checkoutTaskActions = {};
        window.app_checkoutTaskDetails = {};
        window.app_checkoutTaskMeta = {};
        window.app_checkoutUserMap = {};
        /* AI state initialization removed - AI panel safely removed from checkout
        window.app_checkoutAiDraftState = typeof app_checkoutAiDefaultState === 'function' ? app_checkoutAiDefaultState() : {
            draft: null,
            snapshot: null,
            requestId: '',
            sourceScope: '',
            status: 'idle',
            applied: false,
            loading: false
        }; */
        window.app_renderCheckoutActionPreview();

        // Hide modal
        const checkoutModal = document.getElementById('checkout-modal');
        if (checkoutModal) checkoutModal.style.display = 'none';
        app_resetCheckoutLocationSession();

        if (taskUpdates.length > 0) {
            try {
                await window.app_applyCheckoutTaskUpdates(taskUpdates);
            } catch (taskErr) {
                console.error('Checkout task side-effects failed after successful checkout:', taskErr);
                if (window.app_showSyncToast) {
                    window.app_showSyncToast(`Checked out, but some task updates need review: ${taskErr.message || taskErr}`);
                } else {
                    alert(`Checked out, but some task updates need review: ${taskErr.message || taskErr}`);
                }
            }
        }

        // Refresh
        await refreshDashboardAfterAttendance();
    } catch (err) {
        const errorMsg = err?.message || (typeof err === 'string' ? err : 'Unknown error');
        alert("Check-out failed: " + errorMsg);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Complete Check-Out';
        }
    } finally {
        attendanceActionInFlight = false;
    }
};

async function handleManualLog(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const dur = calculateDuration(formData.get('checkIn'), formData.get('checkOut'));
    if (dur === 'Invalid') {
        alert('End time must be after Start time');
        return;
    }
    const date = formData.get('date');
    const checkIn = formData.get('checkIn');
    const checkOut = formData.get('checkOut');
    const checkInDate = window.AppAttendance.buildDateTime(date, checkIn);
    const checkOutDate = window.AppAttendance.buildDateTime(date, checkOut);
    const durationMs = (checkInDate && checkOutDate) ? (checkOutDate - checkInDate) : 0;
    const workedHours = Math.max(0, durationMs) / (1000 * 60 * 60);
    const attendanceEligible = workedHours >= 4;
    let resolvedType = 'Work Log';
    let resolvedDayCredit = 0;
    if (workedHours >= 8) {
        resolvedType = 'Present';
        resolvedDayCredit = 1;
    } else if (workedHours >= 4) {
        resolvedType = 'Half Day';
        resolvedDayCredit = 0.5;
    }

    const manualWorkDescription = String(formData.get('workDescription') || formData.get('location') || '').trim();
    const manualBudgetHeadId = app_normalizeBudgetHeadId(formData.get('budgetHeadId'));
    let manualUnallocatedReason = '';
    if (manualBudgetHeadId === APP_UNALLOCATED_BUDGET_HEAD.id) {
        manualUnallocatedReason = String(await window.appPrompt(
            'Enter reason for UNALLOCATED budget head:',
            '',
            { title: 'Reason Required', confirmText: 'Continue' }
        ) || '').trim();
        if (!manualUnallocatedReason) {
            alert('Reason is required when budget head is UNALLOCATED.');
            return;
        }
    }
    const logData = {
        date: formData.get('date'),
        checkIn: checkIn,
        checkOut: checkOut,
        duration: dur,
        durationMs: durationMs,
        location: 'Manual timesheet entry',
        workDescription: manualWorkDescription,
        budgetHeadId: manualBudgetHeadId,
        budgetHeadUnallocatedReason: manualUnallocatedReason,
        validationStatus: 'compliant',
        validationErrors: [],
        type: resolvedType,
        dayCredit: resolvedDayCredit,
        lateCountable: false,
        extraWorkedMs: 0,
        policyVersion: 'v2',
        entrySource: 'staff_manual_work',
        attendanceEligible: attendanceEligible,
        isManualOverride: false
    };
    await window.AppAttendance.addManualLog(logData);
    alert('Log added successfully!');
    document.getElementById('log-modal').style.display = 'none';
    contentArea.innerHTML = await AppUI.renderTimesheet();
}

async function handleAddUser(e) {
    e.preventDefault();
    const formData = new FormData(e.target);

    // Sanitize Input (Trim whitespace)
    const name = formData.get('name').trim();
    const username = formData.get('username').trim();
    const password = formData.get('password').trim();
    const email = formData.get('email').trim();

    const isAdmin = formData.get('isAdmin') === 'on' || formData.get('isAdmin') === 'true';
    const canManageAttendanceSheet = formData.get('canManageAttendanceSheet') === 'on' || formData.get('canManageAttendanceSheet') === 'true';
    const canAccessStaffAiMemory = formData.get('canAccessStaffAiMemory') === 'on' || formData.get('canAccessStaffAiMemory') === 'true';
    let birthdayFields;
    try {
        birthdayFields = app_extractBirthdayFields(formData);
    } catch (err) {
        alert(err.message);
        return;
    }

    const userData = {
        id: 'u' + Date.now(),
        name: name,
        username: username,
        password: password,
        role: formData.get('role'),
        dept: formData.get('dept'),
        email: email,
        phone: formData.get('phone'),
        joinDate: formData.get('joinDate'),
        isAdmin: isAdmin,
        canManageAttendanceSheet: canManageAttendanceSheet,
        canAccessStaffAiMemory: canAccessStaffAiMemory,
        canManageBirthdays: false,
        birthDay: birthdayFields.birthDay,
        birthMonth: birthdayFields.birthMonth,
        birthYear: birthdayFields.birthYear,
        permissions: window.app_getPermissionsFromUI('add'),
        avatar: `https://ui-avatars.com/api/?name=${formData.get('name')}&background=random&color=fff`,
        status: 'out',
        lastCheckIn: null
    };

    try {
        if (userData.isAdmin) {
            userData.role = 'Administrator';
            userData.canManageAttendanceSheet = true;
            userData.canManageBirthdays = true;
            userData.canAccessStaffAiMemory = true;
            userData.permissions = {
                ...(userData.permissions || {}),
                birthday: 'admin'
            };
        } else {
            userData.isAdmin = false;
            userData.canManageBirthdays = userData.permissions?.birthday === 'admin';
        }

        await window.AppDB.add('users', userData);
        alert('Success! Account created.');
        document.getElementById('add-user-modal').style.display = 'none';

        const contentArea = document.getElementById('page-content');
        if (contentArea) contentArea.innerHTML = await AppUI.renderAdmin();
    } catch (err) {
        alert('Error creating user: ' + err.message);
    }
}

window.app_getPermissionsFromUI = (prefix) => {
    const permissions = {};
    const modules = ['dashboard', 'leaves', 'users', 'attendance', 'reports', 'minutes', 'policies', 'birthday', 'letterPad', 'customize'];
    modules.forEach(m => {
        const viewCheck = document.getElementById(`${prefix}-perm-${m}-view`);
        const adminCheck = document.getElementById(`${prefix}-perm-${m}-admin`);
        if (adminCheck && adminCheck.checked) {
            permissions[m] = 'admin';
        } else if (viewCheck && viewCheck.checked) {
            permissions[m] = 'view';
        } else {
            permissions[m] = null;
        }
    });
    return permissions;
};

window.app_submitEditUser = async (e) => {
    if (e) e.preventDefault();

    // VALIDATED: Your evaluation is correct. e.target is the form, currentTarget is document.
    const form = (e && e.target && e.target.tagName === 'FORM') ? e.target : document.getElementById('edit-user-form');

    if (!form) {
        console.error("Critical Failure: Edit user form not found.");
        alert("Error: Form missing.");
        return;
    }

    const formData = new FormData(form);
    // VALIDATED: name="id" is present in ui.js, so this lookup is correct.
    const id = (formData.get('id') || "").trim();

    if (!id) {
        console.error("Data Failure: No 'id' name attribute found in form data.", {
            target: e.target,
            allData: Object.fromEntries(formData.entries())
        });
        alert('Error: User ID missing. Please refresh.');
        return;
    }

    const isAdminEl = form.querySelector('[name="isAdmin"]');
    const isAdmin = !!(isAdminEl && isAdminEl.checked);
    const canManageAttendanceSheetEl = form.querySelector('[name="canManageAttendanceSheet"]');
    const canManageAttendanceSheet = !!(canManageAttendanceSheetEl && canManageAttendanceSheetEl.checked);
    const canAccessStaffAiMemoryEl = form.querySelector('[name="canAccessStaffAiMemory"]');
    const canAccessStaffAiMemory = !!(canAccessStaffAiMemoryEl && canAccessStaffAiMemoryEl.checked);
    const pan = String(formData.get('pan') || '').trim().toUpperCase();
    const bankIfsc = String(formData.get('bankIfsc') || '').trim().toUpperCase();
    const joinDate = String(formData.get('joinDate') || '').trim();
    const inputEmployeeId = String(formData.get('employeeId') || '').trim();
    let birthdayFields;
    try {
        birthdayFields = app_extractBirthdayFields(formData);
    } catch (err) {
        alert(err.message);
        return;
    }
    const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
    const ifscPattern = /^[A-Z]{4}0[A-Z0-9]{6}$/;

    if (joinDate) {
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        if (joinDate > todayStr) {
            alert('Join Date cannot be in the future.');
            return;
        }
    }

    if (pan && !panPattern.test(pan)) {
        alert('Invalid PAN format. Use format like ABCDE1234F');
        return;
    }

    if (bankIfsc && !ifscPattern.test(bankIfsc)) {
        alert('Invalid IFSC format. Use format like SBIN0001234');
        return;
    }

    const employeeId = joinDate
        ? (inputEmployeeId || app_deriveEmployeeId(joinDate, id))
        : 'NA';

    const userData = {
        id,
        name: (formData.get('name') || "").trim(),
        username: (formData.get('username') || "").trim(),
        password: (formData.get('password') || "").trim(),
        role: formData.get('role'),
        dept: formData.get('dept'),
        email: (formData.get('email') || "").trim(),
        phone: (formData.get('phone') || "").trim(),
        isAdmin,
        canManageAttendanceSheet,
        canAccessStaffAiMemory,
        canManageBirthdays: false,
        employeeId,
        joinDate: joinDate || null,
        birthDay: birthdayFields.birthDay,
        birthMonth: birthdayFields.birthMonth,
        birthYear: birthdayFields.birthYear,
        baseSalary: Number(formData.get('baseSalary') || 0),
        otherAllowances: Number(formData.get('otherAllowances') || 0),
        providentFund: Number(formData.get('providentFund') || 0),
        professionalTax: Number(formData.get('professionalTax') || 0),
        loanAdvance: Number(formData.get('loanAdvance') || 0),
        tdsPercent: Number(formData.get('tdsPercent') || 0),
        bankName: (formData.get('bankName') || '').trim(),
        bankAccount: (formData.get('bankAccount') || '').trim(),
        bankIfsc: bankIfsc,
        pan: pan,
        uan: (formData.get('uan') || '').trim(),
        permissions: window.app_getPermissionsFromUI('edit')
    };

    console.log("Executing Update for User:", userData);
    if (userData.isAdmin) {
        userData.canManageAttendanceSheet = true;
        userData.canManageBirthdays = true;
        userData.canAccessStaffAiMemory = true;
        userData.role = 'Administrator';
        userData.permissions = {
            ...(userData.permissions || {}),
            birthday: 'admin'
        };
    } else {
        userData.canManageBirthdays = userData.permissions?.birthday === 'admin';
        userData.canAccessStaffAiMemory = !!userData.canAccessStaffAiMemory;
    }

    try {
        const success = await window.AppAuth.updateUser(userData);

        if (success) {
            console.log("Success: User updated in DB.");
            alert(`SUCCESS: Details for '${userData.name}' have been saved.`);
            document.getElementById('edit-user-modal').style.display = 'none';

            const contentArea = document.getElementById('page-content');
            if (contentArea) {
                // Small delay to let DB settle
                setTimeout(async () => {
                    contentArea.innerHTML = await AppUI.renderAdmin();
                    if (window.AppAnalytics) await window.AppAnalytics.initAdminCharts();
                }, 50);
            }
        } else {
            alert('Update failed: User not found.');
        }
    } catch (err) {
        console.error("Update Error:", err);
        alert('Error: ' + err.message);
    }
};

// --- Helpers ---

function calculateDuration(start, end) {
    const [h1, m1] = start.split(':');
    const [h2, m2] = end.split(':');
    const mins = (parseInt(h2) * 60 + parseInt(m2)) - (parseInt(h1) * 60 + parseInt(m1));
    if (mins < 0) return 'Invalid';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
}

function updateDashboardViewport() {
    const grid = document.querySelector('.dashboard-grid');
    if (grid) grid.dataset.viewport = window.innerWidth < 768 ? 'mobile' : 'desktop';
}
window.addEventListener('resize', updateDashboardViewport);

function setupDashboardEvents() {
    updateDashboardViewport();
    const btn = document.getElementById('attendance-btn');
    const readOnly = !!window.app_dashboardReadOnly;
    const targetUser = window.app_dashboardTargetUser || null;
    if (btn && !readOnly) btn.addEventListener('click', handleAttendance);
    startTimer(targetUser, readOnly);
    applyUpdateCtaState();
    if (window.app_refreshNotificationBell) {
        window.app_refreshNotificationBell().catch(() => { });
    }
    if (window.app_attachStatsCardHandlers) {
        window.app_attachStatsCardHandlers();
    }
    if (AppUI.initDashboardLayout) {
        AppUI.initDashboardLayout();
    }
}
window.setupDashboardEvents = setupDashboardEvents;

async function refreshDashboardAfterAttendance() {
    const currentHash = String(window.location.hash || '').replace(/^#/, '') || 'dashboard';
    if (currentHash !== 'dashboard') {
        return;
    }
    const contentArea = document.getElementById('page-content');
    if (!contentArea) return;
    try {
        contentArea.innerHTML = await AppUI.renderDashboard();
        setupDashboardEvents();
    } catch (err) {
        console.error('Dashboard refresh after attendance failed:', err);
        if (typeof window.app_showSyncToast === 'function') {
            window.app_showSyncToast('Attendance saved. Refresh the page if the dashboard looks stale.');
        }
    }
}
window.app_refreshDashboard = refreshDashboardAfterAttendance;

window.app_refreshCurrentPage = async function () {
    await router();
};

window.app_openTeamActivities = async function () {
    const targetHash = 'team-activities';
    const currentHash = String(window.location.hash || '').replace(/^#/, '');
    if (currentHash !== targetHash) {
        window.location.hash = targetHash;
        return;
    }
    if (typeof window.app_refreshCurrentPage === 'function') {
        await window.app_refreshCurrentPage();
    }
};

// --- Global Event Delegation ---

document.addEventListener('submit', (e) => {
    // Force prevent default for ALL forms in this app to prevent query param reloads
    e.preventDefault();

    // Day-plan modal form is handled by its own module-level submit listener.
    if (e.target?.classList?.contains('day-plan-form')) return;

    // Use getAttribute('id') because elements with name="id" shadow the form.id property!
    const id = String(e.target.getAttribute('id') || '');
    if (id === 'manual-log-form') handleManualLog(e);
    else if (id === 'checkout-form') window.app_submitCheckOut(e);
    else if (id === 'add-user-form') handleAddUser(e);
    else if (id === 'login-form') {
        (async () => {
            const fd = new FormData(e.target);
            try {
                const pos = await app_getAttendanceLocation();
                const success = await window.AppAuth.login(fd.get('username'), fd.get('password'));
                if (!success) {
                    alert('Invalid Credentials');
                    return;
                }
                const currentUser = window.AppAuth.getUser();
                if (currentUser) {
                    currentUser.lastLoginLocation = {
                        lat: pos.lat,
                        lng: pos.lng,
                        capturedAt: Date.now()
                    };
                    await window.AppDB.put('users', currentUser);
                }
                window.location.reload();
            } catch (err) {
                const errStr = String(err);
                if (errStr.includes('permission-denied') || errStr.includes('FirebaseError')) {
                    alert(`Database Error: ${errStr}\n\nAccess to the database was blocked. Please check your Firebase Firestore Security Rules.`);
                } else {
                    // Only assume it's a location error if it's not a Firebase error
                    alert(`Login blocked: ${errStr}\n\nPlease enable location and try again.`);
                }
            }
        })();
    }
    else if (id === 'edit-user-form') {
        console.log("Routing to app_submitEditUser...");
        window.app_submitEditUser(e);
    }
    else if (id === 'birthday-details-form') {
        window.app_submitBirthdayDetails(e);
    }
    else if (id === 'birthday-external-form') {
        window.app_submitExternalBirthdayPerson(e);
    }
    else if (id.startsWith('birthday-month-form-')) {
        const month = Number(id.replace('birthday-month-form-', ''));
        window.app_submitBirthdayMonthForm(e, month);
    }
    else if (id === 'notify-form') handleNotifyUser(e);
    else if (id === 'leave-request-form') handleLeaveRequest(e);
    else {
        console.warn("Unhandled form submission ID:", id, "Target:", e.target);
    }
});

async function handleLeaveRequest(e) {
    e.preventDefault();
    const formEl = e.target;
    if (!formEl || formEl.dataset.submitting === '1') return;
    formEl.dataset.submitting = '1';
    const fd = new FormData(e.target);
    const user = window.AppAuth.getUser();
    const startDate = fd.get('startDate');
    let endDate = fd.get('endDate');
    const type = fd.get('type');
    const submitBtn = formEl.querySelector('button[type="submit"]');
    const originalLabel = submitBtn ? submitBtn.innerHTML : '';
    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = 'Submitting...';
        }
        if (type === 'Half Day') {
            endDate = startDate;
        }
        await window.AppLeaves.requestLeave({
            userId: user.id,
            userName: user.name,
            startDate,
            endDate,
            startTime: fd.get('startTime') || '',
            endTime: fd.get('endTime') || '',
            type,
            reason: fd.get('reason'),
            durationHours: fd.get('durationHours') || ''
        });

        alert('Leave requested successfully!');
        document.getElementById('leave-modal').style.display = 'none';
        e.target.reset();
    } finally {
        formEl.dataset.submitting = '0';
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalLabel;
        }
    }
}

async function handleNotifyUser(e) {

    e.preventDefault();
    const formData = new FormData(e.target);
    const toUserId = formData.get('toUserId');
    const reminderMsg = formData.get('reminderMessage') || '';
    const reminderLink = formData.get('reminderLink') || '';
    const taskTitle = formData.get('taskTitle') || '';
    const taskDesc = formData.get('taskDescription') || '';
    const taskDue = formData.get('taskDueDate') || '';

    try {
        if (!reminderMsg.trim() && !taskTitle.trim()) {
            alert('Please enter a reminder or a task.');
            return;
        }
        // Check if user exists
        const user = await window.AppDB.get('users', toUserId);
        if (!user) throw new Error("User not found");

        const currentUser = window.AppAuth.getUser();
        const nowIso = new Date().toISOString();
        // Add notification(s)
        if (!user.notifications) user.notifications = [];
        if (reminderMsg.trim()) {
            user.notifications.unshift({
                id: `rem_${Date.now()}`,
                type: 'reminder',
                message: reminderMsg.trim(),
                taggedById: currentUser.id,
                taggedByName: currentUser.name,
                taggedAt: nowIso,
                status: 'pending',
                date: nowIso,
                read: false
            });
            await window.AppDB.add('staff_messages', {
                id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                type: 'text',
                message: reminderMsg.trim(),
                link: reminderLink.trim(),
                fromId: currentUser.id,
                fromName: currentUser.name,
                toId: toUserId,
                toName: user.name,
                createdAt: nowIso,
                read: false
            });
        }
        if (taskTitle.trim()) {
            user.notifications.unshift({
                id: `task_${Date.now()}`,
                type: 'task',
                title: taskTitle.trim(),
                description: taskDesc.trim(),
                taggedById: currentUser.id,
                taggedByName: currentUser.name,
                taggedAt: nowIso,
                status: 'pending',
                dueDate: taskDue || '',
                date: nowIso,
                read: false
            });
            await window.AppDB.add('staff_messages', {
                id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                type: 'task',
                title: taskTitle.trim(),
                description: taskDesc.trim(),
                dueDate: taskDue || '',
                status: 'pending',
                fromId: currentUser.id,
                fromName: currentUser.name,
                toId: toUserId,
                toName: user.name,
                createdAt: nowIso,
                read: false,
                history: [{ action: 'created', byId: currentUser.id, byName: currentUser.name, at: nowIso }]
            });
        }

        await window.AppAuth.updateUser(user);
        alert('Notification sent!');
        document.getElementById('notify-modal').style.display = 'none';
        if (window.app_updateStaffNavIndicator) {
            await window.app_updateStaffNavIndicator();
        }
    } catch (err) {
        alert('Failed to send: ' + err.message);
    }
}

window.app_openStaffThread = async (userId) => {
    window.app_staffThreadId = userId;
    const currentUser = window.AppAuth.getUser();
    if (!currentUser) return;
    const messages = await window.app_getMyMessages();
    const updates = messages.filter(m => m.toId === currentUser.id && m.fromId === userId && !m.read);
    for (const msg of updates) {
        msg.read = true;
        msg.readAt = new Date().toISOString();
        await window.AppDB.put('staff_messages', msg);
    }
    const contentArea = document.getElementById('page-content');
    if (contentArea) {
        contentArea.innerHTML = await AppUI.renderStaffDirectoryPage();
    }
    if (window.app_updateStaffNavIndicator) {
        await window.app_updateStaffNavIndicator();
    }
};

window.app_sendStaffText = async (e) => {
    e.preventDefault();
    const currentUser = window.AppAuth.getUser();
    const formData = new FormData(e.target);
    const toUserId = formData.get('toUserId');
    const message = (formData.get('message') || '').trim();
    const link = (formData.get('link') || '').trim();
    if (!message) {
        alert('Please type a message.');
        return;
    }
    const toUser = await window.AppDB.get('users', toUserId);
    if (!toUser) {
        alert('Staff member not found.');
        return;
    }
    await window.AppDB.add('staff_messages', {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'text',
        message,
        link,
        fromId: currentUser.id,
        fromName: currentUser.name,
        toId: toUserId,
        toName: toUser.name,
        createdAt: new Date().toISOString(),
        read: false
    });
    e.target.reset();
    const messageModal = document.getElementById('staff-message-modal');
    if (messageModal) messageModal.remove();
    const contentArea = document.getElementById('page-content');
    if (contentArea) {
        contentArea.innerHTML = await AppUI.renderStaffDirectoryPage();
    }
    if (window.app_updateStaffNavIndicator) {
        await window.app_updateStaffNavIndicator();
    }
};

window.app_sendStaffTask = async (e) => {
    e.preventDefault();
    const currentUser = window.AppAuth.getUser();
    const formData = new FormData(e.target);
    const toUserId = formData.get('toUserId');
    const title = (formData.get('taskTitle') || '').trim();
    const description = (formData.get('taskDescription') || '').trim();
    const dueDate = (formData.get('taskDueDate') || '').trim();
    if (!title) {
        alert('Please provide a task title.');
        return;
    }
    const toUser = await window.AppDB.get('users', toUserId);
    if (!toUser) {
        alert('Staff member not found.');
        return;
    }
    await window.AppDB.add('staff_messages', {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'task',
        title,
        description,
        dueDate,
        status: 'pending',
        fromId: currentUser.id,
        fromName: currentUser.name,
        toId: toUserId,
        toName: toUser.name,
        createdAt: new Date().toISOString(),
        read: false,
        history: [{ action: 'created', byId: currentUser.id, byName: currentUser.name, at: new Date().toISOString() }]
    });
    e.target.reset();
    const taskModal = document.getElementById('staff-task-modal');
    if (taskModal) taskModal.remove();
    const contentArea = document.getElementById('page-content');
    if (contentArea) {
        contentArea.innerHTML = await AppUI.renderStaffDirectoryPage();
    }
    if (window.app_updateStaffNavIndicator) {
        await window.app_updateStaffNavIndicator();
    }
};

window.app_openStaffMessageModal = (toUserId, toName) => {
    if (!toUserId) {
        alert('Select a staff member first.');
        return;
    }
    const safeName = String(toName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `
            <div class="modal-overlay" id="staff-message-modal" style="display:flex;">
                <div class="modal-content staff-message-modal">
                    <div class="staff-modal-head">
                        <div>
                            <h3>Send Message</h3>
                            <span>To ${safeName}</span>
                        </div>
                        <button onclick="this.closest('.modal-overlay').remove()" class="staff-modal-close">&times;</button>
                    </div>
                    <form onsubmit="window.app_sendStaffText(event)" class="staff-modal-form">
                        <input type="hidden" name="toUserId" value="${toUserId}">
                        <textarea name="message" rows="4" placeholder="Type a message... (text + links only)" required></textarea>
                        <input type="url" name="link" placeholder="Optional link (https://...)">
                        <button type="submit" class="action-btn">Send Message</button>
                    </form>
                </div>
            </div>
        `;
    window.app_showModal(html, 'staff-message-modal');
};

window.app_openStaffTaskModal = (toUserId, toName) => {
    if (!toUserId) {
        alert('Select a staff member first.');
        return;
    }
    const safeName = String(toName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `
            <div class="modal-overlay" id="staff-task-modal" style="display:flex;">
                <div class="modal-content staff-message-modal">
                    <div class="staff-modal-head">
                        <div>
                            <h3>Send Task</h3>
                            <span>To ${safeName}</span>
                        </div>
                        <button onclick="this.closest('.modal-overlay').remove()" class="staff-modal-close">&times;</button>
                    </div>
                    <form onsubmit="window.app_sendStaffTask(event)" class="staff-modal-form">
                        <input type="hidden" name="toUserId" value="${toUserId}">
                        <input type="text" name="taskTitle" placeholder="Task title" required>
                        <textarea name="taskDescription" rows="3" placeholder="Task details"></textarea>
                        <input type="date" name="taskDueDate">
                        <button type="submit" class="action-btn">Send Task</button>
                    </form>
                </div>
            </div>
        `;
    window.app_showModal(html, 'staff-task-modal');
};

window.app_respondStaffTask = async (messageId, response) => {
    const currentUser = window.AppAuth.getUser();
    const msg = await window.AppDB.get('staff_messages', messageId);
    if (!msg) {
        alert('Task not found.');
        return;
    }
    if (msg.toId !== currentUser.id) {
        alert('Only the recipient can approve or reject this task.');
        return;
    }
    let reason = '';
    if (response === 'rejected') {
        reason = (await window.appPrompt('Optional: add a rejection reason', '', { title: 'Reject Task', confirmText: 'Submit Reason' })) || '';
    }
    msg.status = response;
    msg.respondedAt = new Date().toISOString();
    if (reason) msg.rejectReason = reason;
    if (!msg.history) msg.history = [];
    msg.history.unshift({ action: response, byId: currentUser.id, byName: currentUser.name, at: msg.respondedAt, reason });

    if (response === 'approved' && !msg.calendarSynced) {
        const taskDate = msg.dueDate || new Date().toISOString().split('T')[0];
        const recipientName = msg.toName || currentUser.name;
        const details = `${msg.title}${msg.description ? ` - ${msg.description}` : ''}`;
        if (window.AppCalendar) {
            await window.AppCalendar.addWorkPlanTask(taskDate, msg.toId, `${details} (Responsible: ${recipientName})`, [], {
                addedFrom: 'staff',
                sourcePlanId: msg.id,
                sourceTaskIndex: 0,
                taggedById: msg.fromId,
                taggedByName: msg.fromName,
                status: 'pending'
            });
            await window.AppCalendar.addWorkPlanTask(taskDate, msg.fromId, `${details} (Assigned to ${recipientName})`, [], {
                addedFrom: 'staff',
                sourcePlanId: msg.id,
                sourceTaskIndex: 1,
                taggedById: msg.fromId,
                taggedByName: msg.fromName,
                status: 'pending'
            });
            msg.calendarSynced = true;
        }
    }
    await window.AppDB.put('staff_messages', msg);

    const sender = await window.AppDB.get('users', msg.fromId);
    if (sender) {
        if (!sender.notifications) sender.notifications = [];
        sender.notifications.unshift({
            id: `taskresp_${Date.now()}`,
            type: 'task_response',
            message: `${currentUser.name} ${response} a task.`,
            title: msg.title,
            taggedByName: currentUser.name,
            status: response,
            reason,
            date: msg.respondedAt,
            read: false
        });
        await window.AppDB.put('users', sender);
    }
    const contentArea = document.getElementById('page-content');
    if (contentArea) {
        contentArea.innerHTML = await AppUI.renderStaffDirectoryPage();
    }
    if (window.app_updateStaffNavIndicator) {
        await window.app_updateStaffNavIndicator();
    }
};

window.app_updateStaffNavIndicator = async () => {
    const currentUser = window.AppAuth.getUser();
    if (!currentUser) return;
    const navTargets = document.querySelectorAll('[data-page="staff-directory"]');
    if (!navTargets.length) return;
    const messages = await window.app_getMyMessages();
    const hasUnread = messages.some(m => m.toId === currentUser.id && !m.read);
    navTargets.forEach(el => {
        if (hasUnread) el.classList.add('has-new-msg');
        else el.classList.remove('has-new-msg');
    });
};

window.app_handleTagDecision = async (notifId, response) => {
    const user = window.AppAuth.getUser();
    try {
        const updatedUser = await window.AppDB.get('users', user.id);
        if (!updatedUser || !updatedUser.notifications) throw new Error('Notification not found');
        const notif = updatedUser.notifications.find(n => n.id === notifId);
        if (!notif) throw new Error('Notification not found');
        let reason = '';
        if (response === 'rejected') reason = (await window.appPrompt('Optional: add a rejection reason', '', { title: 'Reject Item', confirmText: 'Submit Reason' })) || '';
        const nowIso = new Date().toISOString();
        notif.status = response;
        notif.respondedAt = nowIso;
        notif.read = true;
        notif.dismissedAt = nowIso;
        if (reason) notif.rejectReason = reason;
        if (!updatedUser.tagHistory) updatedUser.tagHistory = [];
        updatedUser.tagHistory.unshift({
            id: `taghist_${Date.now()}`,
            type: 'tag_response',
            title: notif.title || notif.message || 'Tagged item',
            taggedByName: notif.taggedByName || 'Staff',
            status: response,
            reason,
            date: new Date().toISOString()
        });
        await window.AppDB.put('users', updatedUser);

        if (notif.taggedById) {
            const tagger = await window.AppDB.get('users', notif.taggedById);
            if (tagger) {
                if (!tagger.notifications) tagger.notifications = [];
                tagger.notifications.unshift({
                    id: `tagresp_${Date.now()}`,
                    type: 'tag_response',
                    message: `${user.name} ${response} your ${notif.type || 'tag'}.`,
                    title: notif.title || '',
                    taggedByName: user.name,
                    status: response,
                    reason,
                    date: new Date().toISOString(),
                    read: false
                });
                await window.AppDB.put('users', tagger);
            }
        }

        const contentArea = document.getElementById('page-content');
        if (contentArea) {
            contentArea.innerHTML = await AppUI.renderDashboard();
            if (window.setupDashboardEvents) window.setupDashboardEvents();
        }
    } catch (err) {
        alert('Failed to update tag: ' + err.message);
    }
};

document.addEventListener('auth-logout', () => window.AppAuth.logout());

window.app_reviewMinuteAccessFromNotification = async (notifIndex, notifId, decision) => {
    try {
        const currentUser = window.AppAuth.getUser();
        const isAdmin = currentUser && (currentUser.isAdmin || currentUser.role === 'Administrator');
        if (!isAdmin) {
            alert('Only admin can review access requests.');
            return;
        }

        const adminUser = await window.AppDB.get('users', currentUser.id);
        if (!adminUser || !Array.isArray(adminUser.notifications)) {
            alert('Notification not found.');
            return;
        }

        let notif = null;
        if (typeof notifIndex === 'number' && adminUser.notifications[notifIndex]) {
            notif = adminUser.notifications[notifIndex];
        }
        if (!notif && notifId) {
            notif = adminUser.notifications.find(n => String(n.id) === String(notifId));
        }
        if (!notif || notif.type !== 'minute-access-request') {
            alert('This notification is no longer available.');
            return;
        }

        const minuteId = notif.minuteId;
        const requesterId = notif.taggedById || notif.requesterId;
        if (!minuteId || !requesterId) {
            alert('Invalid access request payload.');
            return;
        }

        const minute = await window.AppDB.get('minutes', minuteId);
        if (!minute) {
            alert('Minute not found.');
            return;
        }

        const accessRequests = Array.isArray(minute.accessRequests) ? minute.accessRequests.slice() : [];
        const existingIndex = accessRequests.findIndex(r => r.userId === requesterId);
        if (existingIndex < 0) {
            accessRequests.push({
                userId: requesterId,
                userName: notif.taggedByName || 'Staff',
                requestedAt: notif.taggedAt || notif.date || new Date().toISOString(),
                status: 'pending',
                reviewedAt: '',
                reviewedBy: ''
            });
        }

        const reqIndex = accessRequests.findIndex(r => r.userId === requesterId);
        accessRequests[reqIndex] = {
            ...accessRequests[reqIndex],
            status: decision,
            reviewedAt: new Date().toISOString(),
            reviewedBy: currentUser.name
        };

        let allowedViewers = Array.isArray(minute.allowedViewers) ? minute.allowedViewers.slice() : [];
        if (decision === 'approved') {
            if (!allowedViewers.includes(requesterId)) allowedViewers.push(requesterId);
        } else {
            allowedViewers = allowedViewers.filter(uid => uid !== requesterId);
        }

        await window.AppMinutes.updateMinute(
            minuteId,
            { accessRequests, allowedViewers },
            decision === 'approved' ? 'Admin approved minutes access from notification' : 'Admin rejected minutes access from notification'
        );

        const requester = await window.AppDB.get('users', requesterId);
        if (requester) {
            if (!requester.notifications) requester.notifications = [];
            requester.notifications.unshift({
                id: Date.now() + Math.random(),
                type: 'minute-access-reviewed',
                title: 'Minutes Access Update',
                message: `Your request for "${minute.title}" was ${decision}.`,
                minuteId,
                taggedById: currentUser.id,
                taggedByName: currentUser.name,
                status: decision,
                taggedAt: new Date().toISOString(),
                date: new Date().toISOString()
            });
            await window.AppDB.put('users', requester);
        }

        const targetNotif = adminUser.notifications.find(n => String(n.id) === String(notif.id));
        if (targetNotif) {
            targetNotif.status = decision;
            targetNotif.respondedAt = new Date().toISOString();
            targetNotif.read = true;
            await window.AppAuth.updateUser(adminUser);
        }

        contentArea.innerHTML = await AppUI.renderDashboard();
        if (window.setupDashboardEvents) window.setupDashboardEvents();
        if (window.app_refreshNotificationBell) await window.app_refreshNotificationBell();
    } catch (err) {
        alert('Failed to review access request: ' + err.message);
    }
};

window.app_reviewMissedCheckoutReasonFromNotification = async (notifIndex, notifId, decision) => {
    try {
        const currentUser = window.AppAuth.getUser();
        const isAdmin = currentUser && (currentUser.isAdmin || currentUser.role === 'Administrator');
        if (!isAdmin) {
            alert('Only admin can review missed checkout reasons.');
            return;
        }

        const adminUser = await window.AppDB.get('users', currentUser.id);
        if (!adminUser || !Array.isArray(adminUser.notifications)) {
            alert('Notification not found.');
            return;
        }

        let notif = null;
        if (typeof notifIndex === 'number' && adminUser.notifications[notifIndex]) {
            notif = adminUser.notifications[notifIndex];
        }
        if (!notif && notifId) {
            notif = adminUser.notifications.find(n => String(n.id) === String(notifId));
        }
        if (!notif || notif.type !== 'missed-checkout-reason') {
            alert('This notification is no longer available.');
            return;
        }

        const staffId = notif.staffId || notif.taggedById;
        const logId = notif.logId;
        if (!staffId || !logId) {
            alert('Invalid missed checkout payload.');
            return;
        }

        let reviewNote = '';
        if (decision === 'rejected') {
            reviewNote = await window.app_requestMandatoryRejectionReason({
                title: 'Reject Auto Checkout',
                message: 'Please enter why this missed/auto checkout request is being rejected.',
                confirmText: 'Submit Reason'
            });
            if (reviewNote === null) return;
        }

        const log = await window.AppDB.get('attendance', logId);
        if (log) {
            const approvedMissedCheckoutUpdate = decision === 'approved' && log.autoCheckout
                ? {
                    type: 'Present',
                    missedCheckoutOriginalType: log.missedCheckoutOriginalType || log.type || 'Absent',
                    dayCredit: (window.AppAttendance && typeof window.AppAttendance.getDayCredit === 'function')
                        ? window.AppAttendance.getDayCredit('Present')
                        : 1,
                    lateCountable: false,
                    missedCheckoutApprovedAsFullDay: true,
                    missedCheckoutApprovedAt: new Date().toISOString(),
                    missedCheckoutApprovedBy: currentUser.name
                }
                : {};
            await window.AppDB.put('attendance', {
                ...log,
                ...approvedMissedCheckoutUpdate,
                missedCheckoutReasonStatus: decision,
                missedCheckoutReviewedBy: currentUser.name,
                missedCheckoutReviewedAt: new Date().toISOString(),
                missedCheckoutReviewNote: reviewNote || ''
            });
        }

        const nowIso = new Date().toISOString();
        const targetNotif = adminUser.notifications.find(n => String(n.id) === String(notif.id));
        if (targetNotif) {
            targetNotif.status = decision;
            targetNotif.respondedAt = nowIso;
            targetNotif.read = true;
            await window.AppAuth.updateUser(adminUser);
        }

        const staffUser = await window.AppDB.get('users', staffId);
        const reviewedDate = notif.missedCheckoutDate || (log ? log.date : 'the previous day');
        if (staffUser) {
            if (!staffUser.notifications) staffUser.notifications = [];
            staffUser.notifications.unshift({
                id: `mcr_rev_${Date.now()}`,
                type: 'missed-checkout-reason-reviewed',
                title: 'Missed checkout reason reviewed',
                message: `Admin ${decision} your missed checkout reason for ${reviewedDate}.`,
                status: decision,
                date: nowIso,
                taggedById: currentUser.id,
                taggedByName: currentUser.name,
                reviewNote: reviewNote || ''
            });
            await window.AppDB.put('users', staffUser);
        }

        contentArea.innerHTML = await AppUI.renderDashboard();
        if (window.setupDashboardEvents) window.setupDashboardEvents();
        if (window.app_refreshNotificationBell) await window.app_refreshNotificationBell();

        const decisionLabel = decision === 'approved' ? 'approved' : 'rejected';
        const confirmationMessage = `${notif.staffName || 'Staff'}'s missed checkout for ${reviewedDate} was ${decisionLabel}.`;
        if (window.appAlert) {
            await window.appAlert(confirmationMessage, 'Review Complete');
        } else {
            alert(confirmationMessage);
        }
    } catch (err) {
        alert('Failed to review missed checkout reason: ' + err.message);
    }
};

window.app_undoMissedCheckoutReview = async (notifId) => {
    try {
        const currentUser = window.AppAuth.getUser();
        const isAdmin = currentUser && (currentUser.isAdmin || currentUser.role === 'Administrator');
        if (!isAdmin) {
            alert('Only admin can undo missed checkout reviews.');
            return;
        }

        const adminUser = await window.AppDB.get('users', currentUser.id);
        if (!adminUser || !Array.isArray(adminUser.notifications)) {
            alert('Notification not found.');
            return;
        }

        const notif = adminUser.notifications.find((n) =>
            n
            && n.type === 'missed-checkout-reason'
            && String(n.id || '') === String(notifId || '')
        );
        if (!notif) {
            alert('This missed checkout review is no longer available.');
            return;
        }

        const logId = notif.logId;
        if (!logId) {
            alert('Invalid missed checkout review payload.');
            return;
        }

        const log = await window.AppDB.get('attendance', logId);
        if (log) {
            const restoredType = log.missedCheckoutOriginalType || log.originalTypeBeforeApproval || (log.autoCheckout ? 'Absent' : log.type);
            await window.AppDB.put('attendance', {
                ...log,
                type: restoredType,
                dayCredit: (window.AppAttendance && typeof window.AppAttendance.getDayCredit === 'function')
                    ? window.AppAttendance.getDayCredit(restoredType)
                    : (restoredType === 'Present' ? 1 : 0),
                lateCountable: restoredType === 'Late',
                missedCheckoutApprovedAsFullDay: false,
                missedCheckoutApprovedAt: '',
                missedCheckoutApprovedBy: '',
                missedCheckoutReasonStatus: 'pending',
                missedCheckoutReviewedBy: '',
                missedCheckoutReviewedAt: '',
                missedCheckoutReviewNote: ''
            });
        }

        notif.status = 'pending';
        notif.respondedAt = '';
        notif.read = false;
        await window.AppAuth.updateUser(adminUser);

        const staffId = notif.staffId || notif.taggedById;
        const staffUser = staffId ? await window.AppDB.get('users', staffId) : null;
        if (staffUser) {
            if (!Array.isArray(staffUser.notifications)) staffUser.notifications = [];
            staffUser.notifications.unshift({
                id: `mcr_undo_${Date.now()}`,
                type: 'missed-checkout-review-undone',
                title: 'Missed checkout review reopened',
                message: `Admin moved your missed checkout request for ${notif.missedCheckoutDate || log?.date || 'the selected date'} back to pending review.`,
                status: 'pending',
                date: new Date().toISOString(),
                taggedById: currentUser.id,
                taggedByName: currentUser.name
            });
            await window.AppDB.put('users', staffUser);
        }

        if (typeof window.app_refreshAdminPage === 'function') {
            await window.app_refreshAdminPage();
        } else if (contentArea) {
            contentArea.innerHTML = await AppUI.renderDashboard();
            if (window.setupDashboardEvents) window.setupDashboardEvents();
        }

        if (window.app_refreshNotificationBell) await window.app_refreshNotificationBell();
    } catch (err) {
        alert('Failed to undo missed checkout review: ' + err.message);
    }
};

document.addEventListener('dismiss-notification', async (e) => {
    const payload = e.detail;
    const index = (typeof payload === 'object' && payload !== null) ? payload.notifIndex : payload;
    const notifId = (typeof payload === 'object' && payload !== null) ? String(payload.notifId || '') : '';
    const user = window.AppAuth.getUser();
    if (user && user.notifications && Number.isInteger(index) && index >= 0) {
        let notif = user.notifications[index];
        if (!notif && notifId) {
            notif = user.notifications.find(n => String(n.id || '') === notifId);
        }
        if (!notif) return;
        notif.read = true;
        notif.dismissedAt = new Date().toISOString();
        await window.AppAuth.updateUser(user);
        const hash = window.location.hash.slice(1) || 'dashboard';
        if (hash === 'dashboard') {
            contentArea.innerHTML = await AppUI.renderDashboard();
            if (window.setupDashboardEvents) window.setupDashboardEvents();
        }
        if (window.app_refreshNotificationBell) await window.app_refreshNotificationBell();
    } else if (user && user.notifications && notifId) {
        const notif = user.notifications.find(n => String(n.id || '') === notifId);
        if (!notif) return;
        notif.read = true;
        notif.dismissedAt = new Date().toISOString();
        await window.AppAuth.updateUser(user);
        const hash = window.location.hash.slice(1) || 'dashboard';
        if (hash === 'dashboard') {
            contentArea.innerHTML = await AppUI.renderDashboard();
            if (window.setupDashboardEvents) window.setupDashboardEvents();
        }
        if (window.app_refreshNotificationBell) await window.app_refreshNotificationBell();
    }
});

document.addEventListener('dismiss-tag-history', async (e) => {
    const historyId = String(e.detail || '');
    const user = window.AppAuth.getUser();
    if (!historyId || !user) return;
    if (!Array.isArray(user.tagHistory)) return;
    const removeIndex = user.tagHistory.findIndex(h => String(h.id) === historyId);
    if (removeIndex < 0) return;
    user.tagHistory.splice(removeIndex, 1);
    await window.AppAuth.updateUser(user);
    contentArea.innerHTML = await AppUI.renderDashboard();
    if (window.setupDashboardEvents) window.setupDashboardEvents();
});

// Manual Log Logic
document.addEventListener('open-log-modal', () => {
    const modal = document.getElementById('log-modal');
    if (!modal) return;
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    document.getElementById('log-date').value = now.toISOString().split('T')[0];
    document.getElementById('log-start-time').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const later = new Date(now.getTime() + 3600000);
    document.getElementById('log-end-time').value = `${pad(later.getHours())}:${pad(later.getMinutes())}`;
    modal.style.display = 'flex';
});

document.addEventListener('set-duration', (e) => {
    const minutes = e.detail;
    const startTimeInput = document.getElementById('log-start-time');
    const endTimeInput = document.getElementById('log-end-time');
    if (startTimeInput.value) {
        const [h, m] = startTimeInput.value.split(':').map(Number);
        const startDate = new Date();
        startDate.setHours(h, m);
        const endDate = new Date(startDate.getTime() + minutes * 60 * 1000);
        const pad = n => n.toString().padStart(2, '0');
        endTimeInput.value = `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;
    }
});

// Admin Events
// --- Global Functions (Exposed for UI onclicks) ---

window.app_editUser = async (userId) => {
    console.log("Opening Edit Modal for ID:", userId);
    const user = await window.AppDB.get('users', userId);
    console.log("User Data Found:", user);
    if (!user) return;
    const form = document.getElementById('edit-user-form');
    if (!form) return;

    const setVal = (selector, val) => {
        const el = form.querySelector(selector);
        if (el) el.value = val !== undefined ? val : '';
    };
    const setChecked = (selector, val) => {
        const el = form.querySelector(selector);
        if (el) el.checked = !!val;
    };

    setVal('#edit-user-id', user.id);
    setVal('#edit-user-name', user.name);
    setVal('#edit-user-username', user.username);
    setVal('#edit-user-password', user.password);
    setVal('#edit-user-role', user.role);
    setVal('#edit-user-dept', user.dept);
    setVal('#edit-user-email', user.email);
    setVal('#edit-user-phone', user.phone);
    setChecked('#edit-user-isAdmin', !!(user.isAdmin || user.role === 'Administrator'));
    setChecked('#edit-user-can-manage-attendance-sheet', !!(user.canManageAttendanceSheet || user.isAdmin || user.role === 'Administrator'));
    setChecked('#edit-user-can-access-staff-ai-memory', !!(user.canAccessStaffAiMemory || user.isAdmin || user.role === 'Administrator'));
    setVal('#edit-user-birth-day', user.birthDay || '');
    setVal('#edit-user-birth-month', user.birthMonth || '');
    setVal('#edit-user-birth-year', user.birthYear || '');

    const normalizedJoinDate = app_normalizeIsoDate(user.joinDate);
    setVal('#edit-user-join-date', normalizedJoinDate);
    setVal('#edit-user-employee-id', normalizedJoinDate
        ? (user.employeeId || app_deriveEmployeeId(normalizedJoinDate, user.id))
        : 'NA');
    setVal('#edit-user-base-salary', Number(user.baseSalary || 0));
    setVal('#edit-user-other-allowances', Number(user.otherAllowances || 0));
    setVal('#edit-user-pf', Number(user.providentFund || 0));
    setVal('#edit-user-professional-tax', Number(user.professionalTax || 0));
    setVal('#edit-user-loan-advance', Number(user.loanAdvance || 0));
    setVal('#edit-user-tds-percent', Number(user.tdsPercent || 0));
    setVal('#edit-user-bank-name', user.bankName || '');
    setVal('#edit-user-bank-account', user.bankAccount || user.accountNumber || '');
    setVal('#edit-user-bank-ifsc', user.bankIfsc || user.ifsc || '');
    setVal('#edit-user-pan', user.pan || user.PAN || '');
    setVal('#edit-user-uan', user.uan || user.UAN || '');

    // Populate permissions
    const modules = ['dashboard', 'leaves', 'users', 'attendance', 'reports', 'minutes', 'policies', 'birthday', 'letterPad', 'customize'];
    const permissions = user.permissions || {};
    modules.forEach(m => {
        const val = permissions[m];
        const viewEl = document.getElementById(`edit-perm-${m}-view`);
        const adminEl = document.getElementById(`edit-perm-${m}-admin`);
        if (viewEl) viewEl.checked = (val === 'view' || val === 'admin');
        if (adminEl) adminEl.checked = (val === 'admin');
    });

    if (!permissions.birthday && (user.canManageBirthdays || user.isAdmin || user.role === 'Administrator')) {
        const birthdayViewEl = document.getElementById('edit-perm-birthday-view');
        const birthdayAdminEl = document.getElementById('edit-perm-birthday-admin');
        if (birthdayViewEl) birthdayViewEl.checked = true;
        if (birthdayAdminEl) birthdayAdminEl.checked = true;
    }

    const modal = document.getElementById('edit-user-modal');
    if (modal) {
        modal.style.display = 'flex';
        const pnl = document.getElementById('edit-user-permissions-panel');
        if (pnl) {
            // ALWAYS SHOW the permissions panel so admins can assign rights to any staff
            pnl.style.display = 'block';
        }
    }
};

window.app_notifyUser = (userId) => {
    console.log("Opening Notify for:", userId);
    document.getElementById('notify-user-id').value = userId;
    document.getElementById('notify-modal').style.display = 'flex';
};

window.app_quickAddTask = async (userId) => {
    const currentUser = window.AppAuth.getUser();
    const isAdmin = currentUser && (currentUser.role === 'Administrator' || currentUser.isAdmin);
    if (!isAdmin && userId !== currentUser.id) {
        alert('Only administrators can assign tasks to other staff.');
        return;
    }
    const taskText = await window.appPrompt('Task to assign:', '', { title: 'Assign Task', placeholder: 'Enter task title', confirmText: 'Next' });
    if (!taskText || !taskText.trim()) return;
    const dateInput = await window.appPrompt('Task date (YYYY-MM-DD). Leave blank for today:', '', { title: 'Assign Task Date', placeholder: 'YYYY-MM-DD', confirmText: 'Create Task' });
    const date = dateInput && dateInput.trim()
        ? dateInput.trim()
        : new Date().toISOString().split('T')[0];
    try {
        if (!window.AppCalendar) throw new Error('Calendar module not available.');
        await window.AppCalendar.addWorkPlanTask(date, userId, taskText.trim());
        await window.AppDB.add('staff_messages', {
            id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: 'task',
            title: taskText.trim(),
            description: '',
            dueDate: date,
            status: 'pending',
            fromId: currentUser.id,
            fromName: currentUser.name,
            toId: userId,
            toName: (await window.AppDB.get('users', userId))?.name || 'Staff',
            createdAt: new Date().toISOString(),
            read: false,
            history: [{ action: 'created', byId: currentUser.id, byName: currentUser.name, at: new Date().toISOString() }]
        });
        alert('Task added successfully.');
        const contentArea = document.getElementById('page-content');
        if (contentArea) {
            contentArea.innerHTML = await AppUI.renderDashboard();
            if (window.setupDashboardEvents) window.setupDashboardEvents();
        }
        if (window.app_updateStaffNavIndicator) {
            await window.app_updateStaffNavIndicator();
        }
    } catch (err) {
        alert('Failed to add task: ' + err.message);
    }
};

window.app_viewLogs = async (userId) => {
    if (!window.app_canManageAttendanceSheet()) {
        alert("You do not have permission for this action.");
        return;
    }
    console.log("Viewing details for:", userId);
    const user = await window.AppDB.get('users', userId);
    let logs = await window.AppAttendance.getLogs(userId);

    // Sort: Chronological (Oldest First) for the detailed report view if requested
    // But usually, newest first is better for quick check. 
    // Let's stick to newest first as per attendance.js, but ensure it's clear.

    window.currentViewedLogs = logs;
    window.currentViewedUser = user;

    const logsHTML = logs.length ? `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>In</th>
                            <th>Out</th>
                            <th>Duration</th>
                            <th>Type</th>
                            <th>Location</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map(log => {
        let locDisplay = log.location || 'N/A';
        if (log.lat && log.lng) {
            locDisplay = `<a href="https://www.google.com/maps?q=${log.lat},${log.lng}" target="_blank" style="color:var(--primary);text-decoration:none;">
                                    <i class="fa-solid fa-map-pin"></i> ${Number(log.lat).toFixed(4)}, ${Number(log.lng).toFixed(4)}
                                </a>`;
        }
        return `
                            <tr>
                                <td>${log.date}</td>
                                <td>${log.checkIn}</td>
                                <td>${log.checkOut || '--'}</td>
                                <td>${log.duration || '--'}</td>
                                <td><span class="badge ${log.isManualOverride ? 'manual' : ''}" style="font-size:0.7rem; padding: 2px 6px;">${log.type || 'Office'}</span></td>
                                <td style="font-size:0.85rem; color:#6b7280;">
                                    <div style="display:flex; justify-content:space-between; align-items:center;">
                                        ${locDisplay}
                                        <button onclick="window.app_deleteLog('${log.id}', '${userId}')" style="background:none; border:none; color:#ef4444; cursor:pointer;" title="Delete Log"><i class="fa-solid fa-trash"></i></button>
                                    </div>
                                </td>
                            </tr>`;
    }).join('')}
                    </tbody>
                </table>
            </div>` : '<p style="text-align:center; padding:1rem; color:#6b7280;">No logs found for this user.</p>';

    document.getElementById('user-details-content').innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                <div>
                     <h3>${user.name}</h3>
                     <p style="color:#6b7280; font-size:0.9rem;">${user.role} | ${user.dept || 'General'}</p>
                </div>
                <div style="display:flex; gap:0.5rem;">
                    <button onclick="window.app_openManualLogModal('${user.id}')" class="action-btn" style="padding:0.5rem 1rem; font-size:0.9rem; background:#10b981; border:none;">
                        <i class="fa-solid fa-plus"></i> Add Manual Log
                    </button>
                    <button onclick="window.AppReports.exportUserLogsCSV(window.currentViewedUser, window.currentViewedLogs)" class="action-btn secondary" style="padding:0.5rem 1rem; font-size:0.9rem;">
                        <i class="fa-solid fa-file-export"></i> Export Report
                    </button>
                </div>
            </div>
            ${logsHTML}
        `;
    document.getElementById('user-details-modal').style.display = 'flex';
};

window.app_openManualLogModal = (userId) => {
    if (!window.app_canManageAttendanceSheet()) {
        alert("You do not have permission for this action.");
        return;
    }
    const html = `
            <div class="modal-overlay" id="manual-admin-log-modal" style="display:flex;">
                <div class="modal-content">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
                        <h3>Add Manual Attendance</h3>
                        <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:1.2rem; cursor:pointer;">&times;</button>
                    </div>
                    <form onsubmit="window.app_submitManualLog(event, '${userId}')">
                        <div style="display:flex; flex-direction:column; gap:1rem;">
                            <div>
                                <label style="display:block; font-size:0.85rem; margin-bottom:0.25rem;">Date</label>
                                <input type="date" name="date" required value="${new Date().toISOString().split('T')[0]}" style="width:100%; padding:0.75rem; border:1px solid #ddd; border-radius:8px;">
                            </div>
                            <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
                                <div>
                                    <label style="display:block; font-size:0.85rem; margin-bottom:0.25rem;">Time In</label>
                                    <input type="time" name="checkIn" required value="09:00" style="width:100%; padding:0.75rem; border:1px solid #ddd; border-radius:8px;">
                                </div>
                                <div>
                                    <label style="display:block; font-size:0.85rem; margin-bottom:0.25rem;">Time Out</label>
                                    <input type="time" name="checkOut" required value="17:00" style="width:100%; padding:0.75rem; border:1px solid #ddd; border-radius:8px;">
                                </div>
                            </div>
                            <div>
                                <label style="display:block; font-size:0.85rem; margin-bottom:0.25rem;">Category / Rule Override</label>
                                <select name="type" required style="width:100%; padding:0.75rem; border:1px solid #ddd; border-radius:8px;">
                                    <option value="Present">Present (Full Day)</option>
                                    <option value="Work - Home">Work from Home</option>
                                    <option value="Late">Late (Mark as Late)</option>
                                    <option value="Early Departure">Early Departure</option>
                                    <option value="Training">Training</option>
                                    <option value="Absent">Absent</option>
                                </select>
                            </div>
                            <div>
                                <label style="display:block; font-size:0.85rem; margin-bottom:0.25rem;">Admin Comment</label>
                                <textarea name="description" placeholder="Reason for manual entry..." style="width:100%; padding:0.75rem; border:1px solid #ddd; border-radius:8px; height:60px;"></textarea>
                            </div>
                            <button type="submit" class="action-btn" style="width:100%; margin-top:1rem;">Save Manual Entry</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    window.app_showModal(html, 'manual-admin-log-modal');
};

window.app_submitManualLog = async (e, userId) => {
    if (!window.app_canManageAttendanceSheet()) {
        alert("You do not have permission for this action.");
        return;
    }
    e.preventDefault();
    const fd = new FormData(e.target);
    const checkIn = fd.get('checkIn');
    const checkOut = fd.get('checkOut');

    const dur = calculateDuration(checkIn, checkOut);
    if (dur === 'Invalid') {
        alert('End time must be after Start time');
        return;
    }
    const date = fd.get('date');
    const checkInDate = window.AppAttendance.buildDateTime(date, checkIn);
    const checkOutDate = window.AppAttendance.buildDateTime(date, checkOut);
    const durationMs = (checkInDate && checkOutDate) ? (checkOutDate - checkInDate) : 0;
    const statusMeta = window.AppAttendance.evaluateAttendanceStatus(checkInDate || new Date(), durationMs);

    // Convert 24h back to AM/PM for display consistency (optional, but better)
    const formatTime = (timeStr) => {
        const [h, m] = timeStr.split(':');
        const hours = parseInt(h);
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayH = hours % 12 || 12;
        return `${String(displayH).padStart(2, '0')}:${m} ${ampm}`;
    };

    const logData = {
        date,
        checkIn: formatTime(checkIn),
        checkOut: formatTime(checkOut),
        duration: dur,
        type: statusMeta.status,
        workDescription: fd.get('description') || 'Manual Entry by Admin',
        location: 'Office (Manual)',
        durationMs: durationMs,
        dayCredit: statusMeta.dayCredit,
        lateCountable: statusMeta.lateCountable,
        extraWorkedMs: statusMeta.extraWorkedMs || 0,
        policyVersion: 'v2',
        isManualOverride: true,
        entrySource: 'admin_override',
        attendanceEligible: true
    };

    try {
        await window.AppAttendance.addAdminLog(userId, logData);
        alert("Attendance added manually.");
        document.getElementById('manual-admin-log-modal')?.remove();
        // Refresh logs view
        window.app_viewLogs(userId);
    } catch (err) {
        alert("Error: " + err.message);
    }
};

window.app_deleteLog = async (logId, userId) => {
    if (!window.app_canManageAttendanceSheet()) {
        alert("You do not have permission for this action.");
        return;
    }
    if (!await window.appConfirm("Are you sure you want to delete this attendance record?")) return;
    try {
        await window.AppAttendance.deleteLog(logId);
        alert("Record deleted.");
        window.app_viewLogs(userId);
    } catch (err) {
        alert("Error: " + err.message);
    }
};

// --- Leave Management Handlers ---
const app_refreshAfterLeaveAction = async () => {
    if (typeof window.app_refreshAdminPage === 'function' && (window.location.hash || '').includes('admin')) {
        await window.app_refreshAdminPage();
        return;
    }
    if (contentArea) {
        contentArea.innerHTML = await AppUI.renderDashboard();
        setupDashboardEvents();
    }
};

window.app_approveLeave = async (leaveId) => {
    if (!await window.appConfirm("Are you sure you want to APPROVE this leave request?")) return;
    try {
        const user = window.AppAuth.getUser();
        await window.AppLeaves.updateLeaveStatus(leaveId, 'Approved', user.id);
        alert("Leave Approved! Attendance logs have been automatically generated.");
        await app_refreshAfterLeaveAction();
    } catch (err) {
        alert("Error: " + err.message);
    }
};

window.app_rejectLeave = async (leaveId) => {
    const reason = await window.app_requestMandatoryRejectionReason({
        title: 'Reject Leave',
        message: 'Please enter why this leave request is being rejected.',
        confirmText: 'Reject Leave'
    });
    if (reason === null) return; // Cancelled

    try {
        const user = window.AppAuth.getUser();
        await window.AppLeaves.updateLeaveStatus(leaveId, 'Rejected', user.id, reason);
        alert("Leave Rejected.");
        await app_refreshAfterLeaveAction();
    } catch (err) {
        alert("Error: " + err.message);
    }
};

window.app_undoLeaveDecision = async (leaveId) => {
    try {
        const leave = await window.AppDB.get('leaves', leaveId);
        if (!leave) {
            alert('Leave request not found.');
            return;
        }
        if (String(leave.status || '').toLowerCase() === 'pending') {
            alert('This leave request is already pending.');
            return;
        }
        if (!await window.appConfirm('Move this leave request back to pending review?')) return;
        const user = window.AppAuth.getUser();
        await window.AppLeaves.updateLeaveStatus(leaveId, 'Pending', user?.id || '');
        alert('Leave request moved back to pending.');
        await app_refreshAfterLeaveAction();
    } catch (err) {
        alert('Error: ' + err.message);
    }
};

window.app_addLeaveComment = async (leaveId) => {
    const leave = await window.AppDB.get('leaves', leaveId);
    const comment = await window.appPrompt("Enter/Edit Admin Comment:", leave.adminComment || "", { title: 'Admin Comment', confirmText: 'Save Comment' });
    if (comment === null) return;

    try {
        const user = window.AppAuth.getUser();
        await window.AppLeaves.updateLeaveStatus(leaveId, leave.status, user.id, comment);
        alert("Comment saved.");

        // Refresh Dashboard
        const contentArea = document.getElementById('page-content');
        if (contentArea) {
            contentArea.innerHTML = await AppUI.renderDashboard();
            setupDashboardEvents();
        }
    } catch (err) {
        alert("Error: " + err.message);
    }
};

window.app_exportLeaves = async () => {
    try {
        const allLeaves = await window.AppLeaves.getAllLeaves();
        if (allLeaves.length === 0) {
            alert("No leave requests found to export.");
            return;
        }
        await window.AppReports.exportLeavesCSV(allLeaves);
    } catch (err) {
        alert("Export Failed: " + err.message);
    }
};

window.app_exportLeaveRequestPdf = async (leaveId) => {
    try {
        const leave = await window.AppDB.get('leaves', leaveId);
        if (!leave) {
            alert('Leave request not found.');
            return;
        }
        const user = await window.AppDB.get('users', leave.userId).catch(() => null);
        const staffName = leave.userName || user?.name || 'Staff';
        const status = String(leave.status || 'Pending');
        const statusColor = status === 'Approved' ? '#166534' : status === 'Rejected' ? '#b91c1c' : '#854d0e';
        const printWindow = window.open('', '_blank', 'width=920,height=760');
        if (!printWindow) {
            alert('Please allow popups to open the printable leave slip.');
            return;
        }

        const escapeHtml = (value) => String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const html = `
            <!doctype html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Leave Slip - ${escapeHtml(staffName)}</title>
                <style>
                    body { font-family: "Segoe UI", Tahoma, sans-serif; margin: 0; background: #eef4fb; color: #1f2937; }
                    .sheet { max-width: 820px; margin: 32px auto; background: #fff; border-radius: 24px; padding: 32px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.14); }
                    .head { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 24px; }
                    .brand { font-size: 28px; font-weight: 800; color: #1e3a5f; margin: 0 0 6px; }
                    .sub { margin: 0; color: #64748b; font-size: 14px; }
                    .status { padding: 10px 16px; border-radius: 999px; font-weight: 700; color: ${statusColor}; background: ${statusColor}15; border: 1px solid ${statusColor}33; }
                    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 24px; }
                    .card { border: 1px solid #dbe5f1; border-radius: 18px; padding: 16px 18px; background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%); }
                    .label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin-bottom: 6px; font-weight: 700; }
                    .value { font-size: 18px; font-weight: 700; color: #0f172a; }
                    .full { grid-column: 1 / -1; }
                    .reason { min-height: 84px; white-space: pre-wrap; line-height: 1.55; }
                    .actions { margin-top: 28px; display: flex; justify-content: flex-end; }
                    button { border: 0; border-radius: 14px; padding: 12px 18px; background: linear-gradient(135deg, #355b86 0%, #28496f 100%); color: #fff; font-weight: 700; cursor: pointer; }
                    @media print {
                        body { background: #fff; }
                        .sheet { margin: 0; box-shadow: none; border-radius: 0; max-width: none; }
                        .actions { display: none; }
                    }
                </style>
            </head>
            <body>
                <div class="sheet">
                    <div class="head">
                        <div>
                            <h1 class="brand">CRWI Attendance</h1>
                            <p class="sub">Leave request slip</p>
                        </div>
                        <div class="status">${escapeHtml(status)}</div>
                    </div>
                    <div class="grid">
                        <div class="card"><span class="label">Staff</span><div class="value">${escapeHtml(staffName)}</div></div>
                        <div class="card"><span class="label">Type</span><div class="value">${escapeHtml(leave.type || '--')}</div></div>
                        <div class="card"><span class="label">From</span><div class="value">${escapeHtml(leave.startDate || '--')}</div></div>
                        <div class="card"><span class="label">To</span><div class="value">${escapeHtml(leave.endDate || '--')}</div></div>
                        <div class="card"><span class="label">Days</span><div class="value">${escapeHtml(leave.daysCount || '--')}</div></div>
                        <div class="card"><span class="label">Applied On</span><div class="value">${escapeHtml(leave.appliedOn ? new Date(leave.appliedOn).toLocaleString() : '--')}</div></div>
                        <div class="card full"><span class="label">Reason</span><div class="value reason">${escapeHtml(leave.reason || 'No reason provided.')}</div></div>
                        <div class="card full"><span class="label">Admin Comment</span><div class="value reason">${escapeHtml(leave.adminComment || 'No admin comment added.')}</div></div>
                    </div>
                    <div class="actions">
                        <button onclick="window.print()">Print / Save PDF</button>
                    </div>
                </div>
            </body>
            </html>
        `;

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
    } catch (err) {
        alert('Failed to open leave slip: ' + err.message);
    }
};


window.app_refreshMasterSheet = async () => {
    const contentArea = document.getElementById('page-content');
    if (contentArea) {
        const m = document.getElementById('sheet-month')?.value;
        const y = document.getElementById('sheet-year')?.value;
        contentArea.innerHTML = await AppUI.renderMasterSheet(m, y);
    }
};

window.app_exportMasterSheet = async () => {
    if (!window.app_canManageAttendanceSheet()) {
        alert("You do not have permission for this action.");
        return;
    }
    const month = parseInt(document.getElementById('sheet-month').value);
    const year = parseInt(document.getElementById('sheet-year').value);
    const users = await window.AppDB.getAll('users');

    // Filtered Query for Logs (Optimization)
    const startDateStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDateStr = `${year}-${String(month + 1).padStart(2, '0')}-31`;
    const logs = await window.AppDB.query('attendance', 'date', '>=', startDateStr);
    const filteredLogs = logs.filter(l => l.date <= endDateStr);

    await window.AppReports.exportMasterSheetCSV(month, year, users, filteredLogs);
};

window.app_openCellOverride = async (userId, dateStr) => {
    if (!window.app_canManageAttendanceSheet()) {
        alert("You do not have permission for this action.");
        return;
    }
    const user = (await window.AppDB.getAll('users')).find(u => u.id === userId);
    const logs = await window.AppDB.getAll('attendance');
    const isAttendanceEligibleLog = (log) => {
        if (Object.prototype.hasOwnProperty.call(log || {}, 'attendanceEligible')) {
            return log.attendanceEligible === true;
        }
        const src = String(log?.entrySource || '');
        if (src === 'staff_manual_work') return false;
        if (src === 'admin_override' || src === 'checkin_checkout') return true;
        if (log?.isManualOverride) return true;
        if (log?.location === 'Office (Manual)' || log?.location === 'Office (Override)') return true;
        const hasSystemSignals =
            typeof log?.activityScore !== 'undefined' ||
            typeof log?.locationMismatched !== 'undefined' ||
            typeof log?.autoCheckout !== 'undefined' ||
            !!log?.checkOutLocation ||
            typeof log?.outLat !== 'undefined' ||
            typeof log?.outLng !== 'undefined';
        if (hasSystemSignals) return true;
        const type = String(log?.type || '');
        return type.includes('Leave') || log?.location === 'On Leave';
    };
    const existingLog = logs
        .filter(l => (l.userId === userId || l.user_id === userId) && l.date === dateStr && isAttendanceEligibleLog(l))
        .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];

    const baseOverrideTypes = [
        'Present',
        'Half Day',
        'Late',
        'Present (Late Waived)',
        'Work - Home',
        'On Duty',
        'Absent',
        'Half Day Leave',
        'Short Leave',
        'Casual Leave',
        'Sick Leave',
        'Medical Leave',
        'Annual Leave',
        'Earned Leave',
        'Paid Leave',
        'Maternity Leave',
        'Paternity Leave',
        'Study Leave',
        'Compassionate Leave',
        'Retreat Leave',
        'Staff Development Leave',
        'Regional Holidays',
        'National Holiday',
        'Holiday'
    ];
    const overrideTypeLabels = {
        'Work - Home': 'WFH'
    };
    const existingType = String(existingLog?.type || '').trim();
    if (existingType && !baseOverrideTypes.includes(existingType)) {
        baseOverrideTypes.unshift(existingType);
    }
    const overrideTypeOptions = baseOverrideTypes.map((type) => {
        const label = overrideTypeLabels[type] || type;
        return `<option value="${type}" ${existingType === type ? 'selected' : ''}>${label}</option>`;
    }).join('');

    const html = `
            <div class="modal-overlay" id="cell-override-modal" style="display:flex;">
                <div class="modal-content">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
                        <div>
                            <h3 style="margin:0;">Edit Attendance</h3>
                            <p style="font-size:0.8rem; color:#666; margin:4px 0 0 0;">${user.name} | ${dateStr}</p>
                        </div>
                        <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:1.2rem; cursor:pointer;">&times;</button>
                    </div>
                        <form onsubmit="window.app_submitCellOverride(event, '${userId}', '${dateStr}', '${existingLog?.id || ''}')">
                            <div style="display:flex; flex-direction:column; gap:1rem;">
                            <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
                                <div>
                                    <label style="display:block; font-size:0.85rem; margin-bottom:0.25rem;">Time In</label>
                                    <input type="time" name="checkIn" required value="${existingLog ? convertTo24h(existingLog.checkIn) : '09:00'}" style="width:100%; padding:0.75rem; border:1px solid #ddd; border-radius:8px;">
                                </div>
                                <div>
                                    <label style="display:block; font-size:0.85rem; margin-bottom:0.25rem;">Time Out</label>
                                    <input type="time" name="checkOut" required value="${existingLog ? convertTo24h(existingLog.checkOut) : '17:00'}" style="width:100%; padding:0.75rem; border:1px solid #ddd; border-radius:8px;">
                                </div>
                            </div>
                            <div>
                                <label style="display:block; font-size:0.85rem; margin-bottom:0.25rem;">Entry Type</label>
                                <select name="type" required style="width:100%; padding:0.75rem; border:1px solid #ddd; border-radius:8px;">
                                    ${overrideTypeOptions}
                                </select>
                            </div>
                            <div>
                                <label style="display:block; font-size:0.85rem; margin-bottom:0.25rem;">Admin Reason</label>
                                <textarea name="description" placeholder="Override reason..." style="width:100%; padding:0.75rem; border:1px solid #ddd; border-radius:8px; height:60px;">${existingLog?.workDescription || ''}</textarea>
                            </div>
                            ${existingLog?.autoCheckoutRequiresApproval ? `
                                <div style="display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0.75rem; border:1px solid #fde68a; border-radius:8px; background:#fffbeb;">
                                    <input type="checkbox" name="autoCheckoutExtraApproved" id="auto-extra-approve" ${existingLog?.autoCheckoutExtraApproved ? 'checked' : ''}>
                                    <label for="auto-extra-approve" style="font-size:0.8rem; color:#92400e; cursor:pointer;">Approve extra hours for auto check-out</label>
                                </div>
                            ` : ''}
                            <div style="display:flex; gap:0.75rem;">
                                <button type="submit" class="action-btn" style="flex:2;">${existingLog ? 'Update Log' : 'Create Log'}</button>
                                ${existingLog ? `<button type="button" onclick="window.app_deleteCellLog('${existingLog.id}', '${userId}')" class="action-btn checkout" style="flex:1; padding:0;">Delete</button>` : ''}
                            </div>
                            <div style="display:flex; align-items:center; gap:0.5rem; margin-top:0.5rem;">
                                <input type="checkbox" name="isManualOverride" id="override-check" ${existingLog?.isManualOverride ? 'checked' : ''}>
                                <label for="override-check" style="font-size:0.8rem; color:#666; cursor:pointer;">Mark as Manual Override</label>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        `;
    window.app_showModal(html, 'cell-override-modal');
};

window.app_submitCellOverride = async (e, userId, dateStr, logId) => {
    if (!window.app_canManageAttendanceSheet()) {
        alert("You do not have permission for this action.");
        return;
    }
    e.preventDefault();
    const fd = new FormData(e.target);
    const checkIn = fd.get('checkIn');
    const checkOut = fd.get('checkOut');

    const dur = calculateDuration(checkIn, checkOut);
    if (dur === 'Invalid') {
        alert('End time must be after Start time');
        return;
    }
    const checkInDate = window.AppAttendance.buildDateTime(dateStr, checkIn);
    const checkOutDate = window.AppAttendance.buildDateTime(dateStr, checkOut);
    const durationMs = (checkInDate && checkOutDate) ? (checkOutDate - checkInDate) : 0;
    const workedHours = Math.max(0, durationMs) / (1000 * 60 * 60);
    const statusMeta = window.AppAttendance.evaluateAttendanceStatus(checkInDate || new Date(), durationMs);
    const isManualOverride = fd.get('isManualOverride') === 'on';
    const selectedType = String(fd.get('type') || '').trim();
    const finalType = isManualOverride && selectedType ? selectedType : statusMeta.status;
    const eightHoursMs = 8 * 60 * 60 * 1000;
    let existingLog = null;

    let isSystemAutoClosed = false;
    if (logId) {
        existingLog = await window.AppDB.get('attendance', logId).catch(() => null);
        isSystemAutoClosed = !!existingLog?.autoCheckout;
    }

    if (selectedType === 'Half Day Leave' && durationMs >= eightHoursMs && !isSystemAutoClosed) {
        alert(`Cannot set Half Day Leave for ${workedHours.toFixed(2)} worked hours. 8+ hours must be treated as full day.`);
        return;
    }

    const formatTime = (timeStr) => {
        if (!timeStr || timeStr === '--') return '--';
        const [h, m] = timeStr.split(':');
        const hours = parseInt(h);
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayH = hours % 12 || 12;
        return `${String(displayH).padStart(2, '0')}:${m} ${ampm}`;
    };

    const logData = {
        date: dateStr,
        checkIn: formatTime(checkIn),
        checkOut: formatTime(checkOut),
        duration: dur,
        type: finalType,
        workDescription: fd.get('description') || 'Admin Override',
        location: 'Office (Override)',
        durationMs: durationMs,
        dayCredit: statusMeta.dayCredit,
        lateCountable: statusMeta.lateCountable,
        extraWorkedMs: statusMeta.extraWorkedMs || 0,
        policyVersion: 'v2',
        isManualOverride: isManualOverride,
        entrySource: 'admin_override',
        attendanceEligible: true,
        autoCheckoutExtraApproved: fd.get('autoCheckoutExtraApproved') === 'on'
    };

    try {
        const linkedLeaveId = String(existingLog?.leaveRequestId || '').trim();
        const actorId = window.AppAuth?.getUser?.()?.id || '';
        const shouldSyncLeaveType = !!(
            linkedLeaveId
            && selectedType
            && selectedType.includes('Leave')
            && window.AppLeaves?.updateLeaveType
        );
        if (shouldSyncLeaveType) {
            const linkedLeave = await window.AppDB.get('leaves', linkedLeaveId).catch(() => null);
            if (linkedLeave && String(linkedLeave.type || '').trim() !== selectedType) {
                await window.AppLeaves.updateLeaveType(linkedLeaveId, selectedType, actorId);
            }
        }

        if (logId) {
            await window.AppAttendance.updateLog(logId, logData);
        } else {
            await window.AppAttendance.addAdminLog(userId, logData);
        }
        alert("Override successful.");
        document.getElementById('cell-override-modal')?.remove();
        window.app_refreshMasterSheet();
    } catch (err) {
        alert("Error: " + err.message);
    }
};

window.app_deleteCellLog = async (logId, _userId) => {
    if (!window.app_canManageAttendanceSheet()) {
        alert("You do not have permission for this action.");
        return;
    }
    if (!await window.appConfirm("Delete this attendance record?")) return;
    try {
        await window.AppAttendance.deleteLog(logId);
        document.getElementById('cell-override-modal')?.remove();
        window.app_refreshMasterSheet();
    } catch (err) {
        alert("Error: " + err.message);
    }
};

function convertTo24h(timeStr) {
    if (!timeStr || timeStr === '--' || timeStr === 'Active Now') return '09:00';
    const [time, ampm] = timeStr.split(' ');
    let [h, m] = time.split(':');
    let hours = parseInt(h);
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${m}`;
}

const parseLogDateToISO = (value) => {
    if (!value) return null;
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    // Let native parser handle locale formats first (e.g. 2/19/2026).
    const native = new Date(raw);
    if (!Number.isNaN(native.getTime())) {
        const y = native.getFullYear();
        const m = String(native.getMonth() + 1).padStart(2, '0');
        const d = String(native.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // Support common dd/mm/yyyy or d/m/yyyy forms
    const dm = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dm) {
        const a = Number(dm[1]);
        const b = Number(dm[2]);
        const y = Number(dm[3]);
        let day = a;
        let month = b;

        // If impossible month in day-first, try month-first interpretation.
        if (month > 12 && a <= 12) {
            month = a;
            day = b;
        }
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    return null;
};

window.app_runAttendancePolicyMigration = async () => {
    if (!window.app_canManageAttendanceSheet()) {
        alert("You do not have permission for this action.");
        return;
    }
    const confirmed = await window.appConfirm(
        "Recalculate historical attendance logs with the current policy? This updates stored status/credits for existing office logs.",
        "Run Attendance Migration"
    );
    if (!confirmed) return;

    try {
        const logs = await window.AppDB.getAll('attendance');
        let scanned = 0;
        let updated = 0;
        let skipped = 0;
        const specialTypes = new Set([
            'Work - Home',
            'Training',
            'On Duty',
            'Holiday',
            'National Holiday',
            'Regional Holidays'
        ]);
        let duplicateNeutralized = 0;
        let invalidTimeNeutralized = 0;

        const metaById = new Map();
        const groupBuckets = new Map();

        const inferMeta = (log) => {
            const dateIso = parseLogDateToISO(log?.date);
            const hasSystemSignals =
                typeof log?.activityScore !== 'undefined' ||
                typeof log?.locationMismatched !== 'undefined' ||
                typeof log?.autoCheckout !== 'undefined' ||
                !!log?.checkOutLocation ||
                typeof log?.outLat !== 'undefined' ||
                typeof log?.outLng !== 'undefined';
            const explicitSource = String(log?.entrySource || '').trim();
            let inferredSource = explicitSource;
            if (!inferredSource) {
                if (log?.isManualOverride || log?.location === 'Office (Manual)' || log?.location === 'Office (Override)') {
                    inferredSource = 'admin_override';
                } else if (hasSystemSignals) {
                    inferredSource = 'checkin_checkout';
                } else {
                    inferredSource = 'staff_manual_work';
                }
            }

            const in24 = (log?.checkIn && log?.checkOut && log?.checkOut !== 'Active Now') ? convertTo24h(log.checkIn) : null;
            const out24 = (log?.checkIn && log?.checkOut && log?.checkOut !== 'Active Now') ? convertTo24h(log.checkOut) : null;
            const inDt = (dateIso && in24) ? window.AppAttendance.buildDateTime(dateIso, in24) : null;
            const outDt = (dateIso && out24) ? window.AppAttendance.buildDateTime(dateIso, out24) : null;
            const validTimeRange = !!(inDt && outDt && outDt > inDt);
            const parsedDurationMs = validTimeRange ? (outDt - inDt) : null;
            const resolvedDurationMs = typeof log?.durationMs === 'number' ? log.durationMs : parsedDurationMs;
            const workedHours = typeof resolvedDurationMs === 'number'
                ? Math.max(0, resolvedDurationMs) / (1000 * 60 * 60)
                : 0;

            let inferredAttendanceEligible;
            if (Object.prototype.hasOwnProperty.call(log || {}, 'attendanceEligible')) {
                inferredAttendanceEligible = log.attendanceEligible === true;
            } else if (inferredSource === 'staff_manual_work') {
                inferredAttendanceEligible = workedHours >= 4;
            } else {
                inferredAttendanceEligible = true;
            }

            return {
                dateIso,
                inDt,
                outDt,
                validTimeRange,
                resolvedDurationMs,
                workedHours,
                inferredSource,
                inferredAttendanceEligible
            };
        };

        const rankLog = (log, meta) => {
            const normalizedType = window.AppAttendance.normalizeType(log?.type);
            let creditScore = 0;
            if (meta.inferredSource === 'staff_manual_work') {
                if (meta.workedHours >= 8) creditScore = 100;
                else if (meta.workedHours >= 4) creditScore = 50;
            } else {
                creditScore = Number(window.AppAttendance.getDayCredit(normalizedType) || 0) * 100;
            }
            let score = 0;
            score += creditScore;
            score += Math.min(20, Math.floor(Math.max(0, meta.workedHours || 0)));
            if (meta.inferredAttendanceEligible) score += 40;
            if (meta.validTimeRange) score += 10;
            if (meta.inferredSource === 'checkin_checkout') score += 8;
            else if (meta.inferredSource === 'admin_override') score += 6;
            else score += 4;
            if (log?.isManualOverride) score += 4;
            if (String(log?.type || '').includes('Leave') || log?.location === 'On Leave') score += 6;
            score += Number(log?.id || 0) / 1e13;
            return score;
        };

        for (const log of logs) {
            if (!log || !log.id) continue;
            const meta = inferMeta(log);
            metaById.set(log.id, meta);
            const uid = log.user_id || log.userId;
            if (!uid || !meta.dateIso) continue;
            const key = `${uid}|${meta.dateIso}`;
            if (!groupBuckets.has(key)) groupBuckets.set(key, []);
            groupBuckets.get(key).push(log);
        }

        const keeperByGroup = new Map();
        for (const [key, bucket] of groupBuckets.entries()) {
            if (!bucket || bucket.length === 0) continue;
            const sorted = bucket.slice().sort((a, b) => {
                const am = metaById.get(a.id) || inferMeta(a);
                const bm = metaById.get(b.id) || inferMeta(b);
                return rankLog(b, bm) - rankLog(a, am);
            });
            keeperByGroup.set(key, sorted[0]?.id);
        }

        for (const log of logs) {
            scanned++;
            if (!log || !log.id) {
                skipped++;
                continue;
            }
            const normalizedType = window.AppAttendance.normalizeType(log.type);
            const meta = metaById.get(log.id) || inferMeta(log);
            const dateIso = meta.dateIso;
            const inDt = meta.inDt;
            const outDt = meta.outDt;
            const resolvedDurationMs = meta.resolvedDurationMs;
            const workedHours = meta.workedHours;
            const inferredSource = meta.inferredSource;
            let inferredAttendanceEligible = meta.inferredAttendanceEligible;
            const uid = log.user_id || log.userId;
            const groupKey = (uid && dateIso) ? `${uid}|${dateIso}` : null;
            const keeperId = groupKey ? keeperByGroup.get(groupKey) : null;
            const isDuplicate = !!(keeperId && keeperId !== log.id);
            const hasTimePair = !!(log.checkIn && log.checkOut && log.checkOut !== 'Active Now');
            const invalidTimeRange = hasTimePair && !!(inDt && outDt && outDt <= inDt);
            const preserveApprovedAutoClosure = !!(
                log.autoCheckout
                && String(log.missedCheckoutReasonStatus || '').toLowerCase() === 'approved'
            );

            let nextType = log.type;
            let nextDayCredit = log.dayCredit;
            let nextLateCountable = log.lateCountable;
            let nextExtraWorkedMs = log.extraWorkedMs || 0;

            if (isDuplicate) {
                inferredAttendanceEligible = false;
                if (!String(log.type || '').includes('Leave')) nextType = 'Work Log';
                nextDayCredit = 0;
                nextLateCountable = false;
                nextExtraWorkedMs = 0;
                duplicateNeutralized++;
            }

            if (invalidTimeRange) {
                inferredAttendanceEligible = false;
                if (!String(log.type || '').includes('Leave')) nextType = 'Work Log';
                nextDayCredit = 0;
                nextLateCountable = false;
                nextExtraWorkedMs = 0;
                invalidTimeNeutralized++;
            }

            // Staff manual work logs: derive attendance only from worked duration.
            if (preserveApprovedAutoClosure && !isDuplicate && !invalidTimeRange) {
                nextType = 'Present';
                nextDayCredit = (window.AppAttendance && typeof window.AppAttendance.getDayCredit === 'function')
                    ? window.AppAttendance.getDayCredit('Present')
                    : 1;
                nextLateCountable = false;
                nextExtraWorkedMs = 0;
            } else if (inferredSource === 'staff_manual_work' && !isDuplicate && !invalidTimeRange) {
                if (workedHours >= 8) {
                    nextType = 'Present';
                    nextDayCredit = 1;
                } else if (workedHours >= 4) {
                    nextType = 'Half Day';
                    nextDayCredit = 0.5;
                } else {
                    nextType = 'Work Log';
                    nextDayCredit = 0;
                }
                nextLateCountable = false;
                nextExtraWorkedMs = 0;
            } else if (
                !log.isManualOverride &&
                inferredAttendanceEligible &&
                !(specialTypes.has(normalizedType) || String(normalizedType).includes('Leave') || normalizedType === 'Office') &&
                inDt && outDt && outDt > inDt
            ) {
                const statusMeta = window.AppAttendance.evaluateAttendanceStatus(inDt, outDt - inDt);
                nextType = statusMeta.status;
                nextDayCredit = statusMeta.dayCredit;
                nextLateCountable = statusMeta.lateCountable;
                nextExtraWorkedMs = statusMeta.extraWorkedMs || 0;
            }

            const normalizedDurationMs = (typeof resolvedDurationMs === 'number') ? resolvedDurationMs : null;
            const nextRecord = {
                ...log,
                entrySource: inferredSource,
                attendanceEligible: inferredAttendanceEligible,
                type: nextType,
                dayCredit: typeof nextDayCredit === 'number' ? nextDayCredit : 0,
                lateCountable: nextLateCountable === true,
                extraWorkedMs: nextExtraWorkedMs || 0,
                durationMs: normalizedDurationMs,
                missedCheckoutApprovedAsFullDay: preserveApprovedAutoClosure ? true : log.missedCheckoutApprovedAsFullDay,
                policyVersion: 'v2'
            };

            const changed =
                log.entrySource !== nextRecord.entrySource ||
                log.attendanceEligible !== nextRecord.attendanceEligible ||
                log.type !== nextRecord.type ||
                log.dayCredit !== nextRecord.dayCredit ||
                log.lateCountable !== nextRecord.lateCountable ||
                (log.extraWorkedMs || 0) !== (nextRecord.extraWorkedMs || 0) ||
                log.durationMs !== nextRecord.durationMs ||
                log.policyVersion !== 'v2';

            if (!changed) {
                skipped++;
                continue;
            }

            await window.AppDB.put('attendance', nextRecord);
            updated++;
        }

        alert(`Migration complete.\nScanned: ${scanned}\nUpdated: ${updated}\nSkipped: ${skipped}\nDuplicates neutralized: ${duplicateNeutralized}\nInvalid-time logs neutralized: ${invalidTimeNeutralized}`);

        const hash = window.location.hash.slice(1);
        const contentArea = document.getElementById('page-content');
        if (!contentArea) return;
        if (hash === 'policy-test') {
            contentArea.innerHTML = await AppUI.renderPolicyTest();
        } else if (hash === 'dashboard') {
            contentArea.innerHTML = await AppUI.renderDashboard();
            if (window.setupDashboardEvents) window.setupDashboardEvents();
        } else if (hash === 'salary') {
            contentArea.innerHTML = await AppUI.renderSalaryProcessing();
            if (window.app_recalculateAllSalaries) {
                window.app_recalculateAllSalaries();
            }
        } else if (hash === 'timesheet') {
            contentArea.innerHTML = await AppUI.renderTimesheet();
        }
    } catch (err) {
        console.error("Attendance migration failed:", err);
        alert("Migration failed: " + err.message);
    }
};

window.app_syncLeaveCategoriesFromAttendance = async (options = {}) => {
    if (!window.app_canManageAttendanceSheet()) {
        return { updated: 0, scanned: 0 };
    }

    const silent = options?.silent !== false;
    const hasRange = Number.isFinite(Number(options?.year)) && Number.isFinite(Number(options?.month));
    const year = Number(options?.year);
    const monthOneBased = Number(options?.month);
    let logs = [];
    if (hasRange) {
        const startDateStr = `${year}-${String(monthOneBased).padStart(2, '0')}-01`;
        const endDateStr = `${year}-${String(monthOneBased).padStart(2, '0')}-31`;

        try {
            logs = await window.AppDB.query('attendance', 'date', '>=', startDateStr);
            logs = (logs || []).filter(l => String(l?.date || '') <= endDateStr);
        } catch {
            const allLogs = await window.AppDB.getAll('attendance');
            logs = (allLogs || []).filter(l => String(l?.date || '') >= startDateStr && String(l?.date || '') <= endDateStr);
        }
    } else {
        logs = await window.AppDB.getAll('attendance');
    }

    const selectedLeaves = new Map();
    const candidateScore = (log) => {
        let score = 0;
        if (log?.isManualOverride) score += 100;
        if (String(log?.entrySource || '') === 'admin_override') score += 50;
        if (log?.leaveGenerated) score += 10;
        const idScore = Number(String(log?.id || '').replace(/\D/g, '').slice(-10)) || 0;
        return score + idScore;
    };

    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    let missingLink = 0;
    const reviewCandidates = [];

    for (const log of (logs || [])) {
        if (!log || !log.id) continue;
        scanned++;

        const leaveId = String(log.leaveRequestId || '').trim();
        const logType = String(log.type || '').trim();
        if (!leaveId || !logType || !logType.includes('Leave')) {
            skipped++;
            continue;
        }

        const current = selectedLeaves.get(leaveId);
        const score = candidateScore(log);
        if (!current || score >= current.score) {
            selectedLeaves.set(leaveId, { score, type: logType, log });
        }
    }

    for (const [leaveId, selected] of selectedLeaves.entries()) {
        const leave = await window.AppDB.get('leaves', leaveId).catch(() => null);
        if (!leave) {
            missingLink++;
            reviewCandidates.push({
                leaveId,
                userId: selected.log?.user_id || selected.log?.userId || '',
                date: selected.log?.date || '',
                reason: 'missing linked leave record'
            });
            continue;
        }

        if (String(leave.type || '').trim() === selected.type) {
            continue;
        }

        await window.AppLeaves.updateLeaveType(leaveId, selected.type, window.AppAuth?.getUser?.()?.id || '');
        updated++;
    }

    if (!silent) {
        const sample = reviewCandidates.slice(0, 8).map((c) => `- ${c.date} | ${c.userId || 'unknown'} | ${c.reason}`).join('\n');
        alert(
            `Leave categories synced${hasRange ? ` for ${year}-${String(monthOneBased).padStart(2, '0')}` : ' across all attendance logs'}.\n` +
            `Scanned logs: ${scanned}\n` +
            `Updated leaves: ${updated}\n` +
            `Skipped logs: ${skipped}\n` +
            `Missing leave links: ${missingLink}\n` +
            `${sample ? `\nSample issues:\n${sample}` : ''}`
        );

        // Refresh the policies page so updated categories show in balance cards
        const contentArea = document.getElementById('page-content');
        if (contentArea) {
            contentArea.innerHTML = await window.AppPolicies.render();
        }
    }

    return { updated, scanned, skipped, missingLink, reviewCandidates };
};

window.app_syncLeaveCategoriesForVisibleMonth = async () => {
    if (!window.app_canManageAttendanceSheet()) return;
    const monthValue = Number(document.getElementById('sheet-month')?.value);
    const yearValue = Number(document.getElementById('sheet-year')?.value);
    const month = Number.isFinite(monthValue) ? monthValue + 1 : (new Date().getMonth() + 1);
    const year = Number.isFinite(yearValue) ? yearValue : new Date().getFullYear();
    await window.app_syncLeaveCategoriesFromAttendance({
        silent: false,
        year,
        month
    });
    await window.app_refreshMasterSheet();
};


window.app_deleteUser = async (userId) => {
    if (await window.appConfirm('Are you sure you want to delete this user? This action cannot be undone.')) {
        try {
            await window.AppDB.delete('users', userId);
            alert('User deleted successfully.');
            // Refresh Admin View
            const contentArea = document.getElementById('page-content');
            if (contentArea) {
                contentArea.innerHTML = await AppUI.renderAdmin();
            }
        } catch (err) {
            alert('Failed to delete user: ' + err.message);
        }
    }
};



window.app_recalculateRow = (row) => {
    const base = parseFloat(row.querySelector('.base-salary-input').value) || 0;
    const dailyRate = base / 22;
    const unpaid = parseFloat(row.querySelector('.unpaid-leaves-count').innerText) || 0;
    const lateCount = parseFloat(row.querySelector('.late-count')?.innerText || '0') || 0;
    const rawLateDeductionDays = Math.floor(lateCount / (AppConfig.LATE_GRACE_COUNT || 3)) * (AppConfig.LATE_DEDUCTION_PER_BLOCK || 0.5);
    const extraWorkedHours = parseFloat(row.querySelector('.extra-work-hours')?.innerText || '0') || 0;
    const lateOffsetDays = Math.floor(extraWorkedHours / (AppConfig.EXTRA_HOURS_FOR_HALF_DAY_OFFSET || 4)) * (AppConfig.LATE_DEDUCTION_PER_BLOCK || 0.5);
    const lateDeductionDays = Math.max(0, rawLateDeductionDays - lateOffsetDays);
    const totalDeductionDays = unpaid + lateDeductionDays;
    const globalTds = parseFloat(document.getElementById('global-tds-percent').value) || 0;
    const tdsInput = row.querySelector('.tds-input');
    if (tdsInput && !tdsInput.dataset.manual) {
        tdsInput.value = globalTds;
    }
    const tdsPercent = tdsInput ? (parseFloat(tdsInput.value) || 0) : globalTds;

    const attendanceDeduction = Math.round(dailyRate * totalDeductionDays);
    const lateDedDaysEl = row.querySelector('.late-deduction-days');
    const lateDedRawEl = row.querySelector('.late-deduction-raw');
    const penaltyOffsetEl = row.querySelector('.penalty-offset-days');
    const totalDedDaysEl = row.querySelector('.deduction-days');
    const attendanceDeductionEl = row.querySelector('.attendance-deduction-amount');
    if (lateDedRawEl) lateDedRawEl.innerText = rawLateDeductionDays.toFixed(1);
    if (penaltyOffsetEl) penaltyOffsetEl.innerText = lateOffsetDays.toFixed(1);
    if (lateDedDaysEl) lateDedDaysEl.innerText = lateDeductionDays.toFixed(1);
    if (totalDedDaysEl) totalDedDaysEl.innerText = totalDeductionDays.toFixed(1);
    if (attendanceDeductionEl) attendanceDeductionEl.innerText = '-Rs ' + attendanceDeduction.toLocaleString();
    row.querySelector('.deduction-amount').innerText = '-Rs ' + attendanceDeduction.toLocaleString();

    const adjInput = row.querySelector('.salary-input');
    if (!adjInput.dataset.manual) {
        adjInput.value = Math.max(0, base - attendanceDeduction);
    }

    const adjusted = parseFloat(adjInput.value) || 0;
    const tdsAmount = Math.round(adjusted * (tdsPercent / 100));
    const finalNet = Math.max(0, adjusted - tdsAmount);

    row.querySelector('.tds-amount').innerText = 'Rs ' + tdsAmount.toLocaleString();
    row.querySelector('.tds-amount').dataset.value = tdsAmount;
    row.querySelector('.final-net-salary').innerText = 'Rs ' + finalNet.toLocaleString();
    row.querySelector('.final-net-salary').dataset.value = finalNet;
};

const app_getLateDeductionMetricsFromRow = (row) => {
    const unpaidLeaves = parseFloat(row.querySelector('.unpaid-leaves-count')?.innerText || '0') || 0;
    const lateCount = parseFloat(row.querySelector('.late-count')?.innerText || '0') || 0;
    const extraWorkedHours = parseFloat(row.querySelector('.extra-work-hours')?.innerText || '0') || 0;
    const rawLateDeductionDays = Math.floor(lateCount / (AppConfig.LATE_GRACE_COUNT || 3)) * (AppConfig.LATE_DEDUCTION_PER_BLOCK || 0.5);
    const penaltyOffsetDays = Math.floor(extraWorkedHours / (AppConfig.EXTRA_HOURS_FOR_HALF_DAY_OFFSET || 4)) * (AppConfig.LATE_DEDUCTION_PER_BLOCK || 0.5);
    const lateDeductionDays = Math.max(0, rawLateDeductionDays - penaltyOffsetDays);
    const deductionDays = unpaidLeaves + lateDeductionDays;
    return { unpaidLeaves, lateCount, extraWorkedHours, rawLateDeductionDays, penaltyOffsetDays, lateDeductionDays, deductionDays };
};

window.app_recalculateAllSalaries = () => {
    document.querySelectorAll('tr[data-user-id]').forEach(row => {
        window.app_recalculateRow(row);
    });
};

const parsePayrollMonth = (value, fallbackDate = new Date()) => {
    if (/^\d{4}-\d{2}$/.test(String(value || '').trim())) {
        const [year, month] = String(value).split('-').map(Number);
        if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
            return { year, monthIndex: month - 1 };
        }
    }
    return { year: fallbackDate.getFullYear(), monthIndex: fallbackDate.getMonth() };
};

window.app_toggleSalaryPeriodMode = function () {
    const mode = document.getElementById('salary-period-mode')?.value || 'single';
    const singleWrap = document.getElementById('salary-period-single-wrap');
    const rangeWrap = document.getElementById('salary-period-range-wrap');
    if (singleWrap) singleWrap.style.display = mode === 'range' ? 'none' : 'block';
    if (rangeWrap) rangeWrap.style.display = mode === 'range' ? 'flex' : 'none';
};

window.app_getSalaryPayPeriodInfo = function () {
    const now = new Date();
    const mode = document.getElementById('salary-period-mode')?.value || 'single';
    if (mode === 'range') {
        const fromRaw = document.getElementById('salary-pay-period-from')?.value || '';
        const toRaw = document.getElementById('salary-pay-period-to')?.value || '';
        let from = parsePayrollMonth(fromRaw, now);
        let to = parsePayrollMonth(toRaw, now);
        const fromKeyNum = from.year * 100 + (from.monthIndex + 1);
        const toKeyNum = to.year * 100 + (to.monthIndex + 1);
        if (toKeyNum < fromKeyNum) {
            const tmp = from;
            from = to;
            to = tmp;
        }
        const startDate = new Date(from.year, from.monthIndex, 1);
        const endDate = new Date(to.year, to.monthIndex + 1, 0);
        const fromKey = `${from.year}-${String(from.monthIndex + 1).padStart(2, '0')}`;
        const toKey = `${to.year}-${String(to.monthIndex + 1).padStart(2, '0')}`;
        return {
            mode: 'range',
            startDate,
            endDate,
            startKey: fromKey,
            endKey: toKey,
            key: `${fromKey}_to_${toKey}`,
            label: `${startDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} to ${endDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
        };
    }

    const singleRaw = document.getElementById('salary-pay-period')?.value || '';
    const single = parsePayrollMonth(singleRaw, now);
    const startDate = new Date(single.year, single.monthIndex, 1);
    const endDate = new Date(single.year, single.monthIndex + 1, 0);
    const key = `${single.year}-${String(single.monthIndex + 1).padStart(2, '0')}`;
    return {
        mode: 'single',
        startDate,
        endDate,
        startKey: key,
        endKey: key,
        key,
        label: startDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    };
};

window.app_saveAllSalaries = async () => {
    const rows = document.querySelectorAll('tr[data-user-id]');
    const salaryRecords = [];
    const userUpdates = [];
    const payPeriodInfo = window.app_getSalaryPayPeriodInfo();
    const monthKey = payPeriodInfo.key;
    const payDateInput = document.getElementById('salary-pay-date')?.value || '';
    const payDateTs = payDateInput ? new Date(payDateInput).getTime() : Date.now();
    const globalTdsPercent = parseFloat(document.getElementById('global-tds-percent').value) || 0;

    for (const row of rows) {
        const userId = row.dataset.userId;
        const baseSalaryInput = row.querySelector('.base-salary-input').value;
        const adjustedSalary = row.querySelector('.salary-input').value;
        const comment = row.querySelector('.comment-input').value;
        const tdsInput = row.querySelector('.tds-input');
        const rowTdsPercent = tdsInput ? (parseFloat(tdsInput.value) || 0) : globalTdsPercent;
        const tdsAmount = row.querySelector('.tds-amount').dataset.value || 0;
        const finalNet = row.querySelector('.final-net-salary').dataset.value || 0;
        const lateMetrics = app_getLateDeductionMetricsFromRow(row);
        const unpaidLeaves = lateMetrics.unpaidLeaves;
        const lateCount = lateMetrics.lateCount;
        const extraWorkedHours = lateMetrics.extraWorkedHours;
        const lateDeductionRawDays = lateMetrics.rawLateDeductionDays;
        const penaltyOffsetDays = lateMetrics.penaltyOffsetDays;
        const lateDeductionDays = lateMetrics.lateDeductionDays;
        const deductionDays = lateMetrics.deductionDays;
        const attendanceDeduction = Number(String(row.querySelector('.attendance-deduction-amount')?.innerText || '0').replace(/[^0-9.-]+/g, ""));
        const rawEmployeeId = String(row.querySelector('.employee-id-input')?.value || '').trim();
        const designation = String(row.querySelector('.designation-input')?.value || '').trim();
        const department = String(row.querySelector('.department-input')?.value || '').trim();
        const joinDate = String(row.querySelector('.join-date-input')?.value || '').trim();
        const employeeId = joinDate ? (rawEmployeeId || app_deriveEmployeeId(joinDate, userId)) : 'NA';
        const bankName = String(row.querySelector('.bank-name-input')?.value || '').trim();
        const bankAccount = String(row.querySelector('.bank-account-input')?.value || '').trim();
        const pan = String(row.querySelector('.pan-input')?.value || '').trim();
        const uan = String(row.querySelector('.uan-input')?.value || '').trim();
        const otherAllowances = Number(row.querySelector('.other-allowances-input')?.value || 0);
        const providentFund = Number(row.querySelector('.pf-input')?.value || 0);
        const professionalTax = Number(row.querySelector('.professional-tax-input')?.value || 0);
        const loanAdvance = Number(row.querySelector('.loan-advance-input')?.value || 0);

        // Check if comment required
        if (row.querySelector('.comment-input').required && !comment) {
            alert(`Please provide a comment for user ID: ${userId} as the salary was adjusted.`);
            return;
        }

        // Record for the month
        salaryRecords.push({
            id: `salary_${userId}_${monthKey}`,
            userId,
            month: monthKey,
            periodMode: payPeriodInfo.mode,
            periodStart: payPeriodInfo.startKey,
            periodEnd: payPeriodInfo.endKey,
            periodLabel: payPeriodInfo.label,
            payDate: payDateTs,
            baseAmount: Number(baseSalaryInput),
            otherAllowances: otherAllowances,
            providentFund: providentFund,
            professionalTax: professionalTax,
            loanAdvance: loanAdvance,
            employeeId: employeeId,
            designation: designation,
            department: department,
            joinDate: joinDate || null,
            bankName: bankName,
            bankAccount: bankAccount,
            pan: pan,
            uan: uan,
            attendanceDeduction: attendanceDeduction,
            deductions: Number(row.querySelector('.deduction-amount').innerText.replace(/[^0-9.-]+/g, "")),
            unpaidLeaves: unpaidLeaves,
            lateCount: lateCount,
            extraWorkedHours: extraWorkedHours,
            lateDeductionRawDays: lateDeductionRawDays,
            penaltyOffsetDays: penaltyOffsetDays,
            lateDeductionDays: lateDeductionDays,
            deductionDays: deductionDays,
            adjustedAmount: Number(adjustedSalary),
            tdsPercent: rowTdsPercent,
            tdsAmount: Number(tdsAmount),
            finalNet: Number(finalNet),
            comment: comment || '',
            processedAt: Date.now()
        });

        // Update user's base salary if changed
        userUpdates.push({
            id: userId,
            baseSalary: Number(baseSalaryInput),
            tdsPercent: rowTdsPercent,
            employeeId: employeeId,
            designation: designation,
            dept: department,
            joinDate: joinDate || null,
            bankName: bankName,
            bankAccount: bankAccount,
            pan: pan,
            uan: uan,
            otherAllowances: otherAllowances,
            providentFund: providentFund,
            professionalTax: professionalTax,
            loanAdvance: loanAdvance
        });
    }

    try {
        // Persist monthly records
        for (const record of salaryRecords) {
            await window.AppDB.put('salaries', record);
        }

        // Sync user base salaries
        for (const update of userUpdates) {
            const existingUser = await window.AppDB.get('users', update.id);
            if (existingUser) {
                Object.assign(existingUser, update);
                await window.AppDB.put('users', existingUser);
            }
        }

        alert('All records and TDS details saved successfully!');
        // Refresh view to ensure calculations sync with any base salary changes
        const contentArea = document.getElementById('page-content');
        contentArea.innerHTML = await AppUI.renderSalaryProcessing();
    } catch (err) {
        console.error("Salary Save Error:", err);
        alert('Failed to save records: ' + err.message);
    }
};

window.app_exportSalaryCSV = () => {
    const rows = document.querySelectorAll('tr[data-user-id]');
    let csv = 'Staff Name,Emp ID,Designation,Department,Join Date,Bank Name,Bank Account,PAN,UAN,Base Salary,Other Allowances,PF,Professional Tax,Loan Advance,Present,Late,Unpaid Leaves,Extra Work Hours,Late Deduction Raw,Penalty Offset Days,Late Deduction Days,Total Deduction Days,Attendance Deduction,Total Deductions,Adjusted Salary,TDS (%),TDS Amount,Final Net,Comment\n';

    rows.forEach(row => {
        const name = row.querySelector('div[style*="font-weight: 600"]').innerText;
        const base = row.querySelector('.base-salary-input').value;
        const employeeId = row.querySelector('.employee-id-input')?.value || '';
        const designation = row.querySelector('.designation-input')?.value || '';
        const department = row.querySelector('.department-input')?.value || '';
        const joinDate = row.querySelector('.join-date-input')?.value || '';
        const bankName = row.querySelector('.bank-name-input')?.value || '';
        const bankAccount = row.querySelector('.bank-account-input')?.value || '';
        const pan = row.querySelector('.pan-input')?.value || '';
        const uan = row.querySelector('.uan-input')?.value || '';
        const otherAllowances = row.querySelector('.other-allowances-input')?.value || '0';
        const providentFund = row.querySelector('.pf-input')?.value || '0';
        const professionalTax = row.querySelector('.professional-tax-input')?.value || '0';
        const loanAdvance = row.querySelector('.loan-advance-input')?.value || '0';
        const present = row.querySelector('.present-count')?.innerText || '0';
        const late = row.querySelector('.late-count')?.innerText || '0';
        const unpaidLeaves = row.querySelector('.unpaid-leaves-count')?.innerText || '0';
        const extraWorkedHours = row.querySelector('.extra-work-hours')?.innerText || '0';
        const lateDeductionRaw = row.querySelector('.late-deduction-raw')?.innerText || '0';
        const penaltyOffsetDays = row.querySelector('.penalty-offset-days')?.innerText || '0';
        const lateDeductionDays = row.querySelector('.late-deduction-days')?.innerText || '0';
        const deductionDays = row.querySelector('.deduction-days')?.innerText || '0';
        const attendanceDeduction = (row.querySelector('.attendance-deduction-amount')?.innerText || '').replace(/[^0-9.-]+/g, '') || '0';
        const deduct = (row.querySelector('.deduction-amount').innerText || '').replace(/[^0-9.-]+/g, '');
        const adjusted = row.querySelector('.salary-input').value;
        const globalTdsPercent = parseFloat(document.getElementById('global-tds-percent').value) || 0;
        const tdsInput = row.querySelector('.tds-input');
        const tdsP = tdsInput && tdsInput.value !== ''
            ? tdsInput.value
            : globalTdsPercent;
        const tdsA = (row.querySelector('.tds-amount').innerText || '').replace(/[^0-9.-]+/g, '');
        const net = (row.querySelector('.final-net-salary').innerText || '').replace(/[^0-9.-]+/g, '');
        const comment = row.querySelector('.comment-input').value;

        csv += `"${name}","${employeeId}","${designation}","${department}","${joinDate}","${bankName}","${bankAccount}","${pan}","${uan}",${base},${otherAllowances},${providentFund},${professionalTax},${loanAdvance},${present},${late},${unpaidLeaves},${extraWorkedHours},${lateDeductionRaw},${penaltyOffsetDays},${lateDeductionDays},${deductionDays},${attendanceDeduction},${deduct},${adjusted},${tdsP},${tdsA},${net},"${comment}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const payPeriodInfo = window.app_getSalaryPayPeriodInfo();
    a.setAttribute('href', url);
    a.setAttribute('download', `Salaries_${payPeriodInfo.key.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`);
    a.click();
};

const maskSensitiveValue = (value, visible = 4) => {
    const raw = String(value || '').trim();
    if (!raw) return 'NA';
    if (raw.length <= visible) return raw;
    return `${'*'.repeat(Math.max(0, raw.length - visible))}${raw.slice(-visible)}`;
};

const numberToWordsIndian = (num) => {
    const n = Math.floor(Number(num) || 0);
    if (n === 0) return 'Zero';
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const twoDigits = (x) => {
        if (x < 20) return ones[x];
        const t = Math.floor(x / 10);
        const o = x % 10;
        return `${tens[t]}${o ? ` ${ones[o]}` : ''}`.trim();
    };
    const threeDigits = (x) => {
        const h = Math.floor(x / 100);
        const r = x % 100;
        if (!h) return twoDigits(r);
        return `${ones[h]} Hundred${r ? ` ${twoDigits(r)}` : ''}`.trim();
    };
    let value = n;
    const crore = Math.floor(value / 10000000); value %= 10000000;
    const lakh = Math.floor(value / 100000); value %= 100000;
    const thousand = Math.floor(value / 1000); value %= 1000;
    const hundredPart = value;
    const parts = [];
    if (crore) parts.push(`${twoDigits(crore)} Crore`);
    if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
    if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
    if (hundredPart) parts.push(threeDigits(hundredPart));
    return parts.join(' ').trim();
};

window.app_printSalarySlip = function () {
    const modal = document.getElementById('salary-slip-modal');
    if (!modal) return;
    const wrap = modal.querySelector('.salary-slip-print-root');
    if (!wrap) return;
    document.body.classList.add('salary-slip-print-mode');
    wrap.classList.add('print-active');
    setTimeout(() => {
        window.print();
        setTimeout(() => {
            wrap.classList.remove('print-active');
            document.body.classList.remove('salary-slip-print-mode');
        }, 150);
    }, 60);
};

window.app_generateSalarySlip = async function (userId) {
    try {
        const row = document.querySelector(`tr[data-user-id="${userId}"]`);
        if (!row) {
            alert('Unable to locate salary row for this user.');
            return;
        }
        const user = await window.AppDB.get('users', userId);
        if (!user) {
            alert('User details not found.');
            return;
        }

        const now = new Date();
        const payPeriodInfo = window.app_getSalaryPayPeriodInfo();
        const payPeriodLabel = payPeriodInfo.label;
        const payPeriodStart = app_formatDateGb(payPeriodInfo.startDate);
        const payPeriodEnd = app_formatDateGb(payPeriodInfo.endDate);
        const payDateInput = document.getElementById('salary-pay-date')?.value || '';
        const payDate = payDateInput ? app_formatDateGb(payDateInput) : app_formatDateGb(now);
        const generatedAt = app_formatDateTimeGb(now);
        const payrollRef = `CRWI-${payPeriodInfo.key.replace(/[^a-zA-Z0-9]/g, '')}-${userId}-${String(now.getTime()).slice(-5)}`;

        const baseSalary = Number(row.querySelector('.base-salary-input')?.value || 0);
        const adjustedSalary = Number(row.querySelector('.salary-input')?.value || 0);
        const tdsPercent = Number(row.querySelector('.tds-input')?.value || 0);
        const tdsAmount = Number((row.querySelector('.tds-amount')?.dataset?.value || '0'));
        const finalNet = Number((row.querySelector('.final-net-salary')?.dataset?.value || '0'));
        const attendanceDeduction = Number(String(row.querySelector('.attendance-deduction-amount')?.innerText || '0').replace(/[^0-9.-]+/g, '')) || 0;
        const lateMetrics = app_getLateDeductionMetricsFromRow(row);
        const lateRawDays = lateMetrics.rawLateDeductionDays;
        const penaltyOffsetDays = lateMetrics.penaltyOffsetDays;
        const lateDeductionDays = lateMetrics.lateDeductionDays;
        const totalDeductionDays = lateMetrics.deductionDays;
        const unpaidLeaves = lateMetrics.unpaidLeaves;
        const lateCount = lateMetrics.lateCount;
        const comment = String(row.querySelector('.comment-input')?.value || '').trim();
        const otherAllowances = Number(row.querySelector('.other-allowances-input')?.value || user.otherAllowances || 0);
        const grossEarnings = baseSalary + otherAllowances;
        const loanAdvance = Number(row.querySelector('.loan-advance-input')?.value || user.loanAdvance || 0);
        const pf = Number(row.querySelector('.pf-input')?.value || user.providentFund || 0);
        const profTax = Number(row.querySelector('.professional-tax-input')?.value || user.professionalTax || 0);
        const joinDateCandidate = String(row.querySelector('.join-date-input')?.value || user.joinDate || '').trim();
        const enteredEmployeeId = String(row.querySelector('.employee-id-input')?.value || user.employeeId || '').trim();
        const employeeId = joinDateCandidate
            ? (enteredEmployeeId || app_deriveEmployeeId(joinDateCandidate, user.id))
            : 'NA';
        const designation = String(row.querySelector('.designation-input')?.value || user.designation || user.role || '').trim();
        const department = String(row.querySelector('.department-input')?.value || user.dept || user.department || '').trim();
        const joinDateValue = String(row.querySelector('.join-date-input')?.value || user.joinDate || '').trim();
        const bankName = String(row.querySelector('.bank-name-input')?.value || user.bankName || '').trim();
        const bankAccount = String(row.querySelector('.bank-account-input')?.value || user.bankAccount || user.accountNumber || '').trim();
        const pan = String(row.querySelector('.pan-input')?.value || user.pan || user.PAN || '').trim();
        const uan = String(row.querySelector('.uan-input')?.value || user.uan || user.UAN || '').trim();
        const totalDeductions = attendanceDeduction + tdsAmount + loanAdvance + pf + profTax;
        const netSalaryInWords = `${numberToWordsIndian(finalNet)} Rupees Only`;

        const deductionRows = [
            { label: 'Attendance Deduction', amount: attendanceDeduction, remarks: `Unpaid Leaves: ${unpaidLeaves}, Late Count: ${lateCount}, Late Raw: ${lateRawDays.toFixed(1)}, Offset: ${penaltyOffsetDays.toFixed(1)}, Late Deduction: ${lateDeductionDays.toFixed(1)}, Total Deduction Days: ${totalDeductionDays.toFixed(1)}` },
            { label: 'TDS', amount: tdsAmount, remarks: `Applied at ${tdsPercent.toFixed(2)}%` },
            { label: 'Provident Fund', amount: pf, remarks: pf ? 'Configured as per employee profile' : 'NA' },
            { label: 'Professional Tax', amount: profTax, remarks: profTax ? 'Configured as per employee profile' : 'NA' },
            { label: 'Loan / Advance', amount: loanAdvance, remarks: loanAdvance ? 'Recovered in this cycle' : 'Nil' }
        ];

        const money = (v) => app_formatMoneyInr(v);

        const html = `
                <div class="modal-overlay" id="salary-slip-modal" style="display:flex;">
                    <div class="salary-slip-modal-shell salary-slip-print-root">
                        <div class="salary-slip-actions no-print">
                            <button type="button" class="action-btn secondary" onclick="window.app_printSalarySlip()"><i class="fa-solid fa-print"></i> Print / Save PDF</button>
                            <button type="button" class="action-btn secondary" title="Planned enhancement" disabled style="opacity:0.6; cursor:not-allowed;"><i class="fa-solid fa-file-pdf"></i> html2pdf (Later)</button>
                            <button type="button" class="action-btn" onclick="window.app_closeModal(this)"><i class="fa-solid fa-xmark"></i> Close</button>
                        </div>
                        <div class="salary-slip-paper">
                            <div class="salary-slip-header">
                                <img src="Logo/LOGO USED IN WEB.png" alt="CRWI Logo" class="salary-slip-logo">
                                <div class="salary-slip-org">
                                    <h2>Conference Of Religious Women India</h2>
                                    <div>CRI House, Women Section, Masihgarh, Sukhdev Vihar, New Friends Colony PO, New Delhi-110 025</div>
                                    <div>Phone: 63649 19152 | Email: fin@crwi.org.in / executivedirector@crwi.org.in</div>
                                </div>
                            </div>
                            <div class="salary-slip-title">
                                <h3>Salary Slip</h3>
                                <div>Pay Period: ${payPeriodLabel} (${payPeriodStart} to ${payPeriodEnd})</div>
                                <div>Pay Date: ${payDate}</div>
                            </div>

                            <div class="salary-slip-section">
                                <h4>Employee Details</h4>
                                <div class="salary-slip-grid">
                                    <div><b>Employee Name:</b> ${user.name || 'Staff'}</div>
                                    <div><b>Employee ID:</b> ${employeeId || 'NA'}</div>
                                    <div><b>Designation:</b> ${designation || 'NA'}</div>
                                    <div><b>Department:</b> ${department || 'NA'}</div>
                                    <div><b>Date of Joining:</b> ${app_formatDateGb(joinDateValue)}</div>
                                    <div><b>Bank Name:</b> ${bankName || 'NA'}</div>
                                    <div><b>UAN:</b> ${maskSensitiveValue(uan)}</div>
                                    <div><b>PAN:</b> ${maskSensitiveValue(pan)}</div>
                                    <div><b>Bank A/C:</b> ${maskSensitiveValue(bankAccount)}</div>
                                </div>
                            </div>

                            <div class="salary-slip-split">
                                <div class="salary-slip-section">
                                    <h4>Earnings</h4>
                                    <table class="salary-slip-table">
                                        <tr><td>Basic Salary</td><td>${money(baseSalary)}</td></tr>
                                        <tr><td>HRA</td><td>NA</td></tr>
                                        <tr><td>Conveyance Allowance</td><td>NA</td></tr>
                                        <tr><td>Special Allowance</td><td>NA</td></tr>
                                        <tr><td>Other Allowances</td><td>${money(otherAllowances)}</td></tr>
                                        <tr class="total"><td>Gross Earnings</td><td>${money(grossEarnings)}</td></tr>
                                    </table>
                                </div>
                                <div class="salary-slip-section">
                                    <h4>Deductions (Breakdown)</h4>
                                    <table class="salary-slip-table">
                                        ${deductionRows.map(d => `<tr><td>${d.label}<div class="remark">${d.remarks}</div></td><td>${d.amount ? money(d.amount) : 'NA'}</td></tr>`).join('')}
                                        <tr class="total"><td>Total Deductions</td><td>${money(totalDeductions)}</td></tr>
                                    </table>
                                </div>
                            </div>

                            <div class="salary-slip-net">
                                <div><b>Adjusted Salary:</b> ${money(adjustedSalary)}</div>
                                <div><b>Net Salary:</b> ${money(finalNet)}</div>
                                <div><b>Net Salary in Words:</b> ${netSalaryInWords}</div>
                            </div>

                            <div class="salary-slip-footer">
                                <div>This is a system-generated salary slip and does not require a signature.</div>
                                <div>Generated: ${generatedAt} | Payroll Ref ID: ${payrollRef}</div>
                                ${comment ? `<div>Payroll Comment: ${comment}</div>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        window.app_showModal(html, 'salary-slip-modal');
    } catch (err) {
        console.error('Salary slip generation failed:', err);
        alert(`Failed to generate salary slip: ${err.message}`);
    }
};

// --- Admin Task Management Functions ---

/**
 * Edit task status (admin or user)
 */
window.app_editTaskStatus = async function (planId, taskIndex, newStatus) {
    try {
        const _user = window.AppAuth.getUser();
        const completedDate = newStatus === 'completed' ? new Date().toISOString().split('T')[0] : null;

        await window.AppCalendar.updateTaskStatus(planId, taskIndex, newStatus, completedDate);

        // Refresh dashboard
        const contentArea = document.getElementById('page-content');
        contentArea.innerHTML = await AppUI.renderDashboard();
        alert(`Task status updated to: ${newStatus}`);
    } catch (err) {
        console.error('Failed to update task status:', err);
        alert('Failed to update task status. Please try again.');
    }
};

/**
 * Reassign task to another user (admin only)
 */
window.app_reassignTask = async function (planId, taskIndex, newUserId) {
    try {
        const user = window.AppAuth.getUser();
        if (user.role !== 'Administrator' && !user.isAdmin) {
            alert('Only administrators can reassign tasks.');
            return;
        }

        await window.AppCalendar.reassignTask(planId, taskIndex, newUserId);

        // Refresh dashboard
        const contentArea = document.getElementById('page-content');
        contentArea.innerHTML = await AppUI.renderDashboard();
        alert('Task reassigned successfully!');
    } catch (err) {
        console.error('Failed to reassign task:', err);
        alert('Failed to reassign task. Please try again.');
    }
};

/**
 * View task details modal
 */
window.app_viewTaskDetails = async function (planId, taskIndex) {
    try {
        const plan = await window.AppDB.get('work_plans', planId);
        if (!plan || !plan.plans || !plan.plans[taskIndex]) {
            alert('Task not found.');
            return;
        }

        const task = plan.plans[taskIndex];
        const status = window.AppCalendar.getSmartTaskStatus(plan.date, task.status);

        const statusColors = {
            'to-be-started': '#3b82f6',
            'in-process': '#eab308',
            'completed': '#22c55e',
            'overdue': '#ef4444',
            'not-completed': '#6b7280'
        };

        const statusLabels = {
            'to-be-started': '🔵 To Be Started',
            'in-process': '🟡 In Process',
            'completed': '🟢 Completed',
            'overdue': '🔴 Overdue',
            'not-completed': '⚫ Not Completed'
        };

        const modalHTML = `
                <div class="modal-overlay" id="task-details-modal" style="display: flex;">
                    <div class="modal-content" style="max-width: 500px;">
                        <h2 style="margin-bottom: 1rem;">Task Details</h2>
                        
                        <div style="background: #f9fafb; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">
                            <div style="margin-bottom: 0.75rem;">
                                <label style="font-size: 0.75rem; color: #6b7280; text-transform: uppercase; font-weight: 600;">Task</label>
                                <p style="margin: 0.25rem 0 0 0; font-weight: 500;">${task.task}</p>
                            </div>
                            
                            <div style="margin-bottom: 0.75rem;">
                                <label style="font-size: 0.75rem; color: #6b7280; text-transform: uppercase; font-weight: 600;">Planned Date</label>
                                <p style="margin: 0.25rem 0 0 0;">${plan.date}</p>
                            </div>
                            
                            <div style="margin-bottom: 0.75rem;">
                                <label style="font-size: 0.75rem; color: #6b7280; text-transform: uppercase; font-weight: 600;">Status</label>
                                <p style="margin: 0.25rem 0 0 0;">
                                    <span style="background: ${statusColors[status]}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.875rem; font-weight: 600;">
                                        ${statusLabels[status]}
                                    </span>
                                </p>
                            </div>
                            
                            ${task.completedDate ? `
                                <div style="margin-bottom: 0.75rem;">
                                    <label style="font-size: 0.75rem; color: #6b7280; text-transform: uppercase; font-weight: 600;">Completed Date</label>
                                    <p style="margin: 0.25rem 0 0 0;">${task.completedDate}</p>
                                </div>
                            ` : ''}
                            
                            ${task.subPlans && task.subPlans.length > 0 ? `
                                <div>
                                    <label style="font-size: 0.75rem; color: #6b7280; text-transform: uppercase; font-weight: 600;">Sub-tasks</label>
                                    <ul style="margin: 0.25rem 0 0 0; padding-left: 1.5rem;">
                                        ${task.subPlans.map(sub => `<li>${sub}</li>`).join('')}
                                    </ul>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div style="display: flex; gap: 0.5rem;">
                            <button type="button" class="action-btn" style="flex: 1;" onclick="this.closest('.modal-overlay').remove()">Close</button>
                        </div>
                    </div>
                </div>
            `;

        const mc = document.getElementById('modal-container');
        if (mc && !document.getElementById('task-details-modal')) {
            mc.insertAdjacentHTML('beforeend', modalHTML);
        }
    } catch (err) {
        console.error('Failed to view task details:', err);
        alert('Failed to load task details.');
    }
};

/**
 * Recalculate all user ratings (admin only)
 */
window.app_recalculateRatings = async function () {
    try {
        const user = window.AppAuth.getUser();
        if (user.role !== 'Administrator' && !user.isAdmin) {
            alert('Only administrators can recalculate ratings.');
            return;
        }

        if (!await window.appConfirm('This will recalculate ratings for all users. Continue?')) {
            return;
        }

        const updatedUsers = await window.AppRating.updateAllRatings();
        alert(`Successfully updated ratings for ${updatedUsers.length} users!`);

        // Refresh dashboard
        const contentArea = document.getElementById('page-content');
        contentArea.innerHTML = await AppUI.renderDashboard();
    } catch (err) {
        console.error('Failed to recalculate ratings:', err);
        alert('Failed to recalculate ratings. Please try again.');
    }
};

// Listeners for Modal Events 
// (We keep these as they are internal to app.js logic or standard form submits)
// Removed old document.addEventListener calls for admin actions since we use global funcs now.

window.app_triggerManualAudit = async () => {
    if (!await window.appConfirm("Trigger a manual location audit for all active staff?")) return;
    const slotName = `Manual Audit @ ${new Date().toLocaleTimeString()}`;
    try {
        await window.AppDB.add('system_commands', {
            type: 'audit',
            slotName: slotName,
            timestamp: Date.now(),
            requestedBy: window.AppAuth.getUser()?.name || 'Admin',
            status: 'pending'
        });
        alert("Manual audit command sent. All active staff devices will now perform a stealth check.");
    } catch (err) {
        console.error("Failed to trigger manual audit:", err);
        alert("Error: " + err.message);
    }
};

window.app_applyAuditFilter = async () => {
    const start = document.getElementById('audit-start')?.value;
    const end = document.getElementById('audit-end')?.value;
    const contentArea = document.getElementById('page-content');
    if (contentArea) {
        contentArea.innerHTML = await AppUI.renderAdmin(start, end);
        if (window.AppAnalytics) window.AppAnalytics.initAdminCharts();
    }
};

window.app_exportAudits = async () => {
    const start = document.getElementById('audit-start')?.value;
    const end = document.getElementById('audit-end')?.value;

    try {
        let audits = await window.AppDB.getAll('location_audits');
        if (start && end) {
            audits = audits.filter(a => {
                const d = new Date(a.timestamp).toISOString().split('T')[0];
                return d >= start && d <= end;
            });
        }
        audits.sort((a, b) => b.timestamp - a.timestamp);

        if (audits.length === 0) {
            alert("No audits found for the selected range.");
            return;
        }

        const headers = ['Timestamp', 'Date', 'Time', 'Staff Member', 'Slot', 'Status', 'Latitude', 'Longitude'];
        const rows = audits.map(a => [
            a.timestamp,
            new Date(a.timestamp).toLocaleDateString(),
            new Date(a.timestamp).toLocaleTimeString(),
            a.userName || 'Unknown',
            a.slot,
            a.status,
            a.lat || '',
            a.lng || ''
        ]);

        const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `security_audits_${start || 'export'}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        console.error("Export failed:", err);
        alert("Export failed: " + err.message);
    }
};

window.app_fixCurrentMonthFalseHalfDayLeaves = async (options = {}) => {
    if (!window.app_canManageAttendanceSheet()) return { updated: 0, scanned: 0 };
    const silent = options?.silent !== false;
    const now = new Date();
    const year = Number(options?.year) || now.getFullYear();
    const monthOneBased = Number(options?.month) || (now.getMonth() + 1);
    const startDateStr = `${year}-${String(monthOneBased).padStart(2, '0')}-01`;
    const endDateStr = `${year}-${String(monthOneBased).padStart(2, '0')}-31`;

    let logs = [];
    try {
        logs = await window.AppDB.query('attendance', 'date', '>=', startDateStr);
        logs = (logs || []).filter(l => String(l?.date || '') <= endDateStr);
    } catch {
        const allLogs = await window.AppDB.getAll('attendance');
        logs = (allLogs || []).filter(l => String(l?.date || '') >= startDateStr && String(l?.date || '') <= endDateStr);
    }

    let scanned = 0;
    let updated = 0;
    let skippedAutoClosed = 0;
    let skippedLinkedLeave = 0;
    let skippedUnder8Hours = 0;
    let skippedInvalidTime = 0;
    const reviewCandidates = [];
    for (const log of (logs || [])) {
        if (!log || !log.id) continue;
        scanned++;
        const rawType = String(log.type || '').trim();
        if (rawType !== 'Half Day Leave') continue;
        if (log.autoCheckout) {
            skippedAutoClosed++;
            reviewCandidates.push({ id: log.id, userId: log.user_id || log.userId || '', date: log.date, reason: 'auto-closed system entry' });
            continue;
        }
        const isLinkedLeave = !!(log.leaveGenerated || log.leaveRequestId);

        const dateIso = parseLogDateToISO(log.date);
        const in24 = (log.checkIn && log.checkOut && log.checkOut !== 'Active Now') ? convertTo24h(log.checkIn) : null;
        const out24 = (log.checkIn && log.checkOut && log.checkOut !== 'Active Now') ? convertTo24h(log.checkOut) : null;
        if (!dateIso || !in24 || !out24) {
            skippedInvalidTime++;
            reviewCandidates.push({ id: log.id, userId: log.user_id || log.userId || '', date: log.date, reason: 'invalid/missing time range' });
            continue;
        }

        const inDt = window.AppAttendance.buildDateTime(dateIso, in24);
        const outDt = window.AppAttendance.buildDateTime(dateIso, out24);
        if (!(inDt && outDt && outDt > inDt)) {
            skippedInvalidTime++;
            reviewCandidates.push({ id: log.id, userId: log.user_id || log.userId || '', date: log.date, reason: 'invalid/missing time range' });
            continue;
        }
        const durationMs = outDt - inDt;
        if (durationMs < (8 * 60 * 60 * 1000)) {
            skippedUnder8Hours++;
            continue;
        }

        const statusMeta = window.AppAttendance.evaluateAttendanceStatus(inDt, durationMs);
        const nextRecord = {
            ...log,
            type: 'Present',
            dayCredit: 1,
            lateCountable: statusMeta.lateCountable === true,
            extraWorkedMs: statusMeta.extraWorkedMs || 0,
            durationMs: typeof log.durationMs === 'number' ? log.durationMs : durationMs,
            leaveGenerated: false,
            leaveRequestId: '',
            policyVersion: 'v2'
        };
        await window.AppDB.put('attendance', nextRecord);
        if (isLinkedLeave) skippedLinkedLeave++;
        updated++;
    }

    if (!silent && updated > 0) {
        alert(`Fixed ${updated} incorrect Half Day Leave entr${updated === 1 ? 'y' : 'ies'} in ${year}-${String(monthOneBased).padStart(2, '0')}.`);
    } else if (!silent) {
        const sample = reviewCandidates.slice(0, 8).map((c) => `- ${c.date} | ${c.userId || 'unknown'} | ${c.reason}`).join('\n');
        alert(
            `No fixes applied for ${year}-${String(monthOneBased).padStart(2, '0')}.\n` +
            `Scanned: ${scanned}\n` +
            `Skipped (auto-closed): ${skippedAutoClosed}\n` +
            `Skipped (linked leave): ${skippedLinkedLeave}\n` +
            `Skipped (<8h): ${skippedUnder8Hours}\n` +
            `Skipped (invalid time): ${skippedInvalidTime}\n` +
            `${sample ? `\nSample skipped entries:\n${sample}` : ''}`
        );
    }
    return { updated, scanned, skippedAutoClosed, skippedLinkedLeave, skippedUnder8Hours, skippedInvalidTime, reviewCandidates };
};

const APP_STAFF_DATA_RESET_COLLECTIONS = [
    'attendance',
    'leaves',
    'work_plans',
    'staff_messages',
    'meetings',
    'minutes',
    'salaries',
    'location_audits',
    'system_audit_logs',
    'system_commands',
    'daily_summaries',
    'daily_summaries_meta',
    'summary_locks',
    'journey_reflections',
    'ai_staff_context'
];

const app_canManageStaffData = (user = window.AppAuth?.getUser?.()) => {
    if (!user) return false;
    if (window.app_hasPerm?.('users', 'admin', user)) return true;
    return user.isAdmin === true || user.role === 'Administrator';
};

const app_isPermissionDeniedError = (error) => {
    try {
        if (window.AppDB?.isPermissionDenied?.(error)) return true;
    } catch { /* fallback below */ }
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    return code.includes('permission-denied')
        || message.includes('missing or insufficient permissions');
};

const app_normalizeToIsoDate = (value) => {
    if (value === null || value === undefined) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().split('T')[0];
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const asDate = new Date(value);
        if (!Number.isNaN(asDate.getTime())) return asDate.toISOString().split('T')[0];
        return '';
    }

    const raw = String(value || '').trim();
    if (!raw) return '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
    if (/^\d{4}-\d{2}-\d{2}T/i.test(raw)) return raw.slice(0, 10);
    if (/^\d+$/.test(raw)) {
        const asDate = new Date(Number(raw));
        if (!Number.isNaN(asDate.getTime())) return asDate.toISOString().split('T')[0];
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
    return '';
};

const app_getCollectionDateKeys = (collection) => {
    switch (collection) {
    case 'attendance':
        return ['date', 'createdAt', 'updatedAt'];
    case 'work_plans':
        return ['date', 'createdAt', 'updatedAt'];
    case 'staff_messages':
        return ['createdAt', 'date', 'updatedAt'];
    case 'meetings':
        return ['date', 'timestamp', 'createdAt', 'updatedAt'];
    case 'minutes':
        return ['date', 'createdAt', 'updatedAt', 'timestamp'];
    case 'salaries':
        return ['payDate', 'processedAt', 'month', 'periodStart', 'periodEnd', 'createdAt', 'updatedAt'];
    case 'birthday_people':
        return ['date', 'birthDate', 'dob', 'createdAt', 'updatedAt'];
    case 'location_audits':
        return ['timestamp', 'date', 'createdAt', 'updatedAt'];
    case 'system_audit_logs':
        return ['createdAt', 'timestamp', 'date', 'updatedAt'];
    case 'system_commands':
        return ['timestamp', 'createdAt', 'date', 'updatedAt'];
    case 'daily_summaries':
        return ['date', 'summaryDate', 'createdAt', 'updatedAt', 'id'];
    case 'daily_summaries_meta':
        return ['date', 'createdAt', 'updatedAt', 'lastSuccessAt', 'id'];
    case 'summary_locks':
        return ['date', 'createdAt', 'updatedAt', 'lockedAt', 'expiresAt', 'id'];
    default:
        return ['date', 'createdAt', 'updatedAt', 'timestamp', 'id'];
    }
};

const app_rowMatchesRange = (collection, row, startIso, endIso) => {
    if (!startIso || !endIso) return { matches: true, hasDate: true };
    if (!row || typeof row !== 'object') return { matches: false, hasDate: false };

    if (collection === 'leaves') {
        const leaveStart = app_normalizeToIsoDate(row.startDate || row.appliedOn || row.createdAt || row.date);
        const leaveEnd = app_normalizeToIsoDate(row.endDate || row.startDate || row.appliedOn || row.createdAt || row.date);
        if (!leaveStart && !leaveEnd) return { matches: false, hasDate: false };
        const resolvedStart = leaveStart || leaveEnd;
        const resolvedEnd = leaveEnd || leaveStart;
        const overlap = !(resolvedEnd < startIso || resolvedStart > endIso);
        return { matches: overlap, hasDate: true };
    }

    const keys = app_getCollectionDateKeys(collection);
    for (const key of keys) {
        const dateValue = app_normalizeToIsoDate(row[key]);
        if (!dateValue) continue;
        return { matches: dateValue >= startIso && dateValue <= endIso, hasDate: true };
    }

    return { matches: false, hasDate: false };
};

const app_downloadJsonFile = (payload, fileName) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

const app_escapeCsvValue = (value) => {
    if (value === null || value === undefined) return '';
    let text = '';
    if (typeof value === 'object') text = JSON.stringify(value);
    else text = String(value);
    text = text.replace(/"/g, '""');
    if (/[",\n]/.test(text)) return `"${text}"`;
    return text;
};

const app_convertRowsToCsv = (rows = []) => {
    const list = Array.isArray(rows) ? rows : [];
    const keySet = new Set();
    list.forEach((row) => {
        if (!row || typeof row !== 'object') return;
        Object.keys(row).forEach((key) => keySet.add(String(key)));
    });
    const headers = Array.from(keySet);
    if (!headers.length) return 'id\n';

    const headerRow = headers.map(app_escapeCsvValue).join(',');
    const dataRows = list.map((row) => headers.map((key) => app_escapeCsvValue(row?.[key])).join(','));
    return [headerRow, ...dataRows].join('\n');
};

const app_downloadCsvFile = (content, fileName) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

window.app_backupStaffData = async (options = {}) => {
    const user = window.AppAuth?.getUser?.();
    if (!app_canManageStaffData(user)) {
        alert('Only admin users can run staff data backup.');
        return { success: false, reason: 'not_authorized' };
    }

    const data = {};
    const counts = {};
    const warnings = [];
    const hardFailures = [];
    const reads = await Promise.all(APP_STAFF_DATA_RESET_COLLECTIONS.map(async (collection) => {
        try {
            const rows = await window.AppDB.getAll(collection);
            return { collection, rows: rows || [], warning: null };
        } catch (error) {
            if (app_isPermissionDeniedError(error)) {
                return {
                    collection,
                    rows: [],
                    warning: `Permission denied for ${collection}. Backed up as empty.`
                };
            }
            return { collection, rows: [], error };
        }
    }));

    reads.forEach((entry) => {
        const collection = entry.collection;
        if (entry.error) {
            hardFailures.push(collection);
            return;
        }
        if (entry.warning) warnings.push(entry.warning);
        data[collection] = entry.rows || [];
        counts[collection] = (entry.rows || []).length;
    });

    if (hardFailures.length) {
        throw new Error(`Backup failed while reading: ${hardFailures.join(', ')}`);
    }

    const now = new Date();
    const isoStamp = now.toISOString();
    const fileStamp = isoStamp.replace(/[:.]/g, '-');
    const fileName = `staff_backup_${fileStamp}.json`;
    const payload = {
        meta: {
            generatedAt: isoStamp,
            generatedById: user?.id || '',
            generatedByName: user?.name || '',
            reason: options.reason || 'manual_backup',
            scope: 'staff_activity_reset',
            usersRetained: true,
            collections: [...APP_STAFF_DATA_RESET_COLLECTIONS],
            warnings
        },
        counts,
        data
    };

    app_downloadJsonFile(payload, fileName);

    if (options.showSuccess !== false) {
        alert(`Backup downloaded successfully as ${fileName}.`);
    }
    return { success: true, fileName, counts };
};

window.app_backupStaffDataCSV = async () => {
    const user = window.AppAuth?.getUser?.();
    if (!app_canManageStaffData(user)) {
        alert('Only admin users can run staff data backup.');
        return { success: false, reason: 'not_authorized' };
    }

    const isoStamp = new Date().toISOString();
    const fileStamp = isoStamp.replace(/[:.]/g, '-');
    const warnings = [];
    const hardFailures = [];
    const counts = {};
    let downloadedFiles = 0;

    const reads = await Promise.all(APP_STAFF_DATA_RESET_COLLECTIONS.map(async (collection) => {
        try {
            const rows = await window.AppDB.getAll(collection);
            return { collection, rows: rows || [], warning: null };
        } catch (error) {
            if (app_isPermissionDeniedError(error)) {
                return {
                    collection,
                    rows: [],
                    warning: `Permission denied for ${collection}. Backed up as empty.`
                };
            }
            return { collection, rows: [], error };
        }
    }));

    reads.forEach((entry) => {
        const collection = entry.collection;
        if (entry.error) {
            hardFailures.push(collection);
            return;
        }
        if (entry.warning) warnings.push(entry.warning);
        counts[collection] = (entry.rows || []).length;
        const csv = app_convertRowsToCsv(entry.rows || []);
        app_downloadCsvFile(csv, `staff_backup_${collection}_${fileStamp}.csv`);
        downloadedFiles += 1;
    });

    if (hardFailures.length) {
        throw new Error(`CSV backup failed while reading: ${hardFailures.join(', ')}`);
    }

    const warningText = warnings.length ? `\nWarnings:\n- ${warnings.join('\n- ')}` : '';
    alert(`CSV backup downloaded (${downloadedFiles} files).${warningText}`);
    return { success: true, downloadedFiles, counts, warnings };
};

window.app_resetStaffData = async (options = {}) => {
    const user = window.AppAuth?.getUser?.();
    if (!app_canManageStaffData(user)) {
        alert('Only admin users can reset staff data.');
        return;
    }

    const startIso = app_normalizeToIsoDate(options.startDate || '');
    const endIso = app_normalizeToIsoDate(options.endDate || '');
    const hasRangeFilter = !!(startIso || endIso);
    if ((startIso && !endIso) || (!startIso && endIso)) {
        alert('Please select both From Date and To Date for range reset.');
        return;
    }
    if (hasRangeFilter && startIso > endIso) {
        alert('From Date cannot be after To Date.');
        return;
    }
    const rangeLabel = hasRangeFilter ? `${startIso} to ${endIso}` : 'All dates';
    const isFullReset = !hasRangeFilter;

    const confirmed = await window.appConfirm(
        `This will permanently remove staff activity data (attendance, leaves, plans, messages, audits, minutes, and related records) for: ${rangeLabel}. User accounts will be kept. Continue?`
    );
    if (!confirmed) return;

    const confirmPhrase = 'RESET STAFF DATA';
    const typed = await window.appPrompt(
        `Type ${confirmPhrase} to continue.`,
        '',
        { title: 'Final Confirmation', confirmText: 'Run Reset', placeholder: confirmPhrase }
    );
    if (typed === null) return;
    if (String(typed || '').trim().toUpperCase() !== confirmPhrase) {
        alert('Confirmation text did not match. Reset cancelled.');
        return;
    }

    let backupInfo = null;
    try {
        backupInfo = await window.app_backupStaffData({
            reason: hasRangeFilter ? `pre_reset_backup_${startIso}_to_${endIso}` : 'pre_reset_backup',
            showSuccess: false
        });
    } catch (error) {
        console.error('Pre-reset backup failed:', error);
        alert(`Reset cancelled because backup failed: ${error.message}`);
        return;
    }
    if (!backupInfo?.success) {
        alert('Reset cancelled because backup did not complete.');
        return;
    }

    const deletedCounts = {};
    const noDateCounts = {};
    const permissionSkipped = [];
    const verificationRemaining = {};
    const errors = [];

    for (const collection of APP_STAFF_DATA_RESET_COLLECTIONS) {
        try {
            if (isFullReset) {
                const deleted = window.AppDB.deleteAllInCollection
                    ? await window.AppDB.deleteAllInCollection(collection, { source: 'server' })
                    : 0;
                deletedCounts[collection] = Number(deleted || 0);
                continue;
            }

            const rows = await window.AppDB.getAll(collection, { source: 'server' });
            const idsToDelete = [];
            let noDate = 0;
            for (const row of (rows || [])) {
                const match = app_rowMatchesRange(collection, row, startIso, endIso);
                if (!match.hasDate) noDate += 1;
                if (match.matches && row?.id) idsToDelete.push(String(row.id));
            }

            const deleted = idsToDelete.length && window.AppDB.deleteMany
                ? await window.AppDB.deleteMany(collection, idsToDelete)
                : 0;

            deletedCounts[collection] = Number(deleted || 0);
            if (noDate > 0) noDateCounts[collection] = noDate;
        } catch (error) {
            if (app_isPermissionDeniedError(error)) {
                deletedCounts[collection] = Number(deletedCounts[collection] || 0);
                permissionSkipped.push(collection);
                continue;
            }
            console.error(`Failed resetting ${collection}:`, error);
            deletedCounts[collection] = Number(deletedCounts[collection] || 0);
            errors.push(`${collection}: ${error.message}`);
        }
    }

    for (const collection of APP_STAFF_DATA_RESET_COLLECTIONS) {
        try {
            const rows = await window.AppDB.getAll(collection, { source: 'server', silentPermissionDenied: true });
            let stillPresent = 0;
            if (isFullReset) {
                stillPresent = Number((rows || []).length || 0);
            } else {
                stillPresent = Number((rows || []).filter((row) => app_rowMatchesRange(collection, row, startIso, endIso).matches).length || 0);
            }
            if (stillPresent > 0) verificationRemaining[collection] = stillPresent;
        } catch (error) {
            if (!app_isPermissionDeniedError(error)) {
                errors.push(`verify(${collection}): ${error.message}`);
            }
        }
    }

    let usersUpdated = 0;
    if (isFullReset) {
        try {
            const users = await window.AppDB.getAll('users');
            for (const row of users) {
                if (!row || !row.id) continue;
                await window.AppDB.put('users', {
                    id: row.id,
                    status: 'out',
                    lastCheckIn: null,
                    lastCheckOut: null,
                    currentLocation: null,
                    notifications: [],
                    lastSeen: null
                });
                usersUpdated += 1;
            }
        } catch (error) {
            console.error('Failed to normalize users after reset:', error);
            errors.push(`users(normalization): ${error.message}`);
        }
    }

    const deletedTotal = Object.values(deletedCounts).reduce((sum, n) => sum + Number(n || 0), 0);
    const noDateTotal = Object.values(noDateCounts).reduce((sum, n) => sum + Number(n || 0), 0);
    const verifyRemainingTotal = Object.values(verificationRemaining).reduce((sum, n) => sum + Number(n || 0), 0);
    const summaryText = [
        `Backup: ${backupInfo.fileName}`,
        `Range: ${rangeLabel}`,
        `Deleted records: ${deletedTotal}`,
        `Users normalized: ${usersUpdated}`,
        noDateTotal > 0 ? `Skipped (no date in selected mode): ${noDateTotal}` : '',
        permissionSkipped.length ? `Skipped (permission denied): ${permissionSkipped.join(', ')}` : '',
        verifyRemainingTotal > 0 ? `Still present after reset: ${verifyRemainingTotal}` : 'Verification: no matching records remain on Firestore'
    ].filter(Boolean).join('\n');

    try {
        if (window.AppDB?.cache?.clear) window.AppDB.cache.clear();
        if (window.AppAnalytics?.memo?.clear) window.AppAnalytics.memo.clear();
        if (window.AppLeaves?.cache && typeof window.AppLeaves.cache === 'object') window.AppLeaves.cache = {};
        window._currentPlans = null;
    } catch {
        // ignore cache reset errors
    }

    if (window.AppAuth?.refreshCurrentUserFromDB) {
        try { await window.AppAuth.refreshCurrentUserFromDB(); } catch { /* ignore */ }
    }

    if (window.location.hash.replace('#', '') === 'admin' && window.app_refreshAdminPage) {
        await window.app_refreshAdminPage();
    }

    if (errors.length) {
        alert(`Reset completed with issues.\n${summaryText}\n\nErrors:\n${errors.join('\n')}`);
        return;
    }

    alert(`Staff activity data reset completed.\n${summaryText}`);
};

window.app_changeAnnualYear = (delta) => {
    window.app_annualYear = (window.app_annualYear || new Date().getFullYear()) + delta;
    window.app_renderAnnualPlanPage();
};

window.app_toggleAnnualLegendFilter = (key) => {
    const filters = window.app_annualLegendFilters || {
        leave: true,
        event: true,
        work: true,
        overdue: true,
        completed: true
    };
    if (Object.prototype.hasOwnProperty.call(filters, key)) {
        filters[key] = !filters[key];
        window.app_annualLegendFilters = filters;
        window.app_renderAnnualPlanPage();
    }
};

window.app_showAnnualDayDetails = async (dateStr) => {
    if (!dateStr) return;
    const plans = window._currentPlans || await window.AppCalendar.getPlans();
    const filters = window.app_annualLegendFilters || {
        leave: true,
        event: true,
        work: true,
        overdue: true,
        completed: true
    };
    // determine user filter: only apply for non-admins
    const currentUser = window.AppAuth.getUser() || {};
    const isAdmin = currentUser.role === 'Administrator' || currentUser.isAdmin;
    const events = (window.app_getDayEvents(dateStr, plans, { includeAuto: false, userId: isAdmin ? null : currentUser.id }) || []).filter(ev => {
        if (ev.type === 'leave') return !!filters.leave;
        if (ev.type === 'work') return !!filters.work;
        if (ev.type === 'holiday') return !!filters.event;
        return !!filters.event;
    });
    const listHTML = events.length ? events.map(ev => {
        const type = ev.type || 'event';
        const tagStyle = type === 'leave'
            ? 'background:#fee2e2;color:#991b1b;'
            : type === 'work'
                ? 'background:#e0e7ff;color:#3730a3;'
                : type === 'holiday'
                    ? 'background:#f1f5f9;color:#334155;'
                    : 'background:#dcfce7;color:#166534;';
        const tasks = type === 'work' && Array.isArray(ev.plans) && ev.plans.length
            ? `<ul style="margin:0.5rem 0 0 1rem; padding:0; color:#475569; font-size:0.8rem;">
                    ${ev.plans.map(p => `<li>${window.app_formatTaskWithPostponeChip(p.task || 'Work plan item')}</li>`).join('')}
                   </ul>`
            : '';
        return `
                <div class="annual-v2-detail-item" style="border:1px solid #eef2f7; border-radius:12px; padding:0.75rem;">
                    <div class="annual-v2-detail-item-head" style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                        <span class="annual-v2-detail-tag" style="padding:2px 8px; border-radius:999px; font-size:0.7rem; font-weight:700; ${tagStyle}">${type.toUpperCase()}</span>
                        <div class="annual-v2-detail-title" style="font-size:0.9rem; color:#1f2937; font-weight:600;">${ev.title || 'Event'}</div>
                    </div>
                    ${tasks}
                </div>`;
    }).join('') : '<div style="text-align:center; color:#94a3b8; padding:1rem;">No visible items for this date with current filters.</div>';
    const html = `
            <div class="modal-overlay annual-v2-modal" id="annual-day-detail-modal" style="display:flex;">
                <div class="annual-detail-modal annual-v2-modal-content">
                    <div class="annual-detail-modal-header annual-v2-detail-head">
                        <div>
                            <div style="font-size:0.8rem; color:#64748b;">Date</div>
                            <div style="font-size:1rem; font-weight:700; color:#1e1b4b;">${dateStr}</div>
                        </div>
                        <button type="button" onclick="window.app_closeModal(this)" class="day-plan-close-btn" title="Close">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="annual-v2-detail-list" style="display:flex; flex-direction:column; gap:0.6rem; max-height:60vh; overflow:auto;">
                        ${listHTML}
                    </div>
                </div>
            </div>`;
    window.app_showModal(html, 'annual-day-detail-modal');
};

window.app_toggleAnnualView = (mode) => {
    window.app_annualViewMode = mode;
    window.app_renderAnnualPlanPage();
};

window.app_jumpToAnnualToday = () => {
    const today = new Date();
    window.app_annualYear = today.getFullYear();
    window.app_selectedAnnualDate = today.toISOString().split('T')[0];
    window.app_renderAnnualPlanPage().then(() => {
        window.app_showAnnualDayDetails(window.app_selectedAnnualDate);
    });
};

window.app_renderAnnualPlanPage = async () => {
    const contentArea = document.getElementById('page-content');
    if (!contentArea) return;
    contentArea.innerHTML = await AppUI.renderAnnualPlan();
};

window.app_setAnnualStaffFilter = (value) => {
    window.app_annualStaffFilter = String(value || '').trim();
    window.app_renderAnnualPlanPage();
};

window.app_setAnnualListSearch = (value) => {
    window.app_annualListSearch = String(value || '').trim();
    window.app_renderAnnualPlanPage();
};

window.app_setAnnualListSort = (value) => {
    window.app_annualListSort = String(value || 'date-asc').trim();
    window.app_renderAnnualPlanPage();
};

window.app_renderTimesheetPage = async () => {
    const contentArea = document.getElementById('page-content');
    if (!contentArea) return;
    contentArea.innerHTML = await AppUI.renderTimesheet();
};

window.app_setTimesheetView = (mode) => {
    window.app_timesheetViewMode = mode === 'calendar' ? 'calendar' : 'list';
    window.app_renderTimesheetPage();
};

window.app_changeTimesheetMonth = (delta) => {
    const today = new Date();
    const currentMonth = Number.isInteger(window.app_timesheetMonth) ? window.app_timesheetMonth : today.getMonth();
    const currentYear = Number.isInteger(window.app_timesheetYear) ? window.app_timesheetYear : today.getFullYear();
    const d = new Date(currentYear, currentMonth, 1);
    d.setMonth(d.getMonth() + delta);
    window.app_timesheetMonth = d.getMonth();
    window.app_timesheetYear = d.getFullYear();
    window.app_renderTimesheetPage();
};

window.app_jumpTimesheetToday = () => {
    const today = new Date();
    window.app_timesheetMonth = today.getMonth();
    window.app_timesheetYear = today.getFullYear();
    window.app_renderTimesheetPage();
};

window.app_closeModal = (el) => {
    const overlay = el && el.closest ? el.closest('.modal-overlay') : null;
    if (overlay) overlay.remove();
};

window.app_getSystemUpdateNotes = () => ([
    {
        date: '2026-02-21',
        summary: 'Check for System Update now shows this quick update popup before refreshing.'
    },
    {
        date: '2026-02-21',
        summary: 'The update action shortcut was changed from Ctrl+F5 to Ctrl+Shift+R.'
    }
]);

window.app_showSystemUpdatePopup = () => {
    if (document.getElementById('system-update-modal')) return;
    const modalId = 'system-update-modal';
    const state = getReleaseUpdateSnapshot();
    releaseUpdateState.lastPopupReleaseId = state.releaseId || '';
    const isUpdateReady = state.active && state.buildId && state.buildId !== state.currentBuildId;
    const notes = (window.app_getSystemUpdateNotes() || []).slice(0, 5);
    const listHtml = notes.length
        ? notes.map(n => `
                <li style="margin:0 0 0.7rem 0; color:#334155; line-height:1.45;">
                    <span style="display:block; font-size:0.72rem; color:#64748b; font-weight:700;">${escapeDialogHtml(n.date || '')}</span>
                    <span>${escapeDialogHtml(n.summary || '')}</span>
                </li>
            `).join('')
        : '<li style="color:#64748b;">No update notes available.</li>';
    const releaseMeta = isUpdateReady
        ? `
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:0.6rem 0.75rem; margin-bottom:0.8rem;">
                    <div style="font-size:0.78rem; font-weight:700; color:#0f172a;">New version available</div>
                    <div style="font-size:0.74rem; color:#475569; margin-top:0.15rem;">
                        Running build: ${escapeDialogHtml((state.currentCommitSha || '').slice(0, 7) || state.currentBuildId || 'local')}
                        ${state.currentBuiltAt ? ` | Built: ${escapeDialogHtml(state.currentBuiltAt)}` : ''}
                    </div>
                    <div style="font-size:0.74rem; color:#475569; margin-top:0.25rem;">
                        Available build: ${escapeDialogHtml((state.commitSha || '').slice(0, 7) || state.buildId)}
                        ${state.deployedAt ? ` | Deployed: ${escapeDialogHtml(state.deployedAt)}` : ''}
                    </div>
                    ${state.notes ? `<div style="font-size:0.78rem; color:#0f172a; margin-top:0.45rem;">${escapeDialogHtml(state.notes)}</div>` : ''}
                </div>
            `
        : `
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:0.6rem 0.75rem; margin-bottom:0.8rem;">
                    <div style="font-size:0.78rem; font-weight:700; color:#0f172a;">You are on the latest version</div>
                    <div style="font-size:0.74rem; color:#475569; margin-top:0.15rem;">
                        Current build: ${escapeDialogHtml((state.currentCommitSha || '').slice(0, 7) || state.currentBuildId || 'local')}
                        ${state.currentBuiltAt ? ` | Built: ${escapeDialogHtml(state.currentBuiltAt)}` : ''}
                    </div>
                </div>
            `;

    const closeAction = isUpdateReady ? 'window.app_dismissReleaseUpdatePrompt()' : "this.closest('.modal-overlay').remove()";
    const primaryAction = isUpdateReady
        ? `<button type="button" class="action-btn" onclick="this.closest('.modal-overlay').remove(); window.app_forceRefresh();">Update now</button>`
        : '';
    const html = `
            <div class="modal-overlay" id="${modalId}" style="display:flex;">
                <div class="modal-content" style="max-width:560px;">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.8rem;">
                        <h3 style="margin:0; font-size:1.1rem;">${isUpdateReady ? 'System Update Available' : 'System Updates'}</h3>
                        <button type="button" onclick="${closeAction}" style="background:none; border:none; font-size:1.25rem; cursor:pointer;">&times;</button>
                    </div>
                    ${releaseMeta}
                    <p style="margin:0 0 0.8rem 0; color:#64748b; font-size:0.86rem;">Recent functionality changes</p>
                    <ul style="margin:0; padding-left:1rem; max-height:260px; overflow:auto;">
                        ${listHtml}
                    </ul>
                    <div style="display:flex; gap:0.5rem; justify-content:flex-end; margin-top:1rem;">
                        <button type="button" class="action-btn secondary" onclick="${closeAction}">${isUpdateReady ? 'Later' : 'Close'}</button>
                        ${primaryAction}
                    </div>
                </div>
            </div>
        `;
    window.app_showModal(html, modalId);
};

const activateWaitingServiceWorker = async (registration) => {
    if (!registration?.waiting || !navigator.serviceWorker) return false;

    const waitingWorker = registration.waiting;
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
            clearTimeout(timeoutId);
            resolve(value);
        };
        const onControllerChange = () => finish(true);
        const timeoutId = setTimeout(() => finish(false), 3000);

        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    });
};

window.app_forceRefresh = async () => {
    try {
        if (navigator.serviceWorker) {
            const regs = await navigator.serviceWorker.getRegistrations();
            if (appServiceWorkerRegistration?.update) {
                await appServiceWorkerRegistration.update();
            }
            for (const registration of regs) {
                await activateWaitingServiceWorker(registration);
            }
        }
        if (window.caches) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }
    } catch (err) {
        console.warn('Force refresh cleanup failed:', err);
    }
    clearReleaseUpdateState(true);
    window.location.reload();
};

// Initialization
init();

console.log("App.js Loaded & Globals Ready");
