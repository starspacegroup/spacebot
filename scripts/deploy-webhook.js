/**
 * Deploy Webhook Server
 * Listens for GitHub push events on the `main` branch and auto-deploys.
 *
 * Setup:
 *   1. Set DEPLOY_WEBHOOK_SECRET env var (same secret you use in GitHub webhook settings)
 *   2. Add a GitHub webhook pointing to https://spacebot.starspace.group/deploy
 *      - Content type: application/json
 *      - Secret: your DEPLOY_WEBHOOK_SECRET
 *      - Events: Just the push event
 *   3. Add a route in your cloudflared config for /deploy -> localhost:9090
 *
 * The webhook will:
 *   - Validate the GitHub signature
 *   - git pull origin main
 *   - npm install (if package.json changed)
 *   - Run migrations (if migrations/ changed)
 *   - pm2 restart spacebot-gateway
 */

import { createServer } from 'http';
import { createHmac, timingSafeEqual } from 'crypto';
import { loadSecrets, getSecret } from '../src/lib/secrets.js';
import { deploy } from './deploy-runner.js';

// Load dotenv first, then override with GCP secrets if available
import 'dotenv/config';
await loadSecrets();

const PORT = getSecret('DEPLOY_WEBHOOK_PORT') || 9090;
const SECRET = getSecret('DEPLOY_WEBHOOK_SECRET');
const BRANCH = 'main';

if (!SECRET) {
	console.error('❌ DEPLOY_WEBHOOK_SECRET environment variable is required.');
	process.exit(1);
}

function verifySignature(payload, signature) {
	if (!signature) return false;
	const expected = 'sha256=' + createHmac('sha256', SECRET).update(payload).digest('hex');
	try {
		return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
	} catch {
		return false;
	}
}

const server = createServer((req, res) => {
	// Health check
	if (req.method === 'GET') {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('ok');
		return;
	}

	if (req.method !== 'POST') {
		res.writeHead(405);
		res.end();
		return;
	}

	const chunks = [];
	req.on('data', chunk => chunks.push(chunk));
	req.on('end', () => {
		const body = Buffer.concat(chunks);

		// Verify signature
		const signature = req.headers['x-hub-signature-256'];
		if (!verifySignature(body, signature)) {
			console.log(`⚠️  [${new Date().toISOString()}] Invalid signature — rejected`);
			res.writeHead(401);
			res.end('Invalid signature');
			return;
		}

		// Parse event
		const event = req.headers['x-github-event'];
		if (event !== 'push') {
			res.writeHead(200);
			res.end('Ignored event: ' + event);
			return;
		}

		let payload;
		try {
			payload = JSON.parse(body.toString());
		} catch {
			res.writeHead(400);
			res.end('Invalid JSON');
			return;
		}

		// Only deploy on pushes to main
		const ref = payload.ref;
		if (ref !== `refs/heads/${BRANCH}`) {
			console.log(`ℹ️  Push to ${ref} — skipping (not ${BRANCH})`);
			res.writeHead(200);
			res.end(`Ignored push to ${ref}`);
			return;
		}

		// Collect changed files from commits
		const changedFiles = new Set();
		for (const commit of payload.commits || []) {
			for (const f of [...(commit.added || []), ...(commit.modified || []), ...(commit.removed || [])]) {
				changedFiles.add(f);
			}
		}

		// Respond immediately, deploy async
		res.writeHead(200);
		res.end('Deploying...');

		try {
			deploy([...changedFiles], { trigger: 'webhook', remoteHead: payload.after });
		} catch {
			// Errors are already logged inside the deploy runner.
		}
	});
});

server.listen(PORT, () => {
	console.log(`\n🔗 Deploy webhook listening on port ${PORT}`);
	console.log(`   Watching for pushes to ${BRANCH}\n`);
});
