<script>
	import { enhance } from '$app/forms';
	import Toast from '$lib/components/Toast.svelte';
	import { formatDateShort } from '$lib/timezone.js';

	let { data, form } = $props();

	let showToast = $state(true);
	let confirmDisableId = $state(null);
	let expandedId = $state(null);

	// Category metadata
	const CATEGORIES = {
		gaming: { icon: '🎮', label: 'Gaming' },
		ai: { icon: '🤖', label: 'AI Providers' },
		moderation: { icon: '🛡️', label: 'Moderation' },
		utility: { icon: '🔧', label: 'Utility' },
		general: { icon: '📦', label: 'General' },
	};

	function getCategoryInfo(cat) {
		return CATEGORIES[cat] || CATEGORIES.general;
	}

	function getCommandCount(integration) {
		const manifest = integration.manifest;
		if (!manifest?.commands) return 0;
		return manifest.commands.length;
	}

	function toggleExpand(id) {
		expandedId = expandedId === id ? null : id;
	}

	$effect(() => {
		if (form) {
			showToast = true;
			confirmDisableId = null;
		}
	});
</script>

<svelte:head>
	<title>Integrations - {data.guild?.name || 'Server'} | SpaceBot</title>
</svelte:head>

<div class="integrations-page">
	{#if form?.message && showToast}
		<Toast message={form.message} success={form.success} onDismiss={() => showToast = false} />
	{/if}

	<header class="page-header">
		<a href="/admin/{data.serverId}" class="back-link">← Back to Dashboard</a>
		<h1>🔌 Integrations</h1>
		<p class="page-desc">Enable third-party integrations to extend your server with new commands, features, and connections to external services.</p>
	</header>

	<!-- Integrations List -->
	{#if data.integrations.length === 0}
		<div class="empty-state">
			<span class="empty-icon">🔌</span>
			<p>No integrations available</p>
			<span class="empty-hint">Check back later — new integrations are being added regularly.</span>
		</div>
	{:else}
		<div class="integrations-grid">
			{#each data.integrations as integration (integration.id)}
				{@const category = getCategoryInfo(integration.category)}
				{@const commandCount = getCommandCount(integration)}
				{@const isEnabled = integration.guild_enabled}
				{@const isExpanded = expandedId === integration.id}

				<div class="integration-card" class:integration-enabled={isEnabled}>
					<div class="card-header">
						<div class="card-icon">{integration.icon || category.icon}</div>
						<div class="card-info">
							<div class="card-title-row">
								<h3 class="card-title">{integration.name}</h3>
								{#if integration.is_official}
									<span class="official-badge">Official</span>
								{/if}
							</div>
							<div class="card-meta">
								<span class="category-badge">{category.icon} {category.label}</span>
								{#if integration.author}
									<span class="meta-item">by {#if integration.manifest?.author_url}<a href={integration.manifest.author_url} target="_blank" rel="noopener noreferrer">{integration.author}</a>{:else}{integration.author}{/if}</span>
								{/if}
								<span class="meta-item">v{integration.version}</span>
							</div>
						</div>
						<div class="card-status">
							{#if isEnabled}
								<span class="status-badge status-enabled">Enabled</span>
							{:else}
								<span class="status-badge status-disabled">Disabled</span>
							{/if}
							{#if integration.status === 'online'}
								<span class="connection-badge connection-online" title="Integration is connected and responding">🟢 Online</span>
							{:else if integration.status === 'offline'}
								<span class="connection-badge connection-offline" title="Integration is not responding">🔴 Offline</span>
							{:else}
								<span class="connection-badge connection-unknown" title="Status unknown">⚪ Unknown</span>
							{/if}
						</div>
					</div>

					<p class="card-description">{integration.description}</p>

					<!-- What this integration adds -->
					{#if commandCount > 0}
						<div class="card-features">
							<span class="feature-tag">💬 {commandCount} command{commandCount !== 1 ? 's' : ''}</span>
						</div>
					{/if}

					<!-- Expand for details -->
					<button class="expand-btn" onclick={() => toggleExpand(integration.id)}>
						{isExpanded ? 'Hide Details ▲' : 'Show Details ▼'}
					</button>

					{#if isExpanded}
						<div class="card-details">
							{#if integration.slug === 'github' && isEnabled}
								<div class="detail-section">
									<h4>Setup Instructions</h4>
									<p class="setup-instructions">Add this webhook URL to your GitHub repository settings under <strong>Settings → Webhooks → Add webhook</strong>:</p>
									<div class="copyable-field">
										<code class="copyable-value">{window?.location?.origin || 'https://spacebot.starspace.group'}/api/v1/integrations/github/webhook/{data.serverId}</code>
										<button class="btn-copy" onclick={(e) => {
											const url = `${window.location.origin}/api/v1/integrations/github/webhook/${data.serverId}`;
											navigator.clipboard.writeText(url);
											e.target.textContent = '✓ Copied';
											setTimeout(() => e.target.textContent = 'Copy', 2000);
										}}>Copy</button>
									</div>

									{#if integration.guild_config?.webhook_secret}
										<p class="setup-instructions" style="margin-top: 0.75rem;">Set the <strong>Secret</strong> in GitHub to:</p>
										<div class="copyable-field">
											<code class="copyable-value secret">{'•'.repeat(integration.guild_config.webhook_secret.length)}</code>
											<button class="btn-copy" onclick={(e) => {
												navigator.clipboard.writeText(integration.guild_config.webhook_secret);
												e.target.textContent = '✓ Copied';
												setTimeout(() => e.target.textContent = 'Copy', 2000);
											}}>Copy</button>
										</div>
									{/if}

									<p class="setup-instructions" style="margin-top: 0.75rem;">Set <strong>Content type</strong> to <code>application/json</code>. Choose which events to send, or select "Send me everything".</p>

									<div class="github-events-info">
										<h4 style="margin-top: 1rem;">Available Events for Automations</h4>
										<div class="github-events-list">
											<span class="github-event-tag">🔀 Push</span>
											<span class="github-event-tag">🔃 Pull Request</span>
											<span class="github-event-tag">🐛 Issues</span>
											<span class="github-event-tag">💬 Issue Comment</span>
											<span class="github-event-tag">🏷️ Release</span>
											<span class="github-event-tag">⭐ Star</span>
											<span class="github-event-tag">🍴 Fork</span>
											<span class="github-event-tag">⚙️ Workflow Run</span>
										</div>
									</div>
								</div>
							{:else if integration.slug === 'github' && !isEnabled}
								<div class="detail-section">
									<p class="setup-instructions">Enable this integration to get a webhook URL and secret for your GitHub repository. Once connected, you can create automations that trigger on GitHub events like pushes, pull requests, issues, and more.</p>
								</div>
							{/if}

							{#if integration.manifest?.commands?.length}
								<div class="detail-section">
									<h4>Commands</h4>
									<div class="commands-list">
										{#each integration.manifest.commands as cmd}
											<div class="command-item">
												<code>/{cmd.name}</code>
												<span class="command-desc">{cmd.description}</span>
												{#if cmd.options?.length}
													<div class="subcommands">
														{#each cmd.options.filter(o => o.type === 1) as sub}
															<div class="subcommand">
																<code>/{cmd.name} {sub.name}</code>
																<span>{sub.description}</span>
															</div>
														{/each}
													</div>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/if}

							{#if integration.manifest?.config_schema?.length}
								<div class="detail-section">
									<h4>Configuration</h4>
									<div class="config-fields">
										{#each integration.manifest.config_schema as field}
											<div class="config-field">
												<span class="config-key">{field.label}</span>
												<span class="config-type">{field.type}</span>
												{#if field.required}
													<span class="config-required">Required</span>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/if}

							{#if integration.manifest?.homepage}
								<div class="detail-section">
									<a href={integration.manifest.homepage} target="_blank" rel="noopener noreferrer" class="homepage-link">
										🔗 View Project Homepage →
									</a>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Offline warning for enabled integrations -->
					{#if isEnabled && integration.status === 'offline'}
						<div class="offline-warning">
							⚠️ This integration is currently offline. Its commands are temporarily unavailable and will return automatically when the service reconnects.
						</div>
					{/if}

					<!-- Actions -->
					<div class="card-actions">
						{#if isEnabled}
							{#if confirmDisableId === integration.id}
								<form method="POST" action="?/disableIntegration" use:enhance={() => {
									return async ({ update }) => {
										confirmDisableId = null;
										await update({ invalidateAll: true });
									};
								}}>
									<input type="hidden" name="integrationId" value={integration.id} />
									<span class="confirm-text">Disable this integration? Its commands will be removed.</span>
									<div class="confirm-buttons">
										<button type="submit" class="btn btn-danger btn-small">Yes, Disable</button>
										<button type="button" class="btn btn-secondary btn-small" onclick={() => confirmDisableId = null}>Cancel</button>
									</div>
								</form>
							{:else}
								<button class="btn btn-warning-outline btn-small" onclick={() => confirmDisableId = integration.id}>
									Disable
								</button>
							{/if}
						{:else if integration.status === 'online'}
							<form method="POST" action="?/enableIntegration" use:enhance={() => {
								return async ({ update }) => {
									await update({ invalidateAll: true });
								};
							}}>
								<input type="hidden" name="integrationId" value={integration.id} />
								<button type="submit" class="btn btn-primary">
									Enable Integration
								</button>
							</form>
						{:else}
							<div class="unavailable-notice">
								<span class="unavailable-text">
									{#if integration.status === 'offline'}
										🔴 This integration is currently offline and cannot be enabled.
									{:else}
										⏳ Waiting for this integration to connect...
									{/if}
								</span>
							</div>
						{/if}
					</div>

					{#if isEnabled && integration.enabled_at}
						<div class="card-footer">
							<span class="footer-text">
								Enabled {formatDateShort(integration.enabled_at, data.timezone)}
							</span>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.integrations-page {
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

	/* Grid */
	.integrations-grid {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* Card */
	.integration-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
		transition: border-color 0.15s;
	}

	.integration-card:hover {
		border-color: var(--color-primary);
	}

	.integration-card.integration-enabled {
		border-left: 3px solid #22c55e;
	}

	/* Card Header */
	.card-header {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.card-icon {
		font-size: 2rem;
		width: 3rem;
		height: 3rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(88, 101, 242, 0.1);
		border-radius: var(--radius-md);
		flex-shrink: 0;
	}

	.card-info {
		flex: 1;
		min-width: 0;
	}

	.card-title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.card-title {
		margin: 0;
		font-size: 1.1rem;
		color: var(--color-text);
	}

	.official-badge {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.15rem 0.5rem;
		background: rgba(88, 101, 242, 0.15);
		color: #5865F2;
		border-radius: 9999px;
	}

	.card-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.25rem;
		flex-wrap: wrap;
	}

	.category-badge {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
	}

	.meta-item {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.card-status {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.3rem;
	}

	.status-badge {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.2rem 0.6rem;
		border-radius: 9999px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.status-enabled {
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
	}

	.status-disabled {
		background: var(--color-surface-elevated);
		color: var(--color-text-muted);
	}

	.connection-badge {
		font-size: 0.65rem;
		font-weight: 500;
		padding: 0.15rem 0.5rem;
		border-radius: 9999px;
	}

	.connection-online {
		color: #22c55e;
	}

	.connection-offline {
		color: #ef4444;
	}

	.connection-unknown {
		color: var(--color-text-muted);
	}

	/* Card Body */
	.card-description {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin: 0 0 0.75rem 0;
		line-height: 1.5;
	}

	.card-features {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.feature-tag {
		font-size: 0.75rem;
		padding: 0.2rem 0.6rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
	}

	/* Expand Button */
	.expand-btn {
		display: block;
		width: 100%;
		text-align: center;
		padding: 0.5rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
		margin-bottom: 0.75rem;
	}

	.expand-btn:hover {
		background: var(--color-surface-elevated);
		color: var(--color-text);
	}

	/* Details */
	.card-details {
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1rem;
		margin-bottom: 0.75rem;
	}

	.detail-section {
		margin-bottom: 1rem;
	}

	.detail-section:last-child {
		margin-bottom: 0;
	}

	.detail-section h4 {
		margin: 0 0 0.5rem 0;
		font-size: 0.85rem;
		color: var(--color-text);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.commands-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.command-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.command-item code {
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.85rem;
		color: var(--color-primary);
	}

	.command-desc {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.subcommands {
		margin-left: 1rem;
		margin-top: 0.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding-left: 0.75rem;
		border-left: 2px solid var(--color-border);
	}

	.subcommand {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.subcommand code {
		font-size: 0.8rem;
	}

	.subcommand span {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.config-fields {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.config-field {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	.config-key {
		color: var(--color-text);
		font-weight: 500;
	}

	.config-type {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: var(--color-surface);
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-sm);
	}

	.config-required {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		color: #ef4444;
	}

	.homepage-link {
		font-size: 0.85rem;
		color: var(--color-primary);
		text-decoration: none;
		transition: color 0.15s;
	}

	.homepage-link:hover {
		color: var(--color-primary-hover);
	}

	/* Card Actions */
	.card-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.card-actions form {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.confirm-text {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.confirm-buttons {
		display: flex;
		gap: 0.5rem;
	}

	/* Card Footer */
	.card-footer {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
	}

	.footer-text {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* Offline Warning */
	.offline-warning {
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: 0.5rem;
		padding: 0.6rem 0.85rem;
		font-size: 0.8rem;
		color: #f87171;
		line-height: 1.5;
		margin-bottom: 0.75rem;
	}

	/* Unavailable Notice */
	.unavailable-notice {
		padding: 0.5rem 0;
	}

	.unavailable-text {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		font-style: italic;
	}

	/* Responsive */
	@media (max-width: 640px) {
		.integrations-page {
			padding: 1rem;
		}

		.card-header {
			flex-wrap: wrap;
		}

		.card-meta {
			gap: 0.5rem;
		}

		.card-actions {
			flex-direction: column;
			align-items: flex-start;
		}
	}

	/* GitHub Setup */
	.setup-instructions {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin: 0 0 0.5rem 0;
		line-height: 1.5;
	}

	.setup-instructions code {
		font-size: 0.8rem;
		padding: 0.1rem 0.3rem;
		background: var(--color-surface);
		border-radius: var(--radius-sm);
		color: var(--color-text);
	}

	.copyable-field {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.5rem 0.75rem;
		overflow-x: auto;
	}

	.copyable-value {
		flex: 1;
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.8rem;
		color: var(--color-text);
		word-break: break-all;
	}

	.copyable-value.secret {
		color: var(--color-text-muted);
		user-select: none;
		letter-spacing: -0.05em;
	}

	.btn-copy {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.3rem 0.6rem;
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.btn-copy:hover {
		opacity: 0.85;
	}

	.github-events-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}

	.github-event-tag {
		font-size: 0.75rem;
		padding: 0.2rem 0.6rem;
		background: rgba(36, 41, 46, 0.1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
	}
</style>
