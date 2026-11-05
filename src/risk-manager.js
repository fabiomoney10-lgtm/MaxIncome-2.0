'use strict';

class RiskManager {
  constructor({ legacyXrpReserved = 6, maxRiskBRL = 50, maxDailyLossBRL = 100, maxTradesPerDay = 5, maxExposureBRL = 5000, stopLossPct = 1, takeProfitPct = 2 } = {}) {
    this.legacyXrpReserved = Math.max(0, Number(legacyXrpReserved) || 0);
    this.maxRiskBRL = Number(maxRiskBRL);
    this.maxDailyLossBRL = Number(maxDailyLossBRL);
    this.maxTradesPerDay = Number(maxTradesPerDay);
    this.maxExposureBRL = Number(maxExposureBRL);
    this.stopLossPct = Number(stopLossPct);
    this.takeProfitPct = Number(takeProfitPct);
  }
  evaluate({ signal, usdtBalance }) {
    if (!Number.isFinite(Number(usdtBalance)) || Number(usdtBalance) <= 0) return { allowed:false, reason:'Saldo USDT indisponível; risco não avaliado.' };
    if (signal !== 'BULLISH') return { allowed:false, reason:'A estratégia não confirmou sinal de compra.' };
    return { allowed:false, reason:'Execução na corretora permanentemente bloqueada nesta versão; apenas PAPER.' };
  }
  availableBotXrp(walletXrp) { return Math.max(0, Number(walletXrp || 0) - this.legacyXrpReserved); }
  getLimits() {
    return { mode:'PAPER', executionEnabled:false, currency:'BRL', maxRiskBRL:this.maxRiskBRL, maxDailyLossBRL:this.maxDailyLossBRL, maxTradesPerDay:this.maxTradesPerDay, maxExposureBRL:this.maxExposureBRL, stopLossPct:this.stopLossPct, takeProfitPct:this.takeProfitPct };
  }
}
module.exports = { RiskManager };
