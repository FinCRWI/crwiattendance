import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.grantPermissions(['geolocation'], { origin: 'http://localhost:3000' });
await context.setGeolocation({ latitude: 19.076, longitude: 72.8777 });
const page = await context.newPage();

page.on('dialog', d => { d.accept(); });
page.on('console', msg => {
  const t = msg.text();
  if (t.includes('Error') || t.toLowerCase().includes('fail')) console.log('  [console]', t.slice(0, 140));
});

console.log('1. Loading page...');
await page.goto('http://localhost:3000/?skipGeo=true', { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(6000);

console.log('2. Logging in...');
const loginForm = page.locator('#login-form');
if (await loginForm.isVisible({ timeout: 5000 }).catch(() => false)) {
  await page.locator('#login-form input[name="username"]').fill('Demo');
  await page.locator('#login-form input[type="password"]').fill('Demo');
  await page.locator('#login-form button[type="submit"]').click();
  await page.waitForTimeout(6000);
}

console.log('3. Waiting for dashboard render (dismissing any notice modal)...');
await page.waitForTimeout(2000);
// Dismiss any announcement/notice modal if present
const closeBtn = page.locator('text=Close').first();
if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await closeBtn.click().catch(() => {});
  console.log('   Dismissed notice modal');
}
await page.waitForFunction(() => !!document.querySelector('.modern-dashboard .dashboard-primary-row'), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);

console.log('4. Measuring card heights...');
const result = await page.evaluate(() => {
  const sel = ['.dashboard-checkin-card', '.dashboard-team-schedule-card', '.dashboard-worklog-card'];
  const cards = sel.map(s => document.querySelector(s)).filter(Boolean);
  if (!cards.length) {
    return {
      found: false,
      modernDashboard: !!document.querySelector('.modern-dashboard'),
      bodyText: document.body.innerText.slice(0, 200),
      url: window.location.href
    };
  }
  const heights = cards.map(el => ({ cls: (el.className.match(/dashboard-[a-z-]+-card/) || [])[0] || el.className.slice(0, 30), h: el.offsetHeight }));
  const max = Math.max(...heights.map(c => c.h));
  const min = Math.min(...heights.map(c => c.h));
  const list = document.querySelector('.dashboard-planned-task-list');
  const worklogCard = document.querySelector('.dashboard-worklog-card');
  return {
    found: true,
    heights,
    maxDiff: max - min,
    equalWithin2px: (max - min) <= 2,
    listScrolls: list ? list.scrollHeight > list.clientHeight : null,
    listOverflowY: list ? getComputedStyle(list).overflowY : 'n/a',
    worklogCardOverflow: worklogCard ? getComputedStyle(worklogCard).overflow : 'n/a',
    rowDisplay: getComputedStyle(document.querySelector('.dashboard-primary-row')).display,
    rowAlignItems: getComputedStyle(document.querySelector('.dashboard-primary-row')).alignItems
  };
});

console.log(JSON.stringify(result, null, 2));
await page.screenshot({ path: 'primary-row-heights.png', fullPage: false });
await browser.close();
console.log('Done. Screenshot: primary-row-heights.png');
