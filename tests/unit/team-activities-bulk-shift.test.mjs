import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyTeamActivitiesBulkShift,
    buildTeamActivitiesBulkShiftPlan
} from '../../js/utils/team-activities-bulk-shift.js';

function createMemoryDb(initial = {}) {
    const store = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]));
    return {
        async get(collection, id) {
            const key = `${collection}:${id}`;
            const value = store.get(key);
            return value ? JSON.parse(JSON.stringify(value)) : null;
        },
        async put(collection, value) {
            const key = `${collection}:${value.id}`;
            store.set(key, JSON.parse(JSON.stringify(value)));
            return value;
        },
        dump(collection, id) {
            const key = `${collection}:${id}`;
            const value = store.get(key);
            return value ? JSON.parse(JSON.stringify(value)) : null;
        }
    };
}

describe('team-activities bulk time shift', () => {
    it('builds eligibility from checked-in and checked-out staff while skipping closed work', () => {
        const plan = buildTeamActivitiesBulkShiftPlan({
            pivotDate: '2026-07-30',
            users: [
                { id: 'u-in', status: 'in' },
                { id: 'u-out', status: 'out' }
            ],
            rows: [
                {
                    date: '2026-07-29',
                    staffName: 'Inside Staff',
                    userId: 'u-in',
                    planId: 'plan_u-in_2026-07-29',
                    taskIndex: 0,
                    planScope: 'personal',
                    type: 'work',
                    status: 'in-process'
                },
                {
                    date: '2026-07-29',
                    staffName: 'Outside Staff',
                    userId: 'u-out',
                    planId: 'plan_u-out_2026-07-29',
                    taskIndex: 0,
                    planScope: 'personal',
                    type: 'work',
                    status: 'overdue'
                },
                {
                    date: '2026-07-30',
                    staffName: 'Outside Staff',
                    userId: 'u-out',
                    planId: 'plan_u-out_2026-07-30',
                    taskIndex: 1,
                    planScope: 'personal',
                    type: 'work',
                    status: 'to-be-started'
                },
                {
                    date: '2026-07-30',
                    staffName: 'Outside Staff',
                    userId: 'u-out',
                    planId: 'plan_u-out_2026-07-30',
                    taskIndex: 2,
                    planScope: 'personal',
                    type: 'work',
                    status: 'completed'
                }
            ]
        });

        assert.equal(plan.actions.length, 3);
        assert.equal(plan.summary.movedToToday, 1);
        assert.equal(plan.summary.postponedToTomorrow, 2);
        assert.equal(plan.summary.skipped, 1);
        const actionBySourcePlan = Object.fromEntries(plan.actions.map((action) => [action.sourcePlanId, action]));
        assert.equal(actionBySourcePlan['plan_u-in_2026-07-29'].targetDate, '2026-07-30');
        assert.equal(actionBySourcePlan['plan_u-out_2026-07-30'].targetDate, '2026-07-31');
        assert.equal(actionBySourcePlan['plan_u-out_2026-07-29'].targetDate, '2026-07-31');
    });

    it('moves source rows off the original date and preserves lineage metadata', async () => {
        const db = createMemoryDb({
            'work_plans:plan_u-in_2026-07-29': {
                id: 'plan_u-in_2026-07-29',
                userId: 'u-in',
                userName: 'Inside Staff',
                date: '2026-07-29',
                planScope: 'personal',
                plans: [
                    {
                        task: 'Prepare report',
                        status: 'in-process',
                        budgetHeadId: 'OPS',
                        tags: [{ id: 'tag-1', name: 'Urgent' }],
                        sourcePlanId: 'plan_u-in_2026-07-29',
                        sourceTaskIndex: 0
                    }
                ]
            },
            'work_plans:plan_u-out_2026-07-30': {
                id: 'plan_u-out_2026-07-30',
                userId: 'u-out',
                userName: 'Outside Staff',
                date: '2026-07-30',
                planScope: 'personal',
                plans: [
                    {
                        task: 'Call supplier',
                        status: 'in-process',
                        budgetHeadId: 'OPS',
                        tags: [{ id: 'tag-2', name: 'Follow up' }],
                        sourcePlanId: 'plan_u-out_2026-07-30',
                        sourceTaskIndex: 0
                    }
                ]
            },
            'work_plans:plan_u-out_2026-07-29': {
                id: 'plan_u-out_2026-07-29',
                userId: 'u-out',
                userName: 'Outside Staff',
                date: '2026-07-29',
                planScope: 'personal',
                plans: [
                    {
                        task: 'Review overdue',
                        status: 'overdue',
                        budgetHeadId: 'OPS',
                        tags: [{ id: 'tag-3', name: 'Escalated' }],
                        sourcePlanId: 'plan_u-out_2026-07-29',
                        sourceTaskIndex: 0
                    }
                ]
            }
        });

        const result = await applyTeamActivitiesBulkShift({
            pivotDate: '2026-07-30',
            users: [
                { id: 'u-in', status: 'in' },
                { id: 'u-out', status: 'out' }
            ],
            rows: [
                {
                    date: '2026-07-29',
                    staffName: 'Inside Staff',
                    userId: 'u-in',
                    planId: 'plan_u-in_2026-07-29',
                    taskIndex: 0,
                    planScope: 'personal',
                    type: 'work',
                    status: 'in-process',
                    budgetHeadId: 'OPS',
                    tags: [{ id: 'tag-1', name: 'Urgent' }]
                },
                {
                    date: '2026-07-29',
                    staffName: 'Outside Staff',
                    userId: 'u-out',
                    planId: 'plan_u-out_2026-07-29',
                    taskIndex: 0,
                    planScope: 'personal',
                    type: 'work',
                    status: 'overdue',
                    budgetHeadId: 'OPS',
                    tags: [{ id: 'tag-3', name: 'Escalated' }]
                },
                {
                    date: '2026-07-30',
                    staffName: 'Outside Staff',
                    userId: 'u-out',
                    planId: 'plan_u-out_2026-07-30',
                    taskIndex: 0,
                    planScope: 'personal',
                    type: 'work',
                    status: 'in-process',
                    budgetHeadId: 'OPS',
                    tags: [{ id: 'tag-2', name: 'Follow up' }]
                }
            ],
            db,
            calendar: {
                normalizePlanScope(scope) {
                    return String(scope || 'personal').toLowerCase() === 'annual' ? 'annual' : 'personal';
                },
                getWorkPlanId(date, userId, scope) {
                    return String(scope || 'personal').toLowerCase() === 'annual'
                        ? `plan_annual_${date}`
                        : `plan_${userId}_${date}`;
                }
            },
            currentUser: { id: 'admin-1', name: 'Admin' },
            nowIso: '2026-07-30T10:00:00.000Z'
        });

        assert.equal(result.applied, 3);
        assert.equal(result.movedToToday, 1);
        assert.equal(result.postponedToTomorrow, 2);

        const sourceIn = db.dump('work_plans', 'plan_u-in_2026-07-29');
        const sourceOut = db.dump('work_plans', 'plan_u-out_2026-07-30');
        const sourceOutOverdue = db.dump('work_plans', 'plan_u-out_2026-07-29');
        const targetIn = db.dump('work_plans', 'plan_u-in_2026-07-30');
        const targetOut = db.dump('work_plans', 'plan_u-out_2026-07-31');

        assert.equal(sourceIn.plans.length, 0);
        assert.equal(sourceOut.plans.length, 0);
        assert.equal(sourceOutOverdue.plans.length, 0);

        assert.equal(targetIn.plans.length, 1);
        assert.equal(targetIn.plans[0].startDate, '2026-07-30');
        assert.equal(targetIn.plans[0].endDate, '2026-07-30');
        assert.equal(targetIn.plans[0].carriedForwardFromDate, '2026-07-29');
        assert.equal(targetIn.plans[0].carriedForwardFromPlanId, 'plan_u-in_2026-07-29');
        assert.equal(targetIn.plans[0].sourcePlanId, 'plan_u-in_2026-07-29');
        assert.equal(targetIn.plans[0].sourceTaskIndex, 0);
        assert.equal(targetIn.plans[0].assignedTo, 'u-in');
        assert.deepEqual(targetIn.plans[0].tags, [{ id: 'tag-1', name: 'Urgent' }]);

        assert.equal(targetOut.plans.length, 2);
        const targetOutBySource = Object.fromEntries(targetOut.plans.map((task) => [task.sourcePlanId, task]));
        assert.equal(targetOutBySource['plan_u-out_2026-07-30'].startDate, '2026-07-31');
        assert.equal(targetOutBySource['plan_u-out_2026-07-30'].endDate, '2026-07-31');
        assert.equal(targetOutBySource['plan_u-out_2026-07-30'].status, 'postponed');
        assert.equal(targetOutBySource['plan_u-out_2026-07-30'].postponedFromDate, '2026-07-30');
        assert.equal(targetOutBySource['plan_u-out_2026-07-30'].sourceTaskIndex, 0);
        assert.equal(targetOutBySource['plan_u-out_2026-07-30'].assignedTo, 'u-out');
        assert.deepEqual(targetOutBySource['plan_u-out_2026-07-30'].tags, [{ id: 'tag-2', name: 'Follow up' }]);
        assert.equal(targetOutBySource['plan_u-out_2026-07-29'].startDate, '2026-07-31');
        assert.equal(targetOutBySource['plan_u-out_2026-07-29'].endDate, '2026-07-31');
        assert.equal(targetOutBySource['plan_u-out_2026-07-29'].status, 'postponed');
        assert.equal(targetOutBySource['plan_u-out_2026-07-29'].postponedFromDate, '2026-07-29');
        assert.equal(targetOutBySource['plan_u-out_2026-07-29'].sourceTaskIndex, 0);
        assert.equal(targetOutBySource['plan_u-out_2026-07-29'].assignedTo, 'u-out');
        assert.deepEqual(targetOutBySource['plan_u-out_2026-07-29'].tags, [{ id: 'tag-3', name: 'Escalated' }]);
    });
});
