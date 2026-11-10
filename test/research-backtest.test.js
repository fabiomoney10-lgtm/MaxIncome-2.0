'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { backtestSignalStrategy, signalFor } = require('../src/research-backtest');

function risingBars(length = 80) {
  return Array.from({ length }, (_, i) => {
    const close = 100 + i * 0.1;
    return {
      start: i * 900000,
      open: close,
      high: close + 0.02,
      low: close - 0.02,
      close,
      volume: 100 + i
    };
  });
}

test('research signal at a fixed candle is unaffected by appended future candles', () => {
  const original = risingBars(80);
  const before = signalFor('baseline_sma_9_21', original, 60);
  const withFuture = original.concat([
    { start: 80 * 900000, open: 1, high: 10000, low: 0.5, close: 9000, volume: 1 }
  ]);
  assert.equal(signalFor('baseline_sma_9_21', withFuture, 60), before);
});

test('research backtest uses closed-candle signals and returns net metrics', () => {
  const result = backtestSignalStrategy(risingBars(), 'baseline_sma_9_21', {
    tradeStartIndex: 50,
    startingCapital: 5000,
    riskBudget: 50,
    feeRate: 0.001,
    slippagePct: 0.25
  });
  assert.ok(result.tradeCount >= 1);
  assert.equal(result.assumptions.entryTiming, 'NEXT_CANDLE_OPEN');
  assert.equal(result.assumptions.signalUsesClosedCandle, true);
  assert.equal(result.assumptions.feePctPerSide, 0.1);
  assert.equal(result.assumptions.slippagePctPerSide, 0.25);
  assert.ok(Number.isFinite(result.netPnlUsdt));
  assert.ok(Number.isFinite(result.maxDrawdownPct));
});

test('research backtest rejects invalid candles and unknown strategies', () => {
  assert.throws(
    () => backtestSignalStrategy([{ open: 10, high: 9, low: 8, close: 10 }], 'baseline_sma_9_21'),
    /Candles OHLCV inválidos/
  );
  assert.throws(() => signalFor('unknown', risingBars(), 60), /Estratégia de pesquisa desconhecida/);
});
