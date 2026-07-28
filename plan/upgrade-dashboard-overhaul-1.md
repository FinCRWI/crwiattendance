---
goal: 'Dashboard Overhaul: Performance, UX, and Code Quality Improvements'
version: '1.0'
date_created: '2026-07-28'
last_updated: '2026-07-28'
owner: 'CRWI Dev Team'
status: 'In progress'
tags: ['upgrade', 'performance', 'ux', 'refactor', 'dashboard']
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

The CRWI Attendance App dashboard is the primary entry point for both admin and staff users. A comprehensive evaluation has identified critical performance bottlenecks (unbounded Firestore queries, duplicate fetches, sequential waterfalls), significant UX gaps (staff missing personal data, information overload, no loading states), and code quality issues (god functions, duplicate code, magic numbers). This plan addresses all issues in prioritized phases.

## 1. Requirements & Constraints

- **REQ-001**: Dashboard must load in under 2 seconds on 3G connection
- **REQ-002**: All Firestore queries must have bounded limits or date filters
- **REQ-003**: Staff must see their own rating, leave history, and pending leave status on the dashboard
- **REQ-004**: Team Activity feed must offer a "My Activity" filter toggle for staff
- **REQ-005**: All sections must show loading skeletons during data fetch
- **REQ-006**: Empty sections must show meaningful empty states, not blank gaps
- **REQ-007**: Auto-scroll must respect `prefers-reduced-motion` and have pause controls
- **REQ-008**: All magic numbers must be moved to `AppConfig` or Firestore settings
- **CON-001**: No new npm dependencies — vanilla JS only
- **CON-002**: Firebase Firestore compat SDK v9.23 must be used (loaded via script tag in index.html)
- **CON-003**: All changes must maintain backward compatibility with existing Firestore data
- **CON-004**: Build output must remain under 500KB gzipped
- **GUD-001**: Follow existing code conventions — ES modules, singleton pattern, `AppConfig` for config
- **GUD-002**: All new functions must have JSDoc documentation
- **GUD-003**: CSS changes must use existing CSS custom properties (`--md-*` tokens)
- **PAT-001**: Follow existing module pattern — `js/modules/` for data, `js/ui/` for rendering
- **PAT-002**: Use existing `AppDB.getAll` cache TTL system for read caching

## 2. Implementation Steps

### Implementation Phase 1: Critical Performance Fixes

- GOAL-001: Eliminate unbounded Firestore queries and duplicate fetches in dashboard data loading

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `js/modules/analytics.js:853-891`, add date range filter to `getHeroSharedDataset()` — limit `getAll('attendance')` and `getAll('work_plans')` fallbacks to 7-day window using `queryMany` with `startAt`/`endAt` on the `date` field. When `queryMany` is unavailable, filter the `getAll` results in-memory to the 7-day window before processing. | ✅ | 2026-07-28 |
| TASK-002 | In `js/modules/analytics.js:1720-1742`, eliminate duplicate fetch in `getAllStaffActivities()` — accept an optional `sharedDataset` parameter. When provided (from `getHeroSharedDataset`), reuse its `attendanceLogs` and `workPlans` arrays instead of re-fetching. Update caller at `analytics.js:869` to pass the shared dataset. | ✅ | 2026-07-28 |
| TASK-003 | In `js/ui/dashboard.js:1852-1854`, replace `AppDB.getAll('leaves')` with a bounded query: `queryMany('leaves', { field: 'createdAt', op: '>=', value: thirtyDaysAgo })` where `thirtyDaysAgo = Date.now() - 30*24*60*60*1000`. Add fallback filter on `getAll('leaves')` results. | ✅ | 2026-07-28 |
| TASK-004 | In `js/modules/analytics.js:636-758`, split `getUserYearlyStats()` into monthly chunks. Instead of fetching all 365 days at once, fetch 12 monthly ranges in parallel using `queryMany` with start/end dates per month. Aggregate results after all resolve. | ✅ | 2026-07-28 |
| TASK-005 | In `js/ui/dashboard.js:1976-1981`, move `AppJourneyReflection.buildDashboardState()` into the main `Promise.all` block at line 1841, changing it from sequential `await` to a parallel promise. | ✅ | 2026-07-28 |
| TASK-006 | In `js/modules/analytics.js:83-85`, add warning log when `getAll('attendance')` fallback is triggered: `console.warn('[Analytics] queryMany unavailable — falling back to getAll attendance')`. Add same warning for `getAll('work_plans')` fallback at analytics.js:1740. | ✅ | 2026-07-28 |

