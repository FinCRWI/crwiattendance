import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    isAdminUser,
    canSeeAdminPanel,
    hasPerm,
    canAccessLetterPad,
    canManageAttendanceSheet,
    canAccessStaffAiMemory,
    canManageBirthdays,
    canAdminBirthdays
} from '../../js/modules/permissions.js';

function withUser(user) {
    global.window = { AppAuth: { getUser: () => user } };
}

describe('permissions', () => {
    beforeEach(() => {
        global.window = { AppAuth: { getUser: () => null } };
    });

    it('isAdminUser returns true only for isAdmin === true', () => {
        assert.equal(isAdminUser({ isAdmin: true }), true);
        assert.equal(isAdminUser({ isAdmin: 'true' }), false);
        assert.equal(isAdminUser({ isAdmin: false }), false);
        assert.equal(isAdminUser(null), false);
    });

    it('hasPerm lets global admins do anything', () => {
        const admin = { isAdmin: true };
        assert.equal(hasPerm('dashboard', 'admin', admin), true);
        assert.equal(hasPerm('users', 'view', admin), true);
    });

    it('hasPerm checks module permissions', () => {
        const user = { permissions: { dashboard: 'view', users: 'admin' } };
        assert.equal(hasPerm('dashboard', 'view', user), true);
        assert.equal(hasPerm('dashboard', 'admin', user), false);
        assert.equal(hasPerm('users', 'admin', user), true);
        assert.equal(hasPerm('reports', 'view', user), false);
    });

    it('canSeeAdminPanel lets admins in', () => {
        assert.equal(canSeeAdminPanel({ isAdmin: true }), true);
    });

    it('canSeeAdminPanel lets users with any non-birthday/letterPad admin perm in', () => {
        assert.equal(canSeeAdminPanel({ permissions: { users: 'admin' } }), true);
        assert.equal(canSeeAdminPanel({ permissions: { birthday: 'admin' } }), false);
        assert.equal(canSeeAdminPanel({ permissions: { letterPad: 'admin' } }), false);
    });

    it('canAccessLetterPad reads letterPad permission', () => {
        assert.equal(canAccessLetterPad({ permissions: { letterPad: 'view' } }), true);
        assert.equal(canAccessLetterPad({ permissions: { letterPad: 'admin' } }), true);
        assert.equal(canAccessLetterPad({ permissions: {} }), false);
    });

    it('canManageAttendanceSheet checks attendance admin or explicit flag', () => {
        assert.equal(canManageAttendanceSheet({ permissions: { attendance: 'admin' } }), true);
        assert.equal(canManageAttendanceSheet({ canManageAttendanceSheet: true }), true);
        assert.equal(canManageAttendanceSheet({ permissions: { attendance: 'view' } }), false);
    });

    it('canAccessStaffAiMemory checks admin, users admin or explicit flag', () => {
        assert.equal(canAccessStaffAiMemory({ isAdmin: true }), true);
        assert.equal(canAccessStaffAiMemory({ permissions: { users: 'admin' } }), true);
        assert.equal(canAccessStaffAiMemory({ canAccessStaffAiMemory: true }), true);
        assert.equal(canAccessStaffAiMemory({ permissions: {} }), false);
    });

    it('canManageBirthdays checks admin, role, explicit flag or birthday view perm', () => {
        assert.equal(canManageBirthdays({ isAdmin: true }), true);
        assert.equal(canManageBirthdays({ role: 'Administrator' }), true);
        assert.equal(canManageBirthdays({ canManageBirthdays: true }), true);
        assert.equal(canManageBirthdays({ permissions: { birthday: 'view' } }), true);
        assert.equal(canManageBirthdays({ permissions: {} }), false);
    });

    it('canAdminBirthdays checks admin, role, explicit flag or birthday admin perm', () => {
        assert.equal(canAdminBirthdays({ isAdmin: true }), true);
        assert.equal(canAdminBirthdays({ role: 'Administrator' }), true);
        assert.equal(canAdminBirthdays({ canManageBirthdays: true }), true);
        assert.equal(canAdminBirthdays({ permissions: { birthday: 'admin' } }), true);
        assert.equal(canAdminBirthdays({ permissions: { birthday: 'view' } }), false);
    });

    it('falls back to the currently authenticated user', () => {
        withUser({ isAdmin: true });
        assert.equal(isAdminUser(), true);
        assert.equal(hasPerm('users', 'admin'), true);
    });
});
