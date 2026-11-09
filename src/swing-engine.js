'use strict';

function average(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / period;
}

function analyzeSwingCandles({ fourHour, daily, relativeStrength = 0, currentPrice }) {
  const h4 = (fourHour || []).map(c => Number(c.close)).filter(v => Number.isFinite(v) && v > 0);
  const d1 = (daily || []).map(c => Number(c.close)).filter(v => Number.isFinite(v) && v > 0);
  const candleClose = h4[h4.length - 1];
  const marketPrice = Number(currentPrice);
  const price = Number.isFinite(marketPrice) && marketPrice > 0 ? marketPrice : candleClose;
  const sma20h4 = average(h4, 20);
  const sma50h4 = average(h4, 50);
  const sma20d = average(d1, 20);
  const sma50d = average(d1, 50);
  if (![candleClose, price, sma20h4, sma50h4, sma20d, sma50d].every(Number.isFinite)) {
    return { signal: 'INSUFFICIENT_DATA', score: 0, reason: 'Histórico insuficiente para médias de 20 e 50 períodos.' };
  }

  const previousDaily = d1[d1.length - 21];
  const momentum20dPct = Number.isFinite(previousDaily) && previousDaily > 0
    ? ((d1[d1.length - 1] / previousDaily) - 1) * 100 : 0;
  const priorBreakoutWindow = h4.slice(-21, -1);
  const priorHighClose = priorBreakoutWindow.length ? Math.max(...priorBreakoutWindow) : null;
  // All signal conditions use completed candle closes, never the live ticker.
  const completedPrice = candleClose;
  const breakout = Number.isFinite(priorHighClose) && completedPrice > priorHighClose;
  const dailyTrend = d1[d1.length - 1] > sma20d && sma20d > sma50d;
  const fourHourTrend = completedPrice > sma20h4 && sma20h4 > sma50h4;
  const pullback = Math.abs(completedPrice - sma20h4) / sma20h4 <= 0.015 && completedPrice >= h4[h4.length - 2];
  const positiveMomentum = momentum20dPct > 0;

  let score = 0;
  if (dailyTrend) score += 30;
  if (fourHourTrend) score += 25;
  if (breakout) score += 20;
  if (pullback) score += 15;
  if (positiveMomentum) score += 5;
  if (relativeStrength > 0) score += 5;
  score = Math.min(100, score);

  const reasons = [];
  if (dailyTrend) reasons.push('tendência diária positiva');
  if (fourHourTrend) reasons.push('tendência de 4 horas positiva');
  if (breakout) reasons.push('rompimento da máxima dos 20 candles anteriores de 4h');
  if (pullback) reasons.push('preço próximo da média de 20 períodos de 4h');
  if (positiveMomentum) reasons.push('momentum diário positivo');
  if (relativeStrength > 0) reasons.push('força relativa acima da mediana dos ativos monitorados');
  if (!reasons.length) reasons.push('confluência insuficiente');

  const signal = score >= 65 && dailyTrend && (fourHourTrend || breakout) ? 'BUY_CANDIDATE' : 'WAIT';
  const stopPrice = signal === 'BUY_CANDIDATE' ? price * 0.97 : null;
  const targetPrice = signal === 'BUY_CANDIDATE' ? price * 1.06 : null;
  return {
    signal, score, lastPrice: price, candleClose, sma20_4h: sma20h4, sma50_4h: sma50h4,
    sma20_daily: sma20d, sma50_daily: sma50d, momentum20dPct,
    relativeStrengthPct: relativeStrength, breakout, dailyTrend, fourHourTrend, pullback,
    indicativeStopPrice: stopPrice, indicativeTargetPrice: targetPrice,
    indicativeRiskReward: signal === 'BUY_CANDIDATE' ? 2 : null,
    reason: reasons.join('; '),
    executionEnabled: false
  };
}

class SwingEngine {
  constructor({ client, assets, intervalMs = 300000 }) {
    this.client = client;
    this.assets = assets;
    this.intervalMs = Math.max(60000, Number(intervalMs) || 300000);
    this.running = false;
    this.lastRunAt = null;
    this.lastSuccessAt = null;
    this.lastError = null;
    this.state = {};
  }

  async runOnce() {
    if (this.running) return this.getStatus();
    this.running = true;
    try {
      const rows = await Promise.all(this.assets.map(async symbol => {
        try {
          const [ticker, fourHour, daily] = await Promise.all([
            this.client.getTicker(symbol),
            this.client.getKlines(symbol, '240', '60'),
            this.client.getKlines(symbol, 'D', '60')
          ]);
          const closes = (daily || []).map(c => Number(c.close)).filter(v => Number.isFinite(v) && v > 0);
          const momentum = closes.length >= 21 && closes[closes.length - 21] > 0
            ? ((closes[closes.length - 1] / closes[closes.length - 21]) - 1) * 100 : 0;
          const currentPrice = Number(ticker && ticker.lastPrice);
          if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
            throw new Error('Ticker atual inválido; análise Swing bloqueada para evitar preço de entrada incorreto.');
          }
          return { symbol, ticker, fourHour, daily, momentum, currentPrice };
        } catch (error) {
          return { symbol, error: error.message };
        }
      }));
      const valid = rows.filter(row => !row.error);
      const sorted = valid.map(row => row.momentum).sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      const next = {};
      for (const row of rows) {
        if (row.error) {
          next[row.symbol] = { signal: 'DATA_ERROR', score: 0, reason: row.error, executionEnabled: false };
          continue;
        }
        next[row.symbol] = {
          ...analyzeSwingCandles({
            fourHour: row.fourHour,
            daily: row.daily,
            relativeStrength: row.momentum - median,
            currentPrice: row.currentPrice
          }),
          marketTimestamp: row.ticker.marketTimestamp || null
        };
      }
      this.state = next;
      this.lastRunAt = new Date().toISOString();
      this.lastSuccessAt = valid.length ? this.lastRunAt : this.lastSuccessAt;
      this.lastError = valid.length ? null : 'Nenhum ativo retornou candles válidos e ticker atual.';
      if (!valid.length) throw new Error(this.lastError);
      return this.getStatus();
    } catch (error) {
      this.lastError = error.message;
      throw error;
    } finally {
      this.running = false;
    }
  }

  getStatus() {
    return {
      mode: 'PAPER_ANALYSIS_ONLY',
      timeframe: ['4h', '1D'],
      strategy: ['trend_following', 'breakout', 'pullback', 'relative_strength'],
      executionEnabled: false,
      orderExecutionEnabled: false,
      paperPositionsEnabled: false,
      intervalMs: this.intervalMs,
      lastRunAt: this.lastRunAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      assets: this.state
    };
  }
}

module.exports = { SwingEngine, analyzeSwingCandles, average };
