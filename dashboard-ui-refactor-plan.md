# Dashboard UI Refactor Plan

Based on industry comparison (thefrontkit HR, shadcn/admin, TailAdmin 2025-2026 standards).

---

## 1. Fix Padding & Spacing (ALL Widgets)

**Problem**: `0.7rem` (11px) is too tight vs industry `1rem` (16px). Content feels cramped.

**Files**: `css/main.css`

**Changes**:

| Widget | Current | Target |
|--------|---------|--------|
| `.dashboard-worklog-card` | `0.7rem !important` | `0.85rem !important` |
| `.dashboard-team-activity-card` | `0.7rem !important` | `0.85rem !important` |
| `.dashboard-staff-directory-card` | `0.7rem !important` | `0.85rem !important` |
| `.dashboard-stats-card` | `0.85rem !important` | `0.85rem` (keep) |
| `.dashboard-checkin-card` (modern) | `0.72rem / 0.82rem !important` | `0.85rem !important` |
| `.dashboard-leave-requests-card` | `0.7rem !important` | `0.85rem !important` |
| `.dashboard-team-schedule-card` | inline `0.75rem` | inline `0.85rem` |
| `.dashboard-hero-stats-card` | `clamp(0.56, 1.4vw, 0.78)` | `clamp(0.65, 1.4vw, 0.85rem)` |
| `.dashboard-tagged-card` | `0.85rem` | keep |
| Grid gap: `--card-gap` | `clamp(0.35rem, 0.6vw, 0.5rem)` | `clamp(0.5rem, 0.8vw, 0.75rem)` |
| Grid gap: `.dashboard-detail-section` | `0.75rem` | `0.85rem` |
| Grid gap: `.dashboard-primary-row` | `var(--card-gap)` | keep (inherits) |

---

## 2. Eliminate `!important` Sprawl (~40 declarations → under 10)

**Problem**: `!important` on padding, heights, widths makes CSS fragile. One override breaks layout.

**Strategy**: Replace `!important` with specificity-based selectors.

**Priority targets** (most impactful):

| Current Rule | Fix |
|-------------|-----|
| `.dashboard-worklog-card { padding: 0.85rem !important }` | Remove `!important`, add `&.card` or use parent scope |
| `.dashboard-team-activity-card { padding: 0.85rem !important }` | Same |
| `.dashboard-staff-directory-card { padding: 0.85rem !important }` | Same |
| `.dashboard-stats-card { padding: 0.85rem !important }` | Same |
| `.dashboard-hero-card { height: ... !important; min-height: ... !important }` | Remove `!important` from height dimensions (3 places) |
| `.dashboard-primary-row > .dashboard-primary-col > .dashboard-worklog-card { height: var(...) !important }` | Remove `!important`, add `align-self: stretch` |
| `.dashboard-card-mode-tile height enforcement` | Replace with flex-based equal-height |

**How**: These live inside `.dashboard-staff-view` already, so the specificity chain is long enough without `!important`. Test each removal — if the browser still picks the right value, keep it clean.

---

## 3. Bump Remaining Sub-10px Fonts

**Problem**: Several labels still fail WCAG AA (minimum 10px / 0.625rem).

**Files**: `css/main.css`

| Selector | Current | Target |
|----------|---------|--------|
| `.hero-metric-label` | `0.55rem` (9px) | `0.65rem` (10.4px) |
| `.dashboard-planned-task-chip` | `0.57rem` (9px) | `0.65rem` (10.4px) |
| `.dashboard-hero-eyebrow` | `0.6rem` (9.6px) | `0.65rem` (10.4px) |
| `.dashboard-checkin-kicker` | `0.58rem` (9.3px) | `0.65rem` (10.4px) |
| `.dashboard-hero-eyebrow` (mobile `@media 640px`) | `0.48rem` (7.7px) | `0.6rem` (9.6px) |
| `.dashboard-checkin-kicker` (mobile `@media 640px`) | `0.48rem` (7.7px) | `0.6rem` (9.6px) |
| `.dashboard-modern .dashboard-hero-date` (mobile) | `0.54rem` (8.6px) | `0.6rem` (9.6px) |

