'use strict';

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function buildEligibleUniverse({ exchangeInfo, tickers, bookTickers, minQuoteVolume = 1000000, maxSpreadPct = 0.15 }) {
  const tickerBySymbol = new Map((tickers || []).map(item => [item.symbol, item]));
  const bookBySymbol = new Map((bookTickers || []).map(item => [item.symbol, item]));
  const symbols = (exchangeInfo && exchangeInfo.symbols) || [];

  return symbols.flatMap(info => {
    if (info.status !== 'TRADING' || info.quoteAsset !== 'USDT' || info.isSpotTradingAllowed === false) return [];
    if (Array.isArray(info.permissions) && info.permissions.length && !info.permissions.includes('SPOT')) return [];
    if (Array.isArray(info.permissionSets) && info.permissionSets.length && !info.permissionSets.some(set => Array.isArray(set) && set.includes('SPOT'))) return [];
    const ticker = tickerBySymbol.get(info.symbol);
    const book = bookBySymbol.get(info.symbol);
    if (!ticker || !book) return [];

    const quoteVolume = Number(ticker.quoteVolume);
    const bid = Number(book.bidPrice);
    const ask = Number(book.askPrice);
    const last = Number(ticker.lastPrice);
    if (![quoteVolume, bid, ask, last].every(Number.isFinite) || quoteVolume < minQuoteVolume || bid <= 0 || ask <= bid || last <= 0) return [];

    const spreadPct = ((ask - bid) / ((ask + bid) / 2)) * 100;
    if (!Number.isFinite(spreadPct) || spreadPct > maxSpreadPct) return [];

    const changePct = Number(ticker.priceChangePercent);
    const high = Number(ticker.highPrice);
    const low = Number(ticker.lowPrice);
    const rangePct = low > 0 ? ((high - low) / low) * 100 : 0;
    if (![changePct, rangePct].every(Number.isFinite)) return [];

    const liquidityScore = clamp(Math.log10(Math.max(quoteVolume, 1)) * 3, 0, 30);
    const spreadScore = clamp(20 - spreadPct * 100, 0, 20);
    const activityScore = clamp(Math.log10(Math.max(Number(ticker.count) || 0, 1)) * 2.5, 0, 15);
    const volatilityScore = clamp(rangePct * 1.5, 0, 15);
    const momentumScore = clamp(15 - Math.abs(changePct - 3) * 1.5, 0, 15);
    const scannerScore = Math.round(liquidityScore + spreadScore + activityScore + volatilityScore + momentumScore);

    return [{
      symbol: info.symbol, baseAsset: info.baseAsset, quoteAsset: info.quoteAsset,
      lastPrice: last, quoteVolume24h: quoteVolume, change24hPct: changePct,
      spreadPct, range24hPct: rangePct, trades24h: Number(ticker.count) || 0,
      scannerScore, stage: 'CANDIDATE'
    }];
  }).sort((a, b) => b.scannerScore - a.scannerScore || b.quoteVolume24h - a.quoteVolume24h);
}

class BinanceUniverseScanner {
  constructor({ client, minQuoteVolume = 1000000, maxSpreadPct = 0.15, candidateLimit = 50 }) {
    if (!client) throw new Error('Cliente Binance obrigatório.');
    this.client = client;
    this.minQuoteVolume = minQuoteVolume;
    this.maxSpreadPct = maxSpreadPct;
    this.candidateLimit = candidateLimit;
  }

  async scan() {
    const [exchangeInfo, tickers, bookTickers] = await Promise.all([
      this.client.getExchangeInfo(), this.client.get24hTickers(), this.client.getBookTickers()
    ]);
    const candidates = buildEligibleUniverse({
      exchangeInfo, tickers, bookTickers,
      minQuoteVolume: this.minQuoteVolume, maxSpreadPct: this.maxSpreadPct
    });
    return {
      scannedAt: new Date().toISOString(),
      quoteAsset: 'USDT',
      eligibleCount: candidates.length,
      candidates: candidates.slice(0, this.candidateLimit)
    };
  }
}

module.exports = { BinanceUniverseScanner, buildEligibleUniverse };
