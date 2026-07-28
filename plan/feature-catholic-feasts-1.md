---
goal: 'Catholic Feasts: Indian Context Liturgical Calendar Display'
version: '1.0'
date_created: '2026-07-28'
last_updated: '2026-07-28'
owner: 'CRWI Dev Team'
status: 'Completed'
tags: ['feature', 'ux', 'catholic', 'feasts', 'liturgical-calendar', 'india']
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Display today's Catholic feast/liturgical celebration on the dashboard, sourced live from a free public API. No data is stored locally — the system fetches from the API on each dashboard load, so source changes propagate automatically. Optimized for the Indian Catholic context with saints from the General Roman Calendar including Indian-origin saints (Saint Alphonsa, Saint Devasahayam, Saint John de Britto, etc.).

## 1. Requirements & Constraints

- **REQ-001**: Dashboard must display today's Catholic feast day (name, type, liturgical season) in the hero card area
- **REQ-002**: Data must be fetched live from a public API — nothing saved in Firestore or localStorage beyond session cache
- **REQ-003**: If the source API data changes, the app must reflect the change (no permanent local storage)
- **REQ-004**: API must be free, CORS-enabled, no API key required
- **REQ-005**: Feast display must not block dashboard rendering (deferred/non-blocking)
- **REQ-006**: Graceful degradation — if API fails, feast chip is hidden, no error shown
- **REQ-007**: Display must include liturgical season color accent
- **REQ-008**: Indian-context saints must appear (Saint Alphonsa, Saint Devasahayam, Saint John de Britto, Saint Gonsalo Garcia, Saint Thresia Chiramel Mankdiyan, Blessed Augustine Thevarparambel, Mother Teresa)
- **CON-001**: No new npm dependencies — vanilla JS fetch only
- **CON-002**: Total new code must be under 3KB gzipped
- **CON-003**: Feast chip must fit within the existing hero card chip row (no layout restructuring)
- **GUD-001**: Follow existing module pattern — singleton export, `window.*` alias if needed
- **GUD-002**: Use sessionStorage (not localStorage) for 24h cache to avoid hammering API on page refreshes
- **PAT-001**: Follow existing pattern from geocoding (dashboard.js:2268-2294) — deferred fetch, sessionStorage cache, graceful fallback
- **PAT-002**: Follow existing chip pattern from hero card (dashboard.js:2337)

## 2. Implementation Steps

### Implementation Phase 1: Feasts Module

- GOAL-001: Create the core feasts data-fetching module

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `js/modules/feasts.js` with: (a) `getTodayFeast()` async function that fetches `https://gcatholic.org/calendar/ics/2026-en-IN.ics` (GCatholic India iCal feed), parses iCal to find today's feast, (b) sessionStorage cache with date-based key (auto-expires when date changes), (c) `getLiturgicalSeasonColor(season)` helper returning hex color for chip border accent, (d) `window.AppFeasts` alias for cross-module access. Export `getTodayFeast` and `getLiturgicalSeasonColor` as named exports. | ✅ | 2026-07-28 |
| TASK-002 | In `js/modules/feasts.js`, implement the sessionStorage caching logic: (a) cache key = `feast_in:{YYYY-MM-DD}`, (b) on fetch, check cache first, (c) if cache hit and date matches today, return cached, (d) if cache miss or date mismatch, fetch iCal feed and parse for today's entry, (e) store result in sessionStorage with today's date, (f) max cache TTL = 24 hours (implicit via date-key). Pattern follows `dashboard.js:2275-2291` geocoding cache. | ✅ | 2026-07-28 |
| TASK-003 | In `js/modules/feasts.js`, implement `getLiturgicalSeasonColor(season)` mapping: `Advent` → `#6b21a8` (purple), `Christmas` → `#d97706` (gold), `Lent` → `#7c3aed` (violet), `Easter` → `#059669` (white/green), `Ordinary Time` → `#16a34a` (green), default → `#6b7280` (gray). Also export a `getLiturgicalSeasonIcon(season)` returning Font Awesome class: Advent → `fa-candle-snuffer`, Christmas → `fa-star`, Lent → `fa-cross`, Easter → `fa-dove`, Ordinary Time → `fa-leaf`. | ✅ | 2026-07-28 |

### Implementation Phase 2: Dashboard Integration

- GOAL-002: Wire feasts into the dashboard hero card

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | In `js/ui/dashboard.js`, add `import { getTodayFeast, getLiturgicalSeasonColor, getLiturgicalSeasonIcon } from '../modules/feasts.js'` at the top (near other module imports). Verify no circular dependency issues. | ✅ | 2026-07-28 |
| TASK-005 | In `js/ui/dashboard.js`, modify the hero card chip row (line ~2337) to include a feast chip placeholder: `<div class="dashboard-hero-chip-feast" id="dashboard-feast-chip"></div>`. This is a static placeholder — the actual content is populated async after render. | ✅ | 2026-07-28 |
| TASK-006 | In `js/ui/dashboard.js`, after `renderDashboard()` returns HTML (near line ~2265), add a deferred `setTimeout(() => { ... }, 0)` block that: (a) calls `getTodayFeast()`, (b) if result exists, populates `#dashboard-feast-chip` with feast name + season icon, (c) sets inline `border-left-color` to season color, (d) if no result or error, hides the chip. Pattern follows `dashboard.js:2268-2294` geocoding deferred fetch. | ✅ | 2026-07-28 |

### Implementation Phase 3: CSS Styling

