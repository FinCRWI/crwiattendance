/**
 * UI Module (Main Entry)
 * Centrally exports all UI rendering components as ES Modules.
 * This file replaces the monolithic ui.js and provides backward compatibility.
 */

import {
    renderDashboard,
    renderHeroCard,
    renderWorkLog,
    renderActivityList,
    renderActivityLog,
    renderStaffActivityListSplit,
    renderStaffActivityColumn,
    renderStatsCard,
    renderBreakdown,
    renderLeaveRequests,
    renderLeaveHistory,
    renderNotificationPanel,
    renderTaggedItems,
    renderStaffDirectory
} from './ui/dashboard.js';

import { renderStaffDirectoryPage } from './ui/staff-directory.js';
import { renderAnnualPlan } from './ui/annual-plan.js';
import { renderTimesheet } from './ui/timesheet.js';
import { renderProfile } from './ui/profile.js';
import { renderMasterSheet } from './ui/master-sheet.js';
import { renderAdmin, renderStaffAiMemorySheet } from './ui/admin.js';
import { renderBirthdayCalendar } from './ui/birthday-calendar.js';
import { renderSalaryProcessing, renderPolicyTest } from './ui/payroll.js';
import { renderMinutes } from './ui/minutes-ui.js';
import { renderCheckInModal, renderCheckoutModal } from './ui/attendance-modals.js';
import { renderLogin } from './ui/auth-pages.js';
import { renderModals } from './ui/global-modals.js';
import { renderYearlyPlan } from './ui/team-schedule.js';
import { renderTeamActivitiesPage } from './ui/team-activities.js';
import { renderDashboardSectionPage, initDashboardSectionPage } from './ui/dashboard-sections.js';
import { renderLetterPad } from './ui/letter-pad.js';
import { renderJourneyReflectionCard } from './ui/journey-reflection.js';
import { initDashboardLayout, toggleEditMode, applyDashboardLayout, isEditModeActive } from './ui/dashboard-layout.js';
import { renderKanbanBoard, initKanbanBoard, startKanbanRealtimeListener, stopKanbanRealtimeListener } from './ui/kanban-board.js';
import { renderViewToggle, initViewToggle, ensureViewToggleCSS } from './ui/view-toggle.js';

// Re-export for ESM usage
export {
    renderDashboard,
    renderHeroCard,
    renderWorkLog,
    renderActivityList,
    renderActivityLog,
    renderStaffActivityListSplit,
    renderStaffActivityColumn,
    renderStatsCard,
    renderBreakdown,
    renderLeaveRequests,
    renderLeaveHistory,
    renderNotificationPanel,
    renderTaggedItems,
    renderStaffDirectory,
    renderStaffDirectoryPage,
    renderAnnualPlan,
    renderTimesheet,
    renderProfile,
    renderMasterSheet,
    renderAdmin,
    renderStaffAiMemorySheet,
    renderBirthdayCalendar,
    renderSalaryProcessing,
    renderPolicyTest,
    renderMinutes,
    renderCheckInModal,
    renderCheckoutModal,
    renderLogin,
    renderModals,
    renderYearlyPlan,
    renderTeamActivitiesPage,
    renderDashboardSectionPage,
    initDashboardSectionPage,
    renderLetterPad,
    renderJourneyReflectionCard,
    initDashboardLayout,
    toggleEditMode,
    applyDashboardLayout,
    isEditModeActive,
    renderKanbanBoard,
    initKanbanBoard,
    startKanbanRealtimeListener,
    stopKanbanRealtimeListener,
    renderViewToggle,
    initViewToggle,
    ensureViewToggleCSS
};

export const AppUI = {
    renderDashboard,
    renderHeroCard,
    renderWorkLog,
    renderActivityList,
    renderActivityLog,
    renderStaffActivityListSplit,
    renderStaffActivityColumn,
    renderStatsCard,
    renderBreakdown,
    renderLeaveRequests,
    renderLeaveHistory,
    renderNotificationPanel,
    renderTaggedItems,
    renderStaffDirectory,
    renderStaffDirectoryPage,
    renderAnnualPlan,
    renderTimesheet,
    renderProfile,
    renderMasterSheet,
    renderAdmin,
    renderStaffAiMemorySheet,
    renderBirthdayCalendar,
    renderSalaryProcessing,
    renderPolicyTest,
    renderMinutes,
    renderCheckInModal,
    renderCheckoutModal,
    renderLogin,
    renderModals,
    renderYearlyPlan,
    renderTeamActivitiesPage,
    renderDashboardSectionPage,
    initDashboardSectionPage,
    renderLetterPad,
    renderJourneyReflectionCard,
    initDashboardLayout,
    toggleEditMode,
    applyDashboardLayout,
    isEditModeActive,
    renderKanbanBoard,
    initKanbanBoard,
    startKanbanRealtimeListener,
    stopKanbanRealtimeListener,
    renderViewToggle,
    initViewToggle,
    ensureViewToggleCSS
};


if (typeof window !== 'undefined') {
    window.AppUI = AppUI;
}

export default AppUI;
