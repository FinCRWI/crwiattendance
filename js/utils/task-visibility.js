/**
 * Task visibility helpers for private day-plan tasks.
 *
 * A task flagged `isPrivate: true` is visible only to:
 *   1. the owner of the plan document that contains it (plan.userId), and
 *   2. the user it is assigned to (task.assignedTo), if any.
 *
 * Every other viewer — admins in staff views, team activities, staff activity
 * columns, reports, AI context and the annual-plan calendar — is filtered out
 * via these helpers. Keep this module pure (no top-level `window` access) so
 * Node unit tests can import it directly.
 */

export const isPrivateTask = (task) => {
    return !!task && typeof task === 'object' && task.isPrivate === true;
};

/**
 * True when `viewer` may see `task` given the plan document that contains it.
 * Public tasks are always visible; private tasks are visible only to the plan
 * owner and the task's assignee.
 */
export const isTaskVisibleToViewer = (task, planOwnerId, viewerId) => {
    if (!isPrivateTask(task)) return true;
    const owner = String(planOwnerId || '').trim();
    const viewer = String(viewerId || '').trim();
    if (!viewer) return false;
    if (viewer === owner) return true;
    const assignee = String(task?.assignedTo || '').trim();
    if (assignee && assignee === viewer) return true;
    return false;
};

/**
 * Returns a shallow-copied array of plans with private tasks removed for
 * viewers who are neither the plan owner nor the task assignee. Plans without
 * any private tasks (and non-plan entries) are returned unchanged.
 */
export const stripPrivateTasksForViewer = (plans = [], viewerId) => {
    const safeViewer = String(viewerId || '').trim();
    return (Array.isArray(plans) ? plans : []).map((plan) => {
        if (!plan || typeof plan !== 'object' || !Array.isArray(plan.plans)) return plan;
        if (!plan.plans.some(isPrivateTask)) return plan;
        return {
            ...plan,
            plans: plan.plans.filter((task) =>
                isTaskVisibleToViewer(task, String(plan.userId || ''), safeViewer)
            )
        };
    });
};

/**
 * Current signed-in user id (runtime only). Returns '' outside the browser or
 * when no session is available.
 */
export const getCurrentViewerId = () => {
    try {
        if (typeof window !== 'undefined' && window?.AppAuth?.getUser) {
            return String(window.AppAuth.getUser()?.id || '').trim();
        }
    } catch {
        /* ignore */
    }
    return '';
};
