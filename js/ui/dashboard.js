/**
 * Dashboard Component
 * Handles rendering of the main dashboard and its sub-widgets.
 */

import { safeHtml, safeUrl, timeAgo } from './helpers.js';
import { renderStarRating, renderTaskStatusBadge } from './common.js';
import { normalizeTaskStatus } from '../utils/task-status.js';
import { isTaskVisibleToViewer } from '../utils/task-visibility.js';
import { renderYearlyPlan } from './team-schedule.js';
import { renderJourneyReflectionCard } from './journey-reflection.js';
import { renderStaffPerformance, cleanupPerformanceChart, renderTeamPerformanceExpanded } from './staff-performance.js';
import { AppConfig } from '../config.js';
import {
  DASHBOARD_CARD_MODE_TILE,
  DASHBOARD_CARD_MODE_ORIGINAL,
  DASHBOARD_CARD_MODE_FULLSCREEN,
  DASHBOARD_CARD_MODES,
  DASHBOARD_CARD_CONTROL_EXCLUDED_CLASSES,
  DASHBOARD_MAX_OVERLAY_ID as _DASHBOARD_MAX_OVERLAY_ID,
  DASHBOARD_MAX_TITLE_ID as _DASHBOARD_MAX_TITLE_ID,
  DASHBOARD_MAX_BODY_ID,
  DASHBOARD_MAX_RENDER_DELAY_MS as _DASHBOARD_MAX_RENDER_DELAY_MS,
  closeDashboardCardMaxOverlay,
  openDashboardCardMaxOverlay as _openDashboardCardMaxOverlay,
  getDashboardCardElementById,
  setDashboardCardModeClass as _setDashboardCardModeClass,
  applyDashboardCardMode
} from './dashboard-card-mode.js';
import { onAction } from '../utils/action-router.js';
import { getTodayFeast, loadFeastImage, getLiturgicalSeasonColor, getLiturgicalSeasonBg, getRankLabel } from '../modules/feasts.js';

const escapeJsSingleQuote = (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const WORKLOG_PAGE_SIZE = 25;
const DASHBOARD_IST_TIME_ZONE = 'Asia/Kolkata';
const PLANNED_TASK_STATUS_RANK = {
    'in-process': 0,
    overdue: 1,
    'to-be-started': 2,
    postponed: 3
};
const DASHBOARD_SECTION_ROUTE_CARD_IDS = new Set([
    'checkin',
    'worklog',
    'team-activity',
    'team-schedule',
    'staff-directory',
    'leave-requests',
    'leave-history',
    'missed-checkout',
    'stats-monthly',
    'stats-yearly'
]);

const markPerf = (name) => {
    try {
        if (window?.performance?.mark) window.performance.mark(name);
    } catch {
        /* ignore */
    }
};

const measurePerf = (name, startMark, endMark) => {
    try {
        if (window?.performance?.measure) window.performance.measure(name, startMark, endMark);
    } catch {
        /* ignore */
    }
};

const getDashboardTodayIso = () => {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: DASHBOARD_IST_TIME_ZONE }).format(new Date());
    } catch {
        return new Date().toISOString().slice(0, 10);
    }
};

const isActionablePlannedTaskStatus = (status) => {
    const normalized = String(status || '').toLowerCase().trim();
    // 'not-completed' is the legacy alias of 'postponed' (old editor value) — both are
    // actionable and must keep showing in the widget; only genuinely closed statuses are hidden.
    return !['completed', 'cancelled', 'canceled', 'removed'].includes(normalized);
};

const getPlannedTaskRows = (workPlans, userId, fromKey, toKey, viewerId = '') => {
    const rows = [];
    const uid = String(userId || '').trim();
    if (!uid) return rows;
    const from = String(fromKey || '').trim();
    const to = String(toKey || '').trim();

    (Array.isArray(workPlans) ? workPlans : []).forEach((plan) => {
        if (!plan) return;
        const planDate = String(plan.date || '').trim();
        if (!planDate) return;
        if (from && planDate < from) return;
        if (to && planDate > to) return;
        if (String(plan.userId || '') !== uid) return;

        (Array.isArray(plan.plans) ? plan.plans : []).forEach((task, idx) => {
            if (!task || task.isRemoved === true) return;
            // Private tasks are visible only to the plan owner or the assignee.
            if (!isTaskVisibleToViewer(task, String(plan.userId || ''), String(viewerId || ''))) return;
            let status = normalizeTaskStatus(task, planDate, window.AppCalendar?.getSmartTaskStatus);
            const rawTaskStatus = String(task.status || '').toLowerCase().trim();
            const isPostponedAlias = rawTaskStatus === 'postponed' || rawTaskStatus === 'not-completed' || rawTaskStatus === 'not completed';
            // A postponed copy that has arrived (due today or earlier) is a normal
            // task for that day, not a stale "postponed" item cluttering the widget.
            const isArrivedPostponedCopy = isPostponedAlias
                && (String(task.addedFrom || '').toLowerCase() === 'postponed' || !!task.postponedFromDate)
                && planDate <= getDashboardTodayIso();
            if (isArrivedPostponedCopy) {
                status = planDate === getDashboardTodayIso() ? 'in-process' : 'overdue';
            }
            // A task postponed to a future day belongs to that day — not today's widget.
            if (isPostponedAlias && task.postponedToDate && String(task.postponedToDate).trim() > getDashboardTodayIso()) {
                return;
            }
            if (!isActionablePlannedTaskStatus(status)) return;
            rows.push({
                date: planDate,
                userId: uid,
                planId: String(plan.id || ''),
                taskIndex: idx,
                task: String(task.task || task.description || 'Planned task'),
                status,
                planScope: String(task.planScope || plan.planScope || 'personal'),
                isPrivate: task.isPrivate === true,
                subPlans: Array.isArray(task.subPlans) ? task.subPlans : []
            });
        });
    });

    rows.sort((a, b) => {
        const ra = PLANNED_TASK_STATUS_RANK[a.status] ?? 99;
        const rb = PLANNED_TASK_STATUS_RANK[b.status] ?? 99;
        if (ra !== rb) return ra - rb;
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.taskIndex - b.taskIndex;
    });

    return rows;
};

const renderPlannedTaskItem = (row, index, viewerId, isAdmin) => {
    // Only the task owner or an admin can act on a task. The rows here are filtered to
    // the viewed staff member's own plans, so compare against the real signed-in user.
    const canManage = !!row.planId && Number.isInteger(row.taskIndex)
        && (String(viewerId || '') === String(row.userId || '') || isAdmin);
    const canPostpone = canManage;
    const canComplete = canManage;
    const stepCount = Array.isArray(row.subPlans) ? row.subPlans.length : 0;

    return `
        <div class="dashboard-planned-task-item ${safeHtml(String(row.status || '').toLowerCase().replace(/\s+/g, '-'))}" tabindex="0" role="button" aria-label="Toggle actions for ${safeHtml(row.task)}">
            <div class="dashboard-planned-task-main">
                <div class="dashboard-planned-task-title">${index + 1}. ${safeHtml(row.task)}</div>
                <div class="dashboard-planned-task-meta">
                    ${renderTaskStatusBadge(row.status)}
                    ${row.isPrivate ? `<span class="dashboard-planned-task-chip dashboard-planned-task-chip-private" title="Private — only you can see this task"><i class="fa-solid fa-lock"></i> Private</span>` : ''}
                    <span class="dashboard-planned-task-chip">${safeHtml(row.date)}</span>
                    <span class="dashboard-planned-task-chip">${safeHtml(row.planScope)}</span>
                    ${stepCount ? `<span class="dashboard-planned-task-chip">${stepCount} step${stepCount === 1 ? '' : 's'}</span>` : ''}
                </div>
            </div>
            <div class="dashboard-planned-task-actions">
                <button type="button" class="dashboard-planned-task-btn edit" data-ts-action="edit-task" data-date="${escapeJsSingleQuote(row.date)}" data-user-id="${escapeJsSingleQuote(row.userId)}">
                    <i class="fa-solid fa-pen-to-square"></i><span>Edit</span>
                </button>
                ${canPostpone ? `<button type="button" class="dashboard-planned-task-btn postpone" data-ts-action="postpone-task" data-plan-id="${escapeJsSingleQuote(row.planId)}" data-task-index="${row.taskIndex}" data-plan-scope="${safeHtml(row.planScope)}" data-user-id="${escapeJsSingleQuote(row.userId)}" data-date="${escapeJsSingleQuote(row.date)}">
                    <i class="fa-solid fa-clock"></i><span>Postpone</span>
                </button>` : ''}
                ${canComplete ? `<button type="button" class="dashboard-planned-task-btn complete" data-ts-action="complete-task" data-plan-id="${escapeJsSingleQuote(row.planId)}" data-task-index="${row.taskIndex}" data-user-id="${escapeJsSingleQuote(row.userId)}">
                    <i class="fa-solid fa-check"></i><span>Complete</span>
                </button>` : ''}
            </div>
        </div>
    `;
};

let plannedTaskInteractionsBound = false;
const ensurePlannedTaskInteractions = () => {
    if (plannedTaskInteractionsBound || typeof document === 'undefined') return;
    plannedTaskInteractionsBound = true;

    const closeAll = (exceptEl = null) => {
        document.querySelectorAll('.dashboard-planned-task-item.is-action-open').forEach((el) => {
            if (el !== exceptEl) el.classList.remove('is-action-open');
        });
    };

    if (!window._dashboardActionRegistered) {
        window._dashboardActionRegistered = true;
        onAction('edit-task', (el) => window.app_editDashboardActivity?.('plan', '', el.dataset.date || '', el.dataset.userId || '', ''));
        onAction('postpone-task', (el) => window.app_openPostponeModal?.(el.dataset.planId, Number(el.dataset.taskIndex)));
        onAction('complete-task', (el) => window.app_teamActivitiesCompleteTask?.(el));
        onAction('refresh-hero', (el, e) => window.app_forceRefreshHero?.(e));
        onAction('close-modal', (el) => {
            const id = el.dataset.modalId;
            if (id) document.getElementById(id)?.remove();
        });
        onAction('confirm-postpone', (el) => window.app_confirmHeroPostponeTask?.(el.dataset.planId || '', Number(el.dataset.taskIndex), el.dataset.userId || '', el.dataset.bucketKey || ''));
        onAction('undo-leave', (el) => {
            const id = el.dataset.leaveId || '';
            if (id) window.app_undoLeaveDecision?.(id);
        });
        onAction('close-maximize', () => window.app_closeDashboardCardMaximize?.());
    }

    document.addEventListener('click', (event) => {
        if (event.target?.closest?.('.dashboard-planned-task-btn')) return;
        const item = event.target?.closest?.('.dashboard-planned-task-item');
        if (!item) { closeAll(); return; }
        item.classList.toggle('is-action-open');
        if (item.classList.contains('is-action-open')) closeAll(item);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { closeAll(); return; }
        const item = event.target?.closest?.('.dashboard-planned-task-item');
        if (!item) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            item.classList.toggle('is-action-open');
            if (item.classList.contains('is-action-open')) closeAll(item);
        }
    });
};

export function renderPlannedTasksCard(workPlans, targetStaff = null, options = {}) {
    ensurePlannedTaskInteractions();
    const currentUser = window.AppAuth?.getUser?.() || null;
    const today = getDashboardTodayIso();
    const fromKey = String(options.from || today).trim() || today;
    const toKey = String(options.to || today).trim() || today;
    const targetUserId = String(options.targetStaffId || targetStaff?.id || currentUser?.id || '').trim();
    const targetStaffName = String(options.targetStaffName || targetStaff?.name || currentUser?.name || 'Staff');
    const title = String(options.title || "Today's Planned Tasks").trim();
    const emptyMessage = String(options.emptyMessage || 'No planned tasks found.').trim();
    const rows = getPlannedTaskRows(workPlans, targetUserId, fromKey, toKey, currentUser?.id || '');
    const isAdmin = !!(currentUser && window.app_hasPerm?.('dashboard', 'admin', currentUser));
    const viewerId = String(currentUser?.id || '');
    const cardClass = String(options.cardClass || 'dashboard-worklog-card').trim() || 'dashboard-worklog-card';
    const listClass = String(options.listClass || 'dashboard-planned-task-list').trim() || 'dashboard-planned-task-list';

    return `
        <div class="card ${cardClass}">
            <div class="dashboard-worklog-head dashboard-planned-task-head">
                <div class="dashboard-planned-task-head-copy">
                    <h4>${safeHtml(title)} <span class="dashboard-worklog-staff">(${safeHtml(targetStaffName)})</span></h4>
                </div>
            </div>
            <div class="${safeHtml(listClass)}">
                ${rows.length
                    ? rows.map((row, i) => renderPlannedTaskItem(row, i, viewerId, isAdmin)).join('')
                    : `<div class="dashboard-activity-empty">${safeHtml(emptyMessage)}</div>`}
            </div>
        </div>
    `;
}

const getDashboardCardTitle = (cardEl) => {
    if (cardEl.classList.contains('dashboard-hero-stats-card')) return 'Hero of the Week';
    const heading = cardEl.querySelector('.dashboard-card-title, .dashboard-stats-card-title, .dashboard-worklog-head h4, .dashboard-team-activity-head h4, .dashboard-staff-directory-head h4, .dashboard-tagged-head h4, .dashboard-leave-requests-head h4, .dashboard-leave-history-head h4, h3, h4');
    const text = String(heading?.textContent || '').trim();
    return text || 'Dashboard Card';
};

const getDashboardCardId = (cardEl, index) => {
    if (cardEl.classList.contains('dashboard-hero-stats-card')) return 'hero-week';
    if (cardEl.classList.contains('dashboard-checkin-card')) return 'checkin';
    if (cardEl.classList.contains('dashboard-worklog-card')) return 'worklog';
    if (cardEl.classList.contains('dashboard-team-activity-card')) return 'team-activity';
    if (cardEl.classList.contains('dashboard-team-schedule-card')) return 'team-schedule';
    if (cardEl.classList.contains('dashboard-staff-directory-card')) return 'staff-directory';
    if (cardEl.classList.contains('dashboard-leave-requests-card')) return 'leave-requests';
    if (cardEl.classList.contains('dashboard-leave-history-card')) return 'leave-history';
    if (cardEl.classList.contains('dashboard-tagged-card')) return 'missed-checkout';
    if (cardEl.classList.contains('dashboard-stats-card')) {
        return `stats-${cardEl.getAttribute('data-stats-type') || index}`;
    }
    return `dashboard-card-${index}`;
};

const buildExpandedCardTemplate = (cardEl) => {
    let html = cardEl.innerHTML || '';
    html = html
        .replace(/<div[^>]*class="[^"]*dashboard-card-mode-controls[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<button[^>]*class="[^"]*dashboard-card-max-btn[^"]*"[^>]*>[\s\S]*?<\/button>/gi, '')
        .replace(/<button[^>]*class="[^"]*dashboard-expand-inline-btn[^"]*"[^>]*>[\s\S]*?<\/button>/gi, '');
    if (cardEl.classList.contains('dashboard-worklog-card')) {
        html = html
            .replace(/id="act-start"/g, 'id="act-start-max"')
            .replace(/id="act-end"/g, 'id="act-end-max"')
            .replace(/id="activity-list"/g, 'id="activity-list-max"')
            .replace(/id="dashboard-worklog-load-more"/g, 'id="dashboard-worklog-load-more-max"')
            .replace(/window\.app_filterActivity\(\)/g, "window.app_filterActivity?.('act-start-max','act-end-max','activity-list-max')")
            .replace(/window\.app_loadMoreActivity\?\.\('activity-list'\)/g, "window.app_loadMoreActivity?.('activity-list-max')")
            .replace(/window\.app_loadMoreActivity\('activity-list'\)/g, "window.app_loadMoreActivity?.('activity-list-max')");
    }
    if (cardEl.classList.contains('dashboard-team-activity-card')) {
        html = html
            .replace(/id="staff-activity-list"/g, 'id="staff-activity-list-max"')
            .replace(/id="staff-activity-range-label"/g, 'id="staff-activity-range-label-max"')
            .replace(/window\.app_setStaffActivityMonth\(this\.value\)/g, "window.app_setStaffActivityMonth(this.value, 'staff-activity-list-max', 'staff-activity-range-label-max')")
            .replace(/window\.app_setStaffActivitySort\(this\.value\)/g, "window.app_setStaffActivitySort(this.value, 'staff-activity-list-max', 'staff-activity-range-label-max')");
    }
    if (cardEl.classList.contains('dashboard-stats-card')) {
        const statType = String(cardEl.getAttribute('data-stats-type') || '').trim();
        if (statType) {
            html += renderStatsDetailInline(statType);
        }
    }
    if (cardEl.classList.contains('dashboard-hero-stats-card')) {
        html += renderHeroLeaderboardExpanded(window.app_dashboardHeroLeaderboard, window.app_dashboardHeroData);
    }
    if (cardEl.classList.contains('dashboard-perf-card')) {
        html += '<div id="perf-team-expanded"><div style="text-align:center;padding:2rem;color:#94a3b8;">Loading team performance...</div></div>';
    }
    return html;
};

const buildOriginalCardTemplate = (cardEl) => {
    let html = cardEl.innerHTML || '';
    html = html
        .replace(/<div[^>]*class="[^"]*dashboard-card-mode-controls[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<button[^>]*class="[^"]*dashboard-card-max-btn[^"]*"[^>]*>[\s\S]*?<\/button>/gi, '');
    return html;
};

function normalizeHeroDisplayBundle(heroData, leaderboardData) {
    const rows = Array.isArray(leaderboardData?.rows) ? leaderboardData.rows : [];
    if (!rows.length) return { heroData, leaderboardData };

    const declaredWinnerId = String(leaderboardData?.winnerUserId || '').trim();
    const currentHeroId = String(heroData?.user?.id || '').trim();
    const declaredWinner = declaredWinnerId
        ? rows.find((row) => String(row?.user?.id || '') === declaredWinnerId)
        : null;
    const currentHeroWinner = currentHeroId
        ? rows.find((row) => String(row?.user?.id || '') === currentHeroId)
        : null;
    const rankOneWinner = rows.find((row) => Number(row?.rank) === 1) || rows[0];
    const winnerEntry = declaredWinner || currentHeroWinner || rankOneWinner;
    const winnerId = String(winnerEntry?.user?.id || '').trim();
    if (!winnerId) return { heroData, leaderboardData };

    const normalizedHeroData = {
        ...(heroData || {}),
        state: 'winner',
        user: {
            ...(heroData?.user || {}),
            ...(winnerEntry.user || {})
        },
        stats: {
            ...(heroData?.stats || {}),
            ...(winnerEntry.stats || {})
        }
    };

    const normalizedLeaderboardData = leaderboardData
        ? { ...leaderboardData, winnerUserId: winnerId }
        : leaderboardData;

    return {
        heroData: normalizedHeroData,
        leaderboardData: normalizedLeaderboardData
    };
}

function setDashboardHeroBundle(heroData, leaderboardData, heroMeta = window.app_dashboardHeroMeta || {}) {
    const normalized = normalizeHeroDisplayBundle(heroData, leaderboardData);
    window.app_dashboardHeroData = normalized.heroData;
    window.app_dashboardHeroLeaderboard = normalized.leaderboardData;
    window.app_dashboardHeroMeta = heroMeta;
    return normalized;
}
const renderHeroExpandedAuditMarkup = () => {
    return `${renderHeroCard(window.app_dashboardHeroData, window.app_dashboardHeroMeta || {})}${renderHeroLeaderboardExpanded(window.app_dashboardHeroLeaderboard, window.app_dashboardHeroData)}`;
};

const updateHeroExpandedOverlay = () => {
    if (window._dashboardMaxCardId !== 'hero-week') return;
    const body = document.getElementById(DASHBOARD_MAX_BODY_ID);
    if (!body) return;
    body.innerHTML = `<div class="dashboard-max-card-content">${renderHeroExpandedAuditMarkup()}</div>`;
};
window.app_updateHeroExpandedOverlay = updateHeroExpandedOverlay;

