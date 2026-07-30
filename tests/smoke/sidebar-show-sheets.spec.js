const { test, expect } = require('@playwright/test');

test('master-sheet becomes visible when show_hidden_sheets is enabled', async ({ page }) => {
  // Ensure the preference is set before any app scripts run
  await page.addInitScript(() => {
    try { localStorage.setItem('show_hidden_sheets', 'true'); } catch (e) { void e; }
  });

  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  // Wait for the sidebar markup and app shell to be available
  await page.waitForSelector('.sidebar', { timeout: 5000 });

  // Target the desktop sidebar anchor specifically
  const master = page.locator('aside.sidebar a[data-page="master-sheet"]').first();
  await expect(master).toBeVisible({ timeout: 5000 });
});
