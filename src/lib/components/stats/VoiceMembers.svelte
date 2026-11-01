<script lang="ts">
	/**
	 * Every member who spent time in voice in the chosen range, as a plain list:
	 * face, name, time in voice, and when they were last there. The leaders cards
	 * show the top five; this is everyone.
	 */
	import { parseUTCDate } from '$lib/timezone.js';
	import { getAvatarUrl } from '$lib/utils/avatar.js';

	type Member = {
		id: string;
		name: string;
		avatar: string | null;
		discriminator: string;
		bot: boolean;
		seconds: number;
		last_active: string | null;
	};

	const {
		serverId,
		period,
		preview = null,
	}: {
		serverId: string;
		period: string;
		/** Dev only: canned members, so the list can be seen without a server. */
		preview?: Member[] | null;
	} = $props();

	const COLLAPSED = 18;

	let members = $state<Member[]>([]);
	let loading = $state(true);
	let failed = $state(false);
	let query = $state('');
	let withBots = $state(false);
	let expanded = $state(false);

	$effect(() => {
		if (preview) {
			members = preview;
			loading = false;
			return;
		}
		const controller = new AbortController();
		loading = true;
		failed = false;
		fetch(`/api/admin/${serverId}/voice-members?period=${encodeURIComponent(period)}`, {
			signal: controller.signal,
		})
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((body) => {
				members = body.members ?? [];
				loading = false;
			})
			.catch((err) => {
				if (err?.name === 'AbortError') return;
				failed = true;
				loading = false;
			});
		return () => controller.abort();
	});

	const shown = $derived(
		members.filter(
			(m) =>
				(withBots || !m.bot) &&
				(!query.trim() || m.name.toLowerCase().includes(query.trim().toLowerCase()))
		)
	);
	const visible = $derived(expanded || query.trim() ? shown : shown.slice(0, COLLAPSED));
	const humans = $derived(members.filter((m) => !m.bot).length);

	function duration(seconds: number) {
		const mins = Math.round(seconds / 60);
		if (mins < 60) return `${Math.max(mins, 1)}m`;
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return h >= 10 || m === 0 ? `${h}h` : `${h}h ${m}m`;
	}

	function ago(iso: string | null) {
		if (!iso) return '';
		const then = parseUTCDate(iso)?.getTime();
		if (!then) return '';
		const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
		if (mins < 2) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const h = Math.round(mins / 60);
		if (h < 48) return `${h}h ago`;
		return `${Math.round(h / 24)}d ago`;
	}
</script>

<section class="vm" aria-labelledby="vm-title">
	<header class="vm-head">
		<h2 id="vm-title" class="vm-title">
			Voice members
			<span class="vm-count">
				{loading ? '' : `${withBots ? members.length : humans} in this range`}
			</span>
		</h2>
		<div class="vm-tools">
			<input
				class="vm-search"
				type="search"
				placeholder="Find a member"
				aria-label="Find a voice member"
				bind:value={query}
			/>
			<label class="vm-bots">
				<input type="checkbox" bind:checked={withBots} />
				Bots
			</label>
		</div>
	</header>

	{#if loading}
		<p class="vm-note">Loading…</p>
	{:else if failed}
		<p class="vm-note">The member list could not be loaded.</p>
	{:else if shown.length === 0}
		<p class="vm-note">
			{query.trim() ? 'No one matches that.' : 'No one used voice in this range.'}
		</p>
	{:else}
		<ul class="vm-grid">
			{#each visible as m (m.id)}
				<li class="vm-item">
					<img
						class="vm-av"
						src={getAvatarUrl(m.id, m.avatar, m.discriminator, 64)}
						alt=""
						width="32"
						height="32"
						loading="lazy"
					/>
					<span class="vm-name" title={m.name}>{m.name}</span>
					<span class="vm-time">{duration(m.seconds)}</span>
					<span class="vm-last">{ago(m.last_active)}</span>
				</li>
			{/each}
		</ul>
		{#if !expanded && !query.trim() && shown.length > COLLAPSED}
			<button class="vm-more" type="button" onclick={() => (expanded = true)}>
				Show all {shown.length}
			</button>
		{/if}
	{/if}
</section>

<style>
	.vm {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.1rem 1.25rem;
		box-shadow: var(--shadow-sm);
	}
	.vm-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 0.9rem;
	}
	.vm-title {
		margin: 0;
		font-size: 1.05rem;
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}
	.vm-count {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}
	.vm-tools {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: 1 1 14rem;
		justify-content: flex-end;
	}
	.vm-search {
		padding: 0.4rem 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-elevated);
		color: inherit;
		font: inherit;
		min-width: 0;
		flex: 1 1 8rem;
		max-width: 13rem;
	}
	.vm-bots {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	.vm-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
		gap: 0.4rem 1rem;
	}
	.vm-item {
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr) auto;
		grid-template-areas:
			'av name time'
			'av last time';
		column-gap: 0.65rem;
		align-items: center;
		padding: 0.35rem 0.5rem;
		border-radius: var(--radius-md);
	}
	.vm-item:hover {
		background: var(--color-surface-elevated);
	}
	.vm-av {
		grid-area: av;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		object-fit: cover;
	}
	.vm-name {
		grid-area: name;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.vm-last {
		grid-area: last;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	.vm-time {
		grid-area: time;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.vm-note {
		margin: 0;
		color: var(--color-text-muted);
	}
	.vm-more {
		margin-top: 0.75rem;
		padding: 0.4rem 0.9rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.vm-more:hover {
		border-color: var(--color-primary);
	}
</style>
