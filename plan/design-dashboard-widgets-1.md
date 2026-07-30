---
goal: Light & Lean Dashboard Widget Color Scheme
version: 1.0
date_created: 2026-07-30
owner: AI Agent
status: Planned
tags: design, css, dashboard, ui, refactor
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Strip all dashboard widget cards down to solid light backgrounds, subtle borders, and flat styling — removing gradients, frosted glass, heavy shadows, and dark navy. Each widget gets a distinct pastel accent consistent with the light blue hero card.

## 1. Requirements & Constraints

- **REQ-001**: Every widget card must use a solid light background color (no gradients, no backdrop-filter blur)
- **REQ-002**: Each widget type must have a distinct pastel accent color that visually differentiates it
- **REQ-003**: All text must be dark (`#1e293b` / `#0f2340` range) for readability on light backgrounds
- **REQ-004**: Cards must use flat styling — no `box-shadow` beyond a minimal `0 1px 3px rgba(0,0,0,0.06)`
- **REQ-005**: Existing `.modern-dashboard` card class must remain the default for any widget not explicitly restyled
- **REQ-006**: Dark mode overrides (`[data-theme="dark"]`) must continue to work
- **CON-001**: Only CSS changes — no HTML or JS modifications
- **CON-002**: Color palette must be cohesive and not introduce jarring contrasts
- **CON-003**: Staff-view overrides (`.dashboard-staff-view`) must be updated in tandem with base styles
- **GUD-001**: Use Tailwind-inspired color names (slate, blue, green, amber, purple, pink, teal) for consistency
- **PAT-001**: Follow the existing pattern of defining colors in `dashboard-modern.css` for modern dashboard, and `.dashboard-staff-view` overrides in `main.css`

## 2. Implementation Steps

### Implementation Phase 1 — Monthly Stats Card (Dark Navy → Light Blue)

- GOAL-001: Replace the dark navy gradient on the monthly stats card with a solid light blue background matching the hero family

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `css/dashboard-modern.css`, change `.modern-dashboard .dashboard-stats-row .dashboard-stats-card:first-child` background from `linear-gradient(135deg, var(--md-primary) 0%, #1a2946 100%)` to `background: #dbeafe`, remove `border: none`, set `color: #1e293b` | | |
| TASK-002 | In the same block, change title/kpi-value from `color: white` to `color: #0f2340`, change kpi-label from `rgba(255,255,255,0.7)` to `color: #475569` | | |
| TASK-003 | In `css/main.css`, update `.dashboard-staff-view .dashboard-stats-row .dashboard-stats-card:first-child` overrides to match the new light background and dark text | | |

### Implementation Phase 2 — Default Card (Frosted Glass → Solid White)

- GOAL-002: Replace the frosted-glass default card with a solid white background with subtle border

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | In `css/dashboard-modern.css`, change `.modern-dashboard .card` background from `rgba(255, 255, 255, 0.85); backdrop-filter: blur(8px)` to `background: #ffffff; border: 1px solid #e2e8f0` | | |
| TASK-005 | Reduce `box-shadow` from `var(--md-shadow-sm)` to `0 1px 3px rgba(0, 0, 0, 0.06)` | | |

### Implementation Phase 3 — Yearly Summary Card (Soft Green Tint)

- GOAL-003: Apply a soft green pastel background to the Yearly Summary card to differentiate it from Monthly Stats

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Add `.modern-dashboard .dashboard-stats-row .dashboard-stats-card:nth-child(2)` rule in `css/dashboard-modern.css` with `background: #f0fdf4; border-color: rgba(74, 222, 128, 0.2)` | | |
| TASK-007 | Ensure dark text colors for title, kpi-value, kpi-label inside this card | | |

### Implementation Phase 4 — Journey Reflection Card (Warm Amber Tint)

- GOAL-004: Apply a soft amber pastel background to the Journey Reflection card

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | In `css/dashboard-modern.css`, update `.modern-dashboard .dashboard-detail-section .dashboard-journey-card` with `background: #fffbeb; border: 1px solid rgba(251, 191, 36, 0.2)` | | |
| TASK-009 | Ensure dark text colors within the journey card | | |

