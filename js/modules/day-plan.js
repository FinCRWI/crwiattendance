import { AppAuth } from './auth.js';
import { AppDB } from './db.js';
import { AppCalendar } from './calendar.js';
import { AppConfig } from '../config.js';
import { isTaskVisibleToViewer } from '../utils/task-visibility.js';

const DAY_PLAN_OVERLAY_BASE_Z_INDEX = 10060;
const DAY_PLAN_OVERLAY_STEP = 20;
let dayPlanOverlaySequence = 0;
let activeDayPlanRequestId = 0;
const activeDayPlanLayers = new Set();
const dayPlanLayerReleases = new WeakMap();
const DAY_PLAN_LOAD_TTL_MS = 300000;
const dayPlanLoadCache = new Map();

if (typeof window !== 'undefined' && !window.__dayPlanLoadCacheBound) {
    window.addEventListener('app:db-write', (event) => {
        const collection = String(event?.detail?.collection || '');
        if (collection === 'work_plans' || collection === 'users') {
            dayPlanLoadCache.clear();
        }
        if (collection === 'work_plans') {
            dayPlanMaintenanceDone.clear();
        }
    });
    window.__dayPlanLoadCacheBound = true;
}

// Tracks completed carry-forward maintenance per (date::targetId) per session.
// Cleared on any work_plans write so the next open re-checks.
const dayPlanMaintenanceDone = new Set();
// --- Helper Functions ---

function createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.id) el.id = options.id;
    if (options.className) el.className = options.className;
    if (options.textContent) el.textContent = options.textContent;
    if (options.innerHTML) el.innerHTML = options.innerHTML;
    if (options.attributes) {
        for (const [key, value] of Object.entries(options.attributes)) {
            el.setAttribute(key, value);
        }
    }
    if (options.children) {
        for (const child of options.children) {
            el.appendChild(child);
        }
    }
    return el;
}

function createButton(options = {}) {
    const btn = createElement('button', {
        className: options.className,
        textContent: options.textContent,
        innerHTML: options.innerHTML,
        attributes: { type: 'button', ...options.attributes }
    });
    if (options.onClick) btn.addEventListener('click', options.onClick);
    return btn;
}

function scheduleNextPaint(callback) {
    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.setTimeout(callback, 0));
        return;
    }
    window.setTimeout(callback, 0);
}

export function acquireOverlayLayer(element) {
    if (!element) return () => {};
    const token = Symbol('day-plan-overlay-layer');
    activeDayPlanLayers.add(token);
    dayPlanOverlaySequence += 1;
    element.style.zIndex = String(DAY_PLAN_OVERLAY_BASE_Z_INDEX + (dayPlanOverlaySequence * DAY_PLAN_OVERLAY_STEP));

    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        activeDayPlanLayers.delete(token);
        dayPlanLayerReleases.delete(element);
        if (activeDayPlanLayers.size === 0) dayPlanOverlaySequence = 0;
    };
    dayPlanLayerReleases.set(element, release);
    return release;
}

function releaseOverlayLayer(element) {
    dayPlanLayerReleases.get(element)?.();
}

function removeOverlay(element) {
    if (!element) return;
    releaseOverlayLayer(element);
    element.remove();
}

const DAY_PLAN_PREFETCH_TTL_MS = 300000;
const dayPlanPrefetchCache = new Map();

async function getCachedDayPlanUsers() {
    const cacheKey = AppDB.getCacheKey
        ? AppDB.getCacheKey('dayPlanUsers', 'users', { scope: 'day-plan' })
        : 'dayPlanUsers:users:scope';
    const ttl = Number(AppConfig?.READ_CACHE_TTLS?.users || 60000);
    if (AppDB.getCached) {
        return AppDB.getCached(cacheKey, ttl, () => AppDB.getAll('users'));
    }
    return AppDB.getAll('users');
}

async function getReferencedDayPlanUsers(dayPlans, targetId) {
    const ids = new Set();
    const fallbackUsers = new Map();
    const safeTargetId = String(targetId || '').trim();
    if (safeTargetId) ids.add(safeTargetId);

    (dayPlans || []).forEach((plan) => {
        const ownerId = String(plan?.userId || '').trim();
        if (ownerId && ownerId !== 'annual_shared') {
            ids.add(ownerId);
            fallbackUsers.set(ownerId, {
                id: ownerId,
                name: String(plan?.userName || 'Staff')
            });
        }
        (plan?.plans || []).forEach((task) => {
            const assigneeId = String(task?.assignedTo || '').trim();
            if (assigneeId && assigneeId !== 'annual_shared') ids.add(assigneeId);
        });
    });

    const currentUser = AppAuth.getUser();
    if (currentUser?.id) fallbackUsers.set(String(currentUser.id), currentUser);

    // Batch-fetch only the referenced user IDs instead of scanning the entire users collection.
    // getManyByIds groups into IN queries of 10, avoiding both the full collection scan and N+1.
    const idList = Array.from(ids);
    const users = await AppDB.getManyByIds('users', idList).catch(() => []);
    const usersById = new Map(users.map(u => [String(u.id || ''), u]));

    return idList.map(id => usersById.get(id) || fallbackUsers.get(id) || { id, name: 'Staff' }).filter(Boolean);
}

async function loadDayPlanData(date, targetId) {
    const safeDate = String(date || '').trim();
    const safeTargetId = String(targetId || '').trim();
    const cacheKey = JSON.stringify({ date: safeDate, targetId: safeTargetId });
    const cached = dayPlanLoadCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
    }

    // Fetch exactly the plan docs that can exist for this date — the annual
    // shared plan (plan_annual_{date}) plus each user's personal plan
    // (plan_{userId}_{date}) — by their known doc ids, so no date-scoped
    // collection query runs on the day-plan open/prefetch path. User ids come
    // from the cached users list; the target id is added explicitly in case it
    // is missing from the cache. Falls back to the date query only on error.
    let allDayPlans;
    try {
        const users = await getCachedDayPlanUsers();
        const userIds = (users || []).map((u) => String(u?.id || '')).filter(Boolean);
        if (safeTargetId) userIds.push(safeTargetId);
        allDayPlans = await AppDB.getDayPlansByIds(safeDate, userIds);
    } catch (err) {
        console.warn('[DayPlan] Doc-id plan fetch failed, falling back to date query:', err);
        allDayPlans = await AppDB.getDayPlansByDate(safeDate);
    }
    const personalId = `plan_${safeTargetId}_${safeDate}`;
    const annualId = `plan_annual_${safeDate}`;
    const personalWorkPlan = allDayPlans.find(p => p.id === personalId) || null;
    const annualWorkPlan = allDayPlans.find(p => p.id === annualId) || null;
    const value = { personalWorkPlan, annualWorkPlan, allDayPlans };
    dayPlanLoadCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + DAY_PLAN_LOAD_TTL_MS
    });
    return value;
}

function buildBudgetHeadLookup() {
    const budgetHeads = Array.isArray(window.app_budgetHeadsCache)
        ? window.app_budgetHeadsCache
        : [{ id: 'UNALLOCATED', code: 'UNALLOCATED', name: 'Unallocated / To Be Mapped' }];
    const lookup = new Map();
    budgetHeads.forEach((head) => {
        const id = String(head?.id || '').trim();
        if (!id) return;
        lookup.set(id, {
            id,
            code: String(head?.code || id).trim(),
            name: String(head?.name || id).trim()
        });
    });
    return lookup;
}

function _getBudgetHeadLabel(budgetHeadId, lookup = buildBudgetHeadLookup()) {
    const id = String(budgetHeadId || '').trim();
    if (!id) return '';
    const head = lookup.get(id);
    if (!head) return id;
    return `${head.code} - ${head.name}`;
}

function normalizeDayPlanTargetId(targetUserId) {
    const currentUser = AppAuth.getUser();
    const targetIdRaw = String(targetUserId ?? '').trim();
    return (!targetIdRaw || targetIdRaw === 'undefined' || targetIdRaw === 'null')
        ? currentUser?.id
        : targetIdRaw;
}

function getDayPlanPrefetchKey(date, targetUserId = null, forcedScope = null, options = {}) {
    const targetId = normalizeDayPlanTargetId(targetUserId);
    return JSON.stringify({
        date: String(date || '').trim(),
        targetId: String(targetId || ''),
        forcedScope: forcedScope === 'annual' ? 'annual' : 'personal',
        hideAutoForwardedTasks: options?.hideAutoForwardedTasks === true,
        skipCarryForwardSync: options?.skipCarryForwardSync === true,
        skipCarryForwardCleanup: options?.skipCarryForwardCleanup === true
    });
}

