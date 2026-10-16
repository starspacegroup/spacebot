<script lang="ts">
	import { onMount } from 'svelte';
	import { DiscordSDK } from '@discord/embedded-app-sdk';
	import '@fontsource/antonio/400.css';
	import '@fontsource/antonio/600.css';
	import '@fontsource/antonio/700.css';
	import '$lib/activity/lcars.css';
	import GameTab from '$lib/components/GameTab.svelte';
	import QuorumTab from '$lib/components/QuorumTab.svelte';
	import TimeboxTab from '$lib/components/TimeboxTab.svelte';
	import LcarsFrame from '$lib/components/activity/LcarsFrame.svelte';
	import { LCARS, viewerAvatar, type Dismissed, type Frame } from '$lib/activity/lcars.js';

	const { data } = $props();

	type Module = {
		id: string;
		name: string;
		enabled: boolean;
		help: { summary: string; start: string };
	};
	type Guild = { id: string; name: string; icon: string | null; modules: Module[] };
	type Session = {
		viewer: { id: string; username: string; avatar: string | null };
		context: { kind: 'guild' | 'dm'; guildId?: string; channelId?: string };
		guilds: Guild[];
		token: string;
		expiresAt: number;
	};

	let phase = $state<'loading' | 'outside' | 'error' | 'ready'>('loading');
	let message = $state('');
	let session = $state<Session | null>(null);
	let guildId = $state<string | null>(null);
	let moduleId = $state('timebox');
	// Inside Discord, calls to our own server go through its proxy.
	let base = $state('');

	type TimeboxView = {
		id: number;
		kind: 'solo' | 'shared';
		status: 'running' | 'paused' | 'done' | 'stopped';
		phase: 'focus' | 'break' | 'long_break';
		block_number: number;
		rounds: number;
		focus_minutes: number;
		break_minutes: number;
		long_break_minutes: number;
		ends_at: number | null;
		paused_remaining_ms: number | null;
		voice_channel_id: string | null;
		mine: boolean;
		deafen: 'none' | 'focus' | 'whole';
	};
	let timeboxes = $state<TimeboxView[]>([]);
	let timeboxLoaded = $state(false);
	// Dev only: a canned Game view for ?preview=game-*.
	let gamePreview = $state<any>(null);
	let gamePreviewDismissed = $state<Dismissed>({});
	let gameFrame = $state<Frame | null>(null);
	// Dev only: a canned Quorum view for ?preview=quorum.
	let quorumPreview = $state<any>(null);
	let now = $state(Date.now());

	let timeboxBusy = $state(false);
	let timeboxError = $state('');
	async function actOnTimebox(id: number, action: string) {
		if (!session || !guildId || timeboxBusy) return;
		timeboxBusy = true;
		timeboxError = '';
		try {
			const res = await fetch(`${base}/api/activity/timebox`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${session.token}`,
				},
				body: JSON.stringify({ guild_id: guildId, id, action }),
			});
			const json = await res.json().catch(() => ({}));
			if (res.ok) timeboxes = json.timeboxes ?? [];
			else timeboxError = json.message ?? 'That did not work.';
		} catch {
			timeboxError = 'Could not reach SpaceBot. Try again.';
		} finally {
			timeboxBusy = false;
		}
	}

	// The Timebox tab: fetch the viewer's timeboxes for this server and keep them fresh.
	// The countdown itself runs here from the end time, so the poll can be slow; a block
	// change shows up within one poll of the bot's own minute sweep.
	$effect(() => {
		if (!session || !guildId || moduleId !== 'timebox' || !mod?.enabled) return;
		if (import.meta.env.DEV && session.token === 'preview') return;
		const token = session.token;
		const gid = guildId;
		let stopped = false;
		async function load() {
			try {
				const res = await fetch(`${base}/api/activity/timebox`, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({ guild_id: gid }),
				});
				if (!res.ok) return;
				const json = await res.json();
				if (!stopped) {
					timeboxes = json.timeboxes ?? [];
					timeboxLoaded = true;
				}
			} catch {
				// Keep what is on screen; the next poll tries again.
			}
		}
		timeboxLoaded = false;
		load();
		const poll = setInterval(load, 15000);
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => {
			stopped = true;
			clearInterval(poll);
			clearInterval(tick);
		};
	});

	const guild = $derived(session?.guilds.find((g) => g.id === guildId) ?? null);
	const mod = $derived(guild?.modules.find((m) => m.id === moduleId) ?? null);
	const tabs = $derived(guild?.modules ?? []);

	/** The nav says Agent for the game: it is what /start agent calls it. */
	const tabLabel = (m: Module) => (m.id === 'game' ? 'Agent' : m.name);
	const isPreview = $derived(import.meta.env.DEV && session?.token === 'preview');

	const frame = $derived.by((): Frame => {
		const plain = (title: string, footer = '', accent: string = LCARS.orange) => ({
			title,
			accent,
			tab: null,
			footer,
		});
		if (phase === 'loading') return plain('SpaceBot', 'Signing in with Discord');
		if (phase === 'outside') return plain('SpaceBot', 'Runs inside Discord');
		if (phase === 'error') return plain('SpaceBot · Unable', '', LCARS.alert);
		if (!guild || !mod) return plain('SpaceBot', 'Nothing turned on yet');
		const name = tabLabel(mod);
		if (!mod.enabled) return plain(`${name} · Off`, 'Turned off in this server', LCARS.grey);
		if (mod.id === 'game' && gameFrame) return gameFrame;
		if (mod.id === 'quorum') return plain('Quorum · SpaceBot', 'Same vote as the channel card');
		if (mod.id === 'timebox') {
			const shared = timeboxes[0]?.kind === 'shared';
			return plain(
				'Timebox · SpaceBot',
				timeboxes.length
					? `${shared ? 'Shared' : 'Your'} countdown · read only`
					: 'Read only'
			);
		}
		return plain(`${name} · SpaceBot`);
	});

	function guildIcon(g: Guild) {
		return g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null;
	}

	function preview(kind: string) {
		const modules = (enabled: boolean): Module[] => [
			{
				id: 'timebox',
				name: 'Timebox',
				enabled,
				help: {
					summary:
						'Focus blocks and breaks, alone or with everyone in a voice channel. The countdown shows here.',
					start: 'Start one with /start timebox in this server.',
				},
			},
			{
				id: 'game',
				name: 'Game',
				enabled,
				help: {
					summary: 'A hidden-agent round for everyone in a voice channel.',
					start: 'Join a voice channel and open a lobby here, or use /start agent.',
				},
			},
			{
				id: 'quorum',
				name: 'Quorum',
				enabled,
				help: {
					summary: 'Yes/no questions to the whole server.',
					start: 'Ask one here, or with /start quorum in a channel.',
				},
			},
		];
		const long = 'The Extremely Long Community Server Name That Keeps Going';
		session = {
			viewer: { id: '1', username: 'a-rather-long-display-name-here', avatar: null },
			context: kind === 'dm' ? { kind: 'dm' } : { kind: 'guild', guildId: 'g1' },
			guilds:
				kind === 'empty'
					? []
					: kind === 'dm'
						? [
								{ id: 'g1', name: long, icon: null, modules: modules(true) },
								{ id: 'g2', name: 'Small', icon: null, modules: modules(false) },
							]
						: [{ id: 'g1', name: long, icon: null, modules: modules(kind !== 'off') }],
			token: 'preview',
			expiresAt: 0,
		};
		guildId = session.guilds[0]?.id ?? null;
		if (kind === 'quorum') {
			moduleId = 'quorum';
			const item = (id: number, q: string, yes: number, no: number, my: any) => ({
				id,
				question: q,
				channel_id: 'c',
				channel_name: 'general',
				closes_at: Math.floor(Date.now() / 1000) + 6 * 3600,
				quorum: 5,
				yes,
				no,
				abstain: 1,
				total: yes + no + 1,
				reached: yes + no + 1 >= 5,
				my_vote: my,
				status: 'open',
				result: null,
				asked_by_me: false,
			});
			quorumPreview = {
				ask_channel_id: 'v',
				can_ask: true,
				min_closes: '5m',
				max_closes: '14d',
				default_closes: '24h',
				open: [
					item(
						1,
						'Should we move game night to Friday so more people can make it?',
						4,
						2,
						'yes'
					),
					item(2, 'Add a #memes channel?', 1, 3, null),
				],
				settled: [
					{
						...item(3, 'Rename the server?', 6, 2, null),
						status: 'closed',
						result: 'yes',
					},
				],
			};
			phase = 'ready';
			return;
		}
		if (kind.startsWith('game')) {
			moduleId = 'game';
			gamePreview = previewGame(kind);
			phase = 'ready';
			return;
		}
		if (kind === 'error') {
			message =
				'You are not a member of this server, so there is nothing for me to show you here.';
			phase = 'error';
			return;
		}
		if (kind !== 'help') {
			const base = {
				id: 1,
				status: 'running' as const,
				rounds: 4,
				focus_minutes: 23,
				break_minutes: 5,
				long_break_minutes: 15,
				paused_remaining_ms: null as number | null,
				voice_channel_id: 'v',
				mine: true,
				deafen: 'focus' as const,
			};
			timeboxes = [
				{
					...base,
					kind: 'shared',
					phase: 'focus',
					block_number: 2,
					ends_at: Math.floor(Date.now() / 1000) + 14 * 60 + 7,
				},
				{
					...base,
					id: 2,
					kind: 'solo',
					phase: 'long_break',
					block_number: 4,
					status: 'paused',
					ends_at: null,
					paused_remaining_ms: 9 * 60 * 1000,
					deafen: 'whole',
				},
			];
			timeboxLoaded = true;
		}
		phase = 'ready';
	}

	/**
	 * Canned views of the game for the dev preview, one per screen in the LCARS
	 * mockups: none, lobby, crew, agent, round, vote, ejected, out, watch,
	 * crew-win, agent-win.
	 */
	function previewGame(kind: string) {
		const now = Math.floor(Date.now() / 1000);
		const p = (id: string, name: string, extra: any = {}) => ({
			id,
			name,
			state: 'in',
			avatar: null,
			voice: 'here',
			muted: false,
			...extra,
		});
		const players = [
			p('1', 'a-rather-long-display-name-here'),
			p('2', 'Nova'),
			p('3', 'Orion'),
			p('4', 'Vega'),
			p('5', 'Lyra', { voice: 'away' }),
			p('6', 'Rigel', { muted: true }),
		];
		const round: any = {
			id: 1,
			status: 'running',
			agent_name: 'Agent',
			crew_name: 'Crew',
			min_players: 4,
			calls_per_player: 1,
			started_at: now - 78,
			ends_at: now + 222,
			call_unlocks_at: now + 18,
			is_starter: false,
			starter_id: '2',
			voice_channel_name: 'Engineering',
			round_seconds: 300,
			call_lock_seconds: 60,
			meeting_seconds: 30,
			mute_out: true,
			players,
			me: {
				in: true,
				state: 'in',
				role: 'crew',
				word: 'nebula',
				calls_left: 1,
				call: 'locked',
			},
			meeting: null,
			last_vote: null,
			result: null,
		};
		const v = (r: any, can_open = false) => ({ voice_channel_id: 'v', can_open, round: r });
		const seen = { card: 1 };
		gamePreviewDismissed = kind === 'game-crew' || kind === 'game-agent' ? {} : seen;
		const ejected = players.map((x) => (x.id === '3' ? { ...x, state: 'ejected' } : x));
		const roles = (agent: string, out: string[]) =>
			players.map((x) => ({
				id: x.id,
				name: x.name,
				avatar: null,
				role: x.id === agent ? 'agent' : 'crew',
				state: out.includes(x.id) ? 'ejected' : 'in',
			}));
		switch (kind) {
			case 'game-none':
				return v(null, true);
			case 'game-lobby':
				return v({
					...round,
					status: 'lobby',
					started_at: null,
					ends_at: null,
					call_unlocks_at: null,
					me: { ...round.me, role: null, word: null, call: 'no_round' },
					players: players.map((x) => ({ ...x, voice: 'here' })),
				});
			case 'game-crew':
				return v({ ...round, ends_at: now + 300 });
			case 'game-agent':
				return v({
					...round,
					ends_at: now + 300,
					me: { ...round.me, role: 'agent', word: null },
				});
			case 'game-vote':
				return v({
					...round,
					me: { ...round.me, call: 'open' },
					meeting: {
						id: 1,
						caller_id: '4',
						closes_at: now + 21,
						voted: 3,
						living: 6,
						my_vote: '3',
						voted_ids: ['1', '2', '4'],
					},
				});
			case 'game-ejected':
				return v({
					...round,
					ends_at: now + 178,
					players: ejected,
					me: { ...round.me, call: 'ok' },
					last_vote: {
						meeting_id: 1,
						number: 1,
						closed_at: now - 3,
						ejected_id: '3',
						ejected_name: 'Orion',
					},
				});
			case 'game-out':
				return v({
					...round,
					ends_at: now + 178,
					players: players.map((x) => (x.id === '1' ? { ...x, state: 'ejected' } : x)),
					me: { ...round.me, state: 'ejected', call: 'out' },
					last_vote: {
						meeting_id: 1,
						number: 1,
						closed_at: now - 90,
						ejected_id: '1',
						ejected_name: 'a-rather-long-display-name-here',
					},
				});
			case 'game-watch':
				return v({
					...round,
					players: players.filter((x) => x.id !== '1'),
					me: {
						in: false,
						state: null,
						role: null,
						word: null,
						calls_left: 0,
						call: 'not_in',
					},
				});
			case 'game-crew-win':
				return v(
					{
						...round,
						status: 'ended',
						players: ejected,
						result: {
							code: 'players',
							text: 'The Crew win: the Agent was ejected.',
							agent_id: '6',
							word: 'nebula',
							roles: roles('6', ['3', '6']),
						},
					},
					true
				);
			case 'game-agent-win':
				return v(
					{
						...round,
						status: 'ended',
						result: {
							code: 'agent_time',
							text: 'The Agent wins: the clock ran out.',
							agent_id: '5',
							word: 'nebula',
							roles: roles('5', ['3', '4']),
						},
					},
					true
				);
			default:
				return v({ ...round, call_unlocks_at: now + 18 });
		}
	}

	onMount(() => {
		// Discord adds frame_id to the iframe URL; without it this is just a browser tab.
		const params = new URLSearchParams(location.search);
		// Dev only (stripped from production builds): render the signed-in states
		// without Discord, to check layouts at phone width.
		if (import.meta.env.DEV && params.has('preview')) {
			preview(params.get('preview') ?? 'guild');
			return;
		}
		if (!params.has('frame_id') || !data.clientId) {
			phase = 'outside';
			return;
		}
		base = '/.proxy';
		let timer: ReturnType<typeof setTimeout> | undefined;
		let accessToken = '';
		let sdk: DiscordSDK;

		async function post(path: string, body: unknown) {
			const res = await fetch(`${base}${path}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok)
				throw new Error(json.message || json.error || `Request failed (${res.status})`);
			return json;
		}

		// Asks the server again who is here and what they may see. Run on start, before
		// the token expires, and whenever the people in the instance change: a group DM
		// stops showing server data the moment someone who is not a member joins.
		async function refresh() {
			clearTimeout(timer);
			const next: Session = await post('/api/activity/session', {
				access_token: accessToken,
				instance_id: sdk.instanceId,
			});
			session = next;
			if (!guildId || !next.guilds.some((g) => g.id === guildId)) {
				guildId = next.context.guildId ?? next.guilds[0]?.id ?? null;
			}
			phase = 'ready';
			const wait = Math.max(30, next.expiresAt - Math.floor(Date.now() / 1000) - 60);
			timer = setTimeout(() => refresh().catch(fail), wait * 1000);
		}

		function fail(err: unknown) {
			message = err instanceof Error ? err.message : 'Something went wrong.';
			phase = 'error';
		}

		(async () => {
			sdk = new DiscordSDK(data.clientId!);
			await sdk.ready();
			const { code } = await sdk.commands.authorize({
				client_id: data.clientId!,
				response_type: 'code',
				state: '',
				prompt: 'none',
				scope: ['identify', 'guilds'],
			});
			const tok = await post('/api/activity/token', { code });
			accessToken = tok.access_token;
			await sdk.commands.authenticate({ access_token: accessToken });
			await refresh();
			sdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', () => refresh().catch(fail));
		})().catch(fail);

		return () => clearTimeout(timer);
	});
