import { describe, expect, it } from 'vitest';
import { createRunnerJob } from '../lib/db/local-runners.js';

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    return this.db.execute(this.sql, this.args, 'first');
  }

  async run() {
    return this.db.execute(this.sql, this.args, 'run');
  }
}

class FakeDb {
  constructor() {
    this.tokenRows = [{ id: 10, user_id: 'user-1', revoked: 0 }];
    this.instanceRows = [{ id: 22, runner_token_id: 10, user_id: 'user-1' }];
    this.inserted = [];
    this.nextId = 100;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  execute(sql, args) {
    if (sql.includes('SELECT id FROM local_runner_tokens WHERE id = ? AND user_id = ? AND revoked = 0')) {
      const [tokenId, userId] = args;
      return this.tokenRows.find((t) => t.id === tokenId && t.user_id === userId && t.revoked === 0) || null;
    }

    if (sql.includes('FROM local_runner_instances') && sql.includes('WHERE id = ? AND runner_token_id = ? AND user_id = ?')) {
      const [instanceId, tokenId, userId] = args;
      return this.instanceRows.find((i) => i.id === instanceId && i.runner_token_id === tokenId && i.user_id === userId) || null;
    }

    if (sql.includes('INSERT INTO local_runner_jobs')) {
      const [tokenId, userId, command, workingDir, label, targetInstanceId, jobType, payloadJson] = args;
      const row = {
        id: this.nextId++,
        tokenId,
        userId,
        command,
        workingDir,
        label,
        targetInstanceId,
        jobType,
        payloadJson,
      };
      this.inserted.push(row);
      return { id: row.id };
    }

    throw new Error(`Unhandled SQL: ${sql}`);
  }
}

describe('createRunnerJob typed behavior', () => {
  it('requires command for shell_command jobs', async () => {
    const db = new FakeDb();
    const result = await createRunnerJob(db, 'user-1', 10, {
      job_type: 'shell_command',
      command: '   ',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Command is required');
  });

  it('allows non-shell job without command and stores payload JSON', async () => {
    const db = new FakeDb();
    const result = await createRunnerJob(db, 'user-1', 10, {
      job_type: 'system_profile',
      label: 'Collect profile',
      payload_json: { includeTools: true },
      target_instance_id: 22,
    });

    expect(result.success).toBe(true);
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0].command).toBe('[system_profile]');
    expect(db.inserted[0].jobType).toBe('system_profile');
    expect(db.inserted[0].payloadJson).toBe(JSON.stringify({ includeTools: true }));
  });

  it('rejects non-serializable payload JSON', async () => {
    const db = new FakeDb();
    const circular = {};
    circular.self = circular;

    const result = await createRunnerJob(db, 'user-1', 10, {
      job_type: 'system_profile',
      payload_json: circular,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('serializable JSON');
  });
});
