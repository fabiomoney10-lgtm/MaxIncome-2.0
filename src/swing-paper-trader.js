'use strict';

const {
  getTradingDate,
  calculateAvailableDailyRisk,
  calculateRiskPerUnitBRL,
  DEFAULT_STOP_SLIPPAGE_BUFFER_PCT
} = require('./risk-guards');

const SWING_STOP_LOSS_PCT = 3;
const SWING_TARGET_PCT = 6;
const SWING_SCORE_MIN = 70;
const SWING_MAX_OPEN_POSITIONS = 3;
const SWING_RISK_FRACTION = 0.5;

function sizeSwingPosition({
  entryPrice,
  fxRate,
  settings,
  availableDailyRiskBRL,
  openExposureBRL,
  maxRiskPerTradeBRL
}) {
  const entry = Number(entryPrice);
  const fx = Number(fxRate);
  const stopPct = SWING_STOP_LOSS_PCT;
  const fee = Number(settings.fee_rate_per_side);
  const values = [entry, fx, fee, availableDailyRiskBRL, openExposureBRL, maxRiskPerTradeBRL];
  if (values.some(value => !Number.isFinite(value)) || entry <= 0 || fx <= 0 || fee < 0 ||
      availableDailyRiskBRL <= 0 || openExposureBRL < 0 || maxRiskPerTradeBRL <= 0) return null;

  const riskPerUnitBRL = calculateRiskPerUnitBRL({
    entryPrice: entry,
    fxRate: fx,
    stopLossPct: stopPct,
    feeRatePerSide: fee,
    slippageBufferPct: DEFAULT_STOP_SLIPPAGE_BUFFER_PCT
  });
  if (!(riskPerUnitBRL > 0)) return null;

  const capital = Number(settings.initial_capital_brl);
  const maxExposure = Number(settings.max_exposure_brl);
  const remainingExposure = Math.max(0, maxExposure - openExposureBRL);
  const requestedRisk = Math.min(maxRiskPerTradeBRL, availableDailyRiskBRL);
  const riskLimitedQuantity = requestedRisk / riskPerUnitBRL;
  const remainingCapital = Math.max(0, capital - openExposureBRL);
  const maxNotional = Math.min(remainingExposure, remainingCapital);
  const quantity = Math.min(riskLimitedQuantity, maxNotional / (entry * fx));
  const entryValueBRL = quantity * entry * fx;
  const riskBRL = quantity * riskPerUnitBRL;
  if (!(quantity > 0) || !(entryValueBRL >= 10) || riskBRL > requestedRisk + 0.01) return null;

  const feePct = fee * 2 * 100;
  const minimumTargetPct = 2 * (stopPct + DEFAULT_STOP_SLIPPAGE_BUFFER_PCT + feePct) + feePct;
  const targetPct = Math.max(SWING_TARGET_PCT, minimumTargetPct);
  return {
    quantity,
    entryPrice: entry,
    stopPrice: entry * (1 - stopPct / 100),
    takeProfitPrice: entry * (1 + targetPct / 100),
    entryValueBRL,
    riskBRL,
    targetPct,
    riskReward: targetPct / (stopPct + DEFAULT_STOP_SLIPPAGE_BUFFER_PCT + feePct)
  };
}

class SwingPaperTrader {
  constructor({ pool, fxProvider, scoreMin = SWING_SCORE_MIN, maxOpenPositions = SWING_MAX_OPEN_POSITIONS }) {
    this.pool = pool;
    this.fxProvider = fxProvider;
    this.scoreMin = Number(scoreMin);
    this.maxOpenPositions = Number(maxOpenPositions);
    this.lastRunAt = null;
    this.lastError = null;
    this.lastFx = null;
    this.running = false;
  }

