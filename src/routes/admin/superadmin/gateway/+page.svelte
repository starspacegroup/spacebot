<script lang="ts">
	import { onMount } from 'svelte';
	import { formatDate as tzFormatDate } from '$lib/timezone.js';
	import ChartTooltip from '$lib/components/charts/ChartTooltip.svelte';

	let { data } = $props();

	// Derived from server data as defaults
	const serverStats = $derived(data?.stats ?? null);
	const serverChartData = $derived(data?.chartData ?? []);
	const recentSnapshots = $derived(data?.recentSnapshots ?? []);
	const serverBenchmarkInterval = $derived(data?.benchmarkInterval ?? 60);
	const requestOrigin = $derived(data?.requestOrigin ?? '');

	// Gateway logs state
	let gatewayLogs = $state([]);
	let gatewayLoggingEnabled = $state(false);
	let gatewayLogsLoading = $state(false);
	let gatewayLogsUpdating = $state(false);
	let gatewayLogsError = $state(null);
	let gatewayLogsLastUpdated = $state(null);
	let gatewayLogStatus = $state(null);
	let gatewayLogsAppOrigin = $state('');

	// Mutable state for client-side fetched data (overrides server data)
	let fetchedStats = $state(null);
	let fetchedChartData = $state(null);
	let fetchedRecentSnapshots = $state(null);
	let selectedRange = $state('24h');
	let loading = $state(false);
	let fetchedInterval = $state(null);
	let savingInterval = $state(false);
	let toast = $state(null);

	// Use fetched data if available, otherwise fall back to server data
	const stats = $derived(fetchedStats ?? serverStats);
	const chartData = $derived(fetchedChartData ?? serverChartData);
	const snapshots = $derived(fetchedRecentSnapshots ?? recentSnapshots);
	const benchmarkInterval = $derived(fetchedInterval ?? serverBenchmarkInterval);

	const ranges = [
		{ value: '1h', label: '1 Hour' },
		{ value: '6h', label: '6 Hours' },
		{ value: '24h', label: '24 Hours' },
		{ value: '7d', label: '7 Days' },
		{ value: '30d', label: '30 Days' },
	];

	const intervalOptions = [
		{ value: 30, label: '30 seconds' },
		{ value: 60, label: '1 minute' },
		{ value: 120, label: '2 minutes' },
		{ value: 300, label: '5 minutes' },
		{ value: 600, label: '10 minutes' },
		{ value: 1800, label: '30 minutes' },
		{ value: 3600, label: '1 hour' },
		{ value: 7200, label: '2 hours' },
		{ value: 14400, label: '4 hours' },
		{ value: 28800, label: '8 hours' },
		{ value: 43200, label: '12 hours' },
		{ value: 86400, label: '24 hours' },
	];

	// Format date
	function formatDate(dateStr) {
		if (!dateStr) return 'Never';
		return tzFormatDate(dateStr, null);
	}

	// Format time for chart axis
	function formatTime(dateStr) {
		if (!dateStr) return '';
		const d = new Date(dateStr + 'Z');
		if (selectedRange === '1h' || selectedRange === '6h') {
			return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		}
		if (selectedRange === '24h') {
			return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		}
		return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	// Format latency with color class
	function latencyClass(ms) {
		if (ms === null || ms === undefined) return 'latency-unknown';
		if (ms < 100) return 'latency-good';
		if (ms < 200) return 'latency-ok';
		if (ms < 500) return 'latency-warn';
		return 'latency-bad';
	}

	// Format latency display
	function formatLatency(ms) {
		if (ms === null || ms === undefined) return '—';
		return `${Math.round(ms)}ms`;
	}

	// Format uptime
	function formatUptime(seconds) {
		if (!seconds) return '—';
		const days = Math.floor(seconds / 86400);
		const hours = Math.floor((seconds % 86400) / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		if (days > 0) return `${days}d ${hours}h ${mins}m`;
		if (hours > 0) return `${hours}h ${mins}m`;
		return `${mins}m`;
	}

	// Format status badge
	function statusClass(status) {
		if (status === 'connected') return 'status-connected';
		if (status === 'measuring') return 'status-measuring';
		return 'status-disconnected';
	}

	// Fetch data for a given range
	async function fetchRange(range) {
		selectedRange = range;
		loading = true;

		try {
			const response = await fetch(`/api/gateway/benchmark?range=${range}`);
			if (response.ok) {
				const result = await response.json();
				fetchedStats = result.stats;
				fetchedChartData = result.chartData;
				fetchedRecentSnapshots = result.recentSnapshots ?? null;
				if (result.benchmarkInterval) {
					fetchedInterval = result.benchmarkInterval;
				}
			}
		} catch (error) {
			console.error('Failed to fetch benchmark data:', error);
		} finally {
			loading = false;
		}
	}

	// Update the benchmark check interval
	async function updateInterval(newInterval) {
		if (newInterval === benchmarkInterval) return;
		savingInterval = true;
		toast = null;
		try {
			const response = await fetch('/api/gateway/benchmark', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ benchmark_interval_seconds: newInterval }),
			});
			if (response.ok) {
				const result = await response.json().catch(() => ({}));
				fetchedInterval = result.benchmark_interval_seconds ?? newInterval;
				await fetchRange(selectedRange);
				toast = { type: 'success', message: 'Check interval updated' };
			} else {
				const result = await response.json().catch(() => ({}));
				toast = { type: 'error', message: result.error || `Failed to update interval (${response.status})` };
			}
		} catch (error) {
			toast = { type: 'error', message: error.message || 'Failed to update interval' };
		} finally {
			savingInterval = false;
		}
	}

	// Tooltip state for latency chart
	let latencyTooltip = $state<Record<string, any>>({ visible: false, clientX: 0, clientY: 0, date: '', value: '', hasData: true });

	function showLatencyTooltip(event, point) {
		latencyTooltip = {
			visible: true,
			clientX: event.clientX,
			clientY: event.clientY,
			date: point.time,
			value: `${point.latency}ms`,
			label: point.status,
			chartColor: point.latency < 80 ? '#57F287' : point.latency < 150 ? '#FEE75C' : '#ED4245',
			hasData: true
		};
	}

	function hideLatencyTooltip() {
		latencyTooltip.visible = false;
	}

	// Chart dimensions
	const chartWidth = 800;
	const chartHeight = 250;
	const chartPadding = { top: 20, right: 20, bottom: 30, left: 50 };

	// Compute chart points
	const chartPoints = $derived.by(() => {
		const points = chartData.filter(d => d.heartbeat_latency_ms !== null);
		if (points.length === 0) return [];

		const innerWidth = chartWidth - chartPadding.left - chartPadding.right;
		const innerHeight = chartHeight - chartPadding.top - chartPadding.bottom;

		const timestamps = points.map(d => new Date(d.recorded_at + 'Z').getTime());
		const latencies = points.map(d => d.heartbeat_latency_ms);

		const minTime = Math.min(...timestamps);
		const maxTime = Math.max(...timestamps);
		const maxLatency = Math.max(...latencies, 100); // At least 100ms scale

		const timeRange = maxTime - minTime || 1;

		return points.map((d, i) => ({
			x: chartPadding.left + ((timestamps[i] - minTime) / timeRange) * innerWidth,
			y: chartPadding.top + innerHeight - (d.heartbeat_latency_ms / maxLatency) * innerHeight,
			latency: d.heartbeat_latency_ms,
			time: formatTime(d.recorded_at),
			status: d.status,
		}));
	});

	// SVG path for the line
	const chartPath = $derived(
		chartPoints.length > 1
			? chartPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
			: ''
	);

	// Y-axis labels
	const yAxisLabels = $derived.by(() => {
		const latencies = chartData.filter(d => d.heartbeat_latency_ms !== null).map(d => d.heartbeat_latency_ms);
		if (latencies.length === 0) return [];
		const max = Math.max(...latencies, 100);
		const innerHeight = chartHeight - chartPadding.top - chartPadding.bottom;
		const steps = [0, Math.round(max * 0.25), Math.round(max * 0.5), Math.round(max * 0.75), Math.round(max)];
		return steps.map(v => ({
			value: v,
			y: chartPadding.top + innerHeight - (v / max) * innerHeight,
		}));
	});

	// Current status from latest snapshot
	const latestSnapshot = $derived(snapshots?.[0] ?? null);
	const currentLatency = $derived(latestSnapshot?.heartbeat_latency_ms ?? null);
	const currentStatus = $derived(latestSnapshot?.status ?? 'unknown');

	// Gateway logs helpers
	function formatTimestamp(dateStr) {
		if (!dateStr) return 'Never';
		const parsed = new Date(dateStr);
		if (Number.isNaN(parsed.getTime())) {
			return formatDate(dateStr);
		}
		return `${parsed.toLocaleDateString()} ${parsed.toLocaleTimeString()}`;
	}

	function formatRelativeTime(dateStr) {
		if (!dateStr) return 'never';

		const parsed = new Date(dateStr);
		if (Number.isNaN(parsed.getTime())) {
			return formatTimestamp(dateStr);
		}

		const diffMs = Date.now() - parsed.getTime();
		if (diffMs < 5_000) return 'just now';

		const diffSeconds = Math.floor(diffMs / 1000);
		if (diffSeconds < 60) return `${diffSeconds}s ago`;

		const diffMinutes = Math.floor(diffSeconds / 60);
		if (diffMinutes < 60) return `${diffMinutes}m ago`;

		const diffHours = Math.floor(diffMinutes / 60);
		if (diffHours < 24) return `${diffHours}h ago`;

		const diffDays = Math.floor(diffHours / 24);
		return `${diffDays}d ago`;
	}

	async function parseJsonResponse(response, fallbackMessage) {
		const contentType = (response.headers.get('content-type') || '').toLowerCase();
		const isJson = contentType.includes('application/json');

		if (!isJson) {
			const body = await response.text();
			const isRedirect = response.redirected || (response.status >= 300 && response.status < 400);
			const redirectSuffix = isRedirect ? ` (redirected to ${response.url})` : '';
			const previewSuffix = body ? ` Preview: ${body.slice(0, 120)}` : '';
			throw new Error(
				`${fallbackMessage}: expected JSON but received ${contentType || 'unknown content'} (${response.status})${redirectSuffix}.${previewSuffix}`
			);
		}

		let result;
		try {
			result = await response.json();
		} catch {
			throw new Error(`${fallbackMessage}: invalid JSON response (${response.status})`);
		}

		if (!response.ok) {
			throw new Error(result?.error || `${fallbackMessage} (${response.status})`);
		}

		return result;
	}

	async function refreshGatewayLogs({ silent = false } = {}) {
		if (!silent) {
			gatewayLogsLoading = true;
		}
		gatewayLogsError = null;

		try {
			const response = await fetch('/api/gateway/logs?limit=150');
			const result = await parseJsonResponse(response, 'Failed to load gateway logs');

			applyGatewayLogStatus(result.status);
			gatewayLogs = result.logs || [];
			gatewayLogsLastUpdated = new Date().toISOString();
		} catch (error) {
			gatewayLogsError = error.message;
		} finally {
			gatewayLogsLoading = false;
		}
	}

	async function updateGatewayLogging(enabled) {
		gatewayLogsUpdating = true;
		gatewayLogsError = null;

		try {
			const response = await fetch('/api/gateway/logs', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled }),
			});
			const result = await parseJsonResponse(response, 'Failed to update gateway logging');

			gatewayLoggingEnabled = result.enabled === true;
			await refreshGatewayLogs({ silent: true });
		} catch (error) {
			gatewayLogsError = error.message;
		} finally {
			gatewayLogsUpdating = false;
		}
	}

	function toggleGatewayLogging() {
		return updateGatewayLogging(!gatewayLoggingEnabled);
	}

	function applyGatewayLogStatus(status) {
		if (!status) {
			return;
		}

		gatewayLogStatus = status;
		gatewayLoggingEnabled = status.enabled === true;
	}

	function getGatewayLogsGuidance() {
		if (gatewayLogStatus?.lastGatewayConnected || !gatewayLoggingEnabled) {
			return null;
		}

		if (gatewayLogsAppOrigin.includes('localhost:4269')) {
			return `This local web app is live, but no local gateway process has polled ${gatewayLogsAppOrigin} yet. Start the gateway service separately so it can connect to this app instance.`;
		}

		return 'This app instance has not seen a gateway heartbeat yet. The gateway service is likely offline or pointed at a different environment.';
	}

	onMount(() => {
		gatewayLogsAppOrigin = window.location.origin;

		// There's no server-side push/SSE endpoint for gateway logs (the old
		// EventSource code here pointed at /api/gateway/logs/stream, which was
		// never implemented — it 404'd and reconnected every 3s forever).
		// Plain polling against the existing /api/gateway/logs JSON endpoint
		// is all that's needed for a low-frequency admin log viewer.
		const gatewayLogsIntervalId = window.setInterval(() => {
			void refreshGatewayLogs({ silent: true });
		}, 5000);

		void refreshGatewayLogs();

		return () => {
			window.clearInterval(gatewayLogsIntervalId);
		};
	});
