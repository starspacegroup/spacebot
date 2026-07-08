import { describe, expect, it } from 'vitest';
import { buildRunnerInventorySection } from '../lib/ai/chat.js';

/**
 * The runner reports a compact machine summary (system facts + tools + stored
 * memories) in its instance metadata. buildRunnerInventorySection must surface
 * it so the DM brain is grounded on what the machine actually is — the other
 * half of "the runner and the server understand each other" in one turn.
 */

function inventory(runners: any[]) {
	return { ok: true, runners };
}

describe('buildRunnerInventorySection machine context', () => {
	it('renders the runner-reported machine context line', () => {
		const section = buildRunnerInventorySection(
			inventory([
				{
					id: 11,
					display_name: 'Dirac',
					hostname: 'dirac',
					platform: 'linux',
					arch: 'x64',
					is_online: true,
					pending_job_count: 0,
					running_job_count: 0,
					metadata: {
						machineContext:
							'This machine: dirac (linux/x64), 16 CPUs, 32 GiB RAM. Available tools: git, docker, bun.',
					},
				},
			])
		);

		expect(section).toContain('Machine context:');
		expect(section).toContain('Available tools: git, docker, bun');
	});

	it('omits the machine context line when none is reported', () => {
		const section = buildRunnerInventorySection(
			inventory([
				{
					id: 12,
					display_name: 'Bare',
					hostname: 'bare',
					platform: 'linux',
					arch: 'x64',
					is_online: true,
					pending_job_count: 0,
					running_job_count: 0,
					metadata: {},
				},
			])
		);

		expect(section).not.toContain('Machine context:');
	});

	it('truncates very long machine context and flattens newlines', () => {
		const long = 'x'.repeat(2000);
		const section = buildRunnerInventorySection(
			inventory([
				{
					id: 13,
					display_name: 'Big',
					hostname: 'big',
					is_online: true,
					pending_job_count: 0,
					running_job_count: 0,
					metadata: { machineContext: `line one\nline two\n${long}` },
				},
			])
		);

		const contextLine = section.split('\n').find((l) => l.includes('Machine context:')) ?? '';
		expect(contextLine).toContain('…');
		expect(contextLine.length).toBeLessThan(1000);
	});
});
