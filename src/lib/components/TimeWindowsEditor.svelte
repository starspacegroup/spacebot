<script lang="ts">
	/**
	 * Editor for the `time_windows` automation filter: a list of windows, each
	 * with day toggles and a start/end time, plus include/exclude and an
	 * optional timezone override.
	 *
	 * The result is submitted as one JSON string in a hidden input named
	 * `name`. It is empty while no window exists, so the form saves no filter
	 * at all — same as leaving any other filter blank.
	 */
	import { untrack } from 'svelte';
	import { parseTimeWindows, WEEKDAYS, type TimeWindow } from '$lib/automation/time-windows.js';

	const {
		name,
		value = null,
	}: {
		name: string;
		value?: unknown;
	} = $props();

	// The saved value only seeds the editor; after that the editor owns the state.
	const initial = untrack(() => parseTimeWindows(value));
	let mode = $state<'include' | 'exclude'>(initial?.mode === 'exclude' ? 'exclude' : 'include');
	let timezone = $state(initial?.timezone ?? '');
	const windows = $state<TimeWindow[]>(
		(initial?.windows ?? []).map((w) => ({ ...w, days: [...(w.days ?? [])] }))
	);

	const DAY_LABELS: Record<string, string> = {
		sun: 'Sun',
		mon: 'Mon',
		tue: 'Tue',
		wed: 'Wed',
		thu: 'Thu',
		fri: 'Fri',
		sat: 'Sat',
	};

	const serialized = $derived(
		windows.length === 0
			? ''
			: JSON.stringify({ mode, timezone: timezone.trim() || null, windows })
	);

	function addWindow() {
		windows.push({ days: [], start: '08:00', end: '22:00' });
	}

	function toggleDay(window: TimeWindow, day: string) {
		const days = window.days ?? [];
		window.days = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
	}
</script>

<div class="time-windows">
	<input type="hidden" {name} value={serialized} />

	{#if windows.length > 0}
		<div class="row">
			<label>
				<span class="small">Fire when the event is</span>
				<select bind:value={mode}>
					<option value="include">inside these windows</option>
					<option value="exclude">outside these windows</option>
				</select>
			</label>
			<label>
				<span class="small">Timezone (blank = server timezone)</span>
				<input type="text" bind:value={timezone} placeholder="America/Phoenix" />
			</label>
		</div>
	{/if}

	{#each windows as window, i}
		<div class="window">
			<div class="days" role="group" aria-label="Days of the week">
				{#each WEEKDAYS as day}
					<button
						type="button"
						class="day"
						class:on={window.days?.includes(day)}
						aria-pressed={window.days?.includes(day) ?? false}
						onclick={() => toggleDay(window, day)}>{DAY_LABELS[day]}</button
					>
				{/each}
			</div>
			<input type="time" bind:value={window.start} aria-label="Start time" />
			<span>to</span>
			<input type="time" bind:value={window.end} aria-label="End time" />
			<button
				type="button"
				class="remove"
				aria-label="Remove window"
				onclick={() => windows.splice(i, 1)}>✕</button
			>
		</div>
	{/each}

	<button type="button" class="add" onclick={addWindow}>+ Add time window</button>
	<p class="hint">
		No days selected means every day. An end time before the start crosses midnight.
	</p>
</div>

<style>
	.time-windows {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.row,
	.window {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.row label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.small,
	.hint {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.hint {
		margin: 0;
	}

	.days {
		display: flex;
		gap: 0.25rem;
	}

	.day {
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--color-border-strong);
		border-radius: 6px;
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
		font-size: 0.8rem;
	}

	.day.on {
		background: var(--color-primary-button);
		border-color: var(--color-primary-button);
		color: white;
	}

	.add,
	.remove {
		align-self: flex-start;
		background: transparent;
		border: 1px solid var(--color-border-strong);
		border-radius: 6px;
		color: var(--color-text);
		cursor: pointer;
		padding: 0.25rem 0.6rem;
	}
</style>
