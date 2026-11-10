'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {backtestSma}=require('../src/backtest');

function bars(closes) {
  return closes.map((close,i)=>({start:i,open:close,high:close*1.001,low:close*0.999,close}));
}

test('backtest returns an empty, finite report for insufficient history',()=>{
 const result=backtestSma(bars(Array.from({length:10},(_,i)=>100+i)));
 assert.equal(result.tradeCount,0);
 assert.equal(result.netPnl,0);
});

test('backtest charges entry and exit costs and reports net PnL',()=>{
 const data=bars([100,99,98,99,100,102,104,106,108,110,112,114,116,118,120,122,124,126,128,130,132,134,136,138,140,142,144,146,148,150,152,154,156,158,160]);
 const result=backtestSma(data,{fastPeriod:2,slowPeriod:3,stopPct:1,targetPct:4.2,feeRate:0.001,slippagePct:0.25});
 assert.ok(result.tradeCount>=1);
 assert.ok(result.trades[0].fees>0);
 assert.equal(result.assumptions.feePctPerSide,0.1);
 assert.equal(result.assumptions.slippagePctPerSide,0.25);
});

test('backtest validates OHLC and parameters',()=>{
 assert.throws(()=>backtestSma([{open:10,high:9,low:8,close:10}]),/Candles OHLC inválidos/);
 assert.throws(()=>backtestSma([], {fastPeriod:21,slowPeriod:9}),/Parâmetros inválidos/);
});

test('when stop and target are touched in the same candle, stop wins conservatively',()=>{
 const data=bars([100,99,98,99,100,102,104,106,108,110,112,114,116,118,120,122,124,126,128,130,132,134,136,138,140,142,144,146,148,150,152,154,156,158,160]);
 data[6].high=110;
 data[6].low=100;
 const result=backtestSma(data,{fastPeriod:2,slowPeriod:3,stopPct:1,targetPct:1.5,feeRate:0,slippagePct:0});
 assert.equal(result.trades[0].reason,'STOP');
});