function getDayPlanPrefetchRecord(date, targetUserId = null, forcedScope = null, options = {}) {
    const currentUser = AppAuth.getUser();
    if (!currentUser) return null;

    const targetId = normalizeDayPlanTargetId(targetUserId) || currentUser.id;
    const key = getDayPlanPrefetchKey(date, targetId, forcedScope, options);
    const now = Date.now();
    const existing = dayPlanPrefetchCache.get(key);
    if (existing && existing.expiresAt > now) return existing;

    const todayKey = AppCalendar?.getTodayKey ? AppCalendar.getTodayKey() : '';
    const safeDate = String(date || '').trim();
    const canPrefetchPlans = !!todayKey && safeDate >= todayKey;
    const record = {
        key,
        date: safeDate,
        targetId,
        forcedScope: forcedScope === 'annual' ? 'annual' : 'personal',
        options: {
            hideAutoForwardedTasks: options?.hideAutoForwardedTasks === true,
            skipCarryForwardSync: options?.skipCarryForwardSync === true,
            skipCarryForwardCleanup: options?.skipCarryForwardCleanup === true
        },
        expiresAt: now + DAY_PLAN_PREFETCH_TTL_MS,
        dataPromise: null,
        promise: null
    };

    if (canPrefetchPlans) {
        record.dataPromise = (async () => {
            const data = await loadDayPlanData(safeDate, targetId);
            const allUsers = await getReferencedDayPlanUsers(data.allDayPlans, targetId);
            return { ...data, allUsers };
        })();
        record.promise = record.dataPromise;
    } else {
        record.promise = Promise.resolve(null);
    }

    record.promise.catch(() => {
        dayPlanPrefetchCache.delete(key);
    });
    dayPlanPrefetchCache.set(key, record);
    return record;
}

function createDayPlanLoadingState(message = 'Loading Plan Your Day...') {
    const loader = createElement('div', { className: 'day-plan-loading-state' });
    loader.style.display = 'flex';
    loader.style.alignItems = 'center';
    loader.style.justifyContent = 'center';
    loader.style.minHeight = '260px';
    loader.style.padding = '1.25rem';
    loader.style.textAlign = 'center';

    const panel = createElement('div', { className: 'day-plan-loading-panel' });
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.alignItems = 'center';
    panel.style.gap = '0.75rem';
    panel.style.maxWidth = '420px';

    const icon = createElement('span', {
        className: 'day-plan-loading-icon',
        innerHTML: '<i class="fa-solid fa-spinner fa-spin"></i>'
    });
    icon.style.fontSize = '1.25rem';
    icon.style.color = '#1d4ed8';

    const text = createElement('div', {
        className: 'day-plan-loading-copy',
        textContent: message
    });
    text.style.fontWeight = '600';
    text.style.color = '#1f2937';

    const hint = createElement('div', {
        className: 'day-plan-loading-hint',
        textContent: 'We are preparing your day plan now.'
    });
    hint.style.fontSize = '0.92rem';
    hint.style.color = '#64748b';

    panel.appendChild(icon);
    panel.appendChild(text);
    panel.appendChild(hint);
    loader.appendChild(panel);
    return loader;
}

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatFriendlyDate = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
    }).format(date);
};

/* ============================================================
   STATUS INDICATOR — returns a DOM element
   ============================================================
   completed     → green tick in green circle
   not-completed → calendar icon in orange circle (postponed)
   in-process    → spinner icon in blue circle
   null / ''     → empty dashed circle (auto-track)
   ============================================================ */
function createStatusIndicator(status) {
    const s = String(status || '').trim().toLowerCase();
    let iconHTML = '';
    let cls = 'plan-status-indicator';

    switch (s) {
        case 'completed':
            cls += ' plan-status-completed';
            iconHTML = '<i class="fa-solid fa-check"></i>';
            break;
        case 'not-completed':
        case 'postponed':
            cls += ' plan-status-postponed';
            iconHTML = '<i class="fa-regular fa-calendar"></i>';
            break;
        case 'in-process':
            cls += ' plan-status-inprogress';
            iconHTML = '<i class="fa-solid fa-rotate"></i>';
            break;
        default:
            cls += ' plan-status-none';
            iconHTML = '';
            break;
    }

    return createElement('span', {
        className: cls,
        innerHTML: iconHTML,
        attributes: { 'data-status': s || 'none', title: s ? s.replace('-', ' ') : 'Auto-track' }
    });
}

// --- UI Components ---

function createDayPlanHeader(date, isEditingOther, headerName, hasAnyExistingPlan, targetId) {
    const title = createElement('h3', { textContent: 'Plan Your Day' });
    const dateLabel = formatFriendlyDate(date) || date;
    const subtitle = createElement('p', {
        className: 'day-plan-subline',
        textContent: isEditingOther ? `${dateLabel} · Editing for ${headerName}` : dateLabel
    });

    const deleteBtn = hasAnyExistingPlan ?
        createButton({
            className: 'day-plan-delete-btn',
            attributes: { title: 'Delete plan' },
            innerHTML: '<i class="fa-solid fa-trash"></i>',
            onClick: () => window.app_deleteDayPlan(date, targetId)
        }) :
        null;

    const closeBtn = createButton({
        className: 'day-plan-close-btn',
        attributes: { title: 'Close' },
        innerHTML: '<i class="fa-solid fa-xmark"></i>',
        onClick: (e) => removeOverlay(e.currentTarget.closest('.day-plan-modal-overlay'))
    });

    const headerActions = createElement('div', {
        className: 'day-plan-header-actions',
        children: [deleteBtn, closeBtn].filter(Boolean)
    });

    return createElement('div', {
        className: 'day-plan-header',
        children: [
            createElement('div', {
                className: 'day-plan-headline',
                children: [
                    createElement('span', { className: 'day-plan-kicker', textContent: 'Today' }),
                    title,
                    subtitle
                ]
            }),
            headerActions
        ]
    });
}

