class RiskManager {
  constructor({ legacyXrpReserved = 6 } = {}) {
    this.legacyXrpReserved = Math.max(0, Number(legacyXrpReserved) || 0);
  }

  evaluate({ signal, usdtBalance }) {
    // Nesta primeira etapa, o motor só pode gerar sinais informativos.
    // Nenhuma ordem é enviada à corretora.
    if (!Number.isFinite(usdtBalance) || usdtBalance <= 0) {
      return { allowed: false, reason: 'Saldo USDT indisponível ou zerado.' };
    }
    if (!['BULLISH', 'BEARISH'].includes(signal)) {
      return { allowed: false, reason: 'Sem sinal direcional confirmado.' };
    }
    return { allowed: false, reason: 'Modo PAPER: execução real/simulada de ordens ainda não habilitada nesta etapa.' };
  }

  availableBotXrp(walletXrp) {
    return Math.max(0, Number(walletXrp || 0) - this.legacyXrpReserved);
  }
}

module.exports = { RiskManager };