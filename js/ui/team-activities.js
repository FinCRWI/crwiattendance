/**
 * Team Activities Page
 * Full page view for team activity management.
 */

import { safeHtml } from './helpers.js';
import { normalizeTaskStatus } from '../utils/task-status.js';
import { applyTeamActivitiesBulkShift, buildTeamActivitiesBulkShiftPlan } from '../utils/team-activities-bulk-shift.js';

const DEFAULT_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

function getDefaultRange() {
    const end = new Date();
    const start = new Date(end);
    // Default to current week (Monday to today) for IST locale.
    const day = start.getDay(); // 0=Sun, 1=Mon, ...
    const diffToMonday = (day + 6) % 7;
    start.setDate(start.getDate() - diffToMonday);
    start.setHours(0, 0, 0, 0);
    return {
        startIso: start.toISOString().split('T')[0],
        endIso: end.toISOString().split('T')[0]
    };
}

function getTeamActivitiesState() {
    if (!window.app_teamActivitiesState) {
        const range = getDefaultRange();
        window.app_teamActivitiesState = {
            startIso: range.startIso,
            endIso: range.endIso,
            weeksLoaded: 1,
            staffIds: [],
            status: 'all',
            type: 'all',
            budgetHead: 'all',
            search: '',
            sortKey: 'date-desc',
            page: 1,
            pageSize: DEFAULT_PAGE_SIZE,
            columnFilters: {
                date: '',
                staff: '',
                description: '',
                time: '',
                type: '',
                status: ''
            },
            selectedKeys: [],
            columnVisibility: {
                type: true,
                status: true,
                sourceTime: true,
                budgetHead: true,
                compliance: true
            },
            users: [],
            data: [],
            overdueRows: [],
            overdueCount: 0,
            filtered: [],
            lastRefreshed: null,
            missedCheckoutRows: [],
            missedCheckoutCount: 0
        };
    }
    return window.app_teamActivitiesState;
}

function normalizeActivityRows(rows) {
    const normalizeSourceTime = (row = {}) => {
        const raw = String(row.checkOut || row._sortTime || '').trim();
        if (!raw) return '';
        const lowered = raw.toLowerCase();
        if (lowered === 'active now' || raw === '00:00' || raw === '09:00') return '';
        const hhmm = raw.match(/^(\d{1,2}):(\d{2})/);
        if (hhmm) return `${String(Number(hhmm[1])).padStart(2, '0')}:${hhmm[2]}`;
        return raw;
    };

    return (rows || []).map(row => {
        const type = row.type || (row.workDescription ? 'attendance' : 'work');
        const description = row._displayDesc || row.workDescription || row.task || 'Activity';
        const sourceTime = normalizeSourceTime(row);
        const statusSeed = row.status || (type === 'attendance' ? 'completed' : '');
        const status = normalizeTaskStatus(
            {
                status: statusSeed,
                completedDate: row.completedDate,
                completedAt: row.completedAt,
                completed_on: row.completed_on,
                postponedFromDate: row.postponedFromDate,
                addedFrom: row.addedFrom
            },
            row.date,
            window.AppCalendar?.getSmartTaskStatus
        );
        return {
            date: row.date || '',
            staffName: row.staffName || row.userName || 'Unknown Staff',
            type,
            description,
            status,
            sourceTime,
            userId: row.userId || row.user_id || '',
            planId: row.planId || row.id || '',
            taskIndex: Number.isInteger(row.taskIndex) ? row.taskIndex : null,
            planScope: row.planScope || 'personal',
            task: row.task || row.description || row._displayDesc || row.workDescription || '',
            subPlans: Array.isArray(row.subPlans) ? row.subPlans.slice() : [],
            tags: Array.isArray(row.tags) ? row.tags.slice() : [],
            sourcePlanId: row.sourcePlanId || row.planId || row.id || '',
            sourceTaskIndex: Number.isInteger(row.sourceTaskIndex) ? row.sourceTaskIndex : (Number.isInteger(row.taskIndex) ? row.taskIndex : null),
            addedFrom: row.addedFrom || '',
            completedDate: row.completedDate || '',
            completedAt: row.completedAt || '',
            completed_on: row.completed_on || '',
            postponedFromDate: row.postponedFromDate || '',
            carriedForwardFromDate: row.carriedForwardFromDate || '',
            carriedForwardFromPlanId: row.carriedForwardFromPlanId || '',
            carryForwardRootId: row.carryForwardRootId || '',
            carryForwardPolicy: row.carryForwardPolicy || '',
            carryForwardReason: row.carryForwardReason || '',
            isAutoForwarded: row.isAutoForwarded === true,
            isRemoved: row.isRemoved === true,
            progressPercent: Number.isFinite(Number(row.progressPercent)) ? Number(row.progressPercent) : null,
            progressStatus: row.progressStatus || '',
            progressNote: row.progressNote || '',
            budgetHeadId: row.budgetHeadId || 'UNALLOCATED',
            validationStatus: row.validationStatus || 'unknown',
            validationErrors: Array.isArray(row.validationErrors) ? row.validationErrors : []
        };
    });
}

function isIncompleteStatus(status) {
    const key = String(status || '').toLowerCase();
    return ['overdue', 'not-completed', 'to-be-started', 'in-process', 'postponed'].includes(key);
}

function nextDateIso(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
}

function isValidIsoDate(value) {
    const normalized = String(value || '').trim();
    if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
    const d = new Date(normalized);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(normalized);
}

function openPostponePicker(anchorEl, defaultDate) {
    return new Promise((resolve) => {
        if (!anchorEl) {
            resolve(null);
            return;
        }

        const existing = document.getElementById('team-activities-postpone-popover');
        if (existing) existing.remove();

        const popover = document.createElement('div');
        popover.id = 'team-activities-postpone-popover';
        popover.className = 'team-activities-postpone-popover';
        popover.innerHTML = `
            <div class="team-activities-postpone-head">Postpone to</div>
            <input type="date" class="team-activities-postpone-input" value="${defaultDate}">
            <div class="team-activities-postpone-actions">
                <button type="button" class="team-activities-row-btn warn" data-postpone-cancel>Cancel</button>
                <button type="button" class="team-activities-row-btn success" data-postpone-confirm>Confirm</button>
            </div>
        `;

        document.body.appendChild(popover);

        const rect = anchorEl.getBoundingClientRect();
        const top = rect.bottom + window.scrollY + 8;
        const left = Math.min(rect.left + window.scrollX, window.innerWidth - 260);
        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;

        const input = popover.querySelector('.team-activities-postpone-input');
        if (input) input.focus();

        const cleanup = (value) => {
            document.removeEventListener('click', onDocClick, true);
            popover.remove();
            resolve(value);
        };

        const onDocClick = (event) => {
            if (!popover.contains(event.target) && event.target !== anchorEl) {
                cleanup(null);
            }
        };

        document.addEventListener('click', onDocClick, true);

        popover.addEventListener('click', (event) => {
            const target = event.target;
            if (target.closest('[data-postpone-cancel]')) {
                cleanup(null);
            }
            if (target.closest('[data-postpone-confirm]')) {
                const value = input ? input.value : '';
                cleanup(value || null);
            }
        });
    });
}

