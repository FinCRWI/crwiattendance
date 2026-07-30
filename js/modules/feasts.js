/**
 * Catholic Feasts Module (Indian Context)
 * Fetches today's liturgical celebration from the GCatholic India iCal feed
 * and optionally fetches a saint image from Wikipedia.
 *
 * Source: https://gcatholic.org/calendar/2026/IN-en
 * Proxy: /api/feast-proxy
 */

const FEAST_PROXY_URL = '/api/feast-proxy';

const SEASON_COLORS = Object.freeze({
    'Advent': '#6b21a8',
    'Christmas': '#d97706',
    'Lent': '#7c3aed',
    'Easter': '#059669',
    'Ordinary Time': '#16a34a'
});

const SEASON_BG = Object.freeze({
    'Advent': 'linear-gradient(135deg, #f3e8ff 0%, #ede9fe 100%)',
    'Christmas': 'linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%)',
    'Lent': 'linear-gradient(135deg, #ede9fe 0%, #f5f3ff 100%)',
    'Easter': 'linear-gradient(135deg, #d1fae5 0%, #ecfdf5 100%)',
    'Ordinary Time': 'linear-gradient(135deg, #dcfce7 0%, #f0fdf4 100%)'
});

const SEASON_ICONS = Object.freeze({
    'Advent': 'fa-solid fa-candle-snuffer',
    'Christmas': 'fa-solid fa-star',
    'Lent': 'fa-solid fa-cross',
    'Easter': 'fa-solid fa-dove',
    'Ordinary Time': 'fa-solid fa-leaf'
});

const RANK_MAP = Object.freeze({
    'S': 'SOLEMNITY',
    'F': 'FEAST',
    'M': 'MEMORIAL',
    'm': 'OPTIONAL MEMORIAL',
    'm*': 'OPTIONAL COMMEMORATION'
});

const RANK_LABELS = Object.freeze({
    'SOLEMNITY': 'Solemnity',
    'FEAST': 'Feast',
    'MEMORIAL': 'Memorial',
    'OPTIONAL MEMORIAL': 'Optional Memorial',
    'OPTIONAL COMMEMORATION': 'Optional Commemoration'
});

function getTodayYmd() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return { y, m, d, ymd: `${y}${m}${d}`, key: `${y}-${m}-${d}` };
}

function getCacheKey() {
    return `feast_in:${getTodayYmd().key}`;
}

function parseSummary(summary) {
    const clean = summary.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F7E0}-\u{1F7FF}]/gu, '').trim();
    const rankMatch = clean.match(/^\[([SFMm*]+)\]\s*(.+)$/);
    if (rankMatch) {
        return { rank: RANK_MAP[rankMatch[1]] || null, name: rankMatch[2].trim() };
    }
    return { rank: null, name: clean };
}

function inferSeason(summary) {
    if (/🟣/.test(summary)) return 'Lent';
    if (/🟡/.test(summary)) return 'Easter';
    if (/🟢/.test(summary)) return 'Ordinary Time';
    return 'Ordinary Time';
}

function findTodayEvent(icalText, todayYmd) {
    const blocks = icalText.split('BEGIN:VEVENT');
    let fallback = null;
    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        const dtstartMatch = block.match(/DTSTART(?:;VALUE=DATE)?:\s*(\d{8})/);
        if (!dtstartMatch || dtstartMatch[1] !== todayYmd) continue;
        const summaryMatch = block.match(/SUMMARY:\s*(.+?)(?:\r?\n(?![ \t])|\r?\nEND:)/s);
        if (!summaryMatch) continue;
        const summary = summaryMatch[1].replace(/\\,/g, ',').replace(/\\n/g, ' ').trim();
        // Prefer events with a liturgical rank prefix [S], [F], [M], [m], [m*]
        if (/^\[[SFMm*]+\]/.test(summary)) return summary;
        if (!fallback) fallback = summary;
    }
    return fallback;
}

/**
 * Fetch a saint image from the Wikipedia REST API.
 * Returns image URL or null.
 */
async function fetchSaintImage(saintName) {
    try {
        const searchName = saintName
            .replace(/,?\s*(priest|virgin|martyr|bishop|deacon|religious|doctor|pope|abbot|monk|evangelist|apostle|companions).*$/i, '')
            .trim();
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchName)}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.thumbnail?.source) return data.thumbnail.source;
        if (data?.originalimage?.source) return data.originalimage.source;
        return null;
    } catch {
        return null;
    }
}


/**
 * Returns today's liturgical celebration.
 * @returns {Promise<{name: string, type: string, season: string, rank: string|null, image: string|null}|null>}
 */
export async function getTodayFeast() {
    const cacheKey = getCacheKey();
    try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) return JSON.parse(cached);
    } catch { /* ignore */ }

    const { ymd } = getTodayYmd();
    try {
        const res = await fetch(FEAST_PROXY_URL, { headers: { 'Accept': 'text/plain' } });
        if (!res.ok) return null;
        const text = await res.text();

        const rawSummary = findTodayEvent(text, ymd);
        if (!rawSummary) return null;

        const { rank, name } = parseSummary(rawSummary);
        const season = inferSeason(rawSummary);

        const result = { name, type: rank || '', season, rank, image: null };

        try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch { /* quota */ }
        return result;
    } catch {
        return null;
    }
}

/**
 * Fetch a feast/saint image (non-blocking, deferred).
 * Uses Wikipedia REST API for saint names; seasonal icon shown otherwise.
 */
export async function loadFeastImage(saintName, imgEl, iconEl) {
    if (!saintName || !imgEl) return;
    const image = await fetchSaintImage(saintName);
    if (image && imgEl) {
        imgEl.src = image;
        imgEl.style.display = 'block';
        if (iconEl) iconEl.style.display = 'none';
    }
}

export function getLiturgicalSeasonColor(season) {
    return SEASON_COLORS[season] || '#6b7280';
}

export function getLiturgicalSeasonIcon(season) {
    return SEASON_ICONS[season] || 'fa-solid fa-calendar';
}

export function getLiturgicalSeasonBg(season) {
    return SEASON_BG[season] || SEASON_BG['Ordinary Time'];
}

export function getRankLabel(rank) {
    return RANK_LABELS[rank] || '';
}

window.AppFeasts = { getTodayFeast, loadFeastImage, getLiturgicalSeasonColor, getLiturgicalSeasonIcon, getLiturgicalSeasonBg, getRankLabel };
