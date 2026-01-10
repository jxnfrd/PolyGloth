CREATE TABLE IF NOT EXISTS pure_ai_predictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  market_id TEXT NOT NULL, -- Polymarket's market ID
  market_slug TEXT,
  market_question TEXT,
  
  prediction_summary TEXT, -- AI's 1-2 sentence forecast
  reasoning TEXT, -- AI's chain-of-thought reasoning
  estimated_probability INTEGER, -- AI's % for "Yes"
  confidence_level TEXT CHECK (confidence_level IN ('high', 'medium', 'low')),
  
  ai_model_used TEXT DEFAULT 'gemini-1.5-flash',
  analysis_timestamp TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(market_id) -- One AI prediction per market
);

-- Index for faster retrieval by market_id
CREATE INDEX IF NOT EXISTS idx_pure_ai_market_id ON pure_ai_predictions(market_id);
-- Index for clearing old predictions if needed
CREATE INDEX IF NOT EXISTS idx_pure_ai_timestamp ON pure_ai_predictions(analysis_timestamp);
