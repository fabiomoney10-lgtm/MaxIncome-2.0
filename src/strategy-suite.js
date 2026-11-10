'use strict';

// Research-only strategy diagnostics. This module never places or authorizes orders.
function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sma(values, period) {
  return values.length >= period ? average(values.slice(-period)) : null;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
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

function normalize(candles) {
  if (!Array.isArray(candles)) return [];
  return candles.filter(c => c && [c.open, c.high, c.low, c.close].every(v => Number.isFinite(Number(v))) &&
    Number(c.open) > 0 && Number(c.low) > 0 && Number(c.close) > 0 &&
    Number(c.high) >= Math.max(Number(c.open), Number(c.low), Number(c.close)))
    .map(c => ({
      open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
      volume: c.volume === null || c.volume === undefined || c.volume === '' ? null :
        (Number.isFinite(Number(c.volume)) && Number(c.volume) >= 0 ? Number(c.volume) : null)
    }));
}

function evaluateStrategySuite(candles) {
  const data = normalize(candles);
  const unavailable = {
    mode: 'RESEARCH_ONLY_PAPER',
    executionEnabled: false,
    tradeAllowed: false,
    regime: 'INSUFFICIENT_DATA',
    selectedStrategy: 'NONE',
    reason: 'São necessários pelo menos 55 candles fechados e válidos.',
    strategies: {
      trendFollowing: 'INSUFFICIENT_DATA',
      momentum: 'INSUFFICIENT_DATA',
      meanReversion: 'INSUFFICIENT_DATA'
    },
    indicators: { sma20: null, sma50: null, rsi14: null, atrPct: null, volumeRatio: null }
  };
  if (data.length < 55) return unavailable;

  const closes = data.map(c => c.close);
  const current = data[data.length - 1];
  const fast = sma(closes, 20);
  const slow = sma(closes, 50);
  const previousSlow = sma(closes.slice(0, -5), 50);
  const currentRsi = rsi(closes, 14);
  const previousRsi = rsi(closes.slice(0, -1), 14);
  const trueRanges = data.slice(-14).map((c, index) => {
    const previousClose = data[data.length - 15 + index].close;
    return Math.max(c.high - c.low, Math.abs(c.high - previousClose), Math.abs(c.low - previousClose));
  });
  const atr = average(trueRanges);
  const atrPct = atr / current.close * 100;
  const priorWindow = data.slice(-21, -1);
  const priorHigh = Math.max(...priorWindow.map(c => c.high));
  const priorLow = Math.min(...priorWindow.map(c => c.low));
  const recentVolumes = data.slice(-5).map(c => c.volume);
  const baselineVolumes = data.slice(-25, -5).map(c => c.volume);
  let volumeRatio = null;
  if (recentVolumes.length === 5 && baselineVolumes.length === 20 &&
      recentVolumes.every(Number.isFinite) && baselineVolumes.every(Number.isFinite)) {
    const recentVolume = average(recentVolumes);
    const baselineVolume = average(baselineVolumes);
    if (baselineVolume > 0) volumeRatio = recentVolume / baselineVolume;
  }

  let regime = 'RANGE';
  if (atrPct >= 4.5) regime = 'HIGH_VOLATILITY';
  else if (fast > slow * 1.002 && slow > previousSlow) regime = 'TREND_UP';
  else if (fast < slow * 0.998 && slow < previousSlow) regime = 'TREND_DOWN';

  let trendFollowing = 'NO_SETUP';
  if (regime === 'TREND_UP' && current.close > priorHigh && currentRsi >= 50 && currentRsi <= 78) {
    trendFollowing = 'BUY_CANDIDATE';
  } else if (regime === 'TREND_DOWN' && current.close < priorLow) {
    trendFollowing = 'DOWNTREND_NO_LONG';
  }

  let momentum = 'NO_SETUP';
  if (regime === 'TREND_UP' && current.close > fast && currentRsi >= 55 && currentRsi <= 72 &&
      (volumeRatio === null || volumeRatio >= 1.05)) {
    momentum = 'BUY_CANDIDATE';
  }

  let meanReversion = 'NO_SETUP';
  if (regime === 'RANGE' && current.close < fast && currentRsi <= 32 &&
      previousRsi !== null && currentRsi > previousRsi) {
    meanReversion = 'BUY_CANDIDATE';
  }

  let selectedStrategy = 'NONE';
  let reason = 'Nenhuma estratégia confirmou um setup; permanecer sem posição.';
  if (regime === 'HIGH_VOLATILITY') {
    reason = 'Volatilidade elevada: bloquear novos setups até normalização.';
  } else if (trendFollowing === 'BUY_CANDIDATE') {
    selectedStrategy = 'TREND_FOLLOWING';
    reason = 'Tendência de alta com rompimento confirmado por candle fechado.';
  } else if (momentum === 'BUY_CANDIDATE') {
    selectedStrategy = 'MOMENTUM';
    reason = 'Tendência de alta com força relativa e confirmação de volume quando disponível.';
  } else if (meanReversion === 'BUY_CANDIDATE') {
    selectedStrategy = 'MEAN_REVERSION';
    reason = 'Mercado lateral, sobrevenda e RSI começando a recuperar.';
  } else if (regime === 'TREND_DOWN') {
    reason = 'Tendência de baixa: estratégias compradas ficam bloqueadas.';
  }

  return {
    mode: 'RESEARCH_ONLY_PAPER',
    executionEnabled: false,
    tradeAllowed: false,
    regime,
    selectedStrategy,
    reason,
    strategies: { trendFollowing, momentum, meanReversion },
    indicators: {
      sma20: fast,
      sma50: slow,
      rsi14: currentRsi,
      atrPct,
      volumeRatio,
      prior20High: priorHigh,
      prior20Low: priorLow
    }
  };
}

module.exports = { evaluateStrategySuite, rsi, sma };
