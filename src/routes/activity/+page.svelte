<script lang="ts">
	import { onMount } from 'svelte';
	import { DiscordSDK } from '@discord/embedded-app-sdk';
	import GameTab from '$lib/components/GameTab.svelte';
	import QuorumTab from '$lib/components/QuorumTab.svelte';

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
	// Dev only: a canned Quorum view for ?preview=quorum.
	let quorumPreview = $state<any>(null);
	let now = $state(Date.now());

	const PHASE_LABEL = { focus: 'Focus', break: 'Break', long_break: 'Long break' } as const;

	function clock(tb: TimeboxView): string {
		const ms =
			tb.status === 'paused'
				? (tb.paused_remaining_ms ?? 0)
				: Math.max(0, (tb.ends_at ?? 0) * 1000 - now);
		const total = Math.ceil(ms / 1000);
		return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
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

	/** Canned views of the game for the dev preview: lobby, agent, crew, meeting, ended. */
	function previewGame(kind: string) {
		const now = Math.floor(Date.now() / 1000);
		const players = [
			{ id: '1', name: 'a-rather-long-display-name-here', state: 'in' },
			{ id: '2', name: 'Mira', state: 'in' },
			{ id: '3', name: 'Dev', state: 'ejected' },
			{ id: '4', name: 'Sol', state: 'in' },
			{ id: '5', name: 'Quinn', state: 'in' },
		];
		const round: any = {
			id: 1,
			status: 'running',
			agent_name: 'Agent',
			crew_name: 'Crew',
			min_players: 4,
			calls_per_player: 1,
			started_at: now - 100,
			ends_at: now + 200,
			call_unlocks_at: now - 40,
			is_starter: true,
			players,
			me: {
				in: true,
				state: 'in',
				role: 'crew',
				word: 'lighthouse',
				calls_left: 1,
				call: 'ok',
			},
			meeting: null,
			last_vote: null,
			result: null,
		};
		if (kind === 'game-none') return { voice_channel_id: 'v', can_open: true, round: null };
		if (kind === 'game-lobby')
			return {
				voice_channel_id: 'v',
				can_open: false,
				round: {
					...round,
					status: 'lobby',
					players: players.slice(0, 3).map((p) => ({ ...p, state: 'in' })),
				},
			};
		if (kind === 'game-agent')
			return {
				voice_channel_id: 'v',
				can_open: false,
				round: { ...round, me: { ...round.me, role: 'agent', word: null } },
			};
		if (kind === 'game-meeting')
			return {
				voice_channel_id: 'v',
				can_open: false,
				round: {
					...round,
					meeting: {
						id: 1,
						caller_id: '2',
						closes_at: now + 21,
						voted: 2,
						living: 4,
						my_vote: '4',
					},
				},
			};
		if (kind === 'game-over')
			return {
				voice_channel_id: 'v',
				can_open: true,
				round: {
					...round,
					status: 'ended',
					result: {
						code: 'players',
						text: 'The Crew win: the Agent was ejected.',
						agent_id: '4',
						word: 'lighthouse',
						roles: players.map((p) => ({
							...p,
							role: p.id === '4' ? 'agent' : 'crew',
						})),
					},
				},
			};
		return { voice_channel_id: 'v', can_open: false, round };
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

<main class="act">
	{#if phase === 'loading'}
		<p class="quiet">Signing in with Discord…</p>
	{:else if phase === 'outside'}
		<div class="card">
			<h1>SpaceBot Activity</h1>
			<p>
				This page runs inside Discord. Open it from a voice channel's Activities menu, or
				from a direct message.
			</p>
		</div>
	{:else if phase === 'error'}
		<div class="card">
			<h1>Can't open it here</h1>
			<p>{message}</p>
		</div>
	{:else if session}
		<header class="bar">
			<div class="who">
				<strong>SpaceBot</strong>
				<span class="quiet">{session.viewer.username}</span>
			</div>
			{#if session.guilds.length > 1}
				<label class="pick">
					<span class="sr">Server</span>
					<select bind:value={guildId}>
						{#each session.guilds as g (g.id)}
							<option value={g.id}>{g.name}</option>
						{/each}
					</select>
				</label>
			{:else if guild}
				<span class="server">
					{#if guildIcon(guild)}<img
							src={guildIcon(guild)}
							alt=""
							width="20"
							height="20"
						/>{/if}
					{guild.name}
				</span>
			{/if}
		</header>

		{#if !guild}
			<div class="card">
				<h2>Nothing turned on for you yet</h2>
				<p>
					SpaceBot's Activity shows up for members of a server that has it enabled. Ask a
					server admin to turn a module on from the SpaceBot dashboard.
				</p>
			</div>
		{:else}
			<nav class="tabs" aria-label="Modules">
				{#each tabs as m (m.id)}
					<button
						class="tab"
						class:on={m.id === moduleId}
						aria-current={m.id === moduleId ? 'page' : undefined}
						onclick={() => (moduleId = m.id)}
					>
						{m.name}
					</button>
				{/each}
			</nav>

			{#if mod}
				<section class="card">
					<h2>{mod.name}</h2>
					{#if !mod.enabled}
						<p>
							Not turned on in {guild.name}. A server admin can enable it from the
							dashboard.
						</p>
						<p class="quiet">{mod.help.summary}</p>
					{:else}
						{#if mod.id === 'game'}
							<GameTab
								{base}
								token={session!.token}
								guildId={guild.id}
								viewerId={session!.viewer.id}
								preview={gamePreview}
							/>
						{:else if mod.id === 'quorum'}
							<QuorumTab
								{base}
								token={session!.token}
								guildId={guild.id}
								preview={quorumPreview}
							/>
						{:else if mod.id === 'timebox' && timeboxes.length > 0}
							{#each timeboxes as tb (tb.id)}
								<div class="tb" class:focus={tb.phase === 'focus'}>
									<div class="tb-clock" aria-live="off">{clock(tb)}</div>
									<div class="tb-meta">
										<strong>
											{PHASE_LABEL[tb.phase]}{tb.phase === 'focus'
												? ` · block ${tb.block_number} of ${tb.rounds}`
												: ''}
										</strong>
										<span class="quiet">
											{tb.status === 'paused' ? 'Paused · ' : ''}{tb.kind ===
											'shared'
												? 'Shared with the voice channel'
												: 'Just you'}
											· {tb.focus_minutes}/{tb.break_minutes}/{tb.long_break_minutes}
											min
										</span>
										{#if tb.deafen !== 'none'}
											<span class="quiet">
												You asked to be deafened {tb.deafen === 'whole'
													? 'until it ends'
													: 'during focus blocks'}.
											</span>
										{/if}
									</div>
								</div>
							{/each}
							<p class="quiet">
								Pause, skip and stop are on the card in the channel for now.
							</p>
						{:else if mod.id === 'timebox' && !timeboxLoaded}
							<p class="quiet">Looking for your timebox…</p>
						{:else}
							<p>{mod.help.summary}</p>
							<p class="start">{mod.help.start}</p>
						{/if}
					{/if}
				</section>
			{/if}
		{/if}
	{/if}
</main>

<style>
	:global(html, body) {
		background: var(--color-background);
	}
	.act {
		min-height: 100vh;
		box-sizing: border-box;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		color: var(--color-text);
		font:
			14px/1.5 system-ui,
			sans-serif;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.who {
		display: flex;
		flex-direction: column;
	}
	.server {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--color-text-secondary);
	}
	.server img {
		border-radius: 50%;
	}
	.quiet {
		color: var(--color-text-secondary);
		margin: 0;
	}
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 1rem 1.25rem;
	}
	.card h1,
	.card h2 {
		margin: 0 0 0.5rem;
		font-size: 1.1rem;
	}
	.card p {
		margin: 0.25rem 0;
	}
	.start {
		font-weight: 600;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		overflow-x: auto;
	}
	.tab {
		background: transparent;
		color: inherit;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0.3rem 0.9rem;
		cursor: pointer;
		font: inherit;
	}
	.tab.on {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-fixed-text-bright);
	}
	.pick select {
		background: var(--color-surface);
		color: inherit;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		padding: 0.3rem 0.5rem;
		max-width: 12rem;
	}
	.tb {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 1rem;
		padding: 0.5rem 0;
	}
	.tb + .tb {
		border-top: 1px solid var(--color-border);
	}
	.tb-clock {
		font:
			700 clamp(1.75rem, 11vw, 2.25rem) / 1 ui-monospace,
			monospace;
		font-variant-numeric: tabular-nums;
		min-width: 5.5ch;
	}
	.tb.focus .tb-clock {
		color: var(--color-primary);
	}
	.tb-meta {
		display: flex;
		flex: 1 1 11rem;
		flex-direction: column;
		min-width: 0;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
