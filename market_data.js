/**
 * Day Trading Scanner v7
 * ─────────────────────────────────────────────────────────────────────────────
 * Hosted at: github.com/mgoodson117/DayTradingScanner
 * CDN:       https://cdn.jsdelivr.net/gh/mgoodson117/DayTradingScanner@main/market_data.js
 *
 * Inject into a Yahoo Finance tab via javascript_tool, then call:
 *   window.RDT.run()                 → full auto-scan (gainers + losers + actives + Mag7 + watchlist)
 *   window.RDT.analyze([...tickers]) → analyze a specific list
 *   window.RDT.summary()             → formatted output after either call
 *
 * v7 CHANGES vs v6:
 *
 *   1. ALGO LINES — strict spec method:
 *      - Lookback 90 daily candles (was 60).
 *      - Sloped lines require ≥3 touches within 0.5% tolerance (was 2).
 *      - Hard reject anchor pairs separated by ≥5% overnight gap.
 *      - Hard exclude projection-only lines (level beyond actual 90-day H/L).
 *      - Each line carries slopeQuality (R² of fit) and recencyScore.
 *
 *   2. HORIZONTAL LEVEL WEIGHTING:
 *      - 2 touches → MINOR (1.0), 3 touches → MAJOR (1.5), 4+ → KEY (2.0).
 *
 *   3. PRIOR SWING LEVELS: priorSwingHighs/Lows arrays, last 5 each.
 *
 *   4. ANCHORED VWAPs: from 52w high, 52w low, recent ≥5% gap, breakout pivot.
 *
 *   5. ATR + BREAKOUT-PIVOT PROJECTIONS:
 *      - atr20 = 20-day ATR
 *      - For breakout: T1 = pivot + 1×ATR, T2 = pivot + 2×ATR.
 *      - For ATH: T1 = price + 1×ATR, T2 = price + 2×ATR.
 *      - Synthetic 1R/2R extension fallback removed.
 */

