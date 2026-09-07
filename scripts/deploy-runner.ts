import { execSync } from 'child_process';
import {
	closeSync,
	existsSync,
	openSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'fs';
import { join } from 'path';

const MAIN_BRANCH = 'main';
const REMOTE_NAME = 'origin';
const DEPLOY_LOCK_PATH = join(process.cwd(), '.deploy.lock');
const STALE_LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * The last revision that made it all the way to the restart.
 *
 * The poller used to ask only whether the checkout matched the remote, which
 * says nothing about whether the running processes were ever replaced. A deploy
 * that fast-forwards and then dies — a failing `db:migrate` was how it happened
 * — leaves the two equal and the old processes alive, so the next poll sees
 * nothing to do and the box sits on new code it is not running. That is how the
 * gateway ran for hours without the channel sync that had already been merged.
 *
 * Recording what was deployed, rather than what was fetched, makes that state
 * retryable: the checkout is already right, so the retry skips the merge and
 * picks up from the step that failed.
 */
const DEPLOY_STATE_PATH = join(process.cwd(), '.deploy-state.json');

function readDeployedHead() {
	try {
		if (!existsSync(DEPLOY_STATE_PATH)) return null;
		const parsed = JSON.parse(readFileSync(DEPLOY_STATE_PATH, 'utf8'));
		return typeof parsed?.deployedHead === 'string' ? parsed.deployedHead : null;
	} catch {
		// An unreadable marker is the same as not having one.
		return null;
	}
}

/** Written immediately before the restart, for the same reason the lock is
 *  released there: `pm2 restart` kills this process before anything after it
 *  runs. It records intent to restart, which is the last thing this process can
 *  honestly claim. */
function writeDeployedHead(head) {
	if (!head) return;
	try {
		writeFileSync(
			DEPLOY_STATE_PATH,
			JSON.stringify({ deployedHead: head, at: new Date().toISOString() })
		);
	} catch (err) {
		// Not fatal: the worst case is the old behaviour, one missed retry.
		console.warn(`  ⚠️  Could not record deployed revision: ${err.message}`);
	}
}

function _runInDir(cmd, cwd) {
	console.log(`  → (${cwd}) ${cmd}`);
	return execSync(cmd, { stdio: 'inherit', cwd });
}

function execRead(cmd) {
	return execSync(cmd, {
		cwd: process.cwd(),
		stdio: ['ignore', 'pipe', 'pipe'],
	})
		.toString()
		.trim();
}

export function run(cmd) {
	console.log(`  → ${cmd}`);
	return execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
}

function withDeployLock(fn) {
	let fd;

	try {
		fd = openSync(DEPLOY_LOCK_PATH, 'wx');
	} catch (err) {
		if (err?.code === 'EEXIST') {
			// Check if lock is stale (older than STALE_LOCK_TIMEOUT_MS)
			try {
				const lockStat = statSync(DEPLOY_LOCK_PATH);
				const ageMs = Date.now() - lockStat.mtimeMs;
				if (ageMs > STALE_LOCK_TIMEOUT_MS) {
					console.log(
						`⚠️  Stale deploy lock detected (${Math.round(ageMs / 1000)}s old) — removing`
					);
					unlinkSync(DEPLOY_LOCK_PATH);
					fd = openSync(DEPLOY_LOCK_PATH, 'wx');
				} else {
					throw new Error('Another deployment is already in progress');
				}
			} catch (staleErr) {
				if (staleErr.message === 'Another deployment is already in progress')
					throw staleErr;
				// Lock file disappeared between check and remove — try again
				try {
					fd = openSync(DEPLOY_LOCK_PATH, 'wx');
				} catch {
					throw new Error('Another deployment is already in progress');
				}
			}
		} else {
			throw err;
		}
	}

	try {
		return fn();
	} finally {
		if (fd !== undefined) {
			closeSync(fd);
		}
		try {
			unlinkSync(DEPLOY_LOCK_PATH);
		} catch {
			// Already removed or never created
		}
	}
}

export interface DeployOptions {
	branch?: string;
	remote?: string;
	trigger?: string;
	/** Revision to deploy. Absent means "whatever a fast-forward pull brings". */
	remoteHead?: string;
	/** A previous deploy updated the checkout and died before restarting. */
	stranded?: boolean;
}

export function deploy(changedFiles: string[], options: DeployOptions = {}) {
	return withDeployLock(() => {
		const branch = options.branch || MAIN_BRANCH;
		const remote = options.remote || REMOTE_NAME;
		const trigger = options.trigger || 'manual';
		const remoteHead = options.remoteHead;
		const stranded = options.stranded === true;
		const start = Date.now();

		console.log(`\n🚀 [${new Date().toISOString()}] Deploying (${trigger})...`);

		try {
			// A resumed deploy is already sitting on the revision it is
			// deploying, so there is nothing to merge.
			if (stranded) {
				console.log(
					`  ↩️  Resuming a deploy that reached the checkout but never restarted (${(remoteHead || '').slice(0, 7)})`
				);
			} else {
				if (remoteHead) {
					run(`git merge --ff-only ${remoteHead}`);
				} else {
					run(`git pull --ff-only ${remote} ${branch}`);
				}
			}

			const needsInstall = changedFiles.some(
				(file) => file === 'package.json' || file === 'bun.lock'
			);
			if (needsInstall) {
				console.log('  📦 Dependency manifest changed — installing dependencies...');
				run('bun install --frozen-lockfile');
			}

			const needsMigrations = changedFiles.some(
				(file) => file.startsWith('migrations/') && file.endsWith('.sql')
			);
			if (needsMigrations) {
				console.log('  🗄️  Migration files changed — running database migrations...');
				run('bun run db:migrate');
			} else {
				console.log('  ⏭️  No migration file changes — skipping db:migrate');
			}

			// Both of these happen BEFORE pm2 restart, because pm2 restart kills
			// this process (SIGTERM) before anything after it runs.
			writeDeployedHead(remoteHead || execRead('git rev-parse HEAD'));

			try {
				unlinkSync(DEPLOY_LOCK_PATH);
			} catch {
				/* already removed */
			}

			run('pm2 restart ecosystem.config.cjs --update-env');

			const elapsed = ((Date.now() - start) / 1000).toFixed(1);
			console.log(`✅ Deploy complete in ${elapsed}s\n`);
		} catch (err) {
			console.error(`❌ Deploy failed: ${err.message}\n`);
			throw err;
		}
	});
}

/**
 * Whether there is anything to deploy, and what to compare against.
 *
 * Three states matter:
 *
 * - The checkout is behind the remote. An ordinary deploy, measured from the
 *   checkout.
 * - The checkout matches the remote but the marker does not. A previous deploy
 *   updated the checkout and then died before restarting anything, so the box
 *   is running code it no longer has. Resume it, measured from the last
 *   revision that actually ran, so install and migrate still see every change
 *   this box has not acted on.
 * - Everything agrees, or there is no marker at all. Nothing to do. A missing
 *   marker is deliberately not treated as stranded: a box that has never
 *   written one is not evidence of a failed deploy, and guessing otherwise
 *   would restart every box once on upgrade.
 */
export function decideDeployAction(localHead, remoteHead, deployedHead) {
	if (localHead !== remoteHead) {
		return { stranded: false, since: localHead };
	}
	if (deployedHead && deployedHead !== remoteHead) {
		return { stranded: true, since: deployedHead };
	}
	return null;
}

export function getRemoteDeployPlan(options: DeployOptions = {}) {
	const branch = options.branch || MAIN_BRANCH;
	const remote = options.remote || REMOTE_NAME;
	const remoteRef = `${remote}/${branch}`;

	run(`git fetch ${remote} ${branch}`);

	const localHead = execRead('git rev-parse HEAD');
	const remoteHead = execRead(`git rev-parse ${remoteRef}`);
	const deployedHead = readDeployedHead();

	const action = decideDeployAction(localHead, remoteHead, deployedHead);
	if (!action) {
		return null;
	}

	const { stranded, since } = action;
	const changedOutput = execRead(`git diff --name-only ${since}..${remoteRef}`);
	const changedFiles = changedOutput ? changedOutput.split(/\r?\n/).filter(Boolean) : [];

	return {
		branch,
		remote,
		localHead,
		remoteHead,
		changedFiles,
		stranded,
	};
}
