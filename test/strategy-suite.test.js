'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateStrategySuite, rsi, sma } = require('../src/strategy-suite');

function trendCandles(length = 60) {
  const candles = Array.from({ length }, (_, i) => {
    const close = 100 + i * 0.08 + Math.sin(i * 1.7) * 0.45;
    return { start: i, open: close - 0.03, high: close + 0.15, low: close - 0.15, close, volume: 100 + (i % 4) * 5 };
  });
  const priorHigh = Math.max(...candles.slice(-21, -1).map(c => c.high));
  const close = priorHigh + 0.3;
  candles[candles.length - 1] = { start: length - 1, open: close - 0.1, high: close + 0.1, low: close - 0.2, close, volume: 180 };
  return candles;
}

test('strategy suite fails closed with insufficient closed candles', () => {
  const result = evaluateStrategySuite(trendCandles(40));
  assert.equal(result.regime, 'INSUFFICIENT_DATA');
  assert.equal(result.tradeAllowed, false);
  assert.equal(result.executionEnabled, false);
});

test('strategy suite classifies a rising market and only reports a research candidate', () => {
  const result = evaluateStrategySuite(trendCandles());
  assert.ok(['TREND_UP', 'RANGE'].includes(result.regime));
  assert.equal(result.mode, 'RESEARCH_ONLY_PAPER');
  assert.equal(result.tradeAllowed, false);
  assert.equal(result.executionEnabled, false);
  assert.ok(result.strategies.trendFollowing);
});

test('strategy suite blocks high-volatility conditions', () => {
  const candles = trendCandles();
  for (let i = 45; i < candles.length; i++) {
    candles[i].high = candles[i].close * 1.07;
    candles[i].low = candles[i].close * 0.93;
  }
  const result = evaluateStrategySuite(candles);
  assert.equal(result.regime, 'HIGH_VOLATILITY');
  assert.equal(result.selectedStrategy, 'NONE');
  assert.equal(result.tradeAllowed, false);
});

test('strategy suite identifies a downtrend without proposing spot longs', () => {
  const candles = Array.from({ length: 60 }, (_, i) => {
    const close = 150 - i * 0.5 + Math.sin(i * 1.7) * 0.3;
    return { start: i, open: close + 0.02, high: close + 0.15, low: close - 0.15, close, volume: 100 };
  });
  const result = evaluateStrategySuite(candles);
  assert.equal(result.regime, 'TREND_DOWN');
  assert.equal(result.strategies.trendFollowing, 'DOWNTREND_NO_LONG');
  assert.equal(result.selectedStrategy, 'NONE');
});

test('basic indicator helpers reject undersized data cleanly', () => {
  assert.equal(sma([1, 2], 3), null);
  assert.equal(rsi([1, 2, 3], 14), null);
});
