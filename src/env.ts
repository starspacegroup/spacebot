import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Environment variables SvelteKit 3 exposes to the app. Anything not declared
 * here is not importable from `$app/env/public` or `$app/env/private`.
 *
 * The Sentry vars are all optional: unset means Sentry stays off (see
 * src/hooks.client.ts).
 */
const optional = (value: string | undefined) => value || undefined;

export const variables = defineEnvVars({
	PUBLIC_SENTRY_DSN: { public: true, schema: optional },
	PUBLIC_SENTRY_ENVIRONMENT: { public: true, schema: optional },
	PUBLIC_SENTRY_RELEASE: { public: true, schema: optional },
	PUBLIC_SENTRY_TRACES_SAMPLE_RATE: { public: true, schema: optional },
});