window.app_updatePerfExpandedOverlay = () => {
    console.log('[Perf] Expanded overlay hook fired');
    renderTeamPerformanceExpanded().catch(e => console.error('[Perf] Expanded render failed:', e));
};

const createDashboardModeButton = (cardId, title, mode) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dashboard-card-mode-btn dashboard-card-mode-btn-${mode}`;
    btn.setAttribute('data-mode', mode);
    btn.setAttribute('aria-label', `${mode === DASHBOARD_CARD_MODE_ORIGINAL ? 'Show original size' : 'Show fullscreen'} ${title}`);
    btn.innerHTML = mode === DASHBOARD_CARD_MODE_ORIGINAL
        ? '<i class="fa-solid fa-up-right-and-down-left-from-center"></i>'
        : '<i class="fa-solid fa-expand"></i>';
    btn.addEventListener('click', () => window.app_toggleDashboardCardMode?.(cardId, mode, btn));
    return btn;
};

const ensureDashboardCardControls = (card, cardId, title) => {
    let controls = card.querySelector('.dashboard-card-mode-controls');
    if (!controls) {
        controls = document.createElement('div');
        controls.className = 'dashboard-card-mode-controls';
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', `${title} view controls`);
        controls.appendChild(createDashboardModeButton(cardId, title, DASHBOARD_CARD_MODE_FULLSCREEN));
        card.appendChild(controls);
    } else {
        controls.innerHTML = '';
        controls.appendChild(createDashboardModeButton(cardId, title, DASHBOARD_CARD_MODE_FULLSCREEN));
    }
};

const initDashboardCardControls = () => {
    const root = document.querySelector('.dashboard-staff-view');
    if (!root) return;
    const cards = root.querySelectorAll('.card');
    const templates = {};

    Array.from(cards).forEach((card, index) => {
        if (DASHBOARD_CARD_CONTROL_EXCLUDED_CLASSES.some((cls) => card.classList.contains(cls))) {
            card.classList.remove('dashboard-card-compact', 'dashboard-card-mode-tile', 'dashboard-card-mode-original', 'dashboard-card-has-controls');
            card.dataset.dashboardCardId = '';
            card.dataset.dashboardCardMode = '';
            const orphanControls = card.querySelector('.dashboard-card-mode-controls');
            if (orphanControls) orphanControls.remove();
            return;
        }
        const cardId = getDashboardCardId(card, index);
        const title = getDashboardCardTitle(card);

        card.classList.add('dashboard-card-compact', 'dashboard-card-mode-tile');
        card.classList.remove('dashboard-card-mode-original');
        card.dataset.dashboardOriginalFullWidth = card.classList.contains('full-width') ? '1' : '0';
        card.classList.remove('full-width');
        card.dataset.dashboardCardId = cardId;
        card.dataset.dashboardCardMode = DASHBOARD_CARD_MODE_TILE;

        ensureDashboardCardControls(card, cardId, title);

        templates[cardId] = {
            title,
            tileHtml: card.innerHTML,
            originalHtml: buildOriginalCardTemplate(card),
            expandedHtml: buildExpandedCardTemplate(card)
        };
    });

    window._dashboardCardTemplates = templates;
    window._dashboardCardModeState = {};
};

// --- Local State for Dashboard ---

const teamActivityAutoScroll = {
    controllers: new WeakMap(),
    elements: new Set()
};
const worklogAutoScroll = {
    controllers: new WeakMap(),
    elements: new Set()
};

function getStaffActivityState() {
    if (!window.app_staffActivityState) {
        window.app_staffActivityState = {
            selectedMonth: new Date().toISOString().slice(0, 7),
            sortKey: 'date-desc',
            logs: [],
            leaveHistoryDate: new Date().toISOString().slice(0, 10)
        };
    }
    if (!window.app_staffActivityState.leaveHistoryDate) {
        window.app_staffActivityState.leaveHistoryDate = new Date().toISOString().slice(0, 10);
    }
    return window.app_staffActivityState;
}

function getWeekRange(dateStr) {
    const base = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
    if (Number.isNaN(base.getTime())) {
        return getWeekRange(new Date().toISOString().slice(0, 10));
    }
    const day = base.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const start = new Date(base);
    start.setDate(base.getDate() + diffToMonday);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const fmt = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dayNum = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dayNum}`;
    };
    return {
        start,
        end,
        startKey: fmt(start),
        endKey: fmt(end),
        label: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    };
}

function isCurrentWeekMissedTaskStatus(statusValue = '') {
    return ['overdue', 'missed', 'not-completed'].includes(String(statusValue || '').toLowerCase().trim());
}
function getCurrentWeekOverdueWorkLogs(logs, targetStaffId, weekRange) {
    const startKey = String(weekRange?.startKey || '');
    const endKey = String(weekRange?.endKey || '');
    const selectedStaffId = String(targetStaffId || '');
    const todayKey = new Date().toISOString().slice(0, 10);
    const isOpenTask = (statusValue = '') => !['completed', 'not-completed', 'cancelled', 'canceled', 'removed'].includes(String(statusValue || '').toLowerCase());
    const isVisibleMissedStatus = (statusValue = '') => {
        const normalized = String(statusValue || '').toLowerCase();
        return ['overdue', 'missed', 'postponed', 'in-process', 'in process', 'pending', 'to-be-started', 'to be started', 'not-completed'].includes(normalized);
    };
    const flattened = [];
    (Array.isArray(logs) ? logs : []).forEach((entry) => {
        if (!entry) return;
        if (Array.isArray(entry.plans)) {
            const userId = String(entry.userId || entry.user_id || '');
            entry.plans.forEach((plan, index) => {
                if (!plan) return;
                const dateKey = String(entry.date || '');
                const rawStatus = String(plan.status || '').toLowerCase();
                const smartStatus = normalizeTaskStatus(plan, dateKey, window.AppCalendar?.getSmartTaskStatus);
                const isPastDue = dateKey && dateKey < todayKey;
                const status = rawStatus === 'postponed'
                    ? 'postponed'
                    : (smartStatus === 'overdue' || (isPastDue && isOpenTask(rawStatus)))
                        ? 'overdue'
                        : smartStatus;
                if (!isVisibleMissedStatus(status)) return;
                flattened.push({
                    userId,
                    date: dateKey,
                    status,
                    description: String(plan.task || 'Overdue work'),
                    sourceTime: String(plan.checkOut || plan._sortTime || ''),
                    planScope: String(plan.planScope || entry.planScope || 'personal'),
                    planId: String(entry.id || ''),
                    taskIndex: Number.isFinite(Number(index)) ? index : 0
                });
            });
            return;
        }
        flattened.push({
            userId: String(entry.userId || entry.user_id || ''),
            date: String(entry.date || ''),
            status: String(entry.status || '').toLowerCase(),
            description: String(entry.description || entry.workDescription || entry.task || 'Overdue work'),
            sourceTime: String(entry.sourceTime || entry.checkOut || ''),
            planScope: String(entry.planScope || 'personal'),
            planId: String(entry.planId || entry.id || ''),
            taskIndex: Number.isFinite(Number(entry.taskIndex)) ? Number(entry.taskIndex) : 0
        });
    });

    return flattened
        .filter((log) => {
            if (!log) return false;
            if (selectedStaffId && String(log.userId || log.user_id || '') !== selectedStaffId) return false;
            const dateKey = String(log.date || '');
            if (startKey && dateKey < startKey) return false;
            if (endKey && dateKey > endKey) return false;
            return isCurrentWeekMissedTaskStatus(log.status);
        })
        .sort((a, b) => {
            const dateDiff = String(b.date || '').localeCompare(String(a.date || ''));
            if (dateDiff !== 0) return dateDiff;
            return String(a.description || '').localeCompare(String(b.description || ''));
        });
}

function getCurrentWeekOverdueTaskRows(activityRows, targetStaffId, weekRange) {
    const sourceRows = Array.isArray(window.app_teamActivitiesOverdueRows) && window.app_teamActivitiesOverdueRows.length
        ? window.app_teamActivitiesOverdueRows
        : (Array.isArray(activityRows) ? activityRows : []);
    return getCurrentWeekOverdueWorkLogs(sourceRows, targetStaffId, weekRange);
}

function renderCurrentWeekOverdueTaskStrip(overdueLogs) {
    const count = Array.isArray(overdueLogs) ? overdueLogs.length : 0;
    const preview = (Array.isArray(overdueLogs) ? overdueLogs : [])
        .slice(0, 3)
        .map((row) => `${String(row.staffName || 'Staff')}: ${String(row.description || 'Overdue task')}`)
        .join(' • ');
    const tooltip = count
        ? `${count} missed task${count === 1 ? '' : 's'}${preview ? ` • ${preview}` : ''}`
        : 'No missed tasks';
    return `
        <button type="button" class="dashboard-missed-strip hero-missed-alert" aria-label="Missed tasks count" title="${safeHtml(tooltip)}" onclick="window.app_openTeamActivities?.()">
            <div class="dashboard-missed-strip-title">Missed Tasks</div>
            <div class="dashboard-missed-strip-count">${count}</div>
        </button>
    `;
}

function renderCurrentWeekOverdueWorksModalContent(context = {}) {
    const logs = Array.isArray(context.logs) ? context.logs : [];
    const targetStaff = context.targetStaff || {};
    const weekRange = context.weekRange || {};
    const staffName = targetStaff?.name || 'Staff';
    const label = weekRange?.label || 'Current week';

    const rows = logs.map((log, index) => `
        <div class="hero-task-item">
            <div class="hero-task-item-main">
                <div class="hero-task-item-title">${index + 1}. ${safeHtml(log.description || 'Overdue work')}</div>
                <div class="hero-task-item-subplans">${safeHtml(log.type || 'work')} • ${safeHtml(log.date || '--')}${log.sourceTime ? ` • ${safeHtml(log.sourceTime)}` : ''}</div>
                <div class="hero-task-item-meta">
                    ${renderTaskStatusBadge(log.status)}
                    ${log.planScope ? `<span class="hero-task-item-chip">${safeHtml(log.planScope)}</span>` : ''}
                </div>
            </div>
            <div class="hero-task-item-actions">
                ${log.date ? `<button type="button" class="action-btn secondary" onclick="window.app_openDayPlan?.('${escapeJsSingleQuote(String(log.date || ''))}','${escapeJsSingleQuote(String(targetStaff?.id || ''))}')">Open Day Plan</button>` : ''}
            </div>
        </div>
    `).join('');

    return `
        <div class="hero-task-modal-head">
            <div>
                <h3>Works Overdue</h3>
                <p>${safeHtml(staffName)} • ${safeHtml(label)}</p>
            </div>
            <button type="button" class="dashboard-max-close" onclick="window.app_closeCurrentWeekOverdueWorksModal?.()" aria-label="Close overdue works">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="hero-task-modal-body">
            ${rows || '<div class="dashboard-activity-empty">No overdue work found for this week.</div>'}
        </div>
    `;
}

window.app_openCurrentWeekOverdueWorksModal = function () {
    const context = window.app_currentWeekOverdueWorkContext || {};
    const modalId = 'current-week-overdue-modal';
    document.getElementById(modalId)?.remove();
    if (!Array.isArray(context.logs) || context.logs.length === 0) return;

    const html = `
        <div class="modal-overlay" id="${modalId}" style="display:flex;">
            <div class="modal-content hero-task-modal-shell" style="max-width:760px;">
                ${renderCurrentWeekOverdueWorksModalContent(context)}
            </div>
        </div>
    `;
    if (typeof window.app_showModal === 'function') {
        window.app_showModal(html, modalId);
        return;
    }
    (document.getElementById('modal-container') || document.body).insertAdjacentHTML('beforeend', html);
};

window.app_closeCurrentWeekOverdueWorksModal = function () {
    document.getElementById('current-week-overdue-modal')?.remove();
};

let dashboardActionDelegatesBound = false;

function ensureDashboardActionDelegates() {
    if (dashboardActionDelegatesBound || typeof document === 'undefined') return;
    dashboardActionDelegatesBound = true;

    document.addEventListener('click', async (event) => {
        const btn = event.target && event.target.closest
            ? event.target.closest('.dashboard-leave-btn[data-action][data-leave-id]')
            : null;
        if (!btn) return;

        event.preventDefault();
        const action = String(btn.dataset.action || '');
        const leaveId = String(btn.dataset.leaveId || '');
        if (!leaveId) return;

        try {
            if (action === 'export') {
                if (typeof window.app_exportLeaveRequestPdf === 'function') {
                    await window.app_exportLeaveRequestPdf(leaveId);
                }
                return;
            }
            if (action === 'comment') {
                if (typeof window.app_addLeaveComment === 'function') {
                    await window.app_addLeaveComment(leaveId);
                }
                return;
            }
            if (action === 'approve' || action === 'reject') {
                if (action === 'approve' && typeof window.app_approveLeave === 'function') {
                    await window.app_approveLeave(leaveId);
                } else if (action === 'reject' && typeof window.app_rejectLeave === 'function') {
                    await window.app_rejectLeave(leaveId);
                }
            }
        } catch (err) {
            console.error('Dashboard leave action failed:', err);
        }
    });
}

// --- Dashboard Components ---

export function renderHeroCard(heroData, heroMeta = {}) {
    const heroState = heroData?.state || (heroData?.user ? 'winner' : 'no_eligible_data');
    const currentUser = window.AppAuth?.getUser();
    const isFullAdmin = currentUser && window.app_hasPerm?.('dashboard', 'admin', currentUser);
    let refreshButtonHTML = '';
    if (isFullAdmin) {
        const refreshCount = Number(heroMeta?.heroRefreshCount || 0);
        const maxRefreshes = AppConfig?.DASHBOARD?.MAX_REFRESHES || 3;
        if (refreshCount >= maxRefreshes) {
            refreshButtonHTML = `
                <button class="hero-refresh-btn" disabled title="Max daily refreshes (${maxRefreshes}) reached">
                    <i class="fa-solid fa-arrows-rotate"></i>
                </button>`;
        } else {
            const remaining = maxRefreshes - refreshCount;
            refreshButtonHTML = `
                <button class="hero-refresh-btn" data-ts-action="refresh-hero" title="Recalculate and refresh hero (${remaining} refresh${remaining === 1 ? '' : 'es'} remaining today)">
                    <i class="fa-solid fa-arrows-rotate"></i>
                </button>`;
        }
    }

    if (!heroData || heroState !== 'winner') {
        const emptyReason = heroData?.reason || (heroState === 'fetch_error'
            ? 'Hero stats are temporarily unavailable.'
            : 'No eligible hero data available.');
        const chipText = heroState === 'fetch_error' ? 'Fetch Error' : 'No Eligible Data';
        return `
            <div class="card dashboard-hero-stats-card hero-slot">
                <div class="dashboard-hero-stats-head">
                    <div class="hero-label-badge">Hero of the Week</div>
                    <div class="dashboard-hero-stats-head-right">
                        ${heroMeta.generatedAt ? `<span class="hero-sync-time" title="Source: ${heroMeta.source || heroData?.source || 'unknown'}">Synced ${timeAgo(heroMeta.generatedAt)}</span>` : ''}
                        ${refreshButtonHTML}
                    </div>
                </div>
                <div class="dashboard-activity-empty">
                    ${safeHtml(emptyReason)}
                </div>
                <div class="dashboard-hero-stats-foot">
                    <span class="dashboard-kpi-tag">${chipText}</span>
                </div>
            </div>`;
    }

    const { user, stats } = heroData;
    const taskPlanned = Number(stats?.taskPlanned ?? 0);
    const taskCompleted = Number(stats?.taskCompleted ?? 0);
    const taskInProgress = Number(stats?.taskInProgress ?? 0);
    const taskMissed = Number(stats?.taskMissed ?? 0);
    const taskPostponed = Number(stats?.taskPostponed ?? 0);
    const attendanceDays = Number(stats?.days ?? 0);
    const attendanceHours = Number(stats?.hours ?? 0);
    const attendanceFactor = Number(stats?.attendanceFactor ?? 1);
    const isNew = heroMeta.source === 'generated';
    const confidencePct = Number.isFinite(Number(heroData?.confidence))
        ? Math.round(Number(heroData.confidence) * 100)
        : 0;
    const periodLabel = heroData?.period === 'yesterday_back_7_days'
        ? 'Last 7 Completed Days'
        : 'Weekly';
    const usedFallbackWindow = !!(heroData?.meta?.usedFallbackWindow);
    const heroWindowDays = Math.max(7, Number(heroData?.meta?.windowDays || 0));
    const fallbackBadgeHTML = usedFallbackWindow
        ? `<span class="dashboard-kpi-tag hero-fallback-badge" title="No staff met the minimum hero criteria in the standard window, so the ranking was automatically widened to ${heroWindowDays} days.">Extended window</span>`
        : '';

    return `
        <div class="card dashboard-hero-stats-card hero-slot ${isNew ? 'is-new-summary' : ''}">
            <div class="dashboard-hero-stats-head">
                <div class="hero-label-badge">Hero of the Week</div>
                <div class="dashboard-hero-stats-head-right">
                    ${heroMeta.generatedAt ? `<span class="hero-sync-time" title="Source: ${heroMeta.source || heroData?.source || 'unknown'}">Synced ${timeAgo(heroMeta.generatedAt)}</span>` : ''}
                    ${refreshButtonHTML}
                </div>
            </div>
            <div class="dashboard-hero-stats-body">
                <div class="hero-profile">
                    <img src="${safeUrl(user.avatar)}" alt="${safeHtml(user.name)}" class="hero-avatar">
                    <div class="hero-info">
                        <div class="hero-name">${safeHtml(user.name)}</div>
                        <div class="hero-role">${safeHtml(user.role || 'Staff')}</div>
                    </div>
                </div>
                <div class="hero-metrics">
                    <div class="hero-metric">
                        <div class="hero-metric-value">${taskPlanned}</div>
                        <div class="hero-metric-label">Planned</div>
                    </div>
                    <div class="hero-metric">
                        <div class="hero-metric-value">${taskCompleted}</div>
                        <div class="hero-metric-label">Completed</div>
                    </div>
                    <div class="hero-metric">
                        <div class="hero-metric-value">${taskInProgress}</div>
                        <div class="hero-metric-label">In Progress</div>
                    </div>
                    <div class="hero-metric">
                        <div class="hero-metric-value">${taskPostponed}</div>
                        <div class="hero-metric-label">Postponed</div>
                    </div>
                    <div class="hero-metric">
                        <div class="hero-metric-value">${taskMissed}</div>
                        <div class="hero-metric-label">Missed</div>
                    </div>
                </div>
                <div class="hero-attendance-modifier-row">
                    <span class="hero-attendance-pill">Days <strong>${attendanceDays}</strong></span>
                    <span class="hero-attendance-pill">Hours <strong>${attendanceHours}h</strong></span>
                    <span class="hero-attendance-pill">Factor <strong>x${attendanceFactor.toFixed(2)}</strong></span>
                </div>
            </div>
            <div class="dashboard-hero-stats-foot">
                <span class="dashboard-kpi-tag">${safeHtml(periodLabel)}</span>
                <span class="dashboard-kpi-tag">Confidence ${confidencePct}%</span>
                ${fallbackBadgeHTML}
                <span class="hero-version-badge" title="Hero Calculation Algorithm Version">v5</span>
            </div>
        </div>`;
}

export function renderWorkLog(workPlans, _collabs = [], targetStaff = null, _minutes = [], options = {}) {
    return renderPlannedTasksCard(workPlans, targetStaff, {
        title: options.title || "Today's Planned Tasks",
        from: options.from || getDashboardTodayIso(),
        to: options.to || getDashboardTodayIso(),
        emptyMessage: options.emptyMessage || 'No planned tasks for today.',
        cardClass: options.cardClass || 'dashboard-worklog-card',
        listClass: options.listClass || 'dashboard-planned-task-list'
    });
}

