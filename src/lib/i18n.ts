import { getContext, setContext } from 'svelte';
import { en } from './i18n/en.js';
import { es } from './i18n/es.js';

export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Human-readable names for the language picker (in their own language). */
export const LOCALE_NAMES: Record<Locale, string> = {
	en: 'English',
	es: 'Español',
};

/** Compact codes for the nav language picker where space is tight (EN, ES, …). */
export const LOCALE_SHORT_NAMES: Record<Locale, string> = {
	en: 'EN',
	es: 'ES',
};

export const catalogs: Record<Locale, Record<string, string>> = { en, es };

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

/**
 * Translate a key for a locale, falling back to English then the raw key.
 * Optional params fill `{name}` placeholders in the string.
 */
export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
	let value = catalogs[locale]?.[key] ?? catalogs[DEFAULT_LOCALE][key] ?? key;
	if (params) {
		for (const [name, replacement] of Object.entries(params)) {
			value = value.replaceAll(`{${name}}`, String(replacement));
		}
	}
	return value;
}

// ---------------------------------------------------------------------------
// Component context helpers
//
// The active locale is put on Svelte context by the root layout, so any
// component can obtain a translator bound to it without prop-drilling
// `data.locale`. Because switching language triggers a full reload, the locale
// is fixed for the lifetime of a render — no reactivity plumbing needed, and
// no risk of cross-request state leaking on the server.
// ---------------------------------------------------------------------------

const LOCALE_CONTEXT_KEY = Symbol('spacebot.locale');

export function setLocaleContext(locale: Locale): void {
	setContext(LOCALE_CONTEXT_KEY, locale);
}

export function getLocale(): Locale {
	return getContext<Locale>(LOCALE_CONTEXT_KEY) ?? DEFAULT_LOCALE;
}

/** Grab a translator bound to the context locale. Call once at component init. */
export function getTranslator(): (key: string, params?: Record<string, string | number>) => string {
	const locale = getLocale();
	return (key, params) => t(locale, key, params);
}