### Implementation Phase 2: Dashboard Loading States & Empty States

- GOAL-002: Add skeleton loading states and meaningful empty states to all dashboard sections

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Create `js/ui/dashboard-skeletons.js` with skeleton HTML functions: `renderCheckinSkeleton()`, `renderWorklogSkeleton()`, `renderHeroSkeleton()`, `renderActivitySkeleton()`, `renderLeaveSkeleton()`, `renderStatsSkeleton()`. Each skeleton must use CSS `@keyframes shimmer` animation on a `#f1f5f9` background with `border-radius` matching the target card. | ✅ | 2026-07-28 |
| TASK-008 | In `js/ui/dashboard.js:1741`, before the `Promise.all` fires, insert skeleton placeholders into `#page-content` for each card zone. Use the skeleton functions from TASK-007. Replace skeletons with real content as each section renders. | ✅ | 2026-07-28 |
| TASK-009 | In `js/ui/dashboard.js`, update `renderLeaveRequests()` (line 1548), `renderMissedCheckoutRequests()` (line 1601), and `renderLeaveHistory()` (line 1632) to return meaningful empty-state HTML (icon + message + CTA) instead of `''` when data is empty. Use pattern: `<div class="empty-state"><i class="fa-solid fa-check-circle"></i><p>No pending items</p></div>`. | ✅ | 2026-07-28 |
| TASK-010 | Add CSS for `.empty-state` class to `css/dashboard-modern.css`: centered layout, muted icon color (`#94a3b8`), subtle text color (`#64748b`), appropriate padding (`2rem`). | ✅ | 2026-07-28 |

### Implementation Phase 3: Staff Dashboard Enhancements

- GOAL-003: Give staff users personal data visibility and reduce information overload

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | In `js/ui/dashboard.js:2229`, change the rating display gate from `isAdmin && user.rating !== undefined` to `user.rating !== undefined`. This allows staff to see their own rating in the hero card. | ✅ | 2026-07-28 |
| TASK-012 | In `js/ui/dashboard.js`, add a new `renderStaffLeaveSummary(user)` function that shows the staff member's own pending leave requests and recent leave history (last 5 items). Call this from the staff detail section (around line 2165) when `!canViewAdminSections`. Use existing `AppLeaves` methods filtered by `user.uid`. | ✅ | 2026-07-28 |
| TASK-013 | In `js/ui/dashboard.js:renderActivityLog()` (line 1167), add a toggle button "My Activity" / "Team Activity" above the activity feed. When "My Activity" is selected, filter `dailySummary.teamActivityPreview` to only items where `item.staffId === currentUser.uid`. Store toggle state in a local variable, re-render the activity section on toggle. | ✅ | 2026-07-28 |
| TASK-014 | In `js/ui/dashboard.js:2209`, make the dashboard title configurable — read from `AppConfig.DASHBOARD_TITLE || 'Attendance Command Center'`. Add `DASHBOARD_TITLE` to `js/config.js`. | ✅ | 2026-07-28 |
| TASK-015 | In `js/ui/dashboard.js:2275` and the check-in card location display, add reverse geocoding using `navigator.geolocation` and the free `nominatim.openstreetmap.org` API (no key required). Show formatted address instead of raw lat/lng. Cache result in localStorage with 1-hour TTL. Add fallback to raw coords if geocoding fails. | ✅ | 2026-07-28 |

### Implementation Phase 4: Auto-Scroll & Accessibility Fixes

- GOAL-004: Make auto-scroll accessible and add pause/stop controls

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | In `js/ui/dashboard.js:initTeamActivityAutoScroll()` (line 2394) and `initWorklogAutoScroll()` (line 2493), refactor into a single shared `initAutoScroll(containerId, options)` function. The function must: (a) check `window.matchMedia('(prefers-reduced-motion: reduce)')` and skip auto-scroll if true, (b) pause on `mouseenter`/`touchstart`, (c) resume on `mouseleave`/`touchend`, (d) stop when container is not visible via `IntersectionObserver`. | ✅ | 2026-07-28 |
| TASK-017 | In `js/ui/dashboard.js:renderActivityLog()` and `renderWorkLog()`, add a visible pause/play toggle button (icon: `fa-pause`/`fa-play`) next to the section title. Wire it to the shared auto-scroll controller from TASK-016. | ✅ | 2026-07-28 |
| TASK-018 | Add CSS for `.auto-scroll-controls` to `css/dashboard-modern.css`: small icon button (24px), muted color, positioned absolute top-right of the section header. Add `:hover` and `:focus-visible` states for keyboard navigation. | ✅ | 2026-07-28 |

