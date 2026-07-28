/**
 * Dashboard Skeleton Loading Components
 * Provides shimmer placeholder skeletons for dashboard cards during data fetch.
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
`;

let _skeletonStyleInjected = false;
function ensureSkeletonStyles() {
    if (_skeletonStyleInjected) return;
    _skeletonStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = SKELETON_KEYFRAMES;
    document.head.appendChild(style);
}

export function renderCheckinSkeleton() {
    ensureSkeletonStyles();
    return `
    <div class="skeleton-card" style="display:flex; align-items:center; gap:1rem; padding:1.5rem;">
        <div class="skeleton-circle" style="width:56px; height:56px; flex-shrink:0;"></div>
        <div style="flex:1;">
            <div class="skeleton-line lg"></div>
            <div class="skeleton-line sm"></div>
        </div>
        <div style="display:flex; gap:0.5rem;">
            <div class="skeleton-rect" style="width:80px; height:36px;"></div>
            <div class="skeleton-rect" style="width:80px; height:36px;"></div>
        </div>
    </div>`;
}

export function renderWorklogSkeleton() {
    ensureSkeletonStyles();
    return `
    <div class="skeleton-card">
        <div class="skeleton-line md" style="margin-bottom:16px;"></div>
        ${Array.from({ length: 4 }, () => `
        <div style="display:flex; align-items:center; gap:0.75rem; padding:0.6rem 0; border-bottom:1px solid #f1f5f9;">
            <div class="skeleton-circle" style="width:10px; height:10px; flex-shrink:0;"></div>
            <div style="flex:1;">
                <div class="skeleton-line full"></div>
                <div class="skeleton-line sm"></div>
            </div>
            <div class="skeleton-rect" style="width:60px; height:24px;"></div>
        </div>`).join('')}
    </div>`;
}

export function renderHeroSkeleton() {
    ensureSkeletonStyles();
    return `
    <div class="skeleton-card" style="text-align:center; padding:2rem;">
        <div class="skeleton-circle" style="width:72px; height:72px; margin:0 auto 1rem;"></div>
        <div class="skeleton-line md" style="margin:0 auto 8px;"></div>
        <div class="skeleton-line sm" style="margin:0 auto 16px;"></div>
        <div style="display:flex; justify-content:center; gap:1rem; margin-top:1rem;">
            ${Array.from({ length: 3 }, () => `<div class="skeleton-rect" style="width:80px; height:48px;"></div>`).join('')}
        </div>
    </div>`;
}

export function renderActivitySkeleton() {
    ensureSkeletonStyles();
    return `
    <div class="skeleton-card">
        <div class="skeleton-line md" style="margin-bottom:16px;"></div>
        ${Array.from({ length: 5 }, () => `
        <div style="display:flex; align-items:center; gap:0.75rem; padding:0.5rem 0; border-bottom:1px solid #f1f5f9;">
            <div class="skeleton-rect" style="width:10px; height:10px;"></div>
            <div style="flex:1;">
                <div class="skeleton-line lg"></div>
                <div class="skeleton-line sm"></div>
            </div>
            <div class="skeleton-line sm" style="width:50px;"></div>
        </div>`).join('')}
    </div>`;
}

export function renderLeaveSkeleton() {
    ensureSkeletonStyles();
    return `
    <div class="skeleton-card">
        <div class="skeleton-line md" style="margin-bottom:16px;"></div>
        ${Array.from({ length: 3 }, () => `
        <div style="padding:0.75rem 0; border-bottom:1px solid #f1f5f9;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div class="skeleton-line lg" style="width:50%; margin-bottom:6px;"></div>
                <div class="skeleton-rect" style="width:64px; height:22px;"></div>
            </div>
            <div class="skeleton-line sm"></div>
        </div>`).join('')}
    </div>`;
}

export function renderStatsSkeleton() {
    ensureSkeletonStyles();
    return `
    <div class="skeleton-card">
        <div class="skeleton-line md" style="margin-bottom:16px;"></div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            ${Array.from({ length: 6 }, () => `
            <div>
                <div class="skeleton-line sm" style="width:60%; margin-bottom:4px;"></div>
                <div class="skeleton-line" style="width:40%; height:20px;"></div>
            </div>`).join('')}
        </div>
    </div>`;
}

export function renderDashboardSkeletons() {
    ensureSkeletonStyles();
    return `
    <div style="display:grid; gap:1rem; padding:1rem;">
        ${renderCheckinSkeleton()}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
            ${renderWorklogSkeleton()}
            ${renderStatsSkeleton()}
        </div>
        ${renderHeroSkeleton()}
        ${renderActivitySkeleton()}
    </div>`;
}
