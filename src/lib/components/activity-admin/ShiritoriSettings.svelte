<script lang="ts">
	/**
	 * Shiritori settings, inside its card on the Activity admin page. Posts to
	 * `?/saveShiritori`. The on/off switch is the card's, so this form no longer
	 * carries `enabled`; the action keeps the stored value when it is absent.
	 */
	import { enhance } from '$app/forms';
	import type { GameSettingsProps } from './game-settings.js';

	const { data, keepValues }: GameSettingsProps = $props();

	const channelName = $derived(
		data.shiritoriChannels.find((c) => c.id === data.shiritoriHealth?.channelId)?.name ?? ''
	);
</script>

{#if data.shiritoriHealth}
	<p class="sb-warning" role="alert">
		<strong>SpaceBot could not post there.</strong>
		{data.shiritoriHealth.message}{data.shiritoriHealth.status
			? ` (error ${data.shiritoriHealth.status})`
			: ''}{channelName ? ` in #${channelName}` : ''}, at {data.shiritoriHealth.at
			.slice(0, 16)
			.replace('T', ' ')} UTC.
		{data.shiritoriHealth.hint}
		Saving these settings clears this notice.
	</p>
{/if}
<p class="sb-note">
	Pick a Chain channel for an always-on chain, or run <code>/game shiritori channel:#name</code>
	in Discord (managers only; <code>off:True</code> turns it off). A word that ends in the dead letter
	ends the chain, or puts a player out of a round.
</p>
<form method="POST" action="?/saveShiritori" use:enhance={keepValues} class="sb-settings-form">
	<label class="wide">
		Chain channel
		<select name="chainChannelId" value={data.shiritori.chainChannelId ?? ''}>
			<option value="">None (rounds only)</option>
			{#each data.shiritoriChannels as channel (channel.id)}
				<option value={channel.id}>#{channel.name}</option>
			{/each}
		</select>
		<span class="hint">
			A word that fits gets a ✅. A word that was already used gets a ❌ and breaks the chain.
			Chat is ignored: several words, a word that is not in the dictionary or does not start
			with the right letter, and anything that starts with <code>//</code>.
		</span>
	</label>
	<label>
		Turn clock (seconds)
		<input
			type="number"
			name="turnSeconds"
			min={data.shiritoriLimits.turnSeconds[0]}
			max={data.shiritoriLimits.turnSeconds[1]}
			value={data.shiritori.turnSeconds}
			required
		/>
	</label>
	<label>
		Dead letters
		<input
			type="text"
			name="deadLetters"
			maxlength="8"
			value={data.shiritori.deadLetters}
			autocomplete="off"
		/>
		<span class="hint">One is drawn for each chain or round.</span>
	</label>
	<label class="check">
		<input type="checkbox" name="hardMode" checked={data.shiritori.hardMode} />
		<span class="check-text">
			<span>Hard mode</span>
			<span class="hint">The next word starts with the last two letters.</span>
		</span>
	</label>
	<label class="wide">
		Community words
		<textarea name="allowWords" rows="3" value={data.shiritori.allowWords}></textarea>
		<span class="hint">Words the dictionary lacks and your server accepts, one per line.</span>
	</label>
	<label class="wide">
		Blocked words
		<textarea name="blockWords" rows="3" value={data.shiritori.blockWords}></textarea>
		<span class="hint">Words your server refuses, one per line.</span>
	</label>
	<div class="actions">
		<button type="submit" class="sb-btn-primary">Save Shiritori settings</button>
	</div>
</form>
{#if data.shiritori.chainChannelId}
	<form method="POST" action="?/resetShiritoriChain" use:enhance={keepValues} class="reset">
		<button type="submit" class="sb-btn-secondary">Reset the chain</button>
	</form>
{/if}
{#if data.shiritoriBoard.rows.length}
	<h4 class="board-title">Leaderboard</h4>
	<p class="sb-note">Server record: {data.shiritoriBoard.record} words in one chain.</p>
	<div class="board-scroll">
		<table class="board">
			<thead>
				<tr>
					<th scope="col">Member</th>
					<th scope="col" class="num">Words</th>
					<th scope="col" class="num">Chains broken</th>
					<th scope="col" class="num">Rounds won</th>
					<th scope="col">Longest</th>
				</tr>
			</thead>
			<tbody>
				{#each data.shiritoriBoard.rows as row (row.userId)}
					<tr>
						<td>{row.name}</td>
						<td class="num">{row.wordsAdded}</td>
						<td class="num">{row.chainsBroken}</td>
						<td class="num">{row.roundsWon}</td>
						<td>{row.longestWord ?? '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.reset {
		margin-top: 0.75rem;
	}

	.board-title {
		margin: 1.5rem 0 0.25rem;
		font-size: 1.05rem;
		color: var(--color-text);
	}

	.board-scroll {
		overflow-x: auto;
	}

	.board {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.95rem;
	}

	.board th,
	.board td {
		padding: 0.45rem 0.6rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.board th {
		color: var(--color-text-muted);
		font-weight: 600;
	}

	.board .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