export function renderActivityList(allLogs, startStr, endStr, targetStaffId, collabs = [], minutes = [], options = {}) {
    const pageSize = Math.max(1, Number(options.pageSize) || WORKLOG_PAGE_SIZE);
    const page = Math.max(1, Number(options.page) || 1);
    const listId = String(options.listId || 'activity-list');
    const visibleLimit = page * pageSize;
    const start = new Date(startStr);
    const end = new Date(endStr);
    end.setHours(23, 59, 59, 999);

    const logEntries = allLogs.filter(l => {
        const d = new Date(l.date);
        const desc = l.workDescription || (l.location && !l.location.startsWith('Lat:') ? l.location : 'Standard Activity');
        l._displayDesc = desc;
        l._isCollab = false;
        l._sortTime = l.checkOut || '00:00';
        return d >= start && d <= end;
    });

    const collabEntries = [];
    collabs.forEach(cp => {
        const cpDate = new Date(cp.date);
        if (cpDate < start || cpDate > end) return;
        const dailyCollabPlans = cp.plans.filter(p => p.tags && p.tags.some(t => t.id === targetStaffId && t.status === 'accepted'));
        dailyCollabPlans.forEach(p => {
            collabEntries.push({
                date: cp.date,
                workDescription: `[Collab] Collaborated with ${cp.userName}: ${p.task}${p.subPlans && p.subPlans.length > 0 ? ` (Sub-tasks: ${p.subPlans.join(', ')})` : ''}`,
                checkOut: 'Planned / Accepted',
                _displayDesc: `[Collab] Collaborated with ${cp.userName}: ${p.task}${p.subPlans && p.subPlans.length > 0 ? ` (Sub-tasks: ${p.subPlans.join(', ')})` : ''}`,
                _isCollab: true,
                _sortTime: '23:59'
            });
        });
    });

    const minuteEntries = [];
    minutes.forEach(m => {
        (m.actionItems || []).forEach(ai => {
            if (ai.assignedTo !== targetStaffId) return;
            const aiDate = ai.dueDate || m.date; // Use due date if available, else meeting date
            const d = new Date(aiDate);
            if (d < start || d > end) return;

            minuteEntries.push({
                date: aiDate,
                workDescription: `[Meeting] Task: ${ai.task} (from ${m.title})`,
                status: ai.status || 'pending',
                checkOut: 'Action Item',
                _displayDesc: `[Meeting] Task: ${ai.task} (from ${m.title})`,
                _isCollab: false,
                _isMinute: true,
                _meetingId: m.id,
                _sortTime: '09:00' // Show at start of day
            });
        });
    });

    const merged = [...logEntries, ...collabEntries, ...minuteEntries].sort((a, b) => {
        const dateDiff = new Date(b.date) - new Date(a.date);
        if (dateDiff !== 0) return dateDiff;
        return b._sortTime.localeCompare(a._sortTime);
    });

    if (merged.length === 0) return '<div class="dashboard-activity-empty">No activity descriptions found.</div>';

    const visibleRows = merged.slice(0, visibleLimit);
    let html = '';
    let lastDate = '';
    const currentUser = window.AppAuth.getUser();
    const isAdminUser = window.app_hasPerm('dashboard', 'admin', currentUser);
    const isSelfView = currentUser && String(targetStaffId || '') === String(currentUser.id || '');
    const canEditRows = !!(isAdminUser || isSelfView);

    markPerf(`dashboard:worklog:${listId}:start`);
    visibleRows.forEach(log => {
        const showDate = log.date !== lastDate;
        if (showDate) {
            html += `<div class="dashboard-activity-date">${log.date}</div>`;
            lastDate = log.date;
        }
        const _borderColor = log._isCollab ? '#10b981' : (log._isMinute ? '#6366f1' : '#e5e7eb');
        const collabClass = log._isCollab ? 'dashboard-activity-item-collab' : (log._isMinute ? 'dashboard-activity-item-minute' : '');
        const progressMeta = renderProgressMeta(log);
        const editActionType = log._isMinute
            ? 'minute'
            : ((!log._isCollab && log.id && log.id !== 'active_now') ? 'attendance' : 'plan');
        const editButton = canEditRows
            ? `<div class="dashboard-activity-edit-wrap"><button onclick="window.app_editDashboardActivity('${escapeJsSingleQuote(editActionType)}','${escapeJsSingleQuote(log.id || '')}','${escapeJsSingleQuote(log.date || '')}','${escapeJsSingleQuote(targetStaffId || '')}','${escapeJsSingleQuote(log._meetingId || '')}')" class="dashboard-activity-edit-btn" title="Edit Activity"><i class="fa-solid fa-pen-to-square"></i></button></div>`
            : '';
        let statusBadge = '';
        if (log._isCollab || log.status || log._isMinute) {
            const status = window.AppCalendar ? window.AppCalendar.getSmartTaskStatus(log.date, log.status) : (log.status || 'to-be-started');
            statusBadge = `
                <div class="dashboard-activity-status-row">
                    ${renderTaskStatusBadge(status)}
                    ${editButton}
                </div>`;
        } else if (editButton) {
            statusBadge = `
                <div class="dashboard-activity-status-row">
                    <span></span>
                    ${editButton}
                </div>`;
        }
        const itemBorder = log._isCollab ? 'collab' : (log._isMinute ? 'minute' : 'default');
        html += `<div class="dashboard-activity-item ${collabClass}" data-activity-type="${itemBorder}"><div class="dashboard-activity-desc">${safeHtml(log._displayDesc)}</div>${progressMeta}${statusBadge}<div class="dashboard-activity-meta">${safeHtml(log.checkOut || (log.status === 'completed' ? 'Completed' : 'Planned Activity'))}</div></div>`;
    });
    const hasMore = visibleLimit < merged.length;
    if (hasMore) {
        html += `
            <div class="dashboard-worklog-footer">
                <button type="button" class="dashboard-worklog-load-more" id="dashboard-worklog-load-more" onclick="window.app_loadMoreActivity?.('${listId}')">
                    Load more ${Math.min(pageSize, merged.length - visibleLimit)} item${Math.min(pageSize, merged.length - visibleLimit) === 1 ? '' : 's'}
                </button>
            </div>
        `;
    }
    markPerf(`dashboard:worklog:${listId}:end`);
    measurePerf(`dashboard:worklog:${listId}`, `dashboard:worklog:${listId}:start`, `dashboard:worklog:${listId}:end`);
    return html;
}

function renderHeroLeaderboardExpanded(leaderboardData, heroData = null) {
    const rows = Array.isArray(leaderboardData?.rows) ? leaderboardData.rows : [];
    const meta = leaderboardData?.meta || {};
    const winnerId = String(leaderboardData?.winnerUserId || heroData?.user?.id || '');
    const periodLabel = meta.startDate && meta.endDate
        ? `${safeHtml(meta.startDate)} to ${safeHtml(meta.endDate)}`
        : 'Last 7 completed days';

    if (!rows.length) {
        return `
            <section class="hero-leaderboard-panel">
                <div class="hero-leaderboard-head">
                    <div>
                        <h4>Weekly Hero Audit</h4>
                        <p>Scored range: ${periodLabel}</p>
                    </div>
                </div>
                <div class="dashboard-activity-empty">No staff leaderboard data available for this week.</div>
            </section>
        `;
    }

    const renderMetricButton = (entry, bucketKey, value, label) => {
        const userId = String(entry?.user?.id || '');
        const count = Number(value || 0);
        if (!count || !userId) return `<span class="hero-leaderboard-count">${count}</span>`;
        return `<button type="button" class="hero-leaderboard-count-btn" onclick="window.app_openHeroTaskList('${safeHtml(userId)}','${safeHtml(bucketKey)}')">${count}<span class="sr-only">${safeHtml(label)}</span></button>`;
    };

    const rowsHtml = rows.map((entry) => {
        const user = entry?.user || {};
        const stats = entry?.stats || {};
        const userId = String(user.id || '');
        const isWinner = winnerId && userId === winnerId;
        const eligibilityClass = entry?.isEligible ? 'is-eligible' : 'is-ineligible';
        const eligibilityText = entry?.isEligible ? 'Eligible' : safeHtml(entry?.eligibilityReason || 'Not eligible');
        const rankLabel = Number.isFinite(Number(entry?.rank)) ? `#${Number(entry.rank)}` : 'NR';
        return `
            <tr class="hero-leaderboard-row ${isWinner ? 'is-winner' : ''}">
                <td class="hero-leaderboard-rank">${rankLabel}</td>
                <td class="hero-leaderboard-staff">
                    <div class="hero-leaderboard-staff-wrap">
                        <img src="${safeUrl(user.avatar)}" alt="${safeHtml(user.name || 'Staff')}" class="hero-leaderboard-avatar">
                        <div>
                            <div class="hero-leaderboard-name">${safeHtml(user.name || 'Unknown Staff')}</div>
                            <div class="hero-leaderboard-role">${safeHtml(user.role || 'Staff')}</div>
                        </div>
                    </div>
                </td>
                <td>${Number(stats.taskPlanned || 0)}</td>
                <td>${renderMetricButton(entry, 'completed', stats.taskCompleted, 'completed tasks')}</td>
                <td>${renderMetricButton(entry, 'in_progress', stats.taskInProgress, 'in progress tasks')}</td>
                <td>${renderMetricButton(entry, 'postponed', stats.taskPostponed, 'postponed tasks')}</td>
                <td>${renderMetricButton(entry, 'missed', stats.taskMissed, 'missed tasks')}</td>
                <td>${Number(stats.days || 0)}</td>
                <td>${Number(stats.hours || 0).toFixed(1)}h</td>
                <td>${Number(stats.completionRate || 0).toFixed(1)}%</td>
                <td>x${Number(stats.attendanceFactor || 1).toFixed(2)}</td>
                <td>${Number(stats.finalScore || 0).toFixed(2)}</td>
                <td><span class="hero-leaderboard-pill ${eligibilityClass}">${eligibilityText}</span></td>
            </tr>
        `;
    }).join('');

    return `
        <section class="hero-leaderboard-panel">
            <div class="hero-leaderboard-head">
                <div>
                    <h4>Weekly Hero Audit</h4>
                    <p>Scored range: ${periodLabel}</p>
                </div>
                <div class="hero-leaderboard-summary">
                    <span class="dashboard-kpi-tag">Staff ${rows.length}</span>
                    <span class="dashboard-kpi-tag">Winner ${safeHtml(heroData?.user?.name || rows.find((row) => String(row?.user?.id || '') === winnerId)?.user?.name || 'None')}</span>
                </div>
            </div>
            <div class="table-container hero-leaderboard-table-wrap">
                <table class="hero-leaderboard-table">
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Staff</th>
                            <th>Planned</th>
                            <th>Completed</th>
                            <th>In Progress</th>
                            <th>Postponed</th>
                            <th>Missed</th>
                            <th>Days</th>
                            <th>Hours</th>
                            <th>Completion</th>
                            <th>Factor</th>
                            <th>Score</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        </section>
    `;
}

