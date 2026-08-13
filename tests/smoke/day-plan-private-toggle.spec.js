// Live integration: the day-plan block privacy toggle must flip the hidden
// isPrivate input, the block class, and the lock button icon. Ported from
// verify-private-toggle.mjs.
const { test, expect } = require('@playwright/test');
const { skipUnlessLive, grantGeolocation, loginAsDemo, removeMarkerTasks } = require('./live-helpers');

const MARKER = '[PRIVTOGGLE] Confidential review prep';

test('day-plan block privacy toggle flips private state both ways', async ({ page }) => {
  skipUnlessLive();
  await grantGeolocation(page);
  page.on('dialog', (d) => d.accept());
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

    // Reload so the modal reads fresh plan data.
    await page.reload({ waitUntil: 'load', timeout: 25000 });
    await page.waitForTimeout(4000);
    await page.waitForFunction(() => !!window.AppAuth?.getUser?.(), { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1500);

    await page.evaluate(() => window.app_openDayPlan(window.AppCalendar.getTodayKey()));
    await page.waitForSelector('.personal-plans-container .plan-block', { timeout: 25000 });
    await page.waitForTimeout(1000);

    const blockState = async () => page.evaluate((marker) => {
      const block = [...document.querySelectorAll('.personal-plans-container .plan-block')]
        .find((b) => b.textContent.includes(marker));
      if (!block) return { found: false };
      return {
        found: true,
        inputValue: block.querySelector('.plan-private')?.value,
        blockPrivate: block.classList.contains('plan-block-private'),
        btnPrivate: block.querySelector('.day-plan-private-toggle')?.classList.contains('is-private'),
        btnIcon: block.querySelector('.day-plan-private-toggle i')?.className,
        btnTitle: block.querySelector('.day-plan-private-toggle')?.title
      };
    }, MARKER);

    const initial = await blockState();
    expect(initial.found).toBe(true);
    expect(initial.inputValue).toBe('1');
    expect(initial.blockPrivate).toBe(true);
    expect(initial.btnPrivate).toBe(true);
    expect(initial.btnIcon).toContain('fa-lock');

    // Click -> becomes public.
    await page.evaluate((marker) => {
      const block = [...document.querySelectorAll('.personal-plans-container .plan-block')]
        .find((b) => b.textContent.includes(marker));
      block?.querySelector('.day-plan-private-toggle')?.click();
    }, MARKER);
    await page.waitForTimeout(400);
    const afterOff = await blockState();
    expect(afterOff.inputValue).toBe('0');
    expect(afterOff.blockPrivate).toBe(false);
    expect(afterOff.btnPrivate).toBe(false);
    expect(afterOff.btnIcon).toContain('fa-lock-open');

    // Click again -> private again.
    await page.evaluate((marker) => {
      const block = [...document.querySelectorAll('.personal-plans-container .plan-block')]
        .find((b) => b.textContent.includes(marker));
      block?.querySelector('.day-plan-private-toggle')?.click();
    }, MARKER);
    await page.waitForTimeout(400);
    const afterOn = await blockState();
    expect(afterOn.inputValue).toBe('1');
    expect(afterOn.blockPrivate).toBe(true);
    expect(afterOn.btnPrivate).toBe(true);
    expect(afterOn.btnIcon).toContain('fa-lock');
  } finally {
    await removeMarkerTasks(page, [MARKER]);
  }
});
