import { defineConfig, loadEnv } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { readBuildMeta } = require('./scripts/build-meta.cjs');
const buildMeta = readBuildMeta(process.cwd());
const __dirname = dirname(fileURLToPath(import.meta.url));

function readBody(req) {
    return new Promise((resolveBody, rejectBody) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8').trim();
            if (!raw) {
                resolveBody({});
                return;
            }
            try {
                resolveBody(JSON.parse(raw));
            } catch (err) {
                rejectBody(err);
            }
        });
        req.on('error', rejectBody);
    });
}

function sendJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(payload));
}

function createFeastDevPlugin() {
    let cachedIcal = null;
    let cacheTime = 0;
    const CACHE_TTL = 86400000;
    async function fetchIcal() {
        const upstream = await fetch('https://gcatholic.org/calendar/ics/2026-en-IN.ics', {
            headers: { 'Accept': 'text/calendar' },
            signal: AbortSignal.timeout(10000)
        });
        if (!upstream.ok) throw new Error('Upstream status ' + upstream.status);
        cachedIcal = await upstream.text();
        cacheTime = Date.now();
    }
    return {
        name: 'feast-dev-proxy',
        configureServer(server) {
            fetchIcal().catch(() => {}); // pre-warm cache on startup
            server.middlewares.use('/api/feast-proxy', async (req, res) => {
                try {
                    const now = Date.now();
                    if (!cachedIcal || (now - cacheTime) > CACHE_TTL) {
                        await fetchIcal();
                    }
                    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Cache-Control', 'public, max-age=86400');
                    res.end(cachedIcal);
                } catch (err) {
                    if (cachedIcal) {
                        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.end(cachedIcal);
                        return;
                    }
                    res.statusCode = 502;
                    res.end('Feast proxy error: ' + (err?.message || err));
                }
            });
        }
    };
}

function createAssistantDevPlugin(runtimeEnv) {
    return {
        name: 'assistant-dev-api',
        configureServer(server) {
            const handlerPath = resolve(__dirname, './api/assistant.js');
            const handler = require(handlerPath);
            server.middlewares.use(async (req, res, next) => {
                const url = String(req.url || '').split('?')[0];
                if (url !== '/ai/assistant' && url !== '/api/assistant') {
                    next();
                    return;
                }

                try {
                    if (req.method === 'GET') {
                        sendJson(res, 200, {
                            ok: true,
                            route: '/ai/assistant',
                            backendRoute: '/api/assistant',
                            configured: !!String(runtimeEnv.OPENROUTER_API_KEY || '').trim(),
                            modes: ['staff-plan', 'checkout-summary', 'admin-report'],
                            defaultModel: String(runtimeEnv.OPENROUTER_MODEL || 'openai/gpt-4o-mini').trim()
                        });
                        return;
                    }

                    if (req.method !== 'POST') {
                        res.setHeader('Allow', 'GET, POST');
                        sendJson(res, 405, { ok: false, error: 'Method not allowed' });
                        return;
                    }

                    const body = await readBody(req);
                    req.body = body;
                    await handler(req, res);
                } catch (err) {
                    sendJson(res, 500, { ok: false, error: err?.message || 'Assistant dev route failed' });
                }
            });
        }
    };
}

export default defineConfig({
    root: './',
    plugins: (() => {
        const runtimeEnv = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
        Object.assign(process.env, runtimeEnv);
        return [createFeastDevPlugin(), createAssistantDevPlugin({ ...process.env, ...runtimeEnv })];
    })(),
    define: {
        __APP_BUILD_META__: JSON.stringify(buildMeta)
    },
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                main: './index.html',
            },
        },
    },
    server: {
        port: 3000,
    },
});
