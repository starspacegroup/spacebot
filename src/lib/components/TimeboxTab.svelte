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
	};

	const { timeboxes, loaded, now, help, act, busy, error } = $props<{
		timeboxes: Timebox[];
		loaded: boolean;
		now: number;
		help: { summary: string; start: string };
		act: (id: number, action: 'pause' | 'resume' | 'skip' | 'stop') => void;
		busy: boolean;
		error: string;
	}>();
</script>

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
			{#if tb.deafen !== 'none'}
				<p class="note">
					You asked to be deafened {tb.deafen === 'whole'
						? 'until it ends'
						: 'during focus blocks'}.
				</p>
			{/if}
		</section>
	{/each}
	{#if error}<p class="note">{error}</p>{/if}
{:else if !loaded}
	<p class="st">Looking for your timebox…</p>
{:else}
	<p class="st">Standing by</p>
	<h2 class="hl md">No timebox running</h2>
	<p class="sub">{help.summary}</p>
	<p class="st">{help.start}</p>
{/if}

<style>
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
		line-height: 0.9;
		font-weight: 700;
		letter-spacing: 0.06em;
		font-variant-numeric: tabular-nums;
	}
	.first .big {
		font-size: min(9.1em, 30vw);
	}
	.segs {
		display: flex;
		gap: 0.55em;
		max-width: 42em;
	}
	.segs span {
		flex: 1;
		height: 1.27em;
		border-radius: 0.64em;
		background: var(--well);
		overflow: hidden;
	}
	.segs i {
		display: block;
		height: 100%;
	}
	.ctl {
		display: flex;
		gap: 0.6em;
		flex-wrap: wrap;
	}
	.first .st:last-of-type {
		font-size: 1.3em;
	}
</style>
