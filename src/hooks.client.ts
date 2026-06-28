import * as Sentry from '@sentry/sveltekit';
import { handleErrorWithSentry } from '@sentry/sveltekit';
import { env } from '$env/dynamic/public';

/**
 * Client-side Sentry.
 *
 * The DSN must be a PUBLIC_ var: client code can't read server env, so the
 * value is exposed to the browser at build/runtime via $env/dynamic/public.
 * Set PUBLIC_SENTRY_DSN to enable; unset = no-op (Sentry.init is skipped and
 * handleErrorWithSentry just forwards errors).
 *
 * Server-side error tracking is intentionally NOT wired here: this app runs on
 * Cloudflare Workers where `platform.env` is only available per-request, so
 * @sentry/sveltekit's module-load Sentry.init can't read the DSN. Proper
 * server capture needs @sentry/cloudflare with a per-request wrapper — tracked
 * as a follow-up in ROADMAP.md.
 */
if (env.PUBLIC_SENTRY_DSN) {
	Sentry.init({
		dsn: env.PUBLIC_SENTRY_DSN,
		environment: env.PUBLIC_SENTRY_ENVIRONMENT || 'production',
		release: env.PUBLIC_SENTRY_RELEASE || undefined,
		tracesSampleRate: Number(env.PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '0.05'),
	});
}

export const handleError = handleErrorWithSentry();
