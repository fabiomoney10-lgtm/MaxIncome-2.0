'use strict';

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let result = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of values.slice(period)) result = (value * multiplier) + (result * (1 - multiplier));
  return result;
}

function calculateRsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return gains > 0 ? 100 : 50;
  const relativeStrength = (gains / period) / (losses / period);
  return 100 - (100 / (1 + relativeStrength));
}

function calculateAtr(candles, period = 14) {
  if (candles.length <= period) return null;
  const ranges = [];
  for (let i = 1; i < candles.length; i++) {
    const high = Number(candles[i].high);
    const low = Number(candles[i].low);
    const previousClose = Number(candles[i - 1].close);
    if (![high, low, previousClose].every(Number.isFinite)) return null;
    ranges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }
  return sma(ranges, period);
}

function validCandles(input) {
  return (Array.isArray(input) ? input : []).filter(c => {
    const close = Number(c && c.close);
    return Number.isFinite(close) && close > 0;
  });
}

function trendIsBullish(candles) {
  const closes = validCandles(candles).map(c => Number(c.close));
  if (closes.length < 50) return false;
  const fast = sma(closes, 9);
  const slow = sma(closes, 21);
  const long = ema(closes, 50);
  const previousLong = ema(closes.slice(0, -5), 50);
  return fast > slow && closes[closes.length - 1] > long && long > previousLong;
}

function analyzeCandles(candles, higherTimeframeCandles = []) {
  const valid = validCandles(candles);
  const closes = valid.map(c => Number(c.close));
  const fast = sma(closes, 9);
  const slow = sma(closes, 21);
  const long = ema(closes, 50);
  const rsi = calculateRsi(closes, 14);
  const atr = calculateAtr(valid, 14);
  const last = closes[closes.length - 1];
  const volumeValues = valid.map(c => Number(c.volume));
  const hasVolume = volumeValues.length >= 21 && volumeValues.slice(-21).every(v => Number.isFinite(v) && v >= 0);
  const averageVolume = hasVolume ? sma(volumeValues.slice(0, -1), 20) : null;
  const volumeConfirmed = hasVolume && averageVolume > 0 && volumeValues[volumeValues.length - 1] >= averageVolume * 0.8;
  const atrPct = Number.isFinite(atr) && last > 0 ? (atr / last) * 100 : null;
  const trend = Number.isFinite(fast) && Number.isFinite(slow) && fast > slow && last > slow;
  const longTrend = Number.isFinite(long) && last > long && long > (ema(closes.slice(0, -5), 50) || 0);
  const momentumHealthy = Number.isFinite(rsi) && rsi >= 50 && rsi <= 68;
  const volatilityHealthy = Number.isFinite(atrPct) && atrPct >= 0.15 && atrPct <= 2.5;
  const higherTimeframeBullish = trendIsBullish(higherTimeframeCandles);

  if (closes.length < 55 || !Number.isFinite(rsi) || !Number.isFinite(atr) || !hasVolume) {
    return {
      signal: 'INSUFFICIENT_DATA', score: 0, lastPrice: last || null,
      sma9: fast, sma21: slow, ema50: long, rsi14: rsi, atr14: atr,
      reason: 'Dados insuficientes para validar tendência, RSI, ATR e volume.',
      filters: { trend, longTrend, momentumHealthy, volatilityHealthy, volumeConfirmed, higherTimeframeBullish }
    };
  }

  let score = 0;
  if (trend) score += 20;
  if (longTrend) score += 20;
  if (momentumHealthy) score += 15;
  if (volatilityHealthy) score += 10;
  if (volumeConfirmed) score += 15;
  if (higherTimeframeBullish) score += 20;

  const requiredFilters = trend && longTrend && momentumHealthy &&
    volatilityHealthy && volumeConfirmed && higherTimeframeBullish;
  const signal = score >= 85 && requiredFilters ? 'BULLISH' : 'WAIT';
  const reasons = [];
  if (!trend) reasons.push('SMA 9/21 sem alinhamento comprador');
  if (!longTrend) reasons.push('preço/EMA 50 sem tendência confirmada');
  if (!momentumHealthy) reasons.push('RSI fora da faixa 50–68');
  if (!volatilityHealthy) reasons.push('ATR fora da faixa operacional');
  if (!volumeConfirmed) reasons.push('volume abaixo do filtro mínimo');
  if (!higherTimeframeBullish) reasons.push('tendência de 1h não confirmada');

  return {
    signal, score, lastPrice: last, sma9: fast, sma21: slow, ema50: long,
    rsi14: rsi, atr14: atr, atrPct,
    filters: { trend, longTrend, momentumHealthy, volatilityHealthy, volumeConfirmed, higherTimeframeBullish },
    reason: signal === 'BULLISH' ? 'Confluência dos seis filtros técnicos confirmada.' : reasons.join('; '),
    minimumScore: 85
  };
}

module.exports = { analyzeCandles, sma, ema, calculateRsi, calculateAtr, trendIsBullish };
