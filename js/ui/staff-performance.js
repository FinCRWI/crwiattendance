/**
 * Staff Performance Monitor — Personal View
 * Shows the logged-in user's (or viewed staff's) performance radar,
 * dimension breakdown, weekly trend, and insights.
 * All data comes from analytics.getPersonalPerformance().
 */

import { safeHtml, safeUrl } from './helpers.js';

// ─── Radar Chart (Chart.js global) ─────────────────────────────
let _radarInstance = null;

function renderRadarChart(dimensions) {
    // Defer to next tick so DOM is ready
    setTimeout(() => {
        const canvas = document.getElementById('perf-radar-canvas');
        if (!canvas || !window.Chart) return;

        if (_radarInstance) { _radarInstance.destroy(); _radarInstance = null; }

        const labels = Object.values(dimensions).map(d => d.label);
        const scores = Object.values(dimensions).map(d => d.score);
        const colors = Object.values(dimensions).map(d => d.color);

        _radarInstance = new Chart(canvas.getContext('2d'), {
            type: 'radar',
            data: {
                labels,
                datasets: [{
                    label: 'Score',
                    data: scores,
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
                    borderColor: '#6366f1',
                    borderWidth: 2,
                    pointBackgroundColor: colors,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: {
                    r: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            stepSize: 20,
                            font: { size: 9 },
                            color: '#94a3b8',
                            backdropColor: 'transparent'
                        },
                        pointLabels: {
                            font: { size: 10, weight: '600' },
                            color: '#475569'
                        },
                        grid: { color: '#e2e8f0' },
                        angleLines: { color: '#e2e8f0' }
                    }
                }
            }
        });
    }, 50);
}

// ─── Dimension Bar ─────────────────────────────────────────────
function dimBarHtml(dim) {
    const pct = Math.min(100, Math.max(0, dim.score));
    const color = dim.score >= 80 ? '#16a34a' : dim.score >= 50 ? '#d97706' : '#dc2626';
    return `
        <div class="perf-dim-row">
            <div class="perf-dim-icon" style="color:${dim.color}"><i class="${dim.icon}"></i></div>
            <div class="perf-dim-label">${safeHtml(dim.label)}</div>
            <div class="perf-dim-bar-wrap">
                <div class="perf-dim-bar" style="width:${pct}%;background:${color};"></div>
            </div>
            <div class="perf-dim-score" style="color:${color}">${dim.score}</div>
        </div>`;
}

// ─── Trend Sparkline (pure CSS) ────────────────────────────────
function trendHtml(trend) {
    if (!trend || trend.length < 2) return '';
    const max = Math.max(...trend.map(t => t.score), 1);
    const bars = trend.map(t => {
        const h = Math.max(4, (t.score / max) * 100);
        const color = t.score >= 80 ? '#16a34a' : t.score >= 50 ? '#d97706' : '#dc2626';
        return `<div class="perf-trend-col">
            <div class="perf-trend-bar" style="height:${h}%;background:${color};" title="${t.score}"></div>
            <div class="perf-trend-label">${safeHtml(t.week || '')}</div>
            <div class="perf-trend-val">${t.score}</div>
        </div>`;
    }).join('');

    // Trend arrow
    const first = trend[0].score;
    const last = trend[trend.length - 1].score;
    const diff = last - first;
    let arrow = '', arrowClass = '';
    if (diff > 3) { arrow = '↗ Improving'; arrowClass = 'perf-trend-up'; }
    else if (diff < -3) { arrow = '↘ Declining'; arrowClass = 'perf-trend-down'; }
    else { arrow = '→ Stable'; arrowClass = 'perf-trend-flat'; }

    return `
        <div class="perf-trend-section">
            <div class="perf-trend-header">
                <span class="perf-trend-title">📈 Weekly Trend</span>
                <span class="perf-trend-badge ${arrowClass}">${arrow} (${diff >= 0 ? '+' : ''}${diff})</span>
            </div>
            <div class="perf-trend-chart">${bars}</div>
        </div>`;
}