  async runOnce(analyses = {}) {
    if (this.running) return this.getStatus();
    this.running = true;
    let client;
    try {
      let fx = null;
      try {
        fx = Number(await this.fxProvider());
        if (!Number.isFinite(fx) || fx < 2 || fx > 20) throw new Error('Cotação USD/BRL inválida.');
        this.lastFx = fx;
      } catch (error) {
        this.lastError = 'Câmbio indisponível; novas posições Swing bloqueadas: ' + error.message;
      }

      client = await this.pool.connect();
      await client.query('BEGIN');
      const settingsResult = await client.query('SELECT * FROM public.paper_settings WHERE id=1 FOR UPDATE');
      if (!settingsResult.rows.length) throw new Error('Configuração PAPER ausente.');
      const settings = settingsResult.rows[0];
      const day = getTradingDate();
      await client.query(
        'INSERT INTO public.paper_daily_state (trading_date,starting_balance_brl) VALUES ($1,$2) ON CONFLICT (trading_date) DO NOTHING',
        [day, settings.initial_capital_brl]
      );
      const dailyResult = await client.query('SELECT * FROM public.paper_daily_state WHERE trading_date=$1 FOR UPDATE', [day]);
      const daily = dailyResult.rows[0];

      const openResult = await client.query(
        "SELECT symbol,entry_value_brl,risk_brl,metadata FROM public.paper_trades WHERE status='OPEN' FOR UPDATE"
      );
      const openExposureBRL = openResult.rows.reduce((sum, row) => sum + Number(row.entry_value_brl || 0), 0);
      const reservedOpenRiskBRL = openResult.rows.reduce((sum, row) => {
        const legacyBuffer = row.metadata && row.metadata.slippageBufferPct !== undefined ? 0 : Number(row.entry_value_brl || 0) * 0.0025;
        return sum + Number(row.risk_brl || 0) + legacyBuffer;
      }, 0);
      const availableDailyRiskBRL = calculateAvailableDailyRisk({
        maxDailyLossBRL: Number(settings.max_daily_loss_brl),
        realizedPnlBRL: Number(daily.realized_pnl_brl),
        unrealizedPnlBRL: Number(daily.unrealized_pnl_brl),
        reservedOpenRiskBRL
      });
      const openSwing = openResult.rows.filter(row => row.metadata && row.metadata.engine === 'SWING');
      const openSymbols = new Set(openResult.rows.map(row => row.symbol));
      const canOpen = settings.trading_enabled === true && Boolean(fx) &&
        !daily.halted && availableDailyRiskBRL > 0 &&
        Number(daily.trades_opened) < Number(settings.max_trades_per_day) &&
        openSwing.length < this.maxOpenPositions;

      let opened = null;
      if (canOpen) {
        const swingRiskCap = Math.min(
          Number(settings.max_risk_per_trade_brl) * SWING_RISK_FRACTION,
          Number(settings.initial_capital_brl) * 0.005
        );
        const candidates = Object.entries(analyses)
          .filter(([, item]) => item && item.signal === 'BUY_CANDIDATE' && Number(item.score) >= this.scoreMin)
          .sort((a, b) => Number(b[1].score) - Number(a[1].score));

        for (const [symbol, analysis] of candidates) {
          if (openSymbols.has(symbol)) continue;
          const sizing = sizeSwingPosition({
            entryPrice: analysis.lastPrice,
            fxRate: fx,
            settings,
            availableDailyRiskBRL,
            openExposureBRL,
            maxRiskPerTradeBRL: swingRiskCap
          });
          if (!sizing) continue;
          const entryFeeBRL = sizing.entryValueBRL * Number(settings.fee_rate_per_side);
          const idempotencyKey = 'swing:' + day + ':' + symbol + ':' + (Number(daily.trades_opened) + 1);
          const inserted = await client.query(
            "INSERT INTO public.paper_trades (symbol,side,quantity,entry_price,stop_price,take_profit_price,entry_value_brl,risk_brl,estimated_entry_fee_brl,estimated_exit_fee_brl,idempotency_key,strategy_signal,metadata) VALUES ($1,'BUY',$2,$3,$4,$5,$6,$7,$8,$8,$9,'SWING_BUY_CANDIDATE',$10) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id",
            [
              symbol, sizing.quantity, sizing.entryPrice, sizing.stopPrice, sizing.takeProfitPrice,
              sizing.entryValueBRL, sizing.riskBRL, entryFeeBRL, idempotencyKey,
              JSON.stringify({
                engine: 'SWING',
                timeframe: ['4h', '1D'],
                score: Number(analysis.score),
                reason: String(analysis.reason || ''),
                fxUsdBrl: fx,
                fxSource: 'Frankfurter USD/BRL; USDT tratado como aproximação de USD',
                slippageBufferPct: DEFAULT_STOP_SLIPPAGE_BUFFER_PCT,
                targetPct: sizing.targetPct,
                riskReward: sizing.riskReward
              })
            ]
          );
          if (!inserted.rowCount) continue;
          await client.query(
            'UPDATE public.paper_daily_state SET trades_opened=trades_opened+1,updated_at=now() WHERE trading_date=$1',
            [day]
          );
          await client.query(
            "INSERT INTO public.paper_events (trade_id,event_type,symbol,message,details) VALUES ($1,'SWING_TRADE_OPENED',$2,'Posição Swing PAPER aberta; nenhuma ordem enviada à corretora.',$3)",
            [inserted.rows[0].id, symbol, JSON.stringify({
              entry: sizing.entryPrice,
              stop: sizing.stopPrice,
              target: sizing.takeProfitPrice,
              quantity: sizing.quantity,
              entryValueBRL: sizing.entryValueBRL,
              riskBRL: sizing.riskBRL,
              score: Number(analysis.score),
              fx
            })]
          );
          opened = { id: inserted.rows[0].id, symbol, ...sizing, score: Number(analysis.score) };
          break;
        }
      }

      await client.query('COMMIT');
      this.lastRunAt = new Date().toISOString();
      if (fx) this.lastError = null;
      return { opened, status: await this.getStatus() };
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      this.lastError = error.message;
      throw error;
    } finally {
      if (client) client.release();
      this.running = false;
    }
  }

