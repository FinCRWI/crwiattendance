---
goal: Fix postpone/status inconsistencies across checkout form, carry-forward, team activities, and analytics
version: 1.0
date_created: 2026-07-30
status: Completed
last_updated: 2026-07-30
tags: bug, fix, postpone, carry-forward, status, checkout
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

Fix 4 bugs in the task postpone/status flow that cause duplicate tasks, missing carry-forwards, and status inconsistency between the checkout form, day-plan editor, carry-forward system, and team activities.

## 1. Requirements & Constraints

- **REQ-001**: Postponing a task from the checkout form must remove the original task from the source plan (not leave a `'postponed'` copy behind)
- **REQ-002**: Postponed tasks must not be re-cloned by the auto carry-forward system
- **REQ-003**: The status value `'postponed'` must be recognized everywhere the system checks for closed/completed tasks
- **REQ-004**: Dashboard team activity section must reflect carry-forward tasks without requiring manual day-plan open
- **CON-001**: All changes must be backward-compatible with existing Firestore documents (existing `'postponed'` status values must still work)
- **CON-002**: No new Firestore writes or extra API calls on the hot path (checkout submit)
- **GUD-001**: Follow the existing pattern of `app_teamActivitiesPostponeTask` (team-activities.js:959) which properly splices the original task — this is the correct behavior to replicate
- **PAT-001**: Status normalization should happen in one place — `normalizeTaskStatus` in `calendar.js` — and all downstream consumers should use it

## 2. Implementation Steps

### Phase 1 — Fix `isTaskClosed` to Recognize `'postponed'`

- GOAL-001: Add `'postponed'` to the closed-status check in `isTaskClosed` so the carry-forward system does not re-clone postponed tasks

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `js/modules/calendar.js:68`, add `'postponed'` to the status check: `if (status === 'completed' \|\| status === 'not-completed' \|\| status === 'cancelled' \|\| status === 'postponed') return true;` | ✅ | 2026-07-30 |
| TASK-002 | Verify `getSmartTaskStatus` in the same file returns `'not-completed'` (not `'overdue'`) for a past-date task with status `'postponed'` — if not, add `'postponed'` to its closed-status map | ✅ | 2026-07-30 |

### Phase 2 — Fix Checkout Postpone to Remove Original Task

- GOAL-002: In `app_applyCheckoutTaskUpdates`, after setting task status to `'postponed'` and saving the plan, splice the task out of the source plan so it behaves as a move, not a copy

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-003 | In `js/app.js:5431-5451`, change the postpone handler: after `task.status = 'postponed'` and `plan.updatedAt = ...` and `await window.AppDB.put('work_plans', plan)`, splice the task out of `plan.plans.splice(update.taskIndex, 1)` and re-save the plan with `await window.AppDB.put('work_plans', plan)` | ✅ | 2026-07-30 |
| TASK-004 | In the same handler, after splicing, update `update.taskIndex` references for the `addWorkPlanTask` call so the `sourceTaskIndex` still points to the correct original (splice changes indices — save the original index before splicing) | ✅ | 2026-07-30 |
| TASK-005 | Add a comment explaining the splice: the original task is removed because the new copy on the target date replaces it | ✅ | 2026-07-30 |

### Phase 3 — Normalize `'postponed'` in `normalizeTaskStatus`

- GOAL-003: Make `normalizeTaskStatus` in `calendar.js` normalize `'postponed'` to `'not-completed'` so all downstream code (carry-forward, team activities, analytics) uses a single consistent value

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | In `js/modules/calendar.js:47-51`, add `if (key === 'postponed' \|\| key === 'postpone') return 'not-completed';` to `normalizeTaskStatus` | ✅ | 2026-07-30 |
| TASK-007 | In `js/app.js:5432`, change `task.status = 'postponed'` to `task.status = 'not-completed'` — now `normalizeTaskStatus` in calendar.js will handle it, but the persisted value should be the canonical `'not-completed'` to match the day-plan editor | ✅ | 2026-07-30 |

### Phase 4 — Remove Duplicate `app_renderCheckoutActionPreview`

- GOAL-004: Delete the dead duplicate of `app_renderCheckoutActionPreview` at line 5220

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | In `js/app.js`, delete lines 5220-5349 (the first definition of `window.app_renderCheckoutActionPreview` and the intervening functions, ending before the second definition at line 5353). Verify by checking that lines 5220-5349 contain only the first definition of `app_renderCheckoutActionPreview` and any functions that are also defined again later | ✅ | 2026-07-30 |
| TASK-009 | After deletion, confirm `window.app_renderCheckoutActionPreview` is defined exactly once in app.js | ✅ | 2026-07-30 |

### Phase 5 — Enable Carry-Forward in Dashboard Team Activity Section

