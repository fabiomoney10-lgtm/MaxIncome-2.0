# MaxIncome Radar — Binance Spot (read-only)

## Product decisions
- Market: Binance Spot.
- Universe: dynamically filtered USDT pairs.
- Signal frequency: selective.
- Execution: manual by the user; this module never submits orders.

## Current implementation milestone
- `src/binance-spot-client.js`: public REST access for exchange information, 24h tickers, book tickers and closed klines (5m, 15m, 1h, 4h, 1d).
- `src/binance-universe-scanner.js`: filters active Spot USDT symbols by 24h quote volume and bid/ask spread; returns ranked candidates.
- `GET /api/radar/universe`: authenticated, read-only endpoint. Requires the existing read token.
- Scanner defaults: minimum 24h quote volume 1,000,000 USDT; maximum spread 0.15%; up to 50 candidates. These are initial engineering defaults, not proven trading thresholds.

## Not implemented yet
- Multi-timeframe technical analysis and market regime detection.
- Signal generation, entry/stop/target calculation, expiry and invalidation.
- Persistent signal history and outcome measurement in Supabase.
- WebSocket stream, reconnect/resynchronization and background worker.
- UI for Radar and notification delivery.
- Backtesting, walk-forward validation and paper forward testing.

## Safety
- No Binance API key is needed for public market data.
- No private account endpoints are called.
- No order placement, account transfer or withdrawal code is included.
- A candidate is not a trade signal. Do not treat scanner ranking as a buy recommendation.
- Do not deploy to the existing Render service until the new module is tested and the target workspace/service is explicitly confirmed.
