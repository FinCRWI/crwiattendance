/**
 * Kanban Board Page
 * Drag-and-drop task board grouped by status.
 * Zero extra Firestore reads on page load — reuses getAllStaffActivities().
 * Only 1 read + 1 write per card drag (via AppCalendar.updateTaskStatus).
 */

import { safeHtml } from './helpers.js';
import { normalizeTaskStatus } from '../utils/task-status.js';
import { ensureViewToggleCSS } from './view-toggle.js';

/* ---------- Config ---------- */
const COLUMNS = [
    { key: 'to-be-started', label: 'To Be Started', icon: 'fa-circle-dot' },
    { key: 'in-process',    label: 'In Progress',   icon: 'fa-spinner' },
    { key: 'completed',     label: 'Completed',      icon: 'fa-circle-check' },
    { key: 'overdue',       label: 'Overdue',        icon: 'fa-circle-exclamation' },
    { key: 'postponed',     label: 'Postponed',      icon: 'fa-clock' },
    { key: 'not-completed', label: 'Not Completed',  icon: 'fa-circle-xmark' }
];

const STATUS_ORDER = COLUMNS.map(c => c.key);

const TOAST_DURATION = 2200;

/* ---------- Real-time Listener State ---------- */
let kanbanListenerUnsubscribe = null;
let kanbanRefreshDebounce = null;
let kanbanLastSnapshotSig = '';

/* ---------- State ---------- */
function getState() {
    if (!window.app_kanbanState) {
        const end = new Date();
        const start = new Date(end);
        start.setDate(start.getDate() - 7);
        window.app_kanbanState = {
            startIso: start.toISOString().split('T')[0],
            endIso: end.toISOString().split('T')[0],
            search: '',
            staffFilter: '',
            data: [],
            grouped: {},
            users: [],
            lastRefreshed: null
        };
    }
    return window.app_kanbanState;
}

