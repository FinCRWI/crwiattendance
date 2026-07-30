import { normalizeTaskStatus } from './task-status.js';

const OPEN_STATUSES = new Set(['overdue', 'to-be-started', 'in-process', 'missed']);

function normalizeIsoDate(value) {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
    const [year, month, day] = raw.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (
        Number.isNaN(d.getTime())
        || d.getUTCFullYear() !== year
        || (d.getUTCMonth() + 1) !== month
        || d.getUTCDate() !== day
    ) {
        return '';
    }
    return raw;
}

function addDays(dateStr, deltaDays) {
    const normalized = normalizeIsoDate(dateStr);
    if (!normalized) return '';
    const [year, month, day] = normalized.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0));
    return d.toISOString().split('T')[0];
}

function normalizeAttendanceState(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'in' || raw === 'checked-in' || raw === 'check-in') return 'in';
    if (raw === 'out' || raw === 'checked-out' || raw === 'check-out') return 'out';
    return '';
}

function isOpenTask(row = {}) {
    const status = normalizeTaskStatus(
        {
            status: row.status,
            completedDate: row.completedDate,
            completedAt: row.completedAt,
            completed_on: row.completed_on,
            postponedFromDate: row.postponedFromDate,
            addedFrom: row.addedFrom
        },
        row.date,
        null
    );
    return OPEN_STATUSES.has(status);
}

function getLineageKey(row = {}) {
    const sourcePlanId = String(row.sourcePlanId || row.carriedForwardFromPlanId || '').trim();
    const sourceTaskIndex = Number.isInteger(row.sourceTaskIndex) ? row.sourceTaskIndex : Number(row.sourceTaskIndex);
    if (sourcePlanId && Number.isInteger(sourceTaskIndex)) {
        return `${sourcePlanId}::${sourceTaskIndex}`;
    }
    if (String(row.carryForwardRootId || '').trim()) {
        return String(row.carryForwardRootId).trim();
    }
    if (String(row.planId || '').trim() && Number.isInteger(row.taskIndex)) {
        return `${String(row.planId).trim()}::${row.taskIndex}`;
    }
    return '';
}

function toPlanRowKey(row = {}) {
    return getLineageKey(row) || `${String(row.planId || '').trim()}::${Number.isInteger(row.taskIndex) ? row.taskIndex : ''}`;
}

function cloneTags(tags = []) {
    return Array.isArray(tags) ? tags.map((tag) => (tag && typeof tag === 'object' ? { ...tag } : tag)) : [];
}

function buildShiftedTask(sourceTask = {}, action = {}, nowIso = new Date().toISOString()) {
    const baseTask = {
        ...sourceTask,
        sourcePlanId: action.sourcePlanId,
        sourceTaskIndex: action.sourceTaskIndex,
        budgetHeadId: String(sourceTask.budgetHeadId || action.budgetHeadId || 'UNALLOCATED'),
        tags: cloneTags(sourceTask.tags || action.tags || []),
        assignedTo: action.userId || sourceTask.assignedTo || null,
        assignedToName: action.userName || sourceTask.assignedToName || ''
    };

    delete baseTask.completedDate;
    delete baseTask.completedAt;
    delete baseTask.completed_on;
    delete baseTask.removedAt;
    delete baseTask.removedBy;
    baseTask.isRemoved = false;
    baseTask.updatedAt = nowIso;

    if (action.mode === 'carry-forward') {
        const preservedStatus = normalizeTaskStatus(baseTask, action.targetDate, null);
        baseTask.startDate = action.targetDate;
        baseTask.endDate = action.targetDate;
        baseTask.addedFrom = 'carry-forward';
        baseTask.carriedForwardFromDate = action.sourceDate;
        baseTask.carriedForwardFromPlanId = action.sourcePlanId;
        if (!baseTask.carryForwardRootId) {
            baseTask.carryForwardRootId = action.lineageKey || `${action.sourcePlanId}::${action.sourceTaskIndex}`;
        }
        baseTask.isAutoForwarded = true;
        baseTask.carryForwardPolicy = 'next_day_only';
        if (preservedStatus !== 'in-process') {
            baseTask.status = '';
        } else {
            baseTask.status = 'in-process';
        }
        delete baseTask.postponedFromDate;
    } else if (action.mode === 'postpone') {
        baseTask.startDate = action.targetDate;
        baseTask.endDate = action.targetDate;
        baseTask.addedFrom = 'postponed';
        baseTask.postponedFromDate = action.sourceDate;
        baseTask.status = 'postponed';
    }

    return baseTask;
}

