import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.grantPermissions(['geolocation'], { origin: 'http://localhost:3000' });
await context.setGeolocation({ latitude: 19.076, longitude: 72.8777 });
const page = await context.newPage();
page.on('dialog', d => { d.accept(); });
const MARKER = '[PRIVTEST] Confidential review prep';

const cleanup = async () => {
  await page.evaluate(async (marker) => {
    try {
      const u = window.AppAuth?.getUser();
      const date = window.AppCalendar.getTodayKey();
      const cur = await window.AppCalendar.getWorkPlan(u.id, date, { planScope: 'personal' }).catch(() => null);
      if (cur && Array.isArray(cur.plans)) {
        const filtered = cur.plans.filter(t => !String(t?.task || '').includes(marker));
        await window.AppCalendar.setWorkPlan(date, filtered, u.id, { planScope: 'personal' });
      }
    } catch { /* ignore */ }
  }, MARKER).catch(() => {});
};

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
  const closeBtn = page.locator('text=Close').first();
  if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) await closeBtn.click().catch(() => {});
  await page.waitForFunction(() => !!document.querySelector('.modern-dashboard'), { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2000);

  console.log('Injecting a private personal task for today...');
  await page.evaluate(async ({ marker }) => {
    const u = window.AppAuth?.getUser();
    const date = window.AppCalendar.getTodayKey();
    const cur = await window.AppCalendar.getWorkPlan(u.id, date, { planScope: 'personal' }).catch(() => null);
    const plans = Array.isArray(cur?.plans) ? cur.plans.filter(t => t && t.isRemoved !== true) : [];
    plans.push({
      task: marker, subPlans: [], tags: [], status: null, assignedTo: null, assignedToName: '',
      budgetHeadId: 'UNALLOCATED', startDate: date, endDate: date, planScope: 'personal',
      carryForwardRootId: '', isRemoved: false, isPrivate: true
    });
    await window.AppCalendar.setWorkPlan(date, plans, u.id, { planScope: 'personal' });
  }, { marker: MARKER });

  console.log('Reloading so the modal reads fresh plan data...');
  await page.reload({ waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(4000);
  await page.waitForFunction(() => !!document.querySelector('.modern-dashboard'), { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);

  console.log('Opening day-plan modal...');
  await page.evaluate(() => window.app_openDayPlan(window.AppCalendar.getTodayKey()));
  await page.waitForSelector('.personal-plans-container .plan-block', { timeout: 25000 });
  await page.waitForTimeout(1000);

  const initial = await page.evaluate((marker) => {
    const block = [...document.querySelectorAll('.personal-plans-container .plan-block')]
      .find(b => b.textContent.includes(marker));
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
  console.log('initial state:', JSON.stringify(initial));

  await page.evaluate((marker) => {
    const block = [...document.querySelectorAll('.personal-plans-container .plan-block')]
      .find(b => b.textContent.includes(marker));
    block?.querySelector('.day-plan-private-toggle')?.click();
  }, MARKER);
  await page.waitForTimeout(400);
  const afterOff = await page.evaluate((marker) => {
    const block = [...document.querySelectorAll('.personal-plans-container .plan-block')]
      .find(b => b.textContent.includes(marker));
    return {
      inputValue: block?.querySelector('.plan-private')?.value,
      blockPrivate: block?.classList.contains('plan-block-private'),
      btnPrivate: block?.querySelector('.day-plan-private-toggle')?.classList.contains('is-private'),
      btnIcon: block?.querySelector('.day-plan-private-toggle i')?.className
    };
  }, MARKER);
  console.log('after click (should be public):', JSON.stringify(afterOff));

  await page.evaluate((marker) => {
    const block = [...document.querySelectorAll('.personal-plans-container .plan-block')]
      .find(b => b.textContent.includes(marker));
    block?.querySelector('.day-plan-private-toggle')?.click();
  }, MARKER);
  await page.waitForTimeout(400);
  const afterOn = await page.evaluate((marker) => {
    const block = [...document.querySelectorAll('.personal-plans-container .plan-block')]
      .find(b => b.textContent.includes(marker));
    return {
      inputValue: block?.querySelector('.plan-private')?.value,
      blockPrivate: block?.classList.contains('plan-block-private'),
      btnPrivate: block?.querySelector('.day-plan-private-toggle')?.classList.contains('is-private'),
      btnIcon: block?.querySelector('.day-plan-private-toggle i')?.className
    };
  }, MARKER);
  console.log('after 2nd click (should be private again):', JSON.stringify(afterOn));
} finally {
  await cleanup();
  await browser.close();
}
console.log('Done.');
