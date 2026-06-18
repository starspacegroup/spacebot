import { describe, it, expect } from 'vitest';
import { buildContext, processTemplate } from '../lib/automation/engine.js';

describe('GitHub template context normalization', () => {
  it('maps pull request head_branch to github.branch', () => {
    const context = buildContext({
      actor_id: null,
      actor_name: 'octocat',
      target_id: null,
      target_name: 'owner/repo',
      channel_id: null,
      channel_name: null,
      guild_id: '123',
      event_type: 'GITHUB_PULL_REQUEST',
      event_category: 'github',
      details: {
        repo: 'owner/repo',
        head_branch: 'feature/add-thing',
        base_branch: 'main',
        sender: 'octocat',
        action: 'opened',
        title: 'Add thing',
        url: 'https://github.com/owner/repo/pull/1',
      },
    });

    expect(context.github.branch).toBe('feature/add-thing');
  });

  it('provides title/url fallbacks for issue comments', () => {
    const context = buildContext({
      actor_id: null,
      actor_name: 'octocat',
      target_id: null,
      target_name: 'owner/repo',
      channel_id: null,
      channel_name: null,
      guild_id: '123',
      event_type: 'GITHUB_ISSUE_COMMENT',
      event_category: 'github',
      details: {
        repo: 'owner/repo',
        issue_title: 'Bug report',
        comment_url: 'https://github.com/owner/repo/issues/1#issuecomment-1',
        sender: 'octocat',
        action: 'created',
      },
    });

    expect(context.github.title).toBe('Bug report');
    expect(context.github.url).toBe('https://github.com/owner/repo/issues/1#issuecomment-1');
  });

  it('renders normalized GitHub variables in message templates', () => {
    const context = buildContext({
      actor_id: null,
      actor_name: 'octocat',
      target_id: null,
      target_name: 'owner/repo',
      channel_id: null,
      channel_name: null,
      guild_id: '123',
      event_type: 'GITHUB_PULL_REQUEST',
      event_category: 'github',
      details: {
        repo: 'owner/repo',
        head_branch: 'feature/add-thing',
        sender: 'octocat',
        action: 'opened',
        title: 'Add thing',
        url: 'https://github.com/owner/repo/pull/1',
      },
    });

    const rendered = processTemplate('{github.repo} {github.branch} {github.sender} {github.action} {github.title} {github.url}', context);

    expect(rendered).toBe(
      'owner/repo feature/add-thing octocat opened Add thing https://github.com/owner/repo/pull/1',
    );
  });
});
