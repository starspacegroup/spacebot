<script lang="ts">
	/**
	 * Text channels: who starts conversations, who starts big ones, who ends up killing them,
	 * and how each channel is used. The twin of the Voice tab's boards. Loads its own data.
	 * How a conversation is defined, and the limits of "kills", are in docs/stats.md.
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
		fetch(`/api/admin/${serverId}/text-conversations?period=${encodeURIComponent(period)}`, {
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
	const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '0%');

	const boards = $derived<Board[]>(
		data
			? [
					{
						id: 't-starts',
						title: 'Starts conversations',
						blurb: `Wrote the first message after ${data.thresholds.gap_minutes} quiet minutes.`,
						unit: 'conversations started',
						empty: 'No conversations started in this range.',
						rows: data.starters.leaders.map((l: any) => ({
							...l,
							value: String(l.starts),
							detail: `${l.answered} of ${l.starts} got an answer`,
						})),
					},
					{
						id: 't-big',
						title: 'Starts big conversations',
						blurb: `Started one that reached ${data.thresholds.big} different people.`,
						unit: 'big conversations started',
						empty: `No conversation reached ${data.thresholds.big} people in this range.`,
						rows: data.big.map((l: any) => ({
							...l,
							value: String(l.big),
							detail: `biggest: ${plural(l.most_people, 'person', 'people')}`,
						})),
					},
					{
						id: 't-kills',
						title: 'Kills conversations',
						blurb: 'Had the last word in a lively conversation, and nobody answered.',
						unit: 'lively conversations that ended on their message',
						empty: 'No lively conversation ended on one person in this range.',
						rows: data.killers.map((k: any) => ({
							...k,
							value: String(k.kills),
							detail: `${pct(k.kills, k.lively)} of ${k.lively} lively chats`,
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
</script>

<section class="tc" aria-labelledby="tc-title">
	<header class="tc-head">
		<h2 id="tc-title" class="tc-title">
			Who starts and who ends conversations
			<span class="tc-sub">Bots are left out</span>
		</h2>
	</header>

	{#if loading}
		<p class="tc-note">Loading…</p>
	{:else if failed}
		<p class="tc-note">This could not be loaded.</p>
	{:else}
		{#if data.truncated}
			<p class="tc-note">
				This server is busy: the figures use only the newest messages in the range, so the
				older part is left out.
			</p>
		{/if}
		<RoleBoards {boards} />

		{#if data.channels.length}
			<div class="tc-card">
				<h3>Channels</h3>
				<table>
					<thead>
						<tr>
							<th>Channel</th>
							<th class="n">Messages</th>
							<th class="n">Conversations</th>
							<th class="n">Big</th>
							<th class="n">People each</th>
						</tr>
					</thead>
					<tbody>
						{#each data.channels as c (c.channel_id)}
							<tr>
								<td>#{c.channel_name ?? c.channel_id}</td>
								<td class="n">{c.messages}</td>
								<td class="n">{c.conversations}</td>
								<td class="n">{c.big}</td>
								<td class="n">{c.avg_people}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if data.starters.recent.length}
			<div class="tc-card">
				<h3>Recent conversations</h3>
				<ul>
					{#each data.starters.recent as c (c.channel_id + c.started_at)}
						<li>
							<strong>{c.starter.name}</strong> in #{c.channel_name ?? 'a channel'}, {when(
								c.started_at
							)}:
							{plural(c.messages, 'message')} from {plural(
								c.people,
								'person',
								'people'
							)}, {c.minutes} min
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<p class="tc-note">
			A conversation is a run of messages with no gap longer than {data.thresholds
				.gap_minutes}
			minutes. Silence after a message is often just the end of the topic, so look for a name that
			keeps coming up, not a single one.
		</p>
	{/if}
</section>

<style>
	.tc {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.tc-title {
		margin: 0;
		font-size: 1.05rem;
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.tc-sub {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}
	.tc-note {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	.tc-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem 1.15rem;
		overflow-x: auto;
	}
	.tc-card h3 {
		margin: 0 0 0.5rem;
		font-size: 0.95rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
	}
	.n {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	ul {
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
</style>