function renderHeroTaskDetailsModalContent(userRow, bucketKey) {
    const currentUser = window.AppAuth?.getUser?.();
    const user = userRow?.user || {};
    const stats = userRow?.stats || {};
    const buckets = userRow?.taskBuckets || {};
    const tasks = Array.isArray(buckets?.[bucketKey]) ? buckets[bucketKey] : [];
    const canManageHeroTasks = currentUser && (
        String(currentUser.id || '') === String(user.id || '')
        || window.app_hasPerm?.('dashboard', 'admin', currentUser)
    );
    const titleMap = {
        completed: 'Completed Tasks',
        in_progress: 'In Progress Tasks',
        postponed: 'Postponed Tasks',
        missed: 'Missed Tasks'
    };
    const title = titleMap[bucketKey] || 'Tasks';
    const rowsHtml = tasks.map((task, index) => {
        const subPlans = Array.isArray(task.subPlans) && task.subPlans.length
            ? `<div class="hero-task-item-subplans">${safeHtml(task.subPlans.join(', '))}</div>`
            : '';
        const completedDate = task.completedDate ? `<span class="hero-task-item-chip">Completed ${safeHtml(task.completedDate)}</span>` : '';
        const rawStatus = task.rawStatus ? `<span class="hero-task-item-chip">Status ${safeHtml(task.rawStatus)}</span>` : '';
        const ownerPlanChip = (task.ownerId && String(task.ownerId) !== String(user.id || '') && task.ownerName)
            ? `<span class="hero-task-item-chip">From ${safeHtml(task.ownerName)}&rsquo;s plan</span>`
            : '';
        const safeUserId = escapeJsSingleQuote(String(user.id || ''));
        const safePlanId = escapeJsSingleQuote(String(task.planId || ''));
        const safeTaskDate = escapeJsSingleQuote(String(task.date || ''));
        const safeOwnerId = escapeJsSingleQuote(String(task.ownerId || user.id || ''));
        const safeBucketKey = escapeJsSingleQuote(String(bucketKey || ''));
        const actionButtons = !canManageHeroTasks
            ? ''
            : bucketKey === 'completed'
            ? `
                <button type="button" class="action-btn danger" onclick="window.app_deleteHeroTaskAction('${safePlanId}', ${Number(task.taskIndex)}, '${safeUserId}', '${safeBucketKey}')">Delete</button>
            `
            : bucketKey === 'missed'
                ? `
                    <button type="button" class="action-btn" onclick="window.app_completeHeroTaskAction('${safePlanId}', ${Number(task.taskIndex)}, '${safeUserId}', '${safeBucketKey}')">Complete</button>
                    <button type="button" class="action-btn secondary" onclick="window.app_postponeHeroTaskAction('${safePlanId}', ${Number(task.taskIndex)}, '${safeUserId}', '${safeBucketKey}')">Postpone</button>
                    <button type="button" class="action-btn danger" onclick="window.app_deleteHeroTaskAction('${safePlanId}', ${Number(task.taskIndex)}, '${safeUserId}', '${safeBucketKey}')">Delete</button>
                `
                : bucketKey === 'postponed'
                    ? `
                        <button type="button" class="action-btn" onclick="window.app_completeHeroTaskAction('${safePlanId}', ${Number(task.taskIndex)}, '${safeUserId}', '${safeBucketKey}')">Complete</button>
                        <button type="button" class="action-btn secondary" onclick="window.app_postponeHeroTaskAction('${safePlanId}', ${Number(task.taskIndex)}, '${safeUserId}', '${safeBucketKey}')">Postpone Again</button>
                        <button type="button" class="action-btn danger" onclick="window.app_deleteHeroTaskAction('${safePlanId}', ${Number(task.taskIndex)}, '${safeUserId}', '${safeBucketKey}')">Delete</button>
                    `
                    : `
                        <button type="button" class="action-btn" onclick="window.app_completeHeroTaskAction('${safePlanId}', ${Number(task.taskIndex)}, '${safeUserId}', '${safeBucketKey}')">Complete</button>
                        <button type="button" class="action-btn danger" onclick="window.app_deleteHeroTaskAction('${safePlanId}', ${Number(task.taskIndex)}, '${safeUserId}', '${safeBucketKey}')">Delete</button>
                    `;

        return `
            <div class="hero-task-item">
                <div class="hero-task-item-main">
                    <div class="hero-task-item-title">${index + 1}. ${safeHtml(task.task || 'Untitled task')}</div>
                    ${subPlans}
                    <div class="hero-task-item-meta">
                        <span class="hero-task-item-chip">${safeHtml(task.date || '--')}</span>
                        ${ownerPlanChip}
                        ${rawStatus}
                        ${completedDate}
                    </div>
                </div>
                ${canManageHeroTasks ? `
                    <div class="hero-task-item-actions">
                        <button type="button" class="action-btn secondary" onclick="window.app_editHeroTaskAction('${safeTaskDate}','${safeOwnerId}')">Edit Plan</button>
                        ${actionButtons}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    return `
        <div class="hero-task-modal-head">
            <div>
                <h3>${safeHtml(title)}</h3>
                <p>${safeHtml(user.name || 'Staff')} • ${Number(stats.taskPlanned || 0)} planned</p>
            </div>
            <button type="button" class="dashboard-max-close" onclick="window.app_closeHeroTaskList?.()" aria-label="Close task list">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="hero-task-modal-body">
            ${tasks.length ? rowsHtml : '<div class="dashboard-activity-empty">No tasks in this category for the scored range.</div>'}
        </div>
    `;
}

export function renderActivityLog(allStaffLogs) {
    const state = getStaffActivityState();
    state.logs = Array.isArray(allStaffLogs) ? allStaffLogs : [];
    const viewMode = state.activityViewMode || 'team';
    const currentUser = window.AppAuth.getUser();
    const filteredLogs = viewMode === 'my'
        ? state.logs.filter(log => {
            const logUserId = log.userId || log.user_id || log.staffId || '';
            return logUserId === currentUser?.id;
        })
        : state.logs;

    // Defer side effects
    setTimeout(() => {
        const list = document.getElementById('staff-activity-list');
        if (list) initTeamActivityAutoScroll(list);
    }, 0);

    const monthOptions = buildStaffActivityMonthOptions(8);
    const selectedMonthLabel = formatMonthLabel(state.selectedMonth);

    return `
        <div class="card dashboard-team-activity-card">
            <div class="dashboard-team-activity-head">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <h4>${viewMode === 'my' ? 'My Activity' : 'Team Activity'}</h4>
                    <div class="dashboard-activity-toggle" style="display:flex;gap:0;margin-left:0.5rem;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
                        <button onclick="window.app_setStaffActivityView('my')" class="dashboard-activity-toggle-btn ${viewMode === 'my' ? 'active' : ''}" style="padding:4px 10px;font-size:0.75rem;border:none;cursor:pointer;background:${viewMode === 'my' ? '#6366f1' : '#f8fafc'};color:${viewMode === 'my' ? 'white' : '#475569'};font-weight:600;">My</button>
                        <button onclick="window.app_setStaffActivityView('team')" class="dashboard-activity-toggle-btn ${viewMode === 'team' ? 'active' : ''}" style="padding:4px 10px;font-size:0.75rem;border:none;cursor:pointer;background:${viewMode === 'team' ? '#6366f1' : '#f8fafc'};color:${viewMode === 'team' ? 'white' : '#475569'};font-weight:600;">Team</button>
                    </div>
                </div>
                <span id="staff-activity-range-label">${safeHtml(selectedMonthLabel)}</span>
            </div>
            <div class="dashboard-team-activity-filters dashboard-team-activity-filters-compact">
                <select class="dashboard-team-select" onchange="window.app_setStaffActivityMonth(this.value)">
                    ${monthOptions.map(opt => `<option value="${opt.key}" ${opt.key === state.selectedMonth ? 'selected' : ''}>${safeHtml(opt.label)}</option>`).join('')}
                </select>
                <select class="dashboard-team-select" onchange="window.app_setStaffActivitySort(this.value)">
                    <option value="date-desc" ${state.sortKey === 'date-desc' ? 'selected' : ''}>Date (Newest)</option>
                    <option value="date-asc" ${state.sortKey === 'date-asc' ? 'selected' : ''}>Date (Oldest)</option>
                    <option value="completed-first" ${state.sortKey === 'completed-first' ? 'selected' : ''}>Completed First</option>
                    <option value="incomplete-first" ${state.sortKey === 'incomplete-first' ? 'selected' : ''}>Incomplete First</option>
                    <option value="status-priority" ${state.sortKey === 'status-priority' ? 'selected' : ''}>Status Priority</option>
                    <option value="staff-asc" ${state.sortKey === 'staff-asc' ? 'selected' : ''}>Staff (A-Z)</option>
                    <option value="staff-desc" ${state.sortKey === 'staff-desc' ? 'selected' : ''}>Staff (Z-A)</option>
                </select>
            </div>
            <div id="staff-activity-list" class="dashboard-team-activity-list dashboard-team-activity-list-split">
                ${renderStaffActivityListSplit(filteredLogs, state.sortKey)}
            </div>
        </div>`;
}

export function renderCustomizationWidget(settings) {
    const s = settings || window.app_dashboardCustomization?.getDefaults() || {};
    const wv = s.widgetVisibility || {};
    const density = s.layoutDensity || 'standard';
    const mirror = !!s.globalAdminMirror;

    const widgetIds = [
        ['feast', 'Feast Widget'],
        ['teamActivity', 'Team Activity'],
        ['hero', 'Hero of the Week'],
        ['staffLeaveSummary', 'Staff Leave Summary'],
        ['journeyReflection', 'Journey Reflection'],
        ['staffPerformance', 'Staff Performance'],
        ['statsRow', 'Stats Row']
    ];

    const toggleRows = widgetIds.map(([key, label]) => `
        <label class="dashboard-customize-toggle">
            <input type="checkbox" data-customize-key="widgetVisibility.${key}" ${wv[key] !== false ? 'checked' : ''} onchange="window.app_saveDashboardCustomization()">
            <span>${label}</span>
        </label>`).join('');

    return `
        <div class="dashboard-customization-widget">
            <h3 class="dashboard-customize-heading">Dashboard Customization</h3>
            <div class="dashboard-customize-section">
                <label class="dashboard-customize-label">Widget Visibility</label>
                <div class="dashboard-customize-grid">
                    ${toggleRows}
                </div>
            </div>
            <div class="dashboard-customize-section">
                <label class="dashboard-customize-label">Layout Density</label>
                <div class="dashboard-customize-pills">
                    <label class="dashboard-customize-pill ${density === 'standard' ? 'active' : ''}">
                        <input type="radio" name="customize-density" value="standard" ${density === 'standard' ? 'checked' : ''} onchange="window.app_dashboardCustomization?.saveSettings({ ...window.app_dashboardCustomization?._settings, layoutDensity: 'standard' })">
                        Standard
                    </label>
                    <label class="dashboard-customize-pill ${density === 'compact' ? 'active' : ''}">
                        <input type="radio" name="customize-density" value="compact" ${density === 'compact' ? 'checked' : ''} onchange="window.app_dashboardCustomization?.saveSettings({ ...window.app_dashboardCustomization?._settings, layoutDensity: 'compact' })">
                        Compact
                    </label>
                </div>
            </div>
            <div class="dashboard-customize-section">
                <label class="dashboard-customize-toggle">
                    <input type="checkbox" data-customize-key="globalAdminMirror" ${mirror ? 'checked' : ''} onchange="window.app_saveDashboardCustomization()">
                    <span>Apply customization to Global Admin dashboard</span>
                </label>
            </div>
        </div>`;
}

export function renderStaffActivityListSplit(allLogs, sortKey) {
    const normalized = normalizeStaffActivityLogs(allLogs);
    if (normalized.length === 0) {
        return '<div class="dashboard-activity-empty">No team activities found for the selected month.</div>';
    }
    const sorted = sortStaffActivityLogs(normalized, sortKey);
    const completed = sorted.filter(log => log._taskStatus === 'completed');
    const incomplete = sorted.filter(log => log._taskStatus !== 'completed');
    return `
        <div class="dashboard-team-activity-split-grid">
            ${renderStaffActivityColumn('Completed', completed, 'No completed tasks in this month.')}
            ${renderStaffActivityColumn('In Progress / Incomplete', incomplete, 'No in-progress or incomplete tasks in this month.')}
        </div>
    `;
}

export function renderStaffActivityColumn(title, logs, emptyMsg) {
    const currentUser = window.AppAuth.getUser();
    const isAdminUser = window.app_hasPerm('dashboard', 'admin', currentUser);
    const body = logs.length === 0
        ? `<div class="dashboard-activity-empty">${emptyMsg}</div>`
        : logs.map(log => {
            const isOwner = currentUser && log.userId === currentUser.id;
            const canEdit = isAdminUser || isOwner;
            const progressMeta = renderProgressMeta(log);
            const statusBadge = `
                <div class="dashboard-activity-status-row">
                    ${renderTaskStatusBadge(log._taskStatus)}
                    ${canEdit ? `<div class="dashboard-activity-edit-wrap"><button onclick="window.app_openDayPlan('${log.date}', '${log.userId || ''}')" class="dashboard-activity-edit-btn" title="Edit/Reassign"><i class="fa-solid fa-pen-to-square"></i></button></div>` : ''}
                </div>`;
            return `
                <div class="dashboard-staff-activity-item dashboard-staff-activity-item-compact">
                    <div class="dashboard-staff-name">${safeHtml(log.staffName || 'Unknown Staff')}<span class="dashboard-team-activity-item-date">${log.date || ''}</span></div>
                    <div class="dashboard-activity-desc dashboard-staff-activity-desc">${safeHtml(log._displayDesc || 'Work Plan Task')}</div>
                    ${progressMeta}
                    ${statusBadge}
                    <div class="dashboard-activity-meta">${log._taskStatus === 'completed' ? 'Completed' : 'Work Plan'}</div>
                </div>`;
        }).join('');
    return `
        <div class="dashboard-team-activity-col">
            <div class="dashboard-team-activity-col-head">
                <span>${safeHtml(title)}</span>
                <span class="dashboard-team-activity-count">${logs.length}</span>
            </div>
            <div class="dashboard-team-activity-col-list">${body}</div>
        </div>
    `;
}

function renderProgressMeta(log) {
    if (!log) return '';
    const hasPercent = Number.isFinite(Number(log.progressPercent));
    const status = log.progressStatus ? String(log.progressStatus).replace(/_/g, ' ') : '';
    const note = String(log.progressNote || '').trim();
    if (!hasPercent && !status && !note && Array.isArray(log.taskUpdates) && log.taskUpdates.length > 0) {
        const first = log.taskUpdates[0] || {};
        const derivedPercent = Number.isFinite(Number(first.progressPercent)) ? `${Number(first.progressPercent)}%` : '';
        const derivedStatus = first.progressStatus ? String(first.progressStatus).replace(/_/g, ' ') : '';
        const derivedNote = String(first.progressNote || '').trim();
        if (!derivedPercent && !derivedStatus && !derivedNote) return '';
        const derivedTitle = derivedNote ? ` title="${safeHtml(derivedNote)}"` : '';
        const derivedLabel = `${derivedPercent}${derivedPercent && derivedStatus ? ' - ' : ''}${safeHtml(derivedStatus)}`;
        return `<div class="dashboard-progress-chip"${derivedTitle}>${derivedLabel}</div>`;
    }
    if (!hasPercent && !status && !note) return '';
    const percent = hasPercent ? `${Number(log.progressPercent)}%` : '';
    const title = note ? ` title="${safeHtml(note)}"` : '';
    const label = `${percent}${percent && status ? ' - ' : ''}${safeHtml(status)}`;
    return `<div class="dashboard-progress-chip"${title}>${label}</div>`;
}

export function renderStatsCard(title, subtitle, statsObj, statType = '') {
    const penaltyDays = Number(statsObj.penalty ?? statsObj.penaltyLeaves ?? 0);
    const penaltyBadge = penaltyDays > 0
        ? `<span class="dashboard-penalty-badge">Penalty Applies</span>`
        : '';
    const dataAttr = statType ? ` data-stats-type="${safeHtml(statType)}"` : '';
    return `
        <div class="card dashboard-stats-card" ${dataAttr} role="button" tabindex="0" aria-label="Open ${safeHtml(title)} details">
            <div class="dashboard-stats-card-head">
                <div>
                    <h4 class="dashboard-stats-card-title">${safeHtml(title)}</h4>
                    <span class="dashboard-stats-card-subtitle">${safeHtml(subtitle)}</span>
                </div>
                ${penaltyBadge}
            </div>

            <div class="dashboard-stats-metric-grid">
                 <div class="dashboard-stats-metric dashboard-stats-metric-late">
                    <div class="dashboard-stats-metric-value">${safeHtml(statsObj.totalLateDuration)}</div>
                    <div class="dashboard-stats-metric-label">Late</div>
                 </div>
                 <div class="dashboard-stats-metric dashboard-stats-metric-extra">
                    <div class="dashboard-stats-metric-value">${safeHtml(statsObj.totalExtraDuration)}</div>
                    <div class="dashboard-stats-metric-label">Extra</div>
                 </div>
            </div>

            <div class="dashboard-breakdown-grid">
                ${renderBreakdown(statsObj.breakdown)}
            </div>
        </div>
    `;
}

function renderStatsDetailInline(statType) {
    const type = String(statType || '').trim() === 'yearly' ? 'yearly' : 'monthly';
    const store = window.app_dashboardStatsStore || {};
    const stats = type === 'yearly' ? (store.yearly || {}) : (store.monthly || {});
    const title = type === 'yearly' ? (store.yearlyTitle || 'Yearly Summary') : (store.monthlyTitle || 'Monthly Summary');
    const subtitle = type === 'yearly' ? (store.yearlySubtitle || '') : (store.monthlySubtitle || '');
    const breakdown = stats.breakdown || {};
    const range = store.ranges ? (type === 'yearly' ? store.ranges.yearly : store.ranges.monthly) : null;
    const buckets = buildStatsDetailBuckets(store.logs || [], range);
    const details = {
        late: buckets.late || [],
        early: buckets.early || [],
        extra: buckets.extra || []
    };
    const section = (label, items) => `
        <div class="dashboard-inline-stats-section">
            <div class="dashboard-inline-stats-label">${safeHtml(label)}</div>
            <div class="dashboard-inline-stats-dates">
                ${items.length ? items.map((d) => `<span class="dashboard-inline-stats-date">${safeHtml(d)}</span>`).join('') : '<span class="dashboard-inline-stats-empty">No dates</span>'}
            </div>
        </div>
    `;
    return `
        <div class="dashboard-inline-stats-detail">
            <div class="dashboard-inline-stats-head">
                <h5>${safeHtml(title)}</h5>
                <span>${safeHtml(subtitle || 'Detailed summary')}</span>
            </div>
            <div class="dashboard-inline-stats-grid">
                <div class="dashboard-inline-stats-tile"><strong>${safeHtml(stats.late ?? 0)}</strong><span>Late Count</span></div>
                <div class="dashboard-inline-stats-tile"><strong>${safeHtml(stats.totalLateDuration || '0h 0m')}</strong><span>Late Duration</span></div>
                <div class="dashboard-inline-stats-tile"><strong>${safeHtml(stats.earlyDepartures ?? 0)}</strong><span>Early Exits</span></div>
                <div class="dashboard-inline-stats-tile"><strong>${safeHtml(stats.extraWorkedHours ?? 0)}h</strong><span>Extra Hours</span></div>
            </div>
            ${section('Late Dates', details.late)}
            ${section('Early Departure Dates', details.early)}
            ${section('Extra Hours Dates', details.extra)}
            <div class="dashboard-inline-stats-breakdown">
                ${Object.entries(breakdown).map(([k, v]) => `<div class="dashboard-inline-stats-breakdown-row"><span>${safeHtml(k)}</span><strong>${safeHtml(v)}</strong></div>`).join('')}
            </div>
        </div>
    `;
}

export function renderBreakdown(breakdown) {
    const items = Object.entries(breakdown);
    const meta = {
        'Present': { color: '#166534', bg: '#f0fdf4', label: 'Office' },
        'Work - Home': { color: '#0369a1', bg: '#e0f2fe', label: 'WFH' },
        'Training': { color: '#4338ca', bg: '#eef2ff', label: 'Training' },
        'Late': { color: '#c2410c', bg: '#fff7ed', label: 'Late' },
        'Sick Leave': { color: '#991b1b', bg: '#fef2f2', label: 'Sick' },
        'Casual Leave': { color: '#9d174d', bg: '#fce7f3', label: 'Casual' },
        'Earned Leave': { color: '#be185d', bg: '#fdf2f8', label: 'Earned' },
        'Paid Leave': { color: '#be123c', bg: '#ffe4e6', label: 'Paid' },
        'Maternity Leave': { color: '#a21caf', bg: '#fae8ff', label: 'Maternity' },
        'Retreat Leave': { color: '#0e7490', bg: '#ecfeff', label: 'Retreat' },
        'Staff Development Leave': { color: '#166534', bg: '#f0fdf4', label: 'Staff Dev' },
        'Absent': { color: '#7f1d1d', bg: '#fee2e2', label: 'Absent' },
        'Early Departure': { color: '#991b1b', bg: '#fff1f2', label: 'Early Exit' },
        'Holiday': { color: '#1e293b', bg: '#f1f5f9', label: 'Holiday' },
        'National Holiday': { color: '#334155', bg: '#f8fafc', label: 'Nat. Hol' },
        'Regional Holidays': { color: '#475569', bg: '#f8fafc', label: 'Reg. Hol' }
    };

    return items.map(([key, count]) => {
        const style = meta[key] || { color: '#374151', bg: '#f3f4f6', label: key };
        if (count === 0 && !['Present', 'Late', 'Absent', 'Early Departure'].includes(key)) return '';

        return `
            <div class="dashboard-breakdown-item" data-breakdown-key="${safeHtml(key)}">
                <span class="dashboard-breakdown-count">${count}</span>
                <span class="dashboard-breakdown-label">${style.label}</span>
            </div>
         `;
    }).join('');
}

function attachStatsCardHandlers() {
    document.querySelectorAll('.dashboard-stats-card[data-stats-type]').forEach(card => {
        if (card.dataset.bound === '1') return;
        card.dataset.bound = '1';
        const type = card.getAttribute('data-stats-type') || '';
        card.addEventListener('click', (event) => {
            if (event.target && event.target.closest && event.target.closest('.dashboard-card-mode-controls')) return;
            window.app_toggleDashboardCardMode?.(`stats-${type}`, DASHBOARD_CARD_MODE_FULLSCREEN, card);
        });
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                window.app_toggleDashboardCardMode?.(`stats-${type}`, DASHBOARD_CARD_MODE_FULLSCREEN, card);
            }
        });
    });
}

function attachHeroCardHandlers() {
    document.querySelectorAll('.dashboard-hero-stats-card.hero-slot').forEach(card => {
        if (card.dataset.heroBound === '1') return;
        card.dataset.heroBound = '1';
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', 'Open Hero of the Week details');
        card.addEventListener('click', (event) => {
            if (event.target && event.target.closest && (event.target.closest('.dashboard-card-mode-controls') || event.target.closest('.hero-refresh-btn'))) return;
            window.app_toggleDashboardCardMode?.('hero-week', DASHBOARD_CARD_MODE_FULLSCREEN, card);
        });
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                window.app_toggleDashboardCardMode?.('hero-week', DASHBOARD_CARD_MODE_FULLSCREEN, card);
            }
        });
    });
}

function parseTimeToMinutesLocal(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.toLowerCase().includes('active')) return null;
    const match = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return null;
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const meridiem = match[3] ? match[3].toUpperCase() : '';
    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
    return (hours * 60) + minutes;
}

function buildStatsDetailBuckets(logs, range) {
    const buckets = {
        late: new Set(),
        early: new Set(),
        extra: new Set(),
        breakdown: {
            'Present': new Set(),
            'Work - Home': new Set(),
            'Training': new Set(),
            'Sick Leave': new Set(),
            'Casual Leave': new Set(),
            'Earned Leave': new Set(),
            'Paid Leave': new Set(),
            'Maternity Leave': new Set(),
            'Retreat Leave': new Set(),
            'Staff Development Leave': new Set(),
            'Absent': new Set(),
            'Holiday': new Set(),
            'National Holiday': new Set(),
            'Regional Holidays': new Set(),
            'Late': new Set(),
            'Early Departure': new Set()
        }
    };

    const startDate = range?.start ? new Date(range.start) : new Date('1970-01-01');
    const endDate = range?.end ? new Date(range.end) : new Date();
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    let canonical = Array.isArray(logs) ? logs : [];
    if (window.AppAnalytics && window.AppAnalytics.pickBestAttendanceLogPerDay) {
        try {
            canonical = window.AppAnalytics.pickBestAttendanceLogPerDay(canonical, startDate, endDate);
        } catch (err) {
            console.warn('pickBestAttendanceLogPerDay failed', err);
        }
    } else {
        const byDate = new Map();
        canonical.forEach(log => {
            const key = log.date || '';
            if (!key) return;
            if (!byDate.has(key)) byDate.set(key, log);
        });
        canonical = Array.from(byDate.values());
    }

    const lateCutoff = (typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.LATE_CUTOFF_MINUTES : 555) || 555;
    const earlyDeparture = (typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.EARLY_DEPARTURE_MINUTES : 1020) || 1020;

    canonical.forEach(log => {
        const logDate = log.date ? new Date(log.date) : null;
        if (!logDate || Number.isNaN(logDate.getTime())) return;
        if (logDate < startDate || logDate > endDate) return;
        const dateStr = log.date;
        const type = String(log.type || '');
        const inMinutes = parseTimeToMinutesLocal(log.checkIn);
        const outMinutes = parseTimeToMinutesLocal(log.checkOut);

        const isManual = log.isManualOverride === true;
        const isLateCountable = log.lateCountable === true || (!Object.prototype.hasOwnProperty.call(log, 'lateCountable') && inMinutes !== null && inMinutes > lateCutoff);
        if (isLateCountable) {
            buckets.late.add(dateStr);
            buckets.breakdown['Late'].add(dateStr);
        }
        if (!isManual) {
            if (outMinutes !== null && outMinutes < earlyDeparture && !String(type).includes('Leave') && type !== 'Absent') {
                buckets.early.add(dateStr);
                buckets.breakdown['Early Departure'].add(dateStr);
            }
        } else if (type === 'Early Departure') {
            buckets.early.add(dateStr);
            buckets.breakdown['Early Departure'].add(dateStr);
        }

        const storedExtraMinutes = typeof log.extraWorkedMs === 'number'
            ? Math.max(0, Math.round(log.extraWorkedMs / (1000 * 60)))
            : 0;
        const allowExtra = !(log.autoCheckout && !log.autoCheckoutExtraApproved);
        const hasExtra = storedExtraMinutes > 0 || (allowExtra && ((inMinutes !== null && inMinutes < lateCutoff) || (outMinutes !== null && outMinutes > earlyDeparture)));
        if (hasExtra) buckets.extra.add(dateStr);

        if (type === 'Work - Home') buckets.breakdown['Work - Home'].add(dateStr);
        else if (type === 'Training') buckets.breakdown['Training'].add(dateStr);
        else if (type === 'Sick Leave') buckets.breakdown['Sick Leave'].add(dateStr);
        else if (type === 'Casual Leave') buckets.breakdown['Casual Leave'].add(dateStr);
        else if (type === 'Earned Leave') buckets.breakdown['Earned Leave'].add(dateStr);
        else if (type === 'Paid Leave') buckets.breakdown['Paid Leave'].add(dateStr);
        else if (type === 'Maternity Leave') buckets.breakdown['Maternity Leave'].add(dateStr);
        else if (type === 'Retreat Leave') buckets.breakdown['Retreat Leave'].add(dateStr);
        else if (type === 'Staff Development Leave') buckets.breakdown['Staff Development Leave'].add(dateStr);
        else if (type === 'Absent') buckets.breakdown['Absent'].add(dateStr);
        else if (type === 'National Holiday') buckets.breakdown['National Holiday'].add(dateStr);
        else if (type === 'Regional Holidays') buckets.breakdown['Regional Holidays'].add(dateStr);
        else if (String(type).includes('Holiday')) buckets.breakdown['Holiday'].add(dateStr);
        else if (log.checkIn) buckets.breakdown['Present'].add(dateStr);
    });

    const toSortedArray = (set) => Array.from(set || []).sort((a, b) => new Date(a) - new Date(b));
    return {
        late: toSortedArray(buckets.late),
        early: toSortedArray(buckets.early),
        extra: toSortedArray(buckets.extra),
        breakdown: Object.fromEntries(Object.entries(buckets.breakdown).map(([k, v]) => [k, toSortedArray(v)]))
    };
}