- GOAL-005: Change `sideEffects: false` to `sideEffects: true` (or omit) in `renderTeamActivitySection` so carried-forward tasks appear without manual day-plan open

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | In `js/ui/dashboard-sections.js:337`, change `sideEffects: false` to `sideEffects: true` | ✅ | 2026-07-30 |

### Phase 6 — Build and Verify

- GOAL-006: Build the project and run lint/unit tests to verify no regressions

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Run `npm run build` and confirm zero errors | ✅ | 2026-07-30 |
| TASK-012 | Run `npm run lint` and confirm zero warnings/errors | ✅ | 2026-07-30 |
| TASK-013 | Run `npm run test:unit` and confirm all tests pass | ✅ | 2026-07-30 |

## 3. Alternatives

- **ALT-001**: Leave `'postponed'` as a distinct status value and update all downstream consumers (carry-forward, analytics, team activities) to handle it explicitly. Rejected because it requires touching 5+ files and introduces more surface area for future bugs. Normalizing to `'not-completed'` in one place is simpler.
- **ALT-002**: In the checkout postpone path, instead of splicing the task, add `isRemoved: true` to the original task. Rejected because the team-activities postpone path uses splice (consistent pattern), and `isRemoved` tasks still occupy array slots that need filtering everywhere.
- **ALT-003**: Keep `sideEffects: false` in the dashboard section and instead trigger a one-off carry-forward call after checkout submit. Rejected because `sideEffects: true` is the correct default — the dashboard should show current data without workarounds.

## 4. Dependencies

- **DEP-001**: No external library dependencies. All changes are within the existing codebase.

## 5. Files

- **FILE-001**: `js/modules/calendar.js` — `isTaskClosed` (line 68), `normalizeTaskStatus` (line 47)
- **FILE-002**: `js/app.js` — `app_applyCheckoutTaskUpdates` postpone handler (lines 5431-5451), `app_renderCheckoutActionPreview` duplicate (lines 5220-5349)
- **FILE-003**: `js/ui/dashboard-sections.js` — `renderTeamActivitySection` (line 337)
- **FILE-004**: `plan/fix-postpone-status-flow-1.md` — this plan file

## 6. Testing

- **TEST-001**: Existing unit tests in `tests/unit/` must pass after changes (no new tests needed for this refactor)
- **TEST-002**: Manual smoke test: open checkout form, postpone a task, verify original date's plan no longer shows the task, target date's plan shows it with `(Postponed from ...)` suffix
- **TEST-003**: Manual smoke test: open day plan for a past date with a postponed task, verify carrying forward does NOT duplicate it
- **TEST-004**: Manual smoke test: dashboard team activity section shows carried-forward tasks without opening day plan first

## 7. Risks & Assumptions

- **RISK-001**: Splicing the task out of the source plan in the checkout postpone path (TASK-003) changes array indices. If other parts of the system reference tasks by index in the same plan document, those references could break. Mitigation: the postponed task is being removed from a PAST date's plan, which is no longer the "active" plan — references to it should be minimal.
- **RISK-002**: Changing `sideEffects: false` to `sideEffects: true` in the dashboard section (TASK-010) could trigger expensive carry-forward queries on every dashboard load. Mitigation: the carry-forward functions (`ensureCarryForwardForDate`, `ensureCarryForwardForRange`) have idempotency checks (date already processed, tasks already closed) so repeated calls are cheap.
- **ASSUMPTION-001**: The duplicate `app_renderCheckoutActionPreview` definition at line 5220 is dead code — the second definition at line 5353 is the one that actually runs. Confirmed by reading both definitions — they are functionally identical.
- **ASSUMPTION-002**: `normalizeTaskStatus` is called by all downstream consumers of task status. If any code reads `task.status` directly without calling `normalizeTaskStatus`, it may still see `'postponed'` from old documents. This is acceptable because old documents with `'postponed'` will be gradually migrated on next write (TASK-007).

## 8. Related Specifications / Further Reading

- `D:\Attendace-app-main\js\modules\calendar.js` — `isTaskClosed` at line 65, `normalizeTaskStatus` at line 47, `ensureCarryForwardForRange` at line 197
- `D:\Attendace-app-main\js\app.js` — `app_applyCheckoutTaskUpdates` at line 5403, `app_handleChecklistAction` at line 6549
- `D:\Attendace-app-main\js\ui\team-activities.js` — `app_teamActivitiesPostponeTask` at line 926 (reference implementation for correct splice behavior)
- `D:\Attendace-app-main\js\ui\dashboard-sections.js` — `renderTeamActivitySection` at line 331
- `D:\Attendace-app-main\js\modules\analytics.js` — `normalizePlanStatus` at line 1825 (own normalization that already handles `'postponed'`)
