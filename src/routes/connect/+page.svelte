<script lang="ts">
	import { enhance } from '$app/forms';

	const { data, form } = $props();

	let selectedGuild = $state(data.guilds?.[0]?.id ?? '');
	let approvedScopes = $state((data.scopes ?? []).map((s) => s.scope));

	function toggleScope(scope: string) {
		approvedScopes = approvedScopes.includes(scope)
			? approvedScopes.filter((s) => s !== scope)
			: [...approvedScopes, scope];
	}
</script>

<svelte:head>
	<title>Connect · SpaceBot</title>
	<!-- A consent screen has no business in anyone's index. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="connect-page">
	{#if data.problem}
		<div class="card problem">
			<h1>🚫 Can't connect</h1>
			<p>{data.problem}</p>
			<p class="muted">
				Nothing was sent anywhere, and no access was granted. If you were expecting this,
				check the link you followed.
			</p>
			<a class="btn btn-secondary" href="/admin">Go to your servers</a>
		</div>
	{:else}
		<div class="card">
			<h1>Connect {data.client.name}</h1>
			{#if data.client.description}
				<p class="muted">{data.client.description}</p>
			{/if}

			<p class="lead">
				<strong>{data.client.name}</strong> is asking to read data from one of your servers.
				Approving creates an API key and sends it to
				<code>{data.redirectHost}</code>.
			</p>

			{#if form?.message}
				<p class="error">{form.message}</p>
			{/if}

			{#if data.guilds.length === 0}
				<p class="error">
					You don't administer any server that SpaceBot is in, so there's nothing to
					connect.
				</p>
				<a class="btn btn-secondary" href="/admin">Go to your servers</a>
			{:else}
				<form method="POST" action="?/approve" use:enhance>
					<label class="field">
						<span>Server</span>
						<select name="guildId" bind:value={selectedGuild} required>
							{#each data.guilds as guild (guild.id)}
								<option value={guild.id}>{guild.name}</option>
							{/each}
						</select>
					</label>

					<fieldset class="scopes">
						<legend>Access being granted</legend>
						{#each data.scopes as item (item.scope)}
							<label class="scope">
								<input
									type="checkbox"
									name="scopes"
									value={item.scope}
									checked={approvedScopes.includes(item.scope)}
									onchange={() => toggleScope(item.scope)}
								/>
								<span>
									<code>{item.scope}</code>
									<small>{item.label}</small>
								</span>
							</label>
						{/each}
						<p class="muted small">
							Untick anything you'd rather not grant — the key is created with only
							what you leave ticked.
						</p>
					</fieldset>

					<div class="actions">
						<button class="btn btn-primary" type="submit"> Approve and connect </button>
						<a class="btn btn-secondary" href="/admin">Cancel</a>
					</div>
				</form>

				<p class="muted small footnote">
					The key is sent to {data.client.name}'s server, not through your browser. You
					can revoke it any time under the server's <strong>API keys</strong> page.
				</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.connect-page {
		max-width: 560px;
		margin: 3rem auto;
		padding: 1.5rem;
	}

	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.75rem;
	}

	.card.problem {
		border-color: #ef4444;
	}

	h1 {
		margin: 0 0 0.75rem 0;
		font-size: 1.35rem;
		color: var(--color-text);
	}

	.lead {
		color: var(--color-text);
		font-size: 0.95rem;
		line-height: 1.5;
	}

	.muted {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.small {
		font-size: 0.8rem;
	}

	.footnote {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
	}

	.error {
		color: #ef4444;
		font-size: 0.9rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 1.25rem 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.field select {
		padding: 0.6rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
		color: var(--color-text);
	}

	.scopes {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.85rem 1rem 1rem;
		margin-bottom: 1.25rem;
	}

	.scopes legend {
		font-size: 0.85rem;
		color: var(--color-text);
		padding: 0 0.35rem;
	}

	.scope {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.scope span {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.scope small {
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	code {
		background: var(--color-surface-elevated);
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		font-size: 0.85em;
	}
</style>
