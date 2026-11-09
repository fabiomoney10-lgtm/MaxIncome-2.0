'use strict';

const crypto = require('crypto');

const KLINE_INTERVALS = new Set(['1','3','5','15','30','60','120','240','360','720','D','W','M']);

function candleEndTime(start, interval) {
    if (/^\d+$/.test(interval)) return start + Number(interval) * 60 * 1000;
    const date = new Date(start);
    if (interval === 'D') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    if (interval === 'W') return start + 7 * 24 * 60 * 60 * 1000;
    if (interval === 'M') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    return NaN;
}

class BybitClient {
    constructor({ apiKey, apiSecret, testnet = true }) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.testnet = testnet !== false;
        this.tradingEnvironment = this.testnet ? 'BYBIT TESTNET' : 'BYBIT MAINNET';
        this.marketDataEnvironment = 'BYBIT MAINNET';
        this.environment = this.tradingEnvironment;
        this.marketDataBaseUrl = 'https://api.bybit.com';
        this.baseUrl = this.testnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
        this.recvWindow = '5000';
    }

    async request(method, endpoint, params = {}, signed = false) {
        const query = new URLSearchParams(params).toString();
        const body = method === 'POST' ? JSON.stringify(params) : '';
        const requestBaseUrl = signed ? this.baseUrl : this.marketDataBaseUrl;
        const url = requestBaseUrl + endpoint + (method === 'GET' && query ? `?${query}` : '');
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };

        if (signed) {
            if (!this.apiKey || !this.apiSecret) throw new Error('Credenciais da Bybit não configuradas.');
            const timestamp = Date.now().toString();
            const payload = method === 'GET' ? query : body;
            const preSign = timestamp + this.apiKey + this.recvWindow + payload;
            const signature = crypto.createHmac('sha256', this.apiSecret).update(preSign).digest('hex');
            Object.assign(headers, {
                'X-BAPI-API-KEY': this.apiKey,
                'X-BAPI-SIGN': signature,
                'X-BAPI-TIMESTAMP': timestamp,
                'X-BAPI-RECV-WINDOW': this.recvWindow
            });
        }

        const response = await fetch(url, {
            method, headers,
            ...(method === 'POST' ? { body } : {}),
            signal: AbortSignal.timeout(12000)
        });
        const rawText = await response.text();
        let data;
        try {
            data = JSON.parse(rawText);
        } catch (_) {
            throw new Error(`Resposta não JSON da Bybit. HTTP ${response.status}. Ambiente: ${this.environment}.`);
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.retMsg || 'Falha na API'}`);
        if (data.retCode !== 0) throw new Error(`Bybit ${data.retCode}: ${data.retMsg || 'Erro desconhecido'}`);
        return data.result;
    }

    async getTicker(symbol) {
        const result = await this.request('GET', '/v5/market/tickers', { category: 'spot', symbol });
        const item = result.list && result.list[0];
        const lastPrice = Number(item && item.lastPrice);
        if (!item || !Number.isFinite(lastPrice) || lastPrice <= 0) {
            throw new Error(`Cotação inválida ou ausente para ${symbol}.`);
        }
        const change24h = Number(item.price24hPcnt || 0) * 100;
        return {
            symbol,
            lastPrice,
            change24h: Number.isFinite(change24h) ? change24h : 0,
            marketTimestamp: Number.isFinite(Number(result.time)) ? Number(result.time) : null
        };
    }

    async getKlines(symbol, interval = '15', limit = '60') {
        const normalizedInterval = String(interval);
        if (!KLINE_INTERVALS.has(normalizedInterval)) {
            throw new Error(`Intervalo de candles inválido: ${normalizedInterval}`);
        }
        const numericLimit = Number(limit);
        if (!Number.isInteger(numericLimit) || numericLimit < 1 || numericLimit > 1000) {
            throw new Error('Limite de candles inválido; use um inteiro entre 1 e 1000.');
        }

        const result = await this.request('GET', '/v5/market/kline', {
            category: 'spot', symbol, interval: normalizedInterval, limit: String(numericLimit)
        });
        const now = Date.now();
        const byStart = new Map();
        for (const row of (result.list || [])) {
            const start = Number(row && row[0]);
            const close = Number(row && row[4]);
            const end = candleEndTime(start, normalizedInterval);
            if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(close) || close <= 0 ||
                !Number.isFinite(end) || end > now) continue;
            byStart.set(start, { start, close, isClosed: true });
        }
        return Array.from(byStart.values()).sort((a, b) => a.start - b.start);
    }

    async getWalletBalance() {
        const result = await this.request('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }, true);
        const account = result.list && result.list[0];
        const coins = account ? account.coin || [] : [];
        const get = coin => {
            const found = coins.find(x => x.coin === coin);
            return found ? {
                walletBalance: Number(found.walletBalance || 0),
                locked: Number(found.locked || 0),
                usdValue: Number(found.usdValue || 0)
            } : { walletBalance: 0, locked: 0, usdValue: 0 };
        };
        return {
            accountType: 'UNIFIED',
            USDT: get('USDT'), XRP: get('XRP'), BTC: get('BTC'), ETH: get('ETH'), SOL: get('SOL')
        };
    }
}

module.exports = { BybitClient, candleEndTime, KLINE_INTERVALS };
