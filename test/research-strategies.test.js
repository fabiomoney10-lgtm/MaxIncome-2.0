'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeResearchStrategies } = require('../src/research-strategies');

function trendingBars(length = 60) {
  return Array.from({ length }, (_, i) => {
    const close = 100 + i * 0.5;
    return { start: i, open: close - 0.1, high: close + 0.1, low: close - 0.2, close, volume: 100 };
  });
}

test('research strategies fail closed when history is insufficient', () => {
  const result = analyzeResearchStrategies(trendingBars(40));
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'HISTORICAL_DATA_INSUFFICIENT');
});

test('research candidates expose regime and remain non-executable', () => {
  const result = analyzeResearchStrategies(trendingBars());
  assert.equal(result.ready, true);
  assert.equal(result.regime, 'UPTREND');
  assert.equal(result.candidates.trendFollowing2050, true);
  assert.equal(result.candidates.momentum20, true);
  assert.equal(result.diagnostics.executionEnabled, false);
  assert.equal(result.diagnostics.tradeAllowed, false);
});

test('breakout reference excludes the current candle high', () => {
  const data = trendingBars();
  const expectedPriorHigh = Math.max(...data.slice(-21, -1).map(c => c.high));
  data[data.length - 1].high = data[data.length - 1].close + 1000;
  const result = analyzeResearchStrategies(data);
  assert.equal(result.metrics.priorHigh20, expectedPriorHigh);
});

test('research strategy rejects malformed OHLCV', () => {
  const data = trendingBars();
  data[59] = { open: 10, high: 9, low: 8, close: 10, volume: -1 };
  assert.throws(() => analyzeResearchStrategies(data), /Candles OHLCV inválidos/);
});
