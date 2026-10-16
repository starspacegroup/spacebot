<script lang="ts">
	/**
	 * The Activity's Timebox tab, read-only: the viewer's timeboxes with a big
	 * countdown and one bar per focus block. The page fetches and polls; this
	 * only draws. Controls stay on the card in the channel.
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

	const { timeboxes, loaded, now, help } = $props<{
		timeboxes: Timebox[];
		loaded: boolean;
		now: number;
		help: { summary: string; start: string };
	}>();
</script>

{#if timeboxes.length > 0}
	{#each timeboxes as tb, i (tb.id)}
		{@const next = tbNext(tb)}
		{@const colour = tb.phase === 'focus' ? 'var(--o)' : 'var(--s)'}
		<section class="tbx" class:first={i === 0} aria-label="{TB_PHASE[tb.phase]} countdown">
			<p class="st">
				{tb.phase === 'focus'
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
			<p class="st">
				{next
					? `Next: ${TB_PHASE[next.phase].toLowerCase()} · ${next.minutes} minutes`
					: 'Last block · then done'}
				· {tb.focus_minutes}/{tb.break_minutes}/{tb.long_break_minutes} min
			</p>
			{#if tb.deafen !== 'none'}
				<p class="note">
					You asked to be deafened {tb.deafen === 'whole'
						? 'until it ends'
						: 'during focus blocks'}.
				</p>
			{/if}
		</section>
	{/each}
	<p class="note">Pause, skip and stop are on the card in the channel for now.</p>
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
	.first .st:last-of-type {
		font-size: 1.3em;
	}
</style>