window.RDT = (function () {

  const VERSION = 'v7.1.0';

  const SECTOR_ETFS = {
    XLK: 'Technology', XLE: 'Energy', XLF: 'Financials', XLV: 'Healthcare',
    XLI: 'Industrials', XLY: 'Consumer Disc', XLP: 'Consumer Staples',
    XLB: 'Materials', XLC: 'Comm Services', XLRE: 'Real Estate', XLU: 'Utilities',
  };

  const MAG7 = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'];
  const SEMI_WATCHLIST = ['AMD', 'QCOM'];
  const USER_WATCHLIST = [];

  const MIN_MKTCAP = 2e9;
  const SCREENER_URL = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&count=30&scrIds=';
  const CHART_URL = (t, range) => `https://query1.finance.yahoo.com/v8/finance/chart/${t}?interval=1d&range=${range}`;
  const M5_URL = (t) => `https://query1.finance.yahoo.com/v8/finance/chart/${t}?interval=5m&range=1d`;

  const ALGO_LOOKBACK = 90;
  const ALGO_TOUCH_TOL = 0.005;
  const ALGO_MIN_TOUCHES = 3;
  const ALGO_GAP_THRESH = 0.05;
  const HORIZ_CLUSTER_TOL = 0.005;

  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function getETContext() {
    const now = new Date();
    const etStr = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
    const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const h = etDate.getHours(), m = etDate.getMinutes();
    const totalMin = h * 60 + m;
    let phase;
    if      (totalMin < 9 * 60 + 30)  phase = 'PRE-MARKET';
    else if (totalMin < 10 * 60 + 30) phase = 'EARLY SESSION (first 60 min)';
    else if (totalMin < 14 * 60 + 30) phase = 'MID-SESSION';
    else if (totalMin < 16 * 60)      phase = 'LATE SESSION';
    else                               phase = 'AFTER HOURS';
    return { etStr, phase, h, m, totalMin };
  }

  function fmtDate(ts) {
    return ts ? new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?';
  }

  function sma(values, n) {
    const s = values.slice(-n);
    return s.length >= n ? parseFloat((s.reduce((a, b) => a + b, 0) / n).toFixed(2)) : null;
  }

  function computeATR(candles, period = 20) {
    if (candles.length < period + 1) return null;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].h - candles[i].l,
        Math.abs(candles[i].h - candles[i - 1].c),
        Math.abs(candles[i].l - candles[i - 1].c)
      );
      trs.push(tr);
    }
    const recent = trs.slice(-period);
    return parseFloat((recent.reduce((a, b) => a + b, 0) / period).toFixed(2));
  }

  function findPriorSwingLevels(candles, count = 5) {
    const recent = candles.slice(-ALGO_LOOKBACK);
    const n = recent.length;
    const highs = [], lows = [];
    for (let i = 2; i < n - 2; i++) {
      if (recent[i].h > recent[i-1].h && recent[i].h > recent[i-2].h &&
          recent[i].h > recent[i+1].h && recent[i].h > recent[i+2].h) {
        highs.push({ idx: i, price: recent[i].h, t: recent[i].t });
      }
      if (recent[i].l < recent[i-1].l && recent[i].l < recent[i-2].l &&
          recent[i].l < recent[i+1].l && recent[i].l < recent[i+2].l) {
        lows.push({ idx: i, price: recent[i].l, t: recent[i].t });
      }
    }
    const today = n - 1;
    const fmt = p => ({ price: parseFloat(p.price.toFixed(2)), date: fmtDate(p.t), daysAgo: today - p.idx });
    return {
      priorSwingHighs: highs.slice(-count).reverse().map(fmt),
      priorSwingLows: lows.slice(-count).reverse().map(fmt),
    };
  }

  function computeAnchoredVWAP(candles, anchorIdx) {
    if (anchorIdx == null || anchorIdx < 0 || anchorIdx >= candles.length) return null;
    let cumTPV = 0, cumVol = 0;
    for (let i = anchorIdx; i < candles.length; i++) {
      const c = candles[i];
      if (c.h == null || c.l == null || c.c == null || !c.v) continue;
      const tp = (c.h + c.l + c.c) / 3;
      cumTPV += tp * c.v;
      cumVol += c.v;
    }
    return cumVol > 0 ? parseFloat((cumTPV / cumVol).toFixed(2)) : null;
  }

  function findHighIdx(candles, targetHigh) {
    let bestIdx = -1, bestDiff = Infinity;
    candles.forEach((c, i) => { const diff = Math.abs(c.h - targetHigh); if (diff < bestDiff) { bestDiff = diff; bestIdx = i; } });
    return bestIdx;
  }

  function findLowIdx(candles, targetLow) {
    let bestIdx = -1, bestDiff = Infinity;
    candles.forEach((c, i) => { const diff = Math.abs(c.l - targetLow); if (diff < bestDiff) { bestDiff = diff; bestIdx = i; } });
    return bestIdx;
  }

  function findRecentGapIdx(candles, threshPct = 5) {
    const window = Math.min(30, candles.length - 1);
    for (let i = candles.length - 1; i >= candles.length - window; i--) {
      if (i < 1) continue;
      const gap = Math.abs((candles[i].o - candles[i-1].c) / candles[i-1].c * 100);
      if (gap >= threshPct) return i;
    }
    return null;
  }

  function computeAlgoLinesV7(candles, currentPrice) {
    const recent = candles.slice(-ALGO_LOOKBACK);
    const n = recent.length;
    if (n < 10) return [];

    const swingHighs = [], swingLows = [];
    for (let i = 2; i < n - 2; i++) {
      if (recent[i].h > recent[i-1].h && recent[i].h > recent[i-2].h &&
          recent[i].h > recent[i+1].h && recent[i].h > recent[i+2].h) {
        swingHighs.push({ idx: i, price: recent[i].h, t: recent[i].t });
      }
      if (recent[i].l < recent[i-1].l && recent[i].l < recent[i-2].l &&
          recent[i].l < recent[i+1].l && recent[i].l < recent[i+2].l) {
        swingLows.push({ idx: i, price: recent[i].l, t: recent[i].t });
      }
    }

    const lookbackHigh = Math.max(...recent.map(c => c.h));
    const lookbackLow = Math.min(...recent.map(c => c.l));

    function anchorsCrossEarningsGap(idx1, idx2) {
      const lo = Math.min(idx1, idx2), hi = Math.max(idx1, idx2);
      for (let i = lo + 1; i <= hi; i++) {
        if (i < 1 || i >= n) continue;
        const gap = Math.abs((recent[i].o - recent[i-1].c) / recent[i-1].c);
        if (gap >= ALGO_GAP_THRESH) return true;
      }
      return false;
    }

    function tryFitSlopedLine(pivots, type) {
      if (pivots.length < ALGO_MIN_TOUCHES) return null;
      const pool = pivots.slice(-8);
      const candidates = [];

      for (let i = 0; i < pool.length - 1; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          const p1 = pool[i], p2 = pool[j];
          if (anchorsCrossEarningsGap(p1.idx, p2.idx)) continue;
          const slope = (p2.price - p1.price) / (p2.idx - p1.idx);
          const projected = p2.price + slope * ((n - 1) - p2.idx);
          if (projected > lookbackHigh * 1.005) continue;
          if (projected < lookbackLow * 0.995) continue;

          const touchPivots = [];
          for (const p of pivots) {
            const lineAtIdx = p1.price + slope * (p.idx - p1.idx);
            if (lineAtIdx <= 0) continue;
            if (Math.abs(p.price - lineAtIdx) / lineAtIdx < ALGO_TOUCH_TOL) touchPivots.push(p);
          }
          if (touchPivots.length < ALGO_MIN_TOUCHES) continue;

          const meanPrice = touchPivots.reduce((s, p) => s + p.price, 0) / touchPivots.length;
          let ssRes = 0, ssTot = 0;
          for (const p of touchPivots) {
            const predicted = p1.price + slope * (p.idx - p1.idx);
            ssRes += (p.price - predicted) ** 2;
            ssTot += (p.price - meanPrice) ** 2;
          }
          const slopeQuality = ssTot > 0 ? 1 - ssRes / ssTot : 1;
          const style = slope > 0 ? 'ASCENDING' : (slope < 0 ? 'DESCENDING' : 'HORIZONTAL');
          const meanIdx = touchPivots.reduce((s, p) => s + p.idx, 0) / touchPivots.length;
          const recencyScore = parseFloat((meanIdx / (n - 1)).toFixed(2));

          let recentlyBroken = false, breakDirection = null;
          for (let k = Math.max(0, n - 6); k < n - 1; k++) {
            const lineAt = p1.price + slope * (k - p1.idx);
            const lineNext = p1.price + slope * (k + 1 - p1.idx);
            if (recent[k].c < lineAt && recent[k+1].c > lineNext) { recentlyBroken = true; breakDirection = 'BROKE_ABOVE'; }
            if (recent[k].c > lineAt && recent[k+1].c < lineNext) { recentlyBroken = true; breakDirection = 'BROKE_BELOW'; }
          }

          candidates.push({
            type, style, level: parseFloat(projected.toFixed(2)),
            anchor1: { price: p1.price.toFixed(2), date: fmtDate(p1.t) },
            anchor2: { price: p2.price.toFixed(2), date: fmtDate(p2.t) },
            touches: touchPivots.length,
            slopeQuality: parseFloat(slopeQuality.toFixed(3)),
            recencyScore,
            nearCurrent: Math.abs(projected - currentPrice) / currentPrice < 0.03,
            above: projected > currentPrice,
            recentlyBroken, breakDirection, weight: 1.0, label: 'SLOPED',
          });
        }
      }

      candidates.sort((a, b) => b.touches - a.touches || b.slopeQuality - a.slopeQuality || b.recencyScore - a.recencyScore);
      return candidates[0] || null;
    }

    const lines = [];
    const resLine = tryFitSlopedLine(swingHighs, 'RESISTANCE'); if (resLine) lines.push(resLine);
    const supLine = tryFitSlopedLine(swingLows, 'SUPPORT'); if (supLine) lines.push(supLine);

    const allPivots = [
      ...swingHighs.map(p => ({ ...p, kind: 'HIGH' })),
      ...swingLows.map(p => ({ ...p, kind: 'LOW' })),
    ];
    const used = new Set();
    allPivots.forEach((pivot, i) => {
      if (used.has(i)) return;
      const cluster = [pivot];
      allPivots.forEach((other, j) => {
        if (j === i || used.has(j)) return;
        if (Math.abs(other.price - pivot.price) / pivot.price < HORIZ_CLUSTER_TOL) { cluster.push(other); used.add(j); }
      });
      used.add(i);
      if (cluster.length >= 2) {
        const avg = parseFloat((cluster.reduce((s, p) => s + p.price, 0) / cluster.length).toFixed(2));
        let recentlyBroken = false, breakDirection = null;
        for (let k = Math.max(0, n - 6); k < n - 1; k++) {
          if (recent[k].c < avg && recent[k+1].c > avg) { recentlyBroken = true; breakDirection = 'BROKE_ABOVE'; break; }
          if (recent[k].c > avg && recent[k+1].c < avg) { recentlyBroken = true; breakDirection = 'BROKE_BELOW'; break; }
        }
        let weight, label;
        if (cluster.length >= 4)       { weight = 2.0; label = 'KEY'; }
        else if (cluster.length === 3) { weight = 1.5; label = 'MAJOR'; }
        else                            { weight = 1.0; label = 'MINOR'; }
        lines.push({
          type: avg > currentPrice ? 'RESISTANCE' : 'SUPPORT',
          style: 'HORIZONTAL', level: avg, touches: cluster.length, weight, label,
          slopeQuality: 1.0, nearCurrent: Math.abs(avg - currentPrice) / currentPrice < 0.03,
          above: avg > currentPrice, recentlyBroken, breakDirection,
          anchor1: { price: avg.toFixed(2), date: fmtDate(cluster[0].t) },
          anchor2: { price: avg.toFixed(2), date: fmtDate(cluster[cluster.length - 1].t) },
        });
      }
    });

    return lines
      .sort((a, b) => Math.abs(a.level - currentPrice) - Math.abs(b.level - currentPrice))
      .filter((line, idx, arr) => arr.findIndex(l => Math.abs(l.level - line.level) / line.level < 0.005) === idx)
      .slice(0, 8);
  }

  function findBreakoutPivot(algoLines) {
    const broken = algoLines.filter(l =>
      l.recentlyBroken && l.breakDirection === 'BROKE_ABOVE' &&
      (l.style === 'HORIZONTAL' || l.style === 'DESCENDING') && l.type === 'RESISTANCE'
    );
    if (broken.length === 0) return null;
    broken.sort((a, b) => (b.weight || 1) - (a.weight || 1) || b.touches - a.touches);
    return broken[0];
  }

  function getHATrend(candles) {
    if (candles.length < 3) return 'UNKNOWN';
    let prev = { o: candles[0].o, c: candles[0].c };
    const ha = candles.map(c => {
      const haC = (c.o + c.h + c.l + c.c) / 4;
      const haO = (prev.o + prev.c) / 2;
      prev = { o: haO, c: haC };
      return { o: haO, c: haC };
    });
    const last3 = ha.slice(-3);
    return last3.every(c => c.c > c.o) ? 'BULLISH' : last3.every(c => c.c < c.o) ? 'BEARISH' : 'MIXED';
  }

  function getM5TrendState(m5) {
    if (!m5 || !m5.vwap) return 'N/A (no M5 data)';
    const price = parseFloat(m5.price), vwap = parseFloat(m5.vwap);
    const sma8 = m5.sma8_m5 ? parseFloat(m5.sma8_m5) : null;
    const sma20 = m5.sma20_m5 ? parseFloat(m5.sma20_m5) : null;
    if (sma8 && sma20) {
      const smaSpread = Math.abs(sma8 - sma20) / sma20;
      if (price > sma8 && sma8 > sma20 && price > vwap) return 'TRENDING UP (price > SMA8 > SMA20, above VWAP)';
      if (price < sma8 && sma8 < sma20 && price < vwap) return 'TRENDING DOWN (price < SMA8 < SMA20, below VWAP)';
      if (smaSpread < 0.002 && Math.abs(price - vwap) / vwap < 0.003) return 'CONSOLIDATING';
      if (price > vwap && price < sma8) return 'PULLING BACK (potential long entry zone)';
      if (price < vwap && price > sma8) return 'BOUNCING (watch for VWAP rejection)';
      if (price > vwap && price > sma8 && price < sma20) return 'MIXED (chop zone)';
    }
    if (price > vwap * 1.003) return 'TRENDING UP (extended above VWAP)';
    if (price < vwap * 0.997) return 'TRENDING DOWN (extended below VWAP)';
    return price > vwap ? 'ABOVE VWAP (near flat)' : 'BELOW VWAP (near flat)';
  }

  function getHODProximity(price, dayHigh, dayLow) {
    if (!dayHigh || !dayLow || dayHigh === dayLow) return 'N/A';
    const pctFromHOD = parseFloat(((dayHigh - price) / dayHigh * 100).toFixed(2));
    const pctOfRange = parseFloat(((price - dayLow) / (dayHigh - dayLow) * 100).toFixed(0));
    let label;
    if (pctFromHOD <= 0.3) label = '⚠️ AT/NEAR HOD — do not chase longs';
    else if (pctFromHOD <= 1.0) label = 'Near HOD (' + pctFromHOD + '% off)';
    else if (pctFromHOD <= 2.5) label = 'Mid-upper range (' + pctFromHOD + '% off HOD)';
    else label = 'Low in range (' + pctFromHOD + '% off HOD)';
    return label + ' | Range position: ' + pctOfRange + '% up from LOD';
  }

  async function getCandidates(spyChangePct = 0) {
    const screens = ['day_gainers', 'day_losers', 'most_actives'];
    const responses = await Promise.all(screens.map(s => fetchJSON(SCREENER_URL + s).catch(() => null)));
    const seen = new Set(['SPY']);
    const candidates = [];
    responses.forEach(d => {
      const quotes = d?.finance?.result?.[0]?.quotes || [];
      quotes.forEach(q => {
        if (!q.symbol || seen.has(q.symbol)) return;
        if ((q.marketCap || 0) < MIN_MKTCAP) return;
        if (q.quoteType !== 'EQUITY') return;
        seen.add(q.symbol);
        candidates.push({
          symbol: q.symbol, changePct: q.regularMarketChangePercent || 0,
          price: q.regularMarketPrice, volume: q.regularMarketVolume,
          marketCap: q.marketCap,
          earningsDate: q.earningsTimestampStart ? new Date(q.earningsTimestampStart * 1000) : null,
        });
      });
    });
    candidates.sort((a, b) => Math.abs(b.changePct - spyChangePct) - Math.abs(a.changePct - spyChangePct));
    return candidates.slice(0, 30);
  }

  async function fetchD1(ticker) {
    try {
      const d = await fetchJSON(CHART_URL(ticker, '5y'));
      const res = d.chart?.result?.[0];
      if (!res) return { ticker, error: 'no data' };
      const meta = res.meta, q = res.indicators.quote[0], ts = res.timestamp || [];
      const candles = ts.map((t, i) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] }))
        .filter(c => c.c != null && c.h != null && c.l != null);
      const closes = candles.map(c => c.c);
      const price = meta.regularMarketPrice;
      const prevDayClose = closes.length >= 2 ? closes[closes.length - 2] : null;
      const s20 = sma(closes, 20), s50 = sma(closes, 50), s100 = sma(closes, 100), s200 = sma(closes, 200);
      const d1_long_valid = !!(price > s20 && price > s50 && price > s100 && price > s200);
      const d1_short_valid = !!(price < s20 && price < s50);
      const smaMap = [
        { label: 'SMA20', val: s20 }, { label: 'SMA50', val: s50 },
        { label: 'SMA100', val: s100 }, { label: 'SMA200', val: s200 },
      ];
      const overheadSMAs = smaMap.filter(s => s.val && s.val > price).sort((a, b) => a.val - b.val);
      const overnightGapPct = prevDayClose ? parseFloat(((price - prevDayClose) / prevDayClose * 100).toFixed(2)) : 0;

      // v7.1.0 — preserve sign of overnight gap so direction (UP / DOWN) is available downstream
      let maxRecentGap = { pct: 0, absPct: 0, daysAgo: null, date: null, direction: null };
      const recentWindow = Math.min(5, candles.length - 1);
      for (let i = candles.length - recentWindow; i < candles.length; i++) {
        if (i < 1) continue;
        const signed = (candles[i].o - candles[i-1].c) / candles[i-1].c * 100;
        const abs = Math.abs(signed);
        if (abs > maxRecentGap.absPct) {
          maxRecentGap = {
            pct: parseFloat(signed.toFixed(1)),
            absPct: parseFloat(abs.toFixed(1)),
            daysAgo: candles.length - 1 - i,
            date: fmtDate(candles[i].t),
            direction: signed > 0 ? 'UP' : 'DOWN',
          };
        }
      }

      // v7.1.0 — recent range fields (more useful than 52w for current trade structure)
      const lowsArr  = candles.map(c => c.l);
      const highsArr = candles.map(c => c.h);
      const rangeMin = (arr, days) => {
        const slice = arr.slice(-days);
        return slice.length ? parseFloat(Math.min(...slice).toFixed(2)) : null;
      };
      const rangeMax = (arr, days) => {
        const slice = arr.slice(-days);
        return slice.length ? parseFloat(Math.max(...slice).toFixed(2)) : null;
      };
      const low30d   = rangeMin(lowsArr,  30);
      const low90d   = rangeMin(lowsArr,  90);
      const low180d  = rangeMin(lowsArr, 180);
      const high30d  = rangeMax(highsArr, 30);
      const high90d  = rangeMax(highsArr, 90);
      const high180d = rangeMax(highsArr, 180);

      const algoLines = computeAlgoLinesV7(candles, price);
      const haTrend = getHATrend(candles.slice(-6));
      const swingLevels = findPriorSwingLevels(candles, 5);
      const atr20 = computeATR(candles, 20);

      const high52Idx = findHighIdx(candles, meta.fiftyTwoWeekHigh);
      const low52Idx = findLowIdx(candles, meta.fiftyTwoWeekLow);
      const recentGapIdx = findRecentGapIdx(candles, 5);
      const breakoutPivot = findBreakoutPivot(algoLines);

      let breakoutIdx = null;
      if (breakoutPivot) {
        const startCheck = Math.max(0, candles.length - 6);
        for (let i = startCheck; i < candles.length - 1; i++) {
          if (candles[i].c < breakoutPivot.level && candles[i+1].c > breakoutPivot.level) { breakoutIdx = i + 1; break; }
        }
      }

      const anchoredVWAPs = {
        from52wHigh: high52Idx >= 0 ? computeAnchoredVWAP(candles, high52Idx) : null,
        from52wLow: low52Idx >= 0 ? computeAnchoredVWAP(candles, low52Idx) : null,
        fromRecentGap: recentGapIdx ? computeAnchoredVWAP(candles, recentGapIdx) : null,
        fromBreakout: breakoutIdx ? computeAnchoredVWAP(candles, breakoutIdx) : null,
        anchors: {
          '52wHigh': high52Idx >= 0 ? fmtDate(candles[high52Idx].t) : null,
          '52wLow': low52Idx >= 0 ? fmtDate(candles[low52Idx].t) : null,
          'recentGap': recentGapIdx ? fmtDate(candles[recentGapIdx].t) : null,
          'breakout': breakoutIdx ? fmtDate(candles[breakoutIdx].t) : null,
        },
      };

      let atrTargets = null;
      if (atr20 && breakoutPivot) {
        atrTargets = {
          anchor: 'breakout-pivot', anchorLevel: breakoutPivot.level,
          anchorStyle: breakoutPivot.style, anchorTouches: breakoutPivot.touches,
          T1: parseFloat((breakoutPivot.level + 1 * atr20).toFixed(2)),
          T2: parseFloat((breakoutPivot.level + 2 * atr20).toFixed(2)),
        };
      } else if (atr20 && (price >= (meta.fiftyTwoWeekHigh || 0) * 0.97)) {
        atrTargets = {
          anchor: 'current-price (ATH territory)',
          anchorLevel: parseFloat(price.toFixed(2)),
          T1: parseFloat((price + 1 * atr20).toFixed(2)),
          T2: parseFloat((price + 2 * atr20).toFixed(2)),
        };
      }

      return {
        ticker, price: parseFloat(price.toFixed(2)),
        changePct: prevDayClose ? parseFloat(((price - prevDayClose) / prevDayClose * 100).toFixed(2)) : 0,
        overnightGapPct,
        dayHigh: parseFloat((meta.regularMarketDayHigh || 0).toFixed(2)),
        dayLow: parseFloat((meta.regularMarketDayLow || 0).toFixed(2)),
        volume: meta.regularMarketVolume || 0,
        sma20: s20, sma50: s50, sma100: s100, sma200: s200,
        aboveSma20: price > s20, aboveSma50: price > s50,
        aboveSma100: price > s100, aboveSma200: price > s200,
        d1_long_valid, d1_short_valid,
        nearestOverhead: overheadSMAs[0] || null,
        algoLines, haTrend, atr20, atrTargets, anchoredVWAPs,
        priorSwingHighs: swingLevels.priorSwingHighs,
        priorSwingLows: swingLevels.priorSwingLows,
        closes_last5: closes.slice(-5).map(x => parseFloat(x.toFixed(2))),
        fiftyTwoWeekHigh: parseFloat((meta.fiftyTwoWeekHigh || 0).toFixed(2)),
        fiftyTwoWeekLow: parseFloat((meta.fiftyTwoWeekLow || 0).toFixed(2)),
        low30d, low90d, low180d, high30d, high90d, high180d,
        nearATH: price >= (meta.fiftyTwoWeekHigh || 0) * 0.97,
        nearATL: price <= (meta.fiftyTwoWeekLow || 0) * 1.03,
        maxRecentGap,
      };
    } catch(e) { return { ticker, error: e.message || 'fetch failed' }; }
  }

  async function fetchM5(ticker) {
    try {
      const d = await fetchJSON(M5_URL(ticker));
      const res = d.chart?.result?.[0];
      if (!res) return { ticker, error: 'no M5 data' };
      const meta = res.meta, q = res.indicators.quote[0], ts = res.timestamp || [];
      const regularStart = res.meta?.currentTradingPeriod?.regular?.start || (() => {
        const now = new Date();
        const y = now.getUTCFullYear(), mo = now.getUTCMonth(), dd = now.getUTCDate();
        const isEDT = mo >= 2 && mo <= 9;
        return Math.floor(new Date(Date.UTC(y, mo, dd, isEDT ? 13 : 14, 30, 0)) / 1000);
      })();
      const regularEnd = res.meta?.currentTradingPeriod?.regular?.end || (() => {
        const now = new Date();
        const y = now.getUTCFullYear(), mo = now.getUTCMonth(), dd = now.getUTCDate();
        const isEDT = mo >= 2 && mo <= 9;
        return Math.floor(new Date(Date.UTC(y, mo, dd, isEDT ? 20 : 21, 0, 0)) / 1000);
      })();
      const nowTs = Math.floor(Date.now() / 1000);
      const isRegularSession = nowTs >= regularStart && nowTs < regularEnd;
      const marketState = isRegularSession ? 'REGULAR' : (nowTs < regularStart ? 'PRE' : 'POST');

      const sessionCloses = [], sessionVolumes = [], sessionOpens = [];
      let cumTPV = 0, cumVol = 0;
      ts.forEach((t, i) => {
        if (t < regularStart) return;
        const h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i], o = q.open?.[i];
        if (c != null) sessionCloses.push(c);
        if (v != null) sessionVolumes.push(v);
        if (o != null) sessionOpens.push(o);
        if (h && l && c && v) { cumTPV += ((h + l + c) / 3) * v; cumVol += v; }
      });

      const vwap = cumVol > 0 ? parseFloat((cumTPV / cumVol).toFixed(2)) : null;
      const m5sma = (n) => {
        const s = sessionCloses.slice(-n);
        return s.length >= n ? parseFloat((s.reduce((a, b) => a + b, 0) / n).toFixed(2)) : null;
      };
      const price = meta.regularMarketPrice;
      const sma8 = m5sma(8), sma20 = m5sma(20);
      const rVol = sessionVolumes.slice(-4).reduce((a, b) => a + b, 0);
      const pVol = sessionVolumes.slice(-8, -4).reduce((a, b) => a + b, 0);
      const volTrend = rVol > pVol ? 'RISING' : 'FALLING';
      let greenStreak = 0;
      for (let i = sessionCloses.length - 1; i >= 0; i--) {
        if (sessionCloses[i] > (sessionOpens[i] || 0)) greenStreak++;
        else break;
      }
      const aboveVwap = vwap != null ? price > vwap : null;
      const aboveSma20 = sma20 != null ? price > sma20 : null;

      return {
        ticker, price: price?.toFixed(2),
        vwap: vwap?.toFixed(2) ?? null, aboveVwap,
        sma8_m5: sma8?.toFixed(2) ?? null,
        sma20_m5: sma20?.toFixed(2) ?? null,
        aboveSma8_m5: sma8 != null ? price > sma8 : null,
        aboveSma20_m5: aboveSma20,
        m5_long_valid: aboveVwap === true && aboveSma20 === true,
        m5_short_valid: aboveVwap === false && aboveSma20 === false,
        volTrend, greenStreak,
        candleCount: sessionCloses.length,
        marketState, isRegularSession,
      };
    } catch(e) { return { ticker, error: e.message || 'fetch failed' }; }
  }

  async function fetchSectorBias(spyChangePct) {
    const results = await Promise.all(Object.keys(SECTOR_ETFS).map(async (t) => {
      try {
        const d = await fetchJSON(CHART_URL(t, '5d'));
        const meta = d.chart?.result?.[0]?.meta;
        const q = d.chart?.result?.[0]?.indicators?.quote?.[0];
        const closes = (q?.close || []).filter(x => x != null);
        const price = meta?.regularMarketPrice;
        const prevClose = closes.length >= 2 ? closes[closes.length - 2] : null;
        const changePct = prevClose ? parseFloat(((price - prevClose) / prevClose * 100).toFixed(2)) : 0;
        const rsVsSpy = parseFloat((changePct - spyChangePct).toFixed(2));
        return { ticker: t, name: SECTOR_ETFS[t], price: price?.toFixed(2), changePct, rsVsSpy, isRS: rsVsSpy > 0.3, isRW: rsVsSpy < -0.3 };
      } catch (e) { return { ticker: t, name: SECTOR_ETFS[t], error: true }; }
    }));
    const valid = results.filter(r => !r.error).sort((a, b) => b.rsVsSpy - a.rsVsSpy);
    const leading = valid.slice(0, 3), lagging = valid.slice(-3);
    const isUpDay = spyChangePct > 0.3, isDnDay = spyChangePct < -0.3;
    let huntingGrounds;
    if (isUpDay) huntingGrounds = '🟢 UP DAY — LONG focus in: ' + leading.map(s => s.name + ' (' + s.ticker + ' ' + (s.rsVsSpy > 0 ? '+' : '') + s.rsVsSpy + '%)').join(' | ');
    else if (isDnDay) huntingGrounds = '🔴 DOWN DAY — SHORT focus in: ' + lagging.map(s => s.name + ' (' + s.ticker + ' ' + s.rsVsSpy + '%)').join(' | ');
    else huntingGrounds = '⚪ NEUTRAL DAY — Mixed signals, be selective';
    return { all: valid, leading, lagging, huntingGrounds, isUpDay, isDnDay };
  }

  function checkEarnings(earningsDate, maxRecentGap) {
    let futureFlag = '', futureStr = 'Unknown', daysUntil = null;
    let hasUpcoming = false, justReported = false;
    if (earningsDate) {
      const diffDays = Math.ceil((earningsDate.getTime() - Date.now()) / 86400000);
      daysUntil = diffDays;
      futureStr = earningsDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      if (diffDays > 0 && diffDays <= 7)  { futureFlag = '🚨 EARNINGS WITHIN 7 DAYS'; hasUpcoming = true; }
      if (diffDays > 7 && diffDays <= 14)   futureFlag = '⚠️ Earnings in ~2 weeks';
      if (diffDays <= 0 && diffDays >= -3) { futureFlag = '📊 Just reported'; justReported = true; }
    }
    // v7.1.0 — signed gap, direction in flag
    let recentGapFlag = '', likelyPostEarnings = false;
    if (maxRecentGap && Math.abs(maxRecentGap.pct) >= 5) {
      const label = maxRecentGap.daysAgo === 0 ? 'today'
                  : maxRecentGap.daysAgo === 1 ? 'yesterday'
                  : maxRecentGap.daysAgo + ' sessions ago';
      const dir  = maxRecentGap.direction || (maxRecentGap.pct > 0 ? 'UP' : 'DOWN');
      const sign = maxRecentGap.pct > 0 ? '+' : '';
      recentGapFlag = '🔴 GAP ' + dir + ' ' + sign + maxRecentGap.pct + '% overnight gap ' + label
                    + ' (' + maxRecentGap.date + ') — Step 4D rules apply: half size, day trade only.';
      likelyPostEarnings = true;
    }
    return { hasUpcoming, justReported, futureStr, daysUntil, futureFlag, recentGapFlag, likelyPostEarnings, displayStr: futureStr, anyFlag: futureFlag || recentGapFlag };
  }

  async function getCrumb() {
    try {
      const r = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { credentials: 'include' });
      if (r.ok) return (await r.text()).trim();
    } catch (e) {}
    return null;
  }

  async function fetchEarningsDates(tickers) {
    const map = {};
    let crumb = null;
    try { crumb = await getCrumb(); } catch (e) {}
    if (crumb) {
      await Promise.all(tickers.map(async (sym) => {
        try {
          const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=calendarEvents&crumb=${encodeURIComponent(crumb)}`;
          const data = await fetchJSON(url);
          const earnDate = data?.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate?.[0]?.raw;
          if (earnDate) map[sym] = new Date(earnDate * 1000);
        } catch (e) {}
      }));
      if (Object.keys(map).length > 0) return map;
    }
    const chunkSize = 20;
    for (let i = 0; i < tickers.length; i += chunkSize) {
      const chunk = tickers.slice(i, i + chunkSize);
      try {
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${chunk.join(',')}`;
        const data = await fetchJSON(url);
        (data?.quoteResponse?.result || []).forEach(q => {
          if (q.symbol && q.earningsTimestampStart && !map[q.symbol]) {
            map[q.symbol] = new Date(q.earningsTimestampStart * 1000);
          }
        });
      } catch (e) {}
    }
    return map;
  }

  function scoreStock(d1, m5, spyChangePct, earningsInfo) {
    const rsScore = parseFloat((d1.changePct - spyChangePct).toFixed(2));
    const hasRS = rsScore > 0.5, hasRW = rsScore < -0.5;
    const nearAlgoLines = (d1.algoLines || []).filter(l => l.nearCurrent);
    const brokenAlgoLines = (d1.algoLines || []).filter(l => l.recentlyBroken);

    let direction = 'NEUTRAL', setupType = 'NONE', confluences = [];

    if (d1.d1_long_valid && hasRS) {
      direction = 'LONG'; setupType = 'RS_RW_TRADE';
      confluences.push('D1 above all SMAs (20/50/100/200) ✅');
      confluences.push('RS +' + rsScore + '% vs SPY ✅');
      if (m5?.m5_long_valid) confluences.push('M5 above VWAP + SMA20 ✅');
      if (d1.nearATH) confluences.push('Near 52-wk high — clear air above ✅');
      if (m5?.volTrend === 'RISING') confluences.push('M5 volume rising ✅');
      if (m5?.greenStreak >= 3) confluences.push(m5.greenStreak + ' consecutive green M5 candles ✅');
      if (d1.haTrend === 'BULLISH') confluences.push('D1 HA bullish continuation ✅');
      brokenAlgoLines.forEach(l => {
        if (l.style === 'DESCENDING' && l.breakDirection === 'BROKE_ABOVE')
          confluences.push('🔥 BROKE ABOVE descending resistance $' + l.level + ' (' + l.touches + ' touches) ✅');
        if (l.style === 'HORIZONTAL' && l.breakDirection === 'BROKE_ABOVE') {
          const tag = l.label === 'KEY' ? '🔥🔥 KEY ' : l.label === 'MAJOR' ? '🔥 MAJOR ' : '';
          confluences.push(tag + 'BROKE ABOVE horizontal resistance $' + l.level + ' (' + l.touches + ' touches) ✅');
        }
      });
    } else if (d1.d1_short_valid && hasRW) {
      direction = 'SHORT'; setupType = 'RS_RW_TRADE';
      confluences.push('D1 below SMA20 + SMA50 ✅');
      confluences.push('RW ' + rsScore + '% vs SPY ✅');
      if (m5?.m5_short_valid) confluences.push('M5 below VWAP + SMA20 ✅');
      if (d1.haTrend === 'BEARISH') confluences.push('D1 HA bearish continuation ✅');
      brokenAlgoLines.forEach(l => {
        if (l.style === 'ASCENDING' && l.breakDirection === 'BROKE_BELOW')
          confluences.push('🔥 BROKE BELOW ascending support $' + l.level + ' (' + l.touches + ' touches) ✅');
        if (l.style === 'HORIZONTAL' && l.breakDirection === 'BROKE_BELOW') {
          const tag = l.label === 'KEY' ? '🔥🔥 KEY ' : l.label === 'MAJOR' ? '🔥 MAJOR ' : '';
          confluences.push(tag + 'BROKE BELOW horizontal support $' + l.level + ' (' + l.touches + ' touches) ✅');
        }
      });
    } else if (d1.d1_long_valid && hasRS && m5 && !m5.m5_long_valid) {
      direction = 'LONG'; setupType = 'WAIT_VWAP_RECLAIM';
      confluences.push('D1 above all SMAs ✅');
      confluences.push('RS +' + rsScore + '% vs SPY ✅');
      confluences.push('⏳ M5 below VWAP $' + m5.vwap + ' — waiting for reclaim');
    }

    const cleanCount = confluences.filter(c => c.includes('✅')).length;
    let conviction = cleanCount >= 5 ? 'HIGH' : cleanCount >= 3 ? 'MEDIUM' : 'LOW';
    // v7.1.0 — also downgrade for justReported (daysUntil ∈ [-3, 0]).
    if (earningsInfo.hasUpcoming) {
      if (conviction === 'HIGH')   conviction = 'MEDIUM';
      if (conviction === 'MEDIUM') conviction = 'LOW';
      conviction += ' ⚠️ EARNINGS';
    }
    if (earningsInfo.justReported) {
      if (conviction === 'HIGH')   conviction = 'MEDIUM';
      if (conviction === 'MEDIUM') conviction = 'LOW';
      conviction += ' 📊 JUST-REPORTED';
    }
    if (earningsInfo.likelyPostEarnings) {
      if (conviction === 'HIGH') conviction = 'MEDIUM';
      conviction += ' 🔴 POST-GAP';
    }

    // v7.1.0 — counter-trend penalty applies even at small SPY moves when individual RS is huge
    const counterTrend = (direction === 'SHORT' && spyChangePct > 0) || (direction === 'LONG' && spyChangePct < 0);
    const hugeIndividualMove = Math.abs(rsScore) >= 5;
    const counterTrendStrength = counterTrend
      ? (Math.abs(spyChangePct) >= 0.5 ? 'STRONG'
       : hugeIndividualMove ? 'MILD-RS-OVERRIDE'
       : 'MILD')
      : null;

    const rrEntry = m5?.vwap ? parseFloat(m5.vwap) : d1.price;
    let rrStop, rrT1, rrT2, rrRatio, rrStopNote, rrT1Source;
    const algoAbove = (d1.algoLines || []).filter(l => l.above).sort((a, b) => a.level - b.level);
    const algoBelow = (d1.algoLines || []).filter(l => !l.above).sort((a, b) => b.level - a.level);

    if (direction === 'LONG' || setupType === 'WAIT_VWAP_RECLAIM') {
      rrStop = d1.dayLow; rrStopNote = 'day low';
      const risk = rrEntry > rrStop ? rrEntry - rrStop : null;
      if (d1.atrTargets) {
        rrT1 = d1.atrTargets.T1; rrT2 = d1.atrTargets.T2;
        rrT1Source = d1.atrTargets.anchor === 'breakout-pivot'
          ? 'breakout pivot $' + d1.atrTargets.anchorLevel + ' + 1×ATR(' + d1.atr20 + ')'
          : 'price + 1×ATR(' + d1.atr20 + ') (ATH territory)';
      } else if (algoAbove.length > 0) {
        rrT1 = algoAbove[0].level;
        rrT2 = algoAbove.length > 1 ? algoAbove[1].level : null;
        rrT1Source = 'nearest algo resistance';
      }
      if (rrT1 && rrStop && risk) {
        const reward = rrT1 - rrEntry;
        rrRatio = reward > 0 ? parseFloat((reward / risk).toFixed(1)) : null;
      }
    } else if (direction === 'SHORT') {
      const brokenAbove = (d1.algoLines || []).filter(l =>
        l.above && l.recentlyBroken && l.breakDirection === 'BROKE_BELOW' && l.level < rrEntry * 1.15
      ).sort((a, b) => a.level - b.level);
      if (brokenAbove.length > 0) {
        rrStop = parseFloat((brokenAbove[0].level * 1.005).toFixed(2));
        rrStopNote = 'above broken support $' + brokenAbove[0].level;
      } else if (algoAbove.length > 0 && algoAbove[0].level < rrEntry * 1.10) {
        rrStop = parseFloat((algoAbove[0].level * 1.005).toFixed(2));
        rrStopNote = 'above nearest resistance $' + algoAbove[0].level;
      } else {
        rrStop = d1.dayHigh; rrStopNote = 'day high (wide stop)';
      }
      if (algoBelow.length > 0) {
        rrT1 = algoBelow[0].level; rrT2 = algoBelow.length > 1 ? algoBelow[1].level : null;
        rrT1Source = 'algo support';
      } else if (d1.atr20) {
        rrT1 = parseFloat((rrEntry - 1 * d1.atr20).toFixed(2));
        rrT2 = parseFloat((rrEntry - 2 * d1.atr20).toFixed(2));
        rrT1Source = 'entry - 1×ATR(' + d1.atr20 + ')';
      }
      if (rrT1 && rrStop && rrEntry < rrStop) {
        const risk = rrStop - rrEntry, reward = rrEntry - rrT1;
        rrRatio = reward > 0 && risk > 0 ? parseFloat((reward / risk).toFixed(1)) : null;
      }
    }

    const poorRR = rrRatio != null && rrRatio < 1.5;
    const haMult = d1.haTrend === 'BULLISH' || d1.haTrend === 'BEARISH' ? 1.3 : 0.9;
    let horizWeightBonus = 0;
    brokenAlgoLines.forEach(l => { if (l.style === 'HORIZONTAL') horizWeightBonus += (l.weight || 1) - 1; });
    const rrScoreCap = rrRatio != null ? Math.min(rrRatio, 4) : 1.0;
    const ctPenalty = counterTrend
      ? (counterTrendStrength === 'STRONG'           ? 0.4
       : counterTrendStrength === 'MILD-RS-OVERRIDE' ? 0.85
       :                                                0.7)
      : 1.0;
    // v7.1.0 — explicit downgrade for justReported (treat like upcoming for scoring purposes)
    const earningsPen = (earningsInfo.hasUpcoming || earningsInfo.justReported) ? 0.1
                      : earningsInfo.likelyPostEarnings                          ? 0.75
                      :                                                            1.0;
    const compositeScore = parseFloat(
      ((cleanCount + horizWeightBonus) * rrScoreCap * haMult * ctPenalty * earningsPen).toFixed(2)
    );

    // v7.1.0 — bucket classification + swing-candidate filter
    const swingEligible = !earningsInfo.hasUpcoming
                       && !earningsInfo.justReported
                       && !earningsInfo.likelyPostEarnings
                       && !counterTrend;
    const swingNote = !swingEligible
      ? (earningsInfo.hasUpcoming      ? 'No swing — earnings within 7 days'
       : earningsInfo.justReported     ? 'No swing — just reported earnings'
       : earningsInfo.likelyPostEarnings ? 'No swing — post-earnings gap'
       : 'No swing — counter-trend')
      : 'Swing eligible';

    const swingCandidate = swingEligible
                        && rrRatio != null && rrRatio >= 2
                        && Math.abs(rsScore) >= 1
                        && (direction === 'LONG' || direction === 'SHORT');

    let bucket;
    if (direction === 'NEUTRAL')                                                                       bucket = 'NEUTRAL';
    else if (counterTrend)                                                                              bucket = 'COUNTER_TREND';
    else if (earningsInfo.hasUpcoming || earningsInfo.justReported || earningsInfo.likelyPostEarnings) bucket = 'EARNINGS_REACTOR';
    else if (setupType === 'WAIT_VWAP_RECLAIM')                                                         bucket = 'WAIT';
    else                                                                                                bucket = swingCandidate ? 'CLEAN_SWING' : 'CLEAN_DAY';

    let entryNote = 'No clear setup';
    if (m5 && m5.vwap) {
      const sma20part = m5.sma20_m5 ? ' or M5 SMA20 $' + m5.sma20_m5 : '';
      if (direction === 'LONG' || setupType === 'WAIT_VWAP_RECLAIM') {
        entryNote = m5.aboveVwap
          ? 'Above VWAP $' + m5.vwap + ' ✅ — buy pullback to VWAP' + sma20part
          : 'Below VWAP $' + m5.vwap + ' — WAIT for reclaim';
      } else if (direction === 'SHORT') {
        entryNote = !m5.aboveVwap
          ? 'Below VWAP $' + m5.vwap + ' ✅ — short bounces to VWAP' + sma20part
          : 'Above VWAP $' + m5.vwap + ' — WAIT for rejection';
      }
    }

    const stopNote = (direction === 'LONG' || setupType === 'WAIT_VWAP_RECLAIM')
      ? 'Below $' + (d1.dayLow || m5?.vwap)
      : direction === 'SHORT' ? 'Above $' + rrStop + ' (' + (rrStopNote || 'day high') + ')' : null;

    return {
      direction, setupType, rsScore, hasRS, hasRW,
      confluences, conviction, counterTrend, counterTrendStrength,
      rrEntry, rrStop, rrStopNote, rrT1, rrT1Source, rrT2, rrRatio, poorRR,
      compositeScore, swingEligible, swingCandidate, swingNote,
      bucket, entryNote, stopNote,
      brokenAlgoLines,
    };
  }

  async function fetchVIX() {
    try {
      const d = await fetchJSON(CHART_URL('^VIX', '5d'));
      const meta = d.chart?.result?.[0]?.meta;
      const q = d.chart?.result?.[0]?.indicators?.quote?.[0];
      const closes = (q?.close || []).filter(x => x != null);
      const price = meta?.regularMarketPrice;
      const prev = closes.length >= 2 ? closes[closes.length - 2] : null;
      const changePct = prev ? parseFloat(((price - prev) / prev * 100).toFixed(2)) : 0;
      const regime = price >= 30 ? '🔴 HIGH (>30)' : price >= 25 ? '🟠 ELEVATED (25-30)' : price >= 20 ? '🟡 MODERATE (20-25)' : '🟢 LOW (<20)';
      return { price: parseFloat(price.toFixed(2)), changePct, regime };
    } catch (e) { return { error: true }; }
  }

  async function run(extras) {
    const etCtx = getETContext();
    console.log('[RDT ' + VERSION + '] Auto-scanning at', etCtx.etStr, etCtx.phase);
    let spyChangePct = 0;
    try {
      const spyQ = await fetchJSON('https://query1.finance.yahoo.com/v7/finance/quote?symbols=SPY&fields=regularMarketChangePercent');
      spyChangePct = spyQ?.quoteResponse?.result?.[0]?.regularMarketChangePercent || 0;
    } catch(e) {}
    const candidates = await getCandidates(spyChangePct);
    const symbols = candidates.map(c => c.symbol);
    const combined = [...new Set([...symbols, ...MAG7, ...SEMI_WATCHLIST, ...USER_WATCHLIST, ...(extras || [])])];
    console.log('[RDT ' + VERSION + '] Tickers (' + combined.length + '):', combined.join(', '));
    return analyze(combined, candidates, spyChangePct);
  }

  async function analyze(tickers, candidates, spyChangePctIn) {
    const etCtx = getETContext();

    // v7.1.0 — fetch SPY D1 first to get the canonical change-percent.
    // The /v7/finance/quote endpoint sometimes returns 0 (caching/timing flakes);
    // spyD1.changePct is computed from prevDayClose → current price and is always accurate.
    const [spyD1, spyM5] = await Promise.all([fetchD1('SPY'), fetchM5('SPY')]);
    const spyChangePct = (spyD1 && !spyD1.error && typeof spyD1.changePct === 'number')
      ? spyD1.changePct
      : (spyChangePctIn ?? 0);

    const earningsMap = await fetchEarningsDates(tickers);

    const [sectorBias, vix, ...tickerData] = await Promise.all([
      fetchSectorBias(spyChangePct),
      fetchVIX(),
      ...tickers.map(async t => {
        const [d1, m5] = await Promise.all([fetchD1(t), fetchM5(t)]);
        const cand = (candidates || []).find(c => c.symbol === t);
        const earningsDate = earningsMap[t] || cand?.earningsDate || null;
        const earningsInfo = checkEarnings(earningsDate, d1.maxRecentGap);
        const score = (d1.error || m5.error) ? null : scoreStock(d1, m5, spyChangePct, earningsInfo);
        return { ticker: t, d1, m5, earningsInfo, score };
      })
    ]);

    window._scan = {
      version: VERSION, etCtx,
      spyChg: spyChangePct,
      spyD1, spyM5,
      sectors: sectorBias, vix,
      tickers: tickerData,
      candidates: candidates || [],
    };
    return window._scan;
  }

  function summary() {
    const s = window._scan;
    if (!s) return 'No scan data — call window.RDT.run() first.';
    const lines = [];
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('  Day Trading Scanner ' + VERSION + ' — ' + s.etCtx.etStr + ' ET (' + s.etCtx.phase + ')');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const sd1 = s.spyD1, sm5 = s.spyM5;
    if (!sd1.error) {
      lines.push('');
      lines.push('▶ SPY $' + sd1.price + ' (' + (sd1.changePct >= 0 ? '+' : '') + sd1.changePct + '%)');
      lines.push('  HOD/LOD: $' + sd1.dayHigh + ' / $' + sd1.dayLow);
      lines.push('  SMA20=$' + sd1.sma20 + ' | SMA50=$' + sd1.sma50 + ' | SMA100=$' + sd1.sma100 + ' | SMA200=$' + sd1.sma200);
      lines.push('  D1 Long: ' + (sd1.d1_long_valid ? '✅' : '⛔') + ' | HA: ' + sd1.haTrend + ' | ATR(20): $' + sd1.atr20);
      if (sm5 && !sm5.error) lines.push('  M5: VWAP $' + sm5.vwap + ' | ' + getM5TrendState(sm5));
    }
    if (s.vix && !s.vix.error) {
      lines.push('');
      lines.push('▶ VIX $' + s.vix.price + ' — ' + s.vix.regime);
    }
    if (s.sectors) {
      lines.push('');
      lines.push('▶ ' + s.sectors.huntingGrounds);
    }
    // v7.1.0 — Mag 7 as a markdown table
    const m7 = MAG7.map(t => s.tickers.find(x => x.ticker === t)).filter(Boolean);
    const aboveVwap = m7.filter(t => t.m5?.aboveVwap === true).length;
    const d1Long    = m7.filter(t => t.d1?.d1_long_valid).length;
    const haBull    = m7.filter(t => t.d1?.haTrend === 'BULLISH').length;
    lines.push('');
    lines.push('▶ MAG 7 BREADTH: Above VWAP ' + aboveVwap + '/7 | D1 Long ' + d1Long + '/7 | HA Bullish ' + haBull + '/7');
    lines.push('');
    lines.push('| Ticker | Price | %Chg | RS | D1 Long | VWAP | HA | Earnings | Gap |');
    lines.push('|--------|-------|------|----|---------|------|----|----------|-----|');
    m7.forEach(t => {
      if (!t.d1 || t.d1.error) { lines.push('| ' + t.ticker + ' | (data error) | | | | | | | |'); return; }
      const ch  = (t.d1.changePct >= 0 ? '+' : '') + t.d1.changePct + '%';
      const rs  = (t.score?.rsScore != null ? (t.score.rsScore >= 0 ? '+' : '') + t.score.rsScore + '%' : '—');
      const d1L = t.d1.d1_long_valid ? '✅' : '⛔';
      const v   = t.m5?.aboveVwap === true ? '✅ ' + (t.m5.vwap || '') : (t.m5?.aboveVwap === false ? '⛔ ' + (t.m5.vwap || '') : '—');
      const earn = (t.earningsInfo?.displayStr || '—') + (t.earningsInfo?.justReported ? ' 📊' : t.earningsInfo?.hasUpcoming ? ' 🚨' : '');
      const gapTxt = t.d1.maxRecentGap && Math.abs(t.d1.maxRecentGap.pct) >= 5
        ? (t.d1.maxRecentGap.direction === 'UP' ? '+' : '') + t.d1.maxRecentGap.pct + '% ' + t.d1.maxRecentGap.date
        : '—';
      lines.push('| ' + t.ticker + ' | $' + t.d1.price + ' | ' + ch + ' | ' + rs + ' | ' + d1L + ' | ' + v + ' | ' + t.d1.haTrend + ' | ' + earn + ' | ' + gapTxt + ' |');
    });

    // v7.1.0 — bucket-aware ranking
    const scored = s.tickers.filter(t => t.score && t.score.direction !== 'NEUTRAL');
    const cleanSwings = scored.filter(t => t.score.bucket === 'CLEAN_SWING').sort((a,b) => b.score.compositeScore - a.score.compositeScore);
    const cleanDays   = scored.filter(t => t.score.bucket === 'CLEAN_DAY').sort((a,b) => b.score.compositeScore - a.score.compositeScore);
    const earningsR   = scored.filter(t => t.score.bucket === 'EARNINGS_REACTOR').sort((a,b) => b.score.compositeScore - a.score.compositeScore);
    const counterT    = scored.filter(t => t.score.bucket === 'COUNTER_TREND').sort((a,b) => b.score.compositeScore - a.score.compositeScore);
    const waits       = scored.filter(t => t.score.bucket === 'WAIT').sort((a,b) => b.score.compositeScore - a.score.compositeScore);

    function renderSetup(t, i) {
      const sc = t.score, d1 = t.d1, m5 = t.m5;
      lines.push('');
      lines.push('  #' + (i+1) + ' ' + t.ticker + ' — ' + sc.direction + ' | ' + sc.conviction + ' | Score ' + sc.compositeScore + ' | Bucket ' + sc.bucket);
      lines.push('     Price $' + d1.price + ' (' + (d1.changePct >= 0 ? '+' : '') + d1.changePct + '%) | RS ' + sc.rsScore + '%');
      lines.push('     M5 VWAP $' + (m5?.vwap || 'n/a') + ' ' + (m5?.aboveVwap === true ? '✅' : m5?.aboveVwap === false ? '⛔' : ''));
      lines.push('     HA ' + d1.haTrend + ' | ATR(20) $' + d1.atr20);
      const earnTxt = t.earningsInfo.displayStr + (t.earningsInfo.anyFlag ? ' — ' + t.earningsInfo.anyFlag : '');
      lines.push('     Earnings: ' + earnTxt);
      // v7.1.0 — explicit gap direction
      if (d1.maxRecentGap && Math.abs(d1.maxRecentGap.pct) >= 5) {
        lines.push('     Gap ' + d1.maxRecentGap.direction + ' ' + (d1.maxRecentGap.pct > 0 ? '+' : '') + d1.maxRecentGap.pct + '% (' + d1.maxRecentGap.date + ')');
      }
      lines.push('     Confluences (' + sc.confluences.length + '):');
      sc.confluences.forEach(c => lines.push('       • ' + c));

      // v7.1.0 — distinct labels for 52w prices vs aVWAPs from those dates
      lines.push('     Range — 52w: $' + d1.fiftyTwoWeekLow + ' – $' + d1.fiftyTwoWeekHigh
                + ' | 180d: $' + d1.low180d + ' – $' + d1.high180d
                + ' | 90d: $' + d1.low90d + ' – $' + d1.high90d
                + ' | 30d: $' + d1.low30d + ' – $' + d1.high30d);
      if (d1.priorSwingHighs?.length) lines.push('     Prior swing highs: ' + d1.priorSwingHighs.slice(0,3).map(p => '$' + p.price + ' (' + p.daysAgo + 'd)').join(', '));
      if (d1.priorSwingLows?.length)  lines.push('     Prior swing lows:  ' + d1.priorSwingLows .slice(0,3).map(p => '$' + p.price + ' (' + p.daysAgo + 'd)').join(', '));

      if (d1.algoLines?.length) {
        d1.algoLines.slice(0, 4).forEach(l => {
          const tag = l.label && l.label !== 'SLOPED' ? ' [' + l.label + ']' : '';
          const r2  = l.slopeQuality != null && l.slopeQuality < 1 ? ' R²=' + l.slopeQuality : '';
          const brk = l.recentlyBroken ? ' ← ' + l.breakDirection : '';
          lines.push('     ALGO: ' + l.style + ' ' + l.type + ' $' + l.level + ' (' + l.touches + 't' + r2 + ')' + tag + brk);
        });
      }
      if (d1.anchoredVWAPs) {
        const av = d1.anchoredVWAPs;
        if (av.from52wHigh)   lines.push('     aVWAP from 52w-HIGH date (' + av.anchors['52wHigh']  + '): $' + av.from52wHigh);
        if (av.from52wLow)    lines.push('     aVWAP from 52w-LOW  date (' + av.anchors['52wLow']   + '): $' + av.from52wLow);
        if (av.fromRecentGap) lines.push('     aVWAP from RECENT-GAP    (' + av.anchors.recentGap   + '): $' + av.fromRecentGap);
        if (av.fromBreakout)  lines.push('     aVWAP from BREAKOUT      (' + av.anchors.breakout    + '): $' + av.fromBreakout);
      }
      lines.push('     Entry: ' + sc.entryNote);
      lines.push('     Stop:  ' + sc.stopNote);
      if (sc.rrT1) {
        lines.push('     T1 $' + sc.rrT1 + ' (' + sc.rrT1Source + ')' + (sc.rrT2 ? ' | T2 $' + sc.rrT2 : '') + ' | R:R ' + sc.rrRatio + ':1' + (sc.poorRR ? ' ⚠️ POOR' : ''));
      }
      lines.push('     Swing: ' + sc.swingNote);
    }

    // v7.1.0 — clean swings ranked first; earnings reactors capped at 5; rest follow
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('▶ CLEAN SWING CANDIDATES (no earnings ±14d, no recent gap, RS sustained, R:R ≥ 2)');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (cleanSwings.length === 0) lines.push('  (none today — earnings week dominates the tape)');
    else cleanSwings.slice(0, 6).forEach(renderSetup);

    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('▶ CLEAN DAY-TRADE CANDIDATES (no earnings, R:R < 2 or weaker structure)');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (cleanDays.length === 0) lines.push('  (none)');
    else cleanDays.slice(0, 4).forEach(renderSetup);

    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('▶ EARNINGS REACTORS (post-earnings or just-reported — half size, day trade only)');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    earningsR.slice(0, 5).forEach(renderSetup);

    if (waits.length > 0) {
      lines.push('');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('▶ WAIT (price below VWAP — conditional on reclaim)');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      waits.slice(0, 3).forEach(renderSetup);
    }

    if (counterT.length > 0) {
      lines.push('');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('▶ COUNTER-TREND WATCHLIST (only valid IF SPY breaks direction)');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      counterT.slice(0, 5).forEach(renderSetup);
    }

    return lines.join('\n');
  }

  return {
    VERSION, run, analyze, summary,
    fetchD1, fetchM5, fetchVIX, fetchSectorBias,
    computeAlgoLinesV7, findPriorSwingLevels, computeATR, computeAnchoredVWAP,
    getETContext, getHODProximity, getM5TrendState,
  };
})();

console.log('[RDT ' + window.RDT.VERSION + '] ✅ Loaded');
