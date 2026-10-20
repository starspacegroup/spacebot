/**
 * Server-enforced preview → confirm for the standalone MCP server (security
 * review 2026-10-20, #13).
 *
 * "Preview first, then confirm" used to be advice in tool descriptions: confirm
 * accepted any payload and direct create tools were advertised. Now a preview
 * mints a short-lived, single-use id bound to a digest of the exact payload,
 * and confirm refuses anything that does not present that id with the same
 * payload. Mutation tools exist only with SPACEBOT_MCP_WRITE=true.
 */
import { createHash, randomBytes } from 'node:crypto';

export const PREVIEW_TTL_MS = 10 * 60 * 1000;

export const WRITE_TOOLS = new Set([
	'create_scheduled_event',
	'create_multiple_scheduled_events',
	'confirm_scheduled_event',
	'confirm_multiple_scheduled_events',
]);

export const DIRECT_MUTATION_TOOLS = new Set([
	'create_scheduled_event',
	'create_multiple_scheduled_events',
]);

export function writesEnabled(env: Record<string, string | undefined> = process.env): boolean {
	return env.SPACEBOT_MCP_WRITE === 'true';
}

/** The tool list a client may see: no direct mutations ever, no confirms unless writes are on. */
export function advertisedTools<T extends { name: string }>(
	tools: T[],
	writeEnabled: boolean
): T[] {
	return tools.filter(
		(t) => !DIRECT_MUTATION_TOOLS.has(t.name) && (writeEnabled || !WRITE_TOOLS.has(t.name))
	);
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value as object)
			.filter(
				(k) =>
					k !== 'previewId' &&
					(value as any)[k] !== undefined &&
					(value as any)[k] !== null
			)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical((value as any)[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

export function payloadDigest(kind: string, payload: Record<string, unknown>): string {
	return createHash('sha256')
		.update(`${kind}\n${canonical(payload)}`)
		.digest('hex');
}

export function createPreviewStore(now: () => number = Date.now) {
	const records = new Map<string, { digest: string; expiresAt: number }>();

	return {
		issue(kind: string, payload: Record<string, unknown>): string {
			for (const [id, rec] of records) if (rec.expiresAt <= now()) records.delete(id);
			const id = randomBytes(16).toString('hex');
			records.set(id, {
				digest: payloadDigest(kind, payload),
				expiresAt: now() + PREVIEW_TTL_MS,
			});
			return id;
		},
		consume(
			kind: string,
			payload: Record<string, unknown>
		): { ok: true } | { ok: false; error: string } {
			const id = typeof payload.previewId === 'string' ? payload.previewId : '';
			const rec = id ? records.get(id) : undefined;
			if (!rec)
				return {
					ok: false,
					error: 'Unknown or already-used previewId. Run the preview tool first.',
				};
			records.delete(id);
			if (rec.expiresAt <= now())
				return { ok: false, error: 'Preview expired. Run the preview tool again.' };
			if (rec.digest !== payloadDigest(kind, payload)) {
				return {
					ok: false,
					error: 'Payload differs from the previewed one. Preview the new details first.',
				};
			}
			return { ok: true };
		},
	};
}
