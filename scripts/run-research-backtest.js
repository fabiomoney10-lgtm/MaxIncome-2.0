'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { backtestSignalStrategy } = require('../src/research-backtest');

const SYMBOLS = ['XRPUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const STRATEGIES = [
  'baseline_sma_9_21',
  'trend_sma_20_50',
  'momentum_20',
  'breakout_20',
  'mean_reversion_sideways'
];
const INTERVAL_MINUTES = 15;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;
const BASE_URL = 'https://api.bybit.com/v5/market/kline';
const OUTPUT_DIR = path.join(process.cwd(), 'artifacts', 'research');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function requestPage(symbol, start, end) {
  const url = new URL(BASE_URL);
  url.search = new URLSearchParams({
    category: 'spot',
    symbol,
    interval: String(INTERVAL_MINUTES),
    start: String(start),
    end: String(end),
    limit: '1000'
  }).toString();

  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      if (payload.retCode !== 0) throw new Error('Bybit retCode=' + payload.retCode + ' ' + payload.retMsg);
      return Array.isArray(payload.result?.list) ? payload.result.list : [];
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(500 * (2 ** attempt));
    }
  }
  throw new Error('Falha ao consultar Bybit ' + symbol + ': ' + lastError.message);
}

async function fetchHistory(symbol, startMs, endMs, nowMs) {
  const byTimestamp = new Map();
  let cursorEnd = endMs;
  let rawRows = 0;
  let duplicateRows = 0;
  let excludedUnclosedRows = 0;
  let pages = 0;

  while (cursorEnd >= startMs) {
    const rows = await requestPage(symbol, startMs, cursorEnd);
    pages++;
    rawRows += rows.length;
    if (!rows.length) break;

    let oldest = Infinity;
    for (const row of rows) {
      const timestamp = Number(row[0]);
      if (!Number.isFinite(timestamp)) continue;
      oldest = Math.min(oldest, timestamp);
      // Keep only fully closed 15-minute candles; never use the live partial candle.
      if (timestamp < startMs || timestamp > endMs) continue;
      if (timestamp + INTERVAL_MS > nowMs) { excludedUnclosedRows++; continue; }
      if (byTimestamp.has(timestamp)) duplicateRows++;
      byTimestamp.set(timestamp, {
        start: timestamp,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5])
      });
    }

    if (!Number.isFinite(oldest) || oldest <= startMs || oldest >= cursorEnd) break;
    cursorEnd = oldest - 1;
    await sleep(120);
  }

  const candles = [...byTimestamp.values()].sort((a, b) => a.start - b.start);
  const malformed = candles.filter(c =>
    ![c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) ||
    c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0 || c.volume < 0 ||
    c.high < Math.max(c.open, c.close, c.low) ||
    c.low > Math.min(c.open, c.close, c.high)
  );
  if (malformed.length) throw new Error(symbol + ' contém ' + malformed.length + ' candles inválidos.');

  let missingCandles = 0;
  let gaps = 0;
  for (let i = 1; i < candles.length; i++) {
    const delta = candles[i].start - candles[i - 1].start;
    if (delta > INTERVAL_MS) {
      gaps++;
      missingCandles += Math.round(delta / INTERVAL_MS) - 1;
    }
  }

  return {
    candles,
    quality: {
      symbol,
      pages,
      rawRows,
      uniqueCandles: candles.length,
      duplicateRows,
      excludedUnclosedRows,
      missingIntervals: gaps,
      estimatedMissingCandles: missingCandles,
      firstCandleUtc: candles.length ? new Date(candles[0].start).toISOString() : null,
      lastCandleUtc: candles.length ? new Date(candles[candles.length - 1].start).toISOString() : null
    }
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function runPartitions(symbol, candles) {
  const trainEnd = Math.floor(candles.length * 0.6);
  const validationEnd = Math.floor(candles.length * 0.8);
  const partitions = [
    { name: 'train', start: 0, end: trainEnd },
    { name: 'validation', start: trainEnd, end: validationEnd },
    { name: 'test', start: validationEnd, end: candles.length }
  ];
  const scenarios = [
    { name: 'base_cost', feeRate: 0.001, slippagePct: 0.25 },
    { name: 'stress_cost', feeRate: 0.002, slippagePct: 0.5 }
  ];
  const results = [];

  for (const partition of partitions) {
    const warmupStart = Math.max(0, partition.start - 50);
    const segment = candles.slice(warmupStart, partition.end);
    const tradeStartIndex = partition.start - warmupStart;
    for (const strategy of STRATEGIES) {
      for (const scenario of scenarios) {
        const metrics = backtestSignalStrategy(segment, strategy, {
          tradeStartIndex,
          startingCapital: 5000,
          riskBudget: 50,
          stopPct: 1,
          targetPct: 4.2,
          feeRate: scenario.feeRate,
          slippagePct: scenario.slippagePct
        });
        results.push({
          symbol,
          partition: partition.name,
          partitionCandles: partition.end - partition.start,
          strategy,
          scenario: scenario.name,
          ...metrics
        });
      }
    }
  }
  return results;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const nowMs = Date.now();
  const startMs = Math.floor((nowMs - 365 * 24 * 60 * 60 * 1000) / INTERVAL_MS) * INTERVAL_MS;
  const lastClosedStart = Math.floor(nowMs / INTERVAL_MS) * INTERVAL_MS - INTERVAL_MS;
  const allResults = [];
  const dataQuality = [];
  const dataFiles = [];
  const dataManifest = {
    provider: 'Bybit V5 public market data',
    endpoint: BASE_URL,
    category: 'spot',
    interval: '15',
    intervalMinutes: INTERVAL_MINUTES,
    requestedStartUtc: new Date(startMs).toISOString(),
    requestedEndUtc: new Date(lastClosedStart).toISOString(),
    downloadedAtUtc: new Date(nowMs).toISOString(),
    symbols: SYMBOLS
  };

  for (const symbol of SYMBOLS) {
    process.stdout.write('Baixando ' + symbol + '...\n');
    const { candles, quality } = await fetchHistory(symbol, startMs, lastClosedStart, nowMs);
    if (candles.length < 500) throw new Error(symbol + ': histórico insuficiente (' + candles.length + ' candles).');
    dataQuality.push(quality);

    const candlePath = path.join(OUTPUT_DIR, 'candles-' + symbol + '.csv');
    const candleLines = ['start_utc,open,high,low,close,volume'];
    for (const c of candles) {
      candleLines.push([
        new Date(c.start).toISOString(), c.open, c.high, c.low, c.close, c.volume
      ].join(','));
    }
    fs.writeFileSync(candlePath, candleLines.join('\n') + '\n');
    const candleSha256 = crypto.createHash('sha256').update(fs.readFileSync(candlePath)).digest('hex');
    dataFiles.push({ symbol, file: path.basename(candlePath), sha256: candleSha256 });

    allResults.push(...runPartitions(symbol, candles));
    process.stdout.write(symbol + ': ' + candles.length + ' candles, ' + quality.missingIntervals + ' gaps.\n');
  }

  const report = {
    generatedAtUtc: new Date().toISOString(),
    dataManifest,
    dataQuality,
    dataFiles,
    methodology: {
      partitions: 'Chronological 60% train / 20% validation / 20% test; no shuffle',
      warmupCandles: 50,
      entry: 'Next candle open after a signal on a fully closed candle',
      stopTarget: '1% stop / 4.2% target; stop wins if both levels are touched in the same candle',
      fees: '0.10% per side',
      slippage: '0.25% per side base; 0.50% per side stress',
      fees: '0.10% per side base; 0.20% per side stress',
      sizing: '5,000 USDT virtual capital; 50 USDT max risk budget per trade',
      liquidation: 'Open position liquidated at the end of each partition with exit fee and slippage',
      quoteCurrency: 'USDT; no historical USDT/BRL conversion is applied',
      strategies: STRATEGIES
    },
    results: allResults
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'backtest-report.json'), JSON.stringify(report, null, 2) + '\n');
  const columns = [
    'symbol', 'partition', 'partitionCandles', 'strategy', 'scenario',
    'tradeCount', 'wins', 'losses', 'winRatePct', 'netPnlUsdt',
    'endingCapitalUsdt', 'expectancyUsdt', 'profitFactor', 'maxDrawdownPct',
    'feesUsdt', 'stopCount', 'targetCount', 'endOfDataCount'
  ];
  const csv = [columns.join(',')];
  for (const row of allResults) csv.push(columns.map(key => csvEscape(row[key])).join(','));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'backtest-summary.csv'), csv.join('\n') + '\n');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'data-quality.json'), JSON.stringify(dataQuality, null, 2) + '\n');

  process.stdout.write('Relatório salvo em artifacts/research. Linhas de resultado: ' + allResults.length + '\n');
}

main().catch(error => {
  process.stderr.write((error.stack || error.message) + '\n');
  process.exitCode = 1;
});
