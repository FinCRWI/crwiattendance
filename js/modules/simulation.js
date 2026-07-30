import { AppDB } from './db.js';
import { AppConfig } from '../config.js';

/**
 * Simulation Module
 * Injects optional demo events and performs one-time legacy dummy cleanup.
 */
export class Simulation {
    constructor() {
        this.db = AppDB;
        this.cleanupFlag = AppConfig?.SIMULATION_POLICY?.LEGACY_DUMMY_CLEANUP?.FLAG_KEY || 'legacy_dummy_cleanup_v1';
        this.simulationFlag = 'simulation_run_v2';
    }

    getCleanupPolicy() {
        const policy = AppConfig?.SIMULATION_POLICY?.LEGACY_DUMMY_CLEANUP || {};
        const targetIds = new Set((policy.TARGET_USER_IDS || []).map((v) => String(v || '').trim()).filter(Boolean));
        const targetUsernames = new Set((policy.TARGET_USERNAMES || []).map((v) => String(v || '').trim().toLowerCase()).filter(Boolean));
        return {
            enabled: policy.ENABLED !== false,
            targetIds,
            targetUsernames,
            auditCollection: String(policy.AUDIT_COLLECTION || 'system_audit_logs')
        };
    }

    async writeCleanupAudit(eventType, payload = {}) {
        const policy = this.getCleanupPolicy();
        try {
            // Use silentPermissionDenied to avoid noisy console errors during tests
            await this.db.add(policy.auditCollection, {
                type: eventType,
                module: 'simulation',
                payload,
                createdAt: Date.now()
            }, { silentPermissionDenied: true });
        } catch {
            // best-effort only
        }
    }

    async run() {
        const flags = (AppConfig && AppConfig.READ_OPT_FLAGS) || {};
        const host = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '';
        const isLocalHost = host === 'localhost' || host === '127.0.0.1';
        if (!flags.ENABLE_SIMULATION_MODULE && !isLocalHost) {
            return;
        }

        if (!localStorage.getItem(this.cleanupFlag)) {
            await this.cleanupLegacyDummyData();
            localStorage.setItem(this.cleanupFlag, 'true');
        }

        // Remove old Office Picnic events that were incorrectly marked as holidays
        await this.removeOfficePicnicEvents();

        if (localStorage.getItem(this.simulationFlag)) {
            console.log('Simulation already ran. Use window.AppSimulation.forceRun() to force.');
            return;
        }

        await this.forceRun();
        localStorage.setItem(this.simulationFlag, 'true');
    }

    async removeOfficePicnicEvents() {
        try {
            const allEvents = await this.db.getAll('events');
            const picnicEvents = (allEvents || []).filter(e =>
                String(e?.title || '').toLowerCase().includes('office picnic')
            );
            for (const event of picnicEvents) {
                await this.db.delete('events', event.id);
            }
            if (picnicEvents.length > 0) {
                console.log(`Cleaned up ${picnicEvents.length} old Office Picnic event(s) from events collection.`);
            }
        } catch {
            // best-effort cleanup
        }
    }

    async cleanupLegacyDummyData() {
        const policy = this.getCleanupPolicy();
        if (!policy.enabled) return;

        if (policy.targetIds.size === 0 && policy.targetUsernames.size === 0) {
            await this.writeCleanupAudit('legacy_dummy_cleanup_skipped', { reason: 'no_targets' });
            return;
        }

        try {
            const users = await this.db.getAll('users');
            const matchedUsers = users.filter((u) =>
                policy.targetIds.has(u.id) || policy.targetUsernames.has((u.username || '').trim().toLowerCase())
            );
            const targetIds = new Set(matchedUsers.map((u) => u.id));

            if (targetIds.size === 0) {
                await this.writeCleanupAudit('legacy_dummy_cleanup_skipped', {
                    reason: 'no_matches',
                    configuredTargets: {
                        ids: Array.from(policy.targetIds),
                        usernames: Array.from(policy.targetUsernames)
                    }
                });
                return;
            }

            let attendanceDeleted = 0;
            let leavesDeleted = 0;
            let plansDeleted = 0;
            let usersDeleted = 0;

            const attendance = await this.db.getAll('attendance');
            for (const log of attendance) {
                const uid = log.user_id || log.userId;
                if (targetIds.has(uid)) {
                    await this.db.delete('attendance', log.id);
                    attendanceDeleted += 1;
                }
            }

            const leaves = await this.db.getAll('leaves');
            for (const leave of leaves) {
                const uid = leave.userId || leave.user_id;
                if (targetIds.has(uid)) {
                    await this.db.delete('leaves', leave.id);
                    leavesDeleted += 1;
                }
            }

            const plans = await this.db.getAll('work_plans');
            for (const plan of plans) {
                const uid = plan.userId || plan.user_id;
                if (targetIds.has(uid)) {
                    await this.db.delete('work_plans', plan.id);
                    plansDeleted += 1;
                }
            }

            for (const user of matchedUsers) {
                await this.db.delete('users', user.id);
                usersDeleted += 1;
            }

            await this.writeCleanupAudit('legacy_dummy_cleanup_completed', {
                matchedUserIds: Array.from(targetIds),
                deleted: {
                    attendance: attendanceDeleted,
                    leaves: leavesDeleted,
                    workPlans: plansDeleted,
                    users: usersDeleted
                }
            });

            console.log('Legacy dummy users and linked records removed.', {
                users: usersDeleted,
                attendance: attendanceDeleted,
                leaves: leavesDeleted,
                workPlans: plansDeleted
            });
        } catch (error) {
            await this.writeCleanupAudit('legacy_dummy_cleanup_failed', {
                message: error?.message || String(error)
            });
            console.warn('Legacy dummy cleanup failed:', error);
        }
    }

    async forceRun() {
        console.log('Starting Office Scenario Simulation (V2)...');

        // Simulation now only handles shared event setup.
        const today = new Date();

        if (window.AppCalendar) {
            const holidayDate = new Date(today);
            holidayDate.setDate(holidayDate.getDate() + 1);
            await window.AppCalendar.addEvent({
                title: 'Office Picnic',
                date: holidayDate.toISOString().split('T')[0],
                type: 'social'
            });
        }

        console.log('Simulation Complete.');
    }
}

export const AppSimulation = new Simulation();
if (typeof window !== 'undefined') {
    window.AppSimulation = AppSimulation;
    setTimeout(() => AppSimulation.run(), 2000);
}
