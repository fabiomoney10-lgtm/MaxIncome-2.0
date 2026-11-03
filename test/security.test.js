'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BybitClient } = require('../src/bybit');
const { RiskManager } = require('../src/risk-manager');

test('Bybit client uses only the fixed Testnet host', () => {
  const client = new BybitClient({ apiKey: '', apiSecret: '' });
  assert.equal(client.baseUrl, 'https://api-testnet.bybit.com');
});

test('Bybit client rejects every non-GET method before making a request', async () => {
  const client = new BybitClient({ apiKey: '', apiSecret: '' });
  await assert.rejects(
    client.request('POST', '/v5/market/tickers'),
    /Operação bloqueada/
  );
});

test('Bybit client rejects unapproved endpoints, including order creation', async () => {
  const client = new BybitClient({ apiKey: '', apiSecret: '' });
  await assert.rejects(
    client.request('GET', '/v5/order/create'),
    /Operação bloqueada/
  );
});

test('approved market reads use GET against Testnet', async () => {
  const client = new BybitClient({ apiKey: '', apiSecret: '' });
  const originalFetch = global.fetch;
  let requestedUrl;
  let requestedMethod;

  global.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestedMethod = options.method;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ retCode: 0, result: { list: [] } })
    };
  };

  try {
    await client.request('GET', '/v5/market/tickers', {
      category: 'spot',
      symbol: 'BTCUSDT'
    });
    assert.match(requestedUrl, /^https:\/\/api-testnet\.bybit\.com\//);
    assert.equal(requestedMethod, 'GET');
  } finally {
    global.fetch = originalFetch;
  }
});

test('risk manager never authorizes real or simulated order execution', () => {
  const risk = new RiskManager();
  for (const signal of ['BULLISH', 'BEARISH']) {
    const result = risk.evaluate({ signal, usdtBalance: 1000 });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /Modo PAPER/);
  }
});