function createDayPlanForm(date, targetId, personalWorkPlan, annualWorkPlan, initialBlocks, allUsers, defaultScope, selectableCollaborators, isAdmin, currentUser, uiOptions = {}) {
    const personalOnly = uiOptions?.personalOnly === true;
    const batchSize = 4;
    const scopeBuckets = {
        personal: [],
        annual: [],
        context: 0
    };
    initialBlocks.forEach((plan, idx) => {
        const scope = plan.planScope || plan._planScope || defaultScope;
        const normalizedPlan = { ...plan, _lazyIndex: idx };
        if (scope === 'annual' || plan.isReference) {
            scopeBuckets.annual.push(normalizedPlan);
        } else {
            scopeBuckets.personal.push(normalizedPlan);
        }
        if (plan.isReference === true) scopeBuckets.context += 1;
    });

    const renderState = {
        personal: { pending: [...scopeBuckets.personal], nextIndex: 0, done: false },
        annual: { pending: [...scopeBuckets.annual], nextIndex: 0, done: false }
    };

    const personalContainer = createElement('div', {
        className: 'day-plan-scroll-area personal-plans-container',
        attributes: { 'data-scope': 'personal' }
    });
    const personalExistingContainer = createElement('div', {
        className: 'day-plan-existing-blocks',
        attributes: { 'data-scope': 'personal-existing' }
    });
    const personalSentinel = createElement('div', {
        className: 'day-plan-load-sentinel',
        attributes: { 'aria-hidden': 'true' }
    });
    const personalNewContainer = createElement('div', {
        className: 'day-plan-new-blocks',
        attributes: { 'data-scope': 'personal-new' }
    });
    personalContainer.appendChild(personalExistingContainer);
    personalContainer.appendChild(personalSentinel);
    personalContainer.appendChild(personalNewContainer);

    const othersContainer = createElement('div', {
        className: 'day-plan-scroll-area others-plans-container',
        attributes: { 'data-scope': 'annual' }
    });
    const othersExistingContainer = createElement('div', {
        className: 'day-plan-existing-blocks',
        attributes: { 'data-scope': 'annual-existing' }
    });
    const othersSentinel = createElement('div', {
        className: 'day-plan-load-sentinel',
        attributes: { 'aria-hidden': 'true' }
    });
    const othersNewContainer = createElement('div', {
        className: 'day-plan-new-blocks',
        attributes: { 'data-scope': 'annual-new' }
    });
    othersContainer.appendChild(othersExistingContainer);
    othersContainer.appendChild(othersSentinel);
    othersContainer.appendChild(othersNewContainer);

    const renderBatch = (scope, forceAll = false) => {
        const container = scope === 'annual' ? othersExistingContainer : personalExistingContainer;
        const state = renderState[scope];
        if (!state || state.done) return false;
        const limit = forceAll ? state.pending.length : Math.min(batchSize, state.pending.length);
        if (limit <= 0) {
            state.done = true;
            return false;
        }
        const frag = document.createDocumentFragment();
        const startIndex = state.nextIndex;
        const batch = state.pending.splice(0, limit);
        batch.forEach((plan, offset) => {
            frag.appendChild(dayPlanRenderBlockV3({
                plan,
                idx: startIndex + offset,
                allUsers,
                targetId,
                defaultScope,
                selectableCollaborators,
                isAdmin,
                currentUserId: currentUser.id,
                isReference: plan.isReference
            }));
        });
        state.nextIndex += batch.length;
        container.appendChild(frag);
        if (state.pending.length === 0) state.done = true;
        return state.pending.length > 0;
    };

    const flushAllPending = () => {
        renderBatch('personal', true);
        renderBatch('annual', true);
    };

    const personalCount = scopeBuckets.personal.length;
    const annualCount = scopeBuckets.annual.length;
    const contextCount = scopeBuckets.context;

    const toolbar = createElement('div', {
        className: 'day-plan-toolbar',
        children: [
            createElement('div', {
                className: 'day-plan-toolbar-copy',
                children: [
                    createElement('span', { className: 'day-plan-toolbar-kicker', textContent: 'Planner' }),
                    createElement('h4', { className: 'day-plan-toolbar-title', textContent: 'My Daily Plan' }),
                    createElement('p', {
                        className: 'day-plan-toolbar-subtitle',
                        textContent: 'Focus on the work that matters most today.'
                    })
                ]
            }),
            createButton({
                className: 'day-plan-new-task-btn',
                innerHTML: '<i class="fa-solid fa-plus"></i><span>New Task</span>',
                onClick: () => openPlanEditor({ date, targetId, scope: 'personal', allUsers, selectableCollaborators, isAdmin, container: personalNewContainer })
            }),
            ...(personalOnly ? [createButton({
                className: 'day-plan-context-link',
                attributes: { title: 'Open Team Activity' },
                innerHTML: '<i class="fa-solid fa-chart-line"></i><span>Team Activity</span>',
                onClick: () => {
                    removeOverlay(document.getElementById('day-plan-modal'));
                    window.app_openTeamActivitiesForStaff?.(targetId, date, 'time-desc');
                }
            })] : [])
        ]
    });

    const contextCard = createElement('div', {
        className: 'day-plan-context-card',
        children: [
            createElement('div', {
                className: 'day-plan-context-card-head',
                children: [
                    createElement('span', { className: 'day-plan-context-kicker', textContent: 'Context' }),
                    createElement('strong', { className: 'day-plan-context-title', textContent: 'Around You' })
                ]
            }),
            createElement('div', {
                className: 'day-plan-context-grid',
                children: [
                    createElement('div', {
                        className: 'day-plan-context-stat',
                        children: [
                            createElement('span', { textContent: 'Personal' }),
                            createElement('strong', { textContent: String(personalCount) })
                        ]
                    }),
                    createElement('div', {
                        className: 'day-plan-context-stat',
                        children: [
                            createElement('span', { textContent: 'Annual' }),
                            createElement('strong', { textContent: String(annualCount) })
                        ]
                    }),
                    createElement('div', {
                        className: 'day-plan-context-stat',
                        children: [
                            createElement('span', { textContent: 'Team' }),
                            createElement('strong', { textContent: String(contextCount) })
                        ]
                    })
                ]
            }),
            createButton({
                className: 'day-plan-context-link',
                attributes: { title: 'Open Team Schedule' },
                innerHTML: '<i class="fa-solid fa-calendar-days"></i><span>Schedule</span>',
                onClick: () => {
                    removeOverlay(document.getElementById('day-plan-modal'));
                    if (typeof window.app_openDashboardSection === 'function') {
                        window.app_openDashboardSection('team-schedule');
                    } else {
                        window.location.hash = 'dashboard-section/team-schedule';
                    }
                }
            })
        ]
    });

    const teamTitleWrap = createElement('div', {
        className: 'day-plan-column-title-wrap',
        children: [
            createElement('span', { className: 'day-plan-column-icon day-plan-column-icon-muted', innerHTML: '<i class="fa-solid fa-people-group"></i>' }),
            createElement('div', {
                children: [
                    createElement('h4', {
                        className: 'day-plan-column-title',
                        innerHTML: 'Shared Plans <span class="team-plan-special-badge"><i class="fa-solid fa-star"></i> TEAM</span>'
                    }),
                    createElement('p', { className: 'day-plan-column-subtitle', textContent: 'Annual and referenced work for this day' })
                ]
            })
        ]
    });

    const columns = createElement('div', {
        className: 'day-plan-workspace',
        children: [
            createElement('div', {
                className: 'day-plan-column day-plan-column-equal',
                children: [
                    createElement('div', {
                        className: 'day-plan-column-head',
                        children: [
                            createElement('div', {
                                className: 'day-plan-column-title-wrap',
                                children: [
                                    createElement('span', { className: 'day-plan-column-icon', innerHTML: '<i class="fa-regular fa-calendar"></i>' }),
                                    createElement('div', {
                                        children: [
                                            createElement('h4', { className: 'day-plan-column-title', textContent: 'My Daily Plan' }),
                                            createElement('p', { className: 'day-plan-column-subtitle', textContent: 'Focus blocks and private tasks' })
                                        ]
                                    })
                                ]
                            }),
                            createButton({
                                className: 'day-plan-column-btn',
                                innerHTML: '<i class="fa-solid fa-plus"></i><span>Add task</span>',
                                onClick: () => openPlanEditor({ date, targetId, scope: 'personal', allUsers, selectableCollaborators, isAdmin, container: personalContainer })
                            })
                        ]
                    }),
                    personalContainer
                ]
            }),
            createElement('div', {
                className: 'day-plan-column day-plan-column-equal day-plan-context-column',
                children: [
                    contextCard,
                    createElement('div', {
                        className: 'day-plan-shared-shell',
                        children: [
                            createElement('div', {
                                className: 'day-plan-column-head day-plan-column-head-secondary',
                                children: [
                                    teamTitleWrap,
                                    createButton({
                                        className: 'day-plan-column-btn day-plan-column-btn-secondary',
                                        innerHTML: '<i class="fa-solid fa-plus"></i><span>Add annual</span>',
                                        onClick: () => openPlanEditor({ date, targetId, scope: 'annual', allUsers, selectableCollaborators, isAdmin, container: othersNewContainer })
                                    })
                                ]
                            }),
                            othersContainer
                        ]
                    })
                ]
            })
        ]
    });

    const discardBtn = createButton({
        className: 'day-plan-discard-btn',
        textContent: 'Discard',
        onClick: (e) => removeOverlay(e.currentTarget.closest('.day-plan-modal-overlay'))
    });

    const saveBtn = createButton({
        className: 'day-plan-save-btn',
        innerHTML: '<i class="fa-solid fa-check-circle"></i> <span>Save Plan</span>',
        attributes: { type: 'submit' }
    });

    const footer = createElement('div', {
        className: 'day-plan-footer',
        children: [
            createElement('div', { className: 'day-plan-actions', children: [discardBtn, saveBtn] })
        ]
    });

    const form = createElement('form', {
        className: 'day-plan-form',
        attributes: {
            'data-had-personal': personalWorkPlan ? '1' : '0',
            'data-had-annual': annualWorkPlan ? '1' : '0',
            'data-removed-tasks': '[]',
            'data-next-plan-index': String(initialBlocks.length)
        },
        children: [toolbar, columns, footer]
    });
    form.addEventListener('submit', (e) => window.app_saveDayPlan(e, date, targetId));
    form.addEventListener('input', () => {
        form.dataset.dayPlanTouched = '1';
    });
    form.addEventListener('change', () => {
        form.dataset.dayPlanTouched = '1';
    });
    form.addEventListener('click', (e) => {
        if (e.target?.closest?.('.day-plan-edit-btn, .day-plan-remove-btn, .day-plan-new-task-btn, .day-plan-column-btn')) {
            form.dataset.dayPlanTouched = '1';
        }
    });
    form._dayPlanFlushPending = flushAllPending;

    const loadMoreIntoScope = (scope) => {
        const state = renderState[scope];
        if (!state || state.done || state.pending.length === 0) return;
        window.requestAnimationFrame?.(() => renderBatch(scope, false)) || window.setTimeout(() => renderBatch(scope, false), 0);
    };

    const observeSentinel = (root, sentinel, scope) => {
        if (!root || !sentinel || typeof IntersectionObserver !== 'function') return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                loadMoreIntoScope(scope);
            }
        }, { root, rootMargin: '120px 0px', threshold: 0.01 });
        observer.observe(sentinel);
        form._dayPlanObservers = form._dayPlanObservers || [];
        form._dayPlanObservers.push(observer);
    };

    observeSentinel(personalContainer, personalSentinel, 'personal');
    observeSentinel(othersContainer, othersSentinel, 'annual');

    const loadMoreFallback = createButton({
        className: 'day-plan-load-more-btn',
        textContent: 'Load more',
        onClick: () => {
            loadMoreIntoScope('personal');
            loadMoreIntoScope('annual');
        }
    });
    loadMoreFallback.style.display = (scopeBuckets.personal.length > batchSize || scopeBuckets.annual.length > batchSize) ? 'inline-flex' : 'none';
    footer.appendChild(createElement('div', { className: 'day-plan-load-more-wrap', children: [loadMoreFallback] }));

    renderBatch('personal', false);
    renderBatch('annual', false);

    return form;
}

