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

test('SwingEngine rejects short 4h or daily history instead of reporting a fresh analysis',async()=>{
 const client={
  getTicker:async symbol=>({symbol,lastPrice:200,marketTimestamp:Date.now()}),
  getKlines:async(_symbol,interval)=>interval==='240'?risingCandles(49):risingCandles(60)
 };
 const engine=new SwingEngine({client,assets:['BTCUSDT']});
 await assert.rejects(engine.runOnce(),/Nenhum ativo retornou candles válidos/);
 assert.equal(engine.getStatus().assets.BTCUSDT.signal,'DATA_ERROR');
 assert.match(engine.getStatus().assets.BTCUSDT.reason,/Histórico insuficiente/);
 assert.equal(engine.getStatus().lastSuccessAt,null);
});

test('Swing persistence uses existing database-compatible enum values',()=>{
 const {SWING_EVENT_TYPE,SWING_STRATEGY_SIGNAL}=require('../src/swing-paper-trader');
 assert.equal(SWING_EVENT_TYPE,'TRADE_OPENED');
 assert.equal(SWING_STRATEGY_SIGNAL,'BULLISH');
});
