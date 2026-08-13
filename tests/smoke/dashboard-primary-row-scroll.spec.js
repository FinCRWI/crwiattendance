// Live integration: the dashboard primary row (Check-In, Team Schedule,
// Planned Tasks) renders at equal heights and a long planned-task list scrolls
// inside its card instead of growing the row. Ported from verify-scroll.mjs.
const { test, expect } = require('@playwright/test');
const { skipUnlessLive, grantGeolocation, loginAsDemo } = require('./live-helpers');

test.setTimeout(180000);

test('primary-row cards are equal height and the planned-task list scrolls', async ({ page }) => {
  skipUnlessLive();
  await grantGeolocation(page);
  page.on('dialog', (d) => d.accept());
  await loginAsDemo(page);

  await page.waitForFunction(
    () => !!document.querySelector('.modern-dashboard .dashboard-primary-row'),
    { timeout: 20000 }
  ).catch(() => {});
  await page.waitForTimeout(2500);

  const result = await page.evaluate(() => {
    const list = document.querySelector('.dashboard-planned-task-list');
    const card = document.querySelector('.dashboard-worklog-card');
    const schedule = document.querySelector('.dashboard-team-schedule-card');
    if (!list || !card || !schedule) return { missing: true };

    // Inject synthetic task items (fixed height each) to simulate a long list.
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
      missing: false,
      cardHeight: card.offsetHeight,
      scheduleHeight: schedule.offsetHeight,
      heightDiff: Math.abs(card.offsetHeight - schedule.offsetHeight),
      listClientHeight: list.clientHeight,
      listScrollHeight: list.scrollHeight,
      listScrolls: list.scrollHeight > list.clientHeight,
      listOverflowY: getComputedStyle(list).overflowY
    };
  });

  expect(result.missing).toBe(false);
  // The worklog card stretches to the same height as the team schedule card.
  expect(result.heightDiff).toBeLessThanOrEqual(2);
  // A long planned-task list scrolls inside the card (client vs scroll height).
  expect(result.listScrolls).toBe(true);
  expect(result.listOverflowY).toBe('auto');
});
