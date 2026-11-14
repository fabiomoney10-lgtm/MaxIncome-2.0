'use strict';

const fs = require('node:fs');
const { runBacktest } = require('../src/backtest');

const BYBIT_BASE_URL = 'https://api.bybit.com';
const BINANCE_BASE_URL = 'https://data-api.binance.vision';
const SYMBOLS = (process.env.BACKTEST_SYMBOLS || 'XRPUSDT,BTCUSDT,ETHUSDT,SOLUSDT')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const DAYS = Math.max(30, Math.min(365, Number(process.env.BACKTEST_DAYS || 180)));
const INTERVALS = [{ name: '15', ms: 15 * 60 * 1000 }, { name: '60', ms: 60 * 60 * 1000 }];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchBybitKlines(symbol, interval, intervalMs, days) {
  const now = Date.now();
  const earliest = now - days * 86400000;
  let end = now;
  const candles = new Map();
  let pages = 0;
  while (end > earliest && pages < 500) {
    const query = new URLSearchParams({
      category: 'spot', symbol, interval, limit: '1000', end: String(end)
    });
    const response = await fetch(BYBIT_BASE_URL + '/v5/market/kline?' + query.toString(), {
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

async function fetchBinanceKlines(symbol, interval, intervalMs, days) {
  const now = Date.now();
  const earliest = now - days * 86400000;
  const binanceInterval = interval === '15' ? '15m' : '1h';
  let startTime = earliest;
  const candles = new Map();
  let pages = 0;
  while (startTime < now && pages < 500) {
    const query = new URLSearchParams({
      symbol, interval: binanceInterval, limit: '1000', startTime: String(Math.floor(startTime))
    });
    const response = await fetch(BINANCE_BASE_URL + '/api/v3/klines?' + query.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`Binance HTTP ${response.status} em ${symbol}/${binanceInterval}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error(`Resposta inválida da Binance em ${symbol}/${binanceInterval}`);
    if (!rows.length) break;
    let newest = -Infinity;
    for (const row of rows) {
      const start = Number(row[0]);
      if (!Number.isFinite(start) || start < earliest || start + intervalMs > now) continue;
      newest = Math.max(newest, start);
      candles.set(start, {
        start, open: Number(row[1]), high: Number(row[2]), low: Number(row[3]),
        close: Number(row[4]), volume: Number(row[5])
      });
    }
    pages += 1;
    if (!Number.isFinite(newest) || newest < startTime || rows.length < 1000) break;
    const nextStart = newest + intervalMs;
    if (nextStart <= startTime) throw new Error(`Paginação Binance sem avanço em ${symbol}/${binanceInterval}`);
    startTime = nextStart;
    await sleep(130);
  }
  return [...candles.values()].sort((a, b) => a.start - b.start);
}

async function fetchMarketHistory(symbol, days) {
  const intervals = [{ name: '15', ms: 15 * 60 * 1000 }, { name: '60', ms: 60 * 60 * 1000 }];
  try {
    const [m15, h1] = await Promise.all(intervals.map(x => fetchBybitKlines(symbol, x.name, x.ms, days)));
    if (m15.length < 150 || h1.length < 60) throw new Error('Histórico Bybit insuficiente para o backtest.');
    return { m15, h1, source: 'BYBIT_SPOT_MAINNET' };
  } catch (bybitError) {
    process.stdout.write(`Bybit indisponível para ${symbol} (${bybitError.message}); tentando Binance public market data.\n`);
    const [m15, h1] = await Promise.all(intervals.map(x => fetchBinanceKlines(symbol, x.name, x.ms, days)));
    if (m15.length < 150 || h1.length < 60) {
      throw new Error(`Histórico insuficiente em Bybit e Binance para ${symbol}. Bybit: ${bybitError.message}`);
    }
    return { m15, h1, source: 'BINANCE_SPOT_PUBLIC_PROXY' };
  }
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    sourcePolicy: 'Prefer Bybit spot mainnet. If Bybit blocks or lacks history, use Binance spot public data as a clearly labeled cross-exchange proxy. No authenticated endpoints.',
    daysRequested: DAYS,
    quoteCurrency: 'USDT (P&L remains in USDT; no invented historical USD/BRL conversion)',
    symbols: {}
  };
  for (const symbol of SYMBOLS) {
    process.stdout.write(`Baixando histórico ${symbol}...\n`);
    const history = await fetchMarketHistory(symbol, DAYS);
    const options = { candles15m: history.m15, candles1h: history.h1 };
    report.symbols[symbol] = {
      source: history.source,
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
  const serialized = JSON.stringify(report, null, 2);
  const outputPath = process.env.BACKTEST_OUTPUT || 'backtest-report.json';
  fs.writeFileSync(outputPath, serialized + '\n', 'utf8');
  process.stdout.write('\nRELATÓRIO COMPLETO (JSON) salvo em ' + outputPath + '\n');
  for (const [symbol, result] of Object.entries(report.symbols)) {
    for (const [label, key] of [['BASE', 'baseline'], ['APRIMORADA', 'enhanced']]) {
      const m = result[key].outOfSample;
      process.stdout.write(
        `${symbol} ${label} OOS | trades=${m.trades} | winRate=${m.winRatePct}% | ` +
        `net=${m.netPnl} USDT | PF=${m.profitFactor} | DD=${m.maxDrawdownPct}%\n`
      );
    }
  }
}

main().catch(error => {
  process.stderr.write('Backtest interrompido: ' + error.message + '\n');
  process.exitCode = 1;
});
