'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { backtestSma } = require('../src/backtest');

function bars(closes) {
  return closes.map((close, i) => ({
    start: i, open: close, high: close * 1.001, low: close * 0.999, close
  }));
}

function bullishSetup() {
  // With SMA 2/3, the first valid bullish signal is the close of index 4.
  return bars([100, 99, 98, 99, 100, 100, 100, 100, 100]);
}

const shortPeriods = {
  fastPeriod: 2, slowPeriod: 3, stopPct: 1, targetPct: 1.5,
  feeRate: 0, slippagePct: 0, riskBudget: 50
};

test('insufficient history returns an empty finite report', () => {
  const result = backtestSma(bars([100, 101]), { fastPeriod: 2, slowPeriod: 3 });
  assert.equal(result.tradeCount, 0);
  assert.equal(result.netPnl, 0);
  assert.equal(result.expectancyPerTrade, 0);
});

test('signal uses the current closed candle and enters only at the next candle open', () => {
  const data = bullishSetup();
  data[5].open = 103;
  data[5].high = 103.1;
  data[5].low = 102.9;
  data[5].close = 103;
  const result = backtestSma(data, { ...shortPeriods, stopPct: 20, targetPct: 20 });
  assert.ok(result.tradeCount >= 1);
  assert.equal(result.trades[0].entryIndex, 5);
  assert.equal(result.trades[0].entry, 103);
  assert.equal(result.assumptions.entryTiming, 'NEXT_CANDLE_OPEN');
});

test('future candles cannot change a trade already entered and exited', () => {
  const original = bullishSetup();
  original[5].high = 105;
  original[5].low = 98;
  const changedFuture = original.map(c => ({ ...c }));
  for (let i = 6; i < changedFuture.length; i++) {
    changedFuture[i] = { start: i, open: 500, high: 510, low: 490, close: 505 };
  }
  const a = backtestSma(original, shortPeriods);
  const b = backtestSma(changedFuture, shortPeriods);
  assert.equal(a.trades[0].entryIndex, 5);
  assert.equal(a.trades[0].exitIndex, 5);
  assert.equal(b.trades[0].entry, a.trades[0].entry);
  assert.equal(b.trades[0].exit, a.trades[0].exit);
  assert.equal(b.trades[0].reason, a.trades[0].reason);
});

test('entry and exit each charge fee and adverse slippage', () => {
  const data = bullishSetup();
  data[5].high = 101;
  data[5].low = 98;
  const result = backtestSma(data, {
    ...shortPeriods, feeRate: 0.001, slippagePct: 0.25
  });
  const trade = result.trades[0];
  assert.equal(trade.reason, 'STOP');
  assert.ok(trade.entry > 100);
  assert.ok(trade.exit < 99.25);
  assert.ok(trade.entryFee > 0);
  assert.ok(trade.exitFee > 0);
  assert.ok(Math.abs(trade.fees - trade.entryFee - trade.exitFee) < 1e-10);
  assert.equal(result.assumptions.feePctPerSide, 0.1);
  assert.equal(result.assumptions.slippagePctPerSide, 0.25);
  assert.ok(result.expectancyPerTrade < 0);
});

test('when stop and target are touched in the same candle, stop wins conservatively', () => {
  const data = bullishSetup();
  data[5].high = 105;
  data[5].low = 98;
  const result = backtestSma(data, shortPeriods);
  assert.equal(result.trades[0].reason, 'STOP');
  assert.equal(result.trades[0].exit, 99);
});

test('drawdown does not mark a next-candle entry against the prior signal close', () => {
  const data = bullishSetup();
  data[5] = { start: 5, open: 120, high: 120.1, low: 119.9, close: 120 };
  for (let i = 6; i < data.length; i++) data[i] = { start: i, open: 120, high: 120.1, low: 119.9, close: 120 };
  const result = backtestSma(data, {
    ...shortPeriods, stopPct: 50, targetPct: 50
  });
  assert.equal(result.trades[0].entry, 120);
  assert.equal(result.maxDrawdownPct, 0);
});

test('validates OHLC and rejects invalid numeric options', () => {
  assert.throws(
    () => backtestSma([{ open: 10, high: 9, low: 8, close: 10 }]),
    /Candles OHLC inválidos/
  );
  assert.throws(() => backtestSma([], { fastPeriod: 21, slowPeriod: 9 }), /Parâmetros inválidos/);
  assert.throws(() => backtestSma([], { feeRate: Number.NaN }), /Parâmetros inválidos/);
});
