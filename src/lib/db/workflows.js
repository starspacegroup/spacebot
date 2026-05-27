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
          capability_requirements_json, priority, max_attempts, timeout_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        timeoutSeconds
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

  const workflowTokenId = workflow.target_runner_token_id ? Number(workflow.target_runner_token_id) : null;
  const tokenId = payload?.target_runner_token_id
    ? Number(payload.target_runner_token_id)
    : workflowTokenId;

  if (!tokenId) {
    return { success: false, error: "Workflow does not have a target runner token" };
  }

  const effectiveJobType = payload?.job_type ? normalizeJobType(payload.job_type) : workflow.job_type;
  if (!effectiveJobType) return { success: false, error: "Unsupported job_type" };

  const capabilityRequirements = payload?.capability_requirements_json !== undefined
    ? payload.capability_requirements_json
    : workflow.capability_requirements_json;

  const targetInstanceId = payload?.target_runner_instance_id !== undefined
    ? payload.target_runner_instance_id
    : workflow.target_runner_instance_id;

  const createResult = await createRunnerJob(db, userId, tokenId, {
    command: payload?.command,
    job_type: effectiveJobType,
    payload_json: payload?.payload_json,
    capability_requirements_json: capabilityRequirements,
    working_dir: payload?.working_dir,
    label: payload?.label || `${workflow.name} (${effectiveJobType})`,
    target_instance_id: targetInstanceId,
    priority: payload?.priority ?? workflow.priority,
    max_attempts: payload?.max_attempts ?? workflow.max_attempts,
    timeout_seconds: payload?.timeout_seconds ?? workflow.timeout_seconds,
  });

  if (!createResult.success) return createResult;

  return {
    success: true,
    jobId: createResult.jobId,
    workflow,
  };
}
