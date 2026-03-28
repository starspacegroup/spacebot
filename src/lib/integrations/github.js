/**
 * GitHub Integration
 *
 * Processes incoming GitHub webhook events and converts them into SpaceBot
 * automation events. When a guild enables the GitHub integration, they
 * configure a webhook secret. GitHub sends webhooks to our endpoint, and
 * we verify the signature, parse the event, and fire it into the automation
 * engine for matching automations.
 *
 * Supported GitHub events:
 *   push               → GITHUB_PUSH
 *   pull_request       → GITHUB_PULL_REQUEST
 *   issues             → GITHUB_ISSUES
 *   issue_comment      → GITHUB_ISSUE_COMMENT
 *   release            → GITHUB_RELEASE
 *   star               → GITHUB_STAR
 *   fork               → GITHUB_FORK
 *   workflow_run       → GITHUB_WORKFLOW_RUN
 *   check_run          → GITHUB_CHECK_RUN
 *   check_suite        → GITHUB_CHECK_SUITE
 *   deployment_status  → GITHUB_DEPLOYMENT_STATUS
 */

import { log } from "../log.js";

/**
 * Map of GitHub webhook event names to SpaceBot event types.
 */
export const GITHUB_EVENT_MAP = {
  push: "GITHUB_PUSH",
  pull_request: "GITHUB_PULL_REQUEST",
  issues: "GITHUB_ISSUES",
  issue_comment: "GITHUB_ISSUE_COMMENT",
  release: "GITHUB_RELEASE",
  star: "GITHUB_STAR",
  fork: "GITHUB_FORK",
  workflow_run: "GITHUB_WORKFLOW_RUN",
  check_run: "GITHUB_CHECK_RUN",
  check_suite: "GITHUB_CHECK_SUITE",
  deployment_status: "GITHUB_DEPLOYMENT_STATUS",
};

/**
 * Verify the GitHub webhook signature (HMAC-SHA256).
 *
 * @param {string} payload  - Raw request body as text
 * @param {string} signature - The X-Hub-Signature-256 header value
 * @param {string} secret    - The webhook secret configured for this guild
 * @returns {Promise<boolean>}
 */
