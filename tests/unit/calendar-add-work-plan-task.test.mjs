import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Calendar } from '../../js/modules/calendar.js';

// Builds a Calendar whose db is an in-memory stub (no Firebase), so we can
// assert exactly what addWorkPlanTask writes for postponed copies — the
// deterministic guarantee behind "the checkout form always has a date".
function makeCalendar(seed = {}) {
    const store = new Map(Object.entries(seed));
    const cal = new Calendar();
    cal.db = {
        async get(collection, id) {
            const v = store.get(`${collection}/${id}`);
            return v ? JSON.parse(JSON.stringify(v)) : null;
        },
        async put(collection, doc) {
            store.set(`${collection}/${doc.id}`, JSON.parse(JSON.stringify(doc)));
            return doc;
        },
        _store: store
    };
    return cal;
}

const USER = { id: 'u1', name: 'Test User' };
const POSTPONE_META = {
    addedFrom: 'postponed',
    sourcePlanId: 'plan_u1_2026-08-13',
    sourceTaskIndex: 2,
    postponedFromDate: '2026-08-13',
    postponedToDate: '2026-08-14',
    status: 'postponed',
    assignedTo: 'u1',
    assignedToName: 'Test User'
};

test('addWorkPlanTask creates the next-day copy with full postpone provenance', async () => {
    const cal = makeCalendar({ 'users/u1': USER });
    await cal.addWorkPlanTask('2026-08-14', 'u1', 'SRWI check (Postponed from 2026-08-13)', [], POSTPONE_META);

    const plan = await cal.getWorkPlan('u1', '2026-08-14');
    assert.ok(plan, 'target plan should exist');
    assert.equal(plan.plans.length, 1);
    const copy = plan.plans[0];
    assert.equal(copy.postponedFromDate, '2026-08-13', 'copy records where it came from');
    assert.equal(copy.postponedToDate, '2026-08-14');
    assert.equal(copy.addedFrom, 'postponed');
    assert.equal(copy.sourcePlanId, 'plan_u1_2026-08-13');
    assert.equal(copy.sourceTaskIndex, 2);
    assert.equal(copy.status, 'postponed');
    assert.equal(copy.assignedTo, 'u1');
});

test('addWorkPlanTask preserves provenance when updating an existing copy (no duplicates)', async () => {
    // Target plan already has the postponed copy (e.g. postpone-then-edit).
    const existing = {
        id: 'plan_u1_2026-08-14',
        userId: 'u1',
        userName: 'Test User',
        date: '2026-08-14',
        plans: [
            {
                task: 'SRWI check (Postponed from 2026-08-13)',
                status: 'postponed',
                addedFrom: 'postponed',
                sourcePlanId: 'plan_u1_2026-08-13',
                sourceTaskIndex: 2,
                postponedFromDate: '2026-08-13',
                assignedTo: 'u1',
                assignedToName: 'Test User'
            }
        ],
        updatedAt: new Date().toISOString()
    };
    const cal = makeCalendar({ 'users/u1': USER, 'work_plans/plan_u1_2026-08-14': existing });
    await cal.addWorkPlanTask('2026-08-14', 'u1', 'SRWI check EDITED (Postponed from 2026-08-13)', [], POSTPONE_META);

    const plan = await cal.getWorkPlan('u1', '2026-08-14');
    assert.equal(plan.plans.length, 1, 'must not create a duplicate copy');
    const copy = plan.plans[0];
    assert.equal(copy.task, 'SRWI check EDITED (Postponed from 2026-08-13)');
    assert.equal(copy.postponedFromDate, '2026-08-13', 'provenance survives the update');
    assert.equal(copy.postponedToDate, '2026-08-14');
    assert.equal(copy.addedFrom, 'postponed');
});

test('addWorkPlanTask does not invent provenance for a plain (non-postponed) task', async () => {
    const cal = makeCalendar({ 'users/u1': USER });
    await cal.addWorkPlanTask('2026-08-14', 'u1', 'Plain task', []);
    const plan = await cal.getWorkPlan('u1', '2026-08-14');
    assert.equal(plan.plans.length, 1);
    const copy = plan.plans[0];
    assert.equal(copy.addedFrom, 'minutes');
    assert.equal(copy.postponedFromDate, null);
    assert.equal(copy.postponedToDate, null);
});
