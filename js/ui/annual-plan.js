/**
 * Annual Plan Component
 * Handles rendering of the yearly NGO planning view (Grid and List modes).
 */

import { safeHtml } from './helpers.js';
import { stripPrivateTasksForViewer, getCurrentViewerId } from '../utils/task-visibility.js';

let annualPlanDelegatesBound = false;

function ensureAnnualPlanDelegates() {
    if (annualPlanDelegatesBound || typeof document === 'undefined') return;
    annualPlanDelegatesBound = true;
    document.addEventListener('click', (event) => {
        const openDay = event.target.closest('[data-annual-open-day]');
        if (openDay) { window.app_openAnnualDayPlan?.(openDay.dataset.annualOpenDay); return; }
        const toggleView = event.target.closest('[data-annual-view]');
        if (toggleView) { window.app_toggleAnnualView?.(toggleView.dataset.annualView); return; }
        const jumpToday = event.target.closest('[data-annual-jump-today]');
        if (jumpToday) { window.app_jumpToAnnualToday?.(); return; }
        const yearDelta = event.target.closest('[data-annual-year-delta]');
        if (yearDelta) { window.app_changeAnnualYear?.(Number(yearDelta.dataset.annualYearDelta || 0)); return; }
        const legend = event.target.closest('[data-annual-legend]');
        if (legend) { window.app_toggleAnnualLegendFilter?.(legend.dataset.annualLegend); return; }
        const exportBtn = event.target.closest('[data-annual-export]');
        if (exportBtn) window.AppReports?.exportAnnualListViewCSV?.(window._annualListItems || []);
    });
    document.addEventListener('input', (event) => {
        const input = event.target.closest('[data-annual-staff-filter]');
        if (input) window.app_setAnnualStaffFilter?.(input.value);
    });
    document.addEventListener('change', (event) => {
        const select = event.target.closest('[data-annual-list-sort]');
        if (select) window.app_setAnnualListSort?.(select.value);
    });
    document.addEventListener('keydown', (event) => {
        const input = event.target.closest('[data-annual-list-search]');
        if (input && event.key === 'Enter') window.app_setAnnualListSearch?.(input.value);
    });
    document.addEventListener('mouseover', (event) => {
        const day = event.target.closest('[data-annual-preview-date]');
        if (!day || day.contains(event.relatedTarget)) return;
        window.app_showAnnualHoverPreview?.(event, day.dataset.annualPreviewDate);
    });
    document.addEventListener('mouseout', (event) => {
        const day = event.target.closest('[data-annual-preview-date]');
        if (!day || day.contains(event.relatedTarget)) return;
        window.app_hideAnnualHoverPreview?.();
    });
}
export async function renderAnnualPlan() {
    // Initialize global filters if not present
    if (typeof window.app_setAnnualStaffFilter !== 'function') {
        window.app_setAnnualStaffFilter = async (value) => {
            window.app_annualStaffFilter = String(value || '').trim();
            const contentArea = document.getElementById('page-content');
            if (!contentArea) return;
            contentArea.innerHTML = await renderAnnualPlan();
        };
    }
    if (typeof window.app_toggleAnnualView !== 'function') {
        window.app_toggleAnnualView = async (mode) => {
            window.app_annualViewMode = mode;
            const contentArea = document.getElementById('page-content');
            if (!contentArea) return;
            contentArea.innerHTML = await renderAnnualPlan();
        };
    }
    if (typeof window.app_setAnnualListSearch !== 'function') {
        window.app_setAnnualListSearch = async (value) => {
            window.app_annualListSearch = String(value || '').trim();
            const contentArea = document.getElementById('page-content');
            if (!contentArea) return;
            contentArea.innerHTML = await renderAnnualPlan();
        };
    }
    if (typeof window.app_setAnnualListSort !== 'function') {
        window.app_setAnnualListSort = async (value) => {
            window.app_annualListSort = String(value || 'date-asc').trim();
            const contentArea = document.getElementById('page-content');
            if (!contentArea) return;
            contentArea.innerHTML = await renderAnnualPlan();
        };
    }

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const year = window.app_annualYear || today.getFullYear();
    const plans = await window.AppCalendar.getPlans();
    const users = await window.AppDB.getAll('users').catch(() => []);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const attendanceLogs = await (
        window.AppDB.queryMany
            ? window.AppDB.queryMany('attendance', [
                { field: 'date', operator: '>=', value: yearStart },
                { field: 'date', operator: '<=', value: yearEnd }
            ]).catch(() => window.AppDB.getAll('attendance'))
            : window.AppDB.getAll('attendance')
    ).catch(() => []);
    window._currentPlans = plans;
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    const userMap = {};
    (users || []).forEach(u => { userMap[u.id] = u.name; });
    window._annualUserMap = userMap;
    const resolveName = (id, fallback) => userMap[id] || fallback || 'Staff';

    const filters = window.app_annualLegendFilters || {
        leave: true,
        event: true,
        work: true,
        overdue: true,
        completed: true
    };
    window.app_annualLegendFilters = filters;

    let selectedDate = window.app_selectedAnnualDate || (year === today.getFullYear() ? todayStr : null);
    selectedDate = selectedDate ? String(selectedDate) : null;
    if (selectedDate && !selectedDate.startsWith(`${year}-`)) selectedDate = null;
    window.app_selectedAnnualDate = selectedDate;

    const annualStaffFilter = String(window.app_annualStaffFilter || '').trim();
    const staffNeedle = annualStaffFilter.toLowerCase();
    const annualListSearch = String(window.app_annualListSearch || '').trim();
    const annualListNeedle = annualListSearch.toLowerCase();
    const annualListSort = String(window.app_annualListSort || 'date-asc');
    const staffOptions = (users || []).map(u => `<option value="${safeHtml(u.name)}"></option>`).join('');

    const matchesStaff = (name) => {
        if (!staffNeedle) return true;
        return String(name || '').toLowerCase().includes(staffNeedle);
    };

    const monthIndexMap = {
        january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
        july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
    };

    const inferRangeFromText = (text = '') => {
        const raw = String(text || '').trim();
        if (!raw) return null;
        const m = raw.match(/(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
        if (!m) return null;
        const d1 = Number(m[1]);
        const d2 = Number(m[2]);
        const monthName = String(m[3] || '').toLowerCase();
        const yearNum = Number(m[4]);
        const monthIdx = monthIndexMap[monthName];
        if (!Number.isInteger(d1) || !Number.isInteger(d2) || !Number.isInteger(monthIdx) || !Number.isInteger(yearNum)) return null;
        const start = new Date(yearNum, monthIdx, d1);
        const end = new Date(yearNum, monthIdx, d2);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
        const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        const endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
        if (endDate < startDate) return null;
        return { startDate, endDate };
    };

    const getTaskRangeBounds = (task, planDate) => {
        const inferred = (!task?.startDate && !task?.endDate) ? inferRangeFromText(task?.task || '') : null;
        const startDate = task?.startDate || inferred?.startDate || planDate;
        const endDate = task?.endDate || inferred?.endDate || task?.startDate || planDate;
        return { startDate, endDate };
    };

    const taskAppliesOnDate = (task, planDate, dateStr) => {
        const { startDate, endDate } = getTaskRangeBounds(task, planDate);
        if (!startDate || !endDate) return planDate === dateStr;
        if (dateStr < startDate || dateStr > endDate) return false;
        if (task?.completedDate && task.completedDate < dateStr) return false;
        return true;
    };

    const filteredWorkPlans = stripPrivateTasksForViewer(plans.workPlans || [], getCurrentViewerId()).filter(p => {
        const isAnnualPlan = (p.planScope || 'personal') === 'annual';
        if (isAnnualPlan) {
            if (!staffNeedle) return true;
            const ownerName = resolveName(p.userId, p.userName);
            if (matchesStaff(ownerName)) return true;
            return (p.plans || []).some(task => {
                const assigneeName = resolveName(task.assignedTo || p.userId, ownerName);
                const tagNames = (task.tags || []).map(t => t.name || t).join(' ');
                return matchesStaff(assigneeName) || matchesStaff(tagNames);
            });
        }
        if (!staffNeedle) return true;
        const ownerName = resolveName(p.userId, p.userName);
        if (matchesStaff(ownerName)) return true;
        return (p.plans || []).some(task => {
            const assigneeName = resolveName(task.assignedTo || p.userId, ownerName);
            const tagNames = (task.tags || []).map(t => t.name || t).join(' ');
            return matchesStaff(assigneeName) || matchesStaff(tagNames);
        });
    });

    const filteredLeaves = (plans.leaves || []).filter(l => matchesStaff(resolveName(l.userId, l.userName)));

    const filteredAttendanceLogs = (attendanceLogs || []).filter(l => {
        const dt = String(l.date || '');
        if (!dt.startsWith(String(year))) return false;
        const logUserId = l.user_id || l.userId;
        const logUserName = resolveName(logUserId, '');
        if (!staffNeedle) return true;
        return matchesStaff(logUserName);
    });

    const getDayMarkers = (d, m, y) => {
        const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const hasLeave = filteredLeaves.some(l => dateStr >= l.startDate && dateStr <= l.endDate);
        const hasEvent = !staffNeedle && (plans.events || []).some(e => e.date === dateStr);
        const hasLogWork = filteredAttendanceLogs.some(l => l.date === dateStr);
        const hasWork = filteredWorkPlans.some(p => {
            if (!Array.isArray(p.plans) || !p.plans.length) return p.date === dateStr;
            return p.plans.some(task => taskAppliesOnDate(task, p.date, dateStr));
        }) || hasLogWork;

        let workStatus = '';
        let hasRangeEnd = false;
        if (hasWork) {
            const daily = filteredWorkPlans.filter(p => {
                if (!Array.isArray(p.plans) || !p.plans.length) return p.date === dateStr;
                return p.plans.some(task => taskAppliesOnDate(task, p.date, dateStr));
            });
            let worst = 'to-be-started';
            daily.forEach(p => {
                (p.plans || []).forEach(task => {
                    if (!taskAppliesOnDate(task, p.date, dateStr)) return;
                    const { startDate, endDate } = getTaskRangeBounds(task, p.date);
                    if (startDate && endDate && startDate !== endDate && endDate === dateStr) hasRangeEnd = true;
                    const statusDate = task.completedDate || endDate || p.date || dateStr;
                    const s = window.AppCalendar ? window.AppCalendar.getSmartTaskStatus(statusDate, task.status) : (task.status || 'pending');
                    if (s === 'overdue') worst = 'overdue';
                    else if (s === 'in-process' && worst !== 'overdue') worst = 'in-process';
                    else if (s === 'completed' && worst !== 'overdue' && worst !== 'in-process') worst = 'completed';
                });
            });
            if (hasLogWork && worst === 'to-be-started') worst = 'completed';
            workStatus = worst;
        }
        return { hasLeave, hasEvent, hasWork, workStatus, hasRangeEnd };
    };

    let monthsHTML = '';
    for (let m = 0; m < 12; m++) {
        const firstDay = new Date(year, m, 1).getDay();
        const daysInMonth = new Date(year, m + 1, 0).getDate();
        let daysHTML = '';
        for (let i = 0; i < firstDay; i++) daysHTML += '<div class="annual-day empty"></div>';
        for (let d = 1; d <= daysInMonth; d++) {
            const markers = getDayMarkers(d, m, year);
            const isToday = d === today.getDate() && m === today.getMonth() && year === today.getFullYear();
            const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const showLeave = markers.hasLeave && filters.leave;
            const showEvent = markers.hasEvent && filters.event;
            const showWorkByStatus = markers.hasWork && filters.work && (
                markers.workStatus === 'overdue' ? filters.overdue :
                    markers.workStatus === 'completed' ? filters.completed : true
            );
            const hasAnyVisible = showLeave || showEvent || showWorkByStatus;
            const bgClass = showWorkByStatus ? `has-work work-${markers.workStatus}` : '';
            const selectedClass = selectedDate === dateStr ? 'selected' : '';
            const mutedClass = hasAnyVisible ? '' : 'annual-day-muted';

            daysHTML += `
                <div class="annual-day ${isToday ? 'today' : ''} ${bgClass} ${selectedClass} ${mutedClass}" data-annual-open-day="${dateStr}" data-annual-preview-date="${dateStr}">
                    ${d}
                    <div class="dot-container">
                        ${showLeave ? '<span class="status-dot dot-leave"></span>' : ''}
                        ${showEvent ? '<span class="status-dot dot-event"></span>' : ''}
                        ${showWorkByStatus ? '<span class="status-dot dot-work"></span>' : ''}
                        ${markers.hasRangeEnd ? '<span class="status-dot" title="Task ends today" style="background:#f97316;"></span>' : ''}
                    </div>
                </div>`;
        }
        monthsHTML += `
            <div class="annual-month-card">
                <div class="annual-month-head">
                    <span class="annual-month-title">${monthNames[m]}</span>
                    <span class="annual-month-year">${year}</span>
                </div>
                <div class="annual-cal-mini">
                    <div class="annual-weekday">S</div>
                    <div class="annual-weekday">M</div>
                    <div class="annual-weekday">T</div>
                    <div class="annual-weekday">W</div>
                    <div class="annual-weekday">T</div>
                    <div class="annual-weekday">F</div>
                    <div class="annual-weekday">S</div>
                    ${daysHTML}
                </div>
            </div>`;
    }

    const viewMode = window.app_annualViewMode || 'grid';

    const listItems = (() => {
        const items = [];
        const seenEventKeys = new Set();
        const toStatusLabel = (status) => {
            if (!status) return '';
            const clean = String(status).replace(/_/g, '-').toLowerCase();
            const map = {
                'in-process': 'In Process',
                'to-be-started': 'To Be Started',
                'not-completed': 'Not Completed',
                'completed': 'Completed',
                'overdue': 'Overdue',
                'pending': 'Pending',
                'approved': 'Approved',
                'holiday': 'Holiday',
                'event': 'Event'
            };
            return map[clean] || clean.replace(/\b\w/g, c => c.toUpperCase());
        };
        const normalizeStatus = (date, status) => {
            if (status) return status;
            if (window.AppCalendar && date) {
                return window.AppCalendar.getSmartTaskStatus(date, status);
            }
            return 'pending';
        };

        if (!staffNeedle && window.AppAnalytics) {
            const start = new Date(year, 0, 1);
            const end = new Date(year, 11, 31);
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dt = d.toISOString().split('T')[0];
                const dayType = window.AppAnalytics.getDayType(d);
                if (dayType === 'Holiday') {
                    items.push({
                        date: dt, type: 'holiday', title: 'Company Holiday (Weekend)', staffName: 'All Staff',
                        assignedBy: 'System', assignedTo: 'All Staff', selfAssigned: false,
                        dueDate: dt, status: 'holiday', comments: '', scope: 'Shared'
                    });
                } else if (dayType === 'Half Day') {
                    items.push({
                        date: dt, type: 'event', title: 'Half Working Day (Sat)', staffName: 'All Staff',
                        assignedBy: 'System', assignedTo: 'All Staff', selfAssigned: false,
                        dueDate: dt, status: 'event', comments: '', scope: 'Shared'
                    });
                }
            }
        }

        filteredLeaves.forEach(l => {
            const startDate = new Date(l.startDate);
            const endDate = new Date(l.endDate || l.startDate);
            const staffName = resolveName(l.userId, l.userName);
            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const dt = d.toISOString().split('T')[0];
                if (!dt.startsWith(String(year))) continue;
                items.push({
                    date: dt, type: 'leave', title: `${staffName} (${l.type || 'Leave'})`, staffName,
                    assignedBy: staffName, assignedTo: staffName, selfAssigned: true,
                    dueDate: l.endDate || l.startDate || dt, status: (l.status || 'approved').toLowerCase(),
                    comments: l.reason || '', scope: 'Personal'
                });
            }
        });

        (plans.events || []).forEach(e => {
            if (!staffNeedle && String(e.date || '').startsWith(String(year))) {
                const eventKey = [
                    String(e.date || '').trim(),
                    String(e.title || '').trim().toLowerCase(),
                    String(e.type || 'event').trim().toLowerCase(),
                    String(e.createdById || e.createdByName || '').trim().toLowerCase()
                ].join('|');
                if (seenEventKeys.has(eventKey)) return;
                seenEventKeys.add(eventKey);
                items.push({
                    date: e.date, type: e.type || 'event', title: e.title || 'Company Event', staffName: 'All Staff',
                    assignedBy: e.createdByName || 'Admin', assignedTo: 'All Staff', selfAssigned: false,
                    dueDate: e.date, status: 'event', comments: e.description || '', scope: 'Shared'
                });
            }
        });

        filteredWorkPlans.forEach(p => {
            if (String(p.date || '').startsWith(String(year))) {
                const isAnnualPlan = (p.planScope || 'personal') === 'annual';
                const planOwner = resolveName(p.userId, p.userName) || (isAnnualPlan ? 'All Staff' : 'Staff');
                const scopeLabel = isAnnualPlan ? 'Annual' : 'Personal';
                const planDate = p.date;
                if (p.plans && p.plans.length > 0) {
                    p.plans.forEach(task => {
                        const assignedBy = isAnnualPlan ? (p.createdByName || task.taggedByName || 'Admin') : (task.taggedByName || planOwner);
                        const assignedToId = task.assignedTo || p.userId;
                        const assignedTo = isAnnualPlan ? assignedBy : resolveName(assignedToId, planOwner);
                        const tags = (task.tags || []).map(t => t.name || t).filter(Boolean);
                        const { startDate, endDate } = getTaskRangeBounds(task, planDate);
                        const statusDate = task.completedDate || endDate || planDate;
                        const status = normalizeStatus(statusDate, task.status);
                        const comments = (task.subPlans && task.subPlans.length) ? task.subPlans.join('; ') : (task.comment || task.notes || '');
                        items.push({
                            date: startDate || planDate, type: 'work', title: task.task || 'Work Plan Task',
                            staffName: isAnnualPlan ? assignedBy : assignedTo, assignedBy, assignedTo: isAnnualPlan ? assignedBy : assignedTo,
                            selfAssigned: assignedBy === assignedTo, dueDate: task.dueDate || endDate || planDate, status,
                            comments, tags, scope: scopeLabel
                        });
                    });
                }
            }
        });

        filteredAttendanceLogs.forEach(l => {
            const logUserId = l.user_id || l.userId;
            const staffName = resolveName(logUserId, 'Staff');
            const summary = (l.workDescription || l.location || '').trim() || 'Manual log entry';
            items.push({
                date: l.date, type: 'work', title: summary, staffName, assignedBy: staffName, assignedTo: staffName,
                selfAssigned: true, dueDate: l.date, status: 'completed', comments: summary, tags: ['Manual Log'], scope: 'Personal'
            });
        });

        const deduped = [];
        const rowKeys = new Set();
        items.forEach(item => {
            const key = `${item.date || ''}|${item.type || ''}|${item.title || ''}|${item.staffName || ''}|${item.status || ''}`.toLowerCase();
            if (rowKeys.has(key)) return;
            rowKeys.add(key);
            deduped.push(item);
        });

        deduped.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
        deduped.forEach(item => {
            item.statusLabel = toStatusLabel(item.status);
            item.statusClass = String(item.status || 'pending').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        });

        let filteredItems = (annualListNeedle) ? deduped.filter(item => {
            const haystack = [item.date, item.staffName, item.title, item.statusLabel, item.comments].join(' ').toLowerCase();
            return haystack.includes(annualListNeedle);
        }) : deduped;

        const comparators = {
            'date-asc': (a, b) => String(a.date || '').localeCompare(String(b.date || '')),
            'date-desc': (a, b) => String(b.date || '').localeCompare(String(a.date || '')),
            'staff-asc': (a, b) => String(a.staffName || '').localeCompare(String(b.staffName || '')),
            'staff-desc': (a, b) => String(b.staffName || '').localeCompare(String(a.staffName || '')),
            'status-asc': (a, b) => String(a.statusLabel || '').localeCompare(String(b.statusLabel || '')),
            'status-desc': (a, b) => String(b.statusLabel || '').localeCompare(String(a.statusLabel || ''))
        };
        const sorter = comparators[annualListSort] || comparators['date-asc'];
        return filteredItems.slice().sort(sorter);
    })();

    window._annualListItems = listItems;

    setTimeout(() => ensureAnnualPlanDelegates(), 0);
    return `
        <div class="annual-plan-shell annual-v2-shell">
            <div class="card annual-plan-header annual-v2-header">
                <div class="annual-plan-title-wrap annual-v2-title-wrap">
                    <h2 class="annual-plan-title annual-v2-title">NGO Annual Planning</h2>
                    <p class="annual-plan-subtitle annual-v2-subtitle">Overview of activities for ${year}.</p>
                </div>
                <div class="annual-plan-controls annual-v2-controls">
                    <div class="annual-staff-filter annual-v2-staff-filter">
                        <i class="fa-solid fa-user"></i>
                        <input type="text" list="annual-staff-names" value="${safeHtml(annualStaffFilter)}" placeholder="Filter by staff name" data-annual-staff-filter="1">
                        <datalist id="annual-staff-names">${staffOptions}</datalist>
                    </div>
                    <div class="annual-view-toggle annual-v2-view-toggle">
                        <button data-annual-view="grid" class="annual-toggle-btn annual-v2-toggle-btn ${viewMode === 'grid' ? 'active' : ''}">
                            <i class="fa-solid fa-calendar-days"></i> Grid
                        </button>
                        <button data-annual-view="list" class="annual-toggle-btn annual-v2-toggle-btn ${viewMode === 'list' ? 'active' : ''}">
                            <i class="fa-solid fa-list"></i> List
                        </button>
                    </div>
                    <button data-annual-jump-today="1" class="annual-today-btn annual-v2-today-btn" title="Jump to today">
                        <i class="fa-solid fa-bullseye"></i> Today
                    </button>
                    <div class="annual-year-switch annual-v2-year-switch">
                        <button data-annual-year-delta="-1"><i class="fa-solid fa-chevron-left"></i></button>
                        <div class="annual-year-label">${year}</div>
                        <button data-annual-year-delta="1"><i class="fa-solid fa-chevron-right"></i></button>
                    </div>
                </div>
            </div>

            <div id="annual-grid-view" style="display:${viewMode === 'grid' ? 'block' : 'none'};">
                <div class="card annual-legend-bar annual-v2-legend-bar">
                    <button class="annual-legend-chip ${filters.leave ? 'active' : ''}" data-annual-legend="leave"><span class="annual-dot leave"></span> Staff Leave</button>
                    <button class="annual-legend-chip ${filters.event ? 'active' : ''}" data-annual-legend="event"><span class="annual-dot event"></span> Company Event</button>
                    <button class="annual-legend-chip ${filters.work ? 'active' : ''}" data-annual-legend="work"><span class="annual-dot work"></span> Work Plan</button>
                    <button class="annual-legend-chip ${filters.overdue ? 'active' : ''}" data-annual-legend="overdue">Overdue Border</button>
                    <button class="annual-legend-chip ${filters.completed ? 'active' : ''}" data-annual-legend="completed">Completed Border</button>
                </div>
                <div class="annual-grid-layout annual-v2-grid-layout">
                    <div class="annual-plan-grid annual-v2-plan-grid">
                        ${monthsHTML}
                    </div>
                </div>
            </div>

            <div id="annual-list-view" style="display:${viewMode === 'list' ? 'block' : 'none'};">
                <div class="card annual-list-card annual-v2-list-card">
                    <div class="annual-list-head annual-v2-list-head">
                        <h4>Annual Timeline</h4>
                        <div class="annual-list-actions annual-v2-list-actions">
                            <div class="annual-list-search-wrap annual-v2-search-wrap">
                                <i class="fa-solid fa-magnifying-glass"></i>
                                <input type="text" value="${safeHtml(annualListSearch)}" placeholder="Search list..." data-annual-list-search="1">
                            </div>
                            <select class="annual-v2-sort-select" data-annual-list-sort="1">
                                <option value="date-asc" ${annualListSort === 'date-asc' ? 'selected' : ''}>Date: Oldest First</option>
                                <option value="date-desc" ${annualListSort === 'date-desc' ? 'selected' : ''}>Date: Newest First</option>
                                <option value="staff-asc" ${annualListSort === 'staff-asc' ? 'selected' : ''}>Staff: A-Z</option>
                                <option value="staff-desc" ${annualListSort === 'staff-desc' ? 'selected' : ''}>Staff: Z-A</option>
                            </select>
                            <button class="annual-v2-export-btn" data-annual-export="1">
                                <i class="fa-solid fa-file-export"></i> Export Excel
                            </button>
                        </div>
                    </div>
                    ${listItems.length === 0 ? '<div class="annual-list-empty">No items found.</div>' : `
                        <div class="annual-list-table-wrap">
                            <div class="annual-list-table">
                                <div class="annual-list-header">
                                    <div>Date</div><div>Staff Name</div><div>Task</div><div>Assigned By</div><div>Status</div><div>Comments</div><div>Scope</div>
                                </div>
                                ${listItems.map(item => `
                                    <div class="annual-list-row">
                                        <div class="annual-list-cell">${item.date}</div>
                                        <div class="annual-list-cell">${safeHtml(item.staffName)}</div>
                                        <div class="annual-list-cell annual-list-task">${safeHtml(item.title)}</div>
                                        <div class="annual-list-cell">${safeHtml(item.assignedBy)}</div>
                                        <div class="annual-list-cell"><span class="annual-list-status status-${item.statusClass}">${item.statusLabel}</span></div>
                                        <div class="annual-list-cell annual-list-comments">${safeHtml(item.comments || '--')}</div>
                                        <div class="annual-list-cell">${item.scope}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `}
                </div>
            </div>
        </div>`;
}
