'use strict';

function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function calculateRsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  const changes = [];
  for (let i = 1; i < closes.length; i += 1) changes.push(closes[i] - closes[i - 1]);
  let gain = changes.slice(0, period).reduce((s, v) => s + Math.max(v, 0), 0) / period;
  let loss = changes.slice(0, period).reduce((s, v) => s + Math.max(-v, 0), 0) / period;
  for (const change of changes.slice(period)) {
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - (100 / (1 + gain / loss));
}

function calculateAtr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const ranges = [];
  for (let i = 1; i < candles.length; i += 1) {
    const high = Number(candles[i].high), low = Number(candles[i].low);
    const previousClose = Number(candles[i - 1].close);
    if (![high, low, previousClose].every(Number.isFinite) || high < low || previousClose <= 0) return null;
    ranges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }
  let atr = ranges.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (const range of ranges.slice(period)) atr = (atr * (period - 1) + range) / period;
  return atr;
}

function calculateAdx(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period * 2 + 1) return null;
  const tr = [], plus = [], minus = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i], previous = candles[i - 1];
    const up = Number(current.high) - Number(previous.high);
    const down = Number(previous.low) - Number(current.low);
    tr.push(Math.max(Number(current.high) - Number(current.low),
      Math.abs(Number(current.high) - Number(previous.close)),
      Math.abs(Number(current.low) - Number(previous.close))));
    plus.push(up > down && up > 0 ? up : 0);
    minus.push(down > up && down > 0 ? down : 0);
  }
  const smooth = values => {
    let value = values.slice(0, period).reduce((s, v) => s + v, 0);
    const out = [value];
    for (const item of values.slice(period)) { value = value - value / period + item; out.push(value); }
    return out;
  };
  const trS = smooth(tr), plusS = smooth(plus), minusS = smooth(minus);
  const dx = [];
  for (let i = 0; i < trS.length; i += 1) {
    if (trS[i] <= 0) { dx.push(0); continue; }
    const pdi = 100 * plusS[i] / trS[i], mdi = 100 * minusS[i] / trS[i];
    dx.push(pdi + mdi === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi));
  }
  if (dx.length < period) return null;
  let adx = dx.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (const value of dx.slice(period)) adx = (adx * (period - 1) + value) / period;
  const last = trS.length - 1;
  return { adx, plusDi: trS[last] > 0 ? 100 * plusS[last] / trS[last] : 0,
    minusDi: trS[last] > 0 ? 100 * minusS[last] / trS[last] : 0 };
}

function cleanCandles(candles) {
  return (Array.isArray(candles) ? candles : []).filter(c => {
    const close = Number(c && c.close);
    return Number.isFinite(close) && close > 0 &&
      Number.isFinite(Number(c.high)) && Number.isFinite(Number(c.low));
  });
}

function analyzeCandles(candles, confirmationCandles = []) {
  const intraday = cleanCandles(candles), higher = cleanCandles(confirmationCandles);
  const closes = intraday.map(c => Number(c.close)), higherCloses = higher.map(c => Number(c.close));
  const fast = sma(closes, 9), slow = sma(closes, 21);
  const higherFast = sma(higherCloses, 20), higherSlow = sma(higherCloses, 50);
  const last = closes[closes.length - 1], rsi = calculateRsi(closes, 14), atr = calculateAtr(intraday, 14);
  if (fast === null || slow === null || higherFast === null || higherSlow === null ||
      rsi === null || atr === null || !Number.isFinite(last)) {
    return { signal: 'INSUFFICIENT_DATA', lastPrice: last || null, sma9: fast, sma21: slow,
      higherSma20: higherFast, higherSma50: higherSlow, rsi, atr };
  }
  const previousFast = sma(closes.slice(0, -3), 9), atrPct = atr / last * 100;
  const extensionAtr = (last - fast) / atr;
  const checks = {
    intradayTrend: fast > slow && last > fast,
    higherTimeframeTrend: higherFast > higherSlow && higherCloses.at(-1) > higherFast,
    momentumHealthy: rsi >= 50 && rsi <= 68,
    volatilityTradable: atrPct >= 0.08 && atrPct <= 2.5,
    notOverextended: extensionAtr >= 0 && extensionAtr <= 1.25,
    momentumRising: previousFast !== null && fast > previousFast
  };
  const signal = Object.values(checks).every(Boolean) ? 'BULLISH' : 'WAIT';
  return { signal, lastPrice: last, sma9: fast, sma21: slow, higherSma20: higherFast,
    higherSma50: higherSlow, rsi: Number(rsi.toFixed(2)), atr: Number(atr.toPrecision(8)),
    atrPct: Number(atrPct.toFixed(3)), extensionAtr: Number(extensionAtr.toFixed(3)), checks,
    reason: signal === 'BULLISH' ? 'confluência de tendência 15m/1h, RSI, ATR e aceleração confirmada' :
      Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key).join('; ') };
}

