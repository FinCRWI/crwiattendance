import { AppDB } from './db.js';
import { AppConfig } from '../config.js';
import { isTaskVisibleToViewer, getCurrentViewerId } from '../utils/task-visibility.js';

export class Analytics {
    constructor() {
        this.db = AppDB;
        this.chartInstance = null;
        this.memo = new Map();
        this._cachedHolidays = null;
        this._cachedHolidayYear = null;
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('app:db-write', (e) => {
                const collection = e?.detail?.collection;
                if (['attendance', 'users', 'work_plans', 'leaves', 'minutes', 'settings'].includes(collection)) {
                    this.clearMemo();
                    this._cachedHolidays = null;
                    this._cachedHolidayYear = null;
                }
            });
        }
    }

    getFlags() {
        return (AppConfig && AppConfig.READ_OPT_FLAGS) || {};
    }

    getTtls() {
        return (AppConfig && AppConfig.READ_CACHE_TTLS) || {};
    }

    async memoize(key, ttlMs, fn) {
        const flags = this.getFlags();
        if (!flags.FF_READ_OPT_ANALYTICS_CACHE) return fn();
        const now = Date.now();
        const cached = this.memo.get(key);
        if (cached && cached.expiresAt > now) return cached.value;
        const expiresAt = now + Math.max(0, Number(ttlMs) || 0);
        const pending = Promise.resolve().then(fn);
        this.memo.set(key, { value: pending, expiresAt });
        try {
            const value = await pending;
            this.memo.set(key, { value, expiresAt });
            return value;
        } catch (err) {
            this.memo.delete(key);
            throw err;
        }
    }

    clearMemo(prefix = '') {
        if (!prefix) {
            this.memo.clear();
            return;
        }
        for (const key of this.memo.keys()) {
            if (key.startsWith(prefix)) this.memo.delete(key);
        }
    }

    async getUsersCached() {
        const ttl = this.getTtls().users || 60000;
        return this.memoize('analytics:users', ttl, async () => {
            if (AppDB && AppDB.getCached) {
                const cacheKey = AppDB.getCacheKey('analyticsUsers', 'users', { ttl });
                return AppDB.getCached(cacheKey, ttl, () => this.db.getAll('users'));
            }
            return this.db.getAll('users');
        });
    }

    toLocalDateKey(date) {
        const d = date instanceof Date ? date : new Date(date);
        if (!d || Number.isNaN(d.getTime())) return '';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    async getAttendanceInRange(startDate, endDate, cacheSuffix = '') {
        const ttl = this.getTtls().attendanceSummary || 30000;
        const startIso = typeof startDate === 'string' ? startDate : this.toLocalDateKey(startDate);
        const endIso = typeof endDate === 'string' ? endDate : this.toLocalDateKey(endDate);
        const key = `analytics:attendance:${startIso}:${endIso}:${cacheSuffix}`;
        return this.memoize(key, ttl, async () => {
            if (this.db.queryMany) {
                return this.db.queryMany('attendance', [
                    { field: 'date', operator: '>=', value: startIso },
                    { field: 'date', operator: '<=', value: endIso }
                ]);
            }
            console.warn('[Analytics] queryMany unavailable — falling back to getAll attendance for range', startIso, endIso);
            const all = await this.db.getAll('attendance');
            return all.filter(l => l.date >= startIso && l.date <= endIso);
        });
    }

    async initAdminCharts() {
        const canvas = document.getElementById('admin-stats-chart');
        if (!canvas) return;

        // Destroy existing chart to avoid "Canvas is already in use" error
        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }

        // 1. Fetch Data
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 7);
        const [logs, allUsers] = await Promise.all([
            this.getAttendanceInRange(start, end, 'adminChart'),
            this.getUsersCached()
        ]);

        // 2. Process Data (Last 7 Days)
        const stats = this.processLast7Days(logs, allUsers);

        // 3. Render Chart
        const ctx = canvas.getContext('2d');
        try {
            this.chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: stats.labels,
                    datasets: [
                        {
                            label: 'Staff Present',
                            data: stats.present,
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            fill: true,
                            tension: 0.4,
                            borderWidth: 3,
                            pointBackgroundColor: '#10b981',
                            pointRadius: 4
                        },
                        {
                            label: 'On Leave',
                            data: stats.onLeave,
                            borderColor: '#ef4444',
                            backgroundColor: 'transparent',
                            borderDash: [5, 5],
                            tension: 0.1,
                            pointRadius: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        intersect: false,
                        mode: 'index',
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: { usePointStyle: true, boxWidth: 6 }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(30, 27, 75, 0.9)',
                            padding: 12,
                            titleFont: { size: 14, weight: 'bold' },
                            bodyFont: { size: 13 },
                            cornerRadius: 8
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { stepSize: 1, color: '#6b7280' },
                            grid: { color: 'rgba(0,0,0,0.05)' }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#6b7280' }
                        }
                    }
                }
            });
        } catch (err) {
            console.error("Chart.js Error:", err);
            canvas.parentNode.innerHTML = `<div style="color:red; text-align:center; padding:1rem;">Failed to load chart: ${err.message}</div>`;
        }
    }

    processLast7Days(logs, allUsers = []) {
        const labels = [];
        const presentData = [];
        const leaveData = [];
        const isAttendanceEligible = (log) => {
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

        // Helper for robust date comparison (ignores time & string format)
        const isSameDay = (d1, d2) => {
            return d1.getFullYear() === d2.getFullYear() &&
                d1.getMonth() === d2.getMonth() &&
                d1.getDate() === d2.getDate();
        };

        for (let i = 6; i >= 0; i--) {
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() - i);

            const dayLabel = targetDate.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
            labels.push(dayLabel);

            // Count unique users for this day
            const daysLogs = logs.filter(l => {
                const logDate = new Date(l.date);
                if (isNaN(logDate.getTime())) return false;
                return isSameDay(logDate, targetDate);
            });

            const uniquePresent = new Set();
            const uniqueLeave = new Set();

            daysLogs.forEach(l => {
                if (!isAttendanceEligible(l)) return;
                const uid = l.user_id || l.userId;
                if (!uid) return;

                const isLeaveType = String(l.type || '').toLowerCase().includes('leave') ||
                    l.location === 'On Leave' ||
                    l.type === 'Absent';

                if (isLeaveType) {
                    uniqueLeave.add(uid);
                } else {
                    uniquePresent.add(uid);
                }
            });

            // If processing TODAY, also include users who are currently checked in (active sessions)
            if (i === 0) {
                allUsers.forEach(u => {
                    if (u.status === 'in') {
                        uniquePresent.add(u.id);
                    }
                });
            }

            presentData.push(uniquePresent.size);
            leaveData.push(uniqueLeave.size);
        }

        console.log("Weekly Stats Generated (Unique):", { labels, present: presentData });
        return { labels, present: presentData, onLeave: leaveData };
    }

    // Helper to parse "HH:mm" or "h:mm AM/PM" to minutes from midnight
    parseTimeToMinutes(timeStr) {
        if (!timeStr) return null;
        const [time, modifier] = timeStr.split(' ');
        let [hours, minutes] = time.split(':');

        if (hours === '12') hours = '00';
        if (modifier === 'PM') hours = parseInt(hours, 10) + 12;

        return parseInt(hours, 10) * 60 + parseInt(minutes, 10);
    }

    isAttendanceEligibleLog(log) {
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
    }

    getAttendanceLogPriority(log) {
        const type = String(log?.type || '');
        const isLeaveLog = type.includes('Leave') || log?.location === 'On Leave';
        const isActualCheckoutLog = (
            !!log?.checkOut &&
            log.checkOut !== 'Active Now' &&
            (
                typeof log?.activityScore !== 'undefined' ||
                typeof log?.locationMismatched !== 'undefined' ||
                !!log?.checkOutLocation ||
                typeof log?.outLat !== 'undefined' ||
                typeof log?.outLng !== 'undefined'
            )
        );

        let score = 1;
        if (isActualCheckoutLog) score = 2;
        if (isLeaveLog) score = 3;
        if (log?.isManualOverride) score = 4;
        return score;
    }

    pickBestAttendanceLogPerDay(logs, startDate, endDate) {
        const bestByDate = new Map();
        const toLocalIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        logs.forEach((log) => {
            const logDate = new Date(log?.date);
            if (Number.isNaN(logDate.getTime()) || logDate < startDate || logDate > endDate) return;
            const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(log?.date || '')) ? String(log.date) : toLocalIso(logDate);
            const existing = bestByDate.get(dateKey);
            if (!existing || this.getAttendanceLogPriority(log) > this.getAttendanceLogPriority(existing)) {
                bestByDate.set(dateKey, log);
            }
        });

        return Array.from(bestByDate.values());
    }
    // Helper to format minutes to "Xh Ym"
    formatDuration(totalMinutes) {
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        return `${h}h ${m}m`;
    }

    getWeekNumber(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(d.getFullYear(), 0, 1);
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    async getUserMonthlyStats(userId) {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const logs = await this.getAttendanceInRange(start, end, `monthly:${userId}`);
        const userLogs = logs.filter(l => l.userId === userId || l.user_id === userId);
        return this.calculateStatsForLogs(userLogs);
    }

    getWeekendPolicy(dateStr) {
        const d = new Date(`${dateStr}T00:00:00`);
        const day = d.getDay();
        if (day === 0) return 'holiday';
        if (day === 6) {
            const nthSaturday = Math.floor((d.getDate() - 1) / 7) + 1;
            if (nthSaturday === 2 || nthSaturday === 4) return 'holiday';
            if (nthSaturday === 1 || nthSaturday === 3 || nthSaturday === 5) return 'halfday';
        }
        return 'working';
    }

    async getHolidayDateSetInRange(startDate, endDate) {
        const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
        const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
        let rangeEvents = [];
        try {
            if (window.AppDB?.queryMany) {
                rangeEvents = await window.AppDB.queryMany('events', [
                    { field: 'date', operator: '>=', value: startDateStr },
                    { field: 'date', operator: '<=', value: endDateStr }
                ]);
            } else {
                const allEvents = await window.AppDB.getAll('events');
                rangeEvents = (allEvents || []).filter((event) => {
                    const date = String(event?.date || '').trim();
                    return date >= startDateStr && date <= endDateStr;
                });
            }
        } catch (e) {
            console.warn('Analytics: events query failed, continuing without calendar holidays', e);
            rangeEvents = [];
        }

        let configuredHolidays = [];
        try {
            if (window.AppPolicies?.getHolidaysForYear) {
                configuredHolidays = await window.AppPolicies.getHolidaysForYear(startDate.getFullYear(), false);
            } else {
                const holidaySettings = await window.AppDB.get('settings', 'holidays').catch(() => null);
                configuredHolidays = Array.isArray(holidaySettings?.byYear?.[String(startDate.getFullYear())])
                    ? holidaySettings.byYear[String(startDate.getFullYear())]
                    : [];
            }
        } catch (e) {
            console.warn('Analytics: holiday settings lookup failed, continuing without configured holidays', e);
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

        const holidayDates = new Set();
        (rangeEvents || []).forEach((event) => {
            if (!isHolidayEvent(event)) return;
            const dateStr = normalizeEventDate(event?.date);
            if (!dateStr || dateStr < startDateStr || dateStr > endDateStr) return;
            holidayDates.add(dateStr);
        });
        (configuredHolidays || []).forEach((holiday) => {
            const dateStr = normalizeEventDate(holiday?.date);
            if (!dateStr || dateStr < startDateStr || dateStr > endDateStr) return;
            holidayDates.add(dateStr);
        });

        return holidayDates;
    }

    applyImpliedMonthlyAbsences(user, userLogs, stats, startOfMonth, endOfMonth, holidayDates = new Set()) {
        const today = new Date();
        const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const joinDate = String(user?.joinDate || '').trim();
        const joinDateIso = /^\d{4}-\d{2}-\d{2}$/.test(joinDate) ? joinDate : '';
        const canonicalLogs = this.pickBestAttendanceLogPerDay(userLogs, startOfMonth, endOfMonth);
        const eligibleDates = new Set(
            canonicalLogs
                .filter((log) => this.isAttendanceEligibleLog(log))
                .map((log) => String(log?.date || '').trim())
                .filter(Boolean)
        );

        for (let date = new Date(startOfMonth); date <= endOfMonth; date.setDate(date.getDate() + 1)) {
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            if (dateStr > todayIso) continue;
            if (joinDateIso && dateStr < joinDateIso) continue;
            if (holidayDates.has(dateStr)) continue;
            const weekendPolicy = this.getWeekendPolicy(dateStr);
            if (weekendPolicy === 'holiday') continue;
            if (weekendPolicy === 'halfday') continue; // Half-day Saturdays aren't full absences
            if (eligibleDates.has(dateStr)) continue;
            stats.unpaidLeaves += 1;
            stats.breakdown['Absent'] += 1;
            stats.leaves += 1;
        }

        return stats;
    }

    async getSystemMonthlySummary() {
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const [allUsers, allLogs, holidayDates] = await Promise.all([
            this.getUsersCached(),
            this.getAttendanceInRange(startOfMonth, endOfMonth, 'sysMonthly'),
            this.getHolidayDateSetInRange(startOfMonth, endOfMonth)
        ]);

        const summary = await Promise.all(allUsers.map(async (user) => {
            const userLogs = allLogs.filter(l => (l.userId === user.id || l.user_id === user.id) &&
                (new Date(l.date) >= startOfMonth && new Date(l.date) <= endOfMonth));

            const stats = this.applyImpliedMonthlyAbsences(
                user,
                userLogs,
                this.calculateStatsForLogs(userLogs),
                startOfMonth,
                endOfMonth,
                holidayDates
            );
            return {
                user,
                stats
            };
        }));

        return summary;
    }

    calculateStatsForLogs(userLogs) {
        // Derive the date range from the actual logs instead of hardcoding current month
        const dates = (userLogs || []).map(l => new Date(l.date)).filter(d => !Number.isNaN(d.getTime())).sort((a, b) => a - b);
        const startOfMonth = dates.length > 0 ? new Date(dates[0].getFullYear(), dates[0].getMonth(), 1) : new Date();
        const endOfMonth = dates.length > 0 ? new Date(dates[dates.length - 1].getFullYear(), dates[dates.length - 1].getMonth() + 1, 0) : new Date();

        const breakdown = {
            'Present': 0, 'Late': 0, 'Early Departure': 0, 'Work - Home': 0, 'Training': 0,
            'Sick Leave': 0, 'Casual Leave': 0, 'Earned Leave': 0,
            'Paid Leave': 0, 'Maternity Leave': 0, 'Retreat Leave': 0, 'Staff Development Leave': 0, 'Absent': 0,
            'Holiday': 0, 'National Holiday': 0, 'Regional Holidays': 0
        };

        const stats = {
            present: 0,
            late: 0,
            leaves: 0,
            unpaidLeaves: 0,
            penalty: 0,
            penaltyOffset: 0,
            effectivePenalty: 0,
            extraWorkedHours: 0,
            earlyDepartures: 0,
            label: startOfMonth.toLocaleDateString('default', { month: 'long', year: 'numeric' }),
            breakdown: breakdown,
            totalLateDuration: '0h 0m',
            totalExtraDuration: '0h 0m'
        };

        let totalLateMinutes = 0;
        let totalExtraMinutes = 0;

        // Hoist config lookups outside the loop
        const lateCutoff = (typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.LATE_CUTOFF_MINUTES : 555) || 555;
        const earlyDeparture = (typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.EARLY_DEPARTURE_MINUTES : 1020) || 1020;
        const workStartMinutes = (() => {
            const ws = (typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.WORK_START_TIME : '09:00') || '09:00';
            const parts = ws.split(':').map(Number);
            return (parts[0] || 9) * 60 + (parts[1] || 0);
        })();

        const canonicalLogs = this.pickBestAttendanceLogPerDay(userLogs, startOfMonth, endOfMonth);
        canonicalLogs.forEach(log => {
                if (!this.isAttendanceEligibleLog(log)) return;
                let type = log.type || '';
                const inMinutes = this.parseTimeToMinutes(log.checkIn);
                const outMinutes = this.parseTimeToMinutes(log.checkOut);

                // Manual Override logic
                const isManual = log.isManualOverride === true;

                if (!isManual) {
                    // LATE Check: prefer stored policy decision, fallback to old logs
                    const isLateCountable = log.lateCountable === true || (!Object.prototype.hasOwnProperty.call(log, 'lateCountable') && inMinutes !== null && inMinutes > lateCutoff);
                    if (isLateCountable) {
                        breakdown['Late']++;
                        stats.late++;
                        if (inMinutes !== null) totalLateMinutes += Math.max(0, (inMinutes - lateCutoff));
                    }

                    // EARLY DEPARTURE Check — skip holidays, Sundays, off-Saturdays, and auto-checkouts
                    const logDateStr = log.date || '';
                    const isAutoCheckout = log.autoCheckout === true;
                    if (outMinutes !== null && outMinutes < earlyDeparture && !String(type).includes('Leave') && type !== 'Absent' && !this._isHolidayOrOffDay(logDateStr) && !isAutoCheckout) {
                        stats.earlyDepartures++;
                        breakdown['Early Departure']++;
                    }
                } else {
                    // For manual logs, still track duration if needed, but skip penalties
                    // Manual logs explicitly set their type (Present, Late, etc.)
                    if (type === 'Late') {
                        stats.late++;
                        breakdown['Late']++;
                        if (inMinutes !== null && inMinutes > lateCutoff) {
                            totalLateMinutes += (inMinutes - lateCutoff);
                        }
                    } else if (type === 'Early Departure' && !this._isHolidayOrOffDay(log.date || '')) {
                        stats.earlyDepartures++;
                        breakdown['Early Departure']++;
                    }
                }

                // EXTRA HOURS Check (for duration display)
                const storedExtraMinutes = typeof log.extraTimeConfirmedMs === 'number' && log.extraTimeConfirmedMs > 0
                    ? Math.max(0, Math.round(log.extraTimeConfirmedMs / (1000 * 60)))
                    : (typeof log.extraWorkedMs === 'number'
                        ? Math.max(0, Math.round(log.extraWorkedMs / (1000 * 60)))
                        : 0);
                if (storedExtraMinutes > 0) {
                    totalExtraMinutes += storedExtraMinutes;
                } else {
                    const allowExtra = !(log.autoCheckout && !log.autoCheckoutExtraApproved);
                    if (allowExtra) {
                        const logIsH = this._isHolidayOrOffDay(log.date || '');
                        if (logIsH) {
                            // On holidays/Sundays/off-Saturdays all worked hours are extra
                            if (inMinutes !== null && outMinutes !== null && outMinutes > inMinutes) {
                                totalExtraMinutes += (outMinutes - inMinutes);
                            }
                        } else {
                            if (inMinutes !== null && inMinutes < workStartMinutes) totalExtraMinutes += (workStartMinutes - inMinutes);
                            if (outMinutes !== null && outMinutes > earlyDeparture) totalExtraMinutes += (outMinutes - earlyDeparture);
                        }
                    }
                }

                // CATEGORY Check
                if (type === 'Work - Home') breakdown['Work - Home']++;
                else if (type === 'Training') breakdown['Training']++;
                else if (type === 'Sick Leave') { breakdown['Sick Leave']++; stats.unpaidLeaves++; }
                else if (type === 'Casual Leave') breakdown['Casual Leave']++;
                else if (type === 'Earned Leave') breakdown['Earned Leave']++;
                else if (type === 'Paid Leave') breakdown['Paid Leave']++;
                else if (type === 'Maternity Leave') breakdown['Maternity Leave']++;
                else if (type === 'Retreat Leave') breakdown['Retreat Leave']++;
                else if (type === 'Staff Development Leave') breakdown['Staff Development Leave']++;
                else if (type === 'Absent') { breakdown['Absent']++; stats.unpaidLeaves++; }
                else if (type === 'National Holiday') breakdown['National Holiday']++;
                else if (type === 'Regional Holidays') breakdown['Regional Holidays']++;
                else if (String(type).includes('Holiday')) breakdown['Holiday']++;
                else if (log.checkIn) {
                    breakdown['Present']++;
                }
        });

        stats.present = breakdown['Present'] + breakdown['Work - Home'] + breakdown['Training'];
        stats.leaves = breakdown['Sick Leave'] + breakdown['Casual Leave'] + breakdown['Earned Leave'] + breakdown['Paid Leave'] + breakdown['Maternity Leave'] + breakdown['Retreat Leave'] + breakdown['Staff Development Leave'] + breakdown['Absent'];

        // Penalty inherited from Daily Check (> 15 mins late = 0.5)
        // Penalty Rule 1: > 3 Lates (within grace) = 0.5 Leave penalty? 
        // The request doesn't explicitly state the 3-late rule anymore, 
        // but I'll keep it for lates that WERE within grace but still marked.
        // Actually, let's simplify to match the request exactly.

        stats.extraWorkedHours = Number((totalExtraMinutes / 60).toFixed(2));
        stats.penaltyLeaves = Math.floor((stats.late || 0) / ((typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.LATE_GRACE_COUNT : 3) || 3)) * ((typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.LATE_DEDUCTION_PER_BLOCK : 0.5) || 0.5);
        const offsetStepHours = (typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.EXTRA_HOURS_FOR_HALF_DAY_OFFSET : 4) || 4;
        const penaltyStepDays = (typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.LATE_DEDUCTION_PER_BLOCK : 0.5) || 0.5;
        stats.penaltyOffset = Math.floor((stats.extraWorkedHours || 0) / offsetStepHours) * penaltyStepDays;
        stats.effectivePenalty = Math.max(0, stats.penaltyLeaves - stats.penaltyOffset);
        stats.totalLateDuration = this.formatDuration(totalLateMinutes);
        stats.totalExtraDuration = this.formatDuration(totalExtraMinutes);

        return stats;
    }

    async getUserYearlyStats(userId) {
        const { start, end, label } = this.getFinancialYearDates();

        // Fetch in monthly chunks for better Firestore performance
        const monthChunks = [];
        const chunkStart = new Date(start);
        while (chunkStart <= end) {
            const monthEnd = new Date(chunkStart.getFullYear(), chunkStart.getMonth() + 1, 0);
            const chunkEnd = monthEnd < end ? monthEnd : new Date(end);
            monthChunks.push({ start: new Date(chunkStart), end: chunkEnd });
            chunkStart.setMonth(chunkStart.getMonth() + 1);
            chunkStart.setDate(1);
        }
        const chunkKey = `${start.toISOString().split('T')[0]}_${end.toISOString().split('T')[0]}`;
        const allLogs = await Promise.all(
            monthChunks.map((chunk, i) => this.getAttendanceInRange(chunk.start, chunk.end, `yearly:${userId}:${chunkKey}:${i}`))
        );
        const logs = allLogs.flat();
        const userLogs = logs.filter(l => l.userId === userId || l.user_id === userId);

        const breakdown = {
            'Present': 0, 'Late': 0, 'Early Departure': 0, 'Work - Home': 0, 'Training': 0,
            'Sick Leave': 0, 'Casual Leave': 0, 'Earned Leave': 0,
            'Paid Leave': 0, 'Maternity Leave': 0, 'Retreat Leave': 0, 'Staff Development Leave': 0, 'Absent': 0,
            'Holiday': 0, 'National Holiday': 0, 'Regional Holidays': 0
        };

        const stats = {
            present: 0,
            late: 0,
            leaves: 0,
            earlyDepartures: 0,
            penaltyLeaves: 0,
            penaltyOffset: 0,
            effectivePenalty: 0,
            extraWorkedHours: 0,
            label: label,
            breakdown: breakdown,
            totalLateDuration: '0h 0m',
            totalExtraDuration: '0h 0m'
        };

        let totalLateMinutes = 0;
        let totalExtraMinutes = 0;

        const canonicalLogs = this.pickBestAttendanceLogPerDay(userLogs, start, end);
        // Hoist config lookups outside the loop
        const lateCutoff = (typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.LATE_CUTOFF_MINUTES : 555) || 555;
        const earlyDeparture = (typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.EARLY_DEPARTURE_MINUTES : 1020) || 1020;
        const workStartMinutes = (() => {
            const ws = (typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.WORK_START_TIME : '09:00') || '09:00';
            const parts = ws.split(':').map(Number);
            return (parts[0] || 9) * 60 + (parts[1] || 0);
        })();

        canonicalLogs.forEach(log => {
                if (!this.isAttendanceEligibleLog(log)) return;
                let type = log.type || '';
                const inMinutes = this.parseTimeToMinutes(log.checkIn);
                const outMinutes = this.parseTimeToMinutes(log.checkOut);

                const isManual = log.isManualOverride === true;

                if (!isManual) {
                    // LATE Check
                    const isLateCountable = log.lateCountable === true || (!Object.prototype.hasOwnProperty.call(log, 'lateCountable') && inMinutes !== null && inMinutes > lateCutoff);
                    if (isLateCountable) {
                        breakdown['Late']++;
                        if (inMinutes !== null) totalLateMinutes += Math.max(0, (inMinutes - lateCutoff));
                    }

                    // EARLY DEPARTURE Check — skip holidays, Sundays, off-Saturdays, and auto-checkouts
                    const logDateStr2 = log.date || '';
                    const isAutoCheckout2 = log.autoCheckout === true;
                    if (outMinutes !== null && outMinutes < earlyDeparture && !String(type).includes('Leave') && type !== 'Absent' && !this._isHolidayOrOffDay(logDateStr2) && !isAutoCheckout2) {
                        stats.earlyDepartures++;
                        breakdown['Early Departure']++;
                    }
                } else {
                    if (type === 'Late') {
                        breakdown['Late']++;
                        if (inMinutes !== null && inMinutes > lateCutoff) {
                            totalLateMinutes += (inMinutes - lateCutoff);
                        }
                    } else if (type === 'Early Departure' && !this._isHolidayOrOffDay(log.date || '')) {
                        stats.earlyDepartures++;
                        breakdown['Early Departure']++;
                    }
                }

                // EXTRA HOURS Check
                const storedExtraMinutes = typeof log.extraTimeConfirmedMs === 'number' && log.extraTimeConfirmedMs > 0
                    ? Math.max(0, Math.round(log.extraTimeConfirmedMs / (1000 * 60)))
                    : (typeof log.extraWorkedMs === 'number'
                        ? Math.max(0, Math.round(log.extraWorkedMs / (1000 * 60)))
                        : 0);
                if (storedExtraMinutes > 0) {
                    totalExtraMinutes += storedExtraMinutes;
                } else {
                    const allowExtra = !(log.autoCheckout && !log.autoCheckoutExtraApproved);
                    if (allowExtra) {
                        const logIsH = this._isHolidayOrOffDay(log.date || '');
                        if (logIsH) {
                            // On holidays/Sundays/off-Saturdays all worked hours are extra
                            if (inMinutes !== null && outMinutes !== null && outMinutes > inMinutes) {
                                totalExtraMinutes += (outMinutes - inMinutes);
                            }
                        } else {
                            if (inMinutes !== null && inMinutes < workStartMinutes) totalExtraMinutes += (workStartMinutes - inMinutes);
                            if (outMinutes !== null && outMinutes > earlyDeparture) totalExtraMinutes += (outMinutes - earlyDeparture);
                        }
                    }
                }

                // CATEGORY Check
                if (type === 'Work - Home') breakdown['Work - Home']++;
                else if (type === 'Training') breakdown['Training']++;
                else if (type === 'Sick Leave') breakdown['Sick Leave']++;
                else if (type === 'Casual Leave') breakdown['Casual Leave']++;
                else if (type === 'Earned Leave') breakdown['Earned Leave']++;
                else if (type === 'Paid Leave') breakdown['Paid Leave']++;
                else if (type === 'Maternity Leave') breakdown['Maternity Leave']++;
                else if (type === 'Retreat Leave') breakdown['Retreat Leave']++;
                else if (type === 'Staff Development Leave') breakdown['Staff Development Leave']++;
                else if (type === 'Absent') breakdown['Absent']++;
                else if (type === 'National Holiday') breakdown['National Holiday']++;
                else if (type === 'Regional Holidays') breakdown['Regional Holidays']++;
                else if (String(type).includes('Holiday')) breakdown['Holiday']++;
                else if (log.checkIn) {
                    breakdown['Present']++;
                }
        });

        stats.present = breakdown['Present'] + breakdown['Work - Home'] + breakdown['Training'];
        stats.leaves = breakdown['Sick Leave'] + breakdown['Casual Leave'] + breakdown['Earned Leave'] + breakdown['Paid Leave'] + breakdown['Maternity Leave'] + breakdown['Retreat Leave'] + breakdown['Staff Development Leave'] + breakdown['Absent'];
        stats.late = breakdown['Late'];
        stats.extraWorkedHours = Number((totalExtraMinutes / 60).toFixed(2));
        stats.totalLateDuration = this.formatDuration(totalLateMinutes);
        stats.totalExtraDuration = this.formatDuration(totalExtraMinutes);

        stats.penaltyLeaves = Math.floor((breakdown['Late'] || 0) / ((typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.LATE_GRACE_COUNT : 3) || 3)) * ((typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.LATE_DEDUCTION_PER_BLOCK : 0.5) || 0.5);
        const offsetStepHours = (typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.EXTRA_HOURS_FOR_HALF_DAY_OFFSET : 4) || 4;
        const penaltyStepDays = (typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.LATE_DEDUCTION_PER_BLOCK : 0.5) || 0.5;
        stats.penaltyOffset = Math.floor((stats.extraWorkedHours || 0) / offsetStepHours) * penaltyStepDays;
        stats.effectivePenalty = Math.max(0, stats.penaltyLeaves - stats.penaltyOffset);

        return stats;
    }

    getFinancialYearDates() {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth(); // 0-11
        const startMonth = (typeof AppConfig !== 'undefined' && AppConfig ? AppConfig.FY_START_MONTH : 3) || 3; // Default April

        let startYear = year;
        if (month < startMonth) {
            startYear = year - 1;
        }

        const start = new Date(startYear, startMonth, 1);
        // End is 1 day before start month of next year
        const end = new Date(startYear + 1, startMonth, 0);

        return {
            start,
            end,
            label: `FY ${startYear}-${startYear + 1}`
        };
    }

    getDayType(dateStr) {
        const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
        const day = date.getDay();
        if (day === 0) return 'Holiday'; // Sunday

        if (day === 6) { // Saturday Rules
            if (typeof AppConfig !== 'undefined' && AppConfig && AppConfig.IS_SATURDAY_OFF && AppConfig.IS_SATURDAY_OFF(date)) {
                return 'Holiday';
            }
            return 'Work Day';
        }

        // Check configured holidays from preloaded cache
        if (this._cachedHolidaySet && this._cachedHolidaySet.size > 0) {
            const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            if (this._cachedHolidaySet.has(dateKey)) return 'Holiday';
        }

        return 'Work Day';
    }

    async preloadHolidayCache() {
        try {
            const now = new Date();
            const year = now.getFullYear();
            if (this._cachedHolidayYear === year && this._cachedHolidaySet) return;
            let holidays = [];
            if (window.AppPolicies?.getHolidaysForYear) {
                holidays = await window.AppPolicies.getHolidaysForYear(year, false);
            } else {
                const settings = await window.AppDB.get('settings', 'holidays').catch(() => null);
                holidays = Array.isArray(settings?.byYear?.[String(year)]) ? settings.byYear[String(year)] : [];
            }
            const set = new Set();
            (holidays || []).forEach(h => {
                const date = String(h?.date || '').trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(date)) set.add(date);
            });
            this._cachedHolidaySet = set;
            this._cachedHolidayYear = year;
        } catch (e) {
            console.warn('Analytics: failed to preload holiday cache', e);
        }
    }

    isConfiguredHoliday(dateStr) {
        if (this._cachedHolidaySet && this._cachedHolidaySet.size > 0) {
            const dateKey = typeof dateStr === 'string' ? dateStr
                : `${dateStr.getFullYear()}-${String(dateStr.getMonth() + 1).padStart(2, '0')}-${String(dateStr.getDate()).padStart(2, '0')}`;
            return this._cachedHolidaySet.has(dateKey);
        }
        return false;
    }

    // Returns true if the date is a Sunday, off-Saturday, or configured holiday.
    // Used to exclude non-working days from early-departure / late penalties.
    _isHolidayOrOffDay(dateStr) {
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return false;
        // Sunday
        if (d.getDay() === 0) return true;
        // 2nd/4th Saturday (off)
        if (d.getDay() === 6 && typeof AppConfig !== 'undefined' && AppConfig && typeof AppConfig.IS_SATURDAY_OFF === 'function' && AppConfig.IS_SATURDAY_OFF(d)) return true;
        // Configured holiday (Republic Day, Diwali, etc.)
        if (this.isConfiguredHoliday(dateStr)) return true;
        return false;
    }

    getHeroPolicy() {
        return window.AppHeroPolicy || AppConfig?.HERO_POLICY || {};
    }

    getHeroScoreRange(baseDate = null, windowDays = 7) {
        const width = Math.max(1, Math.round(Number(windowDays) || 7));
        const seed = baseDate instanceof Date && !Number.isNaN(baseDate.getTime())
            ? new Date(baseDate)
            : (window.AppDB?.getIstNow ? window.AppDB.getIstNow() : new Date());
        const end = new Date(seed);
        end.setDate(seed.getDate() - 1);
        end.setHours(23, 59, 59, 999);
        const start = new Date(end);
        start.setDate(end.getDate() - (width - 1));
        start.setHours(0, 0, 0, 0);
        return { start, end };
    }

    buildAttendanceTaskStats(normalizedLogs = []) {
        // Minimum work-description length (chars) for a log to count as substantive
        // completed-planning evidence; shorter logs earn proportional partial credit.
        const EVIDENCE_MIN_CHARS = 40;
        const byUser = new Map();
        (normalizedLogs || []).forEach((log) => {
            if (!log || Number(log.activityLogDepth || 0) <= 0) return;
            if (!byUser.has(log.userId)) {
                byUser.set(log.userId, { planned: 0, completed: 0, inProgress: 0, missed: 0, postponed: 0 });
            }
            const bucket = byUser.get(log.userId);
            bucket.planned += 1;
            // A work log is evidence of effort, not a completed tracked task. Crediting
            // it as fully "completed" let terse check-in notes inflate completion to 100%.
            // Instead, credit proportionally to how substantive the description is.
            const depth = Number(log.activityLogDepth) || 0;
            bucket.completed += Math.min(1, depth / EVIDENCE_MIN_CHARS);
        });
        // Keep the fractional credit for scoring precision but round the per-user
        // totals so the hero card/leaderboard display clean integers.
        byUser.forEach((bucket) => {
            bucket.completed = Math.round(bucket.completed);
        });
        return byUser;
    }

    mergeTaskStats(base = new Map(), extra = new Map()) {
        // Attendance-log entries (work descriptions) are a fallback source of planning
        // evidence. Only apply them to users who have NO work_plan-based tasks at all,
        // so staff who track work purely via attendance can qualify instead of being locked
        // out, without double-counting staff who already recorded work plans.
        extra.forEach((stats, userId) => {
            const existing = base.get(userId) || { planned: 0, completed: 0, inProgress: 0, missed: 0, postponed: 0 };
            if ((existing.planned || 0) > 0) return;
            if ((stats.planned || 0) <= 0) return;
            base.set(userId, {
                planned: existing.planned + (stats.planned || 0),
                completed: existing.completed + (stats.completed || 0),
                inProgress: existing.inProgress + (stats.inProgress || 0),
                missed: existing.missed + (stats.missed || 0),
                postponed: existing.postponed + (stats.postponed || 0)
            });
        });
        return base;
    }

    async getHeroSharedDataset(options = {}) {
        const policy = this.getHeroPolicy();
        const windowDays = Math.max(1, Number(options.windowDays ?? policy.WINDOW_DAYS ?? 7));
        const { start, end } = this.getHeroScoreRange(options.baseDate, windowDays);
        const startIso = this.toLocalDateKey(start);
        const endIso = this.toLocalDateKey(end);
        const ttl = this.getTtls().attendanceSummary || 30000;
        const cacheKey = `analytics:heroShared:${startIso}:${endIso}`;
        return this.memoize(cacheKey, ttl, async () => {
            const [logs, workPlans, users] = await Promise.all([
                this.getAttendanceInRange(start, end, 'hero_yesterday_window'),
                this.db.queryMany
                    ? this.db.queryMany('work_plans', [
                        { field: 'date', operator: '>=', value: startIso },
                        { field: 'date', operator: '<=', value: endIso }
                    ])
                    : this.db.getAll('work_plans').then((rows) => (rows || []).filter((row) => {
                        const d = String(row?.date || '');
                        return d >= startIso && d <= endIso;
                    })),
                this.getUsersCached()
            ]);
            const activityRows = await this.getAllStaffActivities({
                mode: 'range',
                startIso,
                endIso,
                scope: 'work',
                sideEffects: false,
                sharedLogs: logs,
                sharedWorkPlans: workPlans
            });
            return {
                policy,
                start,
                end,
                startIso,
                endIso,
                windowDays,
                logs,
                workPlans,
                activityRows,
                users
            };
        });
    }

    createZeroHeroStats(userId = '') {
        return {
            userId: String(userId || ''),
            days: 0,
            hours: 0,
            totalDurationMs: 0,
            activityLogDepth: 0,
            taskPlanned: 0,
            taskCompleted: 0,
            taskInProgress: 0,
            taskMissed: 0,
            taskPostponed: 0,
            completionRate: 0,
            punctuality: 0,
            attendanceScore: 0,
            taskExecution: 0,
            productivity: 0,
            planning: 0,
            compliance: 0,
            finalScore: 0
        };
    }

    parseHeroLogDate(raw) {
        if (!raw) return null;
        if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
        if (typeof raw !== 'string') return null;
        const s = raw.trim();
        if (!s) return null;

        const direct = new Date(s);
        if (!Number.isNaN(direct.getTime())) return direct;

        // Compatibility for legacy/localized strings such as DD/MM/YYYY or MM/DD/YYYY.
        const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
        if (!m) return null;
        const a = Number(m[1]);
        const b = Number(m[2]);
        let y = Number(m[3]);
        if (y < 100) y += 2000;
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(y)) return null;

        const mm = a > 12 ? b : a;
        const dd = a > 12 ? a : b;
        const dt = new Date(y, mm - 1, dd);
        return Number.isNaN(dt.getTime()) ? null : dt;
    }

    resolveHeroUserId(log) {
        const raw = log?.user_id ?? log?.userId ?? log?.uid ?? log?.user ?? '';
        const uid = String(raw || '').trim();
        return uid || null;
    }

    resolveHeroDurationMs(log) {
        let durationMs = Number(log?.durationMs);
        if (!Number.isFinite(durationMs)) durationMs = 0;
        if (durationMs > 0) return durationMs;
        if (log?.checkIn && log?.checkOut && log.checkOut !== 'Active Now') {
            const inMins = this.parseTimeToMinutes(log.checkIn);
            const outMins = this.parseTimeToMinutes(log.checkOut);
            if (inMins !== null && outMins !== null) {
                durationMs = (outMins - inMins) * 60 * 1000;
            }
        }
        return Math.max(0, Number(durationMs) || 0);
    }

    /**
     * Returns true if the attendance log represents a leave or absent day
     * (should not be counted as a "worked day" in hero scoring).
     */
    isHeroLeaveLog(log) {
        const type = String(log?.type || '');
        return type.toLowerCase().includes('leave') ||
            type === 'Absent' ||
            log?.location === 'On Leave';
    }

    normalizeHeroLogs(logs = []) {
        return (logs || [])
            .map((log) => {
                const logDate = this.parseHeroLogDate(log?.date);
                const userId = this.resolveHeroUserId(log);
                if (!logDate || !userId) return null;
                // Skip leave/absent days — they should not count as worked days in hero scoring
                if (this.isHeroLeaveLog(log)) return null;
                const durationMs = this.resolveHeroDurationMs(log);
                const activityScore = Number(log?.activityScore);
                return {
                    userId,
                    logDate,
                    dateKey: this.toLocalDateKey(logDate),
                    durationMs,
                    activityLogDepth: String(log?.workDescription || '').length,
                    activityScore: Number.isFinite(activityScore) ? activityScore : null
                };
            })
            .filter(Boolean);
    }

    buildHeroCandidateStats(normalizedLogs = []) {
        const byUser = new Map();
        normalizedLogs.forEach((log) => {
            if (!byUser.has(log.userId)) {
                byUser.set(log.userId, {
                    userId: log.userId,
                    totalDurationMs: 0,
                    daysSet: new Set(),
                    activityLogDepth: 0,
                    activityScoreTotal: 0,
                    activityScoreCount: 0
                });
            }
            const bucket = byUser.get(log.userId);
            bucket.totalDurationMs += Math.max(0, Number(log.durationMs) || 0);
            bucket.daysSet.add(log.dateKey);
            bucket.activityLogDepth += Math.max(0, Number(log.activityLogDepth) || 0);
            if (Number.isFinite(log.activityScore)) {
                bucket.activityScoreTotal += log.activityScore;
                bucket.activityScoreCount += 1;
            }
        });
        return Array.from(byUser.values());
    }

    classifyHeroTaskStatus(rawStatus, planDate = null) {
        const normalized = String(rawStatus || '').toLowerCase().trim();
        if (normalized === 'postponed') return 'postponed';
        const smartStatus = window.AppCalendar?.getSmartTaskStatus
            ? String(window.AppCalendar.getSmartTaskStatus(planDate, normalized) || normalized)
            : normalized;
        if (smartStatus === 'completed') return 'completed';
        if (smartStatus === 'in-process' || smartStatus === 'in progress' || smartStatus === 'to-be-started' || smartStatus === 'pending' || smartStatus === '') return 'in_progress';
        if (smartStatus === 'not-completed' || smartStatus === 'overdue' || smartStatus === 'missed') return 'missed';
        return 'in_progress';
    }

    normalizeHeroTasks(workPlans = []) {
        const rawRows = [];
        const shadowedSourceKeys = new Set();

        (workPlans || []).forEach((wp) => {
            const userId = String(wp?.userId || wp?.user_id || '').trim();
            if (!userId || !Array.isArray(wp?.plans)) return;
            wp.plans.forEach((task, taskIndex) => {
                if (!task || !String(task.task || '').trim()) return;
                if (task.isRemoved === true) return;
                const status = this.classifyHeroTaskStatus(task.status, wp.date);
                const planId = String(wp?.id || '');
                const sourcePlanId = String(task.sourcePlanId || '').trim();
                const sourceTaskIndex = Number(task.sourceTaskIndex);
                const hasPostponeSource = String(task.addedFrom || '').trim().toLowerCase() === 'postponed'
                    && sourcePlanId
                    && Number.isInteger(sourceTaskIndex);
                if (hasPostponeSource) {
                    shadowedSourceKeys.add(`${sourcePlanId}::${sourceTaskIndex}`);
                }
                rawRows.push({
                    userId,
                    status,
                    date: wp.date,
                    planId,
                    taskIndex,
                    rawStatus: String(task.status || '').trim().toLowerCase(),
                    addedFrom: String(task.addedFrom || '').trim().toLowerCase(),
                    task: String(task.task || ''),
                    subPlans: Array.isArray(task.subPlans) ? task.subPlans.slice() : [],
                    completedDate: task.completedDate || null,
                    assignedTo: String(task.assignedTo || wp?.userId || wp?.user_id || '').trim(),
                    assignedToName: String(task.assignedToName || wp?.userName || '').trim(),
                    sourcePlanId,
                    sourceTaskIndex: Number.isInteger(sourceTaskIndex) ? sourceTaskIndex : null,
                    carryForwardRootId: String(task.carryForwardRootId || '').trim(),
                    isRemoved: task.isRemoved === true
                });
            });
        });

        const filteredRows = rawRows.filter((row) => {
            if (!row) return false;
            const key = `${String(row.planId || '')}::${Number.isInteger(row.taskIndex) ? row.taskIndex : ''}`;
            if (shadowedSourceKeys.has(key) && row.addedFrom !== 'postponed') {
                return false;
            }
            return true;
        });

        const completedTasksByUserAndName = new Set();
        filteredRows.forEach(row => {
            if (row.status === 'completed') {
                completedTasksByUserAndName.add(`${row.userId}::${row.task.toLowerCase().trim()}`);
            }
        });

        const rows = filteredRows.filter(row => {
            if (row.status === 'postponed') {
                const key = `${row.userId}::${row.task.toLowerCase().trim()}`;
                if (completedTasksByUserAndName.has(key)) {
                    return false;
                }
            }
            return true;
        });

        return rows;
    }

    normalizeHeroTasksFromActivities(activityRows = [], users = []) {
        const rawRows = [];
        const shadowedSourceKeys = new Set();
        const knownUserIds = new Set(
            (Array.isArray(users) ? users : [])
                .map((u) => String(u?.id || '').trim())
                .filter(Boolean)
        );

        (Array.isArray(activityRows) ? activityRows : []).forEach((row) => {
            if (!row || String(row.type || '').toLowerCase() !== 'work') return;
            if (row.isRemoved === true) return;
            const userId = String(row.userId || row.user_id || '').trim();
            const planId = String(row.planId || row.id || '').trim();
            const taskIndex = Number(row.taskIndex);
            const task = String(row.task || row._displayDesc || row.workDescription || '').trim();
            if (!userId || !planId || !task || !Number.isInteger(taskIndex)) return;

            const sourcePlanId = String(row.sourcePlanId || '').trim();
            const sourceTaskIndex = Number(row.sourceTaskIndex);
            const addedFrom = String(row.addedFrom || '').trim().toLowerCase();
            if (addedFrom === 'postponed' && sourcePlanId && Number.isInteger(sourceTaskIndex)) {
                shadowedSourceKeys.add(`${sourcePlanId}::${sourceTaskIndex}`);
            }

            // Option B: tasks assigned to another known staff member are attributed to the
            // assignee; anything else stays with the plan owner. Unknown/stale assignee ids
            // (including 'annual_shared') fall back to the owner so no task becomes orphaned.
            const rawAssignedTo = String(row.assignedTo || '').trim();
            const attributionUserId = (rawAssignedTo && knownUserIds.has(rawAssignedTo))
                ? rawAssignedTo
                : userId;

            rawRows.push({
                userId,
                attributionUserId,
                status: this.classifyHeroTaskStatus(row.status, row.date),
                date: String(row.date || ''),
                planId,
                taskIndex,
                rawStatus: String(row.rawStatus || row.status || '').trim().toLowerCase(),
                addedFrom,
                task,
                subPlans: Array.isArray(row.subPlans) ? row.subPlans.slice() : [],
                completedDate: row.completedDate || null,
                assignedTo: String(row.assignedTo || row.userId || '').trim(),
                assignedToName: String(row.assignedToName || row.staffName || '').trim(),
                ownerId: userId,
                ownerName: String(row.staffName || row.userName || '').trim(),
                sourcePlanId,
                sourceTaskIndex: Number.isInteger(sourceTaskIndex) ? sourceTaskIndex : null,
                carryForwardRootId: String(row.carryForwardRootId || '').trim(),
                isRemoved: row.isRemoved === true
            });
        });

        const filteredRows = rawRows.filter((row) => {
            if (!row) return false;
            const key = `${String(row.planId || '')}::${Number.isInteger(row.taskIndex) ? row.taskIndex : ''}`;
            if (shadowedSourceKeys.has(key) && row.addedFrom !== 'postponed') {
                return false;
            }
            return true;
        });

        const completedTasksByUserAndName = new Set();
        filteredRows.forEach((row) => {
            if (row.status === 'completed') {
                completedTasksByUserAndName.add(`${row.attributionUserId}::${row.task.toLowerCase().trim()}`);
            }
        });

        return filteredRows.filter((row) => {
            if (row.status === 'postponed') {
                const key = `${row.attributionUserId}::${row.task.toLowerCase().trim()}`;
                if (completedTasksByUserAndName.has(key)) {
                    return false;
                }
            }
            return true;
        });
    }

    buildHeroTaskBuckets(taskRows = []) {
        const byUser = new Map();
        const ensureBucket = (userId) => {
            if (!byUser.has(userId)) {
                byUser.set(userId, {
                    completed: [],
                    in_progress: [],
                    postponed: [],
                    missed: []
                });
            }
            return byUser.get(userId);
        };

        taskRows.forEach((row) => {
            const userKey = String(row.attributionUserId || row.userId || '');
            if (!userKey) return;
            const bucket = ensureBucket(userKey);
            const key = ['completed', 'in_progress', 'postponed', 'missed'].includes(row.status)
                ? row.status
                : 'in_progress';
            bucket[key].push({
                userId: userKey,
                planId: String(row.planId || ''),
                taskIndex: Number(row.taskIndex),
                date: String(row.date || ''),
                task: String(row.task || ''),
                subPlans: Array.isArray(row.subPlans) ? row.subPlans.slice() : [],
                status: key,
                rawStatus: String(row.rawStatus || ''),
                completedDate: row.completedDate || null,
                assignedTo: String(row.assignedTo || ''),
                assignedToName: String(row.assignedToName || ''),
                ownerId: String(row.ownerId || row.userId || ''),
                ownerName: String(row.ownerName || '')
            });
        });

        return byUser;
    }

    buildHeroTaskStats(taskRows = []) {
        const byUser = new Map();
        taskRows.forEach((row) => {
            const userKey = String(row.attributionUserId || row.userId || '');
            if (!userKey) return;
            if (!byUser.has(userKey)) {
                byUser.set(userKey, { planned: 0, completed: 0, inProgress: 0, missed: 0, postponed: 0 });
            }
            const bucket = byUser.get(userKey);
            bucket.planned += 1;
            if (row.status === 'completed') bucket.completed += 1;
            else if (row.status === 'postponed') bucket.postponed += 1;
            else if (row.status === 'missed') bucket.missed += 1;
            else bucket.inProgress += 1;
        });
        return byUser;
    }

    rankHeroCandidates(attendanceStats = [], taskStats = new Map(), policy = {}, rawLogs = [], rawWorkPlans = [], dateRange = null) {
        // Use the same 6-dimension additive formula as the Performance widget
        const windowDays = Math.max(1, Number(policy.WINDOW_DAYS || 7));
        const expectedWeeklyTasks = Math.max(1, Number(policy.EXPECTED_WEEKLY_TASKS || 5));
        const expectedTasks = Math.max(1, Math.round(expectedWeeklyTasks * (windowDays / 7)));

        // Performance dimension weights (same as Performance widget)
        const wPunctuality = 0.15;
        const wAttendance = 0.20;
        const wTaskExecution = 0.25;
        const wProductivity = 0.15;
        const wPlanning = 0.15;
        const wCompliance = 0.10;

        const attendanceMap = new Map(attendanceStats.map((row) => [String(row.userId), row]));
        const allUserIds = new Set([...attendanceMap.keys(), ...taskStats.keys()]);

        // Build lookup for raw logs by userId
        const logsByUser = new Map();
        (rawLogs || []).forEach(log => {
            const uid = String(log?.userId || log?.user_id || '');
            if (!uid) return;
            if (!logsByUser.has(uid)) logsByUser.set(uid, []);
            logsByUser.get(uid).push(log);
        });

        // Build lookup for raw work plans by userId
        const plansByUser = new Map();
        (rawWorkPlans || []).forEach(wp => {
            const uid = String(wp?.userId || wp?.user_id || '');
            if (!uid) return;
            if (!plansByUser.has(uid)) plansByUser.set(uid, []);
            plansByUser.get(uid).push(wp);
        });

        // Date range for deduplication — use the actual dataset range
        const rangeStart = dateRange?.start ? new Date(dateRange.start) : (() => { const d = new Date(); d.setDate(d.getDate() - windowDays); d.setHours(0, 0, 0, 0); return d; })();
        const rangeEnd = dateRange?.end ? new Date(dateRange.end) : (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; })();

        return Array.from(allUserIds).map((userId) => {
            const attendance = attendanceMap.get(String(userId)) || {
                userId,
                totalDurationMs: 0,
                daysSet: new Set(),
                activityLogDepth: 0
            };
            const tasks = taskStats.get(String(userId)) || { planned: 0, completed: 0, inProgress: 0, missed: 0, postponed: 0 };

            // Get raw logs and work plans for this user
            const userRawLogs = logsByUser.get(userId) || [];
            const userRawPlans = plansByUser.get(userId) || [];

            // Deduplicate logs (one per day, same as Performance widget)
            const dedupedLogs = this.pickBestAttendanceLogPerDay(userRawLogs, rangeStart, rangeEnd);

            // ── PUNCTUALITY (0–100) ──
            const lateDays = dedupedLogs.filter(l => l.lateCountable === true || String(l.type || '').toLowerCase() === 'late').length;
            const totalDays = dedupedLogs.length;
            const punctuality = totalDays > 0
                ? Math.max(0, Math.round(((totalDays - lateDays) / totalDays) * 100))
                : 50;

            // ── ATTENDANCE (0–100) ──
            const daysWorked = attendance.daysSet.size;
            const attendanceScore = Math.min(100, Math.round((daysWorked / windowDays) * 100));

            // ── TASK EXECUTION (0–100) ──
            // Count tasks from raw work plans (same logic as _computeWeekPerformance)
            let taskPlanned = 0, taskCompleted = 0, taskMissed = 0, taskPostponed = 0, taskInProgress = 0;
            let onTimeCompleted = 0;
            userRawPlans.forEach(wp => {
                if (!Array.isArray(wp?.plans)) return;
                wp.plans.forEach(task => {
                    if (!task || task.isRemoved === true) return;
                    if (!String(task.task || '').trim()) return;
                    taskPlanned++;
                    const status = this.classifyHeroTaskStatus(task.status, wp.date);
                    if (status === 'completed') {
                        taskCompleted++;
                        if (task.completedDate && wp.date) {
                            const diffMs = new Date(task.completedDate).getTime() - new Date(wp.date + 'T23:59:59').getTime();
                            if (diffMs <= 0) onTimeCompleted++;
                        } else {
                            onTimeCompleted++;
                        }
                    } else if (status === 'missed') taskMissed++;
                    else if (status === 'postponed') taskPostponed++;
                    else taskInProgress++;
                });
            });
            // Fallback to aggregated stats if raw plans produced nothing
            if (taskPlanned === 0) {
                taskPlanned = tasks.planned; taskCompleted = tasks.completed;
                taskMissed = tasks.missed; taskPostponed = tasks.postponed;
                taskInProgress = tasks.inProgress;
                onTimeCompleted = tasks.completed; // best guess
            }
            const completionRate = taskPlanned > 0 ? (taskCompleted / taskPlanned) * 100 : 0;
            const onTimeRate = taskCompleted > 0 ? (onTimeCompleted / taskCompleted) * 100 : 100;
            const missRate = taskPlanned > 0 ? (taskMissed / taskPlanned) * 100 : 0;
            const taskExecution = Math.max(0, Math.min(100, Math.round(
                completionRate * 0.5 + onTimeRate * 0.2 - missRate * 0.3
            )));

            // ── PRODUCTIVITY (0–100) ──
            const activityScores = dedupedLogs.map(l => Number(l.activityScore)).filter(s => Number.isFinite(s));
            const avgActivity = activityScores.length > 0
                ? activityScores.reduce((a, b) => a + b, 0) / activityScores.length : 50;
            const totalExtraMs = dedupedLogs.reduce((sum, l) => {
                const type = String(l?.type || '');
                if (type.includes('Leave') || type === 'Absent') return sum;
                const confirmed = typeof l?.extraTimeConfirmedMs === 'number' && l.extraTimeConfirmedMs > 0 ? l.extraTimeConfirmedMs : 0;
                const stored = typeof l?.extraWorkedMs === 'number' && l.extraWorkedMs > 0 ? l.extraWorkedMs : 0;
                return sum + (confirmed || stored);
            }, 0);
            const extraHours = totalExtraMs / (1000 * 60 * 60);
            const workDescDepth = dedupedLogs.reduce((sum, l) => sum + String(l?.workDescription || '').length, 0);
            const depthScore = Math.min(100, (workDescDepth / Math.max(1, totalDays * 200)) * 100);
            const expectedExtraHours = Math.max(1, windowDays * 0.5);
            const extraHoursScore = Math.min(100, (extraHours / expectedExtraHours) * 100);
            const productivity = Math.round(avgActivity * 0.4 + extraHoursScore * 0.3 + depthScore * 0.3);

            // ── PLANNING (0–100) ──
            const planVolume = Math.min(100, (taskPlanned / expectedTasks) * 100);
            const subPlanCount = userRawPlans.reduce((sum, wp) =>
                sum + (Array.isArray(wp?.plans) ? wp.plans.filter(t =>
                    Array.isArray(t?.subPlans) && t.subPlans.length > 0
                ).length : 0), 0
            );
            const subPlanScore = Math.min(100, subPlanCount * 20);
            const planning = Math.round(planVolume * 0.6 + subPlanScore * 0.2 + (taskCompleted > 0 ? 20 : 0));

            // ── COMPLIANCE (0–100) ──
            const locationMismatches = dedupedLogs.filter(l => l.locationMismatched === true).length;
            const autoCheckouts = dedupedLogs.filter(l => l.autoCheckout === true).length;
            const compliance = Math.max(0, Math.min(100, Math.round(100
                - (totalDays > 0 ? (locationMismatches / totalDays) * 50 : 0)
                - (totalDays > 0 ? (autoCheckouts / totalDays) * 50 : 0)
            )));

            // ── COMPOSITE (same formula as Performance widget) ──
            const finalScore = Math.round(
                punctuality * wPunctuality
                + attendanceScore * wAttendance
                + taskExecution * wTaskExecution
                + productivity * wProductivity
                + planning * wPlanning
                + compliance * wCompliance
            );

            return {
                userId,
                days: daysWorked,
                hours: Number((attendance.totalDurationMs / (1000 * 60 * 60)).toFixed(1)),
                totalDurationMs: Math.max(0, Number(attendance.totalDurationMs) || 0),
                activityLogDepth: attendance.activityLogDepth,
                taskPlanned,
                taskCompleted,
                taskInProgress,
                taskMissed,
                taskPostponed,
                completionRate: Number(completionRate.toFixed(1)),
                punctuality,
                attendanceScore,
                taskExecution,
                productivity,
                planning,
                compliance,
                finalScore: Number(Math.max(0, finalScore).toFixed(2))
            };
        }).sort((a, b) => {
            if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
            if (b.taskCompleted !== a.taskCompleted) return b.taskCompleted - a.taskCompleted;
            if (a.taskMissed !== b.taskMissed) return a.taskMissed - b.taskMissed;
            if (b.days !== a.days) return b.days - a.days;
            if (b.totalDurationMs !== a.totalDurationMs) return b.totalDurationMs - a.totalDurationMs;
            return String(a.userId).localeCompare(String(b.userId));
        });
    }

    createNoHeroPayload({ reason = 'No eligible attendance data found.', period = 'weekly', source = 'direct_cache' } = {}) {
        return {
            state: 'no_eligible_data',
            user: null,
            stats: null,
            reason,
            period,
            source,
            confidence: 0,
            schemaVersion: Number(this.getHeroPolicy()?.SCHEMA_VERSION || 1)
        };
    }

    computeHeroConfidence(stats, policy = {}) {
        const expectedWeeklyTasks = Math.max(1, Number(policy.EXPECTED_WEEKLY_TASKS || 5));
        const confidenceTasks = Math.min(1, Number(stats?.taskCompleted || 0) / expectedWeeklyTasks);
        const confidenceDays = Math.min(1, Number(stats?.days || 0) / Math.max(1, Number(policy.WINDOW_DAYS || 7)));
        const confidenceHours = Math.min(1, Number(stats?.totalDurationMs || 0) / (1000 * 60 * 60 * Math.max(1, Number(policy?.CAPS?.hours || 40))));
        return Number(((confidenceTasks + confidenceDays + confidenceHours) / 3).toFixed(2));
    }

    buildDatedHeroPayload(winningStats, dataset, { primaryWindow, source, policy }) {
        const winner = (Array.isArray(dataset?.users) ? dataset.users : []).find(u => String(u?.id) === String(winningStats?.userId || ''));
        if (!winner) {
            return this.createNoHeroPayload({ reason: 'No valid user mapping found for hero candidates.', period: 'yesterday_back_7_days', source });
        }
        return {
            state: 'winner',
            user: winner,
            stats: winningStats,
            reason: this.determineHeroReason(winningStats),
            period: 'yesterday_back_7_days',
            source,
            confidence: this.computeHeroConfidence(winningStats, policy),
            schemaVersion: Number(policy.SCHEMA_VERSION || 1),
            meta: {
                startDate: this.toLocalDateKey(dataset?.start),
                endDate: this.toLocalDateKey(dataset?.end),
                windowDays: dataset?.windowDays || primaryWindow,
                usedFallbackWindow: Number(dataset?.windowDays || primaryWindow) > primaryWindow
            }
        };
    }

    /**
     * Single source of truth for the weekly hero. Builds the ranked/eligibility board for the
     * effective window (primary, widened to FALLBACK_LOOKBACK_DAYS when nobody is eligible) and
     * returns both the full rows and the winning (top eligible) row. Both getHeroLeaderboard and
     * getHeroOfTheWeek consume this so the mini card and the audit table always agree.
     */
    async buildHeroRanking(options = {}) {
        const policy = this.getHeroPolicy();
        const source = String(options.source || 'direct_cache');
        const primaryWindow = Math.max(1, Number(options.windowDays ?? policy.WINDOW_DAYS ?? 7));
        const fallbackWindow = Math.max(primaryWindow, Math.round(Number(policy.FALLBACK_LOOKBACK_DAYS ?? primaryWindow)));
        const minEvidence = policy.MIN_EVIDENCE || {};
        const minDays = Math.max(1, Number(minEvidence.minDays || 1));
        const minDurationMs = Math.max(0, Number(minEvidence.minDurationMs || 1));
        const minPlannedTasks = Math.max(0, Number(minEvidence.minPlannedTasks || 1));

        const rankWindow = async (windowDays) => {
            const dataset = await this.getHeroSharedDataset({ ...options, windowDays });
            const normalizedLogs = this.normalizeHeroLogs(dataset.logs);
            const normalizedTasks = this.normalizeHeroTasksFromActivities(dataset.activityRows, dataset.users);
            const taskStats = this.mergeTaskStats(
                this.buildHeroTaskStats(normalizedTasks),
                this.buildAttendanceTaskStats(normalizedLogs)
            );
            const ranked = this.rankHeroCandidates(
                this.buildHeroCandidateStats(normalizedLogs),
                taskStats,
                policy,
                dataset.logs,
                dataset.workPlans,
                { start: dataset.start, end: dataset.end }
            );
            const taskBuckets = this.buildHeroTaskBuckets(normalizedTasks);
            const rankedMap = new Map(ranked.map((row, index) => [String(row.userId), { ...row, rank: index + 1 }]));
            const rows = (Array.isArray(dataset.users) ? dataset.users : []).map((user) => {
                const userId = String(user?.id || '').trim();
                const stats = rankedMap.get(userId) || { ...this.createZeroHeroStats(userId), rank: null };
                const isEligible = stats.taskPlanned >= minPlannedTasks
                    && stats.days >= minDays
                    && stats.totalDurationMs >= minDurationMs;
                return {
                    user,
                    stats,
                    rank: stats.rank,
                    isEligible,
                    taskBuckets: taskBuckets.get(userId) || {
                        completed: [],
                        in_progress: [],
                        postponed: [],
                        missed: []
                    },
                    eligibilityReason: isEligible
                        ? 'Eligible'
                        : `Needs at least ${minPlannedTasks} planned task${minPlannedTasks === 1 ? '' : 's'}, ${minDays} day${minDays === 1 ? '' : 's'}, and ${Math.round(minDurationMs / 3600000)} hours tracked.`,
                    period: 'yesterday_back_7_days'
                };
            }).sort((a, b) => {
                const aRank = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
                const bRank = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER;
                if (aRank !== bRank) return aRank - bRank;
                return String(a.user?.name || '').localeCompare(String(b.user?.name || ''));
            });
            const winner = rows.find((row) => row.isEligible) || null;
            return { dataset, rows, winner };
        };

        let result = await rankWindow(primaryWindow);
        if (!result.winner && fallbackWindow > primaryWindow) {
            const fallbackResult = await rankWindow(fallbackWindow);
            if (fallbackResult.winner) {
                result = fallbackResult;
            }
        }

        return {
            policy,
            source,
            primaryWindow,
            dataset: result.dataset,
            rows: result.rows,
            winnerRow: result.winner,
            usedFallbackWindow: Number(result.dataset?.windowDays || primaryWindow) > primaryWindow
        };
    }

    async getHeroOfTheWeek(options = {}) {
        try {
            const ranking = await this.buildHeroRanking(options);
            if (!ranking.winnerRow) {
                return {
                    ...this.createNoHeroPayload({
                        reason: 'No staff met the minimum hero criteria in the current window.',
                        period: 'yesterday_back_7_days',
                        source: ranking.source
                    }),
                    period: 'yesterday_back_7_days',
                    source: ranking.source,
                    schemaVersion: Number(ranking.policy.SCHEMA_VERSION || 1),
                    meta: {
                        windowDays: ranking.dataset?.windowDays || ranking.primaryWindow,
                        usedFallbackWindow: ranking.usedFallbackWindow,
                        startDate: this.toLocalDateKey(ranking.dataset?.start),
                        endDate: this.toLocalDateKey(ranking.dataset?.end)
                    }
                };
            }
            return this.buildDatedHeroPayload(ranking.winnerRow.stats, ranking.dataset, {
                primaryWindow: ranking.primaryWindow,
                source: ranking.source,
                policy: ranking.policy
            });
        } catch (err) {
            console.error('Hero Calculation Error:', err);
            return {
                state: 'fetch_error',
                user: null,
                stats: null,
                reason: 'Unable to calculate hero right now.',
                period: 'weekly',
                source: String(options.source || 'direct_cache'),
                confidence: 0,
                schemaVersion: Number(this.getHeroPolicy()?.SCHEMA_VERSION || 1)
            };
        }
    }

    async getHeroLeaderboard(options = {}) {
        try {
            const ranking = await this.buildHeroRanking(options);
            return {
                state: 'ok',
                period: 'yesterday_back_7_days',
                source: ranking.source,
                rows: ranking.rows,
                winnerUserId: ranking.winnerRow?.user?.id || null,
                meta: {
                    startDate: this.toLocalDateKey(ranking.dataset?.start),
                    endDate: this.toLocalDateKey(ranking.dataset?.end),
                    usedFallbackWindow: ranking.usedFallbackWindow,
                    windowDays: ranking.dataset?.windowDays || ranking.primaryWindow,
                    schemaVersion: Number(ranking.policy.SCHEMA_VERSION || 1)
                }
            };
        } catch (err) {
            console.error('Hero Leaderboard Error:', err);
            return {
                state: 'fetch_error',
                period: 'yesterday_back_7_days',
                source: String(options.source || 'direct_cache'),
                rows: [],
                winnerUserId: null,
                meta: {
                    schemaVersion: Number(this.getHeroPolicy()?.SCHEMA_VERSION || 1)
                }
            };
        }
    }

    determineHeroReason(stats) {
        const policy = this.getHeroPolicy();
        const expected = Math.max(1, Number(policy.EXPECTED_WEEKLY_TASKS || 5));
        const planned = Number(stats?.taskPlanned || 0);
        const completed = Number(stats?.taskCompleted || 0);
        const inProgress = Number(stats?.taskInProgress || 0);
        const missed = Number(stats?.taskMissed || 0);
        const completionRate = planned > 0 ? (completed / planned) * 100 : 0;
        const volumeRatio = completed / expected;

        if (volumeRatio >= 1.2 && completionRate >= 80) return "Execution Champion";
        if (volumeRatio >= 1.0 && completionRate >= 70 && missed === 0) return "Committed Planner";
        if (completed >= expected && inProgress >= 2) return "Delivery Momentum";
        if (volumeRatio >= 0.8 && completionRate >= 70) return "Reliable Executor";
        if (planned > 0 && missed === 0 && completionRate >= 60) return "Reliable Finisher";
        return "Top Performer";
    }

    async getSystemPerformance() {
        try {
            const start = new Date();
            start.setDate(start.getDate() - 7);
            const logs = await this.getAttendanceInRange(start, new Date(), 'performance');
            const trendData = [];
            const labels = [];
            let totalScore = 0;
            let scoreCount = 0;

            const isSameDay = (d1, d2) => {
                return d1.getFullYear() === d2.getFullYear() &&
                    d1.getMonth() === d2.getMonth() &&
                    d1.getDate() === d2.getDate();
            };

            for (let i = 6; i >= 0; i--) {
                const targetDate = new Date();
                targetDate.setDate(targetDate.getDate() - i);

                const label = targetDate.toLocaleDateString('en-US', { weekday: 'narrow' });
                labels.push(label);
                const dayLogs = logs.filter(l => {
                    const logDate = new Date(l.date);
                    return !isNaN(logDate.getTime()) && isSameDay(logDate, targetDate);
                });

                if (dayLogs.length === 0) {
                    trendData.push(0);
                } else {
                    const dayScores = dayLogs.map(l => l.activityScore || 0).filter(s => s > 0);
                    const dayAvg = dayScores.length > 0 ? dayScores.reduce((a, b) => a + b, 0) / dayScores.length : 0;
                    trendData.push(Math.round(dayAvg));

                    if (dayAvg > 0) {
                        totalScore += dayAvg;
                        scoreCount++;
                    }
                }
            }

            const finalAvg = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;

            return {
                avgScore: finalAvg,
                trendData: trendData,
                labels: labels
            };
        } catch (err) {
            console.error("System Performance Calculation Error:", err);
            return { avgScore: 0, trendData: [0, 0, 0, 0, 0, 0, 0] };
        }
    }

    async buildDailyDashboardSummary(options = {}) {
        const now = new Date();
        const dateKey = String(options.dateKey || now.toISOString().split('T')[0]);
        const monthKey = String(options.selectedMonth || now.toISOString().slice(0, 7));
        const [yearStr, monthStr] = monthKey.split('-');
        const year = Number(yearStr);
        const monthIndex = Number(monthStr) - 1;
        const monthStart = (Number.isInteger(year) && Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex <= 11)
            ? new Date(year, monthIndex, 1)
            : new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = (Number.isInteger(year) && Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex <= 11)
            ? new Date(year, monthIndex + 1, 0)
            : new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const activityLimit = Math.max(1, Number(AppConfig?.SUMMARY_POLICY?.TEAM_ACTIVITY_LIMIT) || 15);

        const [hero, heroLeaderboard, teamActivities] = await Promise.all([
            this.getHeroOfTheWeek({ source: 'shared_summary' }),
            this.getHeroLeaderboard({ source: 'shared_summary' }),
            this.getAllStaffActivities({ mode: 'month', month: monthKey, scope: 'all', sideEffects: false })
        ]);

        return {
            dateKey,
            monthKey,
            version: Number(AppConfig?.SUMMARY_POLICY?.SCHEMA_VERSION || 1),
            generatedAt: Date.now(),
            hero: (hero && hero.state !== 'fetch_error') ? hero : null,
            heroLeaderboard: (heroLeaderboard && heroLeaderboard.state !== 'fetch_error') ? heroLeaderboard : null,
            teamActivityPreview: (teamActivities || []).slice(0, activityLimit),
            range: {
                startIso: monthStart.toISOString().split('T')[0],
                endIso: monthEnd.toISOString().split('T')[0]
            },
            meta: {
                generatedAt: Date.now(),
                source: 'client_first_writer',
                generationGate: 'first_checkin'
            }
        };
    }

    async getAllStaffActivities(options = {}) {
        try {
            const normalized = options || {};
            const mode = normalized.mode || 'month';
            const scope = normalized.scope || 'all';
            const sideEffects = normalized.sideEffects !== false;

            const normalizeDateInput = (value) => {
                const raw = String(value || '').trim();
                if (!raw) return '';
                const cleaned = raw.replace(/\s+/g, '');
                if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
                if (/^\d{2}-\d{2}-\d{4}$/.test(cleaned)) {
                    const [d, m, y] = cleaned.split('-');
                    return `${y}-${m}-${d}`;
                }
                if (/^\d{4}\/\d{2}\/\d{2}$/.test(cleaned)) return cleaned.replace(/\//g, '-');
                if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleaned)) {
                    const [d, m, y] = cleaned.split('/');
                    return `${y}-${m}-${d}`;
                }
                const parsed = new Date(raw);
                if (!Number.isNaN(parsed.getTime())) {
                    return parsed.toISOString().split('T')[0];
                }
                return '';
            };

            const endDate = new Date();
            const startDate = new Date();

            if (mode === 'range') {
                const startIsoRaw = String(normalized.startIso || '');
                const endIsoRaw = String(normalized.endIso || '');
                let startIsoNormalized = normalizeDateInput(startIsoRaw);
                let endIsoNormalized = normalizeDateInput(endIsoRaw);
                if (!startIsoNormalized || !endIsoNormalized) {
                    console.warn('Invalid range dates, falling back to last 30 days:', startIsoRaw, endIsoRaw);
                    const fallbackEnd = new Date();
                    const fallbackStart = new Date();
                    fallbackStart.setDate(fallbackEnd.getDate() - 30);
                    startIsoNormalized = fallbackStart.toISOString().split('T')[0];
                    endIsoNormalized = fallbackEnd.toISOString().split('T')[0];
                }
                if (startIsoNormalized > endIsoNormalized) {
                    const tmp = startIsoNormalized;
                    startIsoNormalized = endIsoNormalized;
                    endIsoNormalized = tmp;
                }
                const rangeStart = new Date(startIsoNormalized);
                const rangeEnd = new Date(endIsoNormalized);
                startDate.setTime(rangeStart.getTime());
                endDate.setTime(rangeEnd.getTime());
                startDate.setHours(0, 0, 0, 0);
                endDate.setHours(23, 59, 59, 999);
            } else if (mode === 'days') {
                const daysBack = Number.isFinite(Number(normalized.daysBack))
                    ? Number(normalized.daysBack)
                    : 7;
                endDate.setHours(23, 59, 59, 999);
                startDate.setDate(startDate.getDate() - daysBack);
                startDate.setHours(0, 0, 0, 0);
            } else {
                const monthKey = String(normalized.month || new Date().toISOString().slice(0, 7));
                const [yearStr, monthStr] = monthKey.split('-');
                const year = Number(yearStr);
                const monthIndex = Number(monthStr) - 1;
                if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
                    throw new Error(`Invalid month key: ${monthKey}`);
                }
                const monthStart = new Date(year, monthIndex, 1);
                const monthEnd = new Date(year, monthIndex + 1, 0);
                startDate.setTime(monthStart.getTime());
                endDate.setTime(monthEnd.getTime());
                startDate.setHours(0, 0, 0, 0);
                endDate.setHours(23, 59, 59, 999);
            }

            const startIso = startDate.toISOString().split('T')[0];
            const endIso = endDate.toISOString().split('T')[0];

            if (sideEffects && window.AppCalendar?.ensureCarryForwardForRange) {
                await window.AppCalendar.ensureCarryForwardForRange(startIso, endIso);
            }
            if (sideEffects && window.AppCalendar?.cleanupInvalidTodayCarryForwardForDate) {
                const todayKey = window.AppCalendar.getTodayKey ? window.AppCalendar.getTodayKey() : '';
                if (todayKey && todayKey >= startIso && todayKey <= endIso) {
                    try {
                        const cleanupRes = await window.AppCalendar.cleanupInvalidTodayCarryForwardForDate(todayKey, { onlyToday: true });
                        if ((cleanupRes?.removed || 0) > 0) {
                            console.log(`Team activity global cleanup removed ${cleanupRes.removed} invalid carry task(s) for ${todayKey}.`);
                        }
                    } catch (cleanupErr) {
                        console.warn('Global invalid carry cleanup failed:', cleanupErr);
                    }
                }
            }

            const shouldFetchAttendance = scope !== 'work';
            const shouldFetchManualWorkLogs = scope === 'work';
            const hasSharedData = Array.isArray(normalized.sharedLogs) && Array.isArray(normalized.sharedWorkPlans);
            const [attendanceLogs, workPlans, users] = await Promise.all([
                hasSharedData
                    ? Promise.resolve(normalized.sharedLogs)
                    : shouldFetchAttendance
                        ? this.getAttendanceInRange(startDate, endDate, `staffAct:${startIso}:${endIso}:${scope}`)
                        : shouldFetchManualWorkLogs
                            ? this.getAttendanceInRange(startDate, endDate, `staffActManual:${startIso}:${endIso}`)
                        : Promise.resolve([]),
                hasSharedData
                    ? Promise.resolve(normalized.sharedWorkPlans)
                    : this.db.queryMany
                        ? this.memoize(
                            `analytics:workPlans:${mode}:${scope}:${startIso}:${endIso}`,
                            Math.max(
                                30000,
                                Number(this.getTtls().staffActivitiesReadMs || 0),
                                Number(this.getTtls().attendanceSummary || 0),
                                Number(this.getTtls().workPlansAllReadMs || 0)
                            ),
                            async () => this.db.queryMany('work_plans', [
                                { field: 'date', operator: '>=', value: startIso },
                                { field: 'date', operator: '<=', value: endIso }
                            ])
                        )
                        : (() => {
                            console.warn('[Analytics] queryMany unavailable — falling back to getAll work_plans for staff activities');
                            return AppDB.getAll('work_plans').then((rows) => (rows || []).filter((row) => {
                                const d = String(row?.date || '');
                                return d >= startIso && d <= endIso;
                            }));
                        })(),
                this.getUsersCached()
            ]);

            const usersMap = {};
            users.forEach(userData => {
                usersMap[userData.id] = userData.name;
            });

            const mergedActivities = [];
            const attendanceContentByDay = {}; // Map of "userId:date" -> [arrayOfWorkDescriptions]
            const isTaggedCopyOriginTask = (task = {}) => {
                if (window.AppCalendar?.isTaggedCopyOriginTask) {
                    return window.AppCalendar.isTaggedCopyOriginTask(task);
                }
                const addedFrom = String(task.addedFrom || '').toLowerCase().trim();
                const fromTaggedSource = addedFrom === 'tag' || addedFrom === 'delegated' || addedFrom === 'staff';
                const hasSourceReference = !!task.sourcePlanId
                    || Number.isInteger(task.sourceTaskIndex)
                    || Number.isFinite(Number(task.sourceTaskIndex));
                return fromTaggedSource || hasSourceReference;
            };
            const hasCarryForwardLineage = (task = {}) => {
                if (window.AppCalendar?.hasCarryForwardLineage) {
                    return window.AppCalendar.hasCarryForwardLineage(task);
                }
                return !!(
                    task.carryForwardRootId
                    || task.isAutoForwarded === true
                    || task.carriedForwardFromDate
                    || task.carriedForwardFromPlanId
                );
            };
            const resolveOriginDate = (task = {}) => {
                if (window.AppCalendar?.resolveTaskOriginDate) {
                    return String(window.AppCalendar.resolveTaskOriginDate(task) || '');
                }
                const direct = String(task.carriedForwardFromDate || '').trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
                const src = String(task.sourcePlanId || '').match(/(\d{4}-\d{2}-\d{2})/);
                if (src) return src[1];
                const root = String(task.carryForwardRootId || '').match(/(\d{4}-\d{2}-\d{2})/);
                if (root) return root[1];
                return '';
            };
            const hasLegacyTaggedTextPattern = (task = {}) => {
                if (window.AppCalendar?.hasLegacyTaggedTextPattern) {
                    return !!window.AppCalendar.hasLegacyTaggedTextPattern(task);
                }
                const text = String(task.task || '');
                if (!text) return false;
                const repeatedResponsible = (text.match(/\(Responsible:/gi) || []).length > 1;
                return repeatedResponsible;
            };
            const normalizePlanStatus = (plan = {}) => {
                const raw = String(plan.status || '').trim().toLowerCase();
                if (['completed', 'complete', 'done', 'finished', 'closed'].includes(raw)) return 'completed';
                if (['postponed', 'postpone'].includes(raw)) return 'postponed';
                if (['not-completed', 'not completed', 'cancelled', 'canceled', 'removed'].includes(raw)) return 'not-completed';
                if (['in-process', 'in process', 'working', 'started'].includes(raw)) return 'in-process';
                if (['to-be-started', 'to be started', 'pending', 'planned'].includes(raw)) return 'to-be-started';
                if (plan.completedDate || plan.completedAt || plan.completed_on) return 'completed';
                return '';
            };

            if (shouldFetchAttendance || shouldFetchManualWorkLogs) {
                attendanceLogs.forEach(log => {
                    if (shouldFetchManualWorkLogs && String(log.entrySource || '') !== 'staff_manual_work') return;
                    const logDateKey = normalizeDateInput(log.date);
                    if (logDateKey && logDateKey >= startIso && logDateKey <= endIso && log.workDescription) {
                        const userKey = log.user_id || log.userId;
                        const dayKey = `${userKey}:${logDateKey}`;
                        if (!attendanceContentByDay[dayKey]) attendanceContentByDay[dayKey] = [];
                        attendanceContentByDay[dayKey].push(log.workDescription.toLowerCase().trim());

                        mergedActivities.push({
                            ...log,
                            type: 'attendance',
                            staffName: usersMap[userKey] || log.userName || 'Unknown Staff',
                            _displayDesc: log.workDescription,
                            _sortTime: log.checkOut || '00:00',
                            status: 'completed',
                            date: logDateKey
                        });
                    }
                });
            }

            // Process Work Plans
            const staffActViewerId = getCurrentViewerId();
            workPlans.forEach(wp => {
                const wpDateKey = normalizeDateInput(wp.date);
                if (wpDateKey && wpDateKey >= startIso && wpDateKey <= endIso && wp.plans) {
                    const dayKey = `${wp.userId}:${wpDateKey}`;
                    const dayAttendanceContent = attendanceContentByDay[dayKey] || [];

                    wp.plans.forEach((plan, idx) => {
                        if (plan?.isRemoved === true) return;
                        // Private tasks are visible only to the plan owner or the assignee.
                        if (plan?.isPrivate === true && !isTaskVisibleToViewer(plan, String(wp.userId || ''), staffActViewerId)) return;
                        const isOldCarryForwardTask = (() => {
                            const normalizedStatus = String(plan?.status || '').trim().toLowerCase();
                            const isClosed = normalizedStatus === 'completed'
                                || normalizedStatus === 'not-completed'
                                || normalizedStatus === 'cancelled';
                            if (isClosed) return false;
                            const lineage = hasCarryForwardLineage(plan);
                            const originDate = resolveOriginDate(plan);
                            const previousDate = window.AppCalendar?.getPreviousDateKey
                                ? window.AppCalendar.getPreviousDateKey(wpDateKey)
                                : (() => {
                                    const d = new Date(`${wpDateKey}T00:00:00`);
                                    if (Number.isNaN(d.getTime())) return '';
                                    d.setDate(d.getDate() - 1);
                                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                })();
                            if (lineage) {
                                if (originDate && previousDate && originDate < previousDate) return true;
                                if (originDate && previousDate && originDate > previousDate) return true;
                                if (!originDate) return true;
                                if (previousDate && originDate && originDate !== previousDate) return true;
                                if (String(plan.carryForwardPolicy || '') && String(plan.carryForwardPolicy) !== 'next_day_only') return true;
                            }
                            if (isTaggedCopyOriginTask(plan) && hasLegacyTaggedTextPattern(plan)) return true;
                            return false;
                        })();
                        if (isOldCarryForwardTask) return;
                        // Deduplication Logic:
                        // If this task text is found as a substring within any associated attendance log's description 
                        // (which often happens at checkout when tasks are auto-appended to summary), we skip it here.
                        const taskText = (plan.task || '').trim().toLowerCase();
                        if (taskText && dayAttendanceContent.length > 0) {
                            const isDuplicate = dayAttendanceContent.some(desc => desc.includes(taskText));
                            if (isDuplicate) return; // Skip this task as it's already covered by an attendance log
                        }

                        const wpUserId = wp.userId || wp.user_id;
                        let staffName = usersMap[wpUserId] || wp.userName;
                        if (!staffName) {
                            staffName = (wpUserId === 'annual_shared') ? 'All Staff' : 'Unknown Staff';
                        }

                        const effectiveStatus = normalizePlanStatus(plan);
                        mergedActivities.push({
                            ...plan,
                            date: wpDateKey,
                            id: wp.id, // work_plan document id
                            planId: wp.id,
                            taskIndex: idx,
                            planScope: plan.planScope || wp.planScope || 'personal',
                            userId: wpUserId,
                            type: 'work',
                            staffName: staffName,
                            status: effectiveStatus,
                            _displayDesc: plan.task,
                            // Work plans are date-based tasks and may not have an actual time.
                            // Keep this empty so UI can show '--' instead of a fake default time.
                            _sortTime: ''
                        });
                    });
                }
            });

            // Sort by date descending, then by sort time descending
            mergedActivities.sort((a, b) => {
                const dateCompare = new Date(b.date) - new Date(a.date);
                if (dateCompare !== 0) return dateCompare;
                return b._sortTime.localeCompare(a._sortTime);
            });

            return mergedActivities;
        } catch (err) {
            console.error("Error fetching all staff activities:", err);
            return [];
        }
    }

    // ─── Personal Performance ─────────────────────────────────────
    // Computes 6-dimension performance score + 4-week trend for a single user.

    async getPersonalPerformance(userId, options = {}) {
    try {
        const windowDays = Math.max(1, Number(options.windowDays ?? 7));
        const trendWeeks = Math.max(1, Number(options.trendWeeks ?? 4));
        const useCalendarMonth = options.calendarMonth === true;
        const policy = this.getHeroPolicy();
        const weights = policy.WEIGHTS || {};
        const caps = policy.CAPS || {};

        // Weights for the 6 dimensions
        const wPunctuality = 0.15;
        const wAttendance = 0.20;
        const wTaskExecution = 0.25;
        const wProductivity = 0.15;
        const wPlanning = 0.15;
        const wCompliance = 0.10;

        // Build date ranges — non-overlapping windows, step = windowDays
        const now = new Date();
        const windows = [];
        if (useCalendarMonth) {
            // Calendar month: current month as primary, previous 3 months for trend
            for (let i = 0; i < trendWeeks; i++) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
                const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
                const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                windows.push({ start: monthStart, end: monthEnd, label, index: i });
            }
        } else if (windowDays >= 365) {
            // Yearly: single year window + 12 monthly trend points
            const yearStart = new Date(now.getFullYear(), 0, 1);
            const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
            windows.push({ start: yearStart, end: yearEnd, label: `${now.getFullYear()}`, index: 0 });
        } else {
            for (let i = 0; i < trendWeeks; i++) {
                const end = new Date(now);
                end.setDate(now.getDate() - (i * windowDays) - 1);
                end.setHours(23, 59, 59, 999);
                const start = new Date(end);
                start.setDate(end.getDate() - (windowDays - 1));
                start.setHours(0, 0, 0, 0);
                const label = windowDays <= 7
                    ? `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                    : start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                windows.push({ start, end, label, index: i });
            }
        }

        // Fetch all needed data in parallel
        const windowRanges = windows.map(w => ({ start: w.start, end: w.end }));

        const [attendanceChunks, workPlanChunks] = await Promise.all([
            Promise.all(windowRanges.map((r, i) =>
                this.getAttendanceInRange(r.start, r.end, `perf:${userId}:${i}`)
            )),
            Promise.all(windowRanges.map((r, i) => {
                const startIso = this.toLocalDateKey(r.start);
                const endIso = this.toLocalDateKey(r.end);
                return this.db.queryMany
                    ? this.db.queryMany('work_plans', [
                        { field: 'date', operator: '>=', value: startIso },
                        { field: 'date', operator: '<=', value: endIso }
                    ])
                    : this.db.getAll('work_plans').then(rows =>
                        (rows || []).filter(row => {
                            const d = String(row?.date || '');
                            return d >= startIso && d <= endIso;
                        })
                    );
            }))
        ]);

        // Filter to target user
        const filterUser = (logs) => logs.filter(l =>
            String(l?.userId || l?.user_id || '') === String(userId)
        );

        // Compute scores for each window
        const windowScores = windows.map((win, i) => {
            let userLogs = filterUser(attendanceChunks[i] || []);
            // Deduplicate: one log per day (same as Monthly Stats)
            userLogs = this.pickBestAttendanceLogPerDay(userLogs, win.start, win.end);
            const userPlans = (workPlanChunks[i] || []).filter(p =>
                String(p?.userId || p?.user_id || '') === String(userId)
            );
            return this._computeWeekPerformance(userLogs, userPlans, win, {
                wPunctuality, wAttendance, wTaskExecution, wProductivity, wPlanning, wCompliance,
                windowDays: useCalendarMonth ? Math.max(1, Math.round((win.end - win.start) / (1000 * 60 * 60 * 24)) + 1) : windowDays,
                caps, weights, policy
            });
        });

        // Current week is index 0 (most recent)
        const current = windowScores[0] || this._emptyPerformance();

        // Get the SAME attendance stats that getUserMonthlyStats() returns
        // so both the Performance widget and Monthly Stats card show identical numbers
        const currentUserLogs = filterUser(attendanceChunks[0] || []);
        const canonicalUserLogs = this.pickBestAttendanceLogPerDay(currentUserLogs, windows[0].start, windows[0].end);
        const currentStats = this.calculateStatsForLogs(canonicalUserLogs);

        // Build trend (index 0 = oldest, ascending chronological, max 6 points)
        const trend = windowScores.slice().reverse().slice(-6).map((ws, i) => ({
            week: ws.label,
            score: ws.composite
        }));

        // Insights (use same stats as Monthly Stats for consistency)
        const insights = this._generatePerformanceInsights(current, trend, userId, windowDays, currentStats);

        return {
            userId,
            composite: current.composite,
            dimensions: current.dimensions,
            details: current.details,
            stats: currentStats,
            trend,
            insights,
            windowDays: options.windowDays ?? 7,
            computedAt: Date.now()
        };
    } catch (err) {
        console.warn('[Analytics] getPersonalPerformance failed for', userId, err?.message || err);
        const empty = this._emptyPerformance();
        const defaultWindowDays = Math.max(1, Number(options.windowDays ?? 7));
        return { ...empty, userId, trend: [], insights: [], windowDays: defaultWindowDays, computedAt: Date.now() };
    }
    }

    _computeWeekPerformance(userLogs, userPlans, week, config) {
        const { wPunctuality, wAttendance, wTaskExecution, wProductivity, wPlanning, wCompliance, windowDays, caps, weights, policy } = config;
        const label = week.label;

        // ── PUNCTUALITY (0–100) ──
        const lateDays = userLogs.filter(l => l.lateCountable === true || String(l.type || '').toLowerCase() === 'late').length;
        const totalDays = userLogs.length;
        const punctuality = totalDays > 0
            ? Math.max(0, Math.round(((totalDays - lateDays) / totalDays) * 100))
            : 50; // neutral default

        // ── ATTENDANCE (0–100) ──
        const daysWorked = new Set(userLogs.map(l => String(l.date || ''))).size;
        const attendance = Math.min(100, Math.round((daysWorked / windowDays) * 100));

        // ── TASK EXECUTION (0–100) ──
        let taskPlanned = 0, taskCompleted = 0, taskMissed = 0, taskPostponed = 0, taskInProgress = 0;
        let onTimeCompleted = 0, lateCompleted = 0;
        userPlans.forEach(wp => {
            if (!Array.isArray(wp?.plans)) return;
            wp.plans.forEach(task => {
                if (!task || task.isRemoved === true) return;
                if (!String(task.task || '').trim()) return;
                taskPlanned++;
                const status = this.classifyHeroTaskStatus(task.status, wp.date);
                if (status === 'completed') {
                    taskCompleted++;
                    // On-time check
                    if (task.completedDate && wp.date) {
                        const diffMs = new Date(task.completedDate).getTime() - new Date(wp.date + 'T23:59:59').getTime();
                        if (diffMs <= 0) onTimeCompleted++;
                        else lateCompleted++;
                    } else {
                        onTimeCompleted++; // no date = assumed on-time
                    }
                } else if (status === 'missed') taskMissed++;
                else if (status === 'postponed') taskPostponed++;
                else taskInProgress++;
            });
        });
        const completionRate = taskPlanned > 0 ? (taskCompleted / taskPlanned) * 100 : 0;
        const onTimeRate = taskCompleted > 0 ? (onTimeCompleted / taskCompleted) * 100 : 100;
        const missRate = taskPlanned > 0 ? (taskMissed / taskPlanned) * 100 : 0;
        const taskExecution = Math.max(0, Math.min(100, Math.round(
            completionRate * 0.5 + onTimeRate * 0.2 - missRate * 0.3
        )));

        // ── PRODUCTIVITY (0–100) ──
        const activityScores = userLogs
            .map(l => Number(l.activityScore))
            .filter(s => Number.isFinite(s));
        const avgActivity = activityScores.length > 0
            ? activityScores.reduce((a, b) => a + b, 0) / activityScores.length
            : 50;
        // Count extra hours only from working-day logs (same logic as Monthly Stats)
        const totalExtraMs = userLogs.reduce((sum, l) => {
            const type = String(l?.type || '');
            if (type.includes('Leave') || type === 'Absent') return sum;
            const confirmed = typeof l?.extraTimeConfirmedMs === 'number' && l.extraTimeConfirmedMs > 0 ? l.extraTimeConfirmedMs : 0;
            const stored = typeof l?.extraWorkedMs === 'number' && l.extraWorkedMs > 0 ? l.extraWorkedMs : 0;
            return sum + (confirmed || stored);
        }, 0);
        const extraHours = totalExtraMs / (1000 * 60 * 60);
        const workDescDepth = userLogs.reduce((sum, l) =>
            sum + String(l?.workDescription || '').length, 0
        );
        const depthScore = Math.min(100, (workDescDepth / Math.max(1, totalDays * 200)) * 100);
        const expectedExtraHours = Math.max(1, windowDays * 0.5); // ~0.5h extra per day expected
        const extraHoursScore = Math.min(100, (extraHours / expectedExtraHours) * 100);
        const productivity = Math.round(
            avgActivity * 0.4 + extraHoursScore * 0.3 + depthScore * 0.3
        );

        // ── PLANNING (0–100) ──
        const expectedWeeklyTasks = Math.max(1, Number(policy.EXPECTED_WEEKLY_TASKS || 5));
        const expectedTasks = Math.max(1, Math.round(expectedWeeklyTasks * (windowDays / 7)));
        const planVolume = Math.min(100, (taskPlanned / expectedTasks) * 100);
        const subPlanCount = userPlans.reduce((sum, wp) =>
            sum + (Array.isArray(wp?.plans) ? wp.plans.filter(t =>
                Array.isArray(t?.subPlans) && t.subPlans.length > 0
            ).length : 0), 0
        );
        const subPlanScore = Math.min(100, subPlanCount * 20);
        const planning = Math.round(planVolume * 0.6 + subPlanScore * 0.2 + (taskCompleted > 0 ? 20 : 0));

        // ── COMPLIANCE (0–100) ──
        const locationMismatches = userLogs.filter(l => l.locationMismatched === true).length;
        const autoCheckouts = userLogs.filter(l => l.autoCheckout === true).length;
        const compliance = Math.max(0, Math.min(100, Math.round(100
            - (totalDays > 0 ? (locationMismatches / totalDays) * 50 : 0)
            - (totalDays > 0 ? (autoCheckouts / totalDays) * 50 : 0)
        )));

        // ── COMPOSITE ──
        const composite = Math.round(
            punctuality * wPunctuality
            + attendance * wAttendance
            + taskExecution * wTaskExecution
            + productivity * wProductivity
            + planning * wPlanning
            + compliance * wCompliance
        );

        return {
            label,
            composite,
            dimensions: {
                punctuality: { score: punctuality, label: 'Punctuality', icon: 'fa-solid fa-clock', color: '#3b82f6' },
                attendance: { score: attendance, label: 'Attendance', icon: 'fa-solid fa-calendar-check', color: '#10b981' },
                taskExecution: { score: taskExecution, label: 'Task Execution', icon: 'fa-solid fa-list-check', color: '#f59e0b' },
                productivity: { score: productivity, label: 'Productivity', icon: 'fa-solid fa-bolt', color: '#8b5cf6' },
                planning: { score: planning, label: 'Planning', icon: 'fa-solid fa-clipboard-list', color: '#06b6d4' },
                compliance: { score: compliance, label: 'Compliance', icon: 'fa-solid fa-shield-halved', color: '#22c55e' }
            },
            details: {
                lateDays, totalDays, daysWorked,
                taskPlanned, taskCompleted, taskMissed, taskPostponed, taskInProgress,
                onTimeCompleted, lateCompleted,
                avgActivity: Math.round(avgActivity), extraHours: Number(extraHours.toFixed(1)),
                locationMismatches, autoCheckouts
            }
        };
    }

    _emptyPerformance() {
        return {
            composite: 0,
            dimensions: {
                punctuality: { score: 0, label: 'Punctuality', icon: 'fa-solid fa-clock', color: '#3b82f6' },
                attendance: { score: 0, label: 'Attendance', icon: 'fa-solid fa-calendar-check', color: '#10b981' },
                taskExecution: { score: 0, label: 'Task Execution', icon: 'fa-solid fa-list-check', color: '#f59e0b' },
                productivity: { score: 0, label: 'Productivity', icon: 'fa-solid fa-bolt', color: '#8b5cf6' },
                planning: { score: 0, label: 'Planning', icon: 'fa-solid fa-clipboard-list', color: '#06b6d4' },
                compliance: { score: 0, label: 'Compliance', icon: 'fa-solid fa-shield-halved', color: '#22c55e' }
            },
            details: {},
            label: ''
        };
    }

    _generatePerformanceInsights(current, trend, userId, windowDays = 7, sharedStats = null) {
        const insights = [];
        const dims = current.dimensions || {};
        const details = current.details || {};
        const periodLabel = windowDays <= 7 ? 'week' : windowDays <= 31 ? 'period' : 'period';

        // Strongest dimension
        let maxDim = null, maxScore = -1;
        Object.entries(dims).forEach(([key, d]) => {
            if (d.score > maxScore) { maxScore = d.score; maxDim = key; }
        });
        if (maxDim && maxScore > 70) {
            insights.push({ type: 'positive', text: `Strongest area: ${dims[maxDim].label} (${maxScore}/100)` });
        }

        // Weakest dimension
        let minDim = null, minScore = 101;
        Object.entries(dims).forEach(([key, d]) => {
            if (d.score < minScore) { minScore = d.score; minDim = key; }
        });
        if (minDim && minScore < 60) {
            insights.push({ type: 'improve', text: `Focus area: ${dims[minDim].label} (${minScore}/100)` });
        }

        // Trend
        if (trend.length >= 2) {
            const latest = trend[trend.length - 1].score;
            const prev = trend[trend.length - 2].score;
            const diff = latest - prev;
            if (diff > 5) insights.push({ type: 'positive', text: `Improving trend: +${diff} points from previous ${periodLabel}` });
            else if (diff < -5) insights.push({ type: 'warning', text: `Declining: ${diff} points from previous ${periodLabel}` });
            else insights.push({ type: 'neutral', text: `Stable performance this ${periodLabel}` });
        }

        // Late days (use shared stats for consistency with Monthly Stats)
        const lateCount = sharedStats?.late ?? details.lateDays;
        if (lateCount > 0) {
            insights.push({ type: 'warning', text: `${lateCount} late day${lateCount > 1 ? 's' : ''} this ${periodLabel}` });
        }

        // Missed tasks
        if (details.taskMissed > 0) {
            insights.push({ type: 'improve', text: `${details.taskMissed} task${details.taskMissed > 1 ? 's' : ''} missed — review and reschedule` });
        }

        // Extra hours (use shared stats for consistency with Monthly Stats)
        const extraHrs = sharedStats?.extraWorkedHours ?? details.extraHours;
        if (extraHrs > 2) {
            insights.push({ type: 'positive', text: `${extraHrs}h extra hours contributed` });
        }

        return insights;
    }
}

export const AppAnalytics = new Analytics();
if (typeof window !== 'undefined') window.AppAnalytics = AppAnalytics;
