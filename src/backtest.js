'use strict';

const { analyzeCandles } = require('./strategy');
const { calculateMinimumTargetPct, DEFAULT_STOP_SLIPPAGE_BUFFER_PCT } = require('./risk-guards');

function normalizeCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 22) {
    throw new TypeError('Backtest exige pelo menos 22 candles OHLC.');
  }
  const normalized = candles.map((candle, index) => {
    const item = {
      start: Number(candle.start ?? index),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close)
    };
    if (Object.values(item).some(value => !Number.isFinite(value)) ||
        item.open <= 0 || item.high <= 0 || item.low <= 0 || item.close <= 0 ||
        item.high < Math.max(item.open, item.close, item.low) ||
        item.low > Math.min(item.open, item.close, item.high)) {
      throw new TypeError('Backtest recebeu candle OHLC inválido.');
    }
    return item;
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i].start <= normalized[i - 1].start) {
      throw new TypeError('Backtest exige candles únicos e ordenados por horário.');
    }
  }
  return normalized;
}

function runSmaBacktest(candles, options = {}) {
  const data = normalizeCandles(candles);
  const initialCapital = Number(options.initialCapital ?? 5000);
  const riskPerTrade = Number(options.riskPerTrade ?? 50);
  const stopLossPct = Number(options.stopLossPct ?? 1);
  const feeRatePerSide = Number(options.feeRatePerSide ?? 0.001);
  const slippagePct = Number(options.slippagePct ?? DEFAULT_STOP_SLIPPAGE_BUFFER_PCT);
  const targetPct = Number(options.targetPct ?? calculateMinimumTargetPct({
    stopLossPct, feeRatePerSide, slippageBufferPct: slippagePct
  }));
  const params = [initialCapital, riskPerTrade, stopLossPct, feeRatePerSide, slippagePct, targetPct];
  if (params.some(value => !Number.isFinite(value)) || initialCapital <= 0 ||
      riskPerTrade <= 0 || stopLossPct <= 0 || feeRatePerSide < 0 ||
      slippagePct < 0 || targetPct <= 0) {
    throw new TypeError('Parâmetros inválidos para o backtest.');
  }

  let equity = initialCapital;
  let peak = initialCapital;
  let maxDrawdown = 0;
  let grossTotal = 0;
  let feesTotal = 0;
  const trades = [];
  let index = 20;

  while (index < data.length - 1) {
    const signal = analyzeCandles(data.slice(0, index + 1));
    if (signal.signal !== 'BULLISH') {
      index++;
      continue;
    }

    const entryIndex = index + 1;
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
    let exitIndex = data.length - 1;
    let rawExitPrice = data[exitIndex].close;
    let exitReason = 'END_OF_DATA';

    for (let j = entryIndex; j < data.length; j++) {
      const candle = data[j];
      if (candle.open <= stopPrice) {
        exitIndex = j; rawExitPrice = candle.open; exitReason = 'STOP_LOSS'; break;
      }
      if (candle.open >= targetPrice) {
        exitIndex = j; rawExitPrice = candle.open; exitReason = 'TAKE_PROFIT'; break;
      }
      const stopTouched = candle.low <= stopPrice;
      const targetTouched = candle.high >= targetPrice;
      // Conservative intrabar ordering: if both levels trade in one candle, assume stop first.
      if (stopTouched) {
        exitIndex = j; rawExitPrice = stopPrice; exitReason = 'STOP_LOSS'; break;
      }
      if (targetTouched) {
        exitIndex = j; rawExitPrice = targetPrice; exitReason = 'TAKE_PROFIT'; break;
      }
    }

    const exitPrice = rawExitPrice * (1 - slippagePct / 100);
    const grossPnl = (exitPrice - entryPrice) * quantity;
    const entryFee = entryPrice * quantity * feeRatePerSide;
    const exitFee = exitPrice * quantity * feeRatePerSide;
    const fees = entryFee + exitFee;
    const netPnl = grossPnl - fees;
    equity += netPnl;
    peak = Math.max(peak, equity);
    const drawdownPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdownPct);
    grossTotal += grossPnl;
    feesTotal += fees;
    trades.push({
      signalIndex: index,
      entryIndex,
      exitIndex,
      entryTime: data[entryIndex].start,
      exitTime: data[exitIndex].start,
      entryPrice,
      exitPrice,
      stopPrice,
      targetPrice,
      quantity,
      grossPnl,
      fees,
      netPnl,
      exitReason
    });
    index = exitIndex + 1;
  }

  const netPnl = equity - initialCapital;
  const winners = trades.filter(trade => trade.netPnl > 0);
  const losers = trades.filter(trade => trade.netPnl < 0);
  const grossWins = winners.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLosses = Math.abs(losers.reduce((sum, trade) => sum + trade.netPnl, 0));
  return {
    mode: 'HISTORICAL_BACKTEST_ONLY',
    executionEnabled: false,
    currency: 'quote currency (e.g. USDT)',
    assumptions: { initialCapital, riskPerTrade, stopLossPct, targetPct, feeRatePerSide, slippagePct, entryAtNextCandleOpen: true, stopFirstWhenBothTouched: true, drawdownBasis: 'equity after closed trades; intratrade drawdown is not included' },
    metrics: {
      trades: trades.length,
      wins: winners.length,
      losses: losers.length,
      winRatePct: trades.length ? winners.length / trades.length * 100 : 0,
      grossPnl: grossTotal,
      fees: feesTotal,
      netPnl,
      endingCapital: equity,
      maxDrawdownPct: maxDrawdown,
      profitFactor: grossLosses > 0 ? grossWins / grossLosses : null
    },
    trades
  };
}

module.exports = { runSmaBacktest, normalizeCandles };
