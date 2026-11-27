<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from '$lib/toast.svelte.js';

	const { data, form } = $props();
	let showCreate = $state(false);
	let name = $state('');
	let description = $state('');
	let confirmDelete = $state<number | null>(null);
	let copied = $state('');

	async function copy(text: string, which: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = which;
			setTimeout(() => (copied = ''), 2500);
		} catch {
			toast.error('Copy failed. Select the text and copy it by hand.');
		}
	}

	$effect(() => {
		if (form?.message && !form.secret) {
			if (form.success) toast.success(form.message);
			else toast.error(form.message);
		}
	});

	const atLimit = $derived(data.limit !== null && data.webhooks.length >= data.limit);
	const when = (s: string | null) =>
		s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString() : 'never';
</script>

<svelte:head>
	<title>Incoming webhooks · {data.guild?.name || 'Server'}</title>
</svelte:head>

<div class="page">
	<header>
		<a href="/admin/{data.serverId}/settings" class="back">← Settings</a>
		<h1>📨 Incoming webhooks</h1>
		<p class="desc">
			Give an outside service a URL to call. Each call fires your automations that use the
			<strong>Webhook received</strong> trigger. Make one webhook per sender, so you can turn one
			off without breaking the rest.
		</p>
	</header>

	{#if form?.secret}
		<div class="secret-banner">
			<h3>Secret for “{form.secretFor}”</h3>
			<p>Copy it now. It is shown once, and only a hash is kept.</p>
			<div class="row">
				<code>{form.secret}</code>
				<button class="btn" onclick={() => copy(form.secret, 'secret')}>
					{copied === 'secret' ? 'Copied' : 'Copy'}
				</button>
			</div>
			<p class="small">Send it as a header, with a JSON body:</p>
			<pre>curl -X POST {form.url} \
  -H "Authorization: Bearer {form.secret}" \
  -H "Content-Type: application/json" \
  -d '&#123;"title":"Deploy finished","status":"ok"&#125;'</pre>
			<p class="small">
				In an automation use <code>{'{webhook.title}'}</code>,
				<code>{'{webhook.status}'}</code>,
				<code>{'{webhook.name}'}</code> or <code>{'{webhook.body}'}</code>. Mentions in the
				sent text are defused, so a caller cannot ping anyone.
			</p>
		</div>
	{/if}

	<section>
		<div class="head">
			<h2>
				Webhooks
				<span class="count"
					>{data.webhooks.length}{data.limit !== null ? ` / ${data.limit}` : ''}</span
				>
			</h2>
			<button
				class="btn primary"
				disabled={atLimit}
				onclick={() => (showCreate = !showCreate)}
			>
				+ New webhook
			</button>
		</div>
		{#if atLimit}
			<p class="warn">
				You have reached this server's limit. Delete one or upgrade the plan.
			</p>
		{/if}

		{#if showCreate}
			<form
				method="POST"
				action="?/create"
				class="card"
				use:enhance={() =>
					async ({ update }) => {
						await update();
						showCreate = false;
						name = '';
						description = '';
					}}
			>
				<label
					>Name <input
						name="name"
						bind:value={name}
						maxlength="64"
						required
						placeholder="GitHub deploys"
					/></label
				>
				<label
					>Note <input
						name="description"
						bind:value={description}
						maxlength="300"
						placeholder="Optional"
					/></label
				>
				<button class="btn primary" type="submit">Create</button>
			</form>
		{/if}

		{#if data.webhooks.length === 0}
			<p class="empty">No incoming webhooks yet.</p>
		{/if}
		{#each data.webhooks as h (h.id)}
			<div class="card">
				<div class="top">
					<h3>{h.name}</h3>
					<span class="badge {h.enabled ? 'on' : 'off'}"
						>{h.enabled ? 'Enabled' : 'Disabled'}</span
					>
				</div>
				{#if h.description}<p class="desc">{h.description}</p>{/if}
				<div class="row">
					<code>{h.url}</code>
					<button class="btn" onclick={() => copy(h.url, 'u' + h.id)}>
						{copied === 'u' + h.id ? 'Copied' : 'Copy URL'}
					</button>
				</div>
				<p class="meta">
					Secret starts <code>{h.secret_prefix}…</code> · {h.receive_count} calls · last {when(
						h.last_received_at
					)}
					{#if h.last_status && h.last_status !== 'accepted'}· last refusal: {h.last_status}{/if}
				</p>
				<div class="actions">
					<form method="POST" action="?/toggle" use:enhance>
						<input type="hidden" name="id" value={h.id} />
						<input type="hidden" name="enabled" value={!h.enabled} />
						<button class="btn">{h.enabled ? 'Disable' : 'Enable'}</button>
					</form>
					<form method="POST" action="?/rotate" use:enhance>
						<input type="hidden" name="id" value={h.id} />
						<button class="btn">Rotate secret</button>
					</form>
					{#if confirmDelete === h.id}
						<form method="POST" action="?/delete" use:enhance>
							<input type="hidden" name="id" value={h.id} />
							<button class="btn danger">Delete for good</button>
						</form>
						<button class="btn" onclick={() => (confirmDelete = null)}>Cancel</button>
					{:else}
						<button class="btn danger" onclick={() => (confirmDelete = h.id)}
							>Delete</button
						>
					{/if}
				</div>
			</div>
		{/each}
	</section>
</div>

<style>
	.page {
		max-width: 860px;
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
	.small,
	.meta,
	.empty {
		color: var(--color-text-muted);
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.count {
		color: var(--color-text-muted);
		font-size: 0.85em;
		margin-left: 0.5rem;
	}
	.card,
	.secret-banner {
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
		margin: 0.75rem 0;
	}
	.secret-banner {
		border-color: var(--color-primary);
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	h3 {
		margin: 0;
		color: var(--color-text);
	}
	.row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	code,
	pre {
		background: var(--color-surface);
		border-radius: var(--radius-sm);
		padding: 0.25rem 0.5rem;
		color: var(--color-text);
		word-break: break-all;
	}
	pre {
		white-space: pre-wrap;
		padding: 0.75rem;
	}
	label {
		display: block;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}
	input[name] {
		width: 100%;
		padding: 0.4rem;
		margin-top: 0.25rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}
	.btn {
		padding: 0.4rem 0.8rem;
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
	.btn.danger {
		border-color: #e74c3c;
		color: #e74c3c;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.badge {
		font-size: 0.8em;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
	}
	.badge.on {
		background: rgba(46, 204, 113, 0.2);
		color: #2ecc71;
	}
	.badge.off {
		background: rgba(231, 76, 60, 0.2);
		color: #e74c3c;
	}
	.warn {
		color: #e67e22;
	}
</style>
