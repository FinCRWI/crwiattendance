import { AppDB } from './db.js';
import { isTaskVisibleToViewer } from '../utils/task-visibility.js';

const CONTEXT_COLLECTION = 'ai_staff_context';
const REBUILD_DEBOUNCE_MS = 1200;
const STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_RECENT_ITEMS = 8;
const MAX_TOP_ITEMS = 6;
const FALLBACK_SCOPE = 'Curated staff memory';

const SENSITIVE_KEY_PATTERN = /(salary|token|secret|password|passcode|api[-_ ]?key|auth|private|ssn|aadhaar|bank|account|pin|notes?)/i;
const STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'onto', 'your', 'their', 'they', 'them',
    'plan', 'task', 'work', 'today', 'day', 'new', 'add', 'make', 'please', 'review', 'update', 'check',
    'complete', 'completed', 'doing', 'done', 'about', 'after', 'before', 'related', 'relateds'
]);

const trimText = (value, maxLen = 240) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!maxLen || text.length <= maxLen) return text;
    return `${text.slice(0, Math.max(0, maxLen - 1)).trim()}...`;
};

const sanitizeRecursive = (value, depth = 0) => {
    if (value === null || value === undefined) return value;
    if (depth > 4) return '[Depth limited]';
    if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeRecursive(item, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const [key, child] of Object.entries(value)) {
            if (SENSITIVE_KEY_PATTERN.test(key)) continue;
            out[key] = sanitizeRecursive(child, depth + 1);
        }
        return out;
    }
    if (typeof value === 'string') return trimText(value, 400);
    return value;
};

const normalizeDate = (value) => {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}T/i.test(raw)) return raw.slice(0, 10);
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    return '';
};

const wordCountsFromText = (text, counts) => {
    const words = String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 2 && !STOPWORDS.has(word));
    words.forEach((word) => {
        counts.set(word, (counts.get(word) || 0) + 1);
    });
};

const summarizeBudgetHead = (budgetHeadId) => {
    const id = trimText(budgetHeadId, 80);
    if (!id) return '';
    const cache = Array.isArray(window.app_budgetHeadsCache) ? window.app_budgetHeadsCache : [];
    const head = cache.find((item) => String(item?.id || '').trim() === id);
    if (!head) return id;
    return `${String(head.code || id).trim()} - ${String(head.name || id).trim()}`;
};

const summarizePlan = (plan = {}, ownerName = '', sourceLabel = '') => {
    const task = trimText(plan?.task || '', 220);
    if (!task) return null;
    return {
        date: normalizeDate(plan?.date || plan?.startDate || ''),
        task,
        budgetHeadId: trimText(plan?.budgetHeadId || '', 80),
        budgetHeadLabel: summarizeBudgetHead(plan?.budgetHeadId || ''),
        status: trimText(plan?.status || '', 40),
        scope: trimText(plan?.planScope || 'personal', 20),
        assignedTo: trimText(plan?.assignedTo || '', 120),
        collaboratorCount: Array.isArray(plan?.tags) ? plan.tags.length : 0,
        steps: Array.isArray(plan?.subPlans) ? plan.subPlans.map((step) => trimText(step, 120)).filter(Boolean).slice(0, 5) : [],
        ownerName: trimText(ownerName, 120),
        sourceLabel: trimText(sourceLabel, 120)
    };
};

const summarizeActivityEvent = (event = {}) => {
    const eventType = trimText(event?.eventType || event?.type || '', 60);
    if (!eventType) return null;
    return {
        date: normalizeDate(event?.timestamp || event?.effectiveDate || event?.createdAt || ''),
        eventType,
        budgetHeadId: trimText(event?.budgetHeadId || '', 80),
        progressStatus: trimText(event?.progressStatus || '', 40),
        note: trimText(event?.note || '', 180),
        actorId: trimText(event?.actorId || event?.userId || '', 120),
        userId: trimText(event?.userId || '', 120)
    };
};

const summarizeAttendance = async (userId) => {
    const summary = {
        monthly: null,
        yearly: null
    };
    try {
        if (window.AppAnalytics?.getUserMonthlyStats) {
            summary.monthly = sanitizeRecursive(await window.AppAnalytics.getUserMonthlyStats(userId));
        }
    } catch (err) {
        console.warn('AI context feeder: monthly attendance summary failed:', err);
    }
    try {
        if (window.AppAnalytics?.getUserYearlyStats) {
            summary.yearly = sanitizeRecursive(await window.AppAnalytics.getUserYearlyStats(userId));
        }
    } catch (err) {
        console.warn('AI context feeder: yearly attendance summary failed:', err);
    }
    return summary;
};

