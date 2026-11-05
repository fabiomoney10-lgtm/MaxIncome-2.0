'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RiskManager } = require('../src/risk-manager');

test('usa os limites padrão conservadores', () => {
  const risk = new RiskManager();
  assert.deepEqual(risk.getLimits(), {
    maxRiskBRL: 50,
    maxDailyLossBRL: 100,
    maxTradesPerDay: 5,
    maxExposureBRL: 5000,
    stopLossPct: 1,
    takeProfitPct: 2,
    mode: 'PAPER',
    executionEnabled: false,
    currency: 'BRL'
  });
});

test('bloqueia quando a conversão USDT/BRL não está disponível', () => {
  const risk = new RiskManager();
  const result = risk.evaluate({ signal: 'BULLISH', usdtBalance: 100, usdtBrlRate: null });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /USDT\/BRL indisponível/);
});

test('bloqueia sinais que não sejam BULLISH para spot comprado', () => {
  const risk = new RiskManager();
  const result = risk.evaluate({ signal: 'BEARISH', usdtBalance: 100, usdtBrlRate: 5 });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /apenas entrada comprada/);
});

test('bloqueia ao atingir perda diária máxima', () => {
  const risk = new RiskManager();
  const result = risk.evaluate({
    signal: 'BULLISH', usdtBalance: 1000, usdtBrlRate: 5,
    dailyLossBRL: 100, tradesToday: 0, exposureBRL: 0
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /perda diária atingido/);
});

test('bloqueia ao atingir o número máximo de operações', () => {
  const risk = new RiskManager();
  const result = risk.evaluate({
    signal: 'BULLISH', usdtBalance: 1000, usdtBrlRate: 5,
    dailyLossBRL: 0, tradesToday: 5, exposureBRL: 0
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /operações do dia atingido/);
});

test('calcula risco máximo de R$50 com stop de 1% e alvo de 2%, sem liberar execução', () => {
  const risk = new RiskManager();
  const result = risk.evaluate({
    signal: 'BULLISH', usdtBalance: 1000, usdtBrlRate: 5,
    dailyLossBRL: 0, tradesToday: 0, exposureBRL: 0, entryPrice: 2
  });
  assert.equal(result.allowed, false);
  assert.equal(result.paperPlan.notionalBRL, 5000);
  assert.equal(result.paperPlan.estimatedRiskBRL, 50);
  assert.equal(result.paperPlan.estimatedTargetBRL, 100);
  assert.equal(result.paperPlan.stopPrice, 1.98);
  assert.equal(result.paperPlan.targetPrice, 2.04);
  assert.match(result.reason, /histórico diário persistente/);
});

test('rejeita alvo inferior à relação mínima de 2:1', () => {
  assert.throws(
    () => new RiskManager({ stopLossPct: 1, takeProfitPct: 1.5 }),
    /pelo menos duas vezes/
  );
});
