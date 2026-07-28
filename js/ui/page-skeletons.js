/**
 * Page Skeleton Loading Components
 * Centralized skeleton system for all async pages in the CRWI Attendance App.
 * Reuses shimmer animation from dashboard-skeletons.js pattern.
 */

const SKELETON_BASE = 'background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%); background-size: 200% 100%; animation: skeleton-shimmer 1.5s infinite; border-radius: 8px;';

const SKELETON_KEYFRAMES = `
@keyframes skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}
.skeleton-card { padding: 1.25rem; border-radius: 16px; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.skeleton-line { height: 14px; margin-bottom: 10px; ${SKELETON_BASE} }
.skeleton-line.sm { width: 40%; height: 10px; }
.skeleton-line.md { width: 65%; }
.skeleton-line.lg { width: 85%; }
.skeleton-line.full { width: 100%; }
.skeleton-circle { border-radius: 50%; ${SKELETON_BASE} }
.skeleton-rect { border-radius: 8px; ${SKELETON_BASE} }
.skeleton-page { padding: 1rem; display: grid; gap: 1rem; }
`;

let _pageSkeletonStyleInjected = false;
function ensurePageSkeletonStyles() {
    if (_pageSkeletonStyleInjected) return;
    _pageSkeletonStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = SKELETON_KEYFRAMES;
    document.head.appendChild(style);
}

// ── Shared Primitives ────────────────────────────────────────────────────────

function skelLine(cls = '') { return `<div class="skeleton-line ${cls}"></div>`; }
function skelCircle(w, h, extra = '') { return `<div class="skeleton-circle" style="width:${w}px; height:${h}px; ${extra}"></div>`; }
function skelRect(w, h, extra = '') { return `<div class="skeleton-rect" style="width:${w}px; height:${h}px; ${extra}"></div>`; }

function skelStatCard() {
    return `<div class="skeleton-card" style="text-align:center;">
        ${skelCircle(40, 40, 'margin:0 auto 8px;')}
        ${skelLine('md')}
        ${skelLine('sm')}
    </div>`;
}

function skelTableRowSkeleton(rowCount, colWidths) {
    return Array.from({ length: rowCount }, () =>
        `<div style="display:flex; align-items:center; gap:0.75rem; padding:0.5rem 0; border-bottom:1px solid #f1f5f9;">
            ${colWidths.map(w => skelRect(w, 14)).join('')}
        </div>`
    ).join('');
}

// ── Admin Page Skeleton ──────────────────────────────────────────────────────

export function renderAdminSkeleton() {
    ensurePageSkeletonStyles();
    return `
    <div class="skeleton-page">
        <!-- Stat Cards -->
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:1rem;">
            ${Array.from({ length: 6 }, () => skelStatCard()).join('')}
        </div>
        <!-- Staff Table -->
        <div class="skeleton-card">
            ${skelLine('md')}
            ${skelTableRowSkeleton(8, [180, 100, 80, 80, 60])}
        </div>
        <!-- Leave Requests -->
        <div class="skeleton-card">
            ${skelLine('md')}
            ${skelTableRowSkeleton(3, [140, 100, 120, 80])}
        </div>
        <!-- Compliance -->
        <div class="skeleton-card">
            ${skelLine('md')}
            ${skelTableRowSkeleton(3, [160, 100, 100, 80])}
        </div>
    </div>`;
}

// ── Master Sheet Skeleton ────────────────────────────────────────────────────

export function renderMasterSheetSkeleton() {
    ensurePageSkeletonStyles();
    return `
    <div class="skeleton-page">
        <!-- Toolbar -->
        <div style="display:flex; gap:1rem; align-items:center;">
            ${skelRect(120, 36)}
            ${skelRect(80, 36)}
            ${skelRect(100, 36)}
        </div>
        <!-- Grid Table -->
        <div class="skeleton-card" style="overflow-x:auto;">
            <div style="display:flex; gap:0.5rem; padding-bottom:0.5rem; border-bottom:2px solid #e2e8f0; min-width:900px;">
                <div style="width:140px; flex-shrink:0;">${skelLine('lg')}</div>
                ${Array.from({ length: 15 }, () => `<div style="width:48px; flex-shrink:0;">${skelRect(44, 14)}</div>`).join('')}
            </div>
            ${Array.from({ length: 10 }, () => `
            <div style="display:flex; gap:0.5rem; padding:0.4rem 0; border-bottom:1px solid #f1f5f9; min-width:900px;">
                <div style="width:140px; flex-shrink:0;">${skelLine('md')}</div>
                ${Array.from({ length: 15 }, () => `<div style="width:48px; flex-shrink:0;">${skelRect(32, 14)}</div>`).join('')}
            </div>`).join('')}
        </div>
    </div>`;
}

