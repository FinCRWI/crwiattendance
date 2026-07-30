/**
 * Admin Panel Component
 * Handles rendering of the administrative dashboard, performance trends, and staff management.
 */

import { safeHtml } from './helpers.js';
import { AppConfig } from '../config.js';
import { SiteAnnouncement } from './site-announcement.js';
import { onAction } from '../utils/action-router.js';

let aiAssistantModulePromise = null;
async function getAIAssistant() {
    if (window.AppAIAssistant) return window.AppAIAssistant;
    if (!aiAssistantModulePromise) {
        aiAssistantModulePromise = import('../modules/ai-assistant.js').then((mod) => mod.AppAIAssistant || mod.default || window.AppAIAssistant);
    }
    return aiAssistantModulePromise;
}

const updateAdminAiWorkspace = (context = {}, sourceScope = '') => {
    window._adminAiContext = context || {};
    window._adminAiSourceScope = String(sourceScope || '').trim();
};

const buildAdminAiReportContext = ({
    auditStartDate,
    auditEndDate,
    allUsers = [],
    pendingLeaves = [],
    recentAttendanceLogs = [],
    recentTeamActivities = []
}) => {
    const usersById = new Map((Array.isArray(allUsers) ? allUsers : []).map((user) => [String(user.id), user]));
    const recentEntries = (Array.isArray(recentAttendanceLogs) ? recentAttendanceLogs : [])
        .filter((row) => row && row.entrySource === 'checkin_checkout');
    const toEntryTs = (row) => {
        const isoDate = String(row?.date || '').trim();
        const updatedAt = Date.parse(String(row?.updatedAt || row?.autoCheckoutAt || row?.missedCheckoutReviewedAt || ''));
        if (Number.isFinite(updatedAt)) return updatedAt;
        const dateTs = Date.parse(`${isoDate}T00:00:00`);
        return Number.isFinite(dateTs) ? dateTs : 0;
    };
    const attendanceIssues = recentEntries
        .filter((row) => String(row.budgetHeadId || '') === 'UNALLOCATED' || String(row.validationStatus || '').toLowerCase() !== 'compliant')
        .map((row) => ({
            ...row,
            sourceType: 'attendance',
            sourceLabel: 'Attendance',
            _issueKey: `att:${String(row.id || '')}`
        }));
    const teamActivityRows = (Array.isArray(recentTeamActivities) ? recentTeamActivities : [])
        .filter((row) => String(row.type || '').toLowerCase() === 'work')
        .map((row) => ({
            id: '',
            date: row.date || '',
            user_id: row.userId || row.user_id || '',
            budgetHeadId: row.budgetHeadId || 'UNALLOCATED',
            validationStatus: row.validationStatus || 'unknown',
            validationErrors: Array.isArray(row.validationErrors) ? row.validationErrors : [],
            budgetHeadUnallocatedReason: '',
            workDescription: row.description || row.task || '',
            planId: row.planId || '',
            taskIndex: Number.isInteger(row.taskIndex) ? row.taskIndex : null,
            sourceType: 'team_activity',
            sourceLabel: 'Team Activity',
            _issueKey: `wrk:${String(row.planId || '')}:${String(Number.isInteger(row.taskIndex) ? row.taskIndex : 'x')}:${String(row.date || '')}:${String(row.userId || row.user_id || '')}`
        }));
    const teamActivityIssues = teamActivityRows.filter((row) => {
        const budgetIssue = String(row.budgetHeadId || '') === 'UNALLOCATED';
        const validationStatus = String(row.validationStatus || '').toLowerCase();
        const validationIssue = validationStatus && validationStatus !== 'unknown' && validationStatus !== 'compliant';
        return budgetIssue || validationIssue;
    });
    const complianceIssues = [...attendanceIssues, ...teamActivityIssues]
        .sort((a, b) => toEntryTs(b) - toEntryTs(a));
    const staleUnallocated = recentEntries
        .filter((row) => String(row.budgetHeadId || '') === 'UNALLOCATED')
        .sort((a, b) => toEntryTs(b) - toEntryTs(a));
    const complianceReasonCounts = complianceIssues.reduce((acc, row) => {
        const errors = Array.isArray(row.validationErrors) ? row.validationErrors : [];
        if (String(row.budgetHeadId || '') === 'UNALLOCATED') {
            acc.budgetHead += 1;
        }
        if (String(row.validationStatus || '').toLowerCase() !== 'compliant') {
            acc.checkout += 1;
        }
        if (errors.length) {
            acc.errors += errors.length;
        }
        return acc;
    }, { budgetHead: 0, checkout: 0, errors: 0 });

    const sourceScope = `Admin report for ${auditStartDate} to ${auditEndDate} using attendance, leave, compliance, and team activity summaries`;

    return {
        sourceScope,
        context: {
            auditStartDate,
            auditEndDate,
            view: 'admin-report',
            sourceScope,
            metrics: {
                totalStaff: allUsers.length,
                activeStaff: allUsers.filter((u) => u.status === 'in').length,
                adminStaff: allUsers.filter((u) => u.role === 'Administrator' || u.isAdmin === true).length,
                pendingLeaves: pendingLeaves.length,
                openIssues: complianceIssues.length,
                staleUnallocated: staleUnallocated.length,
                recentAttendanceLogs: recentEntries.length,
                recentTeamActivities: teamActivityRows.length
            },
            highlights: [
                `Open issues: ${complianceIssues.length}`,
                `Budget mapping issues: ${complianceReasonCounts.budgetHead}`,
                `Checkout validation issues: ${complianceReasonCounts.checkout}`,
                `Aged 2+ days: ${staleUnallocated.length}`
            ],
            exceptions: complianceIssues.slice(0, 10).map((row) => ({
                date: row.date || '',
                staffName: usersById.get(String(row.user_id || row.userId || ''))?.name || row.staffName || 'Staff',
                sourceLabel: row.sourceLabel || 'Source',
                budgetHeadId: row.budgetHeadId || 'UNALLOCATED',
                validationStatus: row.validationStatus || 'unknown',
                summary: String(row.budgetHeadUnallocatedReason || (Array.isArray(row.validationErrors) ? row.validationErrors.join(' | ') : '') || row.workDescription || 'No summary').slice(0, 180)
            })),
            sampleRows: [
                ...recentEntries.slice(0, 6).map((row) => ({
                    date: row.date || '',
                    staffName: usersById.get(String(row.user_id || row.userId || ''))?.name || row.staffName || 'Staff',
                    sourceLabel: row.sourceLabel || 'Attendance',
                    budgetHeadId: row.budgetHeadId || 'UNALLOCATED',
                    validationStatus: row.validationStatus || 'unknown',
                    summary: String(row.workDescription || row.location || 'Attendance entry').slice(0, 160)
                })),
                ...teamActivityRows.slice(0, 6).map((row) => ({
                    date: row.date || '',
                    staffName: usersById.get(String(row.user_id || row.userId || ''))?.name || row.staffName || 'Staff',
                    sourceLabel: row.sourceLabel || 'Team Activity',
                    budgetHeadId: row.budgetHeadId || 'UNALLOCATED',
                    validationStatus: row.validationStatus || 'unknown',
                    summary: String(row.workDescription || 'Team activity').slice(0, 160)
                }))
            ]
        }
    };
};

const renderAdminAiNarrationPanel = ({
    sourceScope,
    compact = true,
    title = 'Report Narration',
    copy = 'Generate an editable summary from the current admin filter scope.'
}) => `
    <div class="admin-ai-panel${compact ? '' : ' admin-ai-panel-expanded'}">
        <div class="admin-ai-panel-head">
            <div>
                <span class="admin-ai-kicker">Privacy-first summary</span>
                <h4 class="admin-ai-title">${safeHtml(title)}</h4>
                <p class="admin-ai-copy">${safeHtml(copy)}</p>
            </div>
        </div>
        <div class="admin-ai-controls">
            <select id="admin-ai-action" class="admin-ai-select">
                <option value="summary" selected>Attendance summary</option>
                <option value="exceptions">Exception analysis</option>
                <option value="executive">Executive narration</option>
            </select>
            <button type="button" id="admin-ai-run-btn" class="action-btn secondary" data-ts-action="admin-request-ai-summary">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Summarize with AI
            </button>
        </div>
        <textarea id="admin-ai-note" class="admin-ai-note" rows="${compact ? 3 : 4}" placeholder="Optional focus, for example: highlight budget issues and next steps."></textarea>
        <div id="admin-ai-output" class="admin-ai-output">AI summaries will appear here after you click the button.</div>
        <div class="admin-ai-source-inline"><strong>Source Scope:</strong> ${safeHtml(sourceScope || 'Unknown')}</div>
    </div>
`;

if (typeof window !== 'undefined' && !window.app_requestAdminAiSummary) {
    window.app_requestAdminAiSummary = async function () {
        const output = document.getElementById('admin-ai-output');
        const button = document.getElementById('admin-ai-run-btn');
        const actionSelect = document.getElementById('admin-ai-action');
        const noteInput = document.getElementById('admin-ai-note');
        const action = String(actionSelect?.value || 'summary');
        const note = String(noteInput?.value || '').trim();
        const sourceScope = String(window._adminAiSourceScope || '').trim();
        if (output) output.textContent = 'Contacting AI assistant...';
        if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Summarizing...';
        }
        try {
            const aiAssistant = await getAIAssistant();
            if (!aiAssistant?.requestAssistant) {
                if (output) output.textContent = 'No AI suggestions available, please draft manually.';
                return;
            }
            const result = await aiAssistant.requestAssistant({
                mode: 'admin-report',
                context: {
                    ...(window._adminAiContext || {}),
                    action,
                    promptHint: note,
                    notes: 'Admin summaries must reference the source scope and remain privacy-first.'
                },
                user: window.AppAuth?.getUser?.() || null,
                sourceScope
            });
            if (output) {
                output.innerHTML = `
                    <div class="admin-ai-summary-line"><strong>Summary:</strong> ${safeHtml(result.summary || '')}</div>
                    ${Array.isArray(result.suggestedActions) && result.suggestedActions.length ? `<ul class="admin-ai-action-list">${result.suggestedActions.map((item) => `<li>${safeHtml(item)}</li>`).join('')}</ul>` : ''}
                    ${Array.isArray(result.warnings) && result.warnings.length ? `<div class="admin-ai-warnings">${safeHtml(result.warnings.join(' | '))}</div>` : ''}
                    <div class="admin-ai-source"><strong>Source Scope:</strong> ${safeHtml(result.sourceScope || sourceScope || 'Unknown')}</div>
                `;
            }
        } catch (err) {
            console.warn('Admin AI summary failed:', err);
            if (output) output.textContent = 'No AI suggestions available, please draft manually.';
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Summarize with AI';
            }
        }
    };
}

if (typeof window !== 'undefined' && !window.app_openStaffAiMemorySheet) {
    window.app_openStaffAiMemorySheet = () => {
        window.location.hash = 'staff-ai-memory';
    };
}

const ADMIN_MAX_OVERLAY_ID = 'admin-card-max-overlay';
const ADMIN_MAX_TITLE_ID = 'admin-card-max-title';
const ADMIN_MAX_BODY_ID = 'admin-card-max-body';
const ADMIN_CARD_MODE_TILE = 'tile';
const ADMIN_CARD_MODE_ORIGINAL = 'original';
const ADMIN_CARD_MODE_FULLSCREEN = 'fullscreen';
const ADMIN_CARD_MODES = new Set([ADMIN_CARD_MODE_TILE, ADMIN_CARD_MODE_ORIGINAL, ADMIN_CARD_MODE_FULLSCREEN]);

const ensureAdminMaxOverlay = () => {
    let overlay = document.getElementById(ADMIN_MAX_OVERLAY_ID);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = ADMIN_MAX_OVERLAY_ID;
        overlay.className = 'admin-max-overlay';
        overlay.innerHTML = `
            <div class="admin-max-window" role="dialog" aria-modal="true" aria-labelledby="${ADMIN_MAX_TITLE_ID}">
                <div class="admin-max-header">
                    <h2 id="${ADMIN_MAX_TITLE_ID}"></h2>
                    <button type="button" class="admin-max-close" data-ts-action="admin-close-maximize" aria-label="Close maximized card">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div id="${ADMIN_MAX_BODY_ID}" class="admin-max-body"></div>
            </div>
        `;
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                window.app_closeAdminCardMaximize?.();
            }
        });
        document.body.appendChild(overlay);
    }

    if (!window.__adminMaxKeyHandlerBound) {
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && document.body.classList.contains('admin-max-open')) {
                window.app_closeAdminCardMaximize?.();
            }
        });
        window.__adminMaxKeyHandlerBound = true;
    }

    return overlay;
};

const setAdminBodyScrollLock = (isLocked) => {
    if (!document?.body) return;
    document.body.classList.toggle('admin-max-open', !!isLocked);
};

