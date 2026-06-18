<script lang="ts">
	import { enhance } from '$app/forms';
	import Toast from '$lib/components/Toast.svelte';
	import { formatDate as tzFormatDate, parseUTCDate } from '$lib/timezone.js';
	
	let { data, form } = $props();
	
	let showToast = $state(true);
	let showCreateModal = $state(false);
	let deleteConfirmId = $state(null);
	let revokeConfirmId = $state(null);
	let copiedKey = $state(false);
	
	// Form fields
	let keyName = $state('');
	let keyDescription = $state('');
	let selectedScopes = $state([]);
	let expiresAt = $state('');
	
	function openCreateModal() {
		keyName = '';
		keyDescription = '';
		selectedScopes = [];
		expiresAt = '';
		showCreateModal = true;
	}
	
	function closeCreateModal() {
		showCreateModal = false;
	}
	
	function toggleScope(scope) {
		if (selectedScopes.includes(scope)) {
			selectedScopes = selectedScopes.filter(s => s !== scope);
		} else {
			selectedScopes = [...selectedScopes, scope];
		}
	}
	
	function selectAllScopes() {
		selectedScopes = Object.keys(data.availableScopes);
	}
	
	function selectReadOnly() {
		selectedScopes = Object.keys(data.availableScopes).filter(s => s.endsWith(':read'));
	}
	
	async function copyToClipboard(text) {
		try {
			await navigator.clipboard.writeText(text);
			copiedKey = true;
			setTimeout(() => copiedKey = false, 3000);
		} catch (err) {
			// Fallback for non-secure contexts
			const textarea = document.createElement('textarea');
			textarea.value = text;
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			document.body.removeChild(textarea);
			copiedKey = true;
			setTimeout(() => copiedKey = false, 3000);
		}
	}
	
	function formatDate(dateStr) {
		if (!dateStr) return 'Never';
		return tzFormatDate(dateStr, data.timezone);
	}
	
	function isExpired(expiresAt) {
		if (!expiresAt) return false;
		const date = parseUTCDate(expiresAt);
		return date ? date < new Date() : false;
	}
	
	function getKeyStatus(key) {
		if (key.revoked) return { label: 'Revoked', class: 'status-revoked' };
		if (isExpired(key.expires_at)) return { label: 'Expired', class: 'status-expired' };
		return { label: 'Active', class: 'status-active' };
	}

	// Reset toast when form result changes
	$effect(() => {
		if (form) {
			showToast = true;
			// Close modal on successful creation
			if (form.success && !form.rawKey) {
				showCreateModal = false;
			}
		}
	});
</script>

<svelte:head>
	<title>API Keys - {data.guild?.name || 'Server'} | SpaceBot</title>
</svelte:head>

