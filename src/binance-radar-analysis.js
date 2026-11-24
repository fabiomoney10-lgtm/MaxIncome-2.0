'use strict';

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let current = average(values.slice(0, period));
  for (let i = period; i < values.length; i += 1) current = values[i] * multiplier + current * (1 - multiplier);
  return current;
}

function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) return null;
  const ranges = [];
  for (let i = 1; i < candles.length; i += 1) {
    const candle = candles[i];
    const previousClose = candles[i - 1].close;
    ranges.push(Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose)));
  }
  return average(ranges.slice(-period));
}

function validateCandles(candles) {
  return Array.isArray(candles) && candles.length >= 60 && candles.every(c =>
    [c.open, c.high, c.low, c.close, c.volume, c.closeTime].every(Number.isFinite) &&
    c.open > 0 && c.high >= c.low && c.close > 0 && c.volume >= 0
  );
}

function analyzeTimeframe(candles) {
  if (!validateCandles(candles)) return null;
  const closes = candles.map(c => c.close);
  const fast = ema(closes, 20);
  const slow = ema(closes, 50);
  const last = candles[candles.length - 1];
  const strength = rsi(closes, 14);
  const volatility = atr(candles, 14);
  const priorVolumes = candles.slice(-21, -1).map(c => c.volume);
  const volumeAverage = average(priorVolumes);
  const volumeRatio = volumeAverage > 0 ? last.volume / volumeAverage : 0;
  return {
    close: last.close, closeTime: last.closeTime, ema20: fast, ema50: slow,
    rsi: strength, atr: volatility, atrPct: volatility / last.close * 100,
    volumeRatio, bullish: fast > slow && last.close > fast,
    bearish: fast < slow && last.close < fast
  };
}

function analyzeLongSetup({ symbol, frames, btcFrames, scannerScore = 0, minScore = 85 }) {
  const required = ['5m', '15m', '1h', '4h', '1d'];
  if (!symbol || !frames || required.some(tf => !analyzeTimeframe(frames[tf]))) {
    return { symbol, status: 'REJECTED', reason: 'HISTORICO_INSUFICIENTE' };
  }
  const metrics = Object.fromEntries(required.map(tf => [tf, analyzeTimeframe(frames[tf])]));
  const btc1h = btcFrames && analyzeTimeframe(btcFrames['1h']);
  const btc4h = btcFrames && analyzeTimeframe(btcFrames['4h']);
  if (!btc1h || !btc4h) return { symbol, status: 'REJECTED', reason: 'CONTEXTO_BTC_INDISPONIVEL' };

  const m5 = metrics['5m'];
  const m15 = metrics['15m'];
  const m1h = metrics['1h'];
  const m4h = metrics['4h'];
  const m1d = metrics['1d'];
  const btcRiskOff = btc1h.bearish || btc4h.bearish;
  const trendConfirmed = m4h.bullish && m1h.bullish && !m1d.bearish;
  const entryConfirmed = m15.bullish && m5.close > m5.ema20;
  const momentumHealthy = m15.rsi >= 50 && m15.rsi <= 68 && m5.rsi >= 48 && m5.rsi <= 72;
  const volumeConfirmed = m15.volumeRatio >= 1.2;
  const volatilityHealthy = m15.atrPct >= 0.15 && m15.atrPct <= 3.5;

  let score = 0;
  if (m4h.bullish) score += 15;
  if (m1h.bullish) score += 15;
  if (m1d.bullish) score += 8;
  if (m15.bullish) score += 12;
  if (m5.close > m5.ema20) score += 8;
  if (momentumHealthy) score += 10;
  if (volumeConfirmed) score += 12;
  if (!btcRiskOff) score += 12;
  if (volatilityHealthy) score += 4;
  score += Math.max(0, Math.min(4, Number(scannerScore) / 25));
  score = Math.round(Math.min(100, score));

  const checks = { trendConfirmed, entryConfirmed, momentumHealthy, volumeConfirmed, volatilityHealthy, btcRiskOn: !btcRiskOff };
  if (Object.values(checks).some(value => !value) || score < minScore) {
    return { symbol, status: 'REJECTED', score, checks, reason: 'FILTROS_DE_QUALIDADE_NAO_ATINGIDOS' };
  }

  const entry = m15.close;
  const stopDistance = m15.atr * 1.5;
  const stopPct = stopDistance / entry * 100;
  if (!Number.isFinite(stopDistance) || stopDistance <= 0 || stopPct < 0.25 || stopPct > 3.5) {
    return { symbol, status: 'REJECTED', score, checks, reason: 'STOP_FORA_DA_FAIXA' };
  }
  const stop = entry - stopDistance;
  const target = entry + stopDistance * 2;
  const validUntil = new Date(m15.closeTime + 3 * 15 * 60 * 1000).toISOString();
  return {
    symbol, status: 'SIGNAL', side: 'BUY', score, entry, stop, target,
    riskReward: 2, stopPct, validUntil, generatedAt: new Date().toISOString(),
    candleCloseTime: m15.closeTime, checks,
    reasons: ['TENDENCIA_1H_4H_CONFIRMADA', 'ENTRADA_5M_15M_CONFIRMADA', 'VOLUME_ACIMA_DA_MEDIA', 'RSI_EM_FAIXA_SAUDAVEL', 'BTC_SEM_SINAL_DE_RISCO']
  };
}

module.exports = { average, ema, rsi, atr, validateCandles, analyzeTimeframe, analyzeLongSetup };
