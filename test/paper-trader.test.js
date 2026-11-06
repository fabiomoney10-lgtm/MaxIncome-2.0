'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPool}=require('../src/paper-trader');
const {RiskManager}=require('../src/risk-manager');
const {analyzeCandles}=require('../src/strategy');
const {getTradingDate,calculateAvailableDailyRisk,calculateRiskPerUnitBRL}=require('../src/risk-guards');

test('fails closed when DATABASE_URL is absent',()=>assert.throws(()=>createPool(''),/DATABASE_URL não configurada/));
test('risk limits expose PAPER-only controls and never enable exchange execution',()=>{
 const risk=new RiskManager({maxRiskBRL:50,maxDailyLossBRL:100,maxTradesPerDay:5,maxExposureBRL:5000,stopLossPct:1,takeProfitPct:2});
 const limits=risk.getLimits();
 assert.equal(limits.executionEnabled,false);
 assert.equal(limits.maxRiskBRL,50);
 assert.equal(limits.maxDailyLossBRL,100);
 assert.equal(limits.maxTradesPerDay,5);
 assert.equal(limits.maxExposureBRL,5000);
});
test('strategy waits until there are enough candles',()=>{
 assert.equal(analyzeCandles([{close:1},{close:2}]).signal,'INSUFFICIENT_DATA');
});
test('risk manager never authorizes a real Bybit order',()=>{
 const risk=new RiskManager();
 assert.equal(risk.evaluate({signal:'BULLISH',usdtBalance:100}).allowed,false);
});

test('Bybit reports public market data and private environment separately',()=>{
 const {BybitClient}=require('../src/bybit');
 const testnet=new BybitClient({testnet:true});
 assert.equal(testnet.marketDataEnvironment,'BYBIT MAINNET');
 assert.equal(testnet.tradingEnvironment,'BYBIT TESTNET');
 const mainnet=new BybitClient({testnet:false});
 assert.equal(mainnet.marketDataEnvironment,'BYBIT MAINNET');
 assert.equal(mainnet.tradingEnvironment,'BYBIT MAINNET');
});

test('trading engine status clearly identifies PAPER and blocks real execution',()=>{
 const {TradingEngine}=require('../src/trading-engine');
 const client={environment:'BYBIT TESTNET',tradingEnvironment:'BYBIT TESTNET',marketDataEnvironment:'BYBIT MAINNET'};
 const engine=new TradingEngine({client,assets:['BTCUSDT']});
 const status=engine.getStatus();
 assert.equal(status.mode,'PAPER');
 assert.equal(status.environment,'BYBIT TESTNET');
 assert.equal(status.marketDataEnvironment,'BYBIT MAINNET');
 assert.equal(status.orderExecutionEnabled,false);
});

test('trading date follows Sao Paulo midnight, not UTC midnight',()=>{
 assert.equal(getTradingDate(new Date('2026-11-07T02:30:00.000Z')),'2026-11-06');
 assert.equal(getTradingDate(new Date('2026-11-07T03:30:00.000Z')),'2026-11-07');
});

test('daily risk budget reserves open risk and current drawdown',()=>{
 assert.equal(calculateAvailableDailyRisk({maxDailyLossBRL:100,realizedPnlBRL:-20,reservedOpenRiskBRL:40}),40);
 assert.equal(calculateAvailableDailyRisk({maxDailyLossBRL:100,realizedPnlBRL:-80,reservedOpenRiskBRL:30}),0);
});

test('daily risk calculation rejects invalid limits',()=>{
 assert.throws(()=>calculateAvailableDailyRisk({maxDailyLossBRL:0}),/Parâmetros inválidos/);
});

test('unit risk includes stop loss, round-trip fees and a slippage buffer',()=>{
 const risk=calculateRiskPerUnitBRL({entryPrice:100,fxRate:5,stopLossPct:1,feeRatePerSide:0.001});
 assert.equal(risk,7.25);
});

test('unit risk rejects invalid prices and rates',()=>{
 assert.throws(()=>calculateRiskPerUnitBRL({entryPrice:0,fxRate:5,stopLossPct:1,feeRatePerSide:0.001}),/Parâmetros inválidos/);
});
