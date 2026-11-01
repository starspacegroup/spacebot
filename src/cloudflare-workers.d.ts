// The adapter provides this module at build time; workerd provides it at runtime.
declare module 'cloudflare:workers' {
	export const env: Record<string, any>;
	export const waitUntil: ((promise: Promise<unknown>) => void) | undefined;
}
