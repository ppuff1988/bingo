/**
 * Bingo 快取代理伺服器
 * ─────────────────────────────────────────
 * 功能：
 *  1. 靜態檔案服務（index.html / style.css / app.js）
 *  2. GET /api/bingo?openDate=YYYY-MM-DD
 *     └─ 讀取 cache/bingo_YYYY-MM-DD.json
 *        └─ 若檔案存在且新鮮（< 5 分鐘）→ 直接回傳
 *        └─ 否則 → 打台灣彩券 API，寫入快取，再回傳
 *
 * 使用：node server.js
 * ─────────────────────────────────────────
 */

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

// ─── 設定 ────────────────────────────────────────────────────
const PORT        = 8081;
const CACHE_DIR   = path.join(__dirname, 'cache');
const CACHE_TTL   = 5 * 60 * 1000;   // 5 分鐘（毫秒）
const API_BASE    = 'api.taiwanlottery.com';
const API_PATH    = '/TLCAPIWeB/Lottery/BingoResult';
const STATIC_ROOT = __dirname;

// MIME 對照表
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css' : 'text/css; charset=utf-8',
    '.js'  : 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.ico' : 'image/x-icon',
    '.png' : 'image/png',
    '.svg' : 'image/svg+xml',
};

// ─── 快取輔助函式 ─────────────────────────────────────────────

/** 確保快取目錄存在 */
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/** 取得快取檔案路徑 */
function getCachePath(dateStr) {
    return path.join(CACHE_DIR, `bingo_${dateStr}.json`);
}

/**
 * 判斷快取是否仍在有效期內
 * @param {string} filePath
 * @returns {boolean}
 */
function isCacheFresh(filePath) {
    try {
        const stat = fs.statSync(filePath);
        const ageMs = Date.now() - stat.mtimeMs;
        return ageMs < CACHE_TTL;
    } catch {
        return false;
    }
}

/**
 * 取得快取剩餘秒數，用於 log 顯示
 * @param {string} filePath
 * @returns {number}
 */
function cacheRemainingSeconds(filePath) {
    try {
        const stat = fs.statSync(filePath);
        const ageMs = Date.now() - stat.mtimeMs;
        return Math.max(0, Math.round((CACHE_TTL - ageMs) / 1000));
    } catch {
        return 0;
    }
}

/** 讀取快取檔案，失敗回傳 null */
function readCache(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

/** 寫入快取檔案 */
function writeCache(filePath, data) {
    try {
        fs.writeFileSync(filePath, data, 'utf8');
    } catch (e) {
        console.error('[快取] 寫入失敗:', e.message);
    }
}

// ─── 台灣彩券 API 請求 ────────────────────────────────────────

/**
 * 向台灣彩券 API 取得指定日期開獎資料
 * @param {string} dateStr  YYYY-MM-DD
 * @returns {Promise<string>}  Raw JSON string
 */
function fetchFromTaiwanLottery(dateStr) {
    return new Promise((resolve, reject) => {
        const query    = `?openDate=${dateStr}&pageNum=1&pageSize=500`;
        const reqPath  = API_PATH + query;
        const options  = {
            hostname: API_BASE,
            path    : reqPath,
            method  : 'GET',
            headers : {
                'User-Agent': 'Mozilla/5.0 (compatible; BingoAnalyzer/1.0)',
                'Accept'    : 'application/json',
            },
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`API HTTP ${res.statusCode}`));
                    return;
                }
                resolve(body);
            });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('API 請求逾時'));
        });
        req.end();
    });
}

// ─── 靜態檔案服務 ─────────────────────────────────────────────

function serveStatic(req, res, reqPath) {
    // 預設路由導向 index.html
    const filePath = reqPath === '/' || reqPath === ''
        ? path.join(STATIC_ROOT, 'index.html')
        : path.join(STATIC_ROOT, reqPath);

    // 安全性：防止路徑穿越
    if (!filePath.startsWith(STATIC_ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end(`找不到檔案: ${reqPath}`);
            return;
        }
        const ext  = path.extname(filePath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
}

// ─── 主要伺服器邏輯 ───────────────────────────────────────────

const server = http.createServer(async (req, res) => {
    const parsed   = url.parse(req.url, true);
    const pathname = parsed.pathname;

    // ── CORS（開發方便，只開放 localhost） ──
    const origin = req.headers.origin || '';
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Vary', 'Origin');

    // ── OPTIONS preflight ──
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.writeHead(204);
        res.end();
        return;
    }

    // ════════════════════════════════════════
    //  /api/bingo  — 快取代理端點
    // ════════════════════════════════════════
    if (pathname === '/api/bingo' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');

        // 取得查詢日期，預設為今天
        const today   = new Date();
        const dateStr = parsed.query.openDate ||
            today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');

        const cacheFile = getCachePath(dateStr);

        // ① 快取命中且新鮮
        if (isCacheFresh(cacheFile)) {
            const cached = readCache(cacheFile);
            if (cached) {
                const remain = cacheRemainingSeconds(cacheFile);
                console.log(`[快取 HIT ] ${dateStr} — 快取剩餘 ${remain}s，跳過 API`);
                res.setHeader('X-Cache', 'HIT');
                res.setHeader('X-Cache-Remaining-Seconds', String(remain));
                res.writeHead(200);
                res.end(cached);
                return;
            }
        }

        // ② 呼叫台灣彩券 API（每 5 分鐘最多一次）
        console.log(`[API 請求 ] ${dateStr} — 快取過期或不存在，向台灣彩券 API 請求…`);

        try {
            const raw = await fetchFromTaiwanLottery(dateStr);

            // 簡單驗證 JSON
            JSON.parse(raw);

            writeCache(cacheFile, raw);
            console.log(`[快取 MISS] ${dateStr} — 已寫入 ${cacheFile}`);

            res.setHeader('X-Cache', 'MISS');
            res.writeHead(200);
            res.end(raw);
        } catch (err) {
            console.error(`[API 錯誤 ] ${dateStr} — ${err.message}`);

            // ③ API 失敗時，嘗試回傳過期的舊快取（stale）
            const stale = readCache(cacheFile);
            if (stale) {
                console.warn(`[快取 STALE] ${dateStr} — API 失敗，回傳過期快取`);
                res.setHeader('X-Cache', 'STALE');
                res.writeHead(200);
                res.end(stale);
                return;
            }

            res.writeHead(503);
            res.end(JSON.stringify({ rtCode: 'ERR', message: err.message }));
        }
        return;
    }

    // ════════════════════════════════════════
    //  其餘路徑 — 靜態檔案
    // ════════════════════════════════════════
    serveStatic(req, res, pathname);
});

server.listen(PORT, '0.0.0.0', () => {
    const line = '─'.repeat(48);
    console.log(`\n${line}`);
    console.log('  🎱  Bingo 快取代理伺服器已啟動');
    console.log(`${line}`);
    console.log(`  網址      http://localhost:${PORT}`);
    console.log(`  API 端點  http://localhost:${PORT}/api/bingo`);
    console.log(`  快取目錄  ${CACHE_DIR}`);
    console.log(`  快取 TTL  ${CACHE_TTL / 1000} 秒（${CACHE_TTL / 60000} 分鐘）`);
    console.log(`${line}\n`);
});

// 優雅關閉
process.on('SIGINT', () => {
    console.log('\n[伺服器] 收到 SIGINT，正在關閉…');
    server.close(() => process.exit(0));
});
