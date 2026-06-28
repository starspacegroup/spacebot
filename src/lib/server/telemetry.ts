import { getEnv } from '$lib/env.js';
import { log } from '$lib/log.js';

export interface SpanRecord {
	name: string;
	startedAt: number;
	durationMs?: number;
	attributes?: Record<string, any>;
}

export function startSpan(name: string, attributes: Record<string, any> = {}): SpanRecord {
	return { name, startedAt: performance.now(), attributes };
}

export function finishSpan(span: SpanRecord, platform?: any) {
	span.durationMs = Math.round((performance.now() - span.startedAt) * 100) / 100;
	if (getEnv('SENTRY_DSN', platform)) {
		log.debug('[APM] span sentry-ready', span);
	} else {
		log.debug('[APM] span', span);
	}
	return span;
}

export async function withSpan<T>(
	name: string,
	attributes: Record<string, any>,
	platform: any,
	fn: () => Promise<T>
): Promise<T> {
	const span = startSpan(name, attributes);
	try {
		return await fn();
	} finally {
		finishSpan(span, platform);
	}
}
