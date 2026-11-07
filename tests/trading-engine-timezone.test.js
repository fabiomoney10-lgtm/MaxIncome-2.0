'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TradingEngine } = require('../src/trading-engine');

test('engine log timestamps are formatted in São Paulo time, independent of host timezone', () => {
  const engine = new TradingEngine({
    client: { marketDataEnvironment: 'BYBIT MAINNET' },
    assets: [],
    legacyXrpReserved: 0,
    maxRiskBRL: 50,
    maxDailyLossBRL: 100,
    maxTradesPerDay: 5,
    maxExposureBRL: 5000,
    stopLossPct: 1,
    takeProfitPct: 2
  });
  const before = new Date();
  engine.addLog('timezone test');
  const after = new Date();
  const entry = engine.getStatus().log[0];
  const match = entry.match(/^\[(.+)\] timezone test$/);
  assert.ok(match, 'log entry should contain a timestamp');
  const actual = match[1];
  const candidates = [before, after].map(date =>
    date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false })
  );
  assert.ok(candidates.includes(actual), 'timestamp must use America/Sao_Paulo');
});
