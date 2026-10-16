<script lang="ts">
	/**
	 * The Activity's Game tab: the hidden-agent round, played here.
	 *
	 * Everything private to a player (their role, the secret word, their ballot)
	 * is drawn from the server's view for this viewer, which never contains
	 * anyone else's role until the round has ended. The page polls that view
	 * every couple of seconds and after every move, and runs the clock locally
	 * from the end times it is given.
	 */
	import { onMount } from 'svelte';

	type Player = { id: string; name: string; state: 'in' | 'ejected' };
	type Round = {
		id: number;
		status: 'lobby' | 'running' | 'ended';
		agent_name: string;
		crew_name: string;
		min_players: number;
		calls_per_player: number;
		started_at: number | null;
		ends_at: number | null;
		call_unlocks_at: number | null;
		is_starter: boolean;
		players: Player[];
		me: {
			in: boolean;
			state: 'in' | 'ejected' | null;
			role: 'agent' | 'crew' | null;
			word: string | null;
			calls_left: number;
			call: 'ok' | 'no_round' | 'not_in' | 'out' | 'open' | 'locked' | 'used';
		};
		meeting: null | {
			id: number;
			caller_id: string;
			closes_at: number;
			voted: number;
			living: number;
			my_vote: string | null;
		};
		last_vote: null | { ejected_id: string | null; ejected_name: string | null };
		result: null | {
			code: string;
			text: string;
			agent_id: string | null;
			word: string | null;
			roles: { id: string; name: string; role: 'agent' | 'crew' | null; state: string }[];
		};
	};
	type View = { voice_channel_id: string | null; can_open: boolean; round: Round | null };

	const {
		base,
		token,
		guildId,
		viewerId,
		preview = null,
	} = $props<{
		base: string;
		token: string;
		guildId: string;
		viewerId: string;
		/** Dev only: a canned view, so layouts can be checked without Discord. */
		preview?: View | null;
	}>();

	let view = $state<View | null>(null);
	let problem = $state('');
	let busy = $state(false);
	let showWord = $state(true);
	let now = $state(Date.now());

	const round = $derived(view?.round ?? null);
	const nameOf = (id: string) => round?.players.find((p) => p.id === id)?.name ?? 'Someone';
	const living = $derived(round?.players.filter((p) => p.state === 'in') ?? []);

	function clock(unix: number | null): string {
		if (!unix) return '--:--';
		const total = Math.max(0, Math.ceil((unix * 1000 - now) / 1000));
		return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
	}

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
		if (preview) view = preview;
		else load();
		const poll = setInterval(load, 2500);
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => {
			clearInterval(poll);
			clearInterval(tick);
		};
	});

	const callLabel = $derived.by(() => {
		if (!round) return '';
		switch (round.me.call) {
			case 'ok':
				return 'Call a vote';
			case 'locked':
				return `Votes unlock in ${clock(round.call_unlocks_at)}`;
			case 'used':
				return 'You have used your call';
			case 'open':
				return 'A vote is open';
			case 'out':
				return 'You are out';
			default:
				return 'Call a vote';
		}
	});
</script>

