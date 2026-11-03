'use strict';

const crypto = require('crypto');

class BybitClient {
    constructor({ apiKey, apiSecret }) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        // Host fixo: esta aplicação nunca se conecta à API de produção.
        this.baseUrl = 'https://api-testnet.bybit.com';
        this.recvWindow = '5000';
        this.readOnlyEndpoints = new Set([
            '/v5/market/tickers',
            '/v5/market/kline',
            '/v5/account/wallet-balance'
        ]);
    }

    async request(method, endpoint, params = {}, signed = false) {
        // Bloqueio explícito de qualquer método de escrita e de endpoints não aprovados.
        if (method !== 'GET' || !this.readOnlyEndpoints.has(endpoint)) {
            throw new Error('Operação bloqueada: somente endpoints GET de leitura estão habilitados.');
        }
        if (signed && endpoint !== '/v5/account/wallet-balance') {
            throw new Error('Assinatura não permitida para este endpoint.');
        }

        const sortedParams = Object.fromEntries(
            Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
        );
        const query = new URLSearchParams(sortedParams).toString();
        const url = this.baseUrl + endpoint + (query ? `?${query}` : '');

        const headers = {
            'Accept': 'application/json'
        };

        if (signed) {
            if (!this.apiKey || !this.apiSecret) {
                throw new Error('Credenciais da Bybit não configuradas.');
            }

            const timestamp = Date.now().toString();
            const preSign = timestamp + this.apiKey + this.recvWindow + query;
            const signature = crypto
                .createHmac('sha256', this.apiSecret)
                .update(preSign)
                .digest('hex');

            Object.assign(headers, {
                'X-BAPI-API-KEY': this.apiKey,
                'X-BAPI-SIGN': signature,
                'X-BAPI-TIMESTAMP': timestamp,
                'X-BAPI-RECV-WINDOW': this.recvWindow
            });
        }

        const response = await fetch(url, {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(12000)
        });

        const rawText = await response.text();
        let data;
        try {
            data = JSON.parse(rawText);
        } catch (_) {
            throw new Error(`Resposta inválida da Bybit (HTTP ${response.status}).`);
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${data.retMsg || 'Falha na API'}`);
        }
        if (data.retCode !== 0) {
            throw new Error(`Bybit ${data.retCode}: ${data.retMsg || 'Erro desconhecido'}`);
        }
        return data.result;
    }

    async getTicker(symbol) {
        const result = await this.request('GET', '/v5/market/tickers', { category: 'spot', symbol });
        const item = result.list && result.list[0];
        if (!item) throw new Error(`Sem cotação para ${symbol}`);
        return {
            symbol,
            lastPrice: Number(item.lastPrice),
            change24h: Number(item.price24hPcnt) * 100
        };
    }

    async getKlines(symbol, interval = '15', limit = '60') {
        const result = await this.request('GET', '/v5/market/kline', {
            category: 'spot', symbol, interval, limit
        });
        return (result.list || []).map(row => ({
            start: Number(row[0]),
            close: Number(row[4])
        })).reverse();
    }

    async getWalletBalance() {
        const result = await this.request(
            'GET',
            '/v5/account/wallet-balance',
            { accountType: 'UNIFIED' },
            true
        );
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
            USDT: get('USDT'),
            XRP: get('XRP'),
            BTC: get('BTC'),
            ETH: get('ETH'),
            SOL: get('SOL')
        };
    }
}

module.exports = { BybitClient };
