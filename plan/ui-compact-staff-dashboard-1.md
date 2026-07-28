---
goal: Compact Non-Admin Staff Dashboard
version: 1.0
date_created: 2026-07-28
last_updated: 2026-07-28
owner: AI Agent
status: Planned
tags: feature, ui, dashboard, staff, compact
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Make the non-admin staff dashboard layout more compact — tighter spacing, reduced font sizes for secondary text, minimized card padding, and collapsed sections — so more content is visible without scrolling, especially on 1366px+ screens. Only CSS changes to `css/dashboard-modern.css` are required; no JS logic or template structure is altered.

## 1. Requirements & Constraints

- **REQ-001**: Only the staff (non-admin) dashboard view shall be compacted; the admin view must remain unchanged.
- **REQ-002**: Target viewport is 1366px+ (desktop/tablet); mobile responsiveness must not regress.
- **REQ-003**: No JavaScript logic, template strings, or component behaviour shall be modified — CSS only.
- **REQ-004**: All existing functional sections must remain present and visible (feast widget, leave summary, hero card, check-in, yearly plan, work log, activity log, stats, journey reflection).
- **SEC-001**: No content or data shall be hidden, truncated, or removed.
- **CON-001**: Staff view is distinguished by `.dashboard-staff-view` class on `.dashboard-grid`. All compact rules must be scoped to `.dashboard-staff-view .modern-dashboard` or `.dashboard-staff-view .dashboard-hero-card` etc.
- **GUD-001**: Follow the existing design token system (`--md-radius-*`, `--md-shadow-*`, `--md-*` color vars).
- **PAT-001**: Use CSS scoping under `.dashboard-staff-view` to avoid altering admin view.

## 2. Implementation Steps

### Implementation Phase 1 — Reduce Overall Layout Gaps & Card Padding

- GOAL-001: Reduce the bento grid gaps, card padding, and section margins to tighten the vertical layout without breaking the grid structure.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Scope `.dashboard-staff-view .modern-bento-grid` — reduce `gap` from `1.25rem` to `0.85rem` and `margin-top` from `0.25rem` to `0.15rem`. | | |
| TASK-002 | Scope `.dashboard-staff-view .modern-bento-main` — reduce `gap` from `1.25rem` to `0.75rem`. | | |
| TASK-003 | Scope `.dashboard-staff-view .modern-bento-sidebar` — reduce `gap` from `1.25rem` to `0.75rem`. | | |
| TASK-004 | Scope `.dashboard-staff-view .modern-dashboard-header` — reduce `margin-bottom` from `1rem` to `0.5rem`. | | |
| TASK-005 | Scope `.dashboard-staff-view .dashboard-hero-card` — reduce `padding` from `0.85rem 1rem` to `0.55rem 0.85rem` and `margin-bottom` from `0.4rem` to `0`. | | |
| TASK-006 | Scope `.dashboard-staff-view .dashboard-primary-row` — reduce `gap` from `1rem` to `0.65rem`. | | |
| TASK-007 | Scope `.dashboard-staff-view .dashboard-detail-section` — reduce `gap` from `1rem` to `0.55rem`. | | |
| TASK-008 | Scope `.dashboard-staff-view .dashboard-stats-row` — reduce `gap` from `1rem` to `0.55rem`. | | |

### Implementation Phase 2 — Compact Card Internal Spacing

