<script>
	import { enhance } from '$app/forms';
	const { data, form } = $props();
	let typed = $state('');
	let understood = $state(false);
	let busy = $state(false);
	let left = $state(0);
	const matches = $derived(typed.trim().normalize('NFC') === data.confirmName.normalize('NFC'));
	const confirming = $derived(form?.step === 'confirm' && Boolean(form?.token));

	// The final button stays off until the wait is over. The server checks the wait as well.
	$effect(() => {
		if (!confirming) return;
		left = form?.waitSeconds ?? data.waitSeconds;
		const timer = setInterval(() => {
			left = Math.max(0, left - 1);
			if (left === 0) clearInterval(timer);
		}, 1000);
		return () => clearInterval(timer);
	});
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
		<p class="notice">
			Only the owner of the Discord server can delete it. Administrators and SpaceBot staff
			cannot.
		</p>
	{:else if data.hasSubscription}
		<p class="notice">
			This server has a paid plan, or its plan could not be checked.
			<a href="/admin/{data.serverId}/billing">Check Billing</a> first.
		</p>
	{:else if confirming}
		<form
			method="POST"
			action="?/confirm"
			class="card danger"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update({ reset: false });
					busy = false;
				};
			}}
		>
			<h2>Last step</h2>
			<p>
				Everything about <strong>{data.confirmName}</strong> will be deleted now, and SpaceBot
				will leave. There is no undo.
			</p>
			<input type="hidden" name="token" value={form?.token} />
			{#if form?.message}<p class="notice" role="alert">{form.message}</p>{/if}
			<button type="submit" disabled={left > 0 || busy}>
				{#if busy}Deleting…{:else if left > 0}Wait {left}s…{:else}Yes, delete everything{/if}
			</button>
			<a class="cancel" href="/admin/{data.serverId}/delete" data-sveltekit-reload
				>Cancel, keep my server</a
			>
		</form>
	{:else}
		<section class="card">
			<h2>Before you go</h2>
			<p>
				This cannot be undone. If you might want your data, <a
					href="/admin/{data.serverId}/import-export">download a backup</a
				> first.
			</p>
		</section>
		<form
			method="POST"
			action="?/prepare"
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
			<label class="tick">
				<input type="checkbox" name="understand" bind:checked={understood} />
				I understand this deletes everything and cannot be undone.
			</label>
			{#if form?.message}<p class="notice" role="alert">{form.message}</p>{/if}
			<button type="submit" disabled={!matches || !understood || busy}>Continue</button>
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
	.tick {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.tick input {
		width: auto;
		margin-top: 0.2rem;
	}
	.cancel {
		text-align: center;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.notice {
		color: var(--color-danger);
	}
</style>
