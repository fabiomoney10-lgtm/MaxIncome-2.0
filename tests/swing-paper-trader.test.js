'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sizeSwingPosition,
  SWING_STOP_LOSS_PCT,
  SWING_SCORE_MIN,
  SWING_MAX_OPEN_POSITIONS
} = require('../src/swing-paper-trader');

const settings = {
  initial_capital_brl: 5000,
  max_exposure_brl: 5000,
  fee_rate_per_side: 0.001
};

test('Swing sizing uses a 3% stop and respects its independent per-position risk cap', () => {
  const sized = sizeSwingPosition({
    entryPrice: 100,
    fxRate: 5,
    settings,
    availableDailyRiskBRL: 100,
    openExposureBRL: 0,
    maxRiskPerTradeBRL: 25
  });
  assert.ok(sized);
  assert.equal(SWING_STOP_LOSS_PCT, 3);
  assert.ok(sized.riskBRL <= 25.001);
  assert.ok(sized.stopPrice < sized.entryPrice);
  assert.ok(sized.takeProfitPrice > sized.entryPrice);
  assert.ok(sized.riskReward >= 2);
  assert.equal(SWING_SCORE_MIN, 70);
  assert.equal(SWING_MAX_OPEN_POSITIONS, 3);
});

test('Swing sizing cannot exceed remaining shared daily risk', () => {
  const sized = sizeSwingPosition({
    entryPrice: 100,
    fxRate: 5,
    settings,
    availableDailyRiskBRL: 10,
    openExposureBRL: 0,
    maxRiskPerTradeBRL: 25
  });
  assert.ok(sized);
  assert.ok(sized.riskBRL <= 10.001);
});

test('Swing sizing respects remaining shared exposure and capital', () => {
  const sized = sizeSwingPosition({
    entryPrice: 100,
    fxRate: 5,
    settings,
    availableDailyRiskBRL: 100,
    openExposureBRL: 4900,
    maxRiskPerTradeBRL: 25
  });
  assert.ok(sized);
  assert.ok(sized.entryValueBRL <= 100.001);
  assert.equal(sizeSwingPosition({
    entryPrice: 100,
    fxRate: 5,
    settings,
    availableDailyRiskBRL: 100,
    openExposureBRL: 4995,
    maxRiskPerTradeBRL: 25
  }), null);
});

test('Swing sizing rejects invalid prices, FX, fees and exhausted risk', () => {
  for (const input of [
    { entryPrice: 0, fxRate: 5 },
    { entryPrice: 100, fxRate: 0 },
    { entryPrice: 100, fxRate: 5, availableDailyRiskBRL: 0 },
    { entryPrice: 100, fxRate: 5, maxRiskPerTradeBRL: 0 }
  ]) {
    assert.equal(sizeSwingPosition({
      entryPrice: input.entryPrice ?? 100,
      fxRate: input.fxRate ?? 5,
      settings,
      availableDailyRiskBRL: input.availableDailyRiskBRL ?? 100,
      openExposureBRL: 0,
      maxRiskPerTradeBRL: input.maxRiskPerTradeBRL ?? 25
    }), null);
  }
});
