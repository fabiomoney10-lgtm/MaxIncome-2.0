'use strict';

function sma(values, period) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/**
 * Isolated long-only research backtest.
 * A signal is computed using candles through the signal candle's close.
 * Entry is the following candle's open, with adverse slippage.
 * Stops/targets are checked only from the entry candle onward.
 * If both levels are touched in one candle, stop is assumed first.
 * Fees and adverse slippage are charged on both sides.
 * Drawdown is close-to-close marked-to-market plus realized exit costs.
 */
function backtestSma(candles, options = {}) {
  const fastPeriod = Number(options.fastPeriod ?? 9);
  const slowPeriod = Number(options.slowPeriod ?? 21);
  const stopPct = Number(options.stopPct ?? 1) / 100;
  const targetPct = Number(options.targetPct ?? 4.2) / 100;
  const feeRate = Number(options.feeRate ?? 0.001);
  const slippagePct = Number(options.slippagePct ?? 0.25) / 100;
  const startingCapital = Number(options.startingCapital ?? 5000);
  const riskBudget = Number(options.riskBudget ?? 50);
  const numeric = [stopPct, targetPct, feeRate, slippagePct, startingCapital, riskBudget];

  if (!Array.isArray(candles) ||
      !Number.isInteger(fastPeriod) || !Number.isInteger(slowPeriod) ||
      fastPeriod < 2 || slowPeriod <= fastPeriod ||
      numeric.some(value => !Number.isFinite(value)) ||
      stopPct <= 0 || targetPct <= 0 || feeRate < 0 || slippagePct < 0 ||
      slippagePct >= 1 || startingCapital <= 0 || riskBudget <= 0) {
    throw new TypeError('Parâmetros inválidos para backtest.');
  }

  const bars = candles.map(c => ({
    open: Number(c.open), high: Number(c.high), low: Number(c.low),
    close: Number(c.close), start: c.start
  }));
  if (bars.some(c => ![c.open, c.high, c.low, c.close].every(Number.isFinite) ||
      c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0 ||
      c.high < Math.max(c.open, c.close, c.low) ||
      c.low > Math.min(c.open, c.close, c.high))) {
    throw new TypeError('Candles OHLC inválidos.');
  }

  let cash = startingCapital;
  let position = null;
  let peak = startingCapital;
  let maxDrawdownPct = 0;
  const trades = [];

  function markEquity(equity) {
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peak - equity) / peak * 100);
  }

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    // A position is evaluated only on candles at or after its actual entry index.
    if (position && i >= position.index) {
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
        const fees = position.entryFee + exitFee;
        const net = gross - fees;
        cash += net;
        trades.push({
          entry: position.entry, exit, reason, gross, fees, net,
          entryFee: position.entryFee, exitFee,
          entryIndex: position.index, exitIndex: i, barsHeld: i - position.index
        });
        position = null;
        markEquity(cash);
      }
    }

    // Mark-to-market only after the entry candle has actually begun.
    if (position && i >= position.index) {
      markEquity(cash + (bar.close - position.entry) * position.quantity - position.entryFee);
    } else if (!position) {
      markEquity(cash);
    }

    // The current close is known at this point; the fill is not until next candle open.
    if (!position && i < bars.length - 1 && i + 1 >= slowPeriod) {
      const closesThroughSignal = bars.slice(0, i + 1).map(c => c.close);
      const fast = sma(closesThroughSignal, fastPeriod);
      const slow = sma(closesThroughSignal, slowPeriod);
      const bullish = fast !== null && slow !== null &&
        fast > slow && bar.close > fast;

      if (bullish) {
        const nextOpen = bars[i + 1].open;
        const entry = nextOpen * (1 + slippagePct);
        const riskPerUnit = entry * (stopPct + slippagePct + feeRate * 2);
        const quantity = Math.min(riskBudget / riskPerUnit, cash / (entry * (1 + feeRate)));
        if (quantity > 0 && Number.isFinite(quantity)) {
          const notional = entry * quantity;
          const entryFee = notional * feeRate;
          position = {
            entry, quantity, entryFee,
            stop: entry * (1 - stopPct),
            target: entry * (1 + targetPct),
            index: i + 1
          };
        }
      }
    }
  }

  // Explicit end-of-data liquidation includes exit slippage and fee.
  if (position) {
    const lastIndex = bars.length - 1;
    const last = bars[lastIndex];
    const exit = last.close * (1 - slippagePct);
    const gross = (exit - position.entry) * position.quantity;
    const exitFee = exit * position.quantity * feeRate;
    const fees = position.entryFee + exitFee;
    const net = gross - fees;
    cash += net;
    trades.push({
      entry: position.entry, exit, reason: 'END_OF_DATA', gross, fees, net,
      entryFee: position.entryFee, exitFee,
      entryIndex: position.index, exitIndex: lastIndex,
      barsHeld: lastIndex - position.index
    });
    markEquity(cash);
  }

  const wins = trades.filter(t => t.net > 0);
  const losses = trades.filter(t => t.net < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.net, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.net, 0));

  return {
    trades,
    tradeCount: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length ? wins.length / trades.length * 100 : 0,
    netPnl: cash - startingCapital,
    endingCapital: cash,
    expectancyPerTrade: trades.length ? trades.reduce((sum, trade) => sum + trade.net, 0) / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    maxDrawdownPct,
    assumptions: {
      fastPeriod, slowPeriod, stopPct: stopPct * 100, targetPct: targetPct * 100,
      feePctPerSide: feeRate * 100, slippagePctPerSide: slippagePct * 100,
      entryTiming: 'NEXT_CANDLE_OPEN', signalUsesCurrentClose: true,
      sameCandleStopTarget: 'STOP_FIRST', drawdownMethod: 'CLOSE_TO_CLOSE_PLUS_REALIZED_EXITS'
    }
  };
}

module.exports = { backtestSma };
