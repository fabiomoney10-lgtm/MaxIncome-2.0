'use strict';

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sma(values, period) {
  if (values.length < period) return null;
  return mean(values.slice(-period));
}

function standardDeviation(values) {
  const avg = mean(values);
  return Math.sqrt(mean(values.map(value => (value - avg) ** 2)));
}

function calculateAtr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const ranges = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const current = candles[i];
    const previousClose = candles[i - 1].close;
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose)
    ));
  }
  return mean(ranges);
}

function calculateRsi(closes, period = 14) {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain > 0 ? 100 : 50;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

/**
 * Research-only, long-only candidate signals.
 * All indicators use only the candles supplied (which must be closed and chronological).
 * This module is not imported by the live PaperTrader or execution path.
 */
function analyzeResearchStrategies(candles) {
  if (!Array.isArray(candles) || candles.length < 51) {
    return { ready: false, reason: 'HISTORICAL_DATA_INSUFFICIENT' };
  }
  const bars = candles.map(c => ({
    open: Number(c.open), high: Number(c.high), low: Number(c.low),
    close: Number(c.close), volume: c.volume == null ? null : Number(c.volume)
  }));
  if (bars.some(c => ![c.open, c.high, c.low, c.close].every(Number.isFinite) ||
      c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0 ||
      c.high < Math.max(c.open, c.close, c.low) ||
      c.low > Math.min(c.open, c.close, c.high) ||
      (c.volume !== null && (!Number.isFinite(c.volume) || c.volume < 0)))) {
    throw new TypeError('Candles OHLCV inválidos para pesquisa.');
  }

  const closes = bars.map(c => c.close);
  const last = bars[bars.length - 1];
  const sma9 = sma(closes, 9);
  const sma21 = sma(closes, 21);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma20Prior = sma(closes.slice(0, -5), 20);
  const atr14 = calculateAtr(bars, 14);
  const atrPct = atr14 / last.close * 100;
  const rsi14 = calculateRsi(closes, 14);
  const bandWindow = closes.slice(-20);
  const lowerBand = sma20 - 1.5 * standardDeviation(bandWindow);

  let regime = 'SIDEWAYS';
  if (atrPct >= 2.5) regime = 'HIGH_VOLATILITY';
  else if (sma20 > sma50 && sma20 > sma20Prior) regime = 'UPTREND';
  else if (sma20 < sma50 && sma20 < sma20Prior) regime = 'DOWNTREND';

  const volumeAvailable = bars.slice(-21).every(c => c.volume !== null);
  let volumeRatio = null;
  if (volumeAvailable) {
    const priorVolumes = bars.slice(-21, -1).map(c => c.volume);
    const averageVolume = mean(priorVolumes);
    volumeRatio = averageVolume > 0 ? last.volume / averageVolume : null;
  }

  const priorHighs = bars.slice(-21, -1).map(c => c.high);
  const priorHigh20 = Math.max(...priorHighs);
  const momentum20Pct = (last.close / closes[closes.length - 21] - 1) * 100;

  return {
    ready: true,
    regime,
    metrics: { sma9, sma21, sma20, sma50, atr14, atrPct, rsi14, momentum20Pct, priorHigh20, volumeRatio },
    candidates: {
      baselineSma921: sma9 > sma21 && last.close > sma9,
      trendFollowing2050: regime === 'UPTREND' && last.close > sma20,
      momentum20: momentum20Pct >= 1.5 && last.close > sma20,
      breakout20: last.close > priorHigh20 && atrPct >= 0.3 && atrPct <= 3 &&
        (!volumeAvailable || (volumeRatio !== null && volumeRatio >= 1.1)),
      meanReversion: regime === 'SIDEWAYS' && rsi14 <= 30 && last.close < lowerBand
    },
    diagnostics: {
      volumeConfirmationAvailable: volumeAvailable,
      breakoutRequiresVolumeConfirmation: volumeAvailable,
      dataPolicy: 'CLOSED_CANDLES_ONLY',
      executionEnabled: false,
      tradeAllowed: false
    }
  };
}

module.exports = { analyzeResearchStrategies, calculateAtr, calculateRsi };
