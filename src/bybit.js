'use strict';

const crypto = require('crypto');

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
            const signature = crypto.createHmac('sha256', this.apiSecret)
                .update(timestamp + this.apiKey + this.recvWindow + payload).digest('hex');
            Object.assign(headers, {
                'X-BAPI-API-KEY': this.apiKey, 'X-BAPI-SIGN': signature,
                'X-BAPI-TIMESTAMP': timestamp, 'X-BAPI-RECV-WINDOW': this.recvWindow
            });
        }
        const response = await fetch(url, {
            method, headers, ...(method === 'POST' ? { body } : {}),
            signal: AbortSignal.timeout(12000)
        });
        const rawText = await response.text();
        let data;
        try { data = JSON.parse(rawText); }
        catch (error) {
            const preview = rawText.slice(0, 200).replace(/\\s+/g, ' ');
            throw new Error(`Resposta não JSON da Bybit. HTTP ${response.status}. Ambiente: ${this.environment}. Resposta: ${preview || '(corpo vazio)'}`);
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.retMsg || 'Falha na API'}`);
        if (data.retCode !== 0) throw new Error(`Bybit ${data.retCode}: ${data.retMsg || 'Erro desconhecido'}`);
        return data.result;
    }

    async getTicker(symbol) {
        const result = await this.request('GET', '/v5/market/tickers', { category: 'spot', symbol });
        const item = result.list && result.list[0];
        if (!item) throw new Error(`Sem cotação para ${symbol}`);
        return { symbol, lastPrice: Number(item.lastPrice), change24h: Number(item.price24hPcnt) * 100 };
    }

    async getKlines(symbol, interval = '15', limit = '100') {
        const result = await this.request('GET', '/v5/market/kline', { category: 'spot', symbol, interval, limit });
        const intervalMs = interval === 'D' ? 86400000 : interval === 'W' ? 604800000 :
            interval === 'M' ? 2592000000 : Number(interval) * 60000;
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error(`Intervalo de candles inválido: ${interval}`);
        const now = Date.now();
        return (result.list || [])
            .map(row => ({
                start: Number(row[0]), open: Number(row[1]), high: Number(row[2]),
                low: Number(row[3]), close: Number(row[4]), volume: Number(row[5])
            }))
            .filter(candle => Number.isFinite(candle.start) && candle.start + intervalMs <= now)
            .reverse();
    }

    async getWalletBalance() {
        const result = await this.request('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }, true);
        const account = result.list && result.list[0];
        const coins = account ? account.coin || [] : [];
        const get = coin => {
            const found = coins.find(item => item.coin === coin);
            return found ? {
                walletBalance: Number(found.walletBalance || 0),
                locked: Number(found.locked || 0),
                usdValue: Number(found.usdValue || 0)
            } : { walletBalance: 0, locked: 0, usdValue: 0 };
        };
        return { accountType: 'UNIFIED', USDT: get('USDT'), XRP: get('XRP'), BTC: get('BTC'), ETH: get('ETH'), SOL: get('SOL') };
    }
}

module.exports = { BybitClient };
