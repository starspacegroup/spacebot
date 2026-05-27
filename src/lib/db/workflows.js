import { log } from "./logger.js";
import { createRunnerJob } from "./local-runners.js";

const DEFAULT_JOB_TYPE = "shell_command";
const ALLOWED_JOB_TYPES = new Set([
  "shell_command",
  "screenshot_capture",
  "system_profile",
  "vscode_discover_instances",
  "vscode_send_copilot_message",
  "dm",
]);

const DEFAULT_PRIORITY = 0;
const MIN_PRIORITY = -100;
const MAX_PRIORITY = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const MIN_MAX_ATTEMPTS = 1;
const MAX_MAX_ATTEMPTS = 20;
const DEFAULT_TIMEOUT_SECONDS = 300;
const MIN_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 3600;
const RUNNER_ONLINE_WINDOW_SECONDS = 90;
const DEFAULT_RUNNER_STRATEGY = "pinned";
const ALLOWED_RUNNER_STRATEGIES = new Set(["pinned", "any_online", "all_online"]);
const ALLOWED_MODEL_MODE = new Set(["first_success", "fanout_all"]);
const ALLOWED_MODEL_PROVIDERS = new Set(["copilot", "ollama"]);

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.trunc(numeric);
  return Math.max(min, Math.min(max, rounded));
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeWorkflowRow(row) {
  if (!row) return null;
  return {
    ...row,
    enabled: Boolean(row.enabled),
    capability_requirements_json: parseJson(row.capability_requirements_json),
    allowed_runner_token_ids_json: parseJson(row.allowed_runner_token_ids_json),
    allowed_runner_instance_ids_json: parseJson(row.allowed_runner_instance_ids_json),
    model_preferences_json: parseJson(row.model_preferences_json),
    runner_strategy: row.runner_strategy || DEFAULT_RUNNER_STRATEGY,
  };
}

function normalizeJobType(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return DEFAULT_JOB_TYPE;
  return ALLOWED_JOB_TYPES.has(candidate) ? candidate : null;
}

function normalizeCapabilityRequirements(value) {
  if (value === undefined) return { present: false, value: null };
  if (value === null) return { present: true, value: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "capability_requirements_json must be a JSON object" };
  }
  try {
    return { present: true, value: JSON.stringify(value) };
  } catch {
    return { error: "capability_requirements_json must be serializable JSON" };
  }
}

function normalizeRunnerStrategy(value) {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!candidate) return DEFAULT_RUNNER_STRATEGY;
  return ALLOWED_RUNNER_STRATEGIES.has(candidate) ? candidate : null;
}

function normalizeJsonIdList(value, fieldName) {
  if (value === undefined) return { present: false, value: null, parsed: null };
  if (value === null) return { present: true, value: null, parsed: null };
  if (!Array.isArray(value)) {
    return { error: `${fieldName} must be an array of positive integers` };
  }

  const normalized = [...new Set(
    value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isInteger(entry) && entry > 0)
  )];

  if (normalized.length !== value.length) {
    return { error: `${fieldName} must be an array of positive integers` };
  }

  return {
    present: true,
    value: JSON.stringify(normalized),
    parsed: normalized,
  };
}

function normalizeProviderChain(chain) {
  if (chain === undefined) return { present: false, value: null, parsed: [] };
  if (!Array.isArray(chain)) {
    return { error: "model_preferences_json.provider_chain must be an array" };
  }

  const parsed = [];
  for (const raw of chain) {
    if (!raw || typeof raw !== "object") {
      return { error: "Each provider_chain entry must be an object" };
    }

    const provider = typeof raw.provider === "string" ? raw.provider.trim().toLowerCase() : "";
    if (!ALLOWED_MODEL_PROVIDERS.has(provider)) {
      return { error: "provider_chain.provider must be one of: copilot, ollama" };
    }

    const entry = {
      provider,
      model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : null,
      via: typeof raw.via === "string" && raw.via.trim() ? raw.via.trim() : null,
    };
    parsed.push(entry);
  }

  return { present: true, parsed };
}