function buildShiftActions(rows = [], users = [], pivotDate = '') {
    const safePivotDate = normalizeIsoDate(pivotDate) || normalizeIsoDate(new Date().toISOString().split('T')[0]);
    const previousDate = addDays(safePivotDate, -1);
    const nextDate = addDays(safePivotDate, 1);
    const userStateById = new Map((Array.isArray(users) ? users : []).map((user) => [String(user?.id || '').trim(), normalizeAttendanceState(user?.status)]));
    const sourceRows = Array.isArray(rows) ? rows : [];
    const targetKeySets = new Map([
        [safePivotDate, new Set()],
        [nextDate, new Set()]
    ]);

    sourceRows.forEach((row) => {
        if (!row || row.type !== 'work') return;
        const rowDate = normalizeIsoDate(row.date);
        if (rowDate !== safePivotDate && rowDate !== nextDate) return;
        const key = toPlanRowKey(row);
        if (!key) return;
        if (!targetKeySets.has(rowDate)) targetKeySets.set(rowDate, new Set());
        targetKeySets.get(rowDate).add(key);
    });

    const summary = {
        movedToToday: 0,
        postponedToTomorrow: 0,
        skipped: 0,
        skippedByState: {
            in: 0,
            out: 0,
            unknown: 0
        }
    };

    const actions = [];

    sourceRows.forEach((row) => {
        if (!row || row.type !== 'work' || !row.planId || !Number.isInteger(row.taskIndex)) {
            summary.skipped += 1;
            summary.skippedByState.unknown += 1;
            return;
        }

        const userState = userStateById.get(String(row.userId || '').trim()) || '';
        const rowDate = normalizeIsoDate(row.date);
        const lineageKey = getLineageKey(row);
        const rowKey = toPlanRowKey(row);
        const status = normalizeTaskStatus(
            {
                status: row.status,
                completedDate: row.completedDate,
                completedAt: row.completedAt,
                completed_on: row.completed_on,
                postponedFromDate: row.postponedFromDate,
                addedFrom: row.addedFrom
            },
            row.date,
            null
        );

        if (!userState) {
            summary.skipped += 1;
            summary.skippedByState.unknown += 1;
            return;
        }

        if (!isOpenTask(row)) {
            summary.skipped += 1;
            summary.skippedByState[userState] += 1;
            return;
        }

        if (userState === 'in') {
            if (!rowDate || rowDate >= safePivotDate) {
                summary.skipped += 1;
                summary.skippedByState.in += 1;
                return;
            }
            if (lineageKey && targetKeySets.get(safePivotDate)?.has(lineageKey)) {
                summary.skipped += 1;
                summary.skippedByState.in += 1;
                return;
            }
            actions.push({
                mode: 'carry-forward',
                userState,
                sourceDate: rowDate,
                targetDate: safePivotDate,
                sourcePlanId: String(row.planId).trim(),
                sourceTaskIndex: row.taskIndex,
                planScope: row.planScope || 'personal',
                userId: String(row.userId || '').trim(),
                userName: row.staffName || row.userName || '',
                budgetHeadId: row.budgetHeadId || 'UNALLOCATED',
                tags: cloneTags(row.tags || []),
                lineageKey,
                rowKey,
                status
            });
            summary.movedToToday += 1;
            return;
        }

        if (userState === 'out') {
            if (!rowDate || rowDate > safePivotDate) {
                summary.skipped += 1;
                summary.skippedByState.out += 1;
                return;
            }
            const outTargetDate = nextDate;
            if (lineageKey && targetKeySets.get(outTargetDate)?.has(lineageKey)) {
                summary.skipped += 1;
                summary.skippedByState.out += 1;
                return;
            }
            actions.push({
                mode: 'postpone',
                userState,
                sourceDate: rowDate,
                targetDate: outTargetDate,
                sourcePlanId: String(row.planId).trim(),
                sourceTaskIndex: row.taskIndex,
                planScope: row.planScope || 'personal',
                userId: String(row.userId || '').trim(),
                userName: row.staffName || row.userName || '',
                budgetHeadId: row.budgetHeadId || 'UNALLOCATED',
                tags: cloneTags(row.tags || []),
                lineageKey,
                rowKey,
                status
            });
            summary.postponedToTomorrow += 1;
            return;
        }

        summary.skipped += 1;
        summary.skippedByState.unknown += 1;
    });

    return {
        pivotDate: safePivotDate,
        previousDate,
        nextDate,
        actions,
        summary
    };
}

export function buildTeamActivitiesBulkShiftPlan(options = {}) {
    return buildShiftActions(options.rows || [], options.users || [], options.pivotDate || '');
}

