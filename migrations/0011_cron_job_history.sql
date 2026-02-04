-- Cron job execution history table
-- Tracks when scheduled jobs ran and their results

CREATE TABLE IF NOT EXISTS cron_job_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Job identification
    job_name TEXT NOT NULL, -- 'hourly_aggregation', 'daily_refresh'
    cron_pattern TEXT, -- '0 * * * *', '0 0 * * *'
    
    -- Execution details
    triggered_by TEXT NOT NULL, -- 'cron', 'manual'
    triggered_by_user_id TEXT, -- User ID if triggered manually
    
    -- Status
    status TEXT NOT NULL, -- 'running', 'success', 'failed'
    
    -- Results (JSON)
    result_data TEXT, -- JSON with job-specific results
    error_message TEXT,
    
    -- Timing
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    duration_ms INTEGER,
    
    -- Metadata
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_cron_job_history_job_name ON cron_job_history(job_name);
CREATE INDEX IF NOT EXISTS idx_cron_job_history_started_at ON cron_job_history(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_job_history_status ON cron_job_history(status);