function analyzeTrendPullback(candles15m, candles1h, candles4h) {
  const m15 = cleanCandles(candles15m), h1 = cleanCandles(candles1h), h4 = cleanCandles(candles4h);
  const c15 = m15.map(c => Number(c.close)), c1 = h1.map(c => Number(c.close)), c4 = h4.map(c => Number(c.close));
  const last = m15.at(-1), previous = m15.at(-2), price = c15.at(-1);
  const atr = calculateAtr(m15, 14), rsi = calculateRsi(c15, 14);
  const ema20_15 = sma(c15, 20), sma20_4h = sma(c4, 20), sma50_4h = sma(c4, 50);
  const sma20_1h = sma(c1, 20), sma50_1h = sma(c1, 50);
  const adx = calculateAdx(h4, 14);
  if (!last || !previous || !atr || rsi === null || !ema20_15 || !sma20_4h ||
      !sma50_4h || !sma20_1h || !sma50_1h || !adx) {
    return { signal: 'INSUFFICIENT_DATA', reason: 'histórico insuficiente para 15m/1h/4h e ADX' };
  }
  const atrPct = atr / price * 100;
  const trend4h = price > 0 && c4.at(-1) > sma20_4h && sma20_4h > sma50_4h;
  const trend1h = c1.at(-1) > sma20_1h && sma20_1h > sma50_1h;
  const directionalStrength = adx.adx >= 18 && adx.plusDi > adx.minusDi;
  const pullback = last.low <= ema20_15 + atr * 0.25 && last.close > ema20_15;
  const bullishReclaim = last.close > previous.high && last.close > last.open;
  const momentum = rsi >= 48 && rsi <= 65;
  const volatility = atrPct >= 0.08 && atrPct <= 2.5;
  const checks = { trend4h, trend1h, directionalStrength, pullback, bullishReclaim, momentum, volatility };
  const signal = Object.values(checks).every(Boolean) ? 'BULLISH' : 'WAIT';
  const stopPct = Math.max(0.8, Math.min(2.5, 1.8 * atrPct));
  return { signal, reason: signal === 'BULLISH' ? 'tendência 4h/1h + ADX/DI + pullback com retomada 15m' :
      Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key).join('; '),
    checks, adx: Number(adx.adx.toFixed(2)), plusDi: Number(adx.plusDi.toFixed(2)),
    minusDi: Number(adx.minusDi.toFixed(2)), rsi: Number(rsi.toFixed(2)),
    atr: Number(atr.toPrecision(8)), atrPct: Number(atrPct.toFixed(3)),
    stopLossPct: Number(stopPct.toFixed(3)), takeProfitPct: Number((stopPct * 2.2).toFixed(3)) };
}

module.exports = { analyzeCandles, analyzeTrendPullback, calculateRsi, calculateAtr, calculateAdx, sma };