- GOAL-003: Style the feast chip to match the existing hero card chip design

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | In `css/dashboard-modern.css`, add `.dashboard-hero-chip-feast` styles: (a) `display: none` by default (shown via JS), (b) `display: inline-flex` when `.dashboard-hero-chip-feast[data-feast-loaded="true"]`, (c) inherits existing `.dashboard-hero-chip` base styles (padding, font-size, border-radius, background), (d) `border-left: 3px solid var(--md-secondary)` for season color accent, (e) subtle gradient background matching feast type (solemnity=slightly gold, feast=white, memorial=light blue). | ✅ | 2026-07-28 |
| TASK-008 | In `css/dashboard-modern.css`, add dark mode support for feast chip: `[data-theme="dark"] .dashboard-hero-chip-feast` with adjusted background and text colors. Also add mobile responsive: `[data-viewport="mobile"] .dashboard-hero-chip-feast` with smaller font size and padding. | ✅ | 2026-07-28 |

### Implementation Phase 4: Build & Verify

- GOAL-004: Ensure everything builds and passes lint

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Run `npm run lint` — fix any new lint errors introduced by feasts.js and dashboard.js changes. | ✅ | 2026-07-28 |
| TASK-010 | Run `npm run build` — verify dist/ size increase is under 3KB gzipped. | ✅ | 2026-07-28 |
| TASK-011 | Manual smoke test: (a) load dashboard, verify feast chip appears with correct feast name for today, (b) verify liturgical season color matches, (c) verify chip is hidden when API fails (simulate by disconnecting network), (d) verify feast updates when date changes (manually change system clock), (e) verify no console errors. | ✅ | 2026-07-28 |

## 3. Alternatives

- **ALT-001**: Use GCatholic.org India calendar (gcatholic.org/calendar/2026/IN-en) — rejected because it has no JSON API, only HTML and iCal. Would require scraping or iCal parsing, which is fragile and adds complexity.
- **ALT-002**: Use LitCal API (litcal.johnromanodorazio.com) — rejected because India is not confirmed in the default nation list, and the API is more complex (requires nation/diocese parameters).
- **ALT-003**: Store feast data in Firestore — rejected because user explicitly wants live data from API with no local storage, and feast data changes annually.
- **ALT-004**: Show feasts as a separate card in the bento grid — rejected because it would require layout restructuring and take up valuable dashboard real estate. Hero chip is more elegant.
- **ALT-005**: Show multiple days (today + tomorrow) — rejected for v1 to keep it simple. Can be added later.
- **ALT-006**: Use parishcompanion.org API — rejected because it only supports Australia currently.

## 4. Dependencies

- **DEP-001**: GCatholic India iCal feed (`gcatholic.org/calendar/ics/2026-en-IN.ics`) — free, no API key, auto-updates from GCatholic.org
- **DEP-002**: `js/ui/dashboard.js` (lines 2337, 2265-2294) — hero card chip row and deferred fetch pattern
- **DEP-003**: `css/dashboard-modern.css` — existing `.dashboard-hero-chip` styles to inherit from
- **DEP-004**: Font Awesome icons (already in project) — for season icons

## 5. Files

- **FILE-001**: `js/modules/feasts.js` — New file: feast fetching, caching, season color/icon helpers
- **FILE-002**: `js/ui/dashboard.js` — Modified: import feasts module, add chip placeholder, add deferred fetch (lines ~2337, ~2265)
- **FILE-003**: `css/dashboard-modern.css` — Modified: add `.dashboard-hero-chip-feast` styles (near line ~260, after existing chip styles)

## 6. Testing

- **TEST-001**: Run `npm run lint` after each phase to verify no lint errors
- **TEST-002**: Run `npm run build` to verify build succeeds
- **TEST-003**: Manual test: load dashboard on 2026-07-28 (Saint Alphonsa feast day) — verify chip shows "Saint Alphonsa Muttathu Padathu, Virgin" or similar
- **TEST-004**: Manual test: verify liturgical season color is green (Ordinary Time) for July
- **TEST-005**: Manual test: disconnect network, reload dashboard — verify feast chip is hidden, no error shown
- **TEST-006**: Manual test: check sessionStorage for `feast_in:2026-07-28` key — verify data is cached
- **TEST-007**: Manual test: verify feast chip appears in hero card chip row alongside "Your Rating" chip
- **TEST-008**: Manual test: verify dark mode renders feast chip correctly
- **TEST-009**: Manual test: verify mobile viewport renders feast chip correctly

## 7. Risks & Assumptions

- **RISK-001**: API uptime — GCatholic.org is a well-established Catholic resource with high uptime. Mitigation: graceful degradation (chip hidden on failure), sessionStorage cache reduces frequency of calls.
- **RISK-002**: iCal format changes — unlikely as GCatholic has been stable for years. Mitigation: defensive parsing with null checks.
- **RISK-003**: iCal feed may be large (~500KB) — fetched once per day, cached in sessionStorage. Acceptable for a daily fetch.
- **RISK-004**: Feast chip may add visual clutter — mitigation: chip is small (fits in existing chip row), uses muted colors, and is optional (hidden on failure).
- **ASSUMPTION-001**: GCatholic.org will continue to maintain the India iCal feed (currently has 2026 data complete)
- **ASSUMPTION-002**: Font Awesome icons are available in the project (confirmed: project uses Font Awesome via CDN)
- **ASSUMPTION-003**: sessionStorage is available in all target browsers (confirmed: supported in all modern browsers)

## 8. Related Specifications / Further Reading

- GCatholic India Calendar: https://gcatholic.org/calendar/2026/IN-en
- GCatholic India iCal Feed: https://gcatholic.org/calendar/ics/2026-en-IN.ics
- General Roman Calendar: https://www.vatican.va/
- AGENTS.md: `D:\Attendace-app-main\AGENTS.md` — project conventions
- Existing geocaching pattern: `D:\Attendace-app-main\js\ui\dashboard.js:2268-2294`
- Existing chip styles: `D:\Attendace-app-main\css\dashboard-modern.css:241-271`
