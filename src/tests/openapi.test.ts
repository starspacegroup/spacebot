import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openApiDocument } from '$lib/openapi.js';

const ROOT = 'src/routes/api/v1';

// Not part of the bearer-key API: the connect flow, the MCP transport and the
// integration push routes (a GitHub webhook, an integration's own events,
// heartbeat and sync) have their own auth and their own docs.
const EXCLUDED = [
	'/connect',
	'/mcp',
	'/integrations/events',
	'/integrations/github',
	'/integrations/heartbeat',
	'/integrations/sync',
];

function routes(dir: string, prefix = ''): string[] {
	const found: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			const segment = name.replace(/^\[(.+)\]$/, '{$1}');
			found.push(...routes(full, `${prefix}/${segment}`));
		} else if (name === '+server.ts') {
			found.push(prefix);
		}
	}
	return found;
}

describe('openapi document', () => {
	it('describes every bearer-key route under /api/v1', () => {
		const wanted = routes(ROOT).filter(
			(route) => route && !EXCLUDED.some((skip) => route.startsWith(skip))
		);
		const documented = Object.keys(openApiDocument.paths);
		expect(wanted.filter((route) => !documented.includes(route))).toEqual([]);
	});
});
