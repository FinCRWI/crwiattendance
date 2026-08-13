// Task fields that the day-plan editor must round-trip on save. The editor
// rebuilds each task from hidden inputs, so any field NOT in this list is
// silently dropped when a task is edited. Postpone/carry-forward provenance
// (postponedFromDate, addedFrom, source ids, progress) must survive edits,
// otherwise analytics/hero postponed-tracking and auto-forward detection break.
const TASK_PROVENANCE_FIELDS = [
    'postponedFromDate', 'postponedToDate', 'addedFrom', 'sourcePlanId', 'sourceTaskIndex',
    'postponedFromPlanId', 'carriedForwardFromDate', 'carriedForwardFromPlanId',
    'isAutoForwarded', 'carryForwardPolicy', 'autoForwardedAt', 'carryForwardReason',
    'progressPercent', 'progressStatus', 'progressNote',
    'completedDate', 'completedAt', 'completed_on',
    'createdById', 'createdByName'
];

// Serialize the provenance (plus any extras like the original status) into a
// JSON string stored in a hidden input on each plan block.
export function serializeTaskProvenance(task, extra = {}) {
    const out = { ...extra };
    if (task && typeof task === 'object') {
        TASK_PROVENANCE_FIELDS.forEach((key) => {
            const v = task[key];
            if (v !== undefined && v !== null && v !== '') out[key] = v;
        });
    }
    return Object.keys(out).length ? JSON.stringify(out) : '';
}

export function deserializeTaskProvenance(json) {
    if (!json) return {};
    try {
        const parsed = JSON.parse(String(json));
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch {
        return {};
    }
}

// Chip label shown next to a postponed task. The source task records where it
// was moved to (postponedToDate); the next-day copy records where it came from
// (postponedFromDate / addedFrom === 'postponed'). Returns the HTML chip, or
// '' when there is no date to show.
export function formatPostponeChip(task) {
    const s = String(task?.status || '').toLowerCase().trim();
    if (!['postponed', 'not-completed', 'not completed'].includes(s)) return '';
    const to = String(task?.postponedToDate || '').trim();
    if (to) return ` <span class="postponed-target-chip">Postponed to ${to}</span>`;
    const isCopy = String(task?.addedFrom || '').toLowerCase() === 'postponed' || !!task?.postponedFromDate;
    const from = String(task?.postponedFromDate || '').trim();
    if (isCopy && from) return ` <span class="postponed-target-chip">Postponed from ${from}</span>`;
    return '';
}
