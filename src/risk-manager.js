'use strict';

function positiveNumber(value, fallback, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    if (value === undefined || value === null || value === '') return fallback;
    throw new Error(`Configuração inválida para ${name}: informe um número maior que zero.`);
  }
  return parsed;
}

class RiskManager {
  constructor({
    legacyXrpReserved = 6,
    maxRiskBRL = 50,
    maxDailyLossBRL = 100,
    maxTradesPerDay = 5,
    maxExposureBRL = 5000,
    stopLossPct = 1,
    takeProfitPct = 2
  } = {}) {
    this.legacyXrpReserved = Math.max(0, Number(legacyXrpReserved) || 0);
    this.limits = {
      maxRiskBRL: positiveNumber(maxRiskBRL, 50, 'MAX_RISK_BRL'),
      maxDailyLossBRL: positiveNumber(maxDailyLossBRL, 100, 'MAX_DAILY_LOSS_BRL'),
      maxTradesPerDay: Math.floor(positiveNumber(maxTradesPerDay, 5, 'MAX_TRADES_PER_DAY')),
      maxExposureBRL: positiveNumber(maxExposureBRL, 5000, 'MAX_EXPOSURE_BRL'),
      stopLossPct: positiveNumber(stopLossPct, 1, 'PAPER_STOP_LOSS_PCT'),
      takeProfitPct: positiveNumber(takeProfitPct, 2, 'PAPER_TAKE_PROFIT_PCT')
    };
    if (this.limits.takeProfitPct < this.limits.stopLossPct * 2) {
      throw new Error('PAPER_TAKE_PROFIT_PCT deve ser pelo menos duas vezes PAPER_STOP_LOSS_PCT.');
    }
  }

  getLimits() {
    return {
      ...this.limits,
      mode: 'PAPER',
      executionEnabled: false,
      currency: 'BRL'
    };
  }

  evaluate({
    signal,
    usdtBalance,
    usdtBrlRate,
    dailyLossBRL = 0,
    tradesToday = 0,
    exposureBRL = 0,
    entryPrice
  }) {
    const state = { dailyLossBRL, tradesToday, exposureBRL };
    if (!Number.isFinite(Number(usdtBalance)) || Number(usdtBalance) <= 0) {
      return { allowed: false, reason: 'Saldo USDT indisponível ou zerado.' };
    }
    if (!Number.isFinite(Number(usdtBrlRate)) || Number(usdtBrlRate) <= 0) {
      return { allowed: false, reason: 'Cotação USDT/BRL indisponível. Operação bloqueada por segurança.' };
    }
    if (!Number.isFinite(Number(dailyLossBRL)) || dailyLossBRL < 0 ||
        !Number.isInteger(tradesToday) || tradesToday < 0 ||
        !Number.isFinite(Number(exposureBRL)) || exposureBRL < 0) {
      return { allowed: false, reason: 'Estado diário de risco inválido. Operação bloqueada.' };
    }
    if (dailyLossBRL >= this.limits.maxDailyLossBRL) {
      return { allowed: false, reason: 'Limite de perda diária atingido.' };
    }
    if (tradesToday >= this.limits.maxTradesPerDay) {
      return { allowed: false, reason: 'Limite de operações do dia atingido.' };
    }
    if (exposureBRL >= this.limits.maxExposureBRL) {
      return { allowed: false, reason: 'Limite de exposição total atingido.' };
    }
    if (signal !== 'BULLISH') {
      return { allowed: false, reason: 'Spot permite apenas entrada comprada nesta estratégia; sinal não é BULLISH.' };
    }

    const remainingDailyLoss = this.limits.maxDailyLossBRL - dailyLossBRL;
    const remainingExposure = this.limits.maxExposureBRL - exposureBRL;
    const riskBudgetBRL = Math.min(this.limits.maxRiskBRL, remainingDailyLoss);
    const stopFraction = this.limits.stopLossPct / 100;
    const notionalBRL = Math.min(
      riskBudgetBRL / stopFraction,
      remainingExposure,
      Number(usdtBalance) * Number(usdtBrlRate)
    );
    if (!Number.isFinite(notionalBRL) || notionalBRL <= 0) {
      return { allowed: false, reason: 'Tamanho de posição calculado inválido.' };
    }

    const entry = Number(entryPrice);
    const plan = {
      notionalBRL,
      notionalUSDT: notionalBRL / Number(usdtBrlRate),
      estimatedRiskBRL: notionalBRL * stopFraction,
      estimatedTargetBRL: notionalBRL * (this.limits.takeProfitPct / 100),
      stopLossPct: this.limits.stopLossPct,
      takeProfitPct: this.limits.takeProfitPct,
      stopPrice: Number.isFinite(entry) && entry > 0 ? entry * (1 - stopFraction) : null,
      targetPrice: Number.isFinite(entry) && entry > 0 ? entry * (1 + this.limits.takeProfitPct / 100) : null
    };

    // This is a risk calculation only. No order is placed or simulated until
    // durable daily state and the paper execution lifecycle are implemented.
    return {
      allowed: false,
      paperPlan: plan,
      reason: 'Plano de risco calculado. Execução PAPER permanece bloqueada até existir histórico diário persistente e ciclo de simulação validado.'
    };
  }

  availableBotXrp(walletXrp) {
    return Math.max(0, Number(walletXrp || 0) - this.legacyXrpReserved);
  }
}

module.exports = { RiskManager };
