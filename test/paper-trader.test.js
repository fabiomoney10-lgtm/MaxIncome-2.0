'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPool}=require('../src/paper-trader');
const {RiskManager}=require('../src/risk-manager');
const {analyzeCandles}=require('../src/strategy');
const {getTradingDate,calculateAvailableDailyRisk,calculateRiskPerUnitBRL,calculateStopExecutionPrice,calculatePositionSizeBRL}=require('../src/risk-guards');

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
 assert.ok(Math.abs(risk-7.25)<1e-9);
});

test('unit risk rejects invalid prices and rates',()=>{
 assert.throws(()=>calculateRiskPerUnitBRL({entryPrice:0,fxRate:5,stopLossPct:1,feeRatePerSide:0.001}),/Parâmetros inválidos/);
});

test('stop fill applies adverse slippage when market remains near the stop',()=>{
 const fill=calculateStopExecutionPrice({marketPrice:99.9,stopPrice:100,slippageBufferPct:0.25});
 assert.equal(fill,99.75);
});

test('stop fill uses the worse observed market price when the market gaps down',()=>{
 const fill=calculateStopExecutionPrice({marketPrice:98,stopPrice:100,slippageBufferPct:0.25});
 assert.equal(fill,98);
});

test('stop fill rejects invalid market inputs',()=>{
 assert.throws(()=>calculateStopExecutionPrice({marketPrice:0,stopPrice:100}),/Parâmetros inválidos/);
});

test('position sizing includes round-trip fees and adverse slippage inside the risk budget',()=>{
 const sizing=calculatePositionSizeBRL({
  entryPrice:100,fxRate:5,stopLossPct:1,feeRatePerSide:0.001,
  riskBudgetBRL:50,maxNotionalBRL:5000
 });
 assert.ok(sizing.quantity>0);
 assert.ok(sizing.modeledRiskBRL<=50);
 assert.ok(sizing.notionalBRL<5000);
 assert.ok(Math.abs(sizing.riskPerUnitBRL-7.25)<1e-9);
});

test('position sizing rejects invalid or zero risk budgets',()=>{
 assert.throws(()=>calculatePositionSizeBRL({
  entryPrice:100,fxRate:5,stopLossPct:1,feeRatePerSide:0.001,
  riskBudgetBRL:0,maxNotionalBRL:5000
 }),/Parâmetros inválidos/);
});

test('strategy blocks an overbought move and requires higher-timeframe confirmation',()=>{
 const {analyzeCandles}=require('../src/strategy');
 const candles=Array.from({length:80},(_,i)=>{
  const close=100+i*0.1;
  return {open:close-0.03,high:close+0.15,low:close-0.15,close};
 });
 const higher=Array.from({length:80},(_,i)=>{
  const close=100+i*0.1;
  return {open:close-0.03,high:close+0.15,low:close-0.15,close};
 });
 const result=analyzeCandles(candles,higher);
 assert.notEqual(result.signal,'BULLISH');
 assert.equal(result.rsi,100);
});

test('strategy requires sufficient closed 15m and 1h candles',()=>{
 const {analyzeCandles}=require('../src/strategy');
 const result=analyzeCandles([{close:1,high:1,low:1}],[]);
 assert.equal(result.signal,'INSUFFICIENT_DATA');
});

test('strategy accepts a moderate multi-timeframe trend with controlled volatility',()=>{
 const {analyzeCandles}=require('../src/strategy');
 const makeCandles=(length,step,amplitude)=>Array.from({length},(_,i)=>{
  const close=100+i*step+Math.sin(i*1.3)*amplitude;
  return {open:close-0.02,high:close+0.12,low:close-0.12,close};
 });
 const result=analyzeCandles(makeCandles(100,0.04,0.3),makeCandles(100,0.08,0.3));
 assert.equal(result.signal,'BULLISH',JSON.stringify(result));
 assert.ok(result.rsi>=50 && result.rsi<=68);
 assert.ok(result.atrPct>=0.08 && result.atrPct<=2.5);
 assert.equal(result.checks.higherTimeframeTrend,true);
});
