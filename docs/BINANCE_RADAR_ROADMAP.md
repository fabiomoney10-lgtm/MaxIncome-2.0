# MaxIncome Radar — Binance Spot (read-only)

## Product decisions
- Market: Binance Spot.
- Universe: dynamically filtered USDT pairs.
- Signal frequency: selective; the first threshold is score 85/100.
- Execution: manual by the user; this application never submits orders.

## Implemented
- `src/binance-spot-client.js`: public REST access for exchange information, 24h tickers, book tickers and closed klines (5m, 15m, 1h, 4h, 1d).
- `src/binance-universe-scanner.js`: filters active Spot USDT pairs by 24h quote volume and bid/ask spread; ranks candidates.
- `src/binance-radar-analysis.js`: EMA 20/50, RSI, ATR, volume ratio, multi-timeframe trend confirmation, BTC 1h/4h context, ATR stop, 2:1 target, stale-price rejection and signal expiry.
- `src/binance-radar-engine.js`: analyzes up to 10 ranked candidates with bounded concurrency.
- `radar-server.js`: independent Express service; public health route and token-protected Radar endpoints.
- `public/radar.html`: private read-token input, signals table and browser-side 60-second polling while the page remains open.
- `GET /api/radar/universe` and `GET /api/radar/signals`: read-only endpoints.
- Both repository CI workflows passed on code commit `8f51bddf806e505b7ec8d3a15054f472b689483d`, including tests and syntax checks. After dependency upgrades, Render built and started commit `3fff90d4ea579b536def10a62883578da48fe38b` successfully; a fresh `npm install` audit reported 0 vulnerabilities. CI has not yet reported against that dependency-upgrade commit.
- Standalone Render service: `MaxIncome-Radar`, Frankfurt, Free plan, branch `feature/binance-radar-signals`, live deploy commit `3fff90d4ea579b536def10a62883578da48fe38b`.

## Initial engineering thresholds (not performance-validated)
- Minimum 24h quote volume: 1,000,000 USDT.
- Maximum bid/ask spread: 0.15%.
- Candidate analysis limit: 10.
- Minimum signal score: 85/100.
- Entry must remain within 0.5% of the last closed 15m candle.
- Stop is 1.5 × 15m ATR; target is 2 × stop distance.
- These values are starting filters, not evidence of profitability or a promised win rate.

## Remaining before calling this production-ready
- Verify the live HTTP health endpoint and perform a live authenticated scanner request from a client network.
- Commit a reproducible dependency lockfile and keep npm audit checks in CI; the latest Render build reported 0 vulnerabilities after upgrading Express and pg.
- Persist signals, snapshots and outcomes in Supabase with a reviewed migration and least-privilege access.
- Add server-side scheduling/streaming, reconnect and rate-limit handling. Current 60-second polling runs only while the browser page is open.
- Add alert delivery and signal lifecycle (new, active, expired, invalidated).
- Add historical backtests, walk-forward testing, realistic fees/slippage and paper forward testing.
- Validate score calibration and thresholds on out-of-sample data before relying on signals.

## Safety and operations
- Public market data only; no Binance API key is required.
- No private account endpoints, wallet reads, order placement, transfer or withdrawal code.
- A scanner candidate is not a signal; a signal is not a guarantee or an instruction to trade.
- The Render service is on the Free plan and may spin down after inactivity; it is not a 24/7 always-on worker.
- Auto-deploy is disabled. Future branch commits will not reach the live service until tests pass and a deploy is deliberately triggered.
- The existing `MaxIncome-2.0` service and legacy `maxincome-backend` were not modified or deployed by this Radar rollout.