function normalizeModelPreferences(value) {
  if (value === undefined) return { present: false, value: null, parsed: null };
  if (value === null) return { present: true, value: null, parsed: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "model_preferences_json must be an object" };
  }

  const modeRaw = typeof value.mode === "string" ? value.mode.trim().toLowerCase() : "first_success";
  if (!ALLOWED_MODEL_MODE.has(modeRaw)) {
    return { error: "model_preferences_json.mode must be first_success or fanout_all" };
  }

  const chain = normalizeProviderChain(value.provider_chain ?? []);
  if (chain.error) return { error: chain.error };

  const parsed = {
    mode: modeRaw,
    provider_chain: chain.parsed,
  };

  return {
    present: true,
    value: JSON.stringify(parsed),
    parsed,
  };
}

function parseIdListFromWorkflow(value) {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
  return normalized.length > 0 ? new Set(normalized) : null;
}

async function listOnlineRunnerInstances(db, userId) {
  const rows = await db
    .prepare(
      `SELECT i.id, i.runner_token_id, i.display_name, i.last_seen_at, i.metadata
       FROM local_runner_instances i
       JOIN local_runner_tokens t ON t.id = i.runner_token_id
       WHERE i.user_id = ?
         AND t.user_id = ?
         AND t.revoked = 0
         AND i.last_seen_at IS NOT NULL
         AND i.last_seen_at >= datetime('now', ?)
       ORDER BY i.last_seen_at DESC, i.id DESC`
    )
    .bind(userId, userId, `-${RUNNER_ONLINE_WINDOW_SECONDS} seconds`)
    .all();

  return (rows.results || []).map((row) => ({
    id: Number(row.id),
    tokenId: Number(row.runner_token_id),
    displayName: row.display_name,
    lastSeenAt: row.last_seen_at,
    metadata: parseJson(row.metadata),
  }));
}

async function resolvePinnedTarget(db, userId, workflow, payload) {
  const overrideTokenId = Number(payload?.target_runner_token_id);
  const overrideInstanceId = Number(payload?.target_runner_instance_id);
  const tokenId = Number.isInteger(overrideTokenId) && overrideTokenId > 0
    ? overrideTokenId
    : workflow.target_runner_token_id;
  const instanceId = Number.isInteger(overrideInstanceId) && overrideInstanceId > 0
    ? overrideInstanceId
    : workflow.target_runner_instance_id;

  const validation = await validateTargets(db, userId, tokenId, instanceId);
  if (!validation.success || !validation.tokenId) {
    return { success: false, error: "Pinned strategy requires a valid target runner token or instance" };
  }

  return {
    success: true,
    targets: [{
      tokenId: validation.tokenId,
      instanceId: validation.instanceId,
      displayName: validation.instanceId ? `instance-${validation.instanceId}` : null,
    }],
  };
}

async function resolveOnlineTargets(db, userId, workflow, payload, strategy) {
  const onlineInstances = await listOnlineRunnerInstances(db, userId);
  const allowedTokenSet = parseIdListFromWorkflow(workflow.allowed_runner_token_ids_json);
  const allowedInstanceSet = parseIdListFromWorkflow(workflow.allowed_runner_instance_ids_json);

  const overrideTokenId = Number(payload?.target_runner_token_id);
  const overrideInstanceId = Number(payload?.target_runner_instance_id);
  const pinnedTokenId = workflow.target_runner_token_id ? Number(workflow.target_runner_token_id) : null;
  const pinnedInstanceId = workflow.target_runner_instance_id ? Number(workflow.target_runner_instance_id) : null;

  const candidates = onlineInstances.filter((instance) => {
    if (Number.isInteger(overrideInstanceId) && overrideInstanceId > 0 && instance.id !== overrideInstanceId) {
      return false;
    }
    if (Number.isInteger(overrideTokenId) && overrideTokenId > 0 && instance.tokenId !== overrideTokenId) {
      return false;
    }
    if (!(Number.isInteger(overrideTokenId) && overrideTokenId > 0)
      && !(Number.isInteger(overrideInstanceId) && overrideInstanceId > 0)
      && Number.isInteger(pinnedInstanceId)
      && pinnedInstanceId > 0
      && instance.id !== pinnedInstanceId) {
      return false;
    }
    if (!(Number.isInteger(overrideTokenId) && overrideTokenId > 0)
      && !(Number.isInteger(overrideInstanceId) && overrideInstanceId > 0)
      && Number.isInteger(pinnedTokenId)
      && pinnedTokenId > 0
      && instance.tokenId !== pinnedTokenId) {
      return false;
    }
    if (allowedTokenSet && !allowedTokenSet.has(instance.tokenId)) return false;
    if (allowedInstanceSet && !allowedInstanceSet.has(instance.id)) return false;
    return true;
  });

  if (candidates.length === 0) {
    return { success: false, error: "No eligible online runner instances match this workflow" };
  }

  const selected = strategy === "all_online" ? candidates : [candidates[0]];
  return {
    success: true,
    targets: selected.map((instance) => ({
      tokenId: instance.tokenId,
      instanceId: instance.id,
      displayName: instance.displayName || `instance-${instance.id}`,
    })),
  };
}

