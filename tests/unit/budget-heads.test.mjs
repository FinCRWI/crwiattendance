import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    APP_UNALLOCATED_BUDGET_HEAD,
    normalizeBudgetHeadId,
    getActiveBudgetHeads,
    ensureBudgetHeadCatalog,
    getBudgetHeadLabel,
    renderBudgetHeadOptions,
    refreshBudgetHeadsCache
} from '../../js/modules/budget-heads.js';

function createDB({ getAll, get, put } = {}) {
    return {
        getAll: getAll ?? (async () => []),
        get: get ?? (async () => null),
        put: put ?? (async () => null)
    };
}

describe('budget-heads', () => {
    beforeEach(() => {
        global.window = { AppDB: createDB({}) };
    });

    it('normalizes empty values to UNALLOCATED', () => {
        assert.equal(normalizeBudgetHeadId(''), APP_UNALLOCATED_BUDGET_HEAD.id);
        assert.equal(normalizeBudgetHeadId(null), APP_UNALLOCATED_BUDGET_HEAD.id);
        assert.equal(normalizeBudgetHeadId('  '), APP_UNALLOCATED_BUDGET_HEAD.id);
        assert.equal(normalizeBudgetHeadId('SALARY'), 'SALARY');
    });

    it('ensures the unallocated catalog entry exists', async () => {
        let putCalled = false;
        const db = createDB({
            get: async (_collection, id) => (id === APP_UNALLOCATED_BUDGET_HEAD.id ? null : null),
            put: async () => { putCalled = true; }
        });
        await ensureBudgetHeadCatalog(db);
        assert.equal(putCalled, true);
    });

    it('does not write the catalog entry if it already exists', async () => {
        let putCalled = false;
        const db = createDB({
            get: async (_collection, id) => (id === APP_UNALLOCATED_BUDGET_HEAD.id ? { id: APP_UNALLOCATED_BUDGET_HEAD.id } : null),
            put: async () => { putCalled = true; }
        });
        await ensureBudgetHeadCatalog(db);
        assert.equal(putCalled, false);
    });

    it('returns active budget heads sorted hierarchically', async () => {
        const db = createDB({
            getAll: async () => [
                { id: 'B', code: 'B', name: 'Benefits', parentId: '', status: 'active' },
                { id: 'A', code: 'A', name: 'Admin', parentId: '', status: 'active' },
                { id: 'A1', code: 'A1', name: 'Office Admin', parentId: 'A', status: 'active' }
            ]
        });
        const heads = await getActiveBudgetHeads(db);
        const ids = heads.map((h) => h.id);
        assert.ok(ids.includes(APP_UNALLOCATED_BUDGET_HEAD.id));
        assert.ok(ids.indexOf('A') < ids.indexOf('A1'), 'children should follow parent');
    });

    it('filters out inactive budget heads', async () => {
        const db = createDB({
            getAll: async () => [
                { id: 'A', code: 'A', name: 'Active', status: 'active' },
                { id: 'I', code: 'I', name: 'Inactive', status: 'inactive' }
            ]
        });
        const heads = await getActiveBudgetHeads(db);
        assert.ok(heads.some((h) => h.id === 'A'));
        assert.ok(!heads.some((h) => h.id === 'I'));
    });

    it('returns the unallocated label for the unallocated id', async () => {
        const label = await getBudgetHeadLabel(APP_UNALLOCATED_BUDGET_HEAD.id, createDB({}));
        assert.equal(label, APP_UNALLOCATED_BUDGET_HEAD.name);
    });

    it('looks up the budget head label from the database', async () => {
        const db = createDB({ get: async (_collection, id) => (id === 'SALARY' ? { id: 'SALARY', name: 'Salaries', code: 'SAL' } : null) });
        const label = await getBudgetHeadLabel('SALARY', db);
        assert.equal(label, 'Salaries');
    });

    it('renders budget head options with unallocated first', () => {
        const html = renderBudgetHeadOptions('', [
            APP_UNALLOCATED_BUDGET_HEAD,
            { id: 'B', code: 'B', name: 'Benefits', depth: 0 },
            { id: 'A', code: 'A', name: 'Admin', depth: 0 }
        ]);
        assert.ok(html.includes('value="UNALLOCATED"'));
        assert.ok(html.indexOf('UNALLOCATED') < html.indexOf('value="A"'), 'UNALLOCATED should come first');
    });

    it('refreshBudgetHeadsCache populates window.app_budgetHeadsCache', async () => {
        const db = createDB({ getAll: async () => [] });
        global.window = { AppDB: db, app_budgetHeadsCache: null };
        const result = await refreshBudgetHeadsCache(db);
        assert.ok(Array.isArray(result));
        assert.equal(global.window.app_budgetHeadsCache, result);
    });
});
