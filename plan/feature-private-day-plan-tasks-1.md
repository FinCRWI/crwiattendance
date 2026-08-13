---
goal: Add per-task privacy to day-plan tasks (visible only to the owner/assignee) uniformly for all staff
version: 1.0
date_created: 2026-08-13
last_updated: 2026-08-13
owner: Dev
status: 'Completed'
tags: `feature`, `privacy`, `day-plan`, `dashboard`
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

Every staff member can mark some of their plan-of-the-day tasks as **private**. A private task is visible only to its plan owner (`plan.userId`) and its assignee (`task.assignedTo`); it is filtered out of every surface where other staff or admins could see it (dashboard planned-tasks widget, day-plan modal for others, team activities, staff activity columns, AI memory context, reports CSV export, annual-plan calendar). Hero-of-the-week and rating scores keep counting private tasks (numbers only, no text leak) so scoring stays fair.

## 1. Requirements & Constraints

- **REQ-001**: A new boolean `isPrivate` flag on a task object in `work_plans` controls visibility; `false`/absent = public (current behavior).
- **REQ-002**: A private task is visible only to `plan.userId` and to `task.assignedTo`; all other viewers are filtered out.
- **REQ-003**: The privacy toggle must be reachable in every create/edit surface: quick-add personal plan modal, plan block editor overlay, new-block shell, and the block header in the day-plan modal.
- **REQ-004**: Private tasks remain editable and visible to their owner everywhere (dashboard widget lock badge, day-plan modal).
- **REQ-005**: Assigned copies of private tasks carry the flag and remain visible to the assignee (who needs to do the work).
- **SEC-001**: No surface that renders task text to other staff or admins may leak private task content.
- **CON-001**: No new Firestore collections; the flag lives on the existing task object so save/sync/carry-forward machinery is unchanged.
- **CON-002**: Hero scoring (`buildHeroRanking`, `buildAttendanceTaskStats`, rating) keeps private tasks counted; only numeric aggregates are exposed there.
- **CON-003**: All helpers live in `js/utils/task-visibility.js` and must be pure (no top-level `window` access) so Node unit tests can import them.
- **GUD-001**: Filter at shared aggregation choke points (one helper call), not inside each renderer.
- **GUD-002**: Use an unambiguous lock affordance (`fa-lock` / `fa-lock-open` + "Private" label) so users know which tasks are private.
- **PAT-001**: Follow existing module patterns — ESM relative imports, `window.AppAuth?.getUser?.()` for the current viewer.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Add the shared privacy helper module and unit-testable rules.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `js/utils/task-visibility.js` exporting `isPrivateTask(task)`, `isTaskVisibleToViewer(task, planOwnerId, viewerId)`, `stripPrivateTasksForViewer(plans, viewerId)`, `getCurrentViewerId()` per REQ-001/REQ-002/CON-003 | ✅ | 2026-08-13 |
| TASK-002 | Add `tests/unit/task-visibility.test.mjs` covering: public tasks always visible; private tasks visible to owner; private tasks visible to assignee; private tasks hidden from other viewers; `stripPrivateTasksForViewer` strips only non-owner/assignee tasks and returns plan copies otherwise untouched | ✅ | 2026-08-13 |

### Implementation Phase 2

- GOAL-002: Add the privacy toggle to all day-plan create/edit surfaces and persist the flag.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-003 | In `js/modules/day-plan.js` `dayPlanRenderBlockV3`: add hidden input `.plan-private` (value 1/0 from `plan.isPrivate`), add `plan-block-private` class when private, and add a `.day-plan-private-toggle` lock button in `headerActions` (only when `!isReference`) that flips the hidden input, button icon/classes, and block class | ✅ | 2026-08-13 |
| TASK-004 | In `js/modules/day-plan.js` `openPlanEditor`: add `isPrivate: false` to the default `planData`, add a "Private" checkbox field to the editor grid initialized from `planData.isPrivate`, and include `isPrivate: privateCheckbox.checked` in `updatedPlan` | ✅ | 2026-08-13 |
| TASK-005 | In `js/modules/day-plan.js` `quickAddPersonalPlan`: add a "Private" checkbox field to the modal grid and include `isPrivate: privateCheckbox.checked` in the pushed task object | ✅ | 2026-08-13 |
| TASK-006 | In `js/app.js` `app_addPlanBlockUI` shell HTML: add `<input type="hidden" class="plan-private" value="0">` and a `.day-plan-private-toggle` button calling `window.app_togglePlanBlockPrivate(this)`; add the `window.app_togglePlanBlockPrivate(btn)` handler next to `app_togglePlanBlockCollapse` | ✅ | 2026-08-13 |
| TASK-007 | In `js/modules/day-plan.js` `app_extractBlockData`: read `.plan-private` and return `isPrivate` in the extracted object | ✅ | 2026-08-13 |
| TASK-008 | In `js/app.js` `app_saveDayPlan`: read `.plan-private` per block and add `isPrivate` to the `planPayload` (spread into per-assignee copies by existing code) | ✅ | 2026-08-13 |

### Implementation Phase 3

