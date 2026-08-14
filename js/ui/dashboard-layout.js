/**
 * Dashboard Layout Manager
 * Synthetic drag-to-reorder + corner-drag resize with localStorage persistence.
 * Uses mousedown/touchstart → mousemove/touchmove → mouseup/touchend
 * with a floating clone (no native HTML5 DnD).
 */

const STORE = 'dashboard_widget_layout_';
const LAYOUT_VER = 4;
const R_MIN = 80;
const R_MAX = 800;

const ZONE_MAP = {
  primaryRow: ['checkin', 'worklog', 'team-schedule'],
  detailSection: ['journey-reflection', 'team-activity', 'hero-week', 'leave-requests', 'leave-history', 'missed-checkout', 'staff-performance'],
  statsRow: ['stats-monthly', 'stats-yearly']
};

const ZONE_SEL = {
  primaryRow: '[data-zone-id="primaryRow"]',
  detailSection: '[data-zone-id="detailSection"]',
  statsRow: '[data-zone-id="statsRow"]'
};

const CLS = [
  ['.dashboard-checkin-card', 'checkin'],
  ['.dashboard-worklog-card', 'worklog'],
  ['.dashboard-team-activity-card', 'team-activity'],
  ['.dashboard-hero-stats-card.hero-slot', 'hero-week'],
  ['.dashboard-journey-card', 'journey-reflection'],
  ['.dashboard-team-schedule-card', 'team-schedule'],
  ['.dashboard-leave-requests-card', 'leave-requests'],
  ['.dashboard-leave-history-card', 'leave-history'],
  ['.dashboard-tagged-card', 'missed-checkout'],
  ['.dashboard-perf-card', 'staff-performance'],
  ['.dashboard-stats-card[data-stats-type="monthly"]', 'stats-monthly'],
  ['.dashboard-stats-card[data-stats-type="yearly"]', 'stats-yearly']
];

const NEVER_WRAP = new Set(['checkin']);
let editOn = false, drag = null, resize = null, H = null;

// ─── Public API ────────────────────────────────────────────────

export function initDashboardLayout(uid) {
  uid = uid || userId();
  const lay = load(uid);
  if (lay) flatten();
  tag();
  applyOrder(uid);
  applySizes(uid);
  injectBtn(uid);
}

export function toggleEditMode(uid) {
  uid = uid || userId();
  editOn = !editOn;
  const db = qs('.dashboard-staff-view');
  if (!db) return;

  // Kill any in-flight gesture
  if (drag) { removeClone(); if (drag.el) drag.el.classList.remove('dashboard-widget-dragging'); drag = null; }
  if (resize) { if (resize.el) resize.el.classList.remove('dashboard-resize-active'); resize = null; }

  if (editOn) {
    flatten(); db.classList.add('dashboard-edit-mode'); tag();
    a9(db, '[data-dash-id]', el => {
      if (!el.querySelector('.dashboard-widget-handle')) {
        el.style.position = 'relative';
        const h = ce('div'); h.className = 'dashboard-widget-handle'; h.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
        h.setAttribute('aria-label','Drag'); el.prepend(h);
      }
      if (!el.querySelector('.dashboard-resize-handle')) {
        const r = ce('div'); r.className = 'dashboard-resize-handle'; r.setAttribute('aria-label','Resize'); el.append(r);
      }
    });
    bindDrag(db, uid);
    bindResize(db, uid);
  } else {
    // Save before clearing inline dimensions
    save(uid);
    db.classList.remove('dashboard-edit-mode');
    a9(db, '.dashboard-widget-handle', h => h.remove());
    a9(db, '.dashboard-resize-handle', h => h.remove());
    a9(db, '.dashboard-resize-active', e => e.classList.remove('dashboard-resize-active'));
    // Clear inline sizing set by resize
    a9(db, '[data-dash-id]', el => {
      el.style.position = '';
      el.style.minHeight = '';
      el.style.minWidth = '';
      el.style.width = '';
      el.style.height = '';
      el.style.maxWidth = '';
    });
    unbindDrag();
    unbindResize();
  }
  const btn = document.getElementById('dashboard-layout-toggle');
  if (btn) btn.innerHTML = editOn ? '<i class="fa-solid fa-check"></i> Done' : '<i class="fa-solid fa-grid-2"></i> Customize', btn.classList.toggle('active', editOn);
}