- GOAL-002: Reduce internal padding inside all bento cards (check-in, work plan, activity, journey reflection, stats, feast widget, leave summary) while preserving visual hierarchy.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Scope `.dashboard-staff-view .modern-dashboard .card` — reduce `padding` from existing values to `0.65rem` for general dashboard cards (overrides base `.card`). Keep `border-radius: var(--md-radius-md)` (12px) instead of lg (16px). | | |
| TASK-010 | Scope `.dashboard-staff-view .dashboard-detail-section .card` — set `padding: 0.55rem 0.75rem` (currently 1rem inherited). | | |
| TASK-011 | Scope `.dashboard-staff-view .dashboard-stats-row .card` — set `padding: 0.65rem 0.85rem` (currently 1.25rem). | | |
| TASK-012 | Scope `.dashboard-staff-view .dashboard-checkin-card .dashboard-checkin-head` — reduce `margin-bottom` from `1rem` to `0.45rem` and `gap` from `0.75rem` to `0.5rem`. | | |
| TASK-013 | Scope `.dashboard-staff-view .dashboard-checkin-card .dashboard-checkin-avatar` — set `width: 36px; height: 36px;` (smaller avatar). | | |
| TASK-014 | Scope `.dashboard-staff-view .dashboard-checkin-name` — set `font-size: 0.8rem`. | | |
| TASK-015 | Scope `.dashboard-staff-view .dashboard-checkin-role` — set `font-size: 0.6rem`. | | |
| TASK-016 | Scope `.dashboard-staff-view .dashboard-timer-display` — set `font-size: 1.5rem` (reduced from ~2rem). | | |
| TASK-017 | Scope `.dashboard-staff-view .dashboard-checkin-timer-label` — set `font-size: 0.6rem` (reduced from ~0.7rem). | | |
| TASK-018 | Scope `.dashboard-staff-view .dashboard-checkin-countdown-meta` — set `font-size: 0.6rem`. | | |
| TASK-019 | Scope `.dashboard-staff-view .dashboard-checkin-action-row` — reduce `padding-top` and `gap` to `0.35rem`. | | |
| TASK-020 | Scope `.dashboard-staff-view .dashboard-checkin-card .dashboard-checkin-location` — set `font-size: 0.55rem; margin-top: 0.25rem;`. | | |

### Implementation Phase 3 — Compact Content Cards (Feast, Leave, Hero, Activity, Journey)

- GOAL-003: Tighten spacing inside the feast widget, staff leave summary, hero of the week, activity log, and journey reflection cards.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-021 | Scope `.dashboard-staff-view .dashboard-feast-widget` — set `border-left-width: 3px`. | | |
| TASK-022 | Scope `.dashboard-staff-view .dashboard-feast-widget-body` — reduce `padding` from `0.85rem 1rem` to `0.45rem 0.65rem` and `gap` from `0.75rem` to `0.5rem`. | | |
| TASK-023 | Scope `.dashboard-staff-view .dashboard-feast-widget-name` — reduce `font-size` from `0.9rem` to `0.78rem`. | | |
| TASK-024 | Scope `.dashboard-staff-view .dashboard-feast-widget-type` — reduce `font-size` from `0.7rem` to `0.6rem`. | | |
| TASK-025 | Scope `.dashboard-staff-view .dashboard-feast-widget-img` — set `width: 36px; height: 36px;`. | | |
| TASK-026 | Scope `.dashboard-staff-view .dashboard-staff-leave-summary` — reduce padding to `0.55rem 0.75rem`. Set `.dashboard-tagged-item` padding to `0.35rem 0`. Set `.dashboard-tagged-title` font-size to `0.78rem`. Set `.dashboard-tagged-desc` font-size to `0.65rem`. Set `.dashboard-view-all-link` font-size to `0.75rem; padding: 0.3rem;`. | | |
| TASK-027 | Scope `.dashboard-staff-view .dashboard-hero-card .dashboard-hero-title` — reduce `font-size` from `1.05rem` to `0.85rem`. | | |
| TASK-028 | Scope `.dashboard-staff-view .dashboard-hero-card .dashboard-hero-chip-row` — reduce `gap` from `0.35rem` to `0.2rem`. | | |
| TASK-029 | Scope `.dashboard-staff-view .dashboard-hero-card .dashboard-hero-chip` — reduce `font-size` from `0.6rem` to `0.55rem` and `padding` to `0.1rem 0.3rem`. | | |
| TASK-030 | Scope `.dashboard-staff-view .dashboard-team-activity-card` — reduce `padding` from `1rem` to `0.55rem 0.75rem`. Set `.dashboard-activity-item` padding to `0.3rem 0`. Set `.dashboard-activity-desc` font-size to `0.7rem`. Set `.dashboard-activity-meta` font-size to `0.6rem`. Set `.dashboard-activity-date` font-size to `0.55rem`. | | |
| TASK-031 | Scope `.dashboard-staff-view .dashboard-journey-card` — reduce `min-height` constraints and padding. Set `padding: 0.15rem;`. | | |

### Implementation Phase 4 — Stats Card & Primary Row Compactness