### Implementation Phase 5 — Planned Tasks Card (Soft Purple Tint)

- GOAL-005: Apply a soft purple pastel background to the Planned Tasks card

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | In `css/dashboard-modern.css`, add rule targeting the planned-tasks card container with `background: #f5f3ff; border: 1px solid rgba(167, 139, 250, 0.2)` | | |
| TASK-011 | Ensure dark text colors | | |

### Implementation Phase 6 — Detail Section Cards (Soft Pink/Teal Tints)

- GOAL-006: Apply soft pastel backgrounds to remaining detail section cards (team activity, leave requests, etc.)

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-012 | In `css/dashboard-modern.css`, add rule for `.modern-dashboard .dashboard-detail-section .card:nth-child(odd)` with `background: #fdf2f8; border-color: rgba(244, 114, 182, 0.15)` | | |
| TASK-013 | Add rule for `.modern-dashboard .dashboard-detail-section .card:nth-child(even)` with `background: #f0fdfa; border-color: rgba(45, 212, 191, 0.15)` | | |

### Implementation Phase 7 — Staff-View Overrides

- GOAL-007: Update all `.dashboard-staff-view` and `.dashboard-admin-view` overrides in `main.css` to match the new light scheme

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-014 | In `css/main.css`, update `.dashboard-staff-view .dashboard-stats-row .card` to remove any dark backgrounds, set `background: #ffffff; border: 1px solid #e2e8f0; color: #1e293b` | | |
| TASK-015 | Update any `!important` color overrides in `main.css` (staff-view hero-stats-card, etc.) to use dark text colors | | |

### Implementation Phase 8 — Build & Verify

- GOAL-008: Build and verify no lint or build errors

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | Run `npm run lint` — must return 0 errors, 0 warnings | | |
| TASK-017 | Run `npm run build` — must complete without errors | | |

## 3. Alternatives

- **ALT-001**: Keep frosted glass effect (`.card { background: rgba(255,255,255,0.85); backdrop-filter: blur }`) — rejected because it adds visual complexity and the blur effect can be janky on low-end devices
- **ALT-002**: Use only Tailwind-grayscale (slate) without pastel accents — rejected because widgets would be indistinguishable from each other
- **ALT-003**: Apply per-widget gradients (like current monthly stats) — rejected because gradients add visual weight that contradicts the "light and lean" goal

## 4. Dependencies

- **DEP-001**: No external dependencies — only CSS file modifications
- **DEP-002**: Must be done after hero card color update (already completed in prior session)

## 5. Files

- **FILE-001**: `css/dashboard-modern.css` — all `.modern-dashboard` widget card rules
- **FILE-002**: `css/main.css` — `.dashboard-staff-view` and `.dashboard-admin-view` override rules

## 6. Testing

- **TEST-001**: Visual inspection — open dashboard, verify each widget card has a distinct pastel background
- **TEST-002**: Visual inspection — verify all text is dark and readable on every card
- **TEST-003**: Visual inspection — verify dark mode (`[data-theme="dark"]`) still renders readable cards
- **TEST-004**: `npm run lint` — no errors or warnings
- **TEST-005**: `npm run build` — clean build

## 7. Risks & Assumptions

- **RISK-001**: Some widget card containers use generic `.card` class and differentiating by `:nth-child` may be fragile if DOM order changes
- **RISK-002**: Staff-view `!important` overrides in `main.css` may not be fully enumerated — some may linger with old dark-optimized colors
- **ASSUMPTION-001**: All widget cards are children of either `.dashboard-stats-row` or `.dashboard-detail-section` — no orphan cards elsewhere
- **ASSUMPTION-002**: The pastel color mapping (blue→monthly, green→yearly, amber→journey, purple→tasks, pink/teal→detail) is acceptable to the user

## 8. Related Specifications / Further Reading

- [Previous hero card color change in this session](design-dashboard-widgets-1.md)
- CSS variable reference in `css/dashboard-modern.css` (lines 1-80 define `--md-*` design tokens)