function buildModelVariants(modelPreferences) {
  const mode = modelPreferences?.mode === "fanout_all" ? "fanout_all" : "first_success";
  const providerChain = Array.isArray(modelPreferences?.provider_chain)
    ? modelPreferences.provider_chain
    : [];

  if (providerChain.length === 0) {
    return [{ providerChain: null, suffix: null, mode }];
  }

  if (mode === "fanout_all") {
    return providerChain.map((entry) => ({
      providerChain: [entry],
      suffix: entry.model ? `${entry.provider}:${entry.model}` : entry.provider,
      mode,
    }));
  }

  return [{ providerChain, suffix: null, mode }];
}

function mergePayloadWithProviderChain(payloadJson, providerChain) {
  if (!providerChain || providerChain.length === 0) return payloadJson;

  if (payloadJson && typeof payloadJson === "object" && !Array.isArray(payloadJson)) {
    if (Array.isArray(payloadJson.provider_chain)) {
      return payloadJson;
    }
    return {
      ...payloadJson,
      provider_chain: providerChain,
    };
  }

  return {
    input: payloadJson ?? null,
    provider_chain: providerChain,
  };
}

function labelForVariant(base, variant, target, targetCount) {
  const parts = [base];
  if (variant?.suffix) parts.push(`[${variant.suffix}]`);
  if (targetCount > 1 && target?.displayName) parts.push(`@${target.displayName}`);
  return parts.join(" ");
}

async function validateTargets(db, userId, tokenId, instanceId) {
  const parsedTokenId = Number(tokenId);
  const parsedInstanceId = Number(instanceId);
  let resolvedTokenId = Number.isInteger(parsedTokenId) && parsedTokenId > 0 ? parsedTokenId : null;
  let resolvedInstanceId = Number.isInteger(parsedInstanceId) && parsedInstanceId > 0 ? parsedInstanceId : null;

  if (resolvedTokenId) {
    const token = await db
      .prepare("SELECT id FROM local_runner_tokens WHERE id = ? AND user_id = ?")
      .bind(resolvedTokenId, userId)
      .first();
    if (!token?.id) {
      return { success: false, error: "Target runner token not found" };
    }
  }

  if (resolvedInstanceId) {
    const instance = await db
      .prepare("SELECT id, runner_token_id FROM local_runner_instances WHERE id = ? AND user_id = ?")
      .bind(resolvedInstanceId, userId)
      .first();
    if (!instance?.id) {
      return { success: false, error: "Target runner instance not found" };
    }

    if (resolvedTokenId && Number(instance.runner_token_id) !== resolvedTokenId) {
      return { success: false, error: "Target instance does not belong to selected token" };
    }

    if (!resolvedTokenId) {
      resolvedTokenId = Number(instance.runner_token_id);
    }
  }

  return {
    success: true,
    tokenId: resolvedTokenId,
    instanceId: resolvedInstanceId,
  };
}

export async function listUserWorkflows(db, userId, options = {}) {
  if (!db || !userId) return [];
  const limit = clampInteger(options.limit, 100, 1, 200);
  const enabledOnly = options.enabledOnly === true;

  try {
    const sql = enabledOnly
      ? `SELECT *
         FROM user_workflows
         WHERE user_id = ? AND enabled = 1
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`
      : `SELECT *
         FROM user_workflows
         WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`;
    const rows = await db.prepare(sql).bind(userId, limit).all();
    return (rows.results || []).map(normalizeWorkflowRow);
  } catch (err) {
    log.error("[Workflows] listUserWorkflows error:", err);
    return [];
  }
}

