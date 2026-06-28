/**
 * MCP Client for Discord Bot
 * 
 * This module provides a client interface to call MCP tools from within
 * the Discord gateway. Instead of running as a stdio server, these functions
 * can be called directly with the Cloudflare API credentials or local SQLite.
 */

import { log } from "../log.js";

// Dynamic import for SQLite (only loaded when needed, not available on Workers)
// Uses bun:sqlite when running under Bun, falls back to better-sqlite3 for Node.js
let Database = null;
const isBun = typeof globalThis.Bun !== "undefined";

function parseJsonField(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * MCP Client class that connects to D1 database via Cloudflare API or local SQLite
 */
export interface MCPClientOptions {
  accountId?: string;
  apiToken?: string;
  databaseId?: string;
  useLocalDb?: boolean;
  discordBotToken?: string;
  d1Database?: any;
  [key: string]: any;
}

export class MCPClient {
  accountId?: string;
  apiToken?: string;
  databaseId: string;
  useLocalDb: boolean;
  localDb: any;
  discordBotToken?: string;
  d1Database: any;

  constructor(options: MCPClientOptions = {}) {
    this.accountId = options.accountId;
    this.apiToken = options.apiToken;
    this.databaseId = options.databaseId || "6bce735c-2dca-43cd-9911-2eef7062377a";
    this.useLocalDb = options.useLocalDb || false;
    this.localDb = null;
    this.discordBotToken = options.discordBotToken;
    this.d1Database = options.d1Database || null; // D1 database for cache lookups
    
    log.debug(`[MCP] Client initialized - accountId: ${this.accountId ? 'SET' : 'MISSING'}, apiToken: ${this.apiToken ? 'SET' : 'MISSING'}, useLocalDb: ${this.useLocalDb}`);
  }

  /**
   * Check if the client is properly configured
   */
  isConfigured() {
    if (this.useLocalDb) {
      return true; // Local DB doesn't need API credentials
    }
    if (this.d1Database) {
      return true; // D1 binding available directly (Cloudflare Pages/Workers)
    }
    const configured = Boolean(this.accountId && this.apiToken);
    if (!configured) {
      log.warn(`[MCP] Client not configured - accountId: ${this.accountId ? 'SET' : 'MISSING'}, apiToken: ${this.apiToken ? 'SET' : 'MISSING'}`);
    }
    return configured;
  }

  /**
   * Initialize local SQLite database connection
   */
  async initLocalDb() {
    if (this.localDb) return this.localDb;
    
    try {
      // Dynamic imports for Node.js builtins - these are only available in local/gateway mode,
      // not in Cloudflare Workers. Importing them at the top level breaks the Pages build.
      // @vite-ignore preserves the "node:" prefix so wrangler's nodejs_compat handles them.
      const { existsSync, readdirSync } = await import(/* @vite-ignore */ "node:fs");
      const { join, dirname } = await import(/* @vite-ignore */ "node:path");
      const { fileURLToPath } = await import(/* @vite-ignore */ "node:url");

      if (!Database) {
        if (isBun) {
          // Bun has built-in SQLite support
          // @ts-expect-error bun:sqlite is only resolvable under the Bun runtime
          const bunSqlite = await import(/* @vite-ignore */ "bun:sqlite");
          Database = bunSqlite.Database;
        } else {
          // Build the specifier at runtime so no bundler (Vite or esbuild) can resolve it.
          // This package is Node.js-only and never executes on Cloudflare Workers.
          const bs3 = ["better", "sqlite3"].join("-");
          const betterSqlite3 = await import(/* @vite-ignore */ bs3);
          Database = betterSqlite3.default;
        }
      }
      
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const wranglerDbPath = join(__dirname, "../../../.wrangler/state/v3/d1/miniflare-D1DatabaseObject");
      
      if (!existsSync(wranglerDbPath)) {
        throw new Error(`Local D1 database path not found: ${wranglerDbPath}`);
      }
      
      const files = readdirSync(wranglerDbPath).filter(f => f.endsWith(".sqlite") && !f.includes("-shm") && !f.includes("-wal"));
      
      if (files.length === 0) {
        throw new Error("No local D1 database found");
      }
      
      // Find the database that has the automations table (the SpaceBot database)
      // This is necessary because miniflare creates multiple sqlite files for different D1 bindings
      let selectedFile = null;
      for (const file of files) {
        try {
          const testDb = new Database(join(wranglerDbPath, file), { readonly: true });
          // Check if this database has our tables
          const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='automations'").all();
          testDb.close();
          if (tables.length > 0) {
            selectedFile = file;
            log.debug(`[MCP] Found SpaceBot database: ${file}`);
            break;
          }
        } catch (e) {
          // Skip files that can't be opened
          log.debug(`[MCP] Skipping database file ${file}: ${e.message}`);
        }
      }
      
      // Fallback to WAL-based selection if no database has the automations table
      if (!selectedFile) {
        const withWal = files.find(f => existsSync(join(wranglerDbPath, f + "-wal")));
        selectedFile = withWal || files[0];
        log.warn(`[MCP] Could not find database with automations table, falling back to: ${selectedFile}`);
      }
      
      const dbPath = join(wranglerDbPath, selectedFile);
      log.info(`[MCP] Using local SQLite database: ${dbPath}`);
      this.localDb = new Database(dbPath, { readonly: true });
      return this.localDb;
    } catch (error) {
      log.error(`[MCP] Failed to initialize local DB:`, error.message);
      throw error;
    }
  }

  /**
   * Execute a query against the D1 database via Cloudflare API or local SQLite
   */
  async executeD1Query(sql, params = []) {
    if (this.useLocalDb) {
      return this.executeLocalQuery(sql, params);
    }

    // Use D1 binding directly if available (Cloudflare Pages/Workers)
    if (this.d1Database) {
      return this.executeD1BindingQuery(sql, params);
    }
    
    if (!this.isConfigured()) {
      throw new Error("MCP Client not configured: Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN");
    }

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      }
    );

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(`D1 query failed: ${JSON.stringify(data.errors)}`);
    }

    return data.result[0];
  }

  /**
   * Execute a query using the D1 binding directly (Cloudflare Pages/Workers)
   */
  async executeD1BindingQuery(sql, params = []) {
    try {
      const stmt = this.d1Database.prepare(sql).bind(...params);
      const result = await stmt.all();
      return {
        results: result.results || [],
        success: true,
      };
    } catch (error) {
      throw new Error(`D1 binding query failed: ${error.message}`);
    }
  }

  /**
   * Execute a query against the local SQLite database
   */
  async executeLocalQuery(sql, params = []) {
    const db = await this.initLocalDb();
    
    try {
      // Replace ? placeholders with $1, $2, etc. for better-sqlite3/bun:sqlite if needed
      const stmt = db.prepare(sql);
      const results = stmt.all(...params);
      
      return {
        results: results,
        success: true,
      };
    } catch (error) {
      throw new Error(`Local DB query failed: ${error.message}`);
    }
  }

  /**
   * List all guild IDs that have data in SpaceBot
   */
  async listGuilds() {
    const [logsResult, automationsResult, commandsResult, settingsResult] = await Promise.all([
      this.executeD1Query("SELECT DISTINCT guild_id FROM event_logs"),
      this.executeD1Query("SELECT DISTINCT guild_id FROM automations"),
      this.executeD1Query("SELECT DISTINCT guild_id FROM commands"),
      this.executeD1Query("SELECT DISTINCT guild_id FROM guild_settings"),
    ]);

    const guildIds = new Set([
      ...logsResult.results.map(r => r.guild_id),
      ...automationsResult.results.map(r => r.guild_id),
      ...commandsResult.results.map(r => r.guild_id),
      ...settingsResult.results.map(r => r.guild_id),
    ]);

    return Array.from(guildIds);
  }

  async getLocalRunners(userId, options: any = {}) {
    if (!userId) {
      throw new Error("userId is required to list local runners");
    }

    const { includeOffline = true, tokenId = null, limit = 100 } = options;
    let sql = `SELECT i.id, i.runner_token_id, t.name AS token_name, i.instance_key, i.display_name,
                      i.hostname, i.platform, i.platform_release, i.arch, i.runner_version,
                      i.default_workdir, i.metadata, i.last_seen_at, i.last_disconnect_at,
                      i.last_seen_ip, i.created_at, i.updated_at,
                      CASE
                        WHEN i.last_seen_at IS NOT NULL
                         AND i.last_seen_at >= datetime('now', '-90 seconds')
                         AND t.revoked = 0
                        THEN 1 ELSE 0
                      END AS is_online,
                      (
                        SELECT COUNT(*)
                        FROM local_runner_jobs j
                        WHERE j.target_instance_id = i.id AND j.status = 'pending'
                      ) AS pending_job_count,
                      (
                        SELECT COUNT(*)
                        FROM local_runner_jobs j
                        WHERE j.claimed_by_instance_id = i.id AND j.status = 'running'
                      ) AS running_job_count
               FROM local_runner_instances i
               JOIN local_runner_tokens t ON t.id = i.runner_token_id
               WHERE i.user_id = ?`;
    const params = [userId];

    if (tokenId) {
      sql += ` AND i.runner_token_id = ?`;
      params.push(tokenId);
    }

    sql += ` ORDER BY i.last_seen_at DESC, i.created_at DESC LIMIT ?`;
    params.push(limit);

    const result = await this.executeD1Query(sql, params);
    const runners = (result.results || []).map((row) => ({
      ...row,
      is_online: Boolean(row.is_online),
      pending_job_count: Number(row.pending_job_count || 0),
      running_job_count: Number(row.running_job_count || 0),
      metadata: parseJsonField(row.metadata),
    }));

    return includeOffline ? runners : runners.filter((runner) => runner.is_online);
  }

  async getLocalRunnerActivity(userId, options: any = {}) {
    if (!userId) {
      throw new Error("userId is required to inspect local runner activity");
    }

    const { tokenId = null, instanceId = null, limit = 20 } = options;
    const runners = await this.getLocalRunners(userId, { includeOffline: true, tokenId, limit: 100 });
    const filteredRunners = instanceId
      ? runners.filter((runner) => String(runner.id) === String(instanceId))
      : runners;

    let eventsSql = `SELECT e.id, e.runner_token_id, e.runner_instance_id, e.job_id,
                            e.event_type, e.level, e.message, e.details, e.created_at,
                            i.display_name AS instance_name, t.name AS token_name
                     FROM local_runner_events e
                     LEFT JOIN local_runner_instances i ON i.id = e.runner_instance_id
                     JOIN local_runner_tokens t ON t.id = e.runner_token_id
                     WHERE e.user_id = ?`;
    const eventParams = [userId];

    if (tokenId) {
      eventsSql += ` AND e.runner_token_id = ?`;
      eventParams.push(tokenId);
    }

    if (instanceId) {
      eventsSql += ` AND e.runner_instance_id = ?`;
      eventParams.push(instanceId);
    }

    eventsSql += ` ORDER BY e.created_at DESC, e.id DESC LIMIT ?`;
    eventParams.push(limit);

    const eventsResult = await this.executeD1Query(eventsSql, eventParams);
    const recentEvents = (eventsResult.results || []).map((row) => ({
      ...row,
      details: parseJsonField(row.details),
    }));

    let jobsSql = `SELECT j.id, j.runner_token_id, j.command, j.working_dir, j.status,
                          j.label, j.created_at, j.updated_at, j.completed_at,
                          j.target_instance_id, j.claimed_by_instance_id,
                          target.display_name AS target_instance_name,
                          claimed.display_name AS claimed_by_instance_name,
                          t.name AS token_name
                   FROM local_runner_jobs j
                   JOIN local_runner_tokens t ON t.id = j.runner_token_id
                   LEFT JOIN local_runner_instances target ON target.id = j.target_instance_id
                   LEFT JOIN local_runner_instances claimed ON claimed.id = j.claimed_by_instance_id
                   WHERE j.user_id = ? AND j.status IN ('pending', 'running')`;
    const jobParams = [userId];

    if (tokenId) {
      jobsSql += ` AND j.runner_token_id = ?`;
      jobParams.push(tokenId);
    }

    if (instanceId) {
      jobsSql += ` AND (j.target_instance_id = ? OR j.claimed_by_instance_id = ?)`;
      jobParams.push(instanceId, instanceId);
    }

    jobsSql += ` ORDER BY j.created_at DESC LIMIT ?`;
    jobParams.push(limit);

    const jobsResult = await this.executeD1Query(jobsSql, jobParams);

    return {
      runners: filteredRunners,
      activeJobs: jobsResult.results || [],
      recentEvents,
    };
  }

  async startLocalRunnerTask(userId, options: any = {}) {
    if (!userId) {
      throw new Error("userId is required to queue local runner tasks");
    }

    const {
      command,
      workingDir = null,
      label = null,
      tokenId = null,
      instanceIds = [],
      instanceNames = [],
      targetMode = 'selected',
      priority = 0,
      maxAttempts = 5,
      timeoutSeconds = 300,
      capabilityRequirements = null,
    } = options;

    if (!command?.trim()) {
      throw new Error("command is required");
    }

    const boundedPriority = Math.max(-100, Math.min(100, Math.trunc(Number(priority) || 0)));
    const boundedAttempts = Math.max(1, Math.min(20, Math.trunc(Number(maxAttempts) || 5)));
    const boundedTimeout = Math.max(30, Math.min(3600, Math.trunc(Number(timeoutSeconds) || 300)));

    let capabilityRequirementsJson = null;
    if (capabilityRequirements !== null && capabilityRequirements !== undefined) {
      if (typeof capabilityRequirements !== 'object' || Array.isArray(capabilityRequirements)) {
        throw new Error('capabilityRequirements must be an object when provided');
      }
      capabilityRequirementsJson = JSON.stringify(capabilityRequirements);
    }

    const runners = await this.getLocalRunners(userId, { includeOffline: true, tokenId, limit: 500 });
    const selected = new Map();
    const unresolvedNames = [];

    for (const instanceId of instanceIds || []) {
      const match = runners.find((runner) => String(runner.id) === String(instanceId));
      if (match) selected.set(match.id, match);
    }

    for (const rawName of instanceNames || []) {
      const query = String(rawName || '').trim().toLowerCase();
      if (!query) continue;
      const matches = runners.filter((runner) =>
        String(runner.display_name || '').toLowerCase().includes(query)
        || String(runner.hostname || '').toLowerCase().includes(query)
        || String(runner.token_name || '').toLowerCase().includes(query)
      );

      if (matches.length === 0) {
        unresolvedNames.push(rawName);
      }

      for (const match of matches) {
        selected.set(match.id, match);
      }
    }

    if (targetMode === 'all-online') {
      for (const runner of runners.filter((runner) => runner.is_online)) {
        selected.set(runner.id, runner);
      }
    }

    if (targetMode === 'all-known') {
      for (const runner of runners) {
        selected.set(runner.id, runner);
      }
    }

    if (selected.size === 0) {
      if (!instanceIds?.length && !instanceNames?.length && targetMode === 'selected' && runners.length === 1) {
        selected.set(runners[0].id, runners[0]);
      } else {
        throw new Error(unresolvedNames.length > 0
          ? `No runner instances matched: ${unresolvedNames.join(', ')}`
          : 'No runner instances matched the requested targets');
      }
    }

    const queuedJobs = [];
    for (const runner of selected.values()) {
      const insert = await this.executeD1Query(
        `INSERT INTO local_runner_jobs (
           runner_token_id, user_id, command, working_dir, label, status, target_instance_id,
           priority, max_attempts, timeout_seconds, capability_requirements_json
         )
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          runner.runner_token_id,
          userId,
          command.trim(),
          workingDir,
          label,
          runner.id,
          boundedPriority,
          boundedAttempts,
          boundedTimeout,
          capabilityRequirementsJson,
        ]
      );

      queuedJobs.push({
        jobId: insert.results?.[0]?.id ?? null,
        runnerId: runner.id,
        runnerName: runner.display_name,
        tokenId: runner.runner_token_id,
        tokenName: runner.token_name,
        isOnline: runner.is_online,
      });
    }

    return {
      queuedCount: queuedJobs.length,
      queuedJobs,
      unresolvedNames,
    };
  }

  async getLocalRunnerJob(userId, jobId) {
    if (!userId) throw new Error("userId is required");
    if (!jobId) throw new Error("jobId is required");

    const result = await this.executeD1Query(
      `SELECT j.id, j.runner_token_id, j.command, j.working_dir, j.label, j.status,
              j.target_instance_id, j.claimed_by_instance_id,
              j.priority, j.max_attempts, j.attempt_count, j.timeout_seconds,
              j.exit_code, j.output, j.result_json, j.cancel_reason, j.terminal_error,
              j.created_at, j.updated_at, j.started_at, j.completed_at, j.canceled_at,
              j.next_retry_at,
              t.name AS token_name,
              target.display_name AS target_instance_name,
              claimed.display_name AS claimed_by_instance_name
         FROM local_runner_jobs j
         JOIN local_runner_tokens t ON t.id = j.runner_token_id
         LEFT JOIN local_runner_instances target ON target.id = j.target_instance_id
         LEFT JOIN local_runner_instances claimed ON claimed.id = j.claimed_by_instance_id
        WHERE j.id = ? AND j.user_id = ?
        LIMIT 1`,
      [jobId, userId]
    );

    const row = result.results?.[0];
    if (!row) return null;

    // Truncate output to keep DM responses reasonable.
    let output = row.output ?? null;
    let outputTruncated = false;
    if (output && output.length > 4000) {
      output = output.slice(-4000);
      outputTruncated = true;
    }

    return {
      ...row,
      output,
      output_truncated: outputTruncated,
      result_json: parseJsonField(row.result_json),
    };
  }

  async cancelLocalRunnerJob(userId, jobId, reason = null) {
    if (!userId) throw new Error("userId is required");
    if (!jobId) throw new Error("jobId is required");

    const update = await this.executeD1Query(
      `UPDATE local_runner_jobs
         SET status = 'canceled',
             canceled_at = datetime('now'),
             cancel_reason = ?,
             terminal_error = COALESCE(?, terminal_error),
             completed_at = datetime('now'),
             started_at = NULL,
             next_retry_at = NULL,
             updated_at = datetime('now')
       WHERE id = ?
         AND user_id = ?
         AND status IN ('pending', 'running')`,
      [reason ?? null, reason ?? null, jobId, userId]
    );

    const changed = update?.meta?.changes ?? update?.changes ?? 0;
    if (!changed) {
      return { success: false, error: "Job not found or cannot be canceled (only pending or running jobs can be canceled)." };
    }

    const job = await this.getLocalRunnerJob(userId, jobId);
    return { success: true, job };
  }

  async retryLocalRunnerJob(userId, jobId) {
    if (!userId) throw new Error("userId is required");
    if (!jobId) throw new Error("jobId is required");

    const update = await this.executeD1Query(
      `UPDATE local_runner_jobs
         SET status = 'pending',
             output = NULL,
             exit_code = NULL,
             result_json = NULL,
             artifact_refs_json = NULL,
             claimed_by_instance_id = NULL,
             attempt_count = 0,
             started_at = NULL,
             next_retry_at = NULL,
             canceled_at = NULL,
             cancel_reason = NULL,
             terminal_error = NULL,
             completed_at = NULL,
             updated_at = datetime('now')
       WHERE id = ?
         AND user_id = ?
         AND status IN ('failed', 'canceled')`,
      [jobId, userId]
    );

    const changed = update?.meta?.changes ?? update?.changes ?? 0;
    if (!changed) {
      return { success: false, error: "Job not found or cannot be retried (only failed or canceled jobs can be retried)." };
    }

    const job = await this.getLocalRunnerJob(userId, jobId);
    return { success: true, job };
  }

  async resolveLocalRunnerTarget(userId, options: any = {}) {
    const { tokenId = null, instanceId = null, instanceName = null, requireOnline = true } = options;
    const runners = await this.getLocalRunners(userId, {
      includeOffline: true,
      tokenId,
      limit: 200,
    });

    if (!runners.length) {
      throw new Error("No local runner systems are registered for this user");
    }

    let selected = null;

    if (instanceId) {
      selected = runners.find((runner) => String(runner.id) === String(instanceId)) || null;
    }

    if (!selected && instanceName && typeof instanceName === "string") {
      const query = instanceName.trim().toLowerCase();
      if (query) {
        selected = runners.find((runner) =>
          String(runner.display_name || "").toLowerCase().includes(query)
          || String(runner.hostname || "").toLowerCase().includes(query)
          || String(runner.token_name || "").toLowerCase().includes(query)
        ) || null;
      }
    }

    if (!selected) {
      selected = runners.find((runner) => runner.is_online) || runners[0] || null;
    }

    if (!selected) {
      throw new Error("Unable to select a local runner target");
    }

    if (requireOnline && !selected.is_online) {
      throw new Error(`Selected runner ${selected.display_name || selected.hostname || selected.id} is offline`);
    }

    return selected;
  }

  async waitForLocalRunnerJob(userId, jobId, maxWaitSeconds = 25) {
    const maxWaitMs = Math.max(1, Math.min(90, Math.trunc(Number(maxWaitSeconds) || 25))) * 1000;
    const started = Date.now();

    while (Date.now() - started < maxWaitMs) {
      const job = await this.getLocalRunnerJob(userId, jobId);
      if (!job) {
        return { status: "missing", job: null };
      }

      if (job.status === "completed" || job.status === "failed" || job.status === "canceled") {
        return { status: "done", job };
      }

      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    const latest = await this.getLocalRunnerJob(userId, jobId);
    return {
      status: "timeout",
      job: latest,
    };
  }

  async runTypedLocalRunnerJob(userId, options: any = {}) {
    if (!userId) throw new Error("userId is required");

    const {
      jobType,
      payload = {},
      label = null,
      tokenId = null,
      instanceId = null,
      instanceName = null,
      priority = 20,
      timeoutSeconds = 120,
      maxAttempts = 1,
      waitForResult = true,
      waitSeconds = 25,
      requireOnline = true,
      capabilityRequirements = null,
    } = options;

    if (!jobType || typeof jobType !== "string") {
      throw new Error("jobType is required");
    }

    const target = await this.resolveLocalRunnerTarget(userId, {
      tokenId,
      instanceId,
      instanceName,
      requireOnline,
    });

    const insert = await this.executeD1Query(
      `INSERT INTO local_runner_jobs (
         runner_token_id, user_id, command, working_dir, label, status, target_instance_id,
         job_type, payload_json, capability_requirements_json, priority, max_attempts, timeout_seconds
       )
       VALUES (?, ?, ?, NULL, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        target.runner_token_id,
        userId,
        `[${jobType}]`,
        label,
        target.id,
        jobType,
        JSON.stringify(payload || {}),
        capabilityRequirements ? JSON.stringify(capabilityRequirements) : null,
        Math.max(-100, Math.min(100, Math.trunc(Number(priority) || 20))),
        Math.max(1, Math.min(20, Math.trunc(Number(maxAttempts) || 1))),
        Math.max(30, Math.min(3600, Math.trunc(Number(timeoutSeconds) || 120))),
      ],
    );

    const jobId = insert.results?.[0]?.id;
    if (!jobId) {
      throw new Error("Failed to queue local runner job");
    }

    if (!waitForResult) {
      return {
        queued: true,
        jobId,
        target,
      };
    }

    const waitResult = await this.waitForLocalRunnerJob(userId, jobId, waitSeconds);
    return {
      queued: true,
      jobId,
      target,
      waitStatus: waitResult.status,
      job: waitResult.job,
    };
  }

  /**
   * Get event logs for a guild
   */
  async getEventLogs(guildId, options: any = {}) {
    const { limit = 50, offset = 0, category, eventType, since, until, actorId } = options;
    
    let sql = "SELECT * FROM event_logs WHERE guild_id = ?";
    const params = [guildId];

    if (category) {
      sql += " AND event_category = ?";
      params.push(category);
    }

    if (eventType) {
      sql += " AND event_type = ?";
      params.push(eventType);
    }

    if (since) {
      sql += " AND created_at >= ?";
      params.push(since);
    }

    if (until) {
      sql += " AND created_at <= ?";
      params.push(until);
    }

    if (actorId) {
      sql += " AND actor_id = ?";
      params.push(actorId);
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const result = await this.executeD1Query(sql, params);
    
    return result.results.map(logEntry => ({
      ...logEntry,
      details: logEntry.details ? JSON.parse(logEntry.details) : null,
    }));
  }

  /**
   * Get voice activity stats for a guild
   */
  async getVoiceActivity(guildId, options: any = {}) {
    const { days = 7 } = options;
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const [joinCount, uniqueUsers, topUsers, topChannels, voiceSessions] = await Promise.all([
      // Total voice joins
      this.executeD1Query(
        `SELECT COUNT(*) as count FROM event_logs 
         WHERE guild_id = ? AND event_type = 'VOICE_JOIN' AND created_at >= ?`,
        [guildId, sinceDate]
      ),
      // Unique users in voice
      this.executeD1Query(
        `SELECT COUNT(DISTINCT COALESCE(actor_id, target_id)) as count FROM event_logs 
         WHERE guild_id = ? AND event_type = 'VOICE_JOIN' AND created_at >= ?`,
        [guildId, sinceDate]
      ),
      // Top voice users
      this.executeD1Query(
        `SELECT 
           COALESCE(NULLIF(actor_name, ''), NULLIF(target_name, ''), 'Unknown member') as actor_name,
           COALESCE(actor_id, target_id) as actor_id,
           COUNT(*) as join_count
         FROM event_logs 
         WHERE guild_id = ? AND event_type = 'VOICE_JOIN' AND created_at >= ?
           AND COALESCE(actor_id, target_id) IS NOT NULL
         GROUP BY COALESCE(actor_id, target_id) ORDER BY join_count DESC LIMIT 10`,
        [guildId, sinceDate]
      ),
      // Top voice channels
      this.executeD1Query(
        `SELECT channel_name, channel_id, COUNT(*) as join_count FROM event_logs 
         WHERE guild_id = ? AND event_type = 'VOICE_JOIN' AND created_at >= ?
         GROUP BY channel_id ORDER BY join_count DESC LIMIT 10`,
        [guildId, sinceDate]
      ),
      // Voice join/leave pairs for duration calculation
      this.executeD1Query(
        `SELECT 
           COALESCE(actor_id, target_id) as actor_id,
           COALESCE(NULLIF(actor_name, ''), NULLIF(target_name, ''), 'Unknown member') as actor_name,
           event_type,
           created_at
         FROM event_logs 
         WHERE guild_id = ? AND event_type IN ('VOICE_JOIN', 'VOICE_LEAVE') AND created_at >= ?
           AND COALESCE(actor_id, target_id) IS NOT NULL
         ORDER BY COALESCE(actor_id, target_id), created_at`,
        [guildId, sinceDate]
      ),
    ]);

    // Calculate voice hours from join/leave pairs
    let totalMinutes = 0;
    const userMinutes: Record<string, any> = {};
    const sessions = voiceSessions.results || [];

    // Group events by user and pair joins with leaves
    const userEvents: Record<string, any> = {};
    for (const event of sessions) {
      if (!userEvents[event.actor_id]) {
        userEvents[event.actor_id] = { name: event.actor_name, events: [] };
      }
      userEvents[event.actor_id].events.push(event);
    }
    
    const now = Date.now();
    for (const [userId, userData] of Object.entries(userEvents)) {
      let userTotal = 0;
      let pendingJoin = null;
      
      for (const event of userData.events) {
        if (event.event_type === 'VOICE_JOIN') {
          pendingJoin = new Date(event.created_at).getTime();
        } else if (event.event_type === 'VOICE_LEAVE' && pendingJoin) {
          const leaveTime = new Date(event.created_at).getTime();
          userTotal += (leaveTime - pendingJoin) / 60000; // Convert ms to minutes
          pendingJoin = null;
        }
      }
      
      // If user is still in voice (join without leave), count up to now
      if (pendingJoin) {
        userTotal += (now - pendingJoin) / 60000;
      }
      
      userMinutes[userId] = { name: userData.name, minutes: Math.round(userTotal) };
      totalMinutes += userTotal;
    }
    
    // Build top users by time spent
    const topUsersByTime = Object.entries(userMinutes)
      .map(([id, data]) => ({
        actor_name: data.name,
        actor_id: id,
        hours: Math.round(data.minutes / 60 * 10) / 10,
        minutes: data.minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10);

    const totalHours = Math.round(totalMinutes / 60 * 10) / 10;

    return {
      period: `Last ${days} day${days !== 1 ? 's' : ''}`,
      totalVoiceHours: totalHours,
      totalVoiceMinutes: Math.round(totalMinutes),
      totalVoiceJoins: joinCount.results[0]?.count || 0,
      uniqueUsersInVoice: uniqueUsers.results[0]?.count || 0,
      topVoiceUsersByTime: topUsersByTime,
      topVoiceUsersByJoins: topUsers.results,
      topVoiceChannels: topChannels.results,
    };
  }

  /**
   * Get activity summary for a guild
   */
  async getActivitySummary(guildId, options: any = {}) {
    const { days = 7 } = options;
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const [messages, joins, leaves, voice, reactions] = await Promise.all([
      this.executeD1Query(
        `SELECT COUNT(*) as count FROM event_logs 
         WHERE guild_id = ? AND event_type = 'MESSAGE_CREATE' AND created_at >= ?`,
        [guildId, sinceDate]
      ),
      this.executeD1Query(
        `SELECT COUNT(*) as count FROM event_logs 
         WHERE guild_id = ? AND event_type = 'MEMBER_JOIN' AND created_at >= ?`,
        [guildId, sinceDate]
      ),
      this.executeD1Query(
        `SELECT COUNT(*) as count FROM event_logs 
         WHERE guild_id = ? AND event_type = 'MEMBER_LEAVE' AND created_at >= ?`,
        [guildId, sinceDate]
      ),
      this.executeD1Query(
        `SELECT COUNT(*) as count FROM event_logs 
         WHERE guild_id = ? AND event_type = 'VOICE_JOIN' AND created_at >= ?`,
        [guildId, sinceDate]
      ),
      this.executeD1Query(
        `SELECT COUNT(*) as count FROM event_logs 
         WHERE guild_id = ? AND event_type = 'REACTION_ADD' AND created_at >= ?`,
        [guildId, sinceDate]
      ),
    ]);

    // Get top active members by message count
    const topMembers = await this.executeD1Query(
      `SELECT actor_name, actor_id, COUNT(*) as message_count FROM event_logs 
       WHERE guild_id = ? AND event_type = 'MESSAGE_CREATE' AND created_at >= ? AND actor_is_bot = 0
       GROUP BY actor_id ORDER BY message_count DESC LIMIT 10`,
      [guildId, sinceDate]
    );

    // Get most active channels
    const topChannels = await this.executeD1Query(
      `SELECT channel_name, channel_id, COUNT(*) as message_count FROM event_logs 
       WHERE guild_id = ? AND event_type = 'MESSAGE_CREATE' AND created_at >= ?
       GROUP BY channel_id ORDER BY message_count DESC LIMIT 10`,
      [guildId, sinceDate]
    );

    return {
      period: `Last ${days} days`,
      messageCount: messages.results[0]?.count || 0,
      memberJoins: joins.results[0]?.count || 0,
      memberLeaves: leaves.results[0]?.count || 0,
      voiceJoins: voice.results[0]?.count || 0,
      reactionCount: reactions.results[0]?.count || 0,
      topActiveMembers: topMembers.results,
      topActiveChannels: topChannels.results,
    };
  }

  /**
   * Get log statistics for a guild
   */
  async getLogStats(guildId) {
    const [totalResult, categoryResult, recentResult] = await Promise.all([
      this.executeD1Query(
        "SELECT COUNT(*) as total FROM event_logs WHERE guild_id = ?",
        [guildId]
      ),
      this.executeD1Query(
        `SELECT event_category, COUNT(*) as count 
         FROM event_logs WHERE guild_id = ?
         GROUP BY event_category`,
        [guildId]
      ),
      this.executeD1Query(
        `SELECT event_type, COUNT(*) as count 
         FROM event_logs WHERE guild_id = ?
         GROUP BY event_type ORDER BY count DESC LIMIT 10`,
        [guildId]
      ),
    ]);

    return {
      totalEvents: totalResult.results[0]?.total || 0,
      byCategory: Object.fromEntries(
        categoryResult.results.map(r => [r.event_category, r.count])
      ),
      topEventTypes: recentResult.results,
    };
  }

  /**
   * Get automations for a guild
   */
  async getAutomations(guildId, options: any = {}) {
    const { enabled, limit = 100 } = options;
    
    let sql = "SELECT * FROM automations WHERE guild_id = ?";
    const params = [guildId];

    // Filter by enabled status if specified
    if (enabled === true) {
      sql += " AND enabled = 1";
    } else if (enabled === false) {
      sql += " AND enabled = 0";
    }
    // If enabled is undefined, return all automations

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const result = await this.executeD1Query(sql, params);
    
    return result.results.map(automation => ({
      ...automation,
      trigger_events: automation.trigger_events ? JSON.parse(automation.trigger_events) : 
                      (automation.trigger_event ? [automation.trigger_event] : []),
      trigger_filters: automation.trigger_filters ? JSON.parse(automation.trigger_filters) : {},
      action_config: automation.action_config ? JSON.parse(automation.action_config) : {},
    }));
  }

  /**
   * Get a single automation by ID
   */
  async getAutomation(automationId, guildId) {
    const result = await this.executeD1Query(
      "SELECT * FROM automations WHERE id = ? AND guild_id = ?",
      [automationId, guildId]
    );

    if (!result.results.length) {
      return null;
    }

    const automation = result.results[0];
    return {
      ...automation,
      trigger_events: automation.trigger_events ? JSON.parse(automation.trigger_events) : 
                      (automation.trigger_event ? [automation.trigger_event] : []),
      trigger_filters: automation.trigger_filters ? JSON.parse(automation.trigger_filters) : {},
      action_config: automation.action_config ? JSON.parse(automation.action_config) : {},
    };
  }

  /**
   * Get automation execution logs
   */
  async getAutomationLogs(guildId, options: any = {}) {
    const { automationId, limit = 50 } = options;
    
    let sql = "SELECT * FROM automation_logs WHERE guild_id = ?";
    const params = [guildId];

    if (automationId) {
      sql += " AND automation_id = ?";
      params.push(automationId);
    }

    sql += " ORDER BY executed_at DESC LIMIT ?";
    params.push(limit);

    const result = await this.executeD1Query(sql, params);
    
    return result.results.map(logEntry => ({
      ...logEntry,
      trigger_data: logEntry.trigger_data ? JSON.parse(logEntry.trigger_data) : null,
      result_data: logEntry.result_data ? JSON.parse(logEntry.result_data) : null,
    }));
  }

  /**
   * Get commands for a guild
   */
  async getCommands(guildId, options: any = {}) {
    const { enabledOnly = false, registeredOnly = false, limit = 100 } = options;
    
    let sql = "SELECT * FROM commands WHERE guild_id = ?";
    const params = [guildId];

    if (enabledOnly) {
      sql += " AND enabled = 1";
    }

    if (registeredOnly) {
      sql += " AND registered = 1";
    }

    sql += " ORDER BY name ASC LIMIT ?";
    params.push(limit);

    const result = await this.executeD1Query(sql, params);
    
    return result.results.map(command => ({
      ...command,
      options: command.options ? JSON.parse(command.options) : [],
      action_config: command.action_config ? JSON.parse(command.action_config) : {},
      response_embed: command.response_embed ? JSON.parse(command.response_embed) : null,
    }));
  }

  /**
   * Get a single command by ID
   */
  async getCommand(commandId, guildId) {
    const result = await this.executeD1Query(
      "SELECT * FROM commands WHERE id = ? AND guild_id = ?",
      [commandId, guildId]
    );

    if (!result.results.length) {
      return null;
    }

    const command = result.results[0];
    return {
      ...command,
      options: command.options ? JSON.parse(command.options) : [],
      action_config: command.action_config ? JSON.parse(command.action_config) : {},
      response_embed: command.response_embed ? JSON.parse(command.response_embed) : null,
    };
  }

  /**
   * Get command usage logs
   */
  async getCommandLogs(guildId, options: any = {}) {
    const { commandId, limit = 50 } = options;
    
    let sql = "SELECT * FROM command_logs WHERE guild_id = ?";
    const params = [guildId];

    if (commandId) {
      sql += " AND command_id = ?";
      params.push(commandId);
    }

    sql += " ORDER BY executed_at DESC LIMIT ?";
    params.push(limit);

    const result = await this.executeD1Query(sql, params);
    
    return result.results.map(logEntry => ({
      ...logEntry,
      options_used: logEntry.options_used ? JSON.parse(logEntry.options_used) : null,
      result_data: logEntry.result_data ? JSON.parse(logEntry.result_data) : null,
    }));
  }

  /**
   * Get server settings for a guild
   */
  async getGuildSettings(guildId) {
    const result = await this.executeD1Query(
      "SELECT * FROM guild_settings WHERE guild_id = ?",
      [guildId]
    );

    const DEFAULT_SETTINGS = {
      prefix: "!",
      logging_enabled: true,
      log_channel_id: null,
      moderation_role_id: null,
      excluded_channels: [],
      excluded_categories: [],
      permission_settings: {
        viewDashboard: { permission: "MANAGE_GUILD", roles: [] },
        viewLogs: { permission: "MANAGE_GUILD", roles: [] },
        manageAutomations: { permission: "MANAGE_GUILD", roles: [] },
        manageCommands: { permission: "MANAGE_GUILD", roles: [] },
        manageSettings: { permission: "ADMINISTRATOR", roles: [] },
      },
    };

    if (!result.results.length) {
      return DEFAULT_SETTINGS;
    }

    const settings = result.results[0];
    return {
      prefix: settings.prefix || DEFAULT_SETTINGS.prefix,
      logging_enabled: Boolean(settings.logging_enabled),
      log_channel_id: settings.log_channel_id || null,
      moderation_role_id: settings.moderation_role_id || null,
      excluded_channels: settings.excluded_channels ? JSON.parse(settings.excluded_channels) : [],
      excluded_categories: settings.excluded_categories ? JSON.parse(settings.excluded_categories) : [],
      permission_settings: settings.permission_settings ? 
        JSON.parse(settings.permission_settings) : DEFAULT_SETTINGS.permission_settings,
      created_at: settings.created_at,
      updated_at: settings.updated_at,
    };
  }

  /**
   * Get server statistics (member count, channel count, etc.)
   */
  async getServerStats(guildId) {
    // Get the latest stats snapshot
    const result = await this.executeD1Query(
      `SELECT * FROM server_stats 
       WHERE guild_id = ?
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [guildId]
    );

    if (!result.results.length) {
      return null;
    }

    const stats = result.results[0];
    return {
      member_count: stats.member_count,
      human_count: stats.human_count,
      bot_count: stats.bot_count,
      online_count: stats.online_count,
      channel_count: stats.channel_count,
      role_count: stats.role_count,
      emoji_count: stats.emoji_count,
      boost_count: stats.boost_count,
      boost_level: stats.boost_level,
      recorded_at: stats.recorded_at,
    };
  }

  /**
   * Get a user's roles in a specific guild via Discord API
   * @param {string} guildId - The guild ID
   * @param {string} userId - The user ID
   * @returns {Promise<Object>} - User's member info including roles
   */
  async getUserRoles(guildId, userId) {
    if (!this.discordBotToken) {
      throw new Error("Discord bot token not configured - cannot fetch user roles");
    }

    // Fetch the guild member to get their role IDs
    const memberResponse = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
      {
        headers: {
          "Authorization": `Bot ${this.discordBotToken}`,
        },
      }
    );

    if (!memberResponse.ok) {
      if (memberResponse.status === 404) {
        throw new Error("User is not a member of this guild");
      }
      throw new Error(`Failed to fetch member: ${memberResponse.status}`);
    }

    const member = await memberResponse.json();

    // Fetch the guild's roles to get role names
    const rolesResponse = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/roles`,
      {
        headers: {
          "Authorization": `Bot ${this.discordBotToken}`,
        },
      }
    );

    if (!rolesResponse.ok) {
      throw new Error(`Failed to fetch guild roles: ${rolesResponse.status}`);
    }

    const guildRoles: any = await rolesResponse.json();
    const roleMap = new Map<any, any>(guildRoles.map(r => [r.id, r]));

    // Map user's role IDs to role details
    const userRoles = member.roles
      .map(roleId => {
        const role = roleMap.get(roleId);
        if (!role) return null;
        return {
          id: role.id,
          name: role.name,
          color: role.color,
          position: role.position,
          hoist: role.hoist,
          managed: role.managed,
          mentionable: role.mentionable,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.position - a.position); // Sort by position (highest first)

    return {
      userId: member.user.id,
      username: member.user.username,
      displayName: member.nick || member.user.global_name || member.user.username,
      joinedAt: member.joined_at,
      roles: userRoles,
      roleCount: userRoles.length,
      highestRole: userRoles[0] || null,
    };
  }

  /**
   * Get members who have a specific role in a guild
   * Tries cache first, falls back to Discord API
   * @param {string} guildId - The guild ID
   * @param {string} roleNameOrId - The role name (case-insensitive partial match) or role ID
   * @param {number} [limit=100] - Maximum number of members to return
   * @param {D1Database} [db] - Optional D1 database for cache lookup
   * @returns {Promise<Object>} - Members with the role and role details
   */
  async getMembersWithRole(guildId, roleNameOrId, limit = 100, db = null) {
    // Try cache first if db is available
    if (db) {
      try {
        const { getMembersWithRoleFromCache, getCacheMetadata } = await import("../db/guild-cache.js");
        const metadata = await getCacheMetadata(db, guildId);
        
        // Check if cache exists and is reasonably fresh (within 2 hours)
        if (metadata?.members_last_refreshed) {
          const cacheAge = Date.now() - new Date(metadata.members_last_refreshed).getTime();
          const maxAge = 2 * 60 * 60 * 1000; // 2 hours
          
          if (cacheAge < maxAge) {
            log.debug(`[MCP] Using cached member data for guild ${guildId} (age: ${Math.round(cacheAge / 60000)}min)`);
            const cacheResult = await getMembersWithRoleFromCache(db, guildId, roleNameOrId, limit);
            
            if (cacheResult.role) {
              return {
                role: cacheResult.role,
                members: cacheResult.members,
                memberCount: cacheResult.memberCount,
                source: "cache",
                cacheAge: Math.round(cacheAge / 60000), // minutes
              };
            }
            // If role not found in cache, fall through to API
            if (cacheResult.error && cacheResult.error.includes("not found")) {
              return {
                success: false,
                error: cacheResult.error,
                availableRoles: cacheResult.availableRoles,
                source: "cache",
              };
            }
          }
        }
      } catch (cacheError) {
        log.debug(`[MCP] Cache lookup failed, falling back to API:`, cacheError.message);
      }
    }

    // Fall back to Discord API
    if (!this.discordBotToken) {
      throw new Error("Discord bot token not configured - cannot fetch members");
    }

    // First, fetch the guild's roles to find the role by name or ID
    const rolesResponse = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/roles`,
      {
        headers: {
          "Authorization": `Bot ${this.discordBotToken}`,
        },
      }
    );

    if (!rolesResponse.ok) {
      throw new Error(`Failed to fetch guild roles: ${rolesResponse.status}`);
    }

    const guildRoles = await rolesResponse.json();
    
    // Find the role by ID or name (case-insensitive partial match)
    let targetRole = guildRoles.find(r => r.id === roleNameOrId);
    if (!targetRole) {
      const searchName = roleNameOrId.toLowerCase();
      targetRole = guildRoles.find(r => r.name.toLowerCase() === searchName) ||
                   guildRoles.find(r => r.name.toLowerCase().includes(searchName));
    }
    
    if (!targetRole) {
      return {
        success: false,
        error: `Role "${roleNameOrId}" not found. Available roles: ${guildRoles.map(r => r.name).join(', ')}`,
        availableRoles: guildRoles.map(r => ({ id: r.id, name: r.name })),
      };
    }

    // Fetch ALL guild members - Discord limits to 1000 per request
    // We need to paginate through ALL members first, then filter by role
    // The limit parameter only affects how many role members we return, not how many we fetch
    const allMembers = [];
    let lastMemberId = null;
    const maxMembersToFetch = 10000; // Safety limit to prevent infinite loops
    
    // Fetch members in batches until we have all of them
    while (allMembers.length < maxMembersToFetch) {
      const url = new URL(`https://discord.com/api/v10/guilds/${guildId}/members`);
      url.searchParams.set('limit', '1000'); // Always fetch max per request
      if (lastMemberId) {
        url.searchParams.set('after', lastMemberId);
      }

      const membersResponse = await fetch(url.toString(), {
        headers: {
          "Authorization": `Bot ${this.discordBotToken}`,
        },
      });

      if (!membersResponse.ok) {
        if (membersResponse.status === 403) {
          throw new Error("Bot doesn't have permission to view members. The 'Server Members Intent' must be enabled in the Discord Developer Portal.");
        }
        throw new Error(`Failed to fetch members: ${membersResponse.status}`);
      }

      const members = await membersResponse.json();
      if (members.length === 0) break;
      
      allMembers.push(...members);
      lastMemberId = members[members.length - 1].user.id;
      
      log.debug(`[MCP] Fetched ${allMembers.length} members so far...`);
      
      // If we got fewer than 1000, we've reached the end
      if (members.length < 1000) break;
    }

    // Filter members who have the target role
    const membersWithRole = allMembers
      .filter(member => member.roles.includes(targetRole.id))
      .map(member => ({
        id: member.user.id,
        username: member.user.username,
        displayName: member.nick || member.user.global_name || member.user.username,
        isBot: member.user.bot || false,
        joinedAt: member.joined_at,
      }))
      .sort((a, b) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()))
      .slice(0, limit); // Apply limit to the results, not the fetch

    log.info(`[MCP] Found ${membersWithRole.length} members with role "${targetRole.name}" (checked ${allMembers.length} total members)`);

    return {
      role: {
        id: targetRole.id,
        name: targetRole.name,
        color: targetRole.color,
        position: targetRole.position,
        mentionable: targetRole.mentionable,
      },
      members: membersWithRole,
      memberCount: membersWithRole.length,
      totalMembersChecked: allMembers.length,
      source: "discord_api",
    };
  }

  /**
   * Get voice and stage channels for a guild
   * @param {string} guildId - The guild ID
   * @returns {Promise<Object>} - Voice and stage channels
   */
  async getVoiceAndStageChannels(guildId) {
    if (!this.discordBotToken) {
      throw new Error("Discord bot token not configured - cannot fetch channels");
    }

    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/channels`,
      {
        headers: {
          "Authorization": `Bot ${this.discordBotToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch channels: ${response.status}`);
    }

    const channels = await response.json();
    
    // Channel types: 2 = Voice, 13 = Stage
    const voiceChannels = channels
      .filter(c => c.type === 2)
      .map(c => ({ id: c.id, name: c.name, type: "voice", parentId: c.parent_id }))
      .sort((a, b) => a.name.localeCompare(b.name));
    
    const stageChannels = channels
      .filter(c => c.type === 13)
      .map(c => ({ id: c.id, name: c.name, type: "stage", parentId: c.parent_id }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      voiceChannels,
      stageChannels,
      totalVoice: voiceChannels.length,
      totalStage: stageChannels.length,
    };
  }

  /**
   * Get text channels for a guild
   * @param {string} guildId - The guild ID
   * @param {string} [nameFilter] - Optional filter to match channel names (case-insensitive partial match)
   * @returns {Promise<Object>} - Text channels
   */
  async getTextChannels(guildId, nameFilter = null) {
    if (!this.discordBotToken) {
      throw new Error("Discord bot token not configured - cannot fetch channels");
    }

    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/channels`,
      {
        headers: {
          "Authorization": `Bot ${this.discordBotToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch channels: ${response.status}`);
    }

    const channels = await response.json();
    
    // Channel types: 0 = Text, 5 = Announcement/News, 15 = Forum
    let textChannels = channels
      .filter(c => c.type === 0 || c.type === 5 || c.type === 15)
      .map(c => ({ 
        id: c.id, 
        name: c.name, 
        type: c.type === 0 ? "text" : c.type === 5 ? "announcement" : "forum", 
        parentId: c.parent_id,
        position: c.position,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    
    // Filter by name if provided
    if (nameFilter) {
      const filter = nameFilter.toLowerCase().replace(/^#/, ''); // Remove leading # if present
      textChannels = textChannels.filter(c => 
        c.name.toLowerCase().includes(filter)
      );
    }

    return {
      textChannels,
      totalChannels: textChannels.length,
    };
  }

  /**
   * Send a message to a Discord channel
   * @param {string} guildId - The guild ID (for verification)
   * @param {string} channelId - The channel ID to send to
   * @param {string} content - The message content
   * @param {Object} [options] - Additional options
   * @param {boolean} [options.embed] - Whether to send as an embed
   * @param {string} [options.embedTitle] - Title for embed
   * @param {number} [options.embedColor] - Embed color (default: 0x5865F2)
   * @returns {Promise<Object>} - Sent message info
   */
  async sendChannelMessage(guildId, channelId, content, options: any = {}) {
    if (!this.discordBotToken) {
      throw new Error("Discord bot token not configured - cannot send messages");
    }

    // Build the message payload
    let payload;
    if (options.embed) {
      payload = {
        embeds: [{
          title: options.embedTitle || undefined,
          description: content,
          color: options.embedColor || 0x5865F2,
          timestamp: new Date().toISOString(),
        }],
      };
    } else {
      payload = {
        content,
      };
    }

    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bot ${this.discordBotToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.message || `HTTP ${response.status}`;
      throw new Error(`Failed to send message: ${errorMsg}`);
    }

    const sentMessage = await response.json();
    log.info(`[MCP] Sent message to channel ${channelId} in guild ${guildId}`);

    return {
      id: sentMessage.id,
      channelId: sentMessage.channel_id,
      content: sentMessage.content,
      timestamp: sentMessage.timestamp,
    };
  }

  /**
   * Parse a natural language event text into structured event data
   * Handles formats like:
   * - "Men's Olympic Ice Hockey Preliminary: USA vs Denmark\nFeb 14, 2026 · 9:10–11:30 PM"
   * - "Event Name, Feb 14 2026 9:10 PM - 11:30 PM"
   */
  parseEventFromText(text) {
    // Try to extract event name and time from the text
    // Common patterns:
    // 1. Name on first line, date/time on second line (separated by \n)
    // 2. Name, then date · time–time format
    
    const lines = text.trim().split(/\n/);
    let name, dateTimeStr;
    
    if (lines.length >= 2) {
      // Multi-line format
      name = lines[0].trim();
      dateTimeStr = lines.slice(1).join(' ').trim();
    } else {
      // Try to find date pattern in single line
      // Look for patterns like "Feb 14, 2026" or "2026-02-14"
      const dateMatch = text.match(/(.+?)\s*[,·]?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
      if (dateMatch) {
        name = dateMatch[1].trim();
        dateTimeStr = text.substring(dateMatch.index + dateMatch[1].length).trim();
      } else {
        return null; // Can't parse
      }
    }
    
    // Clean up name (remove trailing comma, period, etc.)
    name = name.replace(/[,·]\s*$/, '').trim();
    
    // Parse date and time from dateTimeStr
    // Format examples:
    // "Feb 14, 2026 · 9:10–11:30 PM"
    // "Feb 14, 2026 9:10 PM - 11:30 PM"
    // "February 14, 2026 at 9:10 PM"
    
    // Remove leading separators
    dateTimeStr = dateTimeStr.replace(/^[,·\s]+/, '');
    
    // Extract date part (e.g., "Feb 14, 2026")
    const datePattern = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/;
    const dateMatch = dateTimeStr.match(datePattern);
    
    if (!dateMatch) {
      return null;
    }
    
    const monthStr = dateMatch[1];
    const day = parseInt(dateMatch[2], 10);
    const year = parseInt(dateMatch[3], 10);
    
    // Convert month name to number
    const months = {
      'jan': 0, 'january': 0,
      'feb': 1, 'february': 1,
      'mar': 2, 'march': 2,
      'apr': 3, 'april': 3,
      'may': 4,
      'jun': 5, 'june': 5,
      'jul': 6, 'july': 6,
      'aug': 7, 'august': 7,
      'sep': 8, 'september': 8,
      'oct': 9, 'october': 9,
      'nov': 10, 'november': 10,
      'dec': 11, 'december': 11,
    };
    
    const month = months[monthStr.toLowerCase()];
    if (month === undefined) {
      return null;
    }
    
    // Extract time part
    // Look for patterns like "9:10–11:30 PM", "9:10 PM - 11:30 PM", "9:10 PM"
    const timeStr = dateTimeStr.substring(dateMatch.index + dateMatch[0].length).trim();
    
    // Remove leading separators (· or at or ,)
    const cleanTimeStr = timeStr.replace(/^[·,]\s*|^at\s+/i, '').trim();
    
    // Parse start and end times
    // Formats: "9:10–11:30 PM", "9:10 PM – 11:30 PM", "9:10-11:30 PM", "9:10 PM"
    const timeRangePattern = /(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*[–\-–]\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)/i;
    const singleTimePattern = /(\d{1,2}):?(\d{2})?\s*(AM|PM)/i;
    
    let startHour, startMinute, endHour, endMinute;
    const rangeMatch = cleanTimeStr.match(timeRangePattern);
    
    if (rangeMatch) {
      // Time range found
      startHour = parseInt(rangeMatch[1], 10);
      startMinute = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 0;
      const startAmPm = rangeMatch[3]?.toUpperCase();
      endHour = parseInt(rangeMatch[4], 10);
      endMinute = rangeMatch[5] ? parseInt(rangeMatch[5], 10) : 0;
      const endAmPm = rangeMatch[6].toUpperCase();
      
      // Convert to 24-hour format
      // If start AM/PM is not specified, infer from end time
      const effectiveStartAmPm = startAmPm || endAmPm;
      
      if (effectiveStartAmPm === 'PM' && startHour !== 12) {
        startHour += 12;
      } else if (effectiveStartAmPm === 'AM' && startHour === 12) {
        startHour = 0;
      }
      
      if (endAmPm === 'PM' && endHour !== 12) {
        endHour += 12;
      } else if (endAmPm === 'AM' && endHour === 12) {
        endHour = 0;
      }
    } else {
      // Try single time
      const singleMatch = cleanTimeStr.match(singleTimePattern);
      if (singleMatch) {
        startHour = parseInt(singleMatch[1], 10);
        startMinute = singleMatch[2] ? parseInt(singleMatch[2], 10) : 0;
        const amPm = singleMatch[3].toUpperCase();
        
        if (amPm === 'PM' && startHour !== 12) {
          startHour += 12;
        } else if (amPm === 'AM' && startHour === 12) {
          startHour = 0;
        }
        
        // Default end time: 2 hours after start
        endHour = startHour + 2;
        endMinute = startMinute;
        if (endHour >= 24) {
          endHour -= 24;
        }
      } else {
        // No time found, default to noon-2pm
        startHour = 12;
        startMinute = 0;
        endHour = 14;
        endMinute = 0;
      }
    }
    
    // Create Date objects
    const startDate = new Date(year, month, day, startHour, startMinute, 0);
    const endDate = new Date(year, month, day, endHour, endMinute, 0);
    
    // If end time is before start time, assume it's the next day
    if (endDate <= startDate) {
      endDate.setDate(endDate.getDate() + 1);
    }
    
    return {
      name,
      scheduledStartTime: startDate.toISOString(),
      scheduledEndTime: endDate.toISOString(),
      entityType: 3, // External event
    };
  }

  /**
   * Parse multiple events from text, separated by blank lines
   */
  parseEventsFromText(text) {
    // Split by double newlines or look for patterns
    const eventBlocks = text.split(/\n\s*\n/).filter(block => block.trim());
    const events = [];
    
    for (const block of eventBlocks) {
      const event = this.parseEventFromText(block);
      if (event) {
        events.push(event);
      }
    }
    
    return events;
  }

  /**
   * Generate an image using Cloudflare AI for an event
   * @param {string} eventName - The event name to generate an image for
   * @param {Object} env - Environment variables with Cloudflare credentials
   * @returns {Promise<string|null>} - Base64 data URI or null if failed
   */
  async generateEventImage(eventName, env: any = {}) {
    const accountId = env.CLOUDFLARE_ACCOUNT_ID || this.accountId;
    const apiToken = env.CLOUDFLARE_AI_TOKEN || env.CLOUDFLARE_API_TOKEN || this.apiToken;
    
    if (!accountId || !apiToken) {
      log.warn("[MCP] Cannot generate image: missing Cloudflare credentials");
      return null;
    }

    // Use Stable Diffusion XL Lightning - fast and free
    const model = "@cf/bytedance/stable-diffusion-xl-lightning";
    
    // Create a prompt that generates an attractive event banner
    const prompt = `Create a vibrant, eye-catching event banner image for: "${eventName}". 
Style: Modern, professional, suitable for a Discord server event. 
Include relevant visual elements that match the event theme. 
No text or words in the image. High quality, 16:9 aspect ratio.`;

    log.info(`[MCP] Generating image for event: ${eventName}`);

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt,
            num_steps: 4, // Lightning model uses fewer steps
            width: 1024,
            height: 576, // 16:9 aspect ratio
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        log.error(`[MCP] Image generation failed: ${response.status} - ${errorText}`);
        return null;
      }

      // The response is raw image bytes
      const imageBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(imageBuffer).toString("base64");
      
      // Return as data URI for Discord
      const dataUri = `data:image/png;base64,${base64}`;
      
      log.info(`[MCP] Successfully generated image for: ${eventName}`);
      return dataUri;
    } catch (error) {
      log.error(`[MCP] Image generation error:`, error.message);
      return null;
    }
  }

  /**
   * Create a scheduled event in a Discord server
   * @param {string} guildId - The guild ID
   * @param {Object} eventData - Event data
   * @param {Object} [options] - Additional options
   * @param {boolean} [options.generateImage] - Whether to generate an AI image
   * @param {Object} [options.env] - Environment variables for image generation
   * @returns {Promise<Object>} - Created event
   */
  async createScheduledEvent(guildId, eventData, options: any = {}) {
    if (!this.discordBotToken) {
      throw new Error("Discord bot token not configured - cannot create events");
    }

    // Generate AI image if requested
    let imageDataUri = eventData.image;
    if (options.generateImage && !imageDataUri) {
      imageDataUri = await this.generateEventImage(eventData.name, options.env);
    }

    // Infer entity type from provided data if not explicitly set
    let entityType = eventData.entityType;
    if (!entityType) {
      if (eventData.channelId) {
        entityType = 2; // Voice Channel Event
      } else if (eventData.location) {
        entityType = 3; // External Event
      } else {
        entityType = 3; // Default to External
      }
    }

    // Build the event payload for Discord API
    const payload: Record<string, any> = {
      name: eventData.name,
      privacy_level: 2, // Guild only
      scheduled_start_time: eventData.scheduledStartTime,
      entity_type: entityType,
    };

    // Add optional fields
    if (eventData.description) {
      payload.description = eventData.description;
    }
    if (eventData.scheduledEndTime) {
      payload.scheduled_end_time = eventData.scheduledEndTime;
    }
    if (eventData.channelId && entityType !== 3) {
      payload.channel_id = eventData.channelId;
    }
    // For external events (entityType 3), location AND scheduled_end_time are required
    if (entityType === 3) {
      payload.entity_metadata = { 
        location: eventData.location || eventData.entityMetadata?.location || "To be announced" 
      };
      // Discord requires end time for external events - default to 3 hours after start
      if (!payload.scheduled_end_time) {
        const startTime = new Date(eventData.scheduledStartTime);
        const endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000);
        payload.scheduled_end_time = endTime.toISOString();
      }
    }
    if (imageDataUri) {
      payload.image = imageDataUri;
    }

    log.info(`[MCP] Creating scheduled event in guild ${guildId}: ${eventData.name}`);

    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/scheduled-events`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bot ${this.discordBotToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.message || `HTTP ${response.status}`;
      log.error(`[MCP] Failed to create event: ${errorMsg}`, errorData);
      throw new Error(`Failed to create event: ${errorMsg}`);
    }

    const createdEvent = await response.json();
    log.info(`[MCP] Created event: ${createdEvent.name} (ID: ${createdEvent.id})`);

    return {
      id: createdEvent.id,
      name: createdEvent.name,
      description: createdEvent.description,
      scheduledStartTime: createdEvent.scheduled_start_time,
      scheduledEndTime: createdEvent.scheduled_end_time,
      entityType: createdEvent.entity_type,
      status: createdEvent.status,
    };
  }

  /**
   * Create multiple scheduled events from a text description
   * @param {string} guildId - The guild ID
   * @param {string} eventsText - Text containing multiple event descriptions
   * @param {string} [location] - Optional default location for external events
   * @param {number} [entityType] - Optional entity type (1=Stage, 2=Voice, 3=External)
   * @param {string} [channelId] - Optional channel ID for voice/stage events
   * @param {boolean} [generateImages] - Whether to generate AI images for each event
   * @param {Object} [env] - Environment variables for image generation
   * @returns {Promise<Object>} - Results of the batch creation
   */
  async createMultipleScheduledEvents(guildId, eventsText, location = null, entityType = null, channelId = null, generateImages = false, env: any = {}) {
    const parsedEvents = this.parseEventsFromText(eventsText);
    
    if (parsedEvents.length === 0) {
      return {
        success: false,
        error: "Could not parse any events from the provided text. Please use a format like:\n\nEvent Name\nMonth Day, Year · StartTime–EndTime AM/PM",
        created: [],
        failed: [],
      };
    }

    // Infer entity type from provided parameters if not explicitly set
    let effectiveEntityType = entityType;
    if (!effectiveEntityType) {
      if (channelId) {
        effectiveEntityType = 2; // Voice Channel Event
      } else if (location) {
        effectiveEntityType = 3; // External Event
      }
      // If still null, each event will infer its own type
    }

    log.info(`[MCP] Creating ${parsedEvents.length} scheduled events in guild ${guildId}${generateImages ? ' with AI images' : ''}`);

    const results = {
      success: true,
      created: [],
      failed: [],
      total: parsedEvents.length,
      imagesGenerated: 0,
    };

    for (const event of parsedEvents) {
      try {
        // Apply entity type if determined
        if (effectiveEntityType) {
          event.entityType = effectiveEntityType;
        }
        
        // Apply channel ID if provided (for voice/stage events)
        if (channelId) {
          event.channelId = channelId;
        }
        
        // Add default location if provided (for external events)
        if (location && !event.location) {
          event.location = location;
        }
        
        const created = await this.createScheduledEvent(guildId, event, {
          generateImage: generateImages,
          env,
        });
        results.created.push(created);
        
        if (generateImages) {
          results.imagesGenerated++;
        }
      } catch (error) {
        results.failed.push({
          name: event.name,
          error: error.message,
          scheduledStartTime: event.scheduledStartTime,
        });
        results.success = false;
      }
    }

    return results;
  }

  /**
   * Preview a single scheduled event without creating it
   * Returns the parsed event data for user confirmation
   * @param {string} guildId - The guild ID
   * @param {Object} eventData - Event data to preview
   * @returns {Object} - Preview of the event
   */
  previewScheduledEvent(guildId, eventData) {
    const entityTypeNames = {
      1: "Stage Channel Event",
      2: "Voice Channel Event", 
      3: "External Event",
    };
    
    const errors = [];
    
    // Validate required fields
    if (!eventData.name) {
      errors.push("Event name is required");
    }
    if (!eventData.scheduledStartTime) {
      errors.push("Start time is required");
    }
    
    // Infer entity type from provided data if not explicitly set
    let entityType = eventData.entityType;
    if (!entityType) {
      if (eventData.channelId) {
        entityType = 2; // Voice Channel Event
      } else if (eventData.location) {
        entityType = 3; // External Event
      } else {
        entityType = 3; // Default to External
      }
    }
    
    // Validate entity-type specific requirements
    if (entityType === 1 || entityType === 2) {
      if (!eventData.channelId) {
        errors.push(`Channel ID is required for ${entityTypeNames[entityType]}s`);
      }
    }
    if (entityType === 3 && !eventData.location) {
      errors.push("Location is required for External Events");
    }
    
    // Parse and format dates for display
    let startTimeFormatted = "Invalid date";
    let endTimeFormatted = null;
    
    try {
      const startDate = new Date(eventData.scheduledStartTime);
      if (!isNaN(startDate.getTime())) {
        startTimeFormatted = startDate.toLocaleString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        });
      }
      
      if (eventData.scheduledEndTime) {
        const endDate = new Date(eventData.scheduledEndTime);
        if (!isNaN(endDate.getTime())) {
          endTimeFormatted = endDate.toLocaleString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
          });
        }
      }
    } catch {
      errors.push("Invalid date format");
    }
    
    return {
      valid: errors.length === 0,
      errors,
      preview: {
        name: eventData.name || "(no name)",
        description: eventData.description || "(no description)",
        eventType: entityTypeNames[entityType] || "Unknown",
        entityType,
        startTime: startTimeFormatted,
        startTimeISO: eventData.scheduledStartTime,
        endTime: endTimeFormatted,
        endTimeISO: eventData.scheduledEndTime,
        location: entityType === 3 ? (eventData.location || "(no location)") : null,
        channelId: (entityType === 1 || entityType === 2) ? eventData.channelId : null,
        generateImage: eventData.generateImage || false,
      },
      guildId,
    };
  }

  /**
   * Preview multiple scheduled events without creating them
   * Returns parsed event data for user confirmation
   * @param {string} guildId - The guild ID
   * @param {string} eventsText - Text containing event descriptions
   * @param {string} [location] - Default location for external events
   * @param {number} [entityType] - Event type (1=Stage, 2=Voice, 3=External)
   * @param {string} [channelId] - Channel ID for voice/stage events
   * @param {boolean} [generateImages] - Whether to generate AI images
   * @returns {Object} - Preview of all events
   */
  previewMultipleScheduledEvents(guildId, eventsText, location = null, entityType = null, channelId = null, generateImages = false) {
    const parsedEvents = this.parseEventsFromText(eventsText);
    
    if (parsedEvents.length === 0) {
      return {
        valid: false,
        error: "Could not parse any events from the provided text. Please use a format like:\n\nEvent Name\nMonth Day, Year · StartTime–EndTime AM/PM",
        events: [],
        totalEvents: 0,
      };
    }

    const entityTypeNames = {
      1: "Stage Channel Event",
      2: "Voice Channel Event", 
      3: "External Event",
    };

    // If channelId is provided but no explicit entityType, default to Voice Channel (2)
    // If neither channelId nor entityType provided, and location is provided, use External (3)
    // If nothing provided, default to Voice (2) if channelId exists, otherwise External (3)
    let effectiveEntityType = entityType;
    if (!effectiveEntityType) {
      if (channelId) {
        effectiveEntityType = 2; // Voice Channel Event
      } else if (location) {
        effectiveEntityType = 3; // External Event
      } else {
        effectiveEntityType = 3; // Default to External if no hints
      }
    }
    
    const previews = [];
    const errors = [];

    // Validate entity-type specific requirements once
    if (effectiveEntityType === 1 || effectiveEntityType === 2) {
      if (!channelId) {
        errors.push(`Channel ID is required for ${entityTypeNames[effectiveEntityType]}s`);
      }
    }
    if (effectiveEntityType === 3 && !location) {
      errors.push("Default location is required for External Events");
    }

    for (const event of parsedEvents) {
      // Apply defaults
      const eventEntityType = entityType || event.entityType || 3;
      const eventLocation = event.location || location;
      const eventChannelId = channelId || event.channelId;
      
      // Parse and format dates for display
      let startTimeFormatted = "Invalid date";
      let endTimeFormatted = null;
      
      try {
        const startDate = new Date(event.scheduledStartTime);
        if (!isNaN(startDate.getTime())) {
          startTimeFormatted = startDate.toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });
        }
        
        if (event.scheduledEndTime) {
          const endDate = new Date(event.scheduledEndTime);
          if (!isNaN(endDate.getTime())) {
            endTimeFormatted = endDate.toLocaleString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            });
          }
        }
      } catch {
        // Keep default "Invalid date"
      }

      previews.push({
        name: event.name,
        startTime: startTimeFormatted,
        startTimeISO: event.scheduledStartTime,
        endTime: endTimeFormatted,
        endTimeISO: event.scheduledEndTime,
        eventType: entityTypeNames[eventEntityType],
        entityType: eventEntityType,
        location: eventEntityType === 3 ? eventLocation : null,
        channelId: (eventEntityType === 1 || eventEntityType === 2) ? eventChannelId : null,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      events: previews,
      totalEvents: previews.length,
      guildId,
      options: {
        location,
        entityType: effectiveEntityType,
        entityTypeName: entityTypeNames[effectiveEntityType],
        channelId,
        generateImages,
      },
    };
  }

  /**
   * Get scheduled events for a guild
   * @param {string} guildId - The guild ID
   * @param {Object} [options] - Filter options
   * @param {string} [options.nameFilter] - Filter events by name (case-insensitive partial match)
   * @param {boolean} [options.upcomingOnly] - Only return events that haven't started yet
   * @returns {Promise<Array>} - List of scheduled events
   */
  async getScheduledEvents(guildId, options: any = {}) {
    if (!this.discordBotToken) {
      throw new Error("Discord bot token not configured - cannot fetch events");
    }

    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/scheduled-events?with_user_count=true`,
      {
        headers: {
          "Authorization": `Bot ${this.discordBotToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch scheduled events: ${response.status}`);
    }

    let events = await response.json();
    
    // Map to our format
    events = events.map(event => ({
      id: event.id,
      name: event.name,
      description: event.description,
      scheduledStartTime: event.scheduled_start_time,
      scheduledEndTime: event.scheduled_end_time,
      entityType: event.entity_type,
      status: event.status,
      userCount: event.user_count,
      location: event.entity_metadata?.location,
      // Generate the event link
      eventLink: `https://discord.com/events/${guildId}/${event.id}`,
    }));
    
    // Filter by name if provided
    if (options.nameFilter) {
      const filter = options.nameFilter.toLowerCase();
      events = events.filter(e => 
        e.name.toLowerCase().includes(filter) ||
        (e.description && e.description.toLowerCase().includes(filter))
      );
    }
    
    // Filter to upcoming only if requested (status 1 = scheduled, 2 = active)
    if (options.upcomingOnly) {
      const now = new Date();
      events = events.filter(e => 
        e.status === 1 || e.status === 2 || new Date(e.scheduledStartTime) > now
      );
    }
    
    return events;
  }

  /**
   * Preview an automation without creating it
   * @param {string} guildId - The guild ID
   * @param {Object} automationData - Automation data to preview
   * @returns {Object} - Preview of the automation
   */
  previewAutomation(guildId, automationData) {
    const errors = [];

    if (!automationData.name) {
      errors.push("Automation name is required");
    }
    if (!automationData.trigger_events || automationData.trigger_events.length === 0) {
      errors.push("At least one trigger event is required");
    }
    if (!automationData.action_type) {
      errors.push("Action type is required");
    }
    if (!automationData.action_config || Object.keys(automationData.action_config).length === 0) {
      errors.push("Action config is required");
    }

    return {
      valid: errors.length === 0,
      errors,
      preview: {
        name: automationData.name || "(no name)",
        description: automationData.description || "(no description)",
        trigger_events: automationData.trigger_events || [],
        action_type: automationData.action_type || "(none)",
        action_config: automationData.action_config || {},
        enabled: automationData.enabled !== false,
      },
      guildId,
    };
  }

  /**
   * Create an automation in the D1 database
   * @param {string} guildId - The guild ID
   * @param {Object} automationData - Automation data
   * @param {string} [userId] - ID of the user creating the automation
   * @returns {Promise<Object>} - Created automation
   */
  async createAutomation(guildId, automationData, userId = null) {
    const triggerEvents = automationData.trigger_events || [];
    const primaryTrigger = triggerEvents[0] || null;

    // Generate a random public_id
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let publicId = '';
    for (let i = 0; i < 12; i++) {
      publicId += chars[Math.floor(Math.random() * chars.length)];
    }

    const sql = `INSERT INTO automations (
      guild_id, name, description, enabled,
      trigger_event, trigger_events, trigger_filters,
      action_type, action_config,
      created_by, public_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = [
      guildId,
      automationData.name,
      automationData.description || null,
      automationData.enabled !== false ? 1 : 0,
      primaryTrigger,
      JSON.stringify(triggerEvents),
      automationData.trigger_filters ? JSON.stringify(automationData.trigger_filters) : null,
      automationData.action_type,
      JSON.stringify(automationData.action_config || {}),
      userId || null,
      publicId,
    ];

    const result = await this.executeD1Query(sql, params);

    return {
      success: true,
      id: result.meta?.last_row_id,
      publicId,
      name: automationData.name,
      trigger_events: triggerEvents,
      action_type: automationData.action_type,
      enabled: automationData.enabled !== false,
    };
  }

  /**
   * Preview a command without creating it
   * @param {string} guildId - The guild ID
   * @param {Object} commandData - Command data to preview
   * @returns {Object} - Preview of the command
   */
  previewCommand(guildId, commandData) {
    const errors = [];

    if (!commandData.name) {
      errors.push("Command name is required");
    } else {
      const nameRegex = /^[\w-]{1,32}$/;
      if (!nameRegex.test(commandData.name)) {
        errors.push("Command name must be 1-32 characters, lowercase, alphanumeric or hyphens");
      }
    }
    if (!commandData.description) {
      errors.push("Command description is required");
    }

    return {
      valid: errors.length === 0,
      errors,
      preview: {
        name: commandData.name ? commandData.name.toLowerCase() : "(no name)",
        description: commandData.description || "(no description)",
        response_type: commandData.response_type || "message",
        response_content: commandData.response_content || null,
        action_type: commandData.action_type || "NONE",
        action_config: commandData.action_config || {},
        options: commandData.options || [],
        ephemeral: commandData.ephemeral || false,
        enabled: commandData.enabled !== false,
      },
      guildId,
    };
  }

  /**
   * Create a command in the D1 database
   * @param {string} guildId - The guild ID
   * @param {Object} commandData - Command data
   * @param {string} [userId] - ID of the user creating the command
   * @returns {Promise<Object>} - Created command
   */
  async createCommand(guildId, commandData, userId = null) {
    const sql = `INSERT INTO commands (
      guild_id, name, description, enabled,
      options, ephemeral, defer,
      action_type, action_config,
      response_type, response_content, response_embed,
      default_member_permissions, dm_permission,
      context_menu_user, require_voice,
      created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = [
      guildId,
      commandData.name.toLowerCase(),
      commandData.description || "No description",
      commandData.enabled !== false ? 1 : 0,
      commandData.options ? JSON.stringify(commandData.options) : null,
      commandData.ephemeral ? 1 : 0,
      commandData.defer ? 1 : 0,
      commandData.action_type || "NONE",
      JSON.stringify(commandData.action_config || {}),
      commandData.response_type || "message",
      commandData.response_content || null,
      commandData.response_embed ? JSON.stringify(commandData.response_embed) : null,
      commandData.default_member_permissions || null,
      0, // dm_permission
      commandData.context_menu_user ? 1 : 0,
      commandData.require_voice ? 1 : 0,
      userId || null,
    ];

    const result = await this.executeD1Query(sql, params);

    return {
      success: true,
      id: result.meta?.last_row_id,
      name: commandData.name.toLowerCase(),
      description: commandData.description,
      enabled: commandData.enabled !== false,
    };
  }

  /**
   * Sync guild commands with Discord after creating/modifying commands
   * @param {string} guildId - The guild ID
   * @param {Object} env - Environment variables
   * @returns {Promise<Object>} - Sync result
   */
  async syncGuildCommandsWithDiscord(guildId, env: any = {}) {
    const botToken = this.discordBotToken;
    const clientId = env.DISCORD_CLIENT_ID;

    if (!botToken || !clientId) {
      log.warn("[MCP] Cannot sync commands: missing bot token or client ID");
      return { success: false, error: "Bot configuration not available for command sync" };
    }

    // Fetch all enabled commands for this guild from D1
    const commandsResult = await this.executeD1Query(
      "SELECT * FROM commands WHERE guild_id = ? AND enabled = 1 AND is_built_in = 0 ORDER BY name ASC",
      [guildId]
    );

    // Also fetch enabled built-in commands
    const builtInResult = await this.executeD1Query(
      "SELECT * FROM commands WHERE is_built_in = 1 AND enabled = 1 ORDER BY name ASC"
    );

    // Convert to Discord command format
    const toDiscordFormat = (cmd) => {
      const discordCmd: Record<string, any> = {
        name: cmd.name,
        description: cmd.description || "No description",
        type: cmd.context_menu_user ? 2 : 1, // 2 = USER context menu, 1 = CHAT_INPUT
      };

      // Add options if present and it's a chat input command
      if (!cmd.context_menu_user && cmd.options) {
        const options = typeof cmd.options === 'string' ? JSON.parse(cmd.options) : cmd.options;
        if (options && options.length > 0) {
          discordCmd.options = options.map(opt => ({
            name: opt.name,
            description: opt.description || "No description",
            type: opt.type || 3,
            required: opt.required || false,
            choices: opt.choices || undefined,
          }));
        }
      }

      // Add permission restrictions
      if (cmd.default_member_permissions) {
        discordCmd.default_member_permissions = cmd.default_member_permissions;
      }

      return discordCmd;
    };

    const allCommands = [
      ...builtInResult.results.map(toDiscordFormat),
      ...commandsResult.results.map(toDiscordFormat),
    ];

    // Bulk-overwrite guild commands
    const url = `https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands`;
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bot ${botToken}`,
      },
      body: JSON.stringify(allCommands),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Discord command sync failed: ${response.status} - ${errorData.message || 'Unknown error'}`);
    }

    const registeredCommands = await response.json();
    log.info(`[MCP] Synced ${registeredCommands.length} commands with Discord for guild ${guildId}`);

    return {
      success: true,
      registeredCount: registeredCommands.length,
    };
  }

  /**
   * Execute a tool by name with the given arguments
   * This is the main entry point for AI tool calling
   */
  async executeTool(toolName, args: any = {}) {
    log.debug(`[MCP] Executing tool: ${toolName}`, args);

    try {
      switch (toolName) {
        case "list_guilds":
          return { success: true, data: await this.listGuilds() };

        case "get_event_logs":
          return { 
            success: true, 
            data: await this.getEventLogs(args.guildId, {
              limit: Math.min(args.limit || 20, 100),
              offset: args.offset || 0,
              category: args.category,
              eventType: args.eventType,
              since: args.since,
              until: args.until,
              actorId: args.actorId,
            })
          };

        case "get_voice_activity":
          return {
            success: true,
            data: await this.getVoiceActivity(args.guildId, {
              days: args.days || 7,
            })
          };

        case "get_activity_summary":
          return {
            success: true,
            data: await this.getActivitySummary(args.guildId, {
              days: args.days || 7,
            })
          };

        case "get_log_stats":
          return { success: true, data: await this.getLogStats(args.guildId) };

        case "get_automations":
          return { 
            success: true, 
            data: await this.getAutomations(args.guildId, {
              enabled: args.enabled, // true = active only, false = inactive only, undefined = all
              limit: args.limit || 20,
            })
          };

        case "get_automation": {
          const automation = await this.getAutomation(args.automationId, args.guildId);
          if (!automation) {
            return { success: false, error: "Automation not found" };
          }
          return { success: true, data: automation };
        }

        case "get_automation_logs":
          return { 
            success: true, 
            data: await this.getAutomationLogs(args.guildId, {
              automationId: args.automationId,
              limit: args.limit || 20,
            })
          };

        case "get_commands":
          return { 
            success: true, 
            data: await this.getCommands(args.guildId, {
              enabledOnly: args.enabledOnly || false,
              registeredOnly: args.registeredOnly || false,
              limit: args.limit || 20,
            })
          };

        case "get_command": {
          const command = await this.getCommand(args.commandId, args.guildId);
          if (!command) {
            return { success: false, error: "Command not found" };
          }
          return { success: true, data: command };
        }

        case "get_command_logs":
          return { 
            success: true, 
            data: await this.getCommandLogs(args.guildId, {
              commandId: args.commandId,
              limit: args.limit || 20,
            })
          };

        case "get_server_settings":
          return { success: true, data: await this.getGuildSettings(args.guildId) };

        case "get_server_stats":
          console.log("[MCP] get_server_stats called with guildId:", args.guildId);
          try {
            const stats = await this.getServerStats(args.guildId);
            console.log("[MCP] get_server_stats result:", stats);
            if (!stats) {
              return { success: false, error: "No statistics recorded for this server yet. Stats are recorded when the dashboard is viewed." };
            }
            return { success: true, data: stats };
          } catch (statsError) {
            console.error("[MCP] get_server_stats error:", statsError);
            return { success: false, error: statsError.message };
          }

        case "list_local_runners":
          return {
            success: true,
            data: await this.getLocalRunners(args.userId, {
              includeOffline: args.includeOffline !== false,
              tokenId: args.tokenId,
              limit: args.limit || 100,
            }),
          };

        case "get_local_runner_activity":
          return {
            success: true,
            data: await this.getLocalRunnerActivity(args.userId, {
              tokenId: args.tokenId,
              instanceId: args.instanceId,
              limit: args.limit || 20,
            }),
          };

        case "start_local_runner_task":
          return {
            success: true,
            data: await this.startLocalRunnerTask(args.userId, {
              command: args.command,
              workingDir: args.workingDir,
              label: args.label,
              tokenId: args.tokenId,
              instanceIds: args.instanceIds,
              instanceNames: args.instanceNames,
              targetMode: args.targetMode,
              priority: args.priority,
              maxAttempts: args.maxAttempts,
              timeoutSeconds: args.timeoutSeconds,
              capabilityRequirements: args.capabilityRequirements,
            }),
          };

        case "get_local_runner_job": {
          const job = await this.getLocalRunnerJob(args.userId, args.jobId);
          if (!job) return { success: false, error: "Job not found" };
          return { success: true, data: job };
        }

        case "cancel_local_runner_job": {
          const cancelResult = await this.cancelLocalRunnerJob(args.userId, args.jobId, args.reason ?? null);
          return cancelResult.success
            ? { success: true, data: cancelResult.job }
            : { success: false, error: cancelResult.error };
        }

        case "retry_local_runner_job": {
          const retryResult = await this.retryLocalRunnerJob(args.userId, args.jobId);
          return retryResult.success
            ? { success: true, data: retryResult.job }
            : { success: false, error: retryResult.error };
        }

        case "discover_vscode_instances": {
          return {
            success: true,
            data: await this.runTypedLocalRunnerJob(args.userId, {
              jobType: "vscode_discover_instances",
              payload: {
                bridgeUrl: args.bridgeUrl,
              },
              label: "Discover VS Code Instances",
              tokenId: args.tokenId,
              instanceId: args.instanceId,
              instanceName: args.instanceName,
              waitForResult: args.waitForResult !== false,
              waitSeconds: args.waitSeconds || 20,
              timeoutSeconds: args.timeoutSeconds || 90,
              capabilityRequirements: { vscodeControlAvailable: true },
            }),
          };
        }

        case "open_vscode_workspace": {
          return {
            success: true,
            data: await this.runTypedLocalRunnerJob(args.userId, {
              jobType: "vscode_open_workspace",
              payload: {
                path: args.path,
                newWindow: args.newWindow === true,
                bridgeUrl: args.bridgeUrl,
                instanceId: args.bridgeInstanceId,
              },
              label: "Open VS Code Workspace",
              tokenId: args.tokenId,
              instanceId: args.instanceId,
              instanceName: args.instanceName,
              waitForResult: args.waitForResult !== false,
              waitSeconds: args.waitSeconds || 30,
              timeoutSeconds: args.timeoutSeconds || 120,
              capabilityRequirements: { vscodeControlAvailable: true },
            }),
          };
        }

        case "send_vscode_copilot_message": {
          return {
            success: true,
            data: await this.runTypedLocalRunnerJob(args.userId, {
              jobType: "vscode_send_copilot_message",
              payload: {
                message: args.message,
                bridgeUrl: args.bridgeUrl,
                instanceId: args.bridgeInstanceId,
                conversationKey: args.conversationKey,
                includeResponse: args.includeResponse !== false,
                timeoutMs: args.requestTimeoutMs,
                mirrorToChat: args.mirrorToChat !== false,
              },
              label: "Send VS Code Copilot Message",
              tokenId: args.tokenId,
              instanceId: args.instanceId,
              instanceName: args.instanceName,
              waitForResult: args.waitForResult !== false,
              waitSeconds: args.waitSeconds || 60,
              timeoutSeconds: args.timeoutSeconds || 180,
              capabilityRequirements: {
                vscodeControlAvailable: true,
                copilotMessageAvailable: true,
              },
            }),
          };
        }

        case "get_user_roles":
          return {
            success: true,
            data: await this.getUserRoles(args.guildId, args.userId),
          };

        case "get_members_with_role":
          return {
            success: true,
            data: await this.getMembersWithRole(args.guildId, args.roleName, args.limit || 100, this.d1Database),
          };

        case "get_voice_and_stage_channels":
          return {
            success: true,
            data: await this.getVoiceAndStageChannels(args.guildId),
          };

        case "get_text_channels":
          return {
            success: true,
            data: await this.getTextChannels(args.guildId, args.nameFilter),
          };

        case "send_channel_message":
          return {
            success: true,
            data: await this.sendChannelMessage(
              args.guildId,
              args.channelId,
              args.content,
              {
                embed: args.embed,
                embedTitle: args.embedTitle,
                embedColor: args.embedColor,
              }
            ),
          };

        case "get_scheduled_events":
          return {
            success: true,
            data: await this.getScheduledEvents(args.guildId, {
              nameFilter: args.nameFilter,
              upcomingOnly: args.upcomingOnly,
            }),
          };

        case "create_scheduled_event":
          return {
            success: true,
            data: await this.createScheduledEvent(args.guildId, {
              name: args.name,
              description: args.description,
              scheduledStartTime: args.scheduledStartTime,
              scheduledEndTime: args.scheduledEndTime,
              entityType: args.entityType || 3,
              location: args.location,
              channelId: args.channelId,
            }, {
              generateImage: args.generateImage,
              env: args._env, // Internal: passed from chat.js
            }),
          };

        case "create_multiple_scheduled_events":
          return {
            success: true,
            data: await this.createMultipleScheduledEvents(
              args.guildId,
              args.eventsText,
              args.location,
              args.entityType,
              args.channelId,
              args.generateImages,
              args._env // Internal: passed from chat.js
            ),
          };

        case "preview_scheduled_event":
          return {
            success: true,
            data: this.previewScheduledEvent(args.guildId, {
              name: args.name,
              description: args.description,
              scheduledStartTime: args.scheduledStartTime,
              scheduledEndTime: args.scheduledEndTime,
              entityType: args.entityType || 3,
              location: args.location,
              channelId: args.channelId,
              generateImage: args.generateImage,
            }),
            // Flag to indicate this needs user confirmation
            requiresConfirmation: true,
            confirmationTool: "confirm_scheduled_event",
          };

        case "preview_multiple_scheduled_events":
          return {
            success: true,
            data: this.previewMultipleScheduledEvents(
              args.guildId,
              args.eventsText,
              args.location,
              args.entityType,
              args.channelId,
              args.generateImages
            ),
            // Flag to indicate this needs user confirmation
            requiresConfirmation: true,
            confirmationTool: "confirm_multiple_scheduled_events",
          };

        case "confirm_scheduled_event":
          // This is called after the user confirms the preview
          // The args should contain the full event data from the preview
          return {
            success: true,
            data: await this.createScheduledEvent(args.guildId, {
              name: args.name,
              description: args.description,
              scheduledStartTime: args.scheduledStartTime,
              scheduledEndTime: args.scheduledEndTime,
              entityType: args.entityType || 3,
              location: args.location,
              channelId: args.channelId,
            }, {
              generateImage: args.generateImage,
              env: args._env,
            }),
          };

        case "confirm_multiple_scheduled_events":
          // This is called after the user confirms the preview
          return {
            success: true,
            data: await this.createMultipleScheduledEvents(
              args.guildId,
              args.eventsText,
              args.location,
              args.entityType,
              args.channelId,
              args.generateImages,
              args._env
            ),
          };

        case "preview_automation":
          return {
            success: true,
            data: this.previewAutomation(args.guildId, {
              name: args.name,
              description: args.description,
              trigger_events: args.trigger_events,
              action_type: args.action_type,
              action_config: args.action_config,
              trigger_filters: args.trigger_filters,
              enabled: args.enabled,
            }),
            requiresConfirmation: true,
            confirmationTool: "confirm_automation",
          };

        case "confirm_automation":
          return {
            success: true,
            data: await this.createAutomation(args.guildId, {
              name: args.name,
              description: args.description,
              trigger_events: args.trigger_events,
              action_type: args.action_type,
              action_config: args.action_config,
              trigger_filters: args.trigger_filters,
              enabled: args.enabled,
            }, args.userId),
          };

        case "preview_command":
          return {
            success: true,
            data: this.previewCommand(args.guildId, {
              name: args.name,
              description: args.description,
              response_type: args.response_type,
              response_content: args.response_content,
              response_embed: args.response_embed,
              action_type: args.action_type,
              action_config: args.action_config,
              options: args.options,
              ephemeral: args.ephemeral,
              default_member_permissions: args.default_member_permissions,
              enabled: args.enabled,
            }),
            requiresConfirmation: true,
            confirmationTool: "confirm_command",
          };

        case "confirm_command": {
          const createResult: any = await this.createCommand(args.guildId, {
            name: args.name,
            description: args.description,
            response_type: args.response_type,
            response_content: args.response_content,
            response_embed: args.response_embed,
            action_type: args.action_type,
            action_config: args.action_config,
            options: args.options,
            ephemeral: args.ephemeral,
            default_member_permissions: args.default_member_permissions,
            context_menu_user: args.context_menu_user,
            require_voice: args.require_voice,
            enabled: args.enabled,
          }, args.userId);

          // Auto-sync commands with Discord
          try {
            await this.syncGuildCommandsWithDiscord(args.guildId, args._env || {});
            createResult.synced = true;
          } catch (syncError) {
            log.warn(`[MCP] Command created but sync failed: ${syncError.message}`);
            createResult.synced = false;
            createResult.syncError = syncError.message;
          }

          return { success: true, data: createResult };
        }

        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      log.error(`[MCP] Tool execution error:`, error.message);
      return { success: false, error: error.message };
    }
  }
}

/**
 * Tool definitions for AI function calling
 * These match the MCP tools but are formatted for Cloudflare/OpenAI function calling
 */
export const MCP_TOOLS = [
  {
    name: "list_guilds",
    description: "List all Discord server IDs that have data in SpaceBot. Use this first to see which servers have data.",
  },
  {
    name: "get_event_logs",
    description: "Get event logs for a Discord server. Shows message creates, member joins, voice activity, role changes, etc. Supports date filtering.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      limit: "number (optional) - Max logs to return (default: 20, max: 100)",
      category: "string (optional) - Filter by category: message, member, role, channel, guild, voice, reaction, etc.",
      eventType: "string (optional) - Filter by event type: MESSAGE_CREATE, MEMBER_JOIN, VOICE_JOIN, VOICE_LEAVE, etc.",
      since: "string (optional) - ISO date string to filter events after this date (e.g., '2026-02-01T00:00:00Z')",
      until: "string (optional) - ISO date string to filter events before this date",
      actorId: "string (optional) - Filter by a specific user ID",
    },
  },
  {
    name: "get_voice_activity",
    description: "Get voice chat activity statistics for a server over a time period. Shows total voice hours, total voice joins, unique users, top voice users by time spent and by joins, and most popular voice channels. Use days=1 for today's stats.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      days: "number (optional) - Number of days to look back (default: 7). Use 1 for today.",
    },
  },
  {
    name: "get_activity_summary",
    description: "Get a comprehensive activity summary for a server. Shows message counts, member joins/leaves, voice activity, reactions, top active members, and most active channels over a time period.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      days: "number (optional) - Number of days to look back (default: 7)",
    },
  },
  {
    name: "get_log_stats",
    description: "Get event log statistics for a server - total events and breakdown by category",
    parameters: {
      guildId: "string (required) - The Discord server ID",
    },
  },
  {
    name: "get_automations",
    description: "Get automations configured for a Discord server. Can filter by active/inactive status.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      enabled: "boolean (optional) - Filter by status: true = active/enabled only, false = inactive/disabled only, omit for all automations",
      limit: "number (optional) - Max automations to return (default: 20)",
    },
  },
  {
    name: "get_automation",
    description: "Get details of a specific automation by ID",
    parameters: {
      automationId: "number (required) - The automation ID",
      guildId: "string (required) - The Discord server ID",
    },
  },
  {
    name: "get_automation_logs",
    description: "Get execution logs for automations - when they triggered and results",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      automationId: "number (optional) - Filter by specific automation",
      limit: "number (optional) - Max logs to return (default: 20)",
    },
  },
  {
    name: "get_commands",
    description: "Get all custom slash commands configured for a Discord server",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      enabledOnly: "boolean (optional) - Only return enabled commands",
      registeredOnly: "boolean (optional) - Only return Discord-registered commands",
      limit: "number (optional) - Max commands to return (default: 20)",
    },
  },
  {
    name: "get_command",
    description: "Get details of a specific command by ID",
    parameters: {
      commandId: "number (required) - The command ID",
      guildId: "string (required) - The Discord server ID",
    },
  },
  {
    name: "get_command_logs",
    description: "Get usage logs for commands - when they were used and results",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      commandId: "number (optional) - Filter by specific command",
      limit: "number (optional) - Max logs to return (default: 20)",
    },
  },
  {
    name: "get_server_settings",
    description: "Get settings/configuration for a Discord server",
    parameters: {
      guildId: "string (required) - The Discord server ID",
    },
  },
  {
    name: "get_server_stats",
    description: "Get server statistics including member count, bot count, channel count, boost level, etc. Use this to answer questions about server size or member counts.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
    },
  },
  {
    name: "list_local_runners",
    description: "List the user's known local runner systems across all computers/servers where the runner has connected before. Returns online/offline state, token grouping, host/platform details, and pending/running job counts.",
    parameters: {
      userId: "string (required) - Discord user ID owning the runner systems. This is injected automatically in DMs.",
      tokenId: "number (optional) - Restrict results to a specific runner token",
      includeOffline: "boolean (optional) - Include offline systems as well as online ones (default: true)",
      limit: "number (optional) - Maximum systems to return (default: 100)",
    },
  },
  {
    name: "get_local_runner_activity",
    description: "Get current local runner activity for the DM user: known systems, pending/running jobs, and recent runner events like connects, disconnects, job starts, and job completions/failures.",
    parameters: {
      userId: "string (required) - Discord user ID owning the runner systems. This is injected automatically in DMs.",
      tokenId: "number (optional) - Restrict to a specific runner token",
      instanceId: "number (optional) - Restrict to one concrete runner system",
      limit: "number (optional) - Maximum events/jobs to return (default: 20)",
    },
  },
  {
    name: "start_local_runner_task",
    description: "Queue a shell command to run on one or more known local runner systems owned by the DM user. Use list_local_runners first to discover exact systems. This tool queues per-system jobs so offline systems can pick them up later when they reconnect.",
    parameters: {
      userId: "string (required) - Discord user ID owning the runner systems. This is injected automatically in DMs.",
      command: "string (required) - Shell command to execute on the target systems",
      label: "string (optional) - Human-readable label for the queued task",
      workingDir: "string (optional) - Working directory override for the command",
      tokenId: "number (optional) - Limit targeting to systems under one runner token",
      instanceIds: "number[] (optional) - Exact runner system IDs to target",
      instanceNames: "string[] (optional) - System names/hostnames to match case-insensitively",
      targetMode: "string (optional) - 'selected' (default), 'all-online', or 'all-known'",
      priority: "number (optional) - Queue priority from -100 to 100 (higher runs sooner, default: 0)",
      maxAttempts: "number (optional) - Retry budget per queued job (default: 5, max: 20)",
      timeoutSeconds: "number (optional) - Per-attempt timeout in seconds (default: 300, range: 30-3600)",
      capabilityRequirements: "object (optional) - Required runner capability flags, e.g. { screenshotAvailable: true }",
    },
  },
  {
    name: "get_local_runner_job",
    description: "Get full details (including command output, exit code, status, target system, timestamps) for a single local runner job owned by the DM user. Use this to follow up on a job started with start_local_runner_task, to inspect failures, or before deciding whether to cancel/retry.",
    parameters: {
      userId: "string (required) - Discord user ID owning the job. Injected automatically in DMs.",
      jobId: "number (required) - The local runner job ID to inspect.",
    },
  },
  {
    name: "cancel_local_runner_job",
    description: "Cancel a pending or running local runner job owned by the DM user. Use when the user asks to 'stop', 'cancel', 'kill', or 'abort' a task. Only works on jobs in 'pending' or 'running' state.",
    parameters: {
      userId: "string (required) - Discord user ID owning the job. Injected automatically in DMs.",
      jobId: "number (required) - The local runner job ID to cancel.",
      reason: "string (optional) - Short human-readable reason recorded with the cancellation.",
    },
  },
  {
    name: "retry_local_runner_job",
    description: "Re-queue a failed or canceled local runner job so the owning runner system will pick it up again. The original command, working directory, target system, and limits are preserved.",
    parameters: {
      userId: "string (required) - Discord user ID owning the job. Injected automatically in DMs.",
      jobId: "number (required) - The local runner job ID to retry.",
    },
  },
  {
    name: "discover_vscode_instances",
    description: "Ask a local runner workstation to detect open VS Code windows/instances and return rich discovery details including bridge endpoints and workspace folders.",
    parameters: {
      userId: "string (required) - Discord user ID owning the runner systems. Injected automatically in DMs.",
      tokenId: "number (optional) - Restrict target selection to a specific runner token",
      instanceId: "number (optional) - Target a specific runner system ID",
      instanceName: "string (optional) - Target by runner display name or hostname",
      waitForResult: "boolean (optional) - Wait for job completion (default: true)",
      waitSeconds: "number (optional) - How long to wait for completion when waitForResult is true (default: 20)",
      timeoutSeconds: "number (optional) - Runner execution timeout for this typed job (default: 90)",
    },
  },
  {
    name: "open_vscode_workspace",
    description: "Open a folder/workspace path in VS Code on a target local runner system. Can open in a new VS Code window for creating a fresh instance.",
    parameters: {
      userId: "string (required) - Discord user ID owning the runner systems. Injected automatically in DMs.",
      path: "string (required) - Absolute workspace or folder path on the runner machine",
      newWindow: "boolean (optional) - Open in a new VS Code window/instance (default: false)",
      tokenId: "number (optional) - Restrict target selection to a specific runner token",
      instanceId: "number (optional) - Target a specific runner system ID",
      instanceName: "string (optional) - Target by runner display name or hostname",
      bridgeUrl: "string (optional) - Specific VS Code bridge URL to target when multiple windows are open",
      bridgeInstanceId: "string (optional) - Specific VS Code bridge-reported instanceId to target",
      waitForResult: "boolean (optional) - Wait for completion (default: true)",
      waitSeconds: "number (optional) - Wait timeout in seconds (default: 30)",
      timeoutSeconds: "number (optional) - Runner execution timeout in seconds (default: 120)",
    },
  },
  {
    name: "send_vscode_copilot_message",
    description: "Send a prompt into Copilot Chat in VS Code from DM, optionally wait for a response, and keep prompts mirrored in normal VS Code chat UI.",
    parameters: {
      userId: "string (required) - Discord user ID owning the runner systems. Injected automatically in DMs.",
      message: "string (required) - Prompt text to send",
      includeResponse: "boolean (optional) - Return model response text in the tool result (default: true)",
      conversationKey: "string (optional) - Conversation key to keep context across messages",
      mirrorToChat: "boolean (optional) - Mirror prompt into Copilot Chat UI (default: true)",
      requestTimeoutMs: "number (optional) - Timeout for the local model request in milliseconds",
      tokenId: "number (optional) - Restrict target selection to a specific runner token",
      instanceId: "number (optional) - Target a specific runner system ID",
      instanceName: "string (optional) - Target by runner display name or hostname",
      bridgeUrl: "string (optional) - Specific VS Code bridge URL to target",
      bridgeInstanceId: "string (optional) - Specific VS Code bridge-reported instanceId to target",
      waitForResult: "boolean (optional) - Wait for completion (default: true)",
      waitSeconds: "number (optional) - Wait timeout in seconds (default: 60)",
      timeoutSeconds: "number (optional) - Runner execution timeout in seconds (default: 180)",
    },
  },
  {
    name: "get_user_roles",
    description: "Get a user's roles in a specific Discord server. Returns the user's display name, join date, and all their roles with details like role name, color, and position. Useful for checking what roles a user has.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      userId: "string (required) - The Discord user ID to look up",
    },
  },
  {
    name: "get_members_with_role",
    description: "Get all members who have a specific role in a Discord server. Use this when asked 'who has the X role?' or 'list members with Y role'. Can search by role name (case-insensitive partial match) or role ID. Returns the list of members with their display names.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      roleName: "string (required) - The role name to search for (case-insensitive, supports partial matching like 'crew' for 'Crew') or the exact role ID",
      limit: "number (optional) - Maximum members to return (default: 100, max: 1000)",
    },
  },
  {
    name: "get_voice_and_stage_channels",
    description: "Get all voice and stage channels in a Discord server. Use this BEFORE creating voice or stage events to find the correct channel ID. Returns a list of voice channels and stage channels with their IDs and names.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
    },
  },
  {
    name: "get_text_channels",
    description: "Get text channels in a Discord server. Use this to find the channel ID for a text channel by name (like #announcements, #general). Supports partial name matching.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      nameFilter: "string (optional) - Filter channels by name (case-insensitive partial match). For example, 'announce' will match 'announcements'.",
    },
  },
  {
    name: "send_channel_message",
    description: "Send a message to a text channel in a Discord server. Use this to post messages to channels like #announcements. First use get_text_channels to find the channel ID if you only have the channel name.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      channelId: "string (required) - The ID of the channel to send the message to",
      content: "string (required) - The message content to send. Can include Discord markdown and links.",
      embed: "boolean (optional) - Set to true to send as an embed instead of plain text",
      embedTitle: "string (optional) - Title for the embed (only used if embed=true)",
      embedColor: "number (optional) - Embed color as integer (default: 0x5865F2 / Discord blue)",
    },
  },
  {
    name: "get_scheduled_events",
    description: "Get scheduled events for a Discord server. Returns events with their names, times, locations, RSVP counts, and shareable EVENT LINKS. Use nameFilter to search for specific events (e.g., 'hockey' to find all hockey events). The eventLink property contains a shareable Discord URL for each event.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      nameFilter: "string (optional) - Filter events by name/description (case-insensitive partial match). For example, 'hockey' will match 'Men's Ice Hockey Final'.",
      upcomingOnly: "boolean (optional) - Set to true to only return upcoming/active events (excludes completed events)",
    },
  },
  {
    name: "create_scheduled_event",
    description: "Create a single scheduled event in a Discord server. There are 3 event types: (1) Stage events happen in a stage channel, (2) Voice events happen in a voice channel, (3) External events happen at a location/URL outside Discord. For Stage/Voice events, you MUST provide a channelId - use get_voice_and_stage_channels first to find available channels. Can optionally generate an AI image for the event banner.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      name: "string (required) - The name of the event",
      scheduledStartTime: "string (required) - ISO 8601 date/time when the event starts (e.g., '2026-02-14T21:10:00.000Z')",
      scheduledEndTime: "string (optional) - ISO 8601 date/time when the event ends",
      description: "string (optional) - Description of the event",
      entityType: "number (required) - Event type: 1=Stage (in stage channel), 2=Voice (in voice channel), 3=External (location/URL)",
      channelId: "string (conditional) - Voice/Stage channel ID - REQUIRED for entityType 1 or 2. Use get_voice_and_stage_channels to find channel IDs.",
      location: "string (conditional) - Location or URL - REQUIRED for entityType 3 (external events)",
      generateImage: "boolean (optional) - Set to true to auto-generate an AI image for the event banner based on the event name",
    },
  },
  {
    name: "create_multiple_scheduled_events",
    description: "Create multiple scheduled events from a text description. The text should contain event names and dates in a natural format, separated by blank lines. Supports formats like 'Event Name\\nFeb 14, 2026 · 9:10–11:30 PM'. All events will be created with the same type (external, voice, or stage). For Voice/Stage events, get the channel ID first using get_voice_and_stage_channels. Can optionally generate AI images for each event.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      eventsText: "string (required) - Text containing multiple event descriptions, separated by blank lines",
      entityType: "number (optional) - Event type for ALL events: 1=Stage, 2=Voice, 3=External (default: 3)",
      channelId: "string (conditional) - Voice/Stage channel ID - REQUIRED if entityType is 1 or 2",
      location: "string (conditional) - Default location for external events - REQUIRED if entityType is 3",
      generateImages: "boolean (optional) - Set to true to auto-generate AI images for each event banner based on their names",
    },
  },
  // Preview tools - ALWAYS use these first before creating events
  {
    name: "preview_scheduled_event",
    description: "**ALWAYS USE THIS FIRST** before creating a scheduled event. Shows the user what event will be created and asks for confirmation. Returns a preview of the event with parsed dates and validation errors if any. The user must confirm before the event is actually created.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      name: "string (required) - The name of the event",
      scheduledStartTime: "string (required) - ISO 8601 date/time when the event starts (e.g., '2026-02-14T21:10:00.000Z')",
      scheduledEndTime: "string (optional) - ISO 8601 date/time when the event ends",
      description: "string (optional) - Description of the event",
      entityType: "number (required) - Event type: 1=Stage, 2=Voice, 3=External",
      channelId: "string (conditional) - Voice/Stage channel ID - REQUIRED for entityType 1 or 2",
      location: "string (conditional) - Location or URL - REQUIRED for entityType 3",
      generateImage: "boolean (optional) - Set to true to auto-generate an AI image",
    },
  },
  {
    name: "preview_multiple_scheduled_events",
    description: "**ALWAYS USE THIS FIRST** before creating multiple scheduled events. Parses event text and shows the user ALL events that will be created with their dates and times. Returns a list of all parsed events for user review. The user must confirm before events are actually created.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      eventsText: "string (required) - Text containing multiple event descriptions, separated by blank lines",
      entityType: "number (optional) - Event type for ALL events: 1=Stage, 2=Voice, 3=External (default: 3)",
      channelId: "string (conditional) - Voice/Stage channel ID - REQUIRED if entityType is 1 or 2",
      location: "string (conditional) - Default location for external events - REQUIRED if entityType is 3",
      generateImages: "boolean (optional) - Set to true to auto-generate AI images",
    },
  },
  // Confirmation tools - use after user confirms the preview
  {
    name: "confirm_scheduled_event",
    description: "Create a scheduled event AFTER the user has reviewed and confirmed the preview. Only use this after showing the preview and receiving user confirmation.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      name: "string (required) - The name of the event",
      scheduledStartTime: "string (required) - ISO 8601 date/time when the event starts",
      scheduledEndTime: "string (optional) - ISO 8601 date/time when the event ends",
      description: "string (optional) - Description of the event",
      entityType: "number (required) - Event type: 1=Stage, 2=Voice, 3=External",
      channelId: "string (conditional) - Voice/Stage channel ID - REQUIRED for entityType 1 or 2",
      location: "string (conditional) - Location or URL - REQUIRED for entityType 3",
      generateImage: "boolean (optional) - Set to true to auto-generate an AI image",
    },
  },
  {
    name: "confirm_multiple_scheduled_events",
    description: "Create multiple scheduled events AFTER the user has reviewed and confirmed the preview. Only use this after showing the preview and receiving user confirmation.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      eventsText: "string (required) - Text containing multiple event descriptions",
      entityType: "number (optional) - Event type for ALL events: 1=Stage, 2=Voice, 3=External (default: 3)",
      channelId: "string (conditional) - Voice/Stage channel ID - REQUIRED if entityType is 1 or 2",
      location: "string (conditional) - Default location for external events - REQUIRED if entityType is 3",
      generateImages: "boolean (optional) - Set to true to auto-generate AI images",
    },
  },
  // Automation creation tools - ALWAYS preview first
  {
    name: "preview_automation",
    description: "**ALWAYS USE THIS FIRST** before creating an automation. Shows the user what automation will be created and asks for confirmation. Returns a preview with validation errors if any. The user must confirm before the automation is actually created.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      name: "string (required) - Name for the automation",
      description: "string (optional) - Description of what the automation does",
      trigger_events: "string[] (required) - Array of event types that trigger this automation. Valid events: MEMBER_JOIN, MEMBER_LEAVE, MEMBER_BAN, MEMBER_UNBAN, MEMBER_KICK, MEMBER_TIMEOUT, MESSAGE_CREATE, MESSAGE_UPDATE, MESSAGE_DELETE, VOICE_JOIN, VOICE_LEAVE, VOICE_MOVE, REACTION_ADD, REACTION_REMOVE, ROLE_CREATE, ROLE_UPDATE, ROLE_DELETE, CHANNEL_CREATE, CHANNEL_UPDATE, CHANNEL_DELETE, INVITE_CREATE, INVITE_DELETE, COMMAND_USED, VOICE_SERVER_MUTE, VOICE_SERVER_UNMUTE, VOICE_SERVER_DEAFEN, VOICE_SERVER_UNDEAFEN, VOICE_STREAM_START, VOICE_STREAM_STOP",
      action_type: "string (required) - The action to perform. Valid types: SEND_MESSAGE, SEND_DM, ADD_ROLE, REMOVE_ROLE, KICK_MEMBER, BAN_MEMBER, TIMEOUT_MEMBER, LOG_TO_CHANNEL, CREATE_THREAD, ADD_REACTION, SERVER_MUTE, SERVER_UNMUTE, SERVER_DEAFEN, SERVER_UNDEAFEN, DELETE_USER_MESSAGES, DELETE_MESSAGES, CALL_WEBHOOK",
      action_config: "object (required) - Configuration for the action. Structure depends on action_type. For SEND_MESSAGE: {channel_id, content}. For SEND_DM: {target_user, content}. For ADD_ROLE/REMOVE_ROLE: {target_user, role_id}. For LOG_TO_CHANNEL: {channel_id, content}. For KICK_MEMBER/BAN_MEMBER: {target_user, reason}. For TIMEOUT_MEMBER: {target_user, duration_minutes}. For ADD_REACTION: {emoji}. Use 'actor' for target_user to target the user who triggered the event.",
      trigger_filters: "object (optional) - Conditions that must be met. Example: {channel_id: '123'} to only trigger in a specific channel, {actor_has_role: 'roleId'} to only trigger for users with a role",
      enabled: "boolean (optional) - Whether to enable the automation (default: true)",
    },
  },
  {
    name: "confirm_automation",
    description: "Create an automation AFTER the user has reviewed and confirmed the preview. Only use this after showing the preview and receiving user confirmation.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      name: "string (required) - Name for the automation",
      description: "string (optional) - Description of what the automation does",
      trigger_events: "string[] (required) - Array of trigger event types",
      action_type: "string (required) - The action to perform",
      action_config: "object (required) - Configuration for the action",
      trigger_filters: "object (optional) - Conditions that must be met",
      enabled: "boolean (optional) - Whether to enable the automation (default: true)",
      userId: "string (optional) - Discord user ID of the creator",
    },
  },
  // Command creation tools - ALWAYS preview first
  {
    name: "preview_command",
    description: "**ALWAYS USE THIS FIRST** before creating a slash command. Shows the user what command will be created and asks for confirmation. Returns a preview with validation errors if any. The user must confirm before the command is actually created and synced to Discord.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      name: "string (required) - Command name (lowercase, 1-32 chars, alphanumeric/hyphens only, no spaces). Example: 'hello', 'server-info', 'give-role'",
      description: "string (required) - Short description shown in Discord's command menu (max 100 chars)",
      response_type: "string (optional) - How the bot responds: 'message' (plain text), 'embed' (rich embed), 'action_only' (no visible response, just runs the action). Default: 'message'",
      response_content: "string (optional) - The response message template. Can use template variables: {user.name}, {user.mention}, {guild.name}, {channel.name}, {option.<name>} for option values",
      response_embed: "object (optional) - Embed configuration for response_type='embed'. Example: {title: 'Hello!', description: 'Welcome {user.mention}', color: '#5865F2'}",
      action_type: "string (optional) - Action to perform when command is used. Same types as automations: SEND_MESSAGE, SEND_DM, ADD_ROLE, REMOVE_ROLE, KICK_MEMBER, BAN_MEMBER, TIMEOUT_MEMBER, LOG_TO_CHANNEL, etc. Default: 'NONE'",
      action_config: "object (optional) - Configuration for the action (same structure as automation action_config)",
      options: "array (optional) - Slash command parameters/options. Each option: {name: 'string', description: 'string', type: number, required: boolean, choices?: [{name, value}]}. Types: 3=Text, 4=Integer, 5=Boolean, 6=User, 7=Channel, 8=Role, 10=Number",
      ephemeral: "boolean (optional) - If true, response is only visible to the user who ran the command (default: false)",
      default_member_permissions: "string (optional) - Discord permission bitfield to restrict who can use the command. '8' = Admin only, '32' = Manage Server, null = everyone",
      enabled: "boolean (optional) - Whether to enable the command (default: true)",
    },
  },
  {
    name: "confirm_command",
    description: "Create a slash command AFTER the user has reviewed and confirmed the preview. Only use this after showing the preview and receiving user confirmation. The command will be auto-synced to Discord so it appears in the / menu.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      name: "string (required) - Command name (lowercase, alphanumeric/hyphens)",
      description: "string (required) - Command description",
      response_type: "string (optional) - 'message', 'embed', or 'action_only'. Default: 'message'",
      response_content: "string (optional) - Response template text",
      response_embed: "object (optional) - Embed configuration",
      action_type: "string (optional) - Action to perform. Default: 'NONE'",
      action_config: "object (optional) - Action configuration",
      options: "array (optional) - Slash command options/parameters",
      ephemeral: "boolean (optional) - Only visible to command user",
      default_member_permissions: "string (optional) - Permission restriction",
      enabled: "boolean (optional) - Whether to enable (default: true)",
      userId: "string (optional) - Discord user ID of the creator",
    },
  },
];