// ── Annual Plan Skeleton ─────────────────────────────────────────────────────

export function renderAnnualPlanSkeleton() {
    ensurePageSkeletonStyles();
    return `
    <div class="skeleton-page">
        <!-- Toolbar -->
        <div style="display:flex; gap:0.75rem; align-items:center;">
            ${skelRect(80, 32)}
            ${skelRect(80, 32)}
            ${skelRect(120, 32)}
        </div>
        <!-- 12-Month Grid -->
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1rem;">
            ${Array.from({ length: 12 }, () => `
            <div class="skeleton-card" style="padding:0.75rem;">
                ${skelLine('sm')}
                <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:3px; margin-top:6px;">
                    ${Array.from({ length: 28 }, () => skelRect(16, 16, 'border-radius:4px;')).join('')}
                </div>
            </div>`).join('')}
        </div>
    </div>`;
}

// ── Profile Skeleton ─────────────────────────────────────────────────────────

export function renderProfileSkeleton() {
    ensurePageSkeletonStyles();
    return `
    <div class="skeleton-page">
        <!-- Hero Banner -->
        <div class="skeleton-card" style="display:flex; align-items:center; gap:1.5rem; padding:2rem;">
            ${skelCircle(72, 72, 'flex-shrink:0;')}
            <div style="flex:1;">
                ${skelLine('lg')}
                ${skelLine('md')}
                ${skelLine('sm')}
            </div>
        </div>
        <!-- Stats Strip -->
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1rem;">
            ${Array.from({ length: 4 }, () => `
            <div class="skeleton-card" style="text-align:center;">
                ${skelLine('sm')}
                ${skelLine('lg')}
            </div>`).join('')}
        </div>
        <!-- Leave History -->
        <div class="skeleton-card">
            ${skelLine('md')}
            ${skelTableRowSkeleton(5, [140, 100, 120, 80])}
        </div>
        <!-- Employment Details -->
        <div class="skeleton-card">
            ${skelLine('md')}
            ${Array.from({ length: 4 }, () => `
            <div style="display:flex; gap:1rem; padding:0.5rem 0; border-bottom:1px solid #f1f5f9;">
                <div style="width:120px;">${skelLine('sm')}</div>
                <div style="flex:1;">${skelLine('md')}</div>
            </div>`).join('')}
        </div>
    </div>`;
}

// ── Minutes Skeleton ─────────────────────────────────────────────────────────

export function renderMinutesSkeleton() {
    ensurePageSkeletonStyles();
    return `
    <div class="skeleton-page">
        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:center;">
            ${skelLine('md')}
            ${skelRect(120, 36)}
        </div>
        <!-- Search -->
        <div>${skelRect('100%', 40)}</div>
        <!-- Card Grid -->
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:1rem;">
            ${Array.from({ length: 6 }, () => `
            <div class="skeleton-card">
                ${skelLine('sm')}
                ${skelLine('lg')}
                <div style="display:flex; gap:0.5rem; margin-top:8px;">
                    ${skelCircle(24, 24)}
                    ${skelCircle(24, 24)}
                    ${skelCircle(24, 24)}
                </div>
                <div style="margin-top:8px;">${skelRect(60, 20)}</div>
            </div>`).join('')}
        </div>
    </div>`;
}

// ── Staff Directory Skeleton ─────────────────────────────────────────────────

