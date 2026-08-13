# CRWI Attendance App – Project Memory

> This file captures key architectural decisions, scoring logic, and config values
> so future developers (or AI assistants) can resume work without re-discovery.

---

## Hero of the Week – Scoring System (v5)

### Overview
The "Hero of the Week" identifies the top-performing staff member each week using a
**weighted composite score** rather than a simple completion ratio. This prevents
staff who complete 1 of 1 task (100%) from outranking staff who complete 8 of 10 tasks (80%).

### Scoring Formula
```
taskScore =
    (completionRate        × 0.20)
  + (absoluteVolumeScore   × 0.30)   ← heaviest weight
  + (executionQualityScore × 0.20)
  - (missPenaltyScore      × 0.10)
  - (postponedPenaltyScore × 0.02)   ← very light
  + (planningBreadthScore  × 0.15)

attendanceReliability =
    (consistencyScore/100 × 0.65) + (effortScore/100 × 0.35)

attendanceFactor =
    max(0.5, 0.9 + min(0.15, attendanceReliability × 0.15))

finalScore = taskScore × attendanceFactor
```

### Eligibility (Strict AND gate)
All three must be satisfied:
| Criterion          | Threshold  |
|--------------------|-----------|
| `minPlannedTasks`  | ≥ 3       |
| `minDays`          | ≥ 3       |
| `minDurationMs`    | ≥ 4 hours (14,400,000 ms) |

### Postponed Task Handling
- **Auto-neutralization**: If a postponed task is completed within the same week,
  the postponed entry is filtered out — no penalty applied.
- **Residual penalty**: If the task stays postponed, it carries only 2% weight
  (vs 10% for a truly missed task).

### Config Location
- `js/config.js` → `HERO_POLICY` object
- All hero policy fields are editable by admins via the **Hero of the Week Control Panel** on the Policies page:
  - `WEIGHTS`
  - `WINDOW_DAYS`
  - `FALLBACK_LOOKBACK_DAYS`
  - `EXPECTED_WEEKLY_TASKS`
  - `DEFAULT_ACTIVITY_SCORE`
  - `ATTENDANCE_MODIFIER`
  - `CAPS`
  - `MIN_EVIDENCE` (`minDurationMs` is edited as hours in the UI and saved back in milliseconds)
- Saving from the admin panel auto-increments `SCHEMA_VERSION`, which forces
  a cache invalidation for all clients on their next dashboard load.

### Key Files
| File | Purpose |
|------|---------|
| `js/config.js` | Default policy values and schema version |
| `js/modules/analytics.js` | `rankHeroCandidates`, `scoreHeroFromLogs`, `normalizeHeroTasks` |
| `js/modules/admin-policies.js` | Admin UI for tuning weights and saving to Firestore |
| `js/ui/dashboard.js` | `renderHeroCard()`, `app_forceRefreshHero()` |
| `reports/hero-of-the-week-plan.md` | Detailed layout/behaviour reference |

---

## Admin Manual Refresh (Hero of the Day)

- An **admin-only** refresh button (🔄) appears on the Hero Card in the dashboard.
- Clicking it:
  1. Invalidates local caches for `daily_summaries`, `attendance`, `work_plans`, and `users`.
  2. Calls `AppAnalytics.buildDailyDashboardSummary()` with fresh data.
  3. Writes the new summary to Firestore with `heroRefreshedToday: true`.
  4. Clears the entire in-memory cache and re-renders the dashboard.
- The button is **disabled after one use per day** (enforced by checking the
  `heroRefreshedToday` flag on the Firestore daily summary doc).
- Permission check: `app_hasPerm('dashboard', 'admin', currentUser)`.

---

## Hero Task Modal Fixes

