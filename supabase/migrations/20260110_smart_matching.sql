-- Run in Supabase SQL Editor

-- Add missing columns to signals table
ALTER TABLE contrarian_signals 
ADD COLUMN IF NOT EXISTS news_published_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS signal_generated_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS freshness_score INTEGER,
ADD COLUMN IF NOT EXISTS indicator_color TEXT CHECK (indicator_color IN ('green', 'orange', 'red')),
ADD COLUMN IF NOT EXISTS market_liquidity DECIMAL,
ADD COLUMN IF NOT EXISTS odds_at_signal JSONB,
ADD COLUMN IF NOT EXISTS processing_log TEXT[],
ADD COLUMN IF NOT EXISTS source_outlet TEXT,
ADD COLUMN IF NOT EXISTS source_credibility TEXT CHECK (source_credibility IN ('high', 'medium', 'low'));

-- Create matching statistics table
CREATE TABLE IF NOT EXISTS matching_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_date DATE DEFAULT CURRENT_DATE,
  total_markets INTEGER,
  markets_with_news INTEGER,
  news_with_correlation INTEGER,
  signals_generated INTEGER,
  avg_freshness_score DECIMAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create processing log table (for admin dashboard)
CREATE TABLE IF NOT EXISTS processing_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  log_level TEXT CHECK (log_level IN ('info', 'warning', 'error')),
  component TEXT,
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster analytics
CREATE INDEX IF NOT EXISTS idx_signals_indicator ON contrarian_signals(indicator_color);
CREATE INDEX IF NOT EXISTS idx_signals_freshness ON contrarian_signals(freshness_score);