export function renderStaffLeaveSummary(leaves, user) {
    if (!leaves || leaves.length === 0 || !user) return '';
    const myLeaves = leaves.filter(l => (l.userId || l.user_id) === user.id);
    if (myLeaves.length === 0) return '';
    const recentLeaves = myLeaves
        .sort((a, b) => new Date(b.appliedOn || b.startDate || 0) - new Date(a.appliedOn || a.startDate || 0))
        .slice(0, 5);
    return `
        <div class="card full-width dashboard-staff-leave-summary">
            <div class="dashboard-tagged-head">
                <h4>My Leave Status</h4>
                <span>${myLeaves.length} total request${myLeaves.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="dashboard-tagged-list">
                ${recentLeaves.map(l => {
                    const status = l.status || 'Pending';
                    const color = status === 'Approved' ? '#166534' : status === 'Rejected' ? '#b91c1c' : '#854d0e';
                    return `<div class="dashboard-tagged-item">
                        <div class="dashboard-tagged-main">
                            <div class="dashboard-tagged-title">${safeHtml(l.type || 'Leave')}</div>
                            <div class="dashboard-tagged-desc">${l.startDate || ''} to ${l.endDate || ''} - ${l.daysCount || '?'} day(s)</div>
                        </div>
                        <span class="dashboard-tagged-status" style="color:${color};font-weight:600;font-size:0.8rem;">${status}</span>
                    </div>`;
                }).join('')}
            </div>
            <a href="#leaves" class="dashboard-view-all-link" style="display:block;text-align:center;padding:0.5rem;color:#6366f1;font-weight:600;font-size:0.85rem;">View All Leaves</a>
        </div>`;
}

