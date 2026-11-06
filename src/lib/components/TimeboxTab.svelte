<script lang="ts">
	/**
	 * The Activity's Timebox tab: the viewer's timeboxes with a big countdown, one
	 * bar per focus block, and pause, skip and stop. The page fetches, polls and
	 * sends the controls; this only draws.
	 */
	import {
		TB_PHASE,
		mmss,
		tbLeft,
		tbNext,
		tbSegments,
		type TimeboxLike,
	} from '$lib/activity/lcars.js';

	type Timebox = TimeboxLike & {
		id: number;
		kind: 'solo' | 'shared';
		mine: boolean;
		deafen: 'none' | 'focus' | 'whole';
		goal?: string | null;
	};

	type Other = TimeboxLike & { name: string; avatar_url: string | null };

	const {
		timeboxes,
		others = [],
		loaded,
		now,
		help,
		act,
		busy,
		error,
	}: {
		timeboxes: Timebox[];
		others?: Other[];
		loaded: boolean;
		now: number;
		help: { summary: string; start: string };
		act: (id: number, action: 'pause' | 'resume' | 'skip' | 'stop') => void;
		busy: boolean;
		error: string;
	} = $props();
</script>

{#snippet crew()}
	{#if others.length > 0}
		<section class="crew" aria-label="Other timers in your voice channel">
			<p class="st">In your voice channel</p>
			<ul>
				{#each others as o (o.name + o.ends_at + o.phase)}
					<li>
						<span class="who">{o.name}</span>
						<span
							class="ph"
							style:color={o.phase === 'focus' ? 'var(--o)' : 'var(--s)'}
						>
							{TB_PHASE[o.phase]}{o.status === 'paused' ? ' · paused' : ''}
						</span>
						<span class="clock" role="timer" aria-live="off"
							>{mmss(tbLeft(o, now))}</span
						>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
{/snippet}

{#if timeboxes.length > 0}
	{#each timeboxes as tb, i (tb.id)}
		{@const next = tbNext(tb)}
		{@const colour = tb.phase === 'focus' ? 'var(--o)' : 'var(--s)'}
		<section class="tbx" class:first={i === 0} aria-label="{TB_PHASE[tb.phase]} countdown">
			<p class="st">
				{tb.rounds === 1
					? TB_PHASE[tb.phase]
					: tb.phase === 'focus'
						? `Focus block ${tb.block_number} of ${tb.rounds}`
						: `${TB_PHASE[tb.phase]} after block ${tb.block_number} of ${tb.rounds}`}
				· {tb.kind === 'shared' ? 'shared with the voice channel' : 'just you'}
				{tb.status === 'paused' ? ' · paused' : ''}
			</p>
			<div class="big" style:color={colour} role="timer" aria-live="off">
				{mmss(tbLeft(tb, now))}
			</div>
			<div class="segs" aria-hidden="true">
				{#each tbSegments(tb, now) as fill, n (n)}
					<span><i style:width="{fill * 100}%" style:background={colour}></i></span>
				{/each}
			</div>
			{#if next}
				<p class="st">
					Then: {TB_PHASE[next.phase].toLowerCase()} · {next.minutes} minutes
				</p>
			{/if}
			<div class="ctl">
				{#if tb.status === 'paused'}
					<button class="btn o" disabled={busy} onclick={() => act(tb.id, 'resume')}
						>Resume</button
					>
				{:else}
					<button class="btn o" disabled={busy} onclick={() => act(tb.id, 'pause')}
						>Pause</button
					>
				{/if}
				{#if next}
					<button class="btn" disabled={busy} onclick={() => act(tb.id, 'skip')}
						>Skip</button
					>
				{/if}
				<button class="btn" disabled={busy} onclick={() => act(tb.id, 'stop')}>Stop</button>
			</div>
			{#if tb.goal}
				<p class="note">Your goal: {tb.goal}</p>
			{/if}
			{#if tb.deafen !== 'none'}
				<p class="note">
					You asked to be deafened and muted {tb.deafen === 'whole'
						? 'until it ends'
						: 'during focus blocks'}.
				</p>
			{/if}
		</section>
	{/each}
	{#if error}<p class="note">{error}</p>{/if}
	{@render crew()}
{:else if !loaded}
	<p class="st">Looking for your timebox…</p>
{:else}
	<p class="st">Standing by</p>
	<h2 class="hl md">No timebox running</h2>
	<p class="sub">{help.summary}</p>
	<p class="st">{help.start}</p>
	{@render crew()}
{/if}

<style>
	.crew {
		margin-top: 1.4em;
	}
	.crew ul {
		list-style: none;
		margin: 0.4em 0 0;
		padding: 0;
		display: grid;
		gap: 0.35em;
		max-width: 42em;
	}
	.crew li {
		display: flex;
		align-items: baseline;
		gap: 0.8em;
		padding: 0.35em 0.8em;
		border-radius: 0.2em 0.6em 0.6em 0.2em;
		background: var(--well);
	}
	.crew .who {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.crew .clock {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.06em;
	}
	.tbx {
		display: flex;
		flex-direction: column;
		gap: 0.6em;
	}
	.tbx + .tbx {
		margin-top: 1em;
	}
	.big {
		font-size: min(4.5em, 22vw);
		line-height: 1;
		padding-bottom: 0.06em;
		font-weight: 700;
		letter-spacing: 0.06em;
		font-variant-numeric: tabular-nums;
	}
	.first .big {
		font-size: min(9.1em, 30vw);
	}
	/* One bar per focus block: a track cut into tenths, filled from the left, square at
	   the start and rounded at the end like an LCARS elbow. */
	.segs {
		display: flex;
		gap: 0.55em;
		max-width: 42em;
		margin: 0.5em 0 0.35em;
	}
	.segs span {
		flex: 1;
		height: 0.95em;
		border-radius: 0.2em 0.5em 0.5em 0.2em;
		background: var(--well);
		overflow: hidden;
		/* cut into tenths: only the alpha matters */
		mask-image: repeating-linear-gradient(
			90deg,
			currentColor 0,
			currentColor calc(10% - 0.14em),
			transparent calc(10% - 0.14em),
			transparent 10%
		);
	}
	.segs i {
		display: block;
		height: 100%;
		border-radius: 0.2em 0 0 0.2em;
		transition: width 1s linear;
	}
	.ctl {
		display: flex;
		gap: 0.7em;
		flex-wrap: wrap;
		margin-top: 0.9em;
	}
	.first .st:last-of-type {
		font-size: 1.3em;
	}
</style>
