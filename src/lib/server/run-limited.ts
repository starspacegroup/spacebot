/**
 * Run async jobs a few at a time, results in input order.
 *
 * D1 answers one query at a time per database. A page that fires eighteen queries
 * at once puts every other request, such as the next page someone clicks to, behind
 * all eighteen. Keeping only a few in flight lets other requests slip in between.
 */
export async function runLimited<T>(
	jobs: Array<() => Promise<T>>,
	limit: number,
	signal?: AbortSignal
): Promise<T[]> {
	const results = new Array<T>(jobs.length);
	let next = 0;
	const worker = async () => {
		while (next < jobs.length) {
			if (signal?.aborted) throw new Error('aborted');
			const i = next++;
			results[i] = await jobs[i]();
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
	return results;
}
