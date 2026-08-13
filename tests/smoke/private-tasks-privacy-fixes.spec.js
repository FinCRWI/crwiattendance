// Live integration: privacy follow-up fixes — (1) app_reconcileAssignedPlans
// prunes stale/null-index assignee copies while keeping finite-index ones,
// (2) day-plan blocks round-trip assignedFromPlanId provenance, and (3) legacy
// "not-completed" tasks still show in the dashboard widget. Ported from
// verify-privacy-fixes.mjs.
const { test, expect } = require('@playwright/test');
const { skipUnlessLive, grantGeolocation, loginAsDemo, watchErrors, removeMarkerTasks } = require('./live-helpers');

test.setTimeout(180000);

const M1 = '[FIXTEST] assigned copy round-trip';
const M2 = '[FIXTEST] legacy not-completed task';

test('assigned-plan reconciliation + provenance round-trip + legacy status', async ({ page }) => {
  skipUnlessLive();
  await grantGeolocation(page);
  page.on('dialog', (d) => d.accept());
  const errors = watchErrors(page);
  const me = await loginAsDemo(page);

  try {
    // Find a second non-admin user to test assignee copies against.
    const otherUser = await page.evaluate(async () => {
      const users = await window.AppDB.getAll('users').catch(() => []);
      const myId = window.AppAuth?.getUser()?.id;
      const other = (users || []).find((u) => u.id !== myId && String(u.role || '').toLowerCase() !== 'administrator')
        || (users || []).find((u) => u.id !== myId);
      return other ? { id: other.id, name: other.name } : null;
    });
    if (!otherUser) test.skip(true, 'No second user available for assignee-copy checks');
    expect(otherUser.id).toBeTruthy();

    // --- 1. Reconcile: finite-index copy survives; null-index/stale copy is pruned.
    const reconcile = await page.evaluate(async ({ otherId, marker }) => {
      const me = window.AppAuth.getUser();
      const date = window.AppCalendar.getTodayKey();
      const ownerPlanId = window.AppCalendar.getWorkPlanId(date, me.id, 'personal');
      const makeCopy = (task, idx) => ({
        task, subPlans: [], tags: [], status: null, assignedTo: otherId, assignedToName: '',
        budgetHeadId: 'UNALLOCATED', startDate: date, endDate: date, planScope: 'personal',
        carryForwardRootId: '', isRemoved: false, isPrivate: false,
        assignedFromPlanId: ownerPlanId, assignedFromTaskIndex: idx
      });
      const existing = await window.AppCalendar.getWorkPlan(otherId, date, { planScope: 'personal' }).catch(() => null);
      const base = (Array.isArray(existing?.plans) ? existing.plans : []).filter((t) => !String(t?.task || '').includes('[FIXTEST]'));
      base.push(makeCopy(marker + ' finite-idx0', 0));
      base.push(makeCopy(marker + ' stale-null', null));
      await window.AppCalendar.setWorkPlan(date, base, otherId, { planScope: 'personal' });

      const result = await window.app_reconcileAssignedPlans({
        date,
        targetId: me.id,
        targetPersonalPlanId: ownerPlanId,
        savedByAssignee: new Map([[otherId, new Set([0])]])
      });

      const after = await window.AppCalendar.getWorkPlan(otherId, date, { planScope: 'personal' }).catch(() => null);
      const tasks = Array.isArray(after?.plans) ? after.plans : [];
      return {
        reconcileOk: result?.ok,
        finiteSurvived: tasks.some((t) => String(t?.task || '').includes(marker + ' finite-idx0')),
        stalePruned: !tasks.some((t) => String(t?.task || '').includes(marker + ' stale-null'))
      };
    }, { otherId: otherUser.id, marker: M1 });
    expect(reconcile.reconcileOk).toBe(true);
    expect(reconcile.finiteSurvived).toBe(true);
    expect(reconcile.stalePruned).toBe(true);

    // --- 2. Day-plan blocks carry the source-plan-id hidden input (provenance round-trip).
    await page.evaluate(async (marker) => {
      const me = window.AppAuth.getUser();
      const date = window.AppCalendar.getTodayKey();
      const cur = await window.AppCalendar.getWorkPlan(me.id, date, { planScope: 'personal' }).catch(() => null);
      const plans = (Array.isArray(cur?.plans) ? cur.plans : []).filter((t) => !String(t?.task || '').includes('[FIXTEST]'));
      plans.push({
        task: marker + ' owner task', subPlans: [], tags: [], status: null, assignedTo: null, assignedToName: '',
        budgetHeadId: 'UNALLOCATED', startDate: date, endDate: date, planScope: 'personal',
        carryForwardRootId: '', isRemoved: false, isPrivate: true,
        assignedFromPlanId: window.AppCalendar.getWorkPlanId(date, me.id, 'personal'),
        assignedFromTaskIndex: 0
      });
      await window.AppCalendar.setWorkPlan(date, plans, me.id, { planScope: 'personal' });
      if (window.AppStore?.invalidatePlans) window.AppStore.invalidatePlans();
    }, M1);
    await page.waitForTimeout(800);

    await page.evaluate(() => window.app_openDayPlan(window.AppCalendar.getTodayKey()));
    await page.waitForSelector('.personal-plans-container .plan-block', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const roundtrip = await page.evaluate((marker) => {
      const blocks = [...document.querySelectorAll('.personal-plans-container .plan-block')];
      const block = blocks.find((b) => (b.querySelector('.plan-task')?.value || '').includes(marker)) || blocks[0];
      if (!block) return { found: false };
      const hidden = block.querySelector('.plan-source-plan-id');
      const extracted = window.app_extractBlockData(block);
      return {
        found: !!hidden,
        hiddenInputName: hidden?.className || null,
        extractedHasKey: !!extracted && Object.prototype.hasOwnProperty.call(extracted, 'assignedFromPlanId'),
        extractedValue: extracted?.assignedFromPlanId ?? '(missing)'
      };
    }, M1);
    expect(roundtrip.found).toBe(true);
    expect(roundtrip.extractedHasKey).toBe(true);
    expect(roundtrip.extractedValue).toBeTruthy();
    await page.evaluate(() => {
      document.querySelectorAll('.modal-overlay, #day-plan-modal').forEach((el) => el.remove());
    }).catch(() => {});
    await page.waitForTimeout(500);

    // --- 3. Legacy "not-completed" task shows in the dashboard widget.
    await page.evaluate(async (marker) => {
      const me = window.AppAuth.getUser();
      const date = window.AppCalendar.getTodayKey();
      const cur = await window.AppCalendar.getWorkPlan(me.id, date, { planScope: 'personal' }).catch(() => null);
      const plans = (Array.isArray(cur?.plans) ? cur.plans : []).filter((t) => !String(t?.task || '').includes('[FIXTEST]'));
      plans.push({
        task: marker, subPlans: [], tags: [], status: 'not-completed', assignedTo: null, assignedToName: '',
        budgetHeadId: 'UNALLOCATED', startDate: date, endDate: date, planScope: 'personal',
        carryForwardRootId: '', isRemoved: false, isPrivate: false
      });
      await window.AppCalendar.setWorkPlan(date, plans, me.id, { planScope: 'personal' });
    }, M2);

    await page.reload({ waitUntil: 'load', timeout: 25000 });
    await page.waitForTimeout(4500);
    await page.waitForFunction(() => !!window.AppAuth?.getUser?.(), { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const widget = await page.evaluate((marker) => {
      const items = [...document.querySelectorAll('.dashboard-planned-task-item')];
      const item = items.find((el) => el.textContent.includes(marker));
      return { found: !!item, title: item?.querySelector('.dashboard-planned-task-title')?.textContent?.trim() || null };
    }, M2);
    expect(widget.found).toBe(true);
    expect(widget.title).toBeTruthy();

    // No unexpected page/console errors surfaced (known index noise filtered).
    expect(errors).toEqual([]);
  } finally {
    await removeMarkerTasks(page, [M1, M2]);
  }
});
