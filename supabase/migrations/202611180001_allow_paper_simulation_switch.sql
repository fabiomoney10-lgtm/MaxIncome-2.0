-- Allow the database switch to control PAPER simulation only.
-- This does not add or authorize any exchange order execution.
ALTER TABLE public.paper_settings
  DROP CONSTRAINT IF EXISTS paper_settings_trading_enabled_check;

ALTER TABLE public.paper_settings
  ADD CONSTRAINT paper_settings_trading_enabled_check
  CHECK (trading_enabled IN (false, true));

COMMENT ON COLUMN public.paper_settings.trading_enabled IS
  'Enables/disables simulated PAPER positions only. It never authorizes Bybit orders.';