export async function verifyGitHubSignature(payload, signature, secret) {
  if (!signature || !secret) return false;

  const sigParts = signature.split("=");
  if (sigParts.length !== 2 || sigParts[0] !== "sha256") return false;

  const sigHex = sigParts[1];

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const expectedHex = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison
  if (sigHex.length !== expectedHex.length) return false;
  let mismatch = 0;
  for (let i = 0; i < sigHex.length; i++) {
    mismatch |= sigHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Generate a random webhook secret for a guild's GitHub integration.
 * @returns {string} A 40-character hex string
 */
export function generateWebhookSecret() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Parse a GitHub webhook payload into a SpaceBot event object.
 *
 * @param {string} githubEvent - The X-GitHub-Event header value
 * @param {Object} payload     - Parsed JSON body from GitHub
 * @param {string} guildId     - The guild this webhook targets
 * @returns {{ event: Object, summary: string } | null}
 */
export function parseGitHubEvent(githubEvent, payload, guildId) {
  const eventType = GITHUB_EVENT_MAP[githubEvent];
  if (!eventType) {
    log.debug(`[GitHub] Ignoring unsupported event: ${githubEvent}`);
    return null;
  }

  const repo = payload.repository;
  const sender = payload.sender;

  const base = {
    guild_id: guildId,
    event_type: eventType,
    event_category: "github",
    actor_id: null, // GitHub users don't map to Discord users
    actor_name: sender?.login || "github",
    actor_is_bot: sender?.type === "Bot",
    target_id: null,
    target_name: repo?.full_name || null,
    channel_id: null,
    channel_name: null,
  };

  switch (githubEvent) {
    case "push": {
      const branch = (payload.ref || "").replace("refs/heads/", "");
      const commitCount = payload.commits?.length || 0;
      const headCommit = payload.head_commit;
      return {
        event: {
          ...base,
          details: {
            action: "push",
            repo: repo?.full_name,
            repo_url: repo?.html_url,
            repo_private: repo?.private || false,
            branch,
            ref: payload.ref,
            commit_count: commitCount,
            title: headCommit?.message?.split("\n")[0] || null,
            url: payload.compare || headCommit?.url || null,
            head_commit_message: headCommit?.message || null,
            head_commit_url: headCommit?.url || null,
            sender: sender?.login,
            sender_url: sender?.html_url,
            sender_avatar_url: sender?.avatar_url || null,
            compare_url: payload.compare,
          },
        },
        summary: `${sender?.login} pushed ${commitCount} commit(s) to ${branch} in ${repo?.full_name}`,
      };
    }

    case "pull_request": {
      const pr = payload.pull_request;
      return {
        event: {
          ...base,
          details: {
            action: payload.action, // opened, closed, merged, reopened, etc.
            repo: repo?.full_name,
            repo_url: repo?.html_url,
            repo_private: repo?.private || false,
            number: pr?.number,
            title: pr?.title,
            url: pr?.html_url,
            state: pr?.state,
            merged: pr?.merged || false,
            draft: pr?.draft || false,
            base_branch: pr?.base?.ref,
            head_branch: pr?.head?.ref,
            sender: sender?.login,
            sender_url: sender?.html_url,
            sender_avatar_url: sender?.avatar_url || null,
          },
        },
        summary: `${sender?.login} ${payload.action} PR #${pr?.number}: ${pr?.title}`,
      };
    }

    case "issues": {
      const issue = payload.issue;
      return {
        event: {
          ...base,
          details: {
            action: payload.action, // opened, closed, reopened, edited, etc.
            repo: repo?.full_name,
            repo_url: repo?.html_url,
            repo_private: repo?.private || false,
            number: issue?.number,
            title: issue?.title,
            url: issue?.html_url,
            state: issue?.state,
            labels: issue?.labels?.map((l) => l.name) || [],
            sender: sender?.login,
            sender_url: sender?.html_url,
            sender_avatar_url: sender?.avatar_url || null,
          },
        },
        summary: `${sender?.login} ${payload.action} issue #${issue?.number}: ${issue?.title}`,
      };
    }

    case "issue_comment": {
      const issue = payload.issue;
      const comment = payload.comment;
      return {
        event: {
          ...base,
          details: {
            action: payload.action, // created, edited, deleted
            repo: repo?.full_name,
            repo_url: repo?.html_url,
            repo_private: repo?.private || false,
            title: issue?.title,
            url: comment?.html_url,
            issue_number: issue?.number,
            issue_title: issue?.title,
            issue_url: issue?.html_url,
            comment_body: comment?.body?.substring(0, 500) || null,
            comment_url: comment?.html_url,
            is_pull_request: !!issue?.pull_request,
            sender: sender?.login,
            sender_url: sender?.html_url,
            sender_avatar_url: sender?.avatar_url || null,
          },
        },
        summary: `${sender?.login} commented on #${issue?.number}: ${issue?.title}`,
      };
    }

    case "release": {
      const release = payload.release;
      return {
        event: {
          ...base,
          details: {
            action: payload.action, // published, created, edited, deleted, etc.
            repo: repo?.full_name,
            repo_url: repo?.html_url,
            repo_private: repo?.private || false,
            title: release?.name || release?.tag_name,
            tag: release?.tag_name,
            name: release?.name,
            url: release?.html_url,
            prerelease: release?.prerelease || false,
            draft: release?.draft || false,
            sender: sender?.login,
            sender_url: sender?.html_url,
            sender_avatar_url: sender?.avatar_url || null,
          },
        },
        summary: `${sender?.login} ${payload.action} release ${release?.tag_name}: ${release?.name}`,
      };
    }

    case "star": {
      return {
        event: {
          ...base,
          details: {
            action: payload.action, // created, deleted
            repo: repo?.full_name,
            repo_url: repo?.html_url,
            repo_private: repo?.private || false,
            stars: repo?.stargazers_count,
            sender: sender?.login,
            sender_url: sender?.html_url,
            sender_avatar_url: sender?.avatar_url || null,
          },
        },
        summary: `${sender?.login} ${payload.action === "created" ? "starred" : "unstarred"} ${repo?.full_name}`,
      };
    }

    case "fork": {
      const forkee = payload.forkee;
      return {
        event: {
          ...base,
          details: {
            action: "fork",
            repo: repo?.full_name,
            repo_url: repo?.html_url,
            repo_private: repo?.private || false,
            title: forkee?.full_name,
            url: forkee?.html_url,
            fork_name: forkee?.full_name,
            fork_url: forkee?.html_url,
            sender: sender?.login,
            sender_url: sender?.html_url,
            sender_avatar_url: sender?.avatar_url || null,
          },
        },
        summary: `${sender?.login} forked ${repo?.full_name}`,
      };
    }

    case "workflow_run": {
      const run = payload.workflow_run;
      return {
        event: {
          ...base,
          details: {
            action: payload.action, // completed, requested, in_progress
            repo: repo?.full_name,
            repo_url: repo?.html_url,
            repo_private: repo?.private || false,
            title: run?.name,
            url: run?.html_url,
            workflow_name: run?.name,
            workflow_url: run?.html_url,
            conclusion: run?.conclusion, // success, failure, cancelled, etc.
            status: run?.status,
            branch: run?.head_branch,
            sender: sender?.login,
            sender_url: sender?.html_url,
            sender_avatar_url: sender?.avatar_url || null,
          },
        },
        summary: `Workflow "${run?.name}" ${run?.conclusion || payload.action} on ${repo?.full_name}`,
      };
    }

    case "check_run": {
      const run = payload.check_run;
      return {
        event: {
          ...base,
          details: {
            action: payload.action, // created, completed, rerequested, etc.
            repo: repo?.full_name,
            repo_url: repo?.html_url,
            repo_private: repo?.private || false,
            title: run?.name,
            url: run?.html_url,
            check_name: run?.name,
            status: run?.status,
            conclusion: run?.conclusion, // success, failure, neutral, cancelled, etc.
            branch: run?.check_suite?.head_branch,
            sender: sender?.login,
            sender_url: sender?.html_url,
            sender_avatar_url: sender?.avatar_url || null,
          },
        },
        summary: `Check "${run?.name}" ${run?.conclusion || run?.status} on ${repo?.full_name}`,
      };
    }

    case "check_suite": {
      const suite = payload.check_suite;
      return {
        event: {
          ...base,
          details: {
            action: payload.action, // completed, requested, rerequested
            repo: repo?.full_name,
            repo_url: repo?.html_url,
            repo_private: repo?.private || false,
            url: repo?.html_url,
            status: suite?.status,
            conclusion: suite?.conclusion, // success, failure, neutral, cancelled, etc.
            branch: suite?.head_branch,
            app_name: suite?.app?.name || null,
            sender: sender?.login,
            sender_url: sender?.html_url,
            sender_avatar_url: sender?.avatar_url || null,
          },
        },
        summary: `Check suite ${suite?.conclusion || suite?.status} on ${suite?.head_branch} in ${repo?.full_name}`,
      };
    }

    case "deployment_status": {
      const deployment = payload.deployment;
      const deployStatus = payload.deployment_status;
      return {
        event: {
          ...base,
          details: {
            action: "deployment_status",
            repo: repo?.full_name,
            repo_url: repo?.html_url,
            repo_private: repo?.private || false,
            title: deployment?.task,
            url: deployStatus?.target_url || deployStatus?.log_url || null,
            environment: deployStatus?.environment || deployment?.environment,
            state: deployStatus?.state, // pending, success, failure, error, inactive
            conclusion: deployStatus?.state, // alias so the standard conclusion filter works
            description: deployStatus?.description || null,
            branch: deployment?.ref,
            sender: sender?.login,
            sender_url: sender?.html_url,
            sender_avatar_url: sender?.avatar_url || null,
          },
        },
        summary: `Deployment to ${deployStatus?.environment || deployment?.environment} ${deployStatus?.state} on ${repo?.full_name}`,
      };
    }

    default:
      return null;
  }
}
