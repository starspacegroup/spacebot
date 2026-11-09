<script lang="ts">
	/**
	 * Three short leaderboards for a server owner: who starts chats, who starts big ones,
	 * who ends up killing them. The same shape serves voice and text, so the two tabs read
	 * alike. Each row is a face, a name, one big number and a line of detail.
	 */
	import { getAvatarUrl } from '$lib/utils/avatar.js';

	export type BoardRow = {
		id: string;
		name: string;
		avatar: string | null;
		discriminator: string;
		value: string;
		detail: string;
	};
	export type Board = {
		id: string;
		title: string;
		blurb: string;
		unit: string;
		empty: string;
		rows: BoardRow[];
	};

	const { boards }: { boards: Board[] } = $props();
</script>

<div class="rb">
	{#each boards as b (b.id)}
		<section class="rb-card" aria-labelledby="rb-{b.id}">
			<h3 id="rb-{b.id}" class="rb-title">{b.title}</h3>
			<p class="rb-blurb">{b.blurb}</p>
			{#if b.rows.length === 0}
				<p class="rb-empty">{b.empty}</p>
			{:else}
				<ol class="rb-list">
					{#each b.rows as r, i (r.id)}
						<li class="rb-row">
							<span class="rb-rank">{i + 1}</span>
							<img
								class="rb-av"
								src={getAvatarUrl(r.id, r.avatar, r.discriminator, 64)}
								alt=""
								width="32"
								height="32"
								loading="lazy"
							/>
							<span class="rb-name" title={r.name}>{r.name}</span>
							<span class="rb-detail">{r.detail}</span>
							<span class="rb-value" title={b.unit}>{r.value}</span>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	{/each}
</div>

<style>
	.rb {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
		gap: 1rem;
	}
	.rb-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem 1.15rem;
		box-shadow: var(--shadow-sm);
		min-width: 0;
	}
	.rb-title {
		margin: 0;
		font-size: 1rem;
	}
	.rb-blurb {
		margin: 0.2rem 0 0.75rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	.rb-empty {
		margin: 0;
		color: var(--color-text-muted);
	}
	.rb-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.rb-row {
		display: grid;
		grid-template-columns: 1.2rem 2rem minmax(0, 1fr) auto;
		grid-template-areas:
			'rank av name value'
			'rank av detail value';
		column-gap: 0.6rem;
		align-items: center;
		padding: 0.3rem 0.35rem;
		border-radius: var(--radius-md);
	}
	.rb-row:hover {
		background: var(--color-surface-elevated);
	}
	.rb-rank {
		grid-area: rank;
		color: var(--color-text-muted);
		font-size: 0.8rem;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.rb-av {
		grid-area: av;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		object-fit: cover;
	}
	.rb-name {
		grid-area: name;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rb-detail {
		grid-area: detail;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rb-value {
		grid-area: value;
		font-size: 1.15rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
</style>
