/**
 * Playwright screenshot capture script for CRWI Attendance App
 * Skill: localhost-screenshots
 *
 * KEY DESIGN: Reuses a single page after login so the SPA's JS context
 * (including window.AppAuth.currentUser) stays alive across all captures.
 * This avoids the auth race condition where new pages capture before
 * AppAuth.init() completes its async Firestore query.
 *
 * Authenticates with Demo/Demo, then captures 8 breakpoints
 * across key SPA routes.
 *
 * Run: node scripts/screenshots.mjs
 * Output: _screenshots/<page>/<breakpoint>-<width>x<height>.png
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const BASE_URL = 'http://localhost:3000';
const LOGIN_CREDENTIALS = { username: 'Demo', password: 'Demo' };

// Project CSS breakpoints: sm=640, md=768, lg=1024
const BREAKPOINTS = [
  { name: 'mobile-sm',  width: 320,  height: 568  },
  { name: 'mobile',     width: 375,  height: 812  },
  { name: 'mobile-lg',  width: 428,  height: 926  },
  { name: 'tablet',     width: 768,  height: 1024 },
  { name: 'tablet-lg',  width: 1024, height: 1366 },
  { name: 'desktop',    width: 1280, height: 800  },
  { name: 'desktop-lg', width: 1440, height: 900  },
  { name: 'wide',       width: 1920, height: 1080 },
];

const ROUTES = [
  { path: '/',            name: 'login' },
  { path: '/#dashboard',  name: 'dashboard' },
  { path: '/#staff-directory', name: 'staff-directory' },
  { path: '/#timesheet',  name: 'timesheet' },
  { path: '/#profile',    name: 'profile' },
];

// Content-ready selectors per route (fallback to timeout if none match)
const READY_SELECTORS = {
  login:            ['#login-form', '.login-box', '#page-content'],
  dashboard:        ['.modern-dashboard', '.dashboard-staff-view', '.dashboard-admin-view', '#page-content'],
  'staff-directory': ['.staff-directory', '#page-content'],
  timesheet:        ['.timesheet-container', '#page-content'],
  profile:          ['.profile-container', '#page-content'],
};

async function preflight(browser) {
  const page = await browser.newPage();
  const issues = [];
  try {
    const response = await page.goto(BASE_URL, { waitUntil: 'load', timeout: 10000 });
    if (!response || !response.ok()) issues.push(`Server returned ${response?.status()}`);
    const styles = await page.evaluate(() =>
      document.querySelectorAll('link[rel="stylesheet"], style').length
    );
    if (styles === 0) issues.push('No stylesheets detected');
    const textLen = await page.evaluate(() => document.body?.innerText?.trim().length || 0);
    if (textLen < 10) issues.push('Body is near-empty');
  } catch (e) {
    issues.push(e.message);
  } finally {
    await page.close().catch(() => {});
  }
  return { ok: issues.length === 0, issues };
}

async function capture() {
  console.log(`🚀 Screenshot Capture — ${BASE_URL}`);
  console.log(`Routes: ${ROUTES.map(r => r.name).join(', ')}`);
  console.log(`Breakpoints: ${BREAKPOINTS.map(b => `${b.name} (${b.width}×${b.height})`).join(', ')}`);
  console.log('');

  const browser = await chromium.launch();

  // Pre-flight
  console.log('🔍 Pre-flight check...');
  const pf = await preflight(browser);
  if (pf.ok) {
    console.log('   ✅ Server OK');
  } else {
    console.log(`   ⚠️  Issues: ${pf.issues.join('; ')} (continuing)`);
  }

  // Create a persistent context with geolocation permission
  // (the app requires geolocation on login)
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 12.9716, longitude: 77.5946 },
  });

  // --- CRITICAL: Single page for all captures ---
  // We reuse the SAME page for login + all breakpoints + all routes.
  // This keeps the SPA's JS context alive (currentUser, etc.) and
  // avoids the auth race condition where new pages capture before
  // AppAuth.init() completes its async Firestore query.
  const page = await context.newPage();
  let totalSuccess = 0;
  let totalFail = 0;

  // --- Login page captures (unauthenticated) ---
  console.log('\n🔑 Capturing login page...');
  {
    const routeDir = join(PROJECT_ROOT, '_screenshots', 'login');
    mkdirSync(routeDir, { recursive: true });

    for (const bp of BREAKPOINTS) {
      const filename = `${bp.name}-${bp.width}x${bp.height}.png`;
      try {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.goto(`${BASE_URL}/`, { waitUntil: 'load', timeout: 15000 });
        await page.waitForSelector('#login-form', { timeout: 8000 });
        await page.screenshot({ path: join(routeDir, filename), fullPage: true });
        totalSuccess++;
        process.stdout.write(`  ✅ ${bp.name}  `);
      } catch (err) {
        totalFail++;
        process.stdout.write(`  ❌ ${bp.name} (${err.message?.slice(0, 50)})  `);
      }
    }
    console.log('');
  }

  // --- Login (authenticate once) ---
  console.log('\n🔐 Logging in...');
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForSelector('#login-form', { timeout: 10000 });
    await page.fill('input[name="username"]', LOGIN_CREDENTIALS.username);
    await page.fill('input[name="password"]', LOGIN_CREDENTIALS.password);

    // Click submit and wait for the login form to detach from the DOM.
    // The form handler does: preventDefault, Cp() geolocation, AppAuth.login(), window.location.reload()
    await Promise.all([
      page.waitForSelector('#login-form', { state: 'detached', timeout: 25000 }),
      page.click('button[type="submit"]'),
    ]);

    // Wait for the reloaded page to finish loading
    await page.waitForLoadState('load', { timeout: 15000 });
    console.log('   ✅ Login successful');
  } catch (err) {
    console.error('   ❌ Login failed:', err.message?.slice(0, 80));
    console.log('   Proceeding with unauthenticated captures only.');
  }

  // --- Authenticated page captures (reusing same page) ---
  // After login the page is at '/'. Navigate to each route and capture all
  // breakpoints, resizing the viewport in-place. The SPA's JS context
  // (window.AppAuth.currentUser) stays alive across hash changes.
  const authRoutes = [
    { path: '/#dashboard',  name: 'dashboard' },
    { path: '/#staff-directory', name: 'staff-directory' },
    { path: '/#timesheet',  name: 'timesheet' },
    { path: '/#profile',    name: 'profile' },
  ];

  for (const route of authRoutes) {
    const routeDir = join(PROJECT_ROOT, '_screenshots', route.name);
    mkdirSync(routeDir, { recursive: true });
    const selectors = READY_SELECTORS[route.name] || ['#page-content'];

    console.log(`\n📄 /${route.name}`);

    for (const bp of BREAKPOINTS) {
      const filename = `${bp.name}-${bp.width}x${bp.height}.png`;
      try {
        // Resize viewport first
        await page.setViewportSize({ width: bp.width, height: bp.height });

        // Navigate to the route via hash change — same page, no reload
        await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'load', timeout: 20000 });

        // Wait for content to be ready using route-specific selectors
        let found = false;
        for (const sel of selectors) {
          try {
            await page.waitForSelector(sel, { timeout: 8000 });
            found = true;
            break;
          } catch {
            // try next selector
          }
        }
        if (!found) {
          await new Promise(r => setTimeout(r, 2000));
        }

        await page.screenshot({ path: join(routeDir, filename), fullPage: true });
        totalSuccess++;
        process.stdout.write(`  ✅ ${bp.name}  `);
      } catch (err) {
        totalFail++;
        const msg = err.message?.replace(/\n/g, ' ').slice(0, 60) || String(err);
        process.stdout.write(`  ❌ ${bp.name} (${msg})  `);
      }
    }
    console.log('');
  }

  await context.close();
  await browser.close();

  // Summary
  console.log('\n═══════════════════════════════');
  console.log('📊 Summary');
  console.log(`   ✅ Successful: ${totalSuccess}`);
  console.log(`   ❌ Failed:     ${totalFail}`);
  console.log(`   📁 Output:     _screenshots/`);

  const outDir = join(PROJECT_ROOT, '_screenshots');
  if (existsSync(outDir)) {
    const pages = readdirSync(outDir).filter(f =>
      statSync(join(outDir, f)).isDirectory()
    ).sort();
    for (const page of pages) {
      const files = readdirSync(join(outDir, page)).filter(f => f.endsWith('.png'));
      if (files.length > 0) {
        const sizes = files.map(f => {
          const s = statSync(join(outDir, page, f)).size;
          return `${f}: ${(s / 1024).toFixed(0)}K`;
        }).join(', ');
        console.log(`   ${page}: ${files.length} — ${sizes}`);
      }
    }
  }
  console.log('═══════════════════════════════\n');
}

capture().catch(err => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
