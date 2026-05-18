import { log } from "../log.js";

/**
 * Persist a canonical async ingress event while preserving idempotency.
 * Returns duplicate=true when the same idempotency key was already recorded.
 */
export async function recordAsyncIngressEvent(db, envelope) {
  if (!db) return { success: false, error: "Database not available" };

  try {
    await db.prepare(
      `INSERT OR IGNORE INTO idempotency_keys (key, scope, state)
       VALUES (?, 'event_ingress', 'accepted')`,
    ).bind(envelope.idempotencyKey).run();

    const existing = await db.prepare(
      "SELECT id FROM async_events WHERE idempotency_key = ?",
    ).bind(envelope.idempotencyKey).first();

    if (existing?.id) {
      await db.prepare(
        "UPDATE idempotency_keys SET last_seen_at = datetime('now') WHERE key = ?",
      ).bind(envelope.idempotencyKey).run();

      return { success: true, duplicate: true, eventId: existing.id };
    }

    await db.prepare(
      `INSERT INTO async_events (
         id, idempotency_key, source, guild_id, event_type, event_category,
         correlation_id, causation_id, actor_id, target_id, channel_id,
         status, payload_json, payload_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?)`,
    ).bind(
      envelope.eventId,
      envelope.idempotencyKey,
      envelope.source,
      envelope.guildId,
      envelope.eventType,
      envelope.eventCategory,
      envelope.correlationId,
      envelope.causationId,
      envelope.actorId,
      envelope.targetId,
      envelope.channelId,
      JSON.stringify(envelope.payload),
      envelope.payloadHash,
    ).run();

    await db.prepare(
      `UPDATE idempotency_keys
       SET first_event_id = ?, last_seen_at = datetime('now')
       WHERE key = ?`,
    ).bind(envelope.eventId, envelope.idempotencyKey).run();

    return { success: true, duplicate: false, eventId: envelope.eventId };
  } catch (error) {
    log.error("Failed to record async ingress event:", error);
    return { success: false, error: error.message || String(error) };
  }
}

export async function markAsyncEventQueued(db, eventId, queueName) {
  if (!db || !eventId || !queueName) return;

  try {
    await db.prepare(
      `UPDATE async_events
       SET status = 'queued', queue_name = ?, queued_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(queueName, eventId).run();
  } catch (error) {
    log.warn("Failed to mark async event queued:", error?.message || error);
  }
}