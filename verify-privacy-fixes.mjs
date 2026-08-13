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

const M1 = '[FIXTEST] assigned copy round-trip';
const M2 = '[FIXTEST] legacy not-completed task';
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
    return { id: u?.id || '', name: u?.name || '' };
  });
  step(`   logged in as ${who.name} (${who.id})`);

  const otherUser = await page.evaluate(async () => {
    const users = await window.AppDB.getAll('users').catch(() => []);
    const me = window.AppAuth?.getUser()?.id;
    const other = (users || []).find(u => u.id !== me && String(u.role || '').toLowerCase() !== 'administrator') || (users || []).find(u => u.id !== me);
    return other ? { id: other.id, name: other.name } : null;
  });
  if (!otherUser) throw new Error('No second user found to test assignee copies against');
  step(`   second user: ${otherUser.name} (${otherUser.id})`);

  step('2. Reconcile: finite-index copy survives a re-save; null-index/stale copy pruned');
  const reconcileTest = await page.evaluate(async ({ otherId, marker }) => {
    const me = window.AppAuth.getUser();
    const date = window.AppCalendar.getTodayKey();
    const ownerPlanId = window.AppCalendar.getWorkPlanId(date, me.id, 'personal');

    const makeCopy = (task, idx) => ({
      task, subPlans: [], tags: [], status: null, assignedTo: otherId, assignedToName: '',
      budgetHeadId: 'UNALLOCATED', startDate: date, endDate: date, planScope: 'personal',
      carryForwardRootId: '', isRemoved: false, isPrivate: false,
      assignedFromPlanId: ownerPlanId, assignedFromTaskIndex: idx
    });
    const existing = await window.AppCalendar.getWorkPlan(otherId, date, { planScope: 'personal' }).catch(() => null);
    const base = (Array.isArray(existing?.plans) ? existing.plans : []).filter(t => !String(t?.task || '').includes('[FIXTEST]'));
    base.push(makeCopy(marker + ' finite-idx0', 0));
    base.push(makeCopy(marker + ' stale-null', null));
    await window.AppCalendar.setWorkPlan(date, base, otherId, { planScope: 'personal' });

    // Simulate the owner re-saving task index 0 to this assignee (replacedIndices={0}).
    const result = await window.app_reconcileAssignedPlans({
      date,
      targetId: me.id,
      targetPersonalPlanId: ownerPlanId,
      savedByAssignee: new Map([[otherId, new Set([0])]])
    });

    const after = await window.AppCalendar.getWorkPlan(otherId, date, { planScope: 'personal' }).catch(() => null);
    const tasks = Array.isArray(after?.plans) ? after.plans : [];
    return {
      reconcileOk: result?.ok,
      finiteSurvived: tasks.some(t => String(t?.task || '').includes(marker + ' finite-idx0')),
      stalePruned: !tasks.some(t => String(t?.task || '').includes(marker + ' stale-null')),
      remainingCount: tasks.length
    };
  }, { otherId: otherUser.id, marker: M1 });
  console.log(JSON.stringify(reconcileTest));

  step('3. Day-plan blocks carry the source-plan-id hidden input (provenance round-trip)');
  await page.evaluate(async ({ marker }) => {
    const me = window.AppAuth.getUser();
    const date = window.AppCalendar.getTodayKey();
    const cur = await window.AppCalendar.getWorkPlan(me.id, date, { planScope: 'personal' }).catch(() => null);
    const plans = (Array.isArray(cur?.plans) ? cur.plans : []).filter(t => !String(t?.task || '').includes('[FIXTEST]'));
    plans.push({
      task: marker + ' owner task', subPlans: [], tags: [], status: null, assignedTo: null, assignedToName: '',
      budgetHeadId: 'UNALLOCATED', startDate: date, endDate: date, planScope: 'personal',
      carryForwardRootId: '', isRemoved: false, isPrivate: true,
      assignedFromPlanId: window.AppCalendar.getWorkPlanId(date, me.id, 'personal'),
      assignedFromTaskIndex: 0
    });
    await window.AppCalendar.setWorkPlan(date, plans, me.id, { planScope: 'personal' });
    if (window.AppStore?.invalidatePlans) window.AppStore.invalidatePlans();
  }, { marker: M1 });
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    if (window.app_openDayPlan) window.app_openDayPlan(window.AppCalendar.getTodayKey());
  });
  await page.waitForSelector('.personal-plans-container .plan-block', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  const roundtrip = await page.evaluate((marker) => {
    const blocks = [...document.querySelectorAll('.personal-plans-container .plan-block')];
    const block = blocks.find(b => (b.querySelector('.plan-task')?.value || '').includes(marker)) || blocks[0];
    if (!block) return { found: false };
    const hidden = block.querySelector('.plan-source-plan-id');
    const extracted = window.app_extractBlockData(block);
    return {
      found: !!hidden,
      hiddenInputName: hidden?.className || null,
      extractedHasKey: !!extracted && Object.prototype.hasOwnProperty.call(extracted, 'assignedFromPlanId'),
      extractedValue: extracted?.assignedFromPlanId ?? '(missing)',
      dataIndex: block.getAttribute('data-index')
    };
  }, M1);
  console.log(JSON.stringify(roundtrip));
  await page.evaluate(() => {
    document.querySelectorAll('.modal-overlay, #day-plan-modal').forEach(el => el.remove());
  }).catch(() => {});
  await page.waitForTimeout(500);

  step('4. Legacy "not-completed" task shows in the dashboard widget');
  await page.evaluate(async ({ marker }) => {
    const me = window.AppAuth.getUser();
    const date = window.AppCalendar.getTodayKey();
    const cur = await window.AppCalendar.getWorkPlan(me.id, date, { planScope: 'personal' }).catch(() => null);
    const plans = (Array.isArray(cur?.plans) ? cur.plans : []).filter(t => !String(t?.task || '').includes('[FIXTEST]'));
    plans.push({
      task: marker, subPlans: [], tags: [], status: 'not-completed', assignedTo: null, assignedToName: '',
      budgetHeadId: 'UNALLOCATED', startDate: date, endDate: date, planScope: 'personal',
      carryForwardRootId: '', isRemoved: false, isPrivate: false
    });
    await window.AppCalendar.setWorkPlan(date, plans, me.id, { planScope: 'personal' });
  }, { marker: M2 });

  await page.reload({ waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(4500);
  await page.waitForFunction(() => !!document.querySelector('.modern-dashboard'), { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const widget = await page.evaluate((marker) => {
    const items = [...document.querySelectorAll('.dashboard-planned-task-item')];
    const item = items.find(el => el.textContent.includes(marker));
    return {
      found: !!item,
      totalShown: items.length,
      title: item?.querySelector('.dashboard-planned-task-title')?.textContent?.trim() || null
    };
  }, M2);
  console.log(JSON.stringify(widget));

  step('5. Cleanup: remove injected tasks');
  const cleaned = await page.evaluate(async () => {
    const me = window.AppAuth.getUser();
    const date = window.AppCalendar.getTodayKey();
    const cur = await window.AppCalendar.getWorkPlan(me.id, date, { planScope: 'personal' }).catch(() => null);
    let removed = 0;
    if (cur && Array.isArray(cur.plans)) {
      const filtered = cur.plans.filter(t => {
        if (String(t?.task || '').includes('[FIXTEST]')) { removed += 1; return false; }
        return true;
      });
      await window.AppCalendar.setWorkPlan(date, filtered, me.id, { planScope: 'personal' });
    }
    const users = await window.AppDB.getAll('users').catch(() => []);
    const other = (users || []).find(u => u.id !== me.id) || null;
    if (other) {
      const op = await window.AppCalendar.getWorkPlan(other.id, date, { planScope: 'personal' }).catch(() => null);
      if (op && Array.isArray(op.plans)) {
        await window.AppCalendar.setWorkPlan(date, op.plans.filter(t => !String(t?.task || '').includes('[FIXTEST]')), other.id, { planScope: 'personal' });
      }
    }
    return { removed };
  });
  step(`   cleanup removed ${cleaned.removed} task(s)`);

  console.log(JSON.stringify({ consoleErrors }, null, 2));
} finally {
  await page.evaluate(async () => {
    try {
      const me = window.AppAuth?.getUser();
      const date = window.AppCalendar.getTodayKey();
      if (!me) return;
      const cur = await window.AppCalendar.getWorkPlan(me.id, date, { planScope: 'personal' }).catch(() => null);
      if (cur && Array.isArray(cur.plans)) {
        await window.AppCalendar.setWorkPlan(date, cur.plans.filter(t => !String(t?.task || '').includes('[FIXTEST]')), me.id, { planScope: 'personal' });
      }
      const users = await window.AppDB.getAll('users').catch(() => []);
      const other = (users || []).find(u => u.id !== me.id) || null;
      if (other) {
        const op = await window.AppCalendar.getWorkPlan(other.id, date, { planScope: 'personal' }).catch(() => null);
        if (op && Array.isArray(op.plans)) {
          await window.AppCalendar.setWorkPlan(date, op.plans.filter(t => !String(t?.task || '').includes('[FIXTEST]')), other.id, { planScope: 'personal' });
        }
      }
    } catch { /* ignore */ }
  }).catch(() => {});
  await browser.close();
}
console.log('Done.');