</script>

<svelte:head>
	<title>Gateway Benchmarks | Super Admin</title>
</svelte:head>

<div class="gateway-page">
	<h1 class="page-title">
		<span class="page-icon">📡</span>
		Gateway Benchmarks
	</h1>
	<p class="page-description">Monitor Discord WebSocket connection speed, latency, and uptime.</p>

	<!-- Live Status -->
	<section class="stats-section">
		<h2 class="section-title">
			<span class="section-icon">🔴</span>
			Current Status
		</h2>
		<div class="stats-grid">
			<div class="stat-card stat-primary">
				<div class="stat-icon">🏓</div>
				<div class="stat-content">
					<span class="stat-value {latencyClass(currentLatency)}">{formatLatency(currentLatency)}</span>
					<span class="stat-label">Heartbeat Latency</span>
				</div>
			</div>
			<div class="stat-card stat-blue">
				<div class="stat-icon">🔌</div>
				<div class="stat-content">
					<span class="stat-value">
						<span class="status-dot {statusClass(currentStatus)}"></span>
						{currentStatus}
					</span>
					<span class="stat-label">Connection Status</span>
				</div>
			</div>
			<div class="stat-card stat-purple">
				<div class="stat-icon">🏠</div>
				<div class="stat-content">
					<span class="stat-value">{latestSnapshot?.guild_count ?? '—'}</span>
					<span class="stat-label">Guilds Connected</span>
				</div>
			</div>
			<div class="stat-card stat-green">
				<div class="stat-icon">⏱️</div>
				<div class="stat-content">
					<span class="stat-value">{formatUptime(latestSnapshot?.uptime_seconds)}</span>
					<span class="stat-label">Uptime</span>
				</div>
			</div>
		</div>
	</section>

	<!-- Check Interval Setting -->
	<section class="stats-section">
		<h2 class="section-title">
			<span class="section-icon">⏱️</span>
			Check Interval
		</h2>
		{#if toast}
			<div class="toast toast-{toast.type}">
				<span>{toast.type === 'success' ? '✓' : '✗'}</span> {toast.message}
				<button type="button" class="toast-close" onclick={() => toast = null}>✕</button>
			</div>
		{/if}
		<div class="interval-picker">
			<p class="interval-description">How often the gateway reports latency data. Takes effect on the next check cycle.</p>
			{#if requestOrigin}
				<p class="interval-hint">
					This dashboard is updating settings on <code>{requestOrigin}</code>. The gateway process follows its own <code>API_BASE</code>, so if it points at a different origin the reporting cadence here will not change.
				</p>
			{/if}
			<div class="interval-options">
				{#each intervalOptions as opt}
					<button
						type="button"
						class="range-btn"
						class:active={benchmarkInterval === opt.value}
						onclick={() => updateInterval(opt.value)}
						disabled={savingInterval}
					>
						{opt.label}
					</button>
				{/each}
			</div>
		</div>
	</section>

	<!-- Range Selector -->
	<section class="stats-section">
		<div class="range-header">
			<h2 class="section-title">
				<span class="section-icon">📈</span>
				Latency Over Time
			</h2>
			<div class="range-selector">
				{#each ranges as r}
					<button
						class="range-btn"
						class:active={selectedRange === r.value}
						onclick={() => fetchRange(r.value)}
						disabled={loading}
					>
						{r.label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Stats Summary -->
		{#if stats}
			<div class="stats-grid stats-grid-small">
				<div class="stat-card-mini">
					<span class="stat-label">Average</span>
					<span class="stat-value {latencyClass(stats.avg_latency)}">{formatLatency(stats.avg_latency)}</span>
				</div>
				<div class="stat-card-mini">
					<span class="stat-label">Minimum</span>
					<span class="stat-value {latencyClass(stats.min_latency)}">{formatLatency(stats.min_latency)}</span>
				</div>
				<div class="stat-card-mini">
					<span class="stat-label">Maximum</span>
					<span class="stat-value {latencyClass(stats.max_latency)}">{formatLatency(stats.max_latency)}</span>
				</div>
				<div class="stat-card-mini">
					<span class="stat-label">Disconnections</span>
					<span class="stat-value">{stats.disconnection_count ?? 0}</span>
				</div>
			</div>
		{/if}

		<!-- Latency Chart -->
		<div class="chart-container" class:loading style="position:relative">
			<ChartTooltip tooltip={latencyTooltip} />
			{#if chartPoints.length > 1}
				<svg viewBox="0 0 {chartWidth} {chartHeight}" class="latency-chart">
					<!-- Grid lines -->
					{#each yAxisLabels as label}
						<line
							x1={chartPadding.left}
							y1={label.y}
							x2={chartWidth - chartPadding.right}
							y2={label.y}
							class="grid-line"
						/>
						<text
							x={chartPadding.left - 8}
							y={label.y + 4}
							class="axis-label"
							text-anchor="end"
						>{label.value}ms</text>
					{/each}

					<!-- Latency line -->
					<path d={chartPath} class="latency-line" />

					<!-- Data points -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					{#each chartPoints as point}
						<circle
							cx={point.x}
							cy={point.y}
							r="4"
							class="data-point {latencyClass(point.latency)}"
							style="cursor:pointer"
							onmouseenter={(e) => showLatencyTooltip(e, point)}
							onmouseleave={hideLatencyTooltip}
						/>
					{/each}
				</svg>
			{:else if chartData.length === 0}
				<div class="chart-empty">
					<p>No benchmark data available for this range.</p>
					<p class="chart-empty-hint">The gateway process reports latency every {benchmarkInterval} seconds.</p>
				</div>
			{:else}
				<div class="chart-empty">
					<p>Not enough data points to render a chart.</p>
				</div>
			{/if}

			{#if loading}
				<div class="chart-loading-overlay">
					<span class="loading-spinner"></span>
				</div>
			{/if}
		</div>
	</section>

	<!-- Recent Snapshots Table -->
	<section class="stats-section">
		<h2 class="section-title">
			<span class="section-icon">📋</span>
			Recent Snapshots
		</h2>

		{#if snapshots.length > 0}
			<div class="table-wrapper">
				<table class="snapshots-table">
					<thead>
						<tr>
							<th>Time</th>
							<th>Latency</th>
							<th>Status</th>
							<th>Guilds</th>
							<th>Uptime</th>
							<th>Gateway</th>
						</tr>
					</thead>
					<tbody>
						{#each snapshots as snapshot}
							<tr>
								<td class="cell-time">{formatDate(snapshot.recorded_at)}</td>
								<td>
									<span class="latency-badge {latencyClass(snapshot.heartbeat_latency_ms)}">
										{formatLatency(snapshot.heartbeat_latency_ms)}
									</span>
								</td>
								<td>
									<span class="status-badge {statusClass(snapshot.status)}">
										{snapshot.status}
									</span>
								</td>
								<td>{snapshot.guild_count}</td>
								<td>{formatUptime(snapshot.uptime_seconds)}</td>
								<td class="cell-gateway">{snapshot.gateway_url ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="empty-state">
				<p>No benchmark snapshots recorded yet.</p>
				<p class="empty-hint">The gateway process will start reporting once it's connected.</p>
			</div>
		{/if}
	</section>

	<!-- Gateway Logs -->
	<section class="gateway-logs-section">
		<div class="gateway-logs-header">
			<h2 class="section-title">
				<span class="section-icon">🛰️</span>
				Gateway Logs
			</h2>
			<div class="gateway-logs-actions">
				<span class:gateway-log-status={true} class:enabled={gatewayLoggingEnabled} class:disabled={!gatewayLoggingEnabled}>
					{gatewayLoggingEnabled ? 'Live Capture On' : 'Live Capture Off'}
				</span>
				<button class="btn btn-secondary btn-sm" onclick={() => refreshGatewayLogs()} disabled={gatewayLogsLoading || gatewayLogsUpdating}>
					Refresh
				</button>
				<button class="btn btn-sm {gatewayLoggingEnabled ? 'btn-danger' : 'btn-primary'}" onclick={toggleGatewayLogging} disabled={gatewayLogsUpdating}>
					{#if gatewayLogsUpdating}
						Saving...
					{:else if gatewayLoggingEnabled}
						Disable Logging
					{:else}
						Enable Logging
					{/if}
				</button>
			</div>
		</div>

		<p class="gateway-logs-hint">
			When enabled, the gateway process forwards new console output here for superadmin debugging. Toggle changes propagate to the gateway within a few seconds.
		</p>

		<div class="gateway-logs-diagnostics">
			<span class:gateway-connection-status={true} class:connected={gatewayLogStatus?.lastGatewayConnected === true} class:stale={gatewayLogStatus?.lastGatewayConnected !== true}>
				{gatewayLogStatus?.lastGatewayConnected ? 'Gateway Connected' : 'Gateway Not Connected'}
			</span>
			<span>
				{gatewayLogStatus?.lastGatewaySeenAt ? `Last poll ${formatRelativeTime(gatewayLogStatus.lastGatewaySeenAt)}` : 'No gateway poll seen yet'}
			</span>
			<span>
				{gatewayLogStatus?.lastGatewayPostedAt ? `Last stored batch ${formatRelativeTime(gatewayLogStatus.lastGatewayPostedAt)} (${gatewayLogStatus.lastStoredCount || 0} entries)` : 'No stored gateway batches yet'}
			</span>
		</div>

		{#if getGatewayLogsGuidance()}
			<div class="gateway-logs-empty gateway-logs-guidance">{getGatewayLogsGuidance()}</div>
		{/if}

		{#if gatewayLogsError}
			<div class="cmd-toast cmd-toast-error">
				<span>✗</span> {gatewayLogsError}
				<button class="cmd-toast-close" onclick={() => gatewayLogsError = null}>✕</button>
			</div>
		{/if}

		<div class="gateway-logs-meta">
			<span>Showing {gatewayLogs.length} recent entries</span>
			<span>Last refreshed: {formatTimestamp(gatewayLogsLastUpdated)}</span>
		</div>

		{#if gatewayLogsLoading && gatewayLogs.length === 0}
			<div class="gateway-logs-empty">Loading gateway logs...</div>
		{:else if gatewayLogs.length === 0}
			<div class="gateway-logs-empty">
				{#if gatewayLoggingEnabled && gatewayLogStatus?.lastGatewayConnected !== true}
					Logging is enabled, but this app has not seen a live gateway heartbeat yet.
				{:else if gatewayLoggingEnabled}
					Logging is enabled. New gateway output will appear here live.
				{:else}
					Gateway logging is disabled. Enable it to capture new console output.
				{/if}
			</div>
		{:else}
			<div class="gateway-logs-console">
				{#each gatewayLogs as entry (entry.id)}
					<div class="gateway-log-entry level-{entry.level}">
						<div class="gateway-log-entry-meta">
							<span class="gateway-log-time">{formatTimestamp(entry.logged_at || entry.created_at)}</span>
							<span class="gateway-log-level">{entry.level.toUpperCase()}</span>
						</div>
						<pre class="gateway-log-message">{entry.message}</pre>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.gateway-page {
		width: 100%;
	}

	.page-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.25rem;
		font-weight: 700;
		margin: 0 0 0.25rem;
		color: var(--color-text);
	}

	@media (min-width: 640px) {
		.page-title {
			font-size: 1.5rem;
		}
	}

	.page-icon {
		font-size: 1.25rem;
	}

	@media (min-width: 640px) {
		.page-icon {
			font-size: 1.5rem;
		}
	}

	.page-description {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		margin: 0 0 1.25rem;
	}

	@media (min-width: 640px) {
		.page-description {
			font-size: 0.9rem;
			margin: 0 0 1.5rem;
		}
	}

	/* Stats layout */
	.stats-section {
		margin-bottom: 2rem;
	}

	.section-title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0 0 1rem;
		color: var(--color-text);
	}

	@media (min-width: 640px) {
		.section-title {
			font-size: 1.25rem;
		}
	}

	.section-icon {
		font-size: 1.1rem;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
	}

	@media (min-width: 768px) {
		.stats-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.stats-grid-small {
		grid-template-columns: repeat(2, 1fr);
		margin-bottom: 1rem;
	}

	@media (min-width: 640px) {
		.stats-grid-small {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.stat-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	@media (min-width: 480px) {
		.stat-card {
			flex-direction: row;
			align-items: center;
			gap: 1rem;
			padding: 1.25rem;
		}
	}

	.stat-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	@media (min-width: 480px) {
		.stat-icon {
			font-size: 2rem;
		}
	}

	.stat-content {
		display: flex;
		flex-direction: column;
	}

	.stat-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.2;
	}

	@media (min-width: 480px) {
		.stat-value {
			font-size: 1.5rem;
		}
	}

	.stat-label {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.stat-primary {
		border-left: 4px solid var(--color-primary);
	}

	.stat-blue {
		border-left: 4px solid #3b82f6;
	}

	.stat-purple {
		border-left: 4px solid var(--color-accent-light);
	}

	.stat-green {
		border-left: 4px solid #22c55e;
	}

	.stat-card-mini {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.stat-card-mini .stat-label {
		order: -1;
		font-size: 0.8rem;
	}

	.stat-card-mini .stat-value {
		font-size: 1.25rem;
	}

	/* Latency colors */
	.latency-good {
		color: #22c55e !important;
	}

	.latency-ok {
		color: #eab308 !important;
	}

	.latency-warn {
		color: #f97316 !important;
	}

	.latency-bad {
		color: #ef4444 !important;
	}

	.latency-unknown {
		color: var(--color-text-muted) !important;
	}

	/* Status styling */
	.status-dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		margin-right: 0.4rem;
	}

	.status-dot.status-connected {
		background: #22c55e;
		box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
	}

	.status-dot.status-measuring {
		background: #eab308;
		box-shadow: 0 0 6px rgba(234, 179, 8, 0.5);
	}

	.status-dot.status-disconnected {
		background: #ef4444;
		box-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
	}

	/* Range selector */
	.range-header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	@media (min-width: 640px) {
		.range-header {
			flex-direction: row;
			justify-content: space-between;
			align-items: center;
		}
	}

	.range-header .section-title {
		margin: 0;
	}

	.range-selector {
		display: flex;
		gap: 0.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.25rem;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}

	.range-btn {
		padding: 0.375rem 0.6rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
		flex-shrink: 0;
	}

	@media (min-width: 640px) {
		.range-btn {
			padding: 0.375rem 0.75rem;
			font-size: 0.8rem;
		}
	}

	.range-btn:hover:not(:disabled) {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.range-btn.active {
		background: var(--color-accent-soft);
		color: var(--color-primary);
	}

	.range-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Toast */
	.toast {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		margin-bottom: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}
	.toast-success { background: var(--color-success-soft); color: var(--color-success); border: 1px solid rgba(34, 197, 94, 0.3); }
	.toast-error { background: var(--color-danger-soft); color: var(--color-danger); border: 1px solid rgba(239, 68, 68, 0.3); }
	.toast-close { background: none; border: none; color: inherit; cursor: pointer; margin-left: auto; }

	/* Interval picker */
	.interval-picker {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
	}

	.interval-description {
		color: var(--color-text-muted);
		font-size: 0.8rem;
		margin: 0 0 0.75rem;
	}

	.interval-hint {
		color: var(--color-text-muted);
		font-size: 0.78rem;
		line-height: 1.5;
		margin: 0 0 0.75rem;
	}

	.interval-hint code {
		background: rgba(255, 255, 255, 0.06);
		border-radius: var(--radius-sm);
		padding: 0.1rem 0.35rem;
	}

	.interval-options {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.25rem;
	}

	/* Chart */
	.chart-container {
		position: relative;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 0.75rem;
		min-height: 180px;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}

	@media (min-width: 640px) {
		.chart-container {
			padding: 1rem;
			min-height: 200px;
		}
	}

	.chart-container.loading {
		opacity: 0.6;
	}

	.latency-chart {
		width: 100%;
		height: auto;
		min-width: 500px;
	}

	@media (min-width: 640px) {
		.latency-chart {
			min-width: auto;
		}
	}

	.grid-line {
		stroke: var(--color-border);
		stroke-width: 1;
		stroke-dasharray: 4 4;
	}

	.axis-label {
		fill: var(--color-text-muted);
		font-size: 11px;
		font-family: inherit;
	}

	.latency-line {
		fill: none;
		stroke: #818cf8;
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	.data-point {
		fill: #818cf8;
		stroke: var(--color-surface);
		stroke-width: 1.5;
		cursor: pointer;
	}

	.data-point.latency-good {
		fill: #22c55e;
	}

	.data-point.latency-ok {
		fill: #eab308;
	}

	.data-point.latency-warn {
		fill: #f97316;
	}

	.data-point.latency-bad {
		fill: #ef4444;
	}

	.chart-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 180px;
		color: var(--color-text-muted);
		font-size: 0.9rem;
		text-align: center;
		gap: 0.25rem;
	}

	.chart-empty-hint {
		font-size: 0.8rem;
		opacity: 0.7;
	}

	.chart-loading-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-lg);
	}

	.loading-spinner {
		width: 24px;
		height: 24px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Snapshots Table */
	.table-wrapper {
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.snapshots-table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		font-size: 0.8rem;
		min-width: 550px;
	}

	@media (min-width: 768px) {
		.snapshots-table {
			font-size: 0.85rem;
			min-width: auto;
		}
	}

	.snapshots-table th {
		padding: 0.5rem 0.75rem;
		text-align: left;
		font-weight: 600;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-border);
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
	}

	@media (min-width: 768px) {
		.snapshots-table th {
			padding: 0.75rem 1rem;
			font-size: 0.8rem;
			letter-spacing: 0.03em;
		}
	}

	.snapshots-table td {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		white-space: nowrap;
	}

	@media (min-width: 768px) {
		.snapshots-table td {
			padding: 0.625rem 1rem;
		}
	}

	.snapshots-table tbody tr:last-child td {
		border-bottom: none;
	}

	.snapshots-table tbody tr:hover {
		background: var(--color-surface-hover);
	}

	.cell-time {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.cell-gateway {
		font-size: 0.75rem;
		font-family: monospace;
		color: var(--color-text-muted);
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Latency badge */
	.latency-badge {
		display: inline-block;
		padding: 0.2rem 0.5rem;
		border-radius: var(--radius-sm);
		font-weight: 600;
		font-size: 0.8rem;
	}

	.latency-badge.latency-good {
		background: rgba(34, 197, 94, 0.1);
	}

	.latency-badge.latency-ok {
		background: rgba(234, 179, 8, 0.1);
	}

	.latency-badge.latency-warn {
		background: rgba(249, 115, 22, 0.1);
	}

	.latency-badge.latency-bad {
		background: rgba(239, 68, 68, 0.1);
	}

	/* Status badge */
	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
		font-weight: 500;
		text-transform: capitalize;
	}

	.status-badge.status-connected {
		background: rgba(34, 197, 94, 0.1);
		color: #22c55e;
	}

	.status-badge.status-connected::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #22c55e;
	}

	.status-badge.status-measuring {
		background: rgba(234, 179, 8, 0.1);
		color: #eab308;
	}

	.status-badge.status-measuring::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #eab308;
	}

	.status-badge.status-disconnected {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}

	.status-badge.status-disconnected::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #ef4444;
	}

	/* Empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		color: var(--color-text-muted);
		text-align: center;
		gap: 0.25rem;
	}

	@media (min-width: 640px) {
		.empty-state {
			padding: 3rem 1.5rem;
		}
	}

	.empty-hint {
		font-size: 0.85rem;
		opacity: 0.7;
	}

	/* Gateway Logs */
	.gateway-logs-section {
		margin-bottom: 2rem;
		padding: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	@media (min-width: 640px) {
		.gateway-logs-section {
			padding: 1.25rem;
		}
	}

	.gateway-logs-header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	@media (min-width: 900px) {
		.gateway-logs-header {
			flex-direction: row;
			justify-content: space-between;
			align-items: center;
		}
	}

	.gateway-logs-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.gateway-log-status {
		display: inline-flex;
		align-items: center;
		padding: 0.35rem 0.7rem;
		border-radius: var(--radius-full);
		font-size: 0.75rem;
		font-weight: 700;
	}

	.gateway-log-status.enabled {
		background: var(--color-success-bg, rgba(34, 197, 94, 0.15));
		color: var(--color-success, #22c55e);
	}

	.gateway-log-status.disabled {
		background: rgba(148, 163, 184, 0.16);
		color: var(--color-text-muted);
	}

	.gateway-logs-hint {
		margin: 0 0 0.75rem;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.gateway-logs-diagnostics {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.gateway-connection-status {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.65rem;
		border-radius: var(--radius-full);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	.gateway-connection-status.connected {
		background: rgba(34, 197, 94, 0.15);
		color: #86efac;
		border: 1px solid rgba(34, 197, 94, 0.35);
	}

	.gateway-connection-status.stale {
		background: rgba(245, 158, 11, 0.15);
		color: #fcd34d;
		border: 1px solid rgba(245, 158, 11, 0.35);
	}

	.gateway-logs-meta {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	@media (min-width: 640px) {
		.gateway-logs-meta {
			flex-direction: row;
			justify-content: space-between;
		}
	}

	.gateway-logs-console {
		max-height: 30rem;
		overflow: auto;
		padding: 0.75rem;
		background: var(--color-bg, #0f172a);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.gateway-log-entry {
		padding: 0.75rem 0;
		border-bottom: 1px solid rgba(148, 163, 184, 0.16);
	}

	.gateway-log-entry:first-child {
		padding-top: 0;
	}

	.gateway-log-entry:last-child {
		padding-bottom: 0;
		border-bottom: 0;
	}

	.gateway-log-entry-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.35rem;
		font-size: 0.75rem;
	}

	.gateway-log-time {
		color: #94a3b8;
		font-family: monospace;
	}

	.gateway-log-level {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
		font-weight: 700;
		letter-spacing: 0.03em;
	}

	.level-error .gateway-log-level {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
	}

	.level-warn .gateway-log-level {
		background: rgba(245, 158, 11, 0.15);
		color: #fcd34d;
	}

	.level-info .gateway-log-level,
	.level-log .gateway-log-level {
		background: rgba(59, 130, 246, 0.15);
		color: #93c5fd;
	}

	.level-debug .gateway-log-level {
		background: rgba(168, 85, 247, 0.15);
		color: #d8b4fe;
	}

	.gateway-log-message {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: Consolas, 'Courier New', monospace;
		font-size: 0.82rem;
		line-height: 1.45;
		color: #e2e8f0;
		background: transparent;
	}

	.gateway-logs-empty {
		padding: 1rem;
		background: rgba(148, 163, 184, 0.08);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		text-align: center;
	}

	.gateway-logs-guidance {
		margin-bottom: 0.75rem;
		text-align: left;
	}

	.cmd-toast {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		margin-bottom: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	.cmd-toast-error {
		background: var(--color-danger-soft);
		color: var(--color-danger);
		border: 1px solid rgba(239, 68, 68, 0.3);
	}

	.cmd-toast-close {
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
		margin-left: auto;
	}
</style>
