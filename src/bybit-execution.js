'use strict';

const crypto = require('node:crypto');

function positiveAmount(value, name) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${name} deve ser um número maior que zero.`);
  }
  return amount;
}

function makeOrderLinkId(prefix = 'mi2') {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 28)}`;
}

/**
 * Isolated Bybit Spot execution gateway.
 *
 * Safety properties:
 * - disabled unless explicitly enabled by its constructor;
 * - only submits orders to Testnet (Mainnet is rejected unconditionally);
 * - uses Spot, with borrowing/leverage disabled;
 * - never retries an order automatically;
 * - treats create-order response as an acknowledgement, not a fill.
 *
 * This gateway is intentionally not wired into the strategy loop. A separate
 * order lifecycle/reconciliation layer and exchange-side exit protection are
 * required before autonomous trading can be considered.
 */
class BybitExecutionGateway {
  constructor({ client, enabled = false } = {}) {
    if (!client || typeof client.request !== 'function') {
      throw new Error('Cliente Bybit inválido.');
    }
    this.client = client;
    this.enabled = enabled === true;
  }

  assertTestnetExecution() {
    if (!this.enabled) {
      throw new Error('Execução Testnet desabilitada. Nenhuma ordem foi enviada.');
    }
    if (this.client.testnet !== true) {
      throw new Error('Bloqueio de segurança: este gateway aceita somente Bybit Testnet.');
    }
    if (!this.client.apiKey || !this.client.apiSecret) {
      throw new Error('Credenciais privadas da Bybit não configuradas.');
    }
  }

  async getPreflight(symbols = []) {
    if (!Array.isArray(symbols) || symbols.length === 0) {
      throw new Error('Informe ao menos um ativo para a verificação.');
    }
    const uniqueSymbols = [...new Set(symbols.map((s) => String(s).toUpperCase()))];
    if (uniqueSymbols.some((s) => !/^[A-Z0-9]{3,20}USDT$/.test(s))) {
      throw new Error('Lista de ativos inválida.');
    }

    const [wallet, ...instruments] = await Promise.all([
      this.client.getWalletBalance(),
      ...uniqueSymbols.map((symbol) => this.client.request(
        'GET',
        '/v5/market/instruments-info',
        { category: 'spot', symbol },
        false
      ))
    ]);

    return {
      environment: 'TESTNET',
      readOnly: true,
      orderSubmissionEnabled: this.enabled && this.client.testnet === true,
      wallet,
      instruments: instruments.map((result, index) => {
        const item = result.list && result.list[0];
        if (!item) throw new Error(`Regras de negociação indisponíveis para ${uniqueSymbols[index]}.`);
        return {
          symbol: item.symbol,
          status: item.status,
          baseCoin: item.baseCoin,
          quoteCoin: item.quoteCoin,
          lotSizeFilter: item.lotSizeFilter,
          priceFilter: item.priceFilter
        };
      })
    };
  }

  async placeSpotMarketBuy({ symbol, quoteQtyUSDT, orderLinkId, slippagePct = 0.5 } = {}) {
    this.assertTestnetExecution();
    const amount = positiveAmount(quoteQtyUSDT, 'Valor da compra em USDT');
    const slippage = positiveAmount(slippagePct, 'Limite de slippage');
    if (slippage > 1) throw new Error('Slippage máximo permitido pelo gateway: 1%.');
    const safeSymbol = String(symbol || '').toUpperCase();
    if (!/^[A-Z0-9]{3,20}USDT$/.test(safeSymbol)) throw new Error('Ativo Spot/USDT inválido.');
    const linkId = orderLinkId || makeOrderLinkId();
    if (linkId.length > 36 || !/^[A-Za-z0-9_-]+$/.test(linkId)) {
      throw new Error('orderLinkId inválido (máximo de 36 caracteres alfanuméricos, _ ou -).');
    }

    const result = await this.client.request('POST', '/v5/order/create', {
      category: 'spot',
      symbol: safeSymbol,
      side: 'Buy',
      orderType: 'Market',
      qty: String(amount),
      marketUnit: 'quoteCoin',
      timeInForce: 'IOC',
      isLeverage: 0,
      orderFilter: 'Order',
      slippageToleranceType: 'Percent',
      slippageTolerance: String(slippage),
      orderLinkId: linkId
    }, true);

    return {
      environment: 'TESTNET',
      status: 'ACKNOWLEDGED_UNCONFIRMED',
      orderId: result.orderId,
      orderLinkId: result.orderLinkId || linkId,
      warning: 'Aceite pela API; ainda não significa execução. Consulte o status e os fills.'
    };
  }

  async placeSpotMarketSell({ symbol, baseQty, orderLinkId, slippagePct = 0.5 } = {}) {
    this.assertTestnetExecution();
    const amount = positiveAmount(baseQty, 'Quantidade de venda');
    const slippage = positiveAmount(slippagePct, 'Limite de slippage');
    if (slippage > 1) throw new Error('Slippage máximo permitido pelo gateway: 1%.');
    const safeSymbol = String(symbol || '').toUpperCase();
    if (!/^[A-Z0-9]{3,20}USDT$/.test(safeSymbol)) throw new Error('Ativo Spot/USDT inválido.');
    const linkId = orderLinkId || makeOrderLinkId();
    if (linkId.length > 36 || !/^[A-Za-z0-9_-]+$/.test(linkId)) {
      throw new Error('orderLinkId inválido (máximo de 36 caracteres alfanuméricos, _ ou -).');
    }

    const result = await this.client.request('POST', '/v5/order/create', {
      category: 'spot',
      symbol: safeSymbol,
      side: 'Sell',
      orderType: 'Market',
      qty: String(amount),
      marketUnit: 'baseCoin',
      timeInForce: 'IOC',
      isLeverage: 0,
      orderFilter: 'Order',
      slippageToleranceType: 'Percent',
      slippageTolerance: String(slippage),
      orderLinkId: linkId
    }, true);

    return {
      environment: 'TESTNET',
      status: 'ACKNOWLEDGED_UNCONFIRMED',
      orderId: result.orderId,
      orderLinkId: result.orderLinkId || linkId,
      warning: 'Aceite pela API; ainda não significa execução. Consulte o status e os fills.'
    };
  }

  async getOrder({ symbol, orderId, orderLinkId } = {}) {
    this.assertTestnetExecution();
    const safeSymbol = String(symbol || '').toUpperCase();
    if (!/^[A-Z0-9]{3,20}USDT$/.test(safeSymbol)) throw new Error('Ativo Spot/USDT inválido.');
    if (!orderId && !orderLinkId) throw new Error('Informe orderId ou orderLinkId.');
    const result = await this.client.request('GET', '/v5/order/realtime', {
      category: 'spot',
      symbol: safeSymbol,
      ...(orderId ? { orderId } : { orderLinkId })
    }, true);
    const order = result.list && result.list[0];
    if (!order) return { found: false, status: 'NOT_FOUND' };
    return {
      found: true,
      orderId: order.orderId,
      orderLinkId: order.orderLinkId,
      orderStatus: order.orderStatus,
      side: order.side,
      qty: order.qty,
      cumExecQty: order.cumExecQty,
      avgPrice: order.avgPrice,
      cumExecValue: order.cumExecValue,
      updatedTime: order.updatedTime
    };
  }
}

module.exports = { BybitExecutionGateway, makeOrderLinkId };
