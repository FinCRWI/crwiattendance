import { AppDB } from './db.js';

const JOURNEY_REFLECTION_COLLECTION = 'journey_reflections';
const JOURNEY_REMINDER_PREFIX = 'journey_reflection_dismissed';
const JOURNEY_LOCAL_STORAGE_KEY = 'journey_reflections_local_v1';

export const JOURNEY_REFLECTION_ENERGY_OPTIONS = Object.freeze([
    { value: 'energized', label: 'Energized' },
    { value: 'steady', label: 'Steady' },
    { value: 'mixed', label: 'Mixed' },
    { value: 'drained', label: 'Drained' }
]);

const JOURNEY_PROMPTS = Object.freeze([
    'What felt most meaningful today?',
    'What helped you keep momentum today?',
    'What is one small win worth remembering?',
    'What felt heavy, and what helped?',
    'What would you like tomorrow to feel like?'
]);

const JOURNEY_ENCOURAGEMENTS = Object.freeze([
    'Small pauses make progress easier to repeat.',
    'A short reflection is enough to keep the path visible.',
    'One honest sentence still counts as progress.',
    'Consistency matters more than length here.'
]);

const normalizeText = (value) => String(value ?? '').trim();

const normalizeDateKey = (value) => {
    const raw = normalizeText(value);
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().split('T')[0];
};

const getIstNow = () => {
    try {
        return window?.AppDB?.getIstNow ? window.AppDB.getIstNow() : new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    } catch {
        return new Date();
    }
};

const getDateKeys = () => {
    const keys = window?.AppDB?.getISTDateKeys?.();
    if (keys?.todayKey) {
        return {
            todayKey: normalizeDateKey(keys.todayKey),
            yesterdayKey: normalizeDateKey(keys.yesterdayKey)
        };
    }
    const now = getIstNow();
    const todayKey = now.toISOString().split('T')[0];
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return {
        todayKey,
        yesterdayKey: yesterday.toISOString().split('T')[0]
    };
};