<div class="api-keys-page">
	{#if form?.message && showToast && !form?.rawKey}
		<Toast message={form.message} success={form.success} onDismiss={() => showToast = false} />
	{/if}
	
	<header class="page-header">
		<a href="/admin/{data.serverId}" class="back-link">← Back to Dashboard</a>
		<h1>🔑 API Keys</h1>
		<p class="page-desc">Create API keys to allow external applications to connect to the SpaceBot API and MCP server for this server.</p>
	</header>
	
	<!-- Newly Created Key Display -->
	{#if form?.rawKey}
		<div class="new-key-banner">
			<div class="new-key-header">
				<span class="new-key-icon">✅</span>
				<div>
					<h3>API Key Created</h3>
					<p>Copy this key now. You won't be able to see it again!</p>
				</div>
			</div>
			<div class="new-key-value">
				<code class="key-display">{form.rawKey}</code>
				<button class="btn btn-small" onclick={() => copyToClipboard(form.rawKey)}>
					{copiedKey ? '✓ Copied!' : '📋 Copy'}
				</button>
			</div>
			<div class="new-key-usage">
				<h4>Usage</h4>
				<div class="usage-examples">
					<div class="usage-example">
						<span class="usage-label">HTTP Header</span>
						<code>Authorization: Bearer {form.rawKey}</code>
					</div>
					<div class="usage-example">
						<span class="usage-label">cURL</span>
						<code>curl -H "Authorization: Bearer {form.rawKey}" https://spacebot-dev.starspace.group/api/v1/logs</code>
					</div>
					<div class="usage-example">
						<span class="usage-label">MCP Config</span>
						<code>{`{ "apiKey": "${form.rawKey}" }`}</code>
					</div>
				</div>
			</div>
			<button class="btn btn-secondary" onclick={() => { form = null; showCreateModal = false; }}>
				Dismiss
			</button>
		</div>
	{/if}
	
	<!-- API Keys List -->
	<section class="keys-section">
		<div class="section-header">
			<h2>Your API Keys</h2>
			<button class="btn btn-primary" onclick={openCreateModal}>
				+ Create API Key
			</button>
		</div>
		
		{#if data.apiKeys.length === 0}
			<div class="empty-state">
				<span class="empty-icon">🔑</span>
				<p>No API keys yet</p>
				<span class="empty-hint">Create an API key to allow external apps to access the SpaceBot API for this server.</span>
			</div>
		{:else}
			<div class="keys-list">
				{#each data.apiKeys as key (key.id)}
					{@const status = getKeyStatus(key)}
					<div class="key-card" class:key-revoked={key.revoked} class:key-expired={isExpired(key.expires_at)}>
						<div class="key-header">
							<div class="key-info">
								<h3 class="key-name">{key.name}</h3>
								<span class="key-prefix">{key.key_prefix}...</span>
								<span class="status-badge {status.class}">{status.label}</span>
							</div>
						</div>
						
						{#if key.description}
							<p class="key-description">{key.description}</p>
						{/if}
						
						<div class="key-scopes">
							{#each key.scopes as scope}
								<span class="scope-badge">{scope}</span>
							{/each}
						</div>
						
						<div class="key-meta">
							<span title="Created">📅 Created: {formatDate(key.created_at)}</span>
							<span title="Last used">🕐 Last used: {formatDate(key.last_used_at)}</span>
							{#if key.expires_at}
								<span title="Expires" class:expired-text={isExpired(key.expires_at)}>
									⏳ {isExpired(key.expires_at) ? 'Expired' : 'Expires'}: {formatDate(key.expires_at)}
								</span>
							{:else}
								<span>♾️ No expiration</span>
							{/if}
						</div>
						
						<div class="key-actions">
							{#if !key.revoked}
								{#if revokeConfirmId === key.id}
									<form method="POST" action="?/revokeApiKey" use:enhance={() => {
										return async ({ update }) => {
											revokeConfirmId = null;
											await update({ invalidateAll: true });
										};
									}}>
										<input type="hidden" name="keyId" value={key.id} />
										<span class="confirm-text">Revoke this key?</span>
										<button type="submit" class="btn btn-danger btn-small">Yes, Revoke</button>
										<button type="button" class="btn btn-secondary btn-small" onclick={() => revokeConfirmId = null}>Cancel</button>
									</form>
								{:else}
									<button class="btn btn-warning-outline btn-small" onclick={() => revokeConfirmId = key.id}>
										Revoke
									</button>
								{/if}
							{/if}
							
							{#if deleteConfirmId === key.id}
								<form method="POST" action="?/deleteApiKey" use:enhance={() => {
									return async ({ update }) => {
										deleteConfirmId = null;
										await update({ invalidateAll: true });
									};
								}}>
									<input type="hidden" name="keyId" value={key.id} />
									<span class="confirm-text">Delete permanently?</span>
									<button type="submit" class="btn btn-danger btn-small">Yes, Delete</button>
									<button type="button" class="btn btn-secondary btn-small" onclick={() => deleteConfirmId = null}>Cancel</button>
								</form>
							{:else}
								<button class="btn btn-danger-outline btn-small" onclick={() => deleteConfirmId = key.id}>
									Delete
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
	
	<!-- API Documentation Hint -->
	<section class="docs-section">
		<h2><span class="section-icon">📖</span> API Usage</h2>
		<div class="docs-card">
			<h3>Authentication</h3>
			<p>Include your API key in the <code>Authorization</code> header of every request:</p>
			<pre><code>Authorization: Bearer sb_live_your_key_here</code></pre>
			
			<h3>Available Endpoints</h3>
			<div class="endpoint-list">
				<div class="endpoint">
					<span class="endpoint-method get">GET</span>
					<code>/api/v1/logs</code>
					<span class="endpoint-scope">logs:read</span>
				</div>
				<div class="endpoint">
					<span class="endpoint-method get">GET</span>
					<code>/api/v1/automations</code>
					<span class="endpoint-scope">automations:read</span>
				</div>
				<div class="endpoint">
					<span class="endpoint-method get">GET</span>
					<code>/api/v1/commands</code>
					<span class="endpoint-scope">commands:read</span>
				</div>
				<div class="endpoint">
					<span class="endpoint-method get">GET</span>
					<code>/api/v1/stats</code>
					<span class="endpoint-scope">stats:read</span>
				</div>
				<div class="endpoint">
					<span class="endpoint-method get">GET</span>
					<code>/api/v1/settings</code>
					<span class="endpoint-scope">settings:read</span>
				</div>
			</div>
			
			<h3>MCP Server</h3>
			<p>Use your API key with the SpaceBot MCP server to connect AI assistants:</p>
			<pre><code>{JSON.stringify({
  "mcpServers": {
    "spacebot": {
      "url": "https://spacebot-dev.starspace.group/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer sb_live_your_key_here"
      }
    }
  }
}, null, 2)}</code></pre>
		</div>
	</section>
	
	<!-- Create API Key Modal -->
	{#if showCreateModal}
		<div class="modal-overlay" onclick={closeCreateModal} role="presentation">
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="create-key-title" tabindex="-1">
				<div class="modal-header">
					<h2 id="create-key-title">Create API Key</h2>
					<button class="modal-close" onclick={closeCreateModal} aria-label="Close">×</button>
				</div>
				
				<form method="POST" action="?/createApiKey" use:enhance={() => {
					return async ({ update }) => {
						await update({ invalidateAll: true });
					};
				}}>
					<div class="modal-body">
						<div class="form-group">
							<label class="form-label" for="keyName">Name *</label>
							<input
								type="text"
								id="keyName"
								name="keyName"
								class="form-input"
								bind:value={keyName}
								placeholder="e.g., My Dashboard App"
								required
								maxlength="100"
							/>
							<span class="form-hint">A descriptive name for this API key</span>
						</div>
						
						<div class="form-group">
							<label class="form-label" for="keyDescription">Description</label>
							<textarea
								id="keyDescription"
								name="keyDescription"
								class="form-textarea"
								bind:value={keyDescription}
								placeholder="What is this key used for?"
								rows="2"
								maxlength="500"
							></textarea>
						</div>
						
						<div class="form-group">
							<span class="form-label">Permissions *</span>
							<span class="form-hint">Select which resources this key can access</span>
							<div class="scope-presets">
								<button type="button" class="btn btn-small btn-secondary" onclick={selectReadOnly}>Read Only</button>
								<button type="button" class="btn btn-small btn-secondary" onclick={selectAllScopes}>All Permissions</button>
							</div>
							<div class="scopes-grid">
								{#each Object.entries(data.availableScopes) as [scope, description]}
									<label class="scope-option">
										<input
											type="checkbox"
											name="scopes"
											value={scope}
											checked={selectedScopes.includes(scope)}
											onchange={() => toggleScope(scope)}
										/>
										<div class="scope-detail">
											<span class="scope-name">{scope}</span>
											<span class="scope-desc">{description}</span>
										</div>
									</label>
								{/each}
							</div>
						</div>
						
						<div class="form-group">
							<label class="form-label" for="expiresAt">Expiration (optional)</label>
							<input
								type="datetime-local"
								id="expiresAt"
								name="expiresAt"
								class="form-input"
								bind:value={expiresAt}
							/>
							<span class="form-hint">Leave empty for a key that never expires</span>
						</div>
					</div>
					
					<div class="modal-footer">
						<button type="button" class="btn btn-secondary" onclick={closeCreateModal}>Cancel</button>
						<button type="submit" class="btn btn-primary" disabled={!keyName.trim() || selectedScopes.length === 0}>
							Create API Key
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</div>

<style>
	.api-keys-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 1.5rem;
	}
	
	/* Page Header */
	.page-header {
		margin-bottom: 2rem;
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
	
	.page-header h1 {
		margin: 0 0 0.5rem 0;
		font-size: 1.5rem;
		color: var(--color-text);
	}
	
	.page-desc {
		color: var(--color-text-muted);
		margin: 0;
		font-size: 0.9rem;
	}
	
	/* New Key Banner */
	.new-key-banner {
		background: var(--color-surface-elevated);
		border: 2px solid #22c55e;
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		margin-bottom: 2rem;
	}
	
	.new-key-header {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	
	.new-key-icon {
		font-size: 1.5rem;
	}
	
	.new-key-header h3 {
		margin: 0;
		color: var(--color-text);
	}
	
	.new-key-header p {
		margin: 0.25rem 0 0 0;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}
	
	.new-key-value {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
		background: var(--color-surface);
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
	}
	
	.key-display {
		flex: 1;
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.85rem;
		word-break: break-all;
		color: var(--color-text);
	}
	
	.new-key-usage {
		margin-bottom: 1rem;
	}
	
	.new-key-usage h4 {
		margin: 0 0 0.5rem 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	
	.usage-examples {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.usage-example {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	
	.usage-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-weight: 600;
	}
	
	.usage-example code {
		font-size: 0.8rem;
		background: var(--color-surface);
		padding: 0.35rem 0.5rem;
		border-radius: var(--radius-sm);
		word-break: break-all;
		color: var(--color-text);
	}
	
	/* Section */
	.keys-section {
		margin-bottom: 2rem;
	}
	
	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}
	
	.section-header h2 {
		margin: 0;
		font-size: 1.1rem;
		color: var(--color-text);
	}
	
	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 3rem 1.5rem;
		background: var(--color-surface);
		border-radius: var(--radius-lg);
		border: 1px solid var(--color-border);
	}
	
	.empty-icon {
		font-size: 2.5rem;
		display: block;
		margin-bottom: 0.75rem;
	}
	
	.empty-state p {
		margin: 0 0 0.5rem 0;
		color: var(--color-text);
		font-weight: 500;
	}
	
	.empty-hint {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}
	
	/* Key Cards */
	.keys-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	
	.key-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
		transition: border-color 0.15s;
	}
	
	.key-card:hover {
		border-color: var(--color-primary);
	}
	
	.key-card.key-revoked,
	.key-card.key-expired {
		opacity: 0.6;
	}
	
	.key-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}
	
	.key-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	
	.key-name {
		margin: 0;
		font-size: 1rem;
		color: var(--color-text);
	}
	
	.key-prefix {
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		background: var(--color-surface-elevated);
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-sm);
	}
	
	.status-badge {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 9999px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	
	.status-active {
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
	}
	
	.status-revoked {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}
	
	.status-expired {
		background: rgba(234, 179, 8, 0.15);
		color: #eab308;
	}
	
	.key-description {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin: 0 0 0.75rem 0;
	}
	
	.key-scopes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
	}
	
	.scope-badge {
		font-size: 0.7rem;
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		background: var(--color-surface-elevated);
		color: var(--color-text-muted);
		padding: 0.2rem 0.5rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
	}
	
	.key-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
	}
	
	.expired-text {
		color: #ef4444;
	}
	
	.key-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	
	.key-actions form {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	
	.confirm-text {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	
	/* Docs Section */
	.docs-section {
		margin-bottom: 2rem;
	}
	
	.docs-section h2 {
		margin: 0 0 1rem 0;
		font-size: 1.1rem;
		color: var(--color-text);
	}
	
	.section-icon {
		margin-right: 0.25rem;
	}
	
	.docs-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
	}
	
	.docs-card h3 {
		margin: 0 0 0.5rem 0;
		font-size: 0.95rem;
		color: var(--color-text);
	}
	
	.docs-card h3:not(:first-child) {
		margin-top: 1.25rem;
	}
	
	.docs-card p {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin: 0 0 0.5rem 0;
	}
	
	.docs-card pre {
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.75rem 1rem;
		overflow-x: auto;
		margin: 0.5rem 0;
	}
	
	.docs-card pre code {
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.8rem;
		color: var(--color-text);
	}
	
	.docs-card code {
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.85rem;
	}
	
	.endpoint-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	
	.endpoint {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0;
		font-size: 0.875rem;
	}
	
	.endpoint-method {
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0.15rem 0.4rem;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	
	.endpoint-method.get {
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
	}
	
	.endpoint code {
		color: var(--color-text);
	}
	
	.endpoint-scope {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin-left: auto;
	}
	
	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: var(--color-overlay-scrim);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}
	
	.modal {
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		width: 100%;
		max-width: 560px;
		max-height: 90vh;
		overflow-y: auto;
	}
	
	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--color-border);
	}
	
	.modal-header h2 {
		margin: 0;
		font-size: 1.1rem;
		color: var(--color-text);
	}
	
	.modal-close {
		background: none;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		color: var(--color-text-muted);
		padding: 0;
		line-height: 1;
	}
	
	.modal-close:hover {
		color: var(--color-text);
	}
	
	.modal-body {
		padding: 1.5rem;
	}
	
	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--color-border);
	}
	
	/* Form Elements */
	.form-group {
		margin-bottom: 1.25rem;
	}
	
	.form-label {
		display: block;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		margin-bottom: 0.35rem;
	}
	
	.form-input,
	.form-textarea {
		width: 100%;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-family: inherit;
	}
	
	.form-input:focus,
	.form-textarea:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.2);
	}
	
	.form-hint {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}
	
	.form-textarea {
		resize: vertical;
	}
	
	/* Scope Selection */
	.scope-presets {
		display: flex;
		gap: 0.5rem;
		margin: 0.5rem 0;
	}
	
	.scopes-grid {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-top: 0.5rem;
	}
	
	.scope-option {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color 0.15s;
	}
	
	.scope-option:hover {
		border-color: var(--color-primary);
	}
	
	.scope-option input[type="checkbox"] {
		margin-top: 0.15rem;
	}
	
	.scope-detail {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	
	.scope-name {
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.85rem;
		color: var(--color-text);
	}
	
	.scope-desc {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	
	/* Responsive */
	@media (max-width: 640px) {
		.api-keys-page {
			padding: 1rem;
		}
		
		.section-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.75rem;
		}
		
		.key-meta {
			flex-direction: column;
			gap: 0.25rem;
		}
		
		.key-actions {
			flex-direction: column;
			align-items: flex-start;
		}
		
		.endpoint {
			flex-wrap: wrap;
		}
		
		.endpoint-scope {
			margin-left: 0;
		}
	}
</style>