export async function getUserWorkflow(db, userId, workflowId) {
  if (!db || !userId || !workflowId) return null;
  try {
    const row = await db
      .prepare("SELECT * FROM user_workflows WHERE id = ? AND user_id = ?")
      .bind(workflowId, userId)
      .first();
    return normalizeWorkflowRow(row);
  } catch (err) {
    log.error("[Workflows] getUserWorkflow error:", err);
    return null;
  }
}

export async function createUserWorkflow(db, userId, input) {
  if (!db || !userId) return { success: false, error: "Invalid parameters" };

  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name) return { success: false, error: "name is required" };

  const jobType = normalizeJobType(input?.job_type);
  if (!jobType) return { success: false, error: "Unsupported job_type" };

  const description = typeof input?.description === "string" && input.description.trim()
    ? input.description.trim()
    : null;
  const enabled = input?.enabled === undefined ? 1 : (input.enabled ? 1 : 0);
  const capability = normalizeCapabilityRequirements(input?.capability_requirements_json);
  if (capability.error) return { success: false, error: capability.error };
  const runnerStrategy = normalizeRunnerStrategy(input?.runner_strategy);
  if (!runnerStrategy) return { success: false, error: "Unsupported runner_strategy" };
  const allowedRunnerTokens = normalizeJsonIdList(input?.allowed_runner_token_ids_json, "allowed_runner_token_ids_json");
  if (allowedRunnerTokens.error) return { success: false, error: allowedRunnerTokens.error };
  const allowedRunnerInstances = normalizeJsonIdList(input?.allowed_runner_instance_ids_json, "allowed_runner_instance_ids_json");
  if (allowedRunnerInstances.error) return { success: false, error: allowedRunnerInstances.error };
  const modelPreferences = normalizeModelPreferences(input?.model_preferences_json);
  if (modelPreferences.error) return { success: false, error: modelPreferences.error };

  const targetValidation = await validateTargets(
    db,
    userId,
    input?.target_runner_token_id,
    input?.target_runner_instance_id
  );
  if (!targetValidation.success) return targetValidation;

  const priority = clampInteger(input?.priority, DEFAULT_PRIORITY, MIN_PRIORITY, MAX_PRIORITY);
  const maxAttempts = clampInteger(input?.max_attempts, DEFAULT_MAX_ATTEMPTS, MIN_MAX_ATTEMPTS, MAX_MAX_ATTEMPTS);
  const timeoutSeconds = clampInteger(input?.timeout_seconds, DEFAULT_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS);

  try {
    const row = await db
      .prepare(
        `INSERT INTO user_workflows (
          user_id, name, description, enabled, job_type,
          target_runner_token_id, target_runner_instance_id,
          capability_requirements_json, priority, max_attempts, timeout_seconds,
          runner_strategy, allowed_runner_token_ids_json, allowed_runner_instance_ids_json, model_preferences_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *`
      )
      .bind(
        userId,
        name,
        description,
        enabled,
        jobType,
        targetValidation.tokenId,
        targetValidation.instanceId,
        capability.present ? capability.value : null,
        priority,
        maxAttempts,
        timeoutSeconds,
        runnerStrategy,
        allowedRunnerTokens.present ? allowedRunnerTokens.value : null,
        allowedRunnerInstances.present ? allowedRunnerInstances.value : null,
        modelPreferences.present ? modelPreferences.value : null
      )
      .first();

    return { success: true, workflow: normalizeWorkflowRow(row) };
  } catch (err) {
    log.error("[Workflows] createUserWorkflow error:", err);
    return { success: false, error: "Failed to create workflow" };
  }
}