export async function openPlanEditor(args) {
    const {
        date,
        targetId,
        scope,
        selectableCollaborators: initialCollaborators = [],
        isAdmin,
        container,
        existingBlock = null
    } = args;
    const allUsers = await getCachedDayPlanUsers();
    const selectableCollaborators = isAdmin
        ? allUsers.filter((user) => user.id !== targetId)
        : initialCollaborators;
    const currentUser = AppAuth.getUser();
    const planData = existingBlock ? window.app_extractBlockData(existingBlock) : {
        task: '',
        subPlans: [],
        tags: [],
        status: null,
        assignedTo: targetId,
        assignedToName: (allUsers.find(u => u.id === targetId)?.name || ''),
        startDate: date,
        endDate: date,
        planScope: scope,
        carryForwardRootId: '',
        isRemoved: false,
        isPrivate: false
    };

    const overlay = createElement('div', { className: 'plan-editor-overlay' });
    acquireOverlayLayer(overlay);
    const modal = createElement('div', { className: 'plan-editor-modal' });

    const headTitle = `${existingBlock ? 'Edit' : 'Add'} ${scope === 'annual' ? 'Annual' : 'Personal'} Plan`;
    const head = createElement('div', {
        className: 'plan-editor-head',
        children: [createElement('h4', { textContent: headTitle })]
    });


    const body = createElement('div', { className: 'plan-editor-body' });
    const textarea = createElement('textarea', {
        className: 'plan-editor-textarea',
        textContent: planData.task,
        attributes: { placeholder: 'What is the objective or task for today?', required: true }
    });

    const grid = createElement('div', { className: 'plan-editor-grid' });
    const budgetHeads = Array.isArray(window.app_budgetHeadsCache) ? window.app_budgetHeadsCache : [{ id: 'UNALLOCATED', code: 'UNALLOCATED', name: 'Unallocated / To Be Mapped' }];

    const statusField = createElement('div', { className: 'plan-editor-field' });
    statusField.innerHTML = '<label>Status</label>';
    const statusSelect = createElement('select', { className: 'plan-editor-select' });
    statusSelect.innerHTML = `
        <option value="" ${!planData.status ? 'selected' : ''}>Auto-Track</option>
        <option value="completed" ${planData.status === 'completed' ? 'selected' : ''}>✅ Completed</option>
        <option value="in-process" ${planData.status === 'in-process' ? 'selected' : ''}>🔄 In Progress</option>
        <option value="postponed" ${planData.status === 'postponed' || planData.status === 'not-completed' ? 'selected' : ''}>📅 Postponed</option>
    `;
    statusField.appendChild(statusSelect);
    grid.appendChild(statusField);

    const privacyField = createElement('div', { className: 'plan-editor-field' });
    privacyField.innerHTML = '<label>Privacy</label>';
    const privateCheckbox = createElement('input', {
        className: 'plan-editor-private-check',
        attributes: planData.isPrivate === true ? { type: 'checkbox', checked: '' } : { type: 'checkbox' }
    });
    const privateLabel = createElement('label', {
        className: 'plan-editor-private-label',
        children: [
            privateCheckbox,
            createElement('span', { textContent: ' Private — only I can see this task' })
        ]
    });
    privacyField.appendChild(privateLabel);
    grid.appendChild(privacyField);

    const budgetField = createElement('div', { className: 'plan-editor-field' });
    budgetField.innerHTML = '<label>Budget Head</label>';
    const budgetSelect = createElement('select', { className: 'plan-editor-select' });
    const currentBudgetHeadId = String(planData.budgetHeadId || AppAuth.getUser()?.currentBudgetHeadId || 'UNALLOCATED');
    const sortedBudgetHeads = [...budgetHeads].sort((a, b) => {
        if (String(a?.id || '') === 'UNALLOCATED') return -1;
        if (String(b?.id || '') === 'UNALLOCATED') return 1;
        const aLabel = `${String(a?.code || a?.id || '')} ${String(a?.name || '')}`.trim();
        const bLabel = `${String(b?.code || b?.id || '')} ${String(b?.name || '')}`.trim();
        return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: 'base' });
    });
    sortedBudgetHeads.forEach((head) => {
        const id = String(head.id || '');
        const label = `${String(head.code || id)} - ${String(head.name || id)}`;
        const opt = createElement('option', { textContent: label, attributes: { value: id, selected: id === currentBudgetHeadId } });
        budgetSelect.appendChild(opt);
    });
    budgetField.appendChild(budgetSelect);
    grid.appendChild(budgetField);

    let assignSelect = null;
    const canAssign = scope === 'annual' ? isAdmin : true;
    if (canAssign) {
        const assignField = createElement('div', { className: 'plan-editor-field' });
        assignField.innerHTML = '<label>Assign To</label>';
        assignSelect = createElement('select', { className: 'plan-editor-select' });
        const noneOption = createElement('option', { textContent: 'None (Unassigned)', attributes: { value: '' } });
        assignSelect.appendChild(noneOption);
        const selectedAssigneeId = existingBlock
            ? String(planData.assignedTo || '').trim()
            : (scope === 'annual' ? String(planData.assignedTo || targetId || '').trim() : '');
        allUsers.forEach(u => {
            const attrs = { value: u.id };
            if (u.id === selectedAssigneeId) attrs.selected = '';
            const opt = createElement('option', { textContent: u.name, attributes: attrs });
            assignSelect.appendChild(opt);
        });
        assignField.appendChild(assignSelect);
        grid.appendChild(assignField);
    }

    body.appendChild(textarea);
    body.appendChild(grid);

    const secondaryStrip = createElement('div', { className: 'plan-editor-secondary-strip' });

    const subPlanField = createElement('div', { className: 'plan-editor-subplans' });
    subPlanField.innerHTML = `
        <div class="plan-editor-section-head">
            <div>
                <label>Break into steps</label>
                <p class="plan-editor-section-copy">Split the task into clear, editable steps.</p>
            </div>
        </div>
    `;
    const subPlanList = createElement('div', { className: 'plan-editor-subplans-list' });
    const appendSubPlanRow = (value = '') => {
        const row = createElement('div', { className: 'plan-editor-subplan-row' });
        const input = createElement('input', {
            className: 'plan-editor-subplan-input',
            attributes: {
                type: 'text',
                placeholder: 'Add a step...',
                value: value
            }
        });
        const removeBtn = createButton({
            className: 'day-plan-remove-step-btn plan-editor-subplan-remove',
            attributes: { title: 'Remove step' },
            innerHTML: '<i class="fa-solid fa-circle-xmark"></i>',
            onClick: () => row.remove()
        });
        row.appendChild(input);
        row.appendChild(removeBtn);
        subPlanList.appendChild(row);
        return input;
    };
    const initialSubPlans = Array.isArray(planData.subPlans) ? planData.subPlans.filter(Boolean) : [];
    if (initialSubPlans.length > 0) {
        initialSubPlans.forEach((step) => appendSubPlanRow(step));
    } else {
        appendSubPlanRow('');
    }
    const addSubPlanBtn = createButton({
        className: 'day-plan-add-step-btn plan-editor-add-step-btn',
        innerHTML: '<i class="fa-solid fa-plus"></i> Add step',
        onClick: () => appendSubPlanRow('')
    });
    subPlanField.appendChild(subPlanList);
    subPlanField.appendChild(addSubPlanBtn);
    secondaryStrip.appendChild(subPlanField);

    body.appendChild(secondaryStrip);

    const footer = createElement('div', { className: 'plan-editor-footer' });
    const cancelBtn = createButton({
        className: 'day-plan-discard-btn',
        textContent: 'Cancel',
        onClick: () => removeOverlay(overlay)
    });
    const confirmBtn = createButton({
        className: 'day-plan-save-btn',
        textContent: existingBlock ? 'Update' : 'Add to List',
        onClick: () => {
            const taskText = textarea.value.trim();
            if (!taskText) return alert('Please enter a task description');

            const updatedPlan = {
                ...planData,
                task: taskText,
                status: statusSelect.value,
                budgetHeadId: String(budgetSelect.value || 'UNALLOCATED'),
                assignedTo: assignSelect ? assignSelect.value : (planData.assignedTo || targetId),
                assignedToName: assignSelect
                    ? (allUsers.find(u => u.id === assignSelect.value)?.name || '')
                    : (planData.assignedToName || ''),
                tags: Array.isArray(planData.tags) ? planData.tags : [],
                subPlans: Array.from(subPlanList.querySelectorAll('.plan-editor-subplan-input'))
                    .map((input) => String(input.value || '').trim())
                    .filter(Boolean),
                isPrivate: privateCheckbox.checked
            };

            const blockArgs = {
                plan: updatedPlan,
                allUsers,
                targetId,
                selectableCollaborators,
                isAdmin,
                currentUserId: currentUser.id
            };

            if (existingBlock) {
                const newBlock = dayPlanRenderBlockV3({ ...blockArgs, idx: Number.parseInt(existingBlock.getAttribute('data-index')) });
                existingBlock.replaceWith(newBlock);
            } else {
                const form = container?.closest?.('.day-plan-form');
                const nextIndex = Number.parseInt(form?.dataset?.nextPlanIndex || container.querySelectorAll('.plan-block').length, 10);
                const newBlock = dayPlanRenderBlockV3({ ...blockArgs, idx: Number.isFinite(nextIndex) ? nextIndex : container.querySelectorAll('.plan-block').length });
                container.appendChild(newBlock);
                if (form) {
                    form.dataset.nextPlanIndex = String((Number.isFinite(nextIndex) ? nextIndex : container.querySelectorAll('.plan-block').length) + 1);
                }
            }
            removeOverlay(overlay);
        }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer || !container?.isConnected) {
        releaseOverlayLayer(overlay);
        return;
    }
    modalContainer.appendChild(overlay);
    textarea.focus();
}

