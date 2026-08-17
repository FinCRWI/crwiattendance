import { AppDB } from './db.js';
import { AppConfig } from '../config.js';
import { AppAuth } from './auth.js';
import { AppRating } from './rating.js';

/**
 * Calendar Module
 * Handles Yearly Planning, Events, and Shared Schedules.
 */
export class Calendar {
    constructor() {
        this.db = AppDB;
        this._carryForwardRangeCache = new Map();
        this._carryForwardCleanupCache = new Map();
        this._carryForwardExceptionCache = new Map();
        this._plansCache = new Map();
        this._collaborationsCache = new Map();
        this._carryForwardCacheVersion = 0;
        if (typeof window !== 'undefined' && window.addEventListener && !window.__calendarCacheBound) {
            window.addEventListener('app:db-write', (event) => {
                const collection = String(event?.detail?.collection || '');
                if (['work_plans', 'leaves', 'events', 'users'].includes(collection)) {
                    this._plansCache.clear();
                    this._collaborationsCache.clear();
                }
            });
            window.__calendarCacheBound = true;
        }
    }

    invalidateCarryForwardCache() {
        this._carryForwardRangeCache.clear();
        this._carryForwardCleanupCache.clear();
        this._carryForwardExceptionCache = new Map();
        this._carryForwardCacheVersion += 1;
    }

    getTodayKey() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    normalizePlanScope(scope) {
        return String(scope || '').toLowerCase() === 'annual' ? 'annual' : 'personal';
    }

    normalizeTaskStatus(status) {
        const key = String(status || '').trim().toLowerCase();
        if (key === 'in-progress') return 'in-process';
        if (key === 'postponed' || key === 'postpone') return 'not-completed';
        return key;
    }

    getTaskRootId(task = {}, planId = '', taskIndex = 0) {
        if (task.carryForwardRootId) return String(task.carryForwardRootId);
        if (task.sourcePlanId && Number.isInteger(task.sourceTaskIndex)) {
            return `${task.sourcePlanId}::${task.sourceTaskIndex}`;
        }
        return `${planId}::${taskIndex}`;
    }

    sanitizePlanTasks(tasks = []) {
        return (Array.isArray(tasks) ? tasks : []).filter(task => task && task.isRemoved !== true);
    }

    isTaskClosed(task = {}, planDate = '') {
        if (!task || task.isRemoved === true) return true;
        const status = this.normalizeTaskStatus(task.status);
        if (status === 'completed' || status === 'not-completed' || status === 'cancelled' || status === 'postponed') return true;
        const smartStatus = this.getSmartTaskStatus(planDate || task.startDate || '', status || null);
        return smartStatus === 'completed' || smartStatus === 'not-completed';
    }

    cloneTaskForDate(task = {}, targetDate, rootId, sourcePlan = {}, targetUserId = null, targetUserName = '') {
        const cloned = {
            ...task,
            startDate: targetDate,
            endDate: targetDate,
            carryForwardRootId: rootId,
            carriedForwardFromDate: sourcePlan.date || task.startDate || '',
            carriedForwardFromPlanId: sourcePlan.id || task.carriedForwardFromPlanId || null,
            autoForwardedAt: new Date().toISOString(),
            isAutoForwarded: true,
            carryForwardPolicy: 'next_day_only',
            carryForwardReason: sourcePlan.carryForwardReason || task.carryForwardReason || '',
            assignedTo: targetUserId || sourcePlan.targetUserId || task.assignedTo || null,
            assignedToName: targetUserName || sourcePlan.targetUserName || task.assignedToName || ''
        };
        if (this.normalizeTaskStatus(cloned.status) !== 'in-process') {
            cloned.status = '';
        }
        delete cloned.completedDate;
        delete cloned.removedAt;
        delete cloned.removedBy;
        cloned.isRemoved = false;
        return cloned;
    }

    async getAllWorkPlansUntil(endDate, userId = null) {
        if (this.db.queryMany) {
            const filters = [{ field: 'date', operator: '<=', value: endDate }];
            if (userId) {
                filters.push({ field: 'userId', operator: '==', value: userId });
            }
            return this.db.queryMany('work_plans', filters).catch((err) => {
                console.warn('getAllWorkPlansUntil failed, skipping work_plans fallback read:', err);
                return [];
            });
        }
        return [];
    }