export function applyDashboardLayout(uid) { applyOrder(uid); }
export function saveLayout(uid) { save(uid); }
export function loadLayout(uid) { return load(uid); }
export function isEditModeActive() { return editOn; }

// ─── Layout apply / save / load ───────────────────────────────

function applyOrder(uid) {
  tag();
  const lay = load(uid);
  if (!lay) return;
  flatten();
  const db = qs('.dashboard-staff-view');
  if (!db) return;

  const seen = new Set();

  for (const [zone, ids] of Object.entries(lay)) {
    if (zone[0] === '_') continue;
    const z = db.querySelector(ZONE_SEL[zone]);
    if (!z) continue;
    const ord = [];
    for (const id of ids) {
      const el = gem(id);
      if (!el) continue;
      seen.add(id);
      const f = unwrap(el, zone);
      ord.push(zone === 'primaryRow' ? wrap(f) : f);
    }
    ord.forEach(el => z.append(el));
  }

  // Orphaned widgets back to default zone
  db.querySelectorAll(CLS.map(c => c[0]).join(',')).forEach(el => {
    const id = gid(el);
    if (!id || seen.has(id)) return;
    const dz = defZone(id);
    if (!dz) return;
    const z = db.querySelector(ZONE_SEL[dz]);
    if (!z) return;
    const f = unwrap(el, dz);
    const e2 = dz === 'primaryRow' ? wrap(f) : f;
    if (e2.parentNode !== z) z.append(e2);
  });
  cln();
}

function save(uid) {
  uid = uid || userId();
  const db = qs('.dashboard-staff-view');
  if (!db) return;

  let prev = {};
  try { const x = JSON.parse(localStorage.getItem(STORE + uid) || '{}'); prev = x._s || {}; } catch (e) { void e; }

  const lay = {};
  for (const [zn, sel] of Object.entries(ZONE_SEL)) {
    const z = db.querySelector(sel);
    if (!z) continue;
    const ids = [];
    for (const ch of z.children) {
      if (ch.matches('.dashboard-primary-col')) {
        const inner = ch.querySelector('[data-dash-id]');
        if (inner) ids.push(inner.getAttribute('data-dash-id'));
      } else if (ch.hasAttribute('data-dash-id')) {
        ids.push(ch.getAttribute('data-dash-id'));
      }
    }
    lay[zn] = ids;
  }

  const s = {};
  db.querySelectorAll('[data-dash-id]').forEach(el => {
    const id = el.getAttribute('data-dash-id');
    if (!id) return;
    const h = el.getAttribute('data-wh');
    if (h) s[id] = { h };
  });
  Object.assign(prev, s);
  lay._ver = LAYOUT_VER; lay._s = prev;
  try { localStorage.setItem(STORE + uid, JSON.stringify(lay)); } catch (e) { void e; }
}

function load(uid) {
  try {
    const raw = localStorage.getItem(STORE + uid);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && p._ver >= LAYOUT_VER) {
      const { _ver, _h, _s, ...z } = p;
      z._s = _s || _h || {};
      return z;
    }
    return null;
  } catch { return null; }
}