function applyFilters(state) {
    const search = state.search.trim().toLowerCase();
    const staffIds = new Set(state.staffIds || []);
    const status = state.status;
    const type = state.type;
    const budgetHead = String(state.budgetHead || 'all');
    const col = state.columnFilters || {};
    const colDate = String(col.date || '').trim();
    const colStaff = String(col.staff || '').trim().toLowerCase();
    const colDesc = String(col.description || '').trim().toLowerCase();
    const colTime = String(col.time || '').trim().toLowerCase();
    const colType = String(col.type || '').trim().toLowerCase();
    const colStatus = String(col.status || '').trim().toLowerCase();

    let filtered = state.data.filter(row => {
        if (staffIds.size && !staffIds.has(row.userId)) return false;
        if (type !== 'all' && row.type !== type) return false;
        if (budgetHead !== 'all' && String(row.budgetHeadId || 'UNALLOCATED') !== budgetHead) return false;
        if (status !== 'all' && String(row.status || '').toLowerCase() !== status) return false;
        if (search) {
            const hay = `${row.date} ${row.staffName} ${row.description} ${row.status} ${row.type}`.toLowerCase();
            if (!hay.includes(search)) return false;
        }
        if (colDate && String(row.date || '') !== colDate) return false;
        if (colStaff && !String(row.staffName || '').toLowerCase().includes(colStaff)) return false;
        if (colDesc && !String(row.description || '').toLowerCase().includes(colDesc)) return false;
        if (colTime && !String(row.sourceTime || '').toLowerCase().includes(colTime)) return false;
        if (colType && !String(row.type || '').toLowerCase().includes(colType)) return false;
        if (colStatus && !String(row.status || '').toLowerCase().includes(colStatus)) return false;
        return true;
    });

    filtered = sortRows(filtered, state.sortKey);
    state.filtered = filtered;
    return filtered;
}

function sortRows(rows, sortKey) {
    const copy = [...rows];
    copy.sort((a, b) => {
        const dateDiff = new Date(b.date) - new Date(a.date);
        const timeDiff = String(b.sourceTime || '').localeCompare(String(a.sourceTime || ''));
        const nameCmp = String(a.staffName || '').localeCompare(String(b.staffName || ''));
        const hasActions = (row) => row.type === 'work' && row.planId && Number.isInteger(row.taskIndex);
        if (sortKey === 'date-desc') return dateDiff || timeDiff;
        if (sortKey === 'date-asc') return (new Date(a.date) - new Date(b.date)) || timeDiff;
        if (sortKey === 'staff-asc') return nameCmp || dateDiff;
        if (sortKey === 'staff-desc') return (-nameCmp) || dateDiff;
        if (sortKey === 'status') return String(a.status || '').localeCompare(String(b.status || '')) || dateDiff;
        if (sortKey === 'status-desc') return String(b.status || '').localeCompare(String(a.status || '')) || dateDiff;
        if (sortKey === 'type') return String(a.type || '').localeCompare(String(b.type || '')) || dateDiff;
        if (sortKey === 'type-desc') return String(b.type || '').localeCompare(String(a.type || '')) || dateDiff;
        if (sortKey === 'description') return String(a.description || '').localeCompare(String(b.description || '')) || dateDiff;
        if (sortKey === 'description-desc') return String(b.description || '').localeCompare(String(a.description || '')) || dateDiff;
        if (sortKey === 'time') return String(a.sourceTime || '').localeCompare(String(b.sourceTime || '')) || dateDiff;
        if (sortKey === 'time-desc') return String(b.sourceTime || '').localeCompare(String(a.sourceTime || '')) || dateDiff;
        if (sortKey === 'actions') return Number(hasActions(b)) - Number(hasActions(a)) || dateDiff;
        if (sortKey === 'actions-desc') return Number(hasActions(a)) - Number(hasActions(b)) || dateDiff;
        return dateDiff || timeDiff;
    });
    return copy;
}

function paginate(rows, page, pageSize) {
    const safePage = Math.max(1, page);
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
}

function renderSummary(state) {
    const total = state.filtered.length;
    const staffSet = new Set(state.filtered.map(r => r.userId).filter(Boolean));
    const completed = state.filtered.filter(r => String(r.status).toLowerCase() === 'completed').length;
    const incomplete = total - completed;
    return `
        <div class="team-activities-chip">Total: <strong>${total}</strong></div>
        <div class="team-activities-chip">Staff: <strong>${staffSet.size}</strong></div>
        <div class="team-activities-chip">Completed: <strong>${completed}</strong></div>
        <div class="team-activities-chip">Incomplete: <strong>${incomplete}</strong></div>
    `;
}

function formatBulkShiftSummary(result = {}) {
    const skippedByState = result.skippedByState || {};
    const breakdown = ['in', 'out', 'unknown']
        .map((key) => `${key}: ${Number(skippedByState[key] || 0)}`)
        .join(', ');
    return [
        `Moved to today: ${Number(result.movedToToday || 0)}`,
        `Postponed to tomorrow: ${Number(result.postponedToTomorrow || 0)}`,
        `Skipped: ${Number(result.skipped || 0)}`,
        `Skipped by state: ${breakdown}`
    ].join('\n');
}

function renderStaffFilter(state) {
    const allUsers = state.users || [];
    const selected = new Set(state.staffIds || []);
    const label = selected.size ? `${selected.size} selected` : 'All staff';
    const items = allUsers.map(u => `
        <label class="team-activities-checkbox">
            <input type="checkbox" data-staff-id="${u.id}" ${selected.has(u.id) ? 'checked' : ''}>
            <span>${safeHtml(u.name || 'Staff')}</span>
        </label>
    `).join('');

    return `
        <div class="team-activities-dropdown">
            <button class="team-activities-dropdown-btn" type="button" data-team-activities-staff-toggle>
                <i class="fa-solid fa-users"></i>
                <span>Staff: ${safeHtml(label)}</span>
                <i class="fa-solid fa-chevron-down"></i>
            </button>
            <div class="team-activities-dropdown-panel" id="team-activities-staff-panel">
                <div class="team-activities-dropdown-actions">
                    <button type="button" class="team-activities-link" data-staff-select-all>Select all</button>
                    <button type="button" class="team-activities-link" data-staff-clear>Clear</button>
                </div>
                <div class="team-activities-dropdown-list">
                    ${items || '<div class="team-activities-empty">No staff found.</div>'}
                </div>
            </div>
        </div>
    `;
}

