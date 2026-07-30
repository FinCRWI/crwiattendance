import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTaskStatus } from '../../js/utils/task-status.js';

describe('task-status', () => {
    it('keeps completed status closed even without smart status support', () => {
        const result = normalizeTaskStatus({ status: 'completed' }, '2026-07-30', null);
        assert.equal(result, 'completed');
    });

    it('keeps postponed status closed when postponed metadata is present', () => {
        const result = normalizeTaskStatus(
            { status: '', postponedFromDate: '2026-07-29', addedFrom: 'postponed' },
            '2026-07-30',
            null
        );
        assert.equal(result, 'postponed');
    });

    it('falls back to smart status for open tasks', () => {
        const result = normalizeTaskStatus(
            { status: '' },
            '2026-07-30',
            () => 'in-process'
        );
        assert.equal(result, 'in-process');
    });
});
