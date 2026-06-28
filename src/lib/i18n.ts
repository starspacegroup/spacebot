export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const catalogs: Record<Locale, Record<string, string>> = {
	en: {
		'nav.pricing': 'Pricing',
		'nav.login': 'Login',
		'nav.invite': 'Invite',
		'nav.support': 'Support',
		'nav.vote': 'Vote',
		'nav.leaderboards': 'Leaderboards',
		'language.label': 'Language',
		'public.invite.title': 'Invite SpaceBot',
		'public.support.title': 'Support server',
		'public.vote.title': 'Vote and reviews',
		'public.disabled': 'This link is not configured yet.',
		'public.setup': 'Set the environment variable shown below to enable this action.',
		'leaderboards.title': 'Server leaderboards',
		'profile.title': 'User profile',
		'settings.branding': 'Custom branding',
	},
	es: {
		'nav.pricing': 'Precios',
		'nav.login': 'Iniciar sesion',
		'nav.invite': 'Invitar',
		'nav.support': 'Soporte',
		'nav.vote': 'Votar',
		'nav.leaderboards': 'Clasificaciones',
		'language.label': 'Idioma',
		'public.invite.title': 'Invitar SpaceBot',
		'public.support.title': 'Servidor de soporte',
		'public.vote.title': 'Votos y resenas',
		'public.disabled': 'Este enlace todavia no esta configurado.',
		'public.setup': 'Define la variable de entorno indicada para activar esta accion.',
		'leaderboards.title': 'Clasificaciones del servidor',
		'profile.title': 'Perfil de usuario',
		'settings.branding': 'Marca personalizada',
	},
};

export function normalizeLocale(value: string | null | undefined): Locale {
	const lower = String(value || '')
		.toLowerCase()
		.split('-')[0];
	return SUPPORTED_LOCALES.includes(lower as Locale) ? (lower as Locale) : DEFAULT_LOCALE;
}

export function resolveLocale({
	cookie,
	acceptLanguage,
	userPreference,
}: {
	cookie?: string | null;
	acceptLanguage?: string | null;
	userPreference?: string | null;
}): Locale {
	if (userPreference) return normalizeLocale(userPreference);
	if (cookie) return normalizeLocale(cookie);
	const firstAccepted = acceptLanguage?.split(',')[0]?.trim();
	return normalizeLocale(firstAccepted);
}

export function t(locale: Locale, key: string): string {
	return catalogs[locale]?.[key] ?? catalogs[DEFAULT_LOCALE][key] ?? key;
}