function renderColumnsPanel(state) {
    const vis = state.columnVisibility;
    return `
        <div class="team-activities-columns-popover" id="team-activities-columns-popover">
            <label class="team-activities-checkbox">
                <input type="checkbox" data-column="type" ${vis.type ? 'checked' : ''}>
                <span>Type</span>
            </label>
            <label class="team-activities-checkbox">
                <input type="checkbox" data-column="status" ${vis.status ? 'checked' : ''}>
                <span>Status</span>
            </label>
            <label class="team-activities-checkbox">
                <input type="checkbox" data-column="sourceTime" ${vis.sourceTime ? 'checked' : ''}>
                <span>Time</span>
            </label>
            <label class="team-activities-checkbox">
                <input type="checkbox" data-column="budgetHead" ${vis.budgetHead ? 'checked' : ''}>
                <span>Budget Head</span>
            </label>
            <label class="team-activities-checkbox">
                <input type="checkbox" data-column="compliance" ${vis.compliance ? 'checked' : ''}>
                <span>Compliance</span>
            </label>
        </div>
    `;
}

function renderSortLabel(label, primary, alt, state) {
    const dir = state.sortKey === primary ? '▼'
        : state.sortKey === alt ? '▲'
        : '⇅';
    return `${safeHtml(label)} <span class="team-activities-sort">${dir}</span>`;
}

