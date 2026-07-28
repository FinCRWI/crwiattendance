/**
 * Permission / role helpers used across the app.
 *
 * These functions accept an optional `user` argument and fall back to the
 * currently authenticated user via `window.AppAuth`. Keeping them in a focused
 * module makes the authorization rules easy to unit test.
 */

function getCurrentUser() {
    return window.AppAuth?.getUser?.();
}

export function isAdminUser(user = getCurrentUser()) {
    if (!user) return false;
    // ONLY the boolean flag determines global admin status
    return user.isAdmin === true;
}

export function canSeeAdminPanel(user = getCurrentUser()) {
    if (!user) return false;
    if (isAdminUser(user)) return true;
    // If they have ANY specific admin level permission, they can enter the admin panel
    if (user.permissions) {
        return Object.entries(user.permissions).some(([module, level]) => {
            return !['birthday', 'letterPad'].includes(module) && level === 'admin';
        });
    }
    return false;
}

export function hasPerm(module, level = 'view', user = getCurrentUser()) {
    if (!user) return false;
    // Global admin has all permissions
    if (user.isAdmin === true) return true;
    if (!user.permissions || !user.permissions[module]) return false;

    const perm = user.permissions[module];
    if (level === 'view') return perm === 'view' || perm === 'admin';
    if (level === 'admin') return perm === 'admin';
    return false;
}

export function canAccessLetterPad(user = getCurrentUser()) {
    if (!user) return false;
    const perm = user.permissions?.letterPad;
    return perm === 'view' || perm === 'admin';
}

export function canManageAttendanceSheet(user = getCurrentUser()) {
    if (!user) return false;
    return hasPerm('attendance', 'admin', user) || !!user.canManageAttendanceSheet;
}

export function canAccessStaffAiMemory(user = getCurrentUser()) {
    if (!user) return false;
    return isAdminUser(user)
        || hasPerm('users', 'admin', user)
        || !!user.canAccessStaffAiMemory;
}

export function canManageBirthdays(user = getCurrentUser()) {
    if (!user) return false;
    return isAdminUser(user)
        || user.role === 'Administrator'
        || !!user.canManageBirthdays
        || hasPerm('birthday', 'view', user);
}

export function canAdminBirthdays(user = getCurrentUser()) {
    if (!user) return false;
    return isAdminUser(user)
        || user.role === 'Administrator'
        || !!user.canManageBirthdays
        || hasPerm('birthday', 'admin', user);
}

export function canCustomizeDashboard(user = getCurrentUser()) {
    if (!user) return false;
    return isAdminUser(user)
        || hasPerm('customize', 'admin', user)
        || !!user.canCustomizeDashboard;
}

if (typeof window !== 'undefined') {
    window.app_isAdminUser = isAdminUser;
    window.app_canSeeAdminPanel = canSeeAdminPanel;
    window.app_hasPerm = hasPerm;
    window.app_canAccessLetterPad = canAccessLetterPad;
    window.app_canManageAttendanceSheet = canManageAttendanceSheet;
    window.app_canAccessStaffAiMemory = canAccessStaffAiMemory;
    window.app_canManageBirthdays = canManageBirthdays;
    window.app_canAdminBirthdays = canAdminBirthdays;
    window.app_canCustomizeDashboard = canCustomizeDashboard;
}
