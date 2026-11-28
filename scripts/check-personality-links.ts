/**
 * Opens every link in the /personality catalog and prints the status and page title.
 * Run `bun run check:personality-links` before adding or after a long gap; fix or drop any
 * entry that does not answer 200 or whose title no longer matches the test. A few sites block
 * scripts (403): open those by hand once and note it.
 */
import { TESTS } from '../src/lib/server/personality-tests.ts';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36';
let bad = 0;
await Promise.all(
	TESTS.map(async (t) => {
		try {
			const res = await fetch(t.url, {
				redirect: 'follow',
				headers: { 'user-agent': UA },
				signal: AbortSignal.timeout(15000),
			});
			const title = (await res.text()).match(/<title[^>]*>([^<]{0,80})/i)?.[1]?.trim() ?? '';
			if (!res.ok) bad++;
			console.log(`${res.ok ? 'ok ' : 'BAD'} ${res.status} ${t.id.padEnd(20)} ${title}`);
		} catch (error) {
			bad++;
			console.log(`BAD --- ${t.id.padEnd(20)} ${(error as Error).message}`);
		}
	})
);
console.log(bad ? `\n${bad} link(s) need attention.` : `\nAll ${TESTS.length} links answered.`);
process.exit(bad ? 1 : 0);