/**
 * Format tool definitions for the AI system prompt
 */
export function formatToolsForPrompt() {
  let prompt = "You have access to database tools. You MUST use these tools to get any server-specific data.\n\n";
  prompt += "**BEFORE you can tell the user ANY statistics, counts, automations, commands, logs, or settings, you MUST call a tool first.**\n\n";
  
  // Add critical instruction about preview workflow for scheduled events
  prompt += `## ⚠️ SCHEDULED EVENT WORKFLOW - PREVIEW FIRST!\n\n`;
  prompt += `**IMPORTANT:** When creating scheduled events, you MUST follow this workflow:\n\n`;
  prompt += `1. **If user mentions a voice/stage channel by NAME:** First call \`get_voice_and_stage_channels\` to get the channel ID. DO NOT explain - just call the tool.\n`;
  prompt += `2. **ALWAYS use preview tools:** Use \`preview_scheduled_event\` or \`preview_multiple_scheduled_events\` FIRST.\n`;
  prompt += `3. **Show the preview:** Display the parsed event details clearly to the user (names, dates, times, location).\n`;
  prompt += `4. **Ask for confirmation:** Ask "Does this look correct? Say 'yes' or 'confirm' to create these events, or tell me what to change."\n`;
  prompt += `5. **Wait for user response:** Do NOT create events until the user explicitly confirms.\n`;
  prompt += `6. **Create after confirmation:** Only after user says "yes", "confirm", "looks good", etc., use \`confirm_scheduled_event\` or \`confirm_multiple_scheduled_events\`.\n\n`;
  prompt += `**NEVER use create_scheduled_event or create_multiple_scheduled_events directly.** Always preview first!\n\n`;
  
  // Add automation creation workflow
  prompt += `## ⚠️ AUTOMATION CREATION WORKFLOW - PREVIEW FIRST!\n\n`;
  prompt += `**IMPORTANT:** When creating automations, follow this workflow:\n\n`;
  prompt += `1. **If user mentions a channel or role by NAME:** First call \`get_text_channels\` or \`get_members_with_role\` to resolve the ID. DO NOT explain - just call the tool.\n`;
  prompt += `2. **ALWAYS use preview_automation first:** Show the user what will be created.\n`;
  prompt += `3. **Show the preview:** Display the automation name, trigger events, action type, and config clearly.\n`;
  prompt += `4. **Ask for confirmation:** Ask "Does this look correct? Say 'yes' to create it, or tell me what to change."\n`;
  prompt += `5. **Create after confirmation:** Only after user confirms, use \`confirm_automation\`.\n\n`;
  prompt += `**Common automation patterns:**\n`;
  prompt += `- Greet on join: trigger=MEMBER_JOIN, action=SEND_MESSAGE or SEND_DM\n`;
  prompt += `- Auto-role on join: trigger=MEMBER_JOIN, action=ADD_ROLE, config={target_user: "actor", role_id: "..."}\n`;
  prompt += `- Log joins to channel: trigger=MEMBER_JOIN, action=LOG_TO_CHANNEL, config={channel_id: "...", content: "{user.mention} joined!"}\n`;
  prompt += `- Anti-spam: trigger=MESSAGE_CREATE, action=TIMEOUT_MEMBER, with filters\n\n`;
  prompt += `**For action_config target_user values:** Use "actor" to target the user who triggered the event.\n\n`;
  
  // Add command creation workflow
  prompt += `## ⚠️ SLASH COMMAND CREATION WORKFLOW - PREVIEW FIRST!\n\n`;
  prompt += `**IMPORTANT:** When creating slash commands, follow this workflow:\n\n`;
  prompt += `1. **ALWAYS use preview_command first:** Show the user what command will be created.\n`;
  prompt += `2. **Show the preview:** Display command name, description, response, options, and any actions.\n`;
  prompt += `3. **Ask for confirmation:** Ask "Does this look correct? Say 'yes' to create it."\n`;
  prompt += `4. **Create after confirmation:** Only after user confirms, use \`confirm_command\`. The command will auto-sync to Discord.\n\n`;
  prompt += `**Common command patterns:**\n`;
  prompt += `- Simple response: name="hello", description="Say hello", response_content="Hello {user.mention}! 👋"\n`;
  prompt += `- Give role: name="join-team", description="Join a team role", action_type="ADD_ROLE", action_config={target_user: "actor", role_id: "..."}, response_content="You've been given the role!"\n`;
  prompt += `- Info embed: name="server-info", description="Server information", response_type="embed", response_embed={title: "{guild.name}", description: "Welcome to our server!"}\n`;
  prompt += `- With options: name="say", description="Bot says something", options=[{name: "message", description: "What to say", type: 3, required: true}], response_content="{option.message}"\n`;
  prompt += `- Ephemeral: name="secret", description="Secret info", ephemeral=true, response_content="Only you see this"\n`;
  prompt += `- Admin only: name="kick", description="Kick a user", default_member_permissions="2", action_type="KICK_MEMBER"\n\n`;
  
  for (const tool of MCP_TOOLS) {
    prompt += `### ${tool.name}\n${tool.description}\n`;
    if (tool.parameters) {
      prompt += "Parameters:\n";
      for (const [key, desc] of Object.entries(tool.parameters)) {
        prompt += `- ${key}: ${desc}\n`;
      }
    }
    prompt += "\n";
  }
  
  prompt += `To use a tool, respond with ONLY a JSON block like this:
\`\`\`tool
{"tool": "tool_name", "args": {"param1": "value1"}}
\`\`\`

## CRITICAL INSTRUCTIONS - READ CAREFULLY

1. **JUST OUTPUT THE TOOL BLOCK**: When you need to call a tool, output ONLY the JSON tool block. NO explanation. NO preamble. NO "I'll look that up" or "Let me check". JUST the tool block.

2. **NEVER EXPLAIN WHAT YOU'RE ABOUT TO DO**: Do not say "To create the events, I first need to..." - just call the tool directly!

3. **CHAIN TOOLS AUTOMATICALLY**: If you need info from one tool before calling another (e.g., need channel ID before creating voice events), call the first tool immediately. After you get the result, call the next tool. Don't explain - just do it.

4. **RESOLVE NAMES TO IDS**: When user mentions a channel, role, or user by NAME, automatically look it up using the appropriate tool to get the ID. Don't ask the user for IDs.

5. **NO DATA WITHOUT TOOLS**: You have ZERO knowledge of the user's servers until you call a tool.

6. **Tool results are your ONLY source of truth**: Only cite numbers, names, and details that appear in tool results.

7. **PREVIEW BEFORE CREATE**: When creating scheduled events, automations, or commands, ALWAYS preview first, show the user what will be created, and wait for confirmation.

## EXAMPLE: Create an Automation (CORRECT)

User: "Create a welcome message automation that sends a DM to new members"
You: \`\`\`tool
{"tool": "preview_automation", "args": {"guildId": "123", "name": "Welcome DM", "description": "Send a welcome DM to new members", "trigger_events": ["MEMBER_JOIN"], "action_type": "SEND_DM", "action_config": {"target_user": "actor", "content": "Welcome to the server, {user.name}! 🎉 We're glad to have you here."}}}
\`\`\`

(Shows preview, user confirms)
You: \`\`\`tool
{"tool": "confirm_automation", "args": {"guildId": "123", "name": "Welcome DM", "description": "Send a welcome DM to new members", "trigger_events": ["MEMBER_JOIN"], "action_type": "SEND_DM", "action_config": {"target_user": "actor", "content": "Welcome to the server, {user.name}! 🎉 We're glad to have you here."}}}
\`\`\`

## EXAMPLE: Create a Slash Command (CORRECT)

User: "Make a /hello command that greets the user"
You: \`\`\`tool
{"tool": "preview_command", "args": {"guildId": "123", "name": "hello", "description": "Say hello to the bot", "response_type": "message", "response_content": "Hey there, {user.mention}! 👋 Hope you're having a great day!"}}
\`\`\`

(Shows preview, user confirms)
You: \`\`\`tool
{"tool": "confirm_command", "args": {"guildId": "123", "name": "hello", "description": "Say hello to the bot", "response_type": "message", "response_content": "Hey there, {user.mention}! 👋 Hope you're having a great day!"}}
\`\`\`

## EXAMPLE: Command with Options and Action (CORRECT)

User: "Create a /give-role command that lets admins assign a role to a user"
Step 1 - Preview:
\`\`\`tool
{"tool": "preview_command", "args": {"guildId": "123", "name": "give-role", "description": "Assign a role to a user", "options": [{"name": "user", "description": "The user to give the role to", "type": 6, "required": true}, {"name": "role", "description": "The role to assign", "type": 8, "required": true}], "action_type": "ADD_ROLE", "action_config": {"target_user": "option:user", "role_id": "option:role"}, "response_content": "✅ Gave {option.role} to {option.user}!", "default_member_permissions": "8"}}
\`\`\`

## EXAMPLE: Voice Channel Events (CORRECT)

User: "Create events in the Gaming Voice channel"
You: \`\`\`tool
{"tool": "get_voice_and_stage_channels", "args": {"guildId": "123"}}
\`\`\`

(Tool returns channels, you find Gaming Voice has ID "456")
You: \`\`\`tool
{"tool": "preview_multiple_scheduled_events", "args": {"guildId": "123", "eventsText": "...", "entityType": 2, "channelId": "456"}}
\`\`\`

## EXAMPLE: Voice Channel Events (WRONG - DO NOT DO THIS)

User: "Create events in the Gaming Voice channel"  
You: "To create the events, I first need to get the ID of the Gaming Voice channel. Then, I can proceed with creating the events."
❌ WRONG! Don't explain - just call the tool!

## EXAMPLE: External Events (CORRECT)

User: "Create an event called Game Night on Feb 20 at 7pm at Discord"
You: \`\`\`tool
{"tool": "preview_scheduled_event", "args": {"guildId": "123", "name": "Game Night", "scheduledStartTime": "2026-02-20T19:00:00.000Z", "entityType": 3, "location": "Discord"}}
\`\`\`

## EXAMPLE: Send Event Links to a Channel (CORRECT)

User: "Send links to the hockey events in the #announcements channel"

Step 1 - Find the channel:
\`\`\`tool
{"tool": "get_text_channels", "args": {"guildId": "123", "nameFilter": "announcements"}}
\`\`\`

Step 2 - After getting channel ID "789", find the events:
\`\`\`tool
{"tool": "get_scheduled_events", "args": {"guildId": "123", "nameFilter": "hockey", "upcomingOnly": true}}
\`\`\`

Step 3 - After getting events with their eventLinks, send the message:
\`\`\`tool
{"tool": "send_channel_message", "args": {"guildId": "123", "channelId": "789", "content": "🏒 **Upcoming Hockey Events**\\n\\n• [USA vs Canada](https://discord.com/events/123/456)\\n• [Gold Medal Game](https://discord.com/events/123/457)", "embed": true, "embedTitle": "Hockey Event Links"}}
\`\`\`

**NOTE:** Format the event links nicely - include the event name as link text and the eventLink from the event data.`;
  
  return prompt;
}

/**
 * Create an MCP client with the given environment variables.
 * This creates a new instance each time to ensure we have the correct env.
 * Uses local SQLite DB when MCP_USE_LOCAL_DB=true or when running locally (no D1 binding).
 * @param {Object} env - Environment variables from the Worker context
 */
export function getMCPClient(env: any = {}) {
  // Use local DB if explicitly set, or if we're likely running in local dev mode
  const useLocalDb = env.MCP_USE_LOCAL_DB === "true" || env.MCP_USE_LOCAL_DB === true;
  
  return new MCPClient({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    databaseId: env.D1_DATABASE_ID,
    useLocalDb,
    discordBotToken: env.DISCORD_BOT_TOKEN,
    d1Database: env.DB, // D1 database binding for cache lookups
  });
}
