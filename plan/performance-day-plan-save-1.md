---
goal: Eliminate all Firestore round-trips and DOM-blocking steps from the "Save Plan" critical path in Plan Your Day
version: 1.0
date_created: 2026-07-27
status: 'Planned'
tags: performance, day-plan, firestore, calendar
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

The "Save Plan" button in the "Plan Your Day" modal triggers a chain of synchronous Firestore writes, DOM re-renders, and sequential user-lookup loops that can take **several seconds** to complete. The user sees an `alert()` dialog only after all Firestore writes finish, making the perceived latency equal to the sum of every I/O operation.

This plan breaks the save flow into three phases: (1) **critical path** — the steps the user waits for before seeing success feedback, (2) **immediate background** — Firestore notifications that should be deferred but completed quickly, and (3) **deferred cleanup** — carry-forward operations, cache invalidations, and section re-renders that can be delayed or skipped entirely.

## 1. Requirements & Constraints

- **REQ-001**: The "Save Plan" button must show spinner feedback within 50ms of click and success feedback within 1.5s for plans with ≤5 tasks and no tagged users.
- **REQ-002**: Tagged-user notifications and tagged-task creation must not block the save-flow critical path.
- **REQ-003**: Section-page re-render after save must use cached data when available, avoiding fresh Firestore queries.
- **REQ-004**: The Firestore `work_plans` document write is the single gating I/O — all other Firestore operations in the save path must be deferred or eliminated.
- **CON-001**: The `window.AppCalendar.setWorkPlan()` interface must remain backward-compatible (existing callers in Meeting Minutes, API routes, etc.).
- **CON-002**: No changes to the Firestore security rules or data model.
- **CON-003**: Alert/confirm dialogs must remain for error cases, but success feedback should use non-blocking toast.
- **GUD-001**: Batch Firestore reads into `Promise.all` groups. Never `await` inside a `for` loop when the iterations are independent.
- **GUD-002**: Cache invalidations that happen during the save path should be batched into one call at the end, not called per-operation.
- **PAT-001**: Use the existing `window.app_asyncButton` pattern for the save button spinner.

## 2. Implementation Steps

### Phase 1 — Critical-Path Firestore Writes

- GOAL-001: Reduce the critical save path to exactly 1 Firestore `work_plans` write, eliminating the sequential personal-annual split.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Merge `personalPlans` and `annualPlans` into a single `setWorkPlan()` call by passing both scopes in the `options` object. `AppCalendar.setWorkPlan` already accepts an `options.planScope` parameter — extend it to accept an array `['personal', 'annual']` that writes both scopes in parallel internally. | | |
| TASK-002 | In `AppCalendar.setWorkPlan()`, when `planScope` is an array, generate two `work_plan` documents (one per scope) and write them with `Promise.all([this.db.put('work_plans', personalDoc), this.db.put('work_plans', annualDoc)])`. Call `this.invalidateCarryForwardCache()` once after both writes resolve. | | |
| TASK-003 | Update `app_saveDayPlan` to call `setWorkPlan` once with the merged scope array, eliminating the sequential `if (personalPlans)... if (annualPlans)...` block and the duplicate `deleteWorkPlan` branches. | | |

### Phase 2 — Non-blocking Success Feedback

- GOAL-002: Replace the synchronous `alert("Plans saved successfully!")` with a non-blocking toast so the modal closes instantly after the write resolves.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Replace `alert("Plans saved successfully!")` at line 5708 with `window.app_showSyncToast("Plans saved successfully!")` which already exists and renders a non-blocking toast in the top-right corner. | | |
| TASK-005 | Close the modal (`document.getElementById('day-plan-modal')?.remove()`) immediately before the toast call, not after. | | |

### Phase 3 — Deferred Background Notification & Tagged Tasks

- GOAL-003: Convert the sequential `for...of` tagged-user loops to batched `Promise.all` and defer them to the microtask queue so they never delay the save flow.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Refactor the background notification IIFE (lines 5730-5815) to collect ALL `db.get('users', uid)` promises into an array and run them with `Promise.all`, then collect ALL `db.put('users', user)` promises and run them with another `Promise.all`. | | |
| TASK-007 | Similarly refactor the tagged-task creation loop (lines 5810-5815): collect all `AppCalendar.addWorkPlanTask()` calls into an array and run with `Promise.all`. | | |
| TASK-008 | Wrap the entire background block in `queueMicrotask()` or `setTimeout(..., 0)` so it always runs after the current render cycle completes. | | |

