const { getDb } = require('./_firebase-admin');

const TELEGRAM_API = 'https://api.telegram.org';

async function sendMessage(token, chatId, text) {
    const resp = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: text.slice(0, 4000),
            parse_mode: 'HTML',
            disable_web_page_preview: true
        })
    });
    return resp.json();
}

function getLocalISO(offsetHours = 5.5) {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const local = new Date(utc + offsetHours * 3600000);
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}

function getLocalDay(offsetHours = 5.5) {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const local = new Date(utc + offsetHours * 3600000);
    return local.getDay();
}

function getLocalHour(offsetHours = 5.5) {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const local = new Date(utc + offsetHours * 3600000);
    return local.getHours();
}

async function getLinkedUsers(db) {
    const snap = await db.collection('users')
        .where('telegramChatId', '!=', '')
        .where('telegramChatId', '!=', null)
        .get();

    const users = [];
    snap.forEach(doc => {
        const data = doc.data();
        if (data.telegramChatId && !data.isAdmin && data.status !== 'archived') {
            users.push({ id: doc.id, ...data });
        }
    });
    return users;
}

// ── Daily Standup (6 PM IST) ──────────────────────────────────────────
async function dailyStandup(db, token) {
    const users = await getLinkedUsers(db);
    const today = getLocalISO();

    let sent = 0;
    for (const user of users) {
        // Check if standup already submitted
        const standupId = `standup_${user.id}_${today}`;
        const existing = await db.collection('daily_standups').doc(standupId).get();
        if (existing.exists) continue;

        await sendMessage(token, user.telegramChatId,
            `📝 <b>Daily Standup</b>\n\n` +
            `Hi ${user.name || 'there'}! What did you accomplish today?\n\n` +
            `Just type your update and send it to me.\n` +
            `Examples:\n` +
            `• Completed the API integration\n` +
            `• Fixed 3 bugs, reviewed 2 PRs\n` +
            `• Same as yesterday, no blockers`
        );
        sent++;
    }
    return { standup: true, sent };
}

// ── Absentee Alert (11 AM IST) ────────────────────────────────────────
async function absenteeAlert(db, token) {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) return { absentee: false, reason: 'no chat id' };

    const today = getLocalISO();

    // Get all users who should have checked in
    const usersSnap = await db.collection('users')
        .where('role', '!=', 'Administrator')
        .get();

    const absent = [];
    usersSnap.forEach(doc => {
        const user = doc.data();
        if (user.status === 'archived' || user.isAdmin) return;
        if (user.status !== 'in' && !user.lastCheckIn) {
            absent.push(user.name || user.id);
        }
    });

    // Check today's attendance logs
    const attendanceSnap = await db.collection('attendance')
        .where('date', '==', today)
        .get();

    const checkedIn = new Set();
    attendanceSnap.forEach(doc => {
        const log = doc.data();
        if (log.checkIn) checkedIn.add(log.user_id);
    });

    // Find users who haven't checked in today
    const actuallyAbsent = [];
    usersSnap.forEach(doc => {
        const user = doc.data();
        if (user.status === 'archived' || user.isAdmin) return;
        if (!checkedIn.has(doc.id)) {
            actuallyAbsent.push(user.name || user.id);
        }
    });

    if (actuallyAbsent.length === 0) {
        return { absent: 0, message: 'All staff checked in!' };
    }

    const msg = `🔔 <b>Absentee Alert — ${today}</b>\n\n` +
        `<b>${actuallyAbsent.length} staff</b> haven't checked in yet:\n` +
        actuallyAbsent.map(n => `• ${n}`).join('\n') +
        `\n\n⏰ Current time: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}`;

    await sendMessage(token, chatId, msg);
    return { absent: actuallyAbsent.length, names: actuallyAbsent };
}

