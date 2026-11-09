'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runStrategyComparisonBacktest, runOne } = require('../src/strategy-backtest');

function risingCandles(length = 160) {
  return Array.from({ length }, (_, i) => {
    const close = 100 + i * 0.3;
    return {
      start: i * 900000,
      open: close - 0.1,
      high: close + 0.1,
      low: close - 0.1,
      close,
      volume: 100 + (i % 5) * 10
    };
  });
}

test('comparison rejects short history before attempting strategy evaluation', () => {
  assert.throws(() => runStrategyComparisonBacktest(risingCandles(80)), /110 candles/);
});

test('comparison reports independent in-sample and out-of-sample results without execution', () => {
  const result = runStrategyComparisonBacktest(risingCandles(), { initialCapital: 5000, riskPerTrade: 50 });
  assert.equal(result.mode, 'RESEARCH_ONLY');
  assert.equal(result.executionEnabled, false);
  assert.equal(result.candleCount, 160);
  assert.ok(result.split.testStartTime > result.split.trainEndTime);
  for (const name of ['TREND_FOLLOWING', 'MOMENTUM', 'MEAN_REVERSION']) {
    const item = result.results[name];
    assert.ok(item);
    assert.equal(item.full.executionEnabled, false);
    assert.equal(item.inSample.executionEnabled, false);
    assert.equal(item.outOfSample.executionEnabled, false);
    assert.ok(Number.isFinite(item.outOfSample.metrics.netPnl));
    assert.ok(item.outOfSample.trades.every(trade => trade.entryIndex >= Math.floor(160 * 0.7)));
  }
});

test('single-strategy backtest rejects unknown strategy names', () => {
  assert.throws(() => runOne(risingCandles(), 'MAGIC'), /desconhecida/);
});

test('out-of-sample test period uses preceding candles only for indicator warmup', () => {
  const result = runStrategyComparisonBacktest(risingCandles(), { trainRatio: 0.65 });
  const start = Math.floor(160 * 0.65);
  for (const item of Object.values(result.results)) {
    assert.ok(item.outOfSample.trades.every(trade => trade.signalIndex >= start - 1));
    assert.ok(item.outOfSample.trades.every(trade => trade.entryIndex >= start));
  }
});
