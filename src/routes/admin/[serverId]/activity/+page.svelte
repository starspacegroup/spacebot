<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from '$lib/toast.svelte.js';

	const { data, form } = $props();

	// `use:enhance` resets a form after a successful save, and a reset puts every
	// field back to its HTML default. These fields are set as properties, so the
	// default is empty: the form blanked itself right after saving. Keep what the
	// admin typed; the page's data refreshes behind it.
	const keepValues =
		() =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
		};

	$effect(() => {
		if (form?.message) {
			if (form.success) toast.success(form.message);
			else toast.error(form.message);
		}
	});
</script>

<svelte:head>
	<title>Activity · {data.guild?.name || 'Server'} · SpaceBot</title>
</svelte:head>

<div class="activity-page">
	<header class="page-header">
		<a href="/admin/{data.serverId}" class="back-link">← Back to dashboard</a>
		<h1>🚀 Activity</h1>
		<p class="page-desc">
			The SpaceBot Activity runs inside a voice channel for your members. This page turns its
			parts on for this server and sets their defaults.
		</p>
	</header>

	<section class="card">
		<h2>How members open it</h2>
		<p>
			A member joins a voice channel, opens <strong>Activities</strong> (the rocket button),
			and picks
			<strong>SpaceBot</strong>. It also launches from a DM with a member of this server.
			Nothing here has to be on for the Activity to open; the parts below decide what it
			shows.
		</p>
	</section>

	<section class="card">
		<h2>Parts of the Activity</h2>
		<p class="muted">A part you switch off also hides its slash command from members.</p>
		{#each data.modules as mod (mod.id)}
			<form method="POST" action="?/toggleModule" use:enhance={keepValues} class="module-row">
				<input type="hidden" name="module" value={mod.id} />
				<div class="module-info">
					<span class="module-name">{mod.name}</span>
					<span class="module-desc">{mod.summary}</span>
					<span class="module-desc">{mod.start}</span>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						name="enabled"
						checked={mod.enabled}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
					/>
					<span>{mod.enabled ? 'On' : 'Off'}</span>
				</label>
			</form>
		{/each}
	</section>

	<section class="card">
		<h2>Timebox defaults</h2>
		<p class="muted">
			What <code>/timebox start</code> uses when a member does not choose. Members can still override
			each one when they start.
		</p>
		<form method="POST" action="?/saveTimebox" use:enhance={keepValues} class="settings-form">
			<label>
				Focus (minutes)
				<input
					type="number"
					name="focus"
					min={data.limits.focus[0]}
					max={data.limits.focus[1]}
					value={data.timebox.focus}
					required
				/>
			</label>
			<label>
				Break (minutes)
				<input
					type="number"
					name="break"
					min={data.limits.break[0]}
					max={data.limits.break[1]}
					value={data.timebox.break}
					required
				/>
			</label>
			<label>
				Long break (minutes)
				<input
					type="number"
					name="longBreak"
					min={data.limits.longBreak[0]}
					max={data.limits.longBreak[1]}
					value={data.timebox.longBreak}
					required
				/>
			</label>
			<label>
				Rounds
				<input
					type="number"
					name="rounds"
					min={data.limits.rounds[0]}
					max={data.limits.rounds[1]}
					value={data.timebox.rounds}
					required
				/>
			</label>
			<label class="wide">
				Who can pause, skip or stop a shared timebox
				<select name="control" value={data.timebox.control}>
					<option value="crew">Moderators and the starter</option>
					<option value="anyone">Anyone in the timebox</option>
				</select>
			</label>
			<button type="submit" class="btn-primary">Save defaults</button>
		</form>
	</section>

	<section class="card">
		<h2>Game settings</h2>
		<p class="muted">
			A hidden-agent round in a voice channel. Everyone but one is told a secret word; one is
			the agent and is not. They talk it out, anyone can call a vote, and the table ejects who
			it thinks the agent is. Changes apply to the next round, not one already running.
		</p>
		<form method="POST" action="?/saveGame" use:enhance={keepValues} class="settings-form">
			<label>
				Name for the hidden role
				<input
					type="text"
					name="agentName"
					maxlength="20"
					value={data.game.agentName}
					required
				/>
			</label>
			<label>
				Name for everyone else
				<input
					type="text"
					name="crewName"
					maxlength="20"
					value={data.game.crewName}
					required
				/>
			</label>
			<label>
				Players needed to start
				<input
					type="number"
					name="minPlayers"
					min={data.gameLimits.minPlayers[0]}
					max={data.gameLimits.minPlayers[1]}
					value={data.game.minPlayers}
					required
				/>
			</label>
			<label>
				Round length (seconds)
				<input
					type="number"
					name="roundSeconds"
					min={data.gameLimits.roundSeconds[0]}
					max={data.gameLimits.roundSeconds[1]}
					value={data.game.roundSeconds}
					required
				/>
			</label>
			<label>
				Votes locked for the first (seconds)
				<input
					type="number"
					name="callLockSeconds"
					min={data.gameLimits.callLockSeconds[0]}
					max={data.gameLimits.callLockSeconds[1]}
					value={data.game.callLockSeconds}
					required
				/>
			</label>
			<label>
				A vote stays open for (seconds)
				<input
					type="number"
					name="meetingSeconds"
					min={data.gameLimits.meetingSeconds[0]}
					max={data.gameLimits.meetingSeconds[1]}
					value={data.game.meetingSeconds}
					required
				/>
			</label>
			<label>
				Votes each player may call
				<input
					type="number"
					name="callsPerPlayer"
					min={data.gameLimits.callsPerPlayer[0]}
					max={data.gameLimits.callsPerPlayer[1]}
					value={data.game.callsPerPlayer}
					required
				/>
			</label>
			<label class="check">
				<span>
					<input type="checkbox" name="muteOut" checked={data.game.muteOut} />
					Server-mute a player who is ejected
				</span>
				<span class="hint">
					They can still hear. Needs Mute Members and a bot role above theirs. The mute is
					lifted when the round ends, and a mute a moderator set is left alone.
				</span>
			</label>
			<button type="submit" class="btn-primary">Save game settings</button>
		</form>
		<p class="muted">
			Players can still message each other privately, so this is an honour-system game, not a
			locked-down one.
		</p>
	</section>

	<section class="card">
		<h2>Shiritori</h2>
		<p class="muted">
			The word chain. Each word starts with the last letter of the one before, and no word is
			used twice. Pick a Chain channel for an always-on chain, and members can also run a
			timed round anywhere with <code>/play shiritori</code> (turn on the Game command above). A
			word that ends in the dead letter ends the chain, or puts a player out of a round.
		</p>
		<form method="POST" action="?/saveShiritori" use:enhance={keepValues} class="settings-form">
			<label class="check wide">
				<input type="checkbox" name="enabled" checked={data.shiritori.enabled} />
				<span>Turn Shiritori on</span>
			</label>
			<label class="wide">
				Chain channel
				<select name="chainChannelId" value={data.shiritori.chainChannelId ?? ''}>
					<option value="">None (rounds only)</option>
					{#each data.shiritoriChannels as channel (channel.id)}
						<option value={channel.id}>#{channel.name}</option>
					{/each}
				</select>
				<span class="hint">
					A valid word gets a ✅. A bad one gets a ❌ and breaks the chain. Anything that
					is not one word is ignored, and a message that starts with <code>//</code> is too.
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
			<label class="check wide">
				<input type="checkbox" name="hardMode" checked={data.shiritori.hardMode} />
				<span>Hard mode: the next word starts with the last two letters</span>
			</label>
			<label class="wide">
				Community words
				<textarea name="allowWords" rows="3" value={data.shiritori.allowWords}></textarea>
				<span class="hint"
					>Words the dictionary lacks and your server accepts, one per line.</span
				>
			</label>
			<label class="wide">
				Blocked words
				<textarea name="blockWords" rows="3" value={data.shiritori.blockWords}></textarea>
				<span class="hint">Words your server refuses, one per line.</span>
			</label>
			<button type="submit" class="btn-primary">Save Shiritori settings</button>
		</form>
		{#if data.shiritori.chainChannelId}
			<form method="POST" action="?/resetShiritoriChain" use:enhance={keepValues}>
				<button type="submit" class="btn-secondary">Reset the chain</button>
			</form>
		{/if}
		{#if data.shiritoriBoard.rows.length}
			<h3>Leaderboard</h3>
			<p class="muted">Server record: {data.shiritoriBoard.record} words in one chain.</p>
			<table class="board">
				<thead>
					<tr
						><th>Member</th><th>Words</th><th>Chains broken</th><th>Rounds won</th><th
							>Longest</th
						></tr
					>
				</thead>
				<tbody>
					{#each data.shiritoriBoard.rows as row (row.name)}
						<tr>
							<td>{row.name}</td>
							<td>{row.wordsAdded}</td>
							<td>{row.chainsBroken}</td>
							<td>{row.roundsWon}</td>
							<td>{row.longestWord ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<p class="muted">
		Who may use <code>/timebox</code> is set under
		<a href="/admin/{data.serverId}/commands">Slash Commands</a>, including by role.
	</p>
</div>

<style>
	.activity-page {
		max-width: 760px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}

	.back-link {
		display: inline-block;
		color: var(--color-text-muted);
		text-decoration: none;
		margin-bottom: 0.5rem;
		font-size: 0.875rem;
	}

	.back-link:hover {
		color: var(--color-primary);
	}

	.page-header h1 {
		margin: 0 0 0.5rem 0;
		font-size: 1.5rem;
		color: var(--color-text);
	}

	.page-desc,
	.muted {
		color: var(--color-text-muted);
		font-size: 0.9rem;
		margin: 0 0 0.75rem 0;
	}

	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
		margin-bottom: 1rem;
	}

	.card h2 {
		margin: 0 0 0.5rem 0;
		font-size: 1.1rem;
		color: var(--color-text);
	}

	.card p {
		margin: 0 0 0.75rem 0;
		color: var(--color-text);
		font-size: 0.925rem;
	}

	.card .muted {
		color: var(--color-text-muted);
	}

	.module-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 0;
		border-top: 1px solid var(--color-border);
	}

	.module-info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.module-name {
		font-weight: 600;
		color: var(--color-text);
	}

	.module-desc {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.switch {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		white-space: nowrap;
		color: var(--color-text);
	}

	.settings-form {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem 1rem;
	}

	.settings-form label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.settings-form input,
	.settings-form select,
	.settings-form textarea {
		padding: 0.5rem 0.6rem;
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md, 6px);
		font-size: 0.95rem;
	}

	.settings-form .wide,
	.settings-form .check,
	.settings-form button {
		grid-column: 1 / -1;
	}

	.settings-form .check {
		color: var(--color-text);
	}

	.settings-form .check input {
		margin-right: 0.4rem;
	}

	.hint {
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}

	.btn-primary {
		justify-self: start;
		padding: 0.55rem 1.1rem;
		background: var(--color-primary);
		color: var(--color-text-inverse);
		border: none;
		border-radius: var(--radius-md, 6px);
		font-weight: 600;
		cursor: pointer;
	}

	.btn-primary:hover {
		filter: brightness(1.1);
	}

	.btn-secondary {
		margin-top: 0.75rem;
		padding: 0.5rem 1rem;
		background: transparent;
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md, 6px);
		cursor: pointer;
	}

	.board {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	.board th,
	.board td {
		padding: 0.35rem 0.5rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
	}

	.board th {
		color: var(--color-text-muted);
		font-weight: 600;
	}

	@media (max-width: 560px) {
		.settings-form {
			grid-template-columns: 1fr;
		}
	}
</style>
