'use strict';

// Pure pre-trade guard. It does not send orders and must be supplied with
// persisted account/day state by the execution service.
class LiveSpotRiskGuard {
  constructor({
    capitalReferenceBrl = 5000,
    riskPerTradeBrl = 50,
    maxDailyLossBrl = 100,
    maxTradesPerDay = 5,
    maxCapitalExposureBrl = 5000
  } = {}) {
    this.limits = {
      capitalReferenceBrl: Number(capitalReferenceBrl),
      riskPerTradeBrl: Number(riskPerTradeBrl),
      maxDailyLossBrl: Number(maxDailyLossBrl),
      maxTradesPerDay: Number(maxTradesPerDay),
      maxCapitalExposureBrl: Number(maxCapitalExposureBrl)
    };
    for ( (const [key, value] of Object.entries(this.limits)) ) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Limite inválido: ${key}`);
      }
    }
    if (this.limits.riskPerTradeBrl > this.limits.maxDailyLossBrl) {
      throw new Error('O risco por operação não pode exceder a perda diária máxima.');
    }
    if (this.limits.maxCapitalExposureBrl > this.limits.capitalReferenceBrl) {
      throw new Error('A exposição máxima não pode exceder o capital de referência.');
    }
  }

  evaluateBuy({
    enabled,
    acknowledgement,
    category,
    isLeverage,
    symbol,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    fxBrlPerUsdt,
    availableUsdt,
    currentExposureBrl,
    realizedDailyLossBrl,
    tradesToday,
    feeRate,
    slippageRate,
    minOrderValueUsdt = 0
  }) {
    const deny = reason => ({ allowed: false, reason });
    if (enabled !== true || acknowledgement !== 'MAXINCOME_SPOT_REAL') {
      return deny('Execução REAL não foi explicitamente habilitada.');
    }
    if (category !== 'spot' || isLeverage !== 0) {
      return deny('Somente Spot sem alavancagem é permitido.');
    }
    if (typeof symbol !== 'string' || !/^[A-Z0-9]{2,20}USDT$/.test(symbol)) {
      return deny('Par Spot/USDT inválido ou fora do padrão permitido.');
    }
    const numbers = {
      entryPrice, stopLossPrice, takeProfitPrice, fxBrlPerUsdt,
      availableUsdt, currentExposureBrl, realizedDailyLossBrl,
      tradesToday, feeRate, slippageRate, minOrderValueUsdt
    };
    for (const [key, value] of Object.entries(numbers)) {
      if (!Number.isFinite(Number(value)) || Number(value) < 0) {
        return deny(`Dado inválido: ${key}`);
      }
    }
    if (entryPrice <= 0 || stopLossPrice <= 0 || takeProfitPrice <= 0 ||
        stopLossPrice >= entryPrice || takeProfitPrice <= entryPrice) {
      return deny('Compra exige preço de entrada válido, stop abaixo e alvo acima da entrada.');
    }
    if (fxBrlPerUsdt <= 0 || availableUsdt <= 0) {
      return deny('Cotação BRL/USDT ou saldo disponível inválido.');
    }
    if (feeRate >= 1 || slippageRate >= 1) {
      return deny('Taxas ou slippage fora do intervalo permitido.');
    }
    if (realizedDailyLossBrl >= this.limits.maxDailyLossBrl) {
      return deny('Limite de perda diária atingido; novas operações bloqueadas.');
    }
    if (tradesToday >= this.limits.maxTradesPerDay) {
      return deny('Limite diário de operações atingido.');
    }
    if (currentExposureBrl >= this.limits.maxCapitalExposureBrl) {
      return deny('Limite de exposição total atingido.');
    }

    const remainingDailyRiskBrl = this.limits.maxDailyLossBrl - realizedDailyLossBrl;
    const riskBudgetBrl = Math.min(this.limits.riskPerTradeBrl, remainingDailyRiskBrl);
    const riskBudgetUsdt = riskBudgetBrl / fxBrlPerUsdt;
    const priceRiskRate = (entryPrice - stopLossPrice) / entryPrice;
    const estimatedRoundTripCostRate = (2 * feeRate) + slippageRate;
    const totalRiskRate = priceRiskRate + estimatedRoundTripCostRate;
    if (!Number.isFinite(totalRiskRate) || totalRiskRate <= 0) {
      return deny('Não foi possível calcular o risco total da operação.');
    }

    const maxNotionalByRiskUsdt = riskBudgetUsdt / totalRiskRate;
    const remainingExposureBrl = this.limits.maxCapitalExposureBrl - currentExposureBrl;
    const maxNotionalByExposureUsdt = remainingExposureBrl / fxBrlPerUsdt;
    const maxNotionalByBalanceUsdt = availableUsdt;
    const notionalUsdt = Math.min(
      maxNotionalByRiskUsdt,
      maxNotionalByExposureUsdt,
      maxNotionalByBalanceUsdt
    );
    if (!Number.isFinite(notionalUsdt) || notionalUsdt <= 0 || notionalUsdt < minOrderValueUsdt) {
      return deny('Tamanho calculado abaixo do mínimo da corretora ou sem saldo/exposição disponível.');
    }

    const quantity = notionalUsdt / entryPrice;
    return {
      allowed: true,
      category: 'spot',
      isLeverage: 0,
      symbol,
      side: 'Buy',
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      notionalUsdt,
      quantity,
      estimatedRiskBrl: notionalUsdt * totalRiskRate * fxBrlPerUsdt,
      riskBudgetBrl,
      estimatedRoundTripCostRate,
      reason: 'Pré-validação aprovada. Ainda exige validação de filtros da Bybit, persistência e reconciliação de ordens.'
    };
  }
}

module.exports = { LiveSpotRiskGuard };
