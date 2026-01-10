-- Add unique constraint for upsert
ALTER TABLE whale_signals 
ADD CONSTRAINT whale_signals_market_trader_key UNIQUE (market_id, trader_id);
