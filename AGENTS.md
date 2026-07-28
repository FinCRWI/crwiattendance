# CRWI Attendance App — Agent Guidelines

## Project

Firebase-backed attendance management system for CRWI staff. Vanilla JS (no framework), Vite build, PWA with offline support. Deploys to Vercel.

**Not to be confused with `OmniRoute/`** — that is a separate AI proxy/router project nested in this repo. Ignore it for attendance-app work.

## Stack

- **Build**: Vite 7, vanilla JS ES modules
- **Database**: Firebase Firestore (compat SDK v9.23 loaded via `<script>` in `index.html`)
- **Auth**: Client-side session in localStorage (`crwi_session_user`)
- **Hosting**: Vercel (`vercel.json` configures SPA rewrites)
- **PWA**: Service worker (`sw.js` generated at build), manifest.json
- **AI**: OpenRouter API for assistant features (`api/assistant.js`)

## Commands

```bash
npm install              # install deps
npm run dev              # Vite dev server on :3000
npm run build            # Vite build → dist/
npm run lint             # ESLint flat config
npm run test:unit        # Node.js native test runner (tests/unit/*.test.mjs)
npm run test:smoke       # Playwright smoke tests (tests/smoke/)
npm test                 # lint + unit + smoke
```

**Smoke tests require a build first** — the test server (`test_server.ps1`) serves from `dist/`, not source. Run `npm run build` before `npm run test:smoke` if `dist/` is stale.

## Testing

- **Unit tests**: `tests/unit/*.test.mjs` — Node.js native `--test` runner, no framework
- **Smoke tests**: `tests/smoke/*.spec.js` — Playwright, Chromium only
- **Test server**: `test_server.ps1` binds port 8080 (fallback 3004), serves `dist/`
- **Override target**: `$env:BASE_URL="http://localhost:3004"; npm run test:smoke`

## Architecture

Single-page app with hash-based routing (`#dashboard`, `#staff-directory`, etc.).

```
index.html          ← entry point, loads Firebase SDK + app.js
js/app.js           ← main orchestrator, imports all modules
js/config.js        ← AppConfig: timings, policies, feature flags
js/modules/         ← domain modules (auth, db, attendance, leaves, analytics, etc.)
js/ui.js            ← UI rendering
js/utils/           ← date-helpers, html-escape, action-router
css/                ← stylesheets
api/                ← Vercel serverless functions (assistant.js)
scripts/            ← build helpers (generate-build-assets.cjs)
```

### Key Modules

| Module | Purpose |
|--------|---------|
| `auth.js` | Login, session management, heartbeat |
| `db.js` | Firestore adapter with read cache + telemetry |
| `attendance.js` | Check-in/out, pause, status calculation |
| `leaves.js` | Leave policies, balance, application |
| `analytics.js` | Hero of the Week scoring, dashboard summaries |
| `calendar.js` | Task management, day planning |
| `permissions.js` | Role-based access (admin, hr, staff) |
| `day-plan.js` | Daily work plan with carry-forward |
| `admin-policies.js` | Admin UI for tuning policies |

### Firestore Collections

`users`, `attendance`, `leaves`, `minutes`, `staff_messages`, `location_audits`, `work_plans`, `meetings`, `salaries`, `system_commands`, `settings`, `events`, `daily_summaries`, `daily_summaries_meta`, `summary_locks`, `journey_reflections`, `app_meta`, `policies`, `admin_policies`, `annual_plan`, `day_plan`, `budget_heads`, `task_activity_events`

## Gotchas

- **file:// protocol blocked**: App shows security warning if opened directly. Must use dev server or `start_app.cmd`.
- **Service worker cleanup**: On localhost, the app auto-unregisters service workers and purges caches on first load to avoid stale ESM modules.
- **Letter-pad bare imports**: `docx`, `jsPDF`, `html2canvas` are Vite-resolved. Smoke tests against plain static server may fail on these — run against Vite dev server or use built `dist/`.
- **PowerShell execution policy**: Use `cmd.exe /c` wrapper if PS profile is restricted.
- **Config-driven policies**: `js/config.js` → `HERO_POLICY`, `SIMULATION_POLICY`, `SUMMARY_POLICY` control scoring. Admin panel can override and saves to Firestore with schema version bump.
- **Read cache TTLs**: `config.js` → `READ_CACHE_TTLS` controls Firestore read caching. Stale reads are a common source of confusion during development.

## Environment

Copy `.env.example` to `.env`:
```
OPENROUTER_HTTP_REFERER=http://localhost:3004
OPENROUTER_APP_TITLE=CRWI Attendance App
```

Firebase config is hardcoded in `index.html` (public client keys, not secret).

## Style Conventions

- ES modules throughout (`import`/`export`)
- Classes export singleton instances (`AppDB`, `AppAuth`, etc.)
- Config centralized in `js/config.js` — avoid hardcoding magic numbers
- `window.*` aliases for cross-module communication where needed