export async function quickAddPersonalPlan(date = null, targetUserId = null) {
    const currentUser = AppAuth.getUser();
    if (!currentUser?.id) return;
    const safeDate = String(date || AppCalendar.getTodayKey?.() || new Date().toISOString().slice(0, 10)).trim();
    const targetId = String(targetUserId || currentUser.id).trim() || currentUser.id;

    document.getElementById('quick-personal-plan-modal')?.remove();
    document.getElementById('quick-personal-plan-overlay')?.remove();

    const overlay = createElement('div', {
        id: 'quick-personal-plan-overlay',
        className: 'plan-editor-overlay quick-personal-plan-overlay'
    });
    acquireOverlayLayer(overlay);

    const modal = createElement('div', {
        id: 'quick-personal-plan-modal',
        className: 'plan-editor-modal quick-personal-plan-modal'
    });

    const head = createElement('div', {
        className: 'plan-editor-head',
        children: [
            createElement('h4', { textContent: 'Add Personal Plan' }),
            createElement('p', {
                className: 'plan-editor-section-copy',
                textContent: 'Add one personal task directly without loading the full schedule.'
            })
        ]
    });

    const body = createElement('div', { className: 'plan-editor-body' });
    const taskField = createElement('textarea', {
        className: 'plan-editor-textarea',
        attributes: {
            placeholder: 'What do you want to add to your personal plan?',
            required: true
        }
    });
    body.appendChild(taskField);

    const grid = createElement('div', { className: 'plan-editor-grid' });

    const dateField = createElement('div', { className: 'plan-editor-field' });
    dateField.innerHTML = '<label>Date</label>';
    const dateInput = createElement('input', {
        className: 'plan-editor-select',
        attributes: {
            type: 'date',
            value: safeDate
        }
    });
    dateField.appendChild(dateInput);
    grid.appendChild(dateField);

    const statusField = createElement('div', { className: 'plan-editor-field' });
    statusField.innerHTML = '<label>Status</label>';
    const statusSelect = createElement('select', { className: 'plan-editor-select' });
    statusSelect.innerHTML = `
        <option value="" selected>Auto-Track</option>
        <option value="completed">Completed</option>
        <option value="in-process">In Progress</option>
        <option value="postponed">Postponed</option>
    `;
    statusField.appendChild(statusSelect);
    grid.appendChild(statusField);

    const allUsers = await getCachedDayPlanUsers();
    const assigneeField = createElement('div', { className: 'plan-editor-field' });
    assigneeField.innerHTML = '<label>Assign To</label>';
    const assigneeSelect = createElement('select', { className: 'plan-editor-select' });
    const noneOption = createElement('option', { textContent: 'None (Unassigned)', attributes: { value: '' } });
    assigneeSelect.appendChild(noneOption);
    allUsers.forEach(u => {
        const opt = createElement('option', { textContent: u.name, attributes: { value: u.id } });
        assigneeSelect.appendChild(opt);
    });
    assigneeField.appendChild(assigneeSelect);
    grid.appendChild(assigneeField);

    const privacyField = createElement('div', { className: 'plan-editor-field' });
    privacyField.innerHTML = '<label>Privacy</label>';
    const privateCheckbox = createElement('input', {
        className: 'plan-editor-private-check',
        attributes: { type: 'checkbox' }
    });
    const privateLabel = createElement('label', {
        className: 'plan-editor-private-label',
        children: [
            privateCheckbox,
            createElement('span', { textContent: ' Private — only I can see this task' })
        ]
    });
    privacyField.appendChild(privateLabel);
    grid.appendChild(privacyField);
    body.appendChild(grid);

    const stepsField = createElement('div', { className: 'plan-editor-subplans' });
    stepsField.innerHTML = `
        <div class="plan-editor-section-head">
            <div>
                <label>Break into steps</label>
                <p class="plan-editor-section-copy">Optional. Keep the task small and actionable.</p>
            </div>
        </div>
    `;
    const subPlanList = createElement('div', { className: 'plan-editor-subplans-list' });
    const appendStepRow = (value = '') => {
        const row = createElement('div', { className: 'plan-editor-subplan-row' });
        const input = createElement('input', {
            className: 'plan-editor-subplan-input',
            attributes: {
                type: 'text',
                placeholder: 'Add a step...',
                value
            }
        });
        const removeBtn = createButton({
            className: 'day-plan-remove-step-btn plan-editor-subplan-remove',
            attributes: { title: 'Remove step' },
            innerHTML: '<i class="fa-solid fa-circle-xmark"></i>',
            onClick: () => row.remove()
        });
        row.appendChild(input);
        row.appendChild(removeBtn);
        subPlanList.appendChild(row);
        return input;
    };
    appendStepRow('');
    const addStepBtn = createButton({
        className: 'day-plan-add-step-btn plan-editor-add-step-btn',
        innerHTML: '<i class="fa-solid fa-plus"></i> Add step',
        onClick: () => appendStepRow('').focus()
    });
    stepsField.appendChild(subPlanList);
    stepsField.appendChild(addStepBtn);
    body.appendChild(stepsField);

    const footer = createElement('div', { className: 'plan-editor-footer' });
    const cancelBtn = createButton({
        className: 'day-plan-discard-btn',
        textContent: 'Cancel',
        onClick: () => removeOverlay(overlay)
    });
    const saveBtn = createButton({
        className: 'day-plan-save-btn',
        textContent: 'Add Personal Plan',
        onClick: async () => {
            const taskText = String(taskField.value || '').trim();
            if (!taskText) {
                alert('Please enter a task description');
                taskField.focus();
                return;
            }

            const selectedDate = String(dateInput.value || safeDate || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
                alert('Please choose a valid date');
                dateInput.focus();
                return;
            }

            const stepItems = Array.from(subPlanList.querySelectorAll('.plan-editor-subplan-input'))
                .map((input) => String(input.value || '').trim())
                .filter(Boolean);

            const rawAssigneeId = String(assigneeSelect?.value || '').trim();
            const assigneeId = rawAssigneeId || targetId;
            const assigneeName = rawAssigneeId ? (allUsers.find(u => u.id === assigneeId)?.name || '') : '';

            try {
                const existingPlan = await AppCalendar.getWorkPlan(assigneeId, selectedDate, { planScope: 'personal' });
                const nextPlans = Array.isArray(existingPlan?.plans)
                    ? existingPlan.plans.filter((task) => task && task.isRemoved !== true)
                    : [];

                nextPlans.push({
                    task: taskText,
                    subPlans: stepItems,
                    tags: [],
                    status: statusSelect.value || null,
                    assignedTo: rawAssigneeId || null,
                    assignedToName: assigneeName,
                    budgetHeadId: currentUser.currentBudgetHeadId || 'UNALLOCATED',
                    startDate: selectedDate,
                    endDate: selectedDate,
                    planScope: 'personal',
                    carryForwardRootId: '',
                    isRemoved: false,
                    isPrivate: privateCheckbox.checked
                });

                await AppCalendar.setWorkPlan(selectedDate, nextPlans, assigneeId, { planScope: 'personal' });
                if (window.AppStore?.invalidatePlans) window.AppStore.invalidatePlans();
                removeOverlay(overlay);
                if (typeof window.app_refreshCurrentPage === 'function') {
                    await window.app_refreshCurrentPage();
                } else if (typeof window.app_refreshDashboard === 'function') {
                    await window.app_refreshDashboard();
                }
            } catch (err) {
                console.error('Quick add personal plan failed:', err);
                alert(err?.message || 'Unable to save the personal plan.');
            }
        }
    });
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);

    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    const modalContainer = document.getElementById('modal-container') || document.body;
    modalContainer.appendChild(overlay);
    taskField.focus();
}

