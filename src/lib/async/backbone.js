import { createHash, randomUUID } from "node:crypto";

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeValue(value[key]);
        return acc;
      }, {});
  }

  return value;
}

export function stableJsonStringify(value) {
  return JSON.stringify(normalizeValue(value));
}

export function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

export function buildEventIdempotencyKey(event, source = "api.logs.create") {
  const canonical = stableJsonStringify({ source, event });
  return `event_ingress:${sha256Hex(canonical)}`;
}

export function buildAsyncEventEnvelope(event, options = {}) {
  const source = options.source || "api.logs.create";
  const idempotencyKey =
    options.idempotencyKey || buildEventIdempotencyKey(event, source);
  const payloadCanonical = stableJsonStringify(event);
  const payloadHash = sha256Hex(payloadCanonical);

  return {
    eventId: options.eventId || randomUUID(),
    source,
    idempotencyKey,
    correlationId: options.correlationId || idempotencyKey,
    causationId: options.causationId || null,
    payload: event,
    payloadHash,
    actorId: event?.actor_id || null,
    targetId: event?.target_id || null,
    channelId: event?.channel_id || null,
    guildId: event?.guild_id || null,
    eventType: event?.event_type || null,
    eventCategory: event?.event_category || null,
  };
}