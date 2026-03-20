/**
 * Production Startup Script
 * Ensures all dependencies (cloudflared, pm2) are installed,
 * then starts the gateway and tunnel via PM2.
 *
 * Usage:
 *   node scripts/prod-start.js
 */

import { execSync, spawnSync } from 'child_process';
import { platform } from 'os';

const os = platform();

function commandExists(cmd) {
	try {
		const check = os === 'win32' ? `where ${cmd}` : `which ${cmd}`;
		execSync(check, { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

function run(cmd, label) {
	console.log(`  → ${cmd}`);
	try {
		execSync(cmd, { stdio: 'inherit' });
	} catch (err) {
		console.error(`\n❌ Failed: ${label || cmd}`);
		process.exit(1);
	}
}

// --- Check and install cloudflared ---
console.log('\n🔍 Checking for cloudflared...');
if (commandExists('cloudflared')) {
	const version = execSync('cloudflared --version', { stdio: 'pipe' }).toString().trim();
	console.log(`  ✅ ${version}`);
} else {
	console.log('  ⚠️  cloudflared not found. Installing...\n');

	if (os === 'win32') {
		if (commandExists('winget')) {
			run('winget install --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements', 'install cloudflared via winget');
		} else {
			console.error('❌ Please install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
			process.exit(1);
		}
	} else if (os === 'darwin') {
		if (commandExists('brew')) {
			run('brew install cloudflared', 'install cloudflared via brew');
		} else {
			console.error('❌ Please install Homebrew first, or install cloudflared manually.');
			process.exit(1);
		}
	} else {
		// Linux — use the official Cloudflare package repo
		try {
			run('curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null', 'add cloudflare GPG key');
			run('echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list', 'add cloudflare repo');
			run('sudo apt-get update && sudo apt-get install -y cloudflared', 'install cloudflared via apt');
		} catch {
			console.error('❌ Auto-install failed. Please install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
			process.exit(1);
		}
	}

	// Verify it installed
	if (!commandExists('cloudflared')) {
		console.error('❌ cloudflared installation did not succeed. Please install it manually.');
		process.exit(1);
	}
	console.log('  ✅ cloudflared installed successfully.');
}

// --- Check and install PM2 ---
console.log('\n🔍 Checking for pm2...');
if (commandExists('pm2')) {
	console.log('  ✅ pm2 is available.');
} else {
	console.log('  ⚠️  pm2 not found. Installing globally...\n');
	const npmCmd = commandExists('bun') ? 'bun add -g pm2' : 'npm install -g pm2';
	run(npmCmd, 'install pm2');
	if (!commandExists('pm2')) {
		console.error('❌ pm2 installation did not succeed. Please install it manually.');
		process.exit(1);
	}
	console.log('  ✅ pm2 installed successfully.');
}

// --- Start everything via PM2 ---
console.log('\n🚀 Starting production services via PM2...\n');
run('pm2 start ecosystem.config.cjs', 'pm2 start');

console.log('\n✅ Production services started.');
console.log('   • spacebot-gateway  — Discord gateway bot');
console.log('   • spacebot-tunnel   — Cloudflare tunnel (spacebot-prod.starspace.group)\n');
console.log('   Run "npm run gateway:status" to check status.');
console.log('   Run "npm run gateway:logs" to view logs.\n');
