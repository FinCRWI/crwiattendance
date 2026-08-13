// Shared helpers for the live integration specs under tests/smoke.
//
// These specs log in to the real Firebase backend (Demo/Demo) and assert
// behavior against live seeded data, so they only run when RUN_LIVE=1.
// The default `npx playwright test` run skips them with a clear reason.

const { test } = require('@playwright/test');

const RUN_LIVE = process.env.RUN_LIVE === '1';
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

function skipUnlessLive() {
  test.skip(
    !RUN_LIVE,
    'Live integration test — requires a running app server, real Firebase, and Demo/Demo login. Set RUN_LIVE=1 to run.'
  );
}

// The app uses `?skipGeo=true` to skip geolocation; permission grants are
// belt-and-suspenders for the configured base origin.
async function grantGeolocation(page) {
  const origin = new URL(BASE_URL).origin;
  await page.context().grantPermissions(['geolocation'], { origin });
  await page.context().setGeolocation({ latitude: 19.076, longitude: 72.8777 });
}

// Loads the app and signs in with the Demo account. Returns the logged-in user.
async function loginAsDemo(page) {
  await page.goto('/index.html?skipGeo=true', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(6000);
  const loginForm = page.locator('#login-form');
  if (await loginForm.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#login-form input[name="username"]').fill('Demo');
    await page.locator('#login-form input[type="password"]').fill('Demo');
    await page.locator('#login-form button[type="submit"]').click();
    await page.waitForTimeout(7000);
  }
  const closeBtn = page.locator('text=Close').first();
  if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await closeBtn.click().catch(() => {});
  }
  await page.waitForFunction(
    () => !!window.AppAuth?.getUser?.() && !!window.AppCalendar && !!window.AppDB,
    { timeout: 25000 }
  ).catch(() => {});
  await page.waitForTimeout(2000);

  const user = await page.evaluate(() => {
    const u = window.AppAuth?.getUser?.() || null;
    return { id: u?.id || '', name: u?.name || '', role: u?.role || (u?.isAdmin ? 'Administrator' : '') };
  });
  if (!user.id) throw new Error('Login failed — AppAuth.getUser() returned no user');
  return user;
}

// Collects page errors + console errors so specs can assert the app runs
// cleanly. Known pre-existing infrastructure noise is filtered: Firebase
// permission-denied messages and the work_plans date-range index error (the
// hero/staff-activities dashboard query that silently falls back to getAll).
const KNOWN_NOISE = [
  'Missing or insufficient permissions',
  'The query requires an index',
  'queryMany failed for work_plans'
];
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push('PAGEERROR: ' + String(err).slice(0, 200)));
  page.on('console', (msg) => {
    const t = msg.text();
    if (!t.includes('Error')) return;
    if (KNOWN_NOISE.some((n) => t.includes(n))) return;
    errors.push(t.slice(0, 200));
  });
  return errors;
}

// Scrubs tasks whose text contains any marker from today's personal plans of
// every user (owner + assignee copies). Safe to call repeatedly.
async function removeMarkerTasks(page, markers) {
  await page.evaluate(async (markers) => {
    try {
      const me = window.AppAuth?.getUser();
      const date = window.AppCalendar.getTodayKey();
      if (!me) return;
      const matches = (t) => (markers || []).some((m) => String(t?.task || '').includes(m));
      const scrub = async (userId) => {
        const cur = await window.AppCalendar.getWorkPlan(userId, date, { planScope: 'personal' }).catch(() => null);
        if (cur && Array.isArray(cur.plans) && cur.plans.some(matches)) {
          await window.AppCalendar.setWorkPlan(date, cur.plans.filter((t) => !matches(t)), userId, { planScope: 'personal' });
        }
      };
      await scrub(me.id);
      const users = await window.AppDB.getAll('users').catch(() => []);
      for (const u of (users || [])) {
        if (u.id !== me.id) await scrub(u.id);
      }
    } catch { /* ignore */ }
  }, markers).catch(() => {});
}

module.exports = { RUN_LIVE, BASE_URL, skipUnlessLive, grantGeolocation, loginAsDemo, watchErrors, removeMarkerTasks };
