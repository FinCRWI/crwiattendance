import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 }
});
const page = await context.newPage();

page.on('dialog', d => { console.log('  Dialog:', d.message().slice(0,60)); d.accept(); });
page.on('console', msg => {
  if (msg.text().includes('getLocation: ?skipGeo')) console.log('  [GEO]', msg.text());
});

console.log('1. Loading page with ?skipGeo...');
await page.goto('http://localhost:3000/?skipGeo=true', { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(6000); // Let Firebase + SPA initialize
console.log('   Title:', await page.title());

console.log('2. Logging in...');
const loginForm = page.locator('#login-form');
if (await loginForm.isVisible({ timeout: 5000 }).catch(() => false)) {
  await page.locator('#login-form input[name="username"]').fill('Demo');
  await page.locator('#login-form input[type="password"]').fill('Demo');
  await page.locator('#login-form button[type="submit"]').click();
  console.log('   Login submitted, waiting for dashboard...');
  await page.waitForTimeout(3000);
}

console.log('3. Checking dashboard...');
await page.screenshot({ path: 'test-skipgeo.png', fullPage: false });
console.log('   Screenshot saved');

const info = await page.evaluate(() => {
  const metrics = document.querySelectorAll('.dashboard-hero-stats-card .hero-metrics .hero-metric');
  if (!metrics.length) {
    return {
      found: false,
      modernDashboard: !!document.querySelector('.modern-dashboard'),
      bodyPreview: document.body.innerHTML.substring(0, 300),
      url: window.location.href
    };
  }

  return {
    found: true,
    count: metrics.length,
    dashboardLoaded: true,
    modernDashboard: !!document.querySelector('.modern-dashboard'),
    metrics: Array.from(metrics).map((el, i) => {
      const val = el.querySelector('.hero-metric-value');
      const lbl = el.querySelector('.hero-metric-label');
      return {
        pos: i + 1,
        label: lbl?.textContent?.trim(),
        val: val?.textContent?.trim(),
        valColor: val ? getComputedStyle(val).color : '?',
        lblColor: lbl ? getComputedStyle(lbl).color : '?',
        bg: getComputedStyle(el).backgroundColor,
        border: getComputedStyle(el).borderColor
      };
    })
  };
});

console.log('\n=== DASHBOARD CHECK ===');
console.log(JSON.stringify(info, null, 2));

// Verify expected colors
const expected = {
  'Planned':     { val: 'rgb(59, 130, 246)', lbl: 'rgb(37, 99, 235)'    },
  'Completed':   { val: 'rgb(5, 150, 105)',  lbl: 'rgb(4, 120, 87)'     },
  'In Progress': { val: 'rgb(99, 102, 241)', lbl: 'rgb(79, 70, 229)'    },
  'Postponed':   { val: 'rgb(217, 119, 6)',  lbl: 'rgb(180, 83, 9)'    },
  'Missed':      { val: 'rgb(220, 38, 38)',  lbl: 'rgb(185, 28, 28)'   }
};

if (info.found && info.metrics) {
  console.log('\n=== COLOR VERIFICATION ===');
  let allPass = true;
  for (const m of info.metrics) {
    const e = expected[m.label];
    if (!e) { console.log(`  ${m.label}: ⚠️  NO EXPECTATION`); continue; }
    const pass = m.valColor === e.val && m.lblColor === e.lbl;
    console.log(`  ${m.label}: ${pass ? '✅ PASS' : '❌ FAIL'}`);
    if (!pass) {
      allPass = false;
      console.log(`    Expected val: ${e.val}, got: ${m.valColor}`);
      console.log(`    Expected lbl: ${e.lbl}, got: ${m.lblColor}`);
    }
  }
  console.log(`\n  Overall: ${allPass ? '✅ ALL PASS - Semantic colors rendering correctly!' : '❌ SOME FAILED'}`);
} else {
  console.log(`\n  ❌ Dashboard NOT loaded. Modern dashboard class: ${info.modernDashboard}`);
  console.log('  Body:', info.bodyPreview);
}

await browser.close();
console.log('\nDone!');
