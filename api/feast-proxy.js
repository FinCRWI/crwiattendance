/**
 * Vercel Serverless Function: Catholic Feast Proxy
 * Proxies the GCatholic India iCal feed to bypass CORS restrictions.
 * The client fetches from /api/feast-proxy which returns the iCal text.
 */

const GCATHOLIC_ICAL_URL = 'https://gcatholic.org/calendar/ics/2026-en-IN.ics?v=3';

module.exports = async (req, res) => {
    try {
        const response = await fetch(GCATHOLIC_ICAL_URL, {
            headers: { 'Accept': 'text/plain' }
        });

        if (!response.ok) {
            res.statusCode = response.status;
            res.setHeader('Content-Type', 'text/plain');
            res.end('Failed to fetch liturgical calendar');
            return;
        }

        const text = await response.text();

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(text);
    } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Internal server error');
    }
};
