# CRWI Budget App — Integration Note (staff portal)

> **Two separate projects.** The CRWI Budget App is an **independent repository**
> (`D:\BUDGET APP`). It is **not** a copy/merge of any part of this staff portal codebase,
> and this repo does not build or contain the budget source. The two connect only at runtime:
> they share the same Firestore backend and the budget is surfaced through a navigation link.

## What attaches the budget app here

1. **Shared backend** — both apps use the Firestore project `crwiattendance`. This portal's
   `firestore.rules` allowlists the `budget` collection so the budget app can read/write
   `budget/workbook`.
2. **Navigation link** — sidebar ("Tools" section) and mobile nav have a **Budget** item
   anchored to `/budget/` (added in `index.html`).

## Firestore rules

`firestore.rules` already lists `'budget'` in the allowlist (adjacent to the existing
`budget_heads`). To deploy the rule change into the live project:

```bash
firebase deploy --only firestore:rules
```
(or `npx firebase deploy --only firestore:rules`). Do this once before first real use.

## Exposing the budget app at /budget/ (Option B — separate projects, subpath proxy)

Both remain separate Vercel/deploy units. The staff site proxies `/budget/*` to the budget
app's own deployment:

1. **Budget app**: build with relative base (already set: `base: './'` in
   `D:\BUDGET APP\vite.config.js`) and `VITE_BUDGET_STORAGE=firestore`. Relative base makes
   all assets resolve correctly under the `/budget/` subpath.
2. **Deploy the budget app** to its own host (e.g. its own Vercel project). Call its URL
   `<BUDGET_URL>`.
3. **Proxy here** — add a rewrite to this repo's `vercel.json`:

```json
{
  "source": "/budget/:path*",
  "destination": "https://<BUDGET_URL>/:path*"
}
```

Important: keep the trailing slash when linking — the menu uses `/budget/` so relative asset
paths resolve correctly.

### Alternative (no proxy): host inside this deploy
Skip the rewrite and place the budget `dist/` at `dist/budget/` in this project's output.
Relative asset paths still resolve. Only choose this if you do **not** need the two
repositories to stay fully separate at build time.

## Current status

- [x] Shared Firestore config (budget app uses project `crwiattendance`).
- [x] `firestore.rules` allowlists `budget`.
- [x] Sidebar + mobile **Budget** links added (`index.html`).
- [x] Local dev link points to the budget app at `http://localhost:3001` (budget runs on port 3001 so it does not clash with this staff app on port 3000).
- [x] Budget app now uses its **own** Firestore project (`budget-crwi`) — the `budget`/`budget_users` collections were removed from this project's rules.
- [x] Sidebar + mobile links point to `https://budget.crwi.org.in/` (own subdomain).
- [ ] Deployed budget app `<BUDGET_URL>` (needs credentials/host access).
- [ ] Swap the two links from `http://localhost:3001` to `href="/budget/"` and add the `vercel.json` rewrite with the real `<BUDGET_URL>`.
- [ ] Firestore rules deployed to production.

The budget app's own docs live at `D:\BUDGET APP\INTEGRATION.md` and
`D:\BUDGET APP\BACKUP.md`.