export async function quickEditPersonalPlan(date = null, targetUserId = null) {
    const currentUser = AppAuth.getUser();
    if (!currentUser?.id) return;
    const safeDate = String(date || AppCalendar.getTodayKey?.() || new Date().toISOString().slice(0, 10)).trim();
    const targetId = String(targetUserId || currentUser.id).trim() || currentUser.id;
    window.app_openTeamActivitiesForStaff?.(targetId, safeDate, 'time-desc');
}

// --- Main Functions ---

export function dayPlanRenderBlockV3(args) {
    const {
        plan = {},
        idx = 0,
        allUsers = [],
        targetId,
        defaultScope = 'personal',
        selectableCollaborators = [],
        isAdmin = false,
        isReference = false
    } = args || {};

    const task = String(plan.task || '');
    const assignedTo = plan.assignedTo ?? '';
    const assignedToName = String(plan.assignedToName || (assignedTo ? allUsers.find(u => u.id === assignedTo)?.name : '') || '');
    const startDate = plan.startDate || '';
    const endDate = plan.endDate || '';
    const scope = String(plan.planScope || plan._planScope || defaultScope) === 'annual' ? 'annual' : 'personal';
    const budgetHeadId = String(plan.budgetHeadId || AppAuth.getUser()?.currentBudgetHeadId || 'UNALLOCATED');
    const displayScope = isReference ? (plan.userName ? `${plan.userName}'s Plan` : 'Others Plan') : (scope === 'annual' ? 'Annual Plan' : 'Personal Plan');
    const summary = task.trim() || 'New task';
    const durationLabel = startDate && endDate && startDate !== endDate ? `${startDate} → ${endDate}` : (startDate || 'Due today');
    const planStatus = String(plan.status || '').trim().toLowerCase();

    /* Determine block class based on status */
    let blockStatusClass = '';
    if (planStatus === 'completed') blockStatusClass = ' plan-block-done';
    else if (planStatus === 'not-completed' || planStatus === 'postponed') blockStatusClass = ' plan-block-postponed';
    else if (planStatus === 'in-process') blockStatusClass = ' plan-block-active';

    const planBlock = createElement('div', {
        className: (isReference ? 'plan-block-ref' : 'plan-block') + blockStatusClass + (isReference ? ' is-reference-only' : '') + (plan.isPrivate === true ? ' plan-block-private' : ''),
        attributes: { 'data-index': idx, 'data-status': planStatus || 'none' }
    });

    const hiddenInputs = createElement('div', { className: 'dp-hidden-data', attributes: { style: 'display:none;' } });
    hiddenInputs.innerHTML = `
        <textarea class="plan-task">${esc(task)}</textarea>
        <select class="plan-status"><option value="${esc(plan.status || '')}" selected></option></select>
        <select class="plan-budget-head"><option value="${esc(budgetHeadId)}" selected></option></select>
        <select class="plan-scope"><option value="${esc(scope)}" selected></option></select>
        <select class="plan-assignee"><option value="${esc(assignedTo)}" selected></option></select>
        <input class="plan-assignee-name" value="${esc(assignedToName)}">
        <input class="plan-start-date" value="${esc(startDate)}">
        <input class="plan-end-date" value="${esc(endDate)}">
        <input class="plan-root-id" value="${esc(plan.carryForwardRootId || '')}">
        <input class="plan-removed-flag" value="${plan.isRemoved === true ? '1' : '0'}">
        <input class="plan-private" value="${plan.isPrivate === true ? '1' : '0'}">
        <input class="plan-source-plan-id" value="${esc(plan.assignedFromPlanId || '')}">
    `;
    if (plan.subPlans) {
        plan.subPlans.forEach(s => {
            const input = createElement('input', { className: 'sub-plan-input', attributes: { value: esc(s) } });
            hiddenInputs.appendChild(input);
        });
    }
    if (plan.tags) {
        plan.tags.forEach(t => {
            const chip = createElement('div', {
                className: 'tag-chip',
                attributes: {
                    'data-id': t.id,
                    'data-name': t.name,
                    'data-status': t.status || 'pending'
                }
            });
            hiddenInputs.appendChild(chip);
        });
    }

    planBlock.appendChild(hiddenInputs);

    const header = createElement('div', { className: 'plan-block-header' });

    /* ============================================================
       TITLE GROUP — now includes STATUS INDICATOR before the badge
       ============================================================ */
    const titleGroup = createElement('div', { className: 'plan-block-title-group' });

    /* Status indicator circle (replaces plain index badge when status exists) */
    const statusIndicator = createStatusIndicator(planStatus);
    titleGroup.appendChild(statusIndicator);

    titleGroup.appendChild(createElement('span', { className: 'day-plan-index-badge', textContent: idx + 1 }));
    titleGroup.appendChild(createElement('div', {
        className: 'plan-block-copy',
        children: [
            createElement('span', { className: 'plan-block-summary', textContent: summary }),
            createElement('span', { className: 'plan-block-meta', textContent: durationLabel })
        ]
    }));

    const headerActions = createElement('div', { className: 'plan-block-actions' });
    headerActions.appendChild(createElement('span', { className: 'day-plan-scope-pill', textContent: displayScope }));

    if (!isReference) {
        headerActions.appendChild(createButton({
            className: 'day-plan-private-toggle' + (plan.isPrivate === true ? ' is-private' : ''),
            attributes: { title: plan.isPrivate === true ? 'Private — only you can see this task' : 'Make private — only you can see this task' },
            innerHTML: plan.isPrivate === true ? '<i class="fa-solid fa-lock"></i>' : '<i class="fa-solid fa-lock-open"></i>',
            onClick: () => togglePlanBlockPrivate(planBlock)
        }));
        headerActions.appendChild(createButton({
            className: 'day-plan-edit-btn',
            attributes: { title: 'Edit plan' },
            innerHTML: '<i class="fa-solid fa-pen-to-square"></i>',
            onClick: () => openPlanEditor({
                date: startDate,
                targetId,
                scope,
                allUsers,
                selectableCollaborators,
                isAdmin,
                container: planBlock.parentElement,
                existingBlock: planBlock
            })
        }));
        headerActions.appendChild(createButton({
            className: 'day-plan-remove-btn',
            attributes: { title: 'Remove task' },
            innerHTML: '<i class="fa-solid fa-trash-can"></i>',
            onClick: () => window.app_markTaskRemoved(planBlock)
        }));
    }

    header.appendChild(titleGroup);
    header.appendChild(headerActions);
    planBlock.appendChild(header);

    if ((plan.tags && plan.tags.length > 0) || (Array.isArray(plan.subPlans) && plan.subPlans.length > 0)) {
        const body = createElement('div', { className: 'plan-block-body' });
        if (Array.isArray(plan.subPlans) && plan.subPlans.length > 0) {
            const subList = createElement('div', { className: 'day-plan-subplan-list' });
            plan.subPlans.forEach((step) => {
                subList.appendChild(createElement('div', {
                    className: 'day-plan-subplan-item',
                    children: [
                        createElement('span', { className: 'day-plan-subplan-check', innerHTML: '<i class="fa-regular fa-circle-check"></i>' }),
                        createElement('span', { className: 'day-plan-subplan-text', textContent: step })
                    ]
                }));
            });
            body.appendChild(subList);
        }
        if (plan.tags && plan.tags.length > 0) {
            plan.tags.forEach(t => {
                const tag = createElement('span', { className: 'day-plan-tag-pill', textContent: `@${t.name}` });
                body.appendChild(tag);
            });
        }
        planBlock.appendChild(body);
    }

    return planBlock;
}

export function app_extractBlockData(block) {
    if (!block) return null;
    const task = block.querySelector('.plan-task')?.value || '';
    const status = block.querySelector('.plan-status')?.value || '';
    const planScope = block.querySelector('.plan-scope')?.value || 'personal';
    const budgetHeadId = block.querySelector('.plan-budget-head')?.value || 'UNALLOCATED';
    const assignedTo = block.querySelector('.plan-assignee')?.value || '';
    const assignedToName = block.querySelector('.plan-assignee-name')?.value || '';
    const startDate = block.querySelector('.plan-start-date')?.value || '';
    const endDate = block.querySelector('.plan-end-date')?.value || '';
    const carryForwardRootId = block.querySelector('.plan-root-id')?.value || '';
    const isRemoved = block.querySelector('.plan-removed-flag')?.value === '1';
    const isPrivate = block.querySelector('.plan-private')?.value === '1';
    const assignedFromPlanId = block.querySelector('.plan-source-plan-id')?.value || '';

    const subPlans = Array.from(block.querySelectorAll('.sub-plan-input')).map(i => i.value);
    const tags = Array.from(block.querySelectorAll('.tag-chip')).map(c => ({
        id: c.dataset.id,
        name: c.dataset.name,
        status: c.dataset.status
    }));

    return { task, status, planScope, budgetHeadId, assignedTo, assignedToName, startDate, endDate, subPlans, tags, carryForwardRootId, isRemoved, isPrivate, assignedFromPlanId };
}