// ── Weekly Leaderboard (Monday 9 AM IST) ─────────────────────────────
async function weeklyLeaderboard(db, token) {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) return { leaderboard: false, reason: 'no chat id' };

    // Calculate last week's date range
    const now = new Date();
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - now.getDay() - 6);
    const lastSunday = new Date(now);
    lastSunday.setDate(now.getDate() - now.getDay());

    const startDate = `${lastMonday.getFullYear()}-${String(lastMonday.getMonth() + 1).padStart(2, '0')}-${String(lastMonday.getDate()).padStart(2, '0')}`;
    const endDate = `${lastSunday.getFullYear()}-${String(lastSunday.getMonth() + 1).padStart(2, '0')}-${String(lastSunday.getDate()).padStart(2, '0')}`;

    // Get all attendance logs for last week
    const logsSnap = await db.collection('attendance')
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .get();

    const stats = {};
    logsSnap.forEach(doc => {
        const log = doc.data();
        const uid = log.user_id;
        if (!stats[uid]) {
            stats[uid] = { name: uid, days: 0, totalMs: 0, late: 0, fullDays: 0 };
        }
        stats[uid].days++;
        stats[uid].totalMs += Number(log.durationMs) || 0;
        if (log.lateCountable) stats[uid].late++;
        if (log.type === 'Full Day') stats[uid].fullDays++;
    });

    // Resolve user names
    const userIds = Object.keys(stats);
    for (const uid of userIds) {
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists) {
            stats[uid].name = userDoc.data().name || uid;
        }
    }

    const entries = Object.values(stats).sort((a, b) => b.totalMs - a.totalMs);

    if (entries.length === 0) {
        return { leaderboard: true, count: 0 };
    }

    const medals = ['🥇', '🥈', '🥉'];
    let msg = `🏆 <b>Weekly Leaderboard</b>\n`;
    msg += `📅 ${startDate} → ${endDate}\n\n`;

    entries.forEach((entry, i) => {
        const medal = medals[i] || '  ';
        const hours = (entry.totalMs / 3600000).toFixed(1);
        const avgPerDay = entry.days > 0 ? (entry.totalMs / entry.days / 3600000).toFixed(1) : '0';
        msg += `${medal} <b>${entry.name}</b>\n`;
        msg += `   📊 ${entry.fullDays} full days | ⏱️ ${hours}h total | ⏰ ${avgPerDay}h avg/day\n`;
        if (entry.late > 0) msg += `   ⚠️ ${entry.late} late\n`;
        msg += `\n`;
    });

    const totalHours = entries.reduce((s, e) => s + e.totalMs, 0) / 3600000;
    msg += `📈 Team total: ${totalHours.toFixed(0)}h | ${entries.length} members active`;

    await sendMessage(token, chatId, msg);
    return { leaderboard: true, count: entries.length, totalHours };
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method !== 'POST' && req.method !== 'GET') {
        res.statusCode = 405;
        res.end(JSON.stringify({ ok: false }));
        return;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        res.statusCode = 503;
        res.end(JSON.stringify({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }));
        return;
    }

    const db = getDb();
    if (!db) {
        res.statusCode = 503;
        res.end(JSON.stringify({ ok: false, error: 'FIREBASE_SERVICE_ACCOUNT not set' }));
        return;
    }

    // Determine which task to run based on query param or schedule
    const task = req.query?.task || req.body?.task || '';
    const hour = getLocalHour();
    const day = getLocalDay();

    try {
        let results = {};

        // Run absentee alert at 11 AM (hour 11)
        if (task === 'absentee' || hour === 11) {
            results.absentee = await absenteeAlert(db, token);
        }

        // Run daily standup at 6 PM (hour 18)
        if (task === 'standup' || hour === 18) {
            results.standup = await dailyStandup(db, token);
        }

        // Run weekly leaderboard on Monday at 9 AM
        if (task === 'leaderboard' || (day === 1 && hour === 9)) {
            results.leaderboard = await weeklyLeaderboard(db, token);
        }

        // If specific task requested, run only that
        if (task && !results[task]) {
            if (task === 'absentee') results.absentee = await absenteeAlert(db, token);
            else if (task === 'standup') results.standup = await dailyStandup(db, token);
            else if (task === 'leaderboard') results.leaderboard = await weeklyLeaderboard(db, token);
        }

        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, results }));
    } catch (err) {
        console.error('Scheduler error:', err);
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: err.message }));
    }
};