export async function updateUserWorkflow(db, userId, workflowId, patch) {
  if (!db || !userId || !workflowId) return { success: false, error: "Invalid parameters" };

  const current = await getUserWorkflow(db, userId, workflowId);
  if (!current) return { success: false, error: "Workflow not found" };

  const nextName = patch?.name === undefined
    ? current.name
    : (typeof patch.name === "string" ? patch.name.trim() : "");
  if (!nextName) return { success: false, error: "name is required" };

  const nextJobType = patch?.job_type === undefined
    ? current.job_type
    : normalizeJobType(patch.job_type);
  if (!nextJobType) return { success: false, error: "Unsupported job_type" };

  const nextDescription = patch?.description === undefined
    ? current.description
    : (typeof patch.description === "string" && patch.description.trim() ? patch.description.trim() : null);

  const capability = normalizeCapabilityRequirements(patch?.capability_requirements_json);
  if (capability.error) return { success: false, error: capability.error };
  const runnerStrategy = patch?.runner_strategy === undefined
    ? (current.runner_strategy || DEFAULT_RUNNER_STRATEGY)
    : normalizeRunnerStrategy(patch?.runner_strategy);
  if (!runnerStrategy) return { success: false, error: "Unsupported runner_strategy" };

  const allowedRunnerTokens = normalizeJsonIdList(patch?.allowed_runner_token_ids_json, "allowed_runner_token_ids_json");
  if (allowedRunnerTokens.error) return { success: false, error: allowedRunnerTokens.error };
  const allowedRunnerInstances = normalizeJsonIdList(patch?.allowed_runner_instance_ids_json, "allowed_runner_instance_ids_json");
  if (allowedRunnerInstances.error) return { success: false, error: allowedRunnerInstances.error };
  const modelPreferences = normalizeModelPreferences(patch?.model_preferences_json);
  if (modelPreferences.error) return { success: false, error: modelPreferences.error };

  const targetValidation = await validateTargets(
    db,
    userId,
    patch?.target_runner_token_id === undefined ? current.target_runner_token_id : patch.target_runner_token_id,
    patch?.target_runner_instance_id === undefined ? current.target_runner_instance_id : patch.target_runner_instance_id
  );
  if (!targetValidation.success) return targetValidation;

  const enabled = patch?.enabled === undefined ? (current.enabled ? 1 : 0) : (patch.enabled ? 1 : 0);
  const priority = patch?.priority === undefined
    ? current.priority
    : clampInteger(patch.priority, DEFAULT_PRIORITY, MIN_PRIORITY, MAX_PRIORITY);
  const maxAttempts = patch?.max_attempts === undefined
    ? current.max_attempts
    : clampInteger(patch.max_attempts, DEFAULT_MAX_ATTEMPTS, MIN_MAX_ATTEMPTS, MAX_MAX_ATTEMPTS);
  const timeoutSeconds = patch?.timeout_seconds === undefined
    ? current.timeout_seconds
    : clampInteger(patch.timeout_seconds, DEFAULT_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS);

  const capabilityRequirementsJson = capability.present
    ? capability.value
    : (current.capability_requirements_json ? JSON.stringify(current.capability_requirements_json) : null);
  const allowedRunnerTokensJson = allowedRunnerTokens.present
    ? allowedRunnerTokens.value
    : (Array.isArray(current.allowed_runner_token_ids_json) ? JSON.stringify(current.allowed_runner_token_ids_json) : null);
  const allowedRunnerInstancesJson = allowedRunnerInstances.present
    ? allowedRunnerInstances.value
    : (Array.isArray(current.allowed_runner_instance_ids_json) ? JSON.stringify(current.allowed_runner_instance_ids_json) : null);
  const modelPreferencesJson = modelPreferences.present
    ? modelPreferences.value
    : (current.model_preferences_json ? JSON.stringify(current.model_preferences_json) : null);

  try {
    const row = await db
      .prepare(
        `UPDATE user_workflows
         SET name = ?,
             description = ?,
             enabled = ?,
             job_type = ?,
             target_runner_token_id = ?,
             target_runner_instance_id = ?,
             capability_requirements_json = ?,
             priority = ?,
             max_attempts = ?,
             timeout_seconds = ?,
             runner_strategy = ?,
             allowed_runner_token_ids_json = ?,
             allowed_runner_instance_ids_json = ?,
             model_preferences_json = ?,
             updated_at = datetime('now')
         WHERE id = ? AND user_id = ?
         RETURNING *`
      )
      .bind(
        nextName,
        nextDescription,
        enabled,
        nextJobType,
        targetValidation.tokenId,
        targetValidation.instanceId,
        capabilityRequirementsJson,
        priority,
        maxAttempts,
        timeoutSeconds,
        runnerStrategy,
        allowedRunnerTokensJson,
        allowedRunnerInstancesJson,
        modelPreferencesJson,
        workflowId,
        userId
      )
      .first();

    return { success: true, workflow: normalizeWorkflowRow(row) };
  } catch (err) {
    log.error("[Workflows] updateUserWorkflow error:", err);
    return { success: false, error: "Failed to update workflow" };
  }
}