const closeAdminMaxOverlay = () => {
    const closingCardId = window._adminMaxCardId ? String(window._adminMaxCardId) : '';
    const overlay = document.getElementById(ADMIN_MAX_OVERLAY_ID);
    if (overlay) {
        overlay.classList.remove('open');
        overlay.remove();
    }

    const body = document.getElementById(ADMIN_MAX_BODY_ID);
    if (body) body.innerHTML = '';

    setAdminBodyScrollLock(false);

    const trigger = window._adminMaxTriggerEl;
    window._adminMaxTriggerEl = null;
    window._adminMaxCardId = null;
    if (closingCardId) {
        const cardEl = getAdminCardElementById(closingCardId);
        if (cardEl) {
            setAdminCardModeClass(cardEl, ADMIN_CARD_MODE_TILE);
            cardEl.dataset.adminCardMode = ADMIN_CARD_MODE_TILE;
        }
        if (window._adminCardModeState) {
            window._adminCardModeState[closingCardId] = ADMIN_CARD_MODE_TILE;
        }
    }
    if (trigger && typeof trigger.focus === 'function') {
        try { trigger.focus(); } catch { /* ignore */ }
    }
};

const openAdminMaxOverlay = (cardId, triggerEl = null) => {
    closeAdminMaxOverlay();
    const templates = window._adminCardTemplates || {};
    const template = templates[cardId];
    if (!template) return;

    const overlay = ensureAdminMaxOverlay();
    const titleEl = document.getElementById(ADMIN_MAX_TITLE_ID);
    const bodyEl = document.getElementById(ADMIN_MAX_BODY_ID);
    if (!titleEl || !bodyEl) return;

    titleEl.textContent = template.title || 'Admin Card';
    bodyEl.innerHTML = `<div class="admin-max-card-content" data-admin-card-max="${safeHtml(cardId)}">${template.expandedHtml || template.originalHtml || template.tileHtml || ''}</div>`;

    window._adminMaxTriggerEl = triggerEl;
    window._adminMaxCardId = cardId;

    setAdminBodyScrollLock(true);
    overlay.classList.add('open');

    const closeBtn = overlay.querySelector('.admin-max-close');
    if (closeBtn) {
        try { closeBtn.focus(); } catch { /* ignore */ }
    }
};

const getAdminCardElementById = (cardId) => {
    if (!cardId) return null;
    return document.querySelector(`.dashboard-admin-view .admin-card-compact[data-admin-card="${cardId}"]`);
};

const setAdminCardModeClass = (cardEl, mode) => {
    if (!cardEl) return;
    cardEl.classList.remove('admin-card-mode-tile', 'admin-card-mode-original');
    if (mode === ADMIN_CARD_MODE_ORIGINAL) {
        cardEl.classList.add('admin-card-mode-original');
        if (cardEl.dataset.adminOriginalFullWidth === '1') {
            cardEl.classList.add('full-width');
        }
    } else {
        cardEl.classList.add('admin-card-mode-tile');
        cardEl.classList.remove('full-width');
    }
};

const applyAdminCardMode = (cardId, mode, triggerEl = null) => {
    if (!ADMIN_CARD_MODES.has(mode)) return;
    const cards = document.querySelectorAll('.dashboard-admin-view .admin-card-compact[data-admin-card]');
    if (!cards.length) return;
    cards.forEach((card) => {
        const isTarget = card.getAttribute('data-admin-card') === String(cardId);
        const nextMode = isTarget ? mode : ADMIN_CARD_MODE_TILE;
        setAdminCardModeClass(card, nextMode);
        card.dataset.adminCardMode = nextMode;
    });
    window._adminCardModeState = window._adminCardModeState || {};
    window._adminCardModeState[cardId] = mode;
    window._adminActiveCardModeId = cardId;
    if (mode === ADMIN_CARD_MODE_FULLSCREEN) {
        openAdminMaxOverlay(cardId, triggerEl || getAdminCardElementById(cardId));
    } else {
        closeAdminMaxOverlay();
    }
};

