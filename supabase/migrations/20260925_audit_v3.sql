-- Audit 2026-09-25: real whale data, market price on signals, scoring columns.
ALTER TABLE tracked_traders ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE tracked_traders ADD COLUMN IF NOT EXISTS total_profit DECIMAL;

ALTER TABLE whale_signals ADD COLUMN IF NOT EXISTS outcome_label TEXT;
ALTER TABLE whale_signals ADD COLUMN IF NOT EXISTS condition_id TEXT;
ALTER TABLE whale_signals ADD COLUMN IF NOT EXISTS current_value_usd DECIMAL;
ALTER TABLE whale_signals ADD COLUMN IF NOT EXISTS current_price DECIMAL;
ALTER TABLE whale_signals ADD COLUMN IF NOT EXISTS shares DECIMAL;
ALTER TABLE whale_signals ADD COLUMN IF NOT EXISTS pnl_usd DECIMAL;
ALTER TABLE whale_signals ADD COLUMN IF NOT EXISTS market_end_date TIMESTAMPTZ;
ALTER TABLE whale_signals ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'html-scrape-v1';
ALTER TABLE whale_signals ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_whale_signals_source_seen ON whale_signals(source, last_seen_at DESC);

ALTER TABLE contrarian_signals ADD COLUMN IF NOT EXISTS market_yes_price DECIMAL;
ALTER TABLE contrarian_signals ADD COLUMN IF NOT EXISTS condition_id TEXT;
ALTER TABLE contrarian_signals ADD COLUMN IF NOT EXISTS market_end_date TIMESTAMPTZ;
ALTER TABLE contrarian_signals ADD COLUMN IF NOT EXISTS ai_probability INTEGER;
ALTER TABLE contrarian_signals ADD COLUMN IF NOT EXISTS direction TEXT;
ALTER TABLE contrarian_signals ADD COLUMN IF NOT EXISTS ai_model TEXT;
ALTER TABLE contrarian_signals ADD COLUMN IF NOT EXISTS resolved_outcome TEXT;   -- 'YES' | 'NO' once known
ALTER TABLE contrarian_signals ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE pure_ai_predictions ADD COLUMN IF NOT EXISTS market_yes_price DECIMAL;
ALTER TABLE pure_ai_predictions ADD COLUMN IF NOT EXISTS resolved_outcome TEXT;
ALTER TABLE pure_ai_predictions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE pure_ai_predictions ALTER COLUMN ai_model_used DROP DEFAULT;

-- The 12.5k v1 rows are placeholders (YES / $500 / 0.50 for every trending link). They are NOT deleted here;
-- the dashboard filters on source = 'data-api'. To purge after review:
--   DELETE FROM whale_signals WHERE source = 'html-scrape-v1';
