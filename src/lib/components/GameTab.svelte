<script lang="ts">
	/**
	 * The Activity's Agent tab: the hidden-agent round, played here, in LCARS.
	 *
	 * Everything private to a player (their role, the secret word, their ballot)
	 * is drawn from the server's view for this viewer, which never contains
	 * anyone else's role until the round has ended, and never who voted for whom.
	 * The page polls that view every couple of seconds and after every move, and
	 * runs the clocks locally from the end times it is given.
	 *
	 * The viewer is not in the roster grid: they get their own badge, bottom
	 * right, in the colour of their state. Speaking is not shown: the Activity
	 * cannot know it without a Discord scope it does not have (docs/activity.md).
	 */
	import { onMount } from 'svelte';
	import {
		LCARS,
		gameAccent,
		gameScreen,
		mss,
		msUntil,
		pctLeft,
		winner,
		type Dismissed,
		type Frame,
		type GamePlayer,
		type GameView,
	} from '$lib/activity/lcars.js';
	import Avatar from './activity/Avatar.svelte';
	import LcarsClock from './activity/LcarsClock.svelte';
	import PlayerCard from './activity/PlayerCard.svelte';
	import SelfBadge from './activity/SelfBadge.svelte';

	const {
		base,
		token,
		guildId,
		viewer,
		preview = null,
		previewDismissed = {},
		onframe = () => {},
	} = $props<{
		base: string;
		token: string;
		guildId: string;
		viewer: { id: string; name: string; avatar: string | null };
		/** Dev only: a canned view, so layouts can be checked without Discord. */
		preview?: GameView | null;
		/** Dev only: which screens the preview has already put away. */
		previewDismissed?: Dismissed;
		onframe?: (f: Frame) => void;
	}>();

	const STORE = 'spacebot.game.dismissed';
	let view = $state<GameView | null>(null);
	let problem = $state('');
	let busy = $state(false);
	let hiding = $state(false);
	let wordShown = $state(true);
	let now = $state(Date.now());
	let dismissed = $state<Dismissed>(readDismissed());

	function readDismissed(): Dismissed {
		try {
			return JSON.parse(sessionStorage.getItem(STORE) || '{}') ?? {};
		} catch {
			return {};
		}
	}
	function dismiss(patch: Dismissed) {
		dismissed = { ...dismissed, ...patch };
		try {
			sessionStorage.setItem(STORE, JSON.stringify(dismissed));
		} catch {
			// Private mode or blocked storage: it is only remembered for this page.
		}
	}

	const round = $derived(view?.round ?? null);
	const screen = $derived(gameScreen(view, dismissed, now));
	const accent = $derived(gameAccent(screen, round));
	const mePlayer = $derived(round?.players.find((p) => p.id === viewer.id) ?? null);
	const others = $derived(round?.players.filter((p) => p.id !== viewer.id) ?? []);
	const living = $derived(round?.players.filter((p) => p.state === 'in') ?? []);
	const selfName = $derived(mePlayer?.name ?? viewer.name);
	const selfAvatar = $derived(mePlayer?.avatar ?? viewer.avatar);
	const nameOf = (id: string | null | undefined) =>
		round?.players.find((p) => p.id === id)?.name ?? 'Someone';
	const roleName = $derived(
		round?.me.role === 'agent'
			? round.agent_name
			: round?.me.role === 'crew'
				? round.crew_name
				: ''
	);
	const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

	function voiceLine(p: GamePlayer, lobby = false): string {
		if (p.voice === 'away') return lobby ? 'Not in voice' : 'Left voice · still playing';
		return p.muted ? 'In voice · muted' : 'In voice';
	}

	function status(p: GamePlayer): string {
		if (!round) return '';
		if (round.status === 'lobby')
			return (p.id === round.starter_id ? 'Host · ' : '') + voiceLine(p, true);
		if (p.state === 'ejected') return round.mute_out ? 'Out · muted' : 'Out';
		return voiceLine(p);
	}

	const frame = $derived.by((): Frame => {
		const r = round;
		const out = (t: string, f: string, tab: string | null = null) => ({
			title: `Agent · ${t}`,
			accent,
			tab,
			footer: f,
		});
		switch (screen) {
			case 'loading':
				return out('Standby', 'Looking for a round');
			case 'none':
				return out('Standby', view?.can_open ? 'Ready when you are' : 'No round here');
			case 'lobby':
				return out('Lobby', r?.is_starter ? 'You opened it' : 'Waiting for the host');
			case 'card':
				return out('Your card', 'Private to you');
			case 'round':
				return out('Round', 'Live from voice');
			case 'vote':
				return out('Vote', 'Votes are secret');
			case 'ejected':
				return out('Result', 'Round continues');
			case 'out':
				return out('You are out', 'Spectating', LCARS.grey);
			case 'watch':
				return out('Watching', 'Not in this round', LCARS.grey);
			case 'over':
				return out('Round over', r?.mute_out ? 'Game mutes lifted' : 'Round over');
		}
	});
	$effect(() => onframe(frame));

	const self = $derived.by(() => {
		const r = round;
		const callsLeft = r ? ` · ${plural(r.me.calls_left, 'vote call')} left` : '';
		switch (screen) {
			case 'lobby':
				return {
					status: r?.me.in ? 'In voice · joined' : 'Not joined',
					colour: LCARS.lavender,
				};
			case 'card':
				return { status: roleName, colour: accent };
			case 'round':
			case 'ejected':
				return {
					status: roleName + callsLeft,
					colour: r?.me.role === 'agent' ? LCARS.alert : LCARS.sky,
				};
			case 'vote':
				return {
					status: r?.meeting?.my_vote ? 'Voted · can change' : 'Voting',
					colour: LCARS.orange,
				};
			case 'out':
				return { status: r?.mute_out ? 'Out · muted' : 'Out', colour: '#666666' };
			case 'watch':
				return { status: 'Watching', colour: '#666666' };
			case 'over': {
				const w = winner(r?.result?.code);
				const mine = r?.me.role;
				const won = w === 'none' || !mine ? '' : w === mine ? ' · won' : ' · lost';
				return {
					status: (roleName || 'Watched') + won,
					colour: mine === 'agent' ? LCARS.alert : mine ? LCARS.sky : '#666666',
				};
			}
			default:
				return {
					status: view?.can_open ? 'In voice' : 'Not in voice',
					colour: LCARS.lavender,
				};
		}
	});

	async function call(body: Record<string, unknown>) {
		const res = await fetch(`${base}/api/activity/game`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
			body: JSON.stringify({ guild_id: guildId, ...body }),
		});
		const json = await res.json().catch(() => ({}));
		return { ok: res.ok, json };
	}

	async function load() {
		if (preview) return;
		try {
			const { ok, json } = await call({});
			if (ok) {
				view = json;
				problem = '';
			} else if (json.message) {
				problem = json.message;
			}
		} catch {
			// Keep what is on screen; the next poll tries again.
		}
	}

	async function act(body: Record<string, unknown>) {
		if (busy || preview) return;
		busy = true;
		problem = '';
		try {
			const { ok, json } = await call(body);
			if (!ok) problem = json.error || json.message || 'That did not work.';
		} catch {
			problem = 'Could not reach the server.';
		} finally {
			busy = false;
			await load();
		}
	}

	onMount(() => {
		if (preview) {
			view = preview;
			dismissed = previewDismissed;
		} else load();
		const poll = setInterval(load, 2500);
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => {
			clearInterval(poll);
			clearInterval(tick);
		};
	});

	const roundClock = $derived(round ? mss(msUntil(round.ends_at, now)) : '0:00');
	const roundPct = $derived(round ? pctLeft(round.ends_at, round.round_seconds, now) : 0);

	const hold = {
		onpointerdown: () => (hiding = true),
		onpointerup: () => (hiding = false),
		onpointerleave: () => (hiding = false),
		onpointercancel: () => (hiding = false),
		onkeydown: (e: KeyboardEvent) => {
			if (e.key === ' ' || e.key === 'Enter') {
				e.preventDefault();
				hiding = true;
			}
		},
		onkeyup: () => (hiding = false),
		onblur: () => (hiding = false),
	};
