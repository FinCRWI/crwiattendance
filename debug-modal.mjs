import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.grantPermissions(['geolocation'], { origin: 'http://localhost:3000' });
await context.setGeolocation({ latitude: 19.076, longitude: 72.8777 });
const page = await context.newPage();
page.on('dialog', d => d.accept());

try {
  await page.goto('http://localhost:3000/?skipGeo=true', { waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(6000);
  const loginForm = page.locator('#login-form');
  if (await loginForm.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#login-form input[name="username"]').fill('Demo');
    await page.locator('#login-form input[type="password"]').fill('Demo');
    await page.locator('#login-form button[type="submit"]').click();
    await page.waitForTimeout(7000);
  }
  await page.waitForFunction(() => !!document.querySelector('.modern-dashboard'), { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const injected = await page.evaluate(async () => {
    const me = window.AppAuth?.getUser();
    if (!me) return { ok: false, reason: 'no user' };
    const date = window.AppCalendar.getTodayKey();
    const cur = await window.AppCalendar.getWorkPlan(me.id, date, { planScope: 'personal' }).catch(() => null);
    const plans = (Array.isArray(cur?.plans) ? cur.plans : []).filter(t => !String(t?.task || '').includes('[FIXTEST]'));
    plans.push({
      task: '[FIXTEST] owner task', subPlans: [], tags: [], status: null, assignedTo: null, assignedToName: '',
      budgetHeadId: 'UNALLOCATED', startDate: date, endDate: date, planScope: 'personal',
      carryForwardRootId: '', isRemoved: false, isPrivate: true,
      assignedFromPlanId: window.AppCalendar.getWorkPlanId(date, me.id, 'personal'),
      assignedFromTaskIndex: 0
    });
    await window.AppCalendar.setWorkPlan(date, plans, me.id, { planScope: 'personal' });
    if (window.AppStore?.invalidatePlans) window.AppStore.invalidatePlans();
    // Re-read to confirm persistence
    const reread = await window.AppCalendar.getWorkPlan(me.id, date, { planScope: 'personal' }).catch(() => null);
    return {
      ok: true,
      date,
      storedTasks: (reread?.plans || []).map(t => t.task).slice(0, 10),
      total: (reread?.plans || []).length
    };
  });
  console.log('INJECTED:', JSON.stringify(injected));

  await page.evaluate(() => {
    if (window.app_openDayPlan) window.app_openDayPlan(window.AppCalendar.getTodayKey());
  });
  await page.waitForTimeout(6000);

  const dom = await page.evaluate(() => {
    const modal = document.getElementById('day-plan-modal');
    const personal = document.querySelector('.personal-plans-container');
    const existing = document.querySelector('.personal-plans-container .day-plan-existing-blocks');
    const newC = document.querySelector('.personal-plans-container .day-plan-new-blocks');
    return {
      modalExists: !!modal,
      modalClass: modal?.className || null,
      personalContainer: !!personal,
      existingBlocks: existing?.querySelectorAll('.plan-block')?.length || 0,
      newBlocks: newC?.querySelectorAll('.plan-block')?.length || 0,
      allPlanBlocks: document.querySelectorAll('.plan-block').length,
      bodySnippet: modal ? modal.textContent?.slice(0, 300) : null,
      modalHTML: modal ? modal.innerHTML?.slice(0, 600) : null
    };
  });
  console.log('DOM:', JSON.stringify(dom, null, 2));

  // Cleanup
  await page.evaluate(async () => {
    try {
      const me = window.AppAuth?.getUser();
      const date = window.AppCalendar.getTodayKey();
      const cur = await window.AppCalendar.getWorkPlan(me.id, date, { planScope: 'personal' }).catch(() => null);
      if (cur && Array.isArray(cur.plans)) {
        await window.AppCalendar.setWorkPlan(date, cur.plans.filter(t => !String(t?.task || '').includes('[FIXTEST]')), me.id, { planScope: 'personal' });
      }
    } catch { /* ignore */ }
  }).catch(() => {});
} finally {
  await browser.close();
}
console.log('Done.');
