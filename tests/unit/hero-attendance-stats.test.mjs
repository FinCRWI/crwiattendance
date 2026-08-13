import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Analytics } from '../../js/modules/analytics.js';

const analytics = new Analytics();

const log = (userId, workDescription) => ({
    userId,
    activityLogDepth: String(workDescription || '').length
});

describe('hero-attendance-stats', () => {
    it('counts substantive work descriptions as completed evidence', () => {
        const stats = analytics.buildAttendanceTaskStats([
            log('u1', 'Completed the full QA pass on the checkout module and filed two defects.'),
            log('u1', 'Ran the monthly payroll reconciliation and resolved the variance.'),
            log('u1', 'Reviewed the Q3 design system rollout with the UI team.')
        ]);
        const bucket = stats.get('u1');
        assert.equal(bucket.planned, 3);
        // All descriptions are >= the 40-char evidence threshold → full credit.
        assert.equal(bucket.completed, 3);
    });

    it('does not grant full completion credit for terse log entries', () => {
        const stats = analytics.buildAttendanceTaskStats([
            log('u2', 'done'),
            log('u2', 'ok'),
            log('u2', 'worked'),
            log('u2', 'finished'),
            log('u2', 'no')
        ]);
        const bucket = stats.get('u2');
        assert.equal(bucket.planned, 5);
        // 5 terse logs earn ~0.55 completed credit → rounds to 1, NOT the old 5/5 = 100%.
        assert.ok(bucket.completed < bucket.planned);
        assert.equal(bucket.completed, 1);
    });

    it('ignores logs without a work description', () => {
        const stats = analytics.buildAttendanceTaskStats([
            log('u3', ''),
            { userId: 'u3', activityLogDepth: 0 },
            null,
            undefined
        ]);
        assert.equal(stats.size, 0);
    });

    it('mergeTaskStats only applies attendance evidence to users with no work-plan tasks', () => {
        const base = new Map([
            ['u1', { planned: 2, completed: 1, inProgress: 1, missed: 0, postponed: 0 }]
        ]);
        const extra = new Map([
            ['u1', { planned: 5, completed: 5, inProgress: 0, missed: 0, postponed: 0 }],
            ['u2', { planned: 3, completed: 1, inProgress: 0, missed: 0, postponed: 0 }]
        ]);
        const merged = analytics.mergeTaskStats(base, extra);
        // u1 already has work-plan evidence → attendance stats must NOT be applied.
        assert.deepEqual(merged.get('u1'), { planned: 2, completed: 1, inProgress: 1, missed: 0, postponed: 0 });
        // u2 has no work-plan evidence → attendance stats are applied as a fallback.
        assert.deepEqual(merged.get('u2'), { planned: 3, completed: 1, inProgress: 0, missed: 0, postponed: 0 });
    });
});
