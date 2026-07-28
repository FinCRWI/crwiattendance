---
goal: 'Skeleton Loading States: Project-Wide Implementation'
version: '1.0'
date_created: '2026-07-28'
last_updated: '2026-07-28'
owner: 'CRWI Dev Team'
status: 'Completed'
tags: ['feature', 'ux', 'skeleton', 'loading-states']
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Every async page in the CRWI Attendance App currently shows a blank screen during data fetch. The dashboard already has skeleton loading (implemented in `dashboard-skeletons.js`), but all other 12 pages have zero loading indicators. This plan extends skeleton loading to every page, creates a centralized skeleton system, and modifies the router to auto-show skeletons before data fetches.

## 1. Requirements & Constraints

- **REQ-001**: Every async page must show a skeleton placeholder within 100ms of navigation, before data fetch begins
- **REQ-002**: Skeletons must use the existing shimmer animation from `dashboard-skeletons.js` (`@keyframes skeleton-shimmer`)
- **REQ-003**: Skeletons must match the visual layout of the target page (e.g., table pages get table-row skeletons, card pages get card skeletons)
- **REQ-004**: The router (`app.js:3451-3526`) must inject skeletons automatically — no per-page boilerplate required
- **REQ-005**: Skeletons must be removed when real content renders (innerHTML replacement handles this naturally)
- **REQ-006**: All skeleton CSS must be scoped to `.skeleton-*` classes to avoid conflicts with existing styles
- **REQ-007**: No new npm dependencies — vanilla JS only
- **REQ-008**: Total skeleton CSS/JS overhead must be under 5KB gzipped
- **CON-001**: The existing `dashboard-skeletons.js` must be extended, not replaced (backward compatible)
- **CON-002**: `auth-pages.js` (login) and `journey-reflection.js` (pre-fetched card) do not need skeletons
- **CON-003**: `payroll.js:renderPolicyTest` is synchronous — no skeleton needed
- **GUD-001**: Each page skeleton function must be named `render[Page]Skeleton()` and exported from `page-skeletons.js`
- **GUD-002**: Skeleton HTML must use semantic class names matching the target page structure (e.g., `.skeleton-admin-card`, `.skeleton-timesheet-row`)
- **PAT-001**: Follow existing pattern from `dashboard-skeletons.js` — CSS keyframes injected once, skeleton functions return HTML strings
- **PAT-002**: Router injection pattern: `contentArea.innerHTML = skeletonHTML; contentArea.innerHTML = await renderPage();`

## 2. Implementation Steps

### Implementation Phase 1: Centralized Skeleton System

- GOAL-001: Create a shared skeleton infrastructure that all pages can use

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `js/ui/page-skeletons.js` with: (a) shared CSS keyframes injection (`ensureSkeletonStyles()`), (b) reusable skeleton primitives (`skeletonLine()`, `skeletonCircle()`, `skeletonRect()`, `skeletonCard()`), (c) page-specific skeleton functions for all 12 pages. Import the shimmer animation from `dashboard-skeletons.js` or duplicate the 10-line CSS block to avoid cross-import coupling. | ✅ | 2026-07-28 |
| TASK-002 | In `js/app.js`, create a `showSkeleton(hash)` function that maps each route to its skeleton function: `dashboard` → `renderDashboardSkeletons()` (from existing `dashboard-skeletons.js`), `admin` → `renderAdminSkeleton()`, `master-sheet` → `renderMasterSheetSkeleton()`, `annual-plan` → `renderAnnualPlanSkeleton()`, `profile` → `renderProfileSkeleton()`, `minutes` → `renderMinutesSkeleton()`, `staff-directory` → `renderStaffDirectorySkeleton()`, `timesheet` → `renderTimesheetSkeleton()`, `team-activities` → `renderTeamActivitiesSkeleton()`, `birthday-calendar` → `renderBirthdayCalendarSkeleton()`, `salary` → `renderSalarySkeleton()`, `letter-pad` → `renderLetterPadSkeleton()`, `staff-ai-memory` → `renderStaffAiMemorySkeleton()`. Routes without skeletons (policies, policy-test) return `null`. | ✅ | 2026-07-28 |
| TASK-003 | In `js/app.js` router (lines 3451-3526), before each `contentArea.innerHTML = await AppUI.renderXxx()` call, insert: `const skel = showSkeleton(hash); if (skel) contentArea.innerHTML = skel;`. This ensures skeletons appear instantly before the async render begins. The existing `await` then replaces the skeleton with real content via `contentArea.innerHTML = await ...`. | ✅ | 2026-07-28 |

### Implementation Phase 2: High-Priority Page Skeletons

