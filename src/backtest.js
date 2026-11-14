'use strict';

const { analyzeCandles, analyzeTrendPullback, sma, calculateRsi } = require('./strategy');

const INTERVAL_15M_MS = 15 * 60 * 1000;
const INTERVAL_1H_MS = 60 * 60 * 1000;
const INTERVAL_4H_MS = 4 * 60 * 60 * 1000;

function normalizeCandles(candles, intervalMs) {
  if (!Array.isArray(candles)) throw new TypeError('Candles precisam ser um array.');
  const seen = new Map();
  for (const raw of candles) {
    const candle = {
      start: Number(raw.start),
      open: Number(raw.open),
      high: Number(raw.high),
      low: Number(raw.low),
      close: Number(raw.close),
      volume: Number(raw.volume || 0)
    };
    if (![candle.start, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) ||
        candle.start <= 0 || candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 ||
        candle.high < Math.max(candle.open, candle.close) ||
        candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low) continue;
    seen.set(candle.start, candle);
  }
  return [...seen.values()].sort((a, b) => a.start - b.start)
    .filter(candle => candle.start + intervalMs <= Date.now());
}

function baselineSignal(candles) {
  const closes = candles.map(c => c.close);
  const fast = sma(closes, 9);
  const slow = sma(closes, 21);
  const last = closes[closes.length - 1];
  const rsi = calculateRsi(closes, 14);
  if (fast === null || slow === null || rsi === null || !Number.isFinite(last)) return 'WAIT';
  const extensionPct = ((last / fast) - 1) * 100;
  return fast > slow && last > fast && rsi >= 52 && rsi <= 70 && extensionPct <= 1.5
    ? 'BULLISH' : 'WAIT';
}

function lastCompletedHourlyIndex(hourly, decisionTime, currentIndex = -1) {
  let index = currentIndex;
  while (index + 1 < hourly.length &&
    hourly[index + 1].start + INTERVAL_1H_MS <= decisionTime) index += 1;
  return index;
}

function lastCompletedIndex(candles, intervalMs, decisionTime, currentIndex = -1) {
  let index = currentIndex;
  while (index + 1 < candles.length && candles[index + 1].start + intervalMs <= decisionTime) index += 1;
  return index;
}

function metrics(trades, initialCapital) {
  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl < 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.netPnl, 0));
  const net = trades.reduce((sum, t) => sum + t.netPnl, 0);
  let equity = initialCapital;
  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equity += trade.netPnl;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak * 100);
  }
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: trades.length - wins.length - losses.length,
    winRatePct: trades.length ? Number((wins.length / trades.length * 100).toFixed(2)) : null,
    grossProfit: Number(grossProfit.toFixed(4)),
    grossLoss: Number(grossLoss.toFixed(4)),
    profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(3)) : (grossProfit > 0 ? null : 0),
    fees: Number(trades.reduce((sum, t) => sum + t.fees, 0).toFixed(4)),
    netPnl: Number(net.toFixed(4)),
    expectancyPerTrade: trades.length ? Number((net / trades.length).toFixed(4)) : null,
    averageWin: wins.length ? Number((grossProfit / wins.length).toFixed(4)) : null,
    averageLoss: losses.length ? Number((-grossLoss / losses.length).toFixed(4)) : null,
    averageWinLossRatio: wins.length && losses.length ? Number((grossProfit / wins.length / (grossLoss / losses.length)).toFixed(3)) : null,
    maxDrawdownPct: Number(maxDrawdown.toFixed(2)),
    endingEquity: Number((initialCapital + net).toFixed(4))
  };
}