<div class="game">
	{#if !view}
		<p class="quiet">Looking for a round…</p>
	{:else if !round}
		<p>No round in your voice channel.</p>
		{#if view.can_open}
			<button class="btn primary" disabled={busy} onclick={() => act({ action: 'open' })}>
				Open a lobby
			</button>
			<p class="quiet">
				Everyone but one is told a secret word. One is not. Talk it out, then vote out who
				you think it is.
			</p>
		{:else}
			<p class="quiet">Join a voice channel here to open a lobby.</p>
		{/if}
	{:else if round.status === 'lobby'}
		<h3>Lobby</h3>
		<p class="quiet">
			{round.players.length} of {round.min_players} needed. Everyone but one is told a secret word;
			one is the {round.agent_name} and is not.
		</p>
		<ul class="players">
			{#each round.players as p (p.id)}
				<li>{p.name}{p.id === viewerId ? ' (you)' : ''}</li>
			{/each}
		</ul>
		<div class="row">
			{#if !round.me.in}
				<button
					class="btn primary"
					disabled={busy}
					onclick={() => act({ action: 'join', round_id: round.id })}
				>
					Join
				</button>
			{:else}
				<button
					class="btn"
					disabled={busy}
					onclick={() => act({ action: 'leave', round_id: round.id })}
				>
					Leave
				</button>
			{/if}
			{#if round.is_starter}
				<button
					class="btn primary"
					disabled={busy || round.players.length < round.min_players}
					onclick={() => act({ action: 'start', round_id: round.id })}
				>
					Start the round
				</button>
				<button
					class="btn danger"
					disabled={busy}
					onclick={() => act({ action: 'stop', round_id: round.id })}
				>
					Cancel
				</button>
			{:else}
				<span class="quiet">Waiting for the person who opened it to start.</span>
			{/if}
		</div>
	{:else if round.status === 'running'}
		{#if !round.me.in}
			<p class="quiet">A round is running. You are not in it; you can watch the clock.</p>
		{:else}
			<div class="role" class:agent={round.me.role === 'agent'}>
				{#if round.me.role === 'agent'}
					<span class="kicker">You are the</span>
					<strong class="big">{round.agent_name}</strong>
					<span
						>You do not know the word. Listen, blend in, and do not get voted out.</span
					>
				{:else}
					<span class="kicker">You are a {round.crew_name} player. The word is</span>
					{#if showWord}
						<strong class="big">{round.me.word}</strong>
					{:else}
						<strong class="big hidden">••••••</strong>
					{/if}
					<button class="link" onclick={() => (showWord = !showWord)}>
						{showWord ? 'Hide the word' : 'Show the word'}
					</button>
					<span>Hint at it without saying it. One of you does not know it.</span>
				{/if}
			</div>
		{/if}

		<div class="clock" aria-live="off">
			<span class="clock-num">{clock(round.ends_at)}</span>
			<span class="quiet">left in the round</span>
		</div>

		{#if round.last_vote && !round.meeting}
			<p class="quiet">
				Last vote: {round.last_vote.ejected_name
					? `${round.last_vote.ejected_name} was ejected.`
					: 'nobody was ejected.'}
			</p>
		{/if}

		{#if round.meeting}
			<div class="meeting">
				<strong>{nameOf(round.meeting.caller_id)} called a vote</strong>
				<span class="quiet">
					closes in {clock(round.meeting.closes_at)} · {round.meeting.voted} of {round
						.meeting.living}
					voted
				</span>
				{#if round.me.state === 'in'}
					<div class="ballot" role="group" aria-label="Your vote">
						{#each living.filter((p) => p.id !== viewerId) as p (p.id)}
							<button
								class="pick"
								class:chosen={round.meeting.my_vote === p.id}
								disabled={busy}
								aria-pressed={round.meeting.my_vote === p.id}
								onclick={() =>
									act({ action: 'vote', round_id: round.id, target: p.id })}
							>
								{p.name}
							</button>
						{/each}
						<button
							class="pick"
							class:chosen={round.meeting.my_vote === 'skip'}
							disabled={busy}
							aria-pressed={round.meeting.my_vote === 'skip'}
							onclick={() =>
								act({ action: 'vote', round_id: round.id, target: 'skip' })}
						>
							Skip
						</button>
					</div>
					<span class="quiet">You can change your vote until it closes.</span>
				{:else}
					<span class="quiet">You are out, so you cannot vote. You can still listen.</span
					>
				{/if}
			</div>
		{:else if round.me.in}
			<button
				class="btn primary"
				disabled={busy || round.me.call !== 'ok'}
				onclick={() => act({ action: 'call', round_id: round.id })}
			>
				{callLabel}
			</button>
		{/if}

		<h3>Players</h3>
		<ul class="players">
			{#each round.players as p (p.id)}
				<li class:out={p.state === 'ejected'}>
					{p.name}{p.id === viewerId ? ' (you)' : ''}{p.state === 'ejected'
						? ' · ejected'
						: ''}
				</li>
			{/each}
		</ul>
		{#if round.is_starter}
			<button
				class="link"
				disabled={busy}
				onclick={() => act({ action: 'stop', round_id: round.id })}
			>
				End the round
			</button>
		{/if}
	{:else if round.result}
		<h3>{round.result.text}</h3>
		{#if round.result.agent_id}
			<p>
				The {round.agent_name} was <strong>{nameOf(round.result.agent_id)}</strong>. The
				word was
				<strong>{round.result.word}</strong>.
			</p>
			<ul class="players">
				{#each round.result.roles as p (p.id)}
					<li class:out={p.state === 'ejected'}>
						{p.name} · {p.role === 'agent'
							? round.agent_name
							: round.crew_name}{p.state === 'ejected' ? ' · ejected' : ''}
					</li>
				{/each}
			</ul>
		{/if}
		{#if view.can_open}
			<button class="btn primary" disabled={busy} onclick={() => act({ action: 'open' })}>
				Play again
			</button>
		{/if}
	{/if}

	{#if problem}
		<p class="problem" role="alert">{problem}</p>
	{/if}
</div>

<style>
	.game {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	h3 {
		margin: 0.25rem 0 0;
		font-size: 1rem;
	}
	.quiet {
		color: var(--color-text-secondary);
		margin: 0;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.btn {
		background: var(--color-surface);
		color: inherit;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		padding: 0.5rem 1rem;
		font: inherit;
		cursor: pointer;
	}
	.btn.primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-fixed-text-bright);
		font-weight: 600;
	}
	.btn.danger {
		border-color: var(--color-danger);
		color: var(--color-danger);
	}
	.btn:disabled,
	.pick:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-text-secondary);
		text-decoration: underline;
		font: inherit;
		cursor: pointer;
		align-self: flex-start;
	}
	.players {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.players li {
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0.15rem 0.7rem;
	}
	.players li.out {
		text-decoration: line-through;
		color: var(--color-text-secondary);
	}
	.role {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.9rem 1rem;
	}
	.role.agent {
		border-color: var(--color-danger);
	}
	.kicker {
		color: var(--color-text-secondary);
	}
	.big {
		font-size: clamp(1.5rem, 9vw, 2rem);
		line-height: 1.1;
		overflow-wrap: anywhere;
	}
	.big.hidden {
		letter-spacing: 0.2em;
	}
	.clock {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}
	.clock-num {
		font:
			700 clamp(1.75rem, 11vw, 2.25rem) / 1 ui-monospace,
			monospace;
		font-variant-numeric: tabular-nums;
	}
	.meeting {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border: 1px solid var(--color-primary);
		border-radius: 0.75rem;
		padding: 0.9rem 1rem;
	}
	.ballot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.pick {
		background: var(--color-surface);
		color: inherit;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		padding: 0.5rem 0.9rem;
		font: inherit;
		cursor: pointer;
	}
	.pick.chosen {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-fixed-text-bright);
		font-weight: 600;
	}
	.problem {
		color: var(--color-danger);
		margin: 0;
	}
</style>
