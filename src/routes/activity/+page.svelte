<script lang="ts">
	import { onMount } from 'svelte';
	import { DiscordSDK } from '@discord/embedded-app-sdk';

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
	let base = '';

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

	onMount(() => {
		// Discord adds frame_id to the iframe URL; without it this is just a browser tab.
		const params = new URLSearchParams(location.search);
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
						{#if mod.id === 'timebox' && timeboxes.length > 0}
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
		background: var(--color-bg, #0d0b1a);
	}
	.act {
		min-height: 100vh;
		box-sizing: border-box;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		color: var(--color-text, #e8e6f4);
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
		color: var(--color-text-secondary, #a9a5c4);
	}
	.server img {
		border-radius: 50%;
	}
	.quiet {
		color: var(--color-text-secondary, #a9a5c4);
		margin: 0;
	}
	.card {
		background: var(--color-surface, #16132a);
		border: 1px solid var(--color-border, #2a2745);
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
		border: 1px solid var(--color-border, #2a2745);
		border-radius: 999px;
		padding: 0.3rem 0.9rem;
		cursor: pointer;
		font: inherit;
	}
	.tab.on {
		background: var(--color-primary, #7c6cf2);
		border-color: var(--color-primary, #7c6cf2);
		color: var(--color-fixed-text-bright);
	}
	.pick select {
		background: var(--color-surface, #16132a);
		color: inherit;
		border: 1px solid var(--color-border, #2a2745);
		border-radius: 0.5rem;
		padding: 0.3rem 0.5rem;
		max-width: 12rem;
	}
	.tb {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 0;
	}
	.tb-clock {
		font:
			700 2.25rem/1 ui-monospace,
			monospace;
		font-variant-numeric: tabular-nums;
		min-width: 5.5ch;
	}
	.tb.focus .tb-clock {
		color: var(--color-primary, #7c6cf2);
	}
	.tb-meta {
		display: flex;
		flex-direction: column;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