function runBacktest({
  candles15m,
  candles1h,
  candles4h = [],
  strategy = 'enhanced',
  initialCapital = 5000,
  riskPct = 1,
  stopLossPct = 1,
  takeProfitPct = 2,
  feeRatePerSide = 0.001,
  entrySlippagePct = 0.05,
  stopSlippagePct = 0.25,
  fxRate = 1,
  trainFraction = 0.7
}) {
  const bars = normalizeCandles(candles15m, INTERVAL_15M_MS);
  const hourly = normalizeCandles(candles1h, INTERVAL_1H_MS);
  const fourHourly = normalizeCandles(candles4h, INTERVAL_4H_MS);
  const numeric = [initialCapital, riskPct, stopLossPct, takeProfitPct, feeRatePerSide,
    entrySlippagePct, stopSlippagePct, fxRate, trainFraction];
  if (numeric.some(v => !Number.isFinite(Number(v))) || initialCapital <= 0 ||
      riskPct <= 0 || riskPct > 5 || stopLossPct <= 0 || takeProfitPct <= 0 ||
      feeRatePerSide < 0 || entrySlippagePct < 0 || stopSlippagePct < 0 ||
      fxRate <= 0 || trainFraction <= 0.5 || trainFraction >= 0.9) {
    throw new TypeError('Parâmetros de backtest inválidos.');
  }
  if (bars.length < 150 || hourly.length < 60 || (strategy === 'trend_pullback' && fourHourly.length < 100)) {
    throw new Error('Histórico insuficiente: são necessários 150 candles de 15m, 60 de 1h e, para o candidato, 100 de 4h.');
  }

  const splitIndex = Math.floor(bars.length * trainFraction);
  const splitTimestamp = bars[splitIndex].start;
  const trades = [];
  let hourlyIndex = -1;
  let fourHourlyIndex = -1;
  let openPosition = null;
  let equity = initialCapital;
  let skippedSignals = 0;

  for (let i = 100; i < bars.length - 1; i += 1) {
    const candle = bars[i];
    if (openPosition) {
      const stopTouched = candle.low <= openPosition.stopPrice;
      const targetTouched = candle.high >= openPosition.targetPrice;
      if (!stopTouched && !targetTouched) continue;

      // Conservative intrabar rule: if both stop and target are touched in one
      // candle, assume the stop happened first. A stop gap fills at the worse open.
      const exitReason = stopTouched ? 'STOP_LOSS' : 'TAKE_PROFIT';
      const rawExit = stopTouched
        ? Math.min(candle.open, openPosition.stopPrice)
        : openPosition.targetPrice;
      const exitPrice = stopTouched
        ? rawExit * (1 - stopSlippagePct / 100)
        : rawExit;
      const grossPnl = (exitPrice - openPosition.entryPrice) * openPosition.quantity * fxRate;
      const exitFee = exitPrice * openPosition.quantity * fxRate * feeRatePerSide;
      const fees = openPosition.entryFee + exitFee;
      const netPnl = grossPnl - fees;
      const trade = {
        strategy,
        entryTime: new Date(openPosition.entryTime).toISOString(),
        exitTime: new Date(candle.start + INTERVAL_15M_MS).toISOString(),
        entryPrice: Number(openPosition.entryPrice.toPrecision(10)),
        exitPrice: Number(exitPrice.toPrecision(10)),
        quantity: Number(openPosition.quantity.toPrecision(10)),
        exitReason,
        grossPnl: Number(grossPnl.toFixed(6)),
        fees: Number(fees.toFixed(6)),
        netPnl: Number(netPnl.toFixed(6)),
        riskBudget: Number(openPosition.riskBudget.toFixed(6)),
        holdBars: i - openPosition.entryIndex + 1
      };
      trades.push(trade);
      equity += netPnl;
      openPosition = null;
      continue;
    }

    const decisionTime = candle.start + INTERVAL_15M_MS;
    hourlyIndex = lastCompletedHourlyIndex(hourly, decisionTime, hourlyIndex);
    fourHourlyIndex = lastCompletedIndex(fourHourly, INTERVAL_4H_MS, decisionTime, fourHourlyIndex);

    // Preserve the full Wilder RSI/ATR warm-up history; this avoids resetting recursive indicators mid-test.
    const history15m = bars.slice(0, i + 1);
    const history1h = hourly.slice(0, hourlyIndex + 1);
    const history4h = fourHourly.slice(0, fourHourlyIndex + 1);
    const analysis = strategy === 'trend_pullback'
      ? analyzeTrendPullback(history15m, history1h, history4h)
      : null;
    const signal = strategy === 'baseline'
      ? baselineSignal(history15m)
      : strategy === 'trend_pullback'
        ? analysis.signal
        : analyzeCandles(history15m, history1h).signal;
    if (signal !== 'BULLISH') continue;

    const next = bars[i + 1];
    const entryPrice = next.open * (1 + entrySlippagePct / 100);
    const tradeStopPct = strategy === 'trend_pullback' ? analysis.stopLossPct : stopLossPct;
    const tradeTargetPct = strategy === 'trend_pullback' ? analysis.takeProfitPct : takeProfitPct;
    const stopPrice = entryPrice * (1 - tradeStopPct / 100);
    const effectiveTargetPct = Math.max(
      tradeTargetPct,
      2 * (tradeStopPct + stopSlippagePct + entrySlippagePct + feeRatePerSide * 200) +
        entrySlippagePct + feeRatePerSide * 200
    );
    const targetPrice = entryPrice * (1 + effectiveTargetPct / 100);
    const riskFraction = (tradeStopPct + stopSlippagePct + entrySlippagePct + feeRatePerSide * 200) / 100;
    const riskBudget = equity * riskPct / 100;
    const riskPerUnit = entryPrice * fxRate * riskFraction;
    const quantity = Math.min(riskBudget / riskPerUnit, equity / (entryPrice * fxRate));
    if (!(quantity > 0) || !Number.isFinite(quantity)) {
      skippedSignals += 1;
      continue;
    }
    const entryFee = entryPrice * quantity * fxRate * feeRatePerSide;
    openPosition = {
      entryIndex: i + 1,
      entryTime: next.start,
      entryPrice,
      stopPrice,
      targetPrice,
      quantity,
      entryFee,
      riskBudget
    };
  }

  const inSample = trades.filter(t => Date.parse(t.entryTime) < splitTimestamp);
  const outOfSample = trades.filter(t => Date.parse(t.entryTime) >= splitTimestamp);
  return {
    strategy,
    data: {
      candles15m: bars.length,
      candles1h: hourly.length,
      candles4h: fourHourly.length,
      start: bars.length ? new Date(bars[0].start).toISOString() : null,
      end: bars.length ? new Date(bars[bars.length - 1].start + INTERVAL_15M_MS).toISOString() : null,
      splitAt: new Date(splitTimestamp).toISOString(),
      trainFraction
    },
    assumptions: {
      execution: 'Sinal no fechamento do candle 15m; entrada na abertura do próximo candle',
      sameCandleStopAndTarget: 'Stop primeiro (conservador)',
      stopLossPct,
      takeProfitPctMinimum: takeProfitPct,
      feeRatePerSide,
      entrySlippagePct,
      stopSlippagePct,
      riskPct,
      quoteCurrencyPnl: true,
      fxRate,
      openTradeAtEnd: openPosition ? 'Ignorada por não estar encerrada' : null
    },
    skippedSignals,
    all: metrics(trades, initialCapital),
    inSample: metrics(inSample, initialCapital),
    outOfSample: metrics(outOfSample, initialCapital),
    trades
  };
}

module.exports = { runBacktest, normalizeCandles, baselineSignal, lastCompletedHourlyIndex, lastCompletedIndex, metrics };
