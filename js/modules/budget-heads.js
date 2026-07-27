/**
 * Budget head catalog helpers used across the app.
 *
 * Provides normalization, active catalog loading, option rendering and cache
 * refresh for budget heads stored in Firestore.
 */

export const APP_UNALLOCATED_BUDGET_HEAD = Object.freeze({
    id: 'UNALLOCATED',
    code: 'UNALLOCATED',
    name: 'Unallocated / To Be Mapped',
    status: 'active',
    system: true
});

function getDB() {
    return window.AppDB;
}

export function normalizeBudgetHeadId(value) {
    const raw = String(value || '').trim();
    return raw || APP_UNALLOCATED_BUDGET_HEAD.id;
}

export async function getActiveBudgetHeads(db = getDB()) {
    const rows = await db.getAll('budget_heads').catch(() => []);
    const normalized = Array.isArray(rows)
        ? rows
            .filter((row) => String(row?.status || 'active').toLowerCase() !== 'inactive')
            .map((row) => ({
                id: String(row.id || row.code || '').trim(),
                code: String(row.code || row.id || '').trim(),
                name: String(row.name || row.code || row.id || '').trim(),
                status: String(row.status || 'active').toLowerCase(),
                parentId: String(row.parentId || '').trim()
            }))
            .filter((row) => !!row.id)
        : [];

    const hasUnallocated = normalized.some((row) => row.id === APP_UNALLOCATED_BUDGET_HEAD.id);
    if (!hasUnallocated) normalized.unshift({ ...APP_UNALLOCATED_BUDGET_HEAD });

    const byParent = new Map();
    normalized.forEach((row) => {
        const parentKey = row.parentId || '';
        if (!byParent.has(parentKey)) byParent.set(parentKey, []);
        byParent.get(parentKey).push(row);
    });
    byParent.forEach((list) => list.sort((a, b) => String(a.code || a.id).localeCompare(String(b.code || b.id))));

    const ordered = [];
    const visit = (parentId, depth, trail = new Set()) => {
        const children = byParent.get(parentId) || [];
        for (const child of children) {
            const childId = String(child.id || '');
            if (!childId || trail.has(childId)) continue;
            ordered.push({ ...child, depth });
            const nextTrail = new Set(trail);
            nextTrail.add(childId);
            visit(childId, depth + 1, nextTrail);
        }
    };
    visit('', 0);

    // Include orphans with invalid parent links.
    normalized.forEach((row) => {
        if (!ordered.some((x) => x.id === row.id)) {
            ordered.push({ ...row, depth: 0 });
        }
    });

    return ordered;
}

export async function ensureBudgetHeadCatalog(db = getDB()) {
    const existing = await db.get('budget_heads', APP_UNALLOCATED_BUDGET_HEAD.id).catch(() => null);
    if (!existing) {
        await db.put('budget_heads', {
            ...APP_UNALLOCATED_BUDGET_HEAD,
            owner: 'system',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }).catch(() => null);
    }
}

export async function getBudgetHeadLabel(budgetHeadId, db = getDB()) {
    const normalizedId = normalizeBudgetHeadId(budgetHeadId);
    if (normalizedId === APP_UNALLOCATED_BUDGET_HEAD.id) return APP_UNALLOCATED_BUDGET_HEAD.name;
    const row = await db.get('budget_heads', normalizedId).catch(() => null);
    return row?.name || row?.code || normalizedId;
}

export function renderBudgetHeadOptions(selectedId = '', headsCache = null) {
    const heads = Array.isArray(headsCache)
        ? headsCache
        : Array.isArray(window.app_budgetHeadsCache)
            ? window.app_budgetHeadsCache
            : [APP_UNALLOCATED_BUDGET_HEAD];
    const selected = normalizeBudgetHeadId(selectedId);

    const sortedHeads = [...heads].sort((a, b) => {
        if (String(a?.id || '') === APP_UNALLOCATED_BUDGET_HEAD.id) return -1;
        if (String(b?.id || '') === APP_UNALLOCATED_BUDGET_HEAD.id) return 1;
        const aLabel = `${String(a?.code || a?.id || '')} ${String(a?.name || '')}`.trim();
        const bLabel = `${String(b?.code || b?.id || '')} ${String(b?.name || '')}`.trim();
        return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: 'base' });
    });

    return sortedHeads.map((head) => {
        const id = String(head.id || '');
        const depth = Number(head.depth || 0);
        const indent = depth > 0 ? `${'  '.repeat(depth)}↳ ` : '';
        const label = `${indent}${String(head.code || id)} - ${String(head.name || id)}`;
        return `<option value="${id}" ${id === selected ? 'selected' : ''}>${label}</option>`;
    }).join('');
}

export async function refreshBudgetHeadsCache(db = getDB()) {
    await ensureBudgetHeadCatalog(db);
    window.app_budgetHeadsCache = await getActiveBudgetHeads(db);
    return window.app_budgetHeadsCache;
}

if (typeof window !== 'undefined') {
    window.APP_UNALLOCATED_BUDGET_HEAD = APP_UNALLOCATED_BUDGET_HEAD;
    window.app_normalizeBudgetHeadId = normalizeBudgetHeadId;
    window.app_getActiveBudgetHeads = getActiveBudgetHeads;
    window.app_ensureBudgetHeadCatalog = ensureBudgetHeadCatalog;
    window.app_getBudgetHeadLabel = getBudgetHeadLabel;
    window.app_renderBudgetHeadOptions = renderBudgetHeadOptions;
    window.app_refreshBudgetHeadsCache = refreshBudgetHeadsCache;
}