- GOAL-002: Create skeletons for the 6 highest-impact pages (longest data fetch, most complex UI)

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Create `renderAdminSkeleton()` in `page-skeletons.js`: (a) 6 stat cards in a grid (3×2), each with a number skeleton line + label skeleton line, (b) a staff table skeleton with 8 rows × 5 columns (name, role, attendance, tasks, status), (c) a leave requests section with 3 row skeletons, (d) a compliance section with 3 row skeletons. Total: ~20 skeleton elements. Target: `admin.js:renderAdmin` which fetches 9 parallel data sources. | ✅ | 2026-07-28 |
| TASK-005 | Create `renderMasterSheetSkeleton()` in `page-skeletons.js`: (a) month/year selector skeleton (2 rect buttons), (b) a table skeleton with header row (Staff + 30 day columns) and 10 data rows, each cell a small rect skeleton. The master sheet is a wide grid — skeleton must match the grid layout with `overflow-x: auto`. Target: `master-sheet.js:renderMasterSheet` which fetches 4 data sources. | ✅ | 2026-07-28 |
| TASK-006 | Create `renderAnnualPlanSkeleton()` in `page-skeletons.js`: (a) toolbar skeleton (view toggle + filter buttons), (b) 12 mini-month grid skeletons (4×3 grid of small cards, each with a month label line + 4×5 day-cell grid of tiny rects), or (c) list mode skeleton with 10 row items. Target: `annual-plan.js:renderAnnualPlan` which fetches 3 data sources. | ✅ | 2026-07-28 |
| TASK-007 | Create `renderProfileSkeleton()` in `page-skeletons.js`: (a) hero banner with avatar circle (72px) + name line + role line, (b) stats strip with 4 stat cards (each: number line + label line), (c) leave history table with 5 rows × 4 columns, (d) employment details section with 4 label-value pairs. Target: `profile.js:renderProfile` which fetches 4 data sources. | ✅ | 2026-07-28 |
| TASK-008 | Create `renderMinutesSkeleton()` in `page-skeletons.js`: (a) header with title line + "New Meeting" button rect, (b) search bar skeleton, (c) 6 meeting card skeletons in a grid (each: date line + title line + attendees row of 3 circles + status pill rect). Target: `minutes-ui.js:renderMinutes` which fetches 3 data sources. | ✅ | 2026-07-28 |
| TASK-009 | Create `renderStaffDirectorySkeleton()` in `page-skeletons.js`: (a) left sidebar with 8 staff row skeletons (avatar circle + name line + status dot), (b) right panel with 3 message thread skeletons (avatar + 2 text lines + timestamp). Two-column layout skeleton. Target: `staff-directory.js:renderStaffDirectoryPage` which fetches 2 data sources. | ✅ | 2026-07-28 |

### Implementation Phase 3: Medium-Priority Page Skeletons

- GOAL-003: Create skeletons for the 5 medium-impact pages

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Create `renderTimesheetSkeleton()` in `page-skeletons.js`: (a) stats grid with 4 stat cards (each: icon circle + number line + label line), (b) view toggle skeleton (2 buttons), (c) table skeleton with 8 rows × 6 columns (Date, Check-in, Check-out, Duration, Status, Tasks). Target: `timesheet.js:renderTimesheet` which fetches 2 data sources. | ✅ | 2026-07-28 |
| TASK-011 | Create `renderTeamActivitiesSkeleton()` in `page-skeletons.js`: (a) filter bar with 3 select skeletons + date range skeleton, (b) table skeleton with 10 rows × 5 columns (Date, Staff, Type, Status, Description). Replace the existing text "Loading data..." in `team-activities.js:1128` with this skeleton. Target: `team-activities.js:renderTeamActivitiesPage`. | ✅ | 2026-07-28 |
| TASK-012 | Create `renderBirthdayCalendarSkeleton()` in `page-skeletons.js`: (a) month navigation skeleton (prev/next buttons + month label), (b) 7-column calendar grid skeleton with 5 rows, each cell a small rect, (c) 3 birthday card skeletons below the grid (avatar circle + name line + date line). Target: `birthday-calendar.js:renderBirthdayCalendar` which fetches 2 data sources. | ✅ | 2026-07-28 |
| TASK-013 | Create `renderSalarySkeleton()` in `page-skeletons.js`: (a) month selector skeleton, (b) summary stat cards (2 cards: total salary, average), (c) salary table skeleton with 10 rows × 6 columns (Staff, Basic, Allowances, Deductions, Net, Status). Target: `payroll.js:renderSalaryProcessing` which fetches 1 data source. | ✅ | 2026-07-28 |
| TASK-014 | Create `renderLetterPadSkeleton()` in `page-skeletons.js`: (a) left sidebar with 4 template skeletons (rect card + name line), (b) right editor area with toolbar skeleton (3 button rects) + content area skeleton (6 text lines of varying width). Target: `letter-pad.js:renderLetterPad` which fetches 1 data source (mostly local). | ✅ | 2026-07-28 |
| TASK-015 | Create `renderStaffAiMemorySkeleton()` in `page-skeletons.js`: (a) header with title + staff selector skeleton, (b) memory cards grid with 4 card skeletons (each: category pill + 2 text lines + tag row of 3 pills), (c) activity feed with 5 row skeletons. Target: `admin.js:renderStaffAiMemorySheet` which fetches 5 data sources. | ✅ | 2026-07-28 |

