-- One-click Connect: SpaceBot as an authorization server.
--
-- A registered site sends an admin to /connect, they approve a scope grant for
-- one of their servers, and the site exchanges a one-time code for an API key
-- server-to-server. The point is that nobody has to hand-copy a key, and that
-- the key never travels through a browser, a URL, a referrer header or a log.
--
-- Two rules the schema exists to enforce:
--
-- 1. `redirect_uris` is an allowlist, checked by exact string match. Without it
--    this flow is a phishing primitive: anyone could walk a SpaceBot admin
--    through a genuine consent screen and collect a working key. An
--    unrecognised redirect_uri is refused ON the consent page and never
--    redirected to.
-- 2. `allowed_scopes` caps what a client may ask for, so a compromised or
--    over-eager site cannot escalate a request beyond what it was registered
--    for. The admin's approval narrows further; it can never widen.

CREATE TABLE IF NOT EXISTS connect_clients (
    client_id TEXT PRIMARY KEY,

    -- Shown on the consent screen. The admin is approving *this* name.
    name TEXT NOT NULL,
    description TEXT,

    -- SHA-256 of a 256-bit random secret. The secret is shown once at
    -- registration and never stored or recoverable, exactly like an API key.
    client_secret_hash TEXT NOT NULL,

    -- JSON array of exact, absolute https URIs. Exact match, not prefix:
    -- prefix matching lets an open redirect or a path-traversal quirk on the
    -- client's own domain turn into key theft.
    redirect_uris TEXT NOT NULL DEFAULT '[]',

    -- JSON array of API key scopes this client may ever request.
    allowed_scopes TEXT NOT NULL DEFAULT '[]',

    enabled INTEGER NOT NULL DEFAULT 1,

    created_by TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME
);

-- One-time authorization codes.
--
-- A row records an approval, not a credential: no API key exists until the code
-- is exchanged, so an approval nobody redeems leaves nothing behind to leak.
-- Only the code's SHA-256 is stored, so a database read cannot replay one.
CREATE TABLE IF NOT EXISTS connect_authorization_codes (
    code_hash TEXT PRIMARY KEY,

    client_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,

    -- Bound to the redirect_uri the approval was issued for; the exchange must
    -- present the same one, so a code stolen mid-flight cannot be redeemed
    -- against a different registration.
    redirect_uri TEXT NOT NULL,

    -- JSON array. What the admin actually approved, which may be less than was
    -- requested and can never be more.
    scopes TEXT NOT NULL DEFAULT '[]',

    -- Discord user id of the approver, kept for the audit trail on the key.
    approved_by TEXT NOT NULL,

    expires_at DATETIME NOT NULL,
    consumed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (client_id) REFERENCES connect_clients(client_id) ON DELETE CASCADE
);

-- The pruning scan, and the lookup is by primary key.
CREATE INDEX IF NOT EXISTS idx_connect_codes_expiry
    ON connect_authorization_codes(expires_at);
