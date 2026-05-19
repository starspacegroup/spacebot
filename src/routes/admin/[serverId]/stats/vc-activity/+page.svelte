<script>
	import { parseUTCDate, formatChartDate } from '$lib/timezone.js';
	import { onMount } from 'svelte';

	let { data } = $props();

	const LIVE_VOICE_POLL_MS = 15000;
	const liveUpdatesAuth = $derived(data.liveUpdatesAuth || null);
	const voiceActivityLog = $derived(Array.isArray(data.voiceActivityLog) ? data.voiceActivityLog : []);

	function normalizeLiveVoiceSnapshot(snapshot) {
		return {
			channels: Array.isArray(snapshot?.channels) ? snapshot.channels : [],
			totalUsers: Number(snapshot?.totalUsers || 0),
			totalChannels: Number(snapshot?.totalChannels || 0),
			activeCameras: Number(snapshot?.activeCameras || 0),
			activeStreams: Number(snapshot?.activeStreams || 0),
			updatedAt: snapshot?.updatedAt || null,
		};
	}

	const initialLiveVoiceSnapshot = $derived(normalizeLiveVoiceSnapshot(data.liveVoiceSnapshot));
	let liveVoiceSnapshot = $state(normalizeLiveVoiceSnapshot());
	let liveVoiceRefreshing = $state(false);
	let liveVoiceRefreshError = $state('');
	let liveVoiceStreamConnected = $state(false);

	$effect(() => {
		liveVoiceSnapshot = initialLiveVoiceSnapshot;
	});

	async function refreshLiveVoiceSnapshot({ silent = false } = {}) {
		if (liveVoiceStreamConnected && silent) return;
		if (liveVoiceRefreshing) return;

		liveVoiceRefreshing = true;
		if (!silent) liveVoiceRefreshError = '';

		try {
			const response = await fetch(`/api/admin/${data.serverId}/live-voice`, {
				headers: { accept: 'application/json' },
			});
			if (!response.ok) throw new Error(`Refresh failed with status ${response.status}`);
			liveVoiceSnapshot = normalizeLiveVoiceSnapshot(await response.json());
			liveVoiceRefreshError = '';
		} catch (error) {
			console.warn('[LiveVoice] Refresh failed', error);
			if (!silent) liveVoiceRefreshError = 'Unable to refresh live voice right now.';
		} finally {
			liveVoiceRefreshing = false;
		}
	}

	onMount(() => {
		let stream;

		if (liveUpdatesAuth?.signature && liveUpdatesAuth?.userId && liveUpdatesAuth?.expiresAt) {
			const streamUrl = new URL(`/api/admin/${data.serverId}/live-updates/stream`, window.location.origin);
			streamUrl.searchParams.set('user', liveUpdatesAuth.userId);
			streamUrl.searchParams.set('exp', String(liveUpdatesAuth.expiresAt));
			streamUrl.searchParams.set('sig', liveUpdatesAuth.signature);

			stream = new EventSource(streamUrl);
			stream.addEventListener('open', () => {
				liveVoiceStreamConnected = true;
				liveVoiceRefreshError = '';
			});
			stream.addEventListener('voice_snapshot', (event) => {
				try {
					const payload = JSON.parse(event.data);
					liveVoiceSnapshot = normalizeLiveVoiceSnapshot(payload?.data || payload);
					liveVoiceStreamConnected = true;
					liveVoiceRefreshError = '';
				} catch (error) {
					console.warn('[LiveVoice] Invalid event payload', error);
				}
			});
			stream.addEventListener('error', () => {
				liveVoiceStreamConnected = false;
				if (!liveVoiceSnapshot.updatedAt) {
					liveVoiceRefreshError = 'Live stream unavailable, using refresh fallback.';
				}
			});
		}

		refreshLiveVoiceSnapshot({ silent: true });

		const intervalId = setInterval(() => {
			refreshLiveVoiceSnapshot({ silent: true });
		}, LIVE_VOICE_POLL_MS);

		return () => {
			clearInterval(intervalId);
			stream?.close();
		};
	});

	function formatNumber(num) {
		if (!num) return '0';
		return num.toLocaleString();
	}

	function getAvatarInitial(name) {
		if (!name) return '?';
		return name.trim().charAt(0).toUpperCase();
	}

	function formatRelativeTime(dateStr) {
		if (!dateStr) return 'Never';
		const date = parseUTCDate(dateStr);
		if (!date) return dateStr;
		const now = new Date();
		const diffMs = now - date;
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);
		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return formatChartDate(dateStr);
	}

	function getLiveVoiceBadges(member) {
		return [
			{ key: 'cam', label: 'Cam', active: !!member.selfVideo, tone: 'video' },
			{ key: 'stream', label: 'Share', active: !!member.streaming, tone: 'stream' },
			{ key: 'self-mute', label: 'Self Mute', active: !!member.selfMute, tone: 'self-mute' },
			{ key: 'self-deaf', label: 'Self Deaf', active: !!member.selfDeaf, tone: 'self-deaf' },
			{ key: 'server-mute', label: 'Server Mute', active: !!member.serverMute, tone: 'server-mute' },
			{ key: 'server-deaf', label: 'Server Deaf', active: !!member.serverDeaf, tone: 'server-deaf' },
			{ key: 'stage', label: 'Suppressed', active: !!member.suppress, tone: 'stage' },
		];
	}