const extractUserIdFromPlanId = (planId = '') => {
    const raw = String(planId || '').trim();
    if (!raw) return '';
    const matchAnnual = raw.match(/^plan_annual_(.+?)_\d{4}-\d{2}-\d{2}$/);
    if (matchAnnual?.[1]) return matchAnnual[1];
    const match = raw.match(/^plan_(.+?)_\d{4}-\d{2}-\d{2}$/);
    return match?.[1] || '';
};

const getUserLabel = (user, fallbackId = '') => trimText(user?.name || fallbackId || 'Unknown staff', 120);

async function loadStaffContext(userId) {
    if (!userId) return null;
    if (!AppDB?.get) return null;
    try {
        return await AppDB.get(CONTEXT_COLLECTION, userId, { silentPermissionDenied: true });
    } catch (err) {
        console.warn('AI context feeder: failed to load staff context:', err);
        return null;
    }
}

function normalizeTopItems(map, limit = MAX_TOP_ITEMS) {
    return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([value, count]) => ({ value: trimText(value, 160), count }));
}

async function rebuildStaffContext(userId, _options = {}) {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) return null;

    const [user, allPlans, allEvents, allUsers] = await Promise.all([
        AppDB.get('users', safeUserId).catch(() => null),
        AppDB.getAll('work_plans').catch(() => []),
        AppDB.getAll('task_activity_events').catch(() => []),
        AppDB.getAll('users').catch(() => [])
    ]);

    const userLabel = getUserLabel(user, safeUserId);
    const recentPlans = [];
    const recentPlanDedup = new Set();
    const budgetHeadCounts = new Map();
    const collaboratorCounts = new Map();
    const taskThemeCounts = new Map();
    const stepCounts = new Map();
    const eventTypeCounts = new Map();

    const relevantPlans = (allPlans || [])
        .filter((plan) => {
            if (!plan || !Array.isArray(plan.plans)) return false;
            const planOwnerId = String(plan.userId || '').trim();
            const createdById = String(plan.createdById || '').trim();
            if (planOwnerId === safeUserId || createdById === safeUserId) return true;
            return plan.plans.some((task) => {
                if (!task || task.isRemoved === true) return false;
                const assignedTo = String(task.assignedTo || '').trim();
                const tags = Array.isArray(task.tags) ? task.tags : [];
                return assignedTo === safeUserId || tags.some((tag) => String(tag?.id || '').trim() === safeUserId);
            });
        })
        .sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')))
        .slice(0, 120);

    relevantPlans.forEach((plan) => {
        const planOwner = allUsers.find((u) => String(u.id || '').trim() === String(plan.userId || '').trim()) || null;
        const ownerName = getUserLabel(planOwner, plan.userName || plan.userId || '');
        const visibleTasks = Array.isArray(plan.plans)
            ? plan.plans.filter((task) => task && task.isRemoved !== true && isTaskVisibleToViewer(task, String(plan.userId || ''), safeUserId))
            : [];
        visibleTasks.forEach((task) => {
            const assignedTo = String(task.assignedTo || '').trim();
            if (assignedTo && assignedTo !== safeUserId) {
                const assignee = allUsers.find((u) => String(u.id || '').trim() === assignedTo);
                const assigneeName = getUserLabel(assignee, assignedTo);
                collaboratorCounts.set(assigneeName, (collaboratorCounts.get(assigneeName) || 0) + 1);
            }
            (Array.isArray(task.tags) ? task.tags : []).forEach((tag) => {
                const tagName = trimText(tag?.name || tag?.id || '', 120);
                if (tagName) collaboratorCounts.set(tagName, (collaboratorCounts.get(tagName) || 0) + 1);
            });
            if (task.budgetHeadId) {
                budgetHeadCounts.set(String(task.budgetHeadId), (budgetHeadCounts.get(String(task.budgetHeadId)) || 0) + 1);
            }
            wordCountsFromText(task.task, taskThemeCounts);
            (Array.isArray(task.subPlans) ? task.subPlans : []).forEach((step) => {
                const normalizedStep = trimText(step, 160);
                if (normalizedStep) stepCounts.set(normalizedStep, (stepCounts.get(normalizedStep) || 0) + 1);
            });
            const summaryKey = `${normalizeDate(plan.date || '')}:${task.task}:${task.budgetHeadId || ''}:${assignedTo || ''}`;
            if (!recentPlanDedup.has(summaryKey)) {
                recentPlanDedup.add(summaryKey);
                const planSummary = summarizePlan({
                    ...task,
                    date: plan.date,
                    planScope: plan.planScope,
                    assignedTo: assignedTo || plan.assignedTo || '',
                    budgetHeadId: task.budgetHeadId || plan.budgetHeadId || '',
                    subPlans: task.subPlans || []
                }, ownerName, plan.planScope || 'personal');
                if (planSummary) recentPlans.push(planSummary);
            }
        });
    });

    const activityEvents = (allEvents || [])
        .filter((event) => {
            const actorId = String(event?.actorId || event?.userId || '').trim();
            const targetId = String(event?.userId || '').trim();
            return actorId === safeUserId || targetId === safeUserId;
        })
        .sort((a, b) => String(b?.timestamp || b?.createdAt || '').localeCompare(String(a?.timestamp || a?.createdAt || '')))
        .slice(0, 60);

    const recentActivities = [];
    activityEvents.forEach((event) => {
        const summary = summarizeActivityEvent(event);
        if (!summary) return;
        recentActivities.push(summary);
        eventTypeCounts.set(summary.eventType, (eventTypeCounts.get(summary.eventType) || 0) + 1);
        if (summary.budgetHeadId) {
            budgetHeadCounts.set(summary.budgetHeadId, (budgetHeadCounts.get(summary.budgetHeadId) || 0) + 1);
        }
    });

    const attendance = await summarizeAttendance(safeUserId);
    const tagHistory = Array.isArray(user?.tagHistory) ? user.tagHistory.slice(0, 25) : [];
    const notifications = Array.isArray(user?.notifications) ? user.notifications.slice(0, 25) : [];
    const tagHistorySummary = tagHistory.map((item) => trimText(item?.title || item?.message || item?.type || '', 180)).filter(Boolean).slice(0, 8);
    const notificationSummary = notifications.map((item) => trimText(item?.title || item?.message || item?.type || '', 180)).filter(Boolean).slice(0, 8);

    const recurringBudgetHeads = normalizeTopItems(budgetHeadCounts, 4).map((item) => ({
        ...item,
        label: summarizeBudgetHead(item.value)
    }));
    const recurringCollaborators = normalizeTopItems(collaboratorCounts, 6).map((item) => item.value);
    const recurringTaskTypes = normalizeTopItems(taskThemeCounts, 6).map((item) => item.value);
    const recurringSteps = normalizeTopItems(stepCounts, 6).map((item) => item.value);
    const recurringEventTypes = normalizeTopItems(eventTypeCounts, 6).map((item) => item.value);

    recentPlans.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const attendanceBits = [];
    const monthly = attendance?.monthly || {};
    const yearly = attendance?.yearly || {};
    if (typeof monthly.present === 'number' || typeof monthly.late === 'number' || typeof monthly.leaves === 'number') {
        attendanceBits.push(`This month: ${monthly.present || 0} present, ${monthly.late || 0} late, ${monthly.leaves || 0} leave day(s).`);
    }
    if (typeof yearly.present === 'number' || typeof yearly.late === 'number' || typeof yearly.leaves === 'number') {
        attendanceBits.push(`Year-to-date: ${yearly.present || 0} present, ${yearly.late || 0} late, ${yearly.leaves || 0} leave day(s).`);
    }
    if (yearly?.totalExtraDuration) attendanceBits.push(`Extra time: ${trimText(yearly.totalExtraDuration, 40)}.`);
    if (yearly?.totalLateDuration) attendanceBits.push(`Late duration: ${trimText(yearly.totalLateDuration, 40)}.`);

    const summarySentences = [
        `${userLabel} works most often on ${recurringTaskTypes.slice(0, 3).join(', ') || 'a mix of tasks'}.`,
        recurringBudgetHeads.length ? `Frequent budget heads: ${recurringBudgetHeads.slice(0, 3).map((item) => item.label || item.value).join(', ')}.` : '',
        recurringCollaborators.length ? `Recurring collaborators: ${recurringCollaborators.slice(0, 4).join(', ')}.` : '',
        attendanceBits.join(' '),
        tagHistorySummary.length ? `Recent tagged items: ${tagHistorySummary.join('; ')}.` : '',
        notificationSummary.length ? `Recent notifications: ${notificationSummary.join('; ')}.` : ''
    ].filter(Boolean).join(' ');

    const record = {
        id: safeUserId,
        userId: safeUserId,
        userName: userLabel,
        role: trimText(user?.role || '', 60),
        sourceScope: `${FALLBACK_SCOPE} for ${userLabel}`,
        memoryVersion: 1,
        updatedAt: new Date().toISOString(),
        sourceUpdatedAt: new Date().toISOString(),
        needsRebuild: false,
        summary: {
            narrative: trimText(summarySentences, 1400),
            taskTypes: recurringTaskTypes,
            budgetHeads: recurringBudgetHeads,
            collaborators: recurringCollaborators,
            steps: recurringSteps,
            events: recurringEventTypes,
            attendance: trimText(attendanceBits.join(' '), 700)
        },
        recentPlans: recentPlans.slice(0, MAX_RECENT_ITEMS),
        recentActivities: recentActivities.slice(0, MAX_RECENT_ITEMS),
        attendanceSummary: attendance,
        tagHistorySummary,
        notificationSummary
    };

    try {
        await AppDB.put(CONTEXT_COLLECTION, record, { silentPermissionDenied: true });
    } catch (err) {
        console.warn('AI context feeder: failed to store staff context:', err);
    }
    return record;
}

