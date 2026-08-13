import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.grantPermissions(['geolocation'], { origin: 'http://localhost:3000' });
await context.setGeolocation({ latitude: 19.076, longitude: 72.8777 });
const page = await context.newPage();
page.on('dialog', d => { d.accept(); });

await page.goto('http://localhost:3000/?skipGeo=true', { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(6000);
const loginForm = page.locator('#login-form');
if (await loginForm.isVisible({ timeout: 5000 }).catch(() => false)) {
  await page.locator('#login-form input[name="username"]').fill('Demo');
  await page.locator('#login-form input[type="password"]').fill('Demo');
  await page.locator('#login-form button[type="submit"]').click();
  await page.waitForTimeout(4000);
}
await page.waitForTimeout(2000);
const closeBtn = page.locator('text=Close').first();
if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await closeBtn.click().catch(() => {});
}
await page.waitForFunction(() => !!document.querySelector('.modern-dashboard .dashboard-primary-row'), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);

const result = await page.evaluate(() => {
  const list = document.querySelector('.dashboard-planned-task-list');
  const card = document.querySelector('.dashboard-worklog-card');
  const schedule = document.querySelector('.dashboard-team-schedule-card');
  if (!list || !card || !schedule) return { missing: true };

  // Inject synthetic task items (fixed height each) to simulate a long list
  for (let i = 0; i < 40; i++) {
    const item = document.createElement('div');
    item.className = 'dashboard-planned-task-item';
    item.style.minHeight = '38px';
    item.style.background = '#fff';
    item.style.borderRadius = '8px';
    item.textContent = `Synthetic task ${i + 1}`;
    list.appendChild(item);
  }

  return {
    cardHeight: card.offsetHeight,
    scheduleHeight: schedule.offsetHeight,
    cardStillMatches: card.offsetHeight === schedule.offsetHeight,
    listClientHeight: list.clientHeight,
    listScrollHeight: list.scrollHeight,
    listScrolls: list.scrollHeight > list.clientHeight,
    listOverflowY: getComputedStyle(list).overflowY
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
