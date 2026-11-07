'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeSwingCandles, average } = require('../src/swing-engine');

test('average requires a full window and computes the trailing mean', () => {
  assert.equal(average([1, 2, 3], 2), 2.5);
  assert.equal(average([1], 2), null);
});

test('swing scanner refuses insufficient candle history', () => {
  const result = analyzeSwingCandles({ fourHour: [{ close: 1 }], daily: [{ close: 1 }] });
  assert.equal(result.signal, 'INSUFFICIENT_DATA');
  assert.equal(result.executionEnabled, undefined);
});

test('swing scanner labels a strong trend as candidate without enabling execution', () => {
  const daily = Array.from({ length: 60 }, (_, i) => ({ close: 100 + i }));
  const fourHour = Array.from({ length: 60 }, (_, i) => ({ close: 140 + i * 0.2 }));
  const result = analyzeSwingCandles({ fourHour, daily, relativeStrength: 1 });
  assert.equal(result.signal, 'BUY_CANDIDATE');
  assert.equal(result.executionEnabled, false);
  assert.equal(result.orderExecutionEnabled, undefined);
  assert.equal(result.indicativeRiskReward, 2);
});
