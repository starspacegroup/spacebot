import { execSync } from 'child_process';
import { closeSync, mkdtempSync, openSync, rmSync, statSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const MAIN_BRANCH = 'main';
const REMOTE_NAME = 'origin';
const DEPLOY_LOCK_PATH = join(process.cwd(), '.deploy.lock');
const VALIDATION_BUILD_CMD = process.env.DEPLOY_BUILD_CMD || 'npm run build';
const STALE_LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function runInDir(cmd, cwd) {
	console.log(`  → (${cwd}) ${cmd}`);
	return execSync(cmd, { stdio: 'inherit', cwd });
}

function execRead(cmd) {
	return execSync(cmd, {
		cwd: process.cwd(),
		stdio: ['ignore', 'pipe', 'pipe'],
	}).toString().trim();
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
					console.log(`⚠️  Stale deploy lock detected (${Math.round(ageMs / 1000)}s old) — removing`);
					unlinkSync(DEPLOY_LOCK_PATH);
					fd = openSync(DEPLOY_LOCK_PATH, 'wx');
				} else {
					throw new Error('Another deployment is already in progress');
				}
			} catch (staleErr) {
				if (staleErr.message === 'Another deployment is already in progress') throw staleErr;
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

function validateRemoteRevision(remoteHead) {
	const tempDir = mkdtempSync(join(tmpdir(), 'spacebot-deploy-'));

	try {
		run(`git worktree add --detach "${tempDir}" ${remoteHead}`);
		runInDir('npm install', tempDir);
		runInDir(VALIDATION_BUILD_CMD, tempDir);
	} finally {
		try {
			run(`git worktree remove --force "${tempDir}"`);
		} catch {
			rmSync(tempDir, { recursive: true, force: true });
		}
	}
}

export function deploy(changedFiles, options = {}) {
	return withDeployLock(() => {
		const branch = options.branch || MAIN_BRANCH;
		const remote = options.remote || REMOTE_NAME;
		const trigger = options.trigger || 'manual';
		const remoteHead = options.remoteHead;
		const start = Date.now();

		console.log(`\n🚀 [${new Date().toISOString()}] Deploying (${trigger})...`);

		try {
			if (remoteHead) {
				console.log(`  🔎 Validating remote revision ${remoteHead.slice(0, 7)} before updating live checkout...`);
				validateRemoteRevision(remoteHead);
			}

			if (remoteHead) {
				run(`git merge --ff-only ${remoteHead}`);
			} else {
				run(`git pull --ff-only ${remote} ${branch}`);
			}

			const needsInstall = changedFiles.some(file =>
				file === 'package.json' || file === 'package-lock.json' || file === 'bun.lockb'
			);
			if (needsInstall) {
				console.log('  📦 Dependency manifest changed — installing dependencies...');
				run('npm install');
			}

			const needsMigrate = changedFiles.some(file => file.startsWith('migrations/'));
			if (needsMigrate) {
				console.log('  🗃️  Migration files changed — running migrations...');
				run('npm run db:migrate');
			}

			// Remove the deploy lock BEFORE pm2 restart, because pm2 restart
			// kills this process (SIGTERM) before the finally block can run.
			try { unlinkSync(DEPLOY_LOCK_PATH); } catch { /* already removed */ }

			run('pm2 restart ecosystem.config.cjs --update-env');

			const elapsed = ((Date.now() - start) / 1000).toFixed(1);
			console.log(`✅ Deploy complete in ${elapsed}s\n`);
		} catch (err) {
			console.error(`❌ Deploy failed: ${err.message}\n`);
			throw err;
		}
	});
}

export function getRemoteDeployPlan(options = {}) {
	const branch = options.branch || MAIN_BRANCH;
	const remote = options.remote || REMOTE_NAME;
	const remoteRef = `${remote}/${branch}`;

	run(`git fetch ${remote} ${branch}`);

	const localHead = execRead('git rev-parse HEAD');
	const remoteHead = execRead(`git rev-parse ${remoteRef}`);

	if (localHead === remoteHead) {
		return null;
	}

	const changedOutput = execRead(`git diff --name-only ${localHead}..${remoteRef}`);
	const changedFiles = changedOutput ? changedOutput.split(/\r?\n/).filter(Boolean) : [];

	return {
		branch,
		remote,
		localHead,
		remoteHead,
		changedFiles,
	};
}