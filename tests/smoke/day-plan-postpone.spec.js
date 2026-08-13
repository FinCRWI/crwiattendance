// Live integration: postponed-task fixes end to end.
//   1. Editing a day-plan task must round-trip postpone/carry-forward
//      provenance instead of silently dropping it.
//   2. Marking a task "Postponed" in the day-plan editor must create a
//      next-day copy (with provenance) and tag the source's postponedToDate,
//      exactly once — re-saving must not duplicate it.
//   3. The checkout task row must show a "Postponed to <date>" chip from real
//      data (not text regex) and only for postponed tasks.
//   4. The dashboard "Today's Planned Tasks" widget must treat an arrived
//      postponed copy as a normal in-process task and hide sources postponed
//      to a future day.
// Ported from verify-postpone-fixes.mjs.
const { test, expect } = require('@playwright/test');
const { skipUnlessLive, grantGeolocation, loginAsDemo } = require('./live-helpers');

const MARKER = '[POSTPONETEST]';

test.setTimeout(180000);

// Timezone-safe date-key math (build from local parts; never toISOString,
// which shifts IST midnight back a day in UTC).
const addDaysKey = (key, days) => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

const openModalNoMaintenance = (page, date) => page.evaluate((d) => {
  window.app_openDayPlan(d, null, null, { skipCarryForwardSync: true, skipCarryForwardCleanup: true });
}, date);

const readPostponeState = (page) => page.evaluate(async (marker) => {
  const me = window.AppAuth?.getUser();
  const today = window.AppCalendar.getTodayKey();
  const [y, m, d] = today.split('-').map(Number);
  const tdt = new Date(y, m - 1, d + 1);
  const tomorrow = `${tdt.getFullYear()}-${String(tdt.getMonth() + 1).padStart(2, '0')}-${String(tdt.getDate()).padStart(2, '0')}`;
  const tp = await window.AppCalendar.getWorkPlan(me.id, today, { planScope: 'personal' }).catch(() => null);
  const mp = await window.AppCalendar.getWorkPlan(me.id, tomorrow, { planScope: 'personal' }).catch(() => null);
  const src = (tp?.plans || []).find((t) => t && String(t.task || '').includes(marker));
  const copies = (mp?.plans || []).filter((t) => t && String(t.task || '').includes(marker));
  return {
    today, tomorrow,
    sourceText: src?.task || null,
    sourceStatus: src?.status || null,
    sourcePostponedToDate: src?.postponedToDate || null,
    copyCount: copies.length,
    copyText: copies[0]?.task || null,
    copyAddedFrom: copies[0]?.addedFrom || null,
    copyPostponedFromDate: copies[0]?.postponedFromDate || null
  };
}, MARKER);

const scrubBothDates = async (page) => {
  await page.evaluate(async (marker) => {
    try {
      const me = window.AppAuth?.getUser();
      if (!me) return;
      const today = window.AppCalendar.getTodayKey();
      const [y, m, d] = today.split('-').map(Number);
      const tdt = new Date(y, m - 1, d + 1);
      const tomorrow = `${tdt.getFullYear()}-${String(tdt.getMonth() + 1).padStart(2, '0')}-${String(tdt.getDate()).padStart(2, '0')}`;
      const matches = (t) => t && String(t?.task || '').includes(marker);
      for (const date of [today, tomorrow]) {
        const cur = await window.AppCalendar.getWorkPlan(me.id, date, { planScope: 'personal' }).catch(() => null);
        if (cur && Array.isArray(cur.plans) && cur.plans.some(matches)) {
          await window.AppCalendar.setWorkPlan(date, cur.plans.filter((t) => !matches(t)), me.id, { planScope: 'personal' });
        }
      }
      if (window.AppStore?.invalidatePlans) window.AppStore.invalidatePlans();
    } catch { /* ignore */ }
  }, MARKER).catch(() => {});
};

