/* ============================================================
   賓果賓果分析工具 — app.js
   Taiwan Bingo Bingo Frequency Analyzer
   ============================================================ */

(() => {
    'use strict';

    // ─── Constants ───────────────────────────────────────────────
    const TOTAL_NUMBERS = 80;
    const NUMBERS_PER_DRAW = 20;
    const EXPECTED_PROB = NUMBERS_PER_DRAW / TOTAL_NUMBERS; // 0.25
    const MAX_TRACKED = 8;

    // ─── 快取設定 ─────────────────────────────────────────────────
    // 賓果每 5 分鐘開一期，設定同步；瀏覽器 localStorage 快取有效期
    const CACHE_TTL_MS   = 5 * 60 * 1000;   // 5 分鐘
    // 本地代理伺服器端點（server.js），若未啟動則 fallback 直打 API
    const LOCAL_API_BASE = window.location.port === '3000'
        ? ''           // 同源直接使用相對路徑
        : 'http://localhost:3000';  // 跨埠（如 http-server）
    const CHART_COLORS = [
        '#f87171', '#60a5fa', '#34d399', '#fbbf24',
        '#a78bfa', '#fb923c', '#2dd4bf', '#f472b6'
    ];

    // ─── State ───────────────────────────────────────────────────
    let draws = [];          // Array of objects: [{drawNumber: 'xxx', numbers: [n1,n2,...n20]}, ...]  index 0 = latest


    // ─── DOM References ──────────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const importStatus = $('#importStatus');
    const metaDate     = $('#metaDate');
    const controlBar   = $('#controlBar');
    const dataSummary  = $('#dataSummary');
    const btnClearData = $('#btnClearData');
    const btnRefreshAPI = $('#btnRefreshAPI');
    const heatmapSection = $('#heatmapSection');
    const rankingSection = $('#rankingSection');
    const suggestionSection = $('#suggestionSection');
    const disclaimer = $('#disclaimer');
    const checkPrizeSection = $('#checkPrizeSection');
    const drawRangeStart = $('#drawRangeStart');
    const drawRangeEnd = $('#drawRangeEnd');
    const prizeNumbers = $('#prizeNumbers');
    const btnCheckPrize = $('#btnCheckPrize');
    const checkPrizeResult = $('#checkPrizeResult');
    const distributionHeatmapSection = $('#distributionHeatmapSection');
    const distributionPeriodSelect = $('#distributionPeriodSelect');
    const distributionHeatmap = $('#distributionHeatmap');
    const distributionHeatmapContainer = $('#distributionHeatmapContainer');
    const btnDistFullscreen = $('#btnDistFullscreen');
    const distFullscreenOverlay = $('#distFullscreenOverlay');
    const distributionHeatmapFs = $('#distributionHeatmapFs');
    const distributionPeriodSelectFs = $('#distributionPeriodSelectFs');
    const btnDistClose = $('#btnDistClose');
    const cooccurrenceSection = $('#cooccurrenceSection');
    const coocPicker = $('#coocPicker');
    const coocResult = $('#coocResult');
    const coocPeriodSelect = $('#coocPeriodSelect');
    const btnClearCooc = $('#btnClearCooc');
    const emptyState = $('#emptyState');

    // ─── Co-occurrence state ──────────────────────────────────────
    let coocSelected = []; // up to 4 selected numbers

    // ────────────────────────────────────────────────────────────────
    //  Co-occurrence Statistics
    // ────────────────────────────────────────────────────────────────

    /**
     * 計算所有其他號碼與 selectedNums 在同一期出現的次數
     * @param {number[]} selectedNums - 1 or 2 numbers
     * @param {object[]} data         - draws array
     * @param {number|string} n       - how many draws to scan
     */
    function calcCoOccurrence(selectedNums, data, n) {
        const limit = n === 'all' ? data.length : Math.min(parseInt(n), data.length);
        const slice = data.slice(0, limit);
        const coCount = new Array(TOTAL_NUMBERS + 1).fill(0);
        let totalDrawsWithAll = 0;

        for (const draw of slice) {
            const hasAll = selectedNums.every(sn => draw.numbers.includes(sn));
            if (hasAll) {
                totalDrawsWithAll++;
                for (const num of draw.numbers) {
                    if (!selectedNums.includes(num)) {
                        coCount[num]++;
                    }
                }
            }
        }

        const results = [];
        for (let i = 1; i <= TOTAL_NUMBERS; i++) {
            if (!selectedNums.includes(i)) {
                results.push({
                    number: i,
                    count: coCount[i],
                    pct: totalDrawsWithAll > 0 ? (coCount[i] / totalDrawsWithAll * 100) : 0
                });
            }
        }
        results.sort((a, b) => b.count - a.count || a.number - b.number);
        return { results, totalDrawsWithAll, selectedNums };
    }

    // ────────────────────────────────────────────────────────────────
    //  Co-occurrence Rendering
    // ────────────────────────────────────────────────────────────────

    /** Render the 80-cell picker; cells coloured by frequency heatmap */
    function renderCoocPicker() {
        coocPicker.innerHTML = '';
        const n = coocPeriodSelect ? coocPeriodSelect.value : '50';
        const limit = n === 'all' ? draws.length : Math.min(parseInt(n), draws.length);
        const { freq, count } = calcFrequency(draws, limit);
        const maxFreq = Math.max(...freq.slice(1));
        const minFreq = Math.min(...freq.slice(1));
        const range = maxFreq - minFreq || 1;

        for (let num = 1; num <= TOTAL_NUMBERS; num++) {
            const f = freq[num];
            const ratio = (f - minFreq) / range;
            const bg = heatColor(ratio);
            const fg = textColorFor(ratio);
            const isSelected = coocSelected.includes(num);

            const cell = document.createElement('div');
            cell.className = 'cooc-cell' + (isSelected ? ' selected' : '');
            cell.style.backgroundColor = bg;
            cell.style.color = fg;
            cell.dataset.num = num;
            cell.innerHTML = `<span class="cell-num">${num}</span><span class="cell-freq">${f}次</span>`;
            cell.addEventListener('click', onCoocCellClick);
            coocPicker.appendChild(cell);
        }
    }

    function onCoocCellClick(e) {
        const num = parseInt(e.currentTarget.dataset.num, 10);
        const idx = coocSelected.indexOf(num);
        if (idx >= 0) {
            // deselect
            coocSelected.splice(idx, 1);
        } else {
            if (coocSelected.length >= 4) {
                // replace oldest selection
                coocSelected.shift();
            }
            coocSelected.push(num);
        }
        // update cell classes without full re-render
        coocPicker.querySelectorAll('.cooc-cell').forEach(cell => {
            const n = parseInt(cell.dataset.num, 10);
            cell.classList.toggle('selected', coocSelected.includes(n));
        });
        renderCoocResult();
    }

    function renderCoocResult() {
        const coocBody = coocPicker.parentElement;
        if (coocSelected.length === 0) {
            coocResult.innerHTML = '';
            coocBody.classList.remove('has-result');
            return;
        }
        if (draws.length === 0) {
            coocResult.innerHTML = '<div class="cooc-no-data">尚無開獎資料</div>';
            coocBody.classList.add('has-result');
            return;
        }

        const n = coocPeriodSelect ? coocPeriodSelect.value : '50';
        const { results, totalDrawsWithAll, selectedNums } = calcCoOccurrence(coocSelected, draws, n);

        if (totalDrawsWithAll === 0) {
            coocResult.innerHTML = `<div class="cooc-no-data">在指定範圍內，號碼 ${selectedNums.join('、')} 從未同時出現在同一期。</div>`;
            coocBody.classList.add('has-result');
            return;
        }

        const top = results.slice(0, 12);
        const maxCount = top[0] ? top[0].count : 1;
        const labelPeriod = n === 'all' ? `全部 ${draws.length}` : `最近 ${Math.min(parseInt(n), draws.length)}`;
        const totalScanned = n === 'all' ? draws.length : Math.min(parseInt(n), draws.length);
        const pctAppear = (totalDrawsWithAll / totalScanned * 100).toFixed(1);

        let html = `<div class="cooc-result-header">`;
        html += `<h3>號碼 ${selectedNums.map(n => `<strong>${n}</strong>`).join(' + ')} 的連帶號碼 TOP 12</h3>`;
        html += `<p>統計 ${labelPeriod} 期</p>`;
        html += `</div>`;

        // 組合出現統計卡（選 2 個以上才顯示）
        if (selectedNums.length >= 2) {
            html += `<div class="cooc-combo-stat">`;
            html += `<div class="cooc-combo-stat-main">`;
            html += `<span class="cooc-combo-count">${totalDrawsWithAll}</span>`;
            html += `<span class="cooc-combo-unit"> 期</span>`;
            html += `</div>`;
            html += `<div class="cooc-combo-desc">號碼 ${selectedNums.join('、')} 同時出現，占統計 ${totalScanned} 期的 <strong>${pctAppear}%</strong></div>`;
            html += `</div>`;
        }

        html += `<div class="cooc-bar-list">`;

        top.forEach((item, idx) => {
            const barPct = maxCount > 0 ? (item.count / maxCount * 100) : 0;
            const ratio = maxCount > 0 ? (item.count / maxCount) : 0;
            const bg = heatColor(ratio * 0.85);
            const fg = textColorFor(ratio * 0.85);

            html += `<div class="cooc-bar-item">`;
            html += `<span class="cooc-rank">${idx + 1}</span>`;
            html += `<span class="cooc-num-badge" style="background:${bg};color:${fg}">${item.number}</span>`;
            html += `<div class="cooc-bar-wrap">`;
            html += `<div class="cooc-bar-bg"><div class="cooc-bar-fill" style="width:${Math.max(barPct, 2)}%"></div></div>`;
            html += `<span class="cooc-bar-label">${item.count} 次 (${item.pct.toFixed(1)}%)</span>`;
            html += `</div></div>`;
        });

        html += `</div>`;
        coocResult.innerHTML = html;
        coocBody.classList.add('has-result');
    }

    // ─────────────────────────────────────────────────────────────
    //  2. Statistics Engine  (CSV parsing removed — data comes from API)
    // ─────────────────────────────────────────────────────────────

    /** Count frequency of each number (1-80) in the last n draws */
    function calcFrequency(data, n) {
        const slice = data.slice(0, Math.min(n, data.length));
        const freq = new Array(TOTAL_NUMBERS + 1).fill(0); // index 0 unused
        for (const draw of slice) {
            for (const num of draw.numbers) {
                freq[num]++;
            }
        }
        return { freq, count: slice.length };
    }

    /** Get hot (top 10) and cold (bottom 10) numbers from freq map */
    function calcHotCold(freq, drawCount) {
        const items = [];
        for (let i = 1; i <= TOTAL_NUMBERS; i++) {
            const observed = freq[i];
            const expected = drawCount * EXPECTED_PROB;
            const zScore = expected > 0
                ? (observed - expected) / Math.sqrt(expected * (1 - EXPECTED_PROB))
                : 0;
            items.push({ number: i, freq: observed, pct: drawCount > 0 ? (observed / drawCount * 100) : 0, zScore });
        }
        items.sort((a, b) => b.freq - a.freq || a.number - b.number);
        const hot = items.slice(0, 10);
        const cold = items.slice(-10).reverse();
        return { hot, cold, all: items };
    }

    /** Calculate gap (periods since last appearance) for each number */
    function calcGaps(data) {
        const gaps = [];
        for (let num = 1; num <= TOTAL_NUMBERS; num++) {
            let lastSeen = -1;
            let allGaps = [];
            let prevIdx = -1;

            for (let i = 0; i < data.length; i++) {
                if (data[i].numbers.includes(num)) {
                    if (lastSeen === -1) lastSeen = i;
                    if (prevIdx >= 0) allGaps.push(i - prevIdx);
                    prevIdx = i;
                }
            }

            const currentGap = lastSeen === -1 ? data.length : lastSeen;
            const avgGap = allGaps.length > 0
                ? allGaps.reduce((s, v) => s + v, 0) / allGaps.length
                : TOTAL_NUMBERS / NUMBERS_PER_DRAW; // theoretical ~4

            gaps.push({
                number: num,
                currentGap,
                avgGap: Math.round(avgGap * 10) / 10,
                isOverdue: currentGap > avgGap * 2,
                ratio: avgGap > 0 ? currentGap / avgGap : 0
            });
        }

        gaps.sort((a, b) => b.currentGap - a.currentGap || a.number - b.number);
        return gaps;
    }

    /** Calculate moving-window trend for a specific number */
    function calcTrend(data, number, windowSize = 10) {
        const points = [];
        for (let i = 0; i <= data.length - windowSize; i++) {
            const window = data.slice(i, i + windowSize);
            const count = window.filter(d => d.numbers.includes(number)).length;
            points.push({
                periodLabel: `${i + 1}-${i + windowSize}`,
                index: i,
                frequency: count / windowSize * 100
            });
        }
        return points.reverse(); // oldest first for chart
    }

    /** Check if a number has rising momentum (trend going up in recent windows) */
    function hasMomentum(data, number) {
        if (data.length < 20) return false;
        const recent = calcTrend(data, number, 10);
        if (recent.length < 3) return false;
        const last3 = recent.slice(-3);
        return last3[2].frequency > last3[0].frequency;
    }

    /** Suggest 20 numbers using combined strategy */
    function suggestNumbers(data) {
        const suggestions = [];
        const used = new Set();

        // Strategy 1: Hot numbers with rising momentum (from last 25 draws)
        const { freq: freq25 } = calcFrequency(data, 25);
        const { hot: hot25 } = calcHotCold(freq25, Math.min(25, data.length));
        const momentumHot = hot25.filter(h => hasMomentum(data, h.number));
        for (const h of momentumHot) {
            if (suggestions.length >= 10 || used.has(h.number)) continue;
            suggestions.push({ number: h.number, tag: 'hot', reason: `近25期出現${h.freq}次，動量上升` });
            used.add(h.number);
        }
        // If not enough momentum hot, fill with just hot
        for (const h of hot25) {
            if (suggestions.length >= 10 || used.has(h.number)) continue;
            suggestions.push({ number: h.number, tag: 'hot', reason: `近25期出現${h.freq}次` });
            used.add(h.number);
        }

        // Strategy 2: Overdue numbers (gap > 2x average)
        const gaps = calcGaps(data);
        const overdue = gaps.filter(g => g.isOverdue);
        for (const g of overdue) {
            if (suggestions.length >= 15 || used.has(g.number)) continue;
            suggestions.push({ number: g.number, tag: 'overdue', reason: `已${g.currentGap}期未開出（平均${g.avgGap}期）` });
            used.add(g.number);
        }

        // Strategy 3: Stable high-frequency numbers (from last 50 draws, z-score > 1.5)
        const { freq: freq50 } = calcFrequency(data, 50);
        const { all: all50 } = calcHotCold(freq50, Math.min(50, data.length));
        const stable = all50.filter(a => a.zScore > 1.2).sort((a, b) => b.zScore - a.zScore);
        for (const s of stable) {
            if (suggestions.length >= 20 || used.has(s.number)) continue;
            suggestions.push({ number: s.number, tag: 'stable', reason: `近50期穩定高頻 (Z=${s.zScore.toFixed(1)})` });
            used.add(s.number);
        }

        // If still not 20, fill with remaining hot numbers from 10 draws
        if (suggestions.length < 20) {
            const { freq: freq10 } = calcFrequency(data, 10);
            const { hot: hot10 } = calcHotCold(freq10, Math.min(10, data.length));
            for (const h of hot10) {
                if (suggestions.length >= 20 || used.has(h.number)) continue;
                suggestions.push({ number: h.number, tag: 'hot', reason: `近10期出現${h.freq}次` });
                used.add(h.number);
            }
        }

        // Final fallback: random from remaining
        if (suggestions.length < 20) {
            const remaining = [];
            for (let i = 1; i <= TOTAL_NUMBERS; i++) {
                if (!used.has(i)) remaining.push(i);
            }
            remaining.sort(() => Math.random() - 0.5);
            for (const r of remaining) {
                if (suggestions.length >= 20) break;
                suggestions.push({ number: r, tag: 'stable', reason: '補充候選' });
            }
        }

        return suggestions;
    }

    /**
     * 產生 5 組各 3 個號碼的推薦組合
     * 策略：熱號動量、到期回歸、穩定高頻、冷熱混搭、近期黑馬
     */
    function suggestGroups(data) {
        const { freq: freq25 } = calcFrequency(data, 25);
        const { hot: hot25, all: all25 } = calcHotCold(freq25, Math.min(25, data.length));
        const momentumHot = hot25.filter(h => hasMomentum(data, h.number));

        const { freq: freq10 } = calcFrequency(data, 10);
        const { hot: hot10 } = calcHotCold(freq10, Math.min(10, data.length));

        const gaps = calcGaps(data);
        const overdue = gaps.filter(g => g.isOverdue).sort((a, b) => b.currentGap - a.currentGap);

        const { freq: freq50 } = calcFrequency(data, 50);
        const { all: all50 } = calcHotCold(freq50, Math.min(50, data.length));
        const stable = all50.filter(a => a.zScore > 1.2).sort((a, b) => b.zScore - a.zScore);

        const pick = (pool, exclude, count) => {
            const result = [];
            const excSet = new Set(exclude);
            for (const item of pool) {
                if (result.length >= count) break;
                const num = typeof item === 'object' ? (item.number ?? item.num) : item;
                if (!excSet.has(num)) { result.push(num); excSet.add(num); }
            }
            return result;
        };

        // 組 1 — 熱號動量組：近期動量上升最強
        const g1 = pick([...momentumHot, ...hot25], [], 3);

        // 組 2 — 到期回歸組：最久未開出
        const g2raw = overdue.length >= 3 ? overdue : gaps;
        const g2 = pick(g2raw, [], 3);

        // 組 3 — 穩定高頻組：長期高於均值
        const g3src = stable.length >= 3 ? stable : all50;
        const g3 = pick(g3src, [], 3);

        // 組 4 — 冷熱混搭組：1熱＋1到期＋1穩定，不重疊前三組
        const prevUsed = [...g1, ...g2, ...g3];
        const mix1 = pick(hot25, prevUsed, 1);
        const mix2 = pick(overdue.length ? overdue : gaps, [...prevUsed, ...mix1], 1);
        const mix3 = pick(stable.length ? stable : all50, [...prevUsed, ...mix1, ...mix2], 1);
        const g4 = [...mix1, ...mix2, ...mix3];
        // 如果不足3個，從hot25補齊
        if (g4.length < 3) {
            const extra = pick(hot25, [...prevUsed, ...g4], 3 - g4.length);
            g4.push(...extra);
        }

        // 組 5 — 近期黑馬組：近10期頻率突出，但不與前四組重疊
        const allUsed = [...g1, ...g2, ...g3, ...g4];
        const g5 = pick(hot10, allUsed, 3);
        // 不足3個從hot25補
        if (g5.length < 3) {
            const extra = pick(hot25, [...allUsed, ...g5], 3 - g5.length);
            g5.push(...extra);
        }

        return [
            { name: '熱號動量組', icon: '🔥', nums: g1, desc: '近25期動量持續上升的熱門號', tag: 'hot' },
            { name: '到期回歸組', icon: '⏳', nums: g2, desc: '連續多期未出現，等待回歸', tag: 'overdue' },
            { name: '穩定高頻組', icon: '📊', nums: g3, desc: '長期統計穩定高於平均值', tag: 'stable' },
            { name: '冷熱混搭組', icon: '⚡', nums: g4, desc: '熱號、到期號、穩定號各一', tag: 'mix' },
            { name: '近期黑馬組', icon: '🐎', nums: g5, desc: '近10期頻率突出的黑馬號碼', tag: 'horse' },
        ];
    }

    // ─────────────────────────────────────────────────────────────
    //  3. Prize Checking
    // ─────────────────────────────────────────────────────────────

    /**
     * Check prize matches for given draw range and prize numbers
     * Returns array of match results
     */
    function checkPrizes(startDraw, endDraw, prizeNums) {
        const results = [];
        
        for (const draw of draws) {
            // Check if draw number is in range
            if (startDraw && draw.drawNumber < startDraw) continue;
            if (endDraw && draw.drawNumber > endDraw) continue;
            
            // Count matches
            const matches = draw.numbers.filter(n => prizeNums.includes(n));
            
            results.push({
                drawNumber: draw.drawNumber,
                matchCount: matches.length,
                matchedNumbers: matches,
                drawNumbers: draw.numbers
            });
        }
        
        return results;
    }

    // ─────────────────────────────────────────────────────────────
    //  4. Rendering — Heatmap
    // ─────────────────────────────────────────────────────────────

    /** Map a value 0..1 → HSL color from blue to red */
    function heatColor(ratio) {
        // 紅色單色系：由淡紅到深紅
        // ratio 越大代表頻率越高，顏色越深
        const hue = 0; // 固定紅色
        const sat = 70 + ratio * 25; // 飽和度: 70% → 95%
        const light = 95 - ratio * 55; // 亮度: 95% → 40% (由淡到深)
        return `hsl(${hue}, ${sat}%, ${light}%)`;
    }

    /** Determine text color (dark/light) based on background lightness */
    function textColorFor(ratio) {
        return ratio > 0.5 ? '#fff' : '#1e293b';
    }

    function renderHeatmap(containerId, freq, drawCount) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        if (drawCount === 0) {
            container.innerHTML = '<div class="insufficient">資料不足</div>';
            return;
        }

        const maxFreq = Math.max(...freq.slice(1));
        const minFreq = Math.min(...freq.slice(1));
        const range = maxFreq - minFreq || 1;

        for (let num = 1; num <= TOTAL_NUMBERS; num++) {
            const f = freq[num];
            const ratio = (f - minFreq) / range;
            const pct = (f / drawCount * 100).toFixed(1);
            const bg = heatColor(ratio);
            const fg = textColorFor(ratio);

            const cell = document.createElement('div');
            cell.className = 'hm-cell';
            cell.style.backgroundColor = bg;
            cell.style.color = fg;
            cell.innerHTML = `
                <span class="num">${num}</span>
                <span class="freq">${f}次</span>
                <div class="tooltip">
                    號碼 <b>${num}</b><br>
                    出現 ${f} 次（${pct}%）<br>
                    理論值 ${(drawCount * EXPECTED_PROB).toFixed(1)} 次
                </div>
            `;
            container.appendChild(cell);
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  4. Rendering — Rankings
    // ─────────────────────────────────────────────────────────────

    function renderRanking(containerId, items, maxVal, type) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        items.slice(0, 10).forEach((item, idx) => {
            const barPct = maxVal > 0 ? (
                type === 'overdue'
                    ? (item.currentGap / maxVal * 100)
                    : (item.freq / maxVal * 100)
            ) : 0;

            const label = type === 'overdue'
                ? `${item.currentGap} 期未開`
                : `${item.freq} 次 (${item.pct.toFixed(1)}%)`;

            const badgeColor = type === 'hot'
                ? heatColor(1 - idx * 0.08)
                : type === 'cold'
                    ? heatColor(idx * 0.08)
                    : `hsl(${260 + idx * 5}, 60%, ${55 + idx * 2}%)`;

            const badgeFg = type === 'hot' && idx < 3 ? '#fff' : (type === 'cold' ? '#1e293b' : '#fff');

            const div = document.createElement('div');
            div.className = 'ranking-item';
            div.innerHTML = `
                <span class="rank">${idx + 1}</span>
                <span class="number-badge" style="background:${badgeColor};color:${badgeFg}">${item.number}</span>
                <div class="bar-wrap">
                    <div class="bar-fill" style="width:${Math.max(barPct, 5)}%"></div>
                    <span class="bar-label">${label}</span>
                </div>
            `;
            container.appendChild(div);
        });
    }

    // ─────────────────────────────────────────────────────────────
    //  5. Rendering — Distribution Heatmap
    // ─────────────────────────────────────────────────────────────

    function renderDistributionHeatmap(periodCount) {
        distributionHeatmap.innerHTML = '';
        
        if (draws.length === 0) {
            distributionHeatmap.innerHTML = '<p style="color: var(--text-secondary); padding: 2rem;">無資料</p>';
            if (distributionHeatmapContainer) distributionHeatmapContainer.classList.add('scrolled-end');
            return;
        }
        
        // Determine how many periods to display
        const displayCount = periodCount === 'all' ? draws.length : Math.min(parseInt(periodCount), draws.length);
        const displayDraws = draws.slice(0, displayCount);
        
        // Create header row
        const headerRow = document.createElement('div');
        headerRow.className = 'distribution-row';
        
        // First cell is empty (for draw number column)
        const emptyHeaderCell = document.createElement('div');
        emptyHeaderCell.className = 'distribution-cell header draw-number';
        emptyHeaderCell.textContent = '期數';
        headerRow.appendChild(emptyHeaderCell);
        
        // Header cells for numbers 1-80
        for (let num = 1; num <= TOTAL_NUMBERS; num++) {
            const headerCell = document.createElement('div');
            headerCell.className = 'distribution-cell header';
            headerCell.textContent = num;
            headerRow.appendChild(headerCell);
        }
        
        distributionHeatmap.appendChild(headerRow);
        
        // Create rows for each draw
        for (const draw of displayDraws) {
            const row = document.createElement('div');
            row.className = 'distribution-row';
            
            // Draw number cell
            const drawCell = document.createElement('div');
            drawCell.className = 'distribution-cell draw-number';
            const dn = draw.drawNumber.toString();
            drawCell.innerHTML = `<span class="draw-full">${dn}</span><span class="draw-short">${dn.slice(-4)}</span>`;
            row.appendChild(drawCell);
            
            // Number cells
            for (let num = 1; num <= TOTAL_NUMBERS; num++) {
                const cell = document.createElement('div');
                const isMarked = draw.numbers.includes(num);
                cell.className = 'distribution-cell ' + (isMarked ? 'marked' : 'empty');
                if (isMarked) {
                    cell.textContent = num;
                    cell.title = `期數 ${draw.drawNumber} - 號碼 ${num}`;
                }
                row.appendChild(cell);
            }
            
            distributionHeatmap.appendChild(row);
        }

        // Update scroll-end state after rendering (use rAF so layout is complete)
        requestAnimationFrame(() => { if (typeof checkDistScrollEnd === 'function') checkDistScrollEnd(); });
    }

    // ─────────────────────────────────────────────────────────────
    //  6. Cluster Movement Analysis (Multi-period Dense Zones)
    // ─────────────────────────────────────────────────────────────

    /**
     * Analyze dense zones across multiple draws in segments
     * Returns clusters for each time segment
     */
    function findDenseZones(draws, windowSize, numSegments) {
        if (draws.length < numSegments) return null;
        
        const segmentSize = Math.floor(draws.length / numSegments);
        const segments = [];
        
        // Divide draws into segments (from newest to oldest)
        for (let i = 0; i < numSegments; i++) {
            const start = i * segmentSize;
            const end = (i === numSegments - 1) ? draws.length : (i + 1) * segmentSize;
            const segmentDraws = draws.slice(start, end);
            
            // Calculate frequency for each number in this segment
            const freq = new Array(TOTAL_NUMBERS + 1).fill(0);
            for (const draw of segmentDraws) {
                for (const num of draw.numbers) {
                    freq[num]++;
                }
            }
            
            // Find dense zones using sliding window
            const zones = [];
            let maxDensity = 0;
            
            for (let windowStart = 1; windowStart <= TOTAL_NUMBERS - windowSize + 1; windowStart++) {
                const windowEnd = windowStart + windowSize - 1;
                let totalCount = 0;
                
                for (let num = windowStart; num <= windowEnd; num++) {
                    totalCount += freq[num];
                }
                
                const density = totalCount / segmentDraws.length; // 平均每期在此區間開出多少個
                if (density > maxDensity) maxDensity = density;
                
                if (density >= 3) { // 平均每期至少3個號碼在此區間
                    zones.push({
                        start: windowStart,
                        end: windowEnd,
                        center: (windowStart + windowEnd) / 2,
                        totalCount,
                        density: density.toFixed(2),
                        avgPerDraw: density.toFixed(1)
                    });
                }
            }
            
            // Keep only top zones (non-overlapping)
            const topZones = [];
            zones.sort((a, b) => b.totalCount - a.totalCount);
            
            for (const zone of zones) {
                const overlaps = topZones.some(existing => 
                    !(zone.end < existing.start || zone.start > existing.end)
                );
                if (!overlaps && topZones.length < 3) {
                    topZones.push(zone);
                }
            }
            
            segments.push({
                segmentIndex: i,
                drawCount: segmentDraws.length,
                startDraw: segmentDraws[0].drawNumber,
                endDraw: segmentDraws[segmentDraws.length - 1].drawNumber,
                zones: topZones,
                maxDensity
            });
        }
        
        return segments;
    }

    /**
     * Analyze cluster movements between segments
     */
    function analyzeZoneMovements(segments) {
        if (!segments || segments.length < 2) return null;
        
        const movements = [];
        
        for (let i = 0; i < segments.length - 1; i++) {
            const current = segments[i];
            const next = segments[i + 1];
            
            if (current.zones.length > 0 && next.zones.length > 0) {
                const currentMain = current.zones[0];
                const nextMain = next.zones[0];
                
                const centerShift = currentMain.center - nextMain.center;
                const densityChange = parseFloat(currentMain.density) - parseFloat(nextMain.density);
                
                movements.push({
                    fromSegment: i + 1,
                    toSegment: i,
                    fromZone: nextMain,
                    toZone: currentMain,
                    centerShift: centerShift.toFixed(1),
                    direction: centerShift > 2 ? 'right' : centerShift < -2 ? 'left' : 'stable',
                    densityChange: densityChange.toFixed(2)
                });
            }
        }
        
        // Calculate overall trend
        let totalShift = 0;
        let rightCount = 0;
        let leftCount = 0;
        
        for (const m of movements) {
            totalShift += parseFloat(m.centerShift);
            if (m.direction === 'right') rightCount++;
            else if (m.direction === 'left') leftCount++;
        }
        
        const avgShift = movements.length > 0 ? (totalShift / movements.length).toFixed(1) : 0;
        const trend = totalShift > 2 ? 'right' : totalShift < -2 ? 'left' : 'stable';
        
        return {
            movements,
            avgShift,
            trend,
            rightCount,
            leftCount
        };
    }

    /**
     * Render cluster movement visualization with heatmap overlay
     */
    function renderClusterMovement(period, windowSize, numSegments) {
        if (draws.length === 0) {
            clusterHeatmapWrapper.innerHTML = '<div class="cluster-empty">無資料</div>';
            clusterSummary.innerHTML = '';
            return;
        }
        
        const actualCount = period === 'all' ? draws.length : Math.min(parseInt(period), draws.length);
        const displayDraws = draws.slice(0, actualCount);
        
        if (displayDraws.length < numSegments) {
            clusterHeatmapWrapper.innerHTML = `<div class="cluster-empty">資料不足，需要至少 ${numSegments} 期</div>`;
            clusterSummary.innerHTML = '';
            return;
        }
        
        // Analyze dense zones
        const segments = findDenseZones(displayDraws, windowSize, numSegments);
        const movements = analyzeZoneMovements(segments);
        
        if (!segments || segments.length === 0) {
            clusterHeatmapWrapper.innerHTML = '<div class="cluster-empty">找不到密集區</div>';
            clusterSummary.innerHTML = '';
            return;
        }
        
        // Render heatmap with zone overlays
        let html = '<div class="cluster-heatmap-container">';
        html += '<div class="cluster-heatmap">';
        
        // Header row (numbers 1-80)
        html += '<div class="cluster-heatmap-row header">';
        html += '<div class="distribution-cell header">期數</div>';
        for (let num = 1; num <= TOTAL_NUMBERS; num++) {
            const className = num % 10 === 0 ? 'distribution-cell header milestone' : 'distribution-cell header';
            html += `<div class="${className}">${num}</div>`;
        }
        html += '</div>';
        
        // Segment markers and data rows
        let currentSegmentIndex = 0;
        
        for (let i = 0; i < displayDraws.length; i++) {
            const draw = displayDraws[i];
            
            // Check if we're entering a new segment
            const segmentSize = Math.floor(displayDraws.length / numSegments);
            const newSegmentIndex = Math.floor(i / segmentSize);
            if (newSegmentIndex < numSegments && newSegmentIndex !== currentSegmentIndex) {
                currentSegmentIndex = newSegmentIndex;
                
                // Add segment separator with zone highlight
                const segment = segments[currentSegmentIndex];
                if (segment && segment.zones.length > 0) {
                    html += '<div class="cluster-segment-marker">';
                    html += `<div class="segment-label">時段 ${currentSegmentIndex + 1}</div>`;
                    html += '<div class="segment-zones">';
                    
                    for (const zone of segment.zones) {
                        const leftPos = ((zone.start - 1) / TOTAL_NUMBERS * 100).toFixed(2);
                        const width = ((zone.end - zone.start + 1) / TOTAL_NUMBERS * 100).toFixed(2);
                        const strength = parseFloat(zone.density) >= 4 ? 'strong' : 
                                       parseFloat(zone.density) >= 3.5 ? 'moderate' : 'weak';
                        
                        html += `<div class="segment-zone-bar ${strength}" 
                            style="left: ${leftPos}%; width: ${width}%"
                            title="密集區 ${zone.start}-${zone.end}: 平均${zone.avgPerDraw}個/期">
                        </div>`;
                    }
                    
                    html += '</div>';
                    html += '</div>';
                }
            }
            
            // Data row
            html += '<div class="cluster-heatmap-row">';
            const dn2 = draw.drawNumber.toString();
            html += `<div class="distribution-cell draw-number"><span class="draw-full">${dn2}</span><span class="draw-short">${dn2.slice(-4)}</span></div>`;
            
            for (let num = 1; num <= TOTAL_NUMBERS; num++) {
                const hasNum = draw.numbers.includes(num);
                const className = hasNum ? 'distribution-cell hit' : 'distribution-cell';
                html += `<div class="${className}"></div>`;
            }
            
            html += '</div>';
        }
        
        html += '</div>'; // cluster-heatmap
        html += '</div>'; // cluster-heatmap-container
        
        clusterHeatmapWrapper.innerHTML = html;
        
        // Render summary
        renderClusterSummary(segments, movements);
    }
    
    /**
     * Render cluster movement summary
     */
    function renderClusterSummary(segments, movements) {
        if (!movements) {
            clusterSummary.innerHTML = '';
            return;
        }
        
        let html = '';
        
        // Movement trend card
        html += '<div class="cluster-summary-card">';
        html += '<h3><span class="icon">🔄</span> 板塊移動趨勢</h3>';
        
        html += '<div class="cluster-summary-item">';
        html += '<span class="cluster-summary-label">整體趨勢</span>';
        const trendLabel = movements.trend === 'right' ? '向右（往大號）' : 
                          movements.trend === 'left' ? '向左（往小號）' : '位置穩定';
        const trendClass = movements.trend;
        html += `<span class="cluster-movement-arrow ${trendClass}">${trendLabel}</span>`;
        html += '</div>';
        
        html += '<div class="cluster-summary-item">';
        html += '<span class="cluster-summary-label">平均移動</span>';
        html += `<span class="cluster-summary-value">${Math.abs(movements.avgShift)} 個號碼</span>`;
        html += '</div>';
        
        html += '<div class="cluster-summary-item">';
        html += '<span class="cluster-summary-label">移動次數</span>';
        html += `<span class="cluster-summary-value">→${movements.rightCount} / ←${movements.leftCount}</span>`;
        html += '</div>';
        html += '</div>';
        
        // Segment details
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            if (segment.zones.length === 0) continue;
            
            html += '<div class="cluster-summary-card">';
            html += `<h3><span class="icon">📍</span> 時段 ${i + 1} 密集區</h3>`;
            html += `<p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
                期數 ${segment.endDraw} ~ ${segment.startDraw} (${segment.drawCount}期)
            </p>`;
            
            for (let j = 0; j < segment.zones.length; j++) {
                const zone = segment.zones[j];
                html += '<div class="cluster-summary-item">';
                html += `<span class="cluster-summary-label">密集區 ${j + 1}</span>`;
                html += `<span class="cluster-summary-value">${zone.start}-${zone.end} (${zone.avgPerDraw}/期)</span>`;
                html += '</div>';
            }
            
            html += '</div>';
        }
        
        clusterSummary.innerHTML = html;
    }

    // ─────────────────────────────────────────────────────────────
    //  7. Rendering — Suggestions
    // ─────────────────────────────────────────────────────────────

    function renderSuggestions(suggestions) {
        const container = document.getElementById('suggestionContainer');
        container.innerHTML = '';

        suggestions.slice().sort((a, b) => a.number - b.number).forEach(s => {
            const tagClass = s.tag === 'hot' ? 'tag-hot' : s.tag === 'overdue' ? 'tag-overdue' : 'tag-stable';
            const tagLabel = s.tag === 'hot' ? '熱號' : s.tag === 'overdue' ? '到期' : '穩定';
            const numColor = s.tag === 'hot' ? '#fca5a5' : s.tag === 'overdue' ? '#c4b5fd' : '#86efac';

            const card = document.createElement('div');
            card.className = 'suggestion-card';
            card.title = s.reason;
            card.innerHTML = `
                <span class="s-number" style="color:${numColor}">${s.number}</span>
                <span class="s-tag ${tagClass}">${tagLabel}</span>
            `;
            container.appendChild(card);
        });
    }

    function renderGroups(groups) {
        const container = document.getElementById('groupContainer');
        if (!container) return;
        container.innerHTML = '';

        const palette = {
            hot:    { bg: 'rgba(239,68,68,0.10)',   border: 'rgba(252,165,165,0.25)', numColor: '#fca5a5' },
            overdue:{ bg: 'rgba(124,58,237,0.10)',  border: 'rgba(196,181,253,0.25)', numColor: '#c4b5fd' },
            stable: { bg: 'rgba(34,197,94,0.10)',   border: 'rgba(134,239,172,0.25)', numColor: '#86efac' },
            mix:    { bg: 'rgba(59,130,246,0.10)',  border: 'rgba(147,197,253,0.25)', numColor: '#93c5fd' },
            horse:  { bg: 'rgba(234,179,8,0.10)',   border: 'rgba(253,224,71,0.25)',  numColor: '#fde047' },
        };

        groups.forEach((g, i) => {
            const c = palette[g.tag] || palette.hot;
            const card = document.createElement('div');
            card.className = 'group-card';
            card.style.cssText = `background:${c.bg};border-color:${c.border};`;

            const numsHtml = g.nums.slice().sort((a, b) => a - b).map(n =>
                `<span class="g-number" style="color:${c.numColor}">${String(n).padStart(2, '0')}</span>`
            ).join('');

            card.innerHTML = `
                <div class="g-header">
                    <span class="g-icon">${g.icon}</span>
                    <span class="g-name">${g.name}</span>
                    <span class="g-index">第 ${i + 1} 組</span>
                </div>
                <div class="g-numbers">${numsHtml}</div>
                <div class="g-desc">${g.desc}</div>
            `;
            container.appendChild(card);
        });
    }

    // ─────────────────────────────────────────────────────────────
    //  7. Master Render
    // ─────────────────────────────────────────────────────────────

    function populateDrawRangeSelects() {
        const savedStart = drawRangeStart.value;
        const savedEnd = drawRangeEnd.value;

        // 兩個下拉選單皆以最新期數排在最前面（遞減排序）
        const allNums = draws.map(d => d.drawNumber);
        const descending = [...allNums].sort((a, b) => a > b ? -1 : 1);

        drawRangeStart.innerHTML = '<option value="">（最早）</option>';
        for (const num of descending) {
            const opt = document.createElement('option');
            opt.value = num;
            opt.textContent = num;
            drawRangeStart.appendChild(opt);
        }

        drawRangeEnd.innerHTML = '<option value="">（最新）</option>';
        for (const num of descending) {
            const opt = document.createElement('option');
            opt.value = num;
            opt.textContent = num;
            drawRangeEnd.appendChild(opt);
        }

        // Restore previous selection if still valid
        if (savedStart && drawRangeStart.querySelector(`option[value="${savedStart}"]`)) {
            drawRangeStart.value = savedStart;
        }
        if (savedEnd && drawRangeEnd.querySelector(`option[value="${savedEnd}"]`)) {
            drawRangeEnd.value = savedEnd;
        }
    }

    function refreshAll() {
        // 控制列永遠顯示（讓按鈕隨時可用）
        controlBar.style.display = '';

        if (draws.length === 0) {
            // 隱藏各分析區塊
            [heatmapSection, rankingSection, suggestionSection, disclaimer, checkPrizeSection, distributionHeatmapSection, cooccurrenceSection].forEach(el => el.style.display = 'none');
            // 顯示空狀態
            if (emptyState) emptyState.style.display = '';
            dataSummary.innerHTML = '<span style="opacity:.6">尚未載入資料</span>';
            drawRangeStart.innerHTML = '<option value="">（最早）</option>';
            drawRangeEnd.innerHTML = '<option value="">（最新）</option>';
            return;
        }

        // 有資料：隱藏空狀態
        if (emptyState) emptyState.style.display = 'none';

        // Show sections
        [heatmapSection, rankingSection, suggestionSection, disclaimer, checkPrizeSection, distributionHeatmapSection].forEach(el => el.style.display = '');

        // Summary — 整合到 importStatus，不再單獨顯示
        dataSummary.innerHTML = '';

        // Heatmaps
        const periods = [
            { id: 'heatmap10', n: 10 },
            { id: 'heatmap25', n: 25 },
            { id: 'heatmap50', n: 50 }
        ];

        for (const p of periods) {
            if (draws.length < p.n) {
                const container = document.getElementById(p.id);
                container.innerHTML = `<div class="insufficient">資料不足（需要至少 ${p.n} 期，目前 ${draws.length} 期）</div>`;
            } else {
                const { freq, count } = calcFrequency(draws, p.n);
                renderHeatmap(p.id, freq, count);
            }
        }

        // Rankings (using last 50 draws or all available)
        const rankN = Math.min(50, draws.length);
        const { freq: rankFreq } = calcFrequency(draws, rankN);
        const { hot, cold } = calcHotCold(rankFreq, rankN);
        const gaps = calcGaps(draws);

        const maxHotFreq = hot.length > 0 ? hot[0].freq : 1;
        const maxColdFreq = cold.length > 0 ? cold[0].freq : 1;
        const maxGap = gaps.length > 0 ? gaps[0].currentGap : 1;

        renderRanking('hotRanking', hot, maxHotFreq, 'hot');
        renderRanking('coldRanking', cold, maxColdFreq, 'cold');
        renderRanking('overdueRanking', gaps, maxGap, 'overdue');

        // Suggestions
        const suggestions = suggestNumbers(draws);
        renderSuggestions(suggestions);
        try {
            const groups = suggestGroups(draws);
            renderGroups(groups);
        } catch (e) {
            console.error('[suggestGroups error]', e);
        }
        
        // Draw range selects
        populateDrawRangeSelects();

        // Distribution Heatmap
        const currentPeriod = distributionPeriodSelect.value;
        renderDistributionHeatmap(currentPeriod);

        // Co-occurrence section
        cooccurrenceSection.style.display = '';
        renderCoocPicker();
        renderCoocResult();
    }

    // ─────────────────────────────────────────────────────────────
    //  9. Storage & Status
    // ─────────────────────────────────────────────────────────────

    function showStatus(type, msg) {
        importStatus.className = 'import-status ' + type;
        importStatus.innerHTML = msg;
        importStatus.style.display = 'block';
    }

    function saveToStorage() {
        try {
            localStorage.setItem('bingo_draws', JSON.stringify(draws));
            localStorage.setItem('bingo_last_fetch', String(Date.now()));
        } catch (e) { /* ignore */ }
    }

    function loadFromStorage() {
        try {
            const d = localStorage.getItem('bingo_draws');
            if (d) draws = JSON.parse(d);
        } catch (e) { /* ignore */ }
    }

    /**
     * 判斷瀏覽器 localStorage 快取是否仍在有效期（< 5 分鐘）
     * @returns {{ fresh: boolean, ageMs: number, remainMs: number }}
     */
    function getBrowserCacheStatus() {
        try {
            const lastFetch = parseInt(localStorage.getItem('bingo_last_fetch') || '0', 10);
            const ageMs     = Date.now() - lastFetch;
            return {
                fresh    : lastFetch > 0 && ageMs < CACHE_TTL_MS,
                ageMs,
                remainMs : Math.max(0, CACHE_TTL_MS - ageMs),
            };
        } catch {
            return { fresh: false, ageMs: Infinity, remainMs: 0 };
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  10. Event Binding
    // ─────────────────────────────────────────────────────────────

    // Check prize button
    btnCheckPrize.addEventListener('click', () => {
        const startDraw = drawRangeStart.value.trim();
        const endDraw = drawRangeEnd.value.trim();
        const prizeNumsText = prizeNumbers.value.trim();
        
        if (!prizeNumsText) {
            alert('請輸入對獎號碼');
            return;
        }
        
        // Parse prize numbers
        const prizeNums = prizeNumsText.split(/[\s,，]+/)
            .map(s => parseInt(s, 10))
            .filter(n => !isNaN(n) && n >= 1 && n <= TOTAL_NUMBERS);
        
        if (prizeNums.length === 0) {
            alert('請輸入有效的獎號（1-80）');
            return;
        }
        
        // Check prizes
        const results = checkPrizes(startDraw, endDraw, prizeNums);
        
        if (results.length === 0) {
            alert('找不到符合條件的期數');
            return;
        }
        
        // Display results
        let html = `<h3>對獎結果</h3>`;
        html += `<div class="result-summary">共檢查 ${results.length} 期</div>`;
        html += `<p style="color: var(--text-secondary); margin-bottom: 1rem;">你的號碼：${prizeNums.sort((a,b) => a-b).join(', ')}</p>`;
        html += `<div class="result-list">`;
        
        for (const result of results) {
            const matchClass = result.matchCount >= 10 ? 'match-count' : '';
            html += `<div class="result-item">`;
            html += `期數 <strong>${result.drawNumber}</strong>：中了 <span class="${matchClass}">${result.matchCount}</span> 個號碼`;
            if (result.matchCount > 0) {
                html += ` → ${result.matchedNumbers.sort((a,b) => a-b).join(', ')}`;
            }
            html += `</div>`;
        }
        
        html += `</div>`;
        
        checkPrizeResult.innerHTML = html;
        checkPrizeResult.classList.add('show');
    });

    // Distribution heatmap period selector
    distributionPeriodSelect.addEventListener('change', (e) => {
        renderDistributionHeatmap(e.target.value);
    });

    // Hide right-fade overlay when user scrolls to the end (or no overflow)
    function checkDistScrollEnd() {
        if (!distributionHeatmapContainer) return;
        const el = distributionHeatmapContainer;
        const noOverflow = el.scrollWidth <= el.clientWidth;
        const atEnd = noOverflow || el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
        el.classList.toggle('scrolled-end', atEnd);
    }
    if (distributionHeatmapContainer) {
        distributionHeatmapContainer.addEventListener('scroll', checkDistScrollEnd);
        window.addEventListener('resize', checkDistScrollEnd);
    }

    // Fullscreen distribution heatmap
    // 策略：
    //   1. 優先呼叫原生 requestFullscreen + screen.orientation.lock('landscape')
    //   2. iOS Safari 不支援 requestFullscreen → fallback CSS overlay
    //   3. 關閉時 exitFullscreen + orientation.unlock

    function openDistFullscreen() {
        // Sync period select，複製內容
        distributionPeriodSelectFs.value = distributionPeriodSelect.value;
        distributionHeatmapFs.innerHTML  = distributionHeatmap.innerHTML;

        const el = distFullscreenOverlay;

        // 嘗試原生全螢幕 API
        const reqFS = el.requestFullscreen ||
                      el.webkitRequestFullscreen ||
                      el.mozRequestFullScreen ||
                      el.msRequestFullscreen;

        if (reqFS) {
            reqFS.call(el).then(() => {
                // 進入全螢幕後請求鎖定橫屏
                if (screen.orientation && screen.orientation.lock) {
                    screen.orientation.lock('landscape').catch(() => { /* 部分蠟機不支援，忽略 */ });
                }
            }).catch(() => {
                // requestFullscreen 被拒絕（如 iframe sandbox）→ CSS fallback
                activateCssOverlay();
            });
        } else {
            // iOS Safari—直接用 CSS overlay
            activateCssOverlay();
        }
    }

    function activateCssOverlay() {
        distFullscreenOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeDistFullscreen() {
        // 退出原生全螢幕
        const exitFS = document.exitFullscreen ||
                       document.webkitExitFullscreen ||
                       document.mozCancelFullScreen ||
                       document.msExitFullscreen;

        if (exitFS && document.fullscreenElement) {
            // 先解鎖方向
            if (screen.orientation && screen.orientation.unlock) {
                try { screen.orientation.unlock(); } catch (_) { }
            }
            exitFS.call(document).catch(() => {});
        }

        // 不管原生全螢幕有沒有，一並清除 CSS overlay
        distFullscreenOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    // 原生全螢幕： overlay 顯示 / 隱藏跟隨 fullscreenchange
    document.addEventListener('fullscreenchange',       onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('mozfullscreenchange',    onFsChange);
    function onFsChange() {
        const isFs = !!(document.fullscreenElement ||
                        document.webkitFullscreenElement ||
                        document.mozFullScreenElement);
        if (isFs) {
            distFullscreenOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        } else {
            distFullscreenOverlay.classList.remove('active');
            document.body.style.overflow = '';
            if (screen.orientation && screen.orientation.unlock) {
                try { screen.orientation.unlock(); } catch (_) { }
            }
        }
    }

    btnDistFullscreen.addEventListener('click', openDistFullscreen);
    btnDistClose.addEventListener('click', closeDistFullscreen);

    distributionPeriodSelectFs.addEventListener('change', (e) => {
        // Keep both selects in sync and re-render
        distributionPeriodSelect.value = e.target.value;
        renderDistributionHeatmap(e.target.value);
        distributionHeatmapFs.innerHTML = distributionHeatmap.innerHTML;
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && distFullscreenOverlay.classList.contains('active')) {
            closeDistFullscreen();
        }
    });

    // Co-occurrence period selector
    coocPeriodSelect.addEventListener('change', () => {
        renderCoocPicker();
        renderCoocResult();
    });

    // Co-occurrence clear button
    btnClearCooc.addEventListener('click', () => {
        coocSelected = [];
        coocPicker.querySelectorAll('.cooc-cell').forEach(cell => cell.classList.remove('selected'));
        coocResult.innerHTML = '';
        coocPicker.parentElement.classList.remove('has-result');
    });

    // Refresh API button（強制略過快取，直接打 API）
    btnRefreshAPI.addEventListener('click', () => {
        fetchTodayFromAPI(true);
    });

    // Clear data
    btnClearData.addEventListener('click', () => {
        draws = [];
        localStorage.removeItem('bingo_draws');
        localStorage.removeItem('bingo_last_fetch');
        importStatus.className = 'import-status';
        importStatus.innerHTML = '';
        refreshAll();
    });

    // Empty state 的「立即載入」按鈕（與重新整理同行為）
    const btnEmptyRefresh = $('#btnEmptyRefresh');
    if (btnEmptyRefresh) {
        btnEmptyRefresh.addEventListener('click', () => fetchTodayFromAPI(true));
    }

    // ─────────────────────────────────────────────────────────────
    //  10b. API Auto-Fetch
    // ─────────────────────────────────────────────────────────────

    /**
     * 自動從台灣彩券 API 載入今日 (openDate = 今天 YYYY-MM-DD) 開獎資料
     * API: https://api.taiwanlottery.com/TLCAPIWeB/Lottery/BingoResult
     *   openDate  YYYY-MM-DD 開獎日期
     *   pageNum   頁碼，從 1 開始
     *   pageSize  每頁筆數，500 足夠涵蓋單日全部期數
     * 回傳格式: { rtCode, content: { totalSize, bingoQueryResult: […] } }
     *   bingoQueryResult[i].drawTerm      期數 (number)
     *   bingoQueryResult[i].bigShowOrder  排序後 20 個號碼字串陣列, e.g. ["01","07",...]
     */
    /**
     * 載入今日開獎資料（含三層快取保護）
     *
     * 快取優先順序：
     *   1. 瀏覽器 localStorage（最快，無網路請求）
     *   2. 本地 server.js 檔案快取（/api/bingo）
     *   3. 台灣彩券 API（直打，最後手段）
     *
     * @param {boolean} forceRefresh - true 時略過所有快取，強制打 API
     */
    async function fetchTodayFromAPI(forceRefresh = false) {
        const today   = new Date();
        const dateStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');

        // ── 第一層：瀏覽器 localStorage 快取 ──────────────────────
        if (!forceRefresh) {
            const cacheStatus = getBrowserCacheStatus();
            if (cacheStatus.fresh) {
                loadFromStorage();
                if (draws.length > 0) {
                    const ageMin    = Math.floor(cacheStatus.ageMs / 60000);
                    const ageSec    = Math.floor((cacheStatus.ageMs % 60000) / 1000);
                    const remainMin = Math.floor(cacheStatus.remainMs / 60000);
                    const remainSec = Math.floor((cacheStatus.remainMs % 60000) / 1000);
                    showStatus('success',
                        `✅ 使用本機快取（更新於 ${ageMin}m${ageSec}s 前），已載入 <strong>${draws.length}</strong> 期開獎資料` +
                        `　<span style="opacity:.6">下次更新約 ${remainMin}m${remainSec}s 後</span>`);
                    if (metaDate) metaDate.textContent = `${dateStr} · ${draws.length} 期（快取）`;
                    refreshAll();
                    // 自動排程：快取過期後再刷新
                    setTimeout(() => fetchTodayFromAPI(), cacheStatus.remainMs + 2000);
                    return true;
                }
            }
        }

        // ── 第二層：本地代理（server.js 檔案快取） ────────────────
        const localUrl  = `${LOCAL_API_BASE}/api/bingo?openDate=${dateStr}`;
        const directUrl = `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/BingoResult?openDate=${dateStr}&pageNum=1&pageSize=500`;

        showStatus('', `⏳ 正在載入 <strong>${dateStr}</strong> 開獎資料…`);

        // 先嘗試本地代理，失敗才直打台灣彩券 API
        let json = null;
        let usedSource = '';

        try {
            const resp = await fetch(localUrl);
            if (!resp.ok) throw new Error(`代理 HTTP ${resp.status}`);
            json       = await resp.json();
            usedSource = resp.headers.get('X-Cache') === 'HIT' ? '本地檔案快取' : '台灣彩券 API（經代理）';
        } catch (proxyErr) {
            console.warn('[快取] 本地代理無法連線，直接呼叫台灣彩券 API：', proxyErr.message);
            try {
                const resp = await fetch(directUrl);
                if (!resp.ok) throw new Error(`HTTP 錯誤 ${resp.status}`);
                json       = await resp.json();
                usedSource = '台灣彩券 API（直連）';
            } catch (directErr) {
                // ── 第三層：讀舊的 localStorage 快取（stale）────────
                showStatus('error', `❌ 載入失敗：${directErr.message}`);
                loadFromStorage();
                if (draws.length > 0) {
                    showStatus('warning', `⚠️ 使用上次快取資料（可能非最新），共 <strong>${draws.length}</strong> 期`);
                    refreshAll();
                }
                return false;
            }
        }

        // ── 解析回傳 JSON ──────────────────────────────────────────
        if (!json.content || !Array.isArray(json.content.bingoQueryResult)) {
            showStatus('error', '❌ API 回應格式異常');
            return false;
        }

        const results = json.content.bingoQueryResult;
        const parsed  = [];

        for (const item of results) {
            if (!Array.isArray(item.bigShowOrder) || item.bigShowOrder.length !== NUMBERS_PER_DRAW) continue;
            const numbers = item.bigShowOrder
                .map(n => parseInt(n, 10))
                .filter(n => n >= 1 && n <= TOTAL_NUMBERS);
            if (numbers.length === NUMBERS_PER_DRAW) {
                parsed.push({
                    drawNumber: String(item.drawTerm),
                    numbers   : numbers.sort((a, b) => a - b),
                });
            }
        }

        if (parsed.length === 0) {
            showStatus('warning', `⚠️ ${dateStr} 目前尚無開獎資料，請稍後再試`);
            return false;
        }

        draws = parsed;
        saveToStorage();   // ← 同時寫入時間戳
        if (metaDate) metaDate.textContent = `${dateStr} · ${parsed.length} 期`;
        showStatus('success',
            `✅ 已載入 <strong>${parsed.length}</strong> 期開獎資料（來源：${usedSource}）`);
        refreshAll();

        // 自動排程：5 分鐘後再刷新（對齊下一期開獎）
        setTimeout(() => fetchTodayFromAPI(), CACHE_TTL_MS + 2000);
        return true;
    }

    // ─────────────────────────────────────────────────────────────
    //  11. Init
    // ─────────────────────────────────────────────────────────────

    // 初始控制列文字（載入完成後由 refreshAll 覆蓋）
    dataSummary.innerHTML = '<span style="opacity:.5">正在載入…</span>';

    // 頁面開啟→自動載入（優先讀快取，避免不必要的 API 呼叫）
    fetchTodayFromAPI();

})();
