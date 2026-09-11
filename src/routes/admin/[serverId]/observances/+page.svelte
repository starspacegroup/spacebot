<script lang="ts">
	import { enhance } from '$app/forms';
	import Switch from '$lib/components/Switch.svelte';
	import { mapUrl, formatClock } from '$lib/db/anniversary-timeline.js';

	const { data, form } = $props();

	// One object rather than five loose fields, with an effect that reseeds it
	// whenever the loader returns. `use:enhance` re-runs `load` after a save, so
	// this is what makes a value the server CLAMPED show its clamped form: type
	// 9999 into the grace window and the field must come back reading 240, not
	// keep displaying a number that was never stored.
	// svelte-ignore state_referenced_locally
	// Capturing the initial value here is the intent, not an oversight: this is
	// a form, so it must NOT track `data` continuously or a reload would wipe
	// what someone is halfway through typing. The $effect below is the deliberate
	// resync point, and it fires only when the loader actually returns.
	let editing = $state(fromSettings(data.settings));

	$effect(() => {
		editing = fromSettings(data.settings);
	});

	function fromSettings(settings: typeof data.settings) {
		return {
			enabled: settings.enabled,
			channelId: settings.channel_id ?? '',
			timezone: settings.timezone,
			graceMinutes: settings.grace_minutes,
			useEmbed: settings.use_embed,
		};
	}

	/** True once anything differs from what the server last returned. */
	const dirty = $derived.by(() => {
		const saved = fromSettings(data.settings);
		return (
			saved.enabled !== editing.enabled ||
			saved.channelId !== editing.channelId ||
			saved.timezone !== editing.timezone ||
			Number(saved.graceMinutes) !== Number(editing.graceMinutes) ||
			saved.useEmbed !== editing.useEmbed
		);
	});

	// `use:enhance` gives no signal of its own that a submit is in flight, and a
	// save here takes a D1 round-trip. Without this the button stays pressable
	// and a second click lands a second write.
	let saving = $state(false);

	/** One row of this year's post log, as the loader returns it. */
	type PostLogRow = {
		event_key: string;
		status: string;
		message_id: string | null;
		error: string | null;
	};

	const statuses = $derived(
		new Map<string, PostLogRow>(
			((data.postLog ?? []) as PostLogRow[]).map((row) => [row.event_key, row])
		)
	);

	// A saved channel can vanish from the cache — deleted in Discord, or the
	// dashboard has not synced since. The select would then silently show blank
	// and the form would post an empty channel on the next save, turning the
	// timeline off without anyone choosing to. Keep the stored id selectable
	// and say what happened.
	const channelKnown = $derived(
		editing.channelId === '' || data.channels.some((c) => c.channelId === editing.channelId)
	);

	// Enabling with no channel is refused server-side. Say so here too, so the
	// button is not a dead end you only discover by pressing it.
	const canSave = $derived(!editing.enabled || editing.channelId !== '');

	const yearsSince = $derived(data.timeline ? data.logYear - data.timeline.sourceYear : null);

	function statusLabel(key: string) {
		const row = statuses.get(key);
		if (!row) return null;
		if (row.status === 'sent') return 'posted';
		if (row.status === 'skipped') return 'skipped — too late';
		if (row.status === 'failed') return `failed — ${row.error ?? 'unknown'}`;
		return row.status;
	}
</script>

<svelte:head>
	<title>Observances · SpaceBot</title>
</svelte:head>