function applySizes(uid) {
  const lay = load(uid);
  if (!lay || !lay._s) return;
  for (const [id, d] of Object.entries(lay._s)) {
    const el = gem(id);
    if (!el) continue;
    if (d.h) { el.setAttribute('data-wh', d.h); el.style.minHeight = d.h + 'px'; el.style.height = d.h + 'px'; }
    // Width is NOT reapplied — grid layout controls column width via 1fr.
    // Persisting explicit pixel widths would override the grid and stretch columns.
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function userId() { try { return window.AppAuth?.getUser()?.id || 'd'; } catch { return 'd'; } }
function qs(s) { return document.querySelector(s); }
function qsa(s, p) { return (p || document).querySelectorAll(s); }
function ce(t) { return document.createElement(t); }
function a9(p, s, fn) { p.querySelectorAll(s).forEach(fn); }

function defZone(id) {
  for (const [z, ids] of Object.entries(ZONE_MAP)) if (ids.includes(id)) return z;
  return 'detailSection';
}

function gid(el) {
  if (el.hasAttribute('data-dash-id')) return el.getAttribute('data-dash-id');
  for (const [s, id] of CLS) if (el.matches(s)) return id;
  return null;
}

function gem(id) {
  let d = document.querySelector(`[data-dash-id="${id}"]`);
  if (d) return d;
  for (const [s, id2] of CLS) if (id2 === id) return document.querySelector(s);
  return null;
}

function tag() {
  for (const [s, id] of CLS) qsa(s).forEach(el => { if (!el.hasAttribute('data-dash-id')) el.setAttribute('data-dash-id', id); });
}

function unwrap(el, zone) {
  if (zone === 'primaryRow') return el;
  const id = el.getAttribute('data-dash-id');
  if (id && NEVER_WRAP.has(id)) return el;
  const w = el.closest('.dashboard-primary-col');
  if (w && w.parentNode) {
    if (w.classList.contains('dashboard-primary-col-highlight')) el.classList.add('dashboard-primary-col-highlight');
    w.parentNode.insertBefore(el, w);
    if (!w.children.length) w.remove();
  }
  return el;
}

function wrap(el) {
  const id = el.getAttribute('data-dash-id');
  if (id && NEVER_WRAP.has(id)) return el;
  const ex = el.closest('.dashboard-primary-col');
  if (ex) return ex;
  const w = ce('div'); w.className = 'dashboard-primary-col';
  el.parentNode.insertBefore(w, el); w.append(el);
  return w;
}

function cln() { a9(document, '.dashboard-primary-col', c => { if (!c.children.length) c.remove(); }); }

function flatten() {
  const d = qs('[data-zone-id="detailSection"]');
  if (!d) return;
  d.querySelectorAll('.dashboard-schedule-hero-row').forEach(r => {
    [...r.children].forEach(c => d.insertBefore(c, r));
    r.remove();
  });
}

// ─── Edit toggle button ───────────────────────────────────────

function injectBtn(uid) {
  if (!window.app_canCustomizeDashboard?.()) return;
  const old = document.getElementById('dashboard-layout-toggle');
  if (old) old.remove();
  const h = qs('.dashboard-hero-card');
  if (!h) return;
  const b = ce('button'); b.id = 'dashboard-layout-toggle'; b.className = 'dashboard-layout-toggle';
  b.innerHTML = '<i class="fa-solid fa-grid-2"></i> Customize';
  b.addEventListener('click', () => toggleEditMode(uid));
  const a = h.querySelector('.dashboard-hero-aside');
  if (a) a.insertBefore(b, a.firstChild);
}

// ─── Insertion index (for drop positioning) ───────────────────

function insIdx(zone, y) {
  const ch = [...zone.querySelectorAll(':scope > .dashboard-primary-col, :scope > [data-dash-id]')];
  for (let i = 0; i < ch.length; i++) { const r = ch[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return i; }
  return ch.length;
}

function place(wid, target, y) {
  let el = document.querySelector(`[data-dash-id="${wid}"]`);
  if (!el) return;
  const zn = target.getAttribute('data-zone-id');

  if (zn !== 'primaryRow') {
    const w = el.closest('.dashboard-primary-col');
    if (w) { w.parentNode.insertBefore(el, w); if (!w.children.length) w.remove(); }
  }
  if (zn === 'primaryRow' && !el.closest('.dashboard-primary-col')) {
    const w = ce('div'); w.className = 'dashboard-primary-col';
    el.parentNode.insertBefore(w, el); w.append(el);
  }

  el = document.querySelector(`[data-dash-id="${wid}"]`);
  if (!el) return;
  const eff = zn === 'primaryRow' ? el.closest('.dashboard-primary-col') || el : el;

  if (eff.parentNode === target) {
    const idx = insIdx(target, y);
    const ch = target.querySelectorAll(':scope > .dashboard-primary-col, :scope > [data-dash-id]');
    if (idx < ch.length && ch[idx] !== eff) target.insertBefore(eff, ch[idx]);
    else if (idx >= ch.length) target.append(eff);
  } else {
    target.append(eff);
  }
  cln();
}

// ─── Synthetic Drag (unified mouse + touch) ───────────────────

let _touchDrag = false; // prevent synthesized mouse events after touch

function bindDrag(db, uid) {
  if (H) return; // already bound

  const h = {};

  h.s = (e) => {
    if (e.type === 'mousedown' && _touchDrag) { _touchDrag = false; return; } // synthesized mousedown — skip
    if (e.target.closest('.dashboard-resize-handle')) return;
    const el = e.target.closest('[data-dash-id]');
    if (!el) return;
    const src = e.touches ? e.touches[0] : e;
    if (!src.clientX) return;

    e.preventDefault();

    const r = el.getBoundingClientRect();
    drag = { wid: el.getAttribute('data-dash-id'), el, sx: src.clientX, sy: src.clientY, ox: src.clientX - r.left, oy: src.clientY - r.top, moved: false };
    el.classList.add('dashboard-widget-dragging');

    const clone = el.cloneNode(true);
    clone.style.pointerEvents = 'none';
    clone.style.position = 'fixed'; // override any inherited position
    clone.className = 'dashboard-drag-clone';
    clone.style.width = r.width + 'px';
    clone.style.left = (src.clientX - drag.ox) + 'px';
    clone.style.top = (src.clientY - drag.oy) + 'px';
    document.body.append(clone);
    drag.c = clone;

    if (e.type === 'touchstart') _touchDrag = true;
  };

  h.m = (e) => {
    if (!drag || !drag.c) return;
    const src = e.touches ? e.touches[0] : e;
    if (!src.clientX) return;

    if (!drag.moved && (Math.abs(src.clientX - drag.sx) > 5 || Math.abs(src.clientY - drag.sy) > 5)) drag.moved = true;

    drag.c.style.left = (src.clientX - drag.ox) + 'px';
    drag.c.style.top = (src.clientY - drag.oy) + 'px';

    qsa('.dashboard-zone-drag-over').forEach(z => z.classList.remove('dashboard-zone-drag-over'));
    const under = document.elementFromPoint(src.clientX, src.clientY);
    if (under) { const z = under.closest('[data-zone-id]'); if (z) z.classList.add('dashboard-zone-drag-over'); }

    e.preventDefault();
  };

  h.e = (e) => {
    if (!drag) return;
    qsa('.dashboard-zone-drag-over').forEach(z => z.classList.remove('dashboard-zone-drag-over'));
    removeClone();

    if (drag.moved) {
      const src = e.changedTouches ? e.changedTouches[0] : e;
      let z = null;
      qsa('[data-zone-id]').forEach(zn => { const r = zn.getBoundingClientRect(); if (src.clientX >= r.left && src.clientX <= r.right && src.clientY >= r.top && src.clientY <= r.bottom) z = zn; });
      if (z && drag.wid) { place(drag.wid, z, src.clientY); save(uid); }
    }
    if (drag.el) drag.el.classList.remove('dashboard-widget-dragging');
    drag = null;
  };

  h.esc = (e) => { if (e.key === 'Escape' && drag) { qsa('.dashboard-zone-drag-over').forEach(z => z.classList.remove('dashboard-zone-drag-over')); removeClone(); if (drag.el) drag.el.classList.remove('dashboard-widget-dragging'); drag = null; } };

  a9(db, '[data-dash-id]', el => { el.addEventListener('mousedown', h.s); el.addEventListener('touchstart', h.s, { passive: false }); });
  document.addEventListener('mousemove', h.m); document.addEventListener('mouseup', h.e);
  document.addEventListener('touchmove', h.m, { passive: false }); document.addEventListener('touchend', h.e, { passive: false });
  document.addEventListener('keydown', h.esc);

  H = h;
  // Bind touch resize after H is set
  bindTouchResize(uid);
}

function unbindDrag() {
  if (!H) return;
  const db = qs('.dashboard-staff-view');
  if (db) { a9(db, '[data-dash-id]', el => { el.removeEventListener('mousedown', H.s); el.removeEventListener('touchstart', H.s); }); }
  document.removeEventListener('mousemove', H.m); document.removeEventListener('mouseup', H.e);
  document.removeEventListener('touchmove', H.m); document.removeEventListener('touchend', H.e);
  document.removeEventListener('keydown', H.esc);
  unbindTouchResize();
  H = null;
}

function removeClone() { if (drag && drag.c && drag.c.parentNode) drag.c.parentNode.removeChild(drag.c); }

// ─── Desktop resize ───────────────────────────────────────────

function bindResize(db, uid) {
  const s = (e) => {
    const h = e.target.closest('.dashboard-resize-handle');
    if (!h) return; const el = h.closest('[data-dash-id]'); if (!el) return;
    e.preventDefault();
    resize = { el, sy: e.clientY, sh: el.offsetHeight, uid };
    el.classList.add('dashboard-resize-active');

    const m = (ev) => {
      if (!resize) return;
      const dh = ev.clientY - resize.sy;
      const nh = Math.max(R_MIN, Math.min(R_MAX, resize.sh + dh));
      resize.el.style.minHeight = nh + 'px'; resize.el.style.height = nh + 'px';
      resize.el.setAttribute('data-wh', nh);
    };
    const u = () => {
      if (!resize) return;
      resize.el.classList.remove('dashboard-resize-active');
      resize.el.setAttribute('data-wh', resize.el.offsetHeight);
      save(resize.uid); resize = null;
      document.removeEventListener('mousemove', m); document.removeEventListener('mouseup', u);
    };
    document.addEventListener('mousemove', m); document.addEventListener('mouseup', u);
  };
  db.addEventListener('mousedown', s); H._rs = s;
}

function unbindResize() {
  if (!H || !H._rs) return;
  const db = qs('.dashboard-staff-view');
  if (db) db.removeEventListener('mousedown', H._rs);
}

// ─── Touch resize ─────────────────────────────────────────────

function bindTouchResize(uid) {
  if (!H) return;

  const s = (e) => {
    if (!editOn) return;
    const h = e.target.closest('.dashboard-resize-handle');
    if (!h) return; const el = h.closest('[data-dash-id]'); if (!el) return;
    e.preventDefault();
    const t = e.touches[0];
    resize = { el, uid, sy: t.clientY, sh: el.offsetHeight };
    el.classList.add('dashboard-resize-active');
  };

  const m = (e) => {
    if (!resize) return; e.preventDefault();
    const t = e.touches[0];
    const nh = Math.max(R_MIN, Math.min(R_MAX, resize.sh + t.clientY - resize.sy));
    resize.el.style.minHeight = nh + 'px'; resize.el.style.height = nh + 'px';
    resize.el.setAttribute('data-wh', nh);
  };

  const u = () => {
    if (!resize) return;
    resize.el.classList.remove('dashboard-resize-active');
    resize.el.setAttribute('data-wh', resize.el.offsetHeight);
    save(resize.uid); resize = null;
  };

  document.addEventListener('touchstart', s, { passive: false }); H._trs = s;
  document.addEventListener('touchmove', m, { passive: false }); H._trm = m;
  document.addEventListener('touchend', u, { passive: false }); H._tre = u;
}

function unbindTouchResize() {
  if (!H) return;
  document.removeEventListener('touchstart', H._trs); document.removeEventListener('touchmove', H._trm);
  document.removeEventListener('touchend', H._tre);
}
