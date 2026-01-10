-- Create table for tracked traders (Whales)
CREATE TABLE IF NOT EXISTS tracked_traders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    polymarket_user_id TEXT UNIQUE NOT NULL, -- User Handle/ID from leaderboard
    display_name TEXT,
    leaderboard_rank INTEGER,
    total_volume DECIMAL,
    total_profit DECIMAL,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Create table for whale signals
CREATE TABLE IF NOT EXISTS whale_signals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    trader_id UUID REFERENCES tracked_traders(id) ON DELETE CASCADE,
    market_id TEXT NOT NULL,
    market_slug TEXT,
    market_question TEXT,
    trader_action TEXT CHECK (trader_action IN ('YES', 'NO', 'SCALP')),
    position_size_usd DECIMAL,
    average_buy_price DECIMAL,
    potential_payout DECIMAL,
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    signal_strength TEXT CHECK (signal_strength IN ('high', 'medium', 'low'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_whale_signals_market_id ON whale_signals(market_id);
CREATE INDEX IF NOT EXISTS idx_whale_signals_trader_id ON whale_signals(trader_id);
CREATE INDEX IF NOT EXISTS idx_whale_signals_discovered_at ON whale_signals(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracked_traders_rank ON tracked_traders(leaderboard_rank);
