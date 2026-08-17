let admin = null;
let db = null;

function getAdmin() {
    if (admin) return admin;

    try {
        admin = require('firebase-admin');
    } catch {
        return null;
    }

    if (admin.apps.length) {
        db = admin.firestore();
        return admin;
    }

    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccount) return null;

    try {
        const parsed = typeof serviceAccount === 'string' ? JSON.parse(serviceAccount) : serviceAccount;
        admin.initializeApp({ credential: admin.credential.cert(parsed) });
        db = admin.firestore();
        return admin;
    } catch {
        return null;
    }
}

function getDb() {
    getAdmin();
    return db;
}

module.exports = { getAdmin, getDb };
