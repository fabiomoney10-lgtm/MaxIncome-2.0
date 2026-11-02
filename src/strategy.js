function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function analyzeCandles(candles) {
  const closes = candles.map(c => c.close).filter(Number.isFinite);
  const fast = sma(closes, 9);
  const slow = sma(closes, 21);
  const last = closes[closes.length - 1];
  if (fast === null || slow === null || !Number.isFinite(last)) {
    return { signal: 'INSUFFICIENT_DATA', lastPrice: last || null, sma9: fast, sma21: slow };
  }
  let signal = 'WAIT';
  if (fast > slow && last > fast) signal = 'BULLISH';
  if (fast < slow && last < fast) signal = 'BEARISH';
  return { signal, lastPrice: last, sma9: fast, sma21: slow };
}

module.exports = { analyzeCandles };