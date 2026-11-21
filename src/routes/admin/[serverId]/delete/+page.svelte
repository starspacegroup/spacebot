<script>
	import { enhance } from '$app/forms';
	const { data, form } = $props();
	let typed = $state('');
	let busy = $state(false);
	const matches = $derived(typed.trim() === data.confirmName);
</script>

<svelte:head><title>Delete this server · SpaceBot</title></svelte:head>

<div class="page">
	<h1>Delete this server</h1>
	<p class="lead">
		This removes the server and everything SpaceBot holds about it, for good. It cannot be
		undone. Your Discord server itself is not touched.
	</p>

	<section class="card">
		<h2>What is deleted</h2>
		<ul>
			<li>Settings, branding, the public listing, and permission rules</li>
			<li>Commands, automations, scheduled messages, buttons, and webhooks</li>
			<li>
				Logs, stats, and history, including command, event, automation, and voice records
			</li>
			<li>Game, Shiritori, Quorum, Timebox, Topic, Personality, and member content data</li>
			<li>API keys, the plan record, and the list of people who use this dashboard</li>
			<li>Cached member, role, and channel lists</li>
		</ul>
		<h2>What happens next</h2>
		<ul>
			<li>SpaceBot's slash commands are removed from the server.</li>
			<li>SpaceBot leaves the server. You can add it again later and start fresh.</li>
			<li>
				SpaceBot keeps one line: the server id, who deleted it, and when. No names and no
				content.
			</li>
		</ul>
	</section>

	{#if !data.mayDelete}
		<p class="notice">Only the server owner or an Administrator can delete a server.</p>
	{:else if data.hasSubscription}
		<p class="notice">
			This server has a paid plan. <a href="/admin/{data.serverId}/billing"
				>Cancel it on Billing</a
			> first.
		</p>
	{:else}
		<form
			method="POST"
			class="card danger"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update({ reset: false });
					busy = false;
				};
			}}
		>
			<label for="confirm">
				To confirm, type <strong>{data.confirmName}</strong>
			</label>
			<input
				id="confirm"
				name="confirm"
				bind:value={typed}
				autocomplete="off"
				spellcheck="false"
			/>
			{#if form?.message}<p class="notice" role="alert">{form.message}</p>{/if}
			<button type="submit" disabled={!matches || busy}>
				{busy ? 'Deleting…' : 'Delete this server and all its data'}
			</button>
		</form>
	{/if}

	<p><a href="/admin/{data.serverId}/settings">← Back to Settings</a></p>
</div>

<style>
	.page {
		max-width: 44rem;
		margin: 0 auto;
		padding: 1rem;
	}
	.lead {
		color: var(--color-text-muted);
	}
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 1rem 1.25rem;
		margin: 1rem 0;
	}
	.card h2 {
		font-size: 1rem;
		margin: 0.5rem 0 0.25rem;
	}
	.card ul {
		margin: 0 0 0.5rem;
		padding-left: 1.25rem;
	}
	.danger {
		border-color: var(--color-danger);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	input {
		padding: 0.6rem 0.75rem;
		font-size: 1rem;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
		color: var(--color-text);
		width: 100%;
		box-sizing: border-box;
	}
	button {
		padding: 0.7rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--color-danger);
		background: var(--color-danger);
		color: var(--color-text);
		font-weight: 700;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.notice {
		color: var(--color-danger);
	}
</style>
