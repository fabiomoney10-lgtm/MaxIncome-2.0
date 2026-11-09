'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SwingEngine,analyzeSwingCandles}=require('../src/swing-engine');

function risingCandles(length,start=100) {
  return Array.from({length},(_,i)=>({
    start:i*60000,
    close:start+i
  }));
}

test('Swing signal uses completed candles while entry reference uses live ticker',()=>{
  const fourHour=risingCandles(60);
  const daily=risingCandles(60);
  const result=analyzeSwingCandles({
    fourHour,
    daily,
    relativeStrength:1,
    currentPrice:200
  });
  assert.equal(result.signal,'BUY_CANDIDATE');
  assert.equal(result.candleClose,159);
  assert.equal(result.lastPrice,200);
  assert.equal(result.indicativeStopPrice,194);
  assert.equal(result.indicativeTargetPrice,212);
});

test('SwingEngine requests 4h and D candles and attaches current ticker price',async()=>{
  const intervals=[];
  const client={
    getTicker:async symbol=>({symbol,lastPrice:200,change24h:2,marketTimestamp:Date.now()}),
    getKlines:async(_symbol,interval)=>{intervals.push(interval);return risingCandles(60);}
  };
  const engine=new SwingEngine({client,assets:['BTCUSDT']});
  await engine.runOnce();
  const asset=engine.getStatus().assets.BTCUSDT;
  assert.deepEqual(intervals.sort(),['240','D']);
  assert.equal(asset.lastPrice,200);
  assert.equal(asset.candleClose,159);
  assert.equal(asset.signal,'BUY_CANDIDATE');
  assert.equal(engine.getStatus().orderExecutionEnabled,false);
});

test('SwingEngine fails closed when current ticker price is invalid',async()=>{
  const client={
    getTicker:async()=>({lastPrice:0}),
    getKlines:async()=>risingCandles(60)
  };
  const engine=new SwingEngine({client,assets:['BTCUSDT']});
  await assert.rejects(engine.runOnce(),/Nenhum ativo retornou candles válidos/);
  assert.equal(engine.getStatus().assets.BTCUSDT.signal,'DATA_ERROR');
});