export async function deleteUserWorkflow(db, userId, workflowId) {
  if (!db || !userId || !workflowId) return { success: false, error: "Invalid parameters" };

  try {
    const result = await db
      .prepare("DELETE FROM user_workflows WHERE id = ? AND user_id = ?")
      .bind(workflowId, userId)
      .run();
    const changed = result?.meta?.changes ?? result?.changes ?? 0;
    if (!changed) return { success: false, error: "Workflow not found" };
    return { success: true };
  } catch (err) {
    log.error("[Workflows] deleteUserWorkflow error:", err);
    return { success: false, error: "Failed to delete workflow" };
  }
}

export async function dispatchWorkflowJob(db, userId, workflowId, payload = {}) {
  if (!db || !userId || !workflowId) return { success: false, error: "Invalid parameters" };

  const workflow = await getUserWorkflow(db, userId, workflowId);
  if (!workflow) return { success: false, error: "Workflow not found" };
  if (!workflow.enabled) return { success: false, error: "Workflow is disabled" };

  const effectiveJobType = payload?.job_type ? normalizeJobType(payload.job_type) : workflow.job_type;
  if (!effectiveJobType) return { success: false, error: "Unsupported job_type" };

  const runnerStrategy = payload?.runner_strategy
    ? normalizeRunnerStrategy(payload.runner_strategy)
    : (workflow.runner_strategy || DEFAULT_RUNNER_STRATEGY);
  if (!runnerStrategy) return { success: false, error: "Unsupported runner_strategy" };

  const capabilityRequirements = payload?.capability_requirements_json !== undefined
    ? payload.capability_requirements_json
    : workflow.capability_requirements_json;

  const modelPreferencesNormalized = normalizeModelPreferences(
    payload?.model_preferences_json !== undefined
      ? payload.model_preferences_json
      : workflow.model_preferences_json
  );
  if (modelPreferencesNormalized.error) {
    return { success: false, error: modelPreferencesNormalized.error };
  }
  const modelPreferences = modelPreferencesNormalized.present
    ? modelPreferencesNormalized.parsed
    : null;

  const targets = runnerStrategy === "pinned"
    ? await resolvePinnedTarget(db, userId, workflow, payload)
    : await resolveOnlineTargets(db, userId, workflow, payload, runnerStrategy);
  if (!targets.success) return targets;

  const variants = buildModelVariants(modelPreferences);
  const createdJobs = [];
  const baseLabel = payload?.label || `${workflow.name} (${effectiveJobType})`;
  for (const target of targets.targets) {
    for (const variant of variants) {
      const payloadJson = mergePayloadWithProviderChain(payload?.payload_json, variant.providerChain);
      const label = labelForVariant(baseLabel, variant, target, targets.targets.length);

      const createResult = await createRunnerJob(db, userId, target.tokenId, {
        command: payload?.command,
        job_type: effectiveJobType,
        payload_json: payloadJson,
        capability_requirements_json: capabilityRequirements,
        working_dir: payload?.working_dir,
        label,
        target_instance_id: target.instanceId,
        priority: payload?.priority ?? workflow.priority,
        max_attempts: payload?.max_attempts ?? workflow.max_attempts,
        timeout_seconds: payload?.timeout_seconds ?? workflow.timeout_seconds,
      });

      if (!createResult.success) return createResult;
      createdJobs.push({
        jobId: createResult.jobId,
        tokenId: target.tokenId,
        instanceId: target.instanceId,
        label,
      });
    }
  }

  if (createdJobs.length === 0) {
    return { success: false, error: "No jobs were created for this workflow dispatch" };
  }

  return {
    success: true,
    jobId: createdJobs[0].jobId,
    jobIds: createdJobs.map((entry) => entry.jobId),
    createdJobs,
    runnerStrategy,
    modelMode: modelPreferences?.mode || "first_success",
    workflow,
  };
}