</script>

{#snippet roster(list: GamePlayer[])}
	{#if list.length === 0}
		<p class="note">Nobody else yet.</p>
	{:else}
		<ul class="ros" aria-label="Players">
			{#each list as p (p.id)}
				<li>
					<PlayerCard
						id={p.id}
						name={p.name}
						avatar={p.avatar}
						status={status(p)}
						icon={p.state === 'ejected' ? '✕' : ''}
						variant={[
							p.state === 'ejected' ? 'out' : '',
							p.state === 'in' && p.voice === 'away' ? 'away' : '',
							round?.status === 'lobby' && p.id === round.starter_id ? 'host' : '',
						].join(' ')}
					/>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet badge()}
	<SelfBadge
		id={viewer.id}
		name={selfName}
		avatar={selfAvatar}
		status={self.status}
		colour={self.colour}
	/>
{/snippet}

{#if screen === 'loading'}
	<p class="st">Looking for a round…</p>
{:else if screen === 'none'}
	<div class="hd">
		<div>
			<p class="st">
				{view?.can_open ? 'Your voice channel is free' : 'You are not in a voice channel'}
			</p>
			<h2 class="hl" style:color={accent}>No round here</h2>
			<p class="sub">
				Everyone but one is told a secret word. One is not. Talk it out, then vote out who
				you think it is.
			</p>
		</div>
	</div>
	<div class="tail">
		<div class="btns">
			{#if view?.can_open}
				<button class="btn o" disabled={busy} onclick={() => act({ action: 'open' })}>
					Open a lobby
				</button>
			{:else}
				<p class="note">Join a voice channel in this server to open a lobby.</p>
			{/if}
		</div>
		{@render badge()}
	</div>
{:else if round && screen === 'lobby'}
	<div class="hd">
		<div>
			<p class="st">
				{round.voice_channel_name ?? 'This'} voice channel · opened by {round.is_starter
					? 'you'
					: nameOf(round.starter_id)}
			</p>
			<h2 class="hl" style:color="var(--p)">{round.players.length} aboard</h2>
			<p class="sub">
				{round.min_players} needed · {round.players.length >= round.min_players
					? 'ready to start'
					: `${round.min_players - round.players.length} more to start`}
			</p>
		</div>
		<div class="panel" style="line-height:1.55;color:var(--l);font-size:1.1em">
			{#if round.round_seconds}Round {Math.round(round.round_seconds / 60)} min<br />{/if}
			{#if round.call_lock_seconds != null}Votes unlock after {round.call_lock_seconds} s<br
				/>{/if}
			{plural(round.calls_per_player, 'vote call')} each{round.meeting_seconds
				? ` · open ${round.meeting_seconds} s`
				: ''}<br />
			{round.mute_out ? 'Ejected players are muted' : 'Ejected players keep their mic'}
		</div>
	</div>
	{@render roster(others)}
	<div class="tail">
		<div class="btns">
			{#if round.is_starter}
				<button
					class="btn o"
					disabled={busy || round.players.length < round.min_players}
					onclick={() => act({ action: 'start', round_id: round.id })}
				>
					Start round
				</button>
			{/if}
			{#if !round.me.in}
				<button
					class="btn o"
					disabled={busy}
					onclick={() => act({ action: 'join', round_id: round.id })}
				>
					Join
				</button>
			{:else}
				<button
					class="btn b"
					disabled={busy}
					onclick={() => act({ action: 'leave', round_id: round.id })}
				>
					Leave
				</button>
			{/if}
			{#if round.is_starter}
				<button
					class="btn ghost"
					disabled={busy}
					onclick={() => act({ action: 'stop', round_id: round.id })}
				>
					Cancel
				</button>
			{/if}
			<p class="note">
				{round.is_starter
					? 'Only people in this voice channel can join'
					: 'Only people in this voice channel can join · the host starts it'}
			</p>
		</div>
		{@render badge()}
	</div>
{:else if round && screen === 'card'}
	{@const agent = round.me.role === 'agent'}
	<div class="hd">
		<div>
			<p class="st">The round begins · only you can see this card</p>
			<h2 class="hl" class:xl={!agent} style:color={accent}>
				{agent ? `You are the ${round.agent_name}` : `You are ${round.crew_name}`}
			</h2>
			<p class="sub">
				{#if agent}
					Everyone else knows a word. You do not. Listen, blend in, survive {Math.round(
						(round.round_seconds ?? 300) / 60
					)} minutes.
				{:else}
					One of the other {others.length} is the {round.agent_name}. Talk about the word
					without saying it.
				{/if}
			</p>
		</div>
		<LcarsClock label="Round" value={roundClock} pct={roundPct} colour={accent} />
	</div>
	<div class="panel word" style:--pc={accent}>
		<span class="st" style="font-size:1.3em">The word</span>
		{#if agent}
			<span class="w unknown" aria-label="You do not know the word">? ? ? ? ? ?</span>
			<span class="note">
				You win if the clock runs out<br />or only one other player is left
			</span>
		{:else}
			<span class="w" aria-live="polite">{hiding ? '• • • • • •' : round.me.word}</span>
			<button class="btn small ghost" {...hold}>Hold to hide</button>
			<span class="note">Covers the word if someone looks</span>
		{/if}
	</div>
	<div class="tail">
		<div class="btns">
			<button class="btn {agent ? 'r' : 'o'}" onclick={() => dismiss({ card: round.id })}>
				Got it
			</button>
		</div>
		{@render badge()}
	</div>
{:else if round && screen === 'round'}
	{@const agent = round.me.role === 'agent'}
	<div class="hd">
		<div>
			<p class="st">
				{#if agent}
					{round.agent_name} · you do not know the word
				{:else}
					{round.crew_name} · word:
					<button class="link" onclick={() => (wordShown = !wordShown)}>
						{wordShown ? round.me.word : 'show'}
					</button>
				{/if}
			</p>
			<h2 class="hl" style:color="var(--p)">Talk it out</h2>
			<p class="sub">
				{#if round.me.call === 'locked'}
					Votes unlock in {mss(msUntil(round.call_unlocks_at, now))}
				{:else if round.me.call === 'used'}
					You have used your vote {round.calls_per_player === 1 ? 'call' : 'calls'}
				{:else}
					Votes are open · call one when you are ready
				{/if}
			</p>
			{#if round.last_vote}
				<p class="st" style="margin-top:.4em">
					Vote {round.last_vote.number ?? ''}: {round.last_vote.ejected_name
						? `${round.last_vote.ejected_name} was ejected`
						: 'nobody was ejected'}
				</p>
			{/if}
		</div>
		<LcarsClock label="Time left" value={roundClock} pct={roundPct} />
	</div>
	{@render roster(others)}
	<div class="tail">
		<div class="btns">
			<button
				class="btn o"
				disabled={busy || round.me.call !== 'ok'}
				onclick={() => act({ action: 'call', round_id: round.id })}
			>
				{round.me.call === 'locked'
					? `Call a vote · ${mss(msUntil(round.call_unlocks_at, now))}`
					: round.me.call === 'used'
						? 'No vote calls left'
						: 'Call a vote'}
			</button>
			{#if round.is_starter}
				<button
					class="btn ghost small"
					disabled={busy}
					onclick={() => act({ action: 'stop', round_id: round.id })}
				>
					End the round
				</button>
			{/if}
			<p class="note">{living.length} playing · 1 {round.agent_name} among them</p>
		</div>
		{@render badge()}
	</div>
{:else if round && round.meeting && screen === 'vote'}
	{@const m = round.meeting}
	{@const picked = m.my_vote && m.my_vote !== 'skip' ? m.my_vote : null}
	{@const pickedPlayer = round.players.find((p) => p.id === picked) ?? null}
	<div class="hd">
		<div>
			<p class="st">
				{m.caller_id === viewer.id ? 'You' : nameOf(m.caller_id)} called a vote · tap a player
				or skip · change it until it closes
			</p>
			<h2 class="hl md" style:color={accent}>Who is the {round.agent_name}?</h2>
		</div>
		<LcarsClock
			label="Closes in"
			value={mss(msUntil(m.closes_at, now))}
			pct={pctLeft(m.closes_at, round.meeting_seconds, now)}
		/>
	</div>
	{#if pickedPlayer}
		<div class="banner" aria-live="polite">
			<Avatar id={pickedPlayer.id} name={pickedPlayer.name} src={pickedPlayer.avatar} />
			<div class="who">
				<div class="k">Your vote</div>
				<div class="n">{pickedPlayer.name}</div>
			</div>
			<div class="ic" aria-hidden="true">◎</div>
		</div>
	{:else if m.my_vote === 'skip'}
		<div class="banner skip" aria-live="polite">
			<div class="who">
				<div class="k">Your vote</div>
				<div class="n">Skip</div>
			</div>
		</div>
	{/if}
	<ul class="ros" aria-label="Pick a player">
		{#each others as p (p.id)}
			{@const isPick = p.id === picked}
			{@const voted = (m.voted_ids ?? []).includes(p.id)}
			<li>
				{#if p.state === 'ejected'}
					<PlayerCard
						id={p.id}
						name={p.name}
						avatar={p.avatar}
						status={status(p)}
						icon="✕"
						variant="out"
					/>
				{:else}
					<PlayerCard
						id={p.id}
						name={p.name}
						avatar={p.avatar}
						status={isPick ? '◎ Your vote' : voted ? 'Voted' : 'Deciding'}
						icon={isPick ? '' : voted ? '✓' : '…'}
						variant={isPick ? 'pick' : m.my_vote ? 'dimv' : ''}
						pressed={isPick}
						disabled={busy}
						onpick={() => act({ action: 'vote', round_id: round.id, target: p.id })}
					/>
				{/if}
			</li>
		{/each}
	</ul>
	<div class="tail">
		<div class="btns">
			<button
				class="btn b"
				aria-pressed={m.my_vote === 'skip'}
				disabled={busy || m.my_vote === 'skip'}
				onclick={() => act({ action: 'vote', round_id: round.id, target: 'skip' })}
			>
				{m.my_vote === 'skip' ? 'Skipping' : m.my_vote ? 'Skip instead' : 'Skip'}
			</button>
			<p class="note">{m.voted} of {m.living} voted · no one sees who voted for whom</p>
		</div>
		{@render badge()}
	</div>
{:else if round && screen === 'ejected' && round.last_vote}
	{@const lv = round.last_vote}
	<div class="hd">
		<div>
			<p class="st">Vote {lv.number ?? ''} · the round goes on</p>
			<h2 class="hl" style:color={accent}>
				{lv.ejected_name ? `${lv.ejected_name} is out` : 'Nobody is out'}
			</h2>
			<p class="sub">
				{lv.ejected_name
					? `They were not the ${round.agent_name}. The round goes on.`
					: 'A tie, or skip on top. The round goes on.'}
			</p>
		</div>
		<LcarsClock label="Time left" value={roundClock} pct={roundPct} />
	</div>
	{@render roster(others)}
	<div class="tail">
		<div class="btns">
			<button class="btn o" onclick={() => dismiss({ vote: lv.meeting_id ?? null })}>
				Back to the round
			</button>
			<p class="note">
				{living.length} left · if only 2 remain, the {round.agent_name} wins
			</p>
		</div>
		{@render badge()}
	</div>
{:else if round && (screen === 'out' || screen === 'watch')}
	{@const out = screen === 'out'}
	{@const lv = round.last_vote}
	<div class="hd">
		<div>
			<p class="st">
				{#if out}
					{lv && lv.ejected_id === viewer.id && lv.number
						? `Ejected in vote ${lv.number}`
						: 'Ejected'} · you can still listen
				{:else}
					A round is running in this voice channel
				{/if}
			</p>
			<h2 class="hl" style:color="#888">{out ? 'You are out' : 'Not in this round'}</h2>
			<p class="sub" style:color="#888">
				{#if out}
					{round.mute_out ? 'You are muted until the round ends. ' : ''}You cannot vote or
					call. Please don't help from outside.
				{:else}
					You can watch the clock. Join the next lobby to play.
				{/if}
			</p>
		</div>
		<LcarsClock label="Time left" value={roundClock} pct={roundPct} colour="#888" />
	</div>
	{@render roster(others)}
	{#if round.meeting}
		<p class="note">
			{nameOf(round.meeting.caller_id)} called a vote · {round.meeting.voted} of {round
				.meeting.living} voted
		</p>
	{/if}
	<div class="tail">
		{#if out && round.mute_out}
			<p class="note">Your mute is lifted the moment the round ends</p>
		{/if}
		{@render badge()}
	</div>
{:else if round && screen === 'over' && round.result}
	{@const res = round.result}
	{@const w = winner(res.code)}
	{@const agentRole = res.roles.find((p) => p.id === res.agent_id) ?? null}
	<div class="hd">
		<div>
			<p class="st">{res.text}</p>
			<h2 class="hl xl" style:color={accent}>
				{w === 'crew'
					? `${round.crew_name} wins`
					: w === 'agent'
						? `${round.agent_name} wins`
						: res.code === 'abandoned'
							? 'Round abandoned'
							: 'Round cancelled'}
			</h2>
			{#if res.word}
				<p class="sub">The word was <span style="color:var(--o)">{res.word}</span></p>
			{/if}
		</div>
		{#if agentRole}
			<div class="panel reveal" style:--pc="var(--rr)">
				<div class="st">The {round.agent_name}</div>
				<Avatar id={agentRole.id} name={agentRole.name} src={agentRole.avatar} />
				<div class="nm">{agentRole.id === viewer.id ? 'You' : agentRole.name}</div>
			</div>
		{/if}
	</div>
	{#if res.roles.length}
		<ul class="ros" aria-label="Roles">
			{#each res.roles.filter((p) => p.id !== viewer.id) as p (p.id)}
				{@const isAgent = p.role === 'agent'}
				<li>
					<PlayerCard
						id={p.id}
						name={p.name}
						avatar={p.avatar}
						status={(isAgent ? round.agent_name : round.crew_name) +
							(p.state === 'ejected' ? ' · ejected' : isAgent ? ' · survived' : '')}
						variant={isAgent ? 'agent' : p.state === 'ejected' ? 'out' : ''}
					/>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="tail">
		<div class="btns">
			{#if view?.can_open}
				<button class="btn o" disabled={busy} onclick={() => act({ action: 'open' })}>
					Play again
				</button>
			{/if}
			<button class="btn b" onclick={() => dismiss({ over: round.id })}>Close</button>
			<p class="note">Roles stay visible for 10 minutes</p>
		</div>
		{@render badge()}
	</div>
{/if}

{#if problem}
	<p class="problem" role="alert">{problem}</p>
{/if}

<style>
	.word {
		display: flex;
		align-items: center;
		gap: 0.9em 1.8em;
		flex-wrap: wrap;
	}
	.word .w {
		font-size: min(2.9em, 11vw);
		color: var(--o);
		font-weight: 600;
		letter-spacing: 0.15em;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.word .w.unknown {
		color: var(--unknown);
	}
	.word :global(.btn.small) {
		user-select: none;
		-webkit-user-select: none;
		touch-action: none;
	}
	.banner {
		display: flex;
		align-items: center;
		gap: 1.2em;
		padding: 0.64em 1.8em 0.64em 0.64em;
		border-radius: 3.2em;
		background: var(--rr);
		color: var(--ink);
		align-self: flex-start;
		max-width: 100%;
		min-width: 0;
		box-shadow:
			0 0 0 0.23em var(--ink),
			0 0 0 0.5em var(--white);
		margin: 0.5em 0 0.3em 0.5em;
	}
	.banner.skip {
		background: var(--b);
		padding-left: 1.8em;
	}
	.banner :global(.av) {
		width: 4.7em;
		height: 4.7em;
		border: 0.23em solid var(--ink);
	}
	.banner :global(.av span) {
		font-size: 2.4em;
	}
	.banner .who {
		min-width: 0;
	}
	.banner .k {
		font-size: 1.1em;
		opacity: 0.75;
	}
	.banner .n {
		font-size: min(3em, 12vw);
		line-height: 1;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.banner .ic {
		font-size: 2.9em;
		margin-left: 0.3em;
	}
	.reveal {
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.45em;
		min-width: 8em;
		max-width: 100%;
	}
	.reveal :global(.av) {
		width: 5.5em;
		height: 5.5em;
	}
	.reveal :global(.av span) {
		font-size: 2.7em;
	}
	.reveal .nm {
		font-size: 1.8em;
		color: var(--rr);
		overflow-wrap: anywhere;
	}
	/* A phone is short: the picked row already says "Your vote", so the big banner
	   would only push the list and Skip off the screen. */
	@media (max-width: 760px) {
		.banner {
			display: none;
		}
	}
</style>