</script>

<svelte:head>
	<title>VC activity - {data.guild?.name || 'Server'} | SpaceBot</title>
</svelte:head>

<div class="live-voice-page">
	<header class="page-header">
		<div class="header-content">
			<a href="/admin/{data.serverId}/stats" class="back-link">
				<span>←</span>
				Back to Statistics
			</a>
			<div class="title-row">
				<div class="title-section">
					<h1>🔴 VC activity</h1>
					<p class="subtitle">Real-time voice activity for {data.guild?.name || 'your server'}</p>
				</div>
				<div class="header-actions">
					<div class="live-voice-actions">
						{#if liveVoiceRefreshError}
							<span class="live-voice-refresh-error">{liveVoiceRefreshError}</span>
						{/if}
						<button
							type="button"
							class="live-voice-refresh"
							class:live-voice-refresh--connected={liveVoiceStreamConnected}
							onclick={() => refreshLiveVoiceSnapshot()}
							disabled={liveVoiceRefreshing || liveVoiceStreamConnected}
							title={liveVoiceStreamConnected ? 'Live updates active via WebSocket' : 'Click to manually refresh'}
						>
							{#if liveVoiceStreamConnected}
								<span class="live-voice-refresh-dot"></span> Live
							{:else if liveVoiceRefreshing}
								Refreshing...
							{:else}
								Refresh
							{/if}
						</button>
					</div>
				</div>
			</div>
		</div>
	</header>

	<div class="page-body">
		<div class="updated-label">
			{liveVoiceSnapshot.updatedAt ? `Updated ${formatRelativeTime(liveVoiceSnapshot.updatedAt)}` : 'Waiting for voice snapshot'}
		</div>

		<div class="live-voice-summary-grid">
			<div class="live-voice-summary-card">
				<span class="live-voice-summary-value">{formatNumber(liveVoiceSnapshot.totalChannels)}</span>
				<span class="live-voice-summary-label">Active Channels</span>
			</div>
			<div class="live-voice-summary-card">
				<span class="live-voice-summary-value">{formatNumber(liveVoiceSnapshot.totalUsers)}</span>
				<span class="live-voice-summary-label">People In Voice</span>
			</div>
			<div class="live-voice-summary-card">
				<span class="live-voice-summary-value">{formatNumber(liveVoiceSnapshot.activeCameras)}</span>
				<span class="live-voice-summary-label">Cameras On</span>
			</div>
			<div class="live-voice-summary-card">
				<span class="live-voice-summary-value">{formatNumber(liveVoiceSnapshot.activeStreams)}</span>
				<span class="live-voice-summary-label">Screensharing</span>
			</div>
		</div>

		{#if liveVoiceSnapshot.channels.length > 0}
			<div class="live-voice-grid">
				{#each liveVoiceSnapshot.channels as channel}
					<div class="live-voice-channel-card">
						<div class="live-voice-channel-header">
							<div>
								<h3 class="live-voice-channel-name">{channel.channelName}</h3>
								<p class="live-voice-channel-meta">{channel.memberCount} {channel.memberCount === 1 ? 'member' : 'members'}</p>
							</div>
							<span class="live-voice-channel-count">{channel.memberCount}</span>
						</div>

						<div class="live-voice-member-list">
							{#each channel.members as member}
								<div class="live-voice-member-row">
									<div class="live-voice-member-avatar-wrap">
										{#if member.avatarUrl}
											<img class="live-voice-member-avatar" src={member.avatarUrl} alt={member.displayName} />
										{:else}
											<div class="live-voice-member-avatar live-voice-member-avatar-fallback">{getAvatarInitial(member.displayName || member.userName)}</div>
										{/if}
									</div>

									<div class="live-voice-member-main">
										<div class="live-voice-member-heading">
											<span class="live-voice-member-name">{member.displayName}</span>
											{#if member.userName && member.userName !== member.displayName}
												<span class="live-voice-member-handle">@{member.userName}</span>
											{/if}
										</div>

										<div class="live-voice-badge-row">
											{#each getLiveVoiceBadges(member) as badge}
												<span class={`live-voice-badge ${badge.active ? 'active' : 'inactive'} ${badge.tone}`} title={`${badge.label}: ${badge.active ? 'on' : 'off'}`}>
													{badge.label}
												</span>
											{/each}
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="live-voice-empty">
				<span class="live-voice-empty-icon">🎧</span>
				<span class="live-voice-empty-text">Nobody is in voice right now.</span>
			</div>
		{/if}

		<section class="voice-log-section">
			<div class="voice-log-header">
				<h2>VC Channel Activity Log</h2>
				<span class="voice-log-count">{voiceActivityLog.length} recent events</span>
			</div>

			{#if voiceActivityLog.length > 0}
				<div class="voice-log-list">
					{#each voiceActivityLog as entry}
						<div class="voice-log-row">
							<div class="voice-log-main">
								<span class="voice-log-actor">{entry.actorName}</span>
								<span class="voice-log-action">{entry.actionLabel}</span>
								<span class="voice-log-channel">in {entry.channelName}</span>
							</div>
							<span class="voice-log-time" title={entry.createdAt || ''}>
								{entry.createdAt ? formatRelativeTime(entry.createdAt) : 'Unknown time'}
							</span>
						</div>
					{/each}
				</div>
			{:else}
				<div class="voice-log-empty">No recent VC channel activity yet.</div>
			{/if}
		</section>
	</div>
</div>

<style>
	.live-voice-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 1rem 2rem;
	}

	.page-header {
		padding: 1.5rem 0 1rem;
		margin-bottom: 1.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.header-content {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.9rem;
		transition: color var(--transition-fast);
	}

	.back-link:hover {
		color: var(--color-text);
	}

	.title-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.title-section h1 {
		margin: 0;
		font-size: 1.6rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.subtitle {
		margin: 0.25rem 0 0;
		color: var(--color-text-muted);
		font-size: 0.95rem;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.page-body {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.updated-label {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.live-voice-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.live-voice-refresh-error {
		font-size: 0.8rem;
		color: #ff8b8b;
	}

	.live-voice-refresh {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 6.5rem;
		padding: 0.55rem 0.85rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.live-voice-refresh:hover:not(:disabled) {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.live-voice-refresh:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.live-voice-refresh--connected {
		border-color: #57F287;
		color: #57F287;
		cursor: default;
	}

	.live-voice-refresh-dot {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #57F287;
		box-shadow: 0 0 6px #57F287;
		animation: live-pulse 1.5s ease-in-out infinite;
		margin-right: 0.1rem;
	}

	@keyframes live-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.live-voice-summary-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}

	@media (min-width: 768px) {
		.live-voice-summary-grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}

		.live-voice-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.live-voice-summary-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.live-voice-summary-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.live-voice-summary-label {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.live-voice-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	.live-voice-channel-card {
		background: linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 88%, var(--color-primary-soft) 12%) 0%, var(--color-surface) 100%);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
	}

	.live-voice-channel-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.85rem;
	}

	.live-voice-channel-name {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.live-voice-channel-meta {
		margin: 0.2rem 0 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.live-voice-channel-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2rem;
		height: 2rem;
		padding: 0 0.65rem;
		border-radius: 999px;
		background: var(--color-primary-soft);
		color: var(--color-text);
		font-weight: 700;
	}

	.live-voice-member-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.live-voice-member-row {
		display: flex;
		align-items: flex-start;
		gap: 0.85rem;
		padding: 0.85rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-surface-elevated) 88%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
	}

	.live-voice-member-avatar-wrap {
		flex: 0 0 auto;
	}

	.live-voice-member-avatar {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
		object-fit: cover;
		background: var(--color-surface-elevated);
	}

	.live-voice-member-avatar-fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		color: var(--color-text);
		background: linear-gradient(135deg, var(--color-primary-soft), color-mix(in srgb, var(--color-primary) 20%, var(--color-surface)));
	}

	.live-voice-member-main {
		min-width: 0;
		flex: 1 1 auto;
	}

	.live-voice-member-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.45rem;
		margin-bottom: 0.45rem;
	}

	.live-voice-member-name {
		font-weight: 700;
		color: var(--color-text);
	}

	.live-voice-member-handle {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.live-voice-badge-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.live-voice-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.22rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	.live-voice-badge.inactive {
		opacity: 0.5;
		background: transparent;
		color: var(--color-text-muted);
	}

	.live-voice-badge.active.video {
		border-color: rgba(88, 101, 242, 0.4);
		background: rgba(88, 101, 242, 0.16);
		color: #8090ff;
	}

	.live-voice-badge.active.stream {
		border-color: rgba(34, 197, 94, 0.4);
		background: rgba(34, 197, 94, 0.16);
		color: #66d48b;
	}

	.live-voice-badge.active.self-mute,
	.live-voice-badge.active.server-mute {
		border-color: rgba(239, 68, 68, 0.4);
		background: rgba(239, 68, 68, 0.14);
		color: #ff8b8b;
	}

	.live-voice-badge.active.self-deaf,
	.live-voice-badge.active.server-deaf,
	.live-voice-badge.active.stage {
		border-color: rgba(245, 158, 11, 0.4);
		background: rgba(245, 158, 11, 0.14);
		color: #f7c96a;
	}

	.live-voice-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 2rem 1rem;
		background: var(--color-surface);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
		color: var(--color-text-muted);
	}

	.live-voice-empty-icon {
		font-size: 1.75rem;
	}

	.live-voice-empty-text {
		font-size: 0.95rem;
	}

	.voice-log-section {
		margin-top: 1rem;
		padding: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.voice-log-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.85rem;
		flex-wrap: wrap;
	}

	.voice-log-header h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.voice-log-count {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.voice-log-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.voice-log-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.75rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-surface-elevated) 84%, transparent);
		flex-wrap: wrap;
	}

	.voice-log-main {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.voice-log-actor {
		font-weight: 700;
		color: var(--color-text);
	}

	.voice-log-action {
		color: var(--color-text);
	}

	.voice-log-channel {
		color: var(--color-text-muted);
	}

	.voice-log-time {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.voice-log-empty {
		padding: 0.8rem;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}
</style>
