import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckoutTaskMutation } from '../../js/modules/checkout-task-updates.js';

describe('checkout-task-updates', () => {
    it('marks completed tasks as completed with a completedDate', () => {
        const result = buildCheckoutTaskMutation(
            { task: 'Write report', status: 'pending', budgetHeadId: 'SALARY' },
            {
                action: 'complete',
                progressPercent: 100,
                progressStatus: 'done',
                progressNote: 'Done',
                budgetHeadId: 'SALARY',
                timestamp: '2026-07-30T10:00:00.000Z'
            },
            { effectiveDate: '2026-07-30', currentUserId: 'u1', planDate: '2026-07-30' }
        );

        assert.equal(result.nextTask.status, 'completed');
        assert.equal(result.nextTask.completedDate, '2026-07-30');
        assert.equal(result.postponedTask, null);
    });

    it('builds a postponed follow-up task and marks the source task postponed', () => {
        const result = buildCheckoutTaskMutation(
            {
                task: 'Call vendor',
                status: 'pending',
                budgetHeadId: 'OPS',
                subPlans: ['Follow up'],
                tags: [{ id: 't1', name: 'Urgent' }]
            },
            {
                action: 'postpone',
                progressPercent: 0,
                progressStatus: 'waiting',
                progressNote: '',
                budgetHeadId: 'OPS',
                actionMeta: { postponeDate: '2026-08-02', postponeReason: 'Waiting on vendor' },
                planId: 'plan_1',
                taskIndex: 3,
                timestamp: '2026-07-30T10:00:00.000Z'
            },
            { effectiveDate: '2026-07-30', currentUserId: 'u1', planDate: '2026-07-30' }
        );

        assert.equal(result.nextTask.status, 'postponed');
        assert.equal(result.postponedTask.date, '2026-08-02');
        assert.equal(result.postponedTask.taskDescription, 'Call vendor - Follow up (Postponed from 2026-07-30)');
        assert.equal(result.postponedTask.meta.addedFrom, 'postponed');
        assert.equal(result.postponedTask.meta.sourcePlanId, 'plan_1');
        assert.equal(result.postponedTask.meta.sourceTaskIndex, 3);
        assert.equal(result.postponedTask.meta.postponedFromDate, '2026-07-30');
        assert.equal(result.postponedTask.meta.status, 'postponed');
        assert.equal(result.postponedTask.meta.assignedTo, 'u1');
        assert.equal(result.postponedTask.meta.assignedToName, '');
        assert.deepEqual(result.postponedTask.meta.tags, [{ id: 't1', name: 'Urgent' }]);
    });

    it('returns postponeError when postpone date is not after source date', () => {
        const result = buildCheckoutTaskMutation(
            { task: 'Follow up', status: 'pending', budgetHeadId: 'OPS' },
            {
                action: 'postpone',
                progressPercent: 0,
                progressStatus: '',
                progressNote: '',
                budgetHeadId: 'OPS',
                actionMeta: { postponeDate: '2026-07-29' },
                planId: 'plan_1',
                taskIndex: 0,
                timestamp: '2026-07-30T10:00:00.000Z'
            },
            { effectiveDate: '2026-07-30', currentUserId: 'u1', planDate: '2026-07-30' }
        );

        assert.equal(result.nextTask.status, 'pending');
        assert.equal(result.nextTask.lastCheckoutAction, '');
        assert.equal(result.postponedTask, null);
        assert.ok(result.postponeError);
    });

    it('returns postponeError when no postpone date is provided', () => {
        const result = buildCheckoutTaskMutation(
            { task: 'Follow up', status: 'pending', budgetHeadId: 'OPS' },
            {
                action: 'postpone',
                progressPercent: 0,
                progressStatus: '',
                progressNote: '',
                budgetHeadId: 'OPS',
                actionMeta: {},
                planId: 'plan_1',
                taskIndex: 0,
                timestamp: '2026-07-30T10:00:00.000Z'
            },
            { effectiveDate: '2026-07-30', currentUserId: 'u1', planDate: '2026-07-30' }
        );

        assert.equal(result.nextTask.status, 'pending');
        assert.equal(result.postponedTask, null);
        assert.ok(result.postponeError);
    });
});
