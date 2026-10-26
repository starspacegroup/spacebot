<script lang="ts">
	import { AreaChart, BarChart, ChartCard } from '$lib/components/charts';
	import { getDiscordCategoryMeta } from '$lib/discord/event-metadata.js';
	import { formatChartDate, parseUTCDate, getTodayLocal } from '$lib/timezone.js';
	import { getAvatarUrl } from '$lib/utils/avatar.js';
	import { page } from '$app/stores';
	import { replaceState } from '$app/navigation';
	import VoiceLive from '$lib/components/stats/VoiceLive.svelte';
	import VoiceMembers from '$lib/components/stats/VoiceMembers.svelte';

	const { data } = $props();

	// The page load returns a fast "shell" (loadMeta.needsHotload) when the
	// in-memory stats cache is cold, instead of blocking navigation on Discord
	// API calls, stats aggregation, and ~18 D1 queries. We used to backfill
	// that with goto(url, { invalidateAll: true }), but that forces every
	// loader in the route tree through SvelteKit's client-side data-merge
	// machinery just to refresh one page's stats — fetch the dedicated
	// endpoint directly instead (see src/routes/admin/[serverId]/+page.svelte
	// for the same fix applied to the dashboard first).
	// Dev only: `?preview=1` swaps in canned data (src/lib/stats/preview-fixture.ts).
	const preview = import.meta.env.DEV && $page.url.searchParams.has('preview');
	let previewData = $state<any>(null);
	if (import.meta.env.DEV && preview) {
		import('$lib/stats/preview-fixture.js').then((m) => (previewData = m.buildPreview()));
	}
	const previewVoice = $derived(previewData?.voice ?? null);

	let liveStats = $state(null);
	let statsKey = $state(null);
	let statsLoading = $state(false);

	const LIVE_FIELDS = [
		'statistics',
		'heatmapData',
		'categoryTrends',
		'recentExecutions',
		'automationHistory',
		'memberStats',
		'memberHistory',
		'voiceActivity',
		'memberGrowth',
		'memberGrowthChartData',
		'voiceActivityChartData',
		'topVoiceUsers',
		'topVideoUsers',
		'topScreenshareUsers',
		'topBoosters',
		'cachedRoles',
		'liveVoiceSnapshot',
	];

	$effect(() => {
		const serverId = data.serverId;
		const period = data.selectedPeriod;
		const key = `${serverId}:${period}`;
		if (preview || !data.loadMeta?.needsHotload || statsKey === key) return;

		statsLoading = true;
		fetch(`/api/admin/${serverId}/stats-data?period=${encodeURIComponent(period)}`)
			.then((res) => {
				if (!res.ok) throw new Error(`stats-data request failed: ${res.status}`);
				return res.json();
			})
			.then((json) => {
				liveStats = json;
				statsKey = key;
			})
			.catch((err) => {
				console.error('[Stats] Failed to load live stats:', err);
				statsKey = key; // stop retrying automatically; fall back to the shell defaults below
			})
			.finally(() => {
				statsLoading = false;
			});
	});

	// Merges the client-fetched stats (once loaded for the current
	// server+period) over the shell/cached defaults from the page load.
	const liveData = $derived(
		previewData
			? previewData.live
			: liveStats && statsKey === `${data.serverId}:${data.selectedPeriod}`
				? liveStats
				: Object.fromEntries(LIVE_FIELDS.map((key) => [key, data[key]]))
	);

	const isStatisticsLoading = $derived(statsLoading);
	const hasStatisticsData = $derived(Boolean(liveData.statistics));

	function createEmptyStatistics() {
		return {
			automations: { active: 0, total: 0, totalExecutions: 0, successfulExecutions: 0 },
			commands: { active: 0, total: 0, totalUsage: 0 },
			events: {
				total: 0,
				totalNonBot: 0,
				today: 0,
				todayNonBot: 0,
				thisWeek: 0,
				thisWeekNonBot: 0,
				thisMonth: 0,
				thisMonthNonBot: 0,
				byCategory: {},
				byCategoryNonBot: {},
			},
			timeSeries: { daily: [] },
			topChannels: [],
			commandUsage: [],
			automationPerformance: [],
		};
	}

	const statistics = $derived(liveData.statistics || createEmptyStatistics());

	const periodOptions = $derived(data.periodOptions || []);
	const selectedPeriod = $derived(data.selectedPeriod || '30d');
	const selectedPeriodLabel = $derived(data.selectedPeriodLabel || '30 Days');
	const liveUpdatesAuth = $derived(data.liveUpdatesAuth || null);

	function periodHref(period) {
		return `/admin/${data.serverId}/stats?period=${period}&tab=${tab}`;
	}

	// Tabs. The choice lives in the address bar (?tab=), so a link lands where it was
	// copied, but switching is client-side: no reload, no new server load.
	const TABS = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'voice', label: 'Voice' },
		{ id: 'activity', label: 'Activity' },
		{ id: 'automations', label: 'Automations' },
	] as const;
	type TabId = (typeof TABS)[number]['id'];
	const VOICE_LOG_PARAMS = [
		'page',
		'pageSize',
		'sort',
		'search',
		'eventType',
		'startDate',
		'endDate',
	];

	function tabFromUrl(): TabId {
		const wanted = $page.url.searchParams.get('tab');
		return TABS.find((t) => t.id === wanted)?.id ?? 'overview';
	}

	let tab = $state<TabId>(tabFromUrl());

	function selectTab(id: TabId) {
		if (id === tab) return;
		tab = id;
		const next = new URL($page.url);
		next.searchParams.set('tab', id);
		if (id !== 'voice') for (const key of VOICE_LOG_PARAMS) next.searchParams.delete(key);
		replaceState(next, {});
	}

	// Master toggle for all bot visibility
	let showBotsGlobal = $state(false);

	// Toggle states for showing bots in different sections
	let showBotsInVoiceUsers = $state(false);
	let showBotsInVideoUsers = $state(false);
	let showBotsInScreenshareUsers = $state(false);

	// Time unit toggle for voice activity cards: 'hours', 'minutes', 'seconds'
	let voiceTimeUnit = $state('hours');
	let showBotsInChannels = $state(false);
	let showBotsInCategories = $state(false);
	let showBotsInActivityChart = $state(false);
	let showBotsInHeatmap = $state(false);
	let showBotsInTotalEvents = $state(false);
	let showBotsInMembers = $state(false); // Default to false to show human members only

	// Pagination state for list sections
	const ITEMS_PER_PAGE = 5;
	let channelsPage = $state(0);
	let boostersPage = $state(0);

	// Master toggle handler
	function toggleAllBots(value) {
		showBotsGlobal = value;
		showBotsInVoiceUsers = value;
		showBotsInVideoUsers = value;
		showBotsInScreenshareUsers = value;
		showBotsInChannels = value;
		showBotsInCategories = value;
		showBotsInActivityChart = value;
		showBotsInTotalEvents = value;
		showBotsInHeatmap = value;
		showBotsInMembers = value;
		showBotsInMemberChart = value;
	}

	// Bot detection: checks actor_is_bot flag OR common bot name patterns (for legacy data)
	function isBot(actor) {
		if (actor.actor_is_bot) return true;
		const name = (actor.actor_name || '').toLowerCase();
		// Common bot patterns for legacy data without actor_is_bot flag
		return (
			name.includes('bot') ||
			name.includes('disboard') ||
			name.includes('github') ||
			name.includes('probot') ||
			name.includes('mee6') ||
			name.includes('dyno')
		);
	}

	function getBoostDays(premiumSince) {
		if (!premiumSince) return 0;
		const startedAt = parseUTCDate(premiumSince);
		if (!startedAt) return 0;
		const elapsedMs = Date.now() - startedAt.getTime();
		if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
		return Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
	}

	const allTopBoosters = $derived(
		(liveData.topBoosters || [])
			.filter((member) => !member.is_bot)
			.map((member) => ({
				...member,
				display_name:
					member.displayName || member.global_name || member.username || 'Unknown User',
				boost_days: getBoostDays(member.premium_since),
			}))
			.sort((a, b) => b.boost_days - a.boost_days)
	);

	const filteredTopBoosters = $derived(
		allTopBoosters.slice(boostersPage * ITEMS_PER_PAGE, (boostersPage + 1) * ITEMS_PER_PAGE)
	);

	const boostersTotalPages = $derived(Math.ceil(allTopBoosters.length / ITEMS_PER_PAGE));

	const filteredVoiceUsers = $derived(
		(liveData.topVoiceUsers || [])
			.filter((user) => showBotsInVoiceUsers || !isBot(user))
			.slice(0, 5)
	);

	const filteredVideoUsers = $derived(
		(liveData.topVideoUsers || [])
			.filter((user) => showBotsInVideoUsers || !isBot(user))
			.slice(0, 5)
	);

	const filteredScreenshareUsers = $derived(
		(liveData.topScreenshareUsers || [])
			.filter((user) => showBotsInScreenshareUsers || !isBot(user))
			.slice(0, 5)
	);

	// Filtered channels based on toggle - use non_bot_count when hiding bots
	const allFilteredChannels = $derived(
		(statistics.topChannels || [])
			.map((ch) => ({
				...ch,
				display_count: showBotsInChannels ? ch.event_count : ch.non_bot_count || 0,
			}))
			.filter((ch) => ch.display_count > 0)
			.sort((a, b) => b.display_count - a.display_count)
	);

	const filteredChannels = $derived(
		allFilteredChannels.slice(
			channelsPage * ITEMS_PER_PAGE,
			(channelsPage + 1) * ITEMS_PER_PAGE
		)
	);

	const channelsTotalPages = $derived(Math.ceil(allFilteredChannels.length / ITEMS_PER_PAGE));

	// Filtered categories based on toggle
	const filteredCategories = $derived(() => {
		const categories = statistics.events?.byCategory || {};
		const categoriesNonBot = statistics.events?.byCategoryNonBot || {};

		return Object.entries(categories)
			.map(([category, count]) => ({
				category,
				count,
				non_bot_count: categoriesNonBot[category] || 0,
				display_count: showBotsInCategories ? count : categoriesNonBot[category] || 0,
			}))
			.filter((c) => c.display_count > 0);
	});

	// Filtered category total
	const filteredCategoryTotal = $derived(
		filteredCategories().reduce((sum, c) => sum + c.display_count, 0)
	);

	function getCategoryPercentage(count, total) {
		if (!total) return 0;
		return ((count / total) * 100).toFixed(1);
	}

	// Format numbers with commas
	function formatNumber(num) {
		if (!num) return '0';
		return num.toLocaleString();
	}

	// Calculate success rate
	function getSuccessRate(successful, total) {
		if (!total) return 100;
		return ((successful / total) * 100).toFixed(1);
	}

	// Get max value for bar charts
	function getMaxValue(items, key) {
		if (!items?.length) return 1;
		return Math.max(...items.map((i) => i[key] || 0));
	}

	// Format seconds into the selected time unit
	function formatTime(seconds) {
		if (!seconds || seconds <= 0) return '0';
		if (voiceTimeUnit === 'seconds') return `${formatNumber(Math.round(seconds))}s`;
		if (voiceTimeUnit === 'minutes') return `${(seconds / 60).toFixed(1)}m`;
		return `${(seconds / 3600).toFixed(1)}h`;
	}

	function getTimeUnitLabel(prefix) {
		const labels = { hours: 'Hours', minutes: 'Minutes', seconds: 'Seconds' };
		return `${labels[voiceTimeUnit]} ${prefix}`;
	}

	function cycleTimeUnit() {
		if (voiceTimeUnit === 'hours') voiceTimeUnit = 'minutes';
		else if (voiceTimeUnit === 'minutes') voiceTimeUnit = 'seconds';
		else voiceTimeUnit = 'hours';
	}

	/** A min–max scaled sparkline: a flat-looking member count still shows its trend. */
	function sparkFrom(values) {
		const v = values.filter((n) => Number.isFinite(n));
		if (v.length < 2) return null;
		const lo = Math.min(...v);
		const hi = Math.max(...v);
		const span = hi - lo || 1;
		const pad = 3;
		const step = 100 / (v.length - 1);
		const pts = v.map((n, i) => [i * step, pad + (1 - (n - lo) / span) * (30 - pad * 2)]);
		const path = pts
			.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`)
			.join(' ');
		return { path, areaPath: `${path} L 100 30 L 0 30 Z` };
	}

	const memberSpark = $derived(
		sparkFrom((liveData.memberHistory || []).map((d) => d.human_count ?? d.member_count ?? 0))
	);
	const eventSpark = $derived(
		sparkFrom(
			(statistics.timeSeries?.daily || []).map((d) =>
				showBotsInTotalEvents ? d.count || 0 : d.non_bot_count || 0
			)
		)
	);

	// Build sparkline path from execution history data
	function buildSparkline(history) {
		if (!history || history.length === 0) {
			return { path: null, areaPath: null };
		}

		// Fill in missing days for last 14 days
		const days = 14;
		const today = new Date();
		const filledData = [];

		for (let i = days - 1; i >= 0; i--) {
			const d = new Date(today);
			d.setDate(d.getDate() - i);
			const dateStr = d.toISOString().split('T')[0];
			const existing = history.find((h) => h.date === dateStr);
			filledData.push({
				date: dateStr,
				value: existing ? existing.value : 0,
			});
		}

		const values = filledData.map((d) => d.value);
		const maxValue = Math.max(...values, 1);

		// Calculate points (viewBox is 100x30)
		const width = 100;
		const height = 30;
		const padding = 2;
		const innerWidth = width - padding * 2;
		const innerHeight = height - padding * 2;

		const xStep = innerWidth / (filledData.length - 1 || 1);
		const points = filledData.map((d, i) => {
			const x = padding + i * xStep;
			const y = padding + innerHeight - (d.value / maxValue) * innerHeight;
			return { x, y };
		});

		// Build line path
		let path = `M ${points[0].x} ${points[0].y}`;
		for (let i = 1; i < points.length; i++) {
			path += ` L ${points[i].x} ${points[i].y}`;
		}

		// Build area path
		const areaPath = `${path} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

		return { path, areaPath };
	}

	// Format relative time
	function formatRelativeTime(dateStr) {
		if (!dateStr) return 'Never';
		const date = parseUTCDate(dateStr);
		if (!date) return dateStr;
		const now = new Date();
		const diffMs = (now as any) - (date as any);
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return formatChartDate(dateStr, data.timezone);
	}

	// Get color for category
	function getCategoryColor(category) {
		return getDiscordCategoryMeta(category).color || '#6E6A95';
	}

	// Get category icon
	function getCategoryIcon(category) {
		return getDiscordCategoryMeta(category).icon || '📊';
	}

	// Prepare heatmap grid (7 days x 24 hours) - filtered by bot toggle
	const heatmapGrid = $derived.by(() => {
		const grid = Array(7)
			.fill(null)
			.map(() => Array(24).fill(0));
		const countKey = showBotsInHeatmap ? 'count' : 'non_bot_count';
		const maxCount = Math.max(
			...(liveData.heatmapData?.map((h) => h[countKey] || 0) || [1]),
			1
		);

		for (const item of liveData.heatmapData || []) {
			const value = item[countKey] || 0;
			grid[item.day_of_week][item.hour] = value / maxCount;
		}

		return grid;
	});

	const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

	// Daily chart data - filtered by bot toggle
	const dailyChartData = $derived.by(() => {
		const data_array = statistics.timeSeries?.daily || [];
		const countKey = showBotsInActivityChart ? 'count' : 'non_bot_count';
		const counts = data_array.map((d) => d[countKey] || 0);
		const maxCount = Math.max(...counts, 1);
		return data_array.map((d) => ({
			...d,
			display_count: d[countKey] || 0,
			percentage: ((d[countKey] || 0) / maxCount) * 100,
			label: formatChartDate(d.period, data.timezone),
		}));
	});

	// Format change with +/- sign
	function formatChange(value) {
		if (!value || value === 0) return '0';
		const sign = value > 0 ? '+' : '';
		return `${sign}${value.toLocaleString()}`;
	}

	// Transform member growth chart data for bar chart component
	const memberGrowthBarData = $derived.by(() => {
		const points = liveData.memberGrowthChartData || [];
		if (!points || points.length === 0) return [];

		return points.map((p) => ({
			date: p.date,
			label: formatChartDate(p.date, data.timezone),
			hasData: p.hasData !== false,
			values: [
				{ label: 'Joined', value: p.joins || 0, color: '#22c55e' },
				{ label: 'Left', value: p.leaves || 0, color: '#ef4444' },
			],
		}));
	});

	// Member growth summary stats
	const memberGrowthStats = $derived.by(() => {
		const points = liveData.memberGrowthChartData || [];
		if (!points || points.length === 0) return null;

		const totalJoins = points.reduce((sum, p) => sum + (p.joins || 0), 0);
		const totalLeaves = points.reduce((sum, p) => sum + (p.leaves || 0), 0);
		const netChange = totalJoins - totalLeaves;

		return { totalJoins, totalLeaves, netChange };
	});

	// Transform voice activity data for area chart component
	const voiceActivityData = $derived.by(() => {
		const points = liveData.voiceActivityChartData || [];
		if (!points || points.length === 0) return [];

		// Determine if we should use hours or minutes
		const totalMinutes = points.reduce((sum, p) => sum + (p.totalMinutes || 0), 0);
		const useHours = totalMinutes > 120;

		return points.map((p) => ({
			date: p.date,
			label: formatChartDate(p.date, data.timezone),
			value: useHours ? p.totalHours || 0 : p.totalMinutes || 0,
			hasData: p.hasData !== false,
		}));
	});

	// Peak unique voice users chart data
	const peakUsersData = $derived.by(() => {
		const points = liveData.voiceActivityChartData || [];
		if (!points || points.length === 0) return [];

		return points.map((p) => ({
			date: p.date,
			label: formatChartDate(p.date, data.timezone),
			value: p.uniqueUsers || 0,
			hasData: p.hasData !== false,
		}));
	});

	// Peak concurrent voice users chart data
	const peakConcurrentData = $derived.by(() => {
		const points = liveData.voiceActivityChartData || [];
		if (!points || points.length === 0) return [];

		return points.map((p) => ({
			date: p.date,
			label: formatChartDate(p.date, data.timezone),
			value: p.peakConcurrent || 0,
			hasData: p.hasData !== false,
		}));
	});

	// Build member count history from authoritative server_stats snapshots
	let showBotsInMemberChart = $state(false);

	const memberCountHistory = $derived.by(() => {
		const history = liveData.memberHistory || [];
		const latest = liveData.memberStats?.latest;
		const currentCount = showBotsInMemberChart
			? latest?.member_count || 0
			: (latest?.human_count ?? latest?.member_count ?? 0);

		const points = history
			.map((d) => {
				const memberCount = d.member_count || 0;
				const resolvedHumanCount =
					d.human_count ??
					(d.bot_count !== null && d.bot_count !== undefined
						? Math.max(0, memberCount - d.bot_count)
						: memberCount);

				return {
					date: d.period || d.last_recorded,
					label: formatChartDate(d.period || d.last_recorded, data.timezone),
					value: showBotsInMemberChart ? memberCount : resolvedHumanCount,
					hasData: true,
				};
			})
			.filter((point) => !!point.date);

		if (points.length === 0) {
			if (currentCount > 0) {
				const today = getTodayLocal(data.timezone);
				return [
					{
						date: today,
						label: formatChartDate(today, data.timezone),
						value: currentCount,
						hasData: true,
					},
				];
			}
			return [];
		}

		// Ensure today is always represented with the actual current count
		const todayForChart = getTodayLocal(data.timezone);
		const lastPoint = points[points.length - 1];
		if (lastPoint && lastPoint.date < todayForChart) {
			points.push({
				date: todayForChart,
				label: formatChartDate(todayForChart, data.timezone),
				value: currentCount,
				hasData: true,
			});
		} else if (lastPoint && lastPoint.date === todayForChart) {
			// Override today's derived value with the authoritative current count
			lastPoint.value = currentCount;
			lastPoint.hasData = true;
		}

		return points;
	});

	// Voice activity summary stats
	const voiceActivityStats = $derived.by(() => {
		const points = liveData.voiceActivityChartData || [];
		if (!points || points.length === 0) return null;

		const totalMinutes = points.reduce((sum, p) => sum + (p.totalMinutes || 0), 0);
		const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
		const useHours = totalMinutes > 120;
		const uniqueUsers = points.reduce((max, p) => Math.max(max, p.uniqueUsers || 0), 0);
		const peakConcurrent = points.reduce((max, p) => Math.max(max, p.peakConcurrent || 0), 0);
		const activePoints = points.filter((p) => (p.uniqueUsers || 0) > 0);
		const avgUniqueUsers =
			activePoints.length > 0
				? Math.round(
						(activePoints.reduce(
							(sum, p) => sum + (p.avgUniqueUsers || p.uniqueUsers || 0),
							0
						) /
							activePoints.length) *
							10
					) / 10
				: 0;
		const activeConcurrentPoints = points.filter((p) => (p.peakConcurrent || 0) > 0);
		const avgConcurrent =
			activeConcurrentPoints.length > 0
				? Math.round(
						(activeConcurrentPoints.reduce(
							(sum, p) => sum + (p.avgConcurrent || p.peakConcurrent || 0),
							0
						) /
							activeConcurrentPoints.length) *
							10
					) / 10
				: 0;

		return {
			totalMinutes,
			totalHours,
			useHours,
			uniqueUsers,
			peakConcurrent,
			avgUniqueUsers,
			avgConcurrent,
		};
	});

	// Role breakdown from cached roles data
	const roleBreakdown = $derived.by(() => {
		const roles = liveData.cachedRoles || [];
		if (roles.length === 0) return null;

		const managed = roles.filter((r) => r.managed);
		const hoisted = roles.filter((r) => r.hoist);
		const mentionable = roles.filter((r) => r.mentionable);
		const colored = roles.filter((r) => r.color && r.color !== 0);
		// @everyone is position 0 and name @everyone
		const custom = roles.filter((r) => !r.managed && r.name !== '@everyone');

		// Top hoisted roles (displayed in member list sidebar), sorted by position desc
		const topHoisted = hoisted.sort((a, b) => b.position - a.position).slice(0, 8);

		return {
			total: roles.length,
			managed: managed.length,
			custom: custom.length,
			hoisted: hoisted.length,
			mentionable: mentionable.length,
			colored: colored.length,
			topHoisted,
		};
	});

	// Convert Discord int color to hex CSS string
	function intToHex(color) {
		if (!color || color === 0) return 'var(--color-text-muted, rgba(255,255,255,0.5))';
		return '#' + color.toString(16).padStart(6, '0');
	}
