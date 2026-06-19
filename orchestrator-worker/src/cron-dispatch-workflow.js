import { WorkflowEntrypoint } from "cloudflare:workers";

/**
 * Durably calls the superadmin workflows dispatch endpoint on each cron
 * tick. Replaces the old GCP/PM2 30s tick (scripts/cron.ts) — the dispatch
 * endpoint itself already dedupes per-template-per-minute, so a once-a-minute
 * trigger here is a lossless replacement, just with automatic step retries
 * and a Cloudflare-visible run history on top.
 */
export class CronDispatchWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    await step.do(
      "dispatch-superadmin-workflows",
      {
        retries: {
          limit: 3,
          delay: "10 seconds",
          backoff: "exponential",
        },
        timeout: "30 seconds",
      },
      async () => {
        const base = String(this.env.SPACEBOT_API_BASE || "").replace(/\/$/, "");
        if (!base) {
          throw new Error("SPACEBOT_API_BASE is not configured");
        }
        const cronSecret = this.env.CRON_SECRET || "";
        if (!cronSecret) {
          throw new Error("CRON_SECRET is not configured");
        }

        const response = await fetch(`${base}/api/superadmin/workflows/dispatch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cronSecret}`,
          },
          body: JSON.stringify({ firedAt: event.payload?.firedAt }),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`Dispatch failed (${response.status}): ${text.slice(0, 300)}`);
        }

        return response.json().catch(() => ({}));
      },
    );
  }
}