### Implementation Phase 5: Code Quality & Deduplication

- GOAL-005: Eliminate duplicate code, dead code, and magic numbers

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-019 | In `js/modules/analytics.js:1029-1097` (`normalizeHeroTasks`) and `analytics.js:1099-1164` (`normalizeHeroTasksFromActivities`), extract shared logic into `normalizeHeroTasksInternal(activities, options)`. Replace both functions with thin wrappers that call the internal function with appropriate defaults. | ✅ | 2026-07-28 |
| TASK-020 | In `js/ui/dashboard.js:2323` and `dashboard.js:2359`, deduplicate the `statusRank` object — define it once at module level (around line 25) as `const STATUS_RANK = { completed: 0, 'in-process': 1, overdue: 2, 'not-completed': 3, 'to-be-started': 4 }` and reference it from both `normalizeStaffActivityLogs` and `sortStaffActivityLogs`. | ✅ | 2026-07-28 |
| TASK-021 | In `js/ui/dashboard.js:1642-1646`, remove the unused `statusColor` function (dead code). | ✅ | 2026-07-28 |
| TASK-022 | In `js/modules/analytics.js:600-601`, remove the duplicate `else if (type === 'Earned Leave')` branch (line 601 is dead code). | ✅ | 2026-07-28 |
| TASK-023 | In `js/ui/dashboard.js`, move all magic numbers to `js/config.js` under a new `DASHBOARD_LIMITS` object: `MAX_REFRESHES: 3`, `WORKLOG_PAGE_SIZE: 25`, `OVERDUE_PREVIEW_COUNT: 3`, `LEAVE_REQUESTS_LIMIT: 5`, `LEAVE_HISTORY_LIMIT: 8`, `ACTIVITY_MONTHS_BACK: 8`, `HERO_VERSION_BADGE: 'v5'`. Update all references in dashboard.js to use `AppConfig.DASHBOARD_LIMITS.X`. | ✅ | 2026-07-28 |
| TASK-024 | In `js/ui/dashboard.js:2232`, break the 800+ character inline HTML template for the staff selector `<select>` into a multi-line template with proper indentation. Extract the `<optgroup>` building logic into a helper function `buildStaffSelectorOptions(allUsers)`. | ✅ | 2026-07-28 |
| TASK-025 | In `js/ui/dashboard-layout.js:213-216`, rename abbreviated helper functions: `a9` -> `createElement`, `ce` -> `createEl`, `qs` -> `querySel`, `qsa` -> `querySelAll`, `gem` -> `getElementMatching`, `gid` -> `getElementById`, `cln` -> `cloneNode`. | ✅ | 2026-07-28 |
| TASK-026 | In `js/ui/dashboard.js`, refactor `renderDashboard()` (line 1741, 1325 lines) into smaller functions: `fetchDashboardData()` (data fetching), `buildDashboardLayout()` (HTML assembly), `initDashboardInteractions()` (event binding). Keep `renderDashboard()` as the orchestrator calling these three. | ✅ | 2026-07-28 |

### Implementation Phase 6: Hero Card Performance & UX

- GOAL-006: Optimize hero card rendering and improve leaderboard mobile experience

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-027 | In `js/ui/dashboard.js:1777-1782`, replace the 1.5s timeout race for daily summary with a proper loading state. Show a shimmer skeleton in the hero card slot while the summary generates. Remove the DOM polling retry loop at lines 1901-1908. | ✅ | 2026-07-28 |
| TASK-028 | In `js/ui/dashboard.js:1914-1946`, replace the 20-retry DOM polling for hero card replacement with an event-based approach: emit a custom event `hero-data-ready` from the summary generator, and listen for it in `renderDashboard()`. | ✅ | 2026-07-28 |
| TASK-029 | In `js/ui/dashboard.js:renderHeroLeaderboardExpanded()` (line 978), convert the 13-column HTML table to a responsive card layout on mobile. Use CSS `@media (max-width: 768px)` to switch from table to stacked cards. Each card shows: rank, name, avatar, score. Detailed metrics expand on tap. | ✅ | 2026-07-28 |
| TASK-030 | In `js/ui/dashboard.js:736`, move `MAX_REFRESHES = 3` to `AppConfig.DASHBOARD.MAX_REFRESHES` (part of TASK-023). | ✅ | 2026-07-28 |

