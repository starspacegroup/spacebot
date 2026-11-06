/**
 * adapter-cloudflare 8 stopped passing `platform` to SvelteKit, so
 * `event.platform.env` (D1, secrets, queues) and `platform.context.waitUntil`
 * came through as undefined in production and every route that reads them broke.
 * The adapter's replacement is the `cloudflare:workers` module. This rebuilds
 * the old `platform` shape from it, so the existing code keeps working.
 *
 * Dev (vite) and tests already supply `platform`; they are left alone.
 */
import * as workers from 'cloudflare:workers';
export const restorePlatform = ({
	event,
	resolve,
}: {
	event: any;
	resolve: (event: any) => any;
}) => {
	if (!event.platform?.env) {
		const waitUntil = workers.waitUntil;
		event.platform = {
			...(event.platform ?? {}),
			env: workers.env,
			context: { waitUntil: (p: Promise<unknown>) => waitUntil?.(p) },
		};
	}
	return resolve(event);
};