function ensurePlanShape(plan = {}, date, userId, userName, planScope, currentUser = null, nowIso = new Date().toISOString()) {
    const normalizedScope = String(planScope || 'personal').toLowerCase() === 'annual' ? 'annual' : 'personal';
    return {
        ...plan,
        id: plan.id || (normalizedScope === 'annual' ? `plan_annual_${date}` : `plan_${userId}_${date}`),
        userId: plan.userId || (normalizedScope === 'annual' ? 'annual_shared' : userId),
        userName: plan.userName || (normalizedScope === 'annual' ? 'All Staff' : (userName || 'Staff')),
        date: plan.date || date,
        planScope: plan.planScope || normalizedScope,
        plans: Array.isArray(plan.plans) ? [...plan.plans] : [],
        createdById: plan.createdById || currentUser?.id || '',
        createdByName: plan.createdByName || currentUser?.name || 'System',
        updatedAt: nowIso
    };
}

function upsertTargetTask(targetPlan, nextTask, action) {
    if (!Array.isArray(targetPlan.plans)) targetPlan.plans = [];
    const existingIndex = targetPlan.plans.findIndex((task) => {
        return String(task?.sourcePlanId || '').trim() === String(action.sourcePlanId || '').trim()
            && Number(task?.sourceTaskIndex) === Number(action.sourceTaskIndex)
            && String(task?.addedFrom || '').trim() === String(nextTask.addedFrom || '').trim();
    });
    if (existingIndex >= 0) {
        targetPlan.plans[existingIndex] = nextTask;
    } else {
        targetPlan.plans.push(nextTask);
    }
}

export async function applyTeamActivitiesBulkShift({
    rows = [],
    users = [],
    pivotDate = '',
    db = null,
    calendar = null,
    currentUser = null,
    nowIso = new Date().toISOString()
} = {}) {
    if (!db || !calendar || typeof db.get !== 'function' || typeof db.put !== 'function' || typeof calendar.getWorkPlanId !== 'function') {
        throw new Error('Bulk shift dependencies are unavailable.');
    }

    const plan = buildTeamActivitiesBulkShiftPlan({ rows, users, pivotDate });
    const { actions, summary } = plan;
    if (!actions.length) {
        return { ...summary, applied: 0, plan };
    }

    const sourceGroups = new Map();
    actions.forEach((action) => {
        if (!sourceGroups.has(action.sourcePlanId)) sourceGroups.set(action.sourcePlanId, []);
        sourceGroups.get(action.sourcePlanId).push(action);
    });

    const extractPlanDate = (planId = '') => {
        const match = String(planId || '').match(/(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : '';
    };

    const targetPlans = new Map();
    let applied = 0;

    const loadTargetPlan = async (action, fallbackName) => {
        const scope = typeof calendar.normalizePlanScope === 'function'
            ? calendar.normalizePlanScope(action.planScope || 'personal')
            : (String(action.planScope || 'personal').toLowerCase() === 'annual' ? 'annual' : 'personal');
        const targetUserId = scope === 'annual' ? 'annual_shared' : action.userId;
        const targetPlanId = calendar.getWorkPlanId(action.targetDate, targetUserId, scope);
        if (targetPlans.has(targetPlanId)) return targetPlans.get(targetPlanId);

        const existing = await db.get('work_plans', targetPlanId).catch(() => null);
        const next = ensurePlanShape(existing || {}, action.targetDate, action.userId, fallbackName, scope, currentUser, nowIso);
        targetPlans.set(targetPlanId, next);
        return next;
    };

    const sourceGroupsOrdered = Array.from(sourceGroups.entries()).sort((a, b) => {
        const dateB = extractPlanDate(b[0]);
        const dateA = extractPlanDate(a[0]);
        return dateB.localeCompare(dateA) || String(b[0]).localeCompare(String(a[0]));
    });

    for (const [sourcePlanId, groupedActions] of sourceGroupsOrdered) {
        const sourcePlan = await db.get('work_plans', sourcePlanId).catch(() => null);
        if (!sourcePlan || !Array.isArray(sourcePlan.plans)) continue;

        const sortedActions = [...groupedActions].sort((a, b) => Number(b.sourceTaskIndex) - Number(a.sourceTaskIndex));
        const removed = [];
        for (const action of sortedActions) {
            const sourceTask = sourcePlan.plans[action.sourceTaskIndex];
            if (!sourceTask) continue;
            const [spliced] = sourcePlan.plans.splice(action.sourceTaskIndex, 1);
            if (!spliced) continue;
            removed.push({ action, sourceTask: spliced });
            applied += 1;
        }

        if (removed.length > 0) {
            sourcePlan.updatedAt = nowIso;
            await db.put('work_plans', sourcePlan);
        }

        for (const { action, sourceTask } of removed) {
            const fallbackName = action.userName || sourcePlan.userName || '';
            const targetPlan = await loadTargetPlan(action, fallbackName);
            const nextTask = buildShiftedTask(sourceTask, action, nowIso);
            upsertTargetTask(targetPlan, nextTask, action);
        }
    }

    for (const targetPlan of targetPlans.values()) {
        targetPlan.updatedAt = nowIso;
        await db.put('work_plans', targetPlan);
    }

    return {
        ...summary,
        applied,
        plan
    };
}
