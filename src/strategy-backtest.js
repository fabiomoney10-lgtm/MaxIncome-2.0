'use strict';

const { evaluateStrategySuite } = require('./strategy-suite');
const { normalizeCandles } = require('./backtest');
const { calculateMinimumTargetPct, DEFAULT_STOP_SLIPPAGE_BUFFER_PCT } = require('./risk-guards');

const STRATEGIES = Object.freeze({
  TREND_FOLLOWING: 'trendFollowing',
  MOMENTUM: 'momentum',
  MEAN_REVERSION: 'meanReversion'
});

function runOne(candles, strategyName, options = {}) {
  const data = normalizeCandles(candles);
  const strategyKey = STRATEGIES[strategyName];
  if (!strategyKey) throw new TypeError('Estratégia desconhecida para comparação.');
  const initialCapital = Number(options.initialCapital ?? 5000);
  const riskPerTrade = Number(options.riskPerTrade ?? 50);
  const stopLossPct = Number(options.stopLossPct ?? 1);
  const feeRatePerSide = Number(options.feeRatePerSide ?? 0.001);
  const slippagePct = Number(options.slippagePct ?? DEFAULT_STOP_SLIPPAGE_BUFFER_PCT);
  const targetPct = Number(options.targetPct ?? calculateMinimumTargetPct({
    stopLossPct, feeRatePerSide, slippageBufferPct: slippagePct
  }));
  const startIndex = Math.max(54, Number(options.startIndex ?? 54));
  const endIndex = Math.min(data.length - 1, Number(options.endIndex ?? data.length - 1));
  const values = [initialCapital, riskPerTrade, stopLossPct, feeRatePerSide, slippagePct, targetPct];
  if (values.some(v => !Number.isFinite(v)) || initialCapital <= 0 || riskPerTrade <= 0 ||
      stopLossPct <= 0 || feeRatePerSide < 0 || slippagePct < 0 || targetPct <= 0 ||
      !Number.isInteger(startIndex) || !Number.isInteger(endIndex) || startIndex > endIndex) {
    throw new TypeError('Parâmetros inválidos para comparação de estratégias.');
  }

  let equity = initialCapital;
  let peak = initialCapital;
  let maxDrawdownPct = 0;
  let grossPnl = 0;
  let fees = 0;
  const trades = [];
  let index = startIndex - 1;

  while (index < endIndex) {
    const analysis = evaluateStrategySuite(data.slice(0, index + 1));
    if (analysis.strategies[strategyKey] !== 'BUY_CANDIDATE') {
      index++;
      continue;
    }
    const entryIndex = index + 1;
    if (entryIndex > endIndex) break;
    const entryCandle = data[entryIndex];
    const entryPrice = entryCandle.open * (1 + slippagePct / 100);
    const riskPerUnit = entryPrice * ((stopLossPct + slippagePct) / 100 + feeRatePerSide * 2);
    const quantity = Math.min(riskPerTrade / riskPerUnit, equity / entryPrice);
    if (!(quantity > 0) || !Number.isFinite(quantity)) {
      index++;
      continue;
    }
    const stopPrice = entryPrice * (1 - stopLossPct / 100);
    const targetPrice = entryPrice * (1 + targetPct / 100);
    let exitIndex = endIndex;
    let rawExitPrice = data[endIndex].close;
    let exitReason = 'END_OF_SAMPLE';

    for (let j = entryIndex; j <= endIndex; j++) {
      const candle = data[j];
      if (candle.open <= stopPrice) {
        exitIndex = j; rawExitPrice = candle.open; exitReason = 'STOP_LOSS'; break;
      }
      if (candle.open >= targetPrice) {
        exitIndex = j; rawExitPrice = candle.open; exitReason = 'TAKE_PROFIT'; break;
      }
      const stopTouched = candle.low <= stopPrice;
      const targetTouched = candle.high >= targetPrice;
      if (stopTouched) {
        exitIndex = j; rawExitPrice = stopPrice; exitReason = 'STOP_LOSS'; break;
      }
      if (targetTouched) {
        exitIndex = j; rawExitPrice = targetPrice; exitReason = 'TAKE_PROFIT'; break;
      }
    }

    const exitPrice = rawExitPrice * (1 - slippagePct / 100);
    const tradeGross = (exitPrice - entryPrice) * quantity;
    const tradeFees = (entryPrice + exitPrice) * quantity * feeRatePerSide;
    const netPnl = tradeGross - tradeFees;
    equity += netPnl;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? (peak - equity) / peak * 100 : 0);
    grossPnl += tradeGross;
    fees += tradeFees;
    trades.push({
      signalIndex: index,
      entryIndex,
      exitIndex,
      signalTime: data[index].start,
      entryTime: data[entryIndex].start,
      exitTime: data[exitIndex].start,
      entryPrice,
      exitPrice,
      stopPrice,
      targetPrice,
      quantity,
      grossPnl: tradeGross,
      fees: tradeFees,
      netPnl,
      exitReason
    });
    index = exitIndex + 1;
  }

  const winners = trades.filter(t => t.netPnl > 0);
  const losers = trades.filter(t => t.netPnl < 0);
  const totalWins = winners.reduce((sum, t) => sum + t.netPnl, 0);
  const totalLosses = Math.abs(losers.reduce((sum, t) => sum + t.netPnl, 0));
  const netPnl = equity - initialCapital;
  return {
    strategy: strategyName,
    mode: 'HISTORICAL_BACKTEST_ONLY',
    executionEnabled: false,
    assumptions: {
      initialCapital, riskPerTrade, stopLossPct, targetPct, feeRatePerSide, slippagePct,
      entryAtNextCandleOpen: true,
      stopFirstWhenBothTouched: true,
      drawdownBasis: 'closed-trade equity; intratrade drawdown excluded'
    },
    metrics: {
      trades: trades.length,
      wins: winners.length,
      losses: losers.length,
      winRatePct: trades.length ? winners.length / trades.length * 100 : 0,
      grossPnl,
      fees,
      netPnl,
      endingCapital: equity,
      returnPct: (netPnl / initialCapital) * 100,
      maxDrawdownPct,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : null,
      expectancyPerTrade: trades.length ? netPnl / trades.length : 0
    },
    trades
  };
}