    buildDateRange(startDate, endDate) {
        const start = new Date(`${startDate}T00:00:00`);
        const end = new Date(`${endDate}T00:00:00`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
        const dates = [];
        const cursor = new Date(start);
        while (cursor <= end) {
            dates.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`);
            cursor.setDate(cursor.getDate() + 1);
        }
        return dates;
    }

    getPreviousDateKey(dateStr) {
        const date = new Date(`${String(dateStr || '').trim()}T00:00:00`);
        if (Number.isNaN(date.getTime())) return '';
        date.setDate(date.getDate() - 1);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    isImmediateNextDay(fromDate, toDate) {
        const safeFromDate = String(fromDate || '').trim();
        const safeToDate = String(toDate || '').trim();
        if (!safeFromDate || !safeToDate) return false;
        return this.getPreviousDateKey(safeToDate) === safeFromDate;
    }

    async getCarryForwardExceptionReason(userId, date) {
        const safeUserId = String(userId || '').trim();
        const safeDate = String(date || '').trim();
        if (!safeUserId || !safeDate) return '';

        if (!this._carryForwardExceptionCache) this._carryForwardExceptionCache = new Map();
        const cacheKey = `${safeUserId}::${safeDate}`;
        if (this._carryForwardExceptionCache.has(cacheKey)) {
            return this._carryForwardExceptionCache.get(cacheKey);
        }

        let reason = '';

        const attendanceRaw = this.db.queryMany
            ? await this.db.queryMany('attendance', [
                { field: 'date', operator: '==', value: safeDate }
            ]).catch(() => this.db.getAll('attendance'))
            : await this.db.getAll('attendance');
        const dayAttendance = (attendanceRaw || []).filter((row) => {
            const rowUserId = String(row?.user_id || row?.userId || '').trim();
            return row && rowUserId === safeUserId && String(row.date || '') === safeDate;
        });
        if (dayAttendance.some((row) => String(row.autoCheckoutReason || '').trim() === 'missed_checkout_next_login')) {
            reason = 'missed_checkout';
        }

        if (!reason) {
            const leavesRaw = this.db.queryMany
                ? await this.db.queryMany('leaves', [
                    { field: 'status', operator: '==', value: 'Approved' }
                ]).catch(() => this.db.getAll('leaves'))
                : await this.db.getAll('leaves');
            const hasApprovedLeave = (leavesRaw || []).some((leave) => {
                if (!leave) return false;
                const leaveUserId = String(leave.userId || leave.user_id || '').trim();
                if (leaveUserId !== safeUserId) return false;
                if (String(leave.status || '') !== 'Approved') return false;
                const start = String(leave.startDate || '').trim();
                const end = String(leave.endDate || '').trim();
                if (!start || !end) return false;
                return start <= safeDate && safeDate <= end;
            });
            if (hasApprovedLeave) reason = 'leave_day';
        }

        this._carryForwardExceptionCache.set(cacheKey, reason);
        return reason;
    }

    async isCarryForwardExceptionDay(userId, date) {
        return !!(await this.getCarryForwardExceptionReason(userId, date));
    }

    async isEligibleNextDayCarryTask(task = {}, fromDate, toDate, userId) {
        if (!task || task.isRemoved === true) return false;
        if (!this.isImmediateNextDay(fromDate, toDate)) return false;
        if (this.isTaskClosed(task, fromDate)) return false;
        return this.isCarryForwardExceptionDay(userId, fromDate);
    }

    async ensureCarryForwardForRange(startDate, endDate, options = {}) {
        const safeEndDate = String(endDate || '').trim();
        if (!safeEndDate) return { created: 0, updatedPlans: [] };
        const todayKey = this.getTodayKey();
        const effectiveEndDate = safeEndDate > todayKey ? todayKey : safeEndDate;
        const safeStartDate = String(startDate || effectiveEndDate).trim() || effectiveEndDate;
        if (safeStartDate > effectiveEndDate) return { created: 0, updatedPlans: [] };

        const targetUserIds = Array.isArray(options.userIds)
            ? options.userIds.map(v => String(v || '').trim()).filter(Boolean)
            : null;
        const cacheKey = JSON.stringify({
            version: this._carryForwardCacheVersion,
            startDate: safeStartDate,
            endDate: effectiveEndDate,
            userIds: targetUserIds || []
        });
        const cached = this._carryForwardRangeCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }
        this._carryForwardExceptionCache = new Map();

        // When targeting specific users, filter at the query level to avoid loading all plans
        const carryUserId = targetUserIds && targetUserIds.length === 1 ? targetUserIds[0] : null;
        const allPlans = (await this.getAllWorkPlansUntil(effectiveEndDate, carryUserId))
            .filter(plan => !!plan && !!plan.date && plan.date <= effectiveEndDate);

        const groups = new Map();
        const upsertGroupPlan = (plan, scope, ownerKey) => {
            const groupKey = `${scope}::${ownerKey}`;
            if (!groups.has(groupKey)) groups.set(groupKey, new Map());
            groups.get(groupKey).set(plan.date, {
                ...plan,
                planScope: scope,
                plans: Array.isArray(plan.plans) ? [...plan.plans] : []
            });
        };

        allPlans.forEach((plan) => {
            const scope = this.normalizePlanScope(plan.planScope);
            if (scope !== 'personal') return;
            const ownerKey = String(plan.userId || '').trim();
            if (!ownerKey || ownerKey === 'annual_shared') return;
            if (targetUserIds && !targetUserIds.includes(ownerKey)) return;
            upsertGroupPlan(plan, 'personal', ownerKey);
        });

        const updatedPlans = [];

        for (const [groupKey, plansByDate] of groups.entries()) {
            const [scope, ownerKey] = groupKey.split('::');
            const dateKeys = this.buildDateRange(safeStartDate, effectiveEndDate);

            for (const dateKey of dateKeys) {
                let dayPlan = plansByDate.get(dateKey) || null;
                const existingTasks = dayPlan && Array.isArray(dayPlan.plans) ? [...dayPlan.plans] : [];
                const rootsInCurrentPlan = new Set();

                existingTasks.forEach((task, idx) => {
                    rootsInCurrentPlan.add(this.getTaskRootId(task, dayPlan?.id || this.getWorkPlanId(dateKey, ownerKey, scope), idx));
                });

                const carryTasks = [];
                const previousDate = this.getPreviousDateKey(dateKey);
                const previousPlan = previousDate ? plansByDate.get(previousDate) : null;
                const carryReason = previousDate
                    ? await this.getCarryForwardExceptionReason(ownerKey, previousDate)
                    : '';
                const previousTasks = previousPlan && Array.isArray(previousPlan.plans) ? previousPlan.plans : [];
                if (carryReason && previousPlan && previousTasks.length > 0) {
                    for (let idx = 0; idx < previousTasks.length; idx += 1) {
                        const task = previousTasks[idx];
                        if (!await this.isEligibleNextDayCarryTask(task, previousDate, dateKey, ownerKey)) continue;
                        const rootId = this.getTaskRootId(task, previousPlan.id, idx);
                        if (rootsInCurrentPlan.has(rootId)) continue;
                        carryTasks.push(this.cloneTaskForDate(task, dateKey, rootId, {
                            id: previousPlan.id,
                            date: previousPlan.date,
                            sourceTaskIndex: idx,
                            carryForwardReason: carryReason,
                            targetUserId: ownerKey,
                            targetUserName: dayPlan?.userName || previousPlan?.userName || ''
                        }, ownerKey, dayPlan?.userName || previousPlan?.userName || ''));
                        rootsInCurrentPlan.add(rootId);
                    }
                }

                if (carryTasks.length > 0) {
                    const firstCarrySource = carryTasks[0];
                    const fallbackName = firstCarrySource?.assignedToName || previousPlan?.userName || '';
                    if (!dayPlan) {
                        dayPlan = {
                            id: this.getWorkPlanId(dateKey, ownerKey, scope),
                            userId: ownerKey,
                            userName: fallbackName,
                            date: dateKey,
                            plans: [],
                            planScope: scope
                        };
                    }
                    dayPlan.plans = [...existingTasks, ...carryTasks];
                    dayPlan.updatedAt = new Date().toISOString();
                    await this.db.put('work_plans', dayPlan);
                    plansByDate.set(dateKey, dayPlan);
                    updatedPlans.push(dayPlan.id);
                }
            }
        }

        const result = {
            created: updatedPlans.length,
            updatedPlans
        };
        this._carryForwardRangeCache.set(cacheKey, {
            value: result,
            expiresAt: Date.now() + 10000
        });
        return result;
    }

    async ensureCarryForwardForDate(date, options = {}) {
        const targetDate = String(date || '').trim();
        if (!targetDate) return { created: 0, updatedPlans: [] };
        return this.ensureCarryForwardForRange(targetDate, targetDate, options);
    }

    getWorkPlanId(date, targetUserId = null, planScope = 'personal') {
        const scope = this.normalizePlanScope(planScope);
        if (scope === 'annual') return `plan_annual_${date}`;
        return `plan_${targetUserId}_${date}`;
    }

    /**
     * Get all plans (approved leaves, company events, and work plans)
     */
    async getPlans() {
        try {
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().split('T')[0];
            const end = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString().split('T')[0];
            const cacheKey = `calendarPlans:${start}:${end}`;
            const cached = this._plansCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) {
                return cached.value;
            }
            const [leaves, events, workPlans, users] = await Promise.all([
                this.db.getAll('leaves'),
                this.db.getAll('events').catch(() => []),
                this.db.queryMany
                    ? this.db.queryMany('work_plans', [
                        { field: 'date', operator: '>=', value: start },
                        { field: 'date', operator: '<=', value: end }
                    ]).catch((err) => {
                        console.warn('getPlans work_plans query failed:', err);
                        return [];
                    })
                    : [],
                this.db.getCached
                    ? this.db.getCached(this.db.getCacheKey('calendarUsers', 'users', {}), (AppConfig?.READ_CACHE_TTLS?.users || 60000), () => this.db.getAll('users')).catch(() => [])
                    : this.db.getAll('users').catch(() => [])
            ]);

            // Map User IDs to Names for Leaves
            const userMap = {};
            users.forEach(u => { userMap[u.id] = u.name; });

            const enrichedLeaves = (leaves || [])
                .filter(l => l.status === 'Approved')
                .map(l => ({
                    ...l,
                    userName: l.userName || userMap[l.userId] || 'Staff'
                }));

            const dedupedEvents = (() => {
                const unique = new Map();
                (events || []).forEach((e) => {
                    const key = [
                        String(e.date || '').trim(),
                        String(e.title || '').trim().toLowerCase(),
                        String(e.type || 'event').trim().toLowerCase(),
                        String(e.createdById || e.createdByName || '').trim().toLowerCase()
                    ].join('|');
                    if (!unique.has(key)) unique.set(key, e);
                });
                return Array.from(unique.values());
            })();

            const normalizedWorkPlans = (workPlans || [])
                .map((plan) => ({
                    ...plan,
                    plans: this.sanitizePlanTasks(plan.plans)
                }))
                .filter((plan) => plan.plans.length > 0);

            const result = {
                leaves: enrichedLeaves,
                events: dedupedEvents,
                workPlans: normalizedWorkPlans
            };
            this._plansCache.set(cacheKey, {
                value: result,
                expiresAt: Date.now() + 60000
            });
            return result;
        } catch (err) {
            console.error("Failed to fetch calendar plans:", err);
            return { leaves: [], events: [], workPlans: [] };
        }
    }

    /**
     * Set/Add a work plan for a specific day
     * Updated to handle multiple plans and tagged coworkers
     */
    async setWorkPlan(date, plans = [], targetUserId = null, options = {}) {
        const currentUser = AppAuth.getUser();
        if (!currentUser) throw new Error("Not authenticated");

        const targetId = targetUserId || currentUser.id;

        // Support planScope as an array to batch personal + annual writes in parallel.
        const scopes = Array.isArray(options.planScope) ? options.planScope : [options.planScope || 'personal'];

        const targetUser = targetId === currentUser.id
            ? currentUser
            : await this.db.get('users', targetId);

        if (!targetUser) {
            console.error("setWorkPlan Error: Target user not found", { targetId, currentUser });
            throw new Error("Target user not found");
        }

        // Build one document per scope and write them in parallel.
        // Each scope only gets plans that match its scope (prevents data leak).
        const writePromises = scopes.map((scope) => {
            const normalizedScope = this.normalizePlanScope(scope);
            const scopedPlans = Array.isArray(plans)
                ? plans.filter(p => p.planScope === normalizedScope)
                : [];
            const workPlan = {
                id: this.getWorkPlanId(date, targetId, normalizedScope),
                userId: normalizedScope === 'annual' ? 'annual_shared' : targetId,
                userName: normalizedScope === 'annual' ? 'All Staff' : targetUser.name,
                date: date,
                plans: scopedPlans,
                planScope: normalizedScope,
                createdById: currentUser.id,
                createdByName: currentUser.name || 'Admin',
                updatedAt: new Date().toISOString()
            };
            return this.db.put('work_plans', workPlan);
        });

        const saved = await Promise.all(writePromises);
        if (!options.skipCacheInvalidation) this.invalidateCarryForwardCache();
        return saved;
    }

    /**
     * Add a single task to a user's work plan for a specific date
     * Used by Meeting Minutes to assign action items
     */
    async addWorkPlanTask(date, userId, taskDescription, tags = [], meta = {}) {
        let workPlan = await this.getWorkPlan(userId, date);

        // Create if not exists
        if (!workPlan) {
            const currentUser = AppAuth.getUser();
            const targetUser = userId === currentUser?.id
                ? currentUser
                : await this.db.get('users', userId);
            if (!targetUser) throw new Error("Target user not found");

            workPlan = {
                id: `plan_${userId}_${date}`,
                userId: userId,
                userName: targetUser.name,
                date: date,
                plans: [],
                updatedAt: new Date().toISOString()
            };
        }

        // Add the task
        if (!workPlan.plans) workPlan.plans = [];
        workPlan.plans = this.sanitizePlanTasks(workPlan.plans);

        if (meta.sourcePlanId !== undefined && meta.sourceTaskIndex !== undefined && meta.sourcePlanId !== null) {
            const existing = workPlan.plans.find(p =>
                p.sourcePlanId === meta.sourcePlanId &&
                p.sourceTaskIndex === meta.sourceTaskIndex &&
                p.addedFrom === (meta.addedFrom || 'minutes')
            );
            if (existing) {
                existing.task = taskDescription;
                existing.subPlans = meta.subPlans || existing.subPlans || [];
                existing.tags = tags;
                existing.status = meta.status || existing.status || 'pending';
                existing.budgetHeadId = String(meta.budgetHeadId || existing.budgetHeadId || 'UNALLOCATED');
                existing.startDate = meta.startDate || existing.startDate || date;
                existing.endDate = meta.endDate || existing.endDate || existing.startDate || date;
                existing.assignedTo = meta.assignedTo || existing.assignedTo || userId;
                existing.assignedToName = meta.assignedToName || existing.assignedToName || workPlan.userName || '';
                existing.addedFrom = meta.addedFrom || existing.addedFrom || 'minutes';
                existing.sourcePlanId = meta.sourcePlanId || existing.sourcePlanId || null;
                existing.sourceTaskIndex = meta.sourceTaskIndex ?? existing.sourceTaskIndex ?? null;
                existing.postponedFromDate = meta.postponedFromDate || existing.postponedFromDate || null;
                existing.postponedToDate = meta.postponedToDate || existing.postponedToDate || null;
                existing.postponedFromPlanId = meta.postponedFromPlanId || existing.postponedFromPlanId || null;
                existing.carriedForwardFromDate = meta.carriedForwardFromDate || existing.carriedForwardFromDate || null;
                existing.carriedForwardFromPlanId = meta.carriedForwardFromPlanId || existing.carriedForwardFromPlanId || null;
                existing.isAutoForwarded = meta.isAutoForwarded === true || existing.isAutoForwarded === true;
                existing.carryForwardPolicy = meta.carryForwardPolicy || existing.carryForwardPolicy || null;
                existing.carryForwardReason = meta.carryForwardReason || existing.carryForwardReason || null;
                existing.progressPercent = Number.isFinite(Number(meta.progressPercent)) ? Number(meta.progressPercent) : (existing.progressPercent ?? null);
                existing.progressStatus = meta.progressStatus || existing.progressStatus || null;
                existing.progressNote = meta.progressNote || existing.progressNote || null;
                existing.updatedAt = new Date().toISOString();
                workPlan.updatedAt = new Date().toISOString();
                const saved = await this.db.put('work_plans', workPlan);
                this.invalidateCarryForwardCache();
                return saved;
            }
        }

        workPlan.plans.push({
            task: taskDescription,
            subPlans: meta.subPlans || [],
            tags: tags,
            status: meta.status || 'pending', // Default
            budgetHeadId: String(meta.budgetHeadId || 'UNALLOCATED'),
            startDate: meta.startDate || date,
            endDate: meta.endDate || meta.startDate || date,
            addedFrom: meta.addedFrom || 'minutes',
            sourcePlanId: meta.sourcePlanId || null,
            sourceTaskIndex: meta.sourceTaskIndex ?? null,
            taggedById: meta.taggedById || null,
            taggedByName: meta.taggedByName || null,
            assignedTo: meta.assignedTo || userId,
            assignedToName: meta.assignedToName || workPlan.userName || '',
            // Preserve postpone/carry-forward provenance so copies created here
            // keep their metadata (previously dropped silently).
            postponedFromDate: meta.postponedFromDate || null,
            postponedToDate: meta.postponedToDate || null,
            postponedFromPlanId: meta.postponedFromPlanId || null,
            carriedForwardFromDate: meta.carriedForwardFromDate || null,
            carriedForwardFromPlanId: meta.carriedForwardFromPlanId || null,
            isAutoForwarded: meta.isAutoForwarded === true,
            carryForwardPolicy: meta.carryForwardPolicy || null,
            carryForwardReason: meta.carryForwardReason || null,
            progressPercent: Number.isFinite(Number(meta.progressPercent)) ? Number(meta.progressPercent) : null,
            progressStatus: meta.progressStatus || null,
            progressNote: meta.progressNote || null,
            completedDate: meta.completedDate || null
        });

        workPlan.updatedAt = new Date().toISOString();
        const saved = await this.db.put('work_plans', workPlan);
        this.invalidateCarryForwardCache();
        return saved;
    }

    extractDateFromPlanToken(token = '') {
        const raw = String(token || '').trim();
        const match = raw.match(/(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : '';
    }

    extractOwnerFromPlanToken(token = '') {
        const raw = String(token || '').trim();
        if (!raw) return '';
        if (raw.startsWith('plan_annual_')) return 'annual_shared';
        const match = raw.match(/^plan_([^_]+)_\d{4}-\d{2}-\d{2}/);
        return match ? match[1] : '';
    }

    resolveTaskOriginDate(task = {}) {
        const direct = String(task.carriedForwardFromDate || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;

        const fromRoot = this.extractDateFromPlanToken(task.carryForwardRootId);
        if (fromRoot) return fromRoot;

        const fromCarryPlan = this.extractDateFromPlanToken(task.carriedForwardFromPlanId);
        if (fromCarryPlan) return fromCarryPlan;

        const fromSource = this.extractDateFromPlanToken(task.sourcePlanId);
        if (fromSource) return fromSource;

        const start = String(task.startDate || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return start;

        const end = String(task.endDate || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(end)) return end;

        return '';
    }

    isTaggedCopyOriginTask(task = {}) {
        const addedFrom = String(task.addedFrom || '').toLowerCase().trim();
        const fromTaggedSource = addedFrom === 'tag' || addedFrom === 'delegated' || addedFrom === 'staff';
        const hasSourceReference = !!task.sourcePlanId
            || Number.isInteger(task.sourceTaskIndex)
            || Number.isFinite(Number(task.sourceTaskIndex));
        return fromTaggedSource || hasSourceReference;
    }

    hasLegacyTaggedTextPattern(task = {}) {
        const text = String(task.task || '');
        if (!text) return false;
        const repeatedResponsible = (text.match(/\(Responsible:/gi) || []).length > 1;
        return repeatedResponsible;
    }

    hasResponsibleMarker(task = {}) {
        const text = String(task.task || '');
        return /\((Responsible|Assigned to):/i.test(text);
    }

    normalizeTaskForStaleCompare(taskText = '') {
        return String(taskText || '')
            .replace(/\s*\((Responsible|Assigned to):[^)]*\)\s*/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    hasCarryForwardLineage(task = {}) {
        return !!(
            task.carryForwardRootId
            || task.isAutoForwarded === true
            || task.carriedForwardFromDate
            || task.carriedForwardFromPlanId
        );
    }

    async findCarryForwardIssues(options = {}) {
        const includeAssignedMismatch = options.includeAssignedMismatch === true;
        const plans = await this.db.getAll('work_plans');
        const issues = [];

        (plans || []).forEach((plan) => {
            if (!plan || this.normalizePlanScope(plan.planScope) !== 'personal') return;
            const planOwner = String(plan.userId || '').trim();
            if (!planOwner || !Array.isArray(plan.plans) || plan.plans.length === 0) return;

            plan.plans.forEach((task, idx) => {
                if (!task || task.isRemoved === true) return;
                if (!this.hasCarryForwardLineage(task)) return;

                const rootToken = String(
                    task.carryForwardRootId
                    || task.carriedForwardFromPlanId
                    || task.sourcePlanId
                    || ''
                ).trim();
                const rootOwner = this.extractOwnerFromPlanToken(rootToken);
                const assignedTo = String(task.assignedTo || '').trim();
                const ownerMismatch = !!(rootOwner && planOwner && rootOwner !== planOwner);
                const assignedMismatch = !!(assignedTo && planOwner && assignedTo !== planOwner);

                if (!ownerMismatch && !(includeAssignedMismatch && assignedMismatch)) return;

                issues.push({
                    planId: plan.id || '',
                    planDate: plan.date || '',
                    planUserId: planOwner,
                    planUserName: plan.userName || '',
                    taskIndex: idx,
                    taskText: task.task || '',
                    originDate: this.resolveTaskOriginDate(task),
                    rootToken,
                    rootOwner,
                    assignedTo,
                    isAutoForwarded: task.isAutoForwarded === true,
                    carryForwardReason: String(task.carryForwardReason || '').trim(),
                    ownerMismatch,
                    assignedMismatch
                });
            });
        });

        issues.sort((a, b) => {
            const dateDiff = String(b.planDate || '').localeCompare(String(a.planDate || ''));
            if (dateDiff) return dateDiff;
            return String(a.planUserName || '').localeCompare(String(b.planUserName || ''));
        });

        return issues;
    }

    async cleanupInvalidTodayCarryForward(userId, date, options = {}) {
        const targetUserId = String(userId || '').trim();
        const targetDate = String(date || '').trim();
        if (!targetUserId || !targetDate) {
            return { ok: false, removed: 0, reason: 'invalid_input' };
        }

        const onlyToday = options.onlyToday !== false;
        const todayKey = this.getTodayKey();
        if (onlyToday && targetDate !== todayKey) {
            return { ok: true, removed: 0, reason: 'not_today' };
        }

        const cacheKey = JSON.stringify({
            version: this._carryForwardCacheVersion,
            targetUserId,
            targetDate,
            onlyToday
        });
        const cached = this._carryForwardCleanupCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }

        const previousDate = this.getPreviousDateKey(targetDate);
        const personalPlan = await this.getWorkPlan(targetUserId, targetDate, { planScope: 'personal' });
        if (!personalPlan || !Array.isArray(personalPlan.plans) || personalPlan.plans.length === 0) {
            return { ok: true, removed: 0, reason: 'no_plan' };
        }

        const kept = [];
        let removed = 0;
        for (const task of personalPlan.plans) {
            if (!task || task.isRemoved === true) {
                kept.push(task);
                continue;
            }
            if (this.isTaskClosed(task, targetDate)) {
                kept.push(task);
                continue;
            }

            const hasLineage = this.hasCarryForwardLineage(task);
            const originDate = this.resolveTaskOriginDate(task);
            let invalid = false;

            if (originDate && originDate < previousDate) {
                invalid = true;
            } else if (hasLineage) {
                if (!originDate || originDate !== previousDate) {
                    invalid = true;
                } else {
                    const eligible = await this.isEligibleNextDayCarryTask(task, originDate, targetDate, targetUserId);
                    const reason = await this.getCarryForwardExceptionReason(targetUserId, originDate);
                    const taskReason = String(task.carryForwardReason || '').trim();
                    const policy = String(task.carryForwardPolicy || '').trim();
                    if (!eligible) invalid = true;
                    if (!invalid && policy && policy !== 'next_day_only') invalid = true;
                    if (!invalid && reason && taskReason && taskReason !== reason) invalid = true;
                }
            }

            if (invalid) {
                removed += 1;
                continue;
            }
            kept.push(task);
        }

        if (removed === 0) {
            const result = { ok: true, removed: 0, reason: 'no_matches' };
            this._carryForwardCleanupCache.set(cacheKey, {
                value: result,
                expiresAt: Date.now() + 10000
            });
            return result;
        }

        personalPlan.plans = kept;
        personalPlan.updatedAt = new Date().toISOString();
        await this.db.put('work_plans', personalPlan);
        const result = { ok: true, removed, planId: personalPlan.id, date: targetDate };
        this.invalidateCarryForwardCache();
        this._carryForwardCleanupCache.set(cacheKey, {
            value: result,
            expiresAt: Date.now() + 10000
        });
        return result;
    }

    async cleanupInvalidTodayCarryForwardForDate(date, options = {}) {
        const targetDate = String(date || '').trim();
        if (!targetDate) return { ok: false, removed: 0, scannedPlans: 0, reason: 'invalid_date' };
        const onlyToday = options.onlyToday !== false;
        const todayKey = this.getTodayKey();
        if (onlyToday && targetDate !== todayKey) {
            return { ok: true, removed: 0, scannedPlans: 0, reason: 'not_today' };
        }

        const plans = this.db.queryMany
            ? await this.db.queryMany('work_plans', [{ field: 'date', operator: '==', value: targetDate }]).catch((err) => {
                console.warn('cleanupInvalidTodayCarryForwardForDate work_plans query failed:', err);
                return [];
            })
            : [];
        const dayPlans = (plans || []).filter((p) =>
            p
            && String(p.date || '') === targetDate
            && this.normalizePlanScope(p.planScope) === 'personal'
            && Array.isArray(p.plans)
            && p.plans.length > 0
        );

        let removed = 0;
        for (const plan of dayPlans) {
            const uid = String(plan.userId || '').trim();
            if (!uid) continue;
            const result = await this.cleanupInvalidTodayCarryForward(uid, targetDate, { onlyToday });
            removed += Number(result?.removed || 0);
        }
        return { ok: true, removed, scannedPlans: dayPlans.length, date: targetDate };
    }

    // Backward-compatible wrappers for existing callers.
    async cleanupOldCarryForwardTaggedTasks(userId, date, options = {}) {
        return this.cleanupInvalidTodayCarryForward(userId, date, options);
    }

    async cleanupOldCarryForwardTaggedTasksForDate(date, options = {}) {
        return this.cleanupInvalidTodayCarryForwardForDate(date, options);
    }

    /**
     * Delete a work plan for a specific day
     */
    async deleteWorkPlan(date, targetUserId = null, options = {}) {
        const currentUser = AppAuth.getUser();
        if (!currentUser) throw new Error("Not authenticated");
        const planScope = this.normalizePlanScope(options.planScope);
        const targetId = targetUserId || currentUser.id;
        const deleted = await this.db.delete('work_plans', this.getWorkPlanId(date, targetId, planScope));
        this.invalidateCarryForwardCache();
        return deleted;
    }

    async purgeWorkPlansByDate(date, options = {}) {
        const targetDate = String(date || '').trim();
        if (!targetDate) return { ok: false, removedPlans: 0, reason: 'invalid_date' };
        const scopes = Array.isArray(options.scopes) && options.scopes.length
            ? options.scopes.map(s => this.normalizePlanScope(s))
            : ['personal', 'annual'];
        const plans = this.db.queryMany
            ? await this.db.queryMany('work_plans', [{ field: 'date', operator: '==', value: targetDate }]).catch((err) => {
                console.warn('purgeWorkPlansByDate work_plans query failed:', err);
                return [];
            })
            : [];
        const dayPlans = (plans || []).filter((p) =>
            p
            && String(p.date || '') === targetDate
            && scopes.includes(this.normalizePlanScope(p.planScope))
            && Array.isArray(p.plans)
            && p.plans.length > 0
        );

        for (const plan of dayPlans) {
            plan.plans = [];
            plan.updatedAt = new Date().toISOString();
            await this.db.put('work_plans', plan);
        }
        this.invalidateCarryForwardCache();

        return { ok: true, removedPlans: dayPlans.length, date: targetDate };
    }

    async purgeCarriedForwardTasksByDate(date, options = {}) {
        const targetDate = String(date || '').trim();
        if (!targetDate) return { ok: false, removedTasks: 0, touchedPlans: 0, reason: 'invalid_date' };
        const scopes = Array.isArray(options.scopes) && options.scopes.length
            ? options.scopes.map(s => this.normalizePlanScope(s))
            : ['personal', 'annual'];
        const plans = this.db.queryMany
            ? await this.db.queryMany('work_plans', [{ field: 'date', operator: '==', value: targetDate }]).catch((err) => {
                console.warn('purgeCarriedForwardTasksByDate work_plans query failed:', err);
                return [];
            })
            : [];
        const dayPlans = (plans || []).filter((p) =>
            p
            && String(p.date || '') === targetDate
            && scopes.includes(this.normalizePlanScope(p.planScope))
            && Array.isArray(p.plans)
            && p.plans.length > 0
        );

        let removedTasks = 0;
        let touchedPlans = 0;
        for (const plan of dayPlans) {
            const before = plan.plans.length;
            plan.plans = plan.plans.filter((t) => !this.hasCarryForwardLineage(t));
            const after = plan.plans.length;
            if (after !== before) {
                removedTasks += (before - after);
                touchedPlans += 1;
                plan.updatedAt = new Date().toISOString();
                await this.db.put('work_plans', plan);
            }
        }
        if (removedTasks > 0) this.invalidateCarryForwardCache();

        return { ok: true, removedTasks, touchedPlans, date: targetDate };
    }

    /**
     * Get work plan for a specific day and user
     */
    async getWorkPlan(userId, date, options = {}) {
        const includeAnnual = !!options.includeAnnual;
        const mergeAnnual = !!options.mergeAnnual;
        const planScope = options.planScope ? this.normalizePlanScope(options.planScope) : null;
        const preferAnnual = !!options.preferAnnual;

        if (planScope) {
            const scopedPlan = await this.db.get('work_plans', this.getWorkPlanId(date, userId, planScope));
            return scopedPlan ? { ...scopedPlan, plans: this.sanitizePlanTasks(scopedPlan.plans) } : null;
        }

        const personalPlanRaw = await this.db.get('work_plans', this.getWorkPlanId(date, userId, 'personal'));
        const personalPlan = personalPlanRaw ? { ...personalPlanRaw, plans: this.sanitizePlanTasks(personalPlanRaw.plans) } : null;
        if (!includeAnnual) return personalPlan;

        const annualPlanRaw = await this.db.get('work_plans', this.getWorkPlanId(date, userId, 'annual'));
        const annualPlan = annualPlanRaw ? { ...annualPlanRaw, plans: this.sanitizePlanTasks(annualPlanRaw.plans) } : null;
        if (mergeAnnual && annualPlan && personalPlan) {
            const mergedPlans = [];
            (annualPlan.plans || []).forEach((task, idx) => {
                mergedPlans.push({
                    ...task,
                    _planId: annualPlan.id,
                    _taskIndex: idx,
                    _planDate: annualPlan.date,
                    _planScope: 'annual'
                });
            });
            (personalPlan.plans || []).forEach((task, idx) => {
                mergedPlans.push({
                    ...task,
                    _planId: personalPlan.id,
                    _taskIndex: idx,
                    _planDate: personalPlan.date,
                    _planScope: 'personal'
                });
            });
            return {
                id: `plan_merged_${userId}_${date}`,
                userId,
                userName: personalPlan.userName || 'Staff',
                date,
                planScope: 'mixed',
                plans: mergedPlans,
                personalPlanId: personalPlan.id,
                annualPlanId: annualPlan.id
            };
        }

        if (preferAnnual) return annualPlan || personalPlan;
        return personalPlan || annualPlan;
    }

    /**
     * Get smart task status based on date (uses AppRating if available)
     */
    getSmartTaskStatus(taskDate, currentStatus = null) {
        if (AppRating) {
            return AppRating.getSmartTaskStatus(taskDate, currentStatus);
        }
        // Fallback if rating module not loaded
        if (currentStatus === 'completed' || currentStatus === 'not-completed' || currentStatus === 'postponed') {
            return currentStatus;
        }
        const today = new Date().toISOString().split('T')[0];
        const taskDateStr = typeof taskDate === 'string' ? taskDate : taskDate.toISOString().split('T')[0];
        if (taskDateStr > today) return 'to-be-started';
        if (taskDateStr === today) return 'in-process';
        if (taskDateStr < today) return 'overdue';
        return 'in-process';
    }

    /**
     * Update task status (admin or user can mark completed/not-completed)
     */
    async updateTaskStatus(planId, taskIndex, newStatus, completedDate = null) {
        try {
            const plan = await this.db.get('work_plans', planId);
            if (!plan || !plan.plans || !plan.plans[taskIndex]) {
                throw new Error('Plan or task not found');
            }

            plan.plans[taskIndex].status = newStatus;
            if (newStatus === 'completed' && !plan.plans[taskIndex].completedDate) {
                plan.plans[taskIndex].completedDate = completedDate || new Date().toISOString().split('T')[0];
            }
            plan.updatedAt = new Date().toISOString();

            await this.db.put('work_plans', plan);
            this.invalidateCarryForwardCache();

            // Trigger rating recalculation
            if (AppRating) {
                await AppRating.updateUserRating(plan.userId);
            }

            return plan;
        } catch (err) {
            console.error('Failed to update task status:', err);
            throw err;
        }
    }

    async updateTaskLink(planId, taskIndex, link) {
        try {
            const plan = await this.db.get('work_plans', planId);
            if (!plan || !plan.plans || !plan.plans[taskIndex]) {
                throw new Error('Plan or task not found');
            }

            plan.plans[taskIndex].onedriveLink = link || '';
            plan.updatedAt = new Date().toISOString();

            await this.db.put('work_plans', plan);
            return plan;
        } catch (err) {
            console.error('Failed to update task link:', err);
            throw err;
        }
    }

    async addTaskComment(planId, taskIndex, text, authorName) {
        try {
            const plan = await this.db.get('work_plans', planId);
            if (!plan || !plan.plans || !plan.plans[taskIndex]) {
                throw new Error('Plan or task not found');
            }
            const task = plan.plans[taskIndex];
            if (!Array.isArray(task.comments)) task.comments = [];
            const comment = {
                text: String(text || '').trim(),
                author: authorName || 'Staff',
                ts: Date.now()
            };
            if (!comment.text) return task.comments;
            task.comments.push(comment);
            plan.updatedAt = new Date().toISOString();
            await this.db.put('work_plans', plan);
            return task.comments;
        } catch (err) {
            console.error('Failed to add task comment:', err);
            throw err;
        }
    }

    async updateTaskDate(planId, taskIndex, newDate) {
        try {
            const plan = await this.db.get('work_plans', planId);
            if (!plan || !plan.plans || !plan.plans[taskIndex]) {
                throw new Error('Plan or task not found');
            }

            const task = plan.plans[taskIndex];
            const oldDate = task.date || plan.date;
            const userId = plan.userId;

            // If the date didn't actually change, just return
            if (oldDate === newDate) {
                return plan;
            }

            // Remove task from old plan
            plan.plans.splice(taskIndex, 1);
            plan.updatedAt = new Date().toISOString();

            // If old plan is now empty, delete it; otherwise save
            if (plan.plans.length === 0) {
                await this.db.delete('work_plans', planId);
            } else {
                await this.db.put('work_plans', plan);
            }

            // Add task to new date's plan
            const newTask = {
                ...task,
                date: newDate,
                status: 'to-be-started',
                postponedFromDate: oldDate,
                postponedToDate: newDate
            };

            let newPlan = await this.getWorkPlan(userId, newDate);
            if (!newPlan) {
                const currentUser = AppAuth.getUser();
                const targetUser = userId === currentUser?.id
                    ? currentUser
                    : await this.db.get('users', userId);
                newPlan = {
                    id: `plan_${userId}_${newDate}`,
                    userId: userId,
                    userName: targetUser?.name || '',
                    date: newDate,
                    plans: [],
                    updatedAt: new Date().toISOString()
                };
            }

            if (!newPlan.plans) newPlan.plans = [];
            newPlan.plans.push(newTask);
            newPlan.updatedAt = new Date().toISOString();
            await this.db.put('work_plans', newPlan);

            this.invalidateCarryForwardCache();

            // Trigger rating recalculation
            if (AppRating) {
                await AppRating.updateUserRating(userId);
            }

            return newPlan;
        } catch (err) {
            console.error('Failed to update task date:', err);
            throw err;
        }
    }

    async removeTask(planId, taskIndex) {
        try {
            const currentUser = AppAuth.getUser();
            const plan = await this.db.get('work_plans', planId);
            if (!plan || !Array.isArray(plan.plans) || !plan.plans[taskIndex]) {
                throw new Error('Plan or task not found');
            }

            plan.plans[taskIndex] = {
                ...plan.plans[taskIndex],
                status: 'not-completed',
                isRemoved: true,
                removedAt: new Date().toISOString(),
                removedBy: currentUser?.id || ''
            };
            plan.updatedAt = new Date().toISOString();

            await this.db.put('work_plans', plan);
            this.invalidateCarryForwardCache();
            return plan;
        } catch (err) {
            console.error('Failed to remove task:', err);
            throw err;
        }
    }

    /**
     * Reassign task to another user
     */
    async reassignTask(planId, taskIndex, newUserId) {
        try {
            const plan = await this.db.get('work_plans', planId);
            if (!plan || !plan.plans || !plan.plans[taskIndex]) {
                throw new Error('Plan or task not found');
            }

            const users = await this.db.getAll('users');
            const newUser = users.find(u => u.id === newUserId);
            if (!newUser) {
                throw new Error('New user not found');
            }

            plan.plans[taskIndex].assignedTo = newUserId;
            plan.plans[taskIndex].assignedToName = newUser.name || '';
            plan.updatedAt = new Date().toISOString();

            await this.db.put('work_plans', plan);
            this.invalidateCarryForwardCache();
            return plan;
        } catch (err) {
            console.error('Failed to reassign task:', err);
            throw err;
        }
    }

    /**
     * Get tasks by status for a user
     */
    async getTasksByStatus(userId, status, startDate = null, endDate = null) {
        try {
            const allPlans = await this.db.getAll('work_plans');
            const userPlans = allPlans.filter(p => p.userId === userId);

            const tasks = [];
            userPlans.forEach(plan => {
                if (startDate && plan.date < startDate) return;
                if (endDate && plan.date > endDate) return;

                if (plan.plans && Array.isArray(plan.plans)) {
                    plan.plans.forEach((task, idx) => {
                        if (task.isRemoved === true) return;
                        const taskStatus = this.getSmartTaskStatus(plan.date, task.status);
                        if (taskStatus === status) {
                            tasks.push({
                                ...task,
                                planId: plan.id,
                                taskIndex: idx,
                                planDate: plan.date,
                                calculatedStatus: taskStatus
                            });
                        }
                    });
                }
            });

            return tasks;
        } catch (err) {
            console.error('Failed to get tasks by status:', err);
            return [];
        }
    }

    /**
     * Get all work plans where the user is tagged for a specific day
     */
    async getCollaborations(userId, date = null) {
        try {
            const safeUserId = String(userId || '').trim();
            const cacheKey = `calendarCollaborations:${safeUserId}:${String(date || '').trim()}`;
            const cached = this._collaborationsCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) {
                return cached.value;
            }
            const allPlans = await this.db.getAll('work_plans');
            const value = allPlans.filter(p =>
                (!date || p.date === date) &&
                p.plans &&
                p.plans.some(task =>
                    task.tags && task.tags.some(t => t.id === safeUserId && t.status === 'accepted')
                )
            );
            this._collaborationsCache.set(cacheKey, {
                value,
                expiresAt: Date.now() + 30000
            });
            return value;
        } catch (err) {
            console.error("Failed to fetch collaborations:", err);
            return [];
        }
    }

    /**
     * Add a new shared event (Admin only)
     */
    async addEvent(eventData) {
        const event = {
            id: 'ev_' + Date.now(),
            ...eventData,
            createdOn: new Date().toISOString()
        };
        return await this.db.add('events', event);
    }

    /**
     * Helper: Date to YYYY-MM-DD (Local)
     */
    _toLocalISO(date) {
        const d = new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    /**
     * Get events/plans for a specific month
     */
    async getMonthEvents(year, month) {
        const plans = await this.getPlans();

        // Format leaves into daily events
        const leaveEvents = [];
        plans.leaves.forEach(l => {
            const start = new Date(l.startDate);
            const end = new Date(l.endDate);
            let current = new Date(start);
            while (current <= end) {
                leaveEvents.push({
                    date: this._toLocalISO(current),
                    title: `${l.userName || 'Staff'} (Leave)`,
                    type: 'leave',
                    userId: l.userId
                });
                current.setDate(current.getDate() + 1);
            }
        });

        // Format work plans
        const workEvents = plans.workPlans.map(p => {
            const titleParts = [];
            p.plans.forEach(plan => {
                let text = plan.task;
                if (plan.subPlans && plan.subPlans.length > 0) {
                    text += ' (' + plan.subPlans.join(', ') + ')';
                }
                if (plan.tags && plan.tags.length > 0) {
                    text += ' with ' + plan.tags.map(t => t.name).join(', ');
                }
                titleParts.push(text);
            });

            return {
                date: p.date,
                title: `${p.userName}: ${titleParts.join('; ')}`,
                type: 'work',
                userId: p.userId,
                plans: p.plans
            };
        });

        // Merge
        const all = [...leaveEvents, ...plans.events, ...workEvents];

        // Filter by month
        return all.filter(ev => {
            const evDate = new Date(ev.date);
            return evDate.getFullYear() === year && evDate.getMonth() === month;
        });
    }
}

export const AppCalendar = new Calendar();
if (typeof window !== 'undefined') window.AppCalendar = AppCalendar;