- The hero-of-the-week task popout now refreshes from live data after each action instead of reopening on a delayed timeout.
- `Delete` now waits for `AppCalendar.removeTask()` to finish, then refreshes the hero list from the latest leaderboard data.
- `Postpone` now waits for the task move to complete before refreshing the hero modal, which avoids the duplicate-looking stale state.
- Hero analytics now ignore removed tasks and shadow postponed source tasks when a postponed copy exists, so deleted items do not reappear and postponed tasks are not double-counted in the hero modal.

## Dashboard Refresh Guard

- `app_refreshDashboard()` now exits unless the current route is the main dashboard.
- This prevents task completion flows from forcing a dashboard redraw while the user is inside other pages such as Team Activities.

---

## Hero And Team Activity Sync

- The Hero of the Week task popout now uses the same normalized activity rows as Team Activities for task status and task identity.
- `postponed` is preserved as a distinct status in the shared status helpers, so postponed tasks do not get collapsed into overdue or missed states.
- Hero task ranking now excludes removed tasks and shadows the source task when a postponed copy exists, which prevents deleted items from reappearing and stops postponed items from being double-counted.
- Team Activities actions (`complete`, `postpone`, `remove`, and bulk remove) now trigger a hero refresh after the write succeeds, so both screens stay in sync immediately.

---

## Caching Strategy

| Layer | TTL | Key Pattern |
|-------|-----|-------------|
| Daily summary (Firestore) | 24 h | `daily_summaries/{YYYY-MM-DD}` |
| Hero stats (in-memory) | 24 h | `hero_stats_v{SCHEMA_VERSION}_{todayStr}` |
| Hero leaderboard (in-memory) | 24 h | `hero_leaderboard_v{SCHEMA_VERSION}_{todayStr}` |
| Work plans (read cache) | 60 s | `all:work_plans:*` |
| Users (read cache) | 60 s | `all:users:*` |
| Staff activity aggregation cache | 60 s | `analytics:workPlans:{mode}:{scope}:{start}:{end}` |
| Work plan doc/all read cache | 120 s | `doc:work_plans:*`, `all:work_plans:*` |
| Day-plan modal payload cache | 15 s | `dayPlanLoadCache:{date}:{targetId}` |

Carry-forward and calendar aggregation helpers now return empty results on query failure instead of falling back to full `work_plans` collection reads.

**Day-plan open/prefetch path**: fetches by known doc ids only via `AppDB.getDayPlansByIds(date, userIds)` — `plan_annual_{date}` plus `plan_{userId}_{date}` per user from the cached users list (IN-queries in chunks of 10 via `getManyByIds`). No date-scoped `work_plans` collection query runs on this path; `getDayPlansByDate` is retained as an error-only fallback. Coverage: `tests/unit/day-plan-doc-ids.test.mjs`.

Schema version bump → stale cache keys stop matching → automatic recalculation.

---

## Environment & Build Notes

- **Framework**: Vite (vanilla JS, no React/Vue/Angular)
- **Database**: Firebase Firestore (compat SDK loaded via `<script>` in `index.html`)
- **Hosting**: Vercel
- **Test runner**: Playwright (smoke tests in `tests/smoke/`)
- **Test server**: `test_server.ps1` on port 3004 (serves from root, not `dist/`)
- **PowerShell execution policy**: The user's machine has a restricted PS profile;
  use `cmd.exe /c` to wrap commands when needed.
- **Third-party ES imports**: `docx`, `jsPDF`, `html2canvas` are used in `letter-pad.js`.
  These are resolved by Vite at build time but cause bare-specifier errors if the
  app is served from a plain static server without bundling.

---

## Open Items / Future Improvements

- [ ] Consider adding a "Hero of the Month" aggregate view.
- [ ] Expose postponed-neutralization window (currently same-week) as an admin config.
- [ ] Add unit tests for `rankHeroCandidates` and `scoreHeroFromLogs`.
- [ ] The smoke test (`tests/smoke/app.spec.js`) currently fails on the plain
      static test server because `letter-pad.js` uses bare ES module imports (`docx`).
      Either add an import map or run smoke tests against the Vite dev server.
