const { getDb } = require('./_firebase-admin');

const TELEGRAM_API = 'https://api.telegram.org';
const LATE_CUTOFF_HOUR = 10;

async function sendMessage(token, chatId, text, replyMarkup) {
    const body = {
        chat_id: chatId,
        text: text.slice(0, 4000),
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };
    if (replyMarkup) body.reply_markup = replyMarkup;

    const resp = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return resp.json();
}

function buildKeyboard() {
    return {
        keyboard: [
            [{ text: 'IN' }, { text: 'OUT' }],
            [{ text: 'STATUS' }, { text: 'BALANCE' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
}

function getLocalISO(offsetHours = 5.5) {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const local = new Date(utc + offsetHours * 3600000);
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}

function getLocalTime(offsetHours = 5.5) {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const local = new Date(utc + offsetHours * 3600000);
    return local.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

async function findUserByChatId(db, chatId) {
    const snap = await db.collection('users').where('telegramChatId', '==', String(chatId)).limit(1).get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function handleCheckIn(db, user) {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const isLate = hour > LATE_CUTOFF_HOUR || (hour === LATE_CUTOFF_HOUR && minute > 0);

    const logId = String(Date.now()) + '_0';
    const log = {
        id: logId,
        user_id: user.id,
        date: getLocalISO(),
        checkIn: getLocalTime(),
        checkOut: '',
        duration: '',
        durationMs: 0,
        type: '',
        dayCredit: 0,
        lateCountable: isLate,
        extraWorkedMs: 0,
        policyVersion: 'v2',
        location: 'Telegram Check-in',
        lat: null,
        lng: null,
        checkOutLocation: '',
        outLat: null,
        outLng: null,
        workDescription: '',
        locationMismatched: false,
        locationExplanation: '',
        activityScore: 0,
        autoCheckout: false,
        autoCheckoutReason: '',
        autoCheckoutAt: null,
        autoCheckoutRequiresApproval: false,
        autoCheckoutExtraApproved: null,
        extraTimePrompted: false,
        extraTimeJustification: '',
        extraTimeMode: '',
        extraTimeConfirmedMs: 0,
        extraTimeAutoAllowed: false,
        extraTimeAutoAllowedMs: 0,
        taskUpdates: [],
        budgetHeadId: user.currentBudgetHeadId || 'UNALLOCATED',
        budgetHeadUnallocatedReason: '',
        validationStatus: 'compliant',
        validationErrors: [],
        taskUpdatesSubmittedAt: null,
        entrySource: 'telegram',
        attendanceEligible: true,
        synced: false
    };

    await db.collection('attendance').doc(logId).set(log);

    const userRef = db.collection('users').doc(user.id);
    await userRef.update({
        status: 'in',
        lastCheckIn: Date.now(),
        isPaused: false,
        pauseStartedAt: null,
        totalPausedMs: 0,
        pauseEvents: [],
        currentLocation: { lat: null, lng: null, address: 'Telegram Check-in' }
    });

    const time = getLocalTime();
    if (isLate) {
        return `⚠️ <b>${user.name}</b> checked in LATE at ${time}`;
    }
    return `✅ <b>${user.name}</b> checked in at ${time}`;
}

async function handleCheckOut(db, user) {
    if (user.status !== 'in') {
        return '❌ You are not checked in. Send IN first.';
    }

    const checkInTime = new Date(user.lastCheckIn);
    const now = new Date();
    const durationMs = now.getTime() - checkInTime.getTime() - (Number(user.totalPausedMs) || 0);
    const hours = Math.floor(durationMs / 3600000);
    const mins = Math.floor((durationMs % 3600000) / 60000);
    const duration = `${hours}h ${mins}m`;

    const logId = String(Date.now()) + '_0';
    const log = {
        id: logId,
        user_id: user.id,
        date: getLocalISO(),
        checkIn: checkInTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        checkOut: getLocalTime(),
        duration: duration,
        durationMs: Math.max(0, durationMs),
        type: durationMs >= 28800000 ? 'Full Day' : durationMs >= 14400000 ? 'Half Day' : 'Short Day',
        dayCredit: durationMs >= 28800000 ? 1 : durationMs >= 14400000 ? 0.5 : 0,
        lateCountable: false,
        extraWorkedMs: 0,
        policyVersion: 'v2',
        location: 'Telegram Check-out',
        lat: null,
        lng: null,
        checkOutLocation: 'Telegram Check-out',
        outLat: null,
        outLng: null,
        workDescription: '',
        locationMismatched: false,
        locationExplanation: '',
        activityScore: 0,
        autoCheckout: false,
        autoCheckoutReason: '',
        autoCheckoutAt: null,
        autoCheckoutRequiresApproval: false,
        autoCheckoutExtraApproved: null,
        extraTimePrompted: false,
        extraTimeJustification: '',
        extraTimeMode: '',
        extraTimeConfirmedMs: 0,
        extraTimeAutoAllowed: false,
        extraTimeAutoAllowedMs: 0,
        taskUpdates: [],
        budgetHeadId: user.currentBudgetHeadId || 'UNALLOCATED',
        budgetHeadUnallocatedReason: '',
        validationStatus: 'compliant',
        validationErrors: [],
        taskUpdatesSubmittedAt: null,
        entrySource: 'telegram',
        attendanceEligible: true,
        synced: false
    };

    await db.collection('attendance').doc(logId).set(log);

    const userRef = db.collection('users').doc(user.id);
    await userRef.update({
        status: 'out',
        lastCheckOut: Date.now(),
        lastLocation: { lat: null, lng: null, address: 'Telegram Check-out' },
        lastCheckOutLocation: { lat: null, lng: null, address: 'Telegram Check-out' },
        locationMismatched: false,
        lastCheckIn: null,
        isPaused: false,
        pauseStartedAt: null,
        totalPausedMs: 0,
        pauseEvents: [],
        currentLocation: null,
        currentBudgetHeadId: null,
        currentBudgetHeadUnallocatedReason: ''
    });

    const time = getLocalTime();
    return `🚪 <b>${user.name}</b> checked out at ${time}\n⏱️ Duration: ${duration}`;
}

async function handleStatus(db, user) {
    const today = getLocalISO();
    const snap = await db.collection('attendance')
        .where('user_id', '==', user.id)
        .where('date', '==', today)
        .limit(5)
        .get();

    const logs = [];
    snap.forEach(doc => logs.push(doc.data()));

    const activeLog = logs.find(l => !l.checkOut);
    const completedLog = logs.find(l => l.checkOut);

    let status = user.status === 'in' ? '✅ Checked In' : '🔴 Checked Out';

    let msg = `📊 <b>Status for ${user.name}</b>\n`;
    msg += `📅 ${today}\n`;
    msg += `Status: ${status}\n`;

    if (activeLog) {
        msg += `🕐 Check-in: ${activeLog.checkIn}\n`;
        const elapsed = Date.now() - new Date(user.lastCheckIn).getTime();
        const h = Math.floor(elapsed / 3600000);
        const m = Math.floor((elapsed % 3600000) / 60000);
        msg += `⏱️ Working: ${h}h ${m}m\n`;
    } else if (completedLog) {
        msg += `🕐 Check-in: ${completedLog.checkIn}\n`;
        msg += `🚪 Check-out: ${completedLog.checkOut}\n`;
        msg += `⏱️ Duration: ${completedLog.duration}\n`;
        msg += `📊 Type: ${completedLog.type}\n`;
    } else {
        msg += `No attendance recorded today.\n`;
    }

    return msg;
}

async function handleBalance(db, user) {
    const policy = user.leavePolicy || {};
    const defaultPolicy = {
        'Annual Leave': 10,
        'Casual Leave': 6,
        'Medical Leave': 6,
        'Compassionate Leave': 3,
        'Retreat Leave': 10
    };

    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();

    const leavesSnap = await db.collection('leaves')
        .where('userId', '==', user.id)
        .get();

    const taken = {};
    leavesSnap.forEach(doc => {
        const leave = doc.data();
        const status = String(leave.status || '').toLowerCase();
        if (status !== 'approved' && status !== 'pending') return;
        const type = leave.type || 'Casual Leave';
        const start = new Date(leave.startDate);
        const end = new Date(leave.endDate || leave.startDate);
        if (start.getFullYear() !== year) return;
        const days = leave.daysCount || Math.ceil((end - start) / 86400000) + 1;
        taken[type] = (taken[type] || 0) + days;
    });

    let msg = `📅 <b>Leave Balance for ${user.name}</b>\n\n`;

    const types = ['Annual Leave', 'Casual Leave', 'Medical Leave', 'Compassionate Leave', 'Retreat Leave'];
    for (const type of types) {
        const total = policy[type + '_total'] || defaultPolicy[type] || 0;
        if (total === 0) continue;
        const used = taken[type] || 0;
        const remaining = Math.max(0, total - used);
        const bar = '█'.repeat(remaining) + '░'.repeat(used);
        msg += `${type}: ${remaining}/${total} ${bar}\n`;
    }

    msg += `\n✅ Approved + Pending leaves included.`;
    return msg;
}

function handleHelp() {
    return [
        '🤖 <b>CRWI Attendance Bot</b>',
        '',
        '<b>Commands:</b>',
        'IN — Check in (start work)',
        'OUT — Check out (end work)',
        'STATUS — Today\'s attendance status',
        'BALANCE — Leave balance',
        'HELP — This message',
        '',
        '<b>Quick Actions:</b>',
        'Tap the buttons below for instant access!',
        '',
        '💡 Works from any device with Telegram.'
    ].join('\n');
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    if (req.method !== 'POST') {
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

    const body = req.body || {};

    // Handle webhook verification
    if (body.url) {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // Handle callback queries (inline button presses)
    if (body.callback_query) {
        const cq = body.callback_query;
        const chatId = cq.message?.chat?.id || cq.from?.id;
        const data = cq.data;

        if (chatId && data) {
            const user = await findUserByChatId(db, chatId);
            if (user) {
                let reply = '';
                if (data === 'checkin') reply = await handleCheckIn(db, user);
                else if (data === 'checkout') reply = await handleCheckOut(db, user);
                else if (data === 'status') reply = await handleStatus(db, user);
                else if (data === 'balance') reply = await handleBalance(db, user);
                else if (data === 'help') reply = handleHelp();

                if (reply) {
                    await sendMessage(token, chatId, reply, buildKeyboard());
                }
            }
        }

        // Answer callback query to remove loading state
        await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: cq.id })
        }).catch(() => {});

        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // Handle regular messages
    const message = body.message;
    if (!message) {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    const chatId = message.chat?.id;
    const text = (message.text || '').trim().toUpperCase();
    const firstName = message.from?.first_name || '';
    const lastName = message.from?.last_name || '';
    const fullName = `${firstName} ${lastName}`.trim() || 'Staff';

    if (!chatId) {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    try {
        const user = await findUserByChatId(db, chatId);

        // If user not linked, send linking instructions
        if (!user) {
            await sendMessage(token, chatId,
                `👋 Hi ${fullName}!\n\n` +
                `Your Telegram account is not linked to CRWI Attendance yet.\n\n` +
                `To link your account:\n` +
                `1. Open the CRWI Attendance app\n` +
                `2. Go to Settings → Telegram\n` +
                `3. Tap "Link Telegram Account"\n\n` +
                `Or ask your admin to link your account manually.`,
                { remove_keyboard: true }
            );
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        let reply = '';
        const keyboard = buildKeyboard();

        switch (text) {
            case 'IN':
            case '/IN':
            case '/IN@' + (message.entities?.[0]?.bot_username || '').toLowerCase():
                reply = await handleCheckIn(db, user);
                break;

            case 'OUT':
            case '/OUT':
            case '/OUT@' + (message.entities?.[0]?.bot_username || '').toLowerCase():
                reply = await handleCheckOut(db, user);
                break;

            case 'STATUS':
            case '/STATUS':
            case '/STATUS@' + (message.entities?.[0]?.bot_username || '').toLowerCase():
                reply = await handleStatus(db, user);
                break;

            case 'BALANCE':
            case '/BALANCE':
            case '/BALANCE@' + (message.entities?.[0]?.bot_username || '').toLowerCase():
                reply = await handleBalance(db, user);
                break;

            case 'HELP':
            case '/HELP':
            case '/START':
            case '/START@' + (message.entities?.[0]?.bot_username || '').toLowerCase():
            case '/HELP@' + (message.entities?.[0]?.bot_username || '').toLowerCase():
                reply = handleHelp();
                break;

            default:
                // If it's a text message (daily standup response), save it
                if (message.text && !message.text.startsWith('/')) {
                    const today = getLocalISO();
                    const standupId = `standup_${user.id}_${today}`;
                    await db.collection('daily_standups').doc(standupId).set({
                        id: standupId,
                        userId: user.id,
                        userName: user.name || fullName,
                        date: today,
                        response: message.text,
                        submittedAt: new Date().toISOString(),
                        source: 'telegram'
                    });
                    reply = `✅ <b>Daily standup saved!</b>\n\nYour update for today has been recorded.\n\n💡 Type a command (IN, OUT, STATUS, BALANCE) or tap a button below.`;
                } else {
                    reply = handleHelp();
                }
                break;
        }

        if (reply) {
            await sendMessage(token, chatId, reply, keyboard);
        }

        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
    } catch (err) {
        console.error('Telegram webhook error:', err);
        await sendMessage(token, chatId, `⚠️ Error: ${err.message || 'Something went wrong'}`).catch(() => {});
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
    }
};