## 3. Alternatives

- **ALT-001**: Use Firestore composite indexes for all dashboard queries instead of in-memory filtering — rejected because composite indexes require Firestore console setup per query pattern and don't help with the `queryMany` unavailability fallback path
- **ALT-002**: Implement virtual scrolling for team activity feed — rejected as overkill for the expected data volume (max ~50 staff × ~20 tasks = ~1000 items); CSS `max-height` with `overflow-y: auto` is sufficient
- **ALT-003**: Use a JavaScript framework (React/Vue) for the dashboard — rejected per CON-001 and project convention (vanilla JS)
- **ALT-004**: Move hero scoring to a Cloud Function for pre-computation — rejected because it adds infrastructure complexity; the current client-side approach is acceptable once duplicate fetches are eliminated

## 4. Dependencies

- **DEP-001**: Firebase Firestore compat SDK v9.23 (already loaded via `<script>` in index.html)
- **DEP-002**: Nominatim API for reverse geocoding (free, no key required, rate-limited to 1 req/sec)
- **DEP-003**: `AppConfig` module (`js/config.js`) must be updated with `DASHBOARD_LIMITS` object before TASK-023

## 5. Files

- **FILE-001**: `js/ui/dashboard.js` — Main dashboard rendering (3066 lines), primary target for most tasks
- **FILE-002**: `js/modules/analytics.js` — Hero scoring, stats computation (1916 lines), performance fixes
- **FILE-003**: `js/config.js` — Centralized configuration (110 lines), new DASHBOARD_LIMITS
- **FILE-004**: `css/dashboard-modern.css` — Dashboard styles (2092 lines), skeleton + empty state + mobile
- **FILE-005**: `js/ui/dashboard-skeletons.js` — New file: skeleton loading components
- **FILE-006**: `js/ui/dashboard-layout.js` — Layout helpers (492 lines), rename abbreviated functions
- **FILE-007**: `js/ui/dashboard-sections.js` — Section drill-down (587 lines), may need empty state updates
- **FILE-008**: `js/modules/leaves.js` — Leave data module, used by TASK-012 for staff leave summary

## 6. Testing

- **TEST-001**: Run `npm run lint` after each phase to verify no new lint errors introduced
- **TEST-002**: Run `npm run test:unit` to verify existing unit tests pass (analytics.js has test coverage)
- **TEST-003**: Manual smoke test: load dashboard as admin, verify all sections render with loading skeletons, no console errors, no unbounded Firestore queries in network tab
- **TEST-004**: Manual smoke test: load dashboard as staff, verify rating is visible, "My Activity" toggle works, leave summary shows personal data
- **TEST-005**: Manual smoke test: verify auto-scroll pauses on hover and respects `prefers-reduced-motion`
- **TEST-006**: Manual smoke test: verify hero leaderboard is readable on mobile viewport (375px width)
- **TEST-007**: Verify Firestore network tab shows bounded queries (no `getAll` without date filters) during dashboard load
- **TEST-008**: Run `npm run build` and verify dist/ size remains under 500KB gzipped

## 7. Risks & Assumptions

- **RISK-001**: Nominatim reverse geocoding may be rate-limited or slow — mitigation: cache results in localStorage, fallback to raw coordinates
- **RISK-002**: Refactoring `renderDashboard()` (TASK-026) may introduce regressions in card layout — mitigation: test all card modes (tile, original, fullscreen) after refactor
- **RISK-003**: Splitting `getUserYearlyStats` into monthly chunks (TASK-004) may increase total Firestore read count — mitigation: the parallel fetches should complete faster than one large sequential read
- **RISK-004**: Adding "My Activity" toggle (TASK-013) may confuse users who expect team-wide visibility — mitigation: default to "Team Activity" on first load
- **ASSUMPTION-001**: The `queryMany` function is available in production (the `getAll` fallback is a development-only edge case)
- **ASSUMPTION-002**: Staff count is under 50 (affects performance of `getAll('users')` and hero dataset)
- **ASSUMPTION-003**: The existing CSS custom property system (`--md-*` tokens) is used consistently across dashboard components

## 8. Related Specifications / Further Reading

- Firebase Firestore query limitations: https://firebase.google.com/docs/firestore/query-data/queries
- WCAG 2.2.2 Pause, Stop, Hide: https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html
- Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
- AGENTS.md: `D:\Attendace-app-main\AGENTS.md` — project conventions and commands
