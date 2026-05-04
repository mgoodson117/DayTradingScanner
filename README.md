# DayTradingScanner

Browser-injected day & swing trading scanner. Pulls D1 + M5 data from Yahoo Finance APIs, computes RS/RW vs SPY, sector bias, Mag 7 breadth, algo lines, anchored VWAPs, ATR-based projections, and earnings flags.

## Usage

In a Yahoo Finance tab (DevTools console), run:

```js
const src = await (await fetch('https://cdn.jsdelivr.net/gh/mgoodson117/DayTradingScanner@main/market_data.js')).text();
new Function(src)();

window.RDT.run().then(() => console.log(window.RDT.summary()));
```

The `new Function(src)()` form executes the script in the global scope so `window.RDT` is set, just like a `<script>` tag would.

### Pinning to a version

- `@main` — latest commit on main (auto-updates)
- `@v7.1.0` — pinned tag (recommended for scheduled production runs)

### Versions

**v7.1.0** (current — tagged 2026-05-04)
- SPY change-percent now sourced from `spyD1.changePct` (was: stale quote endpoint that occasionally returned 0).
- Counter-trend penalty now fires correctly when SPY moves <0.5% but the individual stock has RS/RW ≥5%.
- "Just reported" earnings (`daysUntil ∈ [-3, 0]`) now downgrade conviction the same way as "earnings within 7 days" did. Closes the IDCC-class gap where a stock that reported pre-market today still scored HIGH.
- `maxRecentGap.pct` preserves sign and `direction: 'UP' | 'DOWN'`. The flag now reads "GAP DOWN -14% today" instead of "GAP +6.3% today" when the gap was actually down.
- New range fields per ticker: `low30d`, `low90d`, `low180d`, `high30d`, `high90d`, `high180d`. Useful when the strict 52-week low/high is too stale to be tradeably relevant.
- `score.bucket`: one of `CLEAN_SWING` / `CLEAN_DAY` / `EARNINGS_REACTOR` / `COUNTER_TREND` / `WAIT` / `NEUTRAL`. The summary now ranks within buckets — clean swings first, earnings reactors capped at 5, counter-trend section separate.
- `score.swingCandidate`: boolean, true only when no earnings ±14d AND no recent gap AND R:R ≥2 AND RS sustained.
- Mag 7 block rendered as a markdown table.
- aVWAP labels distinguished from price labels: "52w low: $X" (the actual price) is separate from "aVWAP from 52w-LOW date (anchored [date]): $Y" (volume-weighted average since that date).

**v7.0.0**
- Strict algo lines (≥3 touches, no earnings-gap anchor pairs, hard-exclude projection-only).
- Horizontal level weighting by touch count (MINOR/MAJOR/KEY).
- Prior swing highs/lows arrays.
- Anchored VWAPs from 52w H/L, recent gap, breakout pivot.
- ATR(20) + breakout-pivot projections (replaces synthetic 1R/2R extensions).

## Strict v7 algo line method

- 90-day daily lookback
- Sloped lines require ≥3 touches within 0.5%
- Anchor pairs that span ≥5% overnight gap are rejected (no slope-fits across earnings)
- Projection-only lines (level beyond actual 90-day H/L) are hard-excluded
- Each line carries `slopeQuality` (R² of fit) and `recencyScore`

## Horizontal level weighting

- 2 touches → MINOR (1.0)
- 3 touches → MAJOR (1.5)
- 4+ touches → KEY (2.0)

## Returns per ticker

Each ticker's `d1` block includes:
- SMAs (20/50/100/200), HA trend, ATR(20)
- `algoLines[]` — sloped + horizontal with strict validation
- `priorSwingHighs[]` / `priorSwingLows[]` — last 5 pivots each
- `anchoredVWAPs` — from 52w high, 52w low, most recent ≥5% gap, breakout pivot
- `atrTargets.{T1, T2}` — breakout pivot + 1×ATR / 2×ATR (or current price for ATH)
- `maxRecentGap` — largest overnight gap in last 5 sessions

## License

MIT
