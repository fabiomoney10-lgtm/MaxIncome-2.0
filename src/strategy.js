'use strict';

function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

function calculateRsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  const changes = [];
  for (let i = 1; i < closes.length; i += 1) changes.push(closes[i] - closes[i - 1]);
  let averageGain = changes.slice(0, period).reduce((sum, value) => sum + Math.max(value, 0), 0) / period;
  let averageLoss = changes.slice(0, period).reduce((sum, value) => sum + Math.max(-value, 0), 0) / period;
  for (const change of changes.slice(period)) {
    averageGain = ((averageGain * (period - 1)) + Math.max(change, 0)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-change, 0)) / period;
  }
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  return 100 - (100 / (1 + averageGain / averageLoss));
}

function calculateAtr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const ranges = [];
  for (let i = 1; i < candles.length; i += 1) {
    const high = Number(candles[i].high);
    const low = Number(candles[i].low);
    const previousClose = Number(candles[i - 1].close);
    if (![high, low, previousClose].every(Number.isFinite) || high < low || previousClose <= 0) return null;
    ranges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }
  let atr = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const range of ranges.slice(period)) atr = ((atr * (period - 1)) + range) / period;
  return atr;
}

function cleanCandles(candles) {
  return (Array.isArray(candles) ? candles : []).filter(candle => {
    const close = Number(candle && candle.close);
    return Number.isFinite(close) && close > 0;
  });
}

function analyzeCandles(candles, confirmationCandles = []) {
  const intraday = cleanCandles(candles);
  const higher = cleanCandles(confirmationCandles);
  const closes = intraday.map(candle => Number(candle.close));
  const higherCloses = higher.map(candle => Number(candle.close));
  const fast = sma(closes, 9);
  const slow = sma(closes, 21);
  const higherFast = sma(higherCloses, 20);
  const higherSlow = sma(higherCloses, 50);
  const last = closes[closes.length - 1];
  const rsi = calculateRsi(closes, 14);
  const atr = calculateAtr(intraday, 14);

  if (fast === null || slow === null || higherFast === null || higherSlow === null ||
      rsi === null || atr === null || !Number.isFinite(last)) {
    return {
      signal: 'INSUFFICIENT_DATA', lastPrice: last || null, sma9: fast, sma21: slow,
      higherSma20: higherFast, higherSma50: higherSlow, rsi, atr
    };
  }

  const previousFast = sma(closes.slice(0, -3), 9);
  const atrPct = (atr / last) * 100;
  const extensionAtr = (last - fast) / atr;
  const intradayTrend = fast > slow && last > fast;
  const higherTimeframeTrend = higherFast > higherSlow && higherCloses[higherCloses.length - 1] > higherFast;
  const momentumHealthy = rsi >= 50 && rsi <= 68;
  const volatilityTradable = atrPct >= 0.08 && atrPct <= 2.5;
  const notOverextended = extensionAtr >= 0 && extensionAtr <= 1.25;
  const momentumRising = previousFast !== null && fast > previousFast;

  const checks = {
    intradayTrend,
    higherTimeframeTrend,
    momentumHealthy,
    volatilityTradable,
    notOverextended,
    momentumRising
  };
  const signal = Object.values(checks).every(Boolean) ? 'BULLISH' : 'WAIT';
  const reasons = [];
  if (!intradayTrend) reasons.push('tendência de 15m sem alinhamento');
  if (!higherTimeframeTrend) reasons.push('tendência de 1h não confirma');
  if (!momentumHealthy) reasons.push(rsi > 68 ? 'RSI esticado; não perseguir preço' : 'RSI sem força compradora suficiente');
  if (!volatilityTradable) reasons.push('volatilidade fora da faixa operacional');
  if (!notOverextended) reasons.push('preço afastado da média em relação ao ATR');
  if (!momentumRising) reasons.push('média curta sem aceleração positiva');
  if (signal === 'BULLISH') reasons.push('confluência de tendência 15m/1h, RSI, ATR e aceleração confirmada');

  return {
    signal,
    lastPrice: last,
    sma9: fast,
    sma21: slow,
    higherSma20: higherFast,
    higherSma50: higherSlow,
    rsi: Number(rsi.toFixed(2)),
    atr: Number(atr.toPrecision(8)),
    atrPct: Number(atrPct.toFixed(3)),
    extensionAtr: Number(extensionAtr.toFixed(3)),
    checks,
    reason: reasons.join('; ')
  };
}

module.exports = { analyzeCandles, calculateRsi, calculateAtr, sma };
