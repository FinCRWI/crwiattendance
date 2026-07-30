import { safeHtml } from './helpers.js';
import { AppConfig } from '../config.js';
import { renderLeaveHistory, renderLeaveRequests, renderPlannedTasksCard, renderStatsCard } from './dashboard.js';
import { renderStaffDirectoryPage } from './staff-directory.js';

const SECTION_CACHE_TTL_MS = 45000;
const SECTION_ROUTE_PREFIX = 'dashboard-section/';
const SUPPORTED_SECTIONS = new Set([
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

const toIstDate = (value = new Date()) => {
    const base = value instanceof Date ? value : new Date(value);
    return new Date(base.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
};

const toIsoDate = (value) => {
    const dt = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const normalizeIsoDate = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : toIsoDate(parsed);
};

const normalizeRowDate = (row, fields = []) => {
    for (const field of fields) {
        const value = normalizeIsoDate(row?.[field]);
        if (value) return value;
    }
    return '';
};

const getCurrentWeekRange = () => {
    const now = toIstDate();
    const day = now.getDay();
    const diffToMonday = (day + 6) % 7;
    const start = new Date(now);
    start.setDate(now.getDate() - diffToMonday);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return {
        from: toIsoDate(start),
        to: toIsoDate(end)
    };
};

const getCurrentDayRange = () => {
    const now = toIstDate();
    const iso = toIsoDate(now);
    return {
        from: iso,
        to: iso
    };
};

const getSectionState = () => {
    if (!window.app_dashboardSectionState) {
        window.app_dashboardSectionState = {
            rangeBySection: {},
            errorsBySection: {},
            cache: {}
        };
    }
    return window.app_dashboardSectionState;
};

const getRangeForSection = (sectionKey) => {
    const state = getSectionState();
    if (!state.rangeBySection[sectionKey]) {
        state.rangeBySection[sectionKey] = sectionKey === 'worklog'
            ? getCurrentDayRange()
            : getCurrentWeekRange();
    }
    return state.rangeBySection[sectionKey];
};

const setRangeForSection = (sectionKey, from, to) => {
    const state = getSectionState();
    state.rangeBySection[sectionKey] = { from, to };
};

const setErrorForSection = (sectionKey, message = '') => {
    const state = getSectionState();
    state.errorsBySection[sectionKey] = String(message || '');
};

const getErrorForSection = (sectionKey) => {
    const state = getSectionState();
    return String(state.errorsBySection?.[sectionKey] || '');
};

const inRange = (dateKey, from, to) => {
    const key = normalizeIsoDate(dateKey);
    return !!key && key >= from && key <= to;
};

const getCached = async (key, fetcher, ttlMs = SECTION_CACHE_TTL_MS) => {
    const state = getSectionState();
    const now = Date.now();
    const found = state.cache[key];
    if (found && found.expiresAt > now) return found.value;
    const value = await fetcher();
    state.cache[key] = { value, expiresAt: now + ttlMs };
    return value;
};

const queryByDateLowerBound = async (collectionName, field, fromIso) => {
    if (!window.AppDB?.query) return [];
    try {
        return await window.AppDB.query(collectionName, field, '>=', fromIso);
    } catch (err) {
        console.warn(`Date-bounded query failed for ${collectionName}.${field}:`, err);
        return [];
    }
};

const getTargetStaffId = () => {
    const user = window.AppAuth?.getUser?.();
    if (!user) return '';
    const isAdmin = !!window.app_hasPerm?.('dashboard', 'view', user);
    return (isAdmin && window.app_selectedSummaryStaffId) ? window.app_selectedSummaryStaffId : user.id;
};

const getAttendanceForTarget = async (targetUserId, from, to) => {
    const cacheKey = `att-target:${targetUserId}:${from}:${to}`;
    return getCached(cacheKey, async () => {
        const rows = await window.AppDB.query('attendance', 'user_id', '==', targetUserId);
        return (rows || [])
            .map((row) => ({ ...row, _dateKey: normalizeRowDate(row, ['date']) }))
            .filter((row) => inRange(row._dateKey, from, to))
            .sort((a, b) => new Date(b._dateKey) - new Date(a._dateKey))
            .slice(0, 400);
    });
};

const getAttendanceForRangeAllStaff = async (from, to) => {
    const cacheKey = `att-all:${from}:${to}`;
    return getCached(cacheKey, async () => {
        const rows = await queryByDateLowerBound('attendance', 'date', from);
        return (rows || [])
            .map((row) => ({ ...row, _dateKey: normalizeRowDate(row, ['date']) }))
            .filter((row) => inRange(row._dateKey, from, to))
            .slice(0, 800);
    });
};

const getLeavesForRange = async (from, to) => {
    const cacheKey = `leaves:${from}:${to}`;
    return getCached(cacheKey, async () => {
        const rows = await queryByDateLowerBound('leaves', 'startDate', from);
        return (rows || [])
            .map((row) => ({
                ...row,
                _dateKey: normalizeRowDate(row, ['appliedOn', 'actionDate', 'startDate'])
            }))
            .filter((row) => inRange(row._dateKey, from, to))
            .slice(0, 500);
    });
};

const getWorkPlansForRange = async (from, to) => {
    const cacheKey = `work-plans:${from}:${to}`;
    return getCached(cacheKey, async () => {
        const rows = await queryByDateLowerBound('work_plans', 'date', from);
        return (rows || [])
            .map((row) => ({ ...row, _dateKey: normalizeRowDate(row, ['date']) }))
            .filter((row) => inRange(row._dateKey, from, to))
            .slice(0, 600);
    });
};

const computeRangeStats = (logs, label) => {
    const breakdown = {
        Present: 0,
        Late: 0,
        'Early Departure': 0,
        'Work - Home': 0,
        Training: 0,
        'Sick Leave': 0,
        'Casual Leave': 0,
        'Earned Leave': 0,
        'Paid Leave': 0,
        'Maternity Leave': 0,
        'Retreat Leave': 0,
        'Staff Development Leave': 0,
        Absent: 0,
        Holiday: 0,
        'National Holiday': 0,
        'Regional Holidays': 0
    };

    (logs || []).forEach((log) => {
        const type = String(log?.type || '').trim();
        if (type in breakdown) {
            breakdown[type] += 1;
        } else if (type.includes('Holiday')) {
            breakdown.Holiday += 1;
        } else if (log?.checkIn) {
            breakdown.Present += 1;
        }
        if (log?.lateCountable === true || type === 'Late') {
            breakdown.Late += 1;
        }
    });

    const present = breakdown.Present + breakdown['Work - Home'] + breakdown.Training;
    const leaves = breakdown['Sick Leave'] + breakdown['Casual Leave'] + breakdown['Earned Leave'] + breakdown['Paid Leave'] + breakdown['Maternity Leave'] + breakdown['Retreat Leave'] + breakdown['Staff Development Leave'] + breakdown.Absent;
    const late = breakdown.Late;
    const penalty = Math.floor((late || 0) / 3) * 0.5;

    return {
        present,
        late,
        leaves,
        unpaidLeaves: breakdown['Sick Leave'] + breakdown.Absent,
        penalty,
        penaltyOffset: 0,
        effectivePenalty: penalty,
        extraWorkedHours: 0,
        earlyDepartures: breakdown['Early Departure'],
        label,
        breakdown,
        totalLateDuration: '0h 0m',
        totalExtraDuration: '0h 0m'
    };
};

const buildSectionShell = ({ sectionKey, title, from, to, bodyHtml, resetLabel = 'Reset to Current Week' }) => {
    const error = getErrorForSection(sectionKey);
    return `
        <div class="dashboard-section-page" data-dashboard-section="${safeHtml(sectionKey)}">
            <div class="dashboard-section-head">
                <div>
                    <h2>${safeHtml(title)}</h2>
                    <p>Weekly-first data loading. Expand only when needed.</p>
                </div>
                <button class="action-btn secondary" type="button" onclick="window.app_backToDashboard()">
                    <i class="fa-solid fa-arrow-left"></i> Back to Dashboard
                </button>
            </div>
            <div class="dashboard-section-filter-bar">
                <label>From <input id="dashboard-section-from-${safeHtml(sectionKey)}" type="date" value="${safeHtml(from)}"></label>
                <label>To <input id="dashboard-section-to-${safeHtml(sectionKey)}" type="date" value="${safeHtml(to)}"></label>
                <button class="action-btn" type="button" onclick="window.app_applyDashboardSectionDateRange('${safeHtml(sectionKey)}')">Apply</button>
                <button class="action-btn secondary" type="button" onclick="window.app_setDashboardSectionDateRange('${safeHtml(sectionKey)}','','')">${safeHtml(resetLabel)}</button>
            </div>
            ${error ? `<div class="dashboard-section-error">${safeHtml(error)}</div>` : ''}
            <div class="dashboard-section-body">${bodyHtml}</div>
        </div>
    `;
};

const renderCheckinSection = async (from, to) => {
    const user = window.AppAuth?.getUser?.();
    const targetStaffId = getTargetStaffId();
    const [status, logs] = await Promise.all([
        window.AppAttendance?.getStatus?.(),
        getAttendanceForTarget(targetStaffId, from, to)
    ]);
    const presentDays = new Set((logs || []).map((l) => l._dateKey)).size;
    const title = targetStaffId === user?.id ? 'My Check-in & Status' : 'Staff Check-in & Status';
    const rows = (logs || []).slice(0, 50).map((log) => `
        <tr>
            <td>${safeHtml(log._dateKey || '--')}</td>
            <td>${safeHtml(log.checkIn || '--')}</td>
            <td>${safeHtml(log.checkOut || '--')}</td>
            <td>${safeHtml(log.type || 'Attendance')}</td>
        </tr>
    `).join('');
    return {
        title,
        html: `
            <div class="card">
                <div class="dashboard-section-kpis">
                    <div class="dashboard-section-kpi"><span>Status</span><strong>${safeHtml(status?.status || 'out')}</strong></div>
                    <div class="dashboard-section-kpi"><span>Days Present</span><strong>${presentDays}</strong></div>
                    <div class="dashboard-section-kpi"><span>Range</span><strong>${safeHtml(from)} to ${safeHtml(to)}</strong></div>
                </div>
                <div class="table-container">
                    <table class="data-table">
                        <thead><tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Type</th></tr></thead>
                        <tbody>${rows || '<tr><td colspan="4">No check-in logs in this range.</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`
    };
};

const renderWorklogSection = async (from, to) => {
    const targetStaffId = getTargetStaffId();
    const users = window.AppAnalytics?.getUsersCached ? await window.AppAnalytics.getUsersCached() : [];
    const targetStaff = (Array.isArray(users) ? users : []).find((u) => String(u.id || '') === String(targetStaffId || ''))
        || window.AppAuth?.getUser?.()
        || {};
    const plans = await getWorkPlansForRange(from, to);
    return {
        title: 'Planned Tasks',
        html: `
            ${renderPlannedTasksCard(plans, targetStaff, {
                title: 'Planned Tasks',
                subtitle: `${from} to ${to}`,
                from,
                to,
                emptyMessage: 'No planned tasks in this range.',
                cardClass: 'dashboard-worklog-card dashboard-section-card-no-shadow',
                listClass: 'dashboard-planned-task-list dashboard-planned-task-list-section'
            })}`
    };
};

const renderTeamActivitySection = async (from, to) => {
    const rows = await window.AppAnalytics.getAllStaffActivities({
        mode: 'range',
        startIso: from,
        endIso: to,
        scope: 'all',
        sideEffects: true
    });
    const list = (rows || []).slice(0, 150).map((row) => `
        <tr>
            <td>${safeHtml(row.date || '--')}</td>
            <td>${safeHtml(row.staffName || row.userName || '--')}</td>
            <td>${safeHtml(row.type || 'work')}</td>
            <td>${safeHtml(row.status || '--')}</td>
            <td>${safeHtml(row._displayDesc || row.workDescription || row.task || '--')}</td>
        </tr>
    `).join('');
    return {
        title: 'Team Activity',
        html: `
            <div class="card">
                <div class="dashboard-section-inline-actions">
                    <button class="action-btn secondary" onclick="window.location.hash='team-activities'">Open Advanced Team Activities Page</button>
                </div>
                <div class="table-container">
                    <table class="data-table">
                        <thead><tr><th>Date</th><th>Staff</th><th>Type</th><th>Status</th><th>Description</th></tr></thead>
                        <tbody>${list || '<tr><td colspan="5">No team activities in this range.</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`
    };
};

const renderTeamScheduleSection = async (from, to) => {
    const [plans, leaves] = await Promise.all([
        getWorkPlansForRange(from, to),
        getLeavesForRange(from, to)
    ]);
    const planRows = (plans || []).slice(0, 120).map((row) => `
        <tr>
            <td>${safeHtml(row._dateKey || '--')}</td>
            <td>${safeHtml(row.userName || row.userId || '--')}</td>
            <td>${Array.isArray(row.plans) ? row.plans.length : 0}</td>
            <td><button class="action-btn secondary" onclick="window.app_openDayPlan('${safeHtml(row._dateKey || '')}','${safeHtml(row.userId || '')}')">Open Day Plan</button></td>
        </tr>
    `).join('');
    const leaveRows = (leaves || []).slice(0, 80).map((row) => `
        <tr>
            <td>${safeHtml(row.userName || row.userId || '--')}</td>
            <td>${safeHtml(row.type || '--')}</td>
            <td>${safeHtml(row.startDate || '--')}</td>
            <td>${safeHtml(row.endDate || '--')}</td>
            <td>${safeHtml(row.status || 'Pending')}</td>
        </tr>
    `).join('');
    return {
        title: 'Team Schedule',
        html: `
            <div class="card">
                <div class="dashboard-section-inline-actions" style="display:flex; justify-content:space-between; align-items:center; gap:0.75rem; flex-wrap:wrap;">
                    <h4 style="margin:0;">Planned Work</h4>
                    <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                        <button type="button" class="action-btn secondary" onclick="window.app_quickAddPersonalPlan?.()" title="Add Personal Plan">Add Personal Plan</button>
                        <button type="button" class="action-btn secondary" onclick="window.app_quickEditPersonalPlan?.()" title="Edit Personal Plan">Edit Personal Plan</button>
                    </div>
                </div>
                <div class="table-container"><table class="data-table"><thead><tr><th>Date</th><th>Staff</th><th>Tasks</th><th>Action</th></tr></thead><tbody>${planRows || '<tr><td colspan="4">No planned work in range.</td></tr>'}</tbody></table></div>
            </div>
            <div class="card">
                <h4>Leaves in Range</h4>
                <div class="table-container"><table class="data-table"><thead><tr><th>Staff</th><th>Type</th><th>Start</th><th>End</th><th>Status</th></tr></thead><tbody>${leaveRows || '<tr><td colspan="5">No leaves in range.</td></tr>'}</tbody></table></div>
            </div>`
    };
};

const renderStaffDirectorySection = async () => {
    const html = await renderStaffDirectoryPage();
    return {
        title: 'Staff Directory',
        html
    };
};

const renderLeaveRequestsSection = async (from, to) => {
    const leaves = await getLeavesForRange(from, to);
    const pending = (leaves || []).filter((row) => {
        const status = String(row.status || '').toLowerCase();
        return !status || status === 'pending';
    });
    return {
        title: 'Leave Requests',
        html: renderLeaveRequests(pending)
    };
};

const renderLeaveHistorySection = async (from, to) => {
    const leaves = await getLeavesForRange(from, to);
    const history = (leaves || [])
        .slice()
        .sort((a, b) => new Date(b._dateKey || 0) - new Date(a._dateKey || 0))
        .slice(0, 150);
    return {
        title: 'Leave History',
        html: renderLeaveHistory(history, {
            title: 'Leave History',
            subtitle: `${from} to ${to}`,
            selectedDate: to
        })
    };
};

const renderMissedCheckoutSection = async (from, to) => {
    const [logs, users] = await Promise.all([
        getAttendanceForRangeAllStaff(from, to),
        (window.AppDB.getCached
            ? window.AppDB.getCached(window.AppDB.getCacheKey('sectionUsers', 'users', {}), 60000, () => window.AppDB.getAll('users'))
            : window.AppDB.getAll('users')
        ).then(u => (u || []).filter(x => !AppConfig.isDemoUser(x)))
    ]);
    const usersMap = new Map((users || []).map((u) => [String(u.id), u]));
    const pending = (logs || []).filter((log) =>
        log?.missedCheckoutReasonRequired
        && log?.missedCheckoutReasonSubmittedAt
        && String(log?.missedCheckoutReasonStatus || '').toLowerCase() === 'pending'
    );
    const rows = pending.slice(0, 200).map((log) => {
        const staff = usersMap.get(String(log.user_id || log.userId || ''));
        return `
            <tr>
                <td>${safeHtml(log._dateKey || '--')}</td>
                <td>${safeHtml(staff?.name || 'Staff')}</td>
                <td>${safeHtml(log.missedCheckoutReason || 'Reason not provided')}</td>
                <td>${safeHtml(log.missedCheckoutReasonStatus || 'pending')}</td>
            </tr>
        `;
    }).join('');
    return {
        title: 'Missed Checkout Requests',
        html: `
            <div class="card">
                <div class="table-container">
                    <table class="data-table">
                        <thead><tr><th>Date</th><th>Staff</th><th>Reason</th><th>Status</th></tr></thead>
                        <tbody>${rows || '<tr><td colspan="4">No missed checkout requests in this range.</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`
    };
};

const renderStatsSection = async (from, to, statsKind) => {
    const targetStaffId = getTargetStaffId();
    const logs = await getAttendanceForTarget(targetStaffId, from, to);
    const title = statsKind === 'yearly' ? 'Yearly Stats View' : 'Monthly Stats View';
    const stats = computeRangeStats(logs, `${from} to ${to}`);
    return {
        title,
        html: renderStatsCard(title, 'Date-range attendance metrics', stats, '')
    };
};

const sectionRendererMap = {
    checkin: (from, to) => renderCheckinSection(from, to),
    worklog: (from, to) => renderWorklogSection(from, to),
    'team-activity': (from, to) => renderTeamActivitySection(from, to),
    'team-schedule': (from, to) => renderTeamScheduleSection(from, to),
    'staff-directory': () => renderStaffDirectorySection(),
    'leave-requests': (from, to) => renderLeaveRequestsSection(from, to),
    'leave-history': (from, to) => renderLeaveHistorySection(from, to),
    'missed-checkout': (from, to) => renderMissedCheckoutSection(from, to),
    'stats-monthly': (from, to) => renderStatsSection(from, to, 'monthly'),
    'stats-yearly': (from, to) => renderStatsSection(from, to, 'yearly')
};

export const getDashboardSectionFromHash = (hash = '') => {
    const raw = String(hash || '').replace(/^#/, '').trim();
    if (!raw.startsWith(SECTION_ROUTE_PREFIX)) return '';
    const section = raw.slice(SECTION_ROUTE_PREFIX.length).trim();
    return SUPPORTED_SECTIONS.has(section) ? section : '';
};

const renderSection = async (sectionKey) => {
    const safeSection = SUPPORTED_SECTIONS.has(sectionKey) ? sectionKey : 'worklog';
    const range = getRangeForSection(safeSection);
    const fallbackRange = safeSection === 'worklog' ? getCurrentDayRange() : getCurrentWeekRange();
    const from = normalizeIsoDate(range.from) || fallbackRange.from;
    const to = normalizeIsoDate(range.to) || fallbackRange.to;
    const renderer = sectionRendererMap[safeSection] || sectionRendererMap.worklog;
    const content = await renderer(from, to);
    return buildSectionShell({
        sectionKey: safeSection,
        title: content.title || 'Dashboard Section',
        from,
        to,
        bodyHtml: content.html || '<div class="card">No data available.</div>',
        resetLabel: safeSection === 'worklog' ? 'Reset to Today' : 'Reset to Current Week'
    });
};

export async function renderDashboardSectionPage(sectionKey) {
    return renderSection(sectionKey);
}

const rerenderSectionIfOpen = async (sectionKey) => {
    const hashSection = getDashboardSectionFromHash(window.location.hash);
    if (!hashSection || hashSection !== sectionKey) return;
    const page = document.getElementById('page-content');
    if (!page) return;
    page.innerHTML = '<div class="loading-spinner"></div>';
    page.innerHTML = await renderDashboardSectionPage(sectionKey);
    initDashboardSectionPage(sectionKey);
};

export function initDashboardSectionPage() {
    if (window.__dashboardSectionGlobalsBound) return;
    window.__dashboardSectionGlobalsBound = true;

    window.app_openDashboardSection = function (sectionKey) {
        const safeSection = SUPPORTED_SECTIONS.has(String(sectionKey || '').trim())
            ? String(sectionKey).trim()
            : 'worklog';
        if (window.location.hash === `#${SECTION_ROUTE_PREFIX}${safeSection}`) {
            void rerenderSectionIfOpen(safeSection);
            return;
        }
        window.location.hash = `${SECTION_ROUTE_PREFIX}${safeSection}`;
    };

    window.app_backToDashboard = function () {
        window.location.hash = 'dashboard';
    };

    window.app_setDashboardSectionDateRange = async function (sectionKey, from, to) {
        const safeSection = SUPPORTED_SECTIONS.has(String(sectionKey || '').trim())
            ? String(sectionKey).trim()
            : 'worklog';
        const defaultRange = safeSection === 'worklog' ? getCurrentDayRange() : getCurrentWeekRange();
        const nextFrom = normalizeIsoDate(from) || defaultRange.from;
        const nextTo = normalizeIsoDate(to) || defaultRange.to;
        if (nextFrom > nextTo) {
            setErrorForSection(safeSection, 'Invalid date range: "From" must be before or equal to "To".');
            await rerenderSectionIfOpen(safeSection);
            return false;
        }
        setErrorForSection(safeSection, '');
        setRangeForSection(safeSection, nextFrom, nextTo);
        await rerenderSectionIfOpen(safeSection);
        return true;
    };

    window.app_applyDashboardSectionDateRange = async function (sectionKey) {
        const fromInput = document.getElementById(`dashboard-section-from-${sectionKey}`);
        const toInput = document.getElementById(`dashboard-section-to-${sectionKey}`);
        const from = fromInput ? fromInput.value : '';
        const to = toInput ? toInput.value : '';
        await window.app_setDashboardSectionDateRange(sectionKey, from, to);
    };
}
