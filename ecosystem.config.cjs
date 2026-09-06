const { execSync } = require('child_process');
const { existsSync } = require('fs');
const { homedir } = require('os');
const { join } = require('path');

const apiBase = process.env.API_BASE || process.env.APP_URL || 'https://spacebot.starspace.group';
const tunnelName = process.env.CLOUDFLARED_TUNNEL_NAME || 'spacebot';
const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();

function resolveOriginCertPath() {
	const configuredCert = process.env.TUNNEL_ORIGIN_CERT || process.env.CLOUDFLARED_ORIGIN_CERT;
	const candidates = [
		configuredCert,
		join(homeDir, '.cloudflared', 'cert.pem'),
		'/etc/cloudflared/cert.pem',
		'/usr/local/etc/cloudflared/cert.pem',
	].filter(Boolean);

	return candidates.find((candidate) => existsSync(candidate));
}

const originCertPath = resolveOriginCertPath();

function resolveTunnelArgs() {
	const configuredToken = process.env.TUNNEL_TOKEN || process.env.CLOUDFLARED_TUNNEL_TOKEN;
	if (configuredToken) {
		return `tunnel run --token ${configuredToken}`;
	}

	if (originCertPath) {
		try {
			const generatedToken = execSync(`cloudflared tunnel token ${tunnelName}`, {
				stdio: ['ignore', 'pipe', 'ignore'],
				env: {
					...process.env,
					HOME: homeDir,
					TUNNEL_ORIGIN_CERT: originCertPath,
				},
			})
				.toString()
				.trim();

			if (generatedToken) {
				return `tunnel run --token ${generatedToken}`;
			}
		} catch {
			// Fall back to named-tunnel mode when the local machine is not authenticated.
		}
	}

	return `tunnel run ${tunnelName}`;
}

const tunnelArgs = resolveTunnelArgs();

module.exports = {
	apps: [
		{
			name: 'spacebot-gateway',
			script: 'src/lib/discord/gateway-launcher.cjs',
			interpreter: 'bun',
			env: {
				NODE_ENV: 'production',
				API_BASE: apiBase,
			},
			// Restart policy
			max_restarts: 10,
			min_uptime: '10s',
			restart_delay: 5000,
			// Logging
			error_file: 'logs/gateway-error.log',
			out_file: 'logs/gateway-out.log',
			merge_logs: true,
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			// Graceful shutdown
			kill_timeout: 10000,
			listen_timeout: 30000,
			// Watch (disabled in production — enable for dev if desired)
			watch: false,
		},
		{
			name: 'spacebot-tunnel',
			script: 'cloudflared',
			args: tunnelArgs,
			env: {
				HOME: homeDir,
				...(originCertPath ? { TUNNEL_ORIGIN_CERT: originCertPath } : {}),
			},
			// Restart policy
			max_restarts: 10,
			min_uptime: '10s',
			restart_delay: 5000,
			// Logging
			error_file: 'logs/tunnel-error.log',
			out_file: 'logs/tunnel-out.log',
			merge_logs: true,
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			// Graceful shutdown
			kill_timeout: 10000,
			listen_timeout: 30000,
			watch: false,
		},
		{
			name: 'spacebot-deploy',
			script: 'scripts/deploy-webhook.ts',
			// bun, not node: these scripts are TypeScript and import siblings with
			// TS-style `.js` specifiers. Node's type stripping runs the file but
			// does not rewrite `.js` -> `.ts`, so every import of `../src/lib/*.js`
			// dies with ERR_MODULE_NOT_FOUND — and PM2's fork container survives it,
			// leaving a process that reports `online` while doing nothing at all.
			// That is how the deploy poller sat dead for weeks while the box drifted
			// 24 commits behind main.
			interpreter: 'bun',
			env: {
				NODE_ENV: 'production',
			},
			// Restart policy
			max_restarts: 10,
			min_uptime: '10s',
			restart_delay: 5000,
			// Logging
			error_file: 'logs/deploy-error.log',
			out_file: 'logs/deploy-out.log',
			merge_logs: true,
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			// Graceful shutdown
			kill_timeout: 5000,
			listen_timeout: 10000,
			watch: false,
		},
		{
			// Deploy-poll only: workflow scheduling moved to the orchestrator
			// worker's Cloudflare Cron Trigger (see orchestrator-worker/).
			name: 'spacebot-cron',
			script: 'scripts/cron.ts',
			// See the note on spacebot-deploy. The old
			// `--experimental-specifier-resolution=node` arg was the attempted fix
			// for the same import problem; that flag no longer exists in current
			// Node, so it silently did nothing.
			interpreter: 'bun',
			env: {
				NODE_ENV: 'production',
				API_BASE: apiBase,
			},
			// Restart policy
			max_restarts: 10,
			min_uptime: '10s',
			restart_delay: 5000,
			// Logging
			error_file: 'logs/cron-error.log',
			out_file: 'logs/cron-out.log',
			merge_logs: true,
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			// Graceful shutdown
			kill_timeout: 5000,
			listen_timeout: 10000,
			watch: false,
		},
	],
};
