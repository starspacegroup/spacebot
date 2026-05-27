-- Track authenticated dashboard user activity for superadmin audit views.
-- This records page visits and API actions by logged-in users.

CREATE TABLE IF NOT EXISTS user_activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    activity_type TEXT NOT NULL DEFAULT 'action', -- page_view | api_action | action
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    query_string TEXT DEFAULT NULL,
    status_code INTEGER DEFAULT NULL,
    referrer TEXT DEFAULT NULL,
    ip_address TEXT DEFAULT NULL,
    user_agent TEXT DEFAULT NULL,
    details_json TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_created
    ON user_activity_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_activity_type_created
    ON user_activity_logs(activity_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_activity_path_created
    ON user_activity_logs(path, created_at DESC);
