import { afterEach, describe, expect, it, vi } from 'vitest';

const getRunnerInstances = vi.fn();
const createRunnerJob = vi.fn();

vi.mock('$lib/db/local-runners.js', () => ({
  getRunnerInstances,
  createRunnerJob,
}));

afterEach(() => {
  getRunnerInstances.mockReset();
  createRunnerJob.mockReset();
});

describe('gateway dm-runner API', () => {
  it('queues screenshot_capture job targeted by runner name mention', async () => {
    getRunnerInstances.mockResolvedValue([
      { id: 1, runner_token_id: 101, display_name: 'Apollo', hostname: 'apollo-box', token_name: 'Laptop', is_online: true },
      { id: 2, runner_token_id: 202, display_name: 'Dirac', hostname: 'dirac-host', token_name: 'Desktop', is_online: true },
    ]);
    createRunnerJob.mockResolvedValue({ success: true, jobId: 55 });

    const { POST } = await import('../routes/api/gateway/dm-runner/+server.js');

    const request = new Request('http://localhost/api/gateway/dm-runner', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bot test-token',
      },
      body: JSON.stringify({
        userId: 'user-1',
        userName: 'Davis',
        content: 'please take a screenshot of dirac',
        history: [{ role: 'user', content: 'hi' }],
      }),
    });

    const response = await POST({
      request,
      platform: { env: { DB: {}, DISCORD_BOT_TOKEN: 'test-token' } },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.dispatched).toBe(true);
    expect(body.jobId).toBe(55);
    expect(body.runner.id).toBe(2);

    expect(createRunnerJob).toHaveBeenCalledTimes(1);
    const [, , , jobData] = createRunnerJob.mock.calls[0];
    expect(jobData.job_type).toBe('screenshot_capture');
    expect(jobData.target_instance_id).toBe(2);
    expect(jobData.timeout_seconds).toBe(120);
    expect(jobData.payload_json.mode).toBe('all_displays');
    expect(jobData.payload_json.response_target.user_id).toBe('user-1');
  });

  it('queues dm job for non-screenshot messages', async () => {
    getRunnerInstances.mockResolvedValue([
      { id: 9, runner_token_id: 909, display_name: 'Dirac', hostname: 'dirac-host', token_name: 'Desktop', is_online: true },
    ]);
    createRunnerJob.mockResolvedValue({ success: true, jobId: 77 });

    const { POST } = await import('../routes/api/gateway/dm-runner/+server.js');

    const request = new Request('http://localhost/api/gateway/dm-runner', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bot test-token',
      },
      body: JSON.stringify({
        userId: 'user-1',
        userName: 'Davis',
        content: 'run a quick status check',
      }),
    });

    const response = await POST({
      request,
      platform: { env: { DB: {}, DISCORD_BOT_TOKEN: 'test-token' } },
    });

    expect(response.status).toBe(200);
    await response.json();

    const [, , , jobData] = createRunnerJob.mock.calls[0];
    expect(jobData.job_type).toBe('dm');
    expect(jobData.timeout_seconds).toBe(300);
    expect(jobData.payload_json.message).toBe('run a quick status check');
  });
});
