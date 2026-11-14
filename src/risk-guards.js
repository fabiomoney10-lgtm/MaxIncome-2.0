'use strict';

const DEFAULT_STOP_SLIPPAGE_BUFFER_PCT = 0.25;

function getTradingDate(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('Data inválida para calcular o dia de negociação.');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function calculateAvailableDailyRisk({ maxDailyLossBRL, realizedPnlBRL = 0, unrealizedPnlBRL = 0, reservedOpenRiskBRL = 0 }) {
  const values = [maxDailyLossBRL, realizedPnlBRL, unrealizedPnlBRL, reservedOpenRiskBRL].map(Number);
  if (values.some(value => !Number.isFinite(value)) || values[0] <= 0 || values[3] < 0) {
    throw new TypeError('Parâmetros inválidos para calcular o risco diário disponível.');
  }
  const [limit, realized, unrealized, reserved] = values;
  const currentDrawdown = Math.max(0, -(realized + unrealized));
  return Math.max(0, limit - currentDrawdown - reserved);
}

function calculateRiskPerUnitBRL({ entryPrice, fxRate, stopLossPct, feeRatePerSide, slippageBufferPct = DEFAULT_STOP_SLIPPAGE_BUFFER_PCT }) {
  const values = [entryPrice, fxRate, stopLossPct, feeRatePerSide, slippageBufferPct].map(Number);
  if (values.some(value => !Number.isFinite(value)) || values[0] <= 0 || values[1] <= 0 || values[2] <= 0 || values[3] < 0 || values[4] < 0) {
    throw new TypeError('Parâmetros inválidos para estimar o risco unitário.');
  }
  const [entry, fx, stopPct, fee, slippage] = values;
  return entry * fx * ((stopPct + slippage) / 100 + fee * 2);
}

function calculateStopExecutionPrice({ marketPrice, stopPrice, slippageBufferPct = DEFAULT_STOP_SLIPPAGE_BUFFER_PCT }) {
  const values = [marketPrice, stopPrice, slippageBufferPct].map(Number);
  if (values.some(value => !Number.isFinite(value)) || values[0] <= 0 || values[1] <= 0 || values[2] < 0) {
    throw new TypeError('Parâmetros inválidos para estimar o preço de execução do stop.');
  }
  const [market, stop, slippage] = values;
  // Conservative PAPER fill: use the worse of the observed market and the
  // stop price adjusted by the modeled adverse-slippage allowance.
  return Math.min(market, stop * (1 - slippage / 100));
}

module.exports = { getTradingDate, calculateAvailableDailyRisk, calculateRiskPerUnitBRL, calculateStopExecutionPrice, DEFAULT_STOP_SLIPPAGE_BUFFER_PCT };