/* ---------- Data ---------- */
function normalizeRows(rows) {
    return (rows || []).map(row => {
        const type = row.type || (row.workDescription ? 'attendance' : 'work');
        const description = row._displayDesc || row.workDescription || row.task || 'Activity';
        const status = normalizeTaskStatus(
            {
                status: row.status || (type === 'attendance' ? 'completed' : ''),
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
            staffName: row.staffName || row.userName || 'Staff',
            userId: row.userId || row.user_id || '',
            type,
            description,
            status,
            planId: row.planId || '',
            taskIndex: row.taskIndex != null ? row.taskIndex : null,
            budgetHeadId: row.budgetHeadId || '',
            planScope: row.planScope || 'personal',
            sourcePlanId: row.sourcePlanId || '',
            addedFrom: row.addedFrom || '',
            progressPercent: row.progressPercent,
            onedriveLink: row.onedriveLink || '',
            comments: Array.isArray(row.comments) ? row.comments : []
        };
    });
}

function groupByStatus(rows) {
    const grouped = {};
    STATUS_ORDER.forEach(k => { grouped[k] = []; });
    rows.forEach(row => {
        const key = STATUS_ORDER.includes(row.status) ? row.status : 'to-be-started';
        grouped[key].push(row);
    });
    return grouped;
}

function extractUsers(rows) {
    const map = new Map();
    rows.forEach(r => {
        if (r.userId && !map.has(r.userId)) {
            map.set(r.userId, r.staffName);
        }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

function applyFilters(state) {
    let rows = [...state.data];
    if (state.staffFilter) {
        rows = rows.filter(r => r.userId === state.staffFilter);
    }
    if (state.search) {
        const q = state.search.toLowerCase();
        rows = rows.filter(r =>
            (r.description || '').toLowerCase().includes(q) ||
            (r.staffName || '').toLowerCase().includes(q) ||
            (r.date || '').includes(q)
        );
    }
    state.grouped = groupByStatus(rows);
    state.users = extractUsers(state.data);
}

/* ---------- Templates ---------- */
const TEMPLATES_KEY = 'kanban_task_templates';

function getTemplates() {
    try {
        return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]');
    } catch { return []; }
}

function saveTemplates(templates) {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

function renderTemplatesBar() {
    const templates = getTemplates();
    const chips = templates.map((t, i) => `
        <span class="kanban-template-chip" data-template-index="${i}">
            ${safeHtml(t.name)}
            <i class="fa-solid fa-xmark" data-template-delete="${i}" title="Remove"></i>
        </span>`).join('');

    return `
        <div class="kanban-templates-bar">
            <span class="kanban-templates-bar-label"><i class="fa-solid fa-bookmark"></i> Templates</span>
            <div class="kanban-templates-list">${chips || '<span style="font-size:0.72rem;color:#9ca3af;">None saved yet</span>'}</div>
            <button class="kanban-template-add" id="kanban-template-add" title="Save current filters as template">
                <i class="fa-solid fa-plus"></i> Save
            </button>
        </div>`;
}

/* ---------- Rendering ---------- */
function renderControls(state) {
    const usersOpts = state.users.map(u =>
        `<option value="${u.id}"${state.staffFilter === u.id ? ' selected' : ''}>${safeHtml(u.name)}</option>`
    ).join('');

    return `
        <div class="kanban-controls">
            <input type="date" id="kanban-start" value="${state.startIso}" title="Start date">
            <input type="date" id="kanban-end" value="${state.endIso}" title="End date">
            <select id="kanban-staff">
                <option value="">All Staff</option>
                ${usersOpts}
            </select>
            <input type="search" id="kanban-search" placeholder="Search tasks..." value="${safeHtml(state.search)}">
        </div>`;
}

function renderColumn(col, cards) {
    const cardsHtml = cards.map(card => renderCard(card)).join('');
    return `
        <div class="kanban-column" data-status="${col.key}">
            <div class="kanban-column-header">
                <span class="kanban-column-title">
                    <i class="fa-solid ${col.icon}"></i>
                    ${col.label}
                </span>
                <span class="kanban-column-count">${cards.length}</span>
            </div>
            <div class="kanban-column-cards" data-status="${col.key}">
                ${cardsHtml}
            </div>
        </div>`;
}

function renderCard(row) {
    const hasPlan = row.planId && row.taskIndex != null;
    const draggable = hasPlan ? 'draggable="true"' : '';
    const dataAttrs = hasPlan
        ? `data-plan-id="${safeHtml(row.planId)}" data-task-index="${row.taskIndex}"`
        : '';

    const chips = [];
    chips.push(`<span class="kanban-card-chip staff-chip"><i class="fa-solid fa-user"></i>${safeHtml(row.staffName)}</span>`);
    chips.push(`<span class="kanban-card-chip date-chip"><i class="fa-regular fa-calendar"></i>${safeHtml(row.date)}</span>`);
    if (row.planScope === 'annual') {
        chips.push(`<span class="kanban-card-chip scope-chip"><i class="fa-solid fa-layer-group"></i>Annual</span>`);
    }
    if (row.budgetHeadId && row.budgetHeadId !== 'UNALLOCATED') {
        chips.push(`<span class="kanban-card-chip budget-chip"><i class="fa-solid fa-sack-dollar"></i>${safeHtml(row.budgetHeadId)}</span>`);
    }
    if (row.addedFrom) {
        const src = row.addedFrom === 'minutes' ? 'Minutes' : row.addedFrom === 'postponed' ? 'Postponed' : row.addedFrom;
        chips.push(`<span class="kanban-card-chip source-chip"><i class="fa-solid fa-link"></i>${safeHtml(src)}</span>`);
    }
    if (row.onedriveLink) {
        chips.push(`<span class="kanban-card-chip onedrive-chip"><i class="fa-brands fa-microsoft"></i><a href="${safeHtml(row.onedriveLink)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">OneDrive</a></span>`);
    }
    const commentCount = Array.isArray(row.comments) ? row.comments.length : 0;
    if (commentCount > 0) {
        chips.push(`<span class="kanban-card-chip comment-chip"><i class="fa-solid fa-comment"></i>${commentCount}</span>`);
    }

    return `
        <div class="kanban-card" ${draggable} ${dataAttrs}>
            <div class="kanban-card-header">
                <span class="kanban-card-title">${safeHtml(row.description)}</span>
                ${hasPlan ? `<button class="kanban-card-link-btn" draggable="false" data-action="link" data-plan-id="${safeHtml(row.planId)}" data-task-index="${row.taskIndex}" data-existing-link="${safeHtml(row.onedriveLink || '')}" title="${row.onedriveLink ? 'Edit OneDrive link' : 'Add OneDrive link'}">
                    <i class="fa-brands fa-microsoft"></i> ${row.onedriveLink ? 'Link' : 'Attach'}
                </button>` : ''}
            </div>
            <div class="kanban-card-meta">
                ${chips.join('')}
            </div>
        </div>`;
}

function renderBoard(state) {
    const cols = COLUMNS.map(col => renderColumn(col, state.grouped[col.key] || []));
    return `${renderTemplatesBar()}<div class="kanban-refresh-banner" id="kanban-refresh-banner"><i class="fa-solid fa-rotate"></i> Updates available — Click to refresh</div><div class="kanban-board" id="kanban-board">${cols.join('')}</div>`;
}

function renderLoadingSkeleton() {
    const cols = COLUMNS.map(() => `
        <div class="kanban-skeleton-column">
            <div class="kanban-skeleton-header"></div>
            <div class="kanban-skeleton-card"></div>
            <div class="kanban-skeleton-card"></div>
            <div class="kanban-skeleton-card"></div>
        </div>`).join('');
    return `<div class="kanban-board" id="kanban-board">${cols}</div>`;
}

/* ---------- Toast ---------- */
function showToast(message) {
    let toast = document.getElementById('kanban-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'kanban-toast';
        toast.className = 'kanban-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), TOAST_DURATION);
}

/* ---------- Drag & Drop ---------- */
function setupDragDrop() {
    const board = document.getElementById('kanban-board');
    if (!board) return;

    let draggedData = null;

    board.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.kanban-card');
        if (!card) return;
        const planId = card.dataset.planId;
        const taskIndex = card.dataset.taskIndex;
        if (!planId || taskIndex == null) return;

        draggedData = { planId, taskIndex: parseInt(taskIndex, 10) };
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify(draggedData));
    });

    board.addEventListener('dragend', (e) => {
        const card = e.target.closest('.kanban-card');
        if (card) card.classList.remove('dragging');
        board.querySelectorAll('.kanban-column').forEach(col => col.classList.remove('drag-over'));
        draggedData = null;
    });

    board.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const col = e.target.closest('.kanban-column');
        if (col) {
            board.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over'));
            col.classList.add('drag-over');
        }
    });

    board.addEventListener('dragleave', (e) => {
        const col = e.target.closest('.kanban-column');
        if (col && !col.contains(e.relatedTarget)) {
            col.classList.remove('drag-over');
        }
    });

    board.addEventListener('drop', async (e) => {
        e.preventDefault();
        const col = e.target.closest('.kanban-column');
        if (!col || !draggedData) return;

        const targetStatus = col.dataset.status;
        let { planId, taskIndex } = draggedData;

        col.classList.remove('drag-over');

        // Find current status of the card
        const state = getState();
        let currentStatus = '';
        for (const [status, cards] of Object.entries(state.grouped)) {
            if (cards.some(c => c.planId === planId && c.taskIndex === taskIndex)) {
                currentStatus = status;
                break;
            }
        }

        if (currentStatus === targetStatus) return;

        // If moving to "to-be-started", prompt for new date
        let newDate = null;
        if (targetStatus === 'to-be-started') {
            const today = new Date().toISOString().split('T')[0];
            const rawRow = state.data.find(r => r.planId === planId && r.taskIndex === taskIndex);
            const oldDate = rawRow?.date || today;
            const dateInput = prompt(`Reschedule task to:`, today);
            if (dateInput === null) return; // user cancelled
            const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim());
            newDate = validDate ? dateInput.trim() : today;
        }

        // Update Firestore
        const origPlanId = draggedData.planId;
        const origTaskIndex = draggedData.taskIndex;
        try {
            if (newDate && window.AppCalendar?.updateTaskDate) {
                // Moving to "to-be-started" with new date — this moves the task to a new document
                const newPlan = await window.AppCalendar.updateTaskDate(origPlanId, origTaskIndex, newDate);
                if (newPlan && newPlan.id) {
                    planId = newPlan.id;
                    taskIndex = newPlan.plans.length - 1;
                }
            } else if (window.AppCalendar?.updateTaskStatus) {
                // Simple status change, no date move
                await window.AppCalendar.updateTaskStatus(origPlanId, origTaskIndex, targetStatus);
            }
        } catch (err) {
            console.error('Kanban: Failed to update task', err);
            showToast('Failed to update task. Please try again.');
            return;
        }

        // Update local state optimistically — find card by ORIGINAL IDs
        for (const [_status, cards] of Object.entries(state.grouped)) {
            const idx = cards.findIndex(c => c.planId === origPlanId && c.taskIndex === origTaskIndex);
            if (idx !== -1) {
                const [moved] = cards.splice(idx, 1);
                moved.status = targetStatus;
                if (newDate) moved.date = newDate;
                moved.planId = planId;
                moved.taskIndex = taskIndex;
                state.grouped[targetStatus] = state.grouped[targetStatus] || [];
                state.grouped[targetStatus].push(moved);
                break;
            }
        }

        // Also update raw data
        const rawRow = state.data.find(r => r.planId === origPlanId && r.taskIndex === origTaskIndex);
        if (rawRow) {
            rawRow.status = targetStatus;
            if (newDate) rawRow.date = newDate;
            rawRow.planId = planId;
            rawRow.taskIndex = taskIndex;
        }

        // Re-render board
        const boardEl = document.getElementById('kanban-board');
        if (boardEl) {
            boardEl.outerHTML = renderBoard(state);
            setupDragDrop();
        }

        const label = COLUMNS.find(c => c.key === targetStatus)?.label || targetStatus;
        showToast(newDate ? `Moved to ${label} — scheduled ${newDate}` : `Task moved to ${label}`);
    });
}

