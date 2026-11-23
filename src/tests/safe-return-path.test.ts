import fc from 'fast-check';
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
		'/.//evil.example',
		'/a/..//evil.example/x',
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

	it('property: output is the fallback or a single-slash same-origin path', () => {
		const seg = fc.constantFrom('', '.', '..', 'a', 'evil.example', '%2e', 'x?y=1', '#h');
		fc.assert(
			fc.property(fc.array(seg, { maxLength: 6 }), (parts) => {
				const out = safeReturnPath('/' + parts.join('/'));
				if (out === '/admin') return true;
				return (
					out.startsWith('/') &&
					!out.startsWith('//') &&
					new URL(out, 'http://spacebot.invalid').origin === 'http://spacebot.invalid'
				);
			}),
			{ numRuns: 2000 }
		);
	});
});
