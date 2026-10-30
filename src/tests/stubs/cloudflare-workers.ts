/** Vitest stand-in for the `cloudflare:workers` module (workerd-only). */
export const env: Record<string, unknown> = {};
export const waitUntil = (_promise: Promise<unknown>) => {};
