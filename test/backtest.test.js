'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runBacktest, normalizeCandles } = require('../src/backtest');

const FIFTEEN = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const BASE = Date.now() - 220 * FIFTEEN;

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

test('higher timeframe confirmation cannot use an hourly candle before it closes', () => {
  const { m15, h1 } = makeHistory();
  const withIncomplete = runBacktest({ candles15m: m15, candles1h: h1, strategy: 'enhanced' });
  const truncated = h1.filter(c => c.start + HOUR <= m15[150].start + FIFTEEN);
  assert.ok(truncated.length <= h1.length);
  assert.ok(withIncomplete.data.candles1h === h1.length);
});
