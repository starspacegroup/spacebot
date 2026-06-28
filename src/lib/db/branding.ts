export interface GuildBranding {
	guild_id: string;
	display_name: string | null;
	accent_color: string | null;
	logo_url: string | null;
	banner_url: string | null;
	public_tagline: string | null;
	custom_css_json?: string | null;
}

export const DEFAULT_BRANDING = {
	display_name: 'SpaceBot',
	accent_color: '#5865f2',
	logo_url: '/logo.webp',
	banner_url: '/server-admin-dark.webp',
	public_tagline: 'Discord automation, analytics, and AI operations.',
};

export function isValidImageUrl(value: string | null | undefined): boolean {
	if (!value) return true;
	if (value.startsWith('/')) return /\.(?:png|jpe?g|webp|avif|gif|svg)$/i.test(value);
	try {
		const url = new URL(value);
		return (
			['https:', 'http:'].includes(url.protocol) &&
			/\.(?:png|jpe?g|webp|avif|gif|svg)(?:\?.*)?$/i.test(url.pathname + url.search)
		);
	} catch {
		return false;
	}
}

export function validateBranding(input: Record<string, any>) {
	const errors: Record<string, string> = {};
	const accent = String(input.accent_color || '').trim();
	const logo = String(input.logo_url || '').trim();
	const banner = String(input.banner_url || '').trim();

	if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent))
		errors.accent_color = 'Use a hex color like #5865f2.';
	if (logo && !isValidImageUrl(logo))
		errors.logo_url = 'Use an HTTP(S) or root-relative image URL.';
	if (banner && !isValidImageUrl(banner))
		errors.banner_url = 'Use an HTTP(S) or root-relative image URL.';

	return {
		ok: Object.keys(errors).length === 0,
		errors,
		value: {
			display_name:
				String(input.display_name || '')
					.trim()
					.slice(0, 80) || null,
			accent_color: accent || null,
			logo_url: logo || null,
			banner_url: banner || null,
			public_tagline:
				String(input.public_tagline || '')
					.trim()
					.slice(0, 180) || null,
		},
	};
}

export async function getGuildBranding(db: any, guildId: string): Promise<GuildBranding | null> {
	if (!db || !guildId) return null;
	return await db
		.prepare('SELECT * FROM guild_branding WHERE guild_id = ?')
		.bind(guildId)
		.first();
}

export async function saveGuildBranding(
	db: any,
	guildId: string,
	branding: any,
	updatedBy: string
) {
	const now = new Date().toISOString();
	await db
		.prepare(
			`INSERT INTO guild_branding (
				guild_id, display_name, accent_color, logo_url, banner_url, public_tagline, updated_by, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(guild_id) DO UPDATE SET
				display_name = excluded.display_name,
				accent_color = excluded.accent_color,
				logo_url = excluded.logo_url,
				banner_url = excluded.banner_url,
				public_tagline = excluded.public_tagline,
				updated_by = excluded.updated_by,
				updated_at = excluded.updated_at`
		)
		.bind(
			guildId,
			branding.display_name,
			branding.accent_color,
			branding.logo_url,
			branding.banner_url,
			branding.public_tagline,
			updatedBy,
			now,
			now
		)
		.run();
}

export function mergeBranding(row: GuildBranding | null | undefined) {
	return {
		...DEFAULT_BRANDING,
		display_name: row?.display_name || DEFAULT_BRANDING.display_name,
		accent_color: row?.accent_color || DEFAULT_BRANDING.accent_color,
		logo_url: row?.logo_url || DEFAULT_BRANDING.logo_url,
		banner_url: row?.banner_url || DEFAULT_BRANDING.banner_url,
		public_tagline: row?.public_tagline || DEFAULT_BRANDING.public_tagline,
	};
}
