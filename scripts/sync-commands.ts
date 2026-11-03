#!/usr/bin/env bun
/**
 * Sync every server's slash commands now (the post-deploy path).
 *
 *   SPACEBOT_API_BASE=https://… CRON_SECRET=… bun run sync-commands [--sha <commit>]
 *
 * With --sha (the deploy workflow passes the pushed commit) it first waits
 * until the live build is that commit. The minute sweep stays the backstop.
 */
import { syncAllGuilds, waitForVersion } from '../src/lib/server/post-deploy-sync.ts';

const base = String(process.env.SPACEBOT_API_BASE || '').replace(/\/+$/, '');
const secret = process.env.CRON_SECRET || '';
const shaFlag = process.argv.indexOf('--sha');
const sha = shaFlag > -1 ? process.argv[shaFlag + 1] : undefined;

if (!base || !secret) {
	console.error('SPACEBOT_API_BASE and CRON_SECRET must be set.');
	process.exit(2);
}

const log = (line: string) => console.log(line);
if (!(await waitForVersion({ base, secret, sha, log }))) {
	console.error(`The live build never became ${sha}; leaving it to the minute sweep.`);
	process.exit(1);
}
const total = await syncAllGuilds({ base, secret, log });
console.log(`Synced ${total.synced}, failed ${total.failed}, checked ${total.checked}.`);
process.exit(total.failed ? 1 : 0);