---

## 4. Add Keyboard Focus Indicators

**Problem**: No focus outlines on interactive widgets, leaving keyboard users stranded.

**Files**: `css/main.css`

**New rules to add**:

```css
/* All clickable cards */
.dashboard-stats-card:focus-visible,
.dashboard-team-activity-card:focus-visible,
.hero-slot:focus-visible,
.dashboard-cal-day:focus-visible,
[data-dash-id]:focus-visible,
.dashboard-leave-row:focus-visible,
.dashboard-tagged-item:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
    border-radius: inherit;
}
```

---

## 5. Equal-Height System — Replace `!important` Clamp with Flex

**Problem**: `--dashboard-primary-equal-card-h: clamp(240px, 30vh, 290px)` with `!important` and `overflow: hidden` clips content when resized.

**Fix**: Remove the forced height, let cards use `min-height` instead, and let content scroll naturally. The grid's `align-items: start` prevents row stretching.

**Changes in `css/main.css`**:

```css
/* BEFORE (lines 6275-6296) */
.dashboard-staff-view .dashboard-primary-row > .dashboard-primary-col > .dashboard-worklog-card,
.dashboard-staff-view .dashboard-primary-row > .dashboard-primary-col > .dashboard-team-activity-card {
    height: var(--dashboard-primary-equal-card-h) !important;
    min-height: var(--dashboard-primary-equal-card-h) !important;
    max-height: var(--dashboard-primary-equal-card-h) !important;
    overflow: hidden;
}

/* AFTER */
.dashboard-staff-view .dashboard-primary-row > .dashboard-primary-col > .dashboard-worklog-card,
.dashboard-staff-view .dashboard-primary-row > .dashboard-primary-col > .dashboard-team-activity-card {
    min-height: var(--dashboard-primary-equal-card-h);
    height: auto;
    overflow: visible;
}
```

Remove the `.dashboard-card-mode-tile` height duplicates entirely (lines 6288-6296) since tile-mode can rely on the base card styles.

---

## 6. Remove `.dashboard-modern` Class Duality (Optional / Low Priority)

**Problem**: ~40% of dashboard CSS is duplicated under `.dashboard-modern` selectors. If the app always uses this class, strip it.

**Approach**: Find all `.dashboard-modern` prefixed selectors in `main.css` and inline them into the base selector, removing the prefix. Then remove `.dashboard-modern` from the wrapper div in `dashboard.js`.

**Impact**: Cuts ~8KB from CSS, eliminates confusion about which rules apply.

**Risks**: High touch area — skip unless we have dedicated QA time.

---

## 7. Implementation Order

| Phase | Items | Est. CSS Rules Changed |
|-------|-------|----------------------|
| **Phase 1 — Quick wins** | Font bumps (section 3) + Focus indicators (section 4) | ~15 rules |
| **Phase 2 — Spacing** | Padding + gap changes (section 1) | ~12 rules |
| **Phase 3 — CSS debt** | `!important` removal (section 2) + equal-height (section 5) | ~25 rules |
| **Phase 4 — Polish** | `.dashboard-modern` consolidation (section 6) | ~50 rules |

---

## 8. Verification Checklist

After each phase, test:

- [ ] Dashboard renders without visual breakage
- [ ] Widgets align in grid correctly
- [ ] All font sizes at or above 10px for body content
- [ ] Tab through interactive widgets — focus ring visible
- [ ] Card expand/maximize still works
- [ ] Drag-reorder + resize handles still work in edit mode
- [ ] Mobile viewport (≤768px) widgets stack correctly
- [ ] Tablet viewport (768-1024px) widgets show 2 columns
- [ ] No CSS brace imbalance (/etc `node -e` check)
