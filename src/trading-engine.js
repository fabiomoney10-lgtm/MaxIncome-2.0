'use strict';
const { analyzeCandles } = require('./strategy');
const { RiskManager } = require('./risk-manager');

class TradingEngine {
  constructor({ client, assets, legacyXrpReserved, maxRiskBRL, maxDailyLossBRL, maxTradesPerDay, maxExposureBRL, stopLossPct, takeProfitPct }) {
    this.client = client; this.assets = assets;
    this.risk = new RiskManager({ legacyXrpReserved, maxRiskBRL, maxDailyLossBRL, maxTradesPerDay, maxExposureBRL, stopLossPct, takeProfitPct });
    this.state = {
      mode: 'PAPER', environment: client.tradingEnvironment || client.environment,
      marketDataEnvironment: client.marketDataEnvironment || 'BYBIT MAINNET',
      orderExecutionEnabled: false, updatedAt: null, connected: false,
      balance: null, assets: {}, log: ['Sistema iniciado em PAPER. Nenhuma ordem será enviada à corretora.'], error: null
    };
    this.running = false;
  }
  addLog(message) {
    this.state.log.unshift('[' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false }) + '] ' + message);
    this.state.log = this.state.log.slice(0, 30);
  }
  async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await Promise.all(this.assets.map(async symbol => {
        try {
          const [ticker, candles15m, candles1h] = await Promise.all([
            this.client.getTicker(symbol),
            this.client.getKlines(symbol, '15', '100'),
            this.client.getKlines(symbol, '60', '100')
          ]);
          const analysis = analyzeCandles(candles15m, candles1h);
          return [symbol, { ...ticker, ...analysis, risk: this.risk.evaluate({ signal: analysis.signal, usdtBalance: null }) }];
        } catch (error) {
          return [symbol, { error: error.message, signal: 'INSUFFICIENT_DATA' }];
        }
      }));
      this.state.assets = Object.fromEntries(rows);
      this.state.connected = rows.some(([, value]) => Number.isFinite(Number(value.lastPrice)));
      this.state.updatedAt = new Date().toISOString();
      this.state.error = this.state.connected ? null : 'Nenhum ativo retornou dados válidos.';
      this.addLog('Filtros 15m + confirmação 1h, RSI de Wilder, ATR e candles fechados. Dados públicos: ' +
        (this.client.marketDataEnvironment || 'BYBIT MAINNET') + '. PAPER; ordens reais bloqueadas.');
      if (!this.state.connected) throw new Error(this.state.error);
    } catch (error) {
      this.state.connected = false;
      this.state.error = error.message;
      this.addLog('Falha de sincronização: ' + error.message);
      throw error;
    } finally {
      this.running = false;
    }
  }
  getStatus() {
    return { ...this.state, legacyXrpReserved: this.risk.legacyXrpReserved, riskLimits: this.risk.getLimits(), botXrpAvailable: null };
  }
}
module.exports = { TradingEngine };
