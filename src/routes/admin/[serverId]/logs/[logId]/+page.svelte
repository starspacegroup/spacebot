<script lang="ts">
	import { formatDateFull, formatRelativeTime as tzFormatRelative } from '$lib/timezone.js';
	import { getAvatarUrl } from '$lib/utils/avatar.js';
	import { getTranslator } from '$lib/i18n.js';

	const tr = getTranslator();
	const { data } = $props();
	
	function formatDate(dateString) {
		return formatDateFull(dateString, data.timezone);
	}

	function formatRelativeTime(dateString) {
		return tzFormatRelative(dateString, data.timezone);
	}
	
	function copyToClipboard(text) {
		navigator.clipboard.writeText(text);
	}
</script>

<svelte:head>
	<title>{tr('logDetail.metaTitle', { desc: data.eventTypeInfo.description })}</title>
</svelte:head>

<div class="event-detail-container">
	<header class="event-header">
		<div class="header-left">
			<a href="/admin/{data.serverId}/logs" class="back-link">{tr('logDetail.backToLogs')}</a>
			<div class="guild-info">
				{#if data.guild?.icon}
					<img 
						src="https://cdn.discordapp.com/icons/{data.serverId}/{data.guild.icon}.png" 
						alt="{data.guild?.name} icon"
						class="guild-icon"
					/>
				{:else}
					<div class="guild-icon-placeholder">
						{data.guild?.name?.charAt(0).toUpperCase() || '?'}
					</div>
				{/if}
				<div class="guild-text">
					<h1>{tr('logDetail.title')}</h1>
					<span class="guild-name">{data.guild?.name || tr('adash.unknownServer')}</span>
				</div>
			</div>
		</div>
	</header>
	
	<div class="event-content">
		<!-- Event Summary Card -->
		<div class="summary-card" style="--event-color: {data.categoryInfo.color}">
			<div class="summary-header">
				<span class="event-icon">{data.eventTypeInfo.icon}</span>
				<div class="event-info">
					<span class="event-type">{data.eventTypeInfo.description}</span>
					<span class="event-category">{data.categoryInfo.name}</span>
				</div>
			</div>
			<div class="summary-meta">
				<span class="event-time" title={formatDate(data.log.created_at)}>
					🕐 {formatRelativeTime(data.log.created_at)}
				</span>
				<span class="event-id">
					ID: {data.log.id}
					<button class="copy-btn" onclick={() => copyToClipboard(data.log.id.toString())} title={tr('logDetail.copyId')}>
						📋
					</button>
				</span>
			</div>
			<p class="event-description">{data.eventTypeInfo.description}</p>
		</div>
		
		<!-- Main Details Grid -->
		<div class="details-grid">
			<!-- Actor Section -->
			<div class="detail-card">
				<h3>👤 {tr('logDetail.actor')}</h3>
				{#if data.log.actor_name || data.log.actor_id}
					<div class="detail-content">
						{#if data.log.actor_id && data.log.actor_name}
							<div class="actor-avatar-section">
								<img 
									src={getAvatarUrl(data.log.actor_id, data.log.actor_avatar, data.log.actor_discriminator, 64)}
									alt="{data.log.actor_name}'s avatar"
									class="detail-avatar"
									onerror={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
								/>
								<div class="actor-text">
									<span class="actor-name">{data.log.actor_name}</span>
									<span class="actor-id mono">{data.log.actor_id}</span>
								</div>
							</div>
						{:else if data.log.actor_name}
							<div class="detail-row">
								<span class="label">{tr('logDetail.username')}</span>
								<span class="value">{data.log.actor_name}</span>
							</div>
						{/if}
						{#if data.log.actor_id && !data.log.actor_name}
							<div class="detail-row">
								<span class="label">{tr('logDetail.userId')}</span>
								<span class="value mono">
									{data.log.actor_id}
									<button class="copy-btn" onclick={() => copyToClipboard(data.log.actor_id)} title={tr('logDetail.copyId')}>
										📋
									</button>
								</span>
							</div>
						{/if}
					</div>
				{:else}
					<p class="no-data">{tr('logDetail.noActor')}</p>
				{/if}
			</div>

			<!-- Target Section -->
			<div class="detail-card">
				<h3>🎯 {tr('logDetail.target')}</h3>
				{#if data.log.target_name || data.log.target_id}
					<div class="detail-content">
						{#if data.log.target_name}
							<div class="detail-row">
								<span class="label">{tr('logDetail.name')}</span>
								<span class="value">{data.log.target_name}</span>
							</div>
						{/if}
						{#if data.log.target_id}
							<div class="detail-row">
								<span class="label">{tr('logDetail.id')}</span>
								<span class="value mono">
									{data.log.target_id}
									<button class="copy-btn" onclick={() => copyToClipboard(data.log.target_id)} title={tr('logDetail.copyId')}>
										📋
									</button>
								</span>
							</div>
						{/if}
					</div>
				{:else}
					<p class="no-data">{tr('logDetail.noTarget')}</p>
				{/if}
			</div>

			<!-- Channel Section -->
			<div class="detail-card">
				<h3>📁 {tr('logDetail.channel')}</h3>
				{#if data.log.channel_name || data.log.channel_id}
					<div class="detail-content">
						{#if data.log.channel_name}
							<div class="detail-row">
								<span class="label">{tr('logDetail.name')}</span>
								<span class="value channel-name">#{data.log.channel_name}</span>
							</div>
						{/if}
						{#if data.log.channel_id}
							<div class="detail-row">
								<span class="label">{tr('logDetail.channelId')}</span>
								<span class="value mono">
									{data.log.channel_id}
									<button class="copy-btn" onclick={() => copyToClipboard(data.log.channel_id)} title={tr('logDetail.copyId')}>
										📋
									</button>
								</span>
							</div>
						{/if}
					</div>
				{:else}
					<p class="no-data">{tr('logDetail.noChannel')}</p>
				{/if}
			</div>

			<!-- Timestamp Section -->
			<div class="detail-card">
				<h3>🕐 {tr('logDetail.timestamp')}</h3>
				<div class="detail-content">
					<div class="detail-row">
						<span class="label">{tr('logDetail.dateTime')}</span>
						<span class="value">{formatDate(data.log.created_at)}</span>
					</div>
					<div class="detail-row">
						<span class="label">{tr('logDetail.relative')}</span>
						<span class="value">{formatRelativeTime(data.log.created_at)}</span>
					</div>
					<div class="detail-row">
						<span class="label">{tr('logDetail.iso')}</span>
						<span class="value mono">
							{data.log.created_at}
							<button class="copy-btn" onclick={() => copyToClipboard(data.log.created_at)} title={tr('logDetail.copyTimestamp')}>
								📋
							</button>
						</span>
					</div>
				</div>
			</div>
		</div>
		
		<!-- Additional Details Section -->
		{#if data.log.details}
			<div class="extra-details-card">
				<h3>📝 {tr('logDetail.additionalDetails')}</h3>
				<div class="json-viewer">
					<pre>{JSON.stringify(data.log.details, null, 2)}</pre>
				</div>
				<button class="copy-json-btn" onclick={() => copyToClipboard(JSON.stringify(data.log.details, null, 2))}>
					📋 {tr('logDetail.copyJson')}
				</button>
			</div>
		{/if}

		<!-- Raw Event Data (Collapsible) -->
		<details class="raw-data-section">
			<summary>🔧 {tr('logDetail.rawData')}</summary>
			<div class="json-viewer">
				<pre>{JSON.stringify(data.log, null, 2)}</pre>
			</div>
			<button class="copy-json-btn" onclick={() => copyToClipboard(JSON.stringify(data.log, null, 2))}>
				📋 {tr('logDetail.copyRawJson')}
			</button>
		</details>
	</div>
</div>

<style>
	.event-detail-container {
		width: 100%;
		margin: 0 auto;
		padding: 1rem;
	}
	
	@media (min-width: 640px) {
		.event-detail-container {
			padding: 1.5rem;
		}
	}
	
	@media (min-width: 1024px) {
		.event-detail-container {
			padding: 2rem 3rem;
		}
	}
	
	@media (min-width: 1536px) {
		.event-detail-container {
			padding: 2rem 4rem;
		}
	}
	
	.event-header {
		margin-bottom: 2rem;
	}
	
	.header-left {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.back-link {
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.875rem;
	}
	
	.back-link:hover {
		color: var(--color-text);
	}
	
	.guild-info {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	
	.guild-icon, .guild-icon-placeholder {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		object-fit: cover;
	}
	
	.guild-icon-placeholder {
		background: var(--color-surface-elevated);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.25rem;
		font-weight: bold;
		color: var(--color-text);
	}
	
	.guild-text h1 {
		margin: 0;
		font-size: 1.5rem;
	}
	
	.guild-name {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}
	
	/* Summary Card */
	.summary-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-left: 4px solid var(--event-color, var(--color-primary));
		border-radius: 8px;
		padding: 1.5rem;
		margin-bottom: 2rem;
	}
	
	.summary-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	
	.event-icon {
		font-size: 2.5rem;
	}
	
	.event-info {
		display: flex;
		flex-direction: column;
	}
	
	.event-type {
		font-size: 1.5rem;
		font-weight: bold;
		color: var(--color-text);
	}
	
	.event-category {
		color: var(--event-color, var(--color-primary));
		font-size: 0.875rem;
		font-weight: 500;
		text-transform: uppercase;
	}
	
	.summary-meta {
		display: flex;
		gap: 2rem;
		margin-bottom: 0.5rem;
		flex-wrap: wrap;
	}
	
	.event-time, .event-id {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	
	.event-description {
		color: var(--color-text-secondary);
		margin: 0.5rem 0 0;
		font-size: 0.95rem;
	}
	
	/* Details Grid */
	.details-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}
	
	.detail-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 1.25rem;
	}
	
	.detail-card h3 {
		margin: 0 0 1rem;
		font-size: 1rem;
		color: var(--color-text);
	}
	
	.detail-content {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.actor-avatar-section {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.detail-avatar {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	.actor-text {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.actor-name {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.actor-id {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	
	.detail-row {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	
	.detail-row .label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}
	
	.detail-row .value {
		font-size: 0.9rem;
		color: var(--color-text);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		word-break: break-all;
	}
	
	.detail-row .value.mono {
		font-family: monospace;
		font-size: 0.8rem;
	}
	
	.channel-name {
		color: var(--color-primary);
	}
	
	.no-data {
		color: var(--color-text-muted);
		font-style: italic;
		margin: 0;
		font-size: 0.875rem;
	}
	
	.copy-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.15rem 0.25rem;
		font-size: 0.75rem;
		opacity: 0.6;
		transition: opacity 0.2s;
	}
	
	.copy-btn:hover {
		opacity: 1;
	}
	
	/* Extra Details Card */
	.extra-details-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 1.25rem;
		margin-bottom: 1rem;
	}
	
	.extra-details-card h3 {
		margin: 0 0 1rem;
		font-size: 1rem;
		color: var(--color-text);
	}
	
	.json-viewer {
		background: var(--color-code-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 1rem;
		overflow-x: auto;
		margin-bottom: 0.75rem;
	}
	
	.json-viewer pre {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-text);
		white-space: pre-wrap;
		word-break: break-word;
	}
	
	.copy-json-btn {
		padding: 0.5rem 1rem;
		font-size: 0.8rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		border-radius: 4px;
		cursor: pointer;
	}
	
	.copy-json-btn:hover {
		background: var(--color-surface-hover);
	}
	
	/* Raw Data Section */
	.raw-data-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 1rem 1.25rem;
	}
	
	.raw-data-section summary {
		cursor: pointer;
		font-weight: 500;
		color: var(--color-text-secondary);
		user-select: none;
	}
	
	.raw-data-section summary:hover {
		color: var(--color-text);
	}
	
	.raw-data-section[open] summary {
		margin-bottom: 1rem;
	}
	
	/* Responsive */
	@media (max-width: 768px) {
		.event-detail-container {
			padding: 1rem;
		}
		
		.details-grid {
			grid-template-columns: 1fr;
		}
		
		.summary-meta {
			flex-direction: column;
			gap: 0.5rem;
		}
	}
</style>
