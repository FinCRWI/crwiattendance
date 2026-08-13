// Live integration: the day-plan open/prefetch path must fetch plan docs by
// their known doc ids (plan_annual_{date} + plan_{userId}_{date}) via
// AppDB.getDayPlansByIds, never a date-scoped work_plans query, and the modal
// must still render personal/shared sections. Ported from verify-dayplan-doc-ids.mjs.
const { test, expect } = require('@playwright/test');
const { skipUnlessLive, grantGeolocation, loginAsDemo } = require('./live-helpers');

test('day-plan modal fetches by doc ids only and renders', async ({ page }) => {
  skipUnlessLive();
  await grantGeolocation(page);
  page.on('dialog', (d) => d.accept());

  const me = await loginAsDemo(page);

  // Instrument the DB read paths before any day-plan open.
  await page.evaluate(() => {
    const DB = window.AppDB;
    const state = { counts: {}, lastIds: null, workPlansChunks: [] };
    const wrap = (name, fn) => async function (...args) {
      state.counts[name] = (state.counts[name] || 0) + 1;
      if (name === 'getDayPlansByIds') state.lastIds = args;
      if (name === 'getManyByIds' && args[0] === 'work_plans') state.workPlansChunks.push(args[1]);
      return fn.apply(this, args);
    };
    DB.getDayPlansByIds = wrap('getDayPlansByIds', DB.getDayPlansByIds);
    DB.getDayPlansByDate = wrap('getDayPlansByDate', DB.getDayPlansByDate);
    DB.getManyByIds = wrap('getManyByIds', DB.getManyByIds);
    window.__dp = {
      state,
      reset: () => { state.counts = {}; state.lastIds = null; state.workPlansChunks = []; }
    };
  });

  const openModalAndInspect = async (date) => {
    await page.evaluate(() => window.__dp.reset());
    await page.evaluate((d) => window.app_openDayPlan(d), date);
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
    await page.evaluate(() => {
      document.querySelectorAll('#day-plan-modal, .modal-overlay').forEach((el) => el.remove());
    }).catch(() => {});
    await page.waitForTimeout(400);
    return state;
  };

  const todayKey = await page.evaluate(() => window.AppCalendar.getTodayKey());
  const todayState = await openModalAndInspect(todayKey);

  const futureDate = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().split('T')[0];
  });
  const futureState = await openModalAndInspect(futureDate);

  // Today's modal (data was prefetched at dashboard load) still renders.
  expect(todayState.modal.hasForm).toBe(true);
  expect(todayState.modal.hasLoading).toBe(false);
  // If other staff have plans today, the shared references render.
  if (todayState.modal.personalBlocks > 0 || todayState.modal.sharedBlocks > 0) {
    expect(todayState.modal.hasForm).toBe(true);
  }

  // The fresh future-date open goes through the doc-id path exactly once,
  // never falls back to a date-scoped query, and includes the annual id.
  expect(futureState.modal.hasForm).toBe(true);
  expect(futureState.modal.hasLoading).toBe(false);
  expect(futureState.counts.getDayPlansByIds || 0).toBeGreaterThanOrEqual(1);
  expect(futureState.counts.getDayPlansByDate || 0).toBe(0);
  expect(futureState.annualInFetchedIds).toBe(true);
  expect(futureState.lastIds?.idCount || 0).toBeGreaterThanOrEqual(2);
  // The fetched id set covers every staff member (demo included) plus annual.
  expect(futureState.workPlansIds).toContain(`plan_annual_${futureDate}`);
  expect(futureState.workPlansIds).toContain(`plan_${me.id}_${futureDate}`);
});