export function togglePlanBlockPrivate(trigger) {
    // Accept either the .plan-block element itself or a button inside it.
    const block = (trigger && typeof trigger.classList?.contains === 'function' && trigger.classList.contains('plan-block'))
        ? trigger
        : (trigger?.closest ? trigger.closest('.plan-block') : null);
    if (!block) return;
    const input = block.querySelector('.plan-private');
    const isNowPrivate = input?.value !== '1';
    if (input) input.value = isNowPrivate ? '1' : '0';
    const btn = block.querySelector('.day-plan-private-toggle');
    if (btn) {
        btn.classList.toggle('is-private', isNowPrivate);
        btn.innerHTML = isNowPrivate ? '<i class="fa-solid fa-lock"></i>' : '<i class="fa-solid fa-lock-open"></i>';
        btn.title = isNowPrivate ? 'Private — only you can see this task' : 'Make private — only you can see this task';
    }
    block.classList.toggle('plan-block-private', isNowPrivate);
}


const isAutoForwardedTask = (task) => {
    if (!task || typeof task !== 'object') return false;
    return task.isAutoForwarded === true
        || !!task.carryForwardRootId
        || !!task.carriedForwardFromDate
        || !!task.carriedForwardFromPlanId
        || !!task.autoForwardedAt;
};

function scheduleDayPlanMaintenance({ date, targetId, _forcedScope, options, modalContent }) {
    const todayKey = AppCalendar?.getTodayKey ? AppCalendar.getTodayKey() : '';
    const needsCarryForward = !options?.skipCarryForwardSync && AppCalendar?.ensureCarryForwardForDate && date <= todayKey;
    const needsCleanup = !options?.skipCarryForwardCleanup && AppCalendar?.cleanupInvalidTodayCarryForward && date === todayKey;
    if (!needsCarryForward && !needsCleanup) return;

    // Skip maintenance if already done for this (date, targetId) in this session.
    // Cleared automatically when a work_plans write event fires (see app:db-write listener above).
    const maintenanceKey = `${date}::${targetId}`;
    if (dayPlanMaintenanceDone.has(maintenanceKey)) return;
    dayPlanMaintenanceDone.add(maintenanceKey);

    window.setTimeout(async () => {
        try {
            let changed = false;
            if (needsCarryForward) {
                const result = await AppCalendar.ensureCarryForwardForDate(date, { userIds: [targetId] });
                changed = changed || Number(result?.created || 0) > 0 || (result?.updatedPlans || []).length > 0;
            }

            if (needsCleanup) {
                const cleanupResult = await AppCalendar.cleanupInvalidTodayCarryForward(targetId, date, { onlyToday: true });
                changed = changed || Number(cleanupResult?.removed || 0) > 0;
                if ((cleanupResult?.removed || 0) > 0) {
                    console.log(`Day plan cleanup removed ${cleanupResult.removed} invalid carry-forward task(s) for ${targetId} on ${date}.`);
                }
            }

            if (!changed) return;
            dayPlanPrefetchCache.clear();

            // Carry-forward tasks were already saved to Firestore.
            // Instead of re-opening the entire modal (which causes a flash/loading spinner),
            // we just mark that new tasks are available. The user sees them on next open.
            // If the modal is still open and untouched, silently re-fetch and update in-place.
            const activeModal = document.getElementById('day-plan-modal');
            const activeForm = activeModal?.querySelector('.day-plan-form');
            const editorOpen = !!document.querySelector('.plan-editor-overlay');
            const stillShowingSamePlan = activeModal?.dataset?.planDate === date && modalContent?.isConnected;
            const userHasStartedEditing = activeForm?.dataset?.dayPlanTouched === '1';
            if (!stillShowingSamePlan || editorOpen || userHasStartedEditing) return;

            // Lightweight refresh: replace only the plan blocks, not the entire modal
            try {
                const freshData = await loadDayPlanData(date, targetId);
                if (!freshData) return;
                const personalPlan = freshData.personalWorkPlan;
                const freshBlocks = [];
                if (personalPlan && Array.isArray(personalPlan.plans)) {
                    personalPlan.plans.forEach((p, idx) => {
                        if (p.isRemoved !== true) {
                            freshBlocks.push({ ...p, planScope: 'personal', idx });
                        }
                    });
                }
                if (freshBlocks.length > 0) {
                    const container = activeModal?.querySelector('.personal-plans-container');
                    if (container) {
                        container.innerHTML = '';
                        freshBlocks.forEach((block, idx) => {
                            const blockEl = dayPlanRenderBlockV3({
                                plan: block,
                                allUsers: [],
                                targetId,
                                selectableCollaborators: [],
                                isAdmin: false,
                                currentUserId: targetId,
                                idx
                            });
                            container.appendChild(blockEl);
                        });
                    }
                }
            } catch (err) {
                console.warn('Failed to lightweight-refresh carry-forward tasks:', err);
            }
        } catch (err) {
            console.warn('Day plan background maintenance failed:', err);
        }
    }, 0);
}