const getWeekRange = (dateKey = getDateKeys().todayKey) => {
    const base = new Date(`${normalizeDateKey(dateKey)}T00:00:00`);
    if (Number.isNaN(base.getTime())) {
        return getWeekRange(getDateKeys().todayKey);
    }
    const day = base.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const start = new Date(base);
    start.setDate(base.getDate() + diffToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const fmt = (date) => date.toISOString().split('T')[0];
    return {
        startKey: fmt(start),
        endKey: fmt(end)
    };
};

const buildDocId = (userId, dateKey) => {
    const safeUserId = normalizeText(userId).replace(/[^a-zA-Z0-9_-]/g, '_') || 'user';
    const safeDate = normalizeDateKey(dateKey) || getDateKeys().todayKey;
    return `journey_${safeUserId}_${safeDate}`;
};

const getDismissKey = (userId, dateKey) => `${JOURNEY_REMINDER_PREFIX}:${normalizeText(userId)}:${normalizeDateKey(dateKey)}`;

const readDismissedForDay = (userId, dateKey) => {
    try {
        return localStorage.getItem(getDismissKey(userId, dateKey)) === '1';
    } catch {
        return false;
    }
};

const setDismissedForDay = (userId, dateKey) => {
    try {
        localStorage.setItem(getDismissKey(userId, dateKey), '1');
    } catch {
        /* ignore */
    }
};

const clearDismissedForDay = (userId, dateKey) => {
    try {
        localStorage.removeItem(getDismissKey(userId, dateKey));
    } catch {
        /* ignore */
    }
};

const normalizeReflectionRow = (row) => {
    if (!row || typeof row !== 'object') return null;
    const id = normalizeText(row.id);
    const date = normalizeDateKey(row.date);
    const userId = normalizeText(row.userId);
    if (!id || !date || !userId) return null;
    return {
        ...row,
        id,
        userId,
        userName: normalizeText(row.userName),
        date,
        note: normalizeText(row.note),
        energy: normalizeText(row.energy) || 'steady',
        prompt: normalizeText(row.prompt),
        source: normalizeText(row.source) || 'dashboard',
        updatedBy: normalizeText(row.updatedBy) || userId,
        updatedAt: normalizeText(row.updatedAt),
        createdAt: normalizeText(row.createdAt),
        weekKey: normalizeDateKey(row.weekKey) || ''
    };
};

const readLocalReflectionStore = () => {
    try {
        const raw = localStorage.getItem(JOURNEY_LOCAL_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const writeLocalReflectionStore = (rows) => {
    try {
        localStorage.setItem(JOURNEY_LOCAL_STORAGE_KEY, JSON.stringify(Array.isArray(rows) ? rows : []));
    } catch {
        /* ignore */
    }
};

const mergeReflectionRows = (...groups) => {
    const byId = new Map();
    for (const group of groups) {
        for (const row of (group || [])) {
            const normalized = normalizeReflectionRow(row);
            if (!normalized) continue;
            byId.set(normalized.id, normalized);
        }
    }
    return Array.from(byId.values());
};

const readLocalReflections = () => mergeReflectionRows(readLocalReflectionStore());

const saveLocalReflection = (record) => {
    const normalized = normalizeReflectionRow(record);
    if (!normalized) return;
    const next = readLocalReflections().filter((row) => row.id !== normalized.id);
    next.push(normalized);
    writeLocalReflectionStore(next);
};

const hashString = (value) => {
    const text = normalizeText(value);
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
};

const pickBySeed = (items, seedText) => {
    if (!Array.isArray(items) || items.length === 0) return '';
    return items[hashString(seedText) % items.length];
};

const formatEnergyLabel = (value) => {
    const match = JOURNEY_REFLECTION_ENERGY_OPTIONS.find((option) => option.value === value);
    return match?.label || 'Mixed';
};

const toPreview = (value, maxLen = 120) => {
    const text = normalizeText(value);
    if (!text) return '';
    return text.length > maxLen ? `${text.slice(0, maxLen).trim()}...` : text;
};

const resolveCurrentUser = (user = window?.AppAuth?.getUser?.()) => user || null;

const resolveDashboardTargetUserId = (user) => {
    const currentUser = resolveCurrentUser(user);
    if (!currentUser?.id) return '';
    const selected = normalizeText(window?.app_selectedSummaryStaffId || '');
    const canViewStaff = !!window?.app_hasPerm?.('dashboard', 'view', currentUser);
    return canViewStaff && selected && selected !== currentUser.id ? selected : currentUser.id;
};

async function loadAllReflections() {
    const localReflections = readLocalReflections();
    if (!AppDB?.getAll) return localReflections;

    try {
        // Use getAll which works correctly for this collection
        // (journey_reflections is in the Firestore rules allowlist).
        // Avoid calling queryMany with empty filters — it's redundant and
        // can trigger a "Missing or insufficient permissions" error
        // in certain Firestore security rules evaluation contexts.
        const remoteReflections = await AppDB.getAll(JOURNEY_REFLECTION_COLLECTION, {
            silentPermissionDenied: true
        }).catch(() => []);

        const merged = mergeReflectionRows(localReflections, remoteReflections || []);
        if (merged.length > 0) {
            console.log(`Journey reflections loaded: ${merged.length} total (${remoteReflections?.length || 0} remote, ${localReflections.length} local)`);
        }
        return merged;
    } catch (err) {
        console.warn('Journey reflections load failed, using local data:', err);
        return localReflections;
    }
}

async function getReflectionDoc(userId, dateKey) {
    const docId = buildDocId(userId, dateKey);
    if (!AppDB?.get) return null;
    const localMatch = readLocalReflections().find((row) => row.id === docId) || null;
    try {
        // Try primary: get by constructed doc ID
        const remote = await AppDB.get(JOURNEY_REFLECTION_COLLECTION, docId, {
            silentPermissionDenied: true
        }).catch(() => null);

        // Use the getManySignature approach for legacy data lookup.
        // The doc ID pattern is deterministic (journey_{userId}_{dateKey}),
        // so a direct get() is sufficient. The queryMany fallback is removed
        // because it can trigger a spurious "Missing or insufficient permissions"
        // error in Firestore security rules evaluation.
        if (remote) {
            return normalizeReflectionRow(remote);
        }

        return localMatch;
    } catch {
        return localMatch;
    }
}

function filterUserReflections(reflections, userId) {
    const safeUserId = normalizeText(userId);
    return (reflections || [])
        .filter((row) => row && normalizeText(row.userId) === safeUserId)
        .map((row) => ({
            ...row,
            date: normalizeDateKey(row.date),
            note: normalizeText(row.note),
            energy: normalizeText(row.energy) || 'steady',
            prompt: normalizeText(row.prompt),
            userName: normalizeText(row.userName),
            ownerName: normalizeText(row.ownerName)
        }))
        .filter((row) => !!row.date);
}

function computeStreak(records, anchorDateKey) {
    const map = new Map((records || []).map((row) => [row.date, row]));
    const anchor = normalizeDateKey(anchorDateKey);
    if (!anchor) return 0;
    const cursor = new Date(`${anchor}T00:00:00`);
    let streak = 0;
    while (!Number.isNaN(cursor.getTime())) {
        const dateKey = cursor.toISOString().split('T')[0];
        const record = map.get(dateKey);
        if (!record || !normalizeText(record.note)) break;
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

function getWeeklySummary(records, weekStartKey, weekEndKey, todayKey) {
    const safeStart = normalizeDateKey(weekStartKey);
    const safeEnd = normalizeDateKey(weekEndKey);
    const safeToday = normalizeDateKey(todayKey);
    const weeklyRecords = (records || [])
        .filter((row) => row.date >= safeStart && row.date <= safeEnd && normalizeText(row.note))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const count = weeklyRecords.length;
    const streak = computeStreak(records, safeToday);
    const latest = weeklyRecords[0] || null;
    const energyCounts = new Map();
    weeklyRecords.forEach((row) => {
        const energy = normalizeText(row.energy) || 'steady';
        energyCounts.set(energy, (energyCounts.get(energy) || 0) + 1);
    });

    const dominantEnergyKey = Array.from(energyCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([key]) => key)[0] || 'steady';

    let progressCopy = 'No reflections yet this week.';
    if (count === 1) {
        progressCopy = '1 reflection logged this week.';
    } else if (count > 1) {
        progressCopy = `${count} reflections logged this week.`;
    }

    let rhythmCopy = 'Your rhythm is ready to begin.';
    if (streak === 1) {
        rhythmCopy = 'You have a 1-day streak going.';
    } else if (streak > 1) {
        rhythmCopy = `${streak}-day streak in progress.`;
    }

    return {
        weeklyRecords,
        count,
        streak,
        latest,
        dominantEnergyKey,
        dominantEnergyLabel: formatEnergyLabel(dominantEnergyKey),
        progressCopy,
        rhythmCopy,
        latestPreview: latest ? toPreview(latest.note, 140) : ''
    };
}

async function saveJourneyReflection({
    userId,
    userName = '',
    dateKey,
    note,
    energy = 'steady',
    prompt = '',
    updatedBy = '',
    source = 'dashboard'
} = {}) {
    const safeUserId = normalizeText(userId);
    const safeDateKey = normalizeDateKey(dateKey) || getDateKeys().todayKey;
    const safeNote = normalizeText(note);
    if (!safeUserId) throw new Error('Journey reflection requires a user id.');
    if (!safeNote) throw new Error('Please add a short reflection before saving.');

    const record = {
        id: buildDocId(safeUserId, safeDateKey),
        userId: safeUserId,
        userName: normalizeText(userName),
        date: safeDateKey,
        note: safeNote,
        energy: JOURNEY_REFLECTION_ENERGY_OPTIONS.some((option) => option.value === energy) ? energy : 'steady',
        prompt: normalizeText(prompt),
        source: normalizeText(source) || 'dashboard',
        updatedBy: normalizeText(updatedBy) || safeUserId,
        updatedAt: new Date().toISOString(),
        weekKey: getWeekRange(safeDateKey).startKey
    };
    if (!record.createdAt) {
        const existing = await getReflectionDoc(safeUserId, safeDateKey);
        if (existing?.createdAt) {
            record.createdAt = existing.createdAt;
        } else {
            record.createdAt = record.updatedAt;
        }
    }
    const remoteSaved = await AppDB.put(JOURNEY_REFLECTION_COLLECTION, record, { silentPermissionDenied: true }).catch(() => null);
    saveLocalReflection(record);
    if (!remoteSaved) {
        record.storageMode = 'local';
    }
    clearDismissedForDay(safeUserId, safeDateKey);
    return record;
}

async function buildDashboardState({
    viewerUser = resolveCurrentUser(),
    targetUserId = resolveDashboardTargetUserId(),
    targetUserName = '',
    dateKey
} = {}) {
    const currentUser = resolveCurrentUser(viewerUser);
    const ownerId = normalizeText(targetUserId || resolveDashboardTargetUserId(currentUser) || currentUser?.id || '');
    const todayKey = normalizeDateKey(dateKey) || getDateKeys().todayKey;
    const weekRange = getWeekRange(todayKey);
    const allReflections = await loadAllReflections();
    const ownerReflections = filterUserReflections(allReflections, ownerId);
    const todayReflection = ownerReflections.find((row) => row.date === todayKey) || null;
    const weeklySummary = getWeeklySummary(ownerReflections, weekRange.startKey, weekRange.endKey, todayKey);
    const hasTodayReflection = !!normalizeText(todayReflection?.note);
    const canEdit = !!currentUser?.id && currentUser.id === ownerId;
    const dismissedToday = readDismissedForDay(ownerId, todayKey);
    const reminderVisible = canEdit && !hasTodayReflection && !dismissedToday;
    const prompt = pickBySeed(JOURNEY_PROMPTS, `${ownerId}:${todayKey}`);
    const encouragement = pickBySeed(JOURNEY_ENCOURAGEMENTS, `${ownerId}:${todayKey}:enc`);
    const ownerLabel = normalizeText(targetUserName) || normalizeText(currentUser?.name) || 'Staff Member';
    const noteDraft = todayReflection?.note || '';
    const energyDraft = todayReflection?.energy || 'steady';

    return {
        ownerId,
        ownerLabel,
        todayKey,
        weekStartKey: weekRange.startKey,
        weekEndKey: weekRange.endKey,
        canEdit,
        hasTodayReflection,
        todayReflection,
        noteDraft,
        energyDraft,
        prompt,
        encouragement,
        reminderVisible,
        dismissedToday,
        weeklySummary,
        records: ownerReflections,
        phaseLabel: 'Phase 1 - Reflection Start',
        phaseProgressLabel: `${weeklySummary.count}/7 this week`,
        summaryLine: hasTodayReflection
            ? 'You have already reflected today.'
            : reminderVisible
                ? 'No reflection yet today.'
                : 'Reflection is snoozed for today.'
    };
}

function dismissJourneyReflectionReminder(userId, dateKey) {
    const safeUserId = normalizeText(userId);
    const safeDateKey = normalizeDateKey(dateKey) || getDateKeys().todayKey;
    if (!safeUserId) return;
    setDismissedForDay(safeUserId, safeDateKey);
}

// Diagnostic function to check and recover old reflections
async function diagnoseAndRecoverReflections(userId) {
    if (!userId) return { status: 'error', message: 'User ID required' };

    try {
        console.log('🔍 Starting Journey Reflection diagnostic...');

        // Check local storage
        const localData = readLocalReflections();
        const userLocalData = filterUserReflections(localData, userId);
        console.log(`📦 Local storage: ${userLocalData.length} reflections for user`);

        // Check remote data
        if (!AppDB?.queryMany) {
            return { status: 'warning', message: 'Database not initialized' };
        }

        const remoteAll = await AppDB.queryMany(JOURNEY_REFLECTION_COLLECTION, [], {
            silentPermissionDenied: true
        }).catch(() => []);
        console.log(`☁️  Remote total: ${remoteAll?.length || 0} reflections in collection`);

        const userRemoteData = filterUserReflections(remoteAll, userId);
        console.log(`☁️  Remote user-specific: ${userRemoteData.length} reflections for user`);

        // Merge and save to local storage
        const merged = mergeReflectionRows(userLocalData, userRemoteData);
        if (merged.length > userLocalData.length) {
            writeLocalReflectionStore(merged);
            console.log(`✅ Migrated ${merged.length - userLocalData.length} reflections to local storage`);
        }

        return {
            status: 'success',
            localCount: userLocalData.length,
            remoteCount: userRemoteData.length,
            mergedCount: merged.length,
            message: `Found ${merged.length} total reflections (${userRemoteData.length} from server)`
        };
    } catch (err) {
        console.error('Diagnostic error:', err);
        return { status: 'error', message: err.message };
    }
}

export const AppJourneyReflection = {
    JOURNEY_REFLECTION_COLLECTION,
    JOURNEY_REFLECTION_ENERGY_OPTIONS,
    buildDocId,
    buildDashboardState,
    clearDismissedForDay,
    diagnoseAndRecoverReflections,
    dismissJourneyReflectionReminder,
    filterUserReflections,
    formatEnergyLabel,
    getDateKeys,
    getReflectionDoc,
    getWeeklySummary,
    loadAllReflections,
    normalizeDateKey,
    normalizeText,
    readDismissedForDay,
    saveJourneyReflection,
    setDismissedForDay
};

if (typeof window !== 'undefined') {
    window.AppJourneyReflection = AppJourneyReflection;
}

export default AppJourneyReflection;
