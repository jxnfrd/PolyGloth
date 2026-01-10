-- PolyGlot v2.0 Schema Upgrade
-- Run this in Supabase SQL Editor

-- 1. TRACKING TABLES
-- Track users (extends Supabase Auth)
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT,
  subscription_tier TEXT DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track signal interactions
CREATE TABLE IF NOT EXISTS signal_interactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id),
  signal_id UUID REFERENCES contrarian_signals(id),
  action TEXT CHECK (action IN ('view', 'click_link', 'save')),
  clicked_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. SCHEMA UPDATES
-- Add new columns to contrarian_signals if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contrarian_signals' AND column_name = 'market_slug') THEN
        ALTER TABLE contrarian_signals ADD COLUMN market_slug TEXT;
    END IF;
    
    -- These might already exist from previous fixes, but ensuring safety
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contrarian_signals' AND column_name = 'evidence_type') THEN
        ALTER TABLE contrarian_signals ADD COLUMN evidence_type TEXT;
    END IF;

    -- Add new scoring columns for v2
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contrarian_signals' AND column_name = 'tier') THEN
        ALTER TABLE contrarian_signals ADD COLUMN tier INTEGER; -- 1, 2, or 3
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contrarian_signals' AND column_name = 'time_advantage_hours') THEN
        ALTER TABLE contrarian_signals ADD COLUMN time_advantage_hours INTEGER;
    END IF;
END $$;

-- 3. ADMIN ANALYTICS VIEW
CREATE OR REPLACE VIEW admin_dashboard AS
SELECT 
  date_trunc('day', s.created_at) as day,
  COUNT(*) as total_signals,
  AVG(s.contradiction_score) as avg_score,
  COUNT(DISTINCT i.user_id) as active_users,
  COUNT(CASE WHEN i.action = 'click_link' THEN 1 END) as polymarket_clicks
FROM contrarian_signals s
LEFT JOIN signal_interactions i ON s.id = i.signal_id
GROUP BY day
ORDER BY day DESC;
