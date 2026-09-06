import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { log } from '$lib/db/logger.js';
import { filterAdminGuilds, getBotGuildIds, getUserGuilds } from '$lib/discord/guilds.js';
import { resolveLocale } from '$lib/i18n.js';

// Timeout for guild fetching to prevent layout hangs (10 seconds)
const GUILD_FETCH_TIMEOUT = 10000;

/**
 * Fetch and process the admin guild list for a user.
 * Returns a sorted array of guilds with botIsInServer flags.
 */
async function buildAdminGuildsList(accessToken, botToken, isSuperAdmin, cookies) {
	const [allUserGuilds, botGuildIds] = await withTimeout(
		Promise.all([getUserGuilds(accessToken, cookies), getBotGuildIds(botToken, cookies)]),
		GUILD_FETCH_TIMEOUT,
		[[], new Set()]
	);

	let adminGuilds = [];

	if (isSuperAdmin) {
		adminGuilds = allUserGuilds.map((guild) => ({
			...guild,
			botIsInServer: botGuildIds.has(guild.id),
		}));
	} else {
		adminGuilds = filterAdminGuilds(allUserGuilds)
			.filter((guild) => botGuildIds.has(guild.id))
			.map((guild) => ({ ...guild, botIsInServer: true }));
	}

	adminGuilds.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
	return adminGuilds;
}

/**
 * Wrap a promise with a timeout to prevent hanging
 * @param {Promise<T>} promise - The promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @param {T} fallback - Fallback value if timeout occurs
 * @returns {Promise<T>}
 * @template T
 */
async function withTimeout(promise, ms, fallback) {
	let timeoutId;
	const timeoutPromise = new Promise((resolve) => {
		timeoutId = setTimeout(() => {
			log.warn(`[Layout] Request timed out after ${ms}ms, using fallback`);
			resolve(fallback);
		}, ms);
	});

	try {
		const result = await Promise.race([promise, timeoutPromise]);
		clearTimeout(timeoutId);
		return result;
	} catch (error) {
		clearTimeout(timeoutId);
		log.error('[Layout] Promise error:', error);
		return fallback;
	}
}

/**
 * Safely get environment variable, works in both Node.js and Cloudflare Workers
 * @param {string} name - Environment variable name
 * @param {import('@sveltejs/kit').RequestEvent['platform']} platform - SvelteKit platform object
 * @returns {string|undefined}
 */
function getEnv(name, platform) {
	return (
		platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined)
	);
}