</script>

<svelte:head>
	<title>SpaceBot Activity</title>
</svelte:head>

{#snippet guildPick()}
	{#if session && session.guilds.length > 1}
		<label class="guild-label">
			<span class="sr">Server</span>
			<select class="guild" bind:value={guildId}>
				{#each session.guilds as g (g.id)}
					<option value={g.id}>{g.name}</option>
				{/each}
			</select>
		</label>
	{:else if guild}
		<span class="guild-name">
			{#if guildIcon(guild)}<img
					src={guildIcon(guild)}
					alt=""
					width="20"
					height="20"
					referrerpolicy="no-referrer"
				/>{/if}
			{guild.name}
		</span>
	{/if}
{/snippet}

<LcarsFrame
	title={frame.title}
	accent={frame.accent}
	tab={frame.tab}
	footer={frame.footer}
	tabs={phase === 'ready' && guild ? tabs.map((m) => ({ id: m.id, label: tabLabel(m) })) : []}
	active={moduleId}
	onselect={(id) => (moduleId = id)}
	sample={isPreview}
	top={phase === 'ready' ? guildPick : undefined}
>
	{#if phase === 'loading'}
		<p class="st">Signing in with Discord…</p>
	{:else if phase === 'outside'}
		<p class="st">SpaceBot Activity</p>
		<h2 class="hl md">Open it in Discord</h2>
		<p class="sub">
			This page runs inside Discord. Open it from a voice channel's Activities menu, or from a
			direct message.
		</p>
	{:else if phase === 'error'}
		<p class="st">Can't open it here</p>
		<h2 class="hl md" style:color="var(--rr)">Unable to comply</h2>
		<p class="sub">{message}</p>
	{:else if session}
		{#if !guild}
			<p class="st">Nothing turned on for you yet</p>
			<h2 class="hl md">Standing by</h2>
			<p class="sub">
				SpaceBot's Activity shows up for members of a server that has it enabled. Ask a
				server admin to turn a module on from the SpaceBot dashboard.
			</p>
		{:else if mod}
			{#if !mod.enabled}
				<p class="st">{tabLabel(mod)} · not turned on in {guild.name}</p>
				<h2 class="hl md" style:color="#888">Offline</h2>
				<p class="sub">{mod.help.summary}</p>
				<p class="note">A server admin can enable it from the dashboard.</p>
			{:else if mod.id === 'game'}
				<GameTab
					{base}
					token={session.token}
					guildId={guild.id}
					viewer={{
						id: session.viewer.id,
						name: session.viewer.username,
						avatar: viewerAvatar(session.viewer.id, session.viewer.avatar),
					}}
					preview={gamePreview}
					previewDismissed={gamePreviewDismissed}
					onframe={(f) => (gameFrame = f)}
				/>
			{:else if mod.id === 'quorum'}
				<QuorumTab
					{base}
					token={session.token}
					guildId={guild.id}
					preview={quorumPreview}
				/>
			{:else if mod.id === 'timebox'}
				<TimeboxTab
					{timeboxes}
					loaded={timeboxLoaded}
					{now}
					help={mod.help}
					act={actOnTimebox}
					busy={timeboxBusy}
					error={timeboxError}
				/>
			{:else}
				<p class="sub">{mod.help.summary}</p>
				<p class="st">{mod.help.start}</p>
			{/if}
		{/if}
	{/if}
</LcarsFrame>

<style>
	.guild-label {
		display: contents;
	}
	.guild-name img {
		border-radius: 50%;
		vertical-align: middle;
		width: 1.2em;
		height: 1.2em;
		margin-right: 0.3em;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
