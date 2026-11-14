'use strict';

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateRsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  const changes = closes.slice(-(period + 1)).slice(1).map((value, index) => value - closes.slice(-(period + 1))[index]);
  const gains = changes.reduce((sum, value) => sum + Math.max(value, 0), 0) / period;
  const losses = changes.reduce((sum, value) => sum + Math.max(-value, 0), 0) / period;
  if (losses === 0) return gains === 0 ? 50 : 100;
  const relativeStrength = gains / losses;
  return 100 - (100 / (1 + relativeStrength));
}

function analyzeCandles(candles) {
  const closes = candles.map(c => Number(c.close)).filter(value => Number.isFinite(value) && value > 0);
  const fast = sma(closes, 9);
  const slow = sma(closes, 21);
  const last = closes[closes.length - 1];
  const rsi = calculateRsi(closes, 14);
  if (fast === null || slow === null || rsi === null || !Number.isFinite(last)) {
    return { signal: 'INSUFFICIENT_DATA', lastPrice: last || null, sma9: fast, sma21: slow, rsi };
  }

  const extensionPct = ((last / fast) - 1) * 100;
  const bullishTrend = fast > slow && last > fast;
  const momentumHealthy = rsi >= 52 && rsi <= 70;
  const notOverextended = extensionPct <= 1.5;
  const bearishTrend = fast < slow && last < fast;

  let signal = 'WAIT';
  if (bullishTrend && momentumHealthy && notOverextended) signal = 'BULLISH';
  else if (bearishTrend && rsi < 48) signal = 'BEARISH';

  const reasons = [];
  if (!bullishTrend && !bearishTrend) reasons.push('tendência sem alinhamento');
  if (bullishTrend && !momentumHealthy) reasons.push(rsi > 70 ? 'momentum sobrecomprado; evitar perseguir preço' : 'momentum comprador insuficiente');
  if (bullishTrend && !notOverextended) reasons.push('preço esticado acima da SMA 9');
  if (signal === 'BULLISH') reasons.push('tendência alinhada, RSI saudável e preço próximo da média');
  if (signal === 'BEARISH' && rsi >= 48) reasons.push('momentum vendedor insuficiente');

  return {
    signal,
    lastPrice: last,
    sma9: fast,
    sma21: slow,
    rsi: Number(rsi.toFixed(2)),
    extensionPct: Number(extensionPct.toFixed(3)),
    reason: reasons.join('; ') || 'aguardando confirmação'
  };
}

module.exports = { analyzeCandles, calculateRsi, sma };
