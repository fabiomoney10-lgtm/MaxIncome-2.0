'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BybitExecutionGateway } = require('../src/bybit-execution');

function fakeClient({ testnet = true } = {}) {
  const calls = [];
  return {
    testnet,
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    calls,
    async getWalletBalance() { return { USDT: { walletBalance: 100 } }; },
    async request(method, endpoint, params, signed) {
      calls.push({ method, endpoint, params, signed });
      if (endpoint === '/v5/order/create') return { orderId: 'test-order-1', orderLinkId: params.orderLinkId };
      if (endpoint === '/v5/order/realtime') return { list: [{ orderId: 'test-order-1', orderLinkId: 'mi2-test', orderStatus: 'Filled', side: 'Buy', qty: '10', cumExecQty: '10', avgPrice: '1', cumExecValue: '10', updatedTime: '1' }] };
      if (endpoint === '/v5/market/instruments-info') return { list: [{ symbol: params.symbol, status: 'Trading', baseCoin: 'BTC', quoteCoin: 'USDT', lotSizeFilter: { minOrderAmt: '5' }, priceFilter: { tickSize: '0.01' } }] };
      throw new Error('Unexpected endpoint');
    }
  };
}

test('gateway is disabled by default and refuses to submit orders', async () => {
  const client = fakeClient();
  const gateway = new BybitExecutionGateway({ client });
  await assert.rejects(
    gateway.placeSpotMarketBuy({ symbol: 'BTCUSDT', quoteQtyUSDT: 10 }),
    /desabilitada/
  );
  assert.equal(client.calls.length, 0);
});

test('gateway refuses Mainnet even when enabled', async () => {
  const client = fakeClient({ testnet: false });
  const gateway = new BybitExecutionGateway({ client, enabled: true });
  await assert.rejects(
    gateway.placeSpotMarketBuy({ symbol: 'BTCUSDT', quoteQtyUSDT: 10 }),
    /somente Bybit Testnet/
  );
  assert.equal(client.calls.length, 0);
});

test('Spot market buy uses quoteCoin, no leverage, and unique client order id', async () => {
  const client = fakeClient();
  const gateway = new BybitExecutionGateway({ client, enabled: true });
  const result = await gateway.placeSpotMarketBuy({
    symbol: 'BTCUSDT',
    quoteQtyUSDT: 10,
    orderLinkId: 'mi2-test-buy-1'
  });
  assert.equal(result.status, 'ACKNOWLEDGED_UNCONFIRMED');
  assert.equal(result.orderId, 'test-order-1');
  assert.equal(client.calls[0].signed, true);
  assert.equal(client.calls[0].params.marketUnit, 'quoteCoin');
  assert.equal(client.calls[0].params.isLeverage, 0);
  assert.equal(client.calls[0].params.side, 'Buy');
});

test('Spot market sell uses baseCoin and does not retry automatically', async () => {
  const client = fakeClient();
  const gateway = new BybitExecutionGateway({ client, enabled: true });
  const result = await gateway.placeSpotMarketSell({
    symbol: 'BTCUSDT',
    baseQty: 0.001,
    orderLinkId: 'mi2-test-sell-1'
  });
  assert.equal(result.status, 'ACKNOWLEDGED_UNCONFIRMED');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].params.marketUnit, 'baseCoin');
  assert.equal(client.calls[0].params.isLeverage, 0);
});

test('preflight is read-only and returns wallet and instrument constraints', async () => {
  const client = fakeClient();
  const gateway = new BybitExecutionGateway({ client });
  const result = await gateway.getPreflight(['BTCUSDT']);
  assert.equal(result.readOnly, true);
  assert.equal(result.wallet.USDT.walletBalance, 100);
  assert.equal(result.instruments[0].lotSizeFilter.minOrderAmt, '5');
  assert.equal(client.calls[0].signed, false);
});

test('order query returns exchange status and executed quantity', async () => {
  const client = fakeClient();
  const gateway = new BybitExecutionGateway({ client, enabled: true });
  const result = await gateway.getOrder({ symbol: 'BTCUSDT', orderLinkId: 'mi2-test' });
  assert.equal(result.orderStatus, 'Filled');
  assert.equal(result.cumExecQty, '10');
});

test('gateway rejects invalid amount and excessive slippage before API call', async () => {
  const client = fakeClient();
  const gateway = new BybitExecutionGateway({ client, enabled: true });
  await assert.rejects(gateway.placeSpotMarketBuy({ symbol: 'BTCUSDT', quoteQtyUSDT: 0 }), /maior que zero/);
  await assert.rejects(gateway.placeSpotMarketBuy({ symbol: 'BTCUSDT', quoteQtyUSDT: 10, slippagePct: 2 }), /máximo/);
  assert.equal(client.calls.length, 0);
});