async function ensureStaffContext(userId, options = {}) {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) return null;
    const existing = await loadStaffContext(safeUserId);
    const needsRebuild = options.force === true
        || !existing
        || existing.needsRebuild === true
        || !existing.updatedAt
        || (Date.now() - new Date(existing.updatedAt).getTime()) > STALE_AFTER_MS;
    if (needsRebuild) {
        return rebuildStaffContext(safeUserId, options);
    }
    return existing;
}

function buildStaffMemoryPack(record, currentUser) {
    if (!record) {
        return {
            sourceScope: 'No staff memory available yet',
            historyAvailable: false,
            summary: {
                narrative: '',
                taskTypes: [],
                budgetHeads: [],
                collaborators: [],
                steps: [],
                events: [],
                attendance: ''
            },
            recentPlans: [],
            recentActivities: [],
            recentPersonalPlans: [],
            recentTaskActivityHistory: [],
            budgetHeadPatterns: [],
            attendanceSummary: null
        };
    }

    const recentPersonalPlans = Array.isArray(record.recentPlans) ? record.recentPlans.slice(0, MAX_RECENT_ITEMS) : [];
    const recentTaskActivityHistory = Array.isArray(record.recentActivities) ? record.recentActivities.slice(0, MAX_RECENT_ITEMS) : [];
    const budgetHeadPatterns = Array.isArray(record.summary?.budgetHeads) ? record.summary.budgetHeads.slice(0, MAX_RECENT_ITEMS) : [];

    return {
        sourceScope: trimText(record.sourceScope || `Staff memory for ${record.userName || currentUser?.name || 'staff'}`, 240),
        historyAvailable: true,
        updatedAt: record.updatedAt || '',
        user: {
            id: record.userId || '',
            name: record.userName || currentUser?.name || '',
            role: record.role || currentUser?.role || ''
        },
        summary: sanitizeRecursive(record.summary || {}),
        recentPlans: recentPersonalPlans,
        recentPersonalPlans,
        recentActivities: recentTaskActivityHistory,
        recentTaskActivityHistory,
        budgetHeadPatterns,
        attendanceSummary: sanitizeRecursive(record.attendanceSummary || {}),
        tagHistorySummary: Array.isArray(record.tagHistorySummary) ? record.tagHistorySummary.slice(0, MAX_RECENT_ITEMS) : [],
        notificationSummary: Array.isArray(record.notificationSummary) ? record.notificationSummary.slice(0, MAX_RECENT_ITEMS) : []
    };
}

