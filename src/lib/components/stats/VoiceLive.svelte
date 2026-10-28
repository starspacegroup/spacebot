<script lang="ts">
	/**
	 * The Voice tab's live half: who is in voice right now, and the searchable log of
	 * joins, leaves and state changes. It used to be its own page (stats/vc-activity);
	 * it now loads its own data, so the Statistics page costs nothing while another
	 * tab is open.
	 */
	import { onMount, type Snippet } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { parseUTCDate, formatChartDate } from '$lib/timezone.js';
	import { getAvatarUrl } from '$lib/utils/avatar.js';

	type LogFilters = {
		search: string;
		eventType: string;
		sortOrder: 'asc' | 'desc';
		startDate: string;
		endDate: string;
	};

	const {
		serverId,
		liveUpdatesAuth = null,
		eventTypeOptions = [],
		preview = null,
		between,
	}: {
		serverId: string;
		liveUpdatesAuth?: { userId: string; expiresAt: number; signature: string } | null;
		eventTypeOptions?: { value: string; label: string }[];
		/** Dev only: a canned snapshot and log, so the tab can be seen without a server. */
		preview?: { snapshot: any; entries: any[] } | null;
		/** Rendered between the live board and the log: the trend charts and leaders. */
		between?: Snippet;
	} = $props();

	const LIVE_VOICE_POLL_MS = 15000;
	const VOICE_LOG_FILTER_DEBOUNCE_MS = 220;

	function normalizeVoiceLogPagination(pagination?: any) {
		const pageSize = Number(pagination?.pageSize || 30);
		const total = Number(pagination?.total || 0);
		const totalPages = Math.max(
			1,
			Number(pagination?.totalPages || Math.ceil(total / pageSize) || 1)
		);
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

	function normalizeLiveVoiceSnapshot(snapshot?: any) {
		return {
			channels: Array.isArray(snapshot?.channels) ? snapshot.channels : [],
			totalUsers: Number(snapshot?.totalUsers || 0),
			totalChannels: Number(snapshot?.totalChannels || 0),
			activeCameras: Number(snapshot?.activeCameras || 0),
			activeStreams: Number(snapshot?.activeStreams || 0),
			membersInActivities: Number(snapshot?.membersInActivities || 0),
			updatedAt: snapshot?.updatedAt || null,
		};
	}

	let voiceLogEntries = $state<any[]>([]);
	let voiceLogPagination = $state(normalizeVoiceLogPagination());
	let voiceLogPageSize = $state(30);
	let voiceLogSearch = $state('');
	let voiceLogEventType = $state('');
	let voiceLogSortOrder = $state('desc');
	let voiceLogStartDate = $state('');
	let voiceLogEndDate = $state('');
	let voiceLogLoading = $state(true);
	let voiceLogError = $state('');

	let voiceLogDebounceTimer;
	let voiceLogAbortController;
	let voiceLogLiveRefreshController;

	let liveVoiceSnapshot = $state(normalizeLiveVoiceSnapshot());
	let liveVoiceLoaded = $state(false);
	let liveVoiceRefreshing = $state(false);
	let liveVoiceRefreshError = $state('');
	let liveVoiceStreamConnected = $state(false);

	function canAutoRefreshLog() {
		return (
			voiceLogPagination.page === 1 &&
			voiceLogSortOrder === 'desc' &&
			!voiceLogSearch.trim() &&
			!voiceLogEventType &&
			!voiceLogStartDate &&
			!voiceLogEndDate
		);
	}

	function buildVoiceLogQueryParams({
		page = voiceLogPagination.page,
		pageSize = voiceLogPageSize,
	} = {}) {
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

	async function silentRefreshVoiceLog() {
		if (preview || !canAutoRefreshLog()) return;
		if (voiceLogLoading) return;

		voiceLogLiveRefreshController?.abort();
		voiceLogLiveRefreshController = new AbortController();

		try {
			const params = buildVoiceLogQueryParams({ page: 1 });
			const response = await fetch(
				`/api/admin/${serverId}/voice-activity-log?${params.toString()}`,
				{
					headers: { accept: 'application/json' },
					signal: voiceLogLiveRefreshController.signal,
				}
			);
			if (!response.ok) return;
			const payload = await response.json();
			voiceLogEntries = Array.isArray(payload?.entries) ? payload.entries : [];
			voiceLogPagination = normalizeVoiceLogPagination(payload?.pagination);
		} catch (err) {
			if (err?.name === 'AbortError') return;
			console.warn('[LiveVoice] Silent log refresh failed', err);
		}
	}

	async function refreshLiveVoiceSnapshot({ silent = false } = {}) {
		if (preview) return;
		if (liveVoiceStreamConnected && silent) return;
		if (liveVoiceRefreshing) return;

		liveVoiceRefreshing = true;
		if (!silent) liveVoiceRefreshError = '';

		try {
			const response = await fetch(`/api/admin/${serverId}/live-voice`, {
				headers: { accept: 'application/json' },
			});
			if (!response.ok) throw new Error(`Refresh failed with status ${response.status}`);
			liveVoiceSnapshot = normalizeLiveVoiceSnapshot(await response.json());
			liveVoiceLoaded = true;
			liveVoiceRefreshError = '';
		} catch (error) {
			console.warn('[LiveVoice] Refresh failed', error);
			if (!silent) liveVoiceRefreshError = 'Unable to refresh live voice right now.';
		} finally {
			liveVoiceRefreshing = false;
		}
	}

	/** The filters a shared link or a reload carries in the address bar. */
	function readFiltersFromUrl(): LogFilters & { pageSize: number } {
		const q = new URL(window.location.href).searchParams;
		return {
			search: q.get('search') ?? '',
			eventType: q.get('eventType') ?? '',
			sortOrder: q.get('sort') === 'asc' ? 'asc' : 'desc',
			startDate: q.get('startDate') ?? '',
			endDate: q.get('endDate') ?? '',
			pageSize: Number(q.get('pageSize')) || 30,
		};
	}

	function syncVoiceLogQueryToUrl() {
		if (typeof window === 'undefined') return;
		const next = new URL(window.location.href);
		for (const key of [
			'page',
			'pageSize',
			'sort',
			'search',
			'eventType',
			'startDate',
			'endDate',
		]) {
			next.searchParams.delete(key);
		}
		for (const [key, value] of buildVoiceLogQueryParams().entries()) {
			next.searchParams.set(key, value);
		}
		replaceState(next, {});
	}

	async function loadVoiceActivityLog({ resetToFirstPage = false, debounced = false } = {}) {
		if (preview) return;
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
				const response = await fetch(
					`/api/admin/${serverId}/voice-activity-log?${params.toString()}`,
					{
						headers: { accept: 'application/json' },
						signal: voiceLogAbortController.signal,
					}
				);

				if (!response.ok) {
					throw new Error(`Failed to load history (${response.status})`);
				}

				const payload = await response.json();
				voiceLogEntries = Array.isArray(payload?.entries) ? payload.entries : [];
				voiceLogPagination = normalizeVoiceLogPagination(payload?.pagination);
				voiceLogPageSize = voiceLogPagination.pageSize;
				voiceLogLoading = false;
				syncVoiceLogQueryToUrl();
			} catch (error) {
				if (error?.name === 'AbortError') return;
				console.warn('[LiveVoice] Failed to load voice history', error);
				voiceLogError = 'Unable to load history right now.';
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
		voiceLogPagination = { ...voiceLogPagination, page: nextPage };
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

	const filtersActive = $derived(
		!!(
			voiceLogSearch.trim() ||
			voiceLogEventType ||
			voiceLogStartDate ||
			voiceLogEndDate ||
			voiceLogSortOrder === 'asc'
		)
	);

	function getVoiceLogRangeLabel() {
		if (voiceLogPagination.total === 0) return '0 events';
		const start = (voiceLogPagination.page - 1) * voiceLogPagination.pageSize + 1;
		const end = Math.min(start + voiceLogEntries.length - 1, voiceLogPagination.total);
		return `${start}–${end} of ${voiceLogPagination.total}`;
	}

	onMount(() => {
		if (preview) {
			liveVoiceSnapshot = normalizeLiveVoiceSnapshot(preview.snapshot);
			liveVoiceLoaded = true;
			voiceLogEntries = preview.entries;
			voiceLogPagination = normalizeVoiceLogPagination({
				page: 1,
				pageSize: 30,
				total: preview.entries.length,
			});
			voiceLogLoading = false;
			return;
		}

		const fromUrl = readFiltersFromUrl();
		voiceLogSearch = fromUrl.search;
		voiceLogEventType = fromUrl.eventType;
		voiceLogSortOrder = fromUrl.sortOrder;
		voiceLogStartDate = fromUrl.startDate;
		voiceLogEndDate = fromUrl.endDate;
		voiceLogPageSize = fromUrl.pageSize;
		loadVoiceActivityLog();

		let stream;

		if (liveUpdatesAuth?.signature && liveUpdatesAuth?.userId && liveUpdatesAuth?.expiresAt) {
			const streamUrl = new URL(
				`/api/admin/${serverId}/live-updates/stream`,
				window.location.origin
			);
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
					liveVoiceLoaded = true;
					liveVoiceStreamConnected = true;
					liveVoiceRefreshError = '';
					silentRefreshVoiceLog();
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

		// Don't poll a backgrounded tab — nobody is looking at the result and each
		// refresh is a real query against D1.
		const isVisible = () =>
			typeof document === 'undefined' || document.visibilityState === 'visible';

		refreshLiveVoiceSnapshot({ silent: true });

		const intervalId = setInterval(() => {
			if (!isVisible()) return;
			refreshLiveVoiceSnapshot({ silent: true });
			if (!liveVoiceStreamConnected) silentRefreshVoiceLog();
		}, LIVE_VOICE_POLL_MS);

		// Catch up as soon as the tab is foregrounded again.
		const onVisibilityChange = () => {
			if (isVisible()) refreshLiveVoiceSnapshot({ silent: true });
		};
		document.addEventListener('visibilitychange', onVisibilityChange);

		return () => {
			clearInterval(intervalId);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			if (voiceLogDebounceTimer) clearTimeout(voiceLogDebounceTimer);
			voiceLogAbortController?.abort();
			voiceLogLiveRefreshController?.abort();
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
		const diffMs = Date.now() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);
		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return formatChartDate(dateStr);
	}

	/** Only what is on: a row of grey "off" chips for every member was noise. */
	function liveVoiceBadges(member) {
		return [
			{ label: 'Camera', on: !!member.selfVideo, tone: 'video' },
			{ label: 'Sharing', on: !!member.streaming, tone: 'stream' },
			{ label: 'Muted', on: !!member.selfMute, tone: 'mute' },
			{ label: 'Deafened', on: !!member.selfDeaf, tone: 'deaf' },
			{ label: 'Server muted', on: !!member.serverMute, tone: 'mute' },
			{ label: 'Server deafened', on: !!member.serverDeaf, tone: 'deaf' },
			{ label: 'Suppressed', on: !!member.suppress, tone: 'deaf' },
		].filter((b) => b.on);
	}

	const summary = $derived([
		{ label: 'In voice now', value: liveVoiceSnapshot.totalUsers, hero: true },
		{ label: 'Active channels', value: liveVoiceSnapshot.totalChannels },
		{ label: 'Cameras on', value: liveVoiceSnapshot.activeCameras },
		{ label: 'Screensharing', value: liveVoiceSnapshot.activeStreams },
		{ label: 'In an Activity', value: liveVoiceSnapshot.membersInActivities },
	]);
</script>

<section class="vl" aria-label="Live voice">
	<div class="vl-head">
		<div class="vl-title">
			<h2>Right now</h2>
			<span class="vl-updated">
				{liveVoiceSnapshot.updatedAt
					? `Updated ${formatRelativeTime(liveVoiceSnapshot.updatedAt)}`
					: liveVoiceLoaded
						? 'No snapshot yet'
						: 'Loading…'}
			</span>
		</div>
		<div class="vl-actions">
			{#if liveVoiceRefreshError}
				<span class="vl-error">{liveVoiceRefreshError}</span>
			{/if}
			<button
				type="button"
				class="vl-live"
				class:on={liveVoiceStreamConnected || !!preview}
				onclick={() => refreshLiveVoiceSnapshot()}
				disabled={liveVoiceRefreshing || liveVoiceStreamConnected}
				title={liveVoiceStreamConnected
					? 'Live updates are on'
					: 'Click to refresh; this page also checks every 15 seconds'}
			>
				<span class="vl-dot"></span>
				{#if liveVoiceStreamConnected || preview}
					Live
				{:else if liveVoiceRefreshing}
					Refreshing…
				{:else}
					Refresh
				{/if}
			</button>
		</div>
	</div>

	<div class="vl-kpis">
		{#each summary as item (item.label)}
			<div class="vl-kpi" class:hero={item.hero}>
				<span class="vl-kpi-value">{formatNumber(item.value)}</span>
				<span class="vl-kpi-label">{item.label}</span>
			</div>
		{/each}
	</div>

	{#if liveVoiceSnapshot.channels.length > 0}
		<div class="vl-grid">
			{#each liveVoiceSnapshot.channels as channel (channel.channelId ?? channel.channelName)}
				<div class="vl-channel">
					<div class="vl-channel-head">
						<h3>{channel.channelName}</h3>
						<span class="vl-count" title="{channel.memberCount} in this channel"
							>{channel.memberCount}</span
						>
					</div>

					<ul class="vl-members">
						{#each channel.members as member (member.userId ?? member.userName)}
							<li class="vl-member">
								{#if member.avatarUrl}
									<img
										class="vl-avatar"
										src={member.avatarUrl}
										alt=""
										loading="lazy"
									/>
								{:else}
									<span class="vl-avatar vl-avatar-fallback" aria-hidden="true"
										>{getAvatarInitial(
											member.displayName || member.userName
										)}</span
									>
								{/if}

								<div class="vl-member-main">
									<div class="vl-member-line">
										<span class="vl-name">{member.displayName}</span>
										{#if member.userName && member.userName !== member.displayName}
											<span class="vl-handle">@{member.userName}</span>
										{/if}
										{#each liveVoiceBadges(member) as badge (badge.label)}
											<span class="vl-chip {badge.tone}">{badge.label}</span>
										{/each}
									</div>

									{#if member.activities?.length}
										<div class="vl-activities">
											{#each member.activities as activity, i (i)}
												<span
													class="vl-activity"
													title={[activity.details, activity.state]
														.filter(Boolean)
														.join(' — ') || activity.name}
												>
													{#if activity.label}<span class="vl-verb"
															>{activity.label}</span
														>{/if}
													{activity.name}{#if activity.details}<span
															class="vl-detail"
														>
															· {activity.details}</span
														>{/if}
												</span>
											{/each}
										</div>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	{:else if liveVoiceLoaded}
		<div class="vl-empty">
			<span class="vl-empty-mark" aria-hidden="true">
				<svg
					viewBox="0 0 24 24"
					width="28"
					height="28"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
					><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect
						x="2.5"
						y="14"
						width="4.5"
						height="6.5"
						rx="1.6"
					/><rect x="17" y="14" width="4.5" height="6.5" rx="1.6" /></svg
				>
			</span>
			<p>Nobody is in voice right now.</p>
		</div>
	{/if}

	{@render between?.()}

	<div class="vl-log">
		<div class="vl-head">
			<div class="vl-title">
				<h2>Voice activity log</h2>
				<span class="vl-updated">
					{getVoiceLogRangeLabel()}{voiceLogLoading ? ' · loading…' : ''}
				</span>
			</div>
		</div>

		<div class="vl-filters">
			<label class="vl-field vl-field-search">
				<span>Search</span>
				<input
					type="search"
					placeholder="Member, channel or activity"
					bind:value={voiceLogSearch}
					oninput={onVoiceLogSearchInput}
				/>
			</label>

			<label class="vl-field">
				<span>Event</span>
				<select bind:value={voiceLogEventType} onchange={onVoiceLogFilterChange}>
					<option value="">All events</option>
					{#each eventTypeOptions as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</label>

			<label class="vl-field">
				<span>Order</span>
				<select bind:value={voiceLogSortOrder} onchange={onVoiceLogFilterChange}>
					<option value="desc">Newest first</option>
					<option value="asc">Oldest first</option>
				</select>
			</label>

			<label class="vl-field">
				<span>From</span>
				<input
					type="date"
					bind:value={voiceLogStartDate}
					onchange={onVoiceLogFilterChange}
				/>
			</label>

			<label class="vl-field">
				<span>To</span>
				<input type="date" bind:value={voiceLogEndDate} onchange={onVoiceLogFilterChange} />
			</label>

			<label class="vl-field vl-field-size">
				<span>Rows</span>
				<select bind:value={voiceLogPageSize} onchange={onVoiceLogFilterChange}>
					<option value={20}>20</option>
					<option value={30}>30</option>
					<option value={50}>50</option>
					<option value={100}>100</option>
				</select>
			</label>

			{#if filtersActive}
				<button type="button" class="vl-reset" onclick={clearVoiceLogFilters}>Reset</button>
			{/if}
		</div>

		{#if voiceLogError}
			<div class="vl-error-box">{voiceLogError}</div>
		{/if}

		{#if voiceLogEntries.length > 0}
			<ul class="vl-rows">
				{#each voiceLogEntries as entry, i (entry.id ?? i)}
					<li class="vl-row">
						{#if entry.actorId}
							<img
								src={getAvatarUrl(
									entry.actorId,
									entry.actorAvatar,
									entry.actorDiscriminator,
									32
								)}
								alt=""
								class="vl-row-avatar"
								loading="lazy"
								onerror={(e) => {
									(e.target as HTMLElement).style.visibility = 'hidden';
								}}
							/>
						{:else}
							<span class="vl-row-avatar"></span>
						{/if}
						<span class="vl-row-text">
							<strong>{entry.actorName}</strong>
							<span class="vl-row-action"
								>{entry.actionIcon
									? `${entry.actionIcon} `
									: ''}{entry.actionLabel}</span
							>
							<span class="vl-row-channel">{entry.channelName}</span>
						</span>
						<time class="vl-row-time" title={entry.createdAt || ''}>
							{entry.createdAt ? formatRelativeTime(entry.createdAt) : 'Unknown time'}
						</time>
					</li>
				{/each}
			</ul>

			{#if voiceLogPagination.totalPages > 1}
				<div class="vl-pager">
					<button
						type="button"
						onclick={() => goToVoiceLogPage(1)}
						disabled={voiceLogLoading || !voiceLogPagination.hasPreviousPage}
						aria-label="First page">«</button
					>
					<button
						type="button"
						onclick={() => goToVoiceLogPage(voiceLogPagination.page - 1)}
						disabled={voiceLogLoading || !voiceLogPagination.hasPreviousPage}
						>Previous</button
					>
					<span class="vl-page"
						>Page {voiceLogPagination.page} of {voiceLogPagination.totalPages}</span
					>
					<button
						type="button"
						onclick={() => goToVoiceLogPage(voiceLogPagination.page + 1)}
						disabled={voiceLogLoading || !voiceLogPagination.hasNextPage}>Next</button
					>
					<button
						type="button"
						onclick={() => goToVoiceLogPage(voiceLogPagination.totalPages)}
						disabled={voiceLogLoading || !voiceLogPagination.hasNextPage}
						aria-label="Last page">»</button
					>
				</div>
			{/if}
		{:else if !voiceLogLoading}
			<div class="vl-empty vl-empty-sm">
				<p>
					{filtersActive
						? 'Nothing matches these filters.'
						: 'No voice activity recorded yet.'}
				</p>
			</div>
		{/if}
	</div>
</section>

<style>
	.vl {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.vl-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.vl-title {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.vl-title h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 650;
		color: var(--color-text);
	}

	.vl-updated {
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

	.vl-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.vl-error {
		font-size: 0.82rem;
		color: var(--color-danger);
	}

	.vl-live {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.8rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-muted);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}

	.vl-live:disabled {
		cursor: default;
	}

	.vl-live.on {
		border-color: var(--color-success);
		background: var(--color-success-soft);
		color: var(--color-success);
	}

	.vl-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: currentColor;
	}

	.vl-live.on .vl-dot {
		animation: vlPulse 1.8s ease-in-out infinite;
	}

	@keyframes vlPulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.4;
			transform: scale(0.8);
		}
	}

	/* The five live numbers: one lead figure, four smaller ones. */
	.vl-kpis {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}

	@media (min-width: 720px) {
		.vl-kpis {
			grid-template-columns: 1.5fr repeat(4, minmax(0, 1fr));
		}
	}

	.vl-kpi {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.9rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.vl-kpi.hero {
		grid-column: 1 / -1;
		border-color: var(--color-primary);
		background: linear-gradient(
			135deg,
			var(--color-surface) 0%,
			var(--color-primary-soft) 100%
		);
	}

	@media (min-width: 720px) {
		.vl-kpi.hero {
			grid-column: auto;
		}
	}

	.vl-kpi-value {
		font-size: 1.7rem;
		font-weight: 700;
		line-height: 1.1;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}

	.vl-kpi.hero .vl-kpi-value {
		font-size: 2.3rem;
	}

	.vl-kpi-label {
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.vl-grid {
		display: grid;
		gap: 0.9rem;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
	}

	.vl-channel {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.vl-channel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--color-surface-elevated);
		border-bottom: 1px solid var(--color-border-light);
	}

	.vl-channel-head h3 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 650;
		color: var(--color-text);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.vl-count {
		flex: none;
		min-width: 1.6rem;
		padding: 0.1rem 0.5rem;
		border-radius: var(--radius-full);
		background: var(--color-primary-soft);
		color: var(--color-primary);
		font-size: 0.78rem;
		font-weight: 700;
		text-align: center;
	}

	.vl-members {
		list-style: none;
		margin: 0;
		padding: 0.35rem 0;
	}

	.vl-member {
		display: flex;
		gap: 0.7rem;
		align-items: flex-start;
		padding: 0.5rem 1rem;
	}

	.vl-avatar {
		flex: none;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		object-fit: cover;
		background: var(--color-surface-active);
	}

	.vl-avatar-fallback {
		display: grid;
		place-items: center;
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-text-secondary);
	}

	.vl-member-main {
		min-width: 0;
		flex: 1;
	}

	.vl-member-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.5rem;
	}

	.vl-name {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.vl-handle {
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.vl-chip {
		padding: 0.05rem 0.45rem;
		border-radius: var(--radius-full);
		border: 1px solid transparent;
		font-size: 0.68rem;
		font-weight: 650;
		letter-spacing: 0.01em;
	}

	.vl-chip.video {
		background: var(--color-info-soft);
		color: var(--color-info);
	}

	.vl-chip.stream {
		background: var(--color-success-soft);
		color: var(--color-success);
	}

	.vl-chip.mute {
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}

	.vl-chip.deaf {
		background: var(--color-warning-soft);
		color: var(--color-warning);
	}

	.vl-activities {
		margin-top: 0.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		font-size: 0.78rem;
		color: var(--color-text-secondary);
	}

	.vl-verb {
		color: var(--color-text-muted);
		margin-right: 0.25rem;
	}

	.vl-detail {
		color: var(--color-text-muted);
	}

	.vl-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2.5rem 1rem;
		border: 1px dashed var(--color-border-strong);
		border-radius: var(--radius-lg);
		color: var(--color-text-muted);
		text-align: center;
	}

	.vl-empty p {
		margin: 0;
	}

	.vl-empty-sm {
		padding: 1.5rem 1rem;
	}

	.vl-empty-mark {
		display: grid;
		place-items: center;
		width: 3.2rem;
		height: 3.2rem;
		border-radius: 50%;
		background: var(--color-surface-elevated);
		color: var(--color-text-muted);
	}

	/* The log */
	.vl-log {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		margin-top: 0.5rem;
		padding: 1.1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.vl-filters {
		display: grid;
		gap: 0.6rem;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		align-items: end;
	}

	.vl-field-search {
		grid-column: span 2;
	}

	@media (max-width: 520px) {
		.vl-field-search {
			grid-column: 1 / -1;
		}
	}

	.vl-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.vl-field input,
	.vl-field select {
		min-width: 0;
		padding: 0.45rem 0.6rem;
		font: inherit;
		font-size: 0.85rem;
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
		color: var(--color-text);
		background: var(--color-background);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.vl-field input:focus,
	.vl-field select:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--focus-ring);
	}

	.vl-reset {
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.vl-reset:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.vl-error-box {
		padding: 0.6rem 0.8rem;
		border-radius: var(--radius-md);
		background: var(--color-danger-soft);
		color: var(--color-danger);
		font-size: 0.85rem;
	}

	.vl-rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.vl-row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.55rem 0.25rem;
		border-bottom: 1px solid var(--color-border-light);
		font-size: 0.88rem;
	}

	.vl-row:last-child {
		border-bottom: 0;
	}

	.vl-row-avatar {
		flex: none;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		background: var(--color-surface-active);
	}

	.vl-row-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.4rem;
		color: var(--color-text-secondary);
	}

	.vl-row-text strong {
		color: var(--color-text);
		font-weight: 600;
	}

	.vl-row-channel {
		color: var(--color-primary);
		font-weight: 500;
	}

	.vl-row-time {
		flex: none;
		font-size: 0.78rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.vl-pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding-top: 0.25rem;
	}

	.vl-pager button {
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.vl-pager button:hover:not(:disabled) {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.vl-pager button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.vl-page {
		font-size: 0.82rem;
		color: var(--color-text-muted);
		padding: 0 0.4rem;
	}
</style>
