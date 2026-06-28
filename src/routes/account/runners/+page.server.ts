import { redirect } from "@sveltejs/kit";
import { getUser } from "$lib/db/users.js";
import { getRunnerTokens, getRunnerInstances, getRunnerEvents } from "$lib/db/local-runners.js";
import { listUserWorkflows } from "$lib/db/workflows.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies, platform }) => {
  const userId = cookies.get("discord_user_id");
  if (!userId) {
    throw redirect(302, "/login");
  }

  const db = (platform as any)?.env?.DB;

  const dbUser = db ? await getUser(db, userId) : null;

  const runnerUiPrefs = dbUser?.preferences_json
    ? (() => {
        try {
          const parsed = JSON.parse(dbUser.preferences_json);
          return parsed?.runnerUi && typeof parsed.runnerUi === "object"
            ? parsed.runnerUi
            : {};
        } catch {
          return {};
        }
      })()
    : {};

  return {
    runnerUiPrefs,
    runnerTokens: db ? await getRunnerTokens(db, userId) : [],
    runnerInstances: db ? await getRunnerInstances(db, userId, { limit: 100 }) : [],
    runnerEvents: db ? await getRunnerEvents(db, userId, { limit: 50 }) : [],
    workflows: db ? await listUserWorkflows(db, userId, { limit: 100 }) : [],
  };
};
