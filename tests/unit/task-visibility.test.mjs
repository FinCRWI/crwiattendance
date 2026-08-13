import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isPrivateTask,
    isTaskVisibleToViewer,
    stripPrivateTasksForViewer
} from '../../js/utils/task-visibility.js';

const publicTask = { task: 'File the report', isPrivate: false };
const privateTask = { task: 'Book the doctor appointment', isPrivate: true };
const privateAssignedTask = { task: 'Prepare quarterly review slides', isPrivate: true, assignedTo: 'u_assignee' };

describe('isPrivateTask', () => {
    it('flags tasks with isPrivate === true', () => {
        assert.equal(isPrivateTask(privateTask), true);
        assert.equal(isPrivateTask(privateAssignedTask), true);
    });

    it('does not flag public or flagless tasks', () => {
        assert.equal(isPrivateTask(publicTask), false);
        assert.equal(isPrivateTask({ task: 'No flag' }), false);
        assert.equal(isPrivateTask(null), false);
        assert.equal(isPrivateTask(undefined), false);
    });
});

describe('isTaskVisibleToViewer', () => {
    it('public tasks are visible to everyone, even without a viewer', () => {
        assert.equal(isTaskVisibleToViewer(publicTask, 'u_owner', 'u_admin'), true);
        assert.equal(isTaskVisibleToViewer(publicTask, 'u_owner', ''), true);
    });

    it('private tasks are visible to the plan owner', () => {
        assert.equal(isTaskVisibleToViewer(privateTask, 'u_owner', 'u_owner'), true);
    });

    it('private tasks are visible to the assignee', () => {
        assert.equal(isTaskVisibleToViewer(privateAssignedTask, 'u_owner', 'u_assignee'), true);
    });

    it('private tasks are hidden from everyone else', () => {
        assert.equal(isTaskVisibleToViewer(privateTask, 'u_owner', 'u_admin'), false);
        assert.equal(isTaskVisibleToViewer(privateTask, 'u_owner', 'u_other_staff'), false);
    });

    it('private tasks are hidden when there is no viewer (server/aggregation context)', () => {
        assert.equal(isTaskVisibleToViewer(privateTask, 'u_owner', ''), false);
        assert.equal(isTaskVisibleToViewer(privateAssignedTask, 'u_owner', ''), false);
    });

    it('private tasks without an assignee are visible only to the owner', () => {
        assert.equal(isTaskVisibleToViewer(privateTask, 'u_owner', 'u_other'), false);
        assert.equal(isTaskVisibleToViewer(privateTask, 'u_owner', 'u_owner'), true);
    });
});

describe('stripPrivateTasksForViewer', () => {
    const plans = [
        {
            id: 'plan_u_owner_2026-08-13',
            userId: 'u_owner',
            date: '2026-08-13',
            plans: [publicTask, privateTask]
        },
        {
            id: 'plan_u_owner2_2026-08-13',
            userId: 'u_owner2',
            date: '2026-08-13',
            plans: [publicTask, privateAssignedTask]
        }
    ];

    it('strips private tasks from plans the viewer does not own', () => {
        const result = stripPrivateTasksForViewer(plans, 'u_other_staff');
        assert.equal(result[0].plans.length, 1);
        assert.equal(result[0].plans[0].task, 'File the report');
        assert.equal(result[1].plans.length, 1);
        assert.equal(result[1].plans[0].task, 'File the report');
    });

    it('keeps private tasks for the plan owner', () => {
        const result = stripPrivateTasksForViewer(plans, 'u_owner');
        assert.equal(result[0].plans.length, 2);
        assert.equal(result[0].plans.some((t) => t.isPrivate === true), true);
        assert.equal(result[1].plans.length, 1);
    });

    it('keeps private tasks for the assignee even in another owners plan', () => {
        const result = stripPrivateTasksForViewer(plans, 'u_assignee');
        assert.equal(result[1].plans.length, 2);
        assert.equal(result[1].plans.some((t) => t.task === 'Prepare quarterly review slides'), true);
        assert.equal(result[0].plans.length, 1);
    });

    it('returns plans without private tasks unchanged (same reference)', () => {
        const noPrivate = [{ id: 'x', userId: 'u1', plans: [publicTask] }];
        const result = stripPrivateTasksForViewer(noPrivate, 'u_other');
        assert.equal(result[0], noPrivate[0]);
    });

    it('passes through empty and non-array input', () => {
        assert.deepEqual(stripPrivateTasksForViewer([], 'u1'), []);
        assert.deepEqual(stripPrivateTasksForViewer(null, 'u1'), []);
        assert.deepEqual(stripPrivateTasksForViewer(undefined, 'u1'), []);
    });
});
