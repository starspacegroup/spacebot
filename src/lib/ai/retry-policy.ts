import { log } from "$lib/db/logger.js";

const DEFAULT_MAX_WALL_CLOCK_MS = 15 * 60 * 1000;

function classifyError(errorText) {
  const value = String(errorText || "").toLowerCase();

  if (
    value.includes("timed out") ||
    value.includes("timeout") ||
    value.includes("503") ||
    value.includes("429") ||
    value.includes("unavailable")
  ) {
    return "transient_transport";
  }

  if (value.includes("runner") && (value.includes("offline") || value.includes("unavailable"))) {
    return "runner_unavailable";
  }

  if (value.includes("tool") || value.includes("schema") || value.includes("json")) {
    return "tool_schema";
  }

  if (value.includes("permission") || value.includes("unauthorized") || value.includes("forbidden")) {
    return "user_actionable";
  }

  return "unknown";
}

function jitterMs(baseMs, spread = 0.25) {
  const delta = Math.floor(baseMs * spread);
  const min = Math.max(0, baseMs - delta);
  const max = baseMs + delta;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function computeBoundedBackoffMs(errorClass, attemptCount) {
  const attempt = Math.max(1, Number(attemptCount) || 1);

  if (errorClass === "user_actionable") {
    return 0;
  }

  const base = errorClass === "runner_unavailable" ? 15_000 : 6_000;
  const cap = errorClass === "runner_unavailable" ? 180_000 : 120_000;
  const exp = Math.min(cap, base * (2 ** Math.min(7, attempt - 1)));
  return jitterMs(exp);
}

function maybeApplyProviderSwitchHint(decision, context) {
  const chain = context?.providerChain;
  if (!Array.isArray(chain) || chain.length < 2) {
    return decision;
  }

  if (decision.errorClass === "transient_transport") {
    return {
      ...decision,
      providerSwitchHint: {
        from: chain[0],
        to: chain[1],
      },
    };
  }

  return decision;
}

function llmAssessorStub(decision, _context) {
  // Stub for controlled autonomy: in production this can call a model,
  // but the model must only pick among pre-approved bounded actions.
  return decision;
}

export function chooseRetryDecision({
  error,
  attemptCount,
  maxAttempts,
  firstAttemptAt,
  now = Date.now(),
  providerChain,
  mode = "bounded",
}) {
  const errorText = typeof error === "string" ? error : error?.message || "Unknown error";
  const errorClass = classifyError(errorText);
  const hardAttemptCap = Math.max(1, Number(maxAttempts) || 1);
  const elapsedMs = firstAttemptAt ? Math.max(0, now - firstAttemptAt) : 0;

  const baseDecision = {
    retry: false,
    reason: "retry_exhausted",
    errorClass,
    nextRetryDelayMs: 0,
    providerSwitchHint: null,
  };

  if (attemptCount >= hardAttemptCap) {
    return baseDecision;
  }

  if (elapsedMs >= DEFAULT_MAX_WALL_CLOCK_MS) {
    return {
      ...baseDecision,
      reason: "wall_clock_budget_exhausted",
    };
  }

  if (errorClass === "user_actionable") {
    return {
      ...baseDecision,
      reason: "user_action_required",
    };
  }

  let decision = {
    retry: true,
    reason: "bounded_retry",
    errorClass,
    nextRetryDelayMs: computeBoundedBackoffMs(errorClass, attemptCount),
    providerSwitchHint: null,
  };

  decision = maybeApplyProviderSwitchHint(decision, { providerChain });

  if (mode === "llm") {
    try {
      decision = llmAssessorStub(decision, {
        errorText,
        attemptCount,
        maxAttempts,
        elapsedMs,
        providerChain,
      });
    } catch (err) {
      log.warn("[AI Autopilot] LLM retry assessor failed, using bounded decision:", err?.message || err);
    }
  }

  return decision;
}
