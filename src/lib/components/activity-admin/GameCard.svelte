<script lang="ts">
	/**
	 * One game on the Activity admin page, drawn from its registry entry: what it
	 * is, where it is played, its commands, its switch, and its settings panel.
	 */
	import { enhance } from '$app/forms';
	import Switch from '$lib/components/Switch.svelte';
	import type { GameDefinition } from '$lib/games/registry.js';
	import type { GameState } from '$lib/server/games-admin.js';
	import type { GameDisplay } from '$lib/games/display.js';
	import { NAME_MAX, TAGLINE_MAX } from '$lib/games/display.js';
	import { GAME_SETTINGS, type GameSettingsProps } from './game-settings.js';

	const {
		game,
		data,
		keepValues,
		alsoControls = [],
		blockerName = '',
		form = null,
	}: {
		game: GameDefinition &
			GameState & {
				/** The registry's text, for placeholders and Reset. */
				defaults?: { name: string; icon: string; tagline: string };
				/** What members see on this server. */
				display?: GameDisplay;
			};
		data: GameSettingsProps['data'];
		keepValues: GameSettingsProps['keepValues'];
		/** Other games that stop working when this switch is off. */
		alsoControls?: string[];
		/** This server's name for the game whose command is off (`blockedBy`). */
		blockerName?: string;
		/** The page's last action result, to show a naming error on this card. */
		form?: { success?: boolean; game?: string; message?: string } | null;
	} = $props();

	const shown = $derived({
		name: game.display?.name ?? game.name,
		icon: game.display?.icon ?? game.icon,
		tagline: game.display?.tagline ?? game.tagline,
	});
	const custom = $derived(
		Boolean(
			game.display?.custom.name || game.display?.custom.icon || game.display?.custom.tagline
		)
	);
	const nameError = $derived(form && !form.success && form.game === game.id ? form.message : '');

	const Settings = $derived(GAME_SETTINGS[game.id]);
	const planned = $derived(game.status === 'planned');
	const switchHint = $derived(
		alsoControls.length && game.enable?.kind === 'command'
			? `${alsoControls.join(' and ')} rounds also start with /${game.enable.command}, so switching this off stops them too.`
			: ''
	);
</script>

<article class="game" class:planned id="game-{game.id}" aria-labelledby="game-{game.id}-name">
	<div class="head">
		<span class="icon" aria-hidden="true">{shown.icon}</span>
		<div class="title">
			<h3 id="game-{game.id}-name">{shown.name}</h3>
			{#if game.display?.custom.name}
				<span class="was">({game.name})</span>
			{/if}
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

	<p class="tagline">{shown.tagline}</p>

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
			<code>/{game.blockedBy}</code> is off, so rounds cannot start. Turn on {blockerName ||
				`/${game.blockedBy}`} above to allow it.
		</p>
	{/if}

	{#if !planned}
		<details class="settings naming" open={Boolean(nameError) || undefined}>
			<summary>Name on this server</summary>
			<form
				method="POST"
				action="?/saveGameName"
				use:enhance={keepValues}
				class="name-form"
				aria-describedby="game-{game.id}-name-hint"
			>
				<input type="hidden" name="game" value={game.id} />
				<div class="name-row">
					<label class="field icon-field">
						<span>Icon</span>
						<input
							name="icon"
							value={game.display?.custom.icon ? game.display.icon : ''}
							placeholder={game.defaults?.icon ?? game.icon}
							maxlength="16"
							autocomplete="off"
							aria-label="Icon, one emoji"
						/>
					</label>
					<label class="field name-field">
						<span>Name</span>
						<input
							name="name"
							value={game.display?.custom.name ? game.display.name : ''}
							placeholder={game.defaults?.name ?? game.name}
							maxlength={NAME_MAX}
							autocomplete="off"
						/>
					</label>
				</div>
				<label class="field">
					<span>Description</span>
					<input
						name="tagline"
						value={game.display?.custom.tagline ? game.display.tagline : ''}
						placeholder={game.defaults?.tagline ?? game.tagline}
						maxlength={TAGLINE_MAX}
						autocomplete="off"
					/>
				</label>
				<p class="hint" id="game-{game.id}-name-hint">
					Members see this name on cards, in the Activity and in <code>/help</code>. Leave
					a field empty for the default. Slash commands keep their names ({#each game.commands as c, i (c)}{i
							? ', '
							: ''}<code>{c}</code>{/each}): Discord fixes command names for every
					server.
				</p>
				{#if nameError}
					<p class="sb-warning" role="alert">{nameError}</p>
				{/if}
				<div class="name-actions">
					<button type="submit" class="sb-btn-primary">Save name</button>
					{#if custom}
						<button type="submit" name="reset" value="1" class="sb-btn-secondary"
							>Reset to {game.defaults?.name ?? game.name}</button
						>
					{/if}
				</div>
			</form>
		</details>
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

	.was {
		color: var(--color-text-muted);
		font-size: 0.95rem;
	}

	.name-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.name-row {
		display: grid;
		grid-template-columns: 5rem minmax(0, 1fr);
		gap: 0.75rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	.field span {
		color: var(--color-text);
		font-weight: 600;
		font-size: 0.95rem;
	}

	.field input {
		min-height: 2.75rem;
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.75rem;
		font-size: 1rem;
		color: var(--color-text);
		background: var(--color-background);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md, 6px);
	}

	.field input::placeholder {
		color: var(--color-text-muted);
	}

	.field input:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.icon-field input {
		text-align: center;
		font-size: 1.3rem;
	}

	.name-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	.name-actions button {
		min-height: 2.75rem;
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

	@media (max-width: 479px) {
		.meta div {
			grid-template-columns: 1fr;
			gap: 0.15rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.settings summary::before {
			transition: none;
		}
	}
</style>
