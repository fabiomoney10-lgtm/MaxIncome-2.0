const { analyzeCandles } = require('./strategy');
const { RiskManager } = require('./risk-manager');

class TradingEngine {
  constructor({ client, assets, legacyXrpReserved }) {
    this.client = client;
    this.assets = assets;
    this.risk = new RiskManager({ legacyXrpReserved });
    this.state = {
      mode: 'PAPER',
      environment: client.environment === 'mainnet' ? 'BYBIT MAINNET' : 'BYBIT TESTNET',
      updatedAt: null,
      connected: false,
      balance: null,
      assets: {},
      log: ['Sistema iniciado em modo PAPER. Nenhuma ordem será enviada.'],
      error: null
    };
    this.running = false;
  }

  addLog(message) {
    this.state.log.unshift(`[${new Date().toLocaleString('pt-BR')}] ${message}`);
    this.state.log = this.state.log.slice(0, 30);
  }

  async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      const balance = await this.client.getWalletBalance();
      this.state.balance = balance;
      this.state.connected = true;
      this.state.error = null;

      const rows = await Promise.all(this.assets.map(async symbol => {
        try {
          const [ticker, candles] = await Promise.all([
            this.client.getTicker(symbol),
            this.client.getKlines(symbol)
          ]);
          const analysis = analyzeCandles(candles);
          const risk = this.risk.evaluate({
            signal: analysis.signal,
            usdtBalance: balance.USDT.walletBalance
          });
          return [symbol, { ...ticker, ...analysis, risk }];
        } catch (err) {
          return [symbol, { error: err.message }];
        }
      }));

      this.state.assets = Object.fromEntries(rows);
      this.state.updatedAt = new Date().toISOString();
      this.addLog(`Dados de carteira e mercado atualizados. Ambiente: ${this.client.environment}. Modo PAPER: ordens bloqueadas.`);
    } catch (err) {
      this.state.connected = false;
      this.state.error = err.message;
      this.addLog(`Falha de sincronização: ${err.message}`);
      throw err;
    } finally {
      this.running = false;
    }
  }

  getStatus() {
    const b = this.state.balance;
    return {
      ...this.state,
      legacyXrpReserved: this.risk.legacyXrpReserved,
      botXrpAvailable: b ? this.risk.availableBotXrp(b.XRP.walletBalance) : null
    };
  }
}

module.exports = { TradingEngine };