/* ---------- Event Binding ---------- */
function showExpandModal(row) {
    const existing = document.querySelector('.kanban-card-expand');
    if (existing) existing.remove();

    const chips = [];
    chips.push(`<span class="kanban-card-chip staff-chip"><i class="fa-solid fa-user"></i>${safeHtml(row.staffName)}</span>`);
    chips.push(`<span class="kanban-card-chip date-chip"><i class="fa-regular fa-calendar"></i>${safeHtml(row.date)}</span>`);
    if (row.status) chips.push(`<span class="kanban-card-chip"><i class="fa-solid fa-flag"></i>${safeHtml(row.status)}</span>`);
    if (row.budgetHeadId && row.budgetHeadId !== 'UNALLOCATED') chips.push(`<span class="kanban-card-chip budget-chip"><i class="fa-solid fa-sack-dollar"></i>${safeHtml(row.budgetHeadId)}</span>`);
    if (row.onedriveLink) chips.push(`<span class="kanban-card-chip onedrive-chip"><i class="fa-brands fa-microsoft"></i><a href="${safeHtml(row.onedriveLink)}" target="_blank" rel="noopener">OneDrive</a></span>`);

    const comments = Array.isArray(row.comments) ? row.comments : [];
    const commentsHtml = comments.length
        ? comments.map(c => `
            <div class="kanban-comment-item">
                <div class="kanban-comment-meta">${safeHtml(c.author || 'Staff')} · <span class="kanban-comment-time">${timeAgo(c.ts)}</span></div>
                <div class="kanban-comment-text">${safeHtml(c.text)}</div>
            </div>`).join('')
        : '<div class="kanban-comment-empty">No comments yet</div>';

    const overlay = document.createElement('div');
    overlay.className = 'kanban-card-expand open';
    overlay.innerHTML = `
        <div class="kanban-card-expand-box">
            <button class="kanban-card-expand-close"><i class="fa-solid fa-xmark"></i></button>
            <div class="kanban-card-expand-label">Task Description</div>
            <div class="kanban-card-expand-text">${safeHtml(row.description || 'No description')}</div>
            <div class="kanban-card-expand-meta">${chips.join('')}</div>
            <div class="kanban-expand-section">
                <div class="kanban-expand-section-title"><i class="fa-solid fa-comments"></i> Comments</div>
                <div class="kanban-comments-list" data-plan-id="${safeHtml(row.planId || '')}" data-task-index="${row.taskIndex != null ? row.taskIndex : ''}">
                    ${commentsHtml}
                </div>
                <div class="kanban-comment-form">
                    <input type="text" class="kanban-comment-input" placeholder="Add a comment..." maxlength="500">
                    <button class="kanban-comment-submit" type="button"><i class="fa-solid fa-paper-plane"></i></button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('.kanban-comment-input');
    const submitBtn = overlay.querySelector('.kanban-comment-submit');
    const list = overlay.querySelector('.kanban-comments-list');

    const addComment = async () => {
        const text = (input.value || '').trim();
        if (!text || !row.planId || row.taskIndex == null) return;
        const user = window.AppAuth?.getUser?.();
        const authorName = user?.name || 'Staff';
        submitBtn.disabled = true;
        try {
            const updatedComments = await window.AppCalendar.addTaskComment(row.planId, row.taskIndex, text, authorName);
            input.value = '';
            const rawRow = window.app_kanbanState?.data?.find(r => r.planId === row.planId && r.taskIndex === row.taskIndex);
            if (rawRow) rawRow.comments = updatedComments;
            list.innerHTML = updatedComments.map(c => `
                <div class="kanban-comment-item">
                    <div class="kanban-comment-meta">${safeHtml(c.author || 'Staff')} · <span class="kanban-comment-time">${timeAgo(c.ts)}</span></div>
                    <div class="kanban-comment-text">${safeHtml(c.text)}</div>
                </div>`).join('') || '<div class="kanban-comment-empty">No comments yet</div>';
        } catch (err) {
            console.error('Failed to add comment:', err);
        } finally {
            submitBtn.disabled = false;
        }
    };

    submitBtn.addEventListener('click', addComment);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addComment();
    });
}

function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
}

function bindEvents() {
    const state = getState();

    let searchTimer = null;
    document.addEventListener('input', (e) => {
        if (e.target.id === 'kanban-search') {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                state.search = e.target.value || '';
                applyFilters(state);
                rerenderBoard(state);
            }, 250);
        }
    });

    document.addEventListener('change', (e) => {
        if (e.target.id === 'kanban-start' || e.target.id === 'kanban-end') {
            state.startIso = document.getElementById('kanban-start')?.value || state.startIso;
            state.endIso = document.getElementById('kanban-end')?.value || state.endIso;
            refreshData();
        }
        if (e.target.id === 'kanban-staff') {
            state.staffFilter = e.target.value || '';
            applyFilters(state);
            rerenderBoard(state);
        }
    });

    document.addEventListener('click', async (e) => {
        // Card title expand
        const titleEl = e.target.closest('.kanban-card-title');
        if (titleEl) {
            e.preventDefault();
            e.stopPropagation();
            const card = titleEl.closest('.kanban-card');
            if (!card) return;
            const planId = card.dataset.planId;
            const taskIndex = card.dataset.taskIndex;
            const row = state.data.find(r => r.planId === planId && r.taskIndex === parseInt(taskIndex, 10));
            if (!row) return;
            showExpandModal(row);
            return;
        }

        // Refresh banner
        const refreshBanner = e.target.closest('#kanban-refresh-banner');
        if (refreshBanner) {
            e.preventDefault();
            refreshBanner.classList.remove('visible');
            await refreshData();
            return;
        }

        // Close expand modal
        const expandOverlay = e.target.closest('.kanban-card-expand');
        if (expandOverlay && !e.target.closest('.kanban-card-expand-box')) {
            expandOverlay.classList.remove('open');
            return;
        }
        const closeBtn = e.target.closest('.kanban-card-expand-close');
        if (closeBtn) {
            const overlay = closeBtn.closest('.kanban-card-expand');
            if (overlay) overlay.classList.remove('open');
            return;
        }

        // Close any open link popovers when clicking elsewhere
        const linkBtn = e.target.closest('[data-action="link"]');
        const existingPopover = document.querySelector('.kanban-link-popover');

        if (linkBtn) {
            e.preventDefault();
            e.stopPropagation();

            // Close any other open popover first
            if (existingPopover) existingPopover.remove();

            const planId = linkBtn.getAttribute('data-plan-id');
            const taskIndex = linkBtn.getAttribute('data-task-index');
            const existingLink = linkBtn.getAttribute('data-existing-link') || '';

            const popover = document.createElement('div');
            popover.className = 'kanban-link-popover';
            popover.innerHTML = `
                <div class="kanban-link-popover-inner">
                    <label class="kanban-link-popover-label">
                        <i class="fa-brands fa-microsoft"></i> OneDrive Link
                    </label>
                    <input type="url" class="kanban-link-popover-input" placeholder="https://onedrive.live.com/..." value="${existingLink.replace(/"/g, '&quot;')}">
                    <div class="kanban-link-popover-actions">
                        <button class="kanban-link-popover-cancel" type="button">Cancel</button>
                        <button class="kanban-link-popover-save" type="button">
                            <i class="fa-solid fa-check"></i> Save
                        </button>
                    </div>
                </div>
            `;

            const rect = linkBtn.getBoundingClientRect();
            document.body.appendChild(popover);
            popover.style.top = (rect.bottom + 4) + 'px';
            popover.style.left = Math.min(rect.left, window.innerWidth - 280) + 'px';

            const input = popover.querySelector('.kanban-link-popover-input');
            const saveBtn = popover.querySelector('.kanban-link-popover-save');
            const cancelBtn = popover.querySelector('.kanban-link-popover-cancel');

            requestAnimationFrame(() => input.focus());

            const save = async () => {
                const val = input.value.trim();
                if (window.AppCalendar?.updateTaskLink) {
                    try {
                        await window.AppCalendar.updateTaskLink(planId, parseInt(taskIndex, 10), val);
                        const rawRow = state.data.find(r => r.planId === planId && r.taskIndex === parseInt(taskIndex, 10));
                        if (rawRow) rawRow.onedriveLink = val;
                        applyFilters(state);
                        rerenderBoard(state);
                        showToast(val ? 'Link saved.' : 'Link removed.');
                    } catch (err) {
                        console.error('Failed to update link:', err);
                        showToast('Failed to update link.');
                    }
                }
            };

            saveBtn.addEventListener('click', save);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') save();
                if (ev.key === 'Escape') popover.remove();
            });
            cancelBtn.addEventListener('click', () => popover.remove());

        } else if (existingPopover && !e.target.closest('.kanban-link-popover')) {
            existingPopover.remove();
        }

        // Template save
        const addBtn = e.target.closest('#kanban-template-add');
        if (addBtn) {
            e.preventDefault();
            e.stopPropagation();
            const existing = document.querySelector('.kanban-template-modal');
            if (existing) existing.remove();
            const modal = document.createElement('div');
            modal.className = 'kanban-template-modal open';
            modal.innerHTML = `
                <div class="kanban-template-modal-box">
                    <h3>Save Filter as Template</h3>
                    <input type="text" id="kanban-template-name" placeholder="Template name..." maxlength="40" autofocus>
                    <div class="kanban-template-modal-actions">
                        <button class="kanban-template-modal-cancel" type="button">Cancel</button>
                        <button class="kanban-template-modal-save" type="button">Save</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            const nameInput = modal.querySelector('#kanban-template-name');
            const saveTmpl = () => {
                const name = (nameInput.value || '').trim();
                if (!name) return;
                const templates = getTemplates();
                templates.push({
                    name,
                    startIso: state.startIso,
                    endIso: state.endIso,
                    staffFilter: state.staffFilter,
                    search: state.search
                });
                saveTemplates(templates);
                modal.remove();
                rerenderBoard(state);
                showToast('Template saved.');
            };
            modal.querySelector('.kanban-template-modal-save').addEventListener('click', saveTmpl);
            nameInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveTmpl(); });
            modal.querySelector('.kanban-template-modal-cancel').addEventListener('click', () => modal.remove());
            nameInput.focus();
            return;
        }

        // Template apply
        const tmplChip = e.target.closest('.kanban-template-chip');
        if (tmplChip && !e.target.closest('[data-template-delete]')) {
            const idx = parseInt(tmplChip.getAttribute('data-template-index'), 10);
            const templates = getTemplates();
            const tmpl = templates[idx];
            if (tmpl) {
                state.startIso = tmpl.startIso || state.startIso;
                state.endIso = tmpl.endIso || state.endIso;
                state.staffFilter = tmpl.staffFilter || '';
                state.search = tmpl.search || '';
                const startEl = document.getElementById('kanban-start');
                const endEl = document.getElementById('kanban-end');
                const staffEl = document.getElementById('kanban-staff');
                const searchEl = document.getElementById('kanban-search');
                if (startEl) startEl.value = state.startIso;
                if (endEl) endEl.value = state.endIso;
                if (staffEl) staffEl.value = state.staffFilter;
                if (searchEl) searchEl.value = state.search;
                applyFilters(state);
                rerenderBoard(state);
                showToast('Template applied.');
            }
            return;
        }

        // Template delete
        const delBtn = e.target.closest('[data-template-delete]');
        if (delBtn) {
            e.preventDefault();
            e.stopPropagation();
            const idx = parseInt(delBtn.getAttribute('data-template-delete'), 10);
            const templates = getTemplates();
            templates.splice(idx, 1);
            saveTemplates(templates);
            rerenderBoard(state);
            return;
        }
    });
}

