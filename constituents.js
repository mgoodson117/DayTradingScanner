/**
 * constituents.js — Static universe for the Day Trading Scanner
 * ─────────────────────────────────────────────────────────────────────────────
 * Companion file to market_data.js. Load this BEFORE the scanner so it is
 * available as window.RDT_CONSTITUENTS when market_data.js runs.
 *
 *   <script src="constituents.js"></script>
 *   <script src="market_data.js"></script>
 *
 * Or via the same CDN as the scanner:
 *   https://cdn.jsdelivr.net/gh/mgoodson117/DayTradingScanner@v8.2.0/constituents.js
 *
 * WHY THIS EXISTS
 * ───────────────
 * Yahoo's `day_gainers / day_losers / most_actives` screeners surface stocks
 * that have already moved >2–5% today. They are excellent at finding fresh
 * catalyst-driven names but structurally blind to the second-week-of-a-breakdown
 * setups that dominated the top 30 short swings in the May 2026 backtest
 * (ZTS, TSCO, GEHC, COR, SBAC, CPB, ... — defensive/staples names quietly
 * grinding lower, never gapping enough to surface on a single-day screen).
 *
 * The scanner now scans this static universe daily on top of the screener-driven
 * candidates. Catalyst hunt + structural hunt = full coverage.
 *
 * MAINTENANCE
 * ───────────
 * S&P 500 + Nasdaq 100 constituents change roughly 5–15 names per quarterly
 * rebalance (third Friday of March / June / September / December). Edit the
 * SP500 / NQ100 arrays on rebalance dates, bump LAST_UPDATED, and tag a new
 * scanner version (market_data.js VERSION bump too, so the CDN cache picks
 * up the change).
 *
 * The `universe` field is the deduplicated union of both indices — that is
 * what the scanner consumes.
 *
 * Liquidity floor (≥1M shares avg daily volume) is enforced in market_data.js,
 * not here. This file is purely the ticker list.
 */

