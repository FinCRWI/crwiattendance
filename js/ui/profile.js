/**
 * Profile Component — Premium Redesign
 * Hero banner + stats + real leave data + sign-out
 */

import { safeHtml } from './helpers.js';

export async function renderProfile() {
    try {
        const user = window.AppAuth.getUser();
        if (!user) return '<div class="card">User state lost. Please <a href="#" onclick="window.AppAuth.logout()">Login Again</a></div>';

        const isAdmin = user.role === 'Administrator' || user.isAdmin;
        const allUsers = isAdmin ? await window.AppDB.getAll('users') : [];
        const targetProfileId = (isAdmin && window.app_profileTargetUserId) ? window.app_profileTargetUserId : user.id;
        const profileUser = (isAdmin ? (allUsers.find(u => u.id === targetProfileId) || user) : user);

        const deriveEmployeeId = (joinDateRaw, userIdRaw) => {
            const raw = String(joinDateRaw || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'NA';
            const compact = raw.replace(/-/g, '');
            const suffix = String(userIdRaw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(-3) || 'USR';
            return `EMP-${compact}-${suffix}`;
        };

        const profileJoinDate = (typeof profileUser.joinDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(profileUser.joinDate))
            ? profileUser.joinDate : '';
        const profileEmployeeId = profileJoinDate
            ? (profileUser.employeeId || deriveEmployeeId(profileJoinDate, profileUser.id))
            : 'NA';
        const profileBirthDay = Number(profileUser.birthDay || 0);
        const profileBirthMonth = Number(profileUser.birthMonth || 0);
        const profileBirthYear = Number(profileUser.birthYear || 0);
        const profileBirthday = [
            profileBirthDay ? String(profileBirthDay).padStart(2, '0') : '--',
            (profileBirthMonth >= 1 && profileBirthMonth <= 12)
                ? new Date(2026, profileBirthMonth - 1, 1).toLocaleString('en-US', { month: 'long' })
                : '--',
            profileBirthYear ? String(profileBirthYear) : ''
        ].filter(Boolean).join(' ').trim();

        const [monthlyStats, yearlyStats, leaves] = await Promise.all([
            window.AppAnalytics ? window.AppAnalytics.getUserMonthlyStats(profileUser.id) : null,
            window.AppAnalytics ? window.AppAnalytics.getUserYearlyStats(profileUser.id) : null,
            window.AppLeaves ? window.AppLeaves.getUserLeaves(profileUser.id) : []
        ]);

        window.app_changeProfileStaff = async (staffId) => {
            window.app_profileTargetUserId = staffId || user.id;
            const contentArea = document.getElementById('page-content');
            if (contentArea) contentArea.innerHTML = await renderProfile();
        };

        window.app_confirmSignOut = () => {
            if (confirm('Are you sure you want to sign out?')) {
                window.AppAuth.logout();
            }
        };

        const isViewingSelf = profileUser.id === user.id;
        const attendanceRate = monthlyStats?.attendanceRate ?? '—';
        const punctualityRate = monthlyStats?.punctualityRate ?? '—';
        const totalHours = monthlyStats?.totalHours ?? '—';
        const yearlyDays = yearlyStats?.totalDays ?? '—';

        const statusColor = (s) => {
            if (s === 'Approved') return '#16a34a';
            if (s === 'Rejected') return '#dc2626';
            return '#d97706';
        };

        const initials = (profileUser.name || 'U').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();

        return `
            <div class="pro-profile-root">

                <!-- ── Hero Banner ── -->
                <div class="pro-profile-hero">
                    <div class="pro-profile-hero-bg"></div>
                    <div class="pro-profile-hero-inner">
                        <!-- Avatar -->
                        <div class="pro-profile-avatar-ring">
                            ${profileUser.avatar
                ? `<img src="${safeHtml(profileUser.avatar)}" alt="${safeHtml(profileUser.name)}" class="pro-profile-avatar-img">`
                : `<div class="pro-profile-avatar-initials">${initials}</div>`}
                            <span class="pro-profile-status-dot ${profileUser.status === 'in' ? 'online' : 'offline'}"
                                  title="${profileUser.status === 'in' ? 'Currently checked in' : 'Not checked in'}"></span>
                        </div>

                        <!-- Identity -->
                        <div class="pro-profile-identity">
                            <div class="pro-profile-name-row">
                                <h1 class="pro-profile-name">${safeHtml(profileUser.name)}</h1>
                                <span class="pro-profile-role-badge">${safeHtml(profileUser.role || 'Staff')}</span>
                            </div>
                            <div class="pro-profile-email">
                                <i class="fa-solid fa-envelope"></i>
                                ${safeHtml(profileUser.email || '—')}
                            </div>
                            <div class="pro-profile-meta-row">
                                <span class="pro-profile-chip">
                                    <i class="fa-solid fa-id-card"></i>${safeHtml(profileEmployeeId)}
                                </span>
                                ${profileJoinDate ? `<span class="pro-profile-chip">
                                    <i class="fa-solid fa-calendar-check"></i>Joined ${profileJoinDate}
                                </span>` : ''}
                                ${profileUser.department ? `<span class="pro-profile-chip">
                                    <i class="fa-solid fa-building"></i>${safeHtml(profileUser.department)}
                                </span>` : ''}
                            </div>
                        </div>

                        <!-- Header Actions -->
                        <div class="pro-profile-header-actions">
                            ${isAdmin ? `
                            <select class="pro-profile-staff-picker" onchange="window.app_changeProfileStaff(this.value)">
                                <option value="">My Profile</option>
                                ${allUsers.map(u => `<option value="${u.id}" ${u.id === targetProfileId ? 'selected' : ''}>${safeHtml(u.name)}</option>`).join('')}
                            </select>` : ''}
                            ${isViewingSelf ? `
                            <button class="pro-profile-signout-btn" onclick="window.app_confirmSignOut()" title="Sign Out">
                                <i class="fa-solid fa-right-from-bracket"></i>
                                Sign Out
                            </button>` : ''}
                        </div>
                    </div>
                </div>

                <!-- ── Stats Strip ── -->
                <div class="pro-profile-stats-strip">
                    <div class="pro-stat-tile">
                        <i class="fa-solid fa-circle-check pro-stat-icon" style="color:#6366f1;"></i>
                        <div class="pro-stat-value">${attendanceRate}${typeof attendanceRate === 'number' ? '%' : ''}</div>
                        <div class="pro-stat-label">Attendance</div>
                    </div>
                    <div class="pro-stat-tile">
                        <i class="fa-solid fa-clock pro-stat-icon" style="color:#f59e0b;"></i>
                        <div class="pro-stat-value">${punctualityRate}${typeof punctualityRate === 'number' ? '%' : ''}</div>
                        <div class="pro-stat-label">Punctuality</div>
                    </div>
                    <div class="pro-stat-tile">
                        <i class="fa-solid fa-hourglass-half pro-stat-icon" style="color:#10b981;"></i>
                        <div class="pro-stat-value">${totalHours}${typeof totalHours === 'number' ? 'h' : ''}</div>
                        <div class="pro-stat-label">Hours (MTD)</div>
                    </div>
                    <div class="pro-stat-tile">
                        <i class="fa-solid fa-calendar-days pro-stat-icon" style="color:#8b5cf6;"></i>
                        <div class="pro-stat-value">${yearlyDays}</div>
                        <div class="pro-stat-label">Days (YTD)</div>
                    </div>
                </div>

                <!-- ── Body Grid ── -->
                <div class="pro-profile-body">

                    <!-- Left: Leave History -->
                    <div class="pro-profile-main">
                        <div class="pro-card">
                            <div class="pro-card-head">
                                <span class="pro-card-title"><i class="fa-solid fa-umbrella-beach"></i> Leave History</span>
                                <span class="pro-card-sub">${leaves.length} record${leaves.length !== 1 ? 's' : ''}</span>
                            </div>
                            ${leaves.length ? `
                            <table class="pro-leave-table">
                                <thead>
                                    <tr>
                                        <th>From</th>
                                        <th>To</th>
                                        <th>Type</th>
                                        <th>Days</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${leaves.slice(0, 8).map(l => `
                                    <tr>
                                        <td>${safeHtml(l.startDate || '—')}</td>
                                        <td>${safeHtml(l.endDate || '—')}</td>
                                        <td>${safeHtml(l.type || '—')}</td>
                                        <td>${l.daysCount ?? '—'}</td>
                                        <td>
                                            <span class="pro-status-pill" style="background:${statusColor(l.status)}18;color:${statusColor(l.status)};">
                                                ${safeHtml(l.status || 'Pending')}
                                            </span>
                                        </td>
                                    </tr>`).join('')}
                                </tbody>
                            </table>
                            ${leaves.length > 8 ? `<div class="pro-table-footer">Showing 8 of ${leaves.length} records</div>` : ''}
                            ` : `<div class="pro-empty-state"><i class="fa-regular fa-folder-open"></i><p>No leave records found.</p></div>`}
                        </div>

                        <!-- Yearly Breakdown -->
                        ${yearlyStats?.breakdown ? `
                        <div class="pro-card" style="margin-top:1rem;">
                            <div class="pro-card-head">
                                <span class="pro-card-title"><i class="fa-solid fa-chart-bar"></i> Yearly Breakdown</span>
                                <span class="pro-card-sub">${yearlyStats.label || ''}</span>
                            </div>
                            <div class="pro-breakdown-grid">
                                ${Object.entries(yearlyStats.breakdown || {}).filter(([, v]) => v > 0).map(([k, v]) => `
                                <div class="pro-breakdown-chip">
                                    <span class="pro-breakdown-count">${v}</span>
                                    <span class="pro-breakdown-key">${safeHtml(k)}</span>
                                </div>`).join('')}
                            </div>
                        </div>` : ''}
                    </div>

                    <!-- Right Sidebar -->
                    <aside class="pro-profile-side">

                        <!-- Employment -->
                        <div class="pro-card">
                            <div class="pro-card-head">
                                <span class="pro-card-title"><i class="fa-solid fa-briefcase"></i> Employment</span>
                            </div>
                            <div class="pro-detail-list">
                                ${[
                ['Department', profileUser.department || 'Operations'],
                ['Role', profileUser.role || 'Staff'],
                ['Level', profileUser.level || '—'],
                ['Reports To', profileUser.reportsTo || 'Admin'],
                ['Employee ID', profileEmployeeId],
                ['Join Date', profileJoinDate || 'N/A'],
                ['Birthday', profileBirthday || 'N/A'],
                ['Payroll Cycle', 'Monthly (25th)'],
            ].map(([label, value]) => `
                                <div class="pro-detail-row">
                                    <div class="pro-detail-label">${label}</div>
                                    <div class="pro-detail-value">${safeHtml(String(value))}</div>
                                </div>`).join('')}
                            </div>
                        </div>

                        <!-- Quick Actions -->
                        <div class="pro-card" style="margin-top:1rem;">
                            <div class="pro-card-head">
                                <span class="pro-card-title"><i class="fa-solid fa-bolt"></i> Quick Actions</span>
                            </div>
                            <div class="pro-quick-list">
                                <button class="pro-quick-item" onclick="window.location.hash='timesheet'">
                                    <span class="pro-quick-icon" style="background:#eef2ff;color:#4f46e5;"><i class="fa-solid fa-table-list"></i></span>
                                    <span>My Timesheet</span>
                                    <i class="fa-solid fa-chevron-right pro-quick-arrow"></i>
                                </button>
                                <button class="pro-quick-item" onclick="window.location.hash='leaves'">
                                    <span class="pro-quick-icon" style="background:#fef3c7;color:#d97706;"><i class="fa-solid fa-umbrella-beach"></i></span>
                                    <span>Apply Leave</span>
                                    <i class="fa-solid fa-chevron-right pro-quick-arrow"></i>
                                </button>
                                <button class="pro-quick-item" onclick="window.location.hash='analytics'">
                                    <span class="pro-quick-icon" style="background:#f0fdf4;color:#16a34a;"><i class="fa-solid fa-chart-line"></i></span>
                                    <span>My Analytics</span>
                                    <i class="fa-solid fa-chevron-right pro-quick-arrow"></i>
                                </button>
                                ${isViewingSelf ? `
                                <button class="pro-quick-item" onclick="window.app_linkTelegram()">
                                    <span class="pro-quick-icon" style="background:#eff6ff;color:#2563eb;"><i class="fa-brands fa-telegram"></i></span>
                                    <span>${profileUser.telegramChatId ? '✅ Telegram Linked' : 'Link Telegram'}</span>
                                    <i class="fa-solid fa-chevron-right pro-quick-arrow"></i>
                                </button>
                                <button class="pro-quick-item pro-quick-item-danger" onclick="window.app_confirmSignOut()">
                                    <span class="pro-quick-icon" style="background:#fef2f2;color:#dc2626;"><i class="fa-solid fa-right-from-bracket"></i></span>
                                    <span>Sign Out</span>
                                    <i class="fa-solid fa-chevron-right pro-quick-arrow"></i>
                                </button>` : ''}
                            </div>
                        </div>

                    </aside>
                </div>
            </div>
        `;
    } catch (err) {
        console.error('Profile Render Error:', err);
        return `<div class="card error-card">Failed to load profile: ${safeHtml(err.message)}</div>`;
    }
}