- GOAL-003: Filter private tasks out of all non-owner viewer surfaces.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | In `js/ui/dashboard.js`: import `isTaskVisibleToViewer`; add a `viewerId` param to `getPlannedTaskRows`, skip rows where `!isTaskVisibleToViewer(task, plan.userId, viewerId)`, add `isPrivate` to each row; pass `currentUser?.id` from `renderPlannedTasksCard`; render a "Private" lock chip in `renderPlannedTaskItem` meta | ✅ | 2026-08-13 |
| TASK-010 | In `js/modules/day-plan.js` modal block building: import `isTaskVisibleToViewer`; filter blocks in `normalizeScopedPlans` with `isTaskVisibleToViewer(p, workPlan.userId, currentUser.id)` so editing another staff's plan and "others" plan blocks hide private tasks | ✅ | 2026-08-13 |
| TASK-011 | In `js/modules/analytics.js` `getAllStaffActivities`: import `getCurrentViewerId` + `isTaskVisibleToViewer`; skip private tasks in the `workPlans.forEach` merge loop when `!isTaskVisibleToViewer(plan, wp.userId, viewerId)` | ✅ | 2026-08-13 |
| TASK-012 | In `js/modules/ai-context-feeder.js` `rebuildStaffContext`: import `isTaskVisibleToViewer`; filter `visibleTasks` per plan with `isTaskVisibleToViewer(task, plan.userId, safeUserId)` | ✅ | 2026-08-13 |
| TASK-013 | In `js/modules/reports.js` calendar CSV export: import `isTaskVisibleToViewer`; skip private tasks in the `plans.workPlans.forEach` loop when `!isTaskVisibleToViewer(task, p.userId, getCurrentViewerId())` | ✅ | 2026-08-13 |
| TASK-014 | In `js/ui/annual-plan.js`: import `stripPrivateTasksForViewer` + `getCurrentViewerId`; wrap `plans.workPlans` with `stripPrivateTasksForViewer(plans.workPlans || [], getCurrentViewerId())` before the existing `filteredWorkPlans` filter | ✅ | 2026-08-13 |

### Implementation Phase 4

- GOAL-004: Style the private affordances and validate the whole change.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-015 | Add CSS: `.day-plan-private-toggle` (lock button states) and `.plan-block-private` accent in `css/day-plan.css`; `.dashboard-planned-task-chip-private` amber chip in `css/dashboard-modern.css` next to the existing `.modern-dashboard .dashboard-planned-task-chip` rule | ✅ | 2026-08-13 |
| TASK-016 | Run `node --test` on all `tests/unit/*.test.mjs` (including TASK-002) and `npx vite build --mode production`; verify clean | ✅ | 2026-08-13 |
| TASK-017 | Browser-verify with Playwright (Demo/Demo at 1280x800): owner sees a private task with lock badge in dashboard widget; admin staff view and team activities do not show it | ✅ | 2026-08-13 |

## 3. Alternatives

- **ALT-001**: A separate `private_plans` Firestore collection. Rejected — doubles the sync surface, breaks carry-forward and per-assignee copies, and complicates hero scoring.
- **ALT-002**: A single `getPlansForViewer()` funnel applied at every callsite. Rejected — consumers read plans through different paths (cached loaders, shared payloads, analytics merges); a shared helper plus targeted filters at the existing choke points is the pragmatic 80/20.
- **ALT-003**: Excluding private tasks from hero/rating scoring entirely. Rejected — scores are numeric aggregates with no text leak; excluding them would let staff hide work from rankings or dodge completion metrics. Kept counting (CON-002), easily reversible.

## 4. Dependencies

- **DEP-001**: `js/utils/task-visibility.js` must be created before any consumer imports it (TASK-001 precedes TASK-009..014).
- **DEP-002**: `window.AppAuth.getUser()` provides the current viewer id at runtime; Node tests rely on the pure helpers only.

## 5. Files

- **FILE-001**: `js/utils/task-visibility.js` (new) — shared privacy helpers
- **FILE-002**: `js/modules/day-plan.js` — editor toggles, extract, modal filter
- **FILE-003**: `js/app.js` — new-block shell toggle + handler, save payload
- **FILE-004**: `js/ui/dashboard.js` — worklog widget filter + lock badge
- **FILE-005**: `js/modules/analytics.js` — staff-activities filter
- **FILE-006**: `js/modules/ai-context-feeder.js` — AI context filter
- **FILE-007**: `js/modules/reports.js` — CSV export filter
- **FILE-008**: `js/ui/annual-plan.js` — calendar filter
- **FILE-009**: `css/day-plan.css` — toggle + block styles
- **FILE-010**: `css/dashboard-modern.css` — private chip style
- **FILE-011**: `tests/unit/task-visibility.test.mjs` (new) — unit tests

## 6. Testing

- **TEST-001**: `tests/unit/task-visibility.test.mjs` asserts the four visibility rules and the strip helper (TASK-002).
- **TEST-002**: Full unit suite `node --test tests/unit/*.test.mjs` stays green.
- **TEST-003**: `npx vite build --mode production` completes without errors.
- **TEST-004**: Playwright browser check — private task visible to owner (lock badge), hidden from admin staff view and team activities (TASK-017).

## 7. Risks & Assumptions

- **RISK-001**: A future renderer forgets to filter private tasks → silent content leak. Mitigated by the shared helper + TEST-001 and a single choke-point convention (GUD-001).
- **RISK-002**: `getAllStaffActivities` memoizes results; viewer-aware filtering must run inside the merge loop (after cache read) so different viewers never receive cached rows built for another viewer.
- **ASSUMPTION-001**: Hero/rating scores may include private tasks (CON-002).
- **ASSUMPTION-002**: Assigned private tasks remain visible to the assignee (REQ-005).
- **ASSUMPTION-003**: Existing tasks without the flag are public (REQ-001), so the feature is a no-op for current data.

## 8. Related Specifications / Further Reading

- `plan/design-dashboard-primary-row-heights-1.md` (dashboard widget layout context)
- `js/utils/task-status.js` (existing shared-util pattern)
