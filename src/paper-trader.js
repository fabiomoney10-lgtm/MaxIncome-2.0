'use strict';

const { Pool } = require('pg');

function createPool(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL não configurada; motor PAPER permanece bloqueado.');
  return new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: true },
    application_name: 'maxincome-paper'
  });
}

class PaperTrader {
  constructor({ pool, assets, stopLossPct = 1, feeRatePerSide = 0.001 }) {
    this.pool = pool;
    this.assets = assets;
    this.stopLossPct = Number(stopLossPct);
    this.feeRatePerSide = Number(feeRatePerSide);
    this.lastFx = null;
    this.lastFxAt = 0;
    this.lastRunAt = null;
    this.lastError = null;
    this.running = false;
  }

  async getFxRate() {
    if (this.lastFx && Date.now() - this.lastFxAt < 600000) return this.lastFx;
    const response = await fetch('https://api.frankfurter.app/latest?from=USD&to=BRL', { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error('Cotação USD/BRL indisponível; novas operações bloqueadas.');
    const data = await response.json();
    const rate = Number(data && data.rates && data.rates.BRL);
    if (!Number.isFinite(rate) || rate < 2 || rate > 20) throw new Error('Cotação USD/BRL inválida; novas operações bloqueadas.');
    this.lastFx = rate;
    this.lastFxAt = Date.now();
    return rate;
  }

  async runOnce(market) {
    if (this.running) return this.getStatus();
    this.running = true;
    try {
      const fx = await this.getFxRate().catch(err => { this.lastError = err.message; return null; });
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const settingsResult = await client.query('SELECT * FROM public.paper_settings WHERE id = 1 FOR UPDATE');
        if (!settingsResult.rows.length) throw new Error('Configuração PAPER ausente.');
        const settings = settingsResult.rows[0];
        const dateResult = await client.query("SELECT (now() AT TIME ZONE 'UTC')::date AS day");
        const day = dateResult.rows[0].day;
        await client.query(
          'INSERT INTO public.paper_daily_state (trading_date, starting_balance_brl) VALUES ($1, $2) ON CONFLICT (trading_date) DO NOTHING',
          [day, settings.initial_capital_brl]
        );
        const dailyResult = await client.query('SELECT * FROM public.paper_daily_state WHERE trading_date = $1 FOR UPDATE', [day]);
        const daily = dailyResult.rows[0];

        // Existing positions are always monitored, even when the FX feed is unavailable.
        const openResult = await client.query("SELECT * FROM public.paper_trades WHERE status = 'OPEN' ORDER BY opened_at FOR UPDATE");
        let realizedDelta = 0;
        for (const trade of openResult.rows) {
          const ticker = market[trade.symbol];
          const price = Number(ticker && ticker.lastPrice);
          if (!Number.isFinite(price) || price <= 0) continue;
          let reason = null;
          if (price <= Number(trade.stop_price)) reason = 'STOP_LOSS';
          else if (price >= Number(trade.take_profit_price)) reason = 'TAKE_PROFIT';
          if (!reason) continue;
          const tradeFx = Number((trade.metadata && trade.metadata.fxUsdBrl) || fx || 0);
          if (!(tradeFx > 0)) continue;
          const gross = (price - Number(trade.entry_price)) * Number(trade.quantity) * tradeFx;
          const entryFee = Number(trade.estimated_entry_fee_brl);
          const exitFee = price * Number(trade.quantity) * tradeFx * this.feeRatePerSide;
          const fees = entryFee + exitFee;
          const net = gross - fees;
          await client.query(
            "UPDATE public.paper_trades SET status='CLOSED', exit_price=$1, exit_reason=$2, pnl_gross_brl=$3, fees_total_brl=$4, pnl_net_brl=$5, closed_at=now() WHERE id=$6",
            [price, reason, gross, fees, net, trade.id]
          );
          await client.query(
            'INSERT INTO public.paper_events (trade_id,event_type,symbol,message,details) VALUES ($1,$2,$3,$4,$5)',
            [trade.id, reason === 'STOP_LOSS' ? 'STOP_TRIGGERED' : 'TARGET_TRIGGERED', trade.symbol, 'Posição PAPER encerrada por nível de preço.', JSON.stringify({ price, gross, fees, net })]
          );
          realizedDelta += net;
        }
        if (realizedDelta !== 0) {
          await client.query(
            'UPDATE public.paper_daily_state SET realized_pnl_brl=realized_pnl_brl+$1, updated_at=now() WHERE trading_date=$2',
            [realizedDelta, day]
          );
        }

        const updatedDailyResult = await client.query('SELECT * FROM public.paper_daily_state WHERE trading_date=$1 FOR UPDATE', [day]);
        const state = updatedDailyResult.rows[0];
        const openNow = await client.query("SELECT COALESCE(sum(entry_value_brl),0) AS exposure FROM public.paper_trades WHERE status='OPEN'");
        const openExposure = Number(openNow.rows[0].exposure || 0);
        let unrealized = 0;
        if (fx) {
          const liveOpen = await client.query("SELECT symbol,quantity,entry_price,metadata,estimated_entry_fee_brl FROM public.paper_trades WHERE status='OPEN'");
          for (const position of liveOpen.rows) {
            const last = Number(market[position.symbol] && market[position.symbol].lastPrice);
            const positionFx = Number((position.metadata && position.metadata.fxUsdBrl) || fx);
            if (Number.isFinite(last) && last > 0 && positionFx > 0) {
              unrealized += (last - Number(position.entry_price)) * Number(position.quantity) * positionFx - Number(position.estimated_entry_fee_brl) - (last * Number(position.quantity) * positionFx * this.feeRatePerSide);
            }
          }
          await client.query('UPDATE public.paper_daily_state SET unrealized_pnl_brl=$1, updated_at=now() WHERE trading_date=$2',[unrealized,day]);
        }
        const dailyLoss = Number(state.realized_pnl_brl) + unrealized;
        const halted = Boolean(state.halted) || dailyLoss <= -Number(settings.max_daily_loss_brl);
        if (halted && !state.halted) {
          await client.query("UPDATE public.paper_daily_state SET halted=true, halt_reason='Limite de perda diária atingido', updated_at=now() WHERE trading_date=$1", [day]);
          await client.query("INSERT INTO public.paper_events(event_type,message,details) VALUES ('DAILY_HALT','Motor PAPER pausado pelo limite diário.', $1)", [JSON.stringify({ dailyLoss })]);
        }

        if (fx && !halted && Number(state.trades_opened) < Number(settings.max_trades_per_day)) {
          for (const symbol of this.assets) {
            const ticker = market[symbol];
            if (!ticker || ticker.signal !== 'BULLISH' || !Number.isFinite(Number(ticker.lastPrice))) continue;
            const alreadyOpen = await client.query("SELECT 1 FROM public.paper_trades WHERE symbol=$1 AND status='OPEN' LIMIT 1", [symbol]);
            if (alreadyOpen.rowCount) continue;
            const entry = Number(ticker.lastPrice);
            const stop = entry * (1 - Number(settings.stop_loss_pct) / 100);
            const stopPct = Number(settings.stop_loss_pct) / 100;
            const feePct = Number(settings.fee_rate_per_side) * 2;
            const riskPerUnitBrl = entry * fx * (stopPct + feePct);
            if (!(riskPerUnitBrl > 0)) continue;
            const requestedRisk = Math.min(Number(settings.max_risk_per_trade_brl), Number(settings.initial_capital_brl) * 0.01);
            const riskLimitedQty = requestedRisk / riskPerUnitBrl;
            const remainingExposure = Math.max(0, Number(settings.max_exposure_brl) - openExposure);
            const remainingCapital = Math.max(0, Number(settings.initial_capital_brl) - openExposure);
            const maxNotional = Math.min(remainingExposure, remainingCapital);
            const qty = Math.min(riskLimitedQty, maxNotional / (entry * fx));
            const notional = qty * entry * fx;
            const actualRisk = qty * riskPerUnitBrl;
            if (!(qty > 0) || actualRisk > Number(settings.max_risk_per_trade_brl) + 0.01 || notional < 10) continue;
            const takeProfit = entry + (entry - stop) * 2 + entry * feePct;
            const entryFee = notional * Number(settings.fee_rate_per_side);
            const exitFee = notional * Number(settings.fee_rate_per_side);
            const idempotency = 'paper:' + String(day) + ':' + symbol + ':' + String(Number(state.trades_opened) + 1);
            const inserted = await client.query(
              "INSERT INTO public.paper_trades (symbol,quantity,entry_price,stop_price,take_profit_price,entry_value_brl,risk_brl,estimated_entry_fee_brl,estimated_exit_fee_brl,idempotency_key,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id",
              [symbol, qty, entry, stop, takeProfit, notional, actualRisk, entryFee, exitFee, idempotency, JSON.stringify({ fxUsdBrl: fx, fxSource: 'Frankfurter USD/BRL; USDT tratado como aproximação de USD', signal: ticker.signal })]
            );
            if (!inserted.rowCount) continue;
            await client.query(
              'UPDATE public.paper_daily_state SET trades_opened=trades_opened+1, updated_at=now() WHERE trading_date=$1',
              [day]
            );
            await client.query(
              "INSERT INTO public.paper_events(trade_id,event_type,symbol,message,details) VALUES ($1,'TRADE_OPENED',$2,'Posição simulada aberta; nenhuma ordem enviada à Bybit.',$3)",
              [inserted.rows[0].id, symbol, JSON.stringify({ entry, stop, takeProfit, qty, notional, riskBrl: actualRisk, fx })]
            );
            break; // one new position per engine cycle
          }
        }
        await client.query('COMMIT');
        this.lastRunAt = new Date().toISOString();
        this.lastError = fx ? null : this.lastError;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return this.getStatus();
    } catch (err) {
      this.lastError = err.message;
      throw err;
    } finally {
      this.running = false;
    }
  }

  async getStatus() {
    const [settings, daily, open, recent, events] = await Promise.all([
      this.pool.query('SELECT initial_capital_brl,max_risk_per_trade_brl,max_daily_loss_brl,max_trades_per_day,max_exposure_brl,stop_loss_pct,take_profit_pct,fee_rate_per_side,trading_enabled FROM public.paper_settings WHERE id=1'),
      this.pool.query("SELECT * FROM public.paper_daily_state WHERE trading_date=(now() AT TIME ZONE 'UTC')::date"),
      this.pool.query("SELECT id,symbol,quantity,entry_price,stop_price,take_profit_price,entry_value_brl,risk_brl,opened_at FROM public.paper_trades WHERE status='OPEN' ORDER BY opened_at DESC"),
      this.pool.query("SELECT id,symbol,quantity,entry_price,exit_price,exit_reason,pnl_net_brl,status,opened_at,closed_at FROM public.paper_trades ORDER BY opened_at DESC LIMIT 20"),
      this.pool.query("SELECT event_type,symbol,message,created_at FROM public.paper_events ORDER BY created_at DESC LIMIT 20")
    ]);
    return {
      enabled: true,
      mode: 'PAPER',
      orderExecutionEnabled: false,
      fxUsdBrl: this.lastFx,
      fxDescription: 'USDT aproximado por USD; câmbio indicativo, não cotação de execução',
      lastRunAt: this.lastRunAt,
      error: this.lastError,
      settings: settings.rows[0] || null,
      daily: daily.rows[0] || null,
      openPositions: open.rows,
      recentTrades: recent.rows,
      events: events.rows
    };
  }
}

module.exports = { createPool, PaperTrader };
