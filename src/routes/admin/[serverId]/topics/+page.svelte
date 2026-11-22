<script lang="ts">
	import { enhance } from '$app/forms';
	import Switch from '$lib/components/Switch.svelte';

	const { data, form } = $props();

	// One local copy per form, reseeded when the loader returns after a save (the same pattern as
	// the observances page), so a field never shows a value that was not stored.
	// svelte-ignore state_referenced_locally
	let enabled = $state(data.enabled);
	// svelte-ignore state_referenced_locally
	let setVoiceStatus = $state(data.settings.setVoiceStatus);
	// svelte-ignore state_referenced_locally
	let customOnly = $state(data.settings.customOnly);
	$effect(() => {
		enabled = data.enabled;
		setVoiceStatus = data.settings.setVoiceStatus;
		customOnly = data.settings.customOnly;
	});

	let busy = $state<string | null>(null);
	let newTopic = $state('');
	let voiceChannel = $state('');
	let voiceText = $state('');

	/** Wrap a form so its button is disabled while it is in flight and the page reloads after. */
	const run = (name: string, after?: () => void) => () => {
		busy = name;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = null;
			after?.();
		};
	};

	const ownCount = $derived(data.topics.length);
</script>

<svelte:head>
	<title>Topics · SpaceBot</title>
</svelte:head>

