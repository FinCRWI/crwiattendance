import { AppConfig } from '../config.js';

const DEFAULTS = {
    widgetVisibility: {
        feast: true,
        teamActivity: true,
        hero: true,
        staffLeaveSummary: true,
        journeyReflection: true,
        staffPerformance: true,
        statsRow: true
    },
    layoutDensity: 'standard',
    globalAdminMirror: false,
    schemaVersion: AppConfig.DASHBOARD_CUSTOMIZATION.SCHEMA_VERSION
};

class DashboardCustomization {
    constructor() {
        this._settings = null;
        this._loadPromise = null;
    }

    getDefaults() {
        return JSON.parse(JSON.stringify(DEFAULTS));
    }

    async loadSettings() {
        if (this._loadPromise) return this._loadPromise;
        this._loadPromise = this._doLoad();
        return this._loadPromise;
    }

    async _doLoad() {
        try {
            const docPath = AppConfig.DASHBOARD_CUSTOMIZATION.DOC_PATH;
            const [collection, doc] = docPath.split('/');
            const snapshot = await window.AppFirestore.collection(collection).doc(doc).get();
            if (snapshot.exists) {
                const data = snapshot.data();
                this._settings = { ...this.getDefaults(), ...data };
            } else {
                this._settings = this.getDefaults();
            }
        } catch {
            this._settings = this.getDefaults();
        }
        return this._settings;
    }

    async saveSettings(settings) {
        const docPath = AppConfig.DASHBOARD_CUSTOMIZATION.DOC_PATH;
        const [collection, doc] = docPath.split('/');
        const payload = {
            ...settings,
            updatedBy: window.AppAuth?.getUser()?.id || 'unknown',
            updatedAt: window.AppFirestore.FieldValue.serverTimestamp(),
            schemaVersion: AppConfig.DASHBOARD_CUSTOMIZATION.SCHEMA_VERSION
        };
        await window.AppFirestore.collection(collection).doc(doc).set(payload, { merge: true });
        this._settings = { ...this.getDefaults(), ...settings };
        this._loadPromise = null;
    }

    invalidateCache() {
        this._loadPromise = null;
        this._settings = null;
    }
}

export const appDashboardCustomization = new DashboardCustomization();

if (typeof window !== 'undefined') {
    window.app_dashboardCustomization = appDashboardCustomization;
}