const dirtyQueue = new Map();

async function markStaffContextDirty(userId, payload = {}) {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) return;
    const existing = await loadStaffContext(safeUserId).catch(() => null);
    const next = {
        ...(existing || { id: safeUserId, userId: safeUserId, userName: trimText(payload?.userName || safeUserId, 120) }),
        needsRebuild: true,
        updatedAt: new Date().toISOString(),
        sourceUpdatedAt: new Date().toISOString(),
        dirtyReason: trimText(payload?.reason || payload?.collection || 'db-write', 180)
    };
    try {
        await AppDB.put(CONTEXT_COLLECTION, next, { silentPermissionDenied: true });
    } catch (err) {
        console.warn('AI context feeder: failed to mark staff context dirty:', err);
    }
}

function scheduleRebuild(userId, payload = {}) {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) return;
    if (dirtyQueue.has(safeUserId)) {
        window.clearTimeout(dirtyQueue.get(safeUserId));
    }
    const timer = window.setTimeout(async () => {
        dirtyQueue.delete(safeUserId);
        try {
            await rebuildStaffContext(safeUserId, payload);
        } catch (err) {
            console.warn('AI context feeder: scheduled rebuild failed:', err);
        }
    }, REBUILD_DEBOUNCE_MS);
    dirtyQueue.set(safeUserId, timer);
}

