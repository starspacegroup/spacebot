<script lang="ts">
	import { WEEKDAY_OPTIONS, scheduleLabel } from './workflow-ui.js';

	let { draft = $bindable() } = $props();
</script>

<fieldset class="schedule-builder">
	<legend>Schedule</legend>
	<label class="field">
		<span>Cadence</span>
		<select bind:value={draft.scheduleMode}>
			<option value="manual">Manual only</option>
			<option value="hourly">Hourly</option>
			<option value="every_n_hours">Every N hours</option>
			<option value="daily">Daily</option>
			<option value="weekly">Weekly</option>
			<option value="monthly">Monthly</option>
		</select>
	</label>
	{#if draft.scheduleMode !== 'manual'}
		<div class="field-grid">
			{#if draft.scheduleMode === 'every_n_hours'}
				<label class="field">
					<span>Every N hours</span>
					<input type="number" min="1" max="23" bind:value={draft.everyHours} />
				</label>
			{/if}
			{#if draft.scheduleMode !== 'hourly' && draft.scheduleMode !== 'every_n_hours'}
				<label class="field">
					<span>Hour (UTC)</span>
					<input type="number" min="0" max="23" bind:value={draft.hour} />
				</label>
			{/if}
			<label class="field">
				<span>Minute</span>
				<input type="number" min="0" max="59" bind:value={draft.minute} />
			</label>
			{#if draft.scheduleMode === 'weekly'}
				<label class="field">
					<span>Day</span>
					<select bind:value={draft.weekday}>
						{#each WEEKDAY_OPTIONS as opt (opt.id)}
							<option value={opt.id}>{opt.label}</option>
						{/each}
					</select>
				</label>
			{/if}
			{#if draft.scheduleMode === 'monthly'}
				<label class="field">
					<span>Day of month</span>
					<input type="number" min="1" max="31" bind:value={draft.monthday} />
				</label>
			{/if}
		</div>
	{/if}
	<p class="schedule-preview">{scheduleLabel(draft)}</p>
	<label class="toggle-inline">
		<input type="checkbox" bind:checked={draft.enabled} />
		Enabled
	</label>
</fieldset>

<style>
	.schedule-builder {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.75rem 1rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.schedule-builder legend {
		font-size: 0.85rem;
		font-weight: 600;
		padding: 0 0.35rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
	}
	.field span {
		color: var(--color-text-muted);
		font-weight: 600;
	}
	.field input,
	.field select {
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: inherit;
	}
	.field-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.75rem;
	}
	.schedule-preview {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-primary);
	}
	.toggle-inline {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
	}
</style>
