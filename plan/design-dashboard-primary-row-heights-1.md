---
goal: Equalize Primary Row Card Heights (Check-In, Team Schedule, Planned Tasks)
version: 1.0
date_created: 2026-08-13
owner: AI Agent
status: Completed
tags: design, css, dashboard, ui, layout
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

Make the three cards in the dashboard primary row — Check-In ("sign in"), Team Schedule, and Today's Planned Tasks — render at the same height. The Team Schedule card (which carries the calendar grid and a `min-height` of `var(--dashboard-primary-equal-card-h)`) is the tallest reference; the Check-In card already stretches, but the Planned Tasks column currently opts out with `align-self: start`, so it renders at content height and the row looks uneven. This change makes the Planned Tasks column stretch like the others while keeping its internal task list scrollable, so the earlier "empty gray space" problem does not return.

## 1. Requirements & Constraints

- **REQ-001**: At viewport ≥ 1024px the three primary-row cards (`.dashboard-checkin-card`, `.dashboard-team-schedule-card`, `.dashboard-worklog-card`) must have equal rendered heights within a 2px tolerance
- **REQ-002**: The Planned Tasks card must not show the empty-state message pinned to the bottom of the card (no `margin-top: auto` push)
- **REQ-003**: A long Planned Tasks list must scroll inside the card (`.dashboard-planned-task-list` keeps `overflow-y: auto`) instead of overflowing the card
- **REQ-004**: The Check-In card must keep stretching to the row height (existing `height: 100%` + `align-self: stretch` must be preserved)
- **REQ-005**: Staff view (`.dashboard-staff-view`) and admin view (`.dashboard-admin-view`) must both behave identically
- **REQ-006**: Dark mode (`[data-theme="dark"]`) must not regress
- **CON-001**: Only CSS changes in `css/dashboard-modern.css`; no HTML or JS changes
- **CON-002**: The existing `--dashboard-primary-equal-card-h` clamp values in `css/main.css` must remain the source of the row's minimum height
- **GUD-001**: Keep the "primary row" rules grouped under the `/* ── Primary Row ... */` comment block in `dashboard-modern.css`
- **PAT-001**: Follow the existing pattern of scoping overrides under `.modern-dashboard` and leaving base rules in `main.css` untouched

## 2. Implementation Steps

### Implementation Phase 1 — Let the Planned Tasks column stretch

- GOAL-001: Remove the opt-out that prevents the last primary column from stretching so all three cards share the row height

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `css/dashboard-modern.css`, delete the block `.modern-dashboard .dashboard-primary-row > .dashboard-primary-col:last-child { align-self: start; }` including its preceding comment `/* Worklog column: don't stretch, content-based height */` | ✅ | 2026-08-13 |

### Implementation Phase 2 — Make stretched cards fill and scroll correctly

- GOAL-002: Ensure the card inside a stretched column fills the column height and allows internal scrolling

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-002 | In `css/dashboard-modern.css`, update `.modern-dashboard .dashboard-primary-col > .card` to add `min-height: 0;` alongside the existing `flex: 1 1 auto; display: flex; flex-direction: column;` so a stretched card can shrink and let its inner list scroll rather than overflow | ✅ | 2026-08-13 |
| TASK-003 | Verify `.modern-dashboard .dashboard-checkin-card` retains `height: 100%` and `main.css` `.dashboard-staff-view .dashboard-checkin-card` retains `align-self: stretch` (read-only check; no edit expected) | ✅ | 2026-08-13 |

### Implementation Phase 3 — Validate the build and the rendered layout

- GOAL-003: Confirm the change compiles and the three cards render at equal height in a real browser

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Run `npx vite build --mode production` from the project root and confirm it completes with no errors | ✅ | 2026-08-13 |
| TASK-005 | Serve `dist/` (or run the dev server), load the dashboard at 1280×800 logged in as Demo/Demo, and measure the `offsetHeight` of `.dashboard-checkin-card`, `.dashboard-team-schedule-card`, and `.dashboard-worklog-card`; assert the max pairwise difference is ≤ 2px | ✅ | 2026-08-13 |
| TASK-006 | In `css/dashboard-modern.css`, add `.modern-dashboard .dashboard-worklog-card .dashboard-planned-task-list { max-height: min(52vh, 460px); }` so a very long Planned Tasks list scrolls inside the card instead of forcing the whole primary row to grow unboundedly (added after measurement showed the unbounded growth) | ✅ | 2026-08-13 |

## 3. Alternatives

- **ALT-001**: Set a fixed `height: var(--dashboard-primary-equal-card-h)` on all three cards instead of relying on grid stretch. Rejected because the Check-In card content can exceed the clamp on short viewports, which would clip content; grid stretch adapts to the tallest item.
- **ALT-002**: Keep the worklog column at content height and instead shrink the Team Schedule card to match. Rejected because the calendar grid needs the `--dashboard-primary-equal-card-h` minimum to stay usable, and the user explicitly wants the other cards to match the Team Schedule.
- **ALT-003**: Add a JS resize observer to equalize heights at runtime. Rejected — pure CSS grid stretching achieves the same result with zero JS and no layout thrash.

## 4. Dependencies

- **DEP-001**: Existing grid layout in `css/main.css` `.dashboard-primary-row` (grid, `align-items: start`) and the `--dashboard-primary-equal-card-h` clamp values defined under `.dashboard-staff-view` / `.dashboard-admin-view`
- **DEP-002**: Existing `.dashboard-planned-task-list` rule in `css/main.css` that already provides `flex: 1; min-height: 0; overflow-y: auto;`

## 5. Files

- **FILE-001**: `css/dashboard-modern.css` — remove the `align-self: start` override (TASK-001) and add `min-height: 0` to the column card rule (TASK-002)
- **FILE-002**: `css/main.css` — read-only reference; no edits expected

## 6. Testing

- **TEST-001**: `npx vite build --mode production` completes successfully with no errors
- **TEST-002**: Browser measurement — at 1280×800, `Math.max(...[checkin, schedule, worklog].map(el => el.offsetHeight)) - Math.min(...)` is ≤ 2px
- **TEST-003**: With a Planned Tasks list longer than the card, the card does not grow past the row height and the list scrolls (`scrollHeight > clientHeight` on `.dashboard-planned-task-list`)
- **TEST-004**: Injected 40 synthetic task items — card and Team Schedule both measured 482px (equal) and the list scrolled (`scrollHeight` 1729 > `clientHeight` 416)

## 7. Risks & Assumptions

- **RISK-001**: Equal heights reintroduce visible empty space inside the Planned Tasks card when it has few tasks; mitigation is that the space is card background (not a pushed-down empty state), which is standard card layout, and `TASK-005`/`TEST-002` verify the visual result
- **RISK-002**: On very narrow viewports (single-column grid) the cards stack; equal heights then apply per-row and each card keeps its natural height — acceptable and expected
- **ASSUMPTION-001**: The row height is driven by the tallest item, which in practice is the Team Schedule card's `min-height: var(--dashboard-primary-equal-card-h)` or a taller Check-In card; the Planned Tasks list is capped at `min(52vh, 460px)` so it never drives the row height on its own
- **ASSUMPTION-002**: No inline styles or JS set explicit pixel heights on the three cards that would override the CSS grid stretch

## 8. Related Specifications / Further Reading

- [plan/ui-compact-staff-dashboard-1.md](ui-compact-staff-dashboard-1.md)
- [plan/design-dashboard-widgets-1.md](design-dashboard-widgets-1.md)
