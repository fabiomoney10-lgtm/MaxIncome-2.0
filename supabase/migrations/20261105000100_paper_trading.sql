-- MaxIncome 2.0: persistent PAPER trading schema.
-- Existing tables are preserved; this migration is safe on the already-provisioned project.
create table if not exists public.paper_settings (
  id smallint primary key default 1 check (id = 1),
  currency text not null default 'BRL' check (currency = 'BRL'),
  initial_capital_brl numeric(14,2) not null default 5000 check (initial_capital_brl > 0),
  max_risk_per_trade_brl numeric(14,2) not null default 50 check (max_risk_per_trade_brl > 0),
  max_daily_loss_brl numeric(14,2) not null default 100 check (max_daily_loss_brl > 0),
  max_trades_per_day integer not null default 5 check (max_trades_per_day between 1 and 100),
  max_exposure_brl numeric(14,2) not null default 5000 check (max_exposure_brl > 0),
  stop_loss_pct numeric(8,4) not null default 1 check (stop_loss_pct > 0 and stop_loss_pct <= 100),
  take_profit_pct numeric(8,4) not null default 2 check (take_profit_pct >= stop_loss_pct * 2 and take_profit_pct <= 500),
  fee_rate_per_side numeric(8,6) not null default 0.001 check (fee_rate_per_side >= 0 and fee_rate_per_side <= 0.1),
  trading_enabled boolean not null default false check (trading_enabled = false),
  updated_at timestamptz not null default now()
);
insert into public.paper_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.paper_daily_state (
  trading_date date primary key,
  starting_balance_brl numeric(14,2) not null check (starting_balance_brl >= 0),
  realized_pnl_brl numeric(14,2) not null default 0,
  unrealized_pnl_brl numeric(14,2) not null default 0,
  trades_opened integer not null default 0 check (trades_opened >= 0),
  halted boolean not null default false,
  halt_reason text,
  updated_at timestamptz not null default now()
);

create table if not exists public.paper_trades (
  id uuid primary key default gen_random_uuid(),
  account_id smallint not null default 1 references public.paper_settings(id),
  symbol text not null check (symbol ~ '^[A-Z0-9]{3,20}USDT$'),
  side text not null default 'BUY' check (side = 'BUY'),
  quantity numeric(28,12) not null check (quantity > 0),
  entry_price numeric(28,12) not null check (entry_price > 0),
  stop_price numeric(28,12) not null check (stop_price > 0 and stop_price < entry_price),
  take_profit_price numeric(28,12) not null check (take_profit_price >= entry_price * 1.000001),
  entry_value_brl numeric(14,2) not null check (entry_value_brl > 0),
  risk_brl numeric(14,2) not null check (risk_brl > 0),
  estimated_entry_fee_brl numeric(14,2) not null default 0 check (estimated_entry_fee_brl >= 0),
  estimated_exit_fee_brl numeric(14,2) not null default 0 check (estimated_exit_fee_brl >= 0),
  exit_price numeric(28,12),
  exit_reason text check (exit_reason in ('STOP_LOSS','TAKE_PROFIT','MANUAL_CLOSE','SYSTEM_CLOSE')),
  pnl_gross_brl numeric(14,2),
  fees_total_brl numeric(14,2),
  pnl_net_brl numeric(14,2),
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED','CANCELLED')),
  strategy_signal text not null default 'BULLISH' check (strategy_signal in ('BULLISH','BEARISH','WAIT')),
  idempotency_key text not null unique,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  check ((status = 'OPEN' and closed_at is null and exit_price is null and pnl_net_brl is null) or (status in ('CLOSED','CANCELLED') and closed_at is not null))
);
create unique index if not exists paper_trades_one_open_per_symbol on public.paper_trades(account_id,symbol) where status='OPEN';
create index if not exists paper_trades_opened_at_idx on public.paper_trades(opened_at desc);
create index if not exists paper_trades_status_idx on public.paper_trades(status,opened_at desc);

create table if not exists public.paper_events (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid references public.paper_trades(id) on delete set null,
  event_type text not null check (event_type in ('SIGNAL_IGNORED','TRADE_OPENED','STOP_TRIGGERED','TARGET_TRIGGERED','TRADE_CLOSED','RISK_BLOCKED','ENGINE_ERROR','DAILY_HALT')),
  symbol text,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists paper_events_created_at_idx on public.paper_events(created_at desc);
create index if not exists paper_events_trade_id_idx on public.paper_events(trade_id);

alter table public.paper_settings enable row level security;
alter table public.paper_daily_state enable row level security;
alter table public.paper_trades enable row level security;
alter table public.paper_events enable row level security;
revoke all on public.paper_settings,public.paper_daily_state,public.paper_trades,public.paper_events from public,anon,authenticated;
grant select,insert,update,delete on public.paper_settings,public.paper_daily_state,public.paper_trades,public.paper_events to service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paper_trades_minimum_reward_risk') THEN
    ALTER TABLE public.paper_trades
      ADD CONSTRAINT paper_trades_minimum_reward_risk
      CHECK (take_profit_price - entry_price >= (entry_price - stop_price) * 2);
  END IF;
END $$;
