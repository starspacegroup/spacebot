<script lang="ts">
	/** A ranked list: each row's bar is sized against the largest row and shows its share. */
	type Row = { label: string; views: number };
	const {
		title,
		rows,
		name = (label: string) => label,
		empty = 'Nothing yet.',
		valueLabel = 'views',
	}: {
		title: string;
		rows: Row[];
		name?: (label: string) => string;
		empty?: string;
		valueLabel?: string;
	} = $props();

	const total = $derived(rows.reduce((n, r) => n + r.views, 0));
	const top = $derived(Math.max(1, ...rows.map((r) => r.views)));
	const fmt = (n: number) => n.toLocaleString();
</script>

<section class="card">
	<h2>{title}</h2>
	{#if rows.length === 0}
		<p class="empty">{empty}</p>
	{:else}
		<ul>
			{#each rows as r (r.label)}
				<li title="{fmt(r.views)} {valueLabel}">
					<span
						class="meter"
						style="width:{Math.max(2, Math.round((r.views / top) * 100))}%"
					></span>
					<span class="label">{name(r.label)}</span>
					<span class="num">{fmt(r.views)}</span>
					<span class="share">{total > 0 ? Math.round((r.views / total) * 100) : 0}%</span
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.card {
		background: var(--color-background-alt);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 1rem 1.1rem;
		min-width: 0;
	}
	h2 {
		margin: 0 0 0.7rem;
		font-size: 0.95rem;
		font-weight: 600;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 3px;
	}
	li {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 2.6rem;
		gap: 0.6rem;
		align-items: center;
		padding: 0.32rem 0.55rem;
		border-radius: 6px;
		overflow: hidden;
		font-size: 0.88rem;
	}
	.meter {
		position: absolute;
		inset: 0 auto 0 0;
		background: color-mix(in srgb, var(--color-primary) 18%, transparent);
	}
	.label,
	.num,
	.share {
		position: relative;
	}
	.label {
		overflow-wrap: anywhere;
	}
	.num {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.share {
		text-align: right;
		color: var(--color-text-muted);
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
	}
	.empty {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
</style>