function renderTable(state) {
    const vis = state.columnVisibility;
    const rows = paginate(state.filtered, state.page, state.pageSize);
    if (!rows.length) {
        return `<div class="team-activities-empty">No activities found for the selected filters.</div>`;
    }

    const selected = new Set(state.selectedKeys || []);
    const currentUserId = window.AppAuth?.getUser ? window.AppAuth.getUser()?.id : null;
    const currentUser = window.AppAuth?.getUser ? window.AppAuth.getUser() : null;
    const canAdminDelete = !!(currentUser && (currentUser.role === 'Administrator' || currentUser.isAdmin));

    const headCols = `
        <th data-sort="date-desc" data-sort-alt="date-asc">${renderSortLabel('Date', 'date-desc', 'date-asc', state)}</th>
        <th data-sort="staff-asc" data-sort-alt="staff-desc">${renderSortLabel('Staff', 'staff-asc', 'staff-desc', state)}</th>
        ${vis.type ? `<th data-sort="type" data-sort-alt="type-desc">${renderSortLabel('Type', 'type', 'type-desc', state)}</th>` : ''}
        ${vis.status ? `<th data-sort="status" data-sort-alt="status-desc">${renderSortLabel('Status', 'status', 'status-desc', state)}</th>` : ''}
        <th data-sort="description" data-sort-alt="description-desc">${renderSortLabel('Description', 'description', 'description-desc', state)}</th>
        ${vis.budgetHead ? `<th>Budget Head</th>` : ''}
        ${vis.compliance ? `<th>Compliance</th>` : ''}
        ${vis.sourceTime ? `<th data-sort="time" data-sort-alt="time-desc">${renderSortLabel('Time', 'time', 'time-desc', state)}</th>` : ''}
        <th data-sort="actions" data-sort-alt="actions-desc">${renderSortLabel('Actions', 'actions', 'actions-desc', state)}</th>
    `;

    const selectableRows = [];
    const body = rows.map(row => {
        const statusClass = String(row.status || '').toLowerCase().replace(/\s+/g, '-');
        const isOwner = currentUserId && row.userId && currentUserId === row.userId;
        const canRemove = row.type === 'work' && row.planId && Number.isInteger(row.taskIndex) && (isOwner || canAdminDelete);
        const canComplete = row.type === 'work' && isIncompleteStatus(row.status) && row.planId && Number.isInteger(row.taskIndex) && (isOwner || canAdminDelete);
        const rowKey = `${row.planId || ''}__${Number.isInteger(row.taskIndex) ? row.taskIndex : ''}`;
        if (canRemove) selectableRows.push(rowKey);
        const hasProgress = row.type === 'work' && (row.progressPercent !== null || row.progressStatus || row.progressNote);
        const statusLabel = row.progressStatus ? String(row.progressStatus).replace(/_/g, ' ') : '';
        const progressLabel = row.progressPercent !== null ? `${row.progressPercent}%` : '';
        const noteText = String(row.progressNote || '').trim();
        const tooltip = noteText ? ` title="${safeHtml(noteText)}"` : '';
        const progressBadge = hasProgress
            ? `<div class="team-activities-progress"${tooltip}>${safeHtml(progressLabel)}${progressLabel && statusLabel ? ' &bull; ' : ''}${safeHtml(statusLabel)}</div>`
            : '';
        const selectCell = canAdminDelete ? `
            <td class="team-activities-select-col">
                ${canRemove ? `<input type="checkbox" class="team-activities-row-select" data-row-key="${safeHtml(rowKey)}" ${selected.has(rowKey) ? 'checked' : ''}>` : ''}
            </td>
        ` : '<td class="team-activities-select-col"></td>';
        return `
        <tr>
            ${selectCell}
            <td>${safeHtml(row.date)}</td>
            <td>${safeHtml(row.staffName)}</td>
            ${vis.type ? `<td class="team-activities-type">${safeHtml(row.type)}</td>` : ''}
            ${vis.status ? `<td><span class="team-activities-status status-${safeHtml(statusClass)}">${safeHtml(row.status)}</span></td>` : ''}
            <td class="team-activities-desc">${safeHtml(row.description)}${progressBadge}</td>
            ${vis.budgetHead ? `<td>${safeHtml(row.budgetHeadId || 'UNALLOCATED')}</td>` : ''}
            ${vis.compliance ? `<td>${safeHtml(String(row.validationStatus || 'unknown'))}${(row.validationErrors || []).length ? ` <span title="${safeHtml((row.validationErrors || []).join(' | '))}" style="color:#b45309;">(${(row.validationErrors || []).length})</span>` : ''}</td>` : ''}
            ${vis.sourceTime ? `<td>${safeHtml(row.sourceTime || '--')}</td>` : ''}
            <td>
                <div class="team-activities-row-actions">
                    <button class="team-activities-row-btn" data-view-date="${safeHtml(row.date)}" data-view-user="${safeHtml(row.userId)}">
                        <i class="fa-solid fa-eye"></i> View
                    </button>
                    ${row.type === 'work' && isOwner && isIncompleteStatus(row.status) && row.planId && Number.isInteger(row.taskIndex) ? `
                        <button class="team-activities-row-btn warn" data-action="postpone" data-plan-id="${safeHtml(row.planId)}" data-task-index="${row.taskIndex}" data-plan-scope="${safeHtml(row.planScope)}" data-user-id="${safeHtml(row.userId)}" data-date="${safeHtml(row.date)}">
                            <i class="fa-solid fa-clock"></i> Postpone
                        </button>
                    ` : ''}
                    ${canComplete ? `
                        <button class="team-activities-row-btn success" data-action="complete" data-plan-id="${safeHtml(row.planId)}" data-task-index="${row.taskIndex}" data-user-id="${safeHtml(row.userId)}" onclick="window.app_teamActivitiesCompleteTask(this)">
                            <i class="fa-solid fa-check"></i> Complete
                        </button>
                    ` : ''}
                    ${canRemove ? `
                        <button class="team-activities-row-btn danger" data-action="remove" data-plan-id="${safeHtml(row.planId)}" data-task-index="${row.taskIndex}" data-user-id="${safeHtml(row.userId)}">
                            <i class="fa-solid fa-trash"></i> Remove
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `; }).join('');

    const allVisibleSelected = selectableRows.length > 0 && selectableRows.every(k => selected.has(k));
    const bulkBar = canAdminDelete ? `
        <div class="team-activities-bulk-bar">
            <div><strong>${selected.size}</strong> selected</div>
            <div class="team-activities-bulk-actions">
                <button type="button" class="team-activities-row-btn secondary" data-bulk-clear ${selected.size ? '' : 'disabled'}>Clear</button>
                <button type="button" class="team-activities-row-btn danger" data-bulk-remove ${selected.size ? '' : 'disabled'}>Bulk Remove</button>
            </div>
        </div>
    ` : '';

    const selectHead = canAdminDelete
        ? `<th class="team-activities-select-col"><input type="checkbox" data-select-visible ${selectableRows.length ? '' : 'disabled'} ${allVisibleSelected ? 'checked' : ''}></th>`
        : '<th class="team-activities-select-col"></th>';

    return `
        ${bulkBar}
        <table class="team-activities-table">
            <thead><tr>${selectHead}${headCols}</tr></thead>
            <tbody>${body}</tbody>
        </table>
    `;
}

function showInlineActionToast(anchorEl, message) {
    if (!anchorEl) return;
    const row = anchorEl.closest('tr');
    const actions = row ? row.querySelector('.team-activities-row-actions') : null;
    if (!actions) return;
    let toast = actions.querySelector('.team-activities-inline-toast');
    if (!toast) {
        toast = document.createElement('span');
        toast.className = 'team-activities-inline-toast';
        actions.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

function renderPagination(state) {
    const total = state.filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    const current = Math.min(state.page, totalPages);
    return `
        <div class="team-activities-pagination">
            <button class="team-activities-page-btn" data-page="prev" ${current <= 1 ? 'disabled' : ''}>Prev</button>
            <span>Page ${current} of ${totalPages}</span>
            <button class="team-activities-page-btn" data-page="next" ${current >= totalPages ? 'disabled' : ''}>Next</button>
        </div>
    `;
}

function updateUI() {
    const state = getTeamActivitiesState();
    // Ensure time column stays visible for filtering
    state.columnVisibility.sourceTime = true;
    applyFilters(state);
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;

    const summaryEl = document.getElementById('team-activities-summary');
    const tableWrap = document.getElementById('team-activities-table-wrap');
    const paginationWrap = document.getElementById('team-activities-pagination-wrap');
    const lastRef = document.getElementById('team-activities-last-updated');
    const columnsWrap = document.getElementById('team-activities-columns-wrap');
    const staffWrap = document.getElementById('team-activities-staff-wrap');

    if (summaryEl) summaryEl.innerHTML = renderSummary(state);
    if (tableWrap) tableWrap.innerHTML = renderTable(state);
    if (paginationWrap) paginationWrap.innerHTML = renderPagination(state);
    if (columnsWrap) columnsWrap.innerHTML = renderColumnsPanel(state);
    if (staffWrap) staffWrap.innerHTML = renderStaffFilter(state);
    if (lastRef && state.lastRefreshed) {
        lastRef.textContent = new Date(state.lastRefreshed).toLocaleString();
    }

    const selectVisible = tableWrap?.querySelector('[data-select-visible]');
    if (selectVisible) {
        const selectable = Array.from(tableWrap.querySelectorAll('input[data-row-key]'));
        const checkedCount = selectable.filter(cb => cb.checked).length;
        selectVisible.indeterminate = checkedCount > 0 && checkedCount < selectable.length;
    }
}

function extendRangeByWeeks(state, weeks = 1) {
    if (!state) return;
    const start = new Date(`${state.startIso}T00:00:00`);
    if (Number.isNaN(start.getTime())) return;
    start.setDate(start.getDate() - (7 * Math.max(1, Number(weeks) || 1)));
    state.startIso = start.toISOString().split('T')[0];
}

async function refreshData() {
    const state = getTeamActivitiesState();
    const loading = document.getElementById('team-activities-loading');
    if (loading) loading.style.display = 'block';

    try {
        const rows = await window.AppAnalytics.getAllStaffActivities({
            mode: 'range',
            startIso: state.startIso,
            endIso: state.endIso,
            scope: 'work',
            sideEffects: false
        });
        state.data = normalizeActivityRows(rows);
        state.overdueRows = (state.data || []).filter(row => String(row.status || '').toLowerCase() === 'overdue');
        state.overdueCount = state.overdueRows.length;
        window.app_teamActivitiesOverdueRows = state.overdueRows;
        window.app_teamActivitiesOverdueCount = state.overdueCount;
        state.missedCheckoutRows = state.overdueRows.slice();
        state.missedCheckoutCount = state.overdueCount;
        window.app_teamActivitiesOverdueRows = state.overdueRows;
        window.app_teamActivitiesOverdueCount = state.overdueCount;
        state.lastRefreshed = Date.now();
        state.page = 1;
        state.selectedKeys = [];
    } catch (err) {
        console.error('Team Activities fetch failed', err);
    } finally {
        if (loading) loading.style.display = 'none';
    }
    updateUI();
}

function updateStateFromFilters() {
    const state = getTeamActivitiesState();
    const startInput = document.getElementById('team-activities-start');
    const endInput = document.getElementById('team-activities-end');
    const typeSelect = document.getElementById('team-activities-type');
    const statusSelect = document.getElementById('team-activities-status');
    const searchInput = document.getElementById('team-activities-search');
    const pageSizeSelect = document.getElementById('team-activities-page-size');
    const budgetHeadSelect = document.getElementById('team-activities-budget-head');

    if (startInput) state.startIso = startInput.value || state.startIso;
    if (endInput) state.endIso = endInput.value || state.endIso;
    if (typeSelect) state.type = typeSelect.value || 'all';
    if (statusSelect) state.status = statusSelect.value || 'all';
    if (searchInput) state.search = searchInput.value || '';
    if (pageSizeSelect) state.pageSize = Number(pageSizeSelect.value) || DEFAULT_PAGE_SIZE;
    if (budgetHeadSelect) state.budgetHead = budgetHeadSelect.value || 'all';

    state.page = 1;
    updateUI();
}

function bindEvents() {
    const state = getTeamActivitiesState();
    if (state.bound) return;
    state.bound = true;

    let searchTimer = null;

    document.addEventListener('click', async (event) => {
        const target = event.target;
        const staffToggle = target.closest('[data-team-activities-staff-toggle]');
        const staffPanel = document.getElementById('team-activities-staff-panel');
        const columnsButton = target.closest('[data-team-activities-columns-toggle]');
        const columnsPopover = document.getElementById('team-activities-columns-popover');

        if (staffToggle && staffPanel) {
            staffPanel.classList.toggle('open');
        } else if (staffPanel && !staffPanel.contains(target)) {
            staffPanel.classList.remove('open');
        }

        if (columnsButton && columnsPopover) {
            columnsPopover.classList.toggle('open');
        } else if (columnsPopover && !columnsPopover.contains(target)) {
            columnsPopover.classList.remove('open');
        }

        const pageBtn = target.closest('.team-activities-page-btn');
        if (pageBtn) {
            const dir = pageBtn.dataset.page;
            const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
            if (dir === 'prev') state.page = Math.max(1, state.page - 1);
            if (dir === 'next') state.page = Math.min(totalPages, state.page + 1);
            updateUI();
        }

        const viewBtn = target.closest('[data-view-date]');
        if (viewBtn) {
            const date = viewBtn.getAttribute('data-view-date');
            const userId = viewBtn.getAttribute('data-view-user');
            if (window.app_openDayPlan) {
                window.app_openDayPlan(date, userId || '');
            }
        }

        const actionBtn = target.closest('[data-action]');
        if (actionBtn) {
            const action = actionBtn.getAttribute('data-action');
            if (action === 'complete' && window.app_teamActivitiesCompleteTask) {
                await window.app_teamActivitiesCompleteTask(actionBtn);
            }
            if (action === 'postpone' && window.app_teamActivitiesPostponeTask) {
                await window.app_teamActivitiesPostponeTask(actionBtn);
            }
            if (action === 'remove' && window.app_teamActivitiesRemoveTask) {
                await window.app_teamActivitiesRemoveTask(actionBtn);
            }
        }

        const tableHead = target.closest('th[data-sort]');
        if (tableHead) {
            const primary = tableHead.dataset.sort;
            const alt = tableHead.dataset.sortAlt;
            let key = primary;
            if (state.sortKey === primary && alt) key = alt;
            else if (state.sortKey === alt && primary) key = primary;
            if (key) {
                state.sortKey = key;
                updateUI();
            }
        }

        const selectAll = target.closest('[data-staff-select-all]');
        if (selectAll) {
            state.staffIds = (state.users || []).map(u => u.id);
            updateUI();
        }
        const clear = target.closest('[data-staff-clear]');
        if (clear) {
            state.staffIds = [];
            updateUI();
        }

        const bulkClear = target.closest('[data-bulk-clear]');
        if (bulkClear) {
            state.selectedKeys = [];
            updateUI();
        }

        const bulkRemoveBtn = target.closest('[data-bulk-remove]');
        if (bulkRemoveBtn && window.app_teamActivitiesBulkRemove) {
            await window.app_teamActivitiesBulkRemove();
        }

        const loadMore = target.closest('[data-load-more-week]');
        if (loadMore) {
            extendRangeByWeeks(state, 1);
            state.weeksLoaded = Math.max(1, Number(state.weeksLoaded || 1) + 1);
            updateUI();
            await refreshData();
        }
    });

    document.addEventListener('change', (event) => {
        const target = event.target;
        if (target.matches('#team-activities-start, #team-activities-end')) {
            state.weeksLoaded = 1;
            updateStateFromFilters();
            refreshData();
        } else if (target.matches('#team-activities-type, #team-activities-status, #team-activities-page-size')) {
            updateStateFromFilters();
        }
        else if (target.matches('#team-activities-budget-head')) {
            updateStateFromFilters();
        }
        if (target.matches('#team-activities-columns-popover input[type="checkbox"]')) {
            const col = target.getAttribute('data-column');
            if (col) state.columnVisibility[col] = target.checked;
            updateUI();
        }
        if (target.matches('#team-activities-staff-panel input[type="checkbox"]')) {
            const id = target.getAttribute('data-staff-id');
            if (!id) return;
            if (target.checked) {
                if (!state.staffIds.includes(id)) state.staffIds.push(id);
            } else {
                state.staffIds = state.staffIds.filter(x => x !== id);
            }
            updateUI();
        }
        if (target.matches('#team-activities-filter-date')) {
            state.columnFilters.date = target.value || '';
            updateUI();
        }
        if (target.matches('#team-activities-filter-staff')) {
            state.columnFilters.staff = target.value || '';
            updateUI();
        }
        if (target.matches('#team-activities-filter-desc')) {
            state.columnFilters.description = target.value || '';
            updateUI();
        }
        if (target.matches('#team-activities-filter-time')) {
            state.columnFilters.time = target.value || '';
            updateUI();
        }
        if (target.matches('#team-activities-filter-type')) {
            state.columnFilters.type = target.value || '';
            updateUI();
        }
        if (target.matches('#team-activities-filter-status')) {
            state.columnFilters.status = target.value || '';
            updateUI();
        }
        if (target.matches('input[data-row-key]')) {
            const key = target.getAttribute('data-row-key');
            if (!key) return;
            const selected = new Set(state.selectedKeys || []);
            if (target.checked) selected.add(key);
            else selected.delete(key);
            state.selectedKeys = Array.from(selected);
            updateUI();
        }
        if (target.matches('[data-select-visible]')) {
            const tableWrap = document.getElementById('team-activities-table-wrap');
            const boxes = Array.from(tableWrap?.querySelectorAll('input[data-row-key]') || []);
            const selected = new Set(state.selectedKeys || []);
            boxes.forEach(cb => {
                const key = cb.getAttribute('data-row-key');
                if (!key) return;
                cb.checked = target.checked;
                if (target.checked) selected.add(key);
                else selected.delete(key);
            });
            state.selectedKeys = Array.from(selected);
            updateUI();
        }
    });

    document.addEventListener('input', (event) => {
        if (!event.target.matches('#team-activities-search')) return;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => updateStateFromFilters(), SEARCH_DEBOUNCE_MS);
    });
}

function buildCSV(rows) {
    const headers = ['Date', 'Staff', 'Type', 'Status', 'Description', 'Budget Head', 'Validation Status', 'Validation Errors', 'Time'];
    const lines = rows.map(r => [
        r.date,
        r.staffName,
        r.type,
        r.status,
        r.description,
        r.budgetHeadId || 'UNALLOCATED',
        r.validationStatus || 'unknown',
        Array.isArray(r.validationErrors) ? r.validationErrors.join(' | ') : '',
        r.sourceTime
    ].map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(','));
    return [headers.join(','), ...lines].join('\n');
}

// --- Global Actions ---
if (typeof window !== 'undefined') {
    window.app_openTeamActivitiesForStaff = function (staffId, dateKey = '', sortKey = 'date-desc') {
        const state = getTeamActivitiesState();
        const safeStaffId = String(staffId || '').trim();
        const safeDate = String(dateKey || '').trim();
        state.staffIds = safeStaffId ? [safeStaffId] : [];
        state.search = '';
        state.page = 1;
        state.sortKey = String(sortKey || 'date-desc').trim() || 'date-desc';
        if (/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) {
            state.startIso = safeDate;
            state.endIso = safeDate;
            state.columnFilters = {
                ...(state.columnFilters || {}),
                date: safeDate,
                staff: '',
                description: '',
                time: '',
                type: '',
                status: ''
            };
        }
        const targetHash = 'team-activities';
        const currentHash = String(window.location.hash || '').replace(/^#/, '');
        if (currentHash !== targetHash) {
            window.location.hash = targetHash;
        } else if (typeof window.app_teamActivitiesRefresh === 'function') {
            window.app_teamActivitiesRefresh();
        }
    };

    window.app_initTeamActivities = async function () {
        const state = getTeamActivitiesState();
        const users = await window.AppAnalytics.getUsersCached();
        state.users = users || [];
        try {
            const purgeKey = 'purge_carried_2026-03-25';
            if (localStorage.getItem(purgeKey) !== '1' && window.AppCalendar?.purgeCarriedForwardTasksByDate) {
                const purgeRes = await window.AppCalendar.purgeCarriedForwardTasksByDate('2026-03-25', { scopes: ['personal', 'annual'] });
                if ((purgeRes?.removedTasks || 0) > 0) {
                    console.log(`Purged ${purgeRes.removedTasks} carried-forward task(s) on 2026-03-25.`);
                }
                localStorage.setItem(purgeKey, '1');
            }
        } catch (err) {
            console.warn('Purge 2026-03-25 failed:', err);
        }
        bindEvents();
        updateUI();
        await refreshData();
    };

    window.app_teamActivitiesRefresh = async function () {
        updateStateFromFilters();
        await refreshData();
    };

    window.app_teamActivitiesResetFilters = function () {
        const state = getTeamActivitiesState();
        const range = getDefaultRange();
        state.startIso = range.startIso;
        state.endIso = range.endIso;
        state.weeksLoaded = 1;
        state.staffIds = [];
        state.status = 'all';
        state.type = 'all';
        state.budgetHead = 'all';
        state.search = '';
        state.columnFilters = { date: '', staff: '', description: '', time: '', type: '', status: '' };
        state.sortKey = 'date-desc';
        state.page = 1;
        state.pageSize = DEFAULT_PAGE_SIZE;
        state.selectedKeys = [];
        const startInput = document.getElementById('team-activities-start');
        const endInput = document.getElementById('team-activities-end');
        const typeSelect = document.getElementById('team-activities-type');
        const statusSelect = document.getElementById('team-activities-status');
        const searchInput = document.getElementById('team-activities-search');
        const pageSizeSelect = document.getElementById('team-activities-page-size');
        const budgetHeadSelect = document.getElementById('team-activities-budget-head');
        if (startInput) startInput.value = state.startIso;
        if (endInput) endInput.value = state.endIso;
        if (typeSelect) typeSelect.value = 'all';
        if (statusSelect) statusSelect.value = 'all';
        if (searchInput) searchInput.value = '';
        if (pageSizeSelect) pageSizeSelect.value = String(DEFAULT_PAGE_SIZE);
        if (budgetHeadSelect) budgetHeadSelect.value = 'all';
        updateUI();
        refreshData();
    };

    window.app_teamActivitiesCopyCSV = async function () {
        const state = getTeamActivitiesState();
        const csv = buildCSV(state.filtered);
        try {
            await navigator.clipboard.writeText(csv);
            alert('Table copied to clipboard.');
        } catch (err) {
            console.warn('Clipboard copy failed', err);
            alert('Copy failed. Please use Export Excel instead.');
        }
    };

    window.app_teamActivitiesExportXLSX = function () {
        const state = getTeamActivitiesState();
        if (window.AppReports?.exportTeamActivitiesXLSX) {
            window.AppReports.exportTeamActivitiesXLSX(state.filtered, {
                start: state.startIso,
                end: state.endIso
            });
        } else {
            alert('Export module not available.');
        }
    };

    window.app_teamActivitiesCompleteTask = async function (btn) {
        try {
            const currentUser = window.AppAuth?.getUser ? window.AppAuth.getUser() : null;
            const currentUserId = currentUser?.id || null;
            const isAdmin = !!(currentUser && (currentUser.role === 'Administrator' || currentUser.isAdmin));
            const planId = btn.getAttribute('data-plan-id');
            const taskIndex = Number(btn.getAttribute('data-task-index'));
            const ownerId = btn.getAttribute('data-user-id') || '';
            if (!isAdmin && (!currentUserId || currentUserId !== ownerId)) {
                alert('Only the assigned staff member or an admin can complete this task.');
                return;
            }
            if (!planId || !Number.isInteger(taskIndex) || !window.AppCalendar?.updateTaskStatus) return;
            btn.disabled = true;
            await window.AppCalendar.updateTaskStatus(planId, taskIndex, 'completed');
            const state = getTeamActivitiesState();
            if (Array.isArray(state.data)) {
                state.data = state.data.map((row) => {
                    if (row.planId === planId && row.taskIndex === taskIndex) {
                        return { ...row, status: 'completed' };
                    }
                    return row;
                });
                updateUI();
            }
            showInlineActionToast(btn, 'Marked completed');
            setTimeout(() => refreshData(), 400);
            if (window.app_showSyncToast) {
                window.app_showSyncToast('Task marked as completed.');
            }
            if (typeof window.app_refreshHeroAuditLive === 'function') {
                window.app_refreshHeroAuditLive().catch((refreshErr) => {
                    console.warn('Hero refresh after complete failed:', refreshErr);
                });
            }
        } catch (err) {
            console.error('Complete task failed', err);
            alert('Failed to complete task.');
        }
    };

    window.app_teamActivitiesPostponeTask = async function (btn) {
        try {
            const currentUserId = window.AppAuth?.getUser ? window.AppAuth.getUser()?.id : null;
            const planId = btn.getAttribute('data-plan-id');
            const taskIndex = Number(btn.getAttribute('data-task-index'));
            const planScope = btn.getAttribute('data-plan-scope') || 'personal';
            const userId = btn.getAttribute('data-user-id') || '';
            const dateStr = btn.getAttribute('data-date') || '';
            if (!currentUserId || currentUserId !== userId) {
                alert('Only the assigned staff member can postpone this task.');
                return;
            }
            if (!planId || !Number.isInteger(taskIndex) || !window.AppDB || !window.AppCalendar) return;

            btn.disabled = true;
            const plan = await window.AppDB.get('work_plans', planId);
            if (!plan || !Array.isArray(plan.plans) || !plan.plans[taskIndex]) {
                throw new Error('Plan or task not found');
            }

            const defaultDate = nextDateIso(dateStr);
            const pickedDate = await openPostponePicker(btn, defaultDate);
            if (!pickedDate) {
                btn.disabled = false;
                return;
            }
            const normalizedDate = String(pickedDate).trim();
            if (!isValidIsoDate(normalizedDate)) {
                alert('Invalid date. Please use YYYY-MM-DD.');
                btn.disabled = false;
                return;
            }

            const [task] = plan.plans.splice(taskIndex, 1);
            plan.updatedAt = new Date().toISOString();
            await window.AppDB.put('work_plans', plan);

            const nextDate = normalizedDate;
            const scope = planScope || plan.planScope || 'personal';
            const targetUserId = scope === 'annual' ? 'annual_shared' : (plan.userId || userId);
            const targetPlanId = window.AppCalendar.getWorkPlanId(nextDate, targetUserId, scope);
            const movedTask = {
                ...task,
                status: 'postponed',
                startDate: nextDate,
                endDate: nextDate
            };
            delete movedTask.completedDate;

            const targetPlan = await window.AppDB.get('work_plans', targetPlanId);
            if (targetPlan) {
                targetPlan.plans = Array.isArray(targetPlan.plans) ? targetPlan.plans : [];
                targetPlan.plans.push(movedTask);
                targetPlan.updatedAt = new Date().toISOString();
                await window.AppDB.put('work_plans', targetPlan);
            } else {
                const safeUserId = scope === 'annual' ? null : targetUserId;
                await window.AppCalendar.setWorkPlan(nextDate, [movedTask], safeUserId, { planScope: scope });
            }

            await refreshData();
            if (window.app_showSyncToast) {
                window.app_showSyncToast(`Task postponed to ${nextDate}.`);
            }
            if (typeof window.app_refreshHeroAuditLive === 'function') {
                window.app_refreshHeroAuditLive().catch((refreshErr) => {
                    console.warn('Hero refresh after postpone failed:', refreshErr);
                });
            }
        } catch (err) {
            console.error('Postpone task failed', err);
            alert('Failed to postpone task.');
        }
    };

    window.app_teamActivitiesBulkRemove = async function () {
        try {
            const state = getTeamActivitiesState();
            const currentUser = window.AppAuth?.getUser ? window.AppAuth.getUser() : null;
            const isAdmin = !!(currentUser && (currentUser.role === 'Administrator' || currentUser.isAdmin));
            if (!isAdmin) {
                alert('Only admins can bulk remove tasks.');
                return;
            }
            if (!window.AppCalendar?.removeTask) {
                alert('Remove action is not available.');
                return;
            }
            const selected = new Set(state.selectedKeys || []);
            if (!selected.size) {
                alert('Select at least one removable task.');
                return;
            }
            const removable = state.filtered.filter(row => {
                const key = `${row.planId || ''}__${Number.isInteger(row.taskIndex) ? row.taskIndex : ''}`;
                return selected.has(key) && row.type === 'work' && row.planId && Number.isInteger(row.taskIndex);
            });
            if (!removable.length) {
                alert('No removable tasks in selection.');
                return;
            }
            if (!window.appConfirm || !await window.appConfirm(`Remove ${removable.length} selected task(s) so they stop carrying forward?`)) {
                return;
            }
            for (const row of removable) {
                await window.AppCalendar.removeTask(row.planId, row.taskIndex);
            }
            state.selectedKeys = [];
            await refreshData();
            if (window.app_showSyncToast) {
                window.app_showSyncToast(`${removable.length} task(s) removed.`);
            }
            if (typeof window.app_refreshHeroAuditLive === 'function') {
                window.app_refreshHeroAuditLive().catch((refreshErr) => {
                    console.warn('Hero refresh after bulk remove failed:', refreshErr);
                });
            }
        } catch (err) {
            console.error('Bulk remove failed', err);
            alert('Failed to bulk remove tasks.');
        }
    };

    window.app_teamActivitiesBulkShift = async function () {
        try {
            const state = getTeamActivitiesState();
            const currentUser = window.AppAuth?.getUser ? window.AppAuth.getUser() : null;
            const canManageAttendance = !!(currentUser && (currentUser.role === 'Administrator' || currentUser.isAdmin || currentUser.canManageAttendanceSheet));
            if (!canManageAttendance) {
                alert('Only admins or attendance managers can bulk shift tasks.');
                return;
            }
            if (!window.AppDB || !window.AppCalendar || typeof applyTeamActivitiesBulkShift !== 'function') {
                alert('Bulk shift is not available.');
                return;
            }

            const pivotDate = String(state.endIso || '').trim();
            const preview = buildTeamActivitiesBulkShiftPlan({
                rows: state.filtered || [],
                users: state.users || [],
                pivotDate
            });
            if (!preview.actions.length) {
                alert('No eligible tasks were found for the selected date range.');
                return;
            }

            const confirmText = [
                'Bulk shift rule:',
                '- checked-in staff: open tasks from any prior day move to today',
                '- checked-out staff: open tasks from any prior day or today move to tomorrow',
                '',
                `This will move ${preview.summary.movedToToday} task(s) to today and postpone ${preview.summary.postponedToTomorrow} task(s) to tomorrow.`,
                `Skipped: ${preview.summary.skipped}`,
                `Skipped by state - in: ${preview.summary.skippedByState.in}, out: ${preview.summary.skippedByState.out}, unknown: ${preview.summary.skippedByState.unknown}`
            ].join('\n');
            const approved = window.appConfirm
                ? await window.appConfirm(confirmText)
                : window.confirm(confirmText);
            if (!approved) {
                return;
            }

            const result = await applyTeamActivitiesBulkShift({
                rows: state.filtered || [],
                users: state.users || [],
                pivotDate,
                db: window.AppDB,
                calendar: window.AppCalendar,
                currentUser
            });

            await refreshData();
            const summary = formatBulkShiftSummary(result);
            if (window.app_showSyncToast) {
                window.app_showSyncToast('Team activities shifted.');
            }
            if (window.appAlert) {
                await window.appAlert(summary, 'Bulk Shift Complete');
            } else {
                alert(summary);
            }
            if (typeof window.app_refreshHeroAuditLive === 'function') {
                window.app_refreshHeroAuditLive().catch((refreshErr) => {
                    console.warn('Hero refresh after bulk shift failed:', refreshErr);
                });
            }
        } catch (err) {
            console.error('Bulk time shift failed', err);
            alert('Failed to bulk shift team activities.');
        }
    };

    window.app_teamActivitiesRemoveTask = async function (btn) {
        try {
            const currentUser = window.AppAuth?.getUser ? window.AppAuth.getUser() : null;
            const currentUserId = currentUser?.id || null;
            const isAdmin = !!(currentUser && (currentUser.role === 'Administrator' || currentUser.isAdmin));
            const planId = btn.getAttribute('data-plan-id');
            const taskIndex = Number(btn.getAttribute('data-task-index'));
            const ownerId = btn.getAttribute('data-user-id') || '';
            if (!planId || !Number.isInteger(taskIndex) || !window.AppCalendar?.removeTask) return;
            if (!isAdmin && (!currentUserId || currentUserId !== ownerId)) {
                alert('Only the assigned staff member or an admin can remove this task.');
                return;
            }
            if (!window.appConfirm || !await window.appConfirm('Remove this task so it stops carrying forward?')) {
                return;
            }
            btn.disabled = true;
            await window.AppCalendar.removeTask(planId, taskIndex);
            await refreshData();
            if (window.app_showSyncToast) {
                window.app_showSyncToast('Task removed.');
            }
            if (typeof window.app_refreshHeroAuditLive === 'function') {
                window.app_refreshHeroAuditLive().catch((refreshErr) => {
                    console.warn('Hero refresh after remove failed:', refreshErr);
                });
            }
        } catch (err) {
            console.error('Remove task failed', err);
            alert('Failed to remove task.');
        }
    };
}

export async function renderTeamActivitiesPage() {
    const state = getTeamActivitiesState();
    const currentUser = window.AppAuth?.getUser ? window.AppAuth.getUser() : null;
    const isAdmin = !!(currentUser && (currentUser.role === 'Administrator' || currentUser.isAdmin));
    const canManageAttendance = !!(currentUser && (currentUser.role === 'Administrator' || currentUser.isAdmin || currentUser.canManageAttendanceSheet));
    const budgetHeads = (window.app_budgetHeadsCache || [{ id: 'UNALLOCATED', code: 'UNALLOCATED', name: 'Unallocated / To Be Mapped' }]);
    const budgetHeadOptions = ['<option value="all">All budget heads</option>', ...budgetHeads.map((head) => {
        const id = String(head.id || '');
        const sel = id === String(state.budgetHead || 'all') ? 'selected' : '';
        return `<option value="${safeHtml(id)}" ${sel}>${safeHtml(String(head.code || id))}</option>`;
    })].join('');
    return `
        <div class="team-activities-page">
            <div class="team-activities-header">
                <div>
                    <h2>Team Activities</h2>
                    <div class="team-activities-meta">Last updated: <span id="team-activities-last-updated">--</span></div>
                </div>
                <div class="team-activities-actions">
                    <button class="action-btn" onclick="window.app_teamActivitiesRefresh()"><i class="fa-solid fa-rotate"></i> Refresh</button>
                    <button class="action-btn secondary" onclick="window.app_teamActivitiesExportXLSX()"><i class="fa-solid fa-file-excel"></i> Export Excel</button>
                    ${canManageAttendance ? `
                        <button class="action-btn secondary" onclick="window.app_teamActivitiesBulkShift()"><i class="fa-solid fa-clock-rotate-left"></i> Bulk Shift</button>
                    ` : ''}
                    ${isAdmin ? `
                        <button class="action-btn secondary" onclick="window.app_teamActivitiesResetFilters()"><i class="fa-solid fa-filter-circle-xmark"></i> Reset</button>
                        <button class="action-btn secondary" onclick="window.app_findCarryForwardIssues && window.app_findCarryForwardIssues()"><i class="fa-solid fa-triangle-exclamation"></i> Find Auto-Forward Issues</button>
                    ` : ''}
                </div>
            </div>
            <div class="team-activities-summary" id="team-activities-summary">${renderSummary(state)}</div>
            <div class="team-activities-filters compact" aria-label="Activity filters">
                <div class="team-activities-filter-group">
                    <label>Date range</label>
                    <div class="team-activities-date-range">
                        <input type="date" id="team-activities-start" value="${state.startIso}">
                        <span>to</span>
                        <input type="date" id="team-activities-end" value="${state.endIso}">
                    </div>
                </div>
                <div class="team-activities-filter-group">
                    <label>Search</label>
                    <input type="text" id="team-activities-search" placeholder="Search by staff, description, date...">
                </div>
                <div class="team-activities-filter-group">
                    <label>Budget Head</label>
                    <select id="team-activities-budget-head">${budgetHeadOptions}</select>
                </div>
            </div>
            <div id="team-activities-loading" class="team-activities-loading">Loading data...</div>
            <div class="team-activities-table-wrap" id="team-activities-table-wrap"></div>
            <div id="team-activities-pagination-wrap"></div>
            <div class="team-activities-load-more">
                <button class="action-btn secondary" data-load-more-week>Load 1 more week</button>
            </div>
        </div>
    `;
}
