/**
 * Global Modals Component
 * Renders shared modals used across the application.
 */

import { renderCheckoutModal } from './checkout-form.js';
import { onAction } from '../utils/action-router.js';

if (!window._globalModalActionsRegistered) {
    window._globalModalActionsRegistered = true;

    onAction('set-duration', (el) => {
        const mins = Number(el.dataset.minutes) || 0;
        if (mins > 0) document.dispatchEvent(new CustomEvent('set-duration', { detail: mins }));
    });

    onAction('set-location-preset', (el) => {
        const value = el.dataset.location || '';
        if (value) document.getElementById('log-location').value = value;
    });

    onAction('hide-modal', (el) => {
        const id = el.dataset.target || '';
        if (id) document.getElementById(id).style.display = 'none';
    });
}

export function renderModals() {
    const _user = window.AppAuth?.getUser();
    const budgetSelectHtml = typeof window.app_renderBudgetHeadOptions === 'function'
        ? window.app_renderBudgetHeadOptions('')
        : '<option value="UNALLOCATED">Unallocated / To Be Mapped</option>';

    return `
        ${renderCheckoutModal(budgetSelectHtml)}

        <!-- Add Log Modal (Modern) -->
        <div id="log-modal" class="modal-overlay gm-hidden">
            <div class="modal-content" style="width: 100%; max-width: 500px; padding: 0;">
                <div style="padding: 1.5rem; border-bottom: 1px solid #f3f4f6;">
                    <h3 style="margin: 0;">New Time Entry</h3>
                    <p style="color: #6b7280; font-size: 0.9rem; margin-top: 0.25rem;">Log past or off-site work</p>
                </div>
                
                <form id="manual-log-form" style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem;">
                    <div>
                        <label style="display:block; font-size:0.85rem; font-weight:500; color:#374151; margin-bottom:0.5rem;">Budget Head</label>
                        <select name="budgetHeadId" required style="width:100%; padding:0.75rem; border:1px solid #e5e7eb; border-radius:0.5rem; background:#fff;">
                            ${budgetSelectHtml}
                        </select>
                    </div>
                    <div>
                        <label class="gm-label-block">Date</label>
                        <input type="date" name="date" id="log-date" required style="width: 100%; padding: 0.75rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; background: #f9fafb; font-family: inherit;">
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <label class="gm-label-block">Start Time</label>
                            <input type="time" name="checkIn" id="log-start-time" required style="width: 100%; padding: 0.75rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; background: #fff; font-family: inherit;">
                        </div>
                        <div>
                            <label class="gm-label-block">End Time</label>
                            <input type="time" name="checkOut" id="log-end-time" required style="width: 100%; padding: 0.75rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; background: #fff; font-family: inherit;">
                        </div>
                    </div>

                    <div>
                        <label class="gm-label-block">Quick Duration</label>
                        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                            <button type="button" class="chip-btn" data-ts-action="set-duration" data-minutes="30">30m</button>
                            <button type="button" class="chip-btn" data-ts-action="set-duration" data-minutes="60">1h</button>
                            <button type="button" class="chip-btn" data-ts-action="set-duration" data-minutes="240">4h</button>
                            <button type="button" class="chip-btn" data-ts-action="set-duration" data-minutes="480">8h</button>
                        </div>
                    </div>

                     <div>
                        <label class="gm-label-block">Work Summary</label>
                        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem;">
                            <button type="button" class="chip-btn" data-ts-action="set-location-preset" data-location="Work - Home">🏠 Work - Home</button>
                            <button type="button" class="chip-btn" data-ts-action="set-location-preset" data-location="Training">🎓 Training</button>
                            <button type="button" class="chip-btn" data-ts-action="set-location-preset" data-location="Client Visit">🤝 Client Visit</button>
                            <button type="button" class="chip-btn" data-ts-action="set-location-preset" data-location="Field Work">🚧 Field Work</button>
                        </div>
                        <input type="text" name="workDescription" id="log-location" placeholder="Describe the work done..." required style="width: 100%; padding: 0.75rem; border: 1px solid #e5e7eb; border-radius: 0.5rem;">
                    </div>

                    <div style="display: flex; gap: 1rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #f3f4f6;">
                        <button type="button" data-ts-action="hide-modal" data-target="log-modal" style="flex: 1; padding: 0.75rem; border: 1px solid #e5e7eb; background: white; border-radius: 0.5rem; cursor: pointer; color: #374151; font-weight: 500;">Cancel</button>
                        <button type="submit" class="action-btn" style="flex: 2; padding: 0.75rem; border-radius: 0.5rem;">
                            <i class="fa-solid fa-check"></i> Save Entry
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Request Leave Modal -->
        <div id="leave-modal" class="modal-overlay gm-hidden">
            <div class="modal-content" style="width: 100%; max-width: 500px;">
                <h3>Request Leave</h3>
                <form id="leave-request-form" class="gm-flex-col-mt">
                    <div style="display: flex; gap: 1rem;">
                        <label class="gm-flex-fill">From
                            <input type="date" name="startDate" required style="width:100%; padding:0.5rem; border:1px solid #ddd; border-radius:0.5rem;">
                        </label>
                        <label class="gm-flex-fill">To
                            <input type="date" name="endDate" required style="width:100%; padding:0.5rem; border:1px solid #ddd; border-radius:0.5rem;">
                        </label>
                    </div>
                    <label>Type
                        <select name="type" required style="width:100%; padding:0.5rem; border:1px solid #ddd; border-radius:0.5rem;">
                            <option value="Half Day">Half Day</option>
                            <option value="Casual Leave">Casual Leave</option>
                            <option value="Sick Leave">Sick Leave</option>
                            <option value="Earned Leave">Earned Leave</option>
                            <option value="Paid Leave">Paid Leave</option>
                            <option value="Maternity Leave">Maternity Leave</option>
                            <option value="Retreat Leave">Retreat Leave</option>
                            <option value="Staff Development Leave">Staff Development Leave</option>
                            <option value="Regional Holidays">Regional Holidays</option>
                            <option value="National Holiday">National Holiday</option>
                            <option value="Holiday">Holiday</option>
                            <option value="Absent">Absent</option>
                            <option value="Work - Home">Work from Home</option>
                        </select>
                    </label>
                    <label>Reason
                        <textarea name="reason" rows="3" required style="width:100%; padding:0.5rem; border:1px solid #ddd; border-radius:0.5rem;"></textarea>
                        <div style="margin-top:0.35rem; font-size:0.75rem; color:#92400e; line-height:1.4;">Please mention the reason specifically. If the reason is vague or not clearly mentioned, the leave may not be sanctioned.</div>
                    </label>
                    <div class="gm-flex-gap">
                        <button type="button" data-ts-action="hide-modal" data-target="leave-modal" class="gm-card-flex">Cancel</button>
                        <button type="submit" class="action-btn" style="flex: 1; padding: 0.75rem; border-radius: 0.5rem; background: #be123c;">Submit Request</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Edit User Modal -->
        <div id="edit-user-modal" class="modal-overlay gm-hidden">
            <div class="modal-content">
                <h3>Edit Staff Details</h3>
                <form id="edit-user-form" class="gm-flex-col-mt">
                    <input type="hidden" name="id" id="edit-user-id">
                    <label>
                        Full Name
                        <input type="text" name="name" id="edit-user-name" required class="gm-input">
                    </label>
                    
                    <div style="display: flex; gap: 1rem; background: #fffbeb; padding: 1rem; border-radius: 0.5rem; border: 1px dashed #f59e0b;">
                        <label class="gm-flex-fill">
                            Login ID
                            <input type="text" name="username" id="edit-user-username" required class="gm-input">
                        </label>
                        <label class="gm-flex-fill">
                            Password
                            <input type="text" name="password" id="edit-user-password" required class="gm-input">
                        </label>
                    </div>

                    <label>
                        Role / Designation
                        <select name="role" id="edit-user-role" required class="gm-input" onchange="const cb = document.getElementById('edit-user-isAdmin'); cb.checked = (this.value === 'Administrator');">
                            <option value="Employee">Employee</option>
                            <option value="Administrator">Administrator</option>
                            <option value="Guest">Guest</option>
                            <option value="Intern">Intern</option>
                        </select>
                    </label>
                    <label>
                        Department
                        <select name="dept" id="edit-user-dept" required class="gm-input">
                            <option value="Administration">Administration</option>
                            <option value="IT Department">IT Department</option>
                            <option value="HR">HR</option>
                            <option value="Sales">Sales</option>
                            <option value="Operations">Operations</option>
                            <option value="General">General</option>
                        </select>
                    </label>
                    
                    <label style="display: flex; align-items: center; gap: 0.5rem; background: #f0f7ff; padding: 0.75rem; border-radius: 0.5rem; cursor: pointer;">
                        <input type="checkbox" name="isAdmin" id="edit-user-isAdmin" style="width: 1.2rem; height: 1.2rem;" onchange="const sel = document.getElementById('edit-user-role'); if(this.checked) { sel.value = 'Administrator'; } else { if(sel.value === 'Administrator') sel.value = 'Employee'; }">
                        <div style="font-weight: 600; color: #1e40af;">Grant Full Administrator Rights</div>
                    </label>

                    <div id="edit-user-permissions-panel" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 0.7rem; margin-top: 0.5rem;">
                        <div style="font-weight: 700; font-size: 0.85rem; color: #475569; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                            <i class="fa-solid fa-shield-halved"></i> Section-Specific Permissions
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 0.4rem; align-items: center;">
                            <div style="font-size: 0.7rem; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Section</div>
                            <div style="font-size: 0.7rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; text-align: center;">View Only</div>
                            <div style="font-size: 0.7rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; text-align: center;">Full Admin</div>

                            <div class="gm-text">Dashboard</div>
                            <input type="checkbox" class="perm-check gm-center" data-module="dashboard" data-level="view" id="edit-perm-dashboard-view">
                            <input type="checkbox" class="perm-check gm-center" data-module="dashboard" data-level="admin" id="edit-perm-dashboard-admin">

                            <div class="gm-text">Leaves</div>
                            <input type="checkbox" class="perm-check gm-center" data-module="leaves" data-level="view" id="edit-perm-leaves-view">
                            <input type="checkbox" class="perm-check gm-center" data-module="leaves" data-level="admin" id="edit-perm-leaves-admin">

                            <div class="gm-text">User Management</div>
                            <input type="checkbox" class="perm-check gm-center" data-module="users" data-level="view" id="edit-perm-users-view">
                            <input type="checkbox" class="perm-check gm-center" data-module="users" data-level="admin" id="edit-perm-users-admin">

                            <div class="gm-text">Attendance Sheet</div>
                            <input type="checkbox" class="perm-check gm-center" data-module="attendance" data-level="view" id="edit-perm-attendance-view">
                            <input type="checkbox" class="perm-check gm-center" data-module="attendance" data-level="admin" id="edit-perm-attendance-admin">

                            <div class="gm-text">Reports</div>
                            <input type="checkbox" class="perm-check gm-center" data-module="reports" data-level="view" id="edit-perm-reports-view">
                            <input type="checkbox" class="perm-check gm-center" data-module="reports" data-level="admin" id="edit-perm-reports-admin">

                            <div class="gm-text">Meeting Minutes</div>
                            <input type="checkbox" class="perm-check gm-center" data-module="minutes" data-level="view" id="edit-perm-minutes-view">
                            <input type="checkbox" class="perm-check gm-center" data-module="minutes" data-level="admin" id="edit-perm-minutes-admin">

                            <div class="gm-text">Company Policies</div>
                            <input type="checkbox" class="perm-check gm-center" data-module="policies" data-level="view" id="edit-perm-policies-view">
                            <input type="checkbox" class="perm-check gm-center" data-module="policies" data-level="admin" id="edit-perm-policies-admin">

                            <div class="gm-text">Birthday Calendar</div>
                            <input type="checkbox" class="perm-check gm-center" data-module="birthday" data-level="view" id="edit-perm-birthday-view">
                            <input type="checkbox" class="perm-check gm-center" data-module="birthday" data-level="admin" id="edit-perm-birthday-admin">

                            <div class="gm-text">Letter Pad</div>
                            <input type="checkbox" class="perm-check gm-center" data-module="letterPad" data-level="view" id="edit-perm-letterPad-view">
                            <input type="checkbox" class="perm-check gm-center" data-module="letterPad" data-level="admin" id="edit-perm-letterPad-admin">

                            <div class="gm-text">Dashboard Customization</div>
                            <input type="checkbox" class="perm-check gm-center" data-module="customize" data-level="view" id="edit-perm-customize-view">
                            <input type="checkbox" class="perm-check gm-center" data-module="customize" data-level="admin" id="edit-perm-customize-admin">

                            <div style="font-size: 0.82rem; color: #1e293b; display: flex; align-items: center; gap: 0.4rem;">
                                AI Memory Sheet
                                <label style="display: flex; align-items: center; gap: 0.3rem; font-weight: 400; font-size: 0.75rem; color: #475569; cursor: pointer;">
                                    <input type="checkbox" name="canAccessStaffAiMemory" id="edit-user-can-access-staff-ai-memory" style="width: 1rem; height: 1rem;">
                                    Allow access
                                </label>
                            </div>
                            <span></span>
                            <span></span>
                        </div>
                    </div>
                     <div style="display: flex; gap: 1rem;">
                        <label class="gm-flex-fill">
                            Email
                            <input type="email" name="email" id="edit-user-email" required class="gm-input">
                        </label>
                        <label class="gm-flex-fill">
                            Phone
                            <input type="tel" name="phone" id="edit-user-phone" required class="gm-input">
                        </label>
                    </div>
                    <div>
                        <div style="font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 0.45rem;">Date of Birth</div>
                        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:0.75rem;">
                            <label>
                                <span class="gm-hint">Day</span>
                                <input type="number" name="birthDay" id="edit-user-birth-day" min="1" max="31" placeholder="DD" class="gm-input">
                            </label>
                            <label>
                                <span class="gm-hint">Month</span>
                                <input type="number" name="birthMonth" id="edit-user-birth-month" min="1" max="12" placeholder="MM" class="gm-input">
                            </label>
                            <label>
                                <span class="gm-hint">Year</span>
                                <input type="number" name="birthYear" id="edit-user-birth-year" min="1900" max="2100" placeholder="YYYY" class="gm-input">
                            </label>
                        </div>
                        <div style="font-size:0.78rem; color:#64748b; margin-top:0.35rem;">You can save any one or more birthday fields. Day and month are required only for reminders.</div>
                    </div>
                    
                    <div class="gm-flex-gap">
                        <button type="button" data-ts-action="hide-modal" data-target="edit-user-modal" class="gm-card-flex">Cancel</button>
                        <button type="submit" class="action-btn" style="flex: 1; padding: 0.75rem; border-radius: 0.5rem;">Update Details</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- User Details Modal (Logs) -->
        <div id="user-details-modal" class="modal-overlay gm-hidden">
            <div class="modal-content" style="max-width: 700px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                    <h3>Staff Attendance Record</h3>
                    <button data-ts-action="hide-modal" data-target="user-details-modal" style="background:none; border:none; cursor:pointer; font-size:1.2rem;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div id="user-details-content">
                    <!-- Injected by JS -->
                </div>
            </div>
        </div>

        <!-- Send Notification Modal -->
         <div id="notify-modal" class="modal-overlay gm-hidden">
            <div class="modal-content">
                <h3>Send Notification</h3>
                <form id="notify-form" class="gm-flex-col-mt">
                    <input type="hidden" name="toUserId" id="notify-user-id">
                    <label>
                        Message
                        <textarea name="message" required rows="4" placeholder="Type your message here..." style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 0.5rem; font-family: inherit;"></textarea>
                    </label>
                    
                    <div class="gm-flex-gap">
                        <button type="button" data-ts-action="hide-modal" data-target="notify-modal" class="gm-card-flex">Cancel</button>
                        <button type="submit" class="action-btn" style="flex: 1; padding: 0.75rem; border-radius: 0.5rem;">Send Message</button>
                    </div>
                </form>
            </div>
        </div>
        
         <!-- Add User Modal -->
        <div id="add-user-modal" class="modal-overlay gm-hidden">
            <div class="modal-content">
                <h3>Create New Account</h3>
                <form id="add-user-form" class="gm-flex-col-mt">
                    <label>
                        Full Name
                        <input type="text" name="name" required class="gm-input">
                    </label>
                    
                    <div style="display: flex; gap: 1rem; background: #f9fafb; padding: 1rem; border-radius: 0.5rem; border: 1px dashed #d1d5db;">
                        <label class="gm-flex-fill">
                            Login ID
                            <input type="text" name="username" placeholder="e.g. jomit" required class="gm-input">
                        </label>
                        <label class="gm-flex-fill">
                            Password
                            <input type="text" name="password" placeholder="e.g. secret123" required class="gm-input">
                        </label>
                    </div>

                    <label>
                        Role / Designation
                        <select name="role" id="add-user-role" required class="gm-input" onchange="const cb = document.getElementById('add-user-isAdmin'); cb.checked = (this.value === 'Administrator');">
                            <option value="Employee">Employee</option>
                            <option value="Administrator">Administrator</option>
                            <option value="Guest">Guest</option>
                            <option value="Intern">Intern</option>
                        </select>
                    </label>
                    <label>
                        Department
                        <select name="dept" id="add-user-dept" required class="gm-input">
                            <option value="Administration">Administration</option>
                            <option value="IT Department">IT Department</option>
                            <option value="HR">HR</option>
                            <option value="Sales">Sales</option>
                            <option value="Operations">Operations</option>
                            <option value="General">General</option>
                        </select>
                    </label>

                    <label style="display: flex; align-items: center; gap: 0.5rem; background: #f0f7ff; padding: 0.75rem; border-radius: 0.5rem; cursor: pointer; margin-top: 0.5rem;">
                        <input type="checkbox" name="isAdmin" id="add-user-isAdmin" style="width: 1.2rem; height: 1.2rem;" onchange="const sel = document.getElementById('add-user-role'); if(this.checked) { sel.value = 'Administrator'; } else { if(sel.value === 'Administrator') sel.value = 'Employee'; }">
                        <div style="font-weight: 600; color: #1e40af;">Grant Full Administrator Rights</div>
                    </label>

                    <div id="add-user-permissions-panel" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 1rem; margin-top: 0.5rem;">
                        <div style="font-weight: 700; font-size: 0.85rem; color: #475569; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem;">
                            <i class="fa-solid fa-shield-halved"></i> Section-Specific Permissions
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 0.75rem; align-items: center;">
                            <div style="font-size: 0.75rem; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Section</div>
                            <div style="font-size: 0.75rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; text-align: center;">View Only</div>
                            <div style="font-size: 0.75rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; text-align: center;">Full Admin</div>
                            
                            <!-- Dashboard -->
                            <div class="gm-label">Dashboard</div>
                            <input type="checkbox" class="perm-check" data-module="dashboard" data-level="view" id="add-perm-dashboard-view">
                            <input type="checkbox" class="perm-check" data-module="dashboard" data-level="admin" id="add-perm-dashboard-admin">

                            <!-- Leaves -->
                            <div class="gm-label">Leaves</div>
                            <input type="checkbox" class="perm-check" data-module="leaves" data-level="view" id="add-perm-leaves-view">
                            <input type="checkbox" class="perm-check" data-module="leaves" data-level="admin" id="add-perm-leaves-admin">

                            <!-- Users -->
                            <div class="gm-label">User Management</div>
                            <input type="checkbox" class="perm-check" data-module="users" data-level="view" id="add-perm-users-view">
                            <input type="checkbox" class="perm-check" data-module="users" data-level="admin" id="add-perm-users-admin">

                            <!-- AI Memory -->
                            <div class="gm-label">AI Memory Sheet</div>
                            <input type="checkbox" name="canAccessStaffAiMemory" id="add-user-can-access-staff-ai-memory" style="width: 1.1rem; height: 1.1rem;">
                            <div style="font-size: 0.78rem; color: #475569;">Allow this staff member to open the AI memory sheet.</div>

                            <!-- Letter Pad -->
                            <div class="gm-label">Letter Pad</div>
                            <input type="checkbox" class="perm-check" data-module="letterPad" data-level="view" id="add-perm-letterPad-view">
                            <input type="checkbox" class="perm-check" data-module="letterPad" data-level="admin" id="add-perm-letterPad-admin">

                            <!-- Attendance -->
                            <div class="gm-label">Attendance Sheet</div>
                            <input type="checkbox" class="perm-check" data-module="attendance" data-level="view" id="add-perm-attendance-view">
                            <input type="checkbox" class="perm-check" data-module="attendance" data-level="admin" id="add-perm-attendance-admin">

                            <!-- Reports -->
                            <div class="gm-label">Reports</div>
                            <input type="checkbox" class="perm-check" data-module="reports" data-level="view" id="add-perm-reports-view">
                            <input type="checkbox" class="perm-check" data-module="reports" data-level="admin" id="add-perm-reports-admin">

                            <!-- Minutes -->
                            <div class="gm-label">Meeting Minutes</div>
                            <input type="checkbox" class="perm-check" data-module="minutes" data-level="view" id="add-perm-minutes-view">
                            <input type="checkbox" class="perm-check" data-module="minutes" data-level="admin" id="add-perm-minutes-admin">

                            <!-- Policies -->
                            <div class="gm-label">Company Policies</div>
                            <input type="checkbox" class="perm-check" data-module="policies" data-level="view" id="add-perm-policies-view">
                            <input type="checkbox" class="perm-check" data-module="policies" data-level="admin" id="add-perm-policies-admin">

                            <!-- Birthday -->
                            <div class="gm-label">Birthday Calendar</div>
                            <input type="checkbox" class="perm-check" data-module="birthday" data-level="view" id="add-perm-birthday-view">
                            <input type="checkbox" class="perm-check" data-module="birthday" data-level="admin" id="add-perm-birthday-admin">

                            <!-- Dashboard Customization -->
                            <div class="gm-label">Dashboard Customization</div>
                            <input type="checkbox" class="perm-check" data-module="customize" data-level="view" id="add-perm-customize-view">
                            <input type="checkbox" class="perm-check" data-module="customize" data-level="admin" id="add-perm-customize-admin">

                        </div>
                    </div>
                     <div style="display: flex; gap: 1rem;">
                        <label class="gm-flex-fill">
                            Email
                            <input type="email" name="email" required class="gm-input">
                        </label>
                        <label class="gm-flex-fill">
                            Phone
                            <input type="tel" name="phone" required class="gm-input">
                        </label>
                    </div>
                    <div>
                        <div style="font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 0.45rem;">Date of Birth</div>
                        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:0.75rem;">
                            <label>
                                <span class="gm-hint">Day</span>
                                <input type="number" name="birthDay" min="1" max="31" placeholder="DD" class="gm-input">
                            </label>
                            <label>
                                <span class="gm-hint">Month</span>
                                <input type="number" name="birthMonth" min="1" max="12" placeholder="MM" class="gm-input">
                            </label>
                            <label>
                                <span class="gm-hint">Year</span>
                                <input type="number" name="birthYear" min="1900" max="2100" placeholder="YYYY" class="gm-input">
                            </label>
                        </div>
                        <div style="font-size:0.78rem; color:#64748b; margin-top:0.35rem;">You can save any one or more birthday fields. Day and month are required only for reminders.</div>
                    </div>
                    <label>
                        Joining Date
                        <input type="date" name="joinDate" required class="gm-input">
                    </label>
                    
                    <div class="gm-flex-gap">
                        <button type="button" data-ts-action="hide-modal" data-target="add-user-modal" class="gm-card-flex">Cancel</button>
                        <button type="submit" class="action-btn" style="flex: 1; padding: 0.75rem; border-radius: 0.5rem;">Create Account</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}
