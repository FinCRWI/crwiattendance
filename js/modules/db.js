import { AppConfig } from '../config.js';
import { AppFirestore } from './firebase-config.js';

export class Database {
    constructor() {
        this.db = AppFirestore;
        this.cache = new Map();
        this.telemetry = {
            get: 0,
            getAll: 0,
            query: 0,
            queryMany: 0,
            listen: 0,
            listenQuery: 0,
            writes: 0,
            docsRead: 0,
            byCollection: {}
        };
    }

    async init() {
        if (!this.db) {
            console.error("Firebase not initialized! Check config.");
            return;
        }
        console.log("Firestore adapter ready.");
    }

    getFlags() {
        return (AppConfig && AppConfig.READ_OPT_FLAGS) || {};
    }

    track(op, collectionName, docsRead = 0) {
        const flags = this.getFlags();
        if (!flags.ENABLE_READ_TELEMETRY) return;
        if (typeof this.telemetry[op] === 'number') this.telemetry[op] += 1;
        this.telemetry.docsRead += Math.max(0, Number(docsRead) || 0);
        if (!this.telemetry.byCollection[collectionName]) {
            this.telemetry.byCollection[collectionName] = { ops: 0, docsRead: 0 };
        }
        this.telemetry.byCollection[collectionName].ops += 1;
        this.telemetry.byCollection[collectionName].docsRead += Math.max(0, Number(docsRead) || 0);
    }

    getReadTelemetry() {
        return JSON.parse(JSON.stringify(this.telemetry));
    }

    clearReadTelemetry() {
        this.telemetry = {
            get: 0,
            getAll: 0,
            query: 0,
            queryMany: 0,
            listen: 0,
            listenQuery: 0,
            writes: 0,
            docsRead: 0,
            byCollection: {}
        };
    }

    getCacheKey(prefix, collectionName, payload = {}) {
        return `${prefix}:${collectionName}:${JSON.stringify(payload)}`;
    }

    invalidateCollectionCache(collectionName) {
        // Evict legacy keys + new doc/all keys for this collection.
        const needle = `:${collectionName}:`;
        const docNeedle = `doc:${collectionName}:`;
        const allNeedle = `all:${collectionName}:`;

        for (const key of this.cache.keys()) {
            if (key.includes(needle) || key.startsWith(docNeedle) || key.startsWith(allNeedle)) {
                this.cache.delete(key);
            }
        }
    }

    async getCached(cacheKey, ttlMs, fetchFn) {
        const now = Date.now();
        const entry = this.cache.get(cacheKey);
        if (entry && entry.expiresAt > now) {
            return entry.value;
        }
        const value = await fetchFn();
        this.cache.set(cacheKey, {
            value,
            expiresAt: now + Math.max(0, Number(ttlMs) || 0)
        });
        return value;
    }

    async getOrGenerateSummary(summaryKey, generatorFn, ttlMs) {
        if (!summaryKey || typeof generatorFn !== 'function') {
            throw new Error('getOrGenerateSummary requires a key and generator function.');
        }
        const key = this.getCacheKey('summary', 'computed', { summaryKey });
        const ttl = typeof ttlMs === 'number'
            ? ttlMs
            : (AppConfig?.READ_CACHE_TTLS?.attendanceSummary || 30000);
        return this.getCached(key, ttl, generatorFn);
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    }

    getSummarySchemaVersion() {
        return Number(AppConfig?.SUMMARY_POLICY?.SCHEMA_VERSION || 1);
    }

    getIstNow() {
        const now = new Date();
        return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    }