/** @type {import('./$types').LayoutServerLoad} */
export async function load({ cookies, platform, url }) {
	console.log('[Layout] load() called, pathname:', url.pathname);
	const locale = resolveLocale({
		cookie: cookies.get('spacebot_locale'),
		acceptLanguage: null,
	});

	const devAuthEnabled = dev && getEnv('DEV_AUTH_BYPASS', platform) === 'true';

	// Check if user is logged in via cookie
	const userId = cookies.get('discord_user_id');
	console.log('[Layout] userId from cookie:', userId);

	if (!userId) {
		return {
			isLoggedIn: false,
			isAdmin: false,
			isSuperAdmin: false,
			user: null,
			adminGuilds: [],
			selectedGuildId: null,
			locale,
		};
	}

	// Get ADMIN_USER_IDS from environment (these are superadmins with full access)
	const adminUserIds = getEnv('ADMIN_USER_IDS', platform) || '';

	// Parse comma-separated list of superadmin IDs
	const superAdminIdList = adminUserIds
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);

	// Check if current user is a superadmin (defined in ADMIN_USER_IDS)
	const isSuperAdmin = superAdminIdList.includes(userId);

	log.debug(
		'[Layout] userId:',
		userId,
		'superAdminIdList:',
		superAdminIdList,
		'isSuperAdmin:',
		isSuperAdmin
	);

	// Get user info from cookies
	const user = {
		id: userId,
		username: cookies.get('discord_username') || 'User',
		avatar: cookies.get('discord_avatar') || null,
		globalName: cookies.get('discord_global_name') || null,
		discriminator: cookies.get('discord_discriminator') || '0',
	};

	// Fetch guilds for the pages that actually need them.
	//
	// /connect is in this list because its consent screen asks which server to
	// grant — without guilds it renders "you don't administer any server" to
	// everybody, which is what it did before this line included it.
	const needsGuilds =
		url.pathname.startsWith('/admin') ||
		url.pathname.startsWith('/account') ||
		url.pathname.startsWith('/connect');
	let adminGuilds = [];
	let selectedGuildId = null;

	// Always read the last viewed guild from cookie for non-admin pages
	// This allows links like "Go to Dashboard" to go directly to the right server
	const lastViewedGuildId = cookies.get('last_viewed_guild');
	if (!needsGuilds && lastViewedGuildId) {
		selectedGuildId = lastViewedGuildId;
	}

	log.debug('[Layout] needsGuilds:', needsGuilds, 'pathname:', url.pathname);

	if (needsGuilds) {
		// Check if we're using dev auth bypass with a mock guild
		const devGuildId = getEnv('DISCORD_GUILD_ID', platform);
		const isDevMockToken = cookies.get('discord_access_token') === 'dev_mock_token';
		const devAuthRole = cookies.get('dev_auth_role') || 'superadmin';
		const isDevSuperAdmin = devAuthRole === 'superadmin';
		const isDevAdmin = devAuthRole === 'admin' || isDevSuperAdmin;

		if (devAuthEnabled && isDevMockToken) {
			// In dev mode with bypass, role controls the simulated access level.
			if (isDevAdmin) {
				// Prefer whatever guilds scripts/seed-dev-data.ts has seeded into local
				// D1 (multiple fake servers, so the switcher/dashboard aren't limited
				// to one guild) — fall back to the single DISCORD_GUILD_ID mock guild
				// for anyone who hasn't run the seed script yet.
				const db = (platform as any)?.env?.DB;
				let mockGuilds = [];
				if (db) {
					try {
						const result = await db
							.prepare(
								'SELECT guild_id, name, icon, owner_id FROM guild_metadata ORDER BY name'
							)
							.all();
						mockGuilds = (result.results || []).map((g) => ({
							id: g.guild_id,
							name: g.name,
							icon: g.icon || null,
							owner: isDevSuperAdmin,
							permissions: '2147483647', // All permissions
							botIsInServer: true,
						}));
					} catch (err) {
						log.error('[Layout] Failed to load seeded dev guilds:', err);
					}
				}
				if (mockGuilds.length === 0 && devGuildId) {
					mockGuilds = [
						{
							id: devGuildId,
							name: 'Dev Test Server',
							icon: null,
							owner: isDevSuperAdmin,
							permissions: '2147483647',
							botIsInServer: true,
						},
					];
				}

				log.debug(
					'[Layout] DEV MODE - mock guilds:',
					mockGuilds.map((g) => g.id),
					'role:',
					devAuthRole
				);

				const pathMatch = url.pathname.match(/^\/admin\/(\d+)/);
				const selectedFromUrl = url.searchParams.get('guild') || pathMatch?.[1] || null;
				const lastViewedGuildId = cookies.get('last_viewed_guild');
				const selectedGuildId =
					selectedFromUrl || lastViewedGuildId || mockGuilds[0]?.id || null;

				return {
					isLoggedIn: true,
					isAdmin: true,
					isSuperAdmin: isDevSuperAdmin,
					user,
					adminGuilds: mockGuilds,
					selectedGuildId,
					locale,
				};
			}

			if (!isDevAdmin) {
				return {
					isLoggedIn: true,
					isAdmin: false,
					isSuperAdmin: false,
					user,
					adminGuilds: [],
					selectedGuildId: null,
					locale,
				};
			}
		}

		const accessToken = cookies.get('discord_access_token');
		const botToken = getEnv('DISCORD_BOT_TOKEN', platform);

		log.debug('[Layout] Has accessToken:', !!accessToken, 'Has botToken:', !!botToken);

		// Determine selectedGuildId immediately from URL path or cookie — no API call needed
		const pathMatch = url.pathname.match(/^\/admin\/(\d+)/);
		const selectedFromUrl = url.searchParams.get('guild') || pathMatch?.[1] || null;
		selectedGuildId = selectedFromUrl || lastViewedGuildId || null;

		// For /admin exact: redirect immediately using the last-viewed cookie.
		// This avoids blocking the redirect on a Discord API round-trip.
		if (url.pathname === '/admin' && !selectedFromUrl) {
			if (lastViewedGuildId) {
				log.debug('[Layout] Fast redirect to last viewed guild:', lastViewedGuildId);
				throw redirect(302, `/admin/${lastViewedGuildId}`);
			}
			// No cookie (first-ever visit): must fetch guilds to find somewhere to land.
			const guilds = await buildAdminGuildsList(accessToken, botToken, isSuperAdmin, cookies);
			const firstGuild = guilds.find((g) => g.botIsInServer !== false) || guilds[0];
			if (firstGuild) {
				cookies.set('last_viewed_guild', firstGuild.id, {
					path: '/',
					httpOnly: false,
					secure: false,
					sameSite: 'lax',
					maxAge: 60 * 60 * 24 * 365,
				});
				throw redirect(302, `/admin/${firstGuild.id}`);
			}
			return {
				isLoggedIn: true,
				isAdmin: isSuperAdmin || guilds.length > 0,
				isSuperAdmin,
				user,
				adminGuilds: guilds,
				selectedGuildId: null,
				locale,
			};
		}

		// Store selected guild in cookie immediately (we know it from URL/cookie already)
		if (selectedGuildId) {
			cookies.set('last_viewed_guild', selectedGuildId, {
				path: '/',
				httpOnly: false,
				secure: false,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 365,
			});
		}

		// Resolve guilds before returning so child server loaders always receive an array.
		// Returning a Promise here can surface as runtime TypeErrors in routes that call
		// array helpers such as .filter/.some/.find on parentData.adminGuilds.
		adminGuilds = await buildAdminGuildsList(accessToken, botToken, isSuperAdmin, cookies);

		return {
			isLoggedIn: true,
			isAdmin: true, // Logged-in user is on an admin page; individual pages guard auth
			isSuperAdmin,
			user,
			adminGuilds,
			selectedGuildId,
			locale,
		};
	}

	return {
		isLoggedIn: true,
		isAdmin: isSuperAdmin,
		isSuperAdmin,
		user,
		adminGuilds: [],
		selectedGuildId,
		locale,
	};
}
