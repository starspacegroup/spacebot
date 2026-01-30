<script>
	let { data } = $props();
	
	function formatDate(dateString) {
		const date = new Date(dateString);
		return new Intl.DateTimeFormat('en-US', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			timeZoneName: 'short'
		}).format(date);
	}
	
	function formatRelativeTime(dateString) {
		const date = new Date(dateString);
		const now = new Date();
		const diffMs = now - date;
		const diffSec = Math.floor(diffMs / 1000);
		const diffMin = Math.floor(diffSec / 60);
		const diffHour = Math.floor(diffMin / 60);
		const diffDay = Math.floor(diffHour / 24);
		
		if (diffSec < 60) return `${diffSec} seconds ago`;
		if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
		if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
		if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
		return formatDate(dateString);
	}
	
	function copyToClipboard(text) {
		navigator.clipboard.writeText(text);
	}
</script>

<svelte:head>
	<title>Event Details - {data.log.event_type} | SpaceBot Admin</title>
</svelte:head>

<div class="event-detail-container">
	<header class="event-header">
		<div class="header-left">
			<a href="/admin/{data.serverId}/logs" class="back-link">← Back to Logs</a>
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
					<h1>Event Details</h1>
					<span class="guild-name">{data.guild?.name || 'Unknown Server'}</span>
				</div>
			</div>
		</div>
	</header>
	
	<div class="event-content">
		<!-- Event Summary Card -->
		<div class="summary-card" style="--event-color: {data.categoryInfo.color}">
			<div class="summary-header">
				<span class="event-icon">{data.categoryInfo.icon}</span>
				<div class="event-info">
					<span class="event-type">{data.log.event_type.replace(/_/g, ' ')}</span>
					<span class="event-category">{data.categoryInfo.name}</span>
				</div>
			</div>
			<div class="summary-meta">
				<span class="event-time" title={formatDate(data.log.created_at)}>
					🕐 {formatRelativeTime(data.log.created_at)}
				</span>
				<span class="event-id">
					ID: {data.log.id}
					<button class="copy-btn" onclick={() => copyToClipboard(data.log.id.toString())} title="Copy ID">
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
				<h3>👤 Actor</h3>
				{#if data.log.actor_name || data.log.actor_id}
					<div class="detail-content">
						{#if data.log.actor_name}
							<div class="detail-row">
								<span class="label">Username</span>
								<span class="value">{data.log.actor_name}</span>
							</div>
						{/if}
						{#if data.log.actor_id}
							<div class="detail-row">
								<span class="label">User ID</span>
								<span class="value mono">
									{data.log.actor_id}
									<button class="copy-btn" onclick={() => copyToClipboard(data.log.actor_id)} title="Copy ID">
										📋
									</button>
								</span>
							</div>
						{/if}
					</div>
				{:else}
					<p class="no-data">No actor information available</p>
				{/if}
			</div>
			
			<!-- Target Section -->
			<div class="detail-card">
				<h3>🎯 Target</h3>
				{#if data.log.target_name || data.log.target_id}
					<div class="detail-content">
						{#if data.log.target_name}
							<div class="detail-row">
								<span class="label">Name</span>
								<span class="value">{data.log.target_name}</span>
							</div>
						{/if}
						{#if data.log.target_id}
							<div class="detail-row">
								<span class="label">ID</span>
								<span class="value mono">
									{data.log.target_id}
									<button class="copy-btn" onclick={() => copyToClipboard(data.log.target_id)} title="Copy ID">
										📋
									</button>
								</span>
							</div>
						{/if}
					</div>
				{:else}
					<p class="no-data">No target information available</p>
				{/if}
			</div>
			
			<!-- Channel Section -->
			<div class="detail-card">
				<h3>📁 Channel</h3>
				{#if data.log.channel_name || data.log.channel_id}
					<div class="detail-content">
						{#if data.log.channel_name}
							<div class="detail-row">
								<span class="label">Name</span>
								<span class="value channel-name">#{data.log.channel_name}</span>
							</div>
						{/if}
						{#if data.log.channel_id}
							<div class="detail-row">
								<span class="label">Channel ID</span>
								<span class="value mono">
									{data.log.channel_id}
									<button class="copy-btn" onclick={() => copyToClipboard(data.log.channel_id)} title="Copy ID">
										📋
									</button>
								</span>
							</div>
						{/if}
					</div>
				{:else}
					<p class="no-data">No channel information available</p>
				{/if}
			</div>
			
			<!-- Timestamp Section -->
			<div class="detail-card">
				<h3>🕐 Timestamp</h3>
				<div class="detail-content">
					<div class="detail-row">
						<span class="label">Date & Time</span>
						<span class="value">{formatDate(data.log.created_at)}</span>
					</div>
					<div class="detail-row">
						<span class="label">Relative</span>
						<span class="value">{formatRelativeTime(data.log.created_at)}</span>
					</div>
					<div class="detail-row">
						<span class="label">ISO</span>
						<span class="value mono">
							{data.log.created_at}
							<button class="copy-btn" onclick={() => copyToClipboard(data.log.created_at)} title="Copy timestamp">
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
				<h3>📝 Additional Details</h3>
				<div class="json-viewer">
					<pre>{JSON.stringify(data.log.details, null, 2)}</pre>
				</div>
				<button class="copy-json-btn" onclick={() => copyToClipboard(JSON.stringify(data.log.details, null, 2))}>
					📋 Copy JSON
				</button>
			</div>
		{/if}
		
		<!-- Raw Event Data (Collapsible) -->
		<details class="raw-data-section">
			<summary>🔧 Raw Event Data</summary>
			<div class="json-viewer">
				<pre>{JSON.stringify(data.log, null, 2)}</pre>
			</div>
			<button class="copy-json-btn" onclick={() => copyToClipboard(JSON.stringify(data.log, null, 2))}>
				📋 Copy Raw JSON
			</button>
		</details>
	</div>
</div>

<style>
	.event-detail-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
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
		color: var(--text-secondary, #888);
		text-decoration: none;
		font-size: 0.875rem;
	}
	
	.back-link:hover {
		color: var(--text-primary, #fff);
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
		background: var(--bg-secondary, #333);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.25rem;
		font-weight: bold;
		color: var(--text-primary, #fff);
	}
	
	.guild-text h1 {
		margin: 0;
		font-size: 1.5rem;
	}
	
	.guild-name {
		color: var(--text-secondary, #888);
		font-size: 0.875rem;
	}
	
	/* Summary Card */
	.summary-card {
		background: var(--bg-secondary, #222);
		border: 1px solid var(--border-color, #333);
		border-left: 4px solid var(--event-color, #5865F2);
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
		color: var(--text-primary, #fff);
	}
	
	.event-category {
		color: var(--event-color, #5865F2);
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
		color: var(--text-secondary, #888);
		font-size: 0.875rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	
	.event-description {
		color: var(--text-secondary, #aaa);
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
		background: var(--bg-secondary, #222);
		border: 1px solid var(--border-color, #333);
		border-radius: 8px;
		padding: 1.25rem;
	}
	
	.detail-card h3 {
		margin: 0 0 1rem;
		font-size: 1rem;
		color: var(--text-primary, #fff);
	}
	
	.detail-content {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	
	.detail-row {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	
	.detail-row .label {
		font-size: 0.75rem;
		color: var(--text-secondary, #888);
		text-transform: uppercase;
	}
	
	.detail-row .value {
		font-size: 0.9rem;
		color: var(--text-primary, #fff);
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
		color: var(--accent-color, #5865F2);
	}
	
	.no-data {
		color: var(--text-secondary, #666);
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
		background: var(--bg-secondary, #222);
		border: 1px solid var(--border-color, #333);
		border-radius: 8px;
		padding: 1.25rem;
		margin-bottom: 1rem;
	}
	
	.extra-details-card h3 {
		margin: 0 0 1rem;
		font-size: 1rem;
		color: var(--text-primary, #fff);
	}
	
	.json-viewer {
		background: var(--bg-primary, #111);
		border: 1px solid var(--border-color, #444);
		border-radius: 6px;
		padding: 1rem;
		overflow-x: auto;
		margin-bottom: 0.75rem;
	}
	
	.json-viewer pre {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-primary, #ddd);
		white-space: pre-wrap;
		word-break: break-word;
	}
	
	.copy-json-btn {
		padding: 0.5rem 1rem;
		font-size: 0.8rem;
		background: var(--bg-tertiary, #333);
		border: 1px solid var(--border-color, #444);
		color: var(--text-primary, #fff);
		border-radius: 4px;
		cursor: pointer;
	}
	
	.copy-json-btn:hover {
		background: var(--bg-hover, #444);
	}
	
	/* Raw Data Section */
	.raw-data-section {
		background: var(--bg-secondary, #222);
		border: 1px solid var(--border-color, #333);
		border-radius: 8px;
		padding: 1rem 1.25rem;
	}
	
	.raw-data-section summary {
		cursor: pointer;
		font-weight: 500;
		color: var(--text-secondary, #aaa);
		user-select: none;
	}
	
	.raw-data-section summary:hover {
		color: var(--text-primary, #fff);
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
