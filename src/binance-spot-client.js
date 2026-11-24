'use strict';

const BASE_URL = 'https://api.binance.com';

class BinanceSpotClient {
  constructor({ baseUrl = BASE_URL, timeoutMs = 10000, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Fetch indisponível neste Node.js.');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async request(endpoint, params = {}) {
    const query = new URLSearchParams(params).toString();
    const url = this.baseUrl + endpoint + (query ? '?' + query : '');
    const response = await this.fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); }
    catch { throw new Error('Resposta inválida da Binance (HTTP ' + response.status + ').'); }
    if (!response.ok) {
      const message = data && data.msg ? data.msg : 'Falha na API pública';
      throw new Error('Binance HTTP ' + response.status + ': ' + message);
    }
    return data;
  }

  async getExchangeInfo() {
    return this.request('/api/v3/exchangeInfo', { permissions: 'SPOT' });
  }

  async get24hTickers() {
    return this.request('/api/v3/ticker/24hr');
  }

  async getBookTickers() {
    return this.request('/api/v3/ticker/bookTicker');
  }

  async getKlines(symbol, interval = '15m', limit = 250) {
    if (!/^[A-Z0-9]{3,30}$/.test(symbol)) throw new Error('Símbolo inválido.');
    if (!['5m', '15m', '1h', '4h', '1d'].includes(interval)) throw new Error('Intervalo não permitido.');
    const rows = await this.request('/api/v3/klines', { symbol, interval, limit: String(limit) });
    return rows.map(row => ({
      openTime: Number(row[0]), open: Number(row[1]), high: Number(row[2]),
      low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]),
      closeTime: Number(row[6]), quoteVolume: Number(row[7]),
      trades: Number(row[8]), takerBuyBaseVolume: Number(row[9]),
      takerBuyQuoteVolume: Number(row[10]), closed: Number(row[6]) < Date.now()
    })).filter(candle => candle.closed);
  }
}

module.exports = { BinanceSpotClient };
