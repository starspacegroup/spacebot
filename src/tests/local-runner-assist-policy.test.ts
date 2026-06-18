import { describe, expect, it } from "vitest";
import { evaluateLocalRunnerAssistAccess } from "../lib/local-runner-assist-policy.js";

describe("evaluateLocalRunnerAssistAccess guild-context classification", () => {
  it("returns 'no_guild_context' when no guild is supplied (personal job, ownership-authorized downstream)", async () => {
    const res = await evaluateLocalRunnerAssistAccess({}, { guildId: null, userId: "u1" });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("no_guild_context");
  });

  it("returns 'invalid_guild' (NOT 'no_guild_context') when a malformed guild id is supplied", async () => {
    // A malformed guild must NOT be misclassified as a personal job — that would
    // let the AI-job runner-fallback skip the guild policy gate.
    const res = await evaluateLocalRunnerAssistAccess({}, { guildId: "not-a-snowflake", userId: "u1" });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("invalid_guild");
  });

  it("treats a too-short numeric guild id as invalid, not personal", async () => {
    const res = await evaluateLocalRunnerAssistAccess({}, { guildId: "123", userId: "u1" });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("invalid_guild");
  });
});
