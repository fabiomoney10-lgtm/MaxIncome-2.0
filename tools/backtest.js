'use strict';

const { runBacktest } = require('../src/backtest');

const BASE_URL = 'https://api.bybit.com';
const SYMBOLS = (process.env.BACKTEST_SYMBOLS || 'XRPUSDT,BTCUSDT,ETHUSDT,SOLUSDT')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const DAYS = Math.max(30, Math.min(365, Number(process.env.BACKTEST_DAYS || 180)));
const INTERVALS = [{ name: '15', ms: 15 * 60 * 1000 }, { name: '60', ms: 60 * 60 * 1000 }];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchKlines(symbol, interval, intervalMs, days) {
  const now = Date.now();
  const earliest = now - days * 86400000;
  let end = now;
  const candles = new Map();
  let pages = 0;
  while (end > earliest && pages < 500) {
    const query = new URLSearchParams({
      category: 'spot', symbol, interval, limit: '1000', end: String(end)
    });
    const response = await fetch(BASE_URL + '/v5/market/kline?' + query.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`Bybit HTTP ${response.status} em ${symbol}/${interval}`);
    const payload = await response.json();
    if (payload.retCode !== 0) throw new Error(`Bybit ${payload.retCode}: ${payload.retMsg}`);
    const rows = payload.result && payload.result.list || [];
    if (!rows.length) break;
    let oldest = Infinity;
    for (const row of rows) {
      const start = Number(row[0]);
      if (!Number.isFinite(start) || start < earliest || start + intervalMs > now) continue;
      oldest = Math.min(oldest, start);
      candles.set(start, {
        start, open: Number(row[1]), high: Number(row[2]), low: Number(row[3]),
        close: Number(row[4]), volume: Number(row[5])
      });
    }
    pages += 1;
    if (!Number.isFinite(oldest) || oldest <= earliest || rows.length < 1000) break;
    end = oldest - 1;
    await sleep(130);
  }
  return [...candles.values()].sort((a, b) => a.start - b.start);
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    source: 'Bybit public spot market data; no authenticated endpoints',
    daysRequested: DAYS,
    quoteCurrency: 'USDT (P&L remains in USDT; no invented historical USD/BRL conversion)',
    symbols: {}
  };
  for (const symbol of SYMBOLS) {
    process.stdout.write(`Baixando histórico ${symbol}...\n`);
    const [m15, h1] = await Promise.all([
      fetchKlines(symbol, '15', INTERVALS[0].ms, DAYS),
      fetchKlines(symbol, '60', INTERVALS[1].ms, DAYS)
    ]);
    const options = { candles15m: m15, candles1h: h1 };
    report.symbols[symbol] = {
      baseline: runBacktest({ ...options, strategy: 'baseline' }),
      enhanced: runBacktest({ ...options, strategy: 'enhanced' })
    };
    const b = report.symbols[symbol].baseline.outOfSample;
    const e = report.symbols[symbol].enhanced.outOfSample;
    process.stdout.write(
      `${symbol}: base OOS ${b.trades} trades, ${b.netPnl} USDT, WR ${b.winRatePct}% | ` +
      `novo OOS ${e.trades} trades, ${e.netPnl} USDT, WR ${e.winRatePct}%\n`
    );
  }
  process.stdout.write('\nRELATÓRIO COMPLETO (JSON)\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main().catch(error => {
  process.stderr.write('Backtest interrompido: ' + error.message + '\n');
  process.exitCode = 1;
});
