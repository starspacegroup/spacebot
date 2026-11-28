<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from '$lib/toast.svelte.js';

	const { data, form } = $props();

	// The form starts from what is saved; later edits are the owner's.
	// svelte-ignore state_referenced_locally
	let enabled = $state(data.identity.enabled);
	// svelte-ignore state_referenced_locally
	let name = $state(data.identity.name ?? '');
	// svelte-ignore state_referenced_locally
	let mode = $state<'server_icon' | 'custom'>(data.identity.avatar_mode);
	let picked = $state<string | null>(null);
	let busy = $state(false);

	const shownName = $derived(name.trim() || data.defaultName);
	const shownImage = $derived(
		mode === 'custom' ? (picked ?? data.customImagePreview) : data.defaultIconUrl
	);

	function onPick(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!f) return (picked = null);
		if (f.size > data.maxImageKb * 1024) {
			toast.error(`The image is over ${data.maxImageKb} KB.`);
			(e.currentTarget as HTMLInputElement).value = '';
			return (picked = null);
		}
		picked = URL.createObjectURL(f);
	}

	$effect(() => {
		if (form?.message) {
			if (form.success) toast.success(form.message);
			else toast.error(form.message);
		}
	});
</script>

<svelte:head>
	<title>Bot name and image · {data.guild?.name || 'Server'}</title>
</svelte:head>

<div class="page">
	<a href="/admin/{data.serverId}/settings" class="back">← Settings</a>
	<h1>🪪 Bot name and image</h1>
	<p class="desc">
		Let the bot go by its own name and picture on this server. Other servers do not see it.
		Discord shows the name in the member list and on every message the bot sends here.
	</p>

	<form
		method="POST"
		action="?/save"
		enctype="multipart/form-data"
		class="card"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update({ reset: false });
				busy = false;
			};
		}}
	>
		<label class="toggle">
			<input type="checkbox" name="enabled" bind:checked={enabled} />
			<span>Use a custom name and image on this server</span>
		</label>

		<div class="preview" class:off={!enabled}>
			{#if shownImage}
				<img src={shownImage} alt="" width="56" height="56" />
			{:else}
				<div class="ph">🤖</div>
			{/if}
			<div>
				<strong>{enabled ? shownName : 'SpaceBot'}</strong>
				<span class="bot-tag">BOT</span>
			</div>
		</div>

		<fieldset disabled={!enabled}>
			<label>
				Name
				<input
					name="name"
					bind:value={name}
					maxlength={data.maxNick}
					placeholder={data.defaultName}
				/>
				<small>Leave empty for “{data.defaultName}”. Up to {data.maxNick} characters.</small
				>
			</label>

			<div class="radios">
				<span>Image</span>
				<label>
					<input type="radio" name="avatar_mode" value="server_icon" bind:group={mode} />
					This server's icon (follows it when the icon changes)
				</label>
				<label>
					<input type="radio" name="avatar_mode" value="custom" bind:group={mode} />
					A picture I choose
				</label>
				{#if mode === 'custom'}
					<input
						type="file"
						name="avatar"
						accept="image/png,image/jpeg,image/gif,image/webp"
						onchange={onPick}
					/>
					<small>PNG, JPEG, GIF or WebP, up to {data.maxImageKb} KB.</small>
				{/if}
			</div>
		</fieldset>

		<p class="note">
			The bot needs the <strong>Change Nickname</strong> permission on this server to set its name.
		</p>
		<button class="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
	</form>

	{#if data.identity.last_error}
		<div class="card err">
			<strong>The last attempt failed.</strong>
			<p>{data.identity.last_error}</p>
			<form method="POST" action="?/reapply" use:enhance>
				<button class="btn">Try again</button>
			</form>
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 720px;
		margin: 0 auto;
		padding: 1rem;
	}
	.back {
		color: var(--color-primary);
		text-decoration: none;
	}
	h1 {
		color: var(--color-text);
		margin: 0.5rem 0;
	}
	.desc,
	small,
	.note {
		color: var(--color-text-muted);
	}
	small {
		display: block;
		margin-top: 0.25rem;
	}
	.card {
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
		margin: 0.75rem 0;
	}
	.card.err {
		border-color: var(--color-danger, #dc3545);
	}
	.toggle {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		color: var(--color-text);
		font-weight: 600;
	}
	.preview {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		margin: 1rem 0;
		color: var(--color-text);
	}
	.preview.off {
		opacity: 0.6;
	}
	.preview img,
	.ph {
		border-radius: 50%;
		object-fit: cover;
		width: 56px;
		height: 56px;
		background: var(--color-surface);
		display: grid;
		place-items: center;
	}
	.bot-tag {
		background: var(--color-primary);
		color: var(--color-fixed-text-bright);
		font-size: 0.65em;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		margin-left: 0.4rem;
		vertical-align: middle;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
	}
	fieldset:disabled {
		opacity: 0.55;
	}
	label {
		display: block;
		color: var(--color-text);
		margin-bottom: 0.75rem;
	}
	input[name='name'] {
		width: 100%;
		padding: 0.4rem;
		margin-top: 0.25rem;
	}
	.radios {
		display: grid;
		gap: 0.35rem;
		color: var(--color-text);
	}
	.radios label {
		margin: 0;
	}
	.btn {
		padding: 0.4rem 0.9rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
	}
	.btn.primary {
		background: var(--color-primary);
		color: var(--color-fixed-text-bright);
		border-color: transparent;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: wait;
	}
</style>