  async getStatus() {
    const day = getTradingDate();
    const [settings, daily, open, recent, reserved] = await Promise.all([
      this.pool.query('SELECT initial_capital_brl,max_risk_per_trade_brl,max_daily_loss_brl,max_trades_per_day,max_exposure_brl,fee_rate_per_side,trading_enabled FROM public.paper_settings WHERE id=1'),
      this.pool.query('SELECT * FROM public.paper_daily_state WHERE trading_date=$1', [day]),
      this.pool.query("SELECT id,symbol,quantity,entry_price,stop_price,take_profit_price,entry_value_brl,risk_brl,opened_at,metadata FROM public.paper_trades WHERE status='OPEN' AND metadata->>'engine'='SWING' ORDER BY opened_at DESC"),
      this.pool.query("SELECT id,symbol,quantity,entry_price,exit_price,exit_reason,pnl_net_brl,status,opened_at,closed_at,metadata FROM public.paper_trades WHERE metadata->>'engine'='SWING' ORDER BY opened_at DESC LIMIT 20"),
      this.pool.query("SELECT COALESCE(sum(risk_brl + CASE WHEN COALESCE(metadata->>'slippageBufferPct','') = '' THEN entry_value_brl * 0.0025 ELSE 0 END),0) AS reserved_risk FROM public.paper_trades WHERE status='OPEN'")
    ]);
    const cfg = settings.rows[0] || {};
    const state = daily.rows[0] || {};
    const reservedRisk = Number(reserved.rows[0] && reserved.rows[0].reserved_risk || 0);
    const availableRisk = cfg.max_daily_loss_brl ? calculateAvailableDailyRisk({
      maxDailyLossBRL: Number(cfg.max_daily_loss_brl),
      realizedPnlBRL: Number(state.realized_pnl_brl || 0),
      unrealizedPnlBRL: Number(state.unrealized_pnl_brl || 0),
      reservedOpenRiskBRL: reservedRisk
    }) : 0;
    return {
      mode: 'PAPER',
      engine: 'SWING',
      enabled: cfg.trading_enabled === true,
      paperPositionsEnabled: true,
      orderExecutionEnabled: false,
      tradingDate: day,
      tradingDateTimezone: 'America/Sao_Paulo',
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      fxUsdBrl: this.lastFx,
      scoreMinimum: this.scoreMin,
      stopLossPct: SWING_STOP_LOSS_PCT,
      targetPct: SWING_TARGET_PCT,
      maxOpenPositions: this.maxOpenPositions,
      riskPerTradeCapBRL: Math.min(Number(cfg.max_risk_per_trade_brl || 0) * SWING_RISK_FRACTION, Number(cfg.initial_capital_brl || 0) * 0.005),
      dailyRiskReservedBRL: reservedRisk,
      dailyRiskAvailableBRL: availableRisk,
      settings: cfg,
      daily: state,
      openPositions: open.rows,
      recentTrades: recent.rows
    };
  }
}

module.exports = {
  SwingPaperTrader,
  sizeSwingPosition,
  SWING_STOP_LOSS_PCT,
  SWING_TARGET_PCT,
  SWING_SCORE_MIN,
  SWING_MAX_OPEN_POSITIONS
};