export function renderStaffDirectorySkeleton() {
    ensurePageSkeletonStyles();
    return `
    <div style="display:flex; gap:1rem; padding:1rem; height:calc(100vh - 80px);">
        <!-- Sidebar -->
        <div class="skeleton-card" style="width:280px; flex-shrink:0; overflow:hidden;">
            ${skelLine('md')}
            ${Array.from({ length: 8 }, () => `
            <div style="display:flex; align-items:center; gap:0.75rem; padding:0.6rem 0; border-bottom:1px solid #f1f5f9;">
                ${skelCircle(36, 36, 'flex-shrink:0;')}
                <div style="flex:1;">
                    ${skelLine('md')}
                    ${skelLine('sm')}
                </div>
            </div>`).join('')}
        </div>
        <!-- Thread Panel -->
        <div class="skeleton-card" style="flex:1; overflow:hidden;">
            ${skelLine('md')}
            ${Array.from({ length: 3 }, () => `
            <div style="display:flex; align-items:flex-start; gap:0.75rem; padding:0.75rem 0; border-bottom:1px solid #f1f5f9;">
                ${skelCircle(40, 40, 'flex-shrink:0;')}
                <div style="flex:1;">
                    ${skelLine('lg')}
                    ${skelLine('md')}
                    ${skelLine('sm')}
                </div>
                <div style="width:60px;">${skelLine('sm')}</div>
            </div>`).join('')}
        </div>
    </div>`;
}

// ── Timesheet Skeleton ───────────────────────────────────────────────────────

export function renderTimesheetSkeleton() {
    ensurePageSkeletonStyles();
    return `
    <div class="skeleton-page">
        <!-- Stats Grid -->
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1rem;">
            ${Array.from({ length: 4 }, () => `
            <div class="skeleton-card" style="display:flex; align-items:center; gap:1rem;">
                ${skelCircle(40, 40)}
                <div style="flex:1;">
                    ${skelLine('sm')}
                    ${skelLine('lg')}
                </div>
            </div>`).join('')}
        </div>
        <!-- View Toggle -->
        <div style="display:flex; gap:0.5rem;">
            ${skelRect(80, 32)}
            ${skelRect(80, 32)}
        </div>
        <!-- Table -->
        <div class="skeleton-card">
            ${skelTableRowSkeleton(8, [100, 80, 80, 80, 80, 120])}
        </div>
    </div>`;
}

// ── Team Activities Skeleton ─────────────────────────────────────────────────

export function renderTeamActivitiesSkeleton() {
    ensurePageSkeletonStyles();
    return `
    <div class="skeleton-page">
        <!-- Filter Bar -->
        <div style="display:flex; gap:0.75rem; align-items:center;">
            ${skelRect(120, 32)}
            ${skelRect(120, 32)}
            ${skelRect(100, 32)}
            <div style="flex:1;"></div>
            ${skelRect(140, 32)}
        </div>
        <!-- Table -->
        <div class="skeleton-card">
            ${skelTableRowSkeleton(10, [100, 120, 80, 80, 200])}
        </div>
    </div>`;
}

// ── Birthday Calendar Skeleton ───────────────────────────────────────────────

export function renderBirthdayCalendarSkeleton() {
    ensurePageSkeletonStyles();
    return `
    <div class="skeleton-page">
        <!-- Month Nav -->
        <div style="display:flex; justify-content:space-between; align-items:center;">
            ${skelRect(32, 32)}
            ${skelLine('md')}
            ${skelRect(32, 32)}
        </div>
        <!-- Calendar Grid -->
        <div class="skeleton-card">
            <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:4px;">
                ${Array.from({ length: 7 }, () => `<div style="text-align:center;">${skelRect(24, 10)}</div>`).join('')}
                ${Array.from({ length: 35 }, () => `<div style="height:40px; display:flex; align-items:center; justify-content:center;">${skelCircle(8, 8)}</div>`).join('')}
            </div>
        </div>
        <!-- Birthday Cards -->
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:1rem;">
            ${Array.from({ length: 3 }, () => `
            <div class="skeleton-card" style="display:flex; align-items:center; gap:0.75rem;">
                ${skelCircle(48, 48)}
                <div style="flex:1;">
                    ${skelLine('md')}
                    ${skelLine('sm')}
                </div>
            </div>`).join('')}
        </div>
    </div>`;
}

