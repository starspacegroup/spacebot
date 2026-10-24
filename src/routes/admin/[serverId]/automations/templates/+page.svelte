<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';

	const { data, form } = $props();

	const serverId = $derived($page.params.serverId);
	const order = ['welcome', 'logging', 'moderation', 'voice'] as const;
	let busy = $state<string | null>(null);
</script>

<svelte:head><title>Automation templates</title></svelte:head>

<div class="tpl">
	<header class="head">
		<div>
			<h1>Automation templates</h1>
			<p>
				Start from a ready-made automation. It is created switched off, so you can pick the
				channel or role and review it before it runs.
			</p>
		</div>
		<a class="btn btn-secondary" href="/admin/{serverId}/automations">Back to automations</a>
	</header>

	{#if form?.error}<p class="err" role="alert">{form.error}</p>{/if}

	{#each order as cat}
		{@const items = data.templates.filter((t) => t.category === cat)}
		{#if items.length}
			<section>
				<h2>{data.categories[cat].label}</h2>
				<p class="blurb">{data.categories[cat].blurb}</p>
				<div class="grid">
					{#each items as t}
						<form
							class="card"
							method="POST"
							action="?/use"
							use:enhance={() => {
								busy = t.id;
								return async ({ update }) => {
									await update();
									busy = null;
								};
							}}
						>
							<input type="hidden" name="template" value={t.id} />
							<h3>{t.name}</h3>
							<p>{t.description}</p>
							<p class="meta">
								Runs on {t.trigger_events.length === 1
									? '1 event'
									: `${t.trigger_events.length} events`}{#if t.setup.length}
									· you pick the {t.setup.join(' and ')}{/if}
							</p>
							<button class="btn btn-primary" disabled={busy !== null}>
								{busy === t.id ? 'Creating…' : 'Use this template'}
							</button>
						</form>
					{/each}
				</div>
			</section>
		{/if}
	{/each}
</div>

<style>
	.tpl {
		display: grid;
		gap: 1.75rem;
		max-width: 72rem;
		margin: 0 auto;
		padding: 1rem;
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		align-items: flex-start;
	}
	h1 {
		margin: 0 0 0.25rem;
	}
	.head p,
	.blurb,
	.meta {
		color: var(--color-text-muted);
		margin: 0;
	}
	h2 {
		margin: 0;
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.blurb {
		margin-bottom: 0.75rem;
	}
	.grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}
	.card h3 {
		margin: 0;
		font-size: 1rem;
	}
	.card p {
		margin: 0;
	}
	.meta {
		font-size: 0.8rem;
		flex: 1;
	}
	.err {
		color: var(--color-danger);
	}
</style>
