/**
 * Canned data for the Statistics page, for `?preview=1` in dev only. It exists so the
 * page can be looked at, and screenshotted, without a populated server behind it.
 * The page imports it dynamically inside an `import.meta.env.DEV` branch, so it is
 * not part of a production build.
 */

// A small seeded generator: the same numbers every load, so screenshots can be compared.
function rng(seed: number) {
	let s = seed;
	return () => {
		s = (s * 1664525 + 1013904223) % 4294967296;
		return s / 4294967296;
	};
}

const day = (back: number) => {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - back);
	return d.toISOString().slice(0, 10);
};

export function buildPreview(days = 30) {
	const r = rng(7);
	const range = Array.from({ length: days }, (_, i) => days - 1 - i);

	const daily = range.map((back) => {
		const weekend = [0, 6].includes(new Date(day(back)).getUTCDay());
		const count = Math.round((weekend ? 420 : 300) * (0.6 + r() * 0.8));
		return { period: day(back), count, non_bot_count: Math.round(count * 0.82) };
	});

	const voice = range.map((back) => {
		const minutes = Math.round(240 + r() * 900);
		return {
			date: day(back),
			totalMinutes: minutes,
			totalHours: Math.round((minutes / 60) * 10) / 10,
			uniqueUsers: 3 + Math.round(r() * 11),
			avgUniqueUsers: 4 + Math.round(r() * 5),
			peakConcurrent: 2 + Math.round(r() * 7),
			avgConcurrent: 2 + Math.round(r() * 3),
			hasData: true,
		};
	});

	let members = 412;
	const memberHistory = range.map((back) => {
		members += Math.round(r() * 5 - 1.5);
		return {
			period: day(back),
			member_count: members + 38,
			human_count: members,
			bot_count: 38,
		};
	});
	const growth = range.map((back) => ({
		date: day(back),
		joins: Math.round(r() * 9),
		leaves: Math.round(r() * 5),
		hasData: true,
	}));

	const heatmapData = [] as any[];
	for (let d = 0; d < 7; d++) {
		for (let h = 0; h < 24; h++) {
			const evening = Math.exp(-Math.pow((h - 20) / 3.2, 2));
			const midday = 0.45 * Math.exp(-Math.pow((h - 13) / 2.6, 2));
			const count = Math.round(
				(evening + midday) * (d === 0 || d === 6 ? 90 : 60) * (0.6 + r() * 0.6)
			);
			heatmapData.push({
				day_of_week: d,
				hour: h,
				count,
				non_bot_count: Math.round(count * 0.85),
			});
		}
	}

	const people = [
		['Riker', 'riker', 5400 * 6],
		['Data', 'data', 4100 * 6],
		['Troi', 'troi', 3300 * 6],
		['Worf', 'worf', 2500 * 6],
		['Crusher', 'crusher', 1700 * 6],
	];
	const users = (scale: number) =>
		people.map(([name, handle, secs], i) => ({
			actor_id: String(100000000000000100 + i),
			actor_name: name,
			actor_avatar: null,
			actor_discriminator: '0',
			actor_is_bot: 0,
			total_seconds: Math.round((secs as number) * scale),
			handle,
		}));

	const channels = [
		['general', 4210],
		['off-topic', 2890],
		['dev-chat', 1760],
		['memes', 1320],
		['announcements', 410],
	].map(([channel_name, event_count], i) => ({
		channel_id: String(200000000000000000 + i),
		channel_name,
		event_count,
		non_bot_count: Math.round((event_count as number) * 0.88),
		event_types: 4 + i,
	}));

	const byCategory = {
		message: 6120,
		voice: 2310,
		member: 540,
		reaction: 1890,
		channel: 96,
		role: 61,
	};

	return {
		live: {
			statistics: {
				automations: {
					active: 7,
					total: 9,
					totalExecutions: 1284,
					successfulExecutions: 1261,
				},
				commands: { active: 12, total: 15, totalUsage: 3470 },
				events: {
					total: 11017,
					totalNonBot: 9180,
					today: 402,
					todayNonBot: 331,
					thisWeek: 2713,
					thisWeekNonBot: 2290,
					thisMonth: 9040,
					thisMonthNonBot: 7511,
					byCategory,
					byCategoryNonBot: Object.fromEntries(
						Object.entries(byCategory).map(([k, v]) => [k, Math.round(v * 0.84)])
					),
				},
				timeSeries: { daily },
				topChannels: channels,
				commandUsage: [
					['timebox', 1180],
					['play', 820],
					['quorum', 610],
					['help', 520],
					['oldest', 340],
				].map(([name, use_count], i) => ({
					id: i + 1,
					name,
					enabled: i !== 4,
					use_count,
					last_used_at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
				})),
				automationPerformance: [
					['Welcome new members', 640],
					['Role on reaction', 410],
					['Voice join announcer', 233],
				].map(([name, log_count], i) => ({
					id: i + 1,
					public_id: `a${i + 1}`,
					name,
					log_count,
					last_triggered_at: new Date(Date.now() - (i + 2) * 1_800_000).toISOString(),
				})),
			},
			heatmapData,
			categoryTrends: [],
			recentExecutions: [
				['Welcome new members', 'member_join', 42, 1],
				['Role on reaction', 'reaction_add', 118, 1],
				['Voice join announcer', 'voice_join', 87, 0],
				['Welcome new members', 'member_join', 39, 1],
			].map(([automation_name, trigger_event, execution_time_ms, success], i) => ({
				automation_name,
				trigger_event,
				execution_time_ms,
				success: !!success,
				error_message: success ? null : 'Missing permission',
				created_at: new Date(Date.now() - (i + 1) * 2_400_000).toISOString(),
			})),
			automationHistory: {
				1: range
					.slice(-14)
					.map((back) => ({ date: day(back), value: Math.round(r() * 40) })),
				2: range
					.slice(-14)
					.map((back) => ({ date: day(back), value: Math.round(r() * 25) })),
				3: range
					.slice(-14)
					.map((back) => ({ date: day(back), value: Math.round(r() * 15) })),
			},
			memberStats: {
				latest: {
					member_count: members + 38,
					human_count: members,
					bot_count: 38,
					role_count: 24,
					boost_count: 9,
					boost_level: 2,
					recorded_at: new Date().toISOString(),
				},
				changes: {
					current: members + 38,
					currentHuman: members,
					day: 3,
					dayHuman: 3,
					week: 17,
					weekHuman: 15,
					month: 41,
					monthHuman: 36,
				},
			},
			memberHistory,
			voiceActivity: null,
			memberGrowth: null,
			memberGrowthChartData: growth,
			voiceActivityChartData: voice,
			topVoiceUsers: users(1),
			topVideoUsers: users(0.3),
			topScreenshareUsers: users(0.15),
			topBoosters: [],
			cachedRoles: [
				{ name: 'Captain', color: 0xff9900, hoist: 1, position: 9 },
				{ name: 'Bridge crew', color: 0x9999ff, hoist: 1, position: 8 },
				{ name: 'Engineering', color: 0xcc9999, hoist: 1, position: 7 },
				{ name: 'Member', color: 0, hoist: 0, position: 1 },
				{ name: 'SpaceBot', color: 0, hoist: 0, managed: 1, position: 5 },
			],
			liveVoiceSnapshot: null,
		},
		members: users(1).map((u, i) => ({
			id: String(100000000000000100n + BigInt(i)),
			name: u.actor_name,
			avatar: null,
			discriminator: '0',
			bot: false,
			seconds: u.total_seconds,
			last_active: new Date(Date.now() - (i + 1) * 5_400_000).toISOString(),
		})),
		voice: {
			snapshot: {
				totalUsers: 6,
				totalChannels: 2,
				activeCameras: 1,
				activeStreams: 1,
				membersInActivities: 3,
				updatedAt: new Date().toISOString(),
				channels: [
					{
						channelId: 'c1',
						channelName: 'Bridge',
						memberCount: 4,
						members: [
							{
								userId: 'u1',
								displayName: 'Riker',
								userName: 'riker',
								selfVideo: true,
								activities: [
									{ label: 'Playing', name: 'Factorio', details: 'Main base' },
								],
							},
							{
								userId: 'u2',
								displayName: 'Data',
								userName: 'data',
								streaming: true,
								activities: [{ label: 'Using', name: 'Timebox', details: 'Focus' }],
							},
							{ userId: 'u3', displayName: 'Troi', userName: 'troi', selfMute: true },
							{
								userId: 'u4',
								displayName: 'Worf',
								userName: 'worf',
								selfMute: true,
								selfDeaf: true,
								serverMute: true,
							},
						],
					},
					{
						channelId: 'c2',
						channelName: 'Ten Forward',
						memberCount: 2,
						members: [
							{
								userId: 'u5',
								displayName: 'Crusher',
								userName: 'crusher',
								activities: [{ label: 'Using', name: 'Agent', details: 'Round 2' }],
							},
							{ userId: 'u6', displayName: 'Guinan', userName: 'guinan' },
						],
					},
				],
			},
			entries: [
				['Riker', 'joined', 'Bridge'],
				['Data', 'started streaming in', 'Bridge'],
				['Troi', 'muted themselves in', 'Bridge'],
				['Crusher', 'joined', 'Ten Forward'],
				['Worf', 'was server muted in', 'Bridge'],
				['Guinan', 'joined', 'Ten Forward'],
				['Picard', 'left', 'Bridge'],
			].map(([actorName, actionLabel, channelName], i) => ({
				id: i + 1,
				actorId: null,
				actorName,
				actionLabel,
				actionIcon: '',
				channelName,
				createdAt: new Date(Date.now() - (i + 1) * 420_000).toISOString(),
			})),
		},
	};
}
