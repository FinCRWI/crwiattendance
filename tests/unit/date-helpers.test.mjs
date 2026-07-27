import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLocalISO } from '../../js/utils/date-helpers.js';

describe('date-helpers', () => {
    it('formats a date as YYYY-MM-DD', () => {
        assert.equal(getLocalISO(new Date(2026, 6, 25)), '2026-07-25');
        assert.equal(getLocalISO(new Date(2026, 0, 1)), '2026-01-01');
        assert.equal(getLocalISO(new Date(2026, 11, 31)), '2026-12-31');
    });

    it('defaults to today', () => {
        const today = new Date();
        const result = getLocalISO();
        const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        assert.equal(result, expected);
    });
});
