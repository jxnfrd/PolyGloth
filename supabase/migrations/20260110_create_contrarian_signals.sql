-- Create table for storing contrarian signals
CREATE TABLE IF NOT EXISTS contrarian_signals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  market_id TEXT,
  market_title TEXT,
  article_url TEXT,
  article_language TEXT,
  key_finding TEXT,
  evidence_type TEXT, -- Anecdotal, Statistical, etc.
  contradiction_score INTEGER,
  confidence TEXT, -- High, Medium, Low
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS (Optional, better for security if exposing via API)
ALTER TABLE contrarian_signals ENABLE ROW LEVEL SECURITY;

-- Policy: Allow read access to authenticated users (or everyone if public dashboard)
CREATE POLICY "Enable read access for all users" ON contrarian_signals
    FOR SELECT USING (true);

-- Policy: Allow insert access to service role only (backend automation)
CREATE POLICY "Enable insert for service role only" ON contrarian_signals
    FOR INSERT WITH CHECK (auth.role() = 'service_role');
