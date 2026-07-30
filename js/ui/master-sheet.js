/**
 * Master Sheet Component
 * Handles rendering of the administrative attendance grid for all staff.
 */

import { safeHtml } from './helpers.js';
import { AppConfig } from '../config.js';

export async function renderMasterSheet(month = null, year = null) {
    const currentUser = window.AppAuth.getUser();
    const canAdminAttendance = window.app_hasPerm('attendance', 'admin', currentUser);
    const users = (await window.AppDB.getAll('users')).filter(u => !AppConfig.isDemoUser(u));

    const now = new Date();
    const currentMonth = month !== null ? parseInt(month) : now.getMonth();
    const currentYear = year !== null ? parseInt(year) : now.getFullYear();

    // Filtered Query for Logs
    const startDateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
    const endDateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-31`;

    if (canAdminAttendance && typeof window.app_fixCurrentMonthFalseHalfDayLeaves === 'function') {
        try {
            await window.app_fixCurrentMonthFalseHalfDayLeaves({
                silent: true,
                year: currentYear,
                month: currentMonth + 1
            });
        } catch (e) {
            console.warn('MasterSheet: auto-fix for incorrect half-day leaves failed', e);
        }
    }

    // Fallback if query() doesn't exist or work as expected
    let filteredLogs = [];
    try {
        const logs = await window.AppDB.query('attendance', 'date', '>=', startDateStr);
        filteredLogs = logs.filter(l => l.date <= endDateStr);
    } catch (e) {
        console.warn("MasterSheet: query failed, fetching all attendance logs", e);
        const allLogs = await window.AppDB.getAll('attendance');
        filteredLogs = allLogs.filter(l => l.date >= startDateStr && l.date <= endDateStr);
    }

    let monthEvents = [];
    try {
        if (window.AppDB.queryMany) {
            monthEvents = await window.AppDB.queryMany('events', [
                { field: 'date', operator: '>=', value: startDateStr },
                { field: 'date', operator: '<=', value: endDateStr }
            ]);
        } else {
            const allEvents = await window.AppDB.getAll('events');
            monthEvents = (allEvents || []).filter((event) => {
                const date = String(event?.date || '').trim();
                return date >= startDateStr && date <= endDateStr;
            });
        }
    } catch (e) {
        console.warn('MasterSheet: events query failed, continuing without calendar holidays', e);
        monthEvents = [];
    }

    let configuredHolidays = [];
    try {
        if (window.AppPolicies?.getHolidaysForYear) {
            configuredHolidays = await window.AppPolicies.getHolidaysForYear(currentYear, false);
        } else {
            const holidaySettings = await window.AppDB.get('settings', 'holidays').catch(() => null);
            configuredHolidays = Array.isArray(holidaySettings?.byYear?.[String(currentYear)]) ? holidaySettings.byYear[String(currentYear)] : [];
        }
    } catch (e) {
        console.warn('MasterSheet: holiday settings lookup failed, continuing without configured holidays', e);
        configuredHolidays = [];
    }

    const normalizeEventDate = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return '';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const isHolidayEvent = (event) => {
        const type = String(event?.type || '').trim().toLowerCase();
        const title = String(event?.title || '').trim().toLowerCase();
        return type.includes('holiday') || title.includes('holiday');
    };

    const holidayEventsByDate = new Map();
    (monthEvents || []).forEach((event) => {
        if (!isHolidayEvent(event)) return;
        const dateStr = normalizeEventDate(event?.date);
        if (!dateStr || dateStr < startDateStr || dateStr > endDateStr) return;
        if (!holidayEventsByDate.has(dateStr)) holidayEventsByDate.set(dateStr, []);
        const title = String(event?.title || '').trim() || 'Holiday';
        holidayEventsByDate.get(dateStr).push(title);
    });
    (configuredHolidays || []).forEach((holiday) => {
        const dateStr = normalizeEventDate(holiday?.date);
        if (!dateStr || dateStr < startDateStr || dateStr > endDateStr) return;
        if (!holidayEventsByDate.has(dateStr)) holidayEventsByDate.set(dateStr, []);
        const title = String(holiday?.name || holiday?.title || 'Holiday').trim() || 'Holiday';
        holidayEventsByDate.get(dateStr).push(title);
    });

    // Days in selected month
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    const getWeekendPolicy = (dateStr) => {
        const d = new Date(`${dateStr}T00:00:00`);
        const day = d.getDay(); // 0=Sun, 6=Sat
        if (day === 0) return 'holiday';
        if (day === 6) {
            const nthSaturday = Math.floor((d.getDate() - 1) / 7) + 1;
            if (nthSaturday === 2 || nthSaturday === 4) return 'holiday';
            if (nthSaturday === 1 || nthSaturday === 3 || nthSaturday === 5) return 'halfday';
        }
        return 'working';
    };

    const isLeaveLog = (log) => {
        const t = String(log?.type || '');
        return t.includes('Leave') || log?.location === 'On Leave';
    };

    const isActualCheckoutLog = (log) => {
        if (!log || !log.checkOut || log.checkOut === 'Active Now') return false;
        return (
            typeof log.activityScore !== 'undefined' ||
            typeof log.locationMismatched !== 'undefined' ||
            !!log.checkOutLocation ||
            typeof log.outLat !== 'undefined' ||
            typeof log.outLng !== 'undefined'
        );
    };
    const convertTo24h = (timeStr) => {
        const raw = String(timeStr || '').trim();
        if (!raw) return '00:00';
        if (/^\d{2}:\d{2}$/.test(raw)) return raw;
        const [time, ampmRaw] = raw.split(' ');
        if (!time) return '00:00';
        let [h, m] = time.split(':');
        let hours = Number(h);
        const ampm = String(ampmRaw || '').toUpperCase();
        if (ampm === 'PM' && hours < 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
        return `${String(Number.isFinite(hours) ? hours : 0).padStart(2, '0')}:${String(m || '00').padStart(2, '0')}`;
    };

    const getWorkedMs = (log) => {
        if (!log || !log.checkIn || !log.checkOut || log.checkOut === 'Active Now' || !log.date) return 0;
        const in24 = convertTo24h(log.checkIn);
        const out24 = convertTo24h(log.checkOut);
        const inDt = window.AppAttendance?.buildDateTime?.(log.date, in24);
        const outDt = window.AppAttendance?.buildDateTime?.(log.date, out24);
        if (!(inDt && outDt && outDt > inDt)) return 0;
        return outDt - inDt;
    };

    const getAutoClosureNote = (log) => {
        if (!log || !log.autoCheckout) return '';
        if (String(log.missedCheckoutReasonStatus || '').toLowerCase() === 'approved' || log.missedCheckoutApprovedAsFullDay) {
            return 'Auto-closed due to missed checkout. Admin approved and converted this entry to full day.';
        }
        if (String(log.missedCheckoutReasonStatus || '').toLowerCase() === 'rejected') {
            return 'Auto-closed due to missed checkout. Admin rejected the submitted reason.';
        }
        if (String(log.missedCheckoutReasonStatus || '').toLowerCase() === 'approved') {
            return 'Auto-closed due to missed checkout. Admin approved the submitted reason.';
        }
        return 'Auto-closed due to missed checkout.';
    };

    const getLogPriority = (log) => {
        if (log?.isManualOverride) return 4;
        if (isActualCheckoutLog(log) && getWorkedMs(log) >= (8 * 60 * 60 * 1000)) return 3.5;
        if (isLeaveLog(log)) return 3;
        if (isActualCheckoutLog(log)) return 2;
        return 1;
    };

    const isAttendanceEligibleLog = (log) => {
        if (Object.prototype.hasOwnProperty.call(log || {}, 'attendanceEligible')) {
            return log.attendanceEligible === true;
        }
        const src = String(log?.entrySource || '');
        if (src === 'staff_manual_work') return false;
        if (src === 'admin_override' || src === 'checkin_checkout') return true;
        if (log?.isManualOverride) return true;
        if (log?.location === 'Office (Manual)' || log?.location === 'Office (Override)') return true;
        const hasSystemSignals =
            typeof log?.activityScore !== 'undefined' ||
            typeof log?.locationMismatched !== 'undefined' ||
            typeof log?.autoCheckout !== 'undefined' ||
            !!log?.checkOutLocation ||
            typeof log?.outLat !== 'undefined' ||
            typeof log?.outLng !== 'undefined';
        if (hasSystemSignals) return true;
        const type = String(log?.type || '');
        return type.includes('Leave') || log?.location === 'On Leave';
    };

    const todayIso = new Date().toISOString().split('T')[0];
    const toLocalIso = (value) => {
        const d = new Date(value);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    // UI Handlers attached to window
    window.app_refreshMasterSheet = async () => {
        const m = document.getElementById('sheet-month')?.value;
        const y = document.getElementById('sheet-year')?.value;
        const contentArea = document.getElementById('page-content');
        if (contentArea) contentArea.innerHTML = await renderMasterSheet(m, y);
    };
    window.app_runHalfDayLeaveFixForVisibleMonth = async () => {
        if (!canAdminAttendance || typeof window.app_fixCurrentMonthFalseHalfDayLeaves !== 'function') return;
        const monthValue = Number(document.getElementById('sheet-month')?.value);
        const yearValue = Number(document.getElementById('sheet-year')?.value);
        const month = Number.isFinite(monthValue) ? monthValue + 1 : (new Date().getMonth() + 1);
        const year = Number.isFinite(yearValue) ? yearValue : new Date().getFullYear();
        await window.app_fixCurrentMonthFalseHalfDayLeaves({
            silent: false,
            year,
            month
        });
        await window.app_refreshMasterSheet();
    };

    return `
        <div class="dashboard-grid dashboard-admin-view">
            <div class="card full-width">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
                    <div>
                        <h2 style="font-size:1.1rem; margin-bottom:0.1rem;">Attendance Sheet</h2>
                        <p style="color:var(--text-muted); font-size:0.75rem;">Master grid view for all staff logs, including Work From Home (WFH).</p>
                    </div>
                    <div style="display:flex; gap:0.5rem; align-items:center;">
                        <select onchange="window.app_refreshMasterSheet()" id="sheet-month" style="padding:0.4rem; border-radius:6px; border:1px solid #ddd; font-size:0.8rem;">
                            ${monthNames.map((m, i) => `<option value="${i}" ${i === currentMonth ? 'selected' : ''}>${m}</option>`).join('')}
                        </select>
                        <select onchange="window.app_refreshMasterSheet()" id="sheet-year" style="padding:0.4rem; border-radius:6px; border:1px solid #ddd; font-size:0.8rem;">
                            <option value="${currentYear}" selected>${currentYear}</option>
                            <option value="${currentYear - 1}">${currentYear - 1}</option>
                        </select>
                        ${canAdminAttendance ? `
                        <button onclick="window.app_runHalfDayLeaveFixForVisibleMonth()" class="action-btn secondary" style="padding:0.4rem 0.75rem; font-size:0.8rem;">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Fix Incorrect Half Day Leaves
                        </button>
                        <button onclick="window.app_syncLeaveCategoriesForVisibleMonth()" class="action-btn secondary" style="padding:0.4rem 0.75rem; font-size:0.8rem;">
                            <i class="fa-solid fa-arrows-rotate"></i> Sync Leave Categories
                        </button>
                        <button onclick="window.app_exportMasterSheet()" class="action-btn secondary" style="padding:0.4rem 0.75rem; font-size:0.8rem;">
                            <i class="fa-solid fa-file-excel"></i> Export Excel
                        </button>
                        ` : ''}
                    </div>
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.65rem; font-size:0.72rem; color:#475569;">
                    <span style="padding:0.2rem 0.45rem; border:1px solid #e2e8f0; border-radius:999px; background:#f8fafc;"><strong>P</strong> = Present</span>
                    <span style="padding:0.2rem 0.45rem; border:1px solid #e2e8f0; border-radius:999px; background:#fff7ed;"><strong>L</strong> = Late</span>
                    <span style="padding:0.2rem 0.45rem; border:1px solid #e2e8f0; border-radius:999px; background:#fff7ed;"><strong>HD</strong> = Half Day</span>
                    <span style="padding:0.2rem 0.45rem; border:1px solid #e2e8f0; border-radius:999px; background:#fef2f2;"><strong>A</strong> = Absent</span>
                    <span style="padding:0.2rem 0.45rem; border:1px solid #e2e8f0; border-radius:999px; background:#f5f3ff;"><strong>C</strong> = Leave (other)</span>
                    <span style="padding:0.2rem 0.45rem; border:1px solid #e2e8f0; border-radius:999px; background:#ecfeff;"><strong>RL</strong> = Retreat Leave</span>
                    <span style="padding:0.2rem 0.45rem; border:1px solid #e2e8f0; border-radius:999px; background:#f0fdf4;"><strong>SDL</strong> = Staff Development Leave</span>
                    <span style="padding:0.2rem 0.45rem; border:1px solid #e2e8f0; border-radius:999px; background:#f0f9ff;"><strong>W</strong> = Work From Home</span>
                    <span style="padding:0.2rem 0.45rem; border:1px solid #e2e8f0; border-radius:999px; background:#eff6ff;"><strong>D</strong> = On Duty</span>
                    <span style="padding:0.2rem 0.45rem; border:1px solid #e2e8f0; border-radius:999px; background:#f8fafc;"><strong>H</strong> = Holiday</span>
                    <span style="padding:0.2rem 0.45rem; border:1px solid #e2e8f0; border-radius:999px; background:#f8fafc;"><strong>-</strong> = No Log / Future</span>
                    <span style="padding:0.2rem 0.45rem; border:1px solid #c7d2fe; border-radius:999px; background:#eef2ff; color:#4338ca;"><strong>•</strong> = Auto-closed entry</span>
                </div>

                <div class="table-container" style="max-height: 70vh; overflow: auto; border: 1px solid #eee; border-radius: 8px;">
                    <table style="font-size:0.85rem; border-collapse: separate; border-spacing: 0;">
                        <thead>
                            <tr style="position: sticky; top: 0; z-index: 10; background: #f8fafc;">
                                <th style="border-right: 1px solid #eee; padding:6px; position: sticky; left: 0; background: #f8fafc; z-index: 20; font-size:0.75rem;">S.No</th>
                                <th style="border-right: 2px solid #ddd; padding:6px; position: sticky; left: 35px; background: #f8fafc; z-index: 20; min-width: 120px; font-size:0.75rem;">Staff Name</th>
                                ${daysArray.map(d => `<th style="text-align:center; min-width: 28px; padding:4px; border-right: 1px solid #eee; font-size:0.75rem;">${d}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${users.sort((a, b) => a.name.localeCompare(b.name)).map((u, index) => {
        return `
                                <tr>
                                    <td style="text-align:center; border-right: 1px solid #eee; position: sticky; left: 0; background: #fff; z-index: 5; padding:4px; font-size:0.75rem;">${index + 1}</td>
                                    <td style="border-right: 2px solid #ddd; position: sticky; left: 35px; background: #fff; z-index: 5; font-weight: 500; padding:4px;">
                                        <div style="display:flex; flex-direction:column;">
                                            <span style="font-size:0.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:110px;">${safeHtml(u.name)}</span>
                                            <span style="font-size:0.65rem; color:#666; font-weight:400;">${safeHtml(u.dept || 'General')}</span>
                                        </div>
                                    </td>
                                    ${daysArray.map(day => {
            const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayLogs = filteredLogs.filter(l => (l.userId === u.id || l.user_id === u.id) && l.date === dateStr);
            const dayAttendanceLogs = dayLogs.filter(isAttendanceEligibleLog);
            const dayPolicy = getWeekendPolicy(dateStr);
            const holidayTitles = holidayEventsByDate.get(dateStr) || [];
            const hasHolidayEvent = holidayTitles.length > 0;

            let cellContent = '-';
            let cellStyle = '';
            let tooltip = 'No log';

            if (dayAttendanceLogs.length > 0) {
                const log = dayAttendanceLogs.slice().sort((a, b) => getLogPriority(b) - getLogPriority(a))[0];
                const derivedType = (log.autoCheckout && String(log.missedCheckoutReasonStatus || '').toLowerCase() === 'approved')
                    ? 'Present'
                    : log.type;
                const type = (window.AppAttendance && window.AppAttendance.normalizeType) ? window.AppAttendance.normalizeType(derivedType) : derivedType;
                const autoClosureNote = getAutoClosureNote(log);
                cellContent = type.charAt(0).toUpperCase();
                tooltip = `${log.checkIn} - ${log.checkOut || 'Active'}\n${type}`;
                if (autoClosureNote) tooltip += `\n${autoClosureNote}`;

                if (type === 'Present') { cellStyle = 'color: #10b981; font-weight: bold; font-size: 0.9rem;'; }
                else if (type === 'Late') { cellStyle = 'color: #f59e0b; font-weight: bold;'; cellContent = 'L'; }
                else if (type === 'Half Day') { cellStyle = 'color: #c2410c; font-weight: bold;'; cellContent = 'HD'; }
                else if (type === 'Absent') { cellStyle = 'color: #ef4444; font-weight: bold;'; cellContent = 'A'; }
                else if (type.includes('Leave') && type.includes('Half Day')) { cellStyle = 'color: #7c3aed; font-weight: bold;'; cellContent = 'HD'; }
                else if (type === 'Retreat Leave') { cellStyle = 'color: #0e7490; font-weight: bold;'; cellContent = 'RL'; }
                else if (type === 'Staff Development Leave') { cellStyle = 'color: #166534; font-weight: bold;'; cellContent = 'SDL'; }
                else if (type.includes('Leave')) { cellStyle = 'color: #8b5cf6; font-weight: bold;'; cellContent = 'C'; }
                else if (type === 'Work - Home' || /work\s*[- ]?\s*from\s*[- ]?\s*home|wfh/i.test(String(type || ''))) { cellStyle = 'color: #0ea5e9; font-weight: bold;'; cellContent = 'W'; }
                else if (type === 'On Duty') { cellStyle = 'color: #0369a1; font-weight: bold;'; cellContent = 'D'; }

                if (log.isManualOverride) {
                    cellStyle = 'color: #be185d; font-weight: bold; background: #fdf2f8;';
                }

                if (autoClosureNote) {
                    cellContent = `<span style="display:inline-flex; align-items:flex-start; gap:2px;"><span>${cellContent}</span><span style="color:#4338ca; font-size:0.7rem; line-height:1;">•</span></span>`;
                }
            } else {
                const isCheckedInToday = (dateStr === todayIso && u.status === 'in' && u.lastCheckIn && toLocalIso(u.lastCheckIn) === dateStr);
                const isBeforeJoinDate = (typeof u.joinDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(u.joinDate)) ? dateStr < u.joinDate : false;
                const isFutureDate = dateStr > todayIso;

                if (isCheckedInToday) {
                    cellContent = 'P'; cellStyle = 'color: #10b981; font-weight: bold; font-size: 0.9rem;'; tooltip = 'Checked in (pending checkout)';
                } else if (isFutureDate || isBeforeJoinDate) {
                    cellContent = '-'; cellStyle = 'color: #94a3b8; font-weight: 600;'; tooltip = isFutureDate ? 'Future date' : `Before joining date (${u.joinDate})`;
                } else if (hasHolidayEvent) {
                    cellContent = 'H';
                    cellStyle = 'color: #64748b; font-weight: 700;';
                    tooltip = `Holiday: ${Array.from(new Set(holidayTitles)).join(', ')}`;
                } else if (dayPolicy === 'holiday') {
                    cellContent = 'H';
                    cellStyle = 'color: #64748b; font-weight: 700;';
                    const d = new Date(`${dateStr}T00:00:00`);
                    tooltip = d.getDay() === 0 ? 'Weekly off: Sunday' : 'Weekly off: Saturday';
                } else if (dayPolicy === 'halfday') {
                    cellContent = '-';
                    cellStyle = 'color: #94a3b8; font-weight: 600;';
                    tooltip = 'Half-day Saturday';
                } else {
                    cellContent = 'A'; cellStyle = 'color: #ef4444; font-weight: bold;'; tooltip = 'Absent';
                }
            }

            return `<td style="text-align:center; ${canAdminAttendance ? 'cursor:pointer;' : ''} border-right: 1px solid #eee; padding:2px; font-size:0.75rem; ${cellStyle}" title="${tooltip}" ${canAdminAttendance ? `onclick="window.app_openCellOverride('${u.id}', '${dateStr}')"` : ''}>${cellContent}</td>`;
        }).join('')}
                                </tr>`;
    }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>`;
}