(function () {
  'use strict';

  const LAST_UPDATED = '2026-05-16';

  // S&P 500 + Nasdaq 100 union as of LAST_UPDATED.
  // ~525 unique tickers. Hardcoded so the scanner has no network dependency
  // for the universe boundary. Edit on rebalance dates.
  const UNIVERSE = [
    'A', 'AAPL', 'ABBV', 'ABNB', 'ABT', 'ACGL', 'ACN', 'ADBE', 'ADI', 'ADM',
    'ADP', 'ADSK', 'AEE', 'AEP', 'AES', 'AFL', 'AIG', 'AIZ', 'AJG', 'AKAM',
    'ALB', 'ALGN', 'ALL', 'ALLE', 'AMAT', 'AMCR', 'AMD', 'AMGN', 'AMP', 'AMT',
    'AMZN', 'ANET', 'ANSS', 'AON', 'AOS', 'APA', 'APD', 'APH', 'APO', 'APP',
    'APTV', 'ARE', 'ARM', 'ASML', 'ATO', 'AVB', 'AVGO', 'AVY', 'AWK', 'AXON',
    'AXP', 'AZN', 'AZO', 'BA', 'BAC', 'BALL', 'BAX', 'BBY', 'BDX', 'BEN',
    'BG', 'BIIB', 'BK', 'BKNG', 'BKR', 'BLK', 'BLDR', 'BMY', 'BR', 'BRK-B',
    'BRO', 'BSX', 'BWA', 'BX', 'BXP', 'C', 'CAG', 'CAH', 'CARR', 'CAT',
    'CB', 'CBOE', 'CBRE', 'CCEP', 'CCI', 'CCL', 'CDNS', 'CDW', 'CE', 'CEG',
    'CF', 'CFG', 'CHD', 'CHRW', 'CHTR', 'CI', 'CINF', 'CL', 'CLX', 'CMCSA',
    'CME', 'CMG', 'CMI', 'CMS', 'CNC', 'CNP', 'COF', 'COIN', 'COO', 'COP',
    'COR', 'COST', 'CPAY', 'CPB', 'CPRT', 'CPT', 'CRL', 'CRM', 'CRWD', 'CSCO',
    'CSGP', 'CSX', 'CTAS', 'CTLT', 'CTRA', 'CTSH', 'CTVA', 'CTXS', 'CVS', 'CVX',
    'CZR', 'D', 'DAL', 'DASH', 'DAY', 'DD', 'DDOG', 'DE', 'DECK', 'DELL',
    'DFS', 'DG', 'DGX', 'DHI', 'DHR', 'DIS', 'DLR', 'DLTR', 'DOC', 'DOV',
    'DOW', 'DPZ', 'DRI', 'DTE', 'DUK', 'DVA', 'DVN', 'DXCM', 'EA', 'EBAY',
    'ECL', 'ED', 'EFX', 'EG', 'EIX', 'EL', 'ELV', 'EMN', 'EMR', 'ENPH',
    'EOG', 'EPAM', 'EQIX', 'EQR', 'EQT', 'ES', 'ESS', 'ETN', 'ETR', 'EVRG',
    'EW', 'EXC', 'EXE', 'EXPD', 'EXPE', 'EXR', 'F', 'FANG', 'FAST', 'FCX',
    'FDS', 'FDX', 'FE', 'FFIV', 'FI', 'FICO', 'FIS', 'FITB', 'FMC', 'FOX',
    'FOXA', 'FRT', 'FSLR', 'FTNT', 'FTV', 'GD', 'GDDY', 'GE', 'GEHC', 'GEN',
    'GEV', 'GFS', 'GILD', 'GIS', 'GL', 'GLW', 'GM', 'GNRC', 'GOOG', 'GOOGL',
    'GPC', 'GPN', 'GRMN', 'GS', 'GWW', 'HAL', 'HAS', 'HBAN', 'HCA', 'HD',
    'HES', 'HIG', 'HII', 'HLT', 'HOLX', 'HON', 'HPE', 'HPQ', 'HRL', 'HSIC',
    'HST', 'HSY', 'HUBB', 'HUM', 'HWM', 'IBM', 'ICE', 'IDXX', 'IEX', 'IFF',
    'ILMN', 'INCY', 'INTC', 'INTU', 'INVH', 'IP', 'IPG', 'IQV', 'IR', 'IRM',
    'ISRG', 'IT', 'ITW', 'IVZ', 'J', 'JBHT', 'JBL', 'JCI', 'JKHY', 'JNJ',
    'JNPR', 'JPM', 'K', 'KDP', 'KEY', 'KEYS', 'KHC', 'KIM', 'KKR', 'KLAC',
    'KMB', 'KMI', 'KMX', 'KO', 'KR', 'KVUE', 'L', 'LDOS', 'LEN', 'LH',
    'LHX', 'LIN', 'LKQ', 'LLY', 'LMT', 'LNT', 'LOW', 'LRCX', 'LULU', 'LUV',
    'LVS', 'LW', 'LYB', 'LYV', 'MA', 'MAA', 'MAR', 'MARA', 'MAS', 'MCD',
    'MCHP', 'MCK', 'MCO', 'MDLZ', 'MDB', 'MDT', 'MELI', 'MET', 'META', 'MGM',
    'MHK', 'MKC', 'MKTX', 'MLM', 'MMC', 'MMM', 'MNST', 'MO', 'MOH', 'MOS',
    'MPC', 'MPWR', 'MRK', 'MRNA', 'MRVL', 'MS', 'MSCI', 'MSFT', 'MSI', 'MTB',
    'MTCH', 'MTD', 'MU', 'NCLH', 'NDAQ', 'NDSN', 'NEE', 'NEM', 'NFLX', 'NI',
    'NKE', 'NOC', 'NOW', 'NRG', 'NSC', 'NTAP', 'NTRS', 'NUE', 'NVDA', 'NVR',
    'NWS', 'NWSA', 'NXPI', 'O', 'ODFL', 'OKE', 'OMC', 'ON', 'ONON', 'ORCL',
    'ORLY', 'OTIS', 'OXY', 'PANW', 'PARA', 'PAYC', 'PAYX', 'PCAR', 'PCG', 'PDD',
    'PEG', 'PEP', 'PFE', 'PFG', 'PG', 'PGR', 'PH', 'PHM', 'PINS', 'PKG',
    'PLD', 'PLTR', 'PM', 'PNC', 'PNR', 'PNW', 'PODD', 'POOL', 'PPG', 'PPL',
    'PRU', 'PSA', 'PSX', 'PTC', 'PWR', 'PYPL', 'QCOM', 'QRVO', 'RBLX', 'RCL',
    'REG', 'REGN', 'RF', 'RJF', 'RL', 'RMD', 'ROK', 'ROL', 'ROP', 'ROST',
    'RSG', 'RTX', 'RVTY', 'SBAC', 'SBUX', 'SCHW', 'SHW', 'SJM', 'SLB', 'SMCI',
    'SNA', 'SNOW', 'SNPS', 'SO', 'SOLV', 'SPG', 'SPGI', 'SRE', 'STE', 'STLD',
    'STT', 'STX', 'STZ', 'SWK', 'SWKS', 'SYF', 'SYK', 'SYY', 'T', 'TAP',
    'TDG', 'TDY', 'TEAM', 'TECH', 'TEL', 'TER', 'TFC', 'TFX', 'TGT', 'TJX',
    'TMO', 'TMUS', 'TPL', 'TPR', 'TRGP', 'TRMB', 'TROW', 'TRV', 'TSCO', 'TSLA',
    'TSN', 'TT', 'TTD', 'TTWO', 'TXN', 'TXT', 'TYL', 'UAL', 'UBER', 'UDR',
    'UHS', 'ULTA', 'UNH', 'UNP', 'UPS', 'URI', 'USB', 'V', 'VICI', 'VLO',
    'VLTO', 'VMC', 'VRSK', 'VRSN', 'VRTX', 'VST', 'VTR', 'VTRS', 'VZ', 'WAB',
    'WAT', 'WBA', 'WBD', 'WDC', 'WEC', 'WELL', 'WFC', 'WM', 'WMB', 'WMT',
    'WRB', 'WRK', 'WST', 'WTW', 'WY', 'WYNN', 'XEL', 'XOM', 'XYL', 'YUM',
    'ZBH', 'ZBRA', 'ZM', 'ZS', 'ZTS',
  ];

  // Dedupe + sort for stability (idempotent if UNIVERSE is already deduped).
  const universe = [...new Set(UNIVERSE)].sort();

  window.RDT_CONSTITUENTS = {
    version: LAST_UPDATED,
    universe: universe,
    count: universe.length,
  };

  if (typeof console !== 'undefined' && console.log) {
    console.log('[RDT constituents ' + LAST_UPDATED + '] Loaded ' + universe.length + ' tickers.');
  }
})();
