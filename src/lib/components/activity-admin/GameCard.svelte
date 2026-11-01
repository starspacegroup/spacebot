<script lang="ts">
	/**
	 * One game on the Activity admin page, drawn from its registry entry: what it
	 * is, where it is played, its commands, its switch, and its settings panel.
	 */
	import { enhance } from '$app/forms';
	import Switch from '$lib/components/Switch.svelte';
	import type { GameDefinition } from '$lib/games/registry.js';
	import type { GameState } from '$lib/server/games-admin.js';
	import { GAME_SETTINGS, type GameSettingsProps } from './game-settings.js';

	const {
		game,
		data,
		keepValues,
		alsoControls = [],
	}: {
		game: GameDefinition & GameState;
		data: GameSettingsProps['data'];
		keepValues: GameSettingsProps['keepValues'];
		/** Other games that stop working when this switch is off. */
		alsoControls?: string[];
	} = $props();

	const Settings = $derived(GAME_SETTINGS[game.id]);
	const planned = $derived(game.status === 'planned');
	const switchHint = $derived(
		alsoControls.length && game.enable?.kind === 'command'
			? `Also needed by ${alsoControls.join(', ')}: off hides /${game.enable.command} entirely.`
			: ''
	);
</script>

<article class="game" class:planned id="game-{game.id}" aria-labelledby="game-{game.id}-name">
	<div class="head">
		<span class="icon" aria-hidden="true">{game.icon}</span>
		<div class="title">
			<h3 id="game-{game.id}-name">{game.name}</h3>
			{#if planned}
				<span class="pill soon">Coming soon</span>
			{:else}
				<span class="pill" class:on={game.enabled}>{game.enabled ? 'On' : 'Off'}</span>
			{/if}
		</div>
		{#if !planned}
			<form
				method="POST"
				action="?/toggleGame"
				use:enhance={keepValues}
				class="toggle"
				onchange={(e) => e.currentTarget.requestSubmit()}
			>
				<input type="hidden" name="game" value={game.id} />
				<Switch name="enabled" checked={game.enabled} label="Enable" />
			</form>
		{/if}
	</div>

	<p class="tagline">{game.tagline}</p>

	<dl class="meta">
		<div>
			<dt>Players</dt>
			<dd>{game.players}</dd>
		</div>
		<div>
			<dt>Where</dt>
			<dd>{game.where}</dd>
		</div>
		<div>
			<dt>{game.commands.length > 1 ? 'Commands' : 'Command'}</dt>
			<dd class="commands">
				{#each game.commands as c (c)}<code>{c}</code>{/each}
			</dd>
		</div>
	</dl>

	{#if switchHint}
		<p class="hint">{switchHint}</p>
	{/if}
	{#if game.blockedBy}
		<p class="sb-warning" role="status">
			<code>/{game.blockedBy}</code> is off, so rounds cannot start. Turn on Hidden Agent above
			to allow it.
		</p>
	{/if}

	{#if Settings && !planned}
		<details class="settings">
			<summary>Settings</summary>
			<div class="settings-body">
				<Settings {data} {keepValues} />
			</div>
		</details>
	{/if}
</article>

<style>
	.game {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-left: 6px solid var(--color-primary);
		border-radius: var(--radius-lg, 12px);
		min-width: 0;
	}

	.game.planned {
		border-left-color: var(--color-border-strong);
		background: var(--color-background-alt, var(--color-surface));
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		flex-wrap: wrap;
	}

	.icon {
		display: grid;
		place-items: center;
		width: 3rem;
		height: 3rem;
		flex: none;
		font-size: 1.6rem;
		background: var(--color-primary-soft);
		border-radius: var(--radius-md, 8px);
	}

	.title {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		flex: 1 1 10rem;
		min-width: 0;
	}

	h3 {
		margin: 0;
		font-size: 1.3rem;
		line-height: 1.2;
		color: var(--color-text);
	}

	.pill {
		display: inline-block;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		color: var(--color-text-muted);
		background: var(--color-surface-active, var(--color-surface-hover));
		border: 1px solid var(--color-border-strong);
	}

	.pill.on {
		color: var(--color-text);
		background: var(--color-success-soft);
		border-color: var(--color-success);
	}

	.pill.soon {
		color: var(--color-text);
		background: var(--color-info-soft);
		border-color: var(--color-info);
	}

	.toggle {
		margin-left: auto;
	}

	.tagline {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.5;
		color: var(--color-text);
	}

	.meta {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
		margin: 0;
	}

	.meta div {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr);
		gap: 0.75rem;
		align-items: baseline;
	}

	dt {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	dd {
		margin: 0;
		color: var(--color-text);
		font-size: 1rem;
	}

	.commands {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.commands code {
		padding: 0.15rem 0.45rem;
		background: var(--color-code-bg);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		font-size: 0.95rem;
		color: var(--color-text);
	}

	.hint {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.settings {
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
		font-size: 1rem;
		color: var(--color-text);
		cursor: pointer;
		list-style: none;
	}

	.settings summary::-webkit-details-marker {
		display: none;
	}

	.settings summary::before {
		content: '▸';
		transition: transform 0.15s;
	}

	.settings[open] summary::before {
		transform: rotate(90deg);
	}

	.settings summary:hover {
		background: var(--color-surface-hover);
	}

	.settings summary:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.settings-body {
		margin-top: 1rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.settings summary::before {
			transition: none;
		}
	}
</style>