</script>

<svelte:head>
	<title>Statistics - {data.guild?.name || 'Server'} | SpaceBot</title>
</svelte:head>

{#snippet ico(name)}
	<svg
		viewBox="0 0 24 24"
		width="20"
		height="20"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		{#if name === 'members'}
			<circle cx="9" cy="8" r="3.2" /><path
				d="M2.8 20c.4-3.4 2.9-5.4 6.2-5.4s5.8 2 6.2 5.4"
			/><path d="M16 5.2a3.1 3.1 0 0 1 0 5.8M18 14.9c2 .6 3.2 2.3 3.4 5.1" />
		{:else if name === 'automations'}
			<path d="M13 2 4 14h7l-1 8 9-12h-7z" />
		{:else if name === 'commands'}
			<path d="m5 8 5 4-5 4" /><path d="M12 17h7" />
		{:else}
			<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
		{/if}
	</svg>
{/snippet}

<div class="stats-page">
	<header class="sp-head">
		<div class="sp-head-main">
			<a href="/admin/{data.serverId}" class="sp-back">← Dashboard</a>
			<h1>Statistics</h1>
			<p class="sp-sub">{data.guild?.name || 'Your server'}</p>
		</div>
		<div class="sp-head-tools">
			<a href="/admin/{data.serverId}/logs" class="sp-link">Event logs</a>
			<label class="sp-switch" title="Count bots in every chart and total on this page">
				<input
					type="checkbox"
					bind:checked={showBotsGlobal}
					onchange={(e) => toggleAllBots((e.target as HTMLInputElement).checked)}
				/>
				<span class="sp-switch-track"></span>
				<span>Include bots</span>
			</label>
		</div>
	</header>

	<div class="sp-bar">
		<div class="sp-tabs" role="tablist" aria-label="Statistics sections">
			{#each TABS as t (t.id)}
				<button
					type="button"
					role="tab"
					class="sp-tab"
					class:active={tab === t.id}
					aria-selected={tab === t.id}
					onclick={() => selectTab(t.id)}
				>
					{t.label}
				</button>
			{/each}
		</div>
		<div
			class="sp-range"
			role="group"
			aria-label="Date range"
			title="Plan retention: {data.statsRetentionDays
				? `${data.statsRetentionDays} days`
				: 'unlimited'}"
		>
			{#each periodOptions as option (option.value)}
				<a
					href={periodHref(option.value)}
					class="sp-range-opt"
					class:active={selectedPeriod === option.value}
					aria-current={selectedPeriod === option.value ? 'true' : undefined}
				>
					{option.label.replace(' Days', 'd').replace(' Day', 'd')}
				</a>
			{/each}
		</div>
	</div>

	{#if tab === 'voice' && (!preview || previewData)}
		<VoiceLive
			serverId={data.serverId}
			{liveUpdatesAuth}
			eventTypeOptions={data.voiceEventTypeOptions || []}
			preview={previewVoice}
		>
			{#snippet between()}
				<VoiceMembers
					serverId={data.serverId}
					period={selectedPeriod}
					preview={previewData?.members ?? null}
				/>

				<!-- Voice Activity Charts Section -->
				<section class="chart-section">
					<h2 class="section-title">
						Voice Channel Activity
						<span class="section-subtitle">{selectedPeriodLabel}</span>
					</h2>
					<div class="voice-charts-grid">
						<ChartCard
							title="Voice Time"
							icon="⏱️"
							loading={isStatisticsLoading}
							stats={voiceActivityStats
								? [
										{
											icon: '⏱️',
											value:
												voiceActivityStats.totalHours >= 1
													? `${voiceActivityStats.totalHours.toFixed(1)}`
													: `${voiceActivityStats.totalMinutes}`,
											label: voiceActivityStats.useHours
												? 'Total Hours'
												: 'Total Minutes',
											color: '#FEE75C',
										},
									]
								: []}
						>
							<AreaChart
								data={voiceActivityData}
								color="#FEE75C"
								gradientId="voiceGradientServer"
								unit={voiceActivityStats?.useHours ? 'h' : 'm'}
								title="Voice Time"
								loading={isStatisticsLoading}
								emptyMessage="No voice activity data yet."
							/>
						</ChartCard>

						<ChartCard
							title="Peak Unique Voice Users"
							icon="👥"
							loading={isStatisticsLoading}
							stats={voiceActivityStats
								? [
										{
											icon: '👥',
											value: formatNumber(
												voiceActivityStats.uniqueUsers || 0
											),
											label: 'Peak Unique',
											color: '#5865F2',
										},
										{
											icon: '👤',
											value: voiceActivityStats.avgUniqueUsers || 0,
											label: 'Avg Unique',
											color: '#9B84EE',
										},
									]
								: []}
						>
							<AreaChart
								data={peakUsersData}
								color="#5865F2"
								gradientId="peakUsersGradient"
								unit=""
								title="Peak Unique Voice Users"
								loading={isStatisticsLoading}
								emptyMessage="No unique voice user data yet."
							/>
						</ChartCard>

						<ChartCard
							title="Peak Concurrent Voice Users"
							icon="📊"
							loading={isStatisticsLoading}
							stats={voiceActivityStats
								? [
										{
											icon: '📊',
											value: formatNumber(
												voiceActivityStats.peakConcurrent || 0
											),
											label: 'Peak Concurrent',
											color: '#57F287',
										},
										{
											icon: '📉',
											value: voiceActivityStats.avgConcurrent || 0,
											label: 'Avg Concurrent',
											color: '#2ECC71',
										},
									]
								: []}
						>
							<AreaChart
								data={peakConcurrentData}
								color="#57F287"
								gradientId="peakConcurrentGradient"
								unit=""
								title="Peak Concurrent Voice Users"
								loading={isStatisticsLoading}
								emptyMessage="No peak concurrent data yet."
							/>
						</ChartCard>
					</div>
				</section>

				<!-- Voice Activity Users Section -->
				<section class="performance-section">
					<h2 class="section-title">
						Voice Activity Leaders
						<span class="section-subtitle">{selectedPeriodLabel}</span>
						<button
							class="time-unit-toggle"
							onclick={cycleTimeUnit}
							title="Click to cycle between hours, minutes, and seconds"
						>
							{voiceTimeUnit === 'hours'
								? 'Hours'
								: voiceTimeUnit === 'minutes'
									? 'Minutes'
									: 'Seconds'}
						</button>
					</h2>
					<div class="performance-grid">
						<!-- Most Active Voice Users -->
						<div class="performance-card user-card">
							<div class="performance-header">
								<span class="performance-name">Most Active Voice Users</span>
								<label class="bot-toggle-sm">
									<input type="checkbox" bind:checked={showBotsInVoiceUsers} />
									<span class="toggle-switch-sm"></span>
									<span class="toggle-label-sm">🤖</span>
								</label>
							</div>
							<div class="user-list">
								{#if filteredVoiceUsers?.length > 0}
									{#each filteredVoiceUsers as user, i}
										{@const maxVal = getMaxValue(
											filteredVoiceUsers,
											'total_seconds'
										)}
										<div class="user-item">
											<span class="user-rank">#{i + 1}</span>
											<div class="user-info">
												<span class="user-name">
													{#if user.actor_id}
														<img
															src={getAvatarUrl(
																user.actor_id,
																user.actor_avatar,
																user.actor_discriminator,
																20
															)}
															alt="{user.actor_name || 'User'} avatar"
															class="inline-user-avatar"
															onerror={(e) => {
																(
																	e.target as HTMLElement
																).style.display = 'none';
															}}
														/>
													{/if}
													{user.actor_name || 'Unknown User'}
													{#if isBot(user)}<span class="bot-badge-sm"
															>🤖</span
														>{/if}
												</span>
											</div>
											<div class="user-bar-container">
												<div
													class="user-bar voice"
													style="width: {(user.total_seconds / maxVal) *
														100}%"
												></div>
											</div>
											<span class="user-count"
												>{formatTime(user.total_seconds)}</span
											>
										</div>
									{/each}
								{:else}
									<div class="user-empty">No voice activity data</div>
								{/if}
							</div>
							<span class="performance-last"
								>{getTimeUnitLabel('spent in voice chat')}</span
							>
						</div>

						<!-- Most Active Video Users -->
						<div class="performance-card user-card">
							<div class="performance-header">
								<span class="performance-name">Most Active Video Users</span>
								<label class="bot-toggle-sm">
									<input type="checkbox" bind:checked={showBotsInVideoUsers} />
									<span class="toggle-switch-sm"></span>
									<span class="toggle-label-sm">🤖</span>
								</label>
							</div>
							<div class="user-list">
								{#if filteredVideoUsers?.length > 0}
									{#each filteredVideoUsers as user, i}
										{@const maxVal = getMaxValue(
											filteredVideoUsers,
											'total_seconds'
										)}
										<div class="user-item">
											<span class="user-rank">#{i + 1}</span>
											<div class="user-info">
												<span class="user-name">
													{#if user.actor_id}
														<img
															src={getAvatarUrl(
																user.actor_id,
																user.actor_avatar,
																user.actor_discriminator,
																20
															)}
															alt="{user.actor_name || 'User'} avatar"
															class="inline-user-avatar"
															onerror={(e) => {
																(
																	e.target as HTMLElement
																).style.display = 'none';
															}}
														/>
													{/if}
													{user.actor_name || 'Unknown User'}
													{#if isBot(user)}<span class="bot-badge-sm"
															>🤖</span
														>{/if}
												</span>
											</div>
											<div class="user-bar-container">
												<div
													class="user-bar video"
													style="width: {(user.total_seconds / maxVal) *
														100}%"
												></div>
											</div>
											<span class="user-count"
												>{formatTime(user.total_seconds)}</span
											>
										</div>
									{/each}
								{:else}
									<div class="user-empty">No video activity data</div>
								{/if}
							</div>
							<span class="performance-last"
								>{getTimeUnitLabel('with camera on')}</span
							>
						</div>

						<!-- Most Active Screenshare Users -->
						<div class="performance-card user-card">
							<div class="performance-header">
								<span class="performance-name">Most Active Screenshare Users</span>
								<label class="bot-toggle-sm">
									<input
										type="checkbox"
										bind:checked={showBotsInScreenshareUsers}
									/>
									<span class="toggle-switch-sm"></span>
									<span class="toggle-label-sm">🤖</span>
								</label>
							</div>
							<div class="user-list">
								{#if filteredScreenshareUsers?.length > 0}
									{#each filteredScreenshareUsers as user, i}
										{@const maxVal = getMaxValue(
											filteredScreenshareUsers,
											'total_seconds'
										)}
										<div class="user-item">
											<span class="user-rank">#{i + 1}</span>
											<div class="user-info">
												<span class="user-name">
													{#if user.actor_id}
														<img
															src={getAvatarUrl(
																user.actor_id,
																user.actor_avatar,
																user.actor_discriminator,
																20
															)}
															alt="{user.actor_name || 'User'} avatar"
															class="inline-user-avatar"
															onerror={(e) => {
																(
																	e.target as HTMLElement
																).style.display = 'none';
															}}
														/>
													{/if}
													{user.actor_name || 'Unknown User'}
													{#if isBot(user)}<span class="bot-badge-sm"
															>🤖</span
														>{/if}
												</span>
											</div>
											<div class="user-bar-container">
												<div
													class="user-bar screenshare"
													style="width: {(user.total_seconds / maxVal) *
														100}%"
												></div>
											</div>
											<span class="user-count"
												>{formatTime(user.total_seconds)}</span
											>
										</div>
									{/each}
								{:else}
									<div class="user-empty">No screenshare activity data</div>
								{/if}
							</div>
							<span class="performance-last"
								>{getTimeUnitLabel('with screenshare active')}</span
							>
						</div>
					</div>
				</section>
			{/snippet}
		</VoiceLive>
	{:else if !hasStatisticsData && !isStatisticsLoading}
		<div class="empty-state">
			<div class="empty-icon" aria-hidden="true">
				<svg
					viewBox="0 0 24 24"
					width="30"
					height="30"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg
				>
			</div>
			<h2>No statistics yet</h2>
			<p>Charts fill in once there is activity in your server.</p>
		</div>
	{:else if tab === 'overview'}
		<!-- Overview Cards -->
		<section class="overview-section">
			<h2 class="section-title">Overview</h2>
			<div class="overview-grid">
				<!-- Members Card -->
				<div class="stat-card primary members" class:loading={isStatisticsLoading}>
					<div class="stat-card-header">
						<div class="stat-icon">{@render ico('members')}</div>
						<label
							class="bot-toggle-sm"
							title="Toggle to show only human members (excludes bots)"
						>
							<input type="checkbox" bind:checked={showBotsInMembers} />
							<span class="toggle-switch-sm"></span>
							<span class="toggle-label-sm">🤖</span>
						</label>
					</div>
					<div class="stat-content">
						<span class="stat-value"
							>{formatNumber(
								showBotsInMembers
									? liveData.memberStats?.changes?.current ||
											liveData.memberStats?.latest?.member_count ||
											0
									: (liveData.memberStats?.changes?.currentHuman ??
											liveData.memberStats?.latest?.human_count ??
											liveData.memberStats?.changes?.current ??
											liveData.memberStats?.latest?.member_count ??
											0)
							)}</span
						>
						<span class="stat-label"
							>{showBotsInMembers ? 'Server Members' : 'Human Members'}</span
						>
					</div>
					{#if memberSpark}
						<svg
							class="spark"
							viewBox="0 0 100 30"
							preserveAspectRatio="none"
							aria-hidden="true"
						>
							<path class="area" d={memberSpark.areaPath} />
							<path
								class="line"
								d={memberSpark.path}
								vector-effect="non-scaling-stroke"
							/>
						</svg>
					{/if}
					<div class="stat-breakdown">
						<div
							class="breakdown-item"
							class:positive={(showBotsInMembers
								? liveData.memberStats?.changes?.day
								: liveData.memberStats?.changes?.dayHuman) > 0}
							class:negative={(showBotsInMembers
								? liveData.memberStats?.changes?.day
								: liveData.memberStats?.changes?.dayHuman) < 0}
						>
							<span class="breakdown-value"
								>{formatChange(
									showBotsInMembers
										? liveData.memberStats?.changes?.day || 0
										: (liveData.memberStats?.changes?.dayHuman ??
												liveData.memberStats?.changes?.day ??
												0)
								)}</span
							>
							<span class="breakdown-label">Today</span>
						</div>
						<div
							class="breakdown-item"
							class:positive={(showBotsInMembers
								? liveData.memberStats?.changes?.week
								: liveData.memberStats?.changes?.weekHuman) > 0}
							class:negative={(showBotsInMembers
								? liveData.memberStats?.changes?.week
								: liveData.memberStats?.changes?.weekHuman) < 0}
						>
							<span class="breakdown-value"
								>{formatChange(
									showBotsInMembers
										? liveData.memberStats?.changes?.week || 0
										: (liveData.memberStats?.changes?.weekHuman ??
												liveData.memberStats?.changes?.week ??
												0)
								)}</span
							>
							<span class="breakdown-label">This Week</span>
						</div>
						<div
							class="breakdown-item"
							class:positive={(showBotsInMembers
								? liveData.memberStats?.changes?.month
								: liveData.memberStats?.changes?.monthHuman) > 0}
							class:negative={(showBotsInMembers
								? liveData.memberStats?.changes?.month
								: liveData.memberStats?.changes?.monthHuman) < 0}
						>
							<span class="breakdown-value"
								>{formatChange(
									showBotsInMembers
										? liveData.memberStats?.changes?.month || 0
										: (liveData.memberStats?.changes?.monthHuman ??
												liveData.memberStats?.changes?.month ??
												0)
								)}</span
							>
							<span class="breakdown-label">This Month</span>
						</div>
					</div>
				</div>

				<!-- Automations Card -->
				<div class="stat-card" class:loading={isStatisticsLoading}>
					<div class="stat-icon">{@render ico('automations')}</div>
					<div class="stat-content">
						<span class="stat-value">{formatNumber(statistics.automations.active)}</span
						>
						<span class="stat-label">Active Automations</span>
					</div>
					<div class="stat-breakdown">
						<div class="breakdown-item">
							<span class="breakdown-value"
								>{formatNumber(statistics.automations.total)}</span
							>
							<span class="breakdown-label">Total</span>
						</div>
						<div class="breakdown-item">
							<span class="breakdown-value"
								>{formatNumber(statistics.automations.totalExecutions)}</span
							>
							<span class="breakdown-label">Executions</span>
						</div>
						<div class="breakdown-item success">
							<span class="breakdown-value"
								>{getSuccessRate(
									statistics.automations.successfulExecutions,
									statistics.automations.totalExecutions
								)}%</span
							>
							<span class="breakdown-label">Success Rate</span>
						</div>
					</div>
				</div>

				<!-- Commands Card -->
				<div class="stat-card" class:loading={isStatisticsLoading}>
					<div class="stat-icon">{@render ico('commands')}</div>
					<div class="stat-content">
						<span class="stat-value">{formatNumber(statistics.commands.active)}</span>
						<span class="stat-label">Active Commands</span>
					</div>
					<div class="stat-breakdown">
						<div class="breakdown-item">
							<span class="breakdown-value"
								>{formatNumber(statistics.commands.total)}</span
							>
							<span class="breakdown-label">Total</span>
						</div>
						<div class="breakdown-item">
							<span class="breakdown-value"
								>{formatNumber(statistics.commands.totalUsage)}</span
							>
							<span class="breakdown-label">Total Uses</span>
						</div>
					</div>
				</div>

				<!-- Total Events Card -->
				<div class="stat-card" class:loading={isStatisticsLoading}>
					<div class="stat-card-header">
						<div class="stat-icon">{@render ico('events')}</div>
						<label class="bot-toggle-sm">
							<input type="checkbox" bind:checked={showBotsInTotalEvents} />
							<span class="toggle-switch-sm"></span>
							<span class="toggle-label-sm">🤖</span>
						</label>
					</div>
					<div class="stat-content">
						<span class="stat-value"
							>{formatNumber(
								showBotsInTotalEvents
									? statistics.events.total
									: statistics.events.totalNonBot
							)}</span
						>
						<span class="stat-label">Total Events</span>
					</div>
					{#if eventSpark}
						<svg
							class="spark"
							viewBox="0 0 100 30"
							preserveAspectRatio="none"
							aria-hidden="true"
						>
							<path class="area" d={eventSpark.areaPath} />
							<path
								class="line"
								d={eventSpark.path}
								vector-effect="non-scaling-stroke"
							/>
						</svg>
					{/if}
					<div class="stat-breakdown">
						<div class="breakdown-item">
							<span class="breakdown-value"
								>{formatNumber(
									showBotsInTotalEvents
										? statistics.events.today
										: statistics.events.todayNonBot
								)}</span
							>
							<span class="breakdown-label">Today</span>
						</div>
						<div class="breakdown-item">
							<span class="breakdown-value"
								>{formatNumber(
									showBotsInTotalEvents
										? statistics.events.thisWeek
										: statistics.events.thisWeekNonBot
								)}</span
							>
							<span class="breakdown-label">This Week</span>
						</div>
						<div class="breakdown-item">
							<span class="breakdown-value"
								>{formatNumber(
									showBotsInTotalEvents
										? statistics.events.thisMonth
										: statistics.events.thisMonthNonBot
								)}</span
							>
							<span class="breakdown-label">This Month</span>
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- Server Members Overview -->
		{#if liveData.memberStats?.latest}
			<section class="chart-section">
				<ChartCard
					title={showBotsInMemberChart ? 'Server Members' : 'Human Members'}
					subtitle={liveData.memberStats?.latest?.recorded_at
						? `Updated ${formatRelativeTime(liveData.memberStats.latest.recorded_at)}`
						: 'Current'}
					icon="👥"
					loading={isStatisticsLoading}
					stats={[
						{
							icon: '👤',
							value: formatNumber(
								showBotsInMemberChart
									? liveData.memberStats?.latest?.member_count || 0
									: (liveData.memberStats?.latest?.human_count ??
											liveData.memberStats?.latest?.member_count ??
											0)
							),
							label: showBotsInMemberChart ? 'Total Members' : 'Human Members',
							color: '#5865F2',
						},
					]}
				>
					{#snippet headerAction()}
						<label class="bot-toggle-sm" title="Toggle to include bots in member count">
							<input type="checkbox" bind:checked={showBotsInMemberChart} />
							<span class="toggle-switch-sm"></span>
							<span class="toggle-label-sm">🤖</span>
						</label>
					{/snippet}
					<AreaChart
						data={memberCountHistory}
						color="#5865F2"
						gradientId="memberCountGradient"
						title="Member Count"
						loading={isStatisticsLoading}
						emptyMessage="Member count history will appear as data is collected over time."
					/>
				</ChartCard>
			</section>
		{/if}

		<!-- Member Growth Chart Section -->
		<section class="chart-section">
			<ChartCard
				title="Member Growth"
				subtitle={selectedPeriodLabel}
				icon="📈"
				loading={isStatisticsLoading}
				stats={memberGrowthStats
					? [
							{
								icon: '➕',
								value: `+${formatNumber(memberGrowthStats.totalJoins)}`,
								label: 'Joined',
								color: '#22c55e',
							},
							{
								icon: '➖',
								value: `-${formatNumber(memberGrowthStats.totalLeaves)}`,
								label: 'Left',
								color: '#ef4444',
							},
							{
								icon: '📊',
								value: formatChange(memberGrowthStats.netChange),
								label: 'Net Change',
								color:
									memberGrowthStats.netChange > 0
										? '#22c55e'
										: memberGrowthStats.netChange < 0
											? '#ef4444'
											: undefined,
							},
						]
					: liveData.memberGrowth
						? [
								{
									icon: '➕',
									value: `+${formatNumber(liveData.memberGrowth.joins)}`,
									label: 'Joined',
									color: '#22c55e',
								},
								{
									icon: '➖',
									value: `-${formatNumber(liveData.memberGrowth.leaves)}`,
									label: 'Left',
									color: '#ef4444',
								},
								{
									icon: '📊',
									value: formatChange(liveData.memberGrowth.netChange),
									label: 'Net Change',
									color:
										liveData.memberGrowth.netChange > 0
											? '#22c55e'
											: liveData.memberGrowth.netChange < 0
												? '#ef4444'
												: undefined,
								},
							]
						: []}
			>
				<BarChart
					data={memberGrowthBarData}
					title="Member Growth"
					loading={isStatisticsLoading}
					emptyMessage="No member growth data yet. Stats are collected when members join or leave."
				/>
			</ChartCard>
		</section>

		<!-- Roles & Boosts -->
		<div class="server-info-grid">
			<ChartCard
				title="Roles"
				icon="🏷️"
				loading={isStatisticsLoading}
				stats={[
					{
						icon: '🏷️',
						value: formatNumber(
							roleBreakdown?.total || liveData.memberStats?.latest?.role_count || 0
						),
						label: 'Total Roles',
						color: '#EB459E',
					},
					{
						icon: '🎨',
						value: formatNumber(roleBreakdown?.custom || 0),
						label: 'Custom',
						color: '#5865F2',
					},
					{
						icon: '🤖',
						value: formatNumber(roleBreakdown?.managed || 0),
						label: 'Managed',
						color: '#9B84EE',
					},
				]}
			>
				{#if roleBreakdown}
					<div class="role-details">
						<div class="role-meta-row">
							<span
								class="role-meta-item"
								title="Displayed separately in the member list"
							>
								<span class="role-meta-icon">📌</span>
								<span class="role-meta-value">{roleBreakdown.hoisted}</span>
								<span class="role-meta-label">Hoisted</span>
							</span>
							<span class="role-meta-item" title="Can be @mentioned by anyone">
								<span class="role-meta-icon">📣</span>
								<span class="role-meta-value">{roleBreakdown.mentionable}</span>
								<span class="role-meta-label">Mentionable</span>
							</span>
							<span class="role-meta-item" title="Roles with a custom color">
								<span class="role-meta-icon">🎨</span>
								<span class="role-meta-value">{roleBreakdown.colored}</span>
								<span class="role-meta-label">Colored</span>
							</span>
						</div>
						{#if roleBreakdown.topHoisted.length > 0}
							<div class="role-list-section">
								<span class="role-list-label">Hoisted Roles</span>
								<div class="role-pills">
									{#each roleBreakdown.topHoisted as role}
										<span
											class="role-pill"
											style="border-color: {intToHex(
												role.color
											)}; color: {intToHex(role.color)}"
										>
											{#if role.unicode_emoji}
												<span class="role-pill-emoji"
													>{role.unicode_emoji}</span
												>
											{/if}
											{role.name}
										</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</ChartCard>
			{#if liveData.memberStats?.latest?.boost_count > 0}
				<ChartCard
					title="Server Boosts"
					icon="💎"
					loading={isStatisticsLoading}
					stats={[
						{
							icon: '💎',
							value: `${liveData.memberStats.latest.boost_count}`,
							label: 'Boosts',
							color: '#F47FFF',
						},
						{
							icon: '🏆',
							value: `Level ${liveData.memberStats.latest.boost_level}`,
							label: 'Boost Tier',
							color: '#F47FFF',
						},
					]}
				>
					{@const boostLevel = liveData.memberStats.latest.boost_level || 0}
					{@const meta = data.guildMetadata}
					{@const boostFeatures = [
						{
							name: 'Server Tag',
							unlockLevel: 0,
							icon: '🏷️',
							active: !!meta?.features?.includes('GUILD_TAGS'),
							detail: meta?.tag || null,
						},
						{
							name: 'Server Banner',
							unlockLevel: 1,
							icon: '🖼️',
							active: !!meta?.banner,
						},
						{
							name: 'Invite Splash',
							unlockLevel: 1,
							icon: '💦',
							active: !!meta?.splash,
						},
						{
							name: 'Animated Server Icon',
							unlockLevel: 1,
							icon: '✨',
							active: !!meta?.features?.includes('ANIMATED_ICON'),
						},
						{
							name: '128kbps Audio',
							unlockLevel: 1,
							icon: '🔊',
							active: boostLevel >= 1,
						},
						{
							name: 'Custom Stickers',
							unlockLevel: 1,
							icon: '🎨',
							active: boostLevel >= 1,
						},
						{
							name: '256kbps Audio',
							unlockLevel: 2,
							icon: '🔊',
							active: boostLevel >= 2,
						},
						{
							name: 'Server Banner (50MB)',
							unlockLevel: 2,
							icon: '📤',
							active: boostLevel >= 2,
						},
						{
							name: '384kbps Audio',
							unlockLevel: 3,
							icon: '🔊',
							active: boostLevel >= 3,
						},
						{
							name: 'Vanity URL',
							unlockLevel: 3,
							icon: '🔗',
							active: !!meta?.vanity_url_code,
						},
					]}
					<ul class="boost-features">
						{#each boostFeatures as feature}
							<li
								class="boost-feature"
								class:active={feature.active}
								class:locked={boostLevel < feature.unlockLevel}
							>
								<span class="feature-icon">{feature.icon}</span>
								<span class="feature-name">{feature.name}</span>
								{#if feature.detail}
									<span class="feature-detail">{feature.detail}</span>
								{:else if boostLevel < feature.unlockLevel}
									<span class="feature-badge locked"
										>Lvl {feature.unlockLevel}</span
									>
								{:else if feature.active}
									<span class="feature-badge active">✓</span>
								{:else}
									<span class="feature-badge inactive">Not set</span>
								{/if}
							</li>
						{/each}
					</ul>
				</ChartCard>
			{/if}
		</div>
	{:else if tab === 'activity'}
		<!-- Event Categories -->
		<section class="categories-section">
			<div class="section-header-row">
				<h2 class="section-title">Events by Category</h2>
				<label class="bot-toggle">
					<input type="checkbox" bind:checked={showBotsInCategories} />
					<span class="toggle-switch"></span>
					<span class="toggle-label">🤖 Bots</span>
				</label>
			</div>
			<div class="categories-grid">
				{#each filteredCategories() as cat}
					<div class="category-card">
						<div class="category-header">
							<span
								class="category-icon"
								style="background-color: {getCategoryColor(
									cat.category
								)}15; color: {getCategoryColor(cat.category)}"
							>
								{getCategoryIcon(cat.category)}
							</span>
							<span class="category-name">{cat.category}</span>
						</div>
						<div class="category-stats">
							<span class="category-count">{formatNumber(cat.display_count)}</span>
							<span class="category-percent"
								>{getCategoryPercentage(
									cat.display_count,
									filteredCategoryTotal
								)}%</span
							>
						</div>
						<div class="category-bar">
							<div
								class="category-bar-fill"
								style="width: {getCategoryPercentage(
									cat.display_count,
									filteredCategoryTotal
								)}%; background-color: {getCategoryColor(cat.category)}"
							></div>
						</div>
					</div>
				{/each}
			</div>
		</section>

		<!-- Activity Chart -->
		<section class="chart-section">
			<div class="section-header-row">
				<h2 class="section-title">
					Activity ({selectedPeriodLabel})
				</h2>
				<label class="bot-toggle">
					<input type="checkbox" bind:checked={showBotsInActivityChart} />
					<span class="toggle-switch"></span>
					<span class="toggle-label">🤖 Bots</span>
				</label>
			</div>
			<div class="chart-container">
				{#if dailyChartData.length > 0}
					<div class="bar-chart">
						{#each dailyChartData as day, i}
							<div
								class="bar-wrapper"
								title="{day.label}: {formatNumber(day.display_count)} events"
							>
								<div
									class="bar"
									style="height: {Math.max(day.percentage, 2)}%"
								></div>
								{#if i % 5 === 0 || i === dailyChartData.length - 1}
									<span class="bar-label">{day.label}</span>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="chart-empty">
						<span>No activity data available</span>
					</div>
				{/if}
			</div>
		</section>

		<!-- Activity Heatmap -->
		<section class="heatmap-section">
			<div class="section-header-row">
				<h2 class="section-title">
					Activity Heatmap ({selectedPeriodLabel})
				</h2>
				<label class="bot-toggle">
					<input type="checkbox" bind:checked={showBotsInHeatmap} />
					<span class="toggle-switch"></span>
					<span class="toggle-label">🤖 Bots</span>
				</label>
			</div>
			<div class="heatmap-container">
				<div class="heatmap-hours">
					{#each Array(24) as _, hour}
						{#if hour % 3 === 0}
							<span class="hour-label">{hour}:00</span>
						{/if}
					{/each}
				</div>
				<div class="heatmap-grid">
					{#each heatmapGrid as dayData, dayIndex}
						<div class="heatmap-row">
							<span class="day-label">{dayLabels[dayIndex]}</span>
							{#each dayData as intensity, hourIndex}
								<div
									class="heatmap-cell"
									style="opacity: {0.1 + intensity * 0.9}"
									title="{dayLabels[
										dayIndex
									]} {hourIndex}:00 - Activity: {Math.round(intensity * 100)}%"
								></div>
							{/each}
						</div>
					{/each}
				</div>
				<div class="heatmap-legend">
					<span>Less</span>
					<div class="legend-scale">
						<div class="legend-cell" style="opacity: 0.1"></div>
						<div class="legend-cell" style="opacity: 0.3"></div>
						<div class="legend-cell" style="opacity: 0.5"></div>
						<div class="legend-cell" style="opacity: 0.7"></div>
						<div class="legend-cell" style="opacity: 1"></div>
					</div>
					<span>More</span>
				</div>
			</div>
		</section>

		<div class="two-column-section">
			<!-- Top Channels -->
			<section class="list-section">
				<div class="section-header-row">
					<h2 class="section-title">Most Active Channels</h2>
					<label class="bot-toggle">
						<input
							type="checkbox"
							bind:checked={showBotsInChannels}
							onchange={() => (channelsPage = 0)}
						/>
						<span class="toggle-switch"></span>
						<span class="toggle-label">🤖 Bots</span>
					</label>
				</div>
				<div class="list-container">
					{#if filteredChannels?.length > 0}
						{#each filteredChannels as channel, i}
							{@const maxCount = getMaxValue(allFilteredChannels, 'display_count')}
							{@const rank = channelsPage * ITEMS_PER_PAGE + i + 1}
							<div class="list-item">
								<span class="list-rank">#{rank}</span>
								<div class="list-info">
									<span class="list-name"
										>#{channel.channel_name || 'Unknown'}</span
									>
									<span class="list-meta">{channel.event_types} event types</span>
								</div>
								<div class="list-bar-container">
									<div
										class="list-bar"
										style="width: {(channel.display_count / maxCount) * 100}%"
									></div>
								</div>
								<span class="list-count">{formatNumber(channel.display_count)}</span
								>
							</div>
						{/each}
					{:else}
						<div class="list-empty">No channel data available</div>
					{/if}
				</div>
				{#if channelsTotalPages > 1}
					<div class="list-pagination">
						<button
							class="pagination-btn"
							disabled={channelsPage === 0}
							onclick={() => channelsPage--}
						>
							←
						</button>
						<span class="pagination-info"
							>{channelsPage + 1} / {channelsTotalPages}</span
						>
						<button
							class="pagination-btn"
							disabled={channelsPage >= channelsTotalPages - 1}
							onclick={() => channelsPage++}
						>
							→
						</button>
					</div>
				{/if}
			</section>

			<!-- Server Boosters -->
			<section class="list-section">
				<div class="section-header-row">
					<h2 class="section-title">Server Boosters</h2>
				</div>
				<div class="list-container">
					{#if filteredTopBoosters?.length > 0}
						{#each filteredTopBoosters as booster, i}
							{@const maxDays = getMaxValue(allTopBoosters, 'boost_days')}
							{@const rank = boostersPage * ITEMS_PER_PAGE + i + 1}
							<div class="list-item">
								<span class="list-rank">#{rank}</span>
								<div class="list-info">
									<span class="list-name">
										{#if booster.user_id}
											<img
												src={getAvatarUrl(
													booster.user_id,
													booster.guild_avatar || booster.avatar,
													booster.discriminator,
													20
												)}
												alt="{booster.display_name || 'User'} avatar"
												class="inline-user-avatar"
												onerror={(e) => {
													(e.target as HTMLElement).style.display =
														'none';
												}}
											/>
										{/if}
										{booster.display_name}
									</span>
									<span class="list-meta"
										>Boosting {formatRelativeTime(booster.premium_since)}</span
									>
								</div>
								<div class="list-bar-container">
									<div
										class="list-bar"
										style="width: {(booster.boost_days / maxDays) *
											100}%; background: linear-gradient(90deg, #f59e0b, #f97316);"
									></div>
								</div>
								<span class="list-count">{formatNumber(booster.boost_days)}d</span>
							</div>
						{/each}
					{:else}
						<div class="list-empty">No active boosters found in member cache</div>
					{/if}
				</div>
				{#if boostersTotalPages > 1}
					<div class="list-pagination">
						<button
							class="pagination-btn"
							disabled={boostersPage === 0}
							onclick={() => boostersPage--}
						>
							←
						</button>
						<span class="pagination-info"
							>{boostersPage + 1} / {boostersTotalPages}</span
						>
						<button
							class="pagination-btn"
							disabled={boostersPage >= boostersTotalPages - 1}
							onclick={() => boostersPage++}
						>
							→
						</button>
					</div>
				{/if}
			</section>
		</div>
	{:else}
		<!-- Command Usage Section -->
		<section class="performance-section">
			<h2 class="section-title">Command Usage</h2>
			{#if statistics.commandUsage?.length > 0}
				<div class="performance-grid">
					{#each statistics.commandUsage as command}
						<div class="performance-card">
							<div class="performance-header">
								<span class="performance-name">/{command.name}</span>
								<span
									class="command-status"
									class:enabled={command.enabled}
									class:disabled={!command.enabled}
								>
									{command.enabled ? 'On' : 'Off'}
								</span>
							</div>
							<div class="performance-stats">
								<div class="perf-stat">
									<span class="perf-value">{formatNumber(command.use_count)}</span
									>
									<span class="perf-label">Total Uses</span>
								</div>
							</div>
							<span class="performance-last"
								>Last used: {formatRelativeTime(command.last_used_at)}</span
							>
							<a
								href="/admin/{data.serverId}/commands/{command.id}"
								class="btn btn-secondary btn-sm">Edit</a
							>
						</div>
					{/each}
				</div>
			{:else}
				<div class="empty-list">
					<span>No commands configured yet</span>
					<a href="/admin/{data.serverId}/commands/new" class="btn btn-primary btn-sm"
						>Create Command</a
					>
				</div>
			{/if}
		</section>

		<!-- Automation Performance -->
		<section class="performance-section">
			<h2 class="section-title">Automation Performance</h2>
			{#if statistics.automationPerformance?.length > 0}
				<div class="performance-grid">
					{#each statistics.automationPerformance as automation}
						{@const history = liveData.automationHistory?.[automation.id] || []}
						{@const sparklineData = buildSparkline(history)}
						<div class="performance-card">
							<div class="performance-header">
								<span class="performance-name">{automation.name}</span>
							</div>
							{#if sparklineData.path}
								<div class="sparkline-container">
									<svg
										viewBox="0 0 100 30"
										preserveAspectRatio="none"
										class="sparkline"
									>
										<defs>
											<linearGradient
												id="sparkline-gradient-{automation.id}"
												x1="0%"
												y1="0%"
												x2="0%"
												y2="100%"
											>
												<stop
													offset="0%"
													stop-color="var(--color-primary)"
													stop-opacity="0.3"
												/>
												<stop
													offset="100%"
													stop-color="var(--color-primary)"
													stop-opacity="0"
												/>
											</linearGradient>
										</defs>
										<path
											d={sparklineData.areaPath}
											fill="url(#sparkline-gradient-{automation.id})"
										/>
										<path
											d={sparklineData.path}
											fill="none"
											stroke="var(--color-primary)"
											stroke-width="1.5"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</div>
							{:else}
								<div class="sparkline-empty">No recent activity</div>
							{/if}
							<div class="performance-stats">
								<div class="perf-stat">
									<span class="perf-value"
										>{formatNumber(automation.log_count)}</span
									>
									<span class="perf-label">Executions</span>
								</div>
							</div>
							<span class="performance-last"
								>Last triggered: {formatRelativeTime(
									automation.last_triggered_at
								)}</span
							>
							<a
								href="/admin/{data.serverId}/automations/{automation.public_id ||
									automation.id}"
								class="btn btn-secondary btn-sm">Edit</a
							>
						</div>
					{/each}
				</div>
			{:else}
				<div class="empty-list">
					<span>No automations configured yet</span>
					<a href="/admin/{data.serverId}/automations/new" class="btn btn-primary btn-sm"
						>Create Automation</a
					>
				</div>
			{/if}
		</section>

		<!-- Recent Automation Executions -->
		<section class="executions-section">
			<h2 class="section-title">Recent Automation Executions</h2>
			{#if liveData.recentExecutions?.length > 0}
				<div class="executions-table">
					<div class="table-header">
						<span class="col-status">Status</span>
						<span class="col-automation">Automation</span>
						<span class="col-trigger">Trigger</span>
						<span class="col-time">Execution Time</span>
						<span class="col-when">When</span>
					</div>
					{#each liveData.recentExecutions as execution}
						<div class="table-row" class:error={!execution.success}>
							<span class="col-status">
								{#if execution.success}
									<span class="status-badge success">✓</span>
								{:else}
									<span class="status-badge error" title={execution.error_message}
										>✗</span
									>
								{/if}
							</span>
							<span class="col-automation">{execution.automation_name}</span>
							<span class="col-trigger">{execution.trigger_event}</span>
							<span class="col-time"
								>{execution.execution_time_ms
									? execution.execution_time_ms + 'ms'
									: 'N/A'}</span
							>
							<span class="col-when">{formatRelativeTime(execution.created_at)}</span>
						</div>
					{/each}
				</div>
			{:else}
				<div class="empty-list">
					<span>No recent automation executions</span>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.stats-page {
		width: 100%;
		max-width: 1320px;
		margin: 0 auto;
		padding: 1.25rem 1rem 3rem;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.45;
		}
		50% {
			opacity: 1;
		}
	}

	@media (min-width: 640px) {
		.stats-page {
			padding: 1.5rem 1.5rem 3.5rem;
		}
	}

	@media (min-width: 1024px) {
		.stats-page {
			padding: 1.75rem 2.5rem 4rem;
		}
	}

	/* Header */
	.sp-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.sp-back {
		font-size: 0.82rem;
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.sp-back:hover {
		color: var(--color-primary);
	}

	.sp-head h1 {
		margin: 0.2rem 0 0;
		font-size: clamp(1.6rem, 2.6vw, 2.15rem);
		font-weight: 750;
		letter-spacing: -0.02em;
		line-height: 1.1;
		color: var(--color-text);
	}

	.sp-sub {
		margin: 0.2rem 0 0;
		color: var(--color-text-muted);
		font-size: 0.95rem;
	}

	.sp-head-tools {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.sp-link {
		padding: 0.4rem 0.85rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 0.82rem;
		font-weight: 550;
		text-decoration: none;
	}

	.sp-link:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.sp-switch {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.8rem 0.35rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 0.82rem;
		font-weight: 550;
		cursor: pointer;
		user-select: none;
	}

	.sp-switch input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}

	.sp-switch-track {
		position: relative;
		width: 2rem;
		height: 1.15rem;
		border-radius: var(--radius-full);
		background: var(--color-surface-active);
		transition: background var(--transition-fast);
	}

	.sp-switch-track::after {
		content: '';
		position: absolute;
		top: 0.15rem;
		left: 0.15rem;
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 50%;
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		transition: transform var(--transition-fast);
	}

	.sp-switch input:checked + .sp-switch-track {
		background: var(--color-primary);
	}

	.sp-switch input:checked + .sp-switch-track::after {
		transform: translateX(0.85rem);
	}

	.sp-switch input:focus-visible + .sp-switch-track {
		box-shadow: var(--focus-ring);
	}

	/* Tabs and range: one sticky bar, so both stay in reach while scrolling a long tab. */
	.sp-bar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1rem;
		flex-wrap: wrap;
		margin-bottom: 1.5rem;
		background: var(--color-background);
		border-bottom: 1px solid var(--color-border);
	}

	.sp-tabs {
		display: flex;
		gap: 0.15rem;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.sp-tab {
		padding: 0.7rem 0.95rem;
		margin-bottom: -1px;
		border: 0;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--color-text-muted);
		font: inherit;
		font-size: 0.92rem;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.sp-tab:hover {
		color: var(--color-text);
	}

	.sp-tab.active {
		color: var(--color-text);
		border-bottom-color: var(--color-primary);
	}

	.sp-tab:focus-visible {
		outline: none;
		box-shadow: inset var(--focus-ring);
	}

	.sp-range {
		display: inline-flex;
		padding: 2px;
		margin: 0.35rem 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		background: var(--color-surface-elevated);
	}

	.sp-range-opt {
		padding: 0.25rem 0.7rem;
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		font-size: 0.8rem;
		font-weight: 600;
		text-decoration: none;
		font-variant-numeric: tabular-nums;
	}

	.sp-range-opt:hover {
		color: var(--color-text);
	}

	.sp-range-opt.active {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-sm);
	}

	/* Section Titles */
	.section-title {
		margin: 0 0 0.85rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.section-subtitle {
		font-size: 0.74rem;
		font-weight: 500;
		letter-spacing: 0.02em;
		text-transform: none;
		color: var(--color-text-light);
		margin-left: 0.15rem;
	}

	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: 1rem;
	}

	.empty-state h2 {
		margin: 0 0 0.5rem;
		color: var(--color-text);
	}

	.empty-state p {
		color: var(--color-text-muted);
		margin: 0;
	}

	/* Overview Section */
	.overview-section {
		margin-bottom: 2rem;
	}

	.overview-grid {
		display: grid;
		gap: 0.9rem;
		grid-template-columns: 1fr;
	}

	@media (min-width: 640px) {
		.overview-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (min-width: 1100px) {
		.overview-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.stat-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.1rem 1.25rem 1rem;
		position: relative;
		overflow: hidden;
		box-shadow: var(--shadow-sm);
		display: flex;
		flex-direction: column;
	}

	.stat-card.primary {
		border-color: var(--color-primary);
		background: linear-gradient(
			135deg,
			var(--color-surface) 0%,
			var(--color-primary-soft) 100%
		);
	}

	.stat-card.loading .stat-value,
	.stat-card.loading .breakdown-value {
		color: transparent;
		border-radius: 999px;
		background: linear-gradient(
			90deg,
			rgba(255, 255, 255, 0.05) 25%,
			rgba(255, 255, 255, 0.13) 37%,
			rgba(255, 255, 255, 0.05) 63%
		);
		background-size: 400% 100%;
		animation: statShimmer 1.5s ease-in-out infinite;
	}

	.stat-card.loading .stat-value {
		display: inline-block;
		min-width: 6.5rem;
		min-height: 2.1rem;
	}

	.stat-card.loading .breakdown-value {
		display: inline-block;
		min-width: 3.5rem;
		min-height: 1.1rem;
	}

	.stat-card.loading .bot-toggle-sm,
	.stat-card.loading .toggle-switch-sm,
	.stat-card.loading .toggle-label-sm {
		opacity: 0.35;
		pointer-events: none;
	}

	@keyframes statShimmer {
		0% {
			background-position: 100% 0;
		}
		100% {
			background-position: 0 0;
		}
	}

	.stat-card-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 0.7rem;
	}

	.stat-icon {
		display: grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		margin-bottom: 0.7rem;
		border-radius: 0.65rem;
		background: var(--color-primary-soft);
		color: var(--color-primary);
	}

	.stat-card-header .stat-icon {
		margin-bottom: 0;
	}

	.stat-card-header + .stat-content {
		margin-top: 0;
	}

	.stat-content {
		display: flex;
		flex-direction: column-reverse;
		margin-bottom: 0.4rem;
	}

	.stat-value {
		display: block;
		font-size: 2.1rem;
		font-weight: 750;
		letter-spacing: -0.02em;
		color: var(--color-text);
		line-height: 1.15;
		font-variant-numeric: tabular-nums;
	}

	.stat-label {
		color: var(--color-text-muted);
		font-size: 0.82rem;
		font-weight: 600;
	}

	.stat-breakdown {
		display: flex;
		gap: 1.25rem;
		margin-top: auto;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border-light);
	}

	.spark {
		display: block;
		width: 100%;
		height: 2rem;
		margin: 0.15rem 0 0.7rem;
		color: var(--color-primary);
	}

	.spark .area {
		fill: currentColor;
		opacity: 0.12;
	}

	.spark .line {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	.breakdown-item {
		display: flex;
		flex-direction: column;
	}

	.breakdown-value {
		font-weight: 600;
		color: var(--color-text);
	}

	.breakdown-item.success .breakdown-value {
		color: var(--color-success);
	}

	.breakdown-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* Categories Section */
	.categories-section {
		margin-bottom: 2rem;
	}

	.categories-grid {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
	}

	.category-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.875rem;
	}

	@media (min-width: 480px) {
		.category-card {
			padding: 1rem;
		}
	}

	.category-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.category-icon {
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
	}

	.category-name {
		font-weight: 500;
		text-transform: capitalize;
		color: var(--color-text);
		font-size: 0.9rem;
	}

	.category-stats {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.category-count {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text);
	}

	@media (min-width: 480px) {
		.category-count {
			font-size: 1.5rem;
		}
	}

	.category-percent {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.category-bar {
		height: 4px;
		background: var(--color-surface-elevated);
		border-radius: 2px;
		overflow: hidden;
	}

	.category-bar-fill {
		height: 100%;
		border-radius: 2px;
		transition: width var(--transition-normal);
	}

	/* Chart Section */
	.chart-section {
		margin-bottom: 2rem;
	}

	.server-info-grid {
		align-items: start;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1.5rem;
		margin-top: 1.5rem;
	}

	@media (max-width: 768px) {
		.server-info-grid {
			grid-template-columns: 1fr;
		}
	}

	.boost-features {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.boost-feature {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		border-radius: var(--radius-sm, 6px);
		font-size: 0.85rem;
		color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
		transition: opacity 0.15s;
	}

	.boost-feature.active {
		color: var(--color-text, #fff);
	}

	.boost-feature.locked {
		opacity: 0.4;
	}

	.feature-icon {
		font-size: 1rem;
		flex-shrink: 0;
		width: 1.25rem;
		text-align: center;
	}

	.feature-name {
		flex: 1;
		min-width: 0;
	}

	.feature-detail {
		font-size: 0.75rem;
		color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
		font-family: monospace;
	}

	.feature-badge {
		font-size: 0.65rem;
		padding: 0.1rem 0.4rem;
		border-radius: 3px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		flex-shrink: 0;
	}

	.feature-badge.active {
		background: rgba(87, 242, 135, 0.15);
		color: #57f287;
	}

	.feature-badge.locked {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text-muted, rgba(255, 255, 255, 0.35));
	}

	.feature-badge.inactive {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text-muted, rgba(255, 255, 255, 0.4));
		font-weight: 400;
	}

	/* Role details panel */
	.role-details {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.role-meta-row {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.role-meta-item {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: var(--color-text-muted, rgba(255, 255, 255, 0.6));
	}

	.role-meta-icon {
		font-size: 0.9rem;
	}

	.role-meta-value {
		font-weight: 600;
		color: var(--color-text, #fff);
	}

	.role-meta-label {
		opacity: 0.7;
	}

	.role-list-section {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.role-list-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted, rgba(255, 255, 255, 0.4));
		font-weight: 600;
	}

	.role-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.role-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 500;
		border: 1.5px solid;
		background: rgba(255, 255, 255, 0.04);
		line-height: 1.3;
	}

	.role-pill-emoji {
		font-size: 0.8rem;
	}

	.voice-charts-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}

	.voice-charts-grid > :global(:first-child) {
		grid-column: 1 / -1;
	}

	@media (max-width: 768px) {
		.voice-charts-grid {
			grid-template-columns: 1fr;
		}
	}

	.chart-container {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		min-height: 200px;
	}

	.bar-chart {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 150px;
	}

	.bar-wrapper {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		height: 100%;
		position: relative;
	}

	.bar {
		width: 100%;
		background: var(--color-primary);
		border-radius: 2px 2px 0 0;
		min-height: 2px;
		transition: height var(--transition-fast);
	}

	.bar-wrapper:hover .bar {
		background: var(--color-primary-hover);
	}

	.bar-label {
		position: absolute;
		bottom: -20px;
		font-size: 0.65rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.chart-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 150px;
		color: var(--color-text-muted);
	}

	/* Heatmap Section */
	.heatmap-section {
		margin-bottom: 2rem;
	}

	.heatmap-container {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		overflow-x: auto;
	}

	.heatmap-hours {
		display: flex;
		margin-left: 50px;
		margin-bottom: 0.5rem;
	}

	.hour-label {
		width: calc(100% / 8);
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.heatmap-grid {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.heatmap-row {
		display: flex;
		align-items: center;
		gap: 3px;
	}

	.day-label {
		width: 40px;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.heatmap-cell {
		flex: 1;
		height: 18px;
		background: var(--color-primary);
		border-radius: 2px;
		min-width: 12px;
		transition: transform var(--transition-fast);
	}

	.heatmap-cell:hover {
		transform: scale(1.2);
		z-index: 1;
	}

	.heatmap-legend {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.legend-scale {
		display: flex;
		gap: 2px;
	}

	.legend-cell {
		width: 14px;
		height: 14px;
		background: var(--color-primary);
		border-radius: 2px;
	}

	/* Two Column Layout */
	.two-column-section {
		align-items: start;
		display: grid;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	@media (min-width: 480px) {
		.two-column-section {
			gap: 1.5rem;
			margin-bottom: 2rem;
		}
	}

	@media (min-width: 768px) {
		.two-column-section {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	/* List Section */
	.list-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 0.875rem;
	}

	@media (min-width: 480px) {
		.list-section {
			padding: 1.25rem;
		}
	}

	.list-section .section-title {
		margin-bottom: 0.75rem;
	}

	.list-container {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	@media (min-width: 480px) {
		.list-container {
			gap: 0.5rem;
		}
	}

	.list-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
	}

	@media (min-width: 480px) {
		.list-item {
			gap: 0.75rem;
		}
	}

	.list-rank {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		width: 20px;
		flex-shrink: 0;
	}

	@media (min-width: 480px) {
		.list-rank {
			width: 24px;
		}
	}

	.list-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.list-name {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-weight: 500;
		color: var(--color-text);
		font-size: 0.8rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (min-width: 480px) {
		.list-name {
			font-size: 0.9rem;
		}
	}

	.list-meta {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	@media (min-width: 480px) {
		.list-meta {
			font-size: 0.75rem;
		}
	}

	.list-bar-container {
		display: none;
		width: 60px;
		height: 6px;
		background: var(--color-surface);
		border-radius: 3px;
		overflow: hidden;
	}

	@media (min-width: 480px) {
		.list-bar-container {
			display: block;
		}
	}

	.list-bar {
		height: 100%;
		background: var(--color-primary);
		border-radius: 3px;
		transition: width var(--transition-normal);
	}

	.list-count {
		font-weight: 600;
		color: var(--color-text);
		font-size: 0.8rem;
		min-width: 36px;
		text-align: right;
		flex-shrink: 0;
	}

	@media (min-width: 480px) {
		.list-count {
			font-size: 0.85rem;
			min-width: 40px;
		}
	}

	.list-empty {
		padding: 2rem;
		text-align: center;
		color: var(--color-text-muted);
	}

	/* Pagination */
	.list-pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
	}

	.pagination-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text);
		cursor: pointer;
		font-size: 0.85rem;
		transition: all var(--transition-fast);
	}

	.pagination-btn:hover:not(:disabled) {
		background: var(--color-primary-button);
		border-color: var(--color-primary-button);
		color: var(--color-primary-button-text);
	}

	.pagination-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.pagination-info {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		min-width: 50px;
		text-align: center;
	}

	/* Performance Section */
	.performance-section {
		margin-bottom: 2rem;
	}

	.performance-grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
	}

	@media (min-width: 640px) {
		.performance-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (min-width: 1024px) {
		.performance-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	.performance-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
	}

	.sparkline-container {
		height: 40px;
		margin-bottom: 0.75rem;
	}

	.sparkline {
		width: 100%;
		height: 100%;
	}

	.sparkline-empty {
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
	}

	.performance-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
	}

	.performance-name {
		font-weight: 600;
		color: var(--color-text);
	}

	.performance-stats {
		display: flex;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.perf-stat {
		display: flex;
		flex-direction: column;
	}

	.perf-value {
		font-weight: 600;
		color: var(--color-text);
	}

	.perf-label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.performance-last {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.empty-list {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 2rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		color: var(--color-text-muted);
	}

	/* Executions Section */
	.executions-section {
		margin-bottom: 2rem;
	}

	.executions-table {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.table-header,
	.table-row {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1.4fr) minmax(0, 1fr) 6.5rem 6rem;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		align-items: center;
	}

	.table-header {
		background: var(--color-surface-elevated);
		font-weight: 600;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.025em;
		white-space: nowrap;
	}

	.table-row {
		border-top: 1px solid var(--color-border);
		font-size: 0.9rem;
	}

	.table-row.error {
		background: var(--color-danger-soft);
	}

	.status-badge {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.status-badge.success {
		background: var(--color-success-soft);
		color: var(--color-success);
	}

	.status-badge.error {
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}

	.col-automation,
	.col-trigger {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.col-time,
	.col-when {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	/* Responsive table */
	@media (max-width: 640px) {
		.table-header {
			display: none;
		}

		.table-row {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}

		.table-row > span:not(.col-status) {
			padding-left: 2rem;
		}

		.col-status {
			position: absolute;
		}
	}

	/* Members Card */
	.stat-card.members {
		border: 1px solid var(--color-fixed-border-strong);
		background: linear-gradient(135deg, var(--color-surface) 0%, rgba(88, 101, 242, 0.1) 100%);
		color: var(--color-fixed-text-secondary);
	}

	.breakdown-item.positive .breakdown-value {
		color: var(--color-success);
	}

	.breakdown-item.positive .breakdown-value::before {
		content: '';
	}

	.breakdown-item.negative .breakdown-value {
		color: var(--color-danger);
	}

	/* Overview grid with 4 columns for members card */
	@media (min-width: 768px) {
		.overview-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (min-width: 1024px) {
		.overview-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	/* User Activity Cards (Voice, Video, Screenshare) */
	.performance-card.user-card {
		display: flex;
		flex-direction: column;
	}

	.user-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		min-height: 120px;
	}

	.user-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-sm);
	}

	.user-rank {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-muted);
		width: 20px;
		flex-shrink: 0;
	}

	.user-info {
		flex: 1;
		min-width: 0;
	}

	.user-name {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.inline-user-avatar {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	.user-bar-container {
		width: 40px;
		height: 4px;
		background: var(--color-surface);
		border-radius: 2px;
		overflow: hidden;
		flex-shrink: 0;
	}

	.user-bar {
		height: 100%;
		border-radius: 2px;
		transition: width var(--transition-normal);
	}

	.user-bar.voice {
		background: #fee75c;
	}

	.user-bar.video {
		background: #5865f2;
	}

	.user-bar.screenshare {
		background: #57f287;
	}

	.user-count {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text);
		min-width: 30px;
		text-align: right;
		flex-shrink: 0;
	}

	.user-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		min-height: 80px;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	/* Command Status Badge */
	.command-status {
		padding: 0.1rem 0.55rem;
		border-radius: var(--radius-full);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.command-status.enabled {
		background: var(--color-success-soft);
		color: var(--color-success);
	}

	.command-status.disabled {
		background: var(--color-surface-active);
		color: var(--color-text-muted);
	}

	/* Bot Toggle and Badge Styles */
	.section-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		flex-wrap: wrap;
	}

	@media (min-width: 480px) {
		.section-header-row {
			margin-bottom: 1rem;
		}
	}

	.section-header-row .section-title {
		margin: 0;
	}

	/* Toggle switch styles */
	.bot-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		user-select: none;
	}

	.bot-toggle input[type='checkbox'] {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-switch {
		position: relative;
		width: 36px;
		height: 20px;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		transition: all var(--transition-fast);
	}

	.toggle-switch::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		background: var(--color-text-muted);
		border-radius: 50%;
		transition: all var(--transition-fast);
	}

	.bot-toggle input:checked + .toggle-switch {
		background: var(--color-primary);
		border-color: var(--color-primary);
	}

	.bot-toggle input:checked + .toggle-switch::after {
		left: 18px;
		background: var(--color-background);
	}

	.toggle-label {
		font-size: 0.8rem;
		white-space: nowrap;
		opacity: 0.5;
		filter: grayscale(1);
		transition:
			opacity var(--transition-fast),
			filter var(--transition-fast);
	}

	.bot-toggle input:checked ~ .toggle-label {
		opacity: 1;
		filter: grayscale(0);
	}

	/* Smaller toggle for card headers */
	.bot-toggle-sm {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		cursor: pointer;
		font-size: 0.7rem;
		color: var(--color-text-muted);
		user-select: none;
	}

	.bot-toggle-sm input[type='checkbox'] {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-switch-sm {
		position: relative;
		width: 28px;
		height: 16px;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		transition: all var(--transition-fast);
	}

	.toggle-switch-sm::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 10px;
		height: 10px;
		background: var(--color-text-muted);
		border-radius: 50%;
		transition: all var(--transition-fast);
	}

	.bot-toggle-sm input:checked + .toggle-switch-sm {
		background: var(--color-primary);
		border-color: var(--color-primary);
	}

	.bot-toggle-sm input:checked + .toggle-switch-sm::after {
		left: 14px;
		background: var(--color-background);
	}

	.toggle-label-sm {
		font-size: 0.7rem;
		opacity: 0.5;
		filter: grayscale(1);
		transition:
			opacity var(--transition-fast),
			filter var(--transition-fast);
	}

	.bot-toggle-sm input:checked ~ .toggle-label-sm {
		opacity: 1;
		filter: grayscale(0);
	}

	.bot-badge-sm {
		font-size: 0.65rem;
		margin-left: 0.25rem;
	}

	/* Time unit toggle button */
	.time-unit-toggle {
		margin-left: auto;
		padding: 0.2rem 0.6rem;
		font-size: 0.7rem;
		font-weight: 500;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all var(--transition-fast);
		user-select: none;
	}

	.time-unit-toggle:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
		border-color: var(--color-primary);
	}
</style>
