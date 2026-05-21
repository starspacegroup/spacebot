<script>
	import { parseUTCDate, formatChartDate } from '$lib/timezone.js';
	import { getAvatarUrl } from '$lib/utils/avatar.js';
	import { onMount } from 'svelte';

	let { data } = $props();

	const LIVE_VOICE_POLL_MS = 15000;
	const VOICE_LOG_FILTER_DEBOUNCE_MS = 220;
	const liveUpdatesAuth = $derived(data.liveUpdatesAuth || null);
	const voiceActivityLog = $derived(Array.isArray(data.voiceActivityLog) ? data.voiceActivityLog : []);
	const voiceEventTypeOptions = $derived(Array.isArray(data.voiceEventTypeOptions) ? data.voiceEventTypeOptions : []);

	function normalizeVoiceLogPagination(pagination) {
		const pageSize = Number(pagination?.pageSize || 30);
		const total = Number(pagination?.total || 0);
		const totalPages = Math.max(1, Number(pagination?.totalPages || Math.ceil(total / pageSize) || 1));
		const page = Math.min(Math.max(Number(pagination?.page || 1), 1), totalPages);

		return {
			page,
			pageSize,
			total,
			totalPages,
			hasPreviousPage: page > 1,
			hasNextPage: page < totalPages,
		};
	}

	function getInitialVoiceLogFilters(source) {
		return {
			search: String(source?.search || ''),
			eventType: String(source?.eventType || ''),
			sortOrder: source?.sortOrder === 'asc' ? 'asc' : 'desc',
			startDate: String(source?.startDate || ''),
			endDate: String(source?.endDate || ''),
		};
	}

	const initialVoiceLogFilters = $derived(getInitialVoiceLogFilters(data.voiceActivityFilters));
	const initialVoiceLogPagination = $derived(normalizeVoiceLogPagination(data.voiceActivityPagination));

	let voiceLogEntries = $state(voiceActivityLog);
	let voiceLogPagination = $state(initialVoiceLogPagination);
	let voiceLogPageSize = $state(initialVoiceLogPagination.pageSize);
	let voiceLogSearch = $state(initialVoiceLogFilters.search);
	let voiceLogEventType = $state(initialVoiceLogFilters.eventType);
	let voiceLogSortOrder = $state(initialVoiceLogFilters.sortOrder);
	let voiceLogStartDate = $state(initialVoiceLogFilters.startDate);
	let voiceLogEndDate = $state(initialVoiceLogFilters.endDate);
	let voiceLogLoading = $state(false);
	let voiceLogError = $state('');

	let voiceLogDebounceTimer;
	let voiceLogAbortController;

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

	$effect(() => {
		voiceLogEntries = voiceActivityLog;
		voiceLogPagination = initialVoiceLogPagination;
		voiceLogPageSize = initialVoiceLogPagination.pageSize;
		voiceLogSearch = initialVoiceLogFilters.search;
		voiceLogEventType = initialVoiceLogFilters.eventType;
		voiceLogSortOrder = initialVoiceLogFilters.sortOrder;
		voiceLogStartDate = initialVoiceLogFilters.startDate;
		voiceLogEndDate = initialVoiceLogFilters.endDate;
		voiceLogError = '';
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
			if (voiceLogDebounceTimer) {
				clearTimeout(voiceLogDebounceTimer);
			}
			voiceLogAbortController?.abort();
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

	function buildVoiceLogQueryParams({ page = voiceLogPagination.page, pageSize = voiceLogPageSize } = {}) {
		const params = new URLSearchParams();
		params.set('page', String(Math.max(1, page)));
		params.set('pageSize', String(Math.max(1, Number(pageSize) || 30)));
		params.set('sort', voiceLogSortOrder === 'asc' ? 'asc' : 'desc');

		if (voiceLogSearch.trim()) params.set('search', voiceLogSearch.trim());
		if (voiceLogEventType) params.set('eventType', voiceLogEventType);
		if (voiceLogStartDate) params.set('startDate', voiceLogStartDate);
		if (voiceLogEndDate) params.set('endDate', voiceLogEndDate);

		return params;
	}

	function syncVoiceLogQueryToUrl() {
		if (typeof window === 'undefined') return;
		const next = new URL(window.location.href);
		const params = buildVoiceLogQueryParams();

		next.searchParams.delete('page');
		next.searchParams.delete('pageSize');
		next.searchParams.delete('sort');
		next.searchParams.delete('search');
		next.searchParams.delete('eventType');
		next.searchParams.delete('startDate');
		next.searchParams.delete('endDate');

		for (const [key, value] of params.entries()) {
			next.searchParams.set(key, value);
		}

		window.history.replaceState({}, '', next);
	}

	async function loadVoiceActivityLog({ resetToFirstPage = false, debounced = false } = {}) {
		if (resetToFirstPage) {
			voiceLogPagination = {
				...voiceLogPagination,
				page: 1,
				pageSize: Number(voiceLogPageSize) || 30,
				hasPreviousPage: false,
				hasNextPage: voiceLogPagination.totalPages > 1,
			};
		}

		if (voiceLogDebounceTimer) {
			clearTimeout(voiceLogDebounceTimer);
			voiceLogDebounceTimer = undefined;
		}

		const run = async () => {
			voiceLogAbortController?.abort();
			voiceLogAbortController = new AbortController();

			voiceLogLoading = true;
			voiceLogError = '';

			try {
				const params = buildVoiceLogQueryParams();
				const response = await fetch(`/api/admin/${data.serverId}/voice-activity-log?${params.toString()}`, {
					headers: { accept: 'application/json' },
					signal: voiceLogAbortController.signal,
				});

				if (!response.ok) {
					throw new Error(`Failed to load history (${response.status})`);
				}

				const payload = await response.json();
				voiceLogEntries = Array.isArray(payload?.entries) ? payload.entries : [];
				voiceLogPagination = normalizeVoiceLogPagination(payload?.pagination);
				voiceLogPageSize = voiceLogPagination.pageSize;
				syncVoiceLogQueryToUrl();
			} catch (error) {
				if (error?.name === 'AbortError') return;
				console.warn('[LiveVoice] Failed to load voice history', error);
				voiceLogError = 'Unable to load history right now.';
			} finally {
				voiceLogLoading = false;
			}
		};

		if (debounced) {
			voiceLogDebounceTimer = setTimeout(() => {
				run();
			}, VOICE_LOG_FILTER_DEBOUNCE_MS);
			return;
		}

		await run();
	}

	async function goToVoiceLogPage(page) {
		const nextPage = Math.min(Math.max(1, Number(page) || 1), voiceLogPagination.totalPages);
		if (nextPage === voiceLogPagination.page) return;

		voiceLogPagination = {
			...voiceLogPagination,
			page: nextPage,
		};

		await loadVoiceActivityLog();
	}

	function onVoiceLogSearchInput() {
		loadVoiceActivityLog({ resetToFirstPage: true, debounced: true });
	}

	function onVoiceLogFilterChange() {
		loadVoiceActivityLog({ resetToFirstPage: true });
	}

	function clearVoiceLogFilters() {
		voiceLogSearch = '';
		voiceLogEventType = '';
		voiceLogSortOrder = 'desc';
		voiceLogStartDate = '';
		voiceLogEndDate = '';
		loadVoiceActivityLog({ resetToFirstPage: true });
	}

	function getVoiceLogRangeLabel() {
		if (voiceLogPagination.total === 0) return '0 events';
		const start = (voiceLogPagination.page - 1) * voiceLogPagination.pageSize + 1;
		const end = Math.min(start + voiceLogEntries.length - 1, voiceLogPagination.total);
		return `${start}-${end} of ${voiceLogPagination.total}`;
	}

	function getVoiceLogActionIcon(entry) {
		const eventType = String(entry?.eventType || '').toUpperCase();

		switch (eventType) {
			case 'VOICE_JOIN':
				return { icon: '📥', label: 'Joined voice channel', tone: 'join' };
			case 'VOICE_LEAVE':
				return { icon: '📤', label: 'Left voice channel', tone: 'leave' };
			case 'VOICE_MOVE':
				return { icon: '🔁', label: 'Moved voice channel', tone: 'move' };
			case 'VOICE_VIDEO_START':
				return { icon: '🎥', label: 'Started video', tone: 'video-start' };
			case 'VOICE_VIDEO_STOP':
				return { icon: '📷', label: 'Stopped video', tone: 'video-stop' };
			case 'VOICE_STREAM_START':
				return { icon: '🖥️', label: 'Started streaming', tone: 'stream-start' };
			case 'VOICE_STREAM_STOP':
				return { icon: '🛑', label: 'Stopped streaming', tone: 'stream-stop' };
			case 'VOICE_SELF_MUTE':
			case 'VOICE_SERVER_MUTE':
				return { icon: '🔇', label: 'Muted', tone: 'muted' };
			case 'VOICE_SELF_UNMUTE':
			case 'VOICE_SERVER_UNMUTE':
				return { icon: '🔊', label: 'Unmuted', tone: 'unmuted' };
			case 'VOICE_SELF_DEAFEN':
			case 'VOICE_SERVER_DEAFEN':
				return { icon: '🙉', label: 'Deafened', tone: 'deafened' };
			case 'VOICE_SELF_UNDEAFEN':
			case 'VOICE_SERVER_UNDEAFEN':
				return { icon: '👂', label: 'Undeafened', tone: 'undeafened' };
			case 'VOICE_STAGE_SUPPRESS':
				return { icon: '🤐', label: 'Stage suppressed', tone: 'stage' };
			case 'VOICE_STAGE_UNSUPPRESS':
				return { icon: '🎤', label: 'Stage unsuppressed', tone: 'stage' };
			case 'VOICE_STAGE_REQUEST_TO_SPEAK':
				return { icon: '✋', label: 'Requested to speak', tone: 'stage' };
			case 'VOICE_STAGE_REQUEST_CANCELLED':
				return { icon: '✖', label: 'Cancelled speak request', tone: 'stage' };
			default:
				return { icon: '•', label: 'Voice activity event', tone: 'default' };
		}
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
				<div class="voice-log-header-meta">
					<span class="voice-log-count">{getVoiceLogRangeLabel()}</span>
					{#if voiceLogLoading}
						<span class="voice-log-loading">Loading...</span>
					{/if}
				</div>
			</div>

			<div class="voice-log-filters">
				<label class="voice-log-filter voice-log-filter--search">
					<span>Search</span>
					<input
						type="search"
						placeholder="Find member, channel, or activity"
						bind:value={voiceLogSearch}
						oninput={onVoiceLogSearchInput}
					/>
				</label>

				<label class="voice-log-filter">
					<span>Event</span>
					<select bind:value={voiceLogEventType} onchange={onVoiceLogFilterChange}>
						<option value="">All events</option>
						{#each voiceEventTypeOptions as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</label>

				<label class="voice-log-filter">
					<span>Order</span>
					<select bind:value={voiceLogSortOrder} onchange={onVoiceLogFilterChange}>
						<option value="desc">Newest first</option>
						<option value="asc">Oldest first</option>
					</select>
				</label>

				<label class="voice-log-filter">
					<span>From</span>
					<input type="date" bind:value={voiceLogStartDate} onchange={onVoiceLogFilterChange} />
				</label>

				<label class="voice-log-filter">
					<span>To</span>
					<input type="date" bind:value={voiceLogEndDate} onchange={onVoiceLogFilterChange} />
				</label>

				<label class="voice-log-filter">
					<span>Page size</span>
					<select bind:value={voiceLogPageSize} onchange={onVoiceLogFilterChange}>
						<option value="20">20</option>
						<option value="30">30</option>
						<option value="50">50</option>
						<option value="100">100</option>
					</select>
				</label>

				<button type="button" class="voice-log-clear" onclick={clearVoiceLogFilters}>
					Reset
				</button>
			</div>

			{#if voiceLogError}
				<div class="voice-log-error">{voiceLogError}</div>
			{/if}

			{#if voiceLogEntries.length > 0}
				<div class="voice-log-list">
					{#each voiceLogEntries as entry}
						{@const actionIcon = getVoiceLogActionIcon(entry)}
						<div class="voice-log-row">
							<div class="voice-log-main">
								<span class="voice-log-actor">
									{#if entry.actorId}
										<img
											src={getAvatarUrl(entry.actorId, entry.actorAvatar, entry.actorDiscriminator, 20)}
											alt="{entry.actorName}'s avatar"
											class="voice-log-actor-avatar"
											onerror={(e) => { e.target.style.display = 'none'; }}
										/>
									{/if}
									{entry.actorName}
								</span>
								<span class={`voice-log-action-icon ${actionIcon.tone}`} title={actionIcon.label} aria-label={actionIcon.label}>
									{actionIcon.icon}
								</span>
								<span class="voice-log-action">{entry.actionLabel}</span>
								<span class="voice-log-channel">in {entry.channelName}</span>
							</div>
							<span class="voice-log-time" title={entry.createdAt || ''}>
								{entry.createdAt ? formatRelativeTime(entry.createdAt) : 'Unknown time'}
							</span>
						</div>
					{/each}
				</div>

				<div class="voice-log-pagination">
					<button type="button" onclick={() => goToVoiceLogPage(1)} disabled={voiceLogLoading || !voiceLogPagination.hasPreviousPage}>
						First
					</button>
					<button
						type="button"
						onclick={() => goToVoiceLogPage(voiceLogPagination.page - 1)}
						disabled={voiceLogLoading || !voiceLogPagination.hasPreviousPage}
					>
						Previous
					</button>
					<span class="voice-log-page-indicator">
						Page {voiceLogPagination.page} of {voiceLogPagination.totalPages}
					</span>
					<button
						type="button"
						onclick={() => goToVoiceLogPage(voiceLogPagination.page + 1)}
						disabled={voiceLogLoading || !voiceLogPagination.hasNextPage}
					>
						Next
					</button>
					<button
						type="button"
						onclick={() => goToVoiceLogPage(voiceLogPagination.totalPages)}
						disabled={voiceLogLoading || !voiceLogPagination.hasNextPage}
					>
						Last
					</button>
				</div>
			{:else}
				<div class="voice-log-empty">No VC activity matched this filter yet.</div>
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

	.voice-log-header-meta {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
	}

	.voice-log-loading {
		font-size: 0.75rem;
		padding: 0.2rem 0.45rem;
		border: 1px solid color-mix(in srgb, var(--color-primary) 45%, transparent);
		border-radius: 999px;
		color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary-soft) 65%, transparent);
	}

	.voice-log-filters {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.6rem;
		margin-bottom: 0.9rem;
	}

	.voice-log-filter {
		display: flex;
		flex-direction: column;
		gap: 0.32rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.voice-log-filter--search {
		grid-column: span 2;
	}

	.voice-log-filter input,
	.voice-log-filter select {
		height: 2rem;
		padding: 0 0.6rem;
		border-radius: 0.55rem;
		border: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-surface-elevated) 88%, transparent);
		color: var(--color-text);
		font-size: 0.83rem;
	}

	.voice-log-filter input:focus,
	.voice-log-filter select:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--color-primary) 65%, var(--color-border));
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary-soft) 35%, transparent);
	}

	.voice-log-clear {
		height: 2rem;
		align-self: end;
		border: 1px solid var(--color-border);
		border-radius: 0.55rem;
		background: transparent;
		color: var(--color-text-muted);
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.voice-log-clear:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.voice-log-error {
		margin-bottom: 0.8rem;
		padding: 0.6rem 0.7rem;
		border-radius: 0.55rem;
		border: 1px solid rgba(239, 68, 68, 0.45);
		background: rgba(239, 68, 68, 0.12);
		color: #ff9b9b;
		font-size: 0.82rem;
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
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.voice-log-actor {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.voice-log-actor-avatar {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	.voice-log-action {
		color: var(--color-text);
	}

	.voice-log-action-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.2rem;
		height: 1.2rem;
		font-size: 0.85rem;
		line-height: 1;
		border-radius: 0.35rem;
		border: 1px solid transparent;
		background: color-mix(in srgb, var(--color-surface-elevated) 90%, transparent);
	}

	.voice-log-action-icon.join {
		background: rgba(34, 197, 94, 0.14);
		border-color: rgba(34, 197, 94, 0.34);
	}

	.voice-log-action-icon.leave {
		background: rgba(239, 68, 68, 0.14);
		border-color: rgba(239, 68, 68, 0.34);
	}

	.voice-log-action-icon.move {
		background: rgba(245, 158, 11, 0.14);
		border-color: rgba(245, 158, 11, 0.34);
	}

	.voice-log-action-icon.video-start,
	.voice-log-action-icon.stream-start,
	.voice-log-action-icon.unmuted,
	.voice-log-action-icon.undeafened {
		background: rgba(88, 101, 242, 0.14);
		border-color: rgba(88, 101, 242, 0.34);
	}

	.voice-log-action-icon.video-stop,
	.voice-log-action-icon.stream-stop,
	.voice-log-action-icon.muted,
	.voice-log-action-icon.deafened {
		background: rgba(236, 72, 153, 0.14);
		border-color: rgba(236, 72, 153, 0.34);
	}

	.voice-log-action-icon.stage {
		background: rgba(168, 85, 247, 0.14);
		border-color: rgba(168, 85, 247, 0.34);
	}

	.voice-log-channel {
		color: var(--color-text-muted);
	}

	.voice-log-time {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.voice-log-pagination {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.45rem;
		flex-wrap: wrap;
		margin-top: 0.8rem;
	}

	.voice-log-pagination button {
		height: 1.9rem;
		padding: 0 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--color-surface-elevated) 80%, transparent);
		color: var(--color-text);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.voice-log-pagination button:hover:not(:disabled) {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.voice-log-pagination button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.voice-log-page-indicator {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		padding: 0 0.2rem;
	}

	.voice-log-empty {
		padding: 0.8rem;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	@media (max-width: 767px) {
		.voice-log-filter--search {
			grid-column: span 1;
		}

		.voice-log-pagination {
			justify-content: flex-start;
		}
	}
</style>