function rerenderBoard(state) {
    const board = document.getElementById('kanban-board');
    if (board) {
        board.outerHTML = renderBoard(state);
        setupDragDrop();
    }
}

/* ---------- Real-time Listener ---------- */
export function startKanbanRealtimeListener() {
    stopKanbanRealtimeListener();
    if (!window.AppDB || !window.AppDB.listen) return;

    kanbanListenerUnsubscribe = window.AppDB.listen('work_plans', () => {
        if (kanbanRefreshDebounce) clearTimeout(kanbanRefreshDebounce);
        kanbanRefreshDebounce = setTimeout(() => {
            const currentHash = window.location.hash.slice(1);
            if (currentHash !== 'kanban') { stopKanbanRealtimeListener(); return; }

            const state = getState();
            const sig = String(state.data.length);
            if (kanbanLastSnapshotSig && sig !== kanbanLastSnapshotSig) {
                const banner = document.getElementById('kanban-refresh-banner');
                if (banner) banner.classList.add('visible');
            }
            kanbanLastSnapshotSig = sig;
        }, 800);
    });

    // Prime the signature on first load
    setTimeout(() => {
        window.AppDB.getAll('work_plans').then(rows => {
            kanbanLastSnapshotSig = String((rows || []).length);
        }).catch(() => {});
    }, 1500);
}

