<script>
	import { goto } from '$app/navigation';
	import { AreaChart, BarChart, ChartCard } from '$lib/components/charts';
	import { getDiscordCategoryMeta, getDiscordEventTypeMeta } from '$lib/discord/event-metadata.js';
	import { formatChartDate, getTimezone, parseUTCDate, getTodayLocal } from '$lib/timezone.js';
	import { getAvatarUrl } from '$lib/utils/avatar.js';
	import { onMount } from 'svelte';
	
	let { data } = $props();
	let hotloading = $state(false);

	const periodOptions = $derived(data.periodOptions || []);
	const selectedPeriod = $derived(data.selectedPeriod || '30d');
	const selectedPeriodLabel = $derived(data.selectedPeriodLabel || '30 Days');
	const LIVE_VOICE_POLL_MS = 15000;
	const liveUpdatesAuth = $derived(data.liveUpdatesAuth || null);

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

	function periodHref(period) {
		return `/admin/${data.serverId}/stats?period=${period}`;
	}

	async function refreshLiveVoiceSnapshot({ silent = false } = {}) {
		if (liveVoiceStreamConnected && silent) return;
		if (liveVoiceRefreshing) return;

		liveVoiceRefreshing = true;
		if (!silent) {
			liveVoiceRefreshError = '';
		}

		try {
			const response = await fetch(`/api/admin/${data.serverId}/live-voice`, {
				headers: {
					accept: 'application/json',
				},
			});

			if (!response.ok) {
				throw new Error(`Refresh failed with status ${response.status}`);
			}

			liveVoiceSnapshot = normalizeLiveVoiceSnapshot(await response.json());
			liveVoiceRefreshError = '';
		} catch (error) {
			console.warn('[Stats] Live voice refresh failed', error);
			if (!silent) {
				liveVoiceRefreshError = 'Unable to refresh live voice right now.';
			}
		} finally {
			liveVoiceRefreshing = false;
		}
	}

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const isHotloadRequest = params.get('hotload') === '1';

		if (!isHotloadRequest && data.loadMeta?.needsHotload) {
			hotloading = true;
			params.set('hotload', '1');
			goto(`${window.location.pathname}?${params.toString()}`, {
				replaceState: true,
				noScroll: true,
				keepFocus: true,
				invalidateAll: true,
			});
			return () => {};
		}

		if (isHotloadRequest && (data.loadMeta?.source === 'hotload' || data.loadMeta?.source === 'cache')) {
			params.delete('hotload');
			const nextQuery = params.toString();
			history.replaceState({}, '', nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname);
		}

		hotloading = false;

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
					console.warn('[Stats] Invalid live voice event payload', error);
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
	
	// Master toggle for all bot visibility
	let showBotsGlobal = $state(false);
	
	// Toggle states for showing bots in different sections
	let showBotsInActiveUsers = $state(false);
	let showBotsInVoiceUsers = $state(false);
	let showBotsInVideoUsers = $state(false);
	let showBotsInScreenshareUsers = $state(false);
	
	// Time unit toggle for voice activity cards: 'hours', 'minutes', 'seconds'
	let voiceTimeUnit = $state('hours');
	let showBotsInEventTypes = $state(false);
	let showBotsInChannels = $state(false);
	let showBotsInCategories = $state(false);
	let showBotsInActivityChart = $state(false);
	let showBotsInHeatmap = $state(false);
	let showBotsInTotalEvents = $state(false);
	let showBotsInMembers = $state(false);  // Default to false to show human members only
	
	// Pagination state for list sections
	const ITEMS_PER_PAGE = 5;
	let eventTypesPage = $state(0);
	let channelsPage = $state(0);
	let usersPage = $state(0);
	let boostersPage = $state(0);
	
	// Master toggle handler
	function toggleAllBots(value) {
		showBotsGlobal = value;
		showBotsInActiveUsers = value;
		showBotsInVoiceUsers = value;
		showBotsInVideoUsers = value;
		showBotsInScreenshareUsers = value;
		showBotsInEventTypes = value;
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
		return name.includes('bot') || 
			   name.includes('disboard') || 
			   name.includes('github') ||
			   name.includes('probot') ||
			   name.includes('mee6') ||
			   name.includes('dyno');
	}
	
	// Filtered data based on toggle states
	const allFilteredTopActors = $derived(
		(data.statistics?.topActors || [])
			.filter(actor => showBotsInActiveUsers || !isBot(actor))
	);
	
	const filteredTopActors = $derived(
		allFilteredTopActors.slice(usersPage * ITEMS_PER_PAGE, (usersPage + 1) * ITEMS_PER_PAGE)
	);
	
	const usersTotalPages = $derived(Math.ceil(allFilteredTopActors.length / ITEMS_PER_PAGE));

	function getBoostDays(premiumSince) {
		if (!premiumSince) return 0;
		const startedAt = parseUTCDate(premiumSince);
		if (!startedAt) return 0;
		const elapsedMs = Date.now() - startedAt.getTime();
		if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
		return Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
	}

	const allTopBoosters = $derived(
		(data.topBoosters || [])
			.filter((member) => !member.is_bot)
			.map((member) => ({
				...member,
				display_name: member.displayName || member.global_name || member.username || 'Unknown User',
				boost_days: getBoostDays(member.premium_since),
			}))
			.sort((a, b) => b.boost_days - a.boost_days)
	);

	const filteredTopBoosters = $derived(
		allTopBoosters.slice(boostersPage * ITEMS_PER_PAGE, (boostersPage + 1) * ITEMS_PER_PAGE)
	);

	const boostersTotalPages = $derived(Math.ceil(allTopBoosters.length / ITEMS_PER_PAGE));
	
	const filteredVoiceUsers = $derived(
		(data.topVoiceUsers || [])
			.filter(user => showBotsInVoiceUsers || !isBot(user))
			.slice(0, 5)
	);
	
	const filteredVideoUsers = $derived(
		(data.topVideoUsers || [])
			.filter(user => showBotsInVideoUsers || !isBot(user))
			.slice(0, 5)
	);
	
	const filteredScreenshareUsers = $derived(
		(data.topScreenshareUsers || [])
			.filter(user => showBotsInScreenshareUsers || !isBot(user))
			.slice(0, 5)
	);
	
	// Filtered event types based on toggle - use non_bot_count when hiding bots
	const allFilteredEventTypes = $derived(
		(data.statistics?.events?.byType || [])
			.map(et => ({
				...et,
				display_count: showBotsInEventTypes ? et.count : (et.non_bot_count || 0)
			}))
			.filter(et => et.display_count > 0)
			.sort((a, b) => b.display_count - a.display_count)
	);
	
	const filteredEventTypes = $derived(
		allFilteredEventTypes.slice(eventTypesPage * ITEMS_PER_PAGE, (eventTypesPage + 1) * ITEMS_PER_PAGE)
	);
	
	const eventTypesTotalPages = $derived(Math.ceil(allFilteredEventTypes.length / ITEMS_PER_PAGE));
	
	// Filtered channels based on toggle - use non_bot_count when hiding bots
	const allFilteredChannels = $derived(
		(data.statistics?.topChannels || [])
			.map(ch => ({
				...ch,
				display_count: showBotsInChannels ? ch.event_count : (ch.non_bot_count || 0)
			}))
			.filter(ch => ch.display_count > 0)
			.sort((a, b) => b.display_count - a.display_count)
	);
	
	const filteredChannels = $derived(
		allFilteredChannels.slice(channelsPage * ITEMS_PER_PAGE, (channelsPage + 1) * ITEMS_PER_PAGE)
	);
	
	const channelsTotalPages = $derived(Math.ceil(allFilteredChannels.length / ITEMS_PER_PAGE));
	
	// Filtered categories based on toggle
	const filteredCategories = $derived(() => {
		const categories = data.statistics?.events?.byCategory || {};
		const categoriesNonBot = data.statistics?.events?.byCategoryNonBot || {};
		
		return Object.entries(categories).map(([category, count]) => ({
			category,
			count,
			non_bot_count: categoriesNonBot[category] || 0,
			display_count: showBotsInCategories ? count : (categoriesNonBot[category] || 0)
		})).filter(c => c.display_count > 0);
	});
	
	// Filtered category total
	const filteredCategoryTotal = $derived(
		filteredCategories().reduce((sum, c) => sum + c.display_count, 0)
	);
	
	// Calculate percentages for category breakdown - use $derived for reactivity
	const categoryTotal = $derived(Object.values(data.statistics?.events?.byCategory || {}).reduce((a, b) => a + b, 0));
	
	function getCategoryPercentage(count, total) {
		if (!total) return 0;
		return ((count / total) * 100).toFixed(1);
	}
	
	// Format numbers with commas
	function formatNumber(num) {
		if (!num) return '0';
		return num.toLocaleString();
	}

	function getAvatarInitial(name) {
		if (!name) return '?';
		return name.trim().charAt(0).toUpperCase();
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
	
	// Calculate success rate
	function getSuccessRate(successful, total) {
		if (!total) return 100;
		return ((successful / total) * 100).toFixed(1);
	}
	
	// Get max value for bar charts
	function getMaxValue(items, key) {
		if (!items?.length) return 1;
		return Math.max(...items.map(i => i[key] || 0));
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
			const existing = history.find(h => h.date === dateStr);
			filledData.push({
				date: dateStr,
				value: existing ? existing.value : 0
			});
		}
		
		const values = filledData.map(d => d.value);
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
		const diffMs = now - date;
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
		const grid = Array(7).fill(null).map(() => Array(24).fill(0));
		const countKey = showBotsInHeatmap ? 'count' : 'non_bot_count';
		const maxCount = Math.max(...(data.heatmapData?.map(h => h[countKey] || 0) || [1]), 1);
		
		for (const item of data.heatmapData || []) {
			const value = item[countKey] || 0;
			grid[item.day_of_week][item.hour] = value / maxCount;
		}
		
		return grid;
	});
	
	const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	
	// Daily chart data - filtered by bot toggle
	const dailyChartData = $derived.by(() => {
		const data_array = data.statistics?.timeSeries?.daily || [];
		const countKey = showBotsInActivityChart ? 'count' : 'non_bot_count';
		const counts = data_array.map(d => d[countKey] || 0);
		const maxCount = Math.max(...counts, 1);
		return data_array.map(d => ({
			...d,
			display_count: d[countKey] || 0,
			percentage: ((d[countKey] || 0) / maxCount) * 100,
			label: formatChartDate(d.period, data.timezone)
		}));
	});
	
	// Format change with +/- sign
	function formatChange(value) {
		if (!value || value === 0) return '0';
		const sign = value > 0 ? '+' : '';
		return `${sign}${value.toLocaleString()}`;
	}
	
	// Member history chart data with computed values for SVG
	const memberChartData = $derived.by(() => {
		const history = data.memberHistory || [];
		const processed = history.map(d => ({
			...d,
			member_count: d.member_count || 0,
			label: formatChartDate(d.period || d.last_recorded, data.timezone)
		}));
		
		if (processed.length === 0) return { points: [], minValue: 0, maxValue: 0, range: 1 };
		
		const counts = processed.map(d => d.member_count);
		const minValue = Math.min(...counts);
		const maxValue = Math.max(...counts);
		const range = maxValue - minValue || 1;
		
		return {
			points: processed,
			minValue,
			maxValue,
			range,
			width: processed.length * 30,
		};
	});
	
	// Transform member growth chart data for bar chart component
	const memberGrowthBarData = $derived.by(() => {
		const points = data.memberGrowthChartData || [];
		if (!points || points.length === 0) return [];
		
		return points.map(p => ({
			date: p.date,
			label: formatChartDate(p.date, data.timezone),
			hasData: p.hasData !== false,
			values: [
				{ label: 'Joined', value: p.joins || 0, color: '#22c55e' },
				{ label: 'Left', value: p.leaves || 0, color: '#ef4444' },
			]
		}));
	});
	
	// Member growth summary stats
	const memberGrowthStats = $derived.by(() => {
		const points = data.memberGrowthChartData || [];
		if (!points || points.length === 0) return null;
		
		const totalJoins = points.reduce((sum, p) => sum + (p.joins || 0), 0);
		const totalLeaves = points.reduce((sum, p) => sum + (p.leaves || 0), 0);
		const netChange = totalJoins - totalLeaves;
		
		return { totalJoins, totalLeaves, netChange };
	});
	
	// Transform voice activity data for area chart component
	const voiceActivityData = $derived.by(() => {
		const points = data.voiceActivityChartData || [];
		if (!points || points.length === 0) return [];
		
		// Determine if we should use hours or minutes
		const totalMinutes = points.reduce((sum, p) => sum + (p.totalMinutes || 0), 0);
		const useHours = totalMinutes > 120;
		
		return points.map(p => ({
			date: p.date,
			label: formatChartDate(p.date, data.timezone),
			value: useHours ? (p.totalHours || 0) : (p.totalMinutes || 0),
			hasData: p.hasData !== false,
		}));
	});
	
	// Peak unique voice users chart data
	const peakUsersData = $derived.by(() => {
		const points = data.voiceActivityChartData || [];
		if (!points || points.length === 0) return [];
		
		return points.map(p => ({
			date: p.date,
			label: formatChartDate(p.date, data.timezone),
			value: p.uniqueUsers || 0,
			hasData: p.hasData !== false,
		}));
	});
	
	// Peak concurrent voice users chart data
	const peakConcurrentData = $derived.by(() => {
		const points = data.voiceActivityChartData || [];
		if (!points || points.length === 0) return [];
		
		return points.map(p => ({
			date: p.date,
			label: formatChartDate(p.date, data.timezone),
			value: p.peakConcurrent || 0,
			hasData: p.hasData !== false,
		}));
	});
	

	
	// Derive member count history from current count + aggregated net changes
	let showBotsInMemberChart = $state(false);
	
	const memberCountHistory = $derived.by(() => {
		const latest = data.memberStats?.latest;
		const currentCount = showBotsInMemberChart
			? (latest?.member_count || 0)
			: (latest?.human_count ?? latest?.member_count ?? 0);
		const growthData = data.memberGrowthChartData || [];
		const netChangeKey = showBotsInMemberChart ? 'netChange' : 'netChangeHuman';
		if (!currentCount || growthData.length === 0) {
			// Even with no growth data, show at least today's point from server_stats
			if (currentCount > 0) {
				const today = getTodayLocal(data.timezone);
				return [{
					date: today,
					label: formatChartDate(today, data.timezone),
					value: currentCount,
					hasData: true,
				}];
			}
			return [];
		}
		
		// Calculate cumulative net change from end to start
		// Then work backwards from current count
		const totalNetChange = growthData.reduce((sum, d) => sum + (d[netChangeKey] || 0), 0);
		let runningCount = currentCount - totalNetChange;
		
		const points = growthData.map(d => {
			runningCount += (d[netChangeKey] || 0);
			return {
				date: d.date,
				label: formatChartDate(d.date, data.timezone),
				value: runningCount,
				hasData: d.hasData !== false,
			};
		});
		
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
		const points = data.voiceActivityChartData || [];
		if (!points || points.length === 0) return null;
		
		const totalMinutes = points.reduce((sum, p) => sum + (p.totalMinutes || 0), 0);
		const totalHours = Math.round(totalMinutes / 60 * 10) / 10;
		const useHours = totalMinutes > 120;
		const uniqueUsers = points.reduce((max, p) => Math.max(max, p.uniqueUsers || 0), 0);
		const peakConcurrent = points.reduce((max, p) => Math.max(max, p.peakConcurrent || 0), 0);
		const activePoints = points.filter(p => (p.uniqueUsers || 0) > 0);
		const avgUniqueUsers = activePoints.length > 0
			? Math.round(activePoints.reduce((sum, p) => sum + (p.avgUniqueUsers || p.uniqueUsers || 0), 0) / activePoints.length * 10) / 10
			: 0;
		const activeConcurrentPoints = points.filter(p => (p.peakConcurrent || 0) > 0);
		const avgConcurrent = activeConcurrentPoints.length > 0
			? Math.round(activeConcurrentPoints.reduce((sum, p) => sum + (p.avgConcurrent || p.peakConcurrent || 0), 0) / activeConcurrentPoints.length * 10) / 10
			: 0;
		
		return { totalMinutes, totalHours, useHours, uniqueUsers, peakConcurrent, avgUniqueUsers, avgConcurrent };
	});

	// Role breakdown from cached roles data
	const roleBreakdown = $derived.by(() => {
		const roles = data.cachedRoles || [];
		if (roles.length === 0) return null;

		const managed = roles.filter(r => r.managed);
		const hoisted = roles.filter(r => r.hoist);
		const mentionable = roles.filter(r => r.mentionable);
		const colored = roles.filter(r => r.color && r.color !== 0);
		// @everyone is position 0 and name @everyone
		const custom = roles.filter(r => !r.managed && r.name !== '@everyone');
		
		// Top hoisted roles (displayed in member list sidebar), sorted by position desc
		const topHoisted = hoisted
			.sort((a, b) => b.position - a.position)
			.slice(0, 8);

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

<div class="stats-page">
	<!-- Header -->
	<header class="page-header">
		<div class="header-content">
			<a href="/admin/{data.serverId}" class="back-link">
				<span>←</span>
				Back to Dashboard
			</a>
			<div class="title-row">
				<div class="title-section">
					<h1>📊 Statistics</h1>
					<p class="subtitle">Comprehensive analytics for {data.guild?.name || 'your server'}</p>
				</div>
				<div class="header-actions">
					<a href="/admin/{data.serverId}/stats/vc-activity" class="btn btn-secondary btn-sm">🔴 VC Activity</a>
					<a href="/admin/{data.serverId}/logs" class="btn btn-secondary btn-sm">📜 Event Logs</a>
					<label class="master-bot-toggle">
						<input type="checkbox" bind:checked={showBotsGlobal} onchange={(e) => toggleAllBots(e.target.checked)} />
						<span class="toggle-switch"></span>
						<span class="toggle-label">🤖 Include Bots</span>
					</label>
				</div>
			</div>
			<div class="period-nav">
				<div class="period-nav-label">
					Range: {selectedPeriodLabel}
					<span class="period-retention-note">
						(Plan retention: {data.statsRetentionDays ? `${data.statsRetentionDays} days` : 'Unlimited'})
					</span>
				</div>
				<div class="period-pills">
					{#each periodOptions as option}
						<a
							href={periodHref(option.value)}
							class="period-pill"
							class:active={selectedPeriod === option.value}
						>
							{option.label}
						</a>
					{/each}
				</div>
			</div>
		</div>
	</header>

	{#if hotloading || data.loadMeta?.source === 'shell' || data.loadMeta?.isStale || data.loadMeta?.source === 'cache'}
		<div class="data-status" class:is-loading={hotloading || data.loadMeta?.source === 'shell'}>
			<span class="status-dot"></span>
			{#if hotloading || data.loadMeta?.source === 'shell'}
				<span>Hotloading full statistics now. Core layout is ready.</span>
			{:else if data.loadMeta?.isStale}
				<span>Showing cached statistics while fresh data is prepared.</span>
			{:else}
				<span>Showing cached statistics for instant load.</span>
			{/if}
		</div>
	{/if}

	{#if !data.statistics && !(hotloading || data.loadMeta?.source === 'shell')}
		<div class="empty-state">
			<div class="empty-icon">📊</div>
			<h2>No Statistics Available</h2>
			<p>Statistics will appear once there is activity in your server.</p>
		</div>
	{:else}
		<!-- Overview Cards -->
		<section class="overview-section">
			<h2 class="section-title">
				<span class="section-icon">📈</span>
				Overview
			</h2>
			<div class="overview-grid">
				<!-- Members Card -->
				<div class="stat-card primary members">
					<div class="stat-card-header">
						<div class="stat-icon">👥</div>
						<label class="bot-toggle-sm" title="Toggle to show only human members (excludes bots)">
							<input type="checkbox" bind:checked={showBotsInMembers} />
							<span class="toggle-switch-sm"></span>
							<span class="toggle-label-sm">🤖</span>
						</label>
					</div>
					<div class="stat-content">
						<span class="stat-value">{formatNumber(showBotsInMembers 
							? (data.memberStats?.changes?.current || data.memberStats?.latest?.member_count || 0) 
							: (data.memberStats?.changes?.currentHuman ?? data.memberStats?.latest?.human_count ?? data.memberStats?.changes?.current ?? data.memberStats?.latest?.member_count ?? 0))}</span>
						<span class="stat-label">{showBotsInMembers ? 'Server Members' : 'Human Members'}</span>
					</div>
					<div class="stat-breakdown">
						<div class="breakdown-item" class:positive={(showBotsInMembers ? data.memberStats?.changes?.day : data.memberStats?.changes?.dayHuman) > 0} class:negative={(showBotsInMembers ? data.memberStats?.changes?.day : data.memberStats?.changes?.dayHuman) < 0}>
							<span class="breakdown-value">{formatChange(showBotsInMembers ? (data.memberStats?.changes?.day || 0) : (data.memberStats?.changes?.dayHuman ?? data.memberStats?.changes?.day ?? 0))}</span>
							<span class="breakdown-label">Today</span>
						</div>
						<div class="breakdown-item" class:positive={(showBotsInMembers ? data.memberStats?.changes?.week : data.memberStats?.changes?.weekHuman) > 0} class:negative={(showBotsInMembers ? data.memberStats?.changes?.week : data.memberStats?.changes?.weekHuman) < 0}>
							<span class="breakdown-value">{formatChange(showBotsInMembers ? (data.memberStats?.changes?.week || 0) : (data.memberStats?.changes?.weekHuman ?? data.memberStats?.changes?.week ?? 0))}</span>
							<span class="breakdown-label">This Week</span>
						</div>
						<div class="breakdown-item" class:positive={(showBotsInMembers ? data.memberStats?.changes?.month : data.memberStats?.changes?.monthHuman) > 0} class:negative={(showBotsInMembers ? data.memberStats?.changes?.month : data.memberStats?.changes?.monthHuman) < 0}>
							<span class="breakdown-value">{formatChange(showBotsInMembers ? (data.memberStats?.changes?.month || 0) : (data.memberStats?.changes?.monthHuman ?? data.memberStats?.changes?.month ?? 0))}</span>
							<span class="breakdown-label">This Month</span>
						</div>
					</div>
				</div>
				
				<!-- Automations Card -->
				<div class="stat-card">
					<div class="stat-icon">⚡</div>
					<div class="stat-content">
						<span class="stat-value">{formatNumber(data.statistics.automations.active)}</span>
						<span class="stat-label">Active Automations</span>
					</div>
					<div class="stat-breakdown">
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(data.statistics.automations.total)}</span>
							<span class="breakdown-label">Total</span>
						</div>
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(data.statistics.automations.totalExecutions)}</span>
							<span class="breakdown-label">Executions</span>
						</div>
						<div class="breakdown-item success">
							<span class="breakdown-value">{getSuccessRate(data.statistics.automations.successfulExecutions, data.statistics.automations.totalExecutions)}%</span>
							<span class="breakdown-label">Success Rate</span>
						</div>
					</div>
				</div>
				
				<!-- Commands Card -->
				<div class="stat-card">
					<div class="stat-icon">💬</div>
					<div class="stat-content">
						<span class="stat-value">{formatNumber(data.statistics.commands.active)}</span>
						<span class="stat-label">Active Commands</span>
					</div>
					<div class="stat-breakdown">
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(data.statistics.commands.total)}</span>
							<span class="breakdown-label">Total</span>
						</div>
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(data.statistics.commands.totalUsage)}</span>
							<span class="breakdown-label">Total Uses</span>
						</div>
					</div>
				</div>
				
				<!-- Total Events Card -->
				<div class="stat-card">
					<div class="stat-card-header">
						<div class="stat-icon">📊</div>
						<label class="bot-toggle-sm">
							<input type="checkbox" bind:checked={showBotsInTotalEvents} />
							<span class="toggle-switch-sm"></span>
							<span class="toggle-label-sm">🤖</span>
						</label>
					</div>
					<div class="stat-content">
						<span class="stat-value">{formatNumber(showBotsInTotalEvents ? data.statistics.events.total : data.statistics.events.totalNonBot)}</span>
						<span class="stat-label">Total Events</span>
					</div>
					<div class="stat-breakdown">
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(showBotsInTotalEvents ? data.statistics.events.today : data.statistics.events.todayNonBot)}</span>
							<span class="breakdown-label">Today</span>
						</div>
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(showBotsInTotalEvents ? data.statistics.events.thisWeek : data.statistics.events.thisWeekNonBot)}</span>
							<span class="breakdown-label">This Week</span>
						</div>
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(showBotsInTotalEvents ? data.statistics.events.thisMonth : data.statistics.events.thisMonthNonBot)}</span>
							<span class="breakdown-label">This Month</span>
						</div>
					</div>
				</div>
			</div>
		</section>
		
		<!-- Server Members Overview -->
		{#if data.memberStats?.latest}
			<section class="chart-section">
				<ChartCard 
					title={showBotsInMemberChart ? 'Server Members' : 'Human Members'}
					subtitle={data.memberStats?.latest?.recorded_at ? `Updated ${formatRelativeTime(data.memberStats.latest.recorded_at)}` : 'Current'}
					icon="👥"
					stats={[
						{ icon: '👤', value: formatNumber(showBotsInMemberChart ? (data.memberStats?.latest?.member_count || 0) : (data.memberStats?.latest?.human_count ?? data.memberStats?.latest?.member_count ?? 0)), label: showBotsInMemberChart ? 'Total Members' : 'Human Members', color: '#5865F2' },
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
						emptyMessage="Member count history will appear as data is collected over time."
					/>
				</ChartCard>
			</section>
		{/if}
		
		<!-- Voice Activity Charts Section -->
		<section class="chart-section">
			<h2 class="section-title">
				<span class="section-icon">🎤</span>
				Voice Channel Activity
				<span class="section-subtitle">{selectedPeriodLabel}</span>
			</h2>
			<div class="voice-charts-grid">
				<ChartCard 
					title="Voice Time" 
					icon="⏱️"
					stats={voiceActivityStats ? [
						{ icon: '⏱️', value: voiceActivityStats.totalHours >= 1 ? `${voiceActivityStats.totalHours.toFixed(1)}` : `${voiceActivityStats.totalMinutes}`, label: voiceActivityStats.useHours ? 'Total Hours' : 'Total Minutes', color: '#FEE75C' },
					] : []}
				>
					<AreaChart 
						data={voiceActivityData}
						color="#FEE75C"
						gradientId="voiceGradientServer"
						unit={voiceActivityStats?.useHours ? 'h' : 'm'}
						title="Voice Time"
						emptyMessage="No voice activity data yet."
					/>
				</ChartCard>
				
				<ChartCard 
					title="Peak Unique Voice Users" 
					icon="👥"
					stats={voiceActivityStats ? [
						{ icon: '👥', value: formatNumber(voiceActivityStats.uniqueUsers || 0), label: 'Peak Unique', color: '#5865F2' },
						{ icon: '👤', value: voiceActivityStats.avgUniqueUsers || 0, label: 'Avg Unique', color: '#9B84EE' },
					] : []}
				>
					<AreaChart 
						data={peakUsersData}
						color="#5865F2"
						gradientId="peakUsersGradient"
						unit=""
						title="Peak Unique Voice Users"
						emptyMessage="No unique voice user data yet."
					/>
				</ChartCard>
				
				<ChartCard 
					title="Peak Concurrent Voice Users" 
					icon="📊"
					stats={voiceActivityStats ? [
						{ icon: '📊', value: formatNumber(voiceActivityStats.peakConcurrent || 0), label: 'Peak Concurrent', color: '#57F287' },
						{ icon: '📉', value: voiceActivityStats.avgConcurrent || 0, label: 'Avg Concurrent', color: '#2ECC71' },
					] : []}
				>
					<AreaChart 
						data={peakConcurrentData}
						color="#57F287"
						gradientId="peakConcurrentGradient"
						unit=""
						title="Peak Concurrent Voice Users"
						emptyMessage="No peak concurrent data yet."
					/>
				</ChartCard>
			</div>
		</section>

		<!-- Member Growth Chart Section -->
		<section class="chart-section">
			<ChartCard 
				title="Member Growth" 
				subtitle={selectedPeriodLabel}
				icon="📈"
				stats={memberGrowthStats ? [
					{ icon: '➕', value: `+${formatNumber(memberGrowthStats.totalJoins)}`, label: 'Joined', color: '#22c55e' },
					{ icon: '➖', value: `-${formatNumber(memberGrowthStats.totalLeaves)}`, label: 'Left', color: '#ef4444' },
					{ icon: '📊', value: formatChange(memberGrowthStats.netChange), label: 'Net Change', color: memberGrowthStats.netChange > 0 ? '#22c55e' : memberGrowthStats.netChange < 0 ? '#ef4444' : undefined },
				] : (data.memberGrowth ? [
					{ icon: '➕', value: `+${formatNumber(data.memberGrowth.joins)}`, label: 'Joined', color: '#22c55e' },
					{ icon: '➖', value: `-${formatNumber(data.memberGrowth.leaves)}`, label: 'Left', color: '#ef4444' },
					{ icon: '📊', value: formatChange(data.memberGrowth.netChange), label: 'Net Change', color: data.memberGrowth.netChange > 0 ? '#22c55e' : data.memberGrowth.netChange < 0 ? '#ef4444' : undefined },
				] : [])}
			>
				<BarChart 
					data={memberGrowthBarData}
					title="Member Growth"
					emptyMessage="No member growth data yet. Stats are collected when members join or leave."
				/>
			</ChartCard>
		</section>
		
		<!-- Roles & Boosts -->
		<div class="server-info-grid">
			<ChartCard
				title="Roles"
				icon="🏷️"
				stats={[
					{ icon: '🏷️', value: formatNumber(roleBreakdown?.total || data.memberStats?.latest?.role_count || 0), label: 'Total Roles', color: '#EB459E' },
					{ icon: '🎨', value: formatNumber(roleBreakdown?.custom || 0), label: 'Custom', color: '#5865F2' },
					{ icon: '🤖', value: formatNumber(roleBreakdown?.managed || 0), label: 'Managed', color: '#9B84EE' },
				]}
			>
				{#if roleBreakdown}
					<div class="role-details">
						<div class="role-meta-row">
							<span class="role-meta-item" title="Displayed separately in the member list">
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
										<span class="role-pill" style="border-color: {intToHex(role.color)}; color: {intToHex(role.color)}">
											{#if role.unicode_emoji}
												<span class="role-pill-emoji">{role.unicode_emoji}</span>
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
			{#if data.memberStats?.latest?.boost_count > 0}
				<ChartCard
					title="Server Boosts"
					icon="💎"
					stats={[
						{ icon: '💎', value: `${data.memberStats.latest.boost_count}`, label: 'Boosts', color: '#F47FFF' },
						{ icon: '🏆', value: `Level ${data.memberStats.latest.boost_level}`, label: 'Boost Tier', color: '#F47FFF' },
					]}
				>
					{@const boostLevel = data.memberStats.latest.boost_level || 0}
					{@const meta = data.guildMetadata}
					{@const boostFeatures = [
						{ name: 'Server Tag', unlockLevel: 0, icon: '🏷️', active: !!(meta?.features?.includes('GUILD_TAGS')), detail: meta?.tag || null },
						{ name: 'Server Banner', unlockLevel: 1, icon: '🖼️', active: !!(meta?.banner) },
						{ name: 'Invite Splash', unlockLevel: 1, icon: '💦', active: !!(meta?.splash) },
						{ name: 'Animated Server Icon', unlockLevel: 1, icon: '✨', active: !!(meta?.features?.includes('ANIMATED_ICON')) },
						{ name: '128kbps Audio', unlockLevel: 1, icon: '🔊', active: boostLevel >= 1 },
						{ name: 'Custom Stickers', unlockLevel: 1, icon: '🎨', active: boostLevel >= 1 },
						{ name: '256kbps Audio', unlockLevel: 2, icon: '🔊', active: boostLevel >= 2 },
						{ name: 'Server Banner (50MB)', unlockLevel: 2, icon: '📤', active: boostLevel >= 2 },
						{ name: '384kbps Audio', unlockLevel: 3, icon: '🔊', active: boostLevel >= 3 },
						{ name: 'Vanity URL', unlockLevel: 3, icon: '🔗', active: !!(meta?.vanity_url_code) },
					]}
					<ul class="boost-features">
						{#each boostFeatures as feature}
							<li class="boost-feature" class:active={feature.active} class:locked={boostLevel < feature.unlockLevel}>
								<span class="feature-icon">{feature.icon}</span>
								<span class="feature-name">{feature.name}</span>
								{#if feature.detail}
									<span class="feature-detail">{feature.detail}</span>
								{:else if boostLevel < feature.unlockLevel}
									<span class="feature-badge locked">Lvl {feature.unlockLevel}</span>
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
		
		<!-- Event Categories -->
		<section class="categories-section">
			<div class="section-header-row">
				<h2 class="section-title">
					<span class="section-icon">📁</span>
					Events by Category
				</h2>
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
							<span class="category-icon" style="background-color: {getCategoryColor(cat.category)}15; color: {getCategoryColor(cat.category)}">
								{getCategoryIcon(cat.category)}
							</span>
							<span class="category-name">{cat.category}</span>
						</div>
						<div class="category-stats">
							<span class="category-count">{formatNumber(cat.display_count)}</span>
							<span class="category-percent">{getCategoryPercentage(cat.display_count, filteredCategoryTotal)}%</span>
						</div>
						<div class="category-bar">
							<div 
								class="category-bar-fill" 
								style="width: {getCategoryPercentage(cat.display_count, filteredCategoryTotal)}%; background-color: {getCategoryColor(cat.category)}"
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
					<span class="section-icon">📈</span>
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
							<div class="bar-wrapper" title="{day.label}: {formatNumber(day.display_count)} events">
								<div class="bar" style="height: {Math.max(day.percentage, 2)}%"></div>
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
					<span class="section-icon">🗓️</span>
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
									style="opacity: {0.1 + (intensity * 0.9)}"
									title="{dayLabels[dayIndex]} {hourIndex}:00 - Activity: {Math.round(intensity * 100)}%"
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
			<!-- Top Event Types -->
			<section class="list-section">
				<div class="section-header-row">
					<h2 class="section-title">
						<span class="section-icon">🏆</span>
						Top Event Types
					</h2>
					<label class="bot-toggle">
						<input type="checkbox" bind:checked={showBotsInEventTypes} onchange={() => eventTypesPage = 0} />
						<span class="toggle-switch"></span>
						<span class="toggle-label">🤖 Bots</span>
					</label>
				</div>
				<div class="list-container">
					{#if filteredEventTypes?.length > 0}
						{#each filteredEventTypes as eventType, i}
							{@const maxCount = getMaxValue(allFilteredEventTypes, 'display_count')}
							{@const rank = eventTypesPage * ITEMS_PER_PAGE + i + 1}
							{@const eventMeta = getDiscordEventTypeMeta(eventType.event_type, { fallbackCategory: eventType.event_category })}
							<div class="list-item">
								<span class="list-rank">#{rank}</span>
								<div class="list-info">
									<span class="list-name">{eventMeta.icon} {eventMeta.description}</span>
									<span class="list-category" style="color: {getCategoryColor(eventType.event_category)}">
										{getCategoryIcon(eventType.event_category)} {eventType.event_category}
									</span>
								</div>
								<div class="list-bar-container">
									<div 
										class="list-bar" 
										style="width: {(eventType.display_count / maxCount) * 100}%; background-color: {getCategoryColor(eventType.event_category)}"
									></div>
								</div>
								<span class="list-count">{formatNumber(eventType.display_count)}</span>
							</div>
						{/each}
					{:else}
						<div class="list-empty">No event data available</div>
					{/if}
				</div>
				{#if eventTypesTotalPages > 1}
					<div class="list-pagination">
						<button 
							class="pagination-btn" 
							disabled={eventTypesPage === 0}
							onclick={() => eventTypesPage--}
						>
							←
						</button>
						<span class="pagination-info">{eventTypesPage + 1} / {eventTypesTotalPages}</span>
						<button 
							class="pagination-btn" 
							disabled={eventTypesPage >= eventTypesTotalPages - 1}
							onclick={() => eventTypesPage++}
						>
							→
						</button>
					</div>
				{/if}
			</section>
			
			<!-- Top Channels -->
			<section class="list-section">
				<div class="section-header-row">
					<h2 class="section-title">
						<span class="section-icon">📢</span>
						Most Active Channels
					</h2>
					<label class="bot-toggle">
						<input type="checkbox" bind:checked={showBotsInChannels} onchange={() => channelsPage = 0} />
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
									<span class="list-name">#{channel.channel_name || 'Unknown'}</span>
									<span class="list-meta">{channel.event_types} event types</span>
								</div>
								<div class="list-bar-container">
									<div 
										class="list-bar" 
										style="width: {(channel.display_count / maxCount) * 100}%"
									></div>
								</div>
								<span class="list-count">{formatNumber(channel.display_count)}</span>
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
						<span class="pagination-info">{channelsPage + 1} / {channelsTotalPages}</span>
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
		</div>
		
		<div class="two-column-section">
			<!-- Top Users -->
			<section class="list-section">
				<div class="section-header-row">
					<h2 class="section-title">
						<span class="section-icon">👤</span>
						Most Active Users
					</h2>
					<label class="bot-toggle">
						<input type="checkbox" bind:checked={showBotsInActiveUsers} onchange={() => usersPage = 0} />
						<span class="toggle-switch"></span>
						<span class="toggle-label">🤖 Bots</span>
					</label>
				</div>
				<div class="list-container">
					{#if filteredTopActors?.length > 0}
						{#each filteredTopActors as actor, i}
							{@const maxCount = getMaxValue(allFilteredTopActors, 'event_count')}
							{@const rank = usersPage * ITEMS_PER_PAGE + i + 1}
							<div class="list-item">
								<span class="list-rank">#{rank}</span>
								<div class="list-info">
									<span class="list-name">
										{#if actor.actor_id}
											<img
												src={getAvatarUrl(actor.actor_id, actor.actor_avatar, actor.actor_discriminator, 20)}
												alt="{actor.actor_name || 'User'} avatar"
												class="inline-user-avatar"
												onerror={(e) => { e.target.style.display = 'none'; }}
											/>
										{/if}
										{actor.actor_name || 'Unknown User'}
										{#if isBot(actor)}<span class="bot-badge">🤖</span>{/if}
									</span>
									<span class="list-meta">{actor.event_types} event types</span>
								</div>
								<div class="list-bar-container">
									<div 
										class="list-bar" 
										style="width: {(actor.event_count / maxCount) * 100}%"
									></div>
								</div>
								<span class="list-count">{formatNumber(actor.event_count)}</span>
							</div>
						{/each}
					{:else}
						<div class="list-empty">No user data available</div>
					{/if}
				</div>
				{#if usersTotalPages > 1}
					<div class="list-pagination">
						<button 
							class="pagination-btn" 
							disabled={usersPage === 0}
							onclick={() => usersPage--}
						>
							←
						</button>
						<span class="pagination-info">{usersPage + 1} / {usersTotalPages}</span>
						<button 
							class="pagination-btn" 
							disabled={usersPage >= usersTotalPages - 1}
							onclick={() => usersPage++}
						>
							→
						</button>
					</div>
				{/if}
			</section>

			<!-- Server Boosters -->
			<section class="list-section">
				<div class="section-header-row">
					<h2 class="section-title">
						<span class="section-icon">🚀</span>
						Server Boosters
					</h2>
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
												src={getAvatarUrl(booster.user_id, booster.guild_avatar || booster.avatar, booster.discriminator, 20)}
												alt="{booster.display_name || 'User'} avatar"
												class="inline-user-avatar"
												onerror={(e) => { e.target.style.display = 'none'; }}
											/>
										{/if}
										{booster.display_name}
									</span>
									<span class="list-meta">Boosting {formatRelativeTime(booster.premium_since)}</span>
								</div>
								<div class="list-bar-container">
									<div
										class="list-bar"
										style="width: {(booster.boost_days / maxDays) * 100}%; background: linear-gradient(90deg, #f59e0b, #f97316);"
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
						<span class="pagination-info">{boostersPage + 1} / {boostersTotalPages}</span>
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
		
		<!-- Voice Activity Users Section -->
		<section class="performance-section">
			<h2 class="section-title">
				<span class="section-icon">🎙️</span>
				Voice Activity Leaders
				<span class="section-subtitle">{selectedPeriodLabel}</span>
				<button class="time-unit-toggle" onclick={cycleTimeUnit} title="Click to cycle between hours, minutes, and seconds">
					{voiceTimeUnit === 'hours' ? '🕐 hrs' : voiceTimeUnit === 'minutes' ? '⏱️ min' : '⏲️ sec'}
				</button>
			</h2>
			<div class="performance-grid">
				<!-- Most Active Voice Users -->
				<div class="performance-card user-card">
					<div class="performance-header">
						<span class="performance-name">🎤 Most Active Voice Users</span>
						<label class="bot-toggle-sm">
							<input type="checkbox" bind:checked={showBotsInVoiceUsers} />
							<span class="toggle-switch-sm"></span>
							<span class="toggle-label-sm">🤖</span>
						</label>
					</div>
					<div class="user-list">
						{#if filteredVoiceUsers?.length > 0}
							{#each filteredVoiceUsers as user, i}
								{@const maxVal = getMaxValue(filteredVoiceUsers, 'total_seconds')}
								<div class="user-item">
									<span class="user-rank">#{i + 1}</span>
									<div class="user-info">
										<span class="user-name">
											{#if user.actor_id}
												<img
													src={getAvatarUrl(user.actor_id, user.actor_avatar, user.actor_discriminator, 20)}
													alt="{user.actor_name || 'User'} avatar"
													class="inline-user-avatar"
													onerror={(e) => { e.target.style.display = 'none'; }}
												/>
											{/if}
											{user.actor_name || 'Unknown User'}
											{#if isBot(user)}<span class="bot-badge-sm">🤖</span>{/if}
										</span>
									</div>
									<div class="user-bar-container">
										<div
											class="user-bar voice"
											style="width: {(user.total_seconds / maxVal) * 100}%"
										></div>
									</div>
									<span class="user-count">{formatTime(user.total_seconds)}</span>
								</div>
							{/each}
						{:else}
							<div class="user-empty">No voice activity data</div>
						{/if}
					</div>
					<span class="performance-last">{getTimeUnitLabel('spent in voice chat')}</span>
				</div>
				
				<!-- Most Active Video Users -->
				<div class="performance-card user-card">
					<div class="performance-header">
						<span class="performance-name">📹 Most Active Video Users</span>
						<label class="bot-toggle-sm">
							<input type="checkbox" bind:checked={showBotsInVideoUsers} />
							<span class="toggle-switch-sm"></span>
							<span class="toggle-label-sm">🤖</span>
						</label>
					</div>
					<div class="user-list">
						{#if filteredVideoUsers?.length > 0}
							{#each filteredVideoUsers as user, i}
								{@const maxVal = getMaxValue(filteredVideoUsers, 'total_seconds')}
								<div class="user-item">
									<span class="user-rank">#{i + 1}</span>
									<div class="user-info">
										<span class="user-name">
											{#if user.actor_id}
												<img
													src={getAvatarUrl(user.actor_id, user.actor_avatar, user.actor_discriminator, 20)}
													alt="{user.actor_name || 'User'} avatar"
													class="inline-user-avatar"
													onerror={(e) => { e.target.style.display = 'none'; }}
												/>
											{/if}
											{user.actor_name || 'Unknown User'}
											{#if isBot(user)}<span class="bot-badge-sm">🤖</span>{/if}
										</span>
									</div>
									<div class="user-bar-container">
										<div
											class="user-bar video"
											style="width: {(user.total_seconds / maxVal) * 100}%"
										></div>
									</div>
									<span class="user-count">{formatTime(user.total_seconds)}</span>
								</div>
							{/each}
						{:else}
							<div class="user-empty">No video activity data</div>
						{/if}
					</div>
					<span class="performance-last">{getTimeUnitLabel('with camera on')}</span>
				</div>
				
				<!-- Most Active Screenshare Users -->
				<div class="performance-card user-card">
					<div class="performance-header">
						<span class="performance-name">🖥️ Most Active Screenshare Users</span>
						<label class="bot-toggle-sm">
							<input type="checkbox" bind:checked={showBotsInScreenshareUsers} />
							<span class="toggle-switch-sm"></span>
							<span class="toggle-label-sm">🤖</span>
						</label>
					</div>
					<div class="user-list">
						{#if filteredScreenshareUsers?.length > 0}
							{#each filteredScreenshareUsers as user, i}
								{@const maxVal = getMaxValue(filteredScreenshareUsers, 'total_seconds')}
								<div class="user-item">
									<span class="user-rank">#{i + 1}</span>
									<div class="user-info">
										<span class="user-name">
											{#if user.actor_id}
												<img
													src={getAvatarUrl(user.actor_id, user.actor_avatar, user.actor_discriminator, 20)}
													alt="{user.actor_name || 'User'} avatar"
													class="inline-user-avatar"
													onerror={(e) => { e.target.style.display = 'none'; }}
												/>
											{/if}
											{user.actor_name || 'Unknown User'}
											{#if isBot(user)}<span class="bot-badge-sm">🤖</span>{/if}
										</span>
									</div>
									<div class="user-bar-container">
										<div 
											class="user-bar screenshare" 
											style="width: {(user.total_seconds / maxVal) * 100}%"
										></div>
									</div>
									<span class="user-count">{formatTime(user.total_seconds)}</span>
								</div>
							{/each}
						{:else}
							<div class="user-empty">No screenshare activity data</div>
						{/if}
					</div>
					<span class="performance-last">{getTimeUnitLabel('with screenshare active')}</span>
				</div>
			</div>
		</section>
		
		<!-- Command Usage Section -->
		<section class="performance-section">
			<h2 class="section-title">
				<span class="section-icon">💬</span>
				Command Usage
			</h2>
			{#if data.statistics.commandUsage?.length > 0}
				<div class="performance-grid">
					{#each data.statistics.commandUsage as command}
						<div class="performance-card">
							<div class="performance-header">
								<span class="performance-name">/{command.name}</span>
								<span class="command-status" class:enabled={command.enabled} class:disabled={!command.enabled}>
									{command.enabled ? '✅' : '❌'}
								</span>
							</div>
							<div class="performance-stats">
								<div class="perf-stat">
									<span class="perf-value">{formatNumber(command.use_count)}</span>
									<span class="perf-label">Total Uses</span>
								</div>
							</div>
							<span class="performance-last">Last used: {formatRelativeTime(command.last_used_at)}</span>
							<a href="/admin/{data.serverId}/commands/{command.id}" class="btn btn-secondary btn-sm">Edit</a>
						</div>
					{/each}
				</div>
			{:else}
				<div class="empty-list">
					<span>No commands configured yet</span>
					<a href="/admin/{data.serverId}/commands/new" class="btn btn-primary btn-sm">Create Command</a>
				</div>
			{/if}
		</section>
		
		<!-- Automation Performance -->
		<section class="performance-section">
			<h2 class="section-title">
				<span class="section-icon">⚡</span>
				Automation Performance
			</h2>
			{#if data.statistics.automationPerformance?.length > 0}
				<div class="performance-grid">
					{#each data.statistics.automationPerformance as automation}
						{@const history = data.automationHistory?.[automation.id] || []}
						{@const sparklineData = buildSparkline(history)}
						<div class="performance-card">
							<div class="performance-header">
								<span class="performance-name">{automation.name}</span>
							</div>
							{#if sparklineData.path}
								<div class="sparkline-container">
									<svg viewBox="0 0 100 30" preserveAspectRatio="none" class="sparkline">
										<defs>
											<linearGradient id="sparkline-gradient-{automation.id}" x1="0%" y1="0%" x2="0%" y2="100%">
												<stop offset="0%" stop-color="var(--color-primary)" stop-opacity="0.3"/>
												<stop offset="100%" stop-color="var(--color-primary)" stop-opacity="0"/>
											</linearGradient>
										</defs>
										<path d={sparklineData.areaPath} fill="url(#sparkline-gradient-{automation.id})"/>
										<path d={sparklineData.path} fill="none" stroke="var(--color-primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
									</svg>
								</div>
							{:else}
								<div class="sparkline-empty">No recent activity</div>
							{/if}
							<div class="performance-stats">
								<div class="perf-stat">
									<span class="perf-value">{formatNumber(automation.log_count)}</span>
									<span class="perf-label">Executions</span>
								</div>
							</div>
							<span class="performance-last">Last triggered: {formatRelativeTime(automation.last_triggered_at)}</span>
							<a href="/admin/{data.serverId}/automations/{automation.public_id || automation.id}" class="btn btn-secondary btn-sm">Edit</a>
						</div>
					{/each}
				</div>
			{:else}
				<div class="empty-list">
					<span>No automations configured yet</span>
					<a href="/admin/{data.serverId}/automations/new" class="btn btn-primary btn-sm">Create Automation</a>
				</div>
			{/if}
		</section>
		
		<!-- Recent Automation Executions -->
		<section class="executions-section">
			<h2 class="section-title">
				<span class="section-icon">📜</span>
				Recent Automation Executions
			</h2>
			{#if data.recentExecutions?.length > 0}
				<div class="executions-table">
					<div class="table-header">
						<span class="col-status">Status</span>
						<span class="col-automation">Automation</span>
						<span class="col-trigger">Trigger</span>
						<span class="col-time">Execution Time</span>
						<span class="col-when">When</span>
					</div>
					{#each data.recentExecutions as execution}
						<div class="table-row" class:error={!execution.success}>
							<span class="col-status">
								{#if execution.success}
									<span class="status-badge success">✓</span>
								{:else}
									<span class="status-badge error" title={execution.error_message}>✗</span>
								{/if}
							</span>
							<span class="col-automation">{execution.automation_name}</span>
							<span class="col-trigger">{execution.trigger_event}</span>
							<span class="col-time">{execution.execution_time_ms ? execution.execution_time_ms + 'ms' : 'N/A'}</span>
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
		margin: 0 auto;
		padding: 1rem;
	}

	.data-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 1rem;
		padding: 0.65rem 0.9rem;
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(8, 12, 24, 0.55);
		color: rgba(255, 255, 255, 0.9);
		font-size: 0.9rem;
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #60a5fa;
	}

	.data-status.is-loading .status-dot {
		background: #f59e0b;
		animation: pulse 1.2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 0.45;
		}
		50% {
			opacity: 1;
		}
	}
	
	@media (min-width: 640px) {
		.stats-page {
			padding: 1.5rem;
		}
	}
	
	@media (min-width: 1024px) {
		.stats-page {
			padding: 2rem 3rem;
		}
	}
	
	@media (min-width: 1536px) {
		.stats-page {
			padding: 2rem 4rem;
		}
	}
	
	/* Header */
	.page-header {
		margin-bottom: 2rem;
	}
	
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.9rem;
		margin-bottom: 0.75rem;
		transition: color var(--transition-fast);
	}
	
	.back-link:hover {
		color: var(--color-primary);
	}
	
	.title-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	
	.title-section h1 {
		font-size: 1.75rem;
		font-weight: 700;
		margin: 0;
		color: var(--color-text);
	}
	
	.subtitle {
		color: var(--color-text-muted);
		margin: 0.25rem 0 0;
	}
	
	/* Master bot toggle */
	.header-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.period-nav {
		margin-top: 0.75rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}

	.period-nav-label {
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	.period-retention-note {
		margin-left: 0.5rem;
		opacity: 0.8;
	}

	.period-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.period-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-surface);
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.85rem;
		transition: all var(--transition-fast);
	}

	.period-pill:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.period-pill.active {
		border-color: var(--color-primary);
		background: var(--color-primary-soft);
		color: var(--color-text);
	}

	@media (max-width: 767px) {
		.period-nav {
			align-items: flex-start;
			flex-direction: column;
		}
	}

	.master-bot-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-size: 0.9rem;
		color: var(--color-text-muted);
		user-select: none;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.5rem 0.75rem;
	}
	
	.master-bot-toggle input[type="checkbox"] {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	
	.master-bot-toggle .toggle-switch {
		position: relative;
		width: 40px;
		height: 22px;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: 11px;
		transition: all var(--transition-fast);
	}
	
	.master-bot-toggle .toggle-switch::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		background: var(--color-text-muted);
		border-radius: 50%;
		transition: all var(--transition-fast);
	}
	
	.master-bot-toggle input:checked + .toggle-switch {
		background: var(--color-primary);
		border-color: var(--color-primary);
	}
	
	.master-bot-toggle input:checked + .toggle-switch::after {
		left: 20px;
		background: var(--color-background);
	}
	
	.master-bot-toggle .toggle-label {
		font-size: 0.85rem;
		opacity: 0.5;
		filter: grayscale(1);
		transition: opacity var(--transition-fast), filter var(--transition-fast);
	}
	
	.master-bot-toggle input:checked ~ .toggle-label {
		opacity: 1;
		filter: grayscale(0);
	}
	
	/* Section Titles */
	.section-title {
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0 0 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}
	
	.section-subtitle {
		font-size: 0.85rem;
		font-weight: 400;
		color: var(--color-text-muted);
		margin-left: 0.25rem;
	}
	
	.section-icon {
		font-size: 1rem;
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
		gap: 1rem;
		grid-template-columns: 1fr;
	}
	
	@media (min-width: 768px) {
		.overview-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	
	.stat-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
	}
	
	.stat-card.primary {
		border-color: var(--color-primary);
		background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-primary-soft) 100%);
	}
	
	.stat-card-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 0.5rem;
	}
	
	.stat-icon {
		font-size: 2rem;
	}
	
	.stat-card-header + .stat-content {
		margin-top: 0.75rem;
	}
	
	.stat-content {
		margin-bottom: 1rem;
	}
	
	.stat-value {
		display: block;
		font-size: 2rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.2;
	}
	
	.stat-label {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
	
	.stat-breakdown {
		display: flex;
		gap: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
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
		grid-template-columns: 1fr;
	}

	@media (min-width: 480px) {
		.categories-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (min-width: 768px) {
		.categories-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	@media (min-width: 1024px) {
		.categories-grid {
			grid-template-columns: repeat(5, 1fr);
		}
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
		color: #57F287;
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
		grid-template-columns: repeat(3, 1fr);
		gap: 1.5rem;
	}
	
	@media (max-width: 1200px) {
		.voice-charts-grid {
			grid-template-columns: repeat(2, 1fr);
		}
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

	.list-category,
	.list-meta {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	@media (min-width: 480px) {
		.list-category,
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
		grid-template-columns: 50px 1fr 1fr 100px 100px;
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
		border-color: var(--discord-blurple);
		background: linear-gradient(135deg, var(--color-surface) 0%, rgba(88, 101, 242, 0.1) 100%);
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
		background: #FEE75C;
	}
	
	.user-bar.video {
		background: #5865F2;
	}
	
	.user-bar.screenshare {
		background: #57F287;
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
		font-size: 0.9rem;
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
		font-size: 1rem;
	}

	@media (min-width: 480px) {
		.section-header-row .section-title {
			font-size: 1.1rem;
		}
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
	
	.bot-toggle input[type="checkbox"] {
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
		transition: opacity var(--transition-fast), filter var(--transition-fast);
	}
	
	.bot-toggle input:checked ~ .toggle-label {
		opacity: 1;
		filter: grayscale(0);
	}
	
	.bot-badge {
		font-size: 0.7rem;
		padding: 0.1rem 0.35rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		margin-left: 0.35rem;
		color: var(--color-text-muted);
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
	
	.bot-toggle-sm input[type="checkbox"] {
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
		transition: opacity var(--transition-fast), filter var(--transition-fast);
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
