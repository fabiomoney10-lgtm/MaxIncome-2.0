'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPool}=require('../src/paper-trader');
const {RiskManager}=require('../src/risk-manager');
const {analyzeCandles}=require('../src/strategy');

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
