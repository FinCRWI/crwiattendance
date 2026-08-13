import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeTaskProvenance, deserializeTaskProvenance, formatPostponeChip } from '../../js/utils/task-provenance.js';

test('serializes postpone/carry-forward provenance fields only', () => {
    const json = serializeTaskProvenance({
        task: 'Do the report',
        status: 'postponed',
        postponedFromDate: '2026-08-12',
        postponedToDate: '2026-08-14',
        addedFrom: 'postponed',
        sourcePlanId: 'plan_u1_2026-08-12',
        sourceTaskIndex: 3,
        isAutoForwarded: true,
        progressPercent: 40,
        progressStatus: 'started',
        progressNote: 'Waiting on vendor',
        completedDate: null,
        extraNoise: 'should not appear'
    });
    const parsed = JSON.parse(json);
    assert.equal(parsed.postponedFromDate, '2026-08-12');
    assert.equal(parsed.postponedToDate, '2026-08-14');
    assert.equal(parsed.addedFrom, 'postponed');
    assert.equal(parsed.sourcePlanId, 'plan_u1_2026-08-12');
    assert.equal(parsed.sourceTaskIndex, 3);
    assert.equal(parsed.isAutoForwarded, true);
    assert.equal(parsed.progressPercent, 40);
    assert.equal(parsed.progressStatus, 'started');
    assert.equal(parsed.progressNote, 'Waiting on vendor');
    // Explicitly-managed fields are NOT part of provenance.
    assert.equal(parsed.task, undefined);
    assert.equal(parsed.status, undefined);
    // Non-provenance fields are excluded.
    assert.equal(parsed.extraNoise, undefined);
    assert.equal(parsed.completedDate, undefined);
});

test('round-trips through serialize -> deserialize', () => {
    const original = {
        postponedFromDate: '2026-08-11',
        addedFrom: 'carry-forward',
        carriedForwardFromDate: '2026-08-10',
        carriedForwardFromPlanId: 'plan_x_2026-08-10',
        isAutoForwarded: true,
        progressPercent: 25
    };
    const restored = deserializeTaskProvenance(serializeTaskProvenance(original));
    assert.deepEqual(restored, original);
});

test('keeps extras like the original status for newly-postponed detection', () => {
    const json = serializeTaskProvenance({ status: 'postponed', task: 'x' }, { _originalStatus: 'in-process' });
    const parsed = deserializeTaskProvenance(json);
    assert.equal(parsed._originalStatus, 'in-process');
});

test('deserialize handles empty, null, and malformed input safely', () => {
    assert.deepEqual(deserializeTaskProvenance(''), {});
    assert.deepEqual(deserializeTaskProvenance(null), {});
    assert.deepEqual(deserializeTaskProvenance(undefined), {});
    assert.deepEqual(deserializeTaskProvenance('not-json{'), {});
    assert.deepEqual(deserializeTaskProvenance('[]'), {});
});

test('serialize returns empty string when there is nothing to preserve', () => {
    assert.equal(serializeTaskProvenance({ task: 'plain task', status: null }), '');
    assert.equal(serializeTaskProvenance(null), '');
});

test('chip shows "Postponed to" on the source task', () => {
    const chip = formatPostponeChip({ status: 'postponed', postponedToDate: '2026-08-14', task: 'x' });
    assert.ok(chip.includes('postponed-target-chip'));
    assert.ok(chip.includes('Postponed to 2026-08-14'));
});

test('chip shows "Postponed from" on the next-day copy (the checkout-form case)', () => {
    const chip = formatPostponeChip({ status: 'postponed', addedFrom: 'postponed', postponedFromDate: '2026-08-13', task: 'x' });
    assert.ok(chip.includes('postponed-target-chip'));
    assert.ok(chip.includes('Postponed from 2026-08-13'));
    // Works even when addedFrom is missing but the provenance date is present.
    const chip2 = formatPostponeChip({ status: 'postponed', postponedFromDate: '2026-08-13', task: 'x' });
    assert.ok(chip2.includes('Postponed from 2026-08-13'));
});

test('chip is empty when there is no date to show', () => {
    assert.equal(formatPostponeChip({ status: 'postponed', task: 'x' }), '');
    assert.equal(formatPostponeChip({ status: 'postponed', addedFrom: 'postponed', task: 'x' }), '');
    assert.equal(formatPostponeChip({ status: null, task: 'x' }), '');
    assert.equal(formatPostponeChip({ task: 'x' }), '');
    assert.equal(formatPostponeChip(null), '');
});

test('chip only renders for postponed-status tasks', () => {
    assert.equal(formatPostponeChip({ status: 'in-process', postponedToDate: '2026-08-14', task: 'x' }), '');
    assert.equal(formatPostponeChip({ status: 'done', postponedFromDate: '2026-08-13', task: 'x' }), '');
    // not-completed variants still qualify.
    const chip = formatPostponeChip({ status: 'not-completed', postponedToDate: '2026-08-14', task: 'x' });
    assert.ok(chip.includes('Postponed to 2026-08-14'));
});
