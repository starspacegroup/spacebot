import { describe, expect, it } from "vitest";
import { getTriggeredAutomations } from "../lib/db/automations.js";

function createMockDb(rows) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async all() {
              return { results: rows };
            },
          };
        },
      };
    },
  };
}

describe("getTriggeredAutomations wildcard matching", () => {
  it("matches legacy category wildcard trigger GITHUB:*", async () => {
    const db = createMockDb([
      {
        id: 1,
        guild_id: "123",
        name: "GitHub wildcard",
        enabled: 1,
        trigger_event: "GITHUB:*",
        trigger_events: null,
        trigger_filters: null,
        action_config: "{}",
      },
      {
        id: 2,
        guild_id: "123",
        name: "Different category",
        enabled: 1,
        trigger_event: "VOICE_*",
        trigger_events: null,
        trigger_filters: null,
        action_config: "{}",
      },
    ]);

    const matched = await getTriggeredAutomations(db, "123", "GITHUB_CHECK_RUN");
    expect(matched.map((a) => a.name)).toContain("GitHub wildcard");
    expect(matched.map((a) => a.name)).not.toContain("Different category");
  });

  it("matches exact triggers from trigger_events JSON", async () => {
    const db = createMockDb([
      {
        id: 3,
        guild_id: "123",
        name: "Exact trigger",
        enabled: 1,
        trigger_event: null,
        trigger_events: JSON.stringify(["GITHUB_CHECK_RUN"]),
        trigger_filters: null,
        action_config: "{}",
      },
    ]);

    const matched = await getTriggeredAutomations(db, "123", "GITHUB_CHECK_RUN");
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toBe("Exact trigger");
  });
});
