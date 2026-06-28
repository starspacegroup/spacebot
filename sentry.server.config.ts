import * as Sentry from '@sentry/sveltekit';
import { getEnv } from './src/lib/env.js';

const dsn = getEnv('SENTRY_DSN');

if (dsn) {
	Sentry.init({
		dsn,
		environment: getEnv('SENTRY_ENVIRONMENT') || 'production',
		release: getEnv('SENTRY_RELEASE') || undefined,
		tracesSampleRate: Number(getEnv('SENTRY_TRACES_SAMPLE_RATE') || '0.05'),
	});
}