// ─── Insights ──────────────────────────────────────────────────
function insightsHtml(insights) {
    if (!insights || insights.length === 0) return '';
    const iconMap = {
        positive: 'fa-solid fa-circle-check',
        improve: 'fa-solid fa-lightbulb',
        warning: 'fa-solid fa-triangle-exclamation',
        neutral: 'fa-solid fa-info-circle'
    };
    const colorMap = {
        positive: '#16a34a',
        improve: '#2563eb',
        warning: '#d97706',
        neutral: '#64748b'
    };
    const items = insights.map(ins => `
        <div class="perf-insight" style="border-left-color:${colorMap[ins.type] || '#64748b'}">
            <i class="${iconMap[ins.type] || 'fa-solid fa-info-circle'}" style="color:${colorMap[ins.type] || '#64748b'}"></i>
            <span>${safeHtml(ins.text)}</span>
        </div>`).join('');

    return `
        <div class="perf-insights-section">
            <div class="perf-insights-title">💡 Insights</div>
            ${items}
        </div>`;
}

// ─── Detail Chips (quick stats) ────────────────────────────────
function detailChipsHtml(details) {
    if (!details || Object.keys(details).length === 0) return '';
    const chips = [];
    if (details.daysWorked) chips.push(`<span class="perf-chip"><i class="fa-solid fa-calendar"></i> ${details.daysWorked} days worked</span>`);
    if (details.taskCompleted) chips.push(`<span class="perf-chip perf-chip-green"><i class="fa-solid fa-check"></i> ${details.taskCompleted} completed</span>`);
    if (details.taskInProgress) chips.push(`<span class="perf-chip perf-chip-blue"><i class="fa-solid fa-spinner"></i> ${details.taskInProgress} in progress</span>`);
    if (details.taskMissed) chips.push(`<span class="perf-chip perf-chip-red"><i class="fa-solid fa-xmark"></i> ${details.taskMissed} missed</span>`);
    if (details.extraHours > 0) chips.push(`<span class="perf-chip perf-chip-purple"><i class="fa-solid fa-clock"></i> ${details.extraHours}h extra</span>`);
    if (details.avgActivity) chips.push(`<span class="perf-chip"><i class="fa-solid fa-bolt"></i> ${details.avgActivity}% activity</span>`);

    return chips.length > 0
        ? `<div class="perf-detail-chips">${chips.join('')}</div>`
        : '';
}

// ─── Score Ring ────────────────────────────────────────────────
function scoreRingHtml(score) {
    const color = score >= 80 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
    const radius = 22;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;
    return `
        <div class="perf-score-ring">
            <svg width="56" height="56" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="${radius}" fill="none" stroke="#e2e8f0" stroke-width="4"/>
                <circle cx="28" cy="28" r="${radius}" fill="none" stroke="${color}" stroke-width="4"
                    stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
                    stroke-linecap="round" transform="rotate(-90 28 28)"
                    style="transition: stroke-dashoffset 0.8s ease;"/>
            </svg>
            <div class="perf-score-ring-value" style="color:${color}">${score}</div>
        </div>`;
}

// ─── Main Render ───────────────────────────────────────────────
// ─── Period config ───────────────────────────────────────────────
const PERF_PERIODS = [
    { key: 'week', label: 'This Week', windowDays: 7, trendWeeks: 1 },
    { key: 'month', label: 'This Month', windowDays: 30, trendWeeks: 4 },
    { key: 'year', label: 'This Year', windowDays: 365, trendWeeks: 12 }
];

let _personalPerfUserId = null;
let _personalPerfCurrentPeriod = 'week';

function personalPerfTabsHtml(activeKey) {
    return PERF_PERIODS.map(p =>
        `<button class="perf-team-tab ${p.key === activeKey ? 'active' : ''}" onclick="window.app_switchPersonalPerf('${p.key}')">${safeHtml(p.label)}</button>`
    ).join('');
}

window.app_switchPersonalPerf = async (periodKey) => {
    if (!_personalPerfUserId || !window.AppAnalytics?.getPersonalPerformance) return;
    _personalPerfCurrentPeriod = periodKey;
    const period = PERF_PERIODS.find(p => p.key === periodKey) || PERF_PERIODS[0];
    const container = document.querySelector('.dashboard-perf-card');
    if (!container) return;
    // Show loading state
    container.querySelector('.perf-main-layout').style.opacity = '0.4';
    try {
        const perfData = await window.AppAnalytics.getPersonalPerformance(_personalPerfUserId, { windowDays: period.windowDays, trendWeeks: period.trendWeeks });
        if (perfData) {
            cleanupPerformanceChart();
            container.outerHTML = renderStaffPerformance(perfData, { windowDays: period.windowDays, period: periodKey });
        }
    } catch (e) {
        console.warn('[Perf] Personal period switch failed:', e);
        container.querySelector('.perf-main-layout').style.opacity = '1';
    }
};

