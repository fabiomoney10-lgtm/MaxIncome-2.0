'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runBacktest, normalizeCandles, lastCompletedHourlyIndex, lastCompletedIndex } = require('../src/backtest');
const { calculateAdx, analyzeTrendPullback } = require('../src/strategy');

const FIFTEEN = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const BASE = Date.now() - 300 * FIFTEEN;

function makeHistory() {
  const m15 = [];
  for (let i = 0; i < 260; i += 1) {
    const close = 100 + i * 0.025 + Math.sin(i * 1.7) * 0.18;
    m15.push({
      start: BASE + i * FIFTEEN,
      open: close - 0.03,
      high: close + 0.14,
      low: close - 0.14,
      close
    });
  }
  const h1 = [];
  for (let i = 0; i < 80; i += 1) {
    const close = 100 + i * 0.12 + Math.sin(i * 0.7) * 0.25;
    h1.push({
      start: BASE + i * HOUR,
      open: close - 0.04,
      high: close + 0.2,
      low: close - 0.2,
      close
    });
  }
  return { m15, h1 };
}

test('normalization sorts candles, removes duplicates and invalid OHLC', () => {
  const candles = [
    { start: 2, open: 10, high: 11, low: 9, close: 10 },
    { start: 1, open: 10, high: 11, low: 9, close: 10 },
    { start: 1, open: 10, high: 11, low: 9, close: 10 },
    { start: 3, open: 10, high: 9, low: 8, close: 10 }
  ];
  const result = normalizeCandles(candles, 1);
  assert.deepEqual(result.map(c => c.start), [1, 2]);
});

test('backtest rejects insufficient history and unsafe risk inputs', () => {
  assert.throws(() => runBacktest({ candles15m: [], candles1h: [] }), /Histórico insuficiente/);
  const { m15, h1 } = makeHistory();
  assert.throws(() => runBacktest({ candles15m: m15, candles1h: h1, riskPct: 10 }), /Parâmetros de backtest inválidos/);
});

test('backtest returns chronological in-sample and out-of-sample metrics', () => {
  const { m15, h1 } = makeHistory();
  const result = runBacktest({
    candles15m: m15, candles1h: h1, strategy: 'enhanced',
    feeRatePerSide: 0.001, entrySlippagePct: 0.05, stopSlippagePct: 0.25
  });
  assert.equal(result.strategy, 'enhanced');
  assert.equal(result.data.candles15m, m15.length);
  assert.ok(result.data.splitAt);
  assert.ok(result.all.trades >= result.inSample.trades + result.outOfSample.trades);
  assert.ok(result.all.maxDrawdownPct >= 0);
  assert.equal(result.assumptions.sameCandleStopAndTarget, 'Stop primeiro (conservador)');
});

test('higher timeframe confirmation excludes the hourly candle until its close', () => {
  const hourly = [
    { start: 0 }, { start: HOUR }, { start: 2 * HOUR }
  ];
  assert.equal(lastCompletedHourlyIndex(hourly, HOUR - 1), -1);
  assert.equal(lastCompletedHourlyIndex(hourly, HOUR), 0);
  assert.equal(lastCompletedHourlyIndex(hourly, 2 * HOUR), 1);
});

test('4h confirmation never uses a candle before its close', () => {
  const fourHourly = [{ start: 0 }, { start: 4 * HOUR }, { start: 8 * HOUR }];
  assert.equal(lastCompletedIndex(fourHourly, 4 * HOUR, 4 * HOUR, -1), 0);
  assert.equal(lastCompletedIndex(fourHourly, 4 * HOUR, 4 * HOUR - 1, -1), -1);
  assert.equal(lastCompletedIndex(fourHourly, 4 * HOUR, 8 * HOUR - 1, 0), 0);
  assert.equal(lastCompletedIndex(fourHourly, 4 * HOUR, 8 * HOUR, 0), 1);
});

test('trend-pullback strategy fails closed when 4h history is insufficient', () => {
  const { m15, h1 } = makeHistory();
  const result = analyzeTrendPullback(m15, h1, []);
  assert.equal(result.signal, 'INSUFFICIENT_DATA');
});

test('trend-pullback backtest requires a valid 4h history input', () => {
  const { m15, h1 } = makeHistory();
  assert.throws(() => runBacktest({
    candles15m: m15, candles1h: h1, candles4h: [], strategy: 'trend_pullback'
  }), /Histórico insuficiente/);
});

test('ADX returns directional strength data for a valid OHLC series', () => {
  const candles = Array.from({ length: 80 }, (_, i) => {
    const close = 100 + i * 0.5;
    return { open: close - 0.1, high: close + 0.2, low: close - 0.2, close };
  });
  const result = calculateAdx(candles, 14);
  assert.ok(result && Number.isFinite(result.adx));
  assert.ok(result.plusDi > result.minusDi);
});
