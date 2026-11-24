'use strict';
const { analyzeCandles } = require('./strategy');

const BASES = ['https://api.binance.com', 'https://data-api.binance.vision'];
const SYMBOLS = (process.env.RADAR_ASSETS || process.env.ASSETS || 'BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT')
  .split(',').map(x => x.trim().toUpperCase()).filter(x => /^[A-Z0-9]{3,20}USDT$/.test(x)).slice(0, 30);
const cache = { at: 0, value: null };

async function binanceGet(path) {
  let lastError;
  for (const base of BASES) {
    try {
      const response = await fetch(base + path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Binance HTTP ' + response.status);
      return await response.json();
    } catch (error) { lastError = error; }
  }
  throw new Error('Dados públicos Binance indisponíveis: ' + (lastError?.message || 'erro desconhecido'));
}

function mapCandles(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => ({
    start: Number(row[0]), open: Number(row[1]), high: Number(row[2]),
    low: Number(row[3]), close: Number(row[4]), volume: Number(row[5])
  })).filter(c => Number.isFinite(c.close) && c.close > 0 && c.start < Date.now() - 60000);
}

async function analyzeSymbol(symbol) {
  const [ticker, raw15m, raw1h] = await Promise.all([
    binanceGet('/api/v3/ticker/24hr?symbol=' + encodeURIComponent(symbol)),
    binanceGet('/api/v3/klines?symbol=' + encodeURIComponent(symbol) + '&interval=15m&limit=100'),
    binanceGet('/api/v3/klines?symbol=' + encodeURIComponent(symbol) + '&interval=1h&limit=100')
  ]);
  const analysis = analyzeCandles(mapCandles(raw15m), mapCandles(raw1h));
  const price = Number(ticker.lastPrice);
  const validPrice = Number.isFinite(price) && price > 0;
  const stopPct = 1;
  const target1Pct = 1.5;
  const target2Pct = 2;
  const buy = analysis.signal === 'BULLISH' && analysis.score >= 85 && validPrice;
  return {
    symbol, price: validPrice ? price : null,
    change24hPct: Number(ticker.priceChangePercent),
    quoteVolume24h: Number(ticker.quoteVolume),
    signal: buy ? 'BUY' : 'WAIT',
    score: Number(analysis.score || 0),
    rsi14: analysis.rsi14,
    atrPct: analysis.atrPct,
    filters: analysis.filters || {},
    reason: analysis.reason || 'Aguardando dados suficientes.',
    timeframe: '15m + confirmação 1h',
    entry: buy ? price : null,
    stopLoss: buy ? price * (1 - stopPct / 100) : null,
    target1: buy ? price * (1 + target1Pct / 100) : null,
    target2: buy ? price * (1 + target2Pct / 100) : null,
    riskRewardTarget2: target2Pct / stopPct,
    updatedAt: new Date().toISOString()
  };
}

async function getSignals(force = false) {
  if (!force && cache.value && Date.now() - cache.at < 15000) return cache.value;
  const results = await Promise.all(SYMBOLS.map(async symbol => {
    try { return await analyzeSymbol(symbol); }
    catch (error) { return { symbol, signal: 'NO_DATA', score: 0, reason: error.message, price: null, updatedAt: new Date().toISOString() }; }
  }));
  results.sort((a, b) => b.score - a.score);
  const value = {
    provider: 'Binance Spot public market data',
    mode: 'SIGNALS_ONLY_MANUAL_EXECUTION',
    executionEnabled: false,
    updatedAt: new Date().toISOString(),
    timeframe: '15m + confirmação 1h',
    filter: 'Somente BUY com score >= 85 e seis filtros técnicos confirmados; demais ativos ficam em WAIT.',
    signals: results,
    buyCount: results.filter(x => x.signal === 'BUY').length
  };
  cache.at = Date.now(); cache.value = value;
  return value;
}

module.exports = { getSignals };
