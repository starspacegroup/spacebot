/**
 * Minimal stand-in for SvelteKit's `Cookies` with the semantics the session
 * hook relies on: a cookie set or deleted during the request shadows the
 * request header, and a deleted cookie (maxAge 0) reads as undefined.
 */
export function createCookieJar(initial: Record<string, string> = {}) {
	const request = new Map(Object.entries(initial));
	const written = new Map<string, { value: string; options: any }>();
	return {
		written,
		get(name: string) {
			const w = written.get(name);
			if (w) return w.options?.maxAge === 0 ? undefined : w.value;
			return request.get(name);
		},
		getAll() {
			return [...request.keys()].map((name) => ({ name, value: this.get(name) }));
		},
		set(name: string, value: string, options: any = {}) {
			written.set(name, { value, options });
		},
		delete(name: string, options: any = {}) {
			written.set(name, { value: '', options: { ...options, maxAge: 0 } });
		},
		serialize() {
			return '';
		},
	};
}
