import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../../js/modules/db.js';

function makeDb({ planDocs = [], byId = {} } = {}) {
    const db = new Database();
    // Stub the two read paths getDayPlansByIds relies on: getManyByIds for the
    // IN-query path and getDayPlansByDate for the error fallback.
    db.getManyByIds = async (collection, ids = []) => {
        assert.equal(collection, 'work_plans');
        return (ids || []).map((id) => byId[id]).filter(Boolean);
    };
    db.queryManyStrict = async (collection, filters = []) => {
        assert.equal(collection, 'work_plans');
        const dateFilter = (filters || []).find((f) => f.field === 'date');
        return planDocs.filter((p) => !dateFilter || p.date === dateFilter.value);
    };
    return db;
}

test('getDayPlansByIds always includes the annual shared plan id', async () => {
    const db = makeDb();
    let requestedIds = null;
    db.getManyByIds = async (_c, ids) => {
        requestedIds = ids;
        return [];
    };
    const result = await db.getDayPlansByIds('2026-08-13', []);
    assert.deepEqual(result, []);
    assert.ok(requestedIds.includes('plan_annual_2026-08-13'), 'annual id must always be requested');
});

test('getDayPlansByIds builds per-user personal plan ids and skips annual_shared', async () => {
    const byId = {
        'plan_annual_2026-08-13': { id: 'plan_annual_2026-08-13', userId: 'annual_shared', date: '2026-08-13' },
        'plan_u1_2026-08-13': { id: 'plan_u1_2026-08-13', userId: 'u1', date: '2026-08-13' },
        'plan_u2_2026-08-13': { id: 'plan_u2_2026-08-13', userId: 'u2', date: '2026-08-13' }
    };
    const db = makeDb({ byId });
    const plans = await db.getDayPlansByIds('2026-08-13', ['u1', 'u2', 'annual_shared', '', null]);
    const ids = plans.map((p) => p.id).sort();
    assert.deepEqual(ids, ['plan_annual_2026-08-13', 'plan_u1_2026-08-13', 'plan_u2_2026-08-13']);
});

test('getDayPlansByIds returns [] for invalid or missing dates', async () => {
    const db = makeDb();
    assert.deepEqual(await db.getDayPlansByIds('', []), []);
    assert.deepEqual(await db.getDayPlansByIds('not-a-date', ['u1']), []);
});

test('day-plan modal extraction keeps personal + annual and treats the rest as others', async () => {
    // Mirrors loadDayPlanData + openDayPlan logic: fetched plans are keyed by
    // their doc ids, personal/annual are extracted by id, and the remaining
    // docs (other staff personal plans) become "others" blocks.
    const date = '2026-08-13';
    const targetId = 'u1';
    const byId = {
        [`plan_${targetId}_${date}`]: { id: `plan_${targetId}_${date}`, userId: 'u1', date, planScope: 'personal', userName: 'User One', plans: [{ task: 'mine' }] },
        [`plan_annual_${date}`]: { id: `plan_annual_${date}`, userId: 'annual_shared', date, planScope: 'annual', userName: 'All Staff', plans: [{ task: 'team plan' }] },
        [`plan_u2_${date}`]: { id: `plan_u2_${date}`, userId: 'u2', date, planScope: 'personal', userName: 'User Two', plans: [{ task: 'shared ref' }] }
    };
    const db = makeDb({ byId });

    const allDayPlans = await db.getDayPlansByIds(date, ['u1', 'u2']);
    const personalId = `plan_${targetId}_${date}`;
    const annualId = `plan_annual_${date}`;
    const personalWorkPlan = allDayPlans.find((p) => p.id === personalId) || null;
    const annualWorkPlan = allDayPlans.find((p) => p.id === annualId) || null;
    const othersPlans = (allDayPlans || []).filter((p) =>
        p.id !== personalId && p.id !== annualId
    );

    assert.equal(personalWorkPlan.userId, 'u1');
    assert.equal(annualWorkPlan.userId, 'annual_shared');
    assert.deepEqual(othersPlans.map((p) => p.id), [`plan_u2_${date}`]);
});

test('error fallback: getDayPlansByIds failure is caught and date query supplies the plans', async () => {
    const planDocs = [
        { id: 'plan_u1_2026-08-13', date: '2026-08-13' },
        { id: 'plan_annual_2026-08-13', date: '2026-08-13' }
    ];
    const db = makeDb({ planDocs });
    db.getManyByIds = async () => {
        throw new Error('boom');
    };
    // loadDayPlanData wraps the doc-id call in try/catch and falls back here.
    let allDayPlans;
    try {
        allDayPlans = await db.getDayPlansByIds('2026-08-13', ['u1']);
    } catch {
        allDayPlans = await db.getDayPlansByDate('2026-08-13');
    }
    assert.deepEqual(allDayPlans.map((p) => p.id).sort(), [
        'plan_annual_2026-08-13',
        'plan_u1_2026-08-13'
    ]);
});
