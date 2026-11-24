'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ema, rsi, atr, analyzeTimeframe, analyzeLongSetup } = require('../src/binance-radar-analysis');

function candles(count, slope = 0.15, volume = 1000) {
  const firstCloseTime = Date.now() - (count - 1) * 900000 - 60000;
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * slope + Math.sin(i * 1.7) * 0.7;
    return {
      open: close - 0.05, high: close + 0.3, low: close - 0.3,
      close, volume: i === count - 1 ? volume * 1.5 : volume,
      closeTime: firstCloseTime + i * 900000
    };
  });
}

test('EMA, RSI and ATR return finite indicator values with sufficient history', () => {
  const series = candles(80);
  assert.ok(Number.isFinite(ema(series.map(c => c.close), 20)));
  assert.ok(rsi(series.map(c => c.close), 14) > 50);
  assert.ok(atr(series, 14) > 0);
});

test('timeframe analysis rejects incomplete history', () => {
  assert.equal(analyzeTimeframe(candles(30)), null);
});

test('long setup rejects when Bitcoin context is missing', () => {
  const frames = Object.fromEntries(['5m','15m','1h','4h','1d'].map(tf => [tf, candles(80)]));
  assert.equal(analyzeLongSetup({ symbol: 'AAAUSDT', frames, currentPrice: frames['15m'][79].close }).reason, 'CONTEXTO_BTC_INDISPONIVEL');
});

test('long setup emits only BUY signals and enforces score and risk boundaries', () => {
  const frames = Object.fromEntries(['5m','15m','1h','4h','1d'].map(tf => [tf, candles(80, 0.2, 1500)]));
  const btcFrames = { '1h': candles(80, 0.2), '4h': candles(80, 0.2) };
  const result = analyzeLongSetup({ symbol: 'AAAUSDT', frames, btcFrames, scannerScore: 95, currentPrice: frames['15m'][79].close, minScore: 85 });
  assert.equal(result.status, 'SIGNAL', JSON.stringify(result));
  assert.equal(result.side, 'BUY');
  assert.equal(result.riskReward, 2);
  assert.ok(result.priceDeviationPct <= 0.5);
  assert.ok(result.signalId.includes('AAAUSDT:'));
  assert.ok(result.score >= 85 && result.score <= 100);
  assert.ok(result.stop < result.entry && result.target > result.entry);
});

test('long setup rejects an expired candle signal', () => {
  const frames = Object.fromEntries(['5m','15m','1h','4h','1d'].map(tf => [tf, candles(80, 0.2, 1500)]));
  const btcFrames = { '1h': candles(80, 0.2), '4h': candles(80, 0.2) };
  for (const frame of Object.values(frames)) for (const candle of frame) candle.closeTime -= 60 * 60 * 1000;
  const result = analyzeLongSetup({ symbol: 'AAAUSDT', frames, btcFrames, scannerScore: 95, currentPrice: frames['15m'][79].close });
  assert.equal(result.reason, 'SINAL_EXPIRADO');
});