// ── Salary Skeleton ──────────────────────────────────────────────────────────

export function renderSalarySkeleton() {
    ensurePageSkeletonStyles();
    return `
    <div class="skeleton-page">
        <!-- Month Selector -->
        <div style="display:flex; gap:0.75rem; align-items:center;">
            ${skelRect(140, 32)}
            ${skelRect(100, 32)}
        </div>
        <!-- Summary Cards -->
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:1rem;">
            ${Array.from({ length: 2 }, () => `
            <div class="skeleton-card" style="text-align:center;">
                ${skelLine('sm')}
                ${skelLine('lg')}
            </div>`).join('')}
        </div>
        <!-- Table -->
        <div class="skeleton-card">
            ${skelTableRowSkeleton(10, [140, 80, 80, 80, 80, 60])}
        </div>
    </div>`;
}

// ── Letter Pad Skeleton ──────────────────────────────────────────────────────

export function renderLetterPadSkeleton() {
    ensurePageSkeletonStyles();
    return `
    <div style="display:flex; gap:1rem; padding:1rem; height:calc(100vh - 80px);">
        <!-- Sidebar -->
        <div class="skeleton-card" style="width:240px; flex-shrink:0;">
            ${skelLine('md')}
            ${Array.from({ length: 4 }, () => `
            <div style="padding:0.6rem 0; border-bottom:1px solid #f1f5f9;">
                ${skelRect('100%', 60, 'border-radius:8px;')}
                ${skelLine('sm')}
            </div>`).join('')}
        </div>
        <!-- Editor -->
        <div class="skeleton-card" style="flex:1;">
            <div style="display:flex; gap:0.5rem; margin-bottom:1rem;">
                ${Array.from({ length: 3 }, () => skelRect(32, 32)).join('')}
            </div>
            ${Array.from({ length: 8 }, (_, i) => skelLine(i % 3 === 0 ? 'lg' : i % 2 === 0 ? 'md' : 'full')).join('')}
        </div>
    </div>`;
}

// ── Staff AI Memory Skeleton ─────────────────────────────────────────────────

export function renderStaffAiMemorySkeleton() {
    ensurePageSkeletonStyles();
    return `
    <div class="skeleton-page">
        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:center;">
            ${skelLine('md')}
            ${skelRect(140, 32)}
        </div>
        <!-- Memory Cards -->
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:1rem;">
            ${Array.from({ length: 4 }, () => `
            <div class="skeleton-card">
                <div style="display:flex; gap:0.5rem; margin-bottom:8px;">
                    ${skelRect(60, 20)}
                </div>
                ${skelLine('lg')}
                ${skelLine('md')}
                <div style="display:flex; gap:0.5rem; margin-top:8px;">
                    ${skelRect(50, 18)}
                    ${skelRect(50, 18)}
                    ${skelRect(50, 18)}
                </div>
            </div>`).join('')}
        </div>
        <!-- Activity Feed -->
        <div class="skeleton-card">
            ${skelLine('md')}
            ${skelTableRowSkeleton(5, [100, 140, 80, 160])}
        </div>
    </div>`;
}

// ── Route → Skeleton Map (used by router) ────────────────────────────────────

export const ROUTE_SKELETON_MAP = {
    'admin': renderAdminSkeleton,
    'master-sheet': renderMasterSheetSkeleton,
    'annual-plan': renderAnnualPlanSkeleton,
    'profile': renderProfileSkeleton,
    'minutes': renderMinutesSkeleton,
    'staff-directory': renderStaffDirectorySkeleton,
    'timesheet': renderTimesheetSkeleton,
    'team-activities': renderTeamActivitiesSkeleton,
    'birthday-calendar': renderBirthdayCalendarSkeleton,
    'salary': renderSalarySkeleton,
    'letter-pad': renderLetterPadSkeleton,
    'staff-ai-memory': renderStaffAiMemorySkeleton
};

export function showPageSkeleton(hash) {
    const fn = ROUTE_SKELETON_MAP[hash];
    return fn ? fn() : null;
}
