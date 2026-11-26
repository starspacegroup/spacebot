<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from '$lib/toast.svelte.js';
	import Switch from '$lib/components/Switch.svelte';
	import ChannelSelector from '$lib/components/ChannelSelector.svelte';
	import RoleSelector from '$lib/components/RoleSelector.svelte';
	import GameCard from '$lib/components/activity-admin/GameCard.svelte';
	import '$lib/components/activity-admin/settings-form.css';

	const { data, form } = $props();

	// The pickers own these after the first paint; the page refreshes them on save.
	// svelte-ignore state_referenced_locally
	let noLiftChannels = $state((data.timebox.noLiftChannels ?? []).join(','));
	// svelte-ignore state_referenced_locally
	let noLiftRoles = $state((data.timebox.noLiftRoles ?? []).join(','));

	// `use:enhance` resets a form after a successful save, and a reset puts every
	// field back to its HTML default. These fields are set as properties, so the
	// default is empty: the form blanked itself right after saving. Keep what the
	// admin typed; the page's data refreshes behind it. Every form on the page and
	// in each game's settings panel uses this.
	const keepValues =
		() =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
		};

	/** For each game, the other games that need its command switched on. */
	const dependents = $derived(
		Object.fromEntries(
			data.games.map((g) => [
				g.id,
				data.games
					.filter(
						(o) => g.enable?.kind === 'command' && o.needsCommand === g.enable.command
					)
					.map((o) => o.display?.name ?? o.name),
			])
		)
	);
	/** What this server calls the game whose command is `name`, for the "is off" warning. */
	const commandOwner = (name: string | null) => {
		const g = data.games.find((o) => o.enable?.kind === 'command' && o.enable.command === name);
		return g?.display?.name ?? g?.name ?? '';
	};
	const liveCount = $derived(data.games.filter((g) => g.status === 'live').length);
	const onCount = $derived(data.games.filter((g) => g.enabled).length);

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
			Tools and games SpaceBot runs for your members. Switch each part on for this server and
			set its defaults. A part you switch off also hides its slash command.
		</p>
		<nav class="jump" aria-label="On this page">
			<a href="#tools">Tools</a>
			<a href="#games">Games <span class="count">{onCount} of {liveCount} on</span></a>
		</nav>
	</header>

	<aside class="howto" aria-labelledby="howto-title">
		<h2 id="howto-title">How members open it</h2>
		<p>
			Join a voice channel, open <strong>Activities</strong> (the rocket button) and pick
			<strong>SpaceBot</strong>. It also opens from a DM with a member of this server. The
			switches below decide what it shows.
		</p>
	</aside>

	<section id="tools" class="section" aria-labelledby="tools-title">
		<div class="section-head">
			<h2 id="tools-title">Tools</h2>
			<p>Shared focus timers and server-wide votes. Each has a tab in the Activity.</p>
		</div>
		<div class="tool-list">
			{#each data.tools as tool (tool.id)}
				<article class="tool" aria-labelledby="tool-{tool.id}-name">
					<div class="tool-head">
						<h3 id="tool-{tool.id}-name">{tool.name}</h3>
						<span class="pill" class:on={tool.enabled}
							>{tool.enabled ? 'On' : 'Off'}</span
						>
						<form
							method="POST"
							action="?/toggleModule"
							use:enhance={keepValues}
							class="toggle"
							onchange={(e) => e.currentTarget.requestSubmit()}
						>
							<input type="hidden" name="module" value={tool.id} />
							<Switch name="enabled" checked={tool.enabled} label="Enable" />
						</form>
					</div>
					<p class="tool-desc">{tool.summary}</p>
					<p class="tool-meta">Command <code>/{tool.command}</code></p>

					{#if tool.id === 'timebox'}
						<details class="settings">
							<summary>Defaults</summary>
							<p class="sb-note">
								What <code>/timebox start</code> uses when a member does not choose.
								Members can still override each one when they start. Who may use
								<code>/timebox</code> is set under
								<a href="/admin/{data.serverId}/commands">Slash Commands</a>,
								including by role.
							</p>
							<form
								method="POST"
								action="?/saveTimebox"
								use:enhance={keepValues}
								class="sb-settings-form"
							>
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
								<div class="actions">
									<button type="submit" class="sb-btn-primary"
										>Save defaults</button
									>
								</div>
							</form>
							<h4 class="sb-subhead">Places the server holds</h4>
							<p class="sb-note">
								If an automation of yours keeps everyone muted and deafened in a
								voice channel, name it here. The timebox will never lift a mute or
								deafen while a member is in one of these channels or has one of
								these roles, even if they asked for the timebox deafen. It lifts its
								own once they have left.
							</p>
							<form
								method="POST"
								action="?/saveTimeboxHolds"
								use:enhance={keepValues}
								class="sb-settings-form"
							>
								<div class="wide">
									<span>Voice channels</span>
									<ChannelSelector
										guildId={data.serverId}
										typeFilter="voice,stage"
										name="noLiftChannels"
										multiple
										placeholder="Search voice channels..."
										bind:value={noLiftChannels}
									/>
								</div>
								<div class="wide">
									<span>Roles that mean the server holds the member</span>
									<RoleSelector
										guildId={data.serverId}
										name="noLiftRoles"
										multiple
										placeholder="Search roles..."
										bind:value={noLiftRoles}
									/>
								</div>
								<div class="actions">
									<button type="submit" class="sb-btn-primary">Save</button>
								</div>
							</form>
						</details>
					{/if}
				</article>
			{/each}
		</div>
	</section>

	<section id="games" class="section" aria-labelledby="games-title">
		<div class="section-head">
			<h2 id="games-title">Games</h2>
			<p>
				Games members play together in chat and voice. Each has its own switch and settings;
				changed settings apply to the next round.
			</p>
		</div>
		<div class="game-list">
			{#each data.games as game (game.id)}
				<GameCard
					{game}
					{data}
					{keepValues}
					{form}
					alsoControls={dependents[game.id]}
					blockerName={commandOwner(game.blockedBy)}
				/>
			{/each}
		</div>
	</section>
</div>

<style>
	.activity-page {
		max-width: 1080px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
		font-size: 1rem;
	}

	.page-header {
		margin-bottom: 1.25rem;
	}

	.back-link {
		display: inline-block;
		color: var(--color-text-muted);
		text-decoration: none;
		margin-bottom: 0.5rem;
		font-size: 0.95rem;
	}

	.back-link:hover {
		color: var(--color-primary);
	}

	.page-header h1 {
		margin: 0 0 0.5rem 0;
		font-size: 2rem;
		color: var(--color-text);
	}

	.page-desc {
		max-width: 46rem;
		color: var(--color-text-muted);
		font-size: 1.05rem;
		line-height: 1.5;
		margin: 0 0 1rem 0;
	}

	.jump {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.jump a {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.75rem;
		padding: 0 1rem;
		border: 1px solid var(--color-border-strong);
		border-radius: 999px;
		color: var(--color-text);
		text-decoration: none;
		font-weight: 600;
	}

	.jump a:hover {
		background: var(--color-surface-hover);
	}

	.jump a:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.count {
		color: var(--color-text-muted);
		font-weight: 400;
		font-size: 0.9rem;
	}

	.howto {
		margin-bottom: 2rem;
		padding: 1rem 1.25rem;
		background: var(--color-info-soft);
		border: 1px solid var(--color-info);
		border-radius: var(--radius-lg, 12px);
	}

	.howto h2 {
		margin: 0 0 0.35rem;
		font-size: 1.05rem;
		color: var(--color-text);
	}

	.howto p {
		margin: 0;
		color: var(--color-text);
		line-height: 1.5;
	}

	.section {
		margin-bottom: 2.5rem;
		scroll-margin-top: 1rem;
	}

	.section-head {
		margin-bottom: 1rem;
		padding-bottom: 0.6rem;
		border-bottom: 2px solid var(--color-border);
	}

	.section-head h2 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
		color: var(--color-text);
	}

	.section-head p {
		margin: 0;
		color: var(--color-text-muted);
		line-height: 1.5;
	}

	.tool-list,
	.game-list {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	.tool {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg, 12px);
		min-width: 0;
	}

	.tool-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.tool-head h3 {
		margin: 0;
		font-size: 1.2rem;
		color: var(--color-text);
	}

	.toggle {
		margin-left: auto;
	}

	.pill {
		display: inline-block;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-text-muted);
		background: var(--color-surface-active, var(--color-surface-hover));
		border: 1px solid var(--color-border-strong);
	}

	.pill.on {
		color: var(--color-text);
		background: var(--color-success-soft);
		border-color: var(--color-success);
	}

	.tool-desc {
		margin: 0;
		color: var(--color-text);
		line-height: 1.5;
	}

	.tool-meta {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.95rem;
	}

	.tool-meta code {
		background: var(--color-code-bg);
		padding: 0.05rem 0.35rem;
		border-radius: 4px;
		color: var(--color-text);
	}

	.settings {
		margin-top: 0.25rem;
		border-top: 1px solid var(--color-border);
		padding-top: 0.75rem;
	}

	.settings summary {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.75rem;
		padding: 0 0.9rem;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md, 6px);
		font-weight: 600;
		color: var(--color-text);
		cursor: pointer;
		list-style: none;
		margin-bottom: 0.75rem;
	}

	.settings summary::-webkit-details-marker {
		display: none;
	}

	.settings summary::before {
		content: '▸';
	}

	.settings[open] summary::before {
		content: '▾';
	}

	.settings summary:hover {
		background: var(--color-surface-hover);
	}

	.settings summary:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.settings a {
		color: var(--color-primary);
	}

	@media (min-width: 900px) {
		.activity-page {
			padding: 2rem 1.5rem 3rem;
		}

		.tool-list {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			align-items: start;
		}
	}
</style>
