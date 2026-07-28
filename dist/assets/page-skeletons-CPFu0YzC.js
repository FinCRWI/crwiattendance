const a="background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%); background-size: 200% 100%; animation: skeleton-shimmer 1.5s infinite; border-radius: 8px;",m=`
@keyframes skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}
.skeleton-card { padding: 1.25rem; border-radius: 16px; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.skeleton-line { height: 14px; margin-bottom: 10px; ${a} }
.skeleton-line.sm { width: 40%; height: 10px; }
.skeleton-line.md { width: 65%; }
.skeleton-line.lg { width: 85%; }
.skeleton-line.full { width: 100%; }
.skeleton-circle { border-radius: 50%; ${a} }
.skeleton-rect { border-radius: 8px; ${a} }
.skeleton-page { padding: 1rem; display: grid; gap: 1rem; }
`;let o=!1;function d(){if(o)return;o=!0;const t=document.createElement("style");t.textContent=m,document.head.appendChild(t)}function e(t=""){return`<div class="skeleton-line ${t}"></div>`}function r(t,l,n=""){return`<div class="skeleton-circle" style="width:${t}px; height:${l}px; ${n}"></div>`}function i(t,l,n=""){return`<div class="skeleton-rect" style="width:${t}px; height:${l}px; ${n}"></div>`}function v(){return`<div class="skeleton-card" style="text-align:center;">
        ${r(40,40,"margin:0 auto 8px;")}
        ${e("md")}
        ${e("sm")}
    </div>`}function s(t,l){return Array.from({length:t},()=>`<div style="display:flex; align-items:center; gap:0.75rem; padding:0.5rem 0; border-bottom:1px solid #f1f5f9;">
            ${l.map(n=>i(n,14)).join("")}
        </div>`).join("")}function p(){return d(),`
    <div class="skeleton-page">
        <!-- Stat Cards -->
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:1rem;">
            ${Array.from({length:6},()=>v()).join("")}
        </div>
        <!-- Staff Table -->
        <div class="skeleton-card">
            ${e("md")}
            ${s(8,[180,100,80,80,60])}
        </div>
        <!-- Leave Requests -->
        <div class="skeleton-card">
            ${e("md")}
            ${s(3,[140,100,120,80])}
        </div>
        <!-- Compliance -->
        <div class="skeleton-card">
            ${e("md")}
            ${s(3,[160,100,100,80])}
        </div>
    </div>`}function g(){return d(),`
    <div class="skeleton-page">
        <!-- Toolbar -->
        <div style="display:flex; gap:1rem; align-items:center;">
            ${i(120,36)}
            ${i(80,36)}
            ${i(100,36)}
        </div>
        <!-- Grid Table -->
        <div class="skeleton-card" style="overflow-x:auto;">
            <div style="display:flex; gap:0.5rem; padding-bottom:0.5rem; border-bottom:2px solid #e2e8f0; min-width:900px;">
                <div style="width:140px; flex-shrink:0;">${e("lg")}</div>
                ${Array.from({length:15},()=>`<div style="width:48px; flex-shrink:0;">${i(44,14)}</div>`).join("")}
            </div>
            ${Array.from({length:10},()=>`
            <div style="display:flex; gap:0.5rem; padding:0.4rem 0; border-bottom:1px solid #f1f5f9; min-width:900px;">
                <div style="width:140px; flex-shrink:0;">${e("md")}</div>
                ${Array.from({length:15},()=>`<div style="width:48px; flex-shrink:0;">${i(32,14)}</div>`).join("")}
            </div>`).join("")}
        </div>
    </div>`}function c(){return d(),`
    <div class="skeleton-page">
        <!-- Toolbar -->
        <div style="display:flex; gap:0.75rem; align-items:center;">
            ${i(80,32)}
            ${i(80,32)}
            ${i(120,32)}
        </div>
        <!-- 12-Month Grid -->
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1rem;">
            ${Array.from({length:12},()=>`
            <div class="skeleton-card" style="padding:0.75rem;">
                ${e("sm")}
                <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:3px; margin-top:6px;">
                    ${Array.from({length:28},()=>i(16,16,"border-radius:4px;")).join("")}
                </div>
            </div>`).join("")}
        </div>
    </div>`}function f(){return d(),`
    <div class="skeleton-page">
        <!-- Hero Banner -->
        <div class="skeleton-card" style="display:flex; align-items:center; gap:1.5rem; padding:2rem;">
            ${r(72,72,"flex-shrink:0;")}
            <div style="flex:1;">
                ${e("lg")}
                ${e("md")}
                ${e("sm")}
            </div>
        </div>
        <!-- Stats Strip -->
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1rem;">
            ${Array.from({length:4},()=>`
            <div class="skeleton-card" style="text-align:center;">
                ${e("sm")}
                ${e("lg")}
            </div>`).join("")}
        </div>
        <!-- Leave History -->
        <div class="skeleton-card">
            ${e("md")}
            ${s(5,[140,100,120,80])}
        </div>
        <!-- Employment Details -->
        <div class="skeleton-card">
            ${e("md")}
            ${Array.from({length:4},()=>`
            <div style="display:flex; gap:1rem; padding:0.5rem 0; border-bottom:1px solid #f1f5f9;">
                <div style="width:120px;">${e("sm")}</div>
                <div style="flex:1;">${e("md")}</div>
            </div>`).join("")}
        </div>
    </div>`}function y(){return d(),`
    <div class="skeleton-page">
        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:center;">
            ${e("md")}
            ${i(120,36)}
        </div>
        <!-- Search -->
        <div>${i("100%",40)}</div>
        <!-- Card Grid -->
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:1rem;">
            ${Array.from({length:6},()=>`
            <div class="skeleton-card">
                ${e("sm")}
                ${e("lg")}
                <div style="display:flex; gap:0.5rem; margin-top:8px;">
                    ${r(24,24)}
                    ${r(24,24)}
                    ${r(24,24)}
                </div>
                <div style="margin-top:8px;">${i(60,20)}</div>
            </div>`).join("")}
        </div>
    </div>`}function $(){return d(),`
    <div style="display:flex; gap:1rem; padding:1rem; height:calc(100vh - 80px);">
        <!-- Sidebar -->
        <div class="skeleton-card" style="width:280px; flex-shrink:0; overflow:hidden;">
            ${e("md")}
            ${Array.from({length:8},()=>`
            <div style="display:flex; align-items:center; gap:0.75rem; padding:0.6rem 0; border-bottom:1px solid #f1f5f9;">
                ${r(36,36,"flex-shrink:0;")}
                <div style="flex:1;">
                    ${e("md")}
                    ${e("sm")}
                </div>
            </div>`).join("")}
        </div>
        <!-- Thread Panel -->
        <div class="skeleton-card" style="flex:1; overflow:hidden;">
            ${e("md")}
            ${Array.from({length:3},()=>`
            <div style="display:flex; align-items:flex-start; gap:0.75rem; padding:0.75rem 0; border-bottom:1px solid #f1f5f9;">
                ${r(40,40,"flex-shrink:0;")}
                <div style="flex:1;">
                    ${e("lg")}
                    ${e("md")}
                    ${e("sm")}
                </div>
                <div style="width:60px;">${e("sm")}</div>
            </div>`).join("")}
        </div>
    </div>`}function x(){return d(),`
    <div class="skeleton-page">
        <!-- Stats Grid -->
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1rem;">
            ${Array.from({length:4},()=>`
            <div class="skeleton-card" style="display:flex; align-items:center; gap:1rem;">
                ${r(40,40)}
                <div style="flex:1;">
                    ${e("sm")}
                    ${e("lg")}
                </div>
            </div>`).join("")}
        </div>
        <!-- View Toggle -->
        <div style="display:flex; gap:0.5rem;">
            ${i(80,32)}
            ${i(80,32)}
        </div>
        <!-- Table -->
        <div class="skeleton-card">
            ${s(8,[100,80,80,80,80,120])}
        </div>
    </div>`}function k(){return d(),`
    <div class="skeleton-page">
        <!-- Filter Bar -->
        <div style="display:flex; gap:0.75rem; align-items:center;">
            ${i(120,32)}
            ${i(120,32)}
            ${i(100,32)}
            <div style="flex:1;"></div>
            ${i(140,32)}
        </div>
        <!-- Table -->
        <div class="skeleton-card">
            ${s(10,[100,120,80,80,200])}
        </div>
    </div>`}function h(){return d(),`
    <div class="skeleton-page">
        <!-- Month Nav -->
        <div style="display:flex; justify-content:space-between; align-items:center;">
            ${i(32,32)}
            ${e("md")}
            ${i(32,32)}
        </div>
        <!-- Calendar Grid -->
        <div class="skeleton-card">
            <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:4px;">
                ${Array.from({length:7},()=>`<div style="text-align:center;">${i(24,10)}</div>`).join("")}
                ${Array.from({length:35},()=>`<div style="height:40px; display:flex; align-items:center; justify-content:center;">${r(8,8)}</div>`).join("")}
            </div>
        </div>
        <!-- Birthday Cards -->
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:1rem;">
            ${Array.from({length:3},()=>`
            <div class="skeleton-card" style="display:flex; align-items:center; gap:0.75rem;">
                ${r(48,48)}
                <div style="flex:1;">
                    ${e("md")}
                    ${e("sm")}
                </div>
            </div>`).join("")}
        </div>
    </div>`}function u(){return d(),`
    <div class="skeleton-page">
        <!-- Month Selector -->
        <div style="display:flex; gap:0.75rem; align-items:center;">
            ${i(140,32)}
            ${i(100,32)}
        </div>
        <!-- Summary Cards -->
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:1rem;">
            ${Array.from({length:2},()=>`
            <div class="skeleton-card" style="text-align:center;">
                ${e("sm")}
                ${e("lg")}
            </div>`).join("")}
        </div>
        <!-- Table -->
        <div class="skeleton-card">
            ${s(10,[140,80,80,80,80,60])}
        </div>
    </div>`}function b(){return d(),`
    <div style="display:flex; gap:1rem; padding:1rem; height:calc(100vh - 80px);">
        <!-- Sidebar -->
        <div class="skeleton-card" style="width:240px; flex-shrink:0;">
            ${e("md")}
            ${Array.from({length:4},()=>`
            <div style="padding:0.6rem 0; border-bottom:1px solid #f1f5f9;">
                ${i("100%",60,"border-radius:8px;")}
                ${e("sm")}
            </div>`).join("")}
        </div>
        <!-- Editor -->
        <div class="skeleton-card" style="flex:1;">
            <div style="display:flex; gap:0.5rem; margin-bottom:1rem;">
                ${Array.from({length:3},()=>i(32,32)).join("")}
            </div>
            ${Array.from({length:8},(t,l)=>e(l%3===0?"lg":l%2===0?"md":"full")).join("")}
        </div>
    </div>`}function S(){return d(),`
    <div class="skeleton-page">
        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:center;">
            ${e("md")}
            ${i(140,32)}
        </div>
        <!-- Memory Cards -->
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:1rem;">
            ${Array.from({length:4},()=>`
            <div class="skeleton-card">
                <div style="display:flex; gap:0.5rem; margin-bottom:8px;">
                    ${i(60,20)}
                </div>
                ${e("lg")}
                ${e("md")}
                <div style="display:flex; gap:0.5rem; margin-top:8px;">
                    ${i(50,18)}
                    ${i(50,18)}
                    ${i(50,18)}
                </div>
            </div>`).join("")}
        </div>
        <!-- Activity Feed -->
        <div class="skeleton-card">
            ${e("md")}
            ${s(5,[100,140,80,160])}
        </div>
    </div>`}const A={admin:p,"master-sheet":g,"annual-plan":c,profile:f,minutes:y,"staff-directory":$,timesheet:x,"team-activities":k,"birthday-calendar":h,salary:u,"letter-pad":b,"staff-ai-memory":S};function j(t){const l=A[t];return l?l():null}export{A as ROUTE_SKELETON_MAP,p as renderAdminSkeleton,c as renderAnnualPlanSkeleton,h as renderBirthdayCalendarSkeleton,b as renderLetterPadSkeleton,g as renderMasterSheetSkeleton,y as renderMinutesSkeleton,f as renderProfileSkeleton,u as renderSalarySkeleton,S as renderStaffAiMemorySkeleton,$ as renderStaffDirectorySkeleton,k as renderTeamActivitiesSkeleton,x as renderTimesheetSkeleton,j as showPageSkeleton};
