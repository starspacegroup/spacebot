<script lang="ts">
	import { enhance } from '$app/forms';

	const { data, form } = $props();

	let showForm = $state(false);
	let selectedScopes = $state<string[]>([]);

	function toggleScope(scope: string) {
		selectedScopes = selectedScopes.includes(scope)
			? selectedScopes.filter((s) => s !== scope)
			: [...selectedScopes, scope];
	}
</script>

<svelte:head><title>Connect apps · Superadmin</title></svelte:head>

<div class="page">
	<header>
		<h1>🔗 Connect applications</h1>
		<p class="muted">
			Sites that can send a server admin to <code>/connect</code> and receive an API key without
			anyone copying one by hand. A redirect URI that isn't listed here is refused, which is what
			stops this flow being used to harvest keys.
		</p>
	</header>

	{#if form?.client_secret}
		<div class="secret-banner">
			<h3>✅ Registered {form.client_id}</h3>
			<p>Copy the secret now. Only its hash is stored — it cannot be shown again.</p>
			<code class="secret">{form.client_secret}</code>
		</div>
	{:else if form?.message}
		<p class="notice" class:error={!form.success}>{form.message}</p>
	{/if}

	<div class="toolbar">
		<h2>Registered</h2>
		<button class="btn btn-primary" onclick={() => (showForm = !showForm)}>
			{showForm ? 'Cancel' : '+ Register an app'}
		</button>
	</div>

	{#if showForm}
		<form method="POST" action="?/create" use:enhance class="card">
			<label class="field">
				<span>Client ID</span>
				<input name="client_id" placeholder="starspace-website" required />
				<small>Lowercase letters, digits and dashes.</small>
			</label>

			<label class="field">
				<span>Display name</span>
				<input name="name" placeholder="*Space" required />
				<small>Shown on the consent screen — this is the name people approve.</small>
			</label>

			<label class="field">
				<span>Description</span>
				<input name="description" placeholder="The *Space home page" />
			</label>

			<label class="field">
				<span>Redirect URIs (one per line)</span>
				<textarea
					name="redirect_uris"
					rows="3"
					placeholder="https://starspace.group/admin/spacebot/callback"
					required></textarea>
				<small>
					Matched exactly, https only. Every address the app may receive a code at must be
					listed.
				</small>
			</label>

			<fieldset class="scopes">
				<legend>Scopes this app may request</legend>
				<div class="scope-grid">
					{#each Object.entries(data.availableScopes) as [scope, label] (scope)}
						<label class="scope">
							<input
								type="checkbox"
								name="allowed_scopes"
								value={scope}
								checked={selectedScopes.includes(scope)}
								onchange={() => toggleScope(scope)}
							/>
							<span><code>{scope}</code> <small>{label}</small></span>
						</label>
					{/each}
				</div>
				<p class="muted small">
					A ceiling, not a grant — the admin approving still chooses which of these to
					allow, and can approve fewer.
				</p>
			</fieldset>

			<button class="btn btn-primary" type="submit">Register</button>
		</form>
	{/if}

	{#if data.clients.length === 0}
		<p class="muted empty">No applications registered.</p>
	{:else}
		<div class="list">
			{#each data.clients as client (client.client_id)}
				<div class="card client" class:disabled={!client.enabled}>
					<div class="client-head">
						<h3>{client.name}</h3>
						<code>{client.client_id}</code>
						{#if !client.enabled}<span class="badge">Disabled</span>{/if}
					</div>
					{#if client.description}
						<p class="muted small">{client.description}</p>
					{/if}
					<p class="muted small">
						Scopes: {client.allowed_scopes.join(', ') || 'none'}
					</p>
					<ul class="uris">
						{#each client.redirect_uris as uri (uri)}
							<li><code>{uri}</code></li>
						{/each}
					</ul>
					<div class="client-actions">
						<form method="POST" action="?/toggle" use:enhance>
							<input type="hidden" name="client_id" value={client.client_id} />
							<input type="hidden" name="enabled" value={String(!client.enabled)} />
							<button class="btn btn-small" type="submit">
								{client.enabled ? 'Disable' : 'Enable'}
							</button>
						</form>
						<form method="POST" action="?/delete" use:enhance>
							<input type="hidden" name="client_id" value={client.client_id} />
							<button class="btn btn-small btn-danger" type="submit">Delete</button>
						</form>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 860px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	h1 {
		margin: 0 0 0.5rem 0;
		font-size: 1.4rem;
		color: var(--color-text);
	}

	h2 {
		margin: 0;
		font-size: 1.05rem;
		color: var(--color-text);
	}

	.muted {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.small {
		font-size: 0.82rem;
	}

	.empty {
		padding: 2rem 0;
		text-align: center;
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 1.5rem 0 1rem;
	}

	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
		margin-bottom: 1rem;
	}

	.client.disabled {
		opacity: 0.6;
	}

	.client-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.client-head h3 {
		margin: 0;
		font-size: 1rem;
		color: var(--color-text);
	}

	.badge {
		font-size: 0.7rem;
		text-transform: uppercase;
		padding: 0.15rem 0.45rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		color: #f59e0b;
	}

	.uris {
		margin: 0.5rem 0 0.75rem;
		padding-left: 1.1rem;
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

	.client-actions {
		display: flex;
		gap: 0.5rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 1rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.field input,
	.field textarea {
		padding: 0.55rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
		color: var(--color-text);
		font-family: inherit;
	}

	.field small {
		font-size: 0.75rem;
		opacity: 0.85;
	}

	.scopes {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.75rem 1rem 1rem;
		margin-bottom: 1rem;
	}

	.scopes legend {
		font-size: 0.85rem;
		color: var(--color-text);
		padding: 0 0.35rem;
	}

	.scope-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 0.4rem;
	}

	.scope {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

	.secret-banner {
		background: var(--color-surface-elevated);
		border: 2px solid #22c55e;
		border-radius: var(--radius-lg);
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.secret-banner h3 {
		margin: 0 0 0.35rem 0;
		color: var(--color-text);
	}

	.secret {
		display: block;
		margin-top: 0.75rem;
		padding: 0.7rem 0.9rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		word-break: break-all;
		color: var(--color-text);
	}

	.notice {
		padding: 0.7rem 0.9rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.notice.error {
		border-color: #ef4444;
		color: #ef4444;
	}

	code {
		background: var(--color-surface-elevated);
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		font-size: 0.85em;
	}
</style>
