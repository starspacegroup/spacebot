/**
 * A stats query that cannot read the database returns an empty answer so the page still
 * renders. That empty answer must not be mistaken for a real "zero", and must not be cached.
 * `failed()` marks it; `didFail()` reads the mark. The mark does not show up in JSON.
 */
const KEY = 'loadFailed';

export function failed<T>(value: T): T {
	if (value !== null && typeof value === 'object') {
		Object.defineProperty(value, KEY, { value: true, enumerable: false, configurable: true });
	}
	return value;
}

export function didFail(value: unknown): boolean {
	return (
		value !== null &&
		typeof value === 'object' &&
		(value as Record<string, unknown>)[KEY] === true
	);
}

export function failedIf<T>(condition: boolean, value: T): T {
	return condition ? failed(value) : value;
}