### Implementation Phase 4: Router Integration & Testing

- GOAL-004: Wire everything together and verify

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | In `js/app.js`, add `import { renderDashboardSkeletons } from './ui/dashboard-skeletons.js'` and `import { showSkeleton } from './ui/page-skeletons.js'` at the top. Verify no circular import issues. | ✅ | 2026-07-28 |
| TASK-017 | In `js/app.js` router, test each route navigation: (a) verify skeleton appears within 100ms, (b) verify skeleton is replaced by real content, (c) verify no console errors, (d) verify back-button navigation works with skeletons. | ✅ | 2026-07-28 |
| TASK-018 | Run `npm run lint` — fix any new lint errors introduced by skeleton code. | ✅ | 2026-07-28 |
| TASK-019 | Run `npm run build` — verify dist/ size increase is under 5KB gzipped. | ✅ | 2026-07-28 |
| TASK-020 | Manual smoke test: navigate through all 13 async routes in sequence, verify each shows skeleton then real content. Time each skeleton→content transition. Target: skeleton visible for at least 50ms on fast connections, no flash of skeleton on instant data. | ✅ | 2026-07-28 |

## 3. Alternatives

- **ALT-001**: Add skeleton insertion inside each `renderXxx()` function instead of the router — rejected because it requires modifying every page file and adds boilerplate. Router-level injection is cleaner and DRY.
- **ALT-002**: Use CSS `display: none` toggle instead of innerHTML replacement — rejected because innerHTML replacement is the existing pattern and CSS toggle would require additional DOM state management.
- **ALT-003**: Use a single generic skeleton for all pages — rejected because different pages have very different layouts (grid vs table vs card vs sidebar). Page-specific skeletons provide much better perceived performance.
- **ALT-004**: Use IntersectionObserver to defer skeleton rendering until viewport entry — rejected as overkill for full-page navigations where the content area is always visible.

## 4. Dependencies

- **DEP-001**: `js/ui/dashboard-skeletons.js` (existing) — shimmer animation and dashboard-specific skeletons
- **DEP-002**: `js/app.js` router (lines 3451-3526) — must be modified to inject skeletons
- **DEP-003**: All `js/ui/*.js` page modules — no changes required (skeletons are injected at router level)

## 5. Files

- **FILE-001**: `js/ui/page-skeletons.js` — New file: centralized skeleton system + all page skeletons
- **FILE-002**: `js/ui/dashboard-skeletons.js` — Existing: reuse shimmer CSS, no changes needed
- **FILE-003**: `js/app.js` — Router modification: inject skeletons before async renders (lines 3451-3526)
- **FILE-004**: `js/ui/team-activities.js` — Optional: replace text "Loading data..." with skeleton call (line 1128)
- **FILE-005**: `css/dashboard-modern.css` — May need `.skeleton-*` base styles if not already in `page-skeletons.js`

## 6. Testing

- **TEST-001**: Run `npm run lint` after each phase to verify no lint errors
- **TEST-002**: Run `npm run test:unit` to verify existing unit tests pass
- **TEST-003**: Manual test: navigate to `#admin`, verify 6 stat cards + table skeleton appears before content
- **TEST-004**: Manual test: navigate to `#master-sheet`, verify month grid skeleton appears before content
- **TEST-005**: Manual test: navigate to `#profile`, verify avatar + stats skeleton appears before content
- **TEST-006**: Manual test: navigate to `#minutes`, verify card grid skeleton appears before content
- **TEST-007**: Manual test: navigate through all13 routes in sequence, verify no blank screens
- **TEST-008**: Run `npm run build && npm run test:smoke` to verify build output and smoke tests pass

## 7. Risks & Assumptions

- **RISK-001**: Fast data fetches (<50ms) may cause skeleton to flash briefly — mitigation: the 100ms threshold is acceptable for perceived performance; for instant data the skeleton is replaced before human perception threshold (~16ms)
- **RISK-002**: Some pages may have complex conditional rendering that makes skeleton matching difficult — mitigation: skeletons only need to approximate the layout, not match exactly
- **RISK-003**: Router modification affects all navigation — mitigation: skeleton injection is guarded by `if (skel)` check, so routes without skeletons are unaffected
- **ASSUMPTION-001**: All async page renders follow the `contentArea.innerHTML = await renderPage()` pattern in the router
- **ASSUMPTION-002**: The `#page-content` element exists before router executes (guaranteed by the app shell in `index.html`)
- **ASSUMPTION-003**: The shimmer animation from `dashboard-skeletons.js` is performant on mobile (CSS-only, no JS)

## 8. Related Specifications / Further Reading

- WCAG 2.1 Loading States: https://www.w3.org/WAI/tutorials/forms/notifications/#loading
- MDN CSS Shimmer Animation: https://developer.mozilla.org/en-US/docs/Web/CSS/animation
- AGENTS.md: `D:\Attendace-app-main\AGENTS.md` — project conventions
- Existing skeleton system: `D:\Attendace-app-main\js\ui\dashboard-skeletons.js`
