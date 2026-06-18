import { redirect } from "@sveltejs/kit";
import { listUserWorkflows } from "$lib/db/workflows.js";
import { getRunnerTokens, getRunnerInstances, getRunnerJobs } from "$lib/db/local-runners.js";

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) {
    throw redirect(302, "/login");
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return {
      workflows: [],
      runnerTokens: [],
      runnerInstances: [],
      runnerJobs: [],
    };
  }

  const [workflows, runnerTokens, runnerInstances, runnerJobs] = await Promise.all([
    listUserWorkflows(db, userId, { limit: 200 }),
    getRunnerTokens(db, userId),
    getRunnerInstances(db, userId, { limit: 200 }),
    getRunnerJobs(db, userId, null, { limit: 120 }),
  ]);

  return {
    workflows,
    runnerTokens,
    runnerInstances,
    runnerJobs,
  };
}
