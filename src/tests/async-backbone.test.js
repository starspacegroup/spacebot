import { describe, expect, it } from "vitest";
import {
  buildAsyncEventEnvelope,
  buildEventIdempotencyKey,
  stableJsonStringify,
} from "../lib/async/backbone.js";

describe("async backbone helpers", () => {
  it("stableJsonStringify normalizes object key order", () => {
    const left = {
      b: 2,
      a: 1,
      nested: {
        z: 3,
        y: 2,
      },
    };

    const right = {
      a: 1,
      nested: {
        y: 2,
        z: 3,
      },
      b: 2,
    };

    expect(stableJsonStringify(left)).toBe(stableJsonStringify(right));
  });

  it("buildEventIdempotencyKey is deterministic for equivalent payloads", () => {
    const one = {
      guild_id: "123",
      event_type: "MESSAGE_CREATE",
      event_category: "message",
      actor_id: "u1",
      details: { content: "hello", x: 1 },
    };

    const two = {
      event_category: "message",
      event_type: "MESSAGE_CREATE",
      guild_id: "123",
      details: { x: 1, content: "hello" },
      actor_id: "u1",
    };

    expect(buildEventIdempotencyKey(one)).toBe(buildEventIdempotencyKey(two));
  });

  it("buildAsyncEventEnvelope includes key workflow fields", () => {
    const event = {
      guild_id: "123",
      event_type: "MEMBER_JOIN",
      event_category: "member",
      actor_id: "u1",
      target_id: "u2",
      channel_id: "c1",
      details: { source: "test" },
    };

    const envelope = buildAsyncEventEnvelope(event, { source: "test.source" });

    expect(envelope.eventId).toBeTruthy();
    expect(envelope.source).toBe("test.source");
    expect(envelope.idempotencyKey.startsWith("event_ingress:")).toBe(true);
    expect(envelope.correlationId).toBe(envelope.idempotencyKey);
    expect(envelope.payloadHash).toHaveLength(64);
    expect(envelope.guildId).toBe("123");
  });
});