export function renderStaffPerformance(perfData, options = {}) {
    if (!perfData) {
        return `<div class="card dashboard-perf-card" style="display:none;"></div>`;
    }

    _personalPerfUserId = perfData.userId || _personalPerfUserId;
    const periodKey = options.period || _personalPerfCurrentPeriod || 'week';
    const { composite, dimensions, details, trend, insights } = perfData;
    const period = PERF_PERIODS.find(p => p.key === periodKey) || PERF_PERIODS[0];

    // Kick off radar chart after DOM insert
    if (dimensions) renderRadarChart(dimensions);

    return `
        <div class="card dashboard-perf-card">
            <div class="perf-team-tabs" style="margin-bottom:0.5rem;">
                ${personalPerfTabsHtml(periodKey)}
            </div>
            <div class="dashboard-perf-head">
                <div>
                    <h4 class="dashboard-perf-title">Your Performance</h4>
                    <span class="dashboard-perf-subtitle">${safeHtml(period.label)} · ${options.windowDays || period.windowDays}-day window</span>
                </div>
            </div>

            <div class="perf-main-layout">
                <!-- Left: Score ring + Radar -->
                <div class="perf-left">
                    ${scoreRingHtml(composite)}
                    <div class="perf-radar-wrap">
                        <canvas id="perf-radar-canvas"></canvas>
                    </div>
                </div>

                <!-- Right: Dimension bars + chips -->
                <div class="perf-right">
                    <div class="perf-dims">
                        ${Object.values(dimensions || {}).map(d => dimBarHtml(d)).join('')}
                    </div>
                    ${detailChipsHtml(details)}
                </div>
            </div>

            ${trendHtml(trend)}
            ${insightsHtml(insights)}
        </div>`;
}

/**
 * Cleanup chart instance (call on page navigation).
 */
export function cleanupPerformanceChart() {
    if (_radarInstance) { _radarInstance.destroy(); _radarInstance = null; }
}

// ─── Team Performance (Expanded View) ──────────────────────────

function teamDimMiniBar(score) {
    const color = score >= 80 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
    return `<div class="perf-team-mini-bar" style="width:${Math.min(100, score)}%;background:${color};"></div>`;
}



// Cache fetched results per period so tab switching is instant
let _perfTeamCache = {};
let _perfTeamAllUsers = null;

function perfPeriodTabsHtml(activeKey) {
    return PERF_PERIODS.map(p =>
        `<button class="perf-team-tab ${p.key === activeKey ? 'active' : ''}" onclick="window.app_switchPerfPeriod('${p.key}')">${safeHtml(p.label)}</button>`
    ).join('');
}

function perfTeamRowHtml(r) {
    if (!r.perf) return `
        <div class="perf-team-row perf-team-row-empty">
            <div class="perf-team-avatar"><img src="${safeUrl(r.user.avatar || '')}" alt="" loading="lazy"></div>
            <div class="perf-team-name">${safeHtml(r.user.name)}</div>
            <div class="perf-team-empty-msg">No data</div>
        </div>`;
    return `
        <div class="perf-team-row">
            <div class="perf-team-avatar"><img src="${safeUrl(r.user.avatar || '')}" alt="" loading="lazy"></div>
            <div class="perf-team-name-col">
                <div class="perf-team-name">${safeHtml(r.user.name)}</div>
                <div class="perf-team-role">${safeHtml(r.user.role || 'Staff')}</div>
            </div>
            <div class="perf-team-score-badge" style="background:${r.perf.composite >= 80 ? '#dcfce7' : r.perf.composite >= 50 ? '#fef3c7' : '#fee2e2'};color:${r.perf.composite >= 80 ? '#16a34a' : r.perf.composite >= 50 ? '#92400e' : '#991b1b'}">${r.perf.composite}</div>
            <div class="perf-team-dims">
                ${Object.values(r.perf.dimensions).map(dim => `
                    <div class="perf-team-dim">
                        <span class="perf-team-dim-name">${safeHtml(dim.label)}</span>
                        <div class="perf-team-mini-bar-wrap">${teamDimMiniBar(dim.score)}</div>
                        <span class="perf-team-dim-val">${dim.score}</span>
                    </div>
                `).join('')}
            </div>
        </div>`;
}

