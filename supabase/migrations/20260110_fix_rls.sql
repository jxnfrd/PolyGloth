-- Enable RLS on all relevant tables
ALTER TABLE contrarian_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pure_ai_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whale_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_traders ENABLE ROW LEVEL SECURITY;

-- Create Policy: Public Read Access (Anon + Authenticated)
CREATE POLICY "Public Read Access" ON contrarian_signals FOR SELECT USING (true);
CREATE POLICY "Public Read Access" ON pure_ai_predictions FOR SELECT USING (true);
CREATE POLICY "Public Read Access" ON whale_signals FOR SELECT USING (true);
CREATE POLICY "Public Read Access" ON tracked_traders FOR SELECT USING (true);

-- Allow Service Role full access (implicit, but good to double check if needed, usually built-in)