<div class="topics-page">
	<header class="page-header">
		<a class="back-link" href="/admin/{data.serverId}">← Back to server</a>
		<h1>Topics</h1>
		<p class="page-desc">
			<code>/topic</code> gives your members a random topic of conversation. Add your own, and optionally
			have it set a voice channel's topic. Off unless you turn it on.
		</p>
	</header>

	{#if form?.error}
		<p class="alert alert-error" role="alert">{form.error}</p>
	{:else if form?.message}
		<p class="alert alert-success" role="status">{form.message}</p>
	{/if}

	{#if !data.available}
		<p class="alert alert-error">The topic command is not available on this deployment yet.</p>
	{:else}
		<section class="card">
			<form method="POST" action="?/enable" use:enhance={run('enable')}>
				<input type="hidden" name="command_id" value={data.commandId} />
				<div class="card-head">
					<div>
						<h2>Turn on /topic</h2>
						<p class="muted">
							Members of this server can then use <code>/topic new</code>. Anyone with
							Manage Server can use the rest.
						</p>
					</div>
					<Switch
						name="enabled"
						bind:checked={enabled}
						label={enabled ? 'On' : 'Off'}
						disabled={busy === 'enable'}
					/>
				</div>
				<button
					class="btn btn-primary"
					type="submit"
					disabled={busy === 'enable' || enabled === data.enabled}
				>
					{busy === 'enable' ? 'Saving…' : 'Save'}
				</button>
			</form>
		</section>

		<section class="card">
			<form method="POST" action="?/options" use:enhance={run('options')}>
				<h2>Options</h2>
				<div class="options">
					<Switch
						name="set_voice_status"
						bind:checked={setVoiceStatus}
						label="Set the voice channel topic"
						description="When someone in a voice channel uses /topic new in that channel's chat, the topic also becomes the channel's topic. Anyone else just gets the topic posted."
					/>
					<Switch
						name="custom_only"
						bind:checked={customOnly}
						label="Use only my own topics"
						description="Skip the built-in topics. While your list is empty the built-in ones are used, so the command never goes quiet."
					/>
				</div>
				<button
					class="btn btn-primary"
					type="submit"
					disabled={busy === 'options' ||
						(setVoiceStatus === data.settings.setVoiceStatus &&
							customOnly === data.settings.customOnly)}
				>
					{busy === 'options' ? 'Saving…' : 'Save options'}
				</button>
			</form>
		</section>

		<section class="card">
			<h2>Your topics</h2>
			<p class="muted">
				{ownCount} of {data.limits.topics}. They are mixed in with the built-in topics
				unless you turn on “Use only my own topics”.
			</p>

			<form
				class="add"
				method="POST"
				action="?/add"
				use:enhance={run('add', () => (newTopic = ''))}
			>
				<label class="field grow">
					<span>New topic</span>
					<input
						name="text"
						bind:value={newTopic}
						maxlength={data.limits.length}
						placeholder="Is a hotdog a sandwich?"
						required
					/>
				</label>
				<button
					class="btn btn-primary"
					type="submit"
					disabled={busy === 'add' || newTopic.trim() === ''}
				>
					{busy === 'add' ? 'Adding…' : 'Add'}
				</button>
			</form>

			{#if ownCount === 0}
				<p class="muted empty">No topics of your own yet.</p>
			{:else}
				<ul class="list">
					{#each data.topics as topic (topic.id)}
						<li>
							<span class="text">{topic.text}</span>
							<form
								method="POST"
								action="?/remove"
								use:enhance={run(`rm${topic.id}`)}
							>
								<input type="hidden" name="id" value={topic.id} />
								<button
									class="btn btn-danger-outline btn-sm"
									type="submit"
									aria-label="Remove: {topic.text}"
									disabled={busy === `rm${topic.id}`}>Remove</button
								>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="card">
			<h2>Set a voice channel's topic</h2>
			<p class="muted">
				Set or clear any voice channel's topic yourself. You do not need to be in the
				channel. SpaceBot needs the <strong>Set Voice Channel Status</strong> permission there.
			</p>
			{#if data.voiceChannels.length === 0}
				<p class="muted empty">
					No voice channels are cached yet. Open this server's dashboard once to sync
					them.
				</p>
			{:else}
				<form method="POST" action="?/voice" use:enhance={run('voice')}>
					<div class="grid">
						<label class="field">
							<span>Voice channel</span>
							<select name="channel_id" bind:value={voiceChannel} required>
								<option value="">— pick a channel —</option>
								{#each data.voiceChannels as c (c.id)}
									<option value={c.id}
										>🔊 {c.name}{c.parent ? ` — ${c.parent}` : ''}</option
									>
								{/each}
							</select>
						</label>
						<label class="field">
							<span>Topic (blank picks one for you)</span>
							<input
								name="text"
								bind:value={voiceText}
								maxlength={data.limits.length}
							/>
						</label>
					</div>
					<div class="actions">
						<button
							class="btn btn-primary"
							type="submit"
							name="mode"
							value="set"
							disabled={busy === 'voice' || voiceChannel === ''}>Set topic</button
						>
						<button
							class="btn btn-secondary"
							type="submit"
							name="mode"
							value="clear"
							disabled={busy === 'voice' || voiceChannel === ''}>Clear topic</button
						>
					</div>
				</form>
			{/if}
		</section>
	{/if}
</div>

<style>
	.topics-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 1.5rem;
	}
	.page-header {
		margin-bottom: 1.5rem;
	}
	.back-link {
		display: inline-block;
		color: var(--color-text-muted);
		text-decoration: none;
		margin-bottom: 0.5rem;
		font-size: 0.875rem;
	}
	.back-link:hover {
		color: var(--color-primary);
	}
	h1 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
		color: var(--color-text);
	}
	.page-desc,
	.muted {
		color: var(--color-text-muted);
		margin: 0;
		font-size: 0.9rem;
	}
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}
	.card h2 {
		margin: 0 0 0.25rem;
		font-size: 1.1rem;
		color: var(--color-text);
	}
	.card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.options {
		display: grid;
		gap: 1rem;
		margin: 1rem 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 1rem 1.5rem;
		margin: 1rem 0;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.9rem;
		color: var(--color-text);
	}
	.field.grow {
		flex: 1;
	}
	.field input,
	.field select {
		padding: 0.5rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
		color: var(--color-text);
	}
	.field input:focus-visible,
	.field select:focus-visible {
		outline: none;
		border-color: var(--color-primary);
	}
	.add {
		display: flex;
		gap: 0.75rem;
		align-items: flex-end;
		margin: 1rem 0;
	}
	.actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--color-border);
	}
	.list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--color-border);
	}
	.text {
		overflow-wrap: anywhere;
		color: var(--color-text);
	}
	.empty {
		margin-top: 1rem;
	}
	.alert {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-sm);
		margin: 0 0 1rem;
		border: 1px solid var(--color-border);
	}
	.alert-error {
		color: var(--color-danger-text);
		border-color: var(--color-danger);
	}
	.alert-success {
		color: var(--color-success-text);
		border-color: var(--color-success);
	}
	@media (max-width: 600px) {
		.add {
			flex-direction: column;
			align-items: stretch;
		}
		.card-head {
			flex-direction: column;
		}
	}
</style>
