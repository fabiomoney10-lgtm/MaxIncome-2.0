'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEligibleUniverse } = require('../src/binance-universe-scanner');

test('keeps only active, liquid Spot USDT pairs with acceptable spread', () => {
  const result = buildEligibleUniverse({
    exchangeInfo: { symbols: [
      { symbol: 'AAAUSDT', baseAsset: 'AAA', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true, permissions: ['SPOT'] },
      { symbol: 'BBBUSDT', baseAsset: 'BBB', quoteAsset: 'USDT', status: 'BREAK', isSpotTradingAllowed: true, permissions: ['SPOT'] },
      { symbol: 'CCCUSDT', baseAsset: 'CCC', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true, permissions: ['SPOT'] }
    ] },
    tickers: [
      { symbol: 'AAAUSDT', quoteVolume: '5000000', lastPrice: '10', priceChangePercent: '4', highPrice: '11', lowPrice: '9', count: 10000 },
      { symbol: 'BBB', quoteVolume: '9000000', lastPrice: '10', priceChangePercent: '2', highPrice: '11', lowPrice: '9', count: 10000 },
      { symbol: 'CCCUSDT', quoteVolume: '4000000', lastPrice: '10', priceChangePercent: '2', highPrice: '11', lowPrice: '9', count: 10000 }
    ],
    bookTickers: [
      { symbol: 'AAAUSDT', bidPrice: '9.99', askPrice: '10.01' },
      { symbol: 'CCCUSDT', bidPrice: '9.90', askPrice: '10.10' }
    ],
    minQuoteVolume: 1000000,
    maxSpreadPct: 0.15
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].symbol, 'AAAUSDT');
  assert.equal(result[0].stage, 'CANDIDATE');
});

test('returns no candidate when volume is below threshold', () => {
  const result = buildEligibleUniverse({
    exchangeInfo: { symbols: [{ symbol: 'AAAUSDT', baseAsset: 'AAA', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true }] },
    tickers: [{ symbol: 'AAAUSDT', quoteVolume: '100', lastPrice: '10', priceChangePercent: '1', highPrice: '11', lowPrice: '9', count: 100 }],
    bookTickers: [{ symbol: 'AAAUSDT', bidPrice: '9.99', askPrice: '10.01' }],
    minQuoteVolume: 1000000
  });
  assert.equal(result.length, 0);
});
