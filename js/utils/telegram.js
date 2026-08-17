const TELEGRAM_ENDPOINT = '/api/telegram-send';
let lastSentAt = 0;
const THROTTLE_MS = 3000;

export async function sendTelegramNotification(text) {
    try {
        const now = Date.now();
        if (now - lastSentAt < THROTTLE_MS) return;
        lastSentAt = now;

        fetch(TELEGRAM_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        }).catch(() => {});
    } catch {
        // Silently fail — Telegram is best-effort
    }
}

export function telegramNotifyCheckIn(name, time) {
    sendTelegramNotification(`✅ <b>${name}</b> checked in at ${time}`);
}

export function telegramNotifyLateCheckIn(name, time) {
    sendTelegramNotification(`⚠️ <b>${name}</b> checked in LATE at ${time}`);
}

export function telegramNotifyCheckOut(name, time) {
    sendTelegramNotification(`🚪 <b>${name}</b> checked out at ${time}`);
}

export function telegramNotifyLeaveUpdate(name, status) {
    const icon = status === 'approved' ? '✅' : '❌';
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    sendTelegramNotification(`${icon} Leave ${label} for <b>${name}</b>`);
}

export function telegramNotifyTaskTagged(tagger, task) {
    const shortTask = (task || '').length > 80 ? task.slice(0, 80) + '...' : (task || 'untitled');
    sendTelegramNotification(`📋 <b>${tagger}</b> tagged you in: "${shortTask}"`);
}

export async function linkTelegramAccount(chatId) {
    try {
        const user = window.AppAuth?.getUser?.();
        if (!user) return { ok: false, error: 'Not logged in' };

        const fresh = await window.AppDB?.get?.('users', user.id);
        if (!fresh) return { ok: false, error: 'User not found' };

        fresh.telegramChatId = String(chatId);
        await window.AppDB.put('users', fresh);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

export function getTelegramLinkUrl() {
    const botUsername = 'crwi_attendance_bot';
    return `https://t.me/${botUsername}?start=link`;
}
