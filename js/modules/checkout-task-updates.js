function normalizeIsoDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function buildTaskText(task = {}) {
    const details = Array.isArray(task.subPlans) && task.subPlans.length
        ? ` - ${task.subPlans.join(', ')}`
        : '';
    return `${String(task.task || '').trim()}${details}`.trim();
}

export function buildCheckoutTaskMutation(task = {}, update = {}, options = {}) {
    const effectiveDate = String(options.effectiveDate || new Date().toISOString().split('T')[0]);
    const planDate = String(options.planDate || effectiveDate || '').trim();
    const currentUserId = String(options.currentUserId || '').trim();
    const nextTask = {
        ...task,
        progressPercent: update.progressPercent,
        progressStatus: update.progressStatus,
        progressNote: update.progressNote,
        budgetHeadId: String(update.budgetHeadId || task.budgetHeadId || 'UNALLOCATED'),
        lastProgressUpdateAt: update.timestamp,
        lastProgressUpdateBy: currentUserId,
        lastCheckoutAction: update.action
    };

    if (update.action === 'complete') {
        nextTask.status = 'completed';
        if (!nextTask.completedDate) nextTask.completedDate = effectiveDate;
    } else if (update.action === 'postpone') {
        nextTask.status = 'postponed';
    }

    const postponeDate = update.action === 'postpone'
        ? normalizeIsoDate(update.actionMeta?.postponeDate)
        : '';
    const canCreatePostponedCopy = postponeDate && postponeDate > planDate;
    let postponeError = '';
    if (update.action === 'postpone' && !canCreatePostponedCopy) {
        nextTask.status = task.status || '';
        nextTask.lastCheckoutAction = '';
        postponeError = !postponeDate
            ? 'Select a valid new date to postpone.'
            : 'Postpone date must be after the source date.';
    }
    const postponedTask = canCreatePostponedCopy
        ? {
            date: postponeDate,
            userId: String(task.assignedTo || currentUserId || '').trim() || currentUserId,
            taskDescription: `${buildTaskText(task).replace(/\s*\(Postponed from [^)]+\)\s*$/i, '')} (Postponed from ${planDate})`,
            subPlans: Array.isArray(task.subPlans) ? task.subPlans.slice() : [],
            meta: {
                addedFrom: 'postponed',
                sourcePlanId: update.planId,
                sourceTaskIndex: update.taskIndex,
                postponedFromDate: planDate,
                budgetHeadId: String(task.budgetHeadId || 'UNALLOCATED'),
                tags: Array.isArray(task.tags) ? task.tags.slice() : [],
                status: 'postponed',
                assignedTo: String(task.assignedTo || currentUserId || '').trim() || currentUserId,
                assignedToName: String(task.assignedToName || '').trim()
            }
        }
        : null;

    return {
        nextTask,
        postponedTask,
        postponeError
    };
}
