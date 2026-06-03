/**
 * Day Trading Scanner v8.1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Hosted at: github.com/mgoodson117/DayTradingScanner
 * CDN:       https://cdn.jsdelivr.net/gh/mgoodson117/DayTradingScanner@main/market_data.js
 *
 * Inject into a Yahoo Finance tab via javascript_tool, then call:
 *   window.RDT.run()                 → full auto-scan (gainers + losers + actives + Mag7 + watchlists + earnings)
 *   window.RDT.analyze([...tickers]) → analyze a specific list
 *   window.RDT.summary()             → formatted output after either call
 *
 * v8.0.0 CHANGES vs v7.3.0 — PHASE 1 PLAYBOOK FIELDS (from the May 12, 2026 trade-rec
 * evaluation that produced +5.22R over 2 weeks via M5 intraday backtest):
 *
 *   1. DAY-TRADE T1 = 0.5×ATR  (was 1×ATR). For tradeType='D' setups, the
 *      synthetic-T1 default is now half the prior distance. Scanner emits BOTH
 *      `t1DaySynthetic` (entry ± 0.5×ATR) and `t1SwingSynthetic` (entry ± 1×ATR)
 *      so the report-generation step picks the correct one per trade type.
 *      Rationale: 40% of day trades ended CHOP on M5 with 1×ATR T1; halving the
 *      target distance flipped 7 of those to T1 wins over 2 weeks.
 *
 *   2. DUAL ENTRY TRIGGER — every setup emits a `breakoutLong` (HOD × 1.0005)
 *      and `breakoutShort` (LOD × 0.9995) level alongside the existing pullback
 *      VWAP entry. Used by the report to render BOTH an Entry-A (pullback,
 *      expires 12 PM ET) and Entry-B (breakout, vol-gated) condition.
 *      Rescued 7 NO_TRIG → T1 over 2 weeks (continuation-move recoveries).
 *
 *   3. CONVICTION PENALTIES — multiplied into compositeScoreV8:
 *      - extensionPenalty = clamp(1.5 − (price − SMA20) / (3 × ATR), 0.3, 1.0)
 *      - hodProximityPenalty = clamp((dayHigh − price) / (0.5 × ATR), 0.3, 1.0)
 *      - stopQualityFactor = (entry − stop) ≥ 0.3×ATR ? 1.0 : 0.5
 *        (v8.1.0: threshold lowered from 1×ATR — prior value penalised every
 *         valid intraday stop since most are 0.3–0.7×ATR)
 *      The original compositeScore is preserved for backward compatibility;
 *      compositeScoreV8 is the new ranking target.
 *
 * v8.3.0 CHANGES (2026-05-16) — QUALITY-BAR FILTERS + REGIME-AWARE SHORTS:
 *   Closes out the May 16 system-review roadmap. Three filters that route
 *   weak setups to watchlists instead of letting them hit the Top section.
 *
 *   I.  EARN_REACTOR QUALITY BAR — earnings-reactor setups must satisfy at
 *       least 2 of 3 quality conditions to keep the EARNINGS_REACTOR bucket
 *       and qualify for the main Top section:
 *         (a) cleanCount ≥ 4
 *         (b) paceRVol ≥ 2.0 (very heavy, not just heavy 1.4)
 *         (c) ≥1 broken algo level with ≥3 touches AND breakVolRatio ≥ 1.5
 *       Unqualified reactors route to WATCHLIST_REACTOR (watch-only).
 *       Directly addresses the 11% win-rate that the bucket ran on May 12-15.
 *
 *   II. SPY MELT-UP REGIME — `fetchD1` now emits `upDaysLast5`. `analyze()`
 *       computes `spyMeltupRegime = SPY above all 4 SMAs AND up ≥3 of last 5`
 *       and threads it into scoreStock via a new `spyContext` parameter.
 *       Mirrors the score_yesterday.py `is_meltup_regime()` test exactly.
 *
 *   III.MELT-UP SHORT RAISE-BAR — when the regime is melt-up AND a SHORT
 *       setup fails the higher bar (cleanCount ≥ 4, ≥6 days below SMA20,
 *       and ≥10% off 52w high), it routes to WATCHLIST_MELTUP_SHORT.
 *       Per the May 16 backtest, 18/30 best shorts worked in melt-up — so
 *       this is a raise-the-bar gate, not a ban.
 *
 *   Two new bucket labels: WATCHLIST_REACTOR, WATCHLIST_MELTUP_SHORT.
 *   Both rendered in summary() as watch-only sections below the Top.
 *   scoreStock signature gains a 6th param `spyContext = { meltupRegime,
 *   upDaysLast5 }`; callers without it get the old behavior.
 *
 * v8.2.0 CHANGES (2026-05-16) — STATIC UNIVERSE + SLOW_BLEED + TREND-AGE:
 *   Driven by the May 16, 2026 60-day backtest, which showed the system's best
 *   short swings (ZTS, TSCO, GEHC, COR, SBAC, CPB, ...) never appeared on the
 *   Yahoo `day_gainers/day_losers` screens — they're slow multi-week
 *   breakdowns, not single-day gappers. Three architectural changes:
 *
 *   I.  STATIC UNIVERSE SCAN — companion file `constituents.js` defines a
 *       ~525-name S&P 500 + Nasdaq 100 universe at `window.RDT_CONSTITUENTS`.
 *       New `fetchD1Universe()` runs a concurrency-limited daily fetch over
 *       the whole universe (with a 4-hour localStorage cache) and a
 *       `prescreenUniverse()` filter returns structurally-aligned candidates
 *       (slow-bleed shorts and clean-trend longs). These are merged into the
 *       existing screener + earnings + watchlist ticker pool inside `run()`.
 *
 *   II. SLOW_BLEED_SHORT bucket — added to scoreStock(). A new bucket for
 *       names below all 4 SMAs, 5–12 consecutive days below SMA20, within
 *       1.5×ATR of SMA20 (not extended), with mild RW (−0.5% to −8% vs SPY).
 *       Catches the backtest's top-30 short signature directly.
 *
 *   III.TREND-AGE MULTIPLIER on compositeScoreV8 — multiplies the score by
 *       1.25 when the setup is in the day-6-to-10 sweet spot of its trend
 *       (per the 500-trade win-rate curve), 1.10 for day 11–15, 0.85 for
 *       day 3–5 ("pause" zone), and 0.75 for day 16+ ("burned out").
 *       fetchD1 now emits `daysAboveSMA20` and `daysBelowSMA20` to enable.
 *
 *   No scanner-side changes for the new SLOW_BLEED bucket are needed in the
 *   brief format — the report generator routes SLOW_BLEED_SHORT names into
 *   the Top section under the existing CLEAN_SWING/CLEAN_DAY format (it's
 *   just a different bucket label for ranking + display).
 *
 *   Constituents file is independent of scanner version; bump
 *   constituents.js LAST_UPDATED on each quarterly rebalance.
 *
 * v8.1.0 CHANGES (2026-05-13):
 *   A. STOP MINIMUM FLOOR — after computing rrStop for both LONG and SHORT,
 *      enforce a minimum distance of 0.3×ATR from rrEntry. Prevents $0.01 stops
 *      (e.g. PYPL 2026-05-12: broken support sat $0.01 above VWAP; stop rendered
 *      as $44.93 against $44.92 entry). When widened, rrRatio is recomputed and
 *      a "[auto-widened: min 0.3×ATR floor]" note is appended to rrStopNote.
 *   B. LONG ENTRY ANCHOR — when M5 VWAP is unavailable (weekend / pre-market)
 *      and d1.anchoredVWAPs.from52wHigh is below current price, use that aVWAP
 *      as rrEntry instead of d1.price. T1/T2 targets are rebased from the aVWAP
 *      anchor so that entry, stop, target, and R:R are all self-consistent from
 *      the trader's perspective. Fixes WDC 2026-05-10: report showed "entry
 *      $471.23" alongside R:R computed from spot $480 — numbers didn't add up.
 *   C. stopQualityFactor threshold: 1×ATR → 0.3×ATR (see (3) above).
 *
 *   4. CLEAN_DAY QUALIFICATION GATES — exposes `cleanDayPaceOk` (paceRVol≥1.4)
 *      and `cleanDayConfluencesOk` (cleanCount≥3) so report-generation can
 *      enforce Phase-1 Rule 4 (catalyst verified + 3 confluences + heavy pace).
 *      Setups failing either gate drop to the Watchlist subsection, not main Top.
 *
 *   5. SPY-AT-HOD/LOD BLOCK — scan output adds `spyHodBlock` and `spyLodBlock`
 *      booleans (true when SPY within 0.20% of HOD/LOD). When set, the report
 *      renders pullback-only entries and replaces "Top" with "Pullback Watchlist."
 *
 *   The scanner JS does NOT enforce these rules at scoring time — it emits the
 *   data and the report-generation step (Claude reading `SKILL_addendum_phase1_v1.md`)
 *   applies them. This preserves full diagnostic data for backtesting.
 *
 * v7.3.0 CHANGES vs v7.2.0 — EARNINGS COVERAGE GUARANTEE:
 *
 *   1. EARNINGS_REACTOR_WATCHLIST — a curated set of high-frequency earnings
 *      gappers (cybersecurity, observability, cloud-data, fintech, semis, AI)
 *      always merged into run()'s ticker list. Closes the May 7, 2026 DDOG-miss
 *      class of bug: a +30.6% earnings-day mover was silently dropped from the
 *      Top 10 because Yahoo's day_gainers screener ran out of slots before
 *      DDOG appeared. With the watchlist, names like DDOG, MDB, SNOW, NOW,
 *      PANW, CRWD, ZS, NET, NFLX, UBER, etc. are guaranteed coverage on every
 *      Mon–Fri auto-run regardless of screener output.
 *
 *   2. fetchEarningsCalendar() — best-effort pull of Yahoo's earnings calendar
 *      for the current ET date. Any equity with a scheduled report today is
 *      force-included in the analyze() list. Falls back silently if the
 *      endpoint is unreachable or returns 0 results — the watchlist (1) is
 *      the durable safety net.
 *
 *   3. run() now merges six sources: screener candidates + MAG7 +
 *      SEMI_WATCHLIST + USER_WATCHLIST + EARNINGS_REACTOR_WATCHLIST +
 *      todayEarningsTickers + extras (caller's seed list).
 *
 * v7.2.0 CHANGES vs v7.1.0 — VOLUME AWARENESS:
 *
 *   1. DAILY RVOL — today's volume vs 20-day average daily volume.
 *      Fields on D1: volume_today, volume_avg20, dailyRVol (e.g. 1.4),
 *      dailyRVolLabel ('HEAVY' / 'NORMAL' / 'LIGHT' / 'VERY LIGHT').
 *
 *   2. PACE RVOL — intraday pace projection. session_volume / (avg_daily ×
 *      session_elapsed_fraction). Computed in scoreStock so it can use both
 *      D1 and M5 data plus the ET-context elapsed-time fraction.
 *      Fields: paceRVol, paceRVolLabel.
 *
 *   3. BREAKOUT-VOLUME CONFIRMATION — for any algo line with
 *      recentlyBroken === true, attach breakIdx + breakVolume + breakVolRatio
 *      (vs avg20). The break confluence is then suffixed with "on N.N×
 *      volume ✅" when ratio ≥ 1.5, "on N.N× volume ⚠️ suspect" when ratio
 *      ≤ 0.7, otherwise plain "on N.N× volume".
 *
 *   4. PRE-MARKET VOLUME — fetchM5 now uses range=5d & includePrePost=true.
 *      Today's pre-market candles (4:00–9:30 ET) are summed into
 *      preMktVolumeToday; the 4 prior days' pre-mkt sums are averaged into
 *      preMktVolumeAvg4. preMktVolRatio + label flag heavy pre-open interest.
 *
 *   5. VOLUME-AT-PRICE FOR ALGO LINES — horizontal level weighting now
 *      considers the avg volume on touch days vs the 90-day avg. A level with
 *      heavy-volume touches (≥1.5×) gets bumped one tier up (MINOR→MAJOR,
 *      MAJOR→KEY); light-volume (≤0.6×) gets bumped one tier down. Original
 *      touch count is preserved on the line as `rawTouches`; final weight
 *      label may differ from raw.
 *
 * v7.1.0 (prior):
 *   - Algo lines strict spec, horizontal weighting, prior swings, anchored
 *     VWAPs, ATR + breakout-pivot projections, bucket-aware ranking.
 */