export function renderLeaveRequests(leaves, workFromHomeEntries = []) {
    const hasLeaves = Array.isArray(leaves) && leaves.length > 0;
    const hasWfh = Array.isArray(workFromHomeEntries) && workFromHomeEntries.length > 0;

    if (!hasLeaves && !hasWfh) {
        return `<div class="dashboard-empty-state">
            <i class="fa-solid fa-check-circle"></i>
            <p>No pending leave requests</p>
            <span>All leave requests have been reviewed</span>
        </div>`;
    }

    const leaveRows = hasLeaves
        ? leaves.slice(0, 5).map(l => `
            <div class="dashboard-leave-row">
                <div class="dashboard-leave-info">
                    <div class="dashboard-leave-name">${safeHtml(l.userName || 'Staff')}</div>
                    <div class="dashboard-leave-type">${safeHtml(l.type)} • ${l.daysCount} days</div>
                    <div class="dashboard-leave-date">${l.startDate} to ${l.endDate}</div>
                    <div class="dashboard-leave-meta">ID: ${safeHtml(String(l.id || '--'))}</div>
                    ${l.reason ? `<div class="dashboard-leave-reason">${safeHtml(l.reason)}</div>` : ''}
                </div>
                <div class="dashboard-leave-actions">
                    <button class="dashboard-leave-btn export" data-action="export" data-leave-id="${l.id}" title="Export PDF"><i class="fa-solid fa-file-pdf"></i></button>
                    <button class="dashboard-leave-btn comment" data-action="comment" data-leave-id="${l.id}" title="Add Comment"><i class="fa-solid fa-comment-dots"></i></button>
                    <button class="dashboard-leave-btn approve" data-action="approve" data-leave-id="${l.id}" title="Approve"><i class="fa-solid fa-check"></i></button>
                    <button class="dashboard-leave-btn reject" data-action="reject" data-leave-id="${l.id}" title="Reject"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
        `).join('')
        : '';

    const wfhRows = hasWfh
        ? workFromHomeEntries.slice(0, 5).map((row) => `
            <div class="dashboard-leave-row">
                <div class="dashboard-leave-info">
                    <div class="dashboard-leave-name">${safeHtml(row.userName || 'Staff')}</div>
                    <div class="dashboard-leave-type">Work From Home • 1 day</div>
                    <div class="dashboard-leave-date">${safeHtml(row.date || '--')} • ${safeHtml(row.checkIn || '--')} to ${safeHtml(row.checkOut || 'Active')}</div>
                </div>
                <div class="dashboard-leave-actions">
                    <span class="dashboard-tagged-pill accepted">WFH</span>
                </div>
            </div>
        `).join('')
        : '';

    return `
        <div class="card dashboard-leave-requests-card">
            <div class="dashboard-leave-requests-head"><h4>Pending Leaves & Work From Home</h4><span>Review requirements</span></div>
            <div class="dashboard-leave-requests-list">
                ${leaveRows}
                ${wfhRows}
            </div>
            ${hasLeaves && leaves.length > 5 ? `<div class="dashboard-leave-footer"><button onclick="window.location.hash = 'leaves'">View all ${leaves.length} leave requests</button></div>` : ''}
        </div>`;
}
export function renderMissedCheckoutRequests(items) {
    if (!items || items.length === 0) {
        return `<div class="dashboard-empty-state">
            <i class="fa-solid fa-clock"></i>
            <p>No missed checkout requests</p>
            <span>All caught up!</span>
        </div>`;
    }

    return `
        <div class="card full-width dashboard-tagged-card">
            <div class="dashboard-tagged-head"><h4>Missed Tasks Requests</h4><span>Pending admin review</span></div>
            <div class="dashboard-tagged-list">
                ${items.map((item) => `
                    <div class="dashboard-tagged-item">
                        <div class="dashboard-tagged-main">
                            <div class="dashboard-tagged-title">${safeHtml(item.staffName || 'Staff')}</div>
                            <div class="dashboard-tagged-desc">${safeHtml(item.reason || 'Reason not available.')}</div>
                            <div class="dashboard-tagged-meta">${safeHtml(item.date || '--')} | ${safeHtml(item.staffRole || 'Employee')}${item.submittedAt ? ` | Submitted ${safeHtml(new Date(item.submittedAt).toLocaleString())}` : ''}</div>
                        </div>
                        <div class="dashboard-tagged-status">
                            <span class="dashboard-tagged-pill pending">PENDING</span>
                            ${item.notificationId ? `
                                <div class="dashboard-tagged-actions">
                                    <button class="dashboard-tagged-btn accept" onclick='window.app_reviewMissedCheckoutReasonFromNotification(-1, ${JSON.stringify(String(item.notificationId))}, "approved")'>Approve</button>
                                    <button class="dashboard-tagged-btn reject" onclick='window.app_reviewMissedCheckoutReasonFromNotification(-1, ${JSON.stringify(String(item.notificationId))}, "rejected")'>Reject</button>
                                </div>
                            ` : '<span class="text-muted" style="font-size:0.7rem;">Notification sync pending</span>'}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>`;
}

export function renderLeaveHistory(leaves, options = {}) {
    const title = options.title || 'Leave History';
    const subtitle = options.subtitle || 'Past records';
    const selectedDate = options.selectedDate || new Date().toISOString().slice(0, 10);
    const canUndo = options.canUndo === true;

    if (!leaves || leaves.length === 0) {
        return `<div class="dashboard-empty-state">
            <i class="fa-solid fa-calendar-check"></i>
            <p>No leave history</p>
            <span>No leave records found for this period</span>
        </div>`;
    }

    return `
        <div class="card dashboard-leave-history-card">
            <div class="dashboard-leave-history-head">
                <div>
                    <h4>${safeHtml(title)}</h4>
                    <span>${safeHtml(subtitle)}</span>
                </div>
                <input type="date" class="dashboard-team-select" value="${safeHtml(selectedDate)}" onchange="window.app_setDashboardLeaveHistoryDate(this.value)">
            </div>
            <div class="dashboard-leave-history-list">
                ${leaves.map(l => `
                    <div class="dashboard-leave-history-row">
                        <div class="dashboard-leave-history-main">
                            <div class="dashboard-leave-history-user">${safeHtml(l.userName || 'Staff')}</div>
                            <div class="dashboard-leave-history-type">${safeHtml(l.type)} - ${l.daysCount} days</div>
                            <div class="dashboard-leave-meta">ID: ${safeHtml(String(l.id || '--'))}</div>
                            ${l.reason ? `<div class="dashboard-leave-reason">${safeHtml(l.reason)}</div>` : ''}
                            <div class="dashboard-leave-history-date">${l.startDate} to ${l.endDate}${l.adminComment ? ` • ${safeHtml(l.adminComment)}` : ''}</div>
                        </div>
                        <div class="dashboard-leave-history-status">
                            <span class="status-pill" data-status="${safeHtml(l.status)}">${safeHtml(l.status)}</span>
                            ${canUndo && ['Approved', 'Rejected'].includes(String(l.status || '')) ? `
                                <button type="button" class="dashboard-tagged-btn" data-ts-action="undo-leave" data-leave-id="${safeHtml(l.id)}">Undo</button>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>`;
}

// Notifications are now exclusively inside the bell icon panel.
// This function intentionally returns '' to keep the dashboard clean.
// Only @mention / tag items (renderTaggedItems) are shown on the dashboard as they require action.
export function renderNotificationPanel(_notifications, _history) {
    return '';
}

export function renderTaggedItems(_notifications) {
    // Tagged items are intentionally shown only in the notification drawer.
    return '';
}

function buildStaffSelectorBox(allUsers, user, targetStaffId) {
    const staffOptions = (allUsers || [])
        .filter(u => u.id !== user.id)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(u => `<option value="${u.id}" ${u.id === targetStaffId ? 'selected' : ''}>${safeHtml(u.name)}</option>`)
        .join('');
    const isActive = targetStaffId !== user.id;
    return `
        <div class="dashboard-viewing-box">
            <div class="dashboard-viewing-inner">
                <i class="fa-solid fa-users-viewfinder dashboard-viewing-icon"></i>
                <div class="dashboard-viewing-meta">
                    <div class="dashboard-viewing-head">
                        <div class="dashboard-viewing-label">Viewing Summary For</div>
                        ${isActive ? '<span class="dashboard-viewing-state">STAFF VIEW ACTIVE</span>' : ''}
                    </div>
                    <select onchange="window.app_changeSummaryStaff(this.value)" class="dashboard-viewing-select">
                        <option value="${user.id}">My Own Summary</option>
                        <optgroup label="Staff Members">${staffOptions}</optgroup>
                    </select>
                </div>
            </div>
        </div>`;
}

export function renderStaffDirectory(allUsers, _notifications, currentUser) {
    if (!allUsers || allUsers.length === 0) {
        return `
            <div class="card dashboard-staff-directory-card">
                <div class="dashboard-staff-directory-head"><h4>Staff Directory</h4><span>Quick actions</span></div>
                <div class="dashboard-staff-directory-list">
                    <div class="dashboard-activity-empty">No staff loaded.</div>
                </div>
            </div>`;
    }

    const nowMs = Date.now();
    const getNewestNotifTime = (u) => {
        const items = (u.notifications || []).map(n => new Date(n.taggedAt || n.date || n.respondedAt || 0).getTime()).filter(Boolean);
        return items.length ? Math.max(...items) : 0;
    };

    const staffList = allUsers
        .filter(u => u.id !== currentUser.id)
        .sort((a, b) => getNewestNotifTime(b) - getNewestNotifTime(a) || a.name.localeCompare(b.name))
        .map(u => {
            const newest = getNewestNotifTime(u);
            const isNew = newest && (nowMs - newest < 120000);
            return `
                <div class="dashboard-staff-row ${isNew ? 'dashboard-staff-row-new' : ''}">
                    <div class="dashboard-staff-meta">
                        <div class="dashboard-staff-avatar">
                            <img src="${safeUrl(u.avatar)}" alt="${safeHtml(u.name)}">
                        </div>
                        <div class="dashboard-staff-text">
                            <div class="dashboard-staff-name">${safeHtml(u.name)}</div>
                            <div class="dashboard-staff-role">${safeHtml(u.role || 'Staff')}</div>
                        </div>
                    </div>
                    <div class="dashboard-staff-actions">
                        <button class="dashboard-staff-btn" onclick="window.location.hash = 'staff-directory'; window.app_openStaffThread('${u.id}')" title="Message"><i class="fa-solid fa-message"></i></button>
                    </div>
                </div>
            `;
        }).join('');

    return `
        <div class="card dashboard-staff-directory-card">
            <div class="dashboard-staff-directory-head"><h4>Staff Directory</h4><span>Message or assign</span></div>
            <div class="dashboard-staff-directory-list">
                ${staffList}
            </div>
        </div>`;
}

export async function renderDashboard() {
    markPerf('dashboard:render:start');
    window.app_closeDashboardCardMaximize?.();
    const user = window.AppAuth.getUser();
    const isAdmin = window.app_hasPerm('dashboard', 'view', user);
    const isFullAdmin = window.app_hasPerm('dashboard', 'admin', user);
    const canViewAdminSections = window.app_isAdminUser?.(user) || window.app_canSeeAdminPanel?.(user);
    const staffActivityState = getStaffActivityState();
    const selectedMonth = staffActivityState.selectedMonth;
    const leaveHistoryDate = staffActivityState.leaveHistoryDate || new Date().toISOString().slice(0, 10);
    const dateKeys = window.AppDB?.getISTDateKeys ? window.AppDB.getISTDateKeys() : {
        todayKey: new Date().toISOString().split('T')[0],
        yesterdayKey: new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString().split('T')[0]
    };
    const todayStr = dateKeys.todayKey;
    const yesterdayStr = dateKeys.yesterdayKey;
    const targetStaffId = (isAdmin && window.app_selectedSummaryStaffId) ? window.app_selectedSummaryStaffId : user.id;

    const customizationSettings = await window.app_dashboardCustomization?.loadSettings?.() || null;

    const shouldApplyCustomization = customizationSettings && window.app_canCustomizeDashboard?.(user) && (!user.isAdmin || customizationSettings.globalAdminMirror);
    const wv = shouldApplyCustomization ? (customizationSettings.widgetVisibility || {}) : {};
    const wvIf = (key, html) => wv[key] !== false ? html : '';
    const densityClass = shouldApplyCustomization && customizationSettings.layoutDensity === 'compact' ? ' dashboard-density-compact' : '';

    console.time('DashboardFetch');
    markPerf('dashboard:fetch:start');

    // Show skeleton loading state immediately while data fetches
    const { renderDashboardSkeletons } = await import('./dashboard-skeletons.js');
    const skeletonTarget = document.getElementById('page-content');
    if (skeletonTarget && !skeletonTarget.dataset.hasSkeletons) {
        skeletonTarget.dataset.hasSkeletons = '1';
        skeletonTarget.innerHTML = renderDashboardSkeletons();
    }

    const sharedSummaryTask = window.AppDB.getOrCreateDailySummary
        ? window.AppDB.getOrCreateDailySummary({
            dateKey: todayStr,
            yesterdayKey: yesterdayStr,
            staleAfterMs: AppConfig?.SUMMARY_POLICY?.STALENESS_MS,
            lockTtlMs: AppConfig?.SUMMARY_POLICY?.LOCK_TTL_MS,
            generatorFn: () => window.AppAnalytics.buildDailyDashboardSummary({ dateKey: todayStr, selectedMonth })
        }).catch(err => {
            console.warn('Daily summary fetch/generation failed:', err);
            return null;
        })
        : null;

    // Use the full summary promise directly (skeleton loading handles the wait UX)
    const dailySummaryPromise = sharedSummaryTask || Promise.resolve(null);

    // Refresh at midnight
    if (!window._dashboardRefreshScheduled) {
        window._dashboardRefreshScheduled = true;
        try {
            const istNow = window.AppDB.getIstNow();
            const tom = new Date(istNow);
            tom.setDate(tom.getDate() + 1);
            tom.setHours(0, 0, 5, 0);
            const msUntil = tom.getTime() - istNow.getTime();
            setTimeout(() => {
                renderDashboard().then(html => {
                    const content = document.getElementById('page-content');
                    if (content) content.innerHTML = html;
                });
                window._dashboardRefreshScheduled = false;
            }, Math.max(0, msUntil));
        } catch (err) {
            console.warn('failed to schedule dashboard refresh', err);
        }
    }

    // Auto-refresh hero at EOD
    if (!window._heroEodRefreshScheduled) {
        window._heroEodRefreshScheduled = true;
        try {
            const eodHour = AppConfig?.SUMMARY_POLICY?.RECOMPUTE_CUTOFF_HOUR_IST || 17;
            const istNow = window.AppDB.getIstNow();
            if (istNow.getHours() < eodHour) {
                const eod = new Date(istNow);
                eod.setHours(eodHour, 0, 0, 0);
                const msUntilEod = eod.getTime() - istNow.getTime();
                setTimeout(() => {
                    // Try to trigger a quiet background refresh if we can, otherwise just fetch
                    if (window.app_forceRefreshHero && window.AppAuth?.getUser() && window.app_hasPerm('dashboard', 'admin', window.AppAuth.getUser())) {
                        window.app_forceRefreshHero({ stopPropagation: () => {}, preventDefault: () => {} }).catch(() => {});
                    }
                    window._heroEodRefreshScheduled = false;
                }, Math.max(0, msUntilEod));
            }
        } catch (err) {
            console.warn('failed to schedule EOD hero refresh', err);
        }
    }

    const pendingMissedCheckoutNotifications = isAdmin
        ? (Array.isArray(user.notifications) ? user.notifications : []).filter((notif) =>
            notif
            && notif.type === 'missed-checkout-reason'
            && String(notif.status || 'pending').toLowerCase() === 'pending'
            && notif.logId)
        : [];
    const pendingMissedCheckoutLogIds = Array.from(new Set(
        pendingMissedCheckoutNotifications.map((notif) => String(notif.logId || '')).filter(Boolean)
    ));
    const currentWeekRange = getWeekRange(leaveHistoryDate);

    // Parallel Fetch
    const [status, logs, monthlyStats, yearlyStats, calendarPlans, pendingLeaves, allUsers, collaborations, allLeaves, dailySummary, minutesData, attendanceLogs, weeklyAttendanceLogs, currentWeekWorkPlans, journeyReflectionState] = await Promise.all([
        window.AppAttendance.getStatus(),
        window.AppAttendance.getLogs(targetStaffId, { limit: 200 }),
        window.AppAnalytics.getUserMonthlyStats(targetStaffId),
        window.AppAnalytics.getUserYearlyStats(targetStaffId),
        window.AppCalendar ? window.AppCalendar.getPlans() : { leaves: [], events: [] },
        window.app_hasPerm('leaves', 'view') ? window.AppLeaves.getPendingLeaves() : Promise.resolve([]),
        window.AppDB.getCached
            ? window.AppDB.getCached(window.AppDB.getCacheKey('dashboardUsers', 'users', {}), (AppConfig?.READ_CACHE_TTLS?.users || 60000), () => window.AppDB.getAll('users')).then(users => users.filter(u => !AppConfig.isDemoUser(u)))
            : window.AppDB.getAll('users').then(users => users.filter(u => !AppConfig.isDemoUser(u))),
        window.AppCalendar ? window.AppCalendar.getCollaborations(targetStaffId) : Promise.resolve([]),
        window.app_hasPerm('leaves', 'view')
            ? (() => {
                const leavesThirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                return window.AppDB.queryMany
                    ? window.AppDB.queryMany('leaves', [
                        { field: 'createdAt', operator: '>=', value: leavesThirtyDaysAgo }
                    ])
                    : window.AppDB.getAll('leaves').then((rows) => (rows || []).filter((row) => {
                        const created = String(row?.createdAt || row?.date || '');
                        return created >= leavesThirtyDaysAgo;
                    }));
            })()
            : Promise.resolve([]),
        dailySummaryPromise,
        window.AppMinutes ? window.AppMinutes.getMinutes() : Promise.resolve([]),
        (isAdmin && pendingMissedCheckoutLogIds.length)
            ? (window.AppDB.getManyByIds
                ? window.AppDB.getManyByIds('attendance', pendingMissedCheckoutLogIds)
                : Promise.all(pendingMissedCheckoutLogIds.map((id) => window.AppDB.get('attendance', id))).then((rows) => rows.filter(Boolean)))
            : Promise.resolve([]),
        (isAdmin && window.app_hasPerm('leaves', 'view'))
            ? (window.AppDB.queryMany
                ? window.AppDB.queryMany('attendance', [
                    { field: 'date', operator: '>=', value: currentWeekRange.startKey },
                    { field: 'date', operator: '<=', value: currentWeekRange.endKey }
                ])
                : window.AppDB.getAll('attendance').then((rows) => (rows || []).filter((row) => {
                    const d = String(row?.date || '');
                    return d >= currentWeekRange.startKey && d <= currentWeekRange.endKey;
                })))
            : Promise.resolve([]),
        window.AppDB.queryMany
            ? window.AppDB.queryMany('work_plans', [
                { field: 'date', operator: '>=', value: currentWeekRange.startKey },
                { field: 'date', operator: '<=', value: currentWeekRange.endKey }
            ])
            : window.AppDB.getAll('work_plans').then((rows) => (rows || []).filter((row) => {
                const d = String(row?.date || '');
                return d >= currentWeekRange.startKey && d <= currentWeekRange.endKey;
            })),
        window.AppJourneyReflection ? window.AppJourneyReflection.buildDashboardState({
            viewerUser: user,
            targetUserId: targetStaffId,
            targetUserName: user.name,
            dateKey: todayStr
        }) : Promise.resolve(null)
    ]);
    markPerf('dashboard:fetch:end');
    measurePerf('dashboard:fetch', 'dashboard:fetch:start', 'dashboard:fetch:end');
    console.timeEnd('DashboardFetch');

    // Fetch personal performance data (non-blocking — renders when ready)
    const personalPerfPromise = window.AppAnalytics?.getPersonalPerformance
        ? window.AppAnalytics.getPersonalPerformance(targetStaffId, { windowDays: 7, trendWeeks: 4 }).catch(() => null)
        : Promise.resolve(null);

    const heroMeta = {
        lowRead: false,
        generatedAt: dailySummary?.generatedAt || dailySummary?.meta?.generatedAt || 0,
        source: dailySummary?._source || '',
        heroRefreshCount: Number(dailySummary?.heroRefreshCount || 0)
    };
    let heroData = dailySummary?.hero || null;
    let staffActivities = Array.isArray(dailySummary?.teamActivityPreview) ? dailySummary.teamActivityPreview : [];
    const initialHeroBundle = setDashboardHeroBundle(heroData, dailySummary?.heroLeaderboard || null, heroMeta);
    heroData = initialHeroBundle.heroData;

    // If daily summary didn't include team activities, fetch them after render
    if (!dailySummary || !Array.isArray(dailySummary.teamActivityPreview)) {
        setTimeout(() => {
            refreshStaffActivityWidget(true).catch(() => {});
        }, 500);
    }


    // If the daily summary served a stale/fallback doc (e.g. yesterday's), the mini card
    // may show old data. Patch it from the live leaderboard once after render so the card
    // and the audit table always reflect the current window.
    const isStaleHeroSource = heroData != null && String(heroMeta.source || '').startsWith('fallback');
    if (isStaleHeroSource) {
        setTimeout(() => {
            if (window.app_refreshHeroAuditLive) {
                window.app_refreshHeroAuditLive({}).then(() => {
                    // Allow async Firestore listeners / global updates to settle before
                    // reading app_dashboardHeroData / app_dashboardHeroMeta.
                    return new Promise((r) => setTimeout(r, 250));
                }).then(() => {
                    const slot = document.querySelector('.hero-slot');
                    if (slot) {
                        slot.outerHTML = renderHeroCard(window.app_dashboardHeroData, window.app_dashboardHeroMeta || {});
                        setTimeout(() => { initDashboardCardControls(); attachHeroCardHandlers(); }, 0);
                    }
                }).catch(() => {});
            }
        }, 1000);
    }

    // If heroData is null (summary still generating), wait for it and patch when ready
    if (heroData == null && sharedSummaryTask) {
        sharedSummaryTask.then((ds) => {
            const latestHero = ds?.hero || null;
            const latestLeaderboard = ds?.heroLeaderboard || null;
            const updatedMeta = {
                ...heroMeta,
                generatedAt: ds?.generatedAt || heroMeta.generatedAt,
                source: ds?._source || heroMeta.source,
                heroRefreshCount: Number(ds?.heroRefreshCount || 0)
            };
            const bundle = setDashboardHeroBundle(latestHero, latestLeaderboard, updatedMeta);
            const slot = document.querySelector('.hero-slot');
            if (slot) {
                slot.outerHTML = renderHeroCard(bundle.heroData, updatedMeta);
                setTimeout(() => { initDashboardCardControls(); attachHeroCardHandlers(); }, 0);
            }
        }).catch((err) => {
            console.warn('Hero shared summary deferred load failed:', err);
            const slot = document.querySelector('.hero-slot');
            if (slot) {
                slot.outerHTML = renderHeroCard({
                    state: 'fetch_error',
                    reason: 'Hero stats are temporarily unavailable.',
                    source: 'shared_error'
                }, heroMeta);
            }
        });
    }

    if (window.AppRating && user.rating === undefined) {
        window.AppRating.updateUserRating(user.id).then(updatedUser => {
            Object.assign(user, updatedUser);
        }).catch(() => { });
    }

    const targetStaff = (allUsers || []).find(u => u.id === targetStaffId);

    const isViewingSelf = targetStaffId === user.id;
    const displayUser = (!isViewingSelf && targetStaff) ? targetStaff : user;
    const currentWeekOverdueLogs = getCurrentWeekOverdueWorkLogs(currentWeekWorkPlans, targetStaffId, currentWeekRange);
    const currentWeekOverdueTaskRows = getCurrentWeekOverdueTaskRows(currentWeekWorkPlans, targetStaffId, currentWeekRange);
    window.app_currentWeekOverdueWorkContext = {
        logs: currentWeekOverdueLogs,
        targetStaff: displayUser,
        weekRange: currentWeekRange
    };
    window.app_currentWeekOverdueTaskContext = {
        logs: currentWeekOverdueTaskRows,
        targetStaff: displayUser,
        weekRange: currentWeekRange
    };
    const heroHTML = renderHeroCard(heroData, heroMeta);
    const overdueTaskStripHTML = renderCurrentWeekOverdueTaskStrip(
        currentWeekOverdueTaskRows,
        displayUser,
        currentWeekRange
    );
    const journeyReflectionHTML = renderJourneyReflectionCard(journeyReflectionState);
    const isReadOnlyView = isAdmin && !isViewingSelf && !isFullAdmin;
    const now = new Date();
    const monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const fyDates = (window.AppAnalytics && window.AppAnalytics.getFinancialYearDates)
        ? window.AppAnalytics.getFinancialYearDates()
        : { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 11, 31) };
    window.app_dashboardStatsStore = {
        monthly: monthlyStats || {},
        yearly: yearlyStats || {},
        monthlyTitle: isViewingSelf ? monthlyStats.label : `${monthlyStats.label} - ${targetStaff?.name || 'Staff'}`,
        monthlySubtitle: isViewingSelf ? 'Monthly Stats' : 'Viewing Staff Monthly Stats',
        yearlyTitle: 'Yearly Summary',
        yearlySubtitle: isViewingSelf ? yearlyStats.label : `${yearlyStats.label} for ${targetStaff?.name || 'Staff'}`,
        logs: Array.isArray(logs) ? logs : [],
        ranges: {
            monthly: {
                start: monthlyStart.toISOString().split('T')[0],
                end: monthlyEnd.toISOString().split('T')[0]
            },
            yearly: {
                start: fyDates.start.toISOString().split('T')[0],
                end: fyDates.end.toISOString().split('T')[0]
            }
        }
    };

    const statusData = isReadOnlyView
        ? {
            status: displayUser.status || 'out',
            lastCheckIn: displayUser.lastCheckIn || null,
            isPaused: displayUser.isPaused === true,
            pauseStartedAt: displayUser.pauseStartedAt || null,
            totalPausedMs: Number(displayUser.totalPausedMs) || 0
        }
        : status;
    const isCheckedIn = statusData.status === 'in';
    const notifications = user.notifications || [];
    const tagHistory = user.tagHistory || [];
    const usersById = new Map((allUsers || []).map((entry) => [String(entry.id), entry]));
    const missedCheckoutRequests = isAdmin
        ? (attendanceLogs || [])
            .filter((log) => log
                && log.missedCheckoutReasonRequired
                && log.missedCheckoutReasonSubmittedAt
                && String(log.missedCheckoutReasonStatus || '').toLowerCase() === 'pending')
            .map((log) => {
                const staff = usersById.get(String(log.user_id));
                const notification = notifications.find((notif) =>
                    notif
                    && notif.type === 'missed-checkout-reason'
                    && String(notif.logId || '') === String(log.id || '')
                    && String(notif.status || 'pending').toLowerCase() === 'pending'
                );
                return {
                    notificationId: notification?.id || '',
                    staffName: staff?.name || 'Staff',
                    staffRole: staff?.role || 'Employee',
                    reason: log.missedCheckoutReason || '',
                    date: log.date || '',
                    submittedAt: log.missedCheckoutReasonSubmittedAt || ''
                };
            })
            .sort((a, b) => new Date(b.submittedAt || b.date || 0) - new Date(a.submittedAt || a.date || 0))
        : [];
    const workFromHomeRows = isAdmin
        ? (weeklyAttendanceLogs || [])
            .filter((log) => {
                const normalized = window.AppAttendance?.normalizeType
                    ? window.AppAttendance.normalizeType(log?.type || '')
                    : String(log?.type || '');
                return normalized === 'Work - Home';
            })
            .map((log) => ({
                userName: usersById.get(String(log.user_id || log.userId || ''))?.name || log.userName || 'Staff',
                date: log.date || '',
                checkIn: log.checkIn || '',
                checkOut: log.checkOut || ''
            }))
            .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        : [];

    let timerHTML = '00 : 00 : 00';
    let btnText = 'Check-in';
    let btnClass = 'action-btn';

    if (isCheckedIn) {
        btnText = 'Check-out';
        btnClass = 'action-btn checkout';
    }
    const pauseBtnHtml = isCheckedIn && !isReadOnlyView
        ? `<button class="action-btn secondary dashboard-checkin-btn dashboard-checkin-pause-btn" id="attendance-pause-btn" onclick="window.${statusData.isPaused ? 'app_resumeSession' : 'app_pauseSession'}()">
            ${statusData.isPaused ? 'Resume' : 'Pause'} <i class="fa-solid ${statusData.isPaused ? 'fa-play' : 'fa-pause'}"></i>
        </button>`
        : '';

    const formatElapsed = (ms) => {
        const safeMs = Math.max(0, ms || 0);
        let hrs = Math.floor(safeMs / (1000 * 60 * 60));
        let mins = Math.floor((safeMs / (1000 * 60)) % 60);
        let secs = Math.floor((safeMs / 1000) % 60);
        return `${String(hrs).padStart(2, '0')} : ${String(mins).padStart(2, '0')} : ${String(secs).padStart(2, '0')}`;
    };

    if (isCheckedIn && statusData.lastCheckIn) {
        const lastTs = new Date(statusData.lastCheckIn).getTime();
        const pausedMs = Number(statusData.totalPausedMs) || 0;
        const pauseStartMs = Number(statusData.pauseStartedAt) || 0;
        const livePausedMs = (statusData.isPaused === true && pauseStartMs > 0)
            ? Math.max(0, Date.now() - pauseStartMs)
            : 0;
        timerHTML = formatElapsed(Math.max(0, Date.now() - lastTs - pausedMs - livePausedMs));
    }

    const notifHTML = renderNotificationPanel(notifications, tagHistory);
    const taggedHTML = renderTaggedItems(notifications);

    let staffViewBannerHTML = '';
    if (isAdmin && !isViewingSelf && targetStaff) {
        staffViewBannerHTML = `
            <div class="card full-width dashboard-staff-view-banner">
                <div class="dashboard-staff-view-banner-inner">
                    <div class="dashboard-staff-view-banner-profile">
                        <div class="dashboard-staff-view-avatar-wrap">
                            <img src="${safeUrl(targetStaff.avatar)}" alt="${safeHtml(targetStaff.name)}" class="dashboard-staff-view-avatar">
                            <div class="dashboard-staff-view-avatar-badge">
                                <i class="fa-solid fa-eye"></i>
                            </div>
                        </div>
                        <div class="dashboard-staff-view-copy">
                            <div class="dashboard-staff-view-eyebrow">Currently Viewing</div>
                            <h3 class="dashboard-staff-view-title">${safeHtml(targetStaff.name)}'s Dashboard</h3>
                            <div class="dashboard-staff-view-meta">${safeHtml(targetStaff.role)} - ${safeHtml(targetStaff.dept || 'General')}</div>
                        </div>
                    </div>
                    <button onclick="window.app_changeSummaryStaff('${user.id}')" class="dashboard-staff-view-back-btn">
                        <i class="fa-solid fa-arrow-left"></i> Back to My Dashboard
                    </button>
                </div>
            </div>`;
    }

    let detailSectionHTML = '';
    let statsRowHTML = '';
    const primaryRowThirdCard = renderActivityLog(staffActivities);
    const renderYearlyPlanHTML = renderYearlyPlan(calendarPlans);
    const feastWidgetHTML = `<div class="dashboard-feast-widget" id="dashboard-feast-widget"><div class="dashboard-feast-widget-body"><div class="dashboard-feast-widget-text"><div class="dashboard-feast-widget-label">Today's Feast</div><div class="dashboard-feast-widget-name" id="dashboard-feast-name">Loading...</div><div class="dashboard-feast-widget-type" id="dashboard-feast-type"></div></div><i class="dashboard-feast-widget-icon" id="dashboard-feast-icon"></i><img class="dashboard-feast-widget-img" id="dashboard-feast-img" alt="" style="display:none"></div></div>`;
    if (canViewAdminSections) {
        const hasExplicitSelection = !!window.app_selectedSummaryStaffId && window.app_selectedSummaryStaffId !== user.id;
        const weekRange = getWeekRange(leaveHistoryDate);
        const leaveHistoryItems = (allLeaves || [])
            .filter(l => {
                const historyDate = String(l.appliedOn || l.actionDate || l.startDate || '').slice(0, 10);
                return historyDate && historyDate >= weekRange.startKey && historyDate <= weekRange.endKey;
            })
            .sort((a, b) => new Date(b.appliedOn || b.actionDate || b.startDate || 0) - new Date(a.appliedOn || a.actionDate || a.startDate || 0));
        const filteredHistory = hasExplicitSelection
            ? leaveHistoryItems.filter(l => (l.userId || l.user_id) === targetStaffId).slice(0, 8)
            : leaveHistoryItems.slice(0, 8);

        const historyHTML = renderLeaveHistory(filteredHistory, {
            title: hasExplicitSelection ? `${targetStaff?.name || 'Staff'} Leave History` : 'Leave Request History',
            subtitle: hasExplicitSelection
                ? `Current week (${weekRange.label}) for selected staff`
                : `Current week (${weekRange.label}) across all staff`,
            selectedDate: leaveHistoryDate,
            canUndo: true
        });

        const personalPerfData = await personalPerfPromise;
        cleanupPerformanceChart();
        const staffPerfHTML = wvIf('staffPerformance', renderStaffPerformance(personalPerfData, { windowDays: 7 }));
        detailSectionHTML = `
                    <div class="dashboard-detail-section" data-zone-id="detailSection">
                        ${isFullAdmin ? `<div class="dashboard-admin-actions-row">
                            ${renderLeaveRequests(pendingLeaves, workFromHomeRows)}
                            ${renderMissedCheckoutRequests(missedCheckoutRequests)}
                            ${historyHTML}
                        </div>` : ''}
                        ${staffPerfHTML}
                        ${wvIf('teamActivity', primaryRowThirdCard)}
                        ${wvIf('journeyReflection', journeyReflectionHTML)}
                    </div>`;
        statsRowHTML = wvIf('statsRow', `
            <div class="dashboard-stats-row" data-zone-id="statsRow">
                ${wvIf('feast', feastWidgetHTML)}
                ${wvIf('hero', heroHTML)}
                ${renderStatsCard(isViewingSelf ? monthlyStats.label : `${monthlyStats.label} - ${targetStaff?.name || 'Staff'}`, isViewingSelf ? 'Monthly Stats' : 'Viewing Staff Monthly Stats', monthlyStats, 'monthly')}
                ${renderStatsCard('Yearly Summary', isViewingSelf ? yearlyStats.label : `${yearlyStats.label} for ${targetStaff?.name || 'Staff'}`, yearlyStats, 'yearly')}
            </div>`);
    } else {
        const personalPerfData = await personalPerfPromise;
        cleanupPerformanceChart();
        const staffPerfHTML = wvIf('staffPerformance', renderStaffPerformance(personalPerfData, { windowDays: 7 }));
        detailSectionHTML = `
                    <div class="dashboard-detail-section" data-zone-id="detailSection">
                        ${staffPerfHTML}
                        ${wvIf('teamActivity', primaryRowThirdCard)}
                        ${wvIf('staffLeaveSummary', renderStaffLeaveSummary(allLeaves, user))}
                        ${wvIf('journeyReflection', journeyReflectionHTML)}
                    </div>`;
        statsRowHTML = wvIf('statsRow', `
            <div class="dashboard-stats-row" data-zone-id="statsRow">
                ${wvIf('feast', feastWidgetHTML)}
                ${wvIf('hero', heroHTML)}
                ${renderStatsCard(monthlyStats.label, 'Monthly Stats', monthlyStats, 'monthly')}
                ${renderStatsCard('Yearly Summary', yearlyStats.label, yearlyStats, 'yearly')}
            </div>`);
    }

    const updateState = (window.app_getReleaseUpdateState && window.app_getReleaseUpdateState()) || { active: false };
    setTimeout(() => ensureDashboardActionDelegates(), 0);
    window.app_dashboardWorklogContext = {
        logs: Array.isArray(logs) ? logs : [],
        collaborations: Array.isArray(collaborations) ? collaborations : [],
        minutesData: Array.isArray(minutesData) ? minutesData : [],
        workPlans: Array.isArray(currentWeekWorkPlans) ? currentWeekWorkPlans : [],
        targetStaffId,
        page: 1,
        pageSize: WORKLOG_PAGE_SIZE
    };
    setTimeout(() => initWorklogAutoScroll(document), 0);
    setTimeout(() => initDashboardCardControls(), 0);

    // Reverse geocode location display (deferred, non-blocking)
    setTimeout(() => {
        const locEl = document.getElementById('location-text');
        if (!locEl) return;
        const lat = locEl.dataset.lat;
        const lng = locEl.dataset.lng;
        if (!lat || !lng) return;
        const cacheKey = `geocode:${lat}:${lng}`;
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            const span = locEl.querySelector('span');
            if (span) span.textContent = cached;
            return;
        }
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`, {
            headers: { 'Accept-Language': 'en' }
        }).then(r => r.json()).then(data => {
            const addr = data?.address;
            if (!addr) return;
            const parts = [addr.road, addr.neighbourhood, addr.city || addr.town || addr.village, addr.state].filter(Boolean);
            const address = parts.join(', ');
            if (address) {
                sessionStorage.setItem(cacheKey, address);
                const span = locEl.querySelector('span');
                if (span) span.textContent = address;
            }
        }).catch(() => {});
    }, 500);

    // Fetch today's Catholic feast (deferred, non-blocking)
    setTimeout(() => {
        const widget = document.getElementById('dashboard-feast-widget');
        const nameEl = document.getElementById('dashboard-feast-name');
        const typeEl = document.getElementById('dashboard-feast-type');
        const imgEl = document.getElementById('dashboard-feast-img');
        const iconEl = document.getElementById('dashboard-feast-icon');
        if (!widget || !nameEl) return;
        getTodayFeast().then(feast => {
            if (!feast || !feast.name) { widget.style.display = 'none'; return; }
            const season = feast.season || 'Ordinary Time';
            const color = getLiturgicalSeasonColor(season);
            const bg = getLiturgicalSeasonBg(season);
            const rankLabel = getRankLabel(feast.rank);
            nameEl.textContent = feast.name;
            if (typeEl) typeEl.textContent = rankLabel ? `${rankLabel} · ${season}` : season;
            widget.style.background = bg;
            widget.style.borderLeftColor = color;
            widget.style.display = 'block';
            if (iconEl) {
                const iconMap = {
                    'Advent': 'fa-candle-snuffer',
                    'Christmas': 'fa-star',
                    'Lent': 'fa-cross',
                    'Easter': 'fa-dove',
                    'Ordinary Time': 'fa-leaf'
                };
                iconEl.className = `dashboard-feast-widget-icon fas ${iconMap[season] || 'fa-calendar'}`;
                iconEl.style.display = '';
            }
            if (imgEl) {
                loadFeastImage(feast.name, imgEl, iconEl);
            }
        }).catch(() => { widget.style.display = 'none'; });
    }, 0);

    markPerf('dashboard:render:end');
    measurePerf('dashboard:render', 'dashboard:render:start', 'dashboard:render:end');

    // Clear skeleton loading state
    const skeletonClearTarget = document.getElementById('page-content');
    if (skeletonClearTarget) delete skeletonClearTarget.dataset.hasSkeletons;

    const viewportMode = typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop';
    const todayDateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return `
        <div class="dashboard-grid dashboard-staff-view modern-dashboard${densityClass}" data-viewport="${viewportMode}">
            ${notifHTML}
            ${taggedHTML}
            ${staffViewBannerHTML}

            <!-- ── Hero Card (full width) ── -->
            <div class="card full-width dashboard-hero-card">
                <div class="dashboard-hero-orb dashboard-hero-orb-top"></div>
                <div class="dashboard-hero-orb dashboard-hero-orb-bottom"></div>
                <div class="dashboard-hero-content">
                    <div class="dashboard-hero-row">
                        <div class="dashboard-hero-copy">
                            ${isAdmin ? `<div class="dashboard-hero-eyebrow">Executive Overview</div>` : ''}
                            <div class="dashboard-hero-welcome">Welcome back, ${user.name.split(' ')[0]}</div>
                            <h2 class="dashboard-hero-title">${AppConfig?.DASHBOARD?.TITLE || 'Attendance Command Center'}</h2>
                            ${user.rating !== undefined || user.completionStats ? `<div class="dashboard-hero-chip-row">
                                ${user.rating !== undefined ? `<div class="dashboard-hero-chip"><span class="dashboard-hero-chip-label">Your Rating:</span>${renderStarRating(user.rating, true)}</div>` : ''}
                                ${user.completionStats ? `<div class="dashboard-hero-chip"><i class="fa-solid fa-check-circle dashboard-hero-chip-icon"></i><span>${(user.completionStats.completionRate * 100).toFixed(0)}% Complete</span></div>` : ''}
                            </div>` : ''}
                        </div>
                        <div class="dashboard-hero-aside">
                            ${isFullAdmin ? buildStaffSelectorBox(allUsers, user, targetStaffId) : ''}
                            <div class="dashboard-hero-meta">
                                <div class="dashboard-hero-date">${todayDateStr}</div>
                                <button class="${updateState.active ? 'dashboard-refresh-link is-update-pending' : 'dashboard-refresh-link'}" onclick="window.app_checkForSystemUpdate()" title="${updateState.active ? 'Update available. Click to refresh into the new version.' : 'Check for System Update'}">
                                    ${updateState.active ? 'System update available' : 'Check for System Update'}
                                </button>
                            </div>
                            <div class="dashboard-hero-brand" aria-hidden="true">
                                <img src="crwi-logo.png" alt="CRWI logo" class="dashboard-hero-brand-logo">
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            ${overdueTaskStripHTML ? `<div class="dashboard-hero-missed-corner-wrap">${overdueTaskStripHTML}</div>` : ''}

            <!-- ── Bento Grid Layout ── -->
            <div class="modern-bento-grid">
                <!-- Left Column (main content) -->
                <div class="modern-bento-main">
                    <div class="dashboard-primary-row" data-zone-id="primaryRow">
                        <div class="card check-in-widget dashboard-primary-card dashboard-checkin-card">
                            <div class="dashboard-checkin-head">
                                <div class="dashboard-checkin-avatar-wrap">
                                    <img src="${safeUrl(displayUser.avatar)}" alt="Profile" class="dashboard-checkin-avatar">
                                    <div class="dashboard-checkin-status-dot" data-checked-in="${isCheckedIn ? 'true' : 'false'}"></div>
                                </div>
                                <div class="dashboard-checkin-identity">
                                <h4 class="dashboard-checkin-name">${safeHtml(displayUser.name)}</h4>
                                <p class="text-muted dashboard-checkin-role">${safeHtml(displayUser.role)}</p>
                                </div>
                            </div>
                            <div class="dashboard-checkin-timer-wrap">
                                <div class="timer-display dashboard-checkin-timer" id="timer-display">${timerHTML}</div>
                                <div id="timer-label" class="dashboard-checkin-timer-label">Elapsed Time Today</div>
                            </div>
                            <div id="countdown-container" class="dashboard-checkin-countdown">
                                <div class="dashboard-checkin-countdown-meta"><span id="countdown-label">Time to checkout</span><span id="countdown-value" class="dashboard-checkin-countdown-value">--:--:--</span></div>
                                <div class="dashboard-checkin-countdown-bar"><div id="countdown-progress" class="dashboard-checkin-countdown-progress"></div></div>
                            </div>
                            <div id="overtime-container" class="dashboard-checkin-overtime">
                                <div class="dashboard-checkin-overtime-label">OVERTIME</div>
                                <div id="overtime-value" class="dashboard-checkin-overtime-value">00:00:00</div>
                            </div>
                            <div class="dashboard-checkin-action-row">
                                <button class="${btnClass} dashboard-checkin-btn" id="attendance-btn" ${isReadOnlyView ? 'disabled' : ''} title="${isReadOnlyView ? 'View only' : ''}">${btnText} <i class="fa-solid fa-fingerprint"></i></button>
                                ${pauseBtnHtml}
                            </div>
                            <div class="location-text dashboard-checkin-location" id="location-text" ${isCheckedIn && displayUser.currentLocation ? `data-lat="${displayUser.currentLocation.lat}" data-lng="${displayUser.currentLocation.lng}"` : ''}><i class="fa-solid fa-location-dot"></i><span>${isCheckedIn && displayUser.currentLocation ? `Lat: ${Number(displayUser.currentLocation.lat).toFixed(4)}, Lng: ${Number(displayUser.currentLocation.lng).toFixed(4)}` : 'Waiting for location...'}</span></div>
                        </div>
                        <div class="dashboard-primary-col">${renderYearlyPlanHTML}</div>
                        <div class="dashboard-primary-col ${!isViewingSelf ? 'dashboard-primary-col-highlight' : ''}">${renderWorkLog(currentWeekWorkPlans, collaborations, targetStaff, minutesData, {
                            title: "Today's Planned Tasks",
                            subtitle: `For ${todayStr}`,
                            from: todayStr,
                            to: todayStr,
                            emptyMessage: 'No planned tasks for today.'
                        })}</div>
                    </div>

                    ${detailSectionHTML}
                </div>

                <!-- Right Column (sidebar) -->
                <div class="modern-bento-sidebar">
                    ${statsRowHTML}
                </div>
            </div>
        </div>`;
}

// --- Internal Helper Functions (Local) ---

function formatMonthLabel(monthKey) {
    const [yearStr, monthStr] = String(monthKey || '').split('-');
    const year = Number(yearStr);
    const month = Number(monthStr) - 1;
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) return monthKey || 'Current Month';
    return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function buildStaffActivityMonthOptions(count = 8) {
    const opts = [];
    const base = new Date();
    base.setDate(1);
    for (let i = 0; i < count; i++) {
        const d = new Date(base);
        d.setMonth(base.getMonth() - i);
        const key = d.toISOString().slice(0, 7);
        opts.push({ key, label: formatMonthLabel(key) });
    }
    return opts;
}

const STATUS_RANK = { completed: 0, 'in-process': 1, overdue: 2, 'not-completed': 3, 'to-be-started': 4 };

function normalizeStaffActivityLogs(allLogs) {
    const seen = new Map();
    (allLogs || []).forEach((log) => {
        const desc = (log._displayDesc || '').trim();
        const key = `${log.staffName || ''}|${log.date || ''}|${desc}`;
        const taskStatus = normalizeTaskStatus(log, log.date, window.AppCalendar?.getSmartTaskStatus);
        const candidate = { ...log, _taskStatus: taskStatus, _taskGroup: taskStatus === 'completed' ? 'completed' : 'incomplete' };
        const existing = seen.get(key);
        if (!existing) {
            seen.set(key, candidate);
            return;
        }

        const existingRank = STATUS_RANK[existing._taskStatus] ?? 99;
        const candidateRank = STATUS_RANK[candidate._taskStatus] ?? 99;
        if (candidateRank < existingRank) {
            seen.set(key, candidate);
        }
    });

    return Array.from(seen.values());
}

function sortStaffActivityLogs(logs, sortKey) {
    const copy = [...logs];
    copy.sort((a, b) => {
        const dateDiffDesc = new Date(b.date) - new Date(a.date);
        const nameCmp = String(a.staffName || '').toLowerCase().localeCompare(String(b.staffName || '').toLowerCase());
        if (sortKey === 'date-asc') return (new Date(a.date) - new Date(b.date)) || nameCmp;
        if (sortKey === 'staff-asc') return nameCmp || dateDiffDesc;
        if (sortKey === 'staff-desc') return (-nameCmp) || dateDiffDesc;
        if (sortKey === 'completed-first') return a._taskGroup.localeCompare(b._taskGroup) || dateDiffDesc;
        if (sortKey === 'incomplete-first') return b._taskGroup.localeCompare(a._taskGroup) || dateDiffDesc;
        if (sortKey === 'status-priority') return (STATUS_RANK[a._taskStatus] ?? 99) - (STATUS_RANK[b._taskStatus] ?? 99) || dateDiffDesc || nameCmp;
        return dateDiffDesc || nameCmp;
    });
    return copy;
}

function clearTeamActivityController(el) {
    if (!el) return;
    const state = teamActivityAutoScroll.controllers.get(el);
    if (!state) return;
    if (state.intervalId) clearInterval(state.intervalId);
    if (state.pauseTimeoutId) clearTimeout(state.pauseTimeoutId);
    if (state.resumeTimeoutId) clearTimeout(state.resumeTimeoutId);
    el.removeEventListener('mouseenter', state.onMouseEnter);
    el.removeEventListener('mouseleave', state.onMouseLeave);
    el.removeEventListener('touchstart', state.onTouchStart);
    el.removeEventListener('touchend', state.onTouchEnd);
    el.removeEventListener('touchcancel', state.onTouchCancel);
    teamActivityAutoScroll.controllers.delete(el);
    teamActivityAutoScroll.elements.delete(el);
}

function disposeTeamActivityAutoScroll() {
    Array.from(teamActivityAutoScroll.elements).forEach(el => clearTeamActivityController(el));
}

// Shared auto-scroll implementation (TASK-016)
function createAutoScrollController(el, config, registry) {
    const { SCROLL_STEP_PX, TICK_MS, BOTTOM_PAUSE_MS, TOP_PAUSE_MS, EDGE_THRESHOLD_PX, STALL_TICKS_BEFORE_FLIP, TOUCH_RESUME_MS } = config;
    const state = {
        intervalId: null,
        pauseTimeoutId: null,
        resumeTimeoutId: null,
        direction: 1,
        isPausedByUser: false,
        isWaitingAtEdge: false,
        lastScrollTop: 0,
        stallTicks: 0
    };
    const waitAtEdge = (nextDirection, waitMs) => {
        state.isWaitingAtEdge = true;
        if (state.pauseTimeoutId) clearTimeout(state.pauseTimeoutId);
        state.pauseTimeoutId = setTimeout(() => {
            state.direction = nextDirection;
            state.isWaitingAtEdge = false;
            state.stallTicks = 0;
        }, waitMs);
    };
    const tick = () => {
        if (state.isPausedByUser || state.isWaitingAtEdge || !el.isConnected) return;
        const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
        if (maxScroll <= 0) {
            state.stallTicks = 0;
            state.lastScrollTop = 0;
            return;
        }
        el.scrollTop += (SCROLL_STEP_PX * state.direction);
        const nearBottom = el.scrollTop >= (maxScroll - EDGE_THRESHOLD_PX);
        const nearTop = el.scrollTop <= EDGE_THRESHOLD_PX;
        if (state.direction === 1 && nearBottom) {
            el.scrollTop = maxScroll;
            waitAtEdge(-1, BOTTOM_PAUSE_MS);
            return;
        }
        if (state.direction === -1 && nearTop) {
            el.scrollTop = 0;
            waitAtEdge(1, TOP_PAUSE_MS);
            return;
        }
        if (Math.abs(el.scrollTop - state.lastScrollTop) < 0.2) {
            state.stallTicks += 1;
            if (state.stallTicks >= STALL_TICKS_BEFORE_FLIP) {
                state.direction *= -1;
                state.stallTicks = 0;
            }
        } else {
            state.stallTicks = 0;
        }
        state.lastScrollTop = el.scrollTop;
    };
    state.onMouseEnter = () => { state.isPausedByUser = true; };
    state.onMouseLeave = () => { state.isPausedByUser = false; };
    state.onTouchStart = () => { state.isPausedByUser = true; if (state.resumeTimeoutId) clearTimeout(state.resumeTimeoutId); };
    state.onTouchEnd = () => { if (state.resumeTimeoutId) clearTimeout(state.resumeTimeoutId); state.resumeTimeoutId = setTimeout(() => { state.isPausedByUser = false; }, TOUCH_RESUME_MS); };
    state.onTouchCancel = () => { state.isPausedByUser = false; };
    el.addEventListener('mouseenter', state.onMouseEnter);
    el.addEventListener('mouseleave', state.onMouseLeave);
    el.addEventListener('touchstart', state.onTouchStart, { passive: true });
    el.addEventListener('touchend', state.onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', state.onTouchCancel, { passive: true });
    state.intervalId = setInterval(tick, TICK_MS);
    registry.controllers.set(el, state);
    registry.elements.add(el);
}

function clearAutoScrollController(el, registry) {
    if (!el) return;
    const state = registry.controllers.get(el);
    if (!state) return;
    if (state.intervalId) clearInterval(state.intervalId);
    if (state.pauseTimeoutId) clearTimeout(state.pauseTimeoutId);
    if (state.resumeTimeoutId) clearTimeout(state.resumeTimeoutId);
    el.removeEventListener('mouseenter', state.onMouseEnter);
    el.removeEventListener('mouseleave', state.onMouseLeave);
    el.removeEventListener('touchstart', state.onTouchStart);
    el.removeEventListener('touchend', state.onTouchEnd);
    el.removeEventListener('touchcancel', state.onTouchCancel);
    registry.controllers.delete(el);
    registry.elements.delete(el);
}

function disposeAutoScrollRegistry(registry) {
    Array.from(registry.elements).forEach(el => clearAutoScrollController(el, registry));
}

const AUTO_SCROLL_CONFIG_TEAM = { SCROLL_STEP_PX: 1.2, TICK_MS: 35, BOTTOM_PAUSE_MS: 1400, TOP_PAUSE_MS: 900, EDGE_THRESHOLD_PX: 2, STALL_TICKS_BEFORE_FLIP: 20, TOUCH_RESUME_MS: 400 };
const AUTO_SCROLL_CONFIG_WORKLOG = { SCROLL_STEP_PX: 1, TICK_MS: 38, BOTTOM_PAUSE_MS: 1200, TOP_PAUSE_MS: 900, EDGE_THRESHOLD_PX: 2, STALL_TICKS_BEFORE_FLIP: 20, TOUCH_RESUME_MS: 350 };

function initAutoScroll(container, selector, config, registry) {
    if (!container) return;
    disposeAutoScrollRegistry(registry);
    // Respect prefers-reduced-motion
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const elements = container.querySelectorAll(selector);
    elements.forEach(el => createAutoScrollController(el, config, registry));
}

function initTeamActivityAutoScroll(container) {
    initAutoScroll(container, '.dashboard-team-activity-col-list', AUTO_SCROLL_CONFIG_TEAM, teamActivityAutoScroll);
}

function initWorklogAutoScroll(container = document) {
    initAutoScroll(container, '.dashboard-worklog-list', AUTO_SCROLL_CONFIG_WORKLOG, worklogAutoScroll);
}

const refreshStaffActivityWidget = async (fetchLogs = true, options = {}) => {
    const state = getStaffActivityState();
    const primaryListId = options.listId || 'staff-activity-list';
    const primaryLabelId = options.labelId || 'staff-activity-range-label';
    const list = document.getElementById(primaryListId);
    const modalList = document.getElementById('staff-activity-list-modal');
    if (!list && !modalList) {
        throw new Error('Staff activity DOM elements not found');  // Let caller retry
    }
    disposeTeamActivityAutoScroll();
    if (fetchLogs) {
        if (window.AppAnalytics) {
            state.logs = await window.AppAnalytics.getAllStaffActivities({ mode: 'month', month: state.selectedMonth, scope: 'all', sideEffects: false });
        }
    }
    const html = renderStaffActivityListSplit(state.logs, state.sortKey);
    if (list) { list.innerHTML = html; initTeamActivityAutoScroll(list); }
    if (modalList) { modalList.innerHTML = html; }
    const subtitle = document.getElementById(primaryLabelId) || document.getElementById('staff-activity-range-label');
    if (subtitle) subtitle.textContent = formatMonthLabel(state.selectedMonth);
};

// --- Export to Window (Global) ---
if (typeof window !== 'undefined') {
    if (!window.__dashboardMaxEscHandlerBound) {
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && document.body.classList.contains('dashboard-max-open')) {
                window.app_closeDashboardCardMaximize?.();
            }
        });
        window.__dashboardMaxEscHandlerBound = true;
    }

    window.app_closeDashboardCardFullscreen = closeDashboardCardMaxOverlay;
    window.app_closeDashboardCardMaximize = closeDashboardCardMaxOverlay;
    window.app_toggleDashboardCardMode = (cardId, mode = DASHBOARD_CARD_MODE_TILE, triggerEl = null) => {
        if (!cardId) return;
        const safeMode = DASHBOARD_CARD_MODES.has(mode) ? mode : DASHBOARD_CARD_MODE_TILE;
        if (
            safeMode === DASHBOARD_CARD_MODE_FULLSCREEN
            && DASHBOARD_SECTION_ROUTE_CARD_IDS.has(String(cardId || '').trim())
            && typeof window.app_openDashboardSection === 'function'
        ) {
            window.app_openDashboardSection(String(cardId || '').trim());
            return;
        }
        const cardEl = getDashboardCardElementById(cardId);
        const currentMode = String(cardEl?.dataset?.dashboardCardMode || DASHBOARD_CARD_MODE_TILE);
        if (currentMode === safeMode && safeMode !== DASHBOARD_CARD_MODE_TILE) {
            applyDashboardCardMode(cardId, DASHBOARD_CARD_MODE_TILE, triggerEl || null);
            return;
        }
        if (safeMode === DASHBOARD_CARD_MODE_FULLSCREEN && window._dashboardMaxCardId === cardId) {
            closeDashboardCardMaxOverlay();
            applyDashboardCardMode(cardId, DASHBOARD_CARD_MODE_TILE);
            return;
        }
        applyDashboardCardMode(cardId, safeMode, triggerEl || null);
        if (safeMode === DASHBOARD_CARD_MODE_FULLSCREEN && String(cardId || '').trim() === 'hero-week') {
            setTimeout(() => {
                window.app_refreshHeroAuditLive?.();
            }, 0);
        }
    };
    window.app_toggleDashboardCardMaximize = (cardId, triggerEl = null) => {
        window.app_toggleDashboardCardMode?.(cardId, DASHBOARD_CARD_MODE_FULLSCREEN, triggerEl || null);
    };

    window.app_editDashboardActivity = async function (kind, logId, dateStr, targetStaffId, meetingId) {
        const mode = String(kind || '').trim();
        if (mode === 'minute') {
            if (window.app_openMinuteDetails) window.app_openMinuteDetails(String(meetingId || ''));
            else window.location.hash = 'minutes';
            return;
        }

        if (mode === 'attendance') {
            const id = String(logId || '').trim();
            if (!id || id === 'active_now') return;
            let currentDesc = '';
            try {
                const existing = await window.AppDB.get('attendance', id);
                currentDesc = String(existing?.workDescription || '');
            } catch {
                currentDesc = '';
            }

            let newDesc = null;
            if (window.appPrompt) {
                newDesc = await window.appPrompt('Update Work Summary:', currentDesc, { title: 'Update Work Summary', confirmText: 'Save' });
            } else {
                newDesc = window.prompt('Update Work Summary:', currentDesc);
            }
            if (newDesc === null) return;

            await window.AppAttendance.updateLog(id, { workDescription: String(newDesc) });
            if (window.app_refreshDashboard) await window.app_refreshDashboard();
            return;
        }

        if (window.app_openDayPlan) {
            window.app_openDayPlan(String(dateStr || ''), String(targetStaffId || ''));
        }
    };

    window.app_filterActivity = async function (startId = 'act-start', endId = 'act-end', listId = 'activity-list') {
        const start = document.getElementById(startId)?.value;
        const end = document.getElementById(endId)?.value;
        const list = document.getElementById(listId);
        const ctx = window.app_dashboardWorklogContext || {};
        if (!start || !end || !list) return;
        ctx.page = 1;
        list.innerHTML = renderActivityList(
            Array.isArray(ctx.logs) ? ctx.logs : [],
            start,
            end,
            ctx.targetStaffId || window.AppAuth?.getUser?.()?.id || '',
            Array.isArray(ctx.collaborations) ? ctx.collaborations : [],
            Array.isArray(ctx.minutesData) ? ctx.minutesData : [],
            { page: ctx.page || 1, pageSize: ctx.pageSize || WORKLOG_PAGE_SIZE, listId }
        );
        initWorklogAutoScroll(document);
    };

    window.app_loadMoreActivity = function (listId = 'activity-list') {
        const ctx = window.app_dashboardWorklogContext || {};
        const list = document.getElementById(listId);
        const start = document.getElementById(listId === 'activity-list-max' ? 'act-start-max' : 'act-start')?.value;
        const end = document.getElementById(listId === 'activity-list-max' ? 'act-end-max' : 'act-end')?.value;
        if (!list || !start || !end) return;
        ctx.page = Math.max(1, Number(ctx.page || 1) + 1);
        list.innerHTML = renderActivityList(
            Array.isArray(ctx.logs) ? ctx.logs : [],
            start,
            end,
            ctx.targetStaffId || window.AppAuth?.getUser?.()?.id || '',
            Array.isArray(ctx.collaborations) ? ctx.collaborations : [],
            Array.isArray(ctx.minutesData) ? ctx.minutesData : [],
            { page: ctx.page, pageSize: ctx.pageSize || WORKLOG_PAGE_SIZE, listId }
        );
        initWorklogAutoScroll(document);
    };

    window.app_setStaffActivityMonth = async function (value, listId = 'staff-activity-list', labelId = 'staff-activity-range-label') {
        const state = getStaffActivityState();
        const normalized = String(value || '').trim();
        if (!/^\d{4}-\d{2}$/.test(normalized)) return;
        state.selectedMonth = normalized;
        await refreshStaffActivityWidget(true, { listId, labelId });
    };

    window.app_setStaffActivitySort = async function (value, listId = 'staff-activity-list', labelId = 'staff-activity-range-label') {
        const state = getStaffActivityState();
        const nextSort = String(value || '').trim() || 'date-newest';
        state.sortKey = nextSort;
        await refreshStaffActivityWidget(false, { listId, labelId });
    };

    window.app_setStaffActivityView = async function (mode) {
        const state = getStaffActivityState();
        state.activityViewMode = mode === 'my' ? 'my' : 'team';
        await refreshStaffActivityWidget(false);
    };

    window.app_saveDashboardCustomization = async function () {
        const widget = document.querySelector('.dashboard-customization-widget');
        if (!widget) return;
        const settings = window.app_dashboardCustomization?.getDefaults() || {};
        const checks = widget.querySelectorAll('input[data-customize-key]');
        checks.forEach(cb => {
            const key = cb.getAttribute('data-customize-key');
            if (key.startsWith('widgetVisibility.')) {
                const widgetKey = key.replace('widgetVisibility.', '');
                settings.widgetVisibility[widgetKey] = cb.checked;
            } else if (key === 'globalAdminMirror') {
                settings.globalAdminMirror = cb.checked;
            }
        });
        const density = widget.querySelector('input[name="customize-density"]:checked');
        if (density) settings.layoutDensity = density.value;
        await window.app_dashboardCustomization?.saveSettings(settings);
    };

    window.app_setDashboardLeaveHistoryDate = async function (value) {
        const state = getStaffActivityState();
        state.leaveHistoryDate = value || new Date().toISOString().slice(0, 10);
        const contentArea = document.getElementById('page-content');
        window.app_closeDashboardCardFullscreen?.();
        if (contentArea) contentArea.innerHTML = await renderDashboard();
    };

    window.app_expandTeamActivity = function () {
        const card = document.querySelector('.dashboard-staff-view .dashboard-team-activity-card');
        window.app_toggleDashboardCardMode?.('team-activity', DASHBOARD_CARD_MODE_FULLSCREEN, card || null);
    };

    window.app_openStatsDetailModal = function (type) {
        const normalized = String(type || '').trim() === 'yearly' ? 'yearly' : 'monthly';
        const card = document.querySelector(`.dashboard-staff-view .dashboard-stats-card[data-stats-type="${normalized}"]`);
        window.app_toggleDashboardCardMode?.(`stats-${normalized}`, DASHBOARD_CARD_MODE_FULLSCREEN, card || null);
    };

    window.app_closeStatsDetailModal = function () {
        window.app_closeDashboardCardFullscreen?.();
    };

    window.app_updateStatsDetailView = function () { };

    window.app_attachStatsCardHandlers = function () {
        attachStatsCardHandlers();
        attachHeroCardHandlers();
    };

    window.app_openHeroTaskList = function (userId, bucketKey) {
        const leaderboard = window.app_dashboardHeroLeaderboard;
        const rows = Array.isArray(leaderboard?.rows) ? leaderboard.rows : [];
        const target = rows.find((row) => String(row?.user?.id || '') === String(userId || ''));
        if (!target) return;
        let overlay = document.getElementById('hero-task-modal-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'hero-task-modal-overlay';
            overlay.className = 'modal-overlay hero-task-modal-overlay';
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) window.app_closeHeroTaskList?.();
            });
            document.body.appendChild(overlay);
        }
        window.app_heroTaskModalState = { userId: String(userId || ''), bucketKey: String(bucketKey || '') };
        overlay.innerHTML = `<div class="modal-content hero-task-modal-shell">${renderHeroTaskDetailsModalContent(target, String(bucketKey || ''))}</div>`;
        overlay.style.display = 'flex';
    };

    window.app_refreshHeroAuditLive = async function ({ reopenTaskList = false } = {}) {
        try {
            const [liveHero, liveLeaderboard] = await Promise.all([
                window.AppAnalytics.getHeroOfTheWeek({ source: 'live_audit' }),
                window.AppAnalytics.getHeroLeaderboard({ source: 'live_audit' })
            ]);
            setDashboardHeroBundle(
                liveHero && liveHero.state !== 'fetch_error' ? liveHero : window.app_dashboardHeroData,
                liveLeaderboard && liveLeaderboard.state !== 'fetch_error' ? liveLeaderboard : window.app_dashboardHeroLeaderboard,
                {
                    ...(window.app_dashboardHeroMeta || {}),
                    generatedAt: Date.now(),
                    source: 'live_audit'
                }
            );
            updateHeroExpandedOverlay();
            if (reopenTaskList && window.app_heroTaskModalState?.userId && window.app_heroTaskModalState?.bucketKey) {
                window.app_openHeroTaskList(window.app_heroTaskModalState.userId, window.app_heroTaskModalState.bucketKey);
            }
        } catch (err) {
            console.warn('Failed to refresh live hero audit:', err);
        }
    };

    window.app_closeHeroTaskList = function () {
        const overlay = document.getElementById('hero-task-modal-overlay');
        if (overlay) overlay.remove();
        window.app_heroTaskModalState = null;
    };

    window.app_refreshHeroTaskList = async function (userId, bucketKey) {
        window.app_heroTaskModalState = { userId: String(userId || ''), bucketKey: String(bucketKey || '') };
        await window.app_refreshHeroAuditLive({ reopenTaskList: true });
    };

    window.app_canManageHeroTaskActions = function (userId) {
        const currentUser = window.AppAuth?.getUser?.();
        if (!currentUser) return false;
        return String(currentUser.id || '') === String(userId || '')
            || window.app_hasPerm?.('dashboard', 'admin', currentUser);
    };

    window.app_requireHeroTaskManagePermission = function (userId) {
        if (window.app_canManageHeroTaskActions?.(userId)) return true;
        alert('You can only change your own hero task list.');
        return false;
    };

    window.app_applyHeroTaskOptimisticUpdate = function (userId, bucketKey, planId, taskIndex, action) {
        const leaderboard = window.app_dashboardHeroLeaderboard;
        const rows = Array.isArray(leaderboard?.rows) ? leaderboard.rows : null;
        if (!rows) return;
        const row = rows.find((item) => String(item?.user?.id || '') === String(userId || ''));
        if (!row || !row.taskBuckets || !row.stats) return;

        const fromKey = String(bucketKey || '');
        const buckets = row.taskBuckets;
        const sourceList = Array.isArray(buckets[fromKey]) ? buckets[fromKey] : [];
        const idx = sourceList.findIndex((task) => String(task?.planId || '') === String(planId || '') && Number(task?.taskIndex) === Number(taskIndex));
        if (idx < 0) return;

        const [task] = sourceList.splice(idx, 1);
        row.stats.taskPlanned = Math.max(0, Number(row.stats.taskPlanned || 0) - (action === 'delete' ? 1 : 0));
        if (fromKey === 'completed') row.stats.taskCompleted = Math.max(0, Number(row.stats.taskCompleted || 0) - 1);
        if (fromKey === 'in_progress') row.stats.taskInProgress = Math.max(0, Number(row.stats.taskInProgress || 0) - 1);
        if (fromKey === 'postponed') row.stats.taskPostponed = Math.max(0, Number(row.stats.taskPostponed || 0) - 1);
        if (fromKey === 'missed') row.stats.taskMissed = Math.max(0, Number(row.stats.taskMissed || 0) - 1);

        if (action === 'complete') {
            const nextTask = {
                ...task,
                status: 'completed',
                rawStatus: 'completed',
                completedDate: new Date().toISOString().split('T')[0]
            };
            buckets.completed = Array.isArray(buckets.completed) ? buckets.completed : [];
            buckets.completed.unshift(nextTask);
            row.stats.taskCompleted = Number(row.stats.taskCompleted || 0) + 1;
        } else if (action === 'postpone') {
            const nextTask = {
                ...task,
                status: 'postponed',
                rawStatus: 'postponed'
            };
            buckets.postponed = Array.isArray(buckets.postponed) ? buckets.postponed : [];
            buckets.postponed.unshift(nextTask);
            row.stats.taskPostponed = Number(row.stats.taskPostponed || 0) + 1;
        }

        updateHeroExpandedOverlay();
    };

    window.app_scheduleHeroAuditRefresh = function (userId, bucketKey) {
        window.app_refreshHeroTaskList(userId, bucketKey).catch((err) => {
            console.warn('Hero audit refresh failed:', err);
        });
    };

    window.app_completeHeroTaskAction = async function (planId, taskIndex, userId, bucketKey) {
        if (!window.app_requireHeroTaskManagePermission?.(userId)) return;
        window.app_applyHeroTaskOptimisticUpdate(userId, bucketKey, planId, taskIndex, 'complete');
        await window.app_markTaskCompleted(planId, taskIndex);
        await window.app_refreshHeroTaskList(userId, bucketKey);
    };

    window.app_postponeHeroTaskAction = async function (planId, taskIndex, userId, bucketKey) {
        if (!window.app_requireHeroTaskManagePermission?.(userId)) return;
        const modalId = 'postpone-task-modal';
        document.getElementById(modalId)?.remove();
        let tomorrow = '';
        try {
            const istNow = window.AppDB?.getIstNow ? window.AppDB.getIstNow() : new Date();
            const tmr = new Date(istNow);
            tmr.setDate(tmr.getDate() + 1);
            tomorrow = window.AppDB?.toDateKey ? window.AppDB.toDateKey(tmr) : `${tmr.getFullYear()}-${String(tmr.getMonth() + 1).padStart(2, '0')}-${String(tmr.getDate()).padStart(2, '0')}`;
        } catch {
            tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        }
        const html = `
            <div class="modal-overlay" id="${modalId}">
                <div class="modal-content postpone-modal-content">
                    <div class="postpone-modal-head">
                        <h3>Postpone Task</h3>
                        <button type="button" class="postpone-modal-close" data-ts-action="close-modal" data-modal-id="${modalId}">&times;</button>
                    </div>
                    <label for="hero-postpone-date-input" class="postpone-modal-label">Select date</label>
                    <input id="hero-postpone-date-input" type="date" value="${tomorrow}" class="postpone-modal-input">
                    <div class="postpone-modal-actions">
                        <button type="button" class="action-btn secondary" data-ts-action="close-modal" data-modal-id="${modalId}">Cancel</button>
                        <button type="button" class="action-btn" data-ts-action="confirm-postpone" data-plan-id="${escapeJsSingleQuote(String(planId || ''))}" data-task-index="${Number(taskIndex)}" data-user-id="${escapeJsSingleQuote(String(userId || ''))}" data-bucket-key="${escapeJsSingleQuote(String(bucketKey || ''))}">Confirm</button>
                    </div>
                </div>
            </div>`;
        window.app_showModal(html, modalId);
    };

    window.app_confirmHeroPostponeTask = async function (planId, taskIndex, userId, bucketKey) {
        if (!window.app_requireHeroTaskManagePermission?.(userId)) return;
        const targetDate = document.getElementById('hero-postpone-date-input')?.value;
        if (!targetDate) {
            alert('Please select a date.');
            return;
        }
        const plan = await window.AppDB?.get('work_plans', planId).catch(() => null);
        const fromDate = plan?.date || '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || (fromDate && targetDate <= fromDate)) {
            alert('Postpone date must be after the source date.');
            return;
        }
        document.getElementById('postpone-task-modal')?.remove();
        window.app_applyHeroTaskOptimisticUpdate(userId, bucketKey, planId, taskIndex, 'postpone');
        await window.app_postponeTask(planId, taskIndex, targetDate);
        await window.app_refreshHeroTaskList(userId, bucketKey);
    };

    window.app_deleteHeroTaskAction = async function (planId, taskIndex, userId, bucketKey) {
        if (!window.app_requireHeroTaskManagePermission?.(userId)) return;
        if (!window.AppCalendar?.removeTask) return;
        if (!await window.appConfirm('Delete this plan from the hero audit list?')) return;
        window.app_applyHeroTaskOptimisticUpdate(userId, bucketKey, planId, taskIndex, 'delete');
        await window.AppCalendar.removeTask(planId, taskIndex);
        await window.app_refreshHeroTaskList(userId, bucketKey);
    };

    window.app_editHeroTaskAction = async function (date, userId) {
        if (!window.app_requireHeroTaskManagePermission?.(userId)) return;
        window.app_closeHeroTaskList?.();
        window.app_closeDashboardCardFullscreen?.();
        const safeDate = String(date || '').trim();
        const safeUserId = String(userId || '').trim();
        setTimeout(async () => {
            try {
                if (window.AppDayPlan?.openDayPlan) {
                    await window.AppDayPlan.openDayPlan(safeDate, safeUserId);
                } else if (window.app_openDayPlan) {
                    await window.app_openDayPlan(safeDate, safeUserId);
                }
                const modal = document.getElementById('day-plan-modal');
                if (modal) {
                    const heroLayers = Array.from(document.querySelectorAll('.dashboard-max-overlay, .dashboard-max-window, .hero-task-modal-overlay, .hero-task-modal-shell'))
                        .filter((el) => el && el !== modal);
                    const maxZ = heroLayers.reduce((acc, el) => {
                        const z = Number.parseInt(window.getComputedStyle(el).zIndex, 10);
                        return Number.isFinite(z) ? Math.max(acc, z) : acc;
                    }, 1400);
                    modal.style.zIndex = String(maxZ + 20);
                }
            } catch (err) {
                console.error('Failed to open day plan from hero audit:', err);
                alert(`Unable to open plan editor: ${err.message || err}`);
            }
        }, 80);
    };

    window.app_expandTeamActivityRefresh = async function () {
        await refreshStaffActivityWidget(false, { listId: 'staff-activity-list-max', labelId: 'staff-activity-range-label-max' });
    };

    window.app_closeTeamActivityExpanded = function () {
        const modal = document.getElementById('team-activity-modal-overlay');
        if (modal) {
            modal.remove();
            document.body.style.overflow = '';
            window.removeEventListener('keydown', window._teamActivityEscHandler);
        }
    };

    window.app_forceRefreshHero = async function (event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        
        const currentUser = window.AppAuth.getUser();
        const isFullAdmin = window.app_hasPerm('dashboard', 'admin', currentUser);
        if (!isFullAdmin) {
            alert("Only admins can refresh the hero stats.");
            return;
        }

        const dateKeys = window.AppDB?.getISTDateKeys ? window.AppDB.getISTDateKeys() : {
            todayKey: new Date().toISOString().split('T')[0]
        };
        const todayStr = dateKeys.todayKey;

        // Visual feedback
        const btn = document.querySelector('.hero-refresh-btn');
        let originalContent = '';
        if (btn) {
            originalContent = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }

        try {
            // Fetch latest daily summary directly from Firestore to check if already refreshed
            const ds = await window.AppDB.get('daily_summaries', todayStr, { source: 'server' });
            const refreshCount = Number(ds?.heroRefreshCount || 0);
            const maxRefreshes = AppConfig?.DASHBOARD?.MAX_REFRESHES || 3;
            if (refreshCount >= maxRefreshes) {
                alert(`The Hero of the Week has already been refreshed ${maxRefreshes} times today.`);
                // Reload dashboard to update UI
                const html = await renderDashboard();
                const content = document.getElementById('page-content');
                if (content) {
                    content.innerHTML = html;
                    window.setupDashboardEvents?.();
                }
                return;
            }

            // Step 1: Clear ALL memory caches FIRST so fresh data is fetched from Firestore
            window.AppDB.cache.clear();            // clears DB read cache (attendance, users, work_plans, daily_summaries)
            window.AppAnalytics?.clearMemo?.();    // clears analytics memoized datasets (hero shared, attendance ranges etc)

            // Generate fresh summary data — runs against cleared caches, so Firestore is re-queried
            const freshData = await window.AppAnalytics.buildDailyDashboardSummary({ dateKey: todayStr, selectedMonth: todayStr.slice(0, 7) });
            
            // Mark as refreshed
            const payload = {
                ...(freshData || {}),
                heroRefreshCount: refreshCount + 1,
                generatedAt: Date.now(),
                generatedBy: currentUser.id,
                version: Number(AppConfig?.SUMMARY_POLICY?.SCHEMA_VERSION || 1)
            };

            // Save to Firestore
            await window.AppDB.putDailySummary(todayStr, payload);
            await window.AppDB.setLatestSuccessfulSummaryMeta({
                dateKey: todayStr,
                generatedAt: payload.generatedAt,
                version: payload.version
            });

            // Clear again so the re-render reads the newly-written Firestore doc, not a cached version
            window.AppDB.invalidateCollectionCache('daily_summaries');
            window.AppAnalytics?.clearMemo?.('analytics:heroShared');

            alert("Hero stats refreshed successfully!");
            
            // Re-render
            const html = await renderDashboard();
            const content = document.getElementById('page-content');
            if (content) {
                content.innerHTML = html;
                window.setupDashboardEvents?.();
            }
        } catch (err) {
            console.error("Failed to force refresh hero:", err);
            alert("Failed to refresh hero stats: " + err.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalContent;
            }
        }
    };
    window.app_renderCustomizationWidget = renderCustomizationWidget;
}


