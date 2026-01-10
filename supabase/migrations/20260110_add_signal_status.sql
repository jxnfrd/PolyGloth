-- Add status column to distinguish between LIVE signals and REJECTED ones
ALTER TABLE contrarian_signals 
ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('ACTIVE', 'REJECTED', 'ARCHIVED')) DEFAULT 'ACTIVE';

-- Index for filtering
CREATE INDEX IF NOT EXISTS idx_signals_status ON contrarian_signals(status);

-- Update existing records to ACTIVE
UPDATE contrarian_signals SET status = 'ACTIVE' WHERE status IS NULL;
