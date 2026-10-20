import { describe, expect, it } from 'vitest';
import { safeReturnPath } from '../lib/server/safe-return-path.js';

describe('safeReturnPath', () => {
	it.each([
		'https://evil.example/',
		'//evil.example/x',
		'/\\evil.example',
		'\\\\evil.example',
		'javascript:alert(1)',
		'/%0d%0aLocation:x'.replace('%0d%0a', '\r\n'),
		'evil.example',
		'',
		null,
		42,
	])('rejects %j', (value) => {
		expect(safeReturnPath(value)).toBe('/admin');
	});

	it.each(['/admin', '/admin/123/settings?tab=a', '/account#x', '/admin/%2F%2Fevil'])(
		'keeps local path %s',
		(value) => {
			expect(safeReturnPath(value)).toBe(value);
		}
	);
});