function inferUserIdsFromWrite(detail = {}) {
    const collection = String(detail?.collection || '').trim();
    const item = detail?.item && typeof detail.item === 'object' ? detail.item : null;
    const ids = new Set();
    if (collection === 'work_plans') {
        const userId = String(item?.userId || item?.assignedTo || extractUserIdFromPlanId(detail?.id || item?.id || '') || '').trim();
        if (userId) ids.add(userId);
        (Array.isArray(item?.plans) ? item.plans : []).forEach((task) => {
            const assignedTo = String(task?.assignedTo || '').trim();
            if (assignedTo) ids.add(assignedTo);
            (Array.isArray(task?.tags) ? task.tags : []).forEach((tag) => {
                const tagId = String(tag?.id || '').trim();
                if (tagId) ids.add(tagId);
            });
        });
    } else if (collection === 'task_activity_events') {
        const actorId = String(item?.actorId || '').trim();
        const userId = String(item?.userId || '').trim();
        if (actorId) ids.add(actorId);
        if (userId) ids.add(userId);
    } else if (collection === 'attendance') {
        const userId = String(item?.userId || item?.user_id || '').trim();
        if (userId) ids.add(userId);
    } else if (collection === 'users') {
        const userId = String(item?.id || '').trim();
        if (userId) ids.add(userId);
    }
    return Array.from(ids);
}

function handleDbWrite(detail = {}) {
    const collection = String(detail?.collection || '').trim();
    if (!['work_plans', 'task_activity_events'].includes(collection)) return;
    const userIds = inferUserIdsFromWrite(detail);
    if (!userIds.length && detail?.op === 'deleteMany') return;
    userIds.forEach((userId) => {
        markStaffContextDirty(userId, { collection, reason: detail?.op || 'db-write', userName: detail?.item?.userName || detail?.item?.name || userId })
            .then(() => scheduleRebuild(userId, { collection, reason: detail?.op || 'db-write' }))
            .catch(() => null);
    });
}

async function getStaffContextPack(userOrId, options = {}) {
    const user = typeof userOrId === 'object' ? userOrId : null;
    const userId = String(user?.id || userOrId || options.userId || '').trim();
    if (!userId) {
        return buildStaffMemoryPack(null, user);
    }
    const record = await ensureStaffContext(userId, options);
    return buildStaffMemoryPack(record, user);
}

function attachGlobal() {
    const api = {
        CONTEXT_COLLECTION,
        STALE_AFTER_MS,
        REBUILD_DEBOUNCE_MS,
        FALLBACK_SCOPE,
        getStaffContextPack,
        rebuildStaffContext,
        ensureStaffContext,
        markStaffContextDirty,
        handleDbWrite,
        sanitizeRecursive,
        trimText
    };
    if (typeof window !== 'undefined') {
        window.AppAIContextFeeder = api;
        if (!window.__appAiContextFeederBound) {
            window.__appAiContextFeederBound = true;
            window.addEventListener('app:db-write', (e) => handleDbWrite(e?.detail || {}));
        }
    }
    return api;
}

export const AppAIContextFeeder = attachGlobal();
export default AppAIContextFeeder;