test('postponed tasks: provenance survives edits, editor postpone creates a next-day copy, checkout chip + widget behave', async ({ page }) => {
  skipUnlessLive();
  await grantGeolocation(page);
  page.on('dialog', (d) => d.accept());

  const me = await loginAsDemo(page);
  await scrubBothDates(page);

  const today = await page.evaluate(() => window.AppCalendar.getTodayKey());
  const tomorrow = addDaysKey(today, 1);

  // ---- Fix 1 + 2B: editor postpone -> next-day copy; provenance survives edits ----
  await page.evaluate(async ({ marker, today }) => {
    const me = window.AppAuth.getUser();
    const cur = await window.AppCalendar.getWorkPlan(me.id, today, { planScope: 'personal' }).catch(() => null);
    const plans = Array.isArray(cur?.plans) ? cur.plans.filter((t) => t && t.isRemoved !== true) : [];
    plans.push({
      task: marker + ' source task', subPlans: ['sub a'], tags: [], status: null, assignedTo: null,
      assignedToName: '', budgetHeadId: 'UNALLOCATED', startDate: today, endDate: today, planScope: 'personal',
      carryForwardRootId: '', isRemoved: false, isPrivate: false
    });
    await window.AppCalendar.setWorkPlan(today, plans, me.id, { planScope: 'personal' });
  }, { marker: MARKER, today });

  await openModalNoMaintenance(page, today);
  await page.waitForSelector('.personal-plans-container .plan-block', { timeout: 20000 });
  await page.waitForTimeout(800);

  // Open the real editor for our task, choose "Postponed", save the editor, then save the day plan.
  await page.evaluate(async (marker) => {
    const block = [...document.querySelectorAll('.personal-plans-container .plan-block')]
      .find((b) => b.querySelector('.plan-task')?.value?.includes(marker));
    if (!block) return;
    block.querySelector('.day-plan-edit-btn')?.click();
    await new Promise((r) => setTimeout(r, 600));
    const statusSel = document.querySelector('.plan-editor-modal .plan-editor-select');
    if (statusSel) {
      statusSel.value = 'postponed';
      statusSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector('.plan-editor-modal .day-plan-save-btn')?.click();
    await new Promise((r) => setTimeout(r, 800));
    document.querySelector('#day-plan-modal .day-plan-save-btn')?.click();
    await new Promise((r) => setTimeout(r, 3500));
  }, MARKER);
  await page.evaluate(() => document.querySelector('#day-plan-modal')?.remove()).catch(() => {});

  const afterFirstSave = await readPostponeState(page);
  expect(afterFirstSave.sourceStatus).toBe('postponed');
  expect(afterFirstSave.sourcePostponedToDate).toBe(tomorrow);
  expect(afterFirstSave.copyCount).toBe(1);
  expect(afterFirstSave.copyAddedFrom).toBe('postponed');
  expect(afterFirstSave.copyPostponedFromDate).toBe(today);
  expect(afterFirstSave.copyText).toContain('(Postponed from ' + today + ')');

  // ---- Re-open, edit the source text; provenance must survive, no duplicate copy ----
  await openModalNoMaintenance(page, today);
  await page.waitForSelector('.personal-plans-container .plan-block', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.evaluate(async (marker) => {
    const block = [...document.querySelectorAll('.personal-plans-container .plan-block')]
      .find((b) => b.querySelector('.plan-task')?.value?.includes(marker));
    if (!block) return;
    block.querySelector('.plan-task').value = marker + ' source task EDITED';
    document.querySelector('#day-plan-modal .day-plan-save-btn')?.click();
    await new Promise((r) => setTimeout(r, 3500));
  }, MARKER);
  await page.evaluate(() => document.querySelector('#day-plan-modal')?.remove()).catch(() => {});

  const afterSecondSave = await readPostponeState(page);
  expect(afterSecondSave.sourceText).toContain('EDITED');
  expect(afterSecondSave.sourceStatus).toBe('postponed');
  expect(afterSecondSave.sourcePostponedToDate).toBe(tomorrow);
  expect(afterSecondSave.copyCount).toBe(1);

  // ---- Fix 2A: checkout postpone chip comes from real data ----
  const chip = await page.evaluate(() => ({
    withDate: window.app_checkoutPostponeChip({ status: 'postponed', postponedToDate: '2026-08-14', task: 'x' }),
    copyFromDate: window.app_checkoutPostponeChip({ status: 'postponed', addedFrom: 'postponed', postponedFromDate: '2026-08-13', task: 'x' }),
    withoutDate: window.app_checkoutPostponeChip({ status: 'postponed', task: 'x' }),
    notPostponed: window.app_checkoutPostponeChip({ status: 'in-process', postponedToDate: '2026-08-14', task: 'x' })
  }));
  expect(String(chip.withDate)).toContain('Postponed to 2026-08-14');
  expect(String(chip.copyFromDate)).toContain('Postponed from 2026-08-13');
  expect(chip.withoutDate).toBe('');
  expect(chip.notPostponed).toBe('');

  // ---- Fix 3: widget behaviour ----
  const yesterday = addDaysKey(today, -1);
  await page.evaluate(async ({ today, tomorrow, yesterday, marker }) => {
    const me = window.AppAuth.getUser();
    const cur = await window.AppCalendar.getWorkPlan(me.id, today, { planScope: 'personal' }).catch(() => null);
    const plans = Array.isArray(cur?.plans)
      ? cur.plans.filter((t) => t && t.isRemoved !== true && !String(t?.task || '').includes(marker))
      : [];
    plans.push({
      task: marker + ' arrived copy (Postponed from ' + yesterday + ')', subPlans: [], tags: [], status: 'postponed',
      assignedTo: null, assignedToName: '', budgetHeadId: 'UNALLOCATED', startDate: today, endDate: today,
      planScope: 'personal', carryForwardRootId: '', isRemoved: false, isPrivate: false,
      addedFrom: 'postponed', postponedFromDate: yesterday
    });
    plans.push({
      task: marker + ' future source', subPlans: [], tags: [], status: 'postponed',
      assignedTo: null, assignedToName: '', budgetHeadId: 'UNALLOCATED', startDate: today, endDate: today,
      planScope: 'personal', carryForwardRootId: '', isRemoved: false, isPrivate: false,
      postponedToDate: tomorrow
    });
    await window.AppCalendar.setWorkPlan(today, plans, me.id, { planScope: 'personal' });
  }, { today, tomorrow, yesterday, marker: MARKER });

  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => !!window.AppAuth?.getUser?.(), { timeout: 25000 }).catch(() => {});
  // Wait for the widget to actually render before sampling.
  await page.waitForSelector('.dashboard-planned-task-item', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const widget = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.dashboard-planned-task-item')];
    const arrived = items.find((el) => el.textContent.includes('[POSTPONETEST] arrived copy'));
    const future = items.find((el) => el.textContent.includes('[POSTPONETEST] future source'));
    const source = items.find((el) => el.textContent.includes('POSTPONETEST source task'));
    return {
      arrivedShown: !!arrived,
      arrivedClass: arrived ? String(arrived.className) : null,
      futureShown: !!future,
      sourceShown: !!source
    };
  });
  expect(widget.arrivedShown).toBe(true);
  expect(String(widget.arrivedClass || '')).toContain('in-process');
  expect(String(widget.arrivedClass || '')).not.toContain('postponed');
  expect(widget.futureShown).toBe(false);
  expect(widget.sourceShown).toBe(false);

  await scrubBothDates(page);
});
