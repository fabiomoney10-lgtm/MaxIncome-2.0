'use strict';

function sma(values, period, endExclusive) {
  if (endExclusive < period) return null;
  let sum = 0;
  for (let i = endExclusive - period; i < endExclusive; i++) sum += values[i];
  return sum / period;
}

/**
 * Walk-forward, long-only SMA backtest.
 * Signal is evaluated at candle close; entry is at the NEXT candle open.
 * If stop and target are both touched in one candle, stop is assumed first.
 * Fees and adverse slippage are charged on both entry and exit.
 */
function backtestSma(candles, options = {}) {
  const fastPeriod = Number(options.fastPeriod || 9);
  const slowPeriod = Number(options.slowPeriod || 21);
  const stopPct = Number(options.stopPct ?? 1) / 100;
  const targetPct = Number(options.targetPct ?? 4.2) / 100;
  const feeRate = Number(options.feeRate ?? 0.001);
  const slippagePct = Number(options.slippagePct ?? 0.25) / 100;
  const startingCapital = Number(options.startingCapital ?? 5000);
  const riskBudget = Number(options.riskBudget ?? 50);
  if (!Array.isArray(candles) || fastPeriod < 2 || slowPeriod <= fastPeriod ||
      stopPct <= 0 || targetPct <= 0 || feeRate < 0 || slippagePct < 0 ||
      startingCapital <= 0 || riskBudget <= 0) {
    throw new TypeError('Parâmetros inválidos para backtest.');
  }
  const bars = candles.map(c => ({
    open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), start: c.start
  }));
  if (bars.some(c => ![c.open,c.high,c.low,c.close].every(Number.isFinite) ||
      c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0 ||
      c.high < Math.max(c.open,c.close,c.low) || c.low > Math.min(c.open,c.close,c.high))) {
    throw new TypeError('Candles OHLC inválidos.');
  }

  let cash = startingCapital, position = null, peak = startingCapital, maxDrawdownPct = 0;
  const trades = [];
  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i];
    if (position) {
      const stopHit = bar.low <= position.stop;
      const targetHit = bar.high >= position.target;
      if (stopHit || targetHit) {
        const reason = stopHit ? 'STOP' : 'TARGET';
        const rawExit = reason === 'STOP' ? Math.min(bar.open, position.stop) : Math.max(bar.open, position.target);
        const exit = rawExit * (1 - slippagePct);
        const gross = (exit - position.entry) * position.quantity;
        const exitFee = exit * position.quantity * feeRate;
        const net = gross - position.entryFee - exitFee;
        cash += net;
        trades.push({ entry: position.entry, exit, reason, gross, fees: position.entryFee + exitFee, net, barsHeld: i - position.index });
        position = null;
      }
    }

    if (!position && i < bars.length - 1 && i >= slowPeriod) {
      const closes = bars.slice(0, i).map(c => c.close);
      const fast = sma(closes, fastPeriod, closes.length);
      const slow = sma(closes, slowPeriod, closes.length);
      const priorFast = sma(closes, fastPeriod, closes.length - 1);
      const priorSlow = sma(closes, slowPeriod, closes.length - 1);
      const bullish = fast > slow && bar.close > fast;
      if (bullish && !(priorFast > priorSlow)) {
        const nextOpen = bars[i + 1].open;
        const entry = nextOpen * (1 + slippagePct);
        // Size to a fixed gross stop budget, then cap notional to available cash.
        const riskPerUnit = entry * (stopPct + slippagePct + feeRate * 2);
        const quantity = Math.min(riskBudget / riskPerUnit, cash / (entry * (1 + feeRate)));
        if (quantity > 0) {
          const notional = entry * quantity;
          const entryFee = notional * feeRate;
          position = { entry, quantity, entryFee, stop: entry * (1 - stopPct), target: entry * (1 + targetPct), index: i + 1 };
        }
      }
    }
    const marked = cash + (position ? (bar.close - position.entry) * position.quantity - position.entryFee : 0);
    peak = Math.max(peak, marked);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peak - marked) / peak * 100);
  }
  if (position) {
    const last = bars[bars.length - 1];
    const exit = last.close * (1 - slippagePct);
    const gross = (exit - position.entry) * position.quantity;
    const exitFee = exit * position.quantity * feeRate;
    const net = gross - position.entryFee - exitFee;
    cash += net;
    trades.push({ entry: position.entry, exit, reason: 'END_OF_DATA', gross, fees: position.entryFee + exitFee, net, barsHeld: bars.length - 1 - position.index });
  }
  const wins = trades.filter(t => t.net > 0);
  const losses = trades.filter(t => t.net < 0);
  const grossProfit = wins.reduce((s,t) => s + t.net, 0);
  const grossLoss = Math.abs(losses.reduce((s,t) => s + t.net, 0));
  return {
    trades, tradeCount: trades.length, wins: wins.length, losses: losses.length,
    winRatePct: trades.length ? wins.length / trades.length * 100 : 0,
    netPnl: cash - startingCapital, endingCapital: cash,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    maxDrawdownPct, assumptions: { fastPeriod, slowPeriod, stopPct: stopPct*100, targetPct: targetPct*100, feePctPerSide: feeRate*100, slippagePctPerSide: slippagePct*100 }
  };
}

module.exports = { backtestSma };
