import { json } from '@sveltejs/kit';
import { getGlobalSetting, getGlobalSettings, setGlobalSetting } from '$lib/db/global-settings.js';
import { listGatewayLogs, recordGatewayLogs } from '$lib/db/gateway-logs.js';
import { log } from '$lib/log.js';

const GATEWAY_LOG_CAPTURE_KEY = 'gateway_log_capture_enabled';
const GATEWAY_LOG_LAST_SEEN_AT_KEY = 'gateway_log_capture_last_seen_at';
const GATEWAY_LOG_LAST_POST_AT_KEY = 'gateway_log_capture_last_post_at';
const GATEWAY_LOG_LAST_STORED_COUNT_KEY = 'gateway_log_capture_last_stored_count';
const GATEWAY_UPDATE_REQUIRED_VERSION_KEY = 'gateway_update_required_version';
const GATEWAY_UPDATE_LAST_ATTEMPT_KEY = 'gateway_update_last_attempt';
const DEFAULT_LOG_LIMIT = 150;

// How stale the stored heartbeat has to be before a bot poll rewrites it.
// The gateway polls this endpoint continuously, so writing on every poll made
// this one key the single most-written row in the database. The connected
// window is sized to comfortably clear one write interval plus a poll gap.
const GATEWAY_HEARTBEAT_WRITE_INTERVAL_MS = 30_000;
export const GATEWAY_LOG_CONNECTED_WINDOW_MS = 90_000;

function getEnv(name, platform) {
	return (
		platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined)
	);
}

function parseJsonSafe(value) {
	if (!value || typeof value !== 'string') return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function normalizeVersion(value) {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function getFrontendVersion(platform) {
	return (
		normalizeVersion(getEnv('SPACEBOT_FRONTEND_VERSION', platform)) ??
		normalizeVersion(getEnv('npm_package_version', platform)) ??
		'0.0.0'
	);
}

export function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;
	const adminUserIds = getEnv('ADMIN_USER_IDS', platform) || '';
	return adminUserIds
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean)
		.includes(userId);
}

