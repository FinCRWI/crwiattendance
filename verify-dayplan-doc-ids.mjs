import { chromium } from 'playwright';

// Verifies the day-plan open/prefetch path now fetches by doc ids only
// (AppDB.getDayPlansByIds) instead of a date-scoped work_plans query,
// and that the modal still renders personal/annual/shared sections.

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.grantPermissions(['geolocation'], { origin: 'http://localhost:3000' });
await context.setGeolocation({ latitude: 19.076, longitude: 72.8777 });
const page = await context.newPage();

const consoleErrors = [];
page.on('dialog', d => { d.accept(); });
page.on('console', msg => {
  const t = msg.text();
  if (t.includes('Error') && !t.includes('Missing or insufficient permissions')) consoleErrors.push(t.slice(0, 160));
});
page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + String(err).slice(0, 160)));

const step = (msg) => console.log('•', msg);

try {
  step('1. Loading + logging in (Demo/Demo)');
  await page.goto('http://localhost:3000/?skipGeo=true', { waitUntil: 'load', timeout: 25000 });
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
  await page.waitForFunction(() => !!window.AppDB && !!window.AppCalendar && !!window.AppAuth?.getUser?.(), { timeout: 25000 });

  const who = await page.evaluate(() => {
    const u = window.AppAuth?.getUser?.() || null;
    return { id: u?.id || '', name: u?.name || '' };
  });
  step(`   logged in as ${who.name} (${who.id})`);

  step('2. Instrument DB read paths BEFORE any day-plan open');
  await page.evaluate(() => {
    const DB = window.AppDB;
    const state = { counts: {}, lastIds: null, workPlansChunks: [] };
    const wrap = (name, fn) => {
      return async function (...args) {
        state.counts[name] = (state.counts[name] || 0) + 1;
        if (name === 'getDayPlansByIds') state.lastIds = args;
        if (name === 'getManyByIds' && args[0] === 'work_plans') state.workPlansChunks.push(args[1]);
        return fn.apply(this, args);
      };
    };
    DB.getDayPlansByIds = wrap('getDayPlansByIds', DB.getDayPlansByIds);
    DB.getDayPlansByDate = wrap('getDayPlansByDate', DB.getDayPlansByDate);
    DB.getManyByIds = wrap('getManyByIds', DB.getManyByIds);
    window.__dp = {
      state,
      reset: () => { state.counts = {}; state.lastIds = null; state.workPlansChunks = []; }
    };
    return true;
  });

  const openModalAndInspect = async (date, label) => {
    await page.evaluate(() => window.__dp.reset());
    await page.evaluate((d) => {
      if (window.app_openDayPlan) window.app_openDayPlan(d);
    }, date);
    await page.waitForSelector('.day-plan-form', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => {
      const counts = window.__dp.state.counts;
      const chunks = window.__dp.state.workPlansChunks || [];
      const allIds = chunks.flat();
      const lastDate = window.__dp.state.lastIds ? window.__dp.state.lastIds[0] : null;
      return {
        counts,
        lastIds: window.__dp.state.lastIds
          ? { date: lastDate, idCount: (window.__dp.state.lastIds[1] || []).length }
          : null,
        workPlansIds: allIds,
        annualInFetchedIds: lastDate ? allIds.includes(`plan_annual_${lastDate}`) : false,
        modal: {
          hasForm: !!document.querySelector('.day-plan-form'),
          hasLoading: !!document.querySelector('.day-plan-loading-state'),
          personalBlocks: document.querySelectorAll('.personal-plans-container .plan-block').length,
          sharedBlocks: document.querySelectorAll('.others-plans-container .plan-block-ref').length
        }
      };
    });
    console.log(JSON.stringify({ label, ...state }));
    await page.evaluate(() => {
      document.querySelectorAll('#day-plan-modal, .modal-overlay').forEach(el => el.remove());
    }).catch(() => {});
    await page.waitForTimeout(400);
    return state;
  };

  step('3. Open day-plan for today (prefetched at dashboard load)');
  const todayKey = await page.evaluate(() => window.AppCalendar?.getTodayKey?.() || '');
  const todayState = await openModalAndInspect(todayKey, `today=${todayKey}`);

  step('4. Open day-plan for a future date (fresh doc-id fetch)');
  const futureDate = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().split('T')[0];
  });
  const futureState = await openModalAndInspect(futureDate, `future=${futureDate}`);

  step('5. Assertions');
  const results = {
    todayModalRendered: todayState.modal.hasForm && !todayState.modal.hasLoading,
    futureModalRendered: futureState.modal.hasForm && !futureState.modal.hasLoading,
    futureUsedDocIds: (futureState.counts.getDayPlansByIds || 0) >= 1,
    futureNoDateQuery: (futureState.counts.getDayPlansByDate || 0) === 0,
    futureAnnualInFetchedIds: futureState.annualInFetchedIds === true,
    futureLastIdsIncludeDemo: (futureState.lastIds?.idCount || 0) >= 2,
    todayNoDateQuery: (todayState.counts.getDayPlansByDate || 0) === 0,
    todaySharedReferences: (todayState.modal.sharedBlocks || 0) >= 1
  };
  console.log(JSON.stringify({ results }, null, 2));
  console.log(JSON.stringify({ consoleErrors }, null, 2));

  const ok = results.todayModalRendered && results.futureModalRendered &&
    results.futureUsedDocIds && results.futureNoDateQuery &&
    results.futureAnnualInFetchedIds && results.futureLastIdsIncludeDemo &&
    results.todayNoDateQuery && results.todaySharedReferences;
  console.log(ok ? 'VERIFY PASS' : 'VERIFY FAIL');
} finally {
  await browser.close();
}
console.log('Done.');