export async function openDayPlan(date, targetUserId = null, forcedScope = null, options = {}) {
    if (window.performance?.mark) window.performance.mark('day-plan-open-start');
    const dateKey = String(date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        console.warn('Cannot open day plan for invalid date:', date);
        return;
    }
    const requestId = ++activeDayPlanRequestId;
    const currentUser = AppAuth.getUser();
    const targetIdRaw = String(targetUserId ?? '').trim();
    const targetId = (!targetIdRaw || targetIdRaw === 'undefined' || targetIdRaw === 'null') ? currentUser.id : targetIdRaw;
    const isAdmin = currentUser.role === 'Administrator' || currentUser.isAdmin;
    const isEditingOther = targetId !== currentUser.id;
    const defaultScope = forcedScope === 'annual' ? 'annual' : 'personal';
    const hideAutoForwardedTasks = options?.hideAutoForwardedTasks === true;
    window.app_currentDayPlanTargetId = targetId;
    const todayKey = AppCalendar?.getTodayKey ? AppCalendar.getTodayKey() : '';
    const prefetchRecord = getDayPlanPrefetchRecord(dateKey, targetId, forcedScope, options);

    const modalOverlay = createElement('div', {
        id: 'day-plan-modal',
        className: 'day-plan-modal-overlay',
        attributes: { 'data-plan-date': dateKey }
    });


    const modalContent = createElement('div', {
        className: 'day-plan-content'
    });

    const headerWrap = createElement('div', { className: 'day-plan-header-wrap' });
    headerWrap.appendChild(createDayPlanHeader(dateKey, isEditingOther, 'Staff', false, targetId));

    const bodyWrap = createElement('div', { className: 'day-plan-body-wrap' });
    bodyWrap.appendChild(createDayPlanLoadingState());

    modalContent.appendChild(headerWrap);
    modalContent.appendChild(bodyWrap);
    modalOverlay.appendChild(modalContent);

    const container = document.getElementById('modal-container');
    if (!container) return;
    const existing = document.getElementById('day-plan-modal');
    if (existing) removeOverlay(existing);

    acquireOverlayLayer(modalOverlay);
    container.appendChild(modalOverlay);
    if (window.performance?.mark) window.performance.mark('day-plan-shell-mounted');
    if (window.performance?.measure) {
        try {
            window.performance.measure('day-plan:shell', 'day-plan-open-start', 'day-plan-shell-mounted');
        } catch {
            // Ignore duplicate or missing marks.
        }
    }
    const isCurrentRequest = () =>
        requestId === activeDayPlanRequestId
        && modalOverlay.isConnected
        && document.getElementById('day-plan-modal') === modalOverlay;

    scheduleNextPaint(async () => {
        if (!isCurrentRequest()) return;

        if (window.performance?.mark) window.performance.mark('day-plan-hydrate-start');
        try {

            const canUsePrefetchedPlans = !!todayKey && dateKey >= todayKey;
            let allUsers = null;
            let personalWorkPlan = null;
            let annualWorkPlan = null;
            let allDayPlans = null;

            if (options?.personalOnly === true) {
                personalWorkPlan = await AppCalendar.getWorkPlan(targetId, dateKey, { planScope: 'personal' });
                annualWorkPlan = null;
                allDayPlans = [];
                allUsers = [currentUser];
                if (targetId !== currentUser.id) {
                    const targetUser = await AppDB.get('users', targetId).catch(() => null);
                    if (targetUser) allUsers.push(targetUser);
                }
            } else if (canUsePrefetchedPlans && prefetchRecord?.dataPromise) {
                const prefetched = await prefetchRecord.dataPromise;
                allUsers = prefetched?.allUsers || null;
                personalWorkPlan = prefetched?.personalWorkPlan || null;
                annualWorkPlan = prefetched?.annualWorkPlan || null;
                allDayPlans = prefetched?.allDayPlans || null;
            } else {
                // Single fetch: load plan data first, then fetch users for all referenced IDs.
                // This avoids a separate parallel call that only gets the target user,
                // followed by a second call to get remaining referenced users.
                const data = await loadDayPlanData(dateKey, targetId);
                personalWorkPlan = data.personalWorkPlan;
                annualWorkPlan = data.annualWorkPlan;
                allDayPlans = data.allDayPlans;
            }
            if (!isCurrentRequest()) return;
            if (!allUsers) {
                allUsers = await getReferencedDayPlanUsers(allDayPlans, targetId);
            }
            if (!isCurrentRequest()) return;


            const hasAnyExistingPlan = !!(personalWorkPlan || annualWorkPlan);
            const targetUser = allUsers.find(u => u.id === targetId);
            const headerName = targetUser ? targetUser.name : 'Staff';
            const selectableCollaborators = allUsers.filter(u => u.id !== targetId);

            const normalizeScopedPlans = (workPlan, scope, userName = null) => {
                if (!workPlan) return [];
                if (Array.isArray(workPlan.plans) && workPlan.plans.length > 0) {
                    return workPlan.plans.map(p => ({
                        ...p,
                        planScope: scope,
                        userName: userName || workPlan.userName,
                        isReference: !!userName
                    })).filter(p => p.isRemoved !== true && (!hideAutoForwardedTasks || !isAutoForwardedTask(p)))
                        .filter(p => isTaskVisibleToViewer(p, String(workPlan.userId || ''), String(currentUser?.id || '')));
                }
                return [];
            };

            const othersPlans = (allDayPlans || []).filter(p =>
                p.id !== AppCalendar.getWorkPlanId(dateKey, targetId, 'personal') &&
                p.id !== AppCalendar.getWorkPlanId(dateKey, targetId, 'annual')
            );

            const othersBlocks = [];
            othersPlans.forEach(p => {
                othersBlocks.push(...normalizeScopedPlans(p, p.planScope, p.userName));
            });

            const initialBlocks = [
                ...normalizeScopedPlans(personalWorkPlan, 'personal'),
                ...normalizeScopedPlans(annualWorkPlan, 'annual'),
                ...othersBlocks
            ];
            if (initialBlocks.length === 0) {
                initialBlocks.push({
                    task: '',
                    subPlans: [],
                    tags: [],
                    status: null,
                    budgetHeadId: AppAuth.getUser()?.currentBudgetHeadId || 'UNALLOCATED',
                    assignedTo: '',
                    startDate: dateKey,
                    endDate: dateKey,
                    planScope: defaultScope
                });
            }

            headerWrap.replaceChildren(createDayPlanHeader(dateKey, isEditingOther, headerName, hasAnyExistingPlan, targetId));
            bodyWrap.replaceChildren(createDayPlanForm(dateKey, targetId, personalWorkPlan, annualWorkPlan, initialBlocks, allUsers, defaultScope, selectableCollaborators, isAdmin, currentUser, options));
            if (options?.personalOnly === true) {
                const workspace = modalContent.querySelector('.day-plan-workspace');
                const contextColumn = modalContent.querySelector('.day-plan-context-column');
                if (workspace) workspace.style.gridTemplateColumns = '1fr';
                contextColumn?.remove();
            }
            const subtitle = modalContent.querySelector('.day-plan-subline');
            if (subtitle) {
                subtitle.textContent = isEditingOther ? `${formatFriendlyDate(dateKey) || dateKey} · Editing for ${headerName}` : (formatFriendlyDate(dateKey) || dateKey);
            }
            const kicker = modalContent.querySelector('.day-plan-kicker');
            if (kicker) kicker.textContent = 'Today';
            if (window.performance?.mark) window.performance.mark('day-plan-hydrate-end');
            if (window.performance?.measure) {
                try {
                    window.performance.measure('day-plan:hydrate', 'day-plan-hydrate-start', 'day-plan-hydrate-end');
                } catch {
                    // Ignore duplicate or missing marks.
                }
            }
            // After personal/annual are ready, the shared/others blocks are rendered progressively
            // by IntersectionObserver inside createDayPlanForm().
            // (We intentionally avoid an additional “others” hydration pass here to prevent duplicates
            // and extra Firestore reads.)

            // Mark personal/annual hydration complete.
            if (window.performance?.mark) window.performance.mark('day-plan-personal-annual-hydrate-done');
            scheduleDayPlanMaintenance({ date: dateKey, targetId, forcedScope, options, modalContent });


        } catch (err) {
            console.error('Failed to open day plan:', err);
            if (isCurrentRequest()) {
                bodyWrap.replaceChildren(createDayPlanLoadingState(`Unable to load the day plan${err?.message ? `: ${err.message}` : ''}`));
            }
        }
    });
}

export async function addPlanBlockUI(scopeOverride = null) {
    const modal = document.getElementById('day-plan-modal');
    if (!modal) return;
    const scope = scopeOverride || 'personal';
    const container = scope === 'annual' ?
        modal.querySelector('.others-plans-container') :
        modal.querySelector('.personal-plans-container');

    const date = modal.dataset.planDate || new Date().toISOString().split('T')[0];

    const allUsers = await getCachedDayPlanUsers();
    const currentUser = AppAuth.getUser();
    const targetId = window.app_currentDayPlanTargetId || currentUser.id;
    const isAdmin = currentUser.role === 'Administrator' || currentUser.isAdmin;
    const selectableCollaborators = allUsers.filter(u => u.id !== targetId);

    openPlanEditor({ date, targetId, scope, allUsers, selectableCollaborators, isAdmin, container });
}

export function prefetchDayPlan(date, targetUserId = null, forcedScope = null, options = {}) {
    const record = getDayPlanPrefetchRecord(date, targetUserId, forcedScope, options);
    return record?.promise || Promise.resolve(null);
}

// Global exposure
const AppDayPlan = {
    openDayPlan,
    dayPlanRenderBlockV3,
    addPlanBlockUI,
    openPlanEditor,
    prefetchDayPlan,
    quickAddPersonalPlan,
    quickEditPersonalPlan,
    app_extractBlockData,
    togglePlanBlockPrivate
};

window.AppDayPlan = AppDayPlan;
window.app_openDayPlan = openDayPlan;
window.app_dayPlanRenderBlockV3 = dayPlanRenderBlockV3;
window.app_addPlanBlockUI = addPlanBlockUI;
window.app_prefetchDayPlan = prefetchDayPlan;
window.app_quickAddPersonalPlan = quickAddPersonalPlan;
window.app_quickEditPersonalPlan = quickEditPersonalPlan;
window.app_extractBlockData = app_extractBlockData;
window.app_togglePlanBlockPrivate = togglePlanBlockPrivate;
window.app_markTaskRemoved = function (block) {
    if (!block) return;
    const form = block.closest('.day-plan-form');
    const data = app_extractBlockData(block);
    const rootId = data?.carryForwardRootId || '';
    if (form && rootId) {
        let removed = [];
        try {
            removed = JSON.parse(form.dataset.removedTasks || '[]');
        } catch {
            removed = [];
        }
        const scope = data?.planScope === 'annual' ? 'annual' : 'personal';
        if (!removed.find(item => item && item.rootId === rootId && item.scope === scope)) {
            removed.push({ rootId, scope });
            form.dataset.removedTasks = JSON.stringify(removed);
        }
    }
    block.remove();
};

export { AppDayPlan };

// Firestore connection warm-up: do a minimal read on first idle to avoid cold-start
// latency when the user opens their first day plan.
let _warmed = false;
function prewarmFirestore() {
    if (_warmed || !AppDB?.db || !AppAuth?.getUser()) return;
    _warmed = true;
    // Tiny doc existence check — just opens the Firestore connection so subsequent
    // queries don't pay the TLS/cold-start cost.
    AppDB.db.collection('work_plans').limit(1).get().catch(() => {});
}
if (typeof window !== 'undefined') {
    // Run after initial render settles
    const idleCb = () => { requestIdleCallback ? requestIdleCallback(prewarmFirestore) : setTimeout(prewarmFirestore, 1000); };
    if (document.readyState === 'complete') idleCb();
    else window.addEventListener('load', idleCb, { once: true });
}