### Phase 4 — Lazy Section Re-render

- GOAL-004: Skip the full section-page re-render after save; instead update only the planned-tasks widget data via AppStore cache.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | After `AppStore.invalidatePlans()` (line 5703), check if the current view is a section page (`dashboard-section/`). If so, call `window.app_refreshDashboard()` instead of `renderDashboardSectionPage()`. The main dashboard render is already skipped — extend the same logic to section pages by using the shared `invalidatePlans()` + `refreshDashboard()` pattern. | | |
| TASK-010 | If the user is NOT on a section page, fully skip all re-rendering. The `AppStore.invalidatePlans()` cache invalidation already ensures that the next time the user navigates to dashboard, fresh data loads. | | |

### Phase 5 — Eliminate Duplicate Cache Invalidations

- GOAL-005: `invalidateCarryForwardCache()` is called inside `setWorkPlan()`, `addWorkPlanTask()`, and `deleteWorkPlan()`. When invoked from `app_saveDayPlan`, these cascade. Call it exactly once at the top level.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | In `AppCalendar.setWorkPlan()`, add an `options.skipCacheInvalidation` flag. When `true`, skip the `this.invalidateCarryForwardCache()` call. | | |
| TASK-012 | In `AppCalendar.addWorkPlanTask()`, add the same `options.skipCacheInvalidation` flag. | | |
| TASK-013 | In `app_saveDayPlan`, pass `skipCacheInvalidation: true` to all `setWorkPlan` and `addWorkPlanTask` calls. Call `AppCalendar.invalidateCarryForwardCache()` once at line 5703 alongside `AppStore.invalidatePlans()`. | | |

## 3. Alternatives

- **ALT-001**: Replace Firestore entirely with IndexedDB for work plans. Rejected — too invasive, would break real-time sync.
- **ALT-002**: Debounce saves and batch multiple rapid edits. Rejected — adds complexity without addressing the core latency (each save is independent).
- **ALT-003**: Use Firestore `update()` instead of `put()` for partial updates. Rejected — the entire plan document is serialised in the form data, so `put()` (set+merge) is equivalent.

## 4. Dependencies

- **DEP-001**: `window.app_showSyncToast` — already exists in `app.js`.
- **DEP-002**: `window.AppStore.invalidatePlans()` — already exists, clears the plans cache.
- **DEP-003**: `window.AppCalendar.invalidateCarryForwardCache()` — already exists, clears the carry-forward cache.

## 5. Files

- **FILE-001**: `js/app.js` — lines 5569-5840, the `app_saveDayPlan`, `app_deleteDayPlan` functions, and the background notification IIFE.
- **FILE-002**: `js/modules/calendar.js` — lines 414-465, the `setWorkPlan` method; lines 449-500+, the `addWorkPlanTask` method.

## 6. Testing

- **TEST-001**: Run `npx vite build` and verify no build errors.
- **TEST-002**: Manual test — open Plan Your Day, add 1 task, save. Verify the toast appears within 1s and the modal closes immediately.
- **TEST-003**: Manual test — add 5 tasks with 3 tagged users, save. Verify the toast appears quickly and the notifications arrive in the background.
- **TEST-004**: Verify existing Meeting Minutes functionality still works (they call `addWorkPlanTask` without the new `skipCacheInvalidation` flag — it defaults to `false`).

## 7. Risks & Assumptions

- **RISK-001**: The `planScope: ['personal', 'annual']` array extension to `setWorkPlan` could break if other callers pass an unexpected planScope type. Mitigation: check `Array.isArray(options.planScope)` before treating it as a single string.
- **RISK-002**: Deferring tagged-user notifications with `queueMicrotask` could cause them to be lost if the page navigates away immediately. Mitigation: acceptable — notifications are not guaranteed in the save-flow critical path.
- **ASSUMPTION-001**: All tagged-user IDs are valid Firestore document IDs that exist in the `users` collection.
- **ASSUMPTION-002**: The Firestore write for a `work_plans` document takes 200-500ms under normal network conditions, which is the minimum latency the user will perceive.