- GOAL-004: Compact the stats cards (monthly/yearly) and primary row cards (yearly plan, work log).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-032 | Scope `.dashboard-staff-view .dashboard-stats-row .card .stats-header` — reduce `font-size` to `0.7rem` and `margin-bottom` to `0.35rem`. | | |
| TASK-033 | Scope `.dashboard-staff-view .dashboard-stats-row .card .stats-value` — reduce `font-size` to `0.85rem`. | | |
| TASK-034 | Scope `.dashboard-staff-view .dashboard-stats-row .card .stats-label` — reduce `font-size` to `0.65rem`. | | |
| TASK-035 | Scope `.dashboard-staff-view .dashboard-primary-row .dashboard-primary-col > .card` — set `padding: 0.55rem 0.75rem`. | | |
| TASK-036 | Scope `.dashboard-staff-view .dashboard-primary-row .card h4` — set `font-size: 0.8rem;`. | | |
| TASK-037 | Scope `.dashboard-staff-view .dashboard-primary-row .card .text-muted` — set `font-size: 0.65rem;`. | | |

### Implementation Phase 5 — Admin Actions Row (Three-Column Side-by-Side)

- GOAL-005: Lay out the three admin cards (leave requests, missed checkout, leave history) in a 3-column row instead of vertical stacking, saving vertical space when all are empty states.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-038 | Wrap `${renderLeaveRequests()}${renderMissedCheckoutRequests()}${historyHTML}` in `<div class="dashboard-admin-actions-row">` inside `js/ui/dashboard.js:2228`. | ✅ | 2026-07-28 |
| TASK-039 | Add CSS `.dashboard-staff-view .dashboard-admin-actions-row` with `display: grid; grid-template-columns: repeat(3, 1fr)` and mobile breakpoint to stack. | ✅ | 2026-07-28 |

### Implementation Phase 6 — Mobile & Tablet Responsiveness Verification

- GOAL-006: Verify all compact styles degrade gracefully on mobile and tablet. No task-list items should overlap or break.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-040 | Run `npm run lint` — confirm 0 new errors. | ✅ | 2026-07-28 |
| TASK-041 | Run `npm run build` — confirm build succeeds. | ✅ | 2026-07-28 |
| TASK-042 | Open staff dashboard on viewport widths 375px, 768px, 1024px, 1366px and verify no layout breaks (screenshots). | | |

## 3. Alternatives

- **ALT-001**: Collapse sections behind accordion/toggles (rejected — requires JS changes, violates REQ-003 CSS-only constraint).
- **ALT-002**: Use CSS `zoom` or `transform: scale()` on the dashboard container (rejected — causes blurry text and breaks coordinate-based interactions).
- **ALT-003**: Reduce the number of sections shown to staff (rejected — violates REQ-004 and SEC-001).

## 4. Dependencies

- **DEP-001**: `css/dashboard-modern.css` — the single file modified by all tasks.
- **DEP-002**: `.dashboard-staff-view` class must already exist on the staff dashboard grid element (verified present at `js/ui/dashboard.js:2333`).

## 5. Files

- **FILE-001**: `css/dashboard-modern.css` — add ~230 lines of scoped CSS rules under `.dashboard-staff-view` selectors.
- **FILE-002**: `js/ui/dashboard.js:2228` — wrap three cards in `<div class="dashboard-admin-actions-row">`.

## 6. Testing

- **TEST-001**: `npm run lint` — must produce 0 new errors/warnings.
- **TEST-002**: `npm run build` — must produce a passing build with no new warnings.
- **TEST-003**: Visual regression — open staff dashboard (`Demo` user) at 1366px width, full-page screenshot, compare that all sections (feast, hero, check-in, yearly plan, work log, activity, stats, journey) are rendered without overlaps.

## 7. Risks & Assumptions

- **RISK-001**: Some `.card` padding reductions may cause text to overlap if cards have fixed-height children. Mitigation: use `min-height: 0` and avoid `height` constraints.
- **RISK-002**: The `.dashboard-journey-card` has complex background decorations; reducing its padding may clip the decorative gradient. Mitigation: test with the journey card visible and adjust padding/overflow as needed.
- **ASSUMPTION-001**: The `.dashboard-staff-view` class is present and stable at line 2333 of `dashboard.js`.
- **ASSUMPTION-002**: No future CSS changes in `dashboard-modern.css` will remove or rename `.dashboard-staff-view`.

## 8. Related Specifications / Further Reading

- `js/ui/dashboard.js:2333` — `dashboard-grid dashboard-staff-view modern-dashboard` class output
- `css/dashboard-modern.css` — target file for all CSS changes
- Feature plan: `plan/feature-catholic-feasts-1.md` (feast widget reference)
