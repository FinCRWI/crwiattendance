// Live integration: a private day-plan task is visible to its owner on the
// dashboard widget (with the lock chip) and in the owner's staff-activity
// feed, and disappears after cleanup. Ported from verify-private-tasks.mjs.
const { test, expect } = require('@playwright/test');
const { skipUnlessLive, grantGeolocation, loginAsDemo, watchErrors, removeMarkerTasks } = require('./live-helpers');

const MARKER = '[PRIVTASKS] Confidential review prep';

test('private task stays visible to its owner with a lock badge', async ({ page }) => {
  skipUnlessLive();
  await grantGeolocation(page);
  page.on('dialog', (d) => d.accept());
  const errors = watchErrors(page);
  const me = await loginAsDemo(page);

  try {
    // Inject a private personal task for today.
    await page.evaluate(async (marker) => {
      const u = window.AppAuth.getUser();
      const date = window.AppCalendar.getTodayKey();
      const cur = await window.AppCalendar.getWorkPlan(u.id, date, { planScope: 'personal' }).catch(() => null);
      const plans = Array.isArray(cur?.plans) ? cur.plans.filter((t) => t && t.isRemoved !== true) : [];
      plans.push({
        task: marker, subPlans: [], tags: [], status: null, assignedTo: null, assignedToName: '',
        budgetHeadId: 'UNALLOCATED', startDate: date, endDate: date, planScope: 'personal',
        carryForwardRootId: '', isRemoved: false, isPrivate: true
      });
      await window.AppCalendar.setWorkPlan(date, plans, u.id, { planScope: 'personal' });
    }, MARKER);

    await page.reload({ waitUntil: 'load', timeout: 25000 });
    await page.waitForTimeout(4000);
    await page.waitForFunction(() => !!window.AppAuth?.getUser?.(), { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2500);

    // Owner dashboard widget shows the private task with the lock chip.
    const widget = await page.evaluate((marker) => {
      const items = [...document.querySelectorAll('.dashboard-planned-task-item')];
      const item = items.find((el) => el.textContent.includes(marker));
      return {
        found: !!item,
        hasPrivateChip: !!item?.querySelector('.dashboard-planned-task-chip-private'),
        chipText: item?.querySelector('.dashboard-planned-task-chip-private')?.textContent?.trim() || null
      };
    }, MARKER);
    expect(widget.found).toBe(true);
    expect(widget.hasPrivateChip).toBe(true);
    expect(widget.chipText).toBeTruthy();

    // Owner's staff-activity feed includes the private task (numbers/text for
    // the owner only — no cross-viewer leak is expected here).
    const feed = await page.evaluate(async (marker) => {
      const rows = await window.AppAnalytics.getAllStaffActivities({
        mode: 'range',
        startIso: window.AppCalendar.getTodayKey(),
        endIso: window.AppCalendar.getTodayKey(),
        scope: 'work',
        sideEffects: false
      });
      return {
        total: rows.length,
        privateVisible: rows.some((r) => String(r._displayDesc || r.task || '').includes(marker))
      };
    }, MARKER);
    expect(feed.privateVisible).toBe(true);

    // Cleanup, then confirm the marker is gone from the widget.
    await removeMarkerTasks(page, [MARKER]);
    await page.reload({ waitUntil: 'load', timeout: 25000 });
    await page.waitForTimeout(4000);
    await page.waitForFunction(() => !!window.AppAuth?.getUser?.(), { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const after = await page.evaluate((marker) => {
      const items = [...document.querySelectorAll('.dashboard-planned-task-item')];
      return { stillShown: items.some((el) => el.textContent.includes(marker)) };
    }, MARKER);
    expect(after.stillShown).toBe(false);

    // No unexpected page/console errors surfaced during the flow.
    expect(errors).toEqual([]);
  } finally {
    await removeMarkerTasks(page, [MARKER]);
  }
});