function runStrategyComparisonBacktest(candles, options = {}) {
  const data = normalizeCandles(candles);
  if (data.length < 110) {
    throw new TypeError('Comparação exige ao menos 110 candles: aquecimento de indicadores e amostra fora do treino.');
  }
  const trainRatio = Number(options.trainRatio ?? 0.7);
  if (!Number.isFinite(trainRatio) || trainRatio < 0.5 || trainRatio > 0.85) {
    throw new TypeError('Divisão treino/teste inválida; use trainRatio entre 0.5 e 0.85.');
  }
  const splitIndex = Math.floor(data.length * trainRatio);
  if (splitIndex < 55 || splitIndex >= data.length - 5) {
    throw new TypeError('Divisão treino/teste inválida; use trainRatio entre 0.5 e 0.85.');
  }
  const common = { ...options, startIndex: 54 };
  const results = {};
  for (const strategy of Object.keys(STRATEGIES)) {
    const full = runOne(data, strategy, common);
    const inSample = runOne(data, strategy, { ...common, endIndex: splitIndex - 1 });
    const outOfSample = runOne(data, strategy, { ...common, startIndex: splitIndex, endIndex: data.length - 1 });
    results[strategy] = { full, inSample, outOfSample };
  }
  return {
    mode: 'RESEARCH_ONLY',
    executionEnabled: false,
    candleCount: data.length,
    split: {
      trainRatio,
      trainEndTime: data[splitIndex - 1].start,
      testStartTime: data[splitIndex].start,
      outOfSampleTradesAreEvaluatedSeparately: true
    },
    results
  };
}

module.exports = { runStrategyComparisonBacktest, runOne, STRATEGIES };