function renderPerfTeamResults(results, periodKey) {
    const period = PERF_PERIODS.find(p => p.key === periodKey) || PERF_PERIODS[0];
    const scored = results.filter(r => r.perf?.composite > 0);
    const avgComposite = scored.length > 0
        ? Math.round(scored.reduce((s, r) => s + r.perf.composite, 0) / scored.length)
        : 0;

    return `
        <div class="perf-team-wrap">
            <div class="perf-team-tabs">
                ${perfPeriodTabsHtml(periodKey)}
            </div>
            <div class="perf-team-header">
                <h4>Team Performance — ${safeHtml(period.label)}</h4>
                <div class="perf-team-avg-badge">Team avg: <strong>${avgComposite}</strong></div>
            </div>
            <div class="perf-team-list">
                ${results.map(perfTeamRowHtml).join('')}
            </div>
        </div>`;
}

async function fetchTeamPerformance(allUsers, periodKey) {
    const period = PERF_PERIODS.find(p => p.key === periodKey) || PERF_PERIODS[0];
    const analytics = window.AppAnalytics;
    const results = [];
    const BATCH = 5;
    const TIMEOUT_MS = 15000;
    const withTimeout = (promise, ms) => Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
    for (let i = 0; i < allUsers.length; i += BATCH) {
        const batch = allUsers.slice(i, i + BATCH);
        const batchResults = await Promise.all(
            batch.map(u => withTimeout(
                analytics.getPersonalPerformance(u.id, { windowDays: period.windowDays, trendWeeks: period.trendWeeks }),
                TIMEOUT_MS
            ).catch(e => { console.warn('[Perf]', u.name, period.key, e.message); return null; }))
        );
        results.push(...batchResults.map((perf, idx) => ({
            user: batch[idx],
            perf: perf
        })));
    }
    results.sort((a, b) => (b.perf?.composite || 0) - (a.perf?.composite || 0));
    return results;
}

/**
 * Load and display team performance for a given period.
 * Uses cache for instant tab switching after first load.
 */
async function loadAndRenderTeam(allUsers, periodKey, container) {
    if (_perfTeamCache[periodKey]) {
        container.innerHTML = renderPerfTeamResults(_perfTeamCache[periodKey], periodKey);
        return;
    }
    container.innerHTML = `<div class="perf-team-loading">
        <span class="perf-team-loading-dot"></span>
        <span class="perf-team-loading-dot"></span>
        <span class="perf-team-loading-dot"></span>
        <div>Computing scores for ${allUsers.length} staff...</div>
    </div>`;
    try {
        const results = await fetchTeamPerformance(allUsers, periodKey);
        _perfTeamCache[periodKey] = results;
        container.innerHTML = renderPerfTeamResults(results, periodKey);
    } catch (err) {
        console.error('[Perf] Team fetch failed:', err);
        container.innerHTML = `<div style="padding:1.5rem;color:#991b1b;">Failed to load team performance. Please try again.</div>`;
    }
}

/**
 * Tab-switching handler (global, called from onclick).
 */
window.app_switchPerfPeriod = (periodKey) => {
    const container = document.getElementById('perf-team-expanded');
    if (!container || !_perfTeamAllUsers) return;
    loadAndRenderTeam(_perfTeamAllUsers, periodKey, container);
};

/**
 * Fetches all staff performance and renders the team expanded view.
 * Called by the card-mode hook after the overlay opens.
 */
export async function renderTeamPerformanceExpanded() {
    const container = document.getElementById('perf-team-expanded');
    if (!container) return;

    const analytics = window.AppAnalytics;
    const auth = window.AppAuth;
    if (!analytics?.getPersonalPerformance || !auth?.getUser) {
        container.innerHTML = '<div style="padding:1rem;color:#94a3b8;">Performance data unavailable.</div>';
        return;
    }

    // Get all users (exclude demo)
    let allUsers = [];
    try {
        allUsers = await (window.AppDB?.getCached
            ? window.AppDB.getCached(window.AppDB.getCacheKey('perfTeamUsers', 'users', {}), 60000, () => window.AppDB.getAll('users'))
            : window.AppDB.getAll('users'));
        allUsers = allUsers.filter(u => u && u.id && !window.AppConfig?.isDemoUser?.(u));
    } catch { allUsers = []; }

    if (allUsers.length === 0) {
        container.innerHTML = '<div style="padding:1rem;color:#94a3b8;">No staff found.</div>';
        return;
    }

    _perfTeamAllUsers = allUsers;
    _perfTeamCache = {}; // reset cache on fresh open
    await loadAndRenderTeam(allUsers, 'week', container);
}
