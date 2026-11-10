'use strict';

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function smaAt(bars, end, period) {
  if (end + 1 < period) return null;
  let total = 0;
  for (let i = end - period + 1; i <= end; i++) total += bars[i].close;
  return total / period;
}

function stdAt(bars, end, period) {
  const avg = smaAt(bars, end, period);
  if (avg === null) return null;
  let variance = 0;
  for (let i = end - period + 1; i <= end; i++) variance += (bars[i].close - avg) ** 2;
  return Math.sqrt(variance / period);
}

function atrAt(bars, end, period = 14) {
  if (end < period) return null;
  const ranges = [];
  for (let i = end - period + 1; i <= end; i++) {
    const prevClose = bars[i - 1].close;
    ranges.push(Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - prevClose),
      Math.abs(bars[i].low - prevClose)
    ));
  }
  return mean(ranges);
}

function rsiAt(bars, end, period = 14) {
  if (end < period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = end - period + 1; i <= end; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain > 0 ? 100 : 50;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function signalFor(strategy, bars, i) {
  const close = bars[i].close;
  const sma9 = smaAt(bars, i, 9);
  const sma20 = smaAt(bars, i, 20);
  const sma21 = smaAt(bars, i, 21);
  const sma50 = smaAt(bars, i, 50);
  if ([sma9, sma20, sma21, sma50].some(value => value === null)) return false;

  if (strategy === 'baseline_sma_9_21') return sma9 > sma21 && close > sma9;

  const priorSma20 = smaAt(bars, i - 5, 20);
  const atr = atrAt(bars, i, 14);
  const atrPct = atr === null ? null : atr / close * 100;

  if (strategy === 'trend_sma_20_50') {
    return priorSma20 !== null && sma20 > sma50 && sma20 > priorSma20 && close > sma20;
  }

  if (strategy === 'momentum_20') {
    const momentum = (close / bars[i - 20].close - 1) * 100;
    return momentum >= 1.5 && close > sma20;
  }

  if (strategy === 'breakout_20') {
    if (atrPct === null || atrPct < 0.3 || atrPct > 3) return false;
    let priorHigh = -Infinity;
    let volumeTotal = 0;
    let volumeCount = 0;
    for (let j = i - 20; j < i; j++) {
      priorHigh = Math.max(priorHigh, bars[j].high);
      if (Number.isFinite(bars[j].volume)) {
        volumeTotal += bars[j].volume;
        volumeCount++;
      }
    }
    const volumeOk = volumeCount === 0 ||
      (volumeCount === 20 && volumeTotal > 0 && bars[i].volume >= (volumeTotal / 20) * 1.1);
    return close > priorHigh && volumeOk;
  }

  if (strategy === 'mean_reversion_sideways') {
    if (priorSma20 === null || atrPct === null || atrPct >= 2.5) return false;
    const uptrend = sma20 > sma50 && sma20 > priorSma20;
    const downtrend = sma20 < sma50 && sma20 < priorSma20;
    const sideways = !uptrend && !downtrend;
    const rsi = rsiAt(bars, i, 14);
    const deviation = stdAt(bars, i, 20);
    const lowerBand = sma20 - 1.5 * deviation;
    return sideways && rsi !== null && rsi <= 30 && close < lowerBand;
  }

  throw new TypeError('Estratégia de pesquisa desconhecida: ' + strategy);
}

function backtestSignalStrategy(candles, strategy, options = {}) {
  const stopPct = Number(options.stopPct ?? 1) / 100;
  const targetPct = Number(options.targetPct ?? 4.2) / 100;
  const feeRate = Number(options.feeRate ?? 0.001);
  const slippagePct = Number(options.slippagePct ?? 0.25) / 100;
  const startingCapital = Number(options.startingCapital ?? 5000);
  const riskBudget = Number(options.riskBudget ?? 50);
  const tradeStartIndex = Number(options.tradeStartIndex ?? 50);

  if (!Array.isArray(candles) || !Number.isInteger(tradeStartIndex) ||
      tradeStartIndex < 0 || ![stopPct, targetPct, feeRate, slippagePct, startingCapital, riskBudget]
        .every(Number.isFinite) ||
      stopPct <= 0 || targetPct <= 0 || feeRate < 0 || slippagePct < 0 ||
      slippagePct >= 1 || startingCapital <= 0 || riskBudget <= 0) {
    throw new TypeError('Parâmetros inválidos para backtest de pesquisa.');
  }

  const bars = candles.map(c => ({
    start: Number(c.start), open: Number(c.open), high: Number(c.high),
    low: Number(c.low), close: Number(c.close),
    volume: c.volume == null ? null : Number(c.volume)
  }));
  if (bars.some(c => ![c.open, c.high, c.low, c.close].every(Number.isFinite) ||
      c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0 ||
      c.high < Math.max(c.open, c.close, c.low) ||
      c.low > Math.min(c.open, c.close, c.high) ||
      (c.volume !== null && (!Number.isFinite(c.volume) || c.volume < 0)))) {
    throw new TypeError('Candles OHLCV inválidos.');
  }

  let cash = startingCapital;
  let position = null;
  let peak = startingCapital;
  let maxDrawdownPct = 0;
  const trades = [];
  const mark = equity => {
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peak - equity) / peak * 100);
  };

  for (let i = tradeStartIndex; i < bars.length; i++) {
    const bar = bars[i];

    if (position) {
      const stopHit = bar.low <= position.stop;
      const targetHit = bar.high >= position.target;
      if (stopHit || targetHit) {
        const reason = stopHit ? 'STOP' : 'TARGET';
        const rawExit = reason === 'STOP'
          ? Math.min(bar.open, position.stop)
          : Math.max(bar.open, position.target);
        const exit = rawExit * (1 - slippagePct);
        const gross = (exit - position.entry) * position.quantity;
        const exitFee = exit * position.quantity * feeRate;
        const net = gross - position.entryFee - exitFee;
        cash += net;
        trades.push({ net, gross, fees: position.entryFee + exitFee, reason });
        position = null;
        mark(cash);
      }
    }

    if (position) mark(cash + (bar.close - position.entry) * position.quantity - position.entryFee);
    else mark(cash);

    if (!position && i < bars.length - 1 && signalFor(strategy, bars, i)) {
      const entry = bars[i + 1].open * (1 + slippagePct);
      const riskPerUnit = entry * (stopPct + 2 * slippagePct + 2 * feeRate);
      const quantity = Math.min(
        riskBudget / riskPerUnit,
        cash / (entry * (1 + feeRate))
      );
      if (quantity > 0 && Number.isFinite(quantity)) {
        const entryFee = entry * quantity * feeRate;
        position = {
          entry, quantity, entryFee,
          stop: entry * (1 - stopPct),
          target: entry * (1 + targetPct)
        };
      }
    }
  }

  if (position) {
    const last = bars[bars.length - 1];
    const exit = last.close * (1 - slippagePct);
    const gross = (exit - position.entry) * position.quantity;
    const exitFee = exit * position.quantity * feeRate;
    const net = gross - position.entryFee - exitFee;
    cash += net;
    trades.push({ net, gross, fees: position.entryFee + exitFee, reason: 'END_OF_DATA' });
    mark(cash);
  }

  const wins = trades.filter(t => t.net > 0);
  const losses = trades.filter(t => t.net < 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.net, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.net, 0));
  return {
    strategy,
    tradeCount: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length ? wins.length / trades.length * 100 : 0,
    netPnlUsdt: cash - startingCapital,
    endingCapitalUsdt: cash,
    expectancyUsdt: trades.length ? trades.reduce((sum, t) => sum + t.net, 0) / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 'Infinity' : 0),
    maxDrawdownPct,
    feesUsdt: trades.reduce((sum, t) => sum + t.fees, 0),
    stopCount: trades.filter(t => t.reason === 'STOP').length,
    targetCount: trades.filter(t => t.reason === 'TARGET').length,
    endOfDataCount: trades.filter(t => t.reason === 'END_OF_DATA').length,
    assumptions: {
      entryTiming: 'NEXT_CANDLE_OPEN',
      signalUsesClosedCandle: true,
      sameCandleStopTarget: 'STOP_FIRST',
      feePctPerSide: feeRate * 100,
      slippagePctPerSide: slippagePct * 100,
      stopPct: stopPct * 100,
      targetPct: targetPct * 100,
      sizing: 'FIXED_MAX_RISK_BUDGET_USDT',
      quoteCurrency: 'USDT'
    }
  };
}

module.exports = { backtestSignalStrategy, signalFor };