export function stopKanbanRealtimeListener() {
    if (typeof kanbanListenerUnsubscribe === 'function') {
        kanbanListenerUnsubscribe();
        kanbanListenerUnsubscribe = null;
    }
    if (kanbanRefreshDebounce) { clearTimeout(kanbanRefreshDebounce); kanbanRefreshDebounce = null; }
    kanbanLastSnapshotSig = '';
    const banner = document.getElementById('kanban-refresh-banner');
    if (banner) banner.classList.remove('visible');
}

/* ---------- Public API ---------- */

/**
 * Render the full Kanban page HTML
 * @returns {string} HTML for the page
 */
export async function renderKanbanBoard() {
    ensureViewToggleCSS();
    const state = getState();

    return `
        <div class="kanban-page">
            <header class="kanban-header">
                <h2><i class="fa-solid fa-columns" style="margin-right:0.5rem;opacity:0.6;"></i>Task Board</h2>
                ${renderControls(state)}
            </header>
            <div id="kanban-board-container">
                ${renderLoadingSkeleton()}
            </div>
        </div>`;
}

/**
 * Initialize the Kanban board after render (fetch data, bind events)
 */
export async function initKanbanBoard() {
    bindEvents();
    await refreshData();
    showDragTutorialIfNeeded();
}

function showDragTutorialIfNeeded() {
    const SEEN_KEY = 'kanban_drag_tutorial_seen';
    if (localStorage.getItem(SEEN_KEY)) return;

    let step = 0;
    const steps = [
        {
            anim: `
                <div class="kanban-tutorial-ghost-cols">
                    <div class="kanban-tutorial-col">
                        <div class="kanban-tutorial-col-head"></div>
                        <div class="kanban-tutorial-card-placeholder"></div>
                    </div>
                    <div class="kanban-tutorial-col">
                        <div class="kanban-tutorial-col-head"></div>
                    </div>
                </div>
                <div class="kanban-tutorial-drag-item"><i class="fa-solid fa-grip-vertical"></i></div>
                <div class="kanban-tutorial-arrow"><i class="fa-solid fa-arrow-right"></i></div>`,
            title: 'Drag & Drop Tasks',
            text: 'Grab any task card and drag it to another column to change its status.'
        },
        {
            anim: `
                <div class="kanban-tutorial-ghost-cols">
                    <div class="kanban-tutorial-col" style="max-width:200px;">
                        <div class="kanban-tutorial-col-head"></div>
                        <div class="kanban-tutorial-card-placeholder" style="height:40px;"></div>
                        <div class="kanban-tutorial-card-placeholder" style="height:40px;"></div>
                    </div>
                </div>
                <div class="kanban-tutorial-comment-bubble">
                    <i class="fa-solid fa-comment"></i>
                    <div class="kanban-tutorial-comment-lines">
                        <div class="kanban-tutorial-line" style="width:80%;"></div>
                        <div class="kanban-tutorial-line" style="width:55%;"></div>
                    </div>
                </div>`,
            title: 'Add Comments',
            text: 'Click a task title to expand it. Add comments to discuss progress with your team.'
        },
        {
            anim: `
                <div class="kanban-tutorial-ghost-cols">
                    <div class="kanban-tutorial-templates-bar">
                        <div class="kanban-tutorial-line" style="width:70px;height:10px;background:#e5e7eb;border-radius:4px;"></div>
                        <div class="kanban-tutorial-line" style="width:50px;height:10px;background:#e5e7eb;border-radius:4px;"></div>
                        <div class="kanban-tutorial-line" style="width:60px;height:10px;background:#e5e7eb;border-radius:4px;"></div>
                    </div>
                    <div class="kanban-tutorial-col" style="max-width:200px;">
                        <div class="kanban-tutorial-col-head"></div>
                        <div class="kanban-tutorial-card-placeholder"></div>
                    </div>
                </div>`,
            title: 'Save Templates',
            text: 'Save your favourite filters as templates to quickly switch between views.'
        }
    ];

    const overlay = document.createElement('div');
    overlay.className = 'kanban-tutorial-overlay';

    function renderStep() {
        const s = steps[step];
        const isLast = step === steps.length - 1;
        overlay.innerHTML = `
            <div class="kanban-tutorial-card">
                <div class="kanban-tutorial-anim">${s.anim}</div>
                <h3>${s.title}</h3>
                <p>${s.text}</p>
                <div class="kanban-tutorial-nav">
                    <div class="kanban-tutorial-dots">
                        ${steps.map((_, i) => `<span class="kanban-tutorial-dot${i === step ? ' active' : ''}"></span>`).join('')}
                    </div>
                    <button class="kanban-tutorial-btn" id="kanban-tutorial-next">
                        ${isLast ? '<i class="fa-solid fa-check"></i> Got it' : 'Next <i class="fa-solid fa-arrow-right"></i>'}
                    </button>
                </div>
            </div>`;
        overlay.querySelector('#kanban-tutorial-next').addEventListener('click', () => {
            if (isLast) {
                localStorage.setItem(SEEN_KEY, '1');
                overlay.classList.add('hide');
                setTimeout(() => overlay.remove(), 300);
            } else {
                step++;
                renderStep();
            }
        });
    }

    renderStep();
    document.body.appendChild(overlay);
}

/**
 * Refresh kanban data from Firestore
 */
export async function refreshData() {
    const state = getState();
    const container = document.getElementById('kanban-board-container');
    if (container) container.innerHTML = renderLoadingSkeleton();

    try {
        const rows = await window.AppAnalytics.getAllStaffActivities({
            mode: 'range',
            startIso: state.startIso,
            endIso: state.endIso,
            scope: 'work',
            sideEffects: false
        });
        state.data = normalizeRows(rows);
        state.lastRefreshed = Date.now();
    } catch (err) {
        console.error('Kanban: Data fetch failed', err);
        state.data = [];
    }

    applyFilters(state);

    if (container) {
        container.innerHTML = renderBoard(state);
        setupDragDrop();
    }
}
