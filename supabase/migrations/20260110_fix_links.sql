-- Run this in Supabase SQL Editor to fix missing columns
ALTER TABLE contrarian_signals 
ADD COLUMN IF NOT EXISTS market_slug TEXT,
ADD COLUMN IF NOT EXISTS article_url TEXT;

-- Optional: Clean up malformed signals if desired
-- DELETE FROM contrarian_signals WHERE market_slug IS NULL;
