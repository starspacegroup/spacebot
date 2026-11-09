<script lang="ts">
	/**
	 * Voice: who starts chats, who starts big ones, and who ends up killing them. Loads
	 * its own data, so the other tabs pay nothing for it. The numbers and their limits are
	 * explained in docs/stats.md and at the top of voice-presence.ts.
	 */
	import RoleBoards, { type Board } from './RoleBoards.svelte';

	const { serverId, period }: { serverId: string; period: string } = $props();

	let data = $state<any>(null);
	let loading = $state(true);
	let failed = $state(false);

	$effect(() => {
		const controller = new AbortController();
		loading = true;
		failed = false;
		fetch(`/api/admin/${serverId}/voice-presence?period=${encodeURIComponent(period)}`, {
			signal: controller.signal,
		})
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((body) => {
				data = body;
				loading = false;
			})
			.catch((err) => {
				if (err?.name === 'AbortError') return;
				failed = true;
				loading = false;
			});
		return () => controller.abort();
	});

	const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

	const boards = $derived<Board[]>(
		data
			? [
					{
						id: 'v-starts',
						title: 'Starts chats',
						blurb: 'Joined a voice channel nobody else was in.',
						unit: 'chats started',
						empty: 'No one joined an empty channel in this range.',
						rows: data.starters.leaders.map((l: any) => ({
							...l,
							value: String(l.starts),
							detail: `${l.with_company} of ${l.starts} got company`,
						})),
					},
					{
						id: 'v-big',
						title: 'Starts big chats',
						blurb: `Started a chat that reached ${data.thresholds.big_chat} people together.`,
						unit: 'big chats started',
						empty: `No chat grew to ${data.thresholds.big_chat} people in this range.`,
						rows: data.big.map((l: any) => ({
							...l,
							value: String(l.big),
							detail: `biggest: ${plural(l.peak, 'person', 'people')} together`,
						})),
					},
					{
						id: 'v-kills',
						title: 'Kills chats',
						blurb: `Joined a chat that had been going a while, and everyone left within ${data.thresholds.clear_seconds} seconds.`,
						unit: 'chats emptied',
						empty: 'No one emptied a chat in this range. A leave only counts if it reads as a reaction.',
						rows: data.killers.leaders.map((l: any) => ({
							...l,
							value: String(l.kills),
							detail:
								`${plural(l.people_left, 'person', 'people')} left` +
								(l.partial
									? `, ${l.partial} other join${l.partial === 1 ? '' : 's'} saw some leave`
									: ''),
						})),
					},
				]
			: []
	);

	function when(iso: string) {
		const d = new Date(iso.replace(' ', 'T') + 'Z');
		return d.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	}
	function alone(seconds: number | null) {
		if (seconds === null) return 'nobody joined';
		const m = Math.round(seconds / 60);
		return m < 1 ? 'joined within a minute' : `joined after ${m} min`;
	}
</script>

<section class="vp" aria-labelledby="vp-title">
	<header class="vp-head">
		<h2 id="vp-title" class="vp-title">
			Who starts and who ends voice chats
			<span class="vp-sub">Bots are left out</span>
		</h2>
	</header>

	{#if loading}
		<p class="vp-note">Loading…</p>
	{:else if failed}
		<p class="vp-note">This could not be loaded.</p>
	{:else}
		<RoleBoards {boards} />

		{#if data.starters.recent.length || data.killers.recent.length}
			<div class="vp-recent">
				{#if data.starters.recent.length}
					<div>
						<h3>Recent starts</h3>
						<ul>
							{#each data.starters.recent as s, i (`${s.id}|${s.joined_at}|${i}`)}
								<li>
									<strong>{s.name}</strong> in {s.channel_name ?? 'a channel'}, {when(
										s.joined_at
									)}:
									{alone(s.alone_seconds)}{s.joined
										? `, ${plural(s.joined, 'person', 'people')} joined, up to ${s.peak} together`
										: ''}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if data.killers.recent.length}
					<div>
						<h3>Recent clear-outs</h3>
						<ul>
							{#each data.killers.recent as c, i (`${c.id}|${c.joined_at}|${i}`)}
								<li>
									<strong>{c.name}</strong> joined {c.channel_name ??
										'a channel'}, {when(c.joined_at)}:
									{c.left} of {c.present}
									{c.present === 1 ? 'person' : 'people'} left{c.emptied
										? ', the room emptied'
										: ''}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}
		<p class="vp-note">
			Someone leaving soon after you join is often a coincidence; look for the same name
			coming up again and again.
		</p>
	{/if}
</section>

<style>
	.vp {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.vp-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.75rem;
	}
	.vp-title {
		margin: 0;
		font-size: 1.05rem;
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.vp-sub {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}
	.vp-note {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	.vp-recent {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
		gap: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem 1.15rem;
	}
	.vp-recent h3 {
		margin: 0 0 0.4rem;
		font-size: 0.9rem;
	}
	.vp-recent ul {
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
</style>
