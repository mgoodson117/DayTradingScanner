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
- `@v7.0.0` — pinned tag (recommended for scheduled production runs)

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
