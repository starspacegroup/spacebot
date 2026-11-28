/**
 * The pure part of per-server bot identity: names, icon URLs, and checking an uploaded image.
 * No I/O, so the rules can be property-tested.
 */

export const MAX_NICK = 32;
export const MAX_CUSTOM_IMAGE_BYTES = 256 * 1024;
const SUFFIX = 'Bot';

/** Control characters and zero-width characters Discord would reject or that hide a name. */
const HIDDEN = new RegExp(
	'[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028-\\u202f\\u2060\\ufeff]',
	'g'
);

function clean(s: string): string {
	return s.replace(HIDDEN, '').replace(/\s+/g, ' ').trim();
}

/** "<server name>Bot", cut so the whole nickname fits Discord's 32 characters. */
export function defaultBotName(guildName: unknown): string {
	const base = clean(typeof guildName === 'string' ? guildName : '');
	if (!base) return SUFFIX;
	return `${[...base]
		.slice(0, MAX_NICK - SUFFIX.length)
		.join('')
		.trimEnd()}${SUFFIX}`;
}

/** A custom name if the owner gave one, else the default. Always 1..32 characters. */
export function effectiveBotName(custom: unknown, guildName: unknown): string {
	const c = clean(typeof custom === 'string' ? custom : '');
	return c ? [...c].slice(0, MAX_NICK).join('') : defaultBotName(guildName);
}

/** What the owner typed, checked for saving. null means "use the default". */
export function parseCustomName(
	input: unknown
): { ok: true; name: string | null } | { ok: false; error: string } {
	if (typeof input !== 'string' || !clean(input)) return { ok: true, name: null };
	const c = clean(input);
	if ([...c].length > MAX_NICK)
		return { ok: false, error: `The name can be at most ${MAX_NICK} characters` };
	return { ok: true, name: c };
}

export function guildIconUrl(guildId: string, hash: string | null | undefined): string | null {
	if (!hash || !/^[a-z0-9_]+$/i.test(hash) || !/^\d{17,20}$/.test(guildId)) return null;
	return `https://cdn.discordapp.com/icons/${guildId}/${hash}.png?size=256`;
}

const MAGIC: Array<{ type: string; test: (b: Uint8Array) => boolean }> = [
	{
		type: 'image/png',
		test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
	},
	{ type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
	{
		type: 'image/gif',
		test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
	},
	{
		type: 'image/webp',
		test: (b) =>
			b[0] === 0x52 &&
			b[1] === 0x49 &&
			b[2] === 0x46 &&
			b[3] === 0x46 &&
			b[8] === 0x57 &&
			b[9] === 0x45 &&
			b[10] === 0x42 &&
			b[11] === 0x50,
	},
];

export function bytesToDataUri(
	bytes: Uint8Array
): { ok: true; dataUri: string } | { ok: false; error: string } {
	if (bytes.byteLength === 0) return { ok: false, error: 'The image is empty' };
	if (bytes.byteLength > MAX_CUSTOM_IMAGE_BYTES) {
		return { ok: false, error: `The image is over ${MAX_CUSTOM_IMAGE_BYTES / 1024} KB` };
	}
	// The type comes from the bytes, never from the file name or the browser's claim.
	const kind = MAGIC.find((m) => m.test(bytes));
	if (!kind) return { ok: false, error: 'Use a PNG, JPEG, GIF or WebP image' };
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return { ok: true, dataUri: `data:${kind.type};base64,${btoa(bin)}` };
}

export interface IdentityRow {
	enabled: boolean;
	name: string | null;
	avatar_mode: 'server_icon' | 'custom';
	avatar_data: string | null;
}

/**
 * The Modify Current Member body for an identity. `avatar: undefined` means "leave it": a server
 * icon that cannot be fetched must not wipe a working avatar.
 */
export function identityPatch(
	row: IdentityRow,
	guild: { name?: string | null },
	iconDataUri: string | null | undefined
): { nick: string | null; avatar?: string | null } {
	if (!row.enabled) return { nick: null, avatar: null };
	const nick = effectiveBotName(row.name, guild.name);
	if (row.avatar_mode === 'custom' && row.avatar_data) return { nick, avatar: row.avatar_data };
	return iconDataUri === undefined ? { nick } : { nick, avatar: iconDataUri };
}
