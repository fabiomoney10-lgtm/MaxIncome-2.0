'use strict';
const { analyzeCandles } = require('./strategy');

const BASES = ['https://api.binance.com', 'https://data-api.binance.vision'];
const SYMBOLS = (process.env.RADAR_ASSETS || process.env.ASSETS || 'BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT')
  .split(',').map(x => x.trim().toUpperCase()).filter(x => /^[A-Z0-9]{3,20}USDT$/.test(x)).slice(0, 30);
const cache = { at: 0, value: null };
const MIN_QUOTE_VOLUME = Number(process.env.RADAR_MIN_QUOTE_VOLUME_USDT || 1000000);
const MAX_SPREAD_PCT = Number(process.env.RADAR_MAX_SPREAD_PCT || 0.15);

async function binanceGet(path) {
  let lastError;
  for (const base of BASES) {
    try {
      const response = await fetch(base + path, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error('Binance HTTP ' + response.status);
      return await response.json();
    } catch (error) { lastError = error; }
  }
  throw new Error('Dados públicos Binance indisponíveis: ' + (lastError?.message || 'erro desconhecido'));
}

function mapCandles(rows, intervalMs) {
  return (Array.isArray(rows) ? rows : []).map(row => ({
    start: Number(row[0]), open: Number(row[1]), high: Number(row[2]),
    low: Number(row[3]), close: Number(row[4]), volume: Number(row[5])
  })).filter(c => Number.isFinite(c.close) && c.close > 0 &&
    Number.isFinite(c.start) && c.start + intervalMs <= Date.now());
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

async function analyzeSymbol(symbol) {
  const encoded = encodeURIComponent(symbol);
  const [ticker, raw15m, raw1h, book] = await Promise.all([
    binanceGet('/api/v3/ticker/24hr?symbol=' + encoded),
    binanceGet('/api/v3/klines?symbol=' + encoded + '&interval=15m&limit=120'),
    binanceGet('/api/v3/klines?symbol=' + encoded + '&interval=1h&limit=120'),
    binanceGet('/api/v3/ticker/bookTicker?symbol=' + encoded)
  ]);
  const candles15m = mapCandles(raw15m, 15 * 60 * 1000);
  const candles1h = mapCandles(raw1h, 60 * 60 * 1000);
  const analysis = analyzeCandles(candles15m, candles1h);
  const price = Number(ticker.lastPrice);
  const bid = Number(book.bidPrice);
  const ask = Number(book.askPrice);
  const quoteVolume24h = Number(ticker.quoteVolume);
  const validPrice = Number.isFinite(price) && price > 0;
  const spreadPct = bid > 0 && ask >= bid ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null;
  const liquidityOk = Number.isFinite(quoteVolume24h) && quoteVolume24h >= MIN_QUOTE_VOLUME;
  const spreadOk = Number.isFinite(spreadPct) && spreadPct <= MAX_SPREAD_PCT;
  const technicalBuy = analysis.signal === 'BULLISH' && Number(analysis.score) >= 85;
  const buy = technicalBuy && validPrice && liquidityOk && spreadOk;

  // Volatility-adjusted risk: 1.5 ATR, bounded to avoid unusable or oversized stops.
  const atrPct = Number(analysis.atrPct);
  const stopPct = Number.isFinite(atrPct) && atrPct > 0 ? clamp(atrPct * 1.5, 0.6, 2.0) : null;
  const riskDistance = validPrice && stopPct !== null ? price * stopPct / 100 : null;
  const entry = buy ? price : null;
  const stopLoss = buy && riskDistance ? entry - riskDistance : null;
  const target1 = buy && riskDistance ? entry + riskDistance * 1.5 : null;
  const target2 = buy && riskDistance ? entry + riskDistance * 2 : null;
  const reasons = [analysis.reason];
  if (!liquidityOk) reasons.push('liquidez 24h abaixo do mínimo de ' + MIN_QUOTE_VOLUME.toLocaleString('en-US') + ' USDT');
  if (!spreadOk) reasons.push('spread indisponível ou acima de ' + MAX_SPREAD_PCT + '%');
  if (!validPrice) reasons.push('preço de mercado inválido');
  return {
    symbol, price: validPrice ? price : null,
    change24hPct: Number(ticker.priceChangePercent),
    quoteVolume24h,
    bid: Number.isFinite(bid) ? bid : null,
    ask: Number.isFinite(ask) ? ask : null,
    spreadPct,
    signal: buy ? 'BUY' : 'WAIT',
    score: Number(analysis.score || 0),
    rsi14: analysis.rsi14,
    atrPct: analysis.atrPct,
    stopPct,
    filters: { ...(analysis.filters || {}), liquidityOk, spreadOk },
    reason: reasons.filter(Boolean).join('; '),
    timeframe: '15m + confirmação 1h',
    entry, stopLoss, target1, target2,
    riskRewardTarget1: 1.5,
    riskRewardTarget2: 2,
    updatedAt: new Date().toISOString()
  };
}

async function getSignals(force = false) {
  if (!force && cache.value && Date.now() - cache.at < 15000) return cache.value;
  const results = await Promise.all(SYMBOLS.map(async symbol => {
    try { return await analyzeSymbol(symbol); }
    catch (error) {
      return { symbol, signal: 'NO_DATA', score: 0, reason: error.message,
        price: null, entry: null, stopLoss: null, target1: null, target2: null,
        updatedAt: new Date().toISOString() };
    }
  }));
  results.sort((a, b) => b.score - a.score);
  const value = {
    provider: 'Binance Spot public market data',
    mode: 'SIGNALS_ONLY_MANUAL_EXECUTION',
    executionEnabled: false,
    updatedAt: new Date().toISOString(),
    timeframe: '15m + confirmação 1h',
    filter: 'BUY exige score >= 85, tendência 15m/1h, momentum, volume, liquidez mínima e spread controlado.',
    riskModel: 'Stop baseado em 1,5x ATR, limitado entre 0,6% e 2%; alvos em 1,5R e 2R.',
    minimumQuoteVolume24h: MIN_QUOTE_VOLUME,
    maximumSpreadPct: MAX_SPREAD_PCT,
    signals: results,
    buyCount: results.filter(x => x.signal === 'BUY').length,
    dataErrors: results.filter(x => x.signal === 'NO_DATA').length
  };
  cache.at = Date.now(); cache.value = value;
  return value;
}

module.exports = { getSignals };