window.RDT = (function () {

  const VERSION = 'v8.7.0';

  const SECTOR_ETFS = {
    XLK: 'Technology', XLE: 'Energy', XLF: 'Financials', XLV: 'Healthcare',
    XLI: 'Industrials', XLY: 'Consumer Disc', XLP: 'Consumer Staples',
    XLB: 'Materials', XLC: 'Comm Services', XLRE: 'Real Estate', XLU: 'Utilities',
  };

  const MAG7 = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'];
  const SEMI_WATCHLIST = ['AMD', 'QCOM'];
  const USER_WATCHLIST = [];

  // v7.3.0 — Earnings-reactor coverage. These names historically gap >5–30% on
  // earnings prints AND occasionally slip past the day_gainers / day_losers /
  // most_actives screeners (cap floor, count=30 limit, or post-open cache lag
  // — DDOG on 2026-05-07 was the bug that prompted this list). They are always
  // force-fetched in run() so an earnings-day reporter cannot be silently
  // dropped. Curate as needed; bump VERSION when changing.
  const EARNINGS_REACTOR_WATCHLIST = [
    // Cybersecurity (frequent earnings gappers)
    'PANW', 'CRWD', 'ZS', 'FTNT', 'OKTA', 'NET', 'CYBR', 'S',
    // Observability / monitoring (DDOG-tier)
    'DDOG', 'SPLK', 'ESTC', 'DT', 'NEWR', 'PD', 'SUMO',
    // Cloud-data / enterprise-AI
    'MDB', 'SNOW', 'CFLT', 'NOW', 'CRM', 'WDAY', 'TEAM', 'HUBS',
    // Payments / fintech (high earnings vol)
    'SQ', 'PYPL', 'AFRM', 'SOFI', 'HOOD', 'COIN', 'NU',
    // Semis (broader than SEMI_WATCHLIST — ARM/SMCI/ASML often gap)
    'AVGO', 'MU', 'ARM', 'INTC', 'SMCI', 'TXN', 'ASML', 'TSM', 'MRVL', 'WDC', 'ON',
    // Consumer / streaming / sharing earnings movers
    'NFLX', 'UBER', 'LYFT', 'DASH', 'ABNB', 'SHOP', 'ROKU', 'PLTR', 'SPOT',
    // Biotech / pharma frequent gappers
    'LLY', 'NVO', 'MRNA', 'BNTX', 'AXSM', 'VRTX',
  ];

  // v8.2.0 — Static universe (S&P 500 + Nasdaq 100 union, ~525 names) pulled
  // from the companion file `constituents.js`. Loaded BEFORE market_data.js,
  // it sets window.RDT_CONSTITUENTS. Empty array fallback so the scanner still
  // works without the companion file — it just won't run the universe pass.
  const STATIC_UNIVERSE =
    (typeof window !== 'undefined' && window.RDT_CONSTITUENTS && window.RDT_CONSTITUENTS.universe)
      ? window.RDT_CONSTITUENTS.universe
      : [];
  const CONSTITUENTS_VERSION =
    (typeof window !== 'undefined' && window.RDT_CONSTITUENTS && window.RDT_CONSTITUENTS.version)
      ? window.RDT_CONSTITUENTS.version
      : 'NOT_LOADED';

  // v8.2.0 — universe-fetch concurrency + cache settings
  const UNIVERSE_FETCH_CONCURRENCY = 15;
  const UNIVERSE_CACHE_TTL_MS = 4 * 60 * 60 * 1000;  // 4 hours
  const UNIVERSE_MIN_AVG_VOLUME = 1_000_000;          // mirrors the Phase-1 liquidity floor

  const MIN_MKTCAP = 2e9;
  const SCREENER_URL = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&count=30&scrIds=';
  const CHART_URL = (t, range) => `https://query1.finance.yahoo.com/v8/finance/chart/${t}?interval=1d&range=${range}`;
  // v7.2.0 — range=5d so we can also derive prior-4-days pre-market avg in the same call;
  // includePrePost=true so today's pre-market candles are available without a 2nd fetch.
  const M5_URL = (t) => `https://query1.finance.yahoo.com/v8/finance/chart/${t}?interval=5m&range=5d&includePrePost=true`;

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

  // v7.2.0 — average of last `period` candle volumes, excluding today's in-progress candle.
  function computeAvgVolume(candles, period = 20, excludeToday = true) {
    const slice = excludeToday && candles.length > period
      ? candles.slice(-period - 1, -1)
      : candles.slice(-period);
    const vols = slice.map(c => c.v).filter(v => v != null && v > 0);
    if (vols.length === 0) return null;
    return Math.round(vols.reduce((a, b) => a + b, 0) / vols.length);
  }

  // v7.2.0 — classify a volume-ratio (today / avg) into a human label.
  function classifyVolRatio(ratio) {
    if (ratio == null || !isFinite(ratio)) return 'UNKNOWN';
    if (ratio >= 2.0) return 'VERY HEAVY';
    if (ratio >= 1.4) return 'HEAVY';
    if (ratio >= 0.85) return 'NORMAL';
    if (ratio >= 0.6) return 'LIGHT';
    return 'VERY LIGHT';
  }

  // v7.2.0 — emoji decoration for inline volume render.
  function volEmoji(ratio) {
    if (ratio == null || !isFinite(ratio)) return '';
    if (ratio >= 2.0) return '🔥';
    if (ratio >= 1.4) return '✅';
    if (ratio >= 0.85) return '';
    if (ratio >= 0.6) return '⚠️';
    return '⚠️⚠️';
  }

  // v7.2.0 — what fraction of the regular session has elapsed?
  // Returns 0.0 before 9:30 ET, 1.0 after 16:00 ET, fractional in between.
  function sessionElapsedFraction(etCtx) {
    if (!etCtx) return null;
    const open = 9 * 60 + 30;   // 570
    const close = 16 * 60;      // 960
    const sessionMin = close - open; // 390
    if (etCtx.totalMin <= open) return 0;
    if (etCtx.totalMin >= close) return 1;
    return (etCtx.totalMin - open) / sessionMin;
  }

  // v7.2.0 — promote/demote a horizontal level label by one tier based on
  // touch-volume ratio. Keeps weight in lockstep with the displayed label
  // so downstream confluence-bonus math stays consistent.
  function adjustLabelByVolume(rawLabel, rawWeight, volRatio) {
    if (volRatio == null || !isFinite(volRatio)) {
      return { label: rawLabel, weight: rawWeight, volAdjusted: false };
    }
    const tiers = ['MINOR', 'MAJOR', 'KEY'];
    const weights = { MINOR: 1.0, MAJOR: 1.5, KEY: 2.0 };
    const idx = tiers.indexOf(rawLabel);
    if (idx < 0) return { label: rawLabel, weight: rawWeight, volAdjusted: false };
    let newIdx = idx;
    if (volRatio >= 1.5) newIdx = Math.min(2, idx + 1);
    else if (volRatio <= 0.6) newIdx = Math.max(0, idx - 1);
    const newLabel = tiers[newIdx];
    return {
      label: newLabel,
      weight: weights[newLabel],
      volAdjusted: newIdx !== idx,
    };
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

    // v7.2.0 — average volume across the 90-day window (excluding today's
    // in-progress candle). Used for breakout-volume confirmation and for
    // weighting horizontal-level touches by the volume on touch days.
    const volPool = recent.slice(0, -1).map(c => c.v).filter(v => v != null && v > 0);
    const avgVolWindow = volPool.length
      ? volPool.reduce((a, b) => a + b, 0) / volPool.length
      : null;

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

          let recentlyBroken = false, breakDirection = null, breakIdx = null;
          for (let k = Math.max(0, n - 6); k < n - 1; k++) {
            const lineAt = p1.price + slope * (k - p1.idx);
            const lineNext = p1.price + slope * (k + 1 - p1.idx);
            if (recent[k].c < lineAt && recent[k+1].c > lineNext) {
              recentlyBroken = true; breakDirection = 'BROKE_ABOVE'; breakIdx = k + 1;
            }
            if (recent[k].c > lineAt && recent[k+1].c < lineNext) {
              recentlyBroken = true; breakDirection = 'BROKE_BELOW'; breakIdx = k + 1;
            }
          }

          // v7.2.0 — breakout-volume confirmation
          let breakVolume = null, breakVolRatio = null, breakVolLabel = null;
          if (recentlyBroken && breakIdx != null && recent[breakIdx]?.v && avgVolWindow) {
            breakVolume = recent[breakIdx].v;
            breakVolRatio = parseFloat((breakVolume / avgVolWindow).toFixed(2));
            breakVolLabel = classifyVolRatio(breakVolRatio);
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
            recentlyBroken, breakDirection, breakIdx,
            breakVolume, breakVolRatio, breakVolLabel,
            weight: 1.0, label: 'SLOPED',
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
        let recentlyBroken = false, breakDirection = null, breakIdx = null;
        for (let k = Math.max(0, n - 6); k < n - 1; k++) {
          if (recent[k].c < avg && recent[k+1].c > avg) { recentlyBroken = true; breakDirection = 'BROKE_ABOVE'; breakIdx = k + 1; break; }
          if (recent[k].c > avg && recent[k+1].c < avg) { recentlyBroken = true; breakDirection = 'BROKE_BELOW'; breakIdx = k + 1; break; }
        }

        // v7.2.0 — raw weights from touch count
        let rawWeight, rawLabel;
        if (cluster.length >= 4)       { rawWeight = 2.0; rawLabel = 'KEY'; }
        else if (cluster.length === 3) { rawWeight = 1.5; rawLabel = 'MAJOR'; }
        else                            { rawWeight = 1.0; rawLabel = 'MINOR'; }

        // v7.2.0 — average volume on touch days, ratio vs window avg
        const touchVols = cluster.map(p => recent[p.idx]?.v).filter(v => v != null && v > 0);
        const avgTouchVol = touchVols.length
          ? touchVols.reduce((a, b) => a + b, 0) / touchVols.length
          : null;
        const touchVolRatio = (avgTouchVol && avgVolWindow)
          ? parseFloat((avgTouchVol / avgVolWindow).toFixed(2))
          : null;
        const touchVolLabel = classifyVolRatio(touchVolRatio);
        const adjusted = adjustLabelByVolume(rawLabel, rawWeight, touchVolRatio);

        // v7.2.0 — breakout-candle volume on horizontal break
        let breakVolume = null, breakVolRatio = null, breakVolLabel = null;
        if (recentlyBroken && breakIdx != null && recent[breakIdx]?.v && avgVolWindow) {
          breakVolume = recent[breakIdx].v;
          breakVolRatio = parseFloat((breakVolume / avgVolWindow).toFixed(2));
          breakVolLabel = classifyVolRatio(breakVolRatio);
        }

        lines.push({
          type: avg > currentPrice ? 'RESISTANCE' : 'SUPPORT',
          style: 'HORIZONTAL', level: avg,
          touches: cluster.length,
          rawTouches: cluster.length,           // v7.2.0 — preserved
          weight: adjusted.weight,
          label: adjusted.label,
          rawLabel,                             // v7.2.0 — pre-vol-adjustment
          volAdjusted: adjusted.volAdjusted,    // v7.2.0 — true if label moved up/down a tier
          touchVolRatio, touchVolLabel,         // v7.2.0
          breakIdx, breakVolume, breakVolRatio, breakVolLabel,  // v7.2.0
          slopeQuality: 1.0,
          nearCurrent: Math.abs(avg - currentPrice) / currentPrice < 0.03,
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

      // v8.3.0 — count of up-days over the last 5 day-over-day comparisons.
      // Drives the melt-up regime check (above all SMAs + up ≥3 of last 5).
      let upDaysLast5 = 0;
      if (closes.length >= 6) {
        for (let i = closes.length - 5; i < closes.length; i++) {
          if (closes[i] > closes[i - 1]) upDaysLast5++;
        }
      }

      // v8.2.0 — consecutive daily closes on each side of SMA20. The most
      // recent close is the "current side"; walk backwards until the side
      // flips. Capped at 30 lookback (more than enough — anything past day-16
      // is "burned out" per the May 2026 backtest's win-rate curve).
      let daysAboveSMA20 = 0, daysBelowSMA20 = 0;
      {
        const SMA20_LOOKBACK_CAP = 30;
        const SMA_WINDOW = 20;
        const start = Math.max(SMA_WINDOW - 1, closes.length - SMA20_LOOKBACK_CAP);
        for (let i = closes.length - 1; i >= start; i--) {
          // SMA20 at index i = avg of closes[i-19 .. i]
          const w = closes.slice(i - SMA_WINDOW + 1, i + 1);
          if (w.length < SMA_WINDOW) break;
          const smaAtI = w.reduce((a, b) => a + b, 0) / SMA_WINDOW;
          const c = closes[i];
          if (c > smaAtI) {
            if (daysAboveSMA20 === 0 && daysBelowSMA20 === 0) daysAboveSMA20 = 1;
            else if (daysAboveSMA20 > 0) daysAboveSMA20++;
            else break;
          } else if (c < smaAtI) {
            if (daysAboveSMA20 === 0 && daysBelowSMA20 === 0) daysBelowSMA20 = 1;
            else if (daysBelowSMA20 > 0) daysBelowSMA20++;
            else break;
          } else {
            break;  // exactly on SMA — stop the streak
          }
        }
      }

      // v7.2.0 — daily RVOL (today's full-day volume vs 20-day average,
      // excluding today). For mid-session this is "today so far", which
      // the scoreStock pace-RVol calc adjusts for elapsed-fraction.
      const volume_today = candles.length > 0 ? (candles[candles.length - 1].v || 0) : 0;
      const volume_avg20 = computeAvgVolume(candles, 20, true);
      const dailyRVol = (volume_today && volume_avg20)
        ? parseFloat((volume_today / volume_avg20).toFixed(2))
        : null;
      const dailyRVolLabel = classifyVolRatio(dailyRVol);

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

      // v8.6.0 — DAILY SMA break/bounce events (confirmation signals).
      // Looks back up to 3 sessions for a close THROUGH an SMA (break) or a
      // pierce-and-close-back (bounce), using the SMA value AT each bar. Breaks
      // require ≥1.5× volume to be "confirmed"; bounces require price to be on the
      // correct side now. These let the scorer promote a near-MA setup from
      // "conditional" to a highlighted, actionable confirmed break/bounce.
      const smaEvents = (() => {
        const out = [];
        const last = candles.length - 1;
        if (last < 1) return out;
        const volAvg20 = (() => {
          const vs = candles.slice(-21, -1).map(c => c.v).filter(v => v > 0);
          return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
        })();
        const smaAt = (n, i) => {
          if (i + 1 < n) return null;
          let s = 0; for (let k = i - n + 1; k <= i; k++) s += closes[k];
          return s / n;
        };
        const defs = [['SMA20', 20, s20], ['SMA50', 50, s50], ['SMA100', 100, s100], ['SMA200', 200, s200]];
        const LOOKBACK = 3;
        for (const [label, n, curVal] of defs) {
          if (!curVal) continue;
          for (let i = last; i >= Math.max(n, last - LOOKBACK); i--) {
            const smaI = smaAt(n, i), smaPrev = smaAt(n, i - 1);
            if (smaI == null || smaPrev == null) continue;
            const c = candles[i], cPrev = candles[i - 1], daysAgo = last - i;
            const volR = volAvg20 ? parseFloat((c.v / volAvg20).toFixed(2)) : null;
            if (cPrev.c >= smaPrev && c.c < smaI) {
              out.push({ ma: label, level: parseFloat(curVal.toFixed(2)), type: 'BREAK_DOWN', daysAgo, volRatio: volR, confirmed: !!(volR && volR >= 1.5) && price < curVal });
            } else if (cPrev.c <= smaPrev && c.c > smaI) {
              out.push({ ma: label, level: parseFloat(curVal.toFixed(2)), type: 'BREAK_UP', daysAgo, volRatio: volR, confirmed: !!(volR && volR >= 1.5) && price > curVal });
            } else if (c.l < smaI && c.c > smaI) {
              out.push({ ma: label, level: parseFloat(curVal.toFixed(2)), type: 'BOUNCE_UP', daysAgo, volRatio: volR, confirmed: price > curVal });
            } else if (c.h > smaI && c.c < smaI) {
              out.push({ ma: label, level: parseFloat(curVal.toFixed(2)), type: 'BOUNCE_DOWN', daysAgo, volRatio: volR, confirmed: price < curVal });
            }
          }
        }
        return out;
      })();

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
        // v7.2.0 — volume awareness
        volume_today, volume_avg20, dailyRVol, dailyRVolLabel,
        // v8.2.0 — trend-age tracking (consecutive closes on each side of SMA20)
        daysAboveSMA20, daysBelowSMA20,
        // v8.3.0 — up-days count for melt-up regime detection
        upDaysLast5,
        // v8.6.0 — daily SMA break/bounce confirmation events
        smaEvents,
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

      const sessionCloses = [], sessionVolumes = [], sessionOpens = [], sessionHighs = [], sessionLows = [];
      let cumTPV = 0, cumVol = 0;
      // v7.2.0 — pre-market volume (today + prior days for averaging)
      let preMktVolumeToday = 0;
      const preMktDailyVolumes = {}; // dateKey → cumulative pre-mkt volume

      // Build a map of regular-session windows per day in the 5d range (one per
      // unique YYYY-MM-DD in ET). Yahoo's currentTradingPeriod only describes
      // the current/next session; for prior days, we approximate via 4:00 ET
      // start and 9:30 ET end as the pre-market window.
      function dateKey(ts) {
        return new Date(ts * 1000).toLocaleDateString('en-US', {
          timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
        });
      }
      function isPreMktTs(ts) {
        const et = new Date(new Date(ts * 1000).toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const min = et.getHours() * 60 + et.getMinutes();
        // Pre-market: 4:00 ET (240) → 9:30 ET (570).
        return min >= 240 && min < 570;
      }

      const todayKey = dateKey(nowTs);

      ts.forEach((t, i) => {
        const h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i], o = q.open?.[i];
        const k = dateKey(t);
        const inRegular = t >= regularStart && t < regularEnd;
        const inPreMkt = isPreMktTs(t);

        // Today's regular-session aggregation (existing logic)
        if (inRegular && k === todayKey) {
          if (c != null) sessionCloses.push(c);
          if (v != null) sessionVolumes.push(v);
          if (o != null) sessionOpens.push(o);
          if (h != null) sessionHighs.push(h);
          if (l != null) sessionLows.push(l);
          if (h && l && c && v) { cumTPV += ((h + l + c) / 3) * v; cumVol += v; }
        }

        // Pre-market volume bucketing — today and prior days
        if (inPreMkt && v != null) {
          if (k === todayKey) preMktVolumeToday += v;
          else preMktDailyVolumes[k] = (preMktDailyVolumes[k] || 0) + v;
        }
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

      // v7.2.0 — pre-market volume averaging (last 4 prior days)
      const priorDayVols = Object.values(preMktDailyVolumes).filter(v => v > 0);
      const preMktVolumeAvg4 = priorDayVols.length
        ? Math.round(priorDayVols.reduce((a, b) => a + b, 0) / priorDayVols.length)
        : null;
      const preMktVolRatio = (preMktVolumeToday && preMktVolumeAvg4)
        ? parseFloat((preMktVolumeToday / preMktVolumeAvg4).toFixed(2))
        : null;
      const preMktVolLabel = classifyVolRatio(preMktVolRatio);

      // v7.2.0 — sessionVolume = sum of today's regular-session candle volumes
      const sessionVolume = sessionVolumes.reduce((a, b) => a + b, 0);

      // v8.6.0 — compact recent M5 candles (last 12 ≈ 1h) so the scorer can
      // confirm an intraday break through / bounce off a DAILY SMA level.
      const recentCandles = (() => {
        const out = [], len = sessionCloses.length;
        for (let i = Math.max(0, len - 12); i < len; i++) {
          out.push({ c: sessionCloses[i], h: sessionHighs[i], l: sessionLows[i], v: sessionVolumes[i] });
        }
        return out;
      })();

      return {
        ticker, price: price?.toFixed(2),
        recentCandles,
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
        // v7.2.0 — volume fields
        sessionVolume,
        preMktVolumeToday,
        preMktVolumeAvg4,
        preMktVolRatio,
        preMktVolLabel,
        preMktDayCount: priorDayVols.length,
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

  function scoreStock(d1, m5, spyChangePct, earningsInfo, etCtx, spyContext) {
    spyContext = spyContext || {};
    // v8.4.0 Tier-2 — intraday regime-flip detector. In a confirmed melt-up, SPY
    // holding its VWAP on a mild-red day is a HEALTHY PULLBACK (longs stay live,
    // shorts parked); SPY losing its VWAP is an INTRADAY BREAKDOWN (longs become
    // counter-trend, melt-up short suppression released). Unknown VWAP
    // (pre-open/weekend) is treated as intact.
    const _meltup = spyContext.meltupRegime === true;
    const _spyIntradayHealthy = spyContext.spyAboveVwap !== false; // true or null => intact
    const rsScore = parseFloat((d1.changePct - spyChangePct).toFixed(2));
    const hasRS = rsScore > 0.5, hasRW = rsScore < -0.5;
    const nearAlgoLines = (d1.algoLines || []).filter(l => l.nearCurrent);
    const brokenAlgoLines = (d1.algoLines || []).filter(l => l.recentlyBroken);

    // v7.2.0 — pace RVol: today's session-volume-so-far vs (avg-daily × elapsed-fraction)
    let paceRVol = null, paceRVolLabel = null;
    const elapsed = sessionElapsedFraction(etCtx);
    if (m5?.sessionVolume && d1.volume_avg20 && elapsed && elapsed > 0.05) {
      const expected = d1.volume_avg20 * elapsed;
      paceRVol = parseFloat((m5.sessionVolume / expected).toFixed(2));
      paceRVolLabel = classifyVolRatio(paceRVol);
    }

    // v7.2.0 — helper to suffix a break confluence with breakout-volume info
    function breakVolSuffix(line) {
      const r = line.breakVolRatio;
      if (r == null) return '';
      if (r >= 1.5) return ` on ${r}× volume ✅`;
      if (r <= 0.7) return ` on ${r}× volume ⚠️ suspect`;
      return ` on ${r}× volume`;
    }
    // v7.2.0 — touch-volume hint for horizontal lines (in addition to label)
    function touchVolSuffix(line) {
      const r = line.touchVolRatio;
      if (r == null) return '';
      if (r >= 1.5) return ` [touches at ${r}× vol — institutional memory]`;
      if (r <= 0.6) return ` [touches at ${r}× vol — light, downgrade]`;
      return '';
    }

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
      // v7.2.0 — pace-RVol confluence when heavy
      if (paceRVol != null && paceRVol >= 1.4) confluences.push(`📊 Pace RVol ${paceRVol}× (${paceRVolLabel}) — institutional flow ✅`);
      else if (paceRVol != null && paceRVol <= 0.7) confluences.push(`⚠️ Pace RVol ${paceRVol}× (${paceRVolLabel}) — light volume`);
      // v7.2.0 — pre-market volume confluence for gap names
      if (m5?.preMktVolRatio != null && m5.preMktVolRatio >= 2 && m5.preMktDayCount >= 2) {
        confluences.push(`🚀 Pre-mkt volume ${m5.preMktVolRatio}× avg (${m5.preMktVolLabel}) — institutional pre-open interest ✅`);
      }
      brokenAlgoLines.forEach(l => {
        if (l.style === 'DESCENDING' && l.breakDirection === 'BROKE_ABOVE')
          confluences.push('🔥 BROKE ABOVE descending resistance $' + l.level + ' (' + l.touches + ' touches)' + breakVolSuffix(l) + ' ✅');
        if (l.style === 'HORIZONTAL' && l.breakDirection === 'BROKE_ABOVE') {
          const tag = l.label === 'KEY' ? '🔥🔥 KEY ' : l.label === 'MAJOR' ? '🔥 MAJOR ' : '';
          const adj = l.volAdjusted ? ` (vol-adj from ${l.rawLabel})` : '';
          confluences.push(tag + 'BROKE ABOVE horizontal resistance $' + l.level + ' (' + l.touches + ' touches)' + adj + breakVolSuffix(l) + touchVolSuffix(l) + ' ✅');
        }
      });
    } else if (d1.d1_short_valid && hasRW) {
      direction = 'SHORT'; setupType = 'RS_RW_TRADE';
      confluences.push('D1 below SMA20 + SMA50 ✅');
      confluences.push('RW ' + rsScore + '% vs SPY ✅');
      if (m5?.m5_short_valid) confluences.push('M5 below VWAP + SMA20 ✅');
      if (d1.haTrend === 'BEARISH') confluences.push('D1 HA bearish continuation ✅');
      // v7.2.0 — heavy volume on a down day = real distribution
      if (paceRVol != null && paceRVol >= 1.4) confluences.push(`📊 Pace RVol ${paceRVol}× (${paceRVolLabel}) — institutional distribution ✅`);
      brokenAlgoLines.forEach(l => {
        if (l.style === 'ASCENDING' && l.breakDirection === 'BROKE_BELOW')
          confluences.push('🔥 BROKE BELOW ascending support $' + l.level + ' (' + l.touches + ' touches)' + breakVolSuffix(l) + ' ✅');
        if (l.style === 'HORIZONTAL' && l.breakDirection === 'BROKE_BELOW') {
          const tag = l.label === 'KEY' ? '🔥🔥 KEY ' : l.label === 'MAJOR' ? '🔥 MAJOR ' : '';
          const adj = l.volAdjusted ? ` (vol-adj from ${l.rawLabel})` : '';
          confluences.push(tag + 'BROKE BELOW horizontal support $' + l.level + ' (' + l.touches + ' touches)' + adj + breakVolSuffix(l) + touchVolSuffix(l) + ' ✅');
        }
      });
    } else if (d1.d1_long_valid && hasRS && m5 && !m5.m5_long_valid) {
      direction = 'LONG'; setupType = 'WAIT_VWAP_RECLAIM';
      confluences.push('D1 above all SMAs ✅');
      confluences.push('RS +' + rsScore + '% vs SPY ✅');
      confluences.push('⏳ M5 below VWAP $' + m5.vwap + ' — waiting for reclaim');
      if (paceRVol != null && paceRVol >= 1.4) confluences.push(`📊 Pace RVol ${paceRVol}× (${paceRVolLabel}) — building volume on the wait ✅`);
    }

    const cleanCount = confluences.filter(c => c.includes('✅')).length;
    // v8.4.0 Tier-2 — conviction is NO LONGER derived from cleanCount here.
    // The cleanCount tier model (>=5 HIGH / >=3 MEDIUM) selected the most-extended
    // names — more confluences correlated with chase-the-high entries, not edge —
    // so HIGH historically underperformed MEDIUM (+0.06R vs +0.20R). Conviction is
    // now computed near the end of scoreStock() from an edge-based edgeScore (see
    // the `_edgeConviction` block) once trend-age and best-achievable R:R are known.

    // v7.1.0 — counter-trend penalty applies even at small SPY moves when individual RS is huge
    // v8.4.0 Tier-2 Choice 1 — a mild red day inside an intact melt-up (SPY still
    // holding VWAP) is a healthy PULLBACK, not a counter-trend long. Longs are only
    // counter-trend when SPY is red AND not in a healthy-pullback melt-up.
    const counterTrend =
        (direction === 'SHORT' && spyChangePct > 0)
     || (direction === 'LONG'  && spyChangePct < 0 && !(_meltup && _spyIntradayHealthy));
    const hugeIndividualMove = Math.abs(rsScore) >= 5;
    const counterTrendStrength = counterTrend
      ? (Math.abs(spyChangePct) >= 0.5 ? 'STRONG'
       : hugeIndividualMove ? 'MILD-RS-OVERRIDE'
       : 'MILD')
      : null;

    // v8.1.0 — when no live M5 VWAP (weekend / pre-market) and an aVWAP from
    // the 52w-high date is available below current price, use it as the pullback
    // entry anchor so that entry, stop, and targets are all self-consistent.
    const _aVWAPpullback = (!m5?.vwap &&
                            d1.anchoredVWAPs?.from52wHigh != null &&
                            parseFloat(d1.anchoredVWAPs.from52wHigh) < d1.price)
      ? parseFloat(d1.anchoredVWAPs.from52wHigh)
      : null;
    const rrEntry = m5?.vwap
      ? parseFloat(m5.vwap)
      : (_aVWAPpullback != null ? _aVWAPpullback : d1.price);
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
      // v8.1.0 — when entry is an aVWAP pullback (not current spot), rebase
      // T1/T2 from that entry so all numbers are self-consistent.
      if (_aVWAPpullback != null && d1.atr20) {
        rrT1 = parseFloat((_aVWAPpullback + 1.0 * d1.atr20).toFixed(2));
        rrT2 = parseFloat((_aVWAPpullback + 2.0 * d1.atr20).toFixed(2));
        rrT1Source = 'aVWAP $' + _aVWAPpullback + ' + 1×ATR(' + d1.atr20 + ')';
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

    // v8.1.0 — enforce minimum stop distance of 0.3×ATR from entry for both
    // directions. Prevents unusable stops caused by support/resistance levels
    // sitting within a few cents of the entry (e.g. PYPL 2026-05-12 $0.01 stop).
    // When the floor fires: stop is widened, rrRatio is recomputed, and a note
    // is appended so reports can flag the adjustment.
    const _atrFloor = d1.atr20 || 0;
    if (_atrFloor > 0 && rrStop != null) {
      if ((direction === 'LONG' || setupType === 'WAIT_VWAP_RECLAIM') &&
          (rrEntry - rrStop) < 0.3 * _atrFloor) {
        rrStop = parseFloat((rrEntry - 0.3 * _atrFloor).toFixed(2));
        rrStopNote = (rrStopNote || 'stop') + ' [auto-widened: min 0.3×ATR floor]';
        if (rrT1 != null) {
          const risk2 = rrEntry - rrStop, reward2 = rrT1 - rrEntry;
          rrRatio = (reward2 > 0 && risk2 > 0) ? parseFloat((reward2 / risk2).toFixed(1)) : null;
        }
      } else if (direction === 'SHORT' &&
                 (rrStop - rrEntry) < 0.3 * _atrFloor) {
        rrStop = parseFloat((rrEntry + 0.3 * _atrFloor).toFixed(2));
        rrStopNote = (rrStopNote || 'stop') + ' [auto-widened: min 0.3×ATR floor]';
        if (rrT1 != null) {
          const risk2 = rrStop - rrEntry, reward2 = rrEntry - rrT1;
          rrRatio = (reward2 > 0 && risk2 > 0) ? parseFloat((reward2 / risk2).toFixed(1)) : null;
        }
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

    // v8.2.0 — SLOW_BLEED_SHORT bucket detection (per May 2026 backtest signature)
    // Matches the structural pattern that produced the top 30 short swings in
    // the 60-day backtest: below all SMAs, 5–12 days below SMA20, within
    // 1.5×ATR of SMA20, mild RW, 5–35% off 52-week high.
    const _atrLocal = d1.atr20 || 0;
    const _distSma20Atr = (_atrLocal > 0 && d1.sma20 != null)
      ? (d1.price - d1.sma20) / _atrLocal
      : null;
    const _distFrom52wHi = (d1.fiftyTwoWeekHigh > 0)
      ? (d1.price / d1.fiftyTwoWeekHigh - 1) * 100
      : null;

    // v8.5.0 — DAILY SMA PROXIMITY & MA-CLUSTER GATE.
    // The scanner has the SMA values but never measured how close a setup sits to
    // them. Shorting straight into a converged MA *support* cluster (e.g. TTWO at
    // SMA50/SMA100), or longing into an MA *resistance* cluster, bounces on first
    // touch far more often than it breaks — so such setups are NOT immediately
    // actionable. They become CONDITIONAL: valid only on a confirmed close THROUGH
    // the cluster on ≥1.5× volume (breakthrough) or a bounce-and-reject off it.
    const _MA_BAND_ATR = 0.5;          // "near" an MA / cluster (first-touch bounce zone)
    const _MA_CLUSTER_WIDTH_ATR = 0.6; // SMAs within this band of each other = one cluster
    const _maList = [
      { ma: 'SMA20', level: d1.sma20 }, { ma: 'SMA50', level: d1.sma50 },
      { ma: 'SMA100', level: d1.sma100 }, { ma: 'SMA200', level: d1.sma200 },
    ].filter(x => typeof x.level === 'number' && x.level > 0 && _atrLocal > 0);
    const maProximity = _maList.map(x => ({
      ma: x.ma, level: parseFloat(x.level.toFixed(2)),
      distAtr: parseFloat(((x.level - d1.price) / _atrLocal).toFixed(2)), // +ve = MA above price
    })).sort((a, b) => Math.abs(a.distAtr) - Math.abs(b.distAtr));
    let maCluster = null;
    {
      const sorted = [..._maList].sort((a, b) => a.level - b.level);
      for (let i = 0; i < sorted.length; i++) {
        const grp = [sorted[i]];
        for (let j = i + 1; j < sorted.length; j++) {
          if ((sorted[j].level - sorted[i].level) / _atrLocal <= _MA_CLUSTER_WIDTH_ATR) grp.push(sorted[j]);
          else break;
        }
        if (grp.length >= 2) {
          const center = grp.reduce((s, g) => s + g.level, 0) / grp.length;
          const distAtr = Math.abs(center - d1.price) / _atrLocal;
          if (!maCluster || distAtr < maCluster.distAtr)
            maCluster = { members: grp.map(g => g.ma), center: parseFloat(center.toFixed(2)), distAtr: parseFloat(distAtr.toFixed(2)) };
        }
      }
    }
    // Directional hazard test. distAtr is +ve when the MA sits ABOVE price.
    //   • Price sitting ON an MA/cluster (|distAtr| ≤ 0.25) → bounce-both-ways → hazard.
    //   • SHORT bleeding INTO support (MA at/just BELOW price) → hazard.
    //   • LONG running INTO resistance (MA at/just ABOVE price) → hazard.
    //   • An MA on the FAVOURABLE side (resistance above a short / support below a
    //     long) that price is NOT pinned to is NOT a hazard — that's a normal
    //     bounce/rejection entry and stays actionable.
    const _MA_AT_ATR = 0.25;
    const _maHazard = (distAtr) => {
      if (Math.abs(distAtr) <= _MA_AT_ATR) return true;
      if (direction === 'SHORT') return distAtr < 0 && distAtr >= -_MA_BAND_ATR;
      return distAtr > 0 && distAtr <= _MA_BAND_ATR;
    };
    // v8.6.0 — SMA timeframe weighting. NOT all SMAs are equal: the longer the
    // average, the more institutional memory it carries, so it should drive a
    // bigger edge swing. SMA20 lightest → SMA200 heaviest. Weights are centred
    // near 1.0 so they scale the ±1.0/±1.5 MA adjustment sensibly.
    const maWeightOf = (ma) => !ma ? 1.0 : /200/.test(ma) ? 1.4 : /100/.test(ma) ? 1.1 : /50/.test(ma) ? 0.85 : 0.6;
    let maGovWeight = 1.0; // weight of the SMA/cluster governing this setup's MA state
    let maState = 'CLEAR', maConditional = false, maNote = 'No daily MA hazard in the trade path — clean. Actionable.';
    if (_maList.length && _atrLocal > 0 && (direction === 'LONG' || direction === 'SHORT')) {
      const nearestMA = maProximity[0];
      const clusterSigned = maCluster ? parseFloat(((maCluster.center - d1.price) / _atrLocal).toFixed(2)) : null;
      const dir = direction === 'SHORT' ? 'BELOW' : 'ABOVE';
      const verb = direction === 'SHORT' ? 'Shorting into' : 'Buying into';
      if (maCluster && _maHazard(clusterSigned)) {
        maState = 'AT_CLUSTER'; maConditional = true;
        maGovWeight = Math.max.apply(null, maCluster.members.map(maWeightOf)); // cluster as strong as its heaviest MA
        maNote = verb + ' a daily MA cluster (' + maCluster.members.join('+') + ' ≈ $' + maCluster.center
          + ', ' + Math.abs(clusterSigned) + '×ATR ' + (clusterSigned >= 0 ? 'above' : 'below')
          + ') — first touch usually bounces. CONDITIONAL: wait for a confirmed 5-min close '
          + dir + ' $' + maCluster.center + ' on ≥1.5× vol (breakthrough), or a bounce-and-reject off it.';
      } else if (nearestMA && _maHazard(nearestMA.distAtr)) {
        maState = 'AT_MA'; maConditional = true;
        maGovWeight = maWeightOf(nearestMA.ma);
        maNote = verb + ' the daily ' + nearestMA.ma + ' $' + nearestMA.level + ' (' + Math.abs(nearestMA.distAtr)
          + '×ATR ' + (nearestMA.distAtr >= 0 ? 'above' : 'below')
          + ') — first-touch bounce risk. CONDITIONAL: need a confirmed close ' + dir + ' it on ≥1.5× vol, or a bounce-and-reject.';
      } else if (nearestMA) {
        maNote = 'Nearest daily MA: ' + nearestMA.ma + ' $' + nearestMA.level + ' (' + Math.abs(nearestMA.distAtr) + '×ATR '
          + (nearestMA.distAtr >= 0 ? 'above' : 'below') + ') — favourable side / clear of walls. Actionable.';
      }
    }

    // v8.6.0 — CONFIRMATION pass. A daily-close or intraday-M5 break THROUGH /
    // bounce OFF the relevant SMA promotes the setup to actionable and highlights
    // it (overrides the conditional hazard above). Daily confirmation is preferred;
    // intraday M5 is the fallback for a same-session break/bounce.
    let maConfirmed = false, maConfirmVia = null;
    if (_maList.length && _atrLocal > 0 && (direction === 'LONG' || direction === 'SHORT')) {
      const events = d1.smaEvents || [];
      const BULL = new Set(['BREAK_UP', 'BOUNCE_UP']);
      const BEAR = new Set(['BREAK_DOWN', 'BOUNCE_DOWN']);
      const wantSide = direction === 'SHORT' ? BEAR : BULL;
      const oppSide  = direction === 'SHORT' ? BULL : BEAR;
      // RECENCY: a bounce/rejection decays fast (≤1 session); a break has a bit
      // more durability (≤2). NEGATION: discard any event that price later crossed
      // back through (a more-recent opposite-side event on the same MA invalidates
      // it). Together these kill stale/negated signals like DASH's 3-day-old
      // rejection that the next day's rally back above the SMA had already undone.
      const recencyOk = (e) => e.type.indexOf('BREAK') === 0 ? e.daysAgo <= 2 : e.daysAgo <= 1;
      const negated   = (e) => events.some(o => o.ma === e.ma && o.daysAgo < e.daysAgo && oppSide.has(o.type));
      const daily = events
        .filter(e => e.confirmed && wantSide.has(e.type) && recencyOk(e) && !negated(e))
        // prefer the heavier SMA (a 200 break/bounce outranks a 20), then recency
        .sort((a, b) => (maWeightOf(b.ma) - maWeightOf(a.ma)) || (a.daysAgo - b.daysAgo))[0];
      if (daily) {
        maConfirmed = true; maConfirmVia = 'daily'; maGovWeight = maWeightOf(daily.ma);
        const isBreak = daily.type.indexOf('BREAK') === 0;
        // direction-accurate state: LONG off support = BOUNCE; SHORT at resistance = REJECT.
        maState = isBreak ? 'CONFIRMED_BREAK' : (direction === 'SHORT' ? 'CONFIRMED_REJECT' : 'CONFIRMED_BOUNCE');
        const ago = daily.daysAgo === 0 ? 'today' : daily.daysAgo + 'd ago';
        maNote = isBreak
          ? 'CONFIRMED daily break ' + (direction === 'SHORT' ? 'BELOW' : 'ABOVE') + ' ' + daily.ma + ' $' + daily.level
            + ' ' + ago + ' on ' + (daily.volRatio != null ? daily.volRatio + '×' : '?') + ' vol — actionable.'
          : 'CONFIRMED daily ' + (direction === 'SHORT' ? 'rejection at' : 'bounce off') + ' ' + daily.ma + ' $' + daily.level
            + ' ' + ago + ' (not negated since) — actionable.';
      }
      if (!maConfirmed && Array.isArray(m5 && m5.recentCandles) && m5.recentCandles.length >= 3) {
        const useCluster = maCluster && Math.abs((maCluster.center - d1.price) / _atrLocal) <= _MA_BAND_ATR;
        const ref = useCluster ? maCluster.center : (maProximity[0] ? maProximity[0].level : null);
        const refMa = useCluster ? maCluster.members.join('+') : (maProximity[0] ? maProximity[0].ma : null);
        if (ref != null) {
          const rc = m5.recentCandles.filter(c => c && c.c != null);
          const last = rc[rc.length - 1];
          const margin = 0.05 * _atrLocal;
          const heavy = (paceRVol != null && paceRVol >= 1.4);
          if (last) {
            if (direction === 'SHORT') {
              const wasAbove = rc.some(c => c.h != null && c.h > ref);
              if (last.c < ref - margin && wasAbove && heavy) {
                maConfirmed = true; maConfirmVia = 'M5'; maState = 'CONFIRMED_BREAK';
                maNote = 'CONFIRMED intraday M5 break BELOW ' + refMa + ' $' + parseFloat(ref.toFixed(2)) + ' on heavy pace (' + paceRVol + '×) — actionable.';
              } else if (rc.some(c => c.h != null && c.h >= ref && c.c < ref) && last.c < ref) {
                maConfirmed = true; maConfirmVia = 'M5'; maState = 'CONFIRMED_REJECT';
                maNote = 'CONFIRMED intraday M5 rejection at ' + refMa + ' $' + parseFloat(ref.toFixed(2)) + ' (tagged & closed back below) — actionable short.';
              }
            } else {
              const wasBelow = rc.some(c => c.l != null && c.l < ref);
              if (last.c > ref + margin && wasBelow && heavy) {
                maConfirmed = true; maConfirmVia = 'M5'; maState = 'CONFIRMED_BREAK';
                maNote = 'CONFIRMED intraday M5 break ABOVE ' + refMa + ' $' + parseFloat(ref.toFixed(2)) + ' on heavy pace (' + paceRVol + '×) — actionable.';
              } else if (rc.some(c => c.l != null && c.l <= ref && c.c > ref) && last.c > ref) {
                maConfirmed = true; maConfirmVia = 'M5'; maState = 'CONFIRMED_BOUNCE';
                maNote = 'CONFIRMED intraday M5 bounce off ' + refMa + ' $' + parseFloat(ref.toFixed(2)) + ' (tagged & closed back above) — actionable long.';
              }
            }
          }
          if (maConfirmVia === 'M5') maGovWeight = useCluster
            ? Math.max.apply(null, maCluster.members.map(maWeightOf))
            : maWeightOf(maProximity[0] && maProximity[0].ma);
        }
      }
      if (maConfirmed) maConditional = false;
    }

    const slowBleedShort = direction === 'SHORT'
                        && d1.aboveSma100 === false
                        && d1.aboveSma200 === false
                        && d1.daysBelowSMA20 != null
                        && d1.daysBelowSMA20 >= 5 && d1.daysBelowSMA20 <= 12
                        && _distSma20Atr != null
                        && _distSma20Atr >= -1.5 && _distSma20Atr < 0
                        && rsScore <= -0.5 && rsScore >= -8
                        && _distFrom52wHi != null
                        && _distFrom52wHi <= -5 && _distFrom52wHi >= -35
                        && !earningsInfo.hasUpcoming
                        && !earningsInfo.justReported
                        && !earningsInfo.likelyPostEarnings;

    // v8.3.0 — EARN_REACTOR quality bar
    // The May 16 backtest review showed the EARN_REACTOR bucket ran 11% win-rate
    // (1 T1 in 9 trades on May 12-15) versus the 32% baseline of valid-structure
    // shorts. Tighten: require 2 of 3 quality conditions for a reactor to enter
    // the main Top section. Unqualified reactors route to WATCHLIST_REACTOR
    // (rendered as a watch-only sub-section in the brief).
    //
    // Quality conditions:
    //   (a) cleanCount >= 4 (one more confluence than the baseline 3)
    //   (b) paceRVol >= 2.0 (very heavy, not just heavy 1.4)
    //   (c) ≥1 broken algo level with ≥3 touches AND breakVolRatio ≥ 1.5
    //       (institutional break of a real structure level)
    const _isReactor = earningsInfo.hasUpcoming || earningsInfo.justReported || earningsInfo.likelyPostEarnings;
    const _earnQualA = cleanCount >= 4;
    const _earnQualB = paceRVol != null && paceRVol >= 2.0;
    const _earnQualC = brokenAlgoLines.some(l => (l.touches || 0) >= 3 && (l.breakVolRatio || 0) >= 1.5);
    const _earnQualCount = (_earnQualA ? 1 : 0) + (_earnQualB ? 1 : 0) + (_earnQualC ? 1 : 0);
    const earnReactorQualified = _isReactor && _earnQualCount >= 2;
    const earnReactorQualifiers = _isReactor ? {
      confluences4plus: _earnQualA,
      paceRVol2x: _earnQualB,
      institutionalBreak: _earnQualC,
      qualifiedCount: _earnQualCount,
      qualified: earnReactorQualified,
    } : null;

    // v8.3.0 — Melt-up regime + short raise-bar flag
    // The backtest showed 18 of the top-30 best shorts worked even when SPY was
    // above all four SMAs. "Ban shorts in melt-up" is too strong. Instead, flag
    // SHORT setups that DON'T meet a higher structural bar when the regime is
    // melt-up so the brief can demote them to watchlist.
    //
    // SPY melt-up is derived from SPY's own d1 fields if available on the global
    // _scan record; this flag is set externally when run() finishes and routes
    // it back into the per-setup score. As a scoreStock-local fallback we compute
    // it from the SPY change vs SMAs proxy: SPY is in melt-up if spyChangePct > 0
    // for today (caller-set context is more accurate; this is a conservative
    // backstop). The full regime test (above all 4 SMAs + up ≥3 of last 5) is
    // applied in run() and threaded back via window._scan.spyMeltupRegime.
    // v8.4.0 Tier-2 Choice 2 — release the melt-up short suppression once SPY loses
    // its VWAP (intraday breakdown). While SPY holds VWAP the uptrend is intact and
    // shorts stay parked; on a breakdown they route to their normal short buckets.
    const _isMeltupShort = direction === 'SHORT' && _meltup && _spyIntradayHealthy;
    const _meltupShortRaisedBarOk = direction === 'SHORT' && cleanCount >= 4
                                 && (d1.daysBelowSMA20 || 0) >= 6
                                 && _distFrom52wHi != null && _distFrom52wHi <= -10;
    const meltupShortRaisedBar = _isMeltupShort && !_meltupShortRaisedBarOk;

    // v8.4.0 Tier-1 fix #2 — "best achievable" R:R uses the FURTHER target (T2),
    // not the conservative 1/3-off T1. Gating on T1 alone discards tiered-exit
    // runners: validation on logged trades that carry T2 data showed a T2-aware
    // gate keeps 29/31 long picks and drops only 2 net-losers, whereas a blunt
    // T1 gate threw out winning runners. Route to WATCHLIST_LOWRR only when even
    // the T2 target cannot produce 1.5:1.
    const _rrRisk = (rrStop != null) ? Math.abs(rrEntry - rrStop) : null;
    const _rrT2Ratio = (_rrRisk && _rrRisk > 0 && rrT2 != null)
      ? Math.abs(rrT2 - rrEntry) / _rrRisk : null;
    const _bestAchievableRR = Math.max(rrRatio || 0, _rrT2Ratio || 0);

    let bucket;
    if (direction === 'NEUTRAL')                                                                       bucket = 'NEUTRAL';
    else if (counterTrend)                                                                              bucket = 'COUNTER_TREND';
    else if (_isReactor && !earnReactorQualified)                                                       bucket = 'WATCHLIST_REACTOR';
    else if (_isReactor)                                                                                bucket = 'EARNINGS_REACTOR';
    else if (setupType === 'WAIT_VWAP_RECLAIM')                                                         bucket = 'WAIT';
    // v8.4.0 Tier-1 fix #3 — suppress ALL shorts in a confirmed melt-up regime
    // (watchlist-only). Backtest of 121 logged picks (May12–Jun2): shorts booked
    // -8.0R at a 37% triggered win rate in an up-tape. Route slow-bleed, clean,
    // and raised-bar shorts to watch instead of publishing them as trades.
    else if (_isMeltupShort)                                                                            bucket = 'WATCHLIST_MELTUP_SHORT';
    else if (slowBleedShort)                                                                            bucket = 'SLOW_BLEED_SHORT';
    else if (meltupShortRaisedBar)                                                                      bucket = 'WATCHLIST_MELTUP_SHORT';
    // v8.4.0 Tier-1 fix #2 — enforce the R:R floor at the SCANNER, not just as a
    // rendered label. A would-be clean setup with no computable R:R, or R:R < 1.5:1
    // to T1, is routed to WATCHLIST_LOWRR and never occupies a publishable Top slot.
    // (Historically 59% of triggered trades ran < 1.5:1 because this rule was prose-only.)
    else if (_bestAchievableRR < 1.5)                                                                   bucket = 'WATCHLIST_LOWRR';
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

    // ─── v8.0.0 — Phase 1 playbook fields ──────────────────────────────────
    // Reference: Reports/SKILL_addendum_phase1_v1.md
    const atr = d1.atr20 || 0;
    const price = d1.price;
    const sma20 = d1.sma20;
    const dayHigh = d1.dayHigh;
    const dayLow = d1.dayLow;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // Rule 1 — Day-trade T1 = entry + 0.5×ATR; swing T1 = entry + 1×ATR
    const t1DaySynthetic = (direction === 'SHORT')
      ? (atr ? parseFloat((rrEntry - 0.5 * atr).toFixed(2)) : null)
      : (atr ? parseFloat((rrEntry + 0.5 * atr).toFixed(2)) : null);
    const t1SwingSynthetic = (direction === 'SHORT')
      ? (atr ? parseFloat((rrEntry - 1.0 * atr).toFixed(2)) : null)
      : (atr ? parseFloat((rrEntry + 1.0 * atr).toFixed(2)) : null);

    // Rule 2 — Breakout entry levels (pre-publish HOD/LOD at scoring time)
    // Long: 5-min close above dayHigh × 1.0005 with bar volume ≥ 1.5× session avg
    // Short: 5-min close below dayLow × 0.9995 with bar volume ≥ 1.5× session avg
    const breakoutLong = dayHigh ? parseFloat((dayHigh * 1.0005).toFixed(2)) : null;
    const breakoutShort = dayLow ? parseFloat((dayLow * 0.9995).toFixed(2)) : null;

    // Rule 5 — Conviction-score penalties
    const extensionPenalty = (sma20 != null && atr > 0)
      ? parseFloat(clamp(1.5 - (price - sma20) / (3 * atr), 0.3, 1.0).toFixed(2))
      : 1.0;
    const hodProximityPenalty = (dayHigh != null && atr > 0)
      ? parseFloat(clamp((dayHigh - price) / (0.5 * atr), 0.3, 1.0).toFixed(2))
      : 1.0;
    const stopDist = rrStop != null ? Math.abs(rrEntry - rrStop) : 0;
    // v8.1.0 — threshold lowered from 1×ATR to 0.3×ATR. The prior threshold
    // halved the score on virtually every valid intraday setup (most intraday
    // stops are 0.3–0.7×ATR). A stop < 0.3×ATR still scores 0.5 as a penalty
    // signal, but valid tight stops no longer get unfairly penalised.
    const stopQualityFactor = (atr > 0 && stopDist >= 0.3 * atr) ? 1.0 : 0.5;

    // Rule 4 — CLEAN_DAY qualification gates (catalyst verification added externally)
    const cleanDayPaceOk = paceRVol != null && paceRVol >= 1.4;
    const cleanDayConfluencesOk = cleanCount >= 3;

    // v8.2.0 — Trend-age multiplier (per May 2026 backtest win-rate curve).
    // The win rate by days-on-trend-side, on 500 valid short setups, was:
    //   1–3 days:  38.0%  (fresh — mixed)
    //   4–5 days:  28.9%  (pause — worst)
    //   6–7 days:  52.4%  (best — second-leg confirmation)
    //   8–10 days: 45.6%  (continuation)
    //   11–15 days:38.4%  (late)
    //   16+ days:  28.4%  (burned out)
    // Multiplier reflects the curve: boost the sweet-spot, demote the burned-out.
    const _trendDays = direction === 'SHORT' ? (d1.daysBelowSMA20 || 0)
                     : direction === 'LONG'  ? (d1.daysAboveSMA20 || 0)
                     : 0;
    const trendAgeMultiplier =
        (_trendDays >= 6  && _trendDays <= 10) ? 1.25
      : (_trendDays >= 11 && _trendDays <= 15) ? 1.10
      : (_trendDays >= 3  && _trendDays <=  5) ? 0.85
      : (_trendDays >= 16)                     ? 0.75
      :                                          1.00;

    // v8.0.0 — composite score with new penalties stacked
    // v8.2.0 — trendAgeMultiplier added to the chain
    const compositeScoreV8 = parseFloat(
      ((cleanCount + horizWeightBonus) * rrScoreCap * haMult * ctPenalty * earningsPen
       * extensionPenalty * hodProximityPenalty * stopQualityFactor * trendAgeMultiplier).toFixed(2)
    );

    // v8.4.0 Tier-2 — EDGE-BASED CONVICTION (replaces the cleanCount tier model).
    // Built from INDEPENDENT, edge-bearing factors, with redundant confluences
    // capped and extension / stale-trend explicitly penalised. On the May–Jun book
    // the old model put HIGH on the most-extended names (e.g. WDC at trend-age 30,
    // ODFL 3.3×ATR above SMA20) while clean pullback entries sat at MEDIUM/LOW.
    // Factor weights (max ≈ 11): entry-quality 2.5 · trend-age 2 · RS strength 2.5 ·
    // R:R 2 · capped independent confirmations 2.
    function _edgeConviction() {
      if (direction !== 'LONG' && direction !== 'SHORT')
        return { score: 0, label: 'LOW', factors: null };
      // extension in ATR units, signed so "extended in the trade direction" is +ve
      const ext = _distSma20Atr == null ? null
                : (direction === 'LONG' ? _distSma20Atr : -_distSma20Atr);
      let pEntry = 0;
      if (ext == null) pEntry = 0;
      else if (ext <= 1.0)  pEntry = 2.5;   // at/near the 20SMA — best entry, low chase risk
      else if (ext <= 1.75) pEntry = 1.5;
      else if (ext <= 2.5)  pEntry = 0.5;
      else if (ext <= 3.0)  pEntry = 0;
      else                  pEntry = -1.0;  // chasing an extended move
      const td = _trendDays || 0;
      let pTrend = 0;
      if (td >= 6 && td <= 10)       pTrend = 2;    // second-leg sweet spot (~52% win)
      else if (td >= 11 && td <= 15) pTrend = 1;
      else if (td >= 1 && td <= 5)   pTrend = 0.5;
      else if (td >= 16)             pTrend = -1;   // burned-out trend (~28% win)
      let rsAbs = Math.abs(rsScore || 0);
      if (td && td <= 2) rsAbs = Math.min(rsAbs, 1.5); // a 1–2 day move is a gap, not accumulation
      let pRS = 0;
      if (rsAbs >= 4)        pRS = 2.5;
      else if (rsAbs >= 2.5) pRS = 2;
      else if (rsAbs >= 1.5) pRS = 1.5;
      else if (rsAbs >= 0.75)pRS = 1;
      else if (rsAbs >= 0.5) pRS = 0.5;
      const bestRR = _bestAchievableRR || 0;
      let pRR = 0;
      if (bestRR >= 3)        pRR = 2;
      else if (bestRR >= 2)   pRR = 1.5;
      else if (bestRR >= 1.5) pRR = 1;
      // independent confirmations, capped at 2 — kills the redundant-checkbox inflation
      let cats = 0;
      if (confluences.some(c => (c.includes('Pace RVol') && c.includes('✅')) || c.includes('Pre-mkt'))) cats++;
      if (confluences.some(c => c.includes('BROKE'))) cats++;
      if (confluences.some(c => c.includes('HA ') && c.includes('✅'))) cats++;
      const pConf = Math.min(cats, 2);
      // v8.5.0/8.6.0 — MA adjustment. Driving into a daily MA wall docks the score
      // (first-touch bounce risk); a CONFIRMED break-through / bounce-off boosts it
      // (the ambiguity is resolved in the trade's favour and is a setup in itself).
      // v8.6.0 — base MA adjustment, SCALED by the governing SMA's timeframe weight
      // (SMA20 ×0.6 … SMA200 ×1.4). A confirmed break of the 200 swings the edge
      // far more than a 20; a hazard at the 200 is a far stronger bounce risk.
      const maAdjBase = maConfirmed ? 1.0
                      : maConditional ? (maState === 'AT_CLUSTER' ? -1.5 : -1.0)
                      : 0;
      const maAdj = parseFloat((maAdjBase * (maGovWeight || 1.0)).toFixed(2));
      const score = parseFloat((pEntry + pTrend + pRS + pRR + pConf + maAdj).toFixed(2));
      // gap-chase guardrail: a 1–2 day trend on a huge (≥5%) single-day RS spike
      // cannot be HIGH — almost always an unconfirmed earnings/news gap.
      const gapChase = !!td && td <= 2 && Math.abs(rsScore || 0) >= 5;
      let label = score >= 7 ? 'HIGH' : score >= 4.5 ? 'MEDIUM' : 'LOW';
      if (gapChase && label === 'HIGH') label = 'MEDIUM';
      // can't be HIGH conviction while shorting into support / longing into resistance
      if (maConditional && label === 'HIGH') label = 'MEDIUM';
      return {
        score, label,
        factors: { pEntry, pTrend, pRS, pRR, pConf, maAdj, maGovWeight,
                   extAtr: ext == null ? null : parseFloat(ext.toFixed(2)),
                   trendDays: td, bestRR: parseFloat(bestRR.toFixed(2)) }
      };
    }
    const _ec = _edgeConviction();
    const edgeScore = _ec.score;
    const convictionFactors = _ec.factors;
    let conviction = _ec.label;
    // Preserve the existing earnings / just-reported / post-gap downgrades + tags.
    if (earningsInfo.hasUpcoming) {
      if (conviction === 'HIGH')        conviction = 'MEDIUM';
      else if (conviction === 'MEDIUM') conviction = 'LOW';
      conviction += ' ⚠️ EARNINGS';
    }
    if (earningsInfo.justReported) {
      if (conviction === 'HIGH')        conviction = 'MEDIUM';
      else if (conviction === 'MEDIUM') conviction = 'LOW';
      conviction += ' 📊 JUST-REPORTED';
    }
    if (earningsInfo.likelyPostEarnings) {
      if (conviction === 'HIGH') conviction = 'MEDIUM';
      conviction += ' 🔴 POST-GAP';
    }
    // v8.5.0/8.6.0 — MA tags: confirmed break/bounce (actionable) or conditional.
    if (maConfirmed) conviction += (maState === 'CONFIRMED_BREAK' ? ' 🧭 BREAK ✅'
                                  : maState === 'CONFIRMED_REJECT' ? ' 🧭 REJECT ✅'
                                  : ' 🧭 BOUNCE ✅');
    else if (maConditional) conviction += ' 🧭 MA-COND';

    return {
      direction, setupType, rsScore, hasRS, hasRW,
      confluences, conviction, edgeScore, convictionFactors, counterTrend, counterTrendStrength,
      // v8.5.0 — daily SMA proximity + MA-cluster gate; v8.6.0 — confirmation
      maProximity, maCluster, maState, maConditional, maNote, maConfirmed, maConfirmVia, maGovWeight,
      rrEntry, rrStop, rrStopNote, rrT1, rrT1Source, rrT2, rrRatio, poorRR,
      compositeScore, swingEligible, swingCandidate, swingNote,
      bucket, entryNote, stopNote,
      brokenAlgoLines,
      // v7.2.0 — volume metrics surfaced for rendering
      paceRVol, paceRVolLabel,
      // v8.0.0 — Phase 1 fields
      t1DaySynthetic, t1SwingSynthetic,
      breakoutLong, breakoutShort,
      extensionPenalty, hodProximityPenalty, stopQualityFactor,
      cleanDayPaceOk, cleanDayConfluencesOk,
      compositeScoreV8,
      // v8.2.0 — slow-bleed + trend-age fields
      slowBleedShort, trendAgeMultiplier,
      trendDays: _trendDays,
      distSma20Atr: _distSma20Atr != null ? parseFloat(_distSma20Atr.toFixed(2)) : null,
      distFrom52wHi: _distFrom52wHi != null ? parseFloat(_distFrom52wHi.toFixed(2)) : null,
      // v8.3.0 — quality-bar flags
      earnReactorQualified, earnReactorQualifiers, meltupShortRaisedBar,
    };
  }

  // v7.3.0 — best-effort pull of Yahoo's earnings calendar for the current ET
  // calendar date. Returns an array of ticker strings (BMO + AMC + during-market).
  // Yahoo's `/v1/finance/visualization` endpoint requires a CORS-tolerant fetch
  // and may need a crumb on hardened sessions; we try the simpler
  // `finance.yahoo.com/calendar/earnings` HTML embed first and fall back to the
  // visualization endpoint. On any failure we silently return [] so the
  // watchlist is the durable safety net.
  // v8.2.0 — Universe pre-screen helpers ─────────────────────────────────────
  //
  // The Yahoo gainers/losers/most-actives screeners surface only stocks that
  // are already moving >2–5% today. They miss the slow-bleed shorts that took
  // 1–2 weeks to set up (ZTS, TSCO, GEHC, COR, ... per the May 2026 backtest).
  // These helpers fetch D1 for the full STATIC_UNIVERSE in parallel and apply
  // structural filters to surface those names before the catalyst hunt.
  //
  // Cache: localStorage with a 4-hour TTL keyed by YYYY-MM-DD. The pre-open
  // run (8:30 AM ET) pays the universe-fetch cost; subsequent intraday scans
  // read cache.

  function _universeCacheKey() {
    const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const yyyy = et.getFullYear();
    const mm = String(et.getMonth() + 1).padStart(2, '0');
    const dd = String(et.getDate()).padStart(2, '0');
    return 'rdt_d1_universe_' + yyyy + '-' + mm + '-' + dd;
  }

  function _pruneOlderUniverseCache(currentKey) {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('rdt_d1_universe_') && k !== currentKey) keysToRemove.push(k);
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) { /* silently ignore */ }
  }

  async function fetchD1Universe(tickers, opts) {
    opts = opts || {};
    const concurrency = opts.concurrency || UNIVERSE_FETCH_CONCURRENCY;
    const useCache    = opts.useCache !== false;

    const cacheKey = _universeCacheKey();
    let cached = {};
    if (useCache) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.ts && (Date.now() - parsed.ts) < UNIVERSE_CACHE_TTL_MS) {
            cached = parsed.data || {};
          }
        }
      } catch (e) { /* corrupt cache — ignore */ }
    }

    const toFetch = tickers.filter(t => !(t in cached));
    if (toFetch.length === 0) {
      console.log('[RDT ' + VERSION + '] Universe cache HIT (' + tickers.length + ' tickers, fresh < ' + (UNIVERSE_CACHE_TTL_MS / 3.6e6).toFixed(1) + 'h).');
      return cached;
    }
    console.log('[RDT ' + VERSION + '] Universe fetch: ' + toFetch.length + ' tickers (concurrency=' + concurrency + ') — cache hits ' + (tickers.length - toFetch.length) + '.');

    const t0 = Date.now();
    const results = Object.assign({}, cached);
    const queue = toFetch.slice();
    let completed = 0, failed = 0;

    const worker = async () => {
      while (queue.length > 0) {
        const ticker = queue.shift();
        if (!ticker) break;
        try {
          const d1 = await fetchD1(ticker);
          if (d1 && !d1.error) results[ticker] = d1;
          else failed++;
        } catch (e) {
          failed++;
        }
        completed++;
      }
    };
    await Promise.all(Array(concurrency).fill(0).map(() => worker()));

    if (useCache) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: results }));
        _pruneOlderUniverseCache(cacheKey);
      } catch (e) {
        // localStorage might be full or in private-mode — best-effort
        console.warn('[RDT ' + VERSION + '] Universe cache write failed: ' + e.message);
      }
    }
    console.log('[RDT ' + VERSION + '] Universe fetch done: ' + completed + ' done, ' + failed + ' failed, ' +
                ((Date.now() - t0) / 1000).toFixed(1) + 's elapsed.');
    return results;
  }

  // v8.2.0 — Structural pre-screen on the universe D1 map.
  // Returns { tickers: [...], bySource: { slowBleedShort: [...], cleanLong: [...] } }
  //
  // Filter A — SLOW_BLEED_SHORT (per May 2026 backtest top-30 short signature):
  //   - below all 4 daily SMAs
  //   - 5..12 consecutive days below SMA20 (sweet spot 6..10)
  //   - within 1.5×ATR of SMA20 from below (not extended)
  //   - mild relative weakness (−0.5% to −8% vs SPY today)
  //   - 5–35% off 52-week high
  //   - ≥1M shares avg daily volume
  //
  // Filter B — CLEAN_LONG_STRUCTURAL (mirror, lighter — the current scanner
  // already catches most of these via gainers/Mag7, but a universe pass
  // surfaces fresh breakouts the screener might miss):
  //   - above all 4 daily SMAs
  //   - 5..12 consecutive days above SMA20
  //   - positive RS vs SPY (≥+0.5%)
  //   - ≥1M shares avg daily volume
  function prescreenUniverse(d1Map, spyChangePct) {
    const slowBleedShort = [];
    const cleanLong = [];
    for (const ticker in d1Map) {
      const d1 = d1Map[ticker];
      if (!d1 || d1.error) continue;
      if (!d1.volume_avg20 || d1.volume_avg20 < UNIVERSE_MIN_AVG_VOLUME) continue;
      if (!d1.atr20 || d1.atr20 <= 0) continue;
      if (d1.fiftyTwoWeekHigh == null || d1.sma20 == null) continue;

      const rsVsSpy = d1.changePct - spyChangePct;
      const distSma20Atr = (d1.price - d1.sma20) / d1.atr20;
      const distFrom52wHi = (d1.price / d1.fiftyTwoWeekHigh - 1) * 100;

      // Filter A — SLOW_BLEED_SHORT
      if (d1.d1_short_valid && !d1.aboveSma100 && !d1.aboveSma200
          && d1.daysBelowSMA20 >= 5 && d1.daysBelowSMA20 <= 12
          && distSma20Atr >= -1.5 && distSma20Atr < 0
          && rsVsSpy >= -8 && rsVsSpy <= -0.5
          && distFrom52wHi >= -35 && distFrom52wHi <= -5) {
        slowBleedShort.push(ticker);
        continue;
      }

      // Filter B — CLEAN_LONG_STRUCTURAL
      if (d1.d1_long_valid && rsVsSpy >= 0.5
          && d1.daysAboveSMA20 >= 5 && d1.daysAboveSMA20 <= 12) {
        cleanLong.push(ticker);
      }
    }
    return {
      tickers: [...new Set([...slowBleedShort, ...cleanLong])],
      bySource: { slowBleedShort, cleanLong },
    };
  }

  async function fetchEarningsCalendar() {
    try {
      const etDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const yyyy = etDate.getFullYear();
      const mm = String(etDate.getMonth() + 1).padStart(2, '0');
      const dd = String(etDate.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      // Try the public visualization endpoint (no crumb required for read-only earnings query)
      const url = 'https://query1.finance.yahoo.com/v1/finance/visualization?formatted=false&lang=en-US&region=US';
      const body = {
        size: 250, offset: 0,
        sortField: 'companyshortname', sortType: 'ASC',
        entityIdType: 'earnings',
        includeFields: ['ticker'],
        query: {
          operator: 'and',
          operands: [
            { operator: 'gte', operands: ['startdatetime', dateStr] },
            { operator: 'lte', operands: ['startdatetime', dateStr] },
            { operator: 'eq',  operands: ['region', 'us'] },
          ],
        },
      };
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) return [];
      const j = await r.json();
      const rows = j?.finance?.result?.[0]?.documents?.[0]?.rows || [];
      const tickers = rows.map(row => Array.isArray(row) ? row[0] : row.ticker).filter(Boolean);
      return [...new Set(tickers)];
    } catch (e) {
      return [];
    }
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
    console.log('[RDT ' + VERSION + '] constituents.js: ' + CONSTITUENTS_VERSION + ' (' + STATIC_UNIVERSE.length + ' tickers)');
    let spyChangePct = 0;
    try {
      const spyQ = await fetchJSON('https://query1.finance.yahoo.com/v7/finance/quote?symbols=SPY&fields=regularMarketChangePercent');
      spyChangePct = spyQ?.quoteResponse?.result?.[0]?.regularMarketChangePercent || 0;
    } catch(e) {}

    // v8.2.0 — Parallel-launch three workstreams:
    //   1. Catalyst hunt (Yahoo screeners — gainers/losers/most_actives)
    //   2. Earnings calendar (today's reporters)
    //   3. Universe pass (D1 fetch + structural pre-screen over STATIC_UNIVERSE)
    //
    // Universe pass is the slowest (~60–90s on a cold cache, ~2–5s on a warm
    // cache). Catalyst hunt + earnings are fast (~5s). Doing them in parallel
    // keeps the wall-clock cost dominated by whichever is slower; on a warm
    // cache the whole thing is bounded by the catalyst calls.
    const [candidates, earningsToday, universeD1] = await Promise.all([
      getCandidates(spyChangePct),
      fetchEarningsCalendar(),
      STATIC_UNIVERSE.length > 0 ? fetchD1Universe(STATIC_UNIVERSE) : Promise.resolve({}),
    ]);

    // v8.2.0 — apply structural pre-screen on the universe D1 map
    const universePrescreen = STATIC_UNIVERSE.length > 0
      ? prescreenUniverse(universeD1, spyChangePct)
      : { tickers: [], bySource: { slowBleedShort: [], cleanLong: [] } };
    if (universePrescreen.tickers.length) {
      console.log('[RDT ' + VERSION + '] Universe pre-screen: ' +
                  universePrescreen.bySource.slowBleedShort.length + ' SLOW_BLEED_SHORT, ' +
                  universePrescreen.bySource.cleanLong.length + ' CLEAN_LONG_STRUCTURAL');
      if (universePrescreen.bySource.slowBleedShort.length) {
        console.log('[RDT ' + VERSION + '] SLOW_BLEED_SHORT candidates:', universePrescreen.bySource.slowBleedShort.join(', '));
      }
    }

    const symbols = candidates.map(c => c.symbol);
    const combined = [...new Set([
      ...symbols,
      ...MAG7,
      ...SEMI_WATCHLIST,
      ...USER_WATCHLIST,
      ...EARNINGS_REACTOR_WATCHLIST,    // v7.3.0 — always-fetch high-frequency earnings gappers
      ...earningsToday,                 // v7.3.0 — today's pre-mkt + AMC reporters
      ...universePrescreen.tickers,     // v8.2.0 — universe-derived structural candidates
      ...(extras || []),
    ])];
    console.log('[RDT ' + VERSION + '] Tickers (' + combined.length + '):', combined.join(', '));
    if (earningsToday.length) {
      console.log('[RDT ' + VERSION + '] Earnings today (' + earningsToday.length + '):', earningsToday.join(', '));
    } else {
      console.log('[RDT ' + VERSION + '] Earnings calendar fetch returned 0 — relying on EARNINGS_REACTOR_WATCHLIST safety net.');
    }

    // v8.2.0 — pass the universe D1 cache to analyze() so it can skip re-fetching
    // D1 for the universe-derived tickers.
    return analyze(combined, candidates, spyChangePct, universeD1);
  }

  async function analyze(tickers, candidates, spyChangePctIn, d1Cache) {
    const etCtx = getETContext();
    d1Cache = d1Cache || {};

    // v7.1.0 — fetch SPY D1 first to get the canonical change-percent.
    // The /v7/finance/quote endpoint sometimes returns 0 (caching/timing flakes);
    // spyD1.changePct is computed from prevDayClose → current price and is always accurate.
    const [spyD1, spyM5] = await Promise.all([fetchD1('SPY'), fetchM5('SPY')]);
    const spyChangePct = (spyD1 && !spyD1.error && typeof spyD1.changePct === 'number')
      ? spyD1.changePct
      : (spyChangePctIn ?? 0);

    // v8.3.0 — Compute SPY melt-up regime up front, before per-ticker scoring,
    // so scoreStock can demote weak shorts when the tape is melt-up.
    // Definition: SPY above all 4 daily SMAs AND up on ≥3 of the last 5
    // day-over-day comparisons. Mirrors automation/score_yesterday.py's
    // is_meltup_regime() exactly.
    const spyMeltupRegime = !!(spyD1 && !spyD1.error
                            && spyD1.d1_long_valid
                            && (spyD1.upDaysLast5 || 0) >= 3);
    console.log('[RDT ' + VERSION + '] SPY regime: ' + (spyMeltupRegime ? 'MELT-UP (above all SMAs + up ≥3 of last 5)' : 'not melt-up'));
    // v8.4.0 Tier-2 — SPY intraday VWAP state drives the regime "flip" detector.
    // Above VWAP (or unknown pre-open) = uptrend intact; below VWAP = intraday breakdown.
    const spyAboveVwap = (spyM5 && typeof spyM5.aboveVwap === 'boolean') ? spyM5.aboveVwap : null;
    console.log('[RDT ' + VERSION + '] SPY intraday: ' +
      (spyAboveVwap === null ? 'VWAP n/a (pre-open/weekend) — treated as intact'
       : spyAboveVwap ? 'above VWAP — uptrend intact' : 'below VWAP — INTRADAY BREAKDOWN'));
    const spyContext = {
      meltupRegime: spyMeltupRegime,
      upDaysLast5: spyD1?.upDaysLast5 ?? null,
      spyAboveVwap,
    };

    const earningsMap = await fetchEarningsDates(tickers);

    const [sectorBias, vix, ...tickerData] = await Promise.all([
      fetchSectorBias(spyChangePct),
      fetchVIX(),
      // v8.2.0 — D1 cache hit reuses universe-pass data; cache miss falls back
      // to a fresh fetchD1 call. M5 is always fresh (intraday).
      ...tickers.map(async t => {
        const cachedD1 = d1Cache[t];
        const [d1, m5] = await Promise.all([
          cachedD1 && !cachedD1.error ? Promise.resolve(cachedD1) : fetchD1(t),
          fetchM5(t),
        ]);
        const cand = (candidates || []).find(c => c.symbol === t);
        const earningsDate = earningsMap[t] || cand?.earningsDate || null;
        const earningsInfo = checkEarnings(earningsDate, d1.maxRecentGap);
        const score = (d1.error || m5.error) ? null : scoreStock(d1, m5, spyChangePct, earningsInfo, etCtx, spyContext);
        return { ticker: t, d1, m5, earningsInfo, score };
      })
    ]);

    // v8.0.0 — SPY-at-HOD/LOD block (Phase-1 Rule 9)
    // When SPY is within 0.20% of HOD, report-generation step must render
    // only conditional-pullback entries; no "buy now" or breakout entries on
    // a chase day. Mirror at LOD for short days.
    const spyHodBlock = (spyD1 && !spyD1.error && spyD1.dayHigh && spyD1.price)
      ? ((spyD1.dayHigh - spyD1.price) / spyD1.dayHigh) <= 0.002
      : false;
    const spyLodBlock = (spyD1 && !spyD1.error && spyD1.dayLow && spyD1.price)
      ? ((spyD1.price - spyD1.dayLow) / spyD1.dayLow) <= 0.002
      : false;

    window._scan = {
      version: VERSION, etCtx,
      spyChg: spyChangePct,
      spyD1, spyM5,
      // v8.0.0 — SPY chase-risk flags
      spyHodBlock, spyLodBlock,
      // v8.3.0 — melt-up regime exposed on the scan for inspection / brief generation
      spyMeltupRegime, spyContext,
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
      // v7.2.0 — SPY-level volume read for the daily-bias block
      if (sd1.dailyRVol != null) {
        lines.push('  📊 SPY Volume — Daily RVol ' + sd1.dailyRVol + '× (' + sd1.dailyRVolLabel + ') ' + volEmoji(sd1.dailyRVol));
      }
      // v8.0.0 — SPY-at-HOD/LOD chase-risk warning (Phase-1 Rule 9)
      if (s.spyHodBlock) {
        lines.push('  ⛔ SPY within 0.20% of HOD — pullback-only entries; no breakout adds today.');
      } else if (s.spyLodBlock) {
        lines.push('  ⛔ SPY within 0.20% of LOD — bounce-to-VWAP short entries only; no breakdown adds today.');
      }
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
    // v8.2.0 — adds SLOW_BLEED_SHORT
    // v8.3.0 — adds WATCHLIST_REACTOR (unqualified earnings reactors) and
    //          WATCHLIST_MELTUP_SHORT (weak shorts in melt-up regime)
    const scored = s.tickers.filter(t => t.score && t.score.direction !== 'NEUTRAL');
    // v8.4.0 Tier-2 — rank the two headline buckets on EDGESCORE (entry quality +
    // trend-age + RS strength + R:R + capped confirmations), with compositeScoreV8
    // as the tie-break. edgeScore already integrates the anti-chase factors that
    // compositeScoreV8 stacked (extension, HOD proximity, trend age, R:R) but does
    // so additively and without the redundant-confluence inflation in the V8 base,
    // so it orders clean pullback entries above extended/stale ones directly.
    const _rankKey = (s) => (s.edgeScore || 0) * 1000 + (s.compositeScoreV8 || 0);
    const cleanSwings    = scored.filter(t => t.score.bucket === 'CLEAN_SWING').sort((a,b) => _rankKey(b.score) - _rankKey(a.score));
    const cleanDays      = scored.filter(t => t.score.bucket === 'CLEAN_DAY').sort((a,b) => _rankKey(b.score) - _rankKey(a.score));
    const slowBleed      = scored.filter(t => t.score.bucket === 'SLOW_BLEED_SHORT').sort((a,b) => b.score.compositeScoreV8 - a.score.compositeScoreV8);
    const earningsR      = scored.filter(t => t.score.bucket === 'EARNINGS_REACTOR').sort((a,b) => b.score.compositeScore - a.score.compositeScore);
    const watchReactor   = scored.filter(t => t.score.bucket === 'WATCHLIST_REACTOR').sort((a,b) => b.score.compositeScore - a.score.compositeScore);
    const watchMeltup    = scored.filter(t => t.score.bucket === 'WATCHLIST_MELTUP_SHORT').sort((a,b) => b.score.compositeScoreV8 - a.score.compositeScoreV8);
    // v8.4.0 Tier-1 fix #2 — low-R:R setups routed out of the publishable buckets
    const watchLowRR     = scored.filter(t => t.score.bucket === 'WATCHLIST_LOWRR').sort((a,b) => b.score.compositeScoreV8 - a.score.compositeScoreV8);
    const counterT       = scored.filter(t => t.score.bucket === 'COUNTER_TREND').sort((a,b) => b.score.compositeScore - a.score.compositeScore);
    const waits          = scored.filter(t => t.score.bucket === 'WAIT').sort((a,b) => b.score.compositeScore - a.score.compositeScore);

    function renderSetup(t, i) {
      const sc = t.score, d1 = t.d1, m5 = t.m5;
      lines.push('');
      lines.push('  #' + (i+1) + ' ' + t.ticker + ' — ' + sc.direction + ' | ' + sc.conviction + ' | Edge ' + sc.edgeScore + ' | ScoreV8 ' + sc.compositeScoreV8 + ' | Bucket ' + sc.bucket);
      lines.push('     Price $' + d1.price + ' (' + (d1.changePct >= 0 ? '+' : '') + d1.changePct + '%) | RS ' + sc.rsScore + '%');
      lines.push('     M5 VWAP $' + (m5?.vwap || 'n/a') + ' ' + (m5?.aboveVwap === true ? '✅' : m5?.aboveVwap === false ? '⛔' : ''));
      lines.push('     HA ' + d1.haTrend + ' | ATR(20) $' + d1.atr20);
      // v8.5.0 — daily MA proximity / cluster gate (always rendered per setup)
      if (sc.maNote) lines.push('     🧭 Daily MA: ' + sc.maNote
        + (sc.maProximity && sc.maProximity.length
           ? '  [' + sc.maProximity.map(m => m.ma + ' ' + (m.distAtr >= 0 ? '+' : '') + m.distAtr + 'ATR').join(', ') + ']'
           : ''));
      // v7.2.0 — inline volume block
      const volBits = [];
      if (sc.paceRVol != null) volBits.push(`Pace RVol ${sc.paceRVol}× (${sc.paceRVolLabel}) ${volEmoji(sc.paceRVol)}`);
      if (d1.dailyRVol != null) volBits.push(`Daily RVol ${d1.dailyRVol}× (${d1.dailyRVolLabel})`);
      if (m5?.preMktVolRatio != null && m5.preMktDayCount >= 2) {
        volBits.push(`Pre-mkt ${m5.preMktVolRatio}× (${m5.preMktVolLabel}) ${volEmoji(m5.preMktVolRatio)}`);
      }
      if (volBits.length) lines.push('     📊 Volume — ' + volBits.join(' | '));
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
          const adj = l.volAdjusted ? ` (vol→${l.label})` : '';
          const r2  = l.slopeQuality != null && l.slopeQuality < 1 ? ' R²=' + l.slopeQuality : '';
          const brk = l.recentlyBroken ? ' ← ' + l.breakDirection : '';
          // v7.2.0 — inline volume info
          const tv = l.touchVolRatio != null ? ` touchVol=${l.touchVolRatio}×` : '';
          const bv = l.recentlyBroken && l.breakVolRatio != null ? ` brkVol=${l.breakVolRatio}×` : '';
          lines.push('     ALGO: ' + l.style + ' ' + l.type + ' $' + l.level + ' (' + l.touches + 't' + r2 + ')' + tag + adj + brk + tv + bv);
        });
      }
      if (d1.anchoredVWAPs) {
        const av = d1.anchoredVWAPs;
        if (av.from52wHigh)   lines.push('     aVWAP from 52w-HIGH date (' + av.anchors['52wHigh']  + '): $' + av.from52wHigh);
        if (av.from52wLow)    lines.push('     aVWAP from 52w-LOW  date (' + av.anchors['52wLow']   + '): $' + av.from52wLow);
        if (av.fromRecentGap) lines.push('     aVWAP from RECENT-GAP    (' + av.anchors.recentGap   + '): $' + av.fromRecentGap);
        if (av.fromBreakout)  lines.push('     aVWAP from BREAKOUT      (' + av.anchors.breakout    + '): $' + av.fromBreakout);
      }
      lines.push('     Entry-A (pullback): ' + sc.entryNote);
      // v8.0.0 — dual entry trigger (Phase-1 Rule 2)
      if (sc.direction === 'LONG' && sc.breakoutLong != null) {
        lines.push('     Entry-B (breakout): 5m close > $' + sc.breakoutLong + ' with bar vol ≥ 1.5× session avg');
      } else if (sc.direction === 'SHORT' && sc.breakoutShort != null) {
        lines.push('     Entry-B (breakdown): 5m close < $' + sc.breakoutShort + ' with bar vol ≥ 1.5× session avg');
      }
      lines.push('     Stop:  ' + sc.stopNote);
      // v8.0.0 — emit both day-trade T1 (0.5×ATR) and swing T1 (1×ATR) plus original algo target
      if (sc.t1DaySynthetic != null && sc.t1SwingSynthetic != null) {
        lines.push('     T1 (day, 0.5×ATR) $' + sc.t1DaySynthetic + ' | T1 (swing, 1×ATR) $' + sc.t1SwingSynthetic);
      }
      if (sc.rrT1) {
        lines.push('     T1 algo: $' + sc.rrT1 + ' (' + sc.rrT1Source + ')' + (sc.rrT2 ? ' | T2 $' + sc.rrT2 : '') + ' | R:R ' + sc.rrRatio + ':1' + (sc.poorRR ? ' ⚠️ POOR' : ''));
      }
      // v8.0.0 — conviction penalties + CLEAN_DAY gates (Phase-1 Rule 4 + 5)
      const penBits = [];
      if (sc.extensionPenalty != null && sc.extensionPenalty < 1.0) penBits.push('extension ×' + sc.extensionPenalty);
      if (sc.hodProximityPenalty != null && sc.hodProximityPenalty < 1.0) penBits.push('HOD-prox ×' + sc.hodProximityPenalty);
      if (sc.stopQualityFactor != null && sc.stopQualityFactor < 1.0) penBits.push('stop-qual ×' + sc.stopQualityFactor);
      if (penBits.length) lines.push('     Penalties: ' + penBits.join(' | ') + ' → ScoreV8 ' + sc.compositeScoreV8);
      if (sc.bucket === 'CLEAN_DAY') {
        const gateP = sc.cleanDayPaceOk ? '✅' : '❌';
        const gateC = sc.cleanDayConfluencesOk ? '✅' : '❌';
        lines.push('     CLEAN_DAY gates: Pace≥1.4× ' + gateP + ' | Confluences≥3 ' + gateC + ' | Catalyst-verified (external) ⏳');
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

    if (slowBleed.length > 0) {
      lines.push('');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('▶ SLOW BLEED SHORTS (v8.2.0 — second-leg breakdowns from universe pass)');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      slowBleed.slice(0, 5).forEach(renderSetup);
    }

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

    // v8.3.0 — quality-bar watchlists
    if (watchReactor.length > 0) {
      lines.push('');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('▶ WATCHLIST — UNQUALIFIED EARNINGS REACTORS (v8.3.0 quality bar fail)');
      lines.push('  Failed ≥2/3 of: cleanCount≥4 | paceRVol≥2.0 | inst. break (3+ touch, 1.5× vol)');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      watchReactor.slice(0, 5).forEach(renderSetup);
    }
    if (watchMeltup.length > 0) {
      lines.push('');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('▶ WATCHLIST — WEAK SHORTS IN MELT-UP (v8.3.0 raise-the-bar fail)');
      lines.push('  Failed ≥1 of: cleanCount≥4 | 6+ days below SMA20 | ≥10% off 52w high');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      watchMeltup.slice(0, 5).forEach(renderSetup);
    }
    if (watchLowRR.length > 0) {
      lines.push('');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('▶ WATCHLIST — BELOW R:R FLOOR (v8.4.0 — R:R < 1.5:1 or no target)');
      lines.push('  Not publishable as Top setups. Need a better entry (closer to support)');
      lines.push('  or a higher target before the risk/reward clears 1.5:1.');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      watchLowRR.slice(0, 5).forEach(renderSetup);
    }

    return lines.join('\n');
  }

  return {
    VERSION, run, analyze, summary,
    scoreStock,
    fetchD1, fetchM5, fetchVIX, fetchSectorBias,
    computeAlgoLinesV7, findPriorSwingLevels, computeATR, computeAnchoredVWAP,
    getETContext, getHODProximity, getM5TrendState,
    // v7.2.0 — exposed volume helpers
    computeAvgVolume, classifyVolRatio, sessionElapsedFraction,
    // v7.3.0 — earnings coverage exports (so callers can inspect / override)
    fetchEarningsCalendar, EARNINGS_REACTOR_WATCHLIST, MAG7, SEMI_WATCHLIST,
    // v8.2.0 — universe exports (so callers can re-run / inspect / override)
    fetchD1Universe, prescreenUniverse, STATIC_UNIVERSE, CONSTITUENTS_VERSION,
  };
})();

console.log('[RDT ' + window.RDT.VERSION + '] ✅ Loaded');