    toDateKey(dateObj) {
        const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    getISTDateKeys() {
        const istNow = this.getIstNow();
        const istYesterday = new Date(istNow);
        istYesterday.setDate(istYesterday.getDate() - 1);
        return {
            todayKey: this.toDateKey(istNow),
            yesterdayKey: this.toDateKey(istYesterday)
        };
    }

    getISTDayRange(dateKey) {
        const key = String(dateKey || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
        const start = new Date(`${key}T00:00:00+05:30`);
        const end = new Date(`${key}T23:59:59.999+05:30`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
        return {
            start,
            end,
            startMs: start.getTime(),
            endMs: end.getTime()
        };
    }

    shouldRecomputeNowIST(cutoffHourIST) {
        const cutoff = Number.isFinite(Number(cutoffHourIST))
            ? Number(cutoffHourIST)
            : Number(AppConfig?.SUMMARY_POLICY?.RECOMPUTE_CUTOFF_HOUR_IST || 17);
        return this.getIstNow().getHours() >= Math.max(0, Math.min(23, cutoff));
    }

    async hasAttendanceSignalForDate(dateKey) {
        const key = String(dateKey || '').trim();
        if (!key) return false;
        try {
            if (this.queryMany) {
                const attendanceRows = await this.queryMany('attendance', [
                    { field: 'date', operator: '==', value: key }
                ], { limit: 1 });
                if (Array.isArray(attendanceRows) && attendanceRows.length > 0) return true;
            }

            const dayRange = this.getISTDayRange(key);
            if (!dayRange) return false;

            if (this.queryMany) {
                const checkedInUsers = await this.queryMany('users', [
                    { field: 'lastCheckIn', operator: '>=', value: dayRange.startMs },
                    { field: 'lastCheckIn', operator: '<=', value: dayRange.endMs }
                ], { limit: 1 });
                return Array.isArray(checkedInUsers) && checkedInUsers.length > 0;
            }

            const [attendanceRows, users] = await Promise.all([
                this.getAll('attendance'),
                this.getAll('users')
            ]);
            if ((attendanceRows || []).some((row) => String(row?.date || '') === key)) return true;
            return (users || []).some((user) => {
                const lastCheckIn = Number(user?.lastCheckIn || 0);
                return Number.isFinite(lastCheckIn) && lastCheckIn >= dayRange.startMs && lastCheckIn <= dayRange.endMs;
            });
        } catch (error) {
            console.warn('Failed to check attendance signal for date:', key, error);
            return false;
        }
    }

    isSummaryFresh(summaryDoc, staleAfterMs) {
        if (!summaryDoc || typeof summaryDoc !== 'object') return false;
        const generatedAt = Number(summaryDoc.generatedAt || 0);
        const schemaVersion = Number(summaryDoc.version || 0);
        if (!generatedAt || !schemaVersion) return false;
        if (schemaVersion !== this.getSummarySchemaVersion()) return false;
        return (Date.now() - generatedAt) <= Math.max(0, Number(staleAfterMs) || 0);
    }

    async getDailySummary(dateKey) {
        const key = String(dateKey || '').trim();
        if (!key) return null;
        const ttl = AppConfig?.READ_CACHE_TTLS?.dailySummaryReadMs || 60000;
        const cacheKey = this.getCacheKey('dailySummary', 'daily_summaries', { key });
        return this.getCached(cacheKey, ttl, () => this.get('daily_summaries', key));
    }

    listenDailySummary(dateKey, callback) {
        const key = String(dateKey || '').trim();
        if (!key) return null;
        const cacheKey = this.getCacheKey('dailySummary', 'daily_summaries', { key });
        return this.listenDoc('daily_summaries', key, (data, snapshot) => {
            if (data) {
                const ttl = AppConfig?.READ_CACHE_TTLS?.dailySummaryReadMs || 60000;
                this.cache.set(cacheKey, { value: data, expiresAt: Date.now() + ttl });
            }
            if (callback) callback(data, snapshot);
        });
    }

    async getSummaryByDateKey(dateKey) {
        return this.getDailySummary(dateKey);
    }

    async getLatestSuccessfulSummaryMeta() {
        const ttl = AppConfig?.READ_CACHE_TTLS?.dailySummaryReadMs || 60000;
        const cacheKey = this.getCacheKey('dailySummaryMeta', 'daily_summaries_meta', { key: 'latest_success' });
        return this.getCached(cacheKey, ttl, () => this.get('daily_summaries_meta', 'latest_success'));
    }

    async setLatestSuccessfulSummaryMeta({ dateKey, generatedAt, version } = {}) {
        const key = String(dateKey || '').trim();
        if (!key) return;
        const payload = {
            id: 'latest_success',
            dateKey: key,
            generatedAt: Number(generatedAt || Date.now()),
            version: Number(version || this.getSummarySchemaVersion())
        };
        await this.put('daily_summaries_meta', payload);
    }

    async getDailySummaryWithFallback({ todayKey, yesterdayKey, staleAfterMs } = {}) {
        const staleMs = Math.max(1000, Number(staleAfterMs) || Number(AppConfig?.SUMMARY_POLICY?.STALENESS_MS) || 86400000);
        const allowYesterday = AppConfig?.SUMMARY_POLICY?.FALLBACK_TO_PREVIOUS_DAY !== false;

        const tryToday = await this.getSummaryByDateKey(todayKey);
        if (this.isSummaryFresh(tryToday, staleMs)) {
            return { summary: tryToday, source: 'today' };
        }

        if (allowYesterday) {
            const tryYesterday = await this.getSummaryByDateKey(yesterdayKey);
            if (tryYesterday && typeof tryYesterday === 'object') {
                return { summary: tryYesterday, source: 'yesterday' };
            }
        }

        const meta = await this.getLatestSuccessfulSummaryMeta();
        const metaKey = String(meta?.dateKey || '').trim();
        if (metaKey) {
            const viaMeta = await this.getSummaryByDateKey(metaKey);
            if (viaMeta && typeof viaMeta === 'object') {
                return { summary: viaMeta, source: 'latest_success' };
            }
        }

        return { summary: tryToday || null, source: 'none' };
    }

    async putDailySummary(dateKey, payload = {}) {
        const key = String(dateKey || '').trim();
        if (!key) throw new Error('putDailySummary requires dateKey.');
        const doc = {
            id: key,
            dateKey: key,
            version: this.getSummarySchemaVersion(),
            ...payload
        };
        return this.put('daily_summaries', doc);
    }

    async acquireSummaryLock(dateKey, lockOwner, ttlMs) {
        const key = String(dateKey || '').trim();
        const owner = String(lockOwner || '').trim();
        if (!key || !owner) return false;
        if (!this.db || !this.db.runTransaction) return false;
        if (AppConfig?.READ_OPT_FLAGS?.FF_SUMMARY_LOCKING === false) return true;

        const ttl = Math.max(1000, Number(ttlMs) || Number(AppConfig?.SUMMARY_POLICY?.LOCK_TTL_MS) || 90000);
        const ref = this.db.collection('summary_locks').doc(key);
        const now = Date.now();

        try {
            const acquired = await this.db.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                if (snap.exists) {
                    const cur = snap.data() || {};
                    const curOwner = String(cur.ownerId || '');
                    const expiresAt = Number(cur.expiresAt || 0);
                    const isActive = expiresAt > now;
                    if (isActive && curOwner && curOwner !== owner) return false;
                }
                tx.set(ref, {
                    id: key,
                    dateKey: key,
                    ownerId: owner,
                    createdAt: now,
                    expiresAt: now + ttl
                }, { merge: true });
                return true;
            });
            return acquired === true;
        } catch (error) {
            console.warn('Failed to acquire summary lock:', error);
            return false;
        }
    }

    async releaseSummaryLock(dateKey, lockOwner) {
        const key = String(dateKey || '').trim();
        const owner = String(lockOwner || '').trim();
        if (!key || !owner || !this.db || !this.db.runTransaction) return;
        if (AppConfig?.READ_OPT_FLAGS?.FF_SUMMARY_LOCKING === false) return;
        const ref = this.db.collection('summary_locks').doc(key);
        try {
            await this.db.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                if (!snap.exists) return;
                const cur = snap.data() || {};
                if (String(cur.ownerId || '') === owner) {
                    tx.delete(ref);
                }
            });
        } catch (error) {
            console.warn('Failed to release summary lock:', error);
        }
    }

    async getOrCreateDailySummary({
        dateKey,
        yesterdayKey,
        generatorFn,
        staleAfterMs,
        lockTtlMs
    } = {}) {
        const keys = this.getISTDateKeys();
        const key = String(dateKey || keys.todayKey || '').trim();
        const prevKey = String(yesterdayKey || keys.yesterdayKey || '').trim();
        if (!key || typeof generatorFn !== 'function') {
            throw new Error('getOrCreateDailySummary requires dateKey and generatorFn.');
        }
        const staleMs = Math.max(1000, Number(staleAfterMs) || Number(AppConfig?.SUMMARY_POLICY?.STALENESS_MS) || 86400000);
        const lockMs = Math.max(1000, Number(lockTtlMs) || Number(AppConfig?.SUMMARY_POLICY?.LOCK_TTL_MS) || 90000);
        const owner = String(window.AppAuth?.getUser?.()?.id || `anon_${Math.random().toString(36).slice(2, 10)}`);

        const fallback = await this.getDailySummaryWithFallback({
            todayKey: key,
            yesterdayKey: prevKey,
            staleAfterMs: staleMs
        });
        if (fallback.summary && fallback.source === 'today' && this.isSummaryFresh(fallback.summary, staleMs)) {
            // Force recalculation after the cutoff hour if the summary was generated
            // before the cutoff — ensures hero is scored with complete daily task data.
            const cutoffHour = Number(AppConfig?.SUMMARY_POLICY?.RECOMPUTE_CUTOFF_HOUR_IST || 17);
            const istNow = this.getIstNow();
            const generatedAt = Number(fallback.summary.generatedAt || 0);
            const generatedDate = generatedAt ? new Date(generatedAt) : null;
            const generatedHourIST = generatedDate
                ? new Date(generatedDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours()
                : 0;
            const needsPostCutoffRefresh = istNow.getHours() >= cutoffHour && generatedHourIST < cutoffHour;
            if (!needsPostCutoffRefresh) {
                return { ...fallback.summary, _source: 'shared_today' };
            }
            // Fall through to regeneration — clear analytics memo so generatorFn fetches fresh Firestore data
            if (typeof window !== 'undefined' && window.AppAnalytics?.clearMemo) {
                window.AppAnalytics.clearMemo('analytics:heroShared');
                window.AppAnalytics.clearMemo('analytics:attendance');
            }
        }

        const shouldGateOnFirstCheckIn = AppConfig?.SUMMARY_POLICY?.GENERATE_ON_FIRST_CHECKIN !== false;
        if (shouldGateOnFirstCheckIn) {
            const hasAttendanceSignal = await this.hasAttendanceSignalForDate(key);
            if (!hasAttendanceSignal) {
                return fallback.summary ? { ...fallback.summary, _source: `fallback_${fallback.source}` } : null;
            }
        } else if (!this.shouldRecomputeNowIST(AppConfig?.SUMMARY_POLICY?.RECOMPUTE_CUTOFF_HOUR_IST)) {
            return fallback.summary ? { ...fallback.summary, _source: `fallback_${fallback.source}` } : null;
        }

        const acquired = await this.acquireSummaryLock(key, owner, lockMs);
        if (acquired) {
            try {
                const generated = await generatorFn();
                const payload = {
                    ...(generated || {}),
                    generatedAt: Date.now(),
                    generatedBy: owner,
                    version: this.getSummarySchemaVersion()
                };
                await this.putDailySummary(key, payload);
                await this.setLatestSuccessfulSummaryMeta({
                    dateKey: key,
                    generatedAt: payload.generatedAt,
                    version: payload.version
                });
                return { dateKey: key, ...payload, _source: 'generated' };
            } finally {
                await this.releaseSummaryLock(key, owner);
            }
        }

        const pollDelays = [350, 700, 1200, 1800];
        for (const delayMs of pollDelays) {
            await this.sleep(delayMs);
            const candidate = await this.getDailySummary(key);
            if (this.isSummaryFresh(candidate, staleMs)) {
                return { ...candidate, _source: 'shared' };
            }
        }
        return fallback.summary ? { ...fallback.summary, _source: `fallback_${fallback.source}` } : null;
    }

    applyFilters(ref, filters = []) {
        let q = ref;
        (filters || []).forEach(f => {
            if (!f || !f.field || !f.operator) return;
            q = q.where(f.field, f.operator, f.value);
        });
        return q;
    }

    applyOptions(ref, options = {}) {
        let q = ref;
        if (options.orderBy) {
            const arr = Array.isArray(options.orderBy) ? options.orderBy : [options.orderBy];
            arr.forEach(o => {
                if (!o) return;
                if (typeof o === 'string') q = q.orderBy(o);
                else if (o.field) q = q.orderBy(o.field, o.direction || 'asc');
            });
        }
        if (options.limit) q = q.limit(options.limit);
        if (options.startAt !== undefined) q = q.startAt(options.startAt);
        if (options.endAt !== undefined) q = q.endAt(options.endAt);
        return q;
    }

    isPermissionDenied(error) {
        const code = String(error?.code || '').toLowerCase();
        const message = String(error?.message || '').toLowerCase();
        return code.includes('permission-denied')
            || message.includes('missing or insufficient permissions');
    }

    async getAll(collectionName, options = {}) {
        try {
            const source = String(options?.source || '').trim().toLowerCase();
            const canUseSource = source === 'server' || source === 'cache';

            // Cache collections that are read often and rarely change within a session.
            // work_plans and users are fetched by many callsites across the app.
            const isWorkPlans = String(collectionName) === 'work_plans';
            const isUsers = String(collectionName) === 'users';
            const ttlByCollection = AppConfig?.READ_CACHE_TTLS || {};
            const shouldCache = (isWorkPlans || isUsers) && source !== 'server';

            const cacheKey = this.getCacheKey(
                'all',
                collectionName,
                { source: canUseSource ? source : 'none' }
            );

            if (shouldCache) {
                if (isWorkPlans) {
                    const wasHit = this.cache.has(cacheKey);
                    window.app_workPlansLoadSource = (wasHit && this.cache.get(cacheKey)?.expiresAt > Date.now()) ? 'hit' : 'miss';
                }

                const ttlMs = isUsers
                    ? (ttlByCollection.users || 60000)
                    : (ttlByCollection.workPlansAllReadMs || 60000);
                return this.getCached(cacheKey, ttlMs, async () => {
                    const snapshot = canUseSource
                        ? await this.db.collection(collectionName).get({ source })
                        : await this.db.collection(collectionName).get();
                    const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
                    this.track('getAll', collectionName, data.length);
                    return data;
                });
            }

            const snapshot = canUseSource
                ? await this.db.collection(collectionName).get({ source })
                : await this.db.collection(collectionName).get();
            const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            this.track('getAll', collectionName, data.length);
            return data;
        } catch (error) {
            if (options?.silentPermissionDenied && this.isPermissionDenied(error)) {
                return [];
            }
            console.error(`Error getting all from ${collectionName}:`, error);
            throw error;
        }
    }

    async get(collectionName, id, options = {}) {
        if (!id) return null;
        try {
            const docId = String(id);
            const docRef = this.db.collection(collectionName).doc(docId);

            const source = String(options?.source || '').trim().toLowerCase();
            const canUseSource = source === 'server' || source === 'cache';

            // Only cache work_plans doc reads by default to reuse full day plan payload.
            const isWorkPlans = String(collectionName) === 'work_plans';
            const ttlByCollection = AppConfig?.READ_CACHE_TTLS || {};
            const shouldCache = isWorkPlans && source !== 'server';

            const cacheKey = this.getCacheKey(
                'doc',
                collectionName,
                { id: docId, source: canUseSource ? source : 'none' }
            );

            if (shouldCache) {
                // expose where data came from (only for work_plans)
                const wasHit = this.cache.has(cacheKey);
                if (wasHit && this.cache.get(cacheKey)?.expiresAt > Date.now()) {
                    window.app_workPlansLoadSource = 'hit';
                } else {
                    window.app_workPlansLoadSource = 'miss';
                }

                const ttlMs = ttlByCollection.workPlanReadMs || 60000;
                return this.getCached(cacheKey, ttlMs, async () => {
                    const doc = canUseSource ? await docRef.get({ source }) : await docRef.get();
                    if (doc.exists) {
                        this.track('get', collectionName, 1);
                        return { ...doc.data(), id: doc.id };
                    } else {
                        this.track('get', collectionName, 0);
                        return null;
                    }
                });
            }

            const doc = canUseSource ? await docRef.get({ source }) : await docRef.get();
            if (doc.exists) {
                this.track('get', collectionName, 1);
                return { ...doc.data(), id: doc.id };
            } else {
                this.track('get', collectionName, 0);
                return null;
            }
        } catch (error) {
            if (options?.silentPermissionDenied && this.isPermissionDenied(error)) {
                return null;
            }
            console.error(`Error getting ${id} from ${collectionName}:`, error);
            throw error;
        }
    }

    async add(collectionName, item, options = {}) {
        if (item.id) {
            return this.put(collectionName, item);
        }
        try {
            const docRef = await this.db.collection(collectionName).add(item);
            this.telemetry.writes += 1;
            this.invalidateCollectionCache(collectionName);
            if (window.dispatchEvent) window.dispatchEvent(new CustomEvent('app:db-write', {
                detail: {
                    collection: collectionName,
                    op: 'add',
                    id: docRef.id,
                    item: { ...item, id: docRef.id }
                }
            }));
            return docRef.id;
        } catch (error) {
            if (options?.silentPermissionDenied && this.isPermissionDenied(error)) {
                console.warn(`Silent: failed to add to ${collectionName} due to permissions.`);
                return null;
            }
            console.error(`Error adding to ${collectionName}:`, error);
            throw error;
        }
    }

    async put(collectionName, item, options = {}) {
        if (!item.id) throw new Error("Item must have an ID for 'put' operation.");
        try {
            const docId = String(item.id);
            await this.db.collection(collectionName).doc(docId).set(item, { merge: true });
            this.telemetry.writes += 1;
            this.invalidateCollectionCache(collectionName);
            if (window.dispatchEvent) window.dispatchEvent(new CustomEvent('app:db-write', {
                detail: {
                    collection: collectionName,
                    op: 'put',
                    id: docId,
                    item: { ...item }
                }
            }));
            return docId;
        } catch (error) {
            if (options?.silentPermissionDenied && this.isPermissionDenied(error)) {
                return null;
            }
            console.error(`Error putting ${item.id} to ${collectionName}:`, error);
            throw error;
        }
    }

    async delete(collectionName, id) {
        if (!id) return;
        try {
            const docId = String(id);
            await this.db.collection(collectionName).doc(docId).delete();
            this.telemetry.writes += 1;
            this.invalidateCollectionCache(collectionName);
            if (window.dispatchEvent) window.dispatchEvent(new CustomEvent('app:db-write', {
                detail: {
                    collection: collectionName,
                    op: 'delete',
                    id: docId
                }
            }));
        } catch (error) {
            console.error(`Error deleting ${id} from ${collectionName}:`, error);
            throw error;
        }
    }

    async deleteMany(collectionName, ids = [], options = {}) {
        const uniqueIds = Array.from(new Set((ids || []).filter(Boolean).map((id) => String(id))));
        if (!uniqueIds.length) return 0;
        const chunkSize = Math.max(1, Math.min(450, Number(options.chunkSize) || 400));
        let deletedCount = 0;

        try {
            for (let i = 0; i < uniqueIds.length; i += chunkSize) {
                const chunk = uniqueIds.slice(i, i + chunkSize);
                const batch = this.db.batch();
                chunk.forEach((docId) => {
                    const ref = this.db.collection(collectionName).doc(docId);
                    batch.delete(ref);
                });
                await batch.commit();
                deletedCount += chunk.length;
            }
            this.telemetry.writes += deletedCount;
            this.invalidateCollectionCache(collectionName);
            if (window.dispatchEvent) window.dispatchEvent(new CustomEvent('app:db-write', {
                detail: {
                    collection: collectionName,
                    op: 'deleteMany',
                    count: deletedCount,
                    ids: uniqueIds
                }
            }));
            return deletedCount;
        } catch (error) {
            console.error(`Error deleting many from ${collectionName}:`, error);
            throw error;
        }
    }

    async deleteAllInCollection(collectionName, options = {}) {
        const rows = await this.getAll(collectionName, options);
        const ids = (rows || []).map((row) => row?.id).filter(Boolean);
        if (!ids.length) return 0;
        return this.deleteMany(collectionName, ids, options);
    }

    async query(collectionName, field, operator, value) {
        try {
            const snapshot = await this.db.collection(collectionName).where(field, operator, value).get();
            const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            this.track('query', collectionName, data.length);
            return data;
        } catch (error) {
            console.error(`Error querying ${collectionName}:`, error);
            throw error;
        }
    }


    async queryManyStrict(collectionName, filters = [], options = {}) {
        if (!this.db) throw new Error('Firestore is not initialized.');
        let ref = this.db.collection(collectionName);
        ref = this.applyFilters(ref, filters);
        ref = this.applyOptions(ref, options);
        const snapshot = await ref.get();
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        this.track('queryMany', collectionName, data.length);
        return data;
    }

    async getDayPlansByDate(dateKey) {
        const safeDate = String(dateKey || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) return [];
        const plans = await this.queryManyStrict('work_plans', [
            { field: 'date', operator: '==', value: safeDate }
        ]);
        return plans.filter((plan) => String(plan?.date || '').trim() === safeDate);
    }
    async queryMany(collectionName, filters = [], options = {}) {
        const flags = this.getFlags();
        if (!flags.FF_READ_OPT_DB_QUERIES) return this.getAll(collectionName, { ...options, silentPermissionDenied: true });
        try {
            let ref = this.db.collection(collectionName);
            ref = this.applyFilters(ref, filters);
            ref = this.applyOptions(ref, options);
            const snapshot = await ref.get();
            const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            this.track('queryMany', collectionName, data.length);
            return data;
        } catch (error) {
            console.warn(`queryMany failed for ${collectionName}, falling back to getAll`, error);
            return this.getAll(collectionName, { ...options, silentPermissionDenied: true });
        }
    }

    async getManyByIds(collectionName, ids = []) {
        const uniqueIds = Array.from(new Set((ids || []).filter(Boolean).map(v => String(v))));
        if (!uniqueIds.length) return [];
        const chunks = [];
        for (let i = 0; i < uniqueIds.length; i += 10) chunks.push(uniqueIds.slice(i, i + 10));
        const reads = await Promise.all(chunks.map(async (chunk) => {
            try {
                const scoped = await this.queryMany(collectionName, [{ field: 'id', operator: 'in', value: chunk }]);
                if (scoped && scoped.length) return scoped;
                return Promise.all(chunk.map(id => this.get(collectionName, id)));
            } catch {
                return Promise.all(chunk.map(id => this.get(collectionName, id)));
            }
        }));
        return reads.flat().filter(Boolean);
    }

    listenDoc(collectionName, id, callback) {
        if (!this.db || !id) return null;
        const docId = String(id);
        try {
            return this.db.collection(collectionName).doc(docId).onSnapshot((doc) => {
                const data = doc.exists ? { ...doc.data(), id: doc.id } : null;
                this.track('listen', collectionName, 1);
                callback(data, doc);
            }, (error) => {
                console.error(`Realtime listener error in ${collectionName}/${docId}:`, error);
            });
        } catch (error) {
            console.error(`Error setting up listener for ${collectionName}/${docId}:`, error);
            return null;
        }
    }

    listenQuery(collectionName, filters = [], options = {}, callback) {
        if (!this.db) return null;
        try {
            let ref = this.db.collection(collectionName);
            ref = this.applyFilters(ref, filters);
            ref = this.applyOptions(ref, options);
            return ref.onSnapshot((snapshot) => {
                const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
                this.track('listenQuery', collectionName, data.length);
                callback(data, snapshot);
            }, (error) => {
                if (options.silentPermissionDenied && this.isPermissionDenied(error)) {
                    return;
                }
                console.error(`Realtime query listener error in ${collectionName}:`, error);
            });
        } catch (error) {
            console.warn(`listenQuery failed for ${collectionName}, falling back to listen`, error);
            return this.listen(collectionName, callback);
        }
    }

    listen(collectionName, callback) {
        if (!this.db) return null;
        return this.db.collection(collectionName).onSnapshot((snapshot) => {
            const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            this.track('listen', collectionName, data.length);
            callback(data, snapshot);
        }, (error) => {
            console.error(`Realtime listener error in ${collectionName}:`, error);
        });
    }
}

export const AppDB = new Database();
if (typeof window !== 'undefined') window.AppDB = AppDB;