function checkIsBotRequest(request, platform) {
	const authHeader = request.headers.get('Authorization');
	const botToken = getEnv('DISCORD_BOT_TOKEN', platform);
	return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

async function getCaptureEnabled(db) {
	const value = await getGlobalSetting(db, GATEWAY_LOG_CAPTURE_KEY, 'false');
	return value === 'true';
}

function isRecentTimestamp(timestamp, windowMs = GATEWAY_LOG_CONNECTED_WINDOW_MS) {
	if (!timestamp) {
		return false;
	}

	const parsed = new Date(timestamp);
	if (Number.isNaN(parsed.getTime())) {
		return false;
	}

	return Date.now() - parsed.getTime() <= windowMs;
}

interface GatewayLogStatusUpdates {
	lastSeenAt?: string;
	lastPostAt?: string;
	lastStoredCount?: number;
}

async function updateGatewayLogStatus(db, updates: GatewayLogStatusUpdates = {}) {
	const writes = [];

	if (updates.lastSeenAt) {
		writes.push(setGlobalSetting(db, GATEWAY_LOG_LAST_SEEN_AT_KEY, updates.lastSeenAt));
	}

	if (updates.lastPostAt) {
		writes.push(setGlobalSetting(db, GATEWAY_LOG_LAST_POST_AT_KEY, updates.lastPostAt));
	}

	if (updates.lastStoredCount !== undefined) {
		writes.push(
			setGlobalSetting(db, GATEWAY_LOG_LAST_STORED_COUNT_KEY, String(updates.lastStoredCount))
		);
	}

	if (writes.length > 0) {
		await Promise.all(writes);
	}
}

const GATEWAY_STATE_KEYS = [
	GATEWAY_LOG_CAPTURE_KEY,
	GATEWAY_LOG_LAST_SEEN_AT_KEY,
	GATEWAY_LOG_LAST_POST_AT_KEY,
	GATEWAY_LOG_LAST_STORED_COUNT_KEY,
	GATEWAY_UPDATE_REQUIRED_VERSION_KEY,
	GATEWAY_UPDATE_LAST_ATTEMPT_KEY,
];

/**
 * Read every key this endpoint needs in one query.
 *
 * The gateway polls this endpoint on a loop; fanning the six keys out into six
 * `SELECT value FROM global_settings WHERE key = ?` round trips made it by far
 * the most-executed query in the database.
 */
async function readGatewayState(db) {
	const settings = await getGlobalSettings(db, GATEWAY_STATE_KEYS);
	return (key) => settings.get(key) ?? null;
}

function buildGatewayLogStatus(read) {
	const lastGatewaySeenAt = read(GATEWAY_LOG_LAST_SEEN_AT_KEY);
	const parsedStoredCount = Number.parseInt(
		String(read(GATEWAY_LOG_LAST_STORED_COUNT_KEY) ?? '0'),
		10
	);

	return {
		enabled: read(GATEWAY_LOG_CAPTURE_KEY) === 'true',
		lastGatewaySeenAt,
		lastGatewayPostedAt: read(GATEWAY_LOG_LAST_POST_AT_KEY),
		lastStoredCount: Number.isFinite(parsedStoredCount) ? parsedStoredCount : 0,
		lastGatewayConnected: isRecentTimestamp(lastGatewaySeenAt),
		serverTime: new Date().toISOString(),
	};
}

function buildGatewayUpdateState(read, platform) {
	const frontendVersion = getFrontendVersion(platform);
	const lastAttempt = parseJsonSafe(read(GATEWAY_UPDATE_LAST_ATTEMPT_KEY));

	return {
		frontendVersion,
		requiredVersion:
			normalizeVersion(read(GATEWAY_UPDATE_REQUIRED_VERSION_KEY)) ?? frontendVersion,
		lastAttempt: lastAttempt && typeof lastAttempt === 'object' ? lastAttempt : null,
		suggestedCommand: 'git pull && bun run gateway',
	};
}

export async function getGatewayLogStatus(db) {
	return buildGatewayLogStatus(await readGatewayState(db));
}

interface GatewayUpdateAttemptBody {
	targetVersion?: unknown;
	gatewayVersion?: unknown;
	status?: unknown;
	command?: unknown;
	error?: unknown;
}

async function recordGatewayUpdateAttempt(db, body: GatewayUpdateAttemptBody = {}) {
	const targetVersion = normalizeVersion(body?.targetVersion);
	const gatewayVersion = normalizeVersion(body?.gatewayVersion);
	const status = normalizeVersion(body?.status) ?? 'started';
	const command = normalizeVersion(body?.command) ?? 'git pull && bun run gateway';
	const error = normalizeVersion(body?.error) ?? null;

	if (!targetVersion) {
		return { success: false, error: 'targetVersion is required' };
	}

	const payload = {
		targetVersion,
		gatewayVersion,
		status,
		command,
		error,
		attemptedAt: new Date().toISOString(),
	};

	const result = await setGlobalSetting(
		db,
		GATEWAY_UPDATE_LAST_ATTEMPT_KEY,
		JSON.stringify(payload)
	);
	if (!result.success) {
		return { success: false, error: result.error || 'Failed to persist update attempt' };
	}

	return { success: true, attempt: payload };
}

export async function handleGatewayLogsApi({ request, cookies, platform, url }) {
	const db = platform?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	const method = request.method.toUpperCase();

	if (method === 'GET') {
		const isBotRequest = checkIsBotRequest(request, platform);
		if (!isBotRequest) {
			const userId = cookies.get('discord_user_id');
			if (!checkIsSuperAdmin(userId, platform)) {
				return json({ error: 'Unauthorized' }, { status: 401 });
			}
		}

		try {
			const read = await readGatewayState(db);
			const status = buildGatewayLogStatus(read);
			const gatewayUpdate = buildGatewayUpdateState(read, platform);
			const enabled = status.enabled;

			// The gateway polls continuously; only refresh the heartbeat once the
			// stored one has actually aged out, so a live gateway writes this row
			// twice a minute instead of on every poll.
			if (
				isBotRequest &&
				!isRecentTimestamp(status.lastGatewaySeenAt, GATEWAY_HEARTBEAT_WRITE_INTERVAL_MS)
			) {
				const seenAt = new Date().toISOString();
				await updateGatewayLogStatus(db, { lastSeenAt: seenAt });
				status.lastGatewaySeenAt = seenAt;
			}
			status.lastGatewayConnected = isBotRequest || status.lastGatewayConnected;

			if (isBotRequest) {
				return json({ success: true, enabled, status, gatewayUpdate });
			}

			const requestedLimit = url.searchParams.get('limit') || String(DEFAULT_LOG_LIMIT);
			const logs = await listGatewayLogs(db, { limit: requestedLimit });
			return json({ success: true, enabled, logs, status, gatewayUpdate });
		} catch (error) {
			log.error('[GatewayLogs API] GET error:', error);
			return json({ error: 'Failed to fetch gateway logs' }, { status: 500 });
		}
	}

	if (method === 'POST') {
		if (!checkIsBotRequest(request, platform)) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		try {
			const enabled = await getCaptureEnabled(db);
			if (!enabled) {
				return json({ success: true, stored: 0, enabled: false });
			}

			const body = await request.json();
			const entries = Array.isArray(body?.entries) ? body.entries : [];
			const result = await recordGatewayLogs(db, entries);

			if (!result.success) {
				return json({ error: result.error || 'Failed to store logs' }, { status: 500 });
			}

			await updateGatewayLogStatus(db, {
				lastSeenAt: new Date().toISOString(),
				lastPostAt: new Date().toISOString(),
				lastStoredCount: result.count,
			});

			return json({ success: true, stored: result.count, enabled: true });
		} catch (error) {
			log.error('[GatewayLogs API] POST error:', error);
			return json({ error: 'Invalid request body' }, { status: 400 });
		}
	}

	if (method === 'PUT') {
		if (!checkIsBotRequest(request, platform)) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		try {
			const body = await request.json();
			if (body?.type !== 'gateway_update_attempt') {
				return json({ error: 'Unsupported update payload type' }, { status: 400 });
			}

			const result = await recordGatewayUpdateAttempt(db, body);
			if (!result.success) {
				return json(
					{ error: result.error || 'Failed to record update attempt' },
					{ status: 400 }
				);
			}

			return json({ success: true, attempt: result.attempt });
		} catch (error) {
			log.error('[GatewayLogs API] PUT error:', error);
			return json({ error: 'Invalid request body' }, { status: 400 });
		}
	}

	if (method === 'PATCH') {
		const userId = cookies.get('discord_user_id');
		if (!checkIsSuperAdmin(userId, platform)) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		try {
			const body = await request.json();
			if (typeof body?.enabled !== 'boolean') {
				return json({ error: 'enabled must be a boolean' }, { status: 400 });
			}

			const result = await setGlobalSetting(
				db,
				GATEWAY_LOG_CAPTURE_KEY,
				body.enabled ? 'true' : 'false'
			);

			if (!result.success) {
				return json({ error: result.error || 'Failed to update setting' }, { status: 500 });
			}

			return json({ success: true, enabled: body.enabled });
		} catch (error) {
			log.error('[GatewayLogs API] PATCH error:', error);
			return json({ error: 'Invalid request body' }, { status: 400 });
		}
	}

	return json({ error: 'Method not allowed' }, { status: 405 });
}
