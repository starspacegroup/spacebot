import { describe, expect, it } from "vitest";
import { matchesFilters } from "../lib/automation/engine.js";
import { parseGitHubEvent } from "../lib/integrations/github.js";

describe("GitHub visibility handling", () => {
  it("captures explicit repository visibility from webhook payloads", () => {
    const parsed = parseGitHubEvent(
      "workflow_run",
      {
        action: "completed",
        repository: {
          full_name: "owner/repo",
          html_url: "https://github.com/owner/repo",
          private: false,
          visibility: "internal",
        },
        sender: {
          login: "octocat",
          type: "User",
        },
        workflow_run: {
          name: "CI",
          html_url: "https://github.com/owner/repo/actions/runs/1",
          conclusion: "success",
          status: "completed",
          head_branch: "main",
        },
      },
      "123",
    );

    expect(parsed?.event.details.repo_visibility).toBe("internal");
  });

  it("matches explicit repo visibility instead of inferring from repo_private alone", () => {
    const event = {
      event_type: "GITHUB_WORKFLOW_RUN",
      details: {
        repo_visibility: "internal",
        repo_private: false,
      },
    };

    expect(matchesFilters(event, { github_repo_visibility: "internal" })).toBe(
      true,
    );
    expect(matchesFilters(event, { github_repo_visibility: "public" })).toBe(
      false,
    );
  });

  it("falls back to repo_private for older payloads without visibility", () => {
    const event = {
      event_type: "GITHUB_PUSH",
      details: {
        repo_private: true,
      },
    };

    expect(matchesFilters(event, { github_repo_visibility: "private" })).toBe(
      true,
    );
    expect(matchesFilters(event, { github_repo_visibility: "public" })).toBe(
      false,
    );
  });

  it("treats github repo filter value any as no filter", () => {
    const event = {
      event_type: "GITHUB_PUSH",
      details: {
        repo: "owner/repo",
      },
    };

    expect(matchesFilters(event, { github_repo: "any" })).toBe(true);
  });

  it("treats github repo filter value ALL as no filter", () => {
    const event = {
      event_type: "GITHUB_PUSH",
      details: {
        repo: "owner/repo",
      },
    };

    expect(matchesFilters(event, { github_repo: "ALL" })).toBe(true);
  });

  it("matches when repository is in a comma-separated github_repo filter list", () => {
    const event = {
      event_type: "GITHUB_PUSH",
      details: {
        repo: "starspacegroup/spacebot",
      },
    };

    expect(
      matchesFilters(event, {
        github_repo: "owner/repo,starspacegroup/spacebot",
      }),
    ).toBe(true);
    expect(matchesFilters(event, { github_repo: "owner/repo,another/repo" }))
      .toBe(false);
  });

  it("matches github_action completed from check_run status when action is created", () => {
    const event = {
      event_type: "GITHUB_CHECK_RUN",
      details: {
        action: "created",
        status: "completed",
        conclusion: "success",
      },
    };

    expect(matchesFilters(event, { github_action: "completed" })).toBe(true);
    expect(matchesFilters(event, { github_action: "created" })).toBe(true);
  });

  it("does not match github_action completed when neither action nor status are completed", () => {
    const event = {
      event_type: "GITHUB_CHECK_RUN",
      details: {
        action: "rerequested",
        status: "queued",
      },
    };

    expect(matchesFilters(event, { github_action: "completed" })).toBe(false);
  });
});