const buildAdminOriginalTemplate = (compactHtml) => {
    return String(compactHtml || '')
        .replace(/<div[^>]*class="[^"]*admin-card-mode-controls[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
};

if (typeof window !== 'undefined') {
    window.app_closeAdminCardFullscreen = closeAdminMaxOverlay;
    window.app_closeAdminCardMaximize = closeAdminMaxOverlay;
    window.app_toggleAdminCardMode = (cardId, mode = ADMIN_CARD_MODE_TILE, triggerEl = null) => {
        if (!cardId) return;
        const safeMode = ADMIN_CARD_MODES.has(mode) ? mode : ADMIN_CARD_MODE_TILE;
        const cardEl = getAdminCardElementById(cardId);
        const currentMode = String(cardEl?.dataset?.adminCardMode || ADMIN_CARD_MODE_TILE);
        if (currentMode === safeMode && safeMode !== ADMIN_CARD_MODE_TILE) {
            applyAdminCardMode(cardId, ADMIN_CARD_MODE_TILE, triggerEl || null);
            return;
        }
        if (safeMode === ADMIN_CARD_MODE_FULLSCREEN && window._adminMaxCardId === cardId) {
            closeAdminMaxOverlay();
            applyAdminCardMode(cardId, ADMIN_CARD_MODE_TILE);
            return;
        }
        applyAdminCardMode(cardId, safeMode, triggerEl || null);
    };
    window.app_toggleAdminCardMaximize = (cardId, triggerEl = null) => {
        window.app_toggleAdminCardMode?.(cardId, ADMIN_CARD_MODE_FULLSCREEN, triggerEl || null);
    };

    // Register admin actions with shared router (once).
    if (!window._adminActionRegistered) {
        window._adminActionRegistered = true;

        // Simple window function calls
        onAction('admin-request-ai-summary', () => window.app_requestAdminAiSummary?.());
        onAction('admin-close-maximize', () => window.app_closeAdminCardMaximize?.());
        onAction('open-staff-ai-memory', () => window.app_openStaffAiMemorySheet?.());
        onAction('refresh-staff-ai-memory', () => window.app_refreshStaffAiMemorySheet?.());

        // Navigation
        onAction('hash-navigate', (el) => {
            const hash = el.dataset.hash || '';
            if (hash) window.location.hash = hash;
        });

        // Show modal
        onAction('show-modal', (el) => {
            const id = el.dataset.target || '';
            if (id) document.getElementById(id).style.display = 'flex';
        });

        // Backup / Reset data (with ternary safety checks already handled in template)
        onAction('backup-staff-data', () => {
            if (typeof window.app_backupStaffData === 'function') window.app_backupStaffData();
            else alert('Backup tools are not loaded yet. Please refresh this page.');
        });
        onAction('backup-staff-data-csv', () => {
            if (typeof window.app_backupStaffDataCSV === 'function') window.app_backupStaffDataCSV();
            else alert('Backup tools are not loaded yet. Please refresh this page.');
        });
        onAction('reset-staff-data', (el) => {
            if (typeof window.app_resetStaffData === 'function') {
                const startId = el.dataset.startId || 'staff-reset-start-date';
                const endId = el.dataset.endId || 'staff-reset-end-date';
                window.app_resetStaffData({
                    startDate: document.getElementById(startId)?.value || '',
                    endDate: document.getElementById(endId)?.value || ''
                });
            } else {
                alert('Reset tools are not loaded yet. Please refresh this page.');
            }
        });
        onAction('apply-audit-filter', (el) => {
            const startId = el.dataset.startId || 'audit-start';
            const endId = el.dataset.endId || 'audit-end';
            window.app_applyAuditFilter?.(
                document.getElementById(startId)?.value || '',
                document.getElementById(endId)?.value || ''
            );
        });

        // Functions with data attribute args
        onAction('view-logs', (el) => window.app_viewLogs?.(el.dataset.userId || ''));
        onAction('edit-user', (el) => window.app_editUser?.(el.dataset.userId || ''));
        onAction('undo-leave', (el) => window.app_undoLeaveDecision?.(el.dataset.leaveId || ''));
        onAction('approve-leave', (el) => window.app_approveLeave?.(el.dataset.leaveId || ''));
        onAction('reject-leave', (el) => window.app_rejectLeave?.(el.dataset.leaveId || ''));
        onAction('save-budget-head', (el) => window.app_saveBudgetHeadRow?.(el.dataset.budgetHeadId || '', el));
        onAction('prefill-budget-parent', (el) => window.app_prefillBudgetHeadParent?.(el.dataset.budgetHeadId || ''));

        // Complex handlers
        onAction('undo-missed-checkout-review', (el) => {
            window.app_undoMissedCheckoutReview?.(el.dataset.notificationId || '');
        });
        onAction('review-missed-checkout', (el) => {
            window.app_reviewMissedCheckoutReasonFromNotification?.(
                -1,
                el.dataset.notificationId || '',
                el.dataset.reviewAction || 'approved'
            );
        });
        onAction('apply-audit-filter', () => {
            window.app_applyAuditFilter?.(
                document.getElementById('audit-start')?.value || '',
                document.getElementById('audit-end')?.value || ''
            );
        });
        onAction('export-compliance-csv', () => {
            window.AppReports?.exportComplianceExceptionsCSV?.({ days: 31, unresolvedOnly: true });
        });
        onAction('assign-budget-team-task', (el) => {
            window.app_assignBudgetHeadToTeamTask?.(el.dataset.planId || '', el.dataset.taskIndex, el);
        });
        onAction('assign-budget-attendance', (el) => {
            window.app_assignBudgetHeadToAttendance?.(el.dataset.attendanceId || '', el);
        });

        // Card mode toggles
        onAction('admin-toggle-card-mode', (el) => window.app_toggleAdminCardMode?.(el.dataset.cardId || '', el.dataset.mode || 'tile', el));
    }
}

export async function renderAdmin(auditStartDate = null, auditEndDate = null) {
    let allUsers = [];
    let allLeaves = [];
    let pendingLeaves = [];
    let attendanceLogs = [];
    let pendingNotifications = [];
    let reviewedNotifications = [];
    let currentAdmin = null;
    let audits = [];
    let simulationCleanupAudits = [];
    let budgetHeads = [];
    let recentAttendanceLogs = [];
    let recentTeamActivities = [];

    try {
        const today = new Date().toISOString().split('T')[0];
        auditStartDate = auditStartDate || today;
        auditEndDate = auditEndDate || today;

        const results = await Promise.allSettled([
            window.AppDB.getCached
                ? window.AppDB.getCached(window.AppDB.getCacheKey('adminUsers', 'users', {}), (AppConfig?.READ_CACHE_TTLS?.users || 60000), () => window.AppDB.getAll('users'))
                : window.AppDB.getAll('users'),
            window.AppAnalytics.getSystemPerformance(),
            window.AppDB.queryMany
                ? window.AppDB.queryMany('location_audits', [], { orderBy: [{ field: 'timestamp', direction: 'desc' }], limit: 300 }).catch(() => window.AppDB.getAll('location_audits'))
                : window.AppDB.getAll('location_audits'),
            window.AppLeaves.getAllLeaves ? window.AppLeaves.getAllLeaves() : window.AppDB.getAll('leaves'),
            window.AppLeaves.getPendingLeaves(),
            window.AppDB.queryMany
                ? window.AppDB.queryMany('system_audit_logs', [], { orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 80 }).catch(() => window.AppDB.getAll('system_audit_logs'))
                : window.AppDB.getAll('system_audit_logs'),
            window.AppDB.getAll('budget_heads').catch(() => []),
            window.AppDB.queryMany
                ? (() => {
                    const from = new Date();
                    from.setDate(from.getDate() - 60);
                    const fromIso = from.toISOString().split('T')[0];
                    return window.AppDB.queryMany('attendance', [{ field: 'date', operator: '>=', value: fromIso }]).catch(() => window.AppDB.getAll('attendance'));
                })()
                : window.AppDB.getAll('attendance'),
            window.AppAnalytics?.getAllStaffActivities
                ? (() => {
                    const from = new Date();
                    from.setDate(from.getDate() - 60);
                    const fromIso = from.toISOString().split('T')[0];
                    const toIso = new Date().toISOString().split('T')[0];
                    return window.AppAnalytics.getAllStaffActivities({
                        mode: 'range',
                        startIso: fromIso,
                        endIso: toIso,
                        scope: 'work',
                        sideEffects: false
                    }).catch(() => []);
                })()
                : Promise.resolve([])
        ]);

        const readSettled = (idx, fallback, label) => {
            const result = results[idx];
            if (result && result.status === 'fulfilled') return result.value;
            if (result && result.status === 'rejected') {
                console.warn(`Admin data fetch failed for ${label}:`, result.reason);
            }
            return fallback;
        };

        allUsers = readSettled(0, [], 'users');
        readSettled(1, { avgScore: 0, trendData: [0, 0, 0, 0, 0, 0, 0], labels: [] }, 'performance');
        audits = readSettled(2, [], 'location_audits');
        allLeaves = readSettled(3, [], 'all_leaves');
        pendingLeaves = readSettled(4, [], 'pending_leaves');
        simulationCleanupAudits = readSettled(5, [], 'system_audit_logs');
        budgetHeads = readSettled(6, [], 'budget_heads');
        recentAttendanceLogs = readSettled(7, [], 'recent_attendance');
        recentTeamActivities = readSettled(8, [], 'recent_team_activities');

        audits = audits.filter(a => {
            const d = new Date(a.timestamp).toISOString().split('T')[0];
            return d >= auditStartDate && d <= auditEndDate;
        }).sort((a, b) => b.timestamp - a.timestamp);

        simulationCleanupAudits = (simulationCleanupAudits || [])
            .filter((row) => row && row.module === 'simulation' && String(row.type || '').startsWith('legacy_dummy_cleanup_'))
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
            .slice(0, 25);

        const currentUser = window.AppAuth?.getUser?.();
        currentAdmin = currentUser ? allUsers.find((user) => String(user.id) === String(currentUser.id)) || currentUser : null;
        pendingNotifications = (Array.isArray(currentAdmin?.notifications) ? currentAdmin.notifications : [])
            .filter((notif) =>
                notif
                && notif.type === 'missed-checkout-reason'
                && String(notif.status || 'pending').toLowerCase() === 'pending'
                && notif.logId);
        reviewedNotifications = (Array.isArray(currentAdmin?.notifications) ? currentAdmin.notifications : [])
            .filter((notif) =>
                notif
                && notif.type === 'missed-checkout-reason'
                && ['approved', 'rejected'].includes(String(notif.status || '').toLowerCase())
                && notif.logId);
        const reviewLogIds = Array.from(new Set(
            [...pendingNotifications, ...reviewedNotifications].map((notif) => String(notif.logId || '')).filter(Boolean)
        ));

        attendanceLogs = reviewLogIds.length
            ? (window.AppDB.getManyByIds
                ? await window.AppDB.getManyByIds('attendance', reviewLogIds)
                : (await Promise.all(reviewLogIds.map((id) => window.AppDB.get('attendance', id)))).filter(Boolean))
            : [];
    } catch (e) {
        console.error('Failed to fetch admin data', e);
    }

    const activeCount = allUsers.filter(u => u.status === 'in').length;
    const adminCount = allUsers.filter(u => u.role === 'Administrator' || u.isAdmin === true).length;
    const birthdayManagedCount = allUsers.filter(u => Number(u.birthMonth || 0) >= 1 && Number(u.birthDay || 0) >= 1).length;
    const upcomingBirthdayUsers = [...allUsers]
        .filter(u => Number(u.birthMonth || 0) >= 1)
        .sort((a, b) => {
            const aKey = `${String(Number(a.birthMonth || 99)).padStart(2, '0')}-${String(Number(a.birthDay || 99)).padStart(2, '0')}-${String(a.name || '').toLowerCase()}`;
            const bKey = `${String(Number(b.birthMonth || 99)).padStart(2, '0')}-${String(Number(b.birthDay || 99)).padStart(2, '0')}-${String(b.name || '').toLowerCase()}`;
            return aKey.localeCompare(bKey);
        })
        .slice(0, 5);
    const usersById = new Map(allUsers.map((user) => [String(user.id), user]));
    const budgetHeadsSorted = (Array.isArray(budgetHeads) ? budgetHeads : [])
        .filter((head) => head && head.id)
        .sort((a, b) => String(a.code || a.id).localeCompare(String(b.code || b.id)));
    const budgetHeadsTreeOrdered = (() => {
        const byParent = new Map();
        budgetHeadsSorted.forEach((head) => {
            const parentId = String(head.parentId || '').trim();
            if (!byParent.has(parentId)) byParent.set(parentId, []);
            byParent.get(parentId).push(head);
        });
        byParent.forEach((list) => list.sort((a, b) => String(a.code || a.id).localeCompare(String(b.code || b.id))));
        const out = [];
        const visit = (parentId, depth, trail = new Set()) => {
            const children = byParent.get(parentId) || [];
            for (const child of children) {
                const id = String(child.id || '');
                if (!id || trail.has(id)) continue;
                out.push({ ...child, depth });
                const nextTrail = new Set(trail);
                nextTrail.add(id);
                visit(id, depth + 1, nextTrail);
            }
        };
        visit('', 0);
        budgetHeadsSorted.forEach((head) => {
            if (!out.some((row) => row.id === head.id)) out.push({ ...head, depth: 0 });
        });
        return out;
    })();
    const budgetHeadsParentSelectOptions = budgetHeadsTreeOrdered
        .filter((head) => String(head.id || '') !== 'UNALLOCATED')
        .map((head) => {
            const indent = Number(head.depth || 0) > 0 ? `${'&nbsp;&nbsp;'.repeat(Number(head.depth || 0))}↳ ` : '';
            return `<option value="${safeHtml(String(head.id || ''))}">${indent}${safeHtml(String(head.code || head.id || ''))} - ${safeHtml(String(head.name || ''))}</option>`;
        }).join('');
    const recentEntries = (Array.isArray(recentAttendanceLogs) ? recentAttendanceLogs : [])
        .filter((row) => row && row.entrySource === 'checkin_checkout');
    const toEntryTs = (row) => {
        const isoDate = String(row?.date || '').trim();
        const updatedAt = Date.parse(String(row?.updatedAt || row?.autoCheckoutAt || row?.missedCheckoutReviewedAt || ''));
        if (Number.isFinite(updatedAt)) return updatedAt;
        const dateTs = Date.parse(`${isoDate}T00:00:00`);
        return Number.isFinite(dateTs) ? dateTs : 0;
    };
    const unallocatedEntries = recentEntries
        .filter((row) => String(row.budgetHeadId || '') === 'UNALLOCATED')
        .sort((a, b) => toEntryTs(b) - toEntryTs(a));
    const attendanceIssues = recentEntries
        .filter((row) => String(row.budgetHeadId || '') === 'UNALLOCATED' || String(row.validationStatus || '').toLowerCase() !== 'compliant')
        .map((row) => ({
            ...row,
            sourceType: 'attendance',
            sourceLabel: 'Attendance',
            _issueKey: `att:${String(row.id || '')}`
        }));
    const teamActivityRows = (Array.isArray(recentTeamActivities) ? recentTeamActivities : [])
        .filter((row) => String(row.type || '').toLowerCase() === 'work')
        .map((row) => ({
            id: '',
            date: row.date || '',
            user_id: row.userId || row.user_id || '',
            budgetHeadId: row.budgetHeadId || 'UNALLOCATED',
            validationStatus: row.validationStatus || 'unknown',
            validationErrors: Array.isArray(row.validationErrors) ? row.validationErrors : [],
            budgetHeadUnallocatedReason: '',
            workDescription: row.description || row.task || '',
            planId: row.planId || '',
            taskIndex: Number.isInteger(row.taskIndex) ? row.taskIndex : null,
            sourceType: 'team_activity',
            sourceLabel: 'Team Activity',
            _issueKey: `wrk:${String(row.planId || '')}:${String(Number.isInteger(row.taskIndex) ? row.taskIndex : 'x')}:${String(row.date || '')}:${String(row.userId || row.user_id || '')}`
        }));
    const teamActivityIssues = teamActivityRows.filter((row) => {
            const budgetIssue = String(row.budgetHeadId || '') === 'UNALLOCATED';
            const validationStatus = String(row.validationStatus || '').toLowerCase();
            const validationIssue = validationStatus && validationStatus !== 'unknown' && validationStatus !== 'compliant';
            return budgetIssue || validationIssue;
        });
    const complianceIssues = [...attendanceIssues, ...teamActivityIssues]
        .sort((a, b) => toEntryTs(b) - toEntryTs(a));
    const complianceReasonCounts = complianceIssues.reduce((acc, row) => {
        const errors = Array.isArray(row.validationErrors) ? row.validationErrors : [];
        const hasBudgetIssue = String(row.budgetHeadId || '') === 'UNALLOCATED' || errors.some((msg) => String(msg || '').toLowerCase().includes('budget'));
        const hasCheckoutIssue = errors.some((msg) => String(msg || '').toLowerCase().includes('checkout'));
        if (hasBudgetIssue) acc.budgetHead += 1;
        if (hasCheckoutIssue) acc.checkout += 1;
        if (!hasBudgetIssue && !hasCheckoutIssue) acc.other += 1;
        return acc;
    }, { budgetHead: 0, checkout: 0, other: 0 });
    const staleUnallocated = unallocatedEntries.filter((row) => {
        const dt = new Date(`${String(row.date || '')}T00:00:00`);
        if (Number.isNaN(dt.getTime())) return false;
        const ageDays = Math.floor((Date.now() - dt.getTime()) / 86400000);
        return ageDays >= 2;
    });
    const attendanceLogsById = new Map((attendanceLogs || []).filter(Boolean).map((log) => [String(log.id || ''), log]));
    const missedCheckoutItems = pendingNotifications
        .map((notif) => {
            const log = attendanceLogsById.get(String(notif.logId || '')) || null;
            const staffId = String(notif.staffId || notif.taggedById || log?.user_id || log?.userId || '');
            const staff = usersById.get(staffId);
            return {
                ...(log || {}),
                staffName: notif.staffName || staff?.name || 'Staff',
                staffRole: staff?.role || 'Employee',
                notificationId: notif.id || '',
                user_id: log?.user_id || log?.userId || staffId,
                date: log?.date || notif.missedCheckoutDate || notif.date || '',
                missedCheckoutReason: log?.missedCheckoutReason || notif.missedCheckoutReason || '',
                missedCheckoutReasonSubmittedAt: log?.missedCheckoutReasonSubmittedAt || notif.missedCheckoutReasonSubmittedAt || notif.date || '',
                missedCheckoutReasonStatus: String(log?.missedCheckoutReasonStatus || notif.status || 'pending').toLowerCase(),
                missedCheckoutReasonRequired: log?.missedCheckoutReasonRequired !== false
            };
        })
        .filter((item) =>
            item
            && item.notificationId
            && item.missedCheckoutReasonRequired
            && item.missedCheckoutReasonSubmittedAt
            && String(item.missedCheckoutReasonStatus || '').toLowerCase() === 'pending')
        .sort((a, b) => new Date(b.missedCheckoutReasonSubmittedAt || b.systemClosedAt || b.date || 0) - new Date(a.missedCheckoutReasonSubmittedAt || a.systemClosedAt || a.date || 0));
    const reviewedMissedCheckoutItems = reviewedNotifications
        .map((notif) => {
            const log = attendanceLogsById.get(String(notif.logId || '')) || null;
            const staffId = String(notif.staffId || notif.taggedById || log?.user_id || log?.userId || '');
            const staff = usersById.get(staffId);
            return {
                ...(log || {}),
                staffName: notif.staffName || staff?.name || 'Staff',
                staffRole: staff?.role || 'Employee',
                notificationId: notif.id || '',
                date: log?.date || notif.missedCheckoutDate || notif.date || '',
                reviewStatus: String(notif.status || log?.missedCheckoutReasonStatus || '').trim() || 'pending',
                reviewNote: String(log?.missedCheckoutReviewNote || notif.reviewNote || '').trim(),
                reviewedAt: log?.missedCheckoutReviewedAt || notif.respondedAt || notif.date || ''
            };
        })
        .sort((a, b) => new Date(b.reviewedAt || b.date || 0) - new Date(a.reviewedAt || a.date || 0))
        .slice(0, 12);
    const reviewedLeaveItems = (allLeaves || [])
        .filter((leave) => ['approved', 'rejected'].includes(String(leave?.status || '').toLowerCase()))
        .sort((a, b) => new Date(b.actionDate || b.appliedOn || 0) - new Date(a.actionDate || a.appliedOn || 0))
        .slice(0, 12);

    const formatCleanupSummary = (row) => {
        const payload = row && row.payload ? row.payload : {};
        const deleted = payload.deleted || {};
        const configuredTargets = payload.configuredTargets || {};

        if (row.type === 'legacy_dummy_cleanup_completed') {
            return [
                `users=${Number(deleted.users || 0)}`,
                `attendance=${Number(deleted.attendance || 0)}`,
                `leaves=${Number(deleted.leaves || 0)}`,
                `workPlans=${Number(deleted.workPlans || 0)}`
            ].join(', ');
        }

        if (row.type === 'legacy_dummy_cleanup_skipped') {
            const reason = payload.reason || 'unknown';
            const ids = Array.isArray(configuredTargets.ids) ? configuredTargets.ids.length : 0;
            const usernames = Array.isArray(configuredTargets.usernames) ? configuredTargets.usernames.length : 0;
            return `reason=${reason}, targetIds=${ids}, targetUsernames=${usernames}`;
        }

        if (row.type === 'legacy_dummy_cleanup_failed') {
            return String(payload.message || 'Unknown error');
        }

        return '-';
    };

    const renderDataManagementBlock = (isExpanded = false) => {
        const startId = isExpanded ? 'staff-reset-start-date-max' : 'staff-reset-start-date';
        const endId = isExpanded ? 'staff-reset-end-date-max' : 'staff-reset-end-date';
        const _fromRead = `document.getElementById('${startId}')?.value || ''`;
        const _toRead = `document.getElementById('${endId}')?.value || ''`;

        return `
            <p class="text-muted">Create a full backup before running a staff activity reset.</p>
            <div class="admin-data-actions">
                <button class="action-btn secondary" data-ts-action="backup-staff-data">
                    <i class="fa-solid fa-download"></i> Backup Staff Data
                </button>
                <button class="action-btn secondary" data-ts-action="backup-staff-data-csv">
                    <i class="fa-solid fa-file-csv"></i> Backup Staff Data (CSV)
                </button>
            </div>
            <div class="admin-data-range">
                <label>
                    <span>From Date</span>
                    <input type="date" id="${startId}">
                </label>
                <label>
                    <span>To Date</span>
                    <input type="date" id="${endId}">
                </label>
                <button class="action-btn danger" data-ts-action="reset-staff-data" data-start-id="${startId}" data-end-id="${endId}">
                    <i class="fa-solid fa-triangle-exclamation"></i> Reset Staff Data
                </button>
            </div>
            <div class="admin-card-note">
                Choose a date range to delete only that period. Keep both dates empty to reset all staff activity data. User accounts are always kept.
            </div>
        `;
    };

    const renderSecurityAuditsBlock = (isExpanded = false) => {
        const startId = isExpanded ? 'audit-start-max' : 'audit-start';
        const endId = isExpanded ? 'audit-end-max' : 'audit-end';
        const _startRead = `document.getElementById('${startId}')?.value || ''`;
        const _endRead = `document.getElementById('${endId}')?.value || ''`;
        return `
            <div class="admin-audit-filter-row">
                <input type="date" id="${startId}" value="${auditStartDate}" class="adm-text-sm">
                <input type="date" id="${endId}" value="${auditEndDate}" class="adm-text-sm">
                <button type="button" data-ts-action="apply-audit-filter" data-start-id="${startId}" data-end-id="${endId}" class="action-btn">Filter</button>
            </div>
            <div class="table-container ${isExpanded ? 'admin-table-expanded' : ''}">
                <table>
                    <thead><tr><th>Staff</th><th>Slot</th><th>Time</th><th>Status</th></tr></thead>
                    <tbody>
                        ${audits.length ? audits.map(a => `
                            <tr>
                                <td>${safeHtml(a.userName)}</td>
                                <td>${safeHtml(a.slot)}</td>
                                <td>${new Date(a.timestamp).toLocaleTimeString()}</td>
                                <td style="color:${a.status === 'Success' ? 'green' : 'red'}">${a.status}</td>
                            </tr>
                        `).join('') : '<tr><td colspan="4" class="text-center">No audits found</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    };

    const renderSimulationAuditBlock = (isExpanded = false) => `
        <span class="text-muted adm-text-sm">Last ${simulationCleanupAudits.length} entries</span>
        <div class="table-container ${isExpanded ? 'admin-table-expanded' : ''}">
            <table>
                <thead><tr><th>Time</th><th>Event</th><th>Summary</th></tr></thead>
                <tbody>
                    ${simulationCleanupAudits.length ? simulationCleanupAudits.map(row => `
                        <tr>
                            <td>${new Date(Number(row.createdAt || 0)).toLocaleString()}</td>
                            <td>${safeHtml(row.type || '-')}</td>
                            <td>${safeHtml(formatCleanupSummary(row))}</td>
                        </tr>
                    `).join('') : '<tr><td colspan="3" class="text-center">No simulation cleanup audit entries found</td></tr>'}
                </tbody>
            </table>
        </div>
    `;

    const renderStaffBlock = (isExpanded = false) => `
        <div class="admin-staff-head">
            <div class="admin-staff-head-actions">
                ${(window.app_isAdminUser?.() || window.app_canManageBirthdays?.()) ? `<button type="button" class="action-btn secondary" data-ts-action="hash-navigate" data-hash="birthday-calendar"><i class="fa-solid fa-cake-candles"></i> Birthday Calendar</button>` : ''}
                <button type="button" class="action-btn secondary" data-ts-action="open-staff-ai-memory"><i class="fa-solid fa-brain"></i> AI Memory Sheet</button>
                ${window.app_hasPerm('users', 'admin') ? `<button type="button" class="action-btn" data-ts-action="show-modal" data-target="add-user-modal"><i class="fa-solid fa-user-plus"></i> Add Staff</button>` : ''}
            </div>
        </div>
        <div class="table-container ${isExpanded ? 'admin-table-expanded' : ''} mobile-table-card admin-staff-table-wrap">
            <table class="admin-staff-table">
                <thead>
                    <tr><th>Staff Member</th><th>Status</th><th>In / Out</th><th>Role / Dept</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    ${allUsers.map(u => {
        const isLive = u.lastSeen && (Date.now() - u.lastSeen < 120000);
        return `
                        <tr>
                            <td>
                                <div class="admin-user-cell">
                                    <img src="${u.avatar}" class="admin-user-avatar">
                                    <div>
                                        <div class="admin-user-name-row">${safeHtml(u.name)} ${isLive ? '<span class="admin-user-live-tag">LIVE</span>' : ''}</div>
                                        <div class="admin-user-id">${safeHtml(u.username)}</div>
                                    </div>
                                </div>
                            </td>
                            <td><span class="status-badge ${u.status === 'in' ? 'in' : 'out'}">${u.status?.toUpperCase()}</span></td>
                            <td>${u.lastCheckIn ? new Date(u.lastCheckIn).toLocaleTimeString() : '--'} / ${u.lastCheckOut ? new Date(u.lastCheckOut).toLocaleTimeString() : '--'}</td>
                            <td>${safeHtml(u.role)} / ${safeHtml(u.dept || '--')}</td>
                            <td>
                                <div class="admin-row-actions">
                                    <button type="button" data-ts-action="view-logs" data-user-id="${u.id}" class="admin-icon-btn"><i class="fa-solid fa-list-check"></i></button>
                                    ${window.app_hasPerm('users', 'admin') ? `<button type="button" data-ts-action="edit-user" data-user-id="${u.id}" class="admin-icon-btn"><i class="fa-solid fa-pen"></i></button>` : ''}
                                </div>
                            </td>
                        </tr>`;
    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    const pendingLeaveGroups = Array.from(
        (pendingLeaves || []).reduce((map, leave) => {
            const userId = String(leave?.userId || leave?.id || 'unknown');
            const existing = map.get(userId) || {
                userId,
                userName: leave?.userName || 'Staff',
                latestAppliedOn: leave?.appliedOn || leave?.startDate || '',
                totalDays: 0,
                requests: []
            };
            existing.userName = existing.userName || leave?.userName || 'Staff';
            existing.latestAppliedOn = [existing.latestAppliedOn, leave?.appliedOn, leave?.startDate]
                .filter(Boolean)
                .sort((a, b) => new Date(b) - new Date(a))[0] || existing.latestAppliedOn;
            existing.totalDays += Number(leave?.daysCount || 0);
            existing.requests.push(leave);
            map.set(userId, existing);
            return map;
        }, new Map()).values()
    ).sort((a, b) => new Date(b.latestAppliedOn || 0) - new Date(a.latestAppliedOn || 0));

    const formatPendingLeaveRange = (leave) => {
        const start = String(leave?.startDate || '').trim();
        const end = String(leave?.endDate || '').trim();
        if (!start && !end) return '--';
        if (start && end && start !== end) {
            return `${new Date(start).toLocaleDateString()} - ${new Date(end).toLocaleDateString()}`;
        }
        return new Date(start || end).toLocaleDateString();
    };

    const renderPendingLeaveHistory = (limit = null) => `
        <div style="margin-top:0.6rem; border-top:1px solid #e2e8f0; padding-top:0.6rem;">
            <div style="font-weight:700; color:#0f172a; margin-bottom:0.4rem;">Recent Decisions</div>
            ${reviewedLeaveItems.length ? reviewedLeaveItems.slice(0, limit || reviewedLeaveItems.length).map((leave) => `
                <div style="display:flex; justify-content:space-between; gap:0.5rem; align-items:flex-start; border:1px solid #e2e8f0; border-radius:12px; padding:0.5rem 0.6rem; background:rgba(255,255,255,0.9); margin-bottom:0.4rem;">
                    <div>
                        <div style="font-weight:700; color:#334155;">${safeHtml(leave.userName || usersById.get(String(leave.userId || ''))?.name || 'Staff')}</div>
                        <div style="font-size:0.8rem; color:#475569;">${safeHtml(formatPendingLeaveRange(leave))} • ${safeHtml(leave.type || '--')} • <span style="color:${String(leave.status) === 'Approved' ? '#166534' : '#b91c1c'};">${safeHtml(leave.status || '--')}</span></div>
                        <div style="font-size:0.75rem; color:#64748b;">${leave.actionDate ? `Reviewed ${safeHtml(new Date(leave.actionDate).toLocaleString())}` : 'Reviewed recently'}${leave.adminComment ? ` • ${safeHtml(leave.adminComment)}` : ''}</div>
                    </div>
                    <div class="admin-leave-actions">
                        <button type="button" data-ts-action="undo-leave" data-leave-id="${leave.id}" class="admin-btn admin-btn-secondary">Undo</button>
                    </div>
                </div>
            `).join('') : '<div class="text-muted" style="font-size:0.8rem;">No recent leave decisions.</div>'}
        </div>
    `;

    const renderPendingLeavesBlock = (isExpanded = false) => pendingLeaveGroups.length === 0
        ? `${isExpanded ? renderPendingLeaveHistory() : reviewedLeaveItems.length ? renderPendingLeaveHistory(3) : '<p class="text-muted">No pending requests.</p>'}`
        : `
            <div class="table-container ${isExpanded ? 'admin-table-expanded' : ''}">
                <table class="compact-table">
                    <thead>
                        <tr><th>Staff</th><th>Requests</th><th>Total Days</th></tr>
                    </thead>
                    <tbody>
                        ${pendingLeaveGroups.map((group) => `
                            <tr>
                                <td>
                                    <div style="font-weight:700; color:#0f172a;">${safeHtml(group.userName)}</div>
                                    <div class="text-muted" style="font-size:0.78rem;">${group.requests.length} request${group.requests.length === 1 ? '' : 's'}</div>
                                </td>
                                <td>
                                    <div style="display:flex; flex-direction:column; gap:0.45rem;">
                                        ${group.requests
        .sort((a, b) => new Date(b.appliedOn || b.startDate || 0) - new Date(a.appliedOn || a.startDate || 0))
        .map((l) => `
                                                <div style="border:1px solid #e2e8f0; border-radius:12px; padding:0.5rem 0.6rem; background:rgba(248,250,252,0.92);">
                                                    <div style="display:flex; flex-wrap:wrap; gap:0.35rem 0.6rem; align-items:center; margin-bottom:0.45rem;">
                                                        <span style="font-weight:700; color:#334155;">${safeHtml(formatPendingLeaveRange(l))}</span>
                                                        <span class="admin-leave-type-badge">${safeHtml(l.type)}</span>
                                                        <span style="font-size:0.78rem; color:#475569;">${safeHtml(String(l.daysCount || 0))} day${Number(l.daysCount || 0) === 1 ? '' : 's'}</span>
                                                    </div>
                                                    <div style="display:flex; justify-content:space-between; gap:0.5rem; align-items:flex-start; flex-wrap:wrap;">
                                                        <div class="text-muted adm-text-sm">
                                                            Applied ${safeHtml(l.appliedOn ? new Date(l.appliedOn).toLocaleDateString() : '--')}
                                                        </div>
                                                        <div class="admin-leave-actions">
                                                            ${window.app_hasPerm('leaves', 'admin') ? `
                                                                <button type="button" data-ts-action="approve-leave" data-leave-id="${l.id}" class="admin-btn admin-btn-success">Approve</button>
                                                                <button type="button" data-ts-action="reject-leave" data-leave-id="${l.id}" class="admin-btn admin-btn-danger">Reject</button>
                                                            ` : '<span class="text-muted" style="font-size:0.7rem;">View Only</span>'}
                                                        </div>
                                                    </div>
                                                </div>
                                            `).join('')}
                                        ${isExpanded ? renderPendingLeaveHistory() : ''}
                                    </div>
                                </td>
                                <td>${group.totalDays}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            ${!isExpanded && reviewedLeaveItems.length ? renderPendingLeaveHistory(3) : ''}
        `;

    const renderMissedCheckoutHistory = (limit = null) => `
        <div style="margin-top:0.55rem; border-top:1px solid #e2e8f0; padding-top:0.55rem;">
            <div style="font-weight:700; color:#0f172a; margin-bottom:0.4rem;">Recent Decisions</div>
            ${reviewedMissedCheckoutItems.length ? reviewedMissedCheckoutItems.slice(0, limit || reviewedMissedCheckoutItems.length).map((log) => `
                <div class="dashboard-tagged-item">
                    <div>
                        <div class="dashboard-tagged-title">${safeHtml(log.staffName)}</div>
                        <div class="dashboard-tagged-desc">${safeHtml(log.reviewNote || log.missedCheckoutReason || 'No review note recorded.')}</div>
                        <div class="dashboard-tagged-meta">${safeHtml(log.date || '--')} | ${safeHtml(log.staffRole || 'Employee')}${log.reviewedAt ? ` | Reviewed ${safeHtml(new Date(log.reviewedAt).toLocaleString())}` : ''}</div>
                    </div>
                    <div class="dashboard-tagged-status">
                        <span class="dashboard-tagged-pill ${String(log.reviewStatus).toLowerCase() === 'approved' ? 'accepted' : 'rejected'}">${safeHtml(String(log.reviewStatus || '').toUpperCase())}</span>
                        <div class="dashboard-tagged-actions">
                            <button type="button" class="dashboard-tagged-btn" data-ts-action="undo-missed-checkout-review"(${JSON.stringify(String(log.notificationId || ''))})">Undo</button>
                        </div>
                    </div>
                </div>
            `).join('') : '<div class="text-muted" style="font-size:0.8rem;">No recent missed checkout decisions.</div>'}
        </div>
    `;

    const renderMissedCheckoutBlock = (isExpanded = false) => missedCheckoutItems.length === 0
        ? `${isExpanded ? renderMissedCheckoutHistory() : reviewedMissedCheckoutItems.length ? renderMissedCheckoutHistory(3) : '<p class="text-muted">No missed checkout reasons waiting for review.</p>'}`
        : `
            <div class="dashboard-tagged-list ${isExpanded ? 'admin-list-expanded' : ''}">
                ${missedCheckoutItems.map((log) => `
                    <div class="dashboard-tagged-item">
                        <div>
                            <div class="dashboard-tagged-title">${safeHtml(log.staffName)}</div>
                            <div class="dashboard-tagged-desc">${safeHtml(log.missedCheckoutReason || 'Reason not submitted yet.')}</div>
                            <div class="dashboard-tagged-meta">
                                ${safeHtml(log.date || '--')} | ${safeHtml(log.staffRole || 'Employee')}
                                ${log.missedCheckoutReasonSubmittedAt ? ` | Submitted ${safeHtml(new Date(log.missedCheckoutReasonSubmittedAt).toLocaleString())}` : ''}
                            </div>
                        </div>
                        <div class="dashboard-tagged-status">
                            <span class="dashboard-tagged-pill pending">Pending</span>
                            ${log.notificationId ? `
                                <div class="dashboard-tagged-actions">
                                    <button type="button" class="dashboard-tagged-btn accept" data-ts-action="review-missed-checkout" data-notification-id="${log.notificationId}" data-review-action="approved">Approve</button>
                                    <button type="button" class="dashboard-tagged-btn reject" data-ts-action="review-missed-checkout" data-notification-id="${log.notificationId}" data-review-action="rejected">Reject</button>
                                </div>
                            ` : '<span class="text-muted" style="font-size:0.7rem;">Notification sync pending</span>'}
                        </div>
                    </div>
                `).join('')}
                ${isExpanded ? renderMissedCheckoutHistory() : ''}
            </div>
            ${!isExpanded && reviewedMissedCheckoutItems.length ? renderMissedCheckoutHistory(3) : ''}
        `;

    const renderBirthdayBlock = () => `
        <p class="text-muted">${birthdayManagedCount} staff with reminder-ready birthdays</p>
        <div class="admin-birthday-list">
            ${upcomingBirthdayUsers.length
        ? upcomingBirthdayUsers.map((user) => `
                    <div class="admin-birthday-row">
                        <div>
                            <div class="admin-birthday-name">${safeHtml(user.name || 'Staff')}</div>
                            <div class="admin-birthday-meta">${safeHtml(user.role || 'Employee')} / ${safeHtml(user.dept || 'General')}</div>
                        </div>
                        <div class="admin-birthday-date">${safeHtml(String(user.birthDay || '--'))}/${safeHtml(String(user.birthMonth || '--'))}${user.birthYear ? `/${safeHtml(String(user.birthYear))}` : ''}</div>
                    </div>
                `).join('')
        : '<div style="color:#9a3412; font-size:0.85rem;">No birthdays saved yet.</div>'}
        </div>
        <button type="button" class="action-btn" data-ts-action="hash-navigate" data-hash="birthday-calendar"><i class="fa-solid fa-cake-candles"></i> Open</button>
    `;

    const renderBudgetHeadsBlock = (isExpanded = false) => `
        <p class="text-muted">${budgetHeadsSorted.length} budget head(s) configured</p>
        <form onsubmit="window.app_addBudgetHead(event)" style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr auto; gap:0.5rem; margin-bottom:0.5rem;">
            <input id="budget-add-code" name="code" placeholder="Code (e.g. OPS001)" required style="padding:0.5rem; border:1px solid #e2e8f0; border-radius:8px;">
            <input id="budget-add-name" name="name" placeholder="Name (e.g. Operations)" required style="padding:0.5rem; border:1px solid #e2e8f0; border-radius:8px;">
            <select id="budget-add-type" name="headType" onchange="window.app_toggleBudgetHeadParentInput?.(this.value, this)" style="padding:0.5rem; border:1px solid #e2e8f0; border-radius:8px; background:#fff;">
                <option value="main">Main Head</option>
                <option value="sub">Sub Head</option>
            </select>
            <select id="budget-add-parent" name="parentId" disabled style="padding:0.5rem; border:1px solid #e2e8f0; border-radius:8px; background:#fff;">
                <option value="">Main Head (No Parent)</option>
                ${budgetHeadsParentSelectOptions}
            </select>
            <button type="submit" class="action-btn" style="padding:0.5rem 0.8rem;">Add</button>
        </form>
        <div class="table-container ${isExpanded ? 'admin-table-expanded' : ''}" style="max-height:${isExpanded ? '420px' : '220px'}; overflow:auto;">
            <table class="compact-table">
                <thead>
                    <tr>
                        <th>Budget Code</th>
                        <th>Budget Name</th>
                        <th>Head Type</th>
                        <th>Parent Head</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${budgetHeadsTreeOrdered.length ? budgetHeadsTreeOrdered.map((head) => {
            const id = String(head.id || '');
            const isSystem = id === 'UNALLOCATED';
            const parentOptions = ['<option value="">Main Head (No Parent)</option>']
                .concat(
                    budgetHeadsTreeOrdered
                        .filter((candidate) => String(candidate.id || '') !== 'UNALLOCATED' && String(candidate.id || '') !== id)
                        .map((candidate) => {
                            const cId = String(candidate.id || '');
                            const indent = Number(candidate.depth || 0) > 0 ? `${'&nbsp;&nbsp;'.repeat(Number(candidate.depth || 0))}↳ ` : '';
                            return `<option value="${safeHtml(cId)}" ${String(head.parentId || '') === cId ? 'selected' : ''}>${indent}${safeHtml(String(candidate.code || cId))}</option>`;
                        })
                ).join('');
            return `
                            <tr data-bh-id="${safeHtml(id)}">
                                <td><input data-bh-field="code" value="${safeHtml(String(head.code || id))}" ${isSystem ? 'readonly' : ''} style="width:100%; padding:0.4rem; border:1px solid #d1d5db; border-radius:6px;"></td>
                                <td><input data-bh-field="name" value="${safeHtml(String(head.name || ''))}" ${isSystem ? 'readonly' : ''} style="width:100%; padding:0.4rem; border:1px solid #d1d5db; border-radius:6px;"></td>
                                <td>${String(head.parentId || '').trim() ? 'Sub Head' : 'Main Head'}</td>
                                <td>
                                    <select data-bh-field="parentId" ${isSystem ? 'disabled' : ''} style="width:100%; padding:0.4rem; border:1px solid #d1d5db; border-radius:6px; background:#fff;">
                                        ${parentOptions}
                                    </select>
                                </td>
                                <td>
                                    <select data-bh-field="status" ${isSystem ? 'disabled' : ''} style="width:100%; padding:0.4rem; border:1px solid #d1d5db; border-radius:6px; background:#fff;">
                                        <option value="active" ${String(head.status || 'active') === 'active' ? 'selected' : ''}>active</option>
                                        <option value="inactive" ${String(head.status || 'active') === 'inactive' ? 'selected' : ''}>inactive</option>
                                    </select>
                                </td>
                                <td>
                                    ${isSystem ? '<span class="text-muted">System</span>' : `
                                        <button type="button" class="dashboard-tagged-btn accept" data-ts-action="save-budget-head" data-budget-head-id="${safeHtml(id)}">Save</button>
                                        ${String(head.parentId || '').trim() ? '' : `<button type="button" class="dashboard-tagged-btn" data-ts-action="prefill-budget-parent" data-budget-head-id="${safeHtml(id)}" style="margin-left:0.35rem;">Add Sub</button>`}
                                    `}
                                </td>
                            </tr>
                        `;
        }).join('') : '<tr><td colspan="6" class="text-muted">No budget heads found.</td></tr>'}
                </tbody>
            </table>
        </div>
    `;

    const renderComplianceExceptionsBlock = (isExpanded = false) => {
        const list = (isExpanded ? complianceIssues : complianceIssues.slice(0, 6));
        const budgetHeadOptions = (budgetHeadsSorted || [])
            .filter((head) => String(head.id || '') !== 'UNALLOCATED')
            .map((head) => `<option value="${safeHtml(String(head.id || ''))}">${safeHtml(String(head.code || head.id || ''))} - ${safeHtml(String(head.name || ''))}</option>`)
            .join('');
        return `
            <div class="admin-kpi-grid" style="margin-bottom:0.45rem;">
                <div class="admin-kpi-pill"><div class="admin-kpi-pill-value">${complianceIssues.length}</div><div class="admin-kpi-pill-label">Open Issues</div></div>
                <div class="admin-kpi-pill"><div class="admin-kpi-pill-value">${complianceReasonCounts.budgetHead}</div><div class="admin-kpi-pill-label">Budget Mapping</div></div>
                <div class="admin-kpi-pill"><div class="admin-kpi-pill-value">${complianceReasonCounts.checkout}</div><div class="admin-kpi-pill-label">Checkout Validation</div></div>
                <div class="admin-kpi-pill"><div class="admin-kpi-pill-value">${complianceReasonCounts.other}</div><div class="admin-kpi-pill-label">Other Validation</div></div>
                <div class="admin-kpi-pill"><div class="admin-kpi-pill-value">${staleUnallocated.length}</div><div class="admin-kpi-pill-label">Aged 2+ Days</div></div>
            </div>
            <div style="margin-bottom:0.4rem;">
                <button type="button" class="action-btn secondary" data-ts-action="export-compliance-csv">
                    <i class="fa-solid fa-file-csv"></i> Export Open Issues
                </button>
            </div>
            <div style="display:grid; gap:0.45rem; max-height:${isExpanded ? '360px' : '180px'}; overflow:auto;">
                ${list.map((row) => `
                    <div class="dashboard-tagged-item">
                        <div style="display:flex; justify-content:space-between; gap:0.5rem;">
                            <div class="dashboard-tagged-title">${safeHtml(row.date || '--')} • ${safeHtml(usersById.get(String(row.user_id || row.userId || ''))?.name || row.staffName || 'Staff')}</div>
                            <span class="badge" style="background:${row.sourceType === 'team_activity' ? '#ecfeff' : '#eef2ff'}; color:${row.sourceType === 'team_activity' ? '#0e7490' : '#3730a3'}; border:1px solid ${row.sourceType === 'team_activity' ? '#a5f3fc' : '#c7d2fe'};">${safeHtml(String(row.sourceLabel || 'Source'))}</span>
                            <span class="badge" style="background:#fff7ed; color:#9a3412; border:1px solid #fed7aa;">${safeHtml(String(row.budgetHeadId || 'UNALLOCATED'))}</span>
                        </div>
                        <div class="dashboard-tagged-desc" style="white-space:normal; overflow:visible; text-overflow:clip; display:block; -webkit-line-clamp:unset; line-clamp:unset; max-height:none;">
                            ${safeHtml(row.budgetHeadUnallocatedReason || (Array.isArray(row.validationErrors) ? row.validationErrors.join(' | ') : '') || row.workDescription || 'No reason')}
                        </div>
                        <div style="margin-top:0.45rem; font-size:0.8rem; color:#334155; white-space:normal; overflow:visible;">
                            <strong>Task:</strong> ${safeHtml(row.workDescription || 'No task summary')}
                        </div>
                        <div style="margin-top:0.55rem; display:grid; grid-template-columns:1fr auto; gap:0.4rem;">
                            <select id="assign-bh-${safeHtml(String(row._issueKey || row.id || ''))}" onchange="window.app_handleComplianceBudgetHeadSelection && window.app_handleComplianceBudgetHeadSelection('${safeHtml(String(row._issueKey || row.id || ''))}', this)" style="padding:0.45rem; border:1px solid #d1d5db; border-radius:8px;">
                                <option value="">Select budget head</option>
                                ${budgetHeadOptions}
                                <option value="__ADD_NEW__">+ Add new budget head</option>
                            </select>
                            ${row.sourceType === 'team_activity'
                ? `<button type="button" class="dashboard-tagged-btn accept" data-ts-action="assign-budget-team-task" data-plan-id="${safeHtml(String(row.planId || ''))}" data-task-index="${Number.isInteger(row.taskIndex) ? row.taskIndex : 'null'}">Allocate</button>`
                : `<button type="button" class="dashboard-tagged-btn accept" data-ts-action="assign-budget-attendance" data-attendance-id="${safeHtml(String(row.id || ''))}">Allocate</button>`}
                        </div>
                    </div>
                `).join('') || '<div class="text-muted">No exceptions in recent sessions.</div>'}
            </div>
            <div style="margin-top:0.55rem; padding-top:0.4rem; border-top:1px solid #e2e8f0;">
                <div style="font-size:0.84rem; font-weight:700; color:#334155; margin-bottom:0.45rem;">Daily Tasks (Team Activities)</div>
                <div style="display:grid; gap:0.4rem; max-height:${isExpanded ? '280px' : '150px'}; overflow:auto;">
                    ${(teamActivityRows.slice(0, isExpanded ? 40 : 12)).map((row) => `
                        <div style="border:1px solid #e2e8f0; border-radius:10px; padding:0.35rem 0.4rem; background:#f8fafc;">
                            <div style="display:flex; justify-content:space-between; gap:0.5rem;">
                                <div style="font-size:0.79rem; font-weight:700; color:#1e293b;">${safeHtml(row.date || '--')} • ${safeHtml(usersById.get(String(row.user_id || row.userId || ''))?.name || 'Staff')}</div>
                                <span class="badge" style="background:#ecfeff; color:#0e7490; border:1px solid #a5f3fc;">Task</span>
                            </div>
                            <div style="font-size:0.8rem; color:#334155; margin-top:0.2rem;">${safeHtml(row.workDescription || 'No task summary')}</div>
                        </div>
                    `).join('') || '<div class="text-muted">No team tasks found for selected period.</div>'}
                </div>
            </div>
        `;
    };

    const adminAiWorkspace = buildAdminAiReportContext({
        auditStartDate,
        auditEndDate,
        allUsers,
        pendingLeaves,
        recentAttendanceLogs,
        recentTeamActivities
    });
    updateAdminAiWorkspace(adminAiWorkspace.context, adminAiWorkspace.sourceScope);
    const siteAnnouncementSettings = await SiteAnnouncement.getSettings().catch(() => null);

    const cards = [];
    const cardTemplates = {};

    const buildAdminCardModeControls = (id, title) => `
        <div class="admin-card-mode-controls" role="group" aria-label="${safeHtml(title)} view controls">
            <button type="button" class="admin-card-mode-btn admin-card-mode-btn-original" data-ts-action="admin-toggle-card-mode" data-card-id="${id}" data-mode="original" aria-label="Show original size ${safeHtml(title)}">
                <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
            </button>
            <button type="button" class="admin-card-mode-btn admin-card-mode-btn-fullscreen" data-ts-action="admin-toggle-card-mode" data-card-id="${id}" data-mode="fullscreen" aria-label="Show fullscreen ${safeHtml(title)}">
                <i class="fa-solid fa-expand"></i>
            </button>
        </div>
    `;

    const pushCard = ({ id, title, compactHtml, expandedHtml = '', className = '', accentClass = '' }) => {
        if (!id || !title) return;
        const controlsHtml = buildAdminCardModeControls(id, title);
        cardTemplates[id] = {
            title,
            tileHtml: `${controlsHtml}${compactHtml}`,
            originalHtml: `${controlsHtml}${buildAdminOriginalTemplate(compactHtml)}`,
            expandedHtml: expandedHtml || compactHtml
        };

        cards.push(`
            <section class="card admin-card-compact admin-card-mode-tile ${className} ${accentClass}" data-admin-card="${id}" data-admin-card-mode="tile" data-admin-original-full-width="0">
                <div class="admin-card-header-row">
                    <h3 class="admin-card-title">${safeHtml(title)}</h3>
                    ${buildAdminCardModeControls(id, title)}
                </div>
                <div class="admin-card-content">
                    ${compactHtml}
                </div>
            </section>
        `);
    };

    pushCard({
        id: 'staff-kpi',
        title: 'Staff Snapshot',
        className: 'admin-kpi-card',
        compactHtml: `
            <span class="admin-kpi-label">Total Registered Staff</span>
            <h2 class="admin-kpi-value">${allUsers.length}</h2>
            <div class="admin-kpi-grid">
                <div class="admin-kpi-pill">
                    <div class="admin-kpi-pill-value">${activeCount}</div>
                    <div class="admin-kpi-pill-label">Active</div>
                </div>
                <div class="admin-kpi-pill">
                    <div class="admin-kpi-pill-value">${adminCount}</div>
                    <div class="admin-kpi-pill-label">Admins</div>
                </div>
            </div>
        `
    });

    if (window.app_isAdminUser?.(currentAdmin) || currentAdmin?.role === 'Administrator') {
        pushCard({
            id: 'site-announcement',
            title: 'Site Announcement',
            className: 'admin-section-card full-width site-announcement-card',
            accentClass: 'admin-card-accent-blue',
            compactHtml: SiteAnnouncement.renderAdminBody(siteAnnouncementSettings || {}),
            expandedHtml: SiteAnnouncement.renderAdminBody(siteAnnouncementSettings || {})
        });
    }

    if (window.app_hasPerm('users', 'admin')) {
        pushCard({
            id: 'data-management',
            title: 'Data Management',
            className: 'admin-performance-card',
            accentClass: 'admin-card-accent-blue',
            compactHtml: renderDataManagementBlock(false),
            expandedHtml: renderDataManagementBlock(true)
        });
    }

    if (window.app_hasPerm('leaves', 'view')) {
        pushCard({
            id: 'pending-leaves',
            title: `Pending Leave Requests (${pendingLeaveGroups.length} staff / ${pendingLeaves.length} requests)`,
            className: 'admin-section-card',
            compactHtml: renderPendingLeavesBlock(false),
            expandedHtml: renderPendingLeavesBlock(true)
        });
    }

    if (window.app_hasPerm('dashboard', 'admin')) {
        pushCard({
            id: 'missed-checkout',
            title: `Missed Checkout Requests (${missedCheckoutItems.length})`,
            className: 'dashboard-tagged-card',
            compactHtml: renderMissedCheckoutBlock(false),
            expandedHtml: renderMissedCheckoutBlock(true)
        });
    }

    if ((window.app_isAdminUser?.() || window.app_canManageBirthdays?.())) {
        pushCard({
            id: 'birthday-calendar',
            title: 'Birthday Calendar',
            className: 'admin-performance-card',
            accentClass: 'admin-card-accent-amber',
            compactHtml: renderBirthdayBlock(),
            expandedHtml: renderBirthdayBlock()
        });
    }

    if (window.app_hasPerm('users', 'view')) {
        pushCard({
            id: 'staff-management',
            title: 'Staff Management',
            compactHtml: renderStaffBlock(false),
            expandedHtml: renderStaffBlock(true)
        });
    }

    if (window.app_hasPerm('users', 'admin')) {
        pushCard({
            id: 'budget-heads',
            title: 'Budget Heads',
            className: 'admin-section-card',
            accentClass: 'admin-card-accent-blue',
            compactHtml: renderBudgetHeadsBlock(false),
            expandedHtml: renderBudgetHeadsBlock(true)
        });
    }

    if (window.app_hasPerm('attendance', 'view')) {
        pushCard({
            id: 'compliance-exceptions',
            title: 'Compliance Exceptions',
            className: 'admin-section-card',
            accentClass: 'admin-card-accent-amber',
            compactHtml: renderComplianceExceptionsBlock(false),
            expandedHtml: renderComplianceExceptionsBlock(true)
        });
    }

    pushCard({
        id: 'security-audits',
        title: 'Security Audits',
        compactHtml: renderSecurityAuditsBlock(false),
        expandedHtml: renderSecurityAuditsBlock(true)
    });

    pushCard({
        id: 'simulation-audit',
        title: 'Simulation Cleanup Audit (Debug)',
        compactHtml: renderSimulationAuditBlock(false),
        expandedHtml: renderSimulationAuditBlock(true)
    });

    if (window.app_canCustomizeDashboard?.()) {
        const renderCustomizeBlock = () => window.app_renderCustomizationWidget?.(window.app_dashboardCustomization?._settings) || '';
        pushCard({
            id: 'dashboard-customization',
            title: 'Dashboard Customization',
            className: 'admin-section-card',
            compactHtml: renderCustomizeBlock(),
            expandedHtml: renderCustomizeBlock()
        });
    }

    window._adminCardTemplates = cardTemplates;
    window._adminCardModeState = {};

    // UI Handlers
    window.app_applyAuditFilter = async (startDate = '', endDate = '') => {
        const start = String(startDate || '').trim() || document.getElementById('audit-start')?.value || document.getElementById('audit-start-max')?.value;
        const end = String(endDate || '').trim() || document.getElementById('audit-end')?.value || document.getElementById('audit-end-max')?.value;
        const contentArea = document.getElementById('page-content');
        window.app_closeAdminCardMaximize?.();
        if (contentArea) contentArea.innerHTML = await renderAdmin(start, end);
    };

    window.app_refreshAdminPage = async (opts = {}) => {
        const start = document.getElementById('audit-start')?.value || document.getElementById('audit-start-max')?.value || auditStartDate;
        const end = document.getElementById('audit-end')?.value || document.getElementById('audit-end-max')?.value || auditEndDate;
        const contentArea = document.getElementById('page-content');
        const requestedCardId = String(opts?.preserveCardId || '').trim();
        const activeCardId = requestedCardId || (window._adminMaxCardId ? String(window._adminMaxCardId) : '');
        let activeCardMode = '';
        if (requestedCardId) {
            const currentCardEl = document.querySelector(`.dashboard-admin-view .admin-card-compact[data-admin-card="${requestedCardId}"]`);
            activeCardMode = String(opts?.preserveMode || currentCardEl?.dataset?.adminCardMode || 'original');
        } else if (activeCardId) {
            activeCardMode = String((window._adminCardModeState || {})[activeCardId] || 'tile');
        }
        if (contentArea) contentArea.innerHTML = await renderAdmin(start, end);
        if (activeCardId && activeCardMode && typeof window.app_toggleAdminCardMode === 'function') {
            setTimeout(() => {
                window.app_toggleAdminCardMode(activeCardId, activeCardMode);
            }, 0);
        }
    };

    const createBudgetHead = async ({ code, name, parentId = '' }) => {
        const safeCode = String(code || '').trim().toUpperCase();
        const safeName = String(name || '').trim();
        const safeParentId = String(parentId || '').trim();
        if (!safeCode || !safeName) {
            throw new Error('Code and name are required.');
        }
        if (safeParentId && safeParentId === safeCode) {
            throw new Error('A budget head cannot be its own parent.');
        }
        const existing = await window.AppDB.getAll('budget_heads').catch(() => []);
        const dup = (existing || []).some((row) => String(row.id || '').toUpperCase() === safeCode);
        if (dup) {
            throw new Error('Budget head code already exists.');
        }
        if (safeParentId) {
            const parent = (existing || []).find((row) => String(row.id || '') === safeParentId);
            if (!parent) throw new Error('Selected parent budget head not found.');
            if (String(parent.status || 'active').toLowerCase() === 'inactive') {
                throw new Error('Cannot use an inactive budget head as parent.');
            }
        }
        await window.AppDB.put('budget_heads', {
            id: safeCode,
            code: safeCode,
            name: safeName,
            parentId: safeParentId,
            status: 'active',
            owner: window.AppAuth.getUser()?.name || 'Admin',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        if (window.app_refreshBudgetHeadsCache) await window.app_refreshBudgetHeadsCache();
        return safeCode;
    };

    const openBudgetHeadCreateModal = ({ initialCode = '', initialName = '' } = {}) => new Promise((resolve) => {
        const modalId = `admin-budget-head-create-${Date.now()}`;
        const parentMainHeads = budgetHeadsTreeOrdered
            .filter((head) => String(head.id || '') !== 'UNALLOCATED' && !String(head.parentId || '').trim());
        const mainHeadOptions = budgetHeadsTreeOrdered
            .filter((head) => String(head.id || '') !== 'UNALLOCATED' && !String(head.parentId || '').trim())
            .map((head) => `<option value="${safeHtml(String(head.id || ''))}">${safeHtml(String(head.code || head.id || ''))} - ${safeHtml(String(head.name || ''))}</option>`)
            .join('');
        const html = `
            <div class="modal-overlay" id="${modalId}" style="display:flex; z-index:30000;">
                <div class="modal-content" style="max-width:560px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.55rem;">
                        <h3 style="margin:0;">Add Budget Head</h3>
                        <button type="button" data-close style="background:none; border:none; font-size:1.2rem; cursor:pointer;">&times;</button>
                    </div>
                    <form id="${modalId}-form" style="display:grid; gap:0.5rem;">
                        <label class="adm-grid-row">
                            <span class="adm-text-title">Code</span>
                            <input name="code" value="${safeHtml(String(initialCode || ''))}" placeholder="OPS001" required class="adm-input">
                        </label>
                        <label class="adm-grid-row">
                            <span class="adm-text-title">Name</span>
                            <input name="name" value="${safeHtml(String(initialName || ''))}" placeholder="Operations" required class="adm-input">
                        </label>
                        <label class="adm-grid-row">
                            <span class="adm-text-title">Parent Main Head (Optional)</span>
                            <select name="parentId" style="padding:0.45rem; border:1px solid #cbd5e1; border-radius:8px; background:#fff;">
                                <option value="">Main Head (No Parent)</option>
                                <option value="__CREATE_MAIN__">+ Create New Main Head</option>
                                ${mainHeadOptions}
                            </select>
                        </label>
                        <div style="border:1px solid #e2e8f0; border-radius:10px; overflow:hidden;">
                            <div style="font-size:0.78rem; font-weight:700; color:#334155; padding:0.55rem 0.65rem; background:#f8fafc; border-bottom:1px solid #e2e8f0;">Parent Heads Sheet</div>
                            <div style="max-height:170px; overflow:auto;">
                                <table class="compact-table" style="margin:0;">
                                    <thead>
                                        <tr><th>Code</th><th>Name</th><th>Status</th><th>Use</th></tr>
                                    </thead>
                                    <tbody>
                                        ${parentMainHeads.length ? parentMainHeads.map((head) => `
                                            <tr>
                                                <td>${safeHtml(String(head.code || head.id || ''))}</td>
                                                <td>${safeHtml(String(head.name || ''))}</td>
                                                <td>${safeHtml(String(head.status || 'active'))}</td>
                                                <td><button type="button" class="dashboard-tagged-btn accept" data-parent-pick="${safeHtml(String(head.id || ''))}">Use</button></td>
                                            </tr>
                                        `).join('') : '<tr><td colspan="4" class="text-muted">No main heads yet.</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div id="${modalId}-new-main-wrap" style="display:none; border:1px dashed #cbd5e1; border-radius:10px; padding:0.7rem; background:#f8fafc;">
                            <div style="font-size:0.78rem; font-weight:700; color:#334155; margin-bottom:0.5rem;">Create Parent Main Head</div>
                            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.55rem;">
                                <input name="newMainCode" placeholder="Parent code (e.g. FIN001)" class="adm-input">
                                <input name="newMainName" placeholder="Parent name (e.g. Finance)" class="adm-input">
                            </div>
                        </div>
                        <div style="display:flex; gap:0.65rem; justify-content:flex-end; margin-top:0.4rem;">
                            <button type="button" class="action-btn secondary" data-close>Cancel</button>
                            <button type="submit" class="action-btn">Create</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        if (typeof window.app_showModal === 'function') window.app_showModal(html, modalId);
        else (document.getElementById('modal-container') || document.body).insertAdjacentHTML('beforeend', html);
        const modalEl = document.getElementById(modalId);
        if (modalEl) modalEl.style.zIndex = '30000';
        const formEl = document.getElementById(`${modalId}-form`);
        const parentSel = formEl?.querySelector('select[name="parentId"]');
        const newMainWrap = document.getElementById(`${modalId}-new-main-wrap`);
        const syncMainSection = () => {
            const show = String(parentSel?.value || '') === '__CREATE_MAIN__';
            if (newMainWrap) newMainWrap.style.display = show ? 'block' : 'none';
        };
        parentSel?.addEventListener('change', syncMainSection);
        syncMainSection();
        formEl?.addEventListener('click', (ev) => {
            const btn = ev.target?.closest?.('[data-parent-pick]');
            if (!btn || !parentSel) return;
            const picked = String(btn.getAttribute('data-parent-pick') || '').trim();
            if (!picked) return;
            parentSel.value = picked;
            syncMainSection();
        });
        const cleanup = (result) => {
            modalEl?.remove();
            resolve(result);
        };
        modalEl?.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => cleanup(null)));
        modalEl?.addEventListener('click', (ev) => {
            if (ev.target === modalEl) cleanup(null);
        });
        formEl?.addEventListener('submit', (ev) => {
            ev.preventDefault();
            const fd = new FormData(formEl);
            cleanup({
                code: String(fd.get('code') || ''),
                name: String(fd.get('name') || ''),
                parentId: String(fd.get('parentId') || ''),
                newMainCode: String(fd.get('newMainCode') || ''),
                newMainName: String(fd.get('newMainName') || '')
            });
        });
    });

    window.app_addBudgetHead = async (event) => {
        event.preventDefault();
        try {
            const fd = new FormData(event.target);
            const code = String(fd.get('code') || '');
            const name = String(fd.get('name') || '');
            const headType = String(fd.get('headType') || 'main');
            const parentId = headType === 'sub' ? String(fd.get('parentId') || '') : '';
            if (headType === 'sub' && !parentId) {
                alert('Select a parent head for sub head.');
                return;
            }
            await createBudgetHead({ code, name, parentId });
            await window.app_refreshAdminPage();
        } catch (err) {
            const raw = String(err?.message || err || '');
            if (raw.includes('permission-denied') || raw.includes('insufficient permissions')) {
                alert('Firestore permission denied for budget_heads write. Update security rules to allow admin writes on budget_heads.');
                return;
            }
            alert('Failed to add budget head: ' + raw);
        }
    };

    window.app_handleComplianceBudgetHeadSelection = async (logId, selectEl = null) => {
        const id = String(logId || '').trim();
        const sel = selectEl || document.getElementById(`assign-bh-${id}`);
        if (!sel || sel.value !== '__ADD_NEW__') return;
        try {
            const details = await openBudgetHeadCreateModal();
            if (!details) {
                sel.value = '';
                return;
            }
            let parentId = String(details.parentId || '').trim();
            if (parentId === '__CREATE_MAIN__') {
                const newMainCode = String(details.newMainCode || '').trim();
                const newMainName = String(details.newMainName || '').trim();
                if (!newMainCode || !newMainName) {
                    throw new Error('Parent main head code and name are required.');
                }
                const createdMainId = await createBudgetHead({ code: newMainCode, name: newMainName, parentId: '' });
                parentId = createdMainId;
            }
            const newId = await createBudgetHead({ code: details.code, name: details.name, parentId });
            await window.app_refreshAdminPage({ preserveCardId: 'compliance-exceptions' });
            const nextSel = document.getElementById(`assign-bh-${id}`);
            if (nextSel) nextSel.value = newId;
            if (window.app_showSyncToast) window.app_showSyncToast('Budget head created. You can now allocate it.');
        } catch (err) {
            sel.value = '';
            const raw = String(err?.message || err || '');
            if (raw.includes('permission-denied') || raw.includes('insufficient permissions')) {
                alert('Firestore permission denied for budget_heads write. Update security rules to allow admin writes on budget_heads.');
                return;
            }
            alert('Failed to add budget head: ' + raw);
        }
    };

    window.app_toggleBudgetHeadStatus = async (headId) => {
        try {
            const id = String(headId || '').trim();
            if (!id || id === 'UNALLOCATED') return;
            const row = await window.AppDB.get('budget_heads', id);
            if (!row) return;
            row.status = String(row.status || 'active') === 'inactive' ? 'active' : 'inactive';
            row.updatedAt = new Date().toISOString();
            await window.AppDB.put('budget_heads', row);
            if (window.app_refreshBudgetHeadsCache) await window.app_refreshBudgetHeadsCache();
            await window.app_refreshAdminPage();
        } catch (err) {
            const raw = String(err?.message || err || '');
            if (raw.includes('permission-denied') || raw.includes('insufficient permissions')) {
                alert('Firestore permission denied for budget_heads update. Update security rules to allow admin writes on budget_heads.');
                return;
            }
            alert('Failed to update budget head: ' + raw);
        }
    };

    window.app_saveBudgetHeadRow = async (headId, triggerEl = null) => {
        try {
            const id = String(headId || '').trim();
            if (!id || id === 'UNALLOCATED') return;
            const row = await window.AppDB.get('budget_heads', id);
            if (!row) {
                alert('Budget head not found.');
                return;
            }
            const rowEl = triggerEl?.closest?.('tr')
                || Array.from(document.querySelectorAll('tr[data-bh-id]')).find((el) => String(el.getAttribute('data-bh-id') || '') === id)
                || null;
            const code = String(rowEl?.querySelector('[data-bh-field="code"]')?.value || '').trim().toUpperCase();
            const name = String(rowEl?.querySelector('[data-bh-field="name"]')?.value || '').trim();
            const parentId = String(rowEl?.querySelector('[data-bh-field="parentId"]')?.value || '').trim();
            const status = String(rowEl?.querySelector('[data-bh-field="status"]')?.value || 'active').trim().toLowerCase();
            if (!code || !name) {
                alert('Code and name are required.');
                return;
            }
            if (parentId === id) {
                alert('A budget head cannot be its own parent.');
                return;
            }
            row.code = code;
            row.name = name;
            row.parentId = parentId;
            row.status = status === 'inactive' ? 'inactive' : 'active';
            row.updatedAt = new Date().toISOString();
            await window.AppDB.put('budget_heads', row);
            if (window.app_refreshBudgetHeadsCache) await window.app_refreshBudgetHeadsCache();
            if (window.app_showSyncToast) window.app_showSyncToast('Budget head updated.');
        } catch (err) {
            const raw = String(err?.message || err || '');
            if (raw.includes('permission-denied') || raw.includes('insufficient permissions')) {
                alert('Firestore permission denied for budget_heads update. Update security rules to allow admin writes on budget_heads.');
                return;
            }
            alert('Failed to update budget head: ' + raw);
        }
    };

    window.app_toggleBudgetHeadParentInput = (headType = 'main', triggerEl = null) => {
        const formEl = triggerEl?.closest?.('form') || null;
        const parentEl = formEl?.querySelector?.('select[name="parentId"]') || document.getElementById('budget-add-parent');
        if (!parentEl) return;
        const isSub = String(headType || '').toLowerCase() === 'sub';
        parentEl.disabled = !isSub;
        if (!isSub) parentEl.value = '';
    };

    window.app_prefillBudgetHeadParent = (parentId) => {
        const forms = Array.from(document.querySelectorAll('.dashboard-admin-view form')).filter((f) => f?.querySelector?.('select[name="headType"]') && f?.querySelector?.('select[name="parentId"]'));
        forms.forEach((formEl) => {
            const typeEl = formEl.querySelector('select[name="headType"]');
            const parentEl = formEl.querySelector('select[name="parentId"]');
            const codeEl = formEl.querySelector('input[name="code"]');
            if (typeEl) typeEl.value = 'sub';
            window.app_toggleBudgetHeadParentInput?.('sub', typeEl || formEl);
            if (parentEl) parentEl.value = String(parentId || '');
            if (codeEl && typeof codeEl.focus === 'function') codeEl.focus();
        });
    };

    window.app_assignBudgetHeadToAttendance = async (logId, triggerEl = null) => {
        try {
            const id = String(logId || '').trim();
            if (!id) return;
            const sel = triggerEl?.previousElementSibling?.tagName === 'SELECT'
                ? triggerEl.previousElementSibling
                : document.getElementById(`assign-bh-${id}`);
            const nextBudgetHeadId = String(sel?.value || '').trim();
            if (!nextBudgetHeadId) {
                alert('Select a budget head first.');
                return;
            }
            if (nextBudgetHeadId === 'UNALLOCATED') {
                alert('Please select a mapped budget head.');
                return;
            }
            const log = await window.AppDB.get('attendance', id);
            if (!log) {
                alert('Attendance entry not found.');
                return;
            }
            const nextErrors = Array.isArray(log.validationErrors)
                ? log.validationErrors.filter((msg) => !String(msg || '').toLowerCase().includes('budget head'))
                : [];
            const nextValidationStatus = nextErrors.length ? (log.validationStatus || 'incomplete') : 'compliant';
            const taskUpdates = Array.isArray(log.taskUpdates) ? log.taskUpdates : [];
            for (const update of taskUpdates) {
                const planId = String(update?.planId || '').trim();
                const taskIndex = Number(update?.taskIndex);
                if (!planId || !Number.isInteger(taskIndex)) continue;
                const plan = await window.AppDB.get('work_plans', planId).catch(() => null);
                if (!plan || !Array.isArray(plan.plans) || !plan.plans[taskIndex]) continue;
                plan.plans[taskIndex].budgetHeadId = nextBudgetHeadId;
                plan.plans[taskIndex].budgetHeadMappedAt = new Date().toISOString();
                plan.plans[taskIndex].budgetHeadMappedBy = window.AppAuth.getUser()?.name || 'Admin';
                plan.updatedAt = new Date().toISOString();
                await window.AppDB.put('work_plans', plan);
            }
            await window.AppDB.put('attendance', {
                ...log,
                budgetHeadId: nextBudgetHeadId,
                budgetHeadUnallocatedReason: '',
                validationErrors: nextErrors,
                validationStatus: nextValidationStatus,
                budgetHeadMappedAt: new Date().toISOString(),
                budgetHeadMappedBy: window.AppAuth.getUser()?.name || 'Admin'
            });
            const rowEl = triggerEl?.closest?.('.dashboard-tagged-item');
            if (rowEl) rowEl.remove();
            if (window.app_showSyncToast) window.app_showSyncToast('Budget head allocated.');
        } catch (err) {
            console.error('Failed to allocate budget head:', err);
            alert('Failed to allocate budget head: ' + (err?.message || err));
        }
    };

    window.app_assignBudgetHeadToTeamTask = async (planId, taskIndex, triggerEl = null) => {
        try {
            const safePlanId = String(planId || '').trim();
            if (!safePlanId || !Number.isInteger(Number(taskIndex))) {
                alert('Task reference missing for allocation.');
                return;
            }
            const sel = triggerEl?.previousElementSibling?.tagName === 'SELECT'
                ? triggerEl.previousElementSibling
                : null;
            const nextBudgetHeadId = String(sel?.value || '').trim();
            if (!nextBudgetHeadId || nextBudgetHeadId === 'UNALLOCATED') {
                alert('Select a mapped budget head first.');
                return;
            }
            const idx = Number(taskIndex);
            const plan = await window.AppDB.get('work_plans', safePlanId).catch(() => null);
            if (!plan || !Array.isArray(plan.plans) || !plan.plans[idx]) {
                alert('Work-plan task not found.');
                return;
            }
            plan.plans[idx].budgetHeadId = nextBudgetHeadId;
            plan.plans[idx].budgetHeadMappedAt = new Date().toISOString();
            plan.plans[idx].budgetHeadMappedBy = window.AppAuth.getUser()?.name || 'Admin';
            plan.updatedAt = new Date().toISOString();
            await window.AppDB.put('work_plans', plan);
            const rowEl = triggerEl?.closest?.('.dashboard-tagged-item');
            if (rowEl) rowEl.remove();
            if (window.app_showSyncToast) window.app_showSyncToast('Budget head allocated to team activity task.');
        } catch (err) {
            console.error('Failed to allocate budget head for team activity task:', err);
            alert('Failed to allocate budget head: ' + (err?.message || err));
        }
    };

    return `
        <div class="dashboard-grid dashboard-admin-view admin-grid-compact">
            ${cards.join('')}
        </div>`;
}

export async function renderStaffAiMemorySheet(auditStartDate = null, auditEndDate = null) {
    const currentUser = window.AppAuth?.getUser?.();
    if (!currentUser) {
        return '<div class="card">User state lost. Please sign in again.</div>';
    }

    const today = new Date().toISOString().split('T')[0];
    auditStartDate = String(auditStartDate || window.app_staffAiMemoryStartDate || today).trim() || today;
    auditEndDate = String(auditEndDate || window.app_staffAiMemoryEndDate || today).trim() || today;

    const canBrowseStaff = window.app_hasPerm('users', 'view', currentUser) || window.app_canSeeAdminPanel(currentUser);
    const [allUsers, pendingLeaves, recentAttendanceLogs, recentTeamActivities] = await Promise.all([
        window.AppDB.getAll('users').catch(() => []),
        window.AppLeaves?.getPendingLeaves ? window.AppLeaves.getPendingLeaves().catch(() => []) : Promise.resolve([]),
        window.AppDB.queryMany
            ? window.AppDB.queryMany('attendance', [{ field: 'date', operator: '>=', value: auditStartDate }]).catch(() => window.AppDB.getAll('attendance'))
            : window.AppDB.getAll('attendance'),
        window.AppAnalytics?.getAllStaffActivities
            ? window.AppAnalytics.getAllStaffActivities({
                mode: 'range',
                startIso: auditStartDate,
                endIso: auditEndDate,
                scope: 'work',
                sideEffects: false
            }).catch(() => [])
            : Promise.resolve([])
    ]);

    const allStaff = Array.isArray(allUsers) ? allUsers : [];
    const filteredAttendanceLogs = (Array.isArray(recentAttendanceLogs) ? recentAttendanceLogs : [])
        .filter((row) => {
            const rowDate = String(row?.date || '').trim();
            if (!rowDate) return true;
            return rowDate <= auditEndDate;
        });
    const canSwitchStaff = canBrowseStaff && (window.app_isAdminUser?.(currentUser) || window.app_hasPerm('users', 'admin', currentUser));
    const selectedStaffId = canSwitchStaff
        ? String(window.app_staffAiMemoryTargetUserId || currentUser.id || '').trim() || String(currentUser.id || '')
        : String(currentUser.id || '');
    const selectedStaff = canSwitchStaff
        ? (allStaff.find((user) => String(user.id || '') === selectedStaffId) || currentUser)
        : currentUser;
    const staffMemory = await (window.AppAIContextFeeder?.getStaffContextPack
        ? window.AppAIContextFeeder.getStaffContextPack(selectedStaff, { force: false })
        : Promise.resolve(null));
    const staffMemoryPack = staffMemory || {
        sourceScope: 'No staff memory available yet',
        historyAvailable: false,
        summary: {
            narrative: '',
            taskTypes: [],
            budgetHeads: [],
            collaborators: [],
            steps: [],
            events: [],
            attendance: ''
        },
        recentPlans: [],
        recentActivities: [],
        attendanceSummary: null,
        tagHistorySummary: [],
        notificationSummary: []
    };

    const adminAiWorkspace = buildAdminAiReportContext({
        auditStartDate,
        auditEndDate,
        allUsers: allStaff,
        pendingLeaves,
        recentAttendanceLogs: filteredAttendanceLogs,
        recentTeamActivities
    });
    updateAdminAiWorkspace(adminAiWorkspace.context, adminAiWorkspace.sourceScope);

    const pickerOptions = canBrowseStaff
        ? allStaff.map((u) => `<option value="${safeHtml(String(u.id || ''))}" ${String(u.id || '') === String(selectedStaffId) ? 'selected' : ''}>${safeHtml(String(u.name || 'Staff'))}</option>`).join('')
        : '';

    const formatDateTime = (value) => {
        const date = new Date(value || '');
        if (Number.isNaN(date.getTime())) return '--';
        return date.toLocaleString();
    };

    const renderPlanItems = (items = []) => {
        if (!Array.isArray(items) || !items.length) {
            return '<div class="staff-ai-memory-empty">No recent plans captured yet.</div>';
        }
        return items.slice(0, 6).map((plan) => `
            <div class="staff-ai-memory-item">
                <div class="staff-ai-memory-item-head">
                    <strong>${safeHtml(plan.date || '--')}</strong>
                    ${plan.budgetHeadLabel ? `<span class="staff-ai-memory-pill">${safeHtml(plan.budgetHeadLabel)}</span>` : ''}
                </div>
                <div class="staff-ai-memory-item-title">${safeHtml(plan.task || 'Untitled task')}</div>
                ${Array.isArray(plan.steps) && plan.steps.length ? `<div class="staff-ai-memory-mini-list">${plan.steps.slice(0, 3).map((step) => `<span>${safeHtml(step)}</span>`).join('')}</div>` : ''}
            </div>
        `).join('');
    };

    const renderActivityItems = (items = []) => {
        if (!Array.isArray(items) || !items.length) {
            return '<div class="staff-ai-memory-empty">No recent activity events captured yet.</div>';
        }
        return items.slice(0, 6).map((event) => `
            <div class="staff-ai-memory-item">
                <div class="staff-ai-memory-item-head">
                    <strong>${safeHtml(event.date || '--')}</strong>
                    <span class="staff-ai-memory-pill">${safeHtml(event.eventType || 'event')}</span>
                </div>
                <div class="staff-ai-memory-item-title">${safeHtml(event.note || 'No note')}</div>
            </div>
        `).join('');
    };

    const renderChipList = (items = [], emptyLabel = 'No data yet') => {
        if (!Array.isArray(items) || !items.length) {
            return `<div class="staff-ai-memory-empty">${safeHtml(emptyLabel)}</div>`;
        }
        return `<div class="staff-ai-memory-chip-list">${items.slice(0, 8).map((item) => `<span class="staff-ai-memory-chip">${safeHtml(String(item))}</span>`).join('')}</div>`;
    };

    const headerNote = canSwitchStaff
        ? 'Select one staff member to inspect their curated memory, then refresh or jump back to the staff dashboard anytime.'
        : 'You are viewing your own curated staff memory. Staff management users can switch between staff members.';
    const backHash = window.app_canSeeAdminPanel(currentUser) ? 'admin' : 'dashboard';

    window.app_refreshStaffAiMemorySheet = async (opts = {}) => {
        const start = String(opts?.startDate || document.getElementById('staff-ai-memory-start')?.value || auditStartDate || today).trim() || today;
        const end = String(opts?.endDate || document.getElementById('staff-ai-memory-end')?.value || auditEndDate || today).trim() || today;
        window.app_staffAiMemoryStartDate = start;
        window.app_staffAiMemoryEndDate = end;
        const contentArea = document.getElementById('page-content');
        if (contentArea) contentArea.innerHTML = await renderStaffAiMemorySheet(start, end);
    };

    window.app_changeStaffAiMemoryTarget = async (staffId) => {
        window.app_staffAiMemoryTargetUserId = String(staffId || currentUser.id || '').trim();
        const contentArea = document.getElementById('page-content');
        const start = String(document.getElementById('staff-ai-memory-start')?.value || auditStartDate || today).trim() || today;
        const end = String(document.getElementById('staff-ai-memory-end')?.value || auditEndDate || today).trim() || today;
        if (contentArea) contentArea.innerHTML = await renderStaffAiMemorySheet(start, end);
    };

    return `
        <div class="dashboard-admin-view staff-ai-memory-sheet">
            <section class="staff-ai-memory-hero card">
                <div class="staff-ai-memory-hero-copy">
                    <span class="staff-ai-memory-kicker">Staff Management</span>
                    <h2 class="staff-ai-memory-title">AI Memory Viewer</h2>
                    <p class="staff-ai-memory-note">${safeHtml(headerNote)}</p>
                </div>
                <div class="staff-ai-memory-hero-actions">
                    <label class="staff-ai-memory-field">
                        <span>From</span>
                        <input id="staff-ai-memory-start" type="date" value="${safeHtml(auditStartDate)}">
                    </label>
                    <label class="staff-ai-memory-field">
                        <span>To</span>
                        <input id="staff-ai-memory-end" type="date" value="${safeHtml(auditEndDate)}">
                    </label>
                    <button type="button" class="action-btn secondary" data-ts-action="refresh-staff-ai-memory"><i class="fa-solid fa-arrows-rotate"></i> Refresh</button>
                    <button type="button" class="action-btn secondary" data-ts-action="hash-navigate" data-hash="${backHash}"><i class="fa-solid fa-arrow-left"></i> Back</button>
                </div>
            </section>

            <div class="staff-ai-memory-grid">
                <section class="card staff-ai-memory-card">
                    <div class="staff-ai-memory-card-head">
                        <div>
                            <h3>Selected Staff Memory</h3>
                            <p>Curated from plans, activity, attendance, tags, and notifications. Raw dumps stay out.</p>
                        </div>
                        <div class="staff-ai-memory-meta">
                            <span class="staff-ai-memory-badge">${safeHtml(selectedStaff.name || 'Staff')}</span>
                            <span class="staff-ai-memory-badge">${safeHtml(selectedStaff.role || 'Employee')}</span>
                            ${canSwitchStaff ? `
                                <select id="staff-ai-memory-user" class="staff-ai-memory-select" onchange="window.app_changeStaffAiMemoryTarget?.(this.value)">
                                    ${pickerOptions}
                                </select>
                            ` : ''}
                        </div>
                    </div>

                    <div class="staff-ai-memory-summary">
                        <div class="staff-ai-memory-summary-title">Memory Snapshot</div>
                        <p>${safeHtml(staffMemoryPack.summary?.narrative || 'No memory summary available yet.')}</p>
                    </div>

                    <div class="staff-ai-memory-chip-group">
                        <div>
                            <div class="staff-ai-memory-label">Source Scope</div>
                            <div class="staff-ai-memory-muted">${safeHtml(staffMemoryPack.sourceScope || 'No staff memory available yet')}</div>
                        </div>
                        <div>
                            <div class="staff-ai-memory-label">Updated</div>
                            <div class="staff-ai-memory-muted">${safeHtml(formatDateTime(staffMemoryPack.updatedAt || ''))}</div>
                        </div>
                        <div>
                            <div class="staff-ai-memory-label">History</div>
                            <div class="staff-ai-memory-muted">${staffMemoryPack.historyAvailable ? 'Available' : 'Empty or rebuilding'}</div>
                        </div>
                    </div>

                    <div class="staff-ai-memory-section">
                        <div class="staff-ai-memory-section-title">Recurring Task Types</div>
                        ${renderChipList(staffMemoryPack.summary?.taskTypes || [], 'No task patterns yet.')}
                    </div>

                    <div class="staff-ai-memory-section">
                        <div class="staff-ai-memory-section-title">Frequent Budget Heads</div>
                        ${renderChipList((staffMemoryPack.summary?.budgetHeads || []).map((item) => item?.label || item?.value || item), 'No budget-head pattern yet.')}
                    </div>

                    <div class="staff-ai-memory-section">
                        <div class="staff-ai-memory-section-title">Recurring Collaborators</div>
                        ${renderChipList(staffMemoryPack.summary?.collaborators || [], 'No collaborators recorded yet.')}
                    </div>

                    <div class="staff-ai-memory-section">
                        <div class="staff-ai-memory-section-title">Recent Step Patterns</div>
                        ${renderChipList(staffMemoryPack.summary?.steps || [], 'No step patterns captured yet.')}
                    </div>

                    <div class="staff-ai-memory-section">
                        <div class="staff-ai-memory-section-title">Attendance Summary</div>
                        <p class="staff-ai-memory-muted">${safeHtml(staffMemoryPack.summary?.attendance || 'No attendance summary available yet.')}</p>
                    </div>

                    <div class="staff-ai-memory-two-col">
                        <div class="staff-ai-memory-section">
                            <div class="staff-ai-memory-section-title">Recent Plans</div>
                            <div class="staff-ai-memory-list">${renderPlanItems(staffMemoryPack.recentPlans || [])}</div>
                        </div>
                        <div class="staff-ai-memory-section">
                            <div class="staff-ai-memory-section-title">Recent Activities</div>
                            <div class="staff-ai-memory-list">${renderActivityItems(staffMemoryPack.recentActivities || [])}</div>
                        </div>
                    </div>

                    <div class="staff-ai-memory-section staff-ai-memory-footnote">
                        Only curated summaries are shown here. Salaries, tokens, private notes, and raw database dumps are excluded by design.
                    </div>
                </section>

                <section class="card staff-ai-memory-card">
                    <div class="staff-ai-memory-card-head">
                        <div>
                            <h3>Privacy-first summary</h3>
                            <p>Report Narration from the selected source scope. The output stays editable and scoped.</p>
                        </div>
                    </div>
                    ${renderAdminAiNarrationPanel({
                        sourceScope: adminAiWorkspace.sourceScope,
                        compact: false,
                        title: 'Report Narration',
                        copy: 'Generate an editable summary from the selected source scope.'
                    })}
                    <div class="staff-ai-memory-section staff-ai-memory-footnote">
                        Source scope: ${safeHtml(adminAiWorkspace.sourceScope || 'Unknown')}
                    </div>
                </section>
            </div>
        </div>
    `;
}