<div class="observances-page">
	<header class="page-header">
		<a class="back-link" href="/admin/{data.serverId}">← Back to server</a>
		<h1>Observances</h1>
		<p class="page-desc">
			Post a historical day's events at the minutes they happened, on its anniversary. Off
			unless you turn it on.
		</p>
	</header>

	{#if !data.timeline}
		<p class="alert alert-error">This timeline is no longer available.</p>
	{:else}
		<form
			method="POST"
			action="?/save"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update();
					saving = false;
				};
			}}
		>
			<input type="hidden" name="timeline_key" value={data.timeline.key} />

			<section class="card">
				<div class="card-head">
					<div>
						<h2>{data.timeline.title}</h2>
						<p class="muted">
							{data.timeline.events.length} events, from {formatClock(
								data.timeline.events[0].time
							)} to {formatClock(
								data.timeline.events[data.timeline.events.length - 1].time
							)}.
						</p>
					</div>

					<Switch
						name="enabled"
						bind:checked={editing.enabled}
						label={editing.enabled ? 'On' : 'Off'}
					/>
				</div>

				<div class="grid">
					<label class="field">
						<span>Channel</span>
						<select name="channel_id" bind:value={editing.channelId}>
							<option value="">— pick a channel —</option>
							{#if !channelKnown}
								<option value={editing.channelId}>
									Saved channel (no longer in the cache)
								</option>
							{/if}
							{#each data.channels as channel (channel.channelId)}
								<option value={channel.channelId}>
									#{channel.name}{channel.parentName
										? ` — ${channel.parentName}`
										: ''}
								</option>
							{/each}
						</select>
						{#if !channelKnown}
							<small class="warn">
								The saved channel is not in the cached list. It may have been
								deleted, or the dashboard has not synced since. Pick another or open
								the server's dashboard once to re-sync.
							</small>
						{:else if data.channels.length === 0}
							<small class="muted">
								No channels cached yet. Open the server's dashboard once to sync
								them.
							</small>
						{/if}
					</label>

					<label class="field">
						<span>Read the times against</span>
						<select name="timezone" bind:value={editing.timezone}>
							{#each data.timezones as tz (tz.value)}
								<option value={tz.value}>{tz.label}</option>
							{/each}
						</select>
						<small class="muted">
							Defaults to the zone the events happened in, so 8:46 AM means the 8:46
							in the record. Change it if you would rather the day landed on your own
							members' clocks.
						</small>
					</label>

					<label class="field">
						<span>Post up to (minutes late)</span>
						<input
							name="grace_minutes"
							type="number"
							inputmode="numeric"
							min="1"
							max="240"
							bind:value={editing.graceMinutes}
						/>
						<small class="muted">
							If the bot misses a minute, it still posts within this window. Past it
							the event is skipped rather than arriving out of step with the day.
						</small>
					</label>

					<div class="field">
						<span>Format</span>
						<Switch
							name="use_embed"
							bind:checked={editing.useEmbed}
							label="Post as embeds"
							description="Embeds, or plain text for servers that strip them."
						/>
					</div>
				</div>

				<div class="actions">
					<button class="btn btn-primary" type="submit" disabled={!canSave || saving}>
						{saving ? 'Saving…' : 'Save'}
					</button>
					{#if !canSave}
						<small class="muted">Pick a channel before turning it on.</small>
					{:else if form?.error}
						<small class="feedback feedback-error" role="alert">{form.error}</small>
					{:else if dirty}
						<small class="muted">Unsaved changes.</small>
					{:else if form?.success}
						<small class="feedback feedback-ok" role="status">Saved.</small>
					{/if}
				</div>
			</section>
		</form>

		<section class="card">
			<h2>What gets posted</h2>
			<p class="muted">
				{#if yearsSince && yearsSince > 0}
					In {data.logYear} this reads as {yearsSince} years ago today.
				{/if}
				Statuses below are for {data.logYear}.
			</p>

			<ol class="timeline">
				{#each data.timeline.events as event (event.key)}
					{@const status = statusLabel(event.key)}
					<li class:posted={status === 'posted'}>
						<span class="time">{formatClock(event.time)}</span>
						<div class="entry">
							<strong>{event.title}</strong>
							<p>{event.body}</p>
							{#if event.place}
								<a
									class="place"
									href={mapUrl(event.place.query)}
									target="_blank"
									rel="noopener noreferrer">📍 {event.place.name}</a
								>
							{/if}
							{#if event.links?.length}
								<span class="links">
									{#each event.links as link (link.url)}
										<a href={link.url} target="_blank" rel="noopener noreferrer"
											>{link.label}</a
										>
									{/each}
								</span>
							{/if}
							{#if event.image}
								<img
									class="shot"
									src={event.image.url}
									alt={event.title}
									loading="lazy"
								/>
								<span class="credit">{event.image.credit}</span>
							{/if}
							{#if status}
								<span class="status status-{statuses.get(event.key)?.status}"
									>{status}</span
								>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		</section>
	{/if}
</div>

<style>
	.observances-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	.page-header {
		margin-bottom: 2rem;
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
		margin: 0;
		font-size: 0.9rem;
	}

	.warn {
		color: var(--color-warning);
		font-size: 0.85rem;
	}

	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.card h2 {
		margin: 0 0 0.25rem 0;
		font-size: 1.1rem;
		color: var(--color-text);
	}

	.card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.25rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1rem 1.5rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.field input,
	.field select {
		padding: 0.5rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
		color: var(--color-text);
	}

	.field input:focus-visible,
	.field select:focus-visible {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--focus-ring);
	}

	.actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1.25rem;
	}

	.feedback {
		font-size: 0.9rem;
	}

	.feedback-error {
		color: var(--color-danger);
	}

	.feedback-ok {
		color: var(--color-success);
	}

	.alert {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-sm);
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}

	.alert-error {
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}

	.timeline {
		list-style: none;
		margin: 1rem 0 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.timeline li {
		display: grid;
		grid-template-columns: 5.5rem 1fr;
		gap: 0.75rem;
		padding-bottom: 0.9rem;
		border-bottom: 1px solid var(--color-border);
	}

	.timeline li:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.time {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		font-size: 0.85rem;
		padding-top: 0.1rem;
	}

	.entry strong {
		color: var(--color-text);
		font-size: 0.95rem;
	}

	.entry p {
		margin: 0.25rem 0 0 0;
		color: var(--color-text-muted);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.place {
		display: inline-block;
		margin: 0.35rem 0 0.4rem;
		font-size: 0.85rem;
		color: var(--color-primary);
		text-decoration: none;
	}

	.place:hover {
		text-decoration: underline;
	}

	.shot {
		display: block;
		width: 100%;
		max-width: 360px;
		border-radius: var(--radius-sm);
		margin-bottom: 0.25rem;
		background: var(--color-surface-elevated);
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		margin-bottom: 0.4rem;
	}

	.links a {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.links a:hover {
		color: var(--color-primary);
		text-decoration: underline;
	}

	.credit {
		display: block;
		font-size: 0.72rem;
		color: var(--color-text-light);
		margin-bottom: 0.4rem;
	}

	.status {
		display: inline-block;
		margin-top: 0.4rem;
		font-size: 0.75rem;
		padding: 0.1rem 0.45rem;
		border-radius: var(--radius-sm);
		background: var(--color-surface-elevated);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	.status-sent {
		color: var(--color-success);
	}

	.status-failed {
		color: var(--color-danger);
	}

	@media (max-width: 560px) {
		.timeline li {
			grid-template-columns: 1fr;
			gap: 0.2rem;
		}
	}
</style>
