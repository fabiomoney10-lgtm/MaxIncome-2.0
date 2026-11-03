'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LiveSpotRiskGuard } = require('../src/live-spot-risk-guard');

const base = {
  enabled: true,
  acknowledgement: 'MAXINCOME_SPOT_REAL',
  category: 'spot',
  isLeverage: 0,
  symbol: 'BTCUSDT',
  entryPrice: 100000,
  stopLossPrice: 98000,
  takeProfitPrice: 104000,
  fxBrlPerUsdt: 5,
  availableUsdt: 1000,
  currentExposureBrl: 0,
  realizedDailyLossBrl: 0,
  tradesToday: 0,
  feeRate: 0.001,
  slippageRate: 0.002,
  minOrderValueUsdt: 5
};

test('REAL stays disabled without both explicit gates', () => {
  const guard = new LiveSpotRiskGuard();
  assert.equal(guard.evaluateBuy({ ...base, enabled: false }).allowed, false);
  assert.equal(guard.evaluateBuy({ ...base, acknowledgement: '' }).allowed, false);
});

test('only spot without leverage is allowed', () => {
  const guard = new LiveSpotRiskGuard();
  assert.equal(guard.evaluateBuy({ ...base, category: 'linear' }).allowed, false);
  assert.equal(guard.evaluateBuy({ ...base, isLeverage: 1 }).allowed, false);
});

test('rejects missing/invalid stop and target geometry', () => {
  const guard = new LiveSpotRiskGuard();
  assert.equal(guard.evaluateBuy({ ...base, stopLossPrice: 100000 }).allowed, false);
  assert.equal(guard.evaluateBuy({ ...base, takeProfitPrice: 99000 }).allowed, false);
});

test('blocks after daily loss limit or trade count', () => {
  const guard = new LiveSpotRiskGuard();
  assert.equal(guard.evaluateBuy({ ...base, realizedDailyLossBrl: 100 }).allowed, false);
  assert.equal(guard.evaluateBuy({ ...base, tradesToday: 5 }).allowed, false);
});

test('blocks when exposure cap is reached', () => {
  const guard = new LiveSpotRiskGuard();
  assert.equal(guard.evaluateBuy({ ...base, currentExposureBrl: 5000 }).allowed, false);
});

test('calculates a bounded spot buy quantity under risk and balance caps', () => {
  const guard = new LiveSpotRiskGuard();
  const result = guard.evaluateBuy(base);
  assert.equal(result.allowed, true);
  assert.equal(result.category, 'spot');
  assert.equal(result.isLeverage, 0);
  assert.ok(result.estimatedRiskBrl <= 50.000001);
  assert.ok(result.notionalUsdt <= base.availableUsdt);
  assert.ok(result.quantity > 0);
});

test('rejects stale or unavailable FX and invalid costs', () => {
  const guard = new LiveSpotRiskGuard();
  assert.equal(guard.evaluateBuy({ ...base, fxBrlPerUsdt: 0 }).allowed, false);
  assert.equal(guard.evaluateBuy({ ...base, feeRate: 1 }).allowed, false);
});

test('counts already-open risk against the daily loss budget', () => {
  const guard = new LiveSpotRiskGuard();
  assert.equal(guard.evaluateBuy({ ...base, openRiskBrl: 50 }).allowed, false);
  const result = guard.evaluateBuy({ ...base, openRiskBrl: 75 });
  assert.equal(result.allowed, false);
});
