import { chromium } from 'playwright';

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

const MARKER = '[PRIVTEST] Confidential review prep';

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
  await page.waitForFunction(() => !!document.querySelector('.modern-dashboard'), { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const who = await page.evaluate(() => {
    const u = window.AppAuth?.getUser?.() || null;
    return { id: u?.id || '', name: u?.name || '', role: u?.role || u?.isAdmin ? 'admin' : 'staff' };
  });
  step(`   logged in as ${who.name} (${who.id}, role=${who.role})`);

  step('2. Day-plan modal has the privacy toggle');
  await page.evaluate(() => {
    if (window.app_openDayPlan) window.app_openDayPlan(window.AppCalendar.getTodayKey());
  });
  let toggleInfo = { found: false };
  await page.waitForSelector('.personal-plans-container .plan-block', { timeout: 20000 }).catch(() => {});
  const toggle = page.locator('.personal-plans-container .plan-block .day-plan-private-toggle').first();
  if (await toggle.count().catch(() => 0) > 0) {
    toggleInfo.found = true;
    const before = await toggle.getAttribute('title');
    await toggle.click();
    await page.waitForTimeout(400);
    toggleInfo = await page.evaluate(() => {
      const block = document.querySelector('.personal-plans-container .plan-block');
      const input = block?.querySelector('.plan-private');
      const btn = block?.querySelector('.day-plan-private-toggle');
      return {
        found: true,
        beforeTitle: '',
        inputValue: input?.value,
        blockPrivateClass: block?.classList.contains('plan-block-private'),
        btnPrivateClass: btn?.classList.contains('is-private'),
        btnIcon: btn?.querySelector('i')?.className
      };
    });
    toggleInfo.beforeTitle = before;
  }
  console.log(JSON.stringify(toggleInfo));
  // Close the modal without saving
  await page.evaluate(() => {
    document.querySelectorAll('.modal-overlay, #day-plan-modal').forEach(el => el.remove());
  }).catch(() => {});
  await page.waitForTimeout(600);

  step('3. Inject a private task for today via AppCalendar, then reload');
  const inject = await page.evaluate(async ({ marker }) => {
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
    return { date, count: plans.length };
  }, { marker: MARKER });
  step(`   injected private task (date=${inject.date}, total tasks=${inject.count})`);

  await page.reload({ waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(4000);
  await page.waitForFunction(() => !!document.querySelector('.modern-dashboard'), { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2500);

  step('4. Owner dashboard widget shows the private task with lock chip');
  const widget = await page.evaluate((marker) => {
    const items = [...document.querySelectorAll('.dashboard-planned-task-item')];
    const item = items.find(el => el.textContent.includes(marker));
    return {
      found: !!item,
      totalShown: items.length,
      hasPrivateChip: !!item?.querySelector('.dashboard-planned-task-chip-private'),
      chipText: item?.querySelector('.dashboard-planned-task-chip-private')?.textContent?.trim() || null,
      title: item?.querySelector('.dashboard-planned-task-title')?.textContent?.trim() || null
    };
  }, MARKER);
  console.log(JSON.stringify(widget));

  step('5. getAllStaffActivities (owner view) includes the private task');
  const feed = await page.evaluate(async ({ marker }) => {
    const rows = await window.AppAnalytics.getAllStaffActivities({
      mode: 'range', startIso: window.AppCalendar.getTodayKey(), endIso: window.AppCalendar.getTodayKey(),
      scope: 'work', sideEffects: false
    });
    return {
      total: rows.length,
      privateVisible: rows.some(r => String(r._displayDesc || r.task || '').includes(marker))
    };
  }, { marker: MARKER });
  console.log(JSON.stringify(feed));

  step('6. Cleanup: remove the injected private task and re-verify');
  const cleaned = await page.evaluate(async ({ marker }) => {
    const u = window.AppAuth?.getUser();
    const date = window.AppCalendar.getTodayKey();
    const cur = await window.AppCalendar.getWorkPlan(u.id, date, { planScope: 'personal' }).catch(() => null);
    let removed = 0;
    if (cur && Array.isArray(cur.plans)) {
      const filtered = cur.plans.filter(t => {
        if (String(t?.task || '').includes(marker)) { removed += 1; return false; }
        return true;
      });
      await window.AppCalendar.setWorkPlan(date, filtered, u.id, { planScope: 'personal' });
    }
    return { removed };
  }, { marker: MARKER });
  step(`   cleanup removed ${cleaned.removed} task(s)`);

  await page.reload({ waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(4000);
  await page.waitForFunction(() => !!document.querySelector('.modern-dashboard'), { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const after = await page.evaluate((marker) => {
    const items = [...document.querySelectorAll('.dashboard-planned-task-item')];
    return { stillShown: items.some(el => el.textContent.includes(marker)), totalShown: items.length };
  }, MARKER);
  console.log(JSON.stringify(after));

  console.log(JSON.stringify({ consoleErrors }, null, 2));
} finally {
  // Safety: always attempt cleanup of the injected task
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
  await browser.close();
}
console.log('Done.');
