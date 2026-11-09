'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runSmaBacktest}=require('../src/backtest');

function risingSeries(lastHigh=126,lastLow=120) {
  const candles=Array.from({length:21},(_,i)=>{
    const close=100+i;
    return {start:i,open:close-0.2,high:close+0.5,low:close-0.5,close};
  });
  candles.push({start:21,open:121,high:lastHigh,low:lastLow,close:125});
  return candles;
}

test('SMA backtest enters only on the candle after the completed signal candle',()=>{
  const result=runSmaBacktest(risingSeries());
  assert.equal(result.mode,'HISTORICAL_BACKTEST_ONLY');
  assert.equal(result.executionEnabled,false);
  assert.equal(result.metrics.trades,1);
  assert.equal(result.trades[0].signalIndex,20);
  assert.equal(result.trades[0].entryIndex,21);
  assert.equal(result.trades[0].exitReason,'TAKE_PROFIT');
  assert.ok(result.metrics.fees>0);
  assert.ok(result.trades[0].entryPrice>121);
});

test('SMA backtest assumes the stop is hit first when stop and target trade in one candle',()=>{
  const result=runSmaBacktest(risingSeries(130,100));
  assert.equal(result.metrics.trades,1);
  assert.equal(result.trades[0].exitReason,'STOP_LOSS');
  assert.ok(result.trades[0].netPnl<0);
});

test('SMA backtest rejects malformed candles and invalid cost assumptions',()=>{
  assert.throws(()=>runSmaBacktest([{open:1,high:1,low:1,close:1}]),/pelo menos 22/);
  const candles=risingSeries();
  candles[0].high=0.5;
  assert.throws(()=>runSmaBacktest(candles),/candle OHLC inválido/);
  assert.throws(()=>runSmaBacktest(risingSeries(),{feeRatePerSide:-0.1}),/Parâmetros inválidos/);
});
