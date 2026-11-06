'use strict';

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

module.exports = { getTradingDate, calculateAvailableDailyRisk };
