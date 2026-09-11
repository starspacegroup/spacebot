<script lang="ts">
	/**
	 * A toggle switch that is still a real checkbox underneath.
	 *
	 * The native <input> stays in the form with its `name`, so a plain POST sees
	 * `on` exactly as it would from a bare checkbox — nothing server-side needs
	 * to know the control changed shape. It is hidden visually, not with
	 * display:none, so it keeps focus, the space bar, and a screen reader's
	 * "switch, on" announcement.
	 *
	 * The look matches the enable toggle on the automations page (44×24 track,
	 * 20px thumb) so the admin does not grow a second kind of switch.
	 */
	let {
		name,
		checked = $bindable(false),
		label,
		description = '',
		disabled = false,
	}: {
		name: string;
		checked?: boolean;
		label: string;
		description?: string;
		disabled?: boolean;
	} = $props();
</script>

<label class="switch" class:disabled>
	<input type="checkbox" role="switch" {name} bind:checked {disabled} />
	<span class="track" aria-hidden="true"><span class="thumb"></span></span>
	<span class="text">
		<span class="label">{label}</span>
		{#if description}
			<span class="desc">{description}</span>
		{/if}
	</span>
</label>

<style>
	.switch {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.65rem;
		cursor: pointer;
		font-size: 0.9rem;
		color: var(--color-text);
		user-select: none;
	}

	.switch.disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	/* Off-screen, not display:none — it must stay focusable. */
	.switch input {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}

	.track {
		flex: none;
		position: relative;
		width: 44px;
		height: 24px;
		border-radius: 12px;
		background: var(--color-border-strong);
		transition: background 0.2s;
		/* Keeps the thumb centred against the first line of the label. */
		margin-top: 0.05rem;
	}

	.thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: white;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
		transition: transform 0.2s;
	}

	.switch input:checked + .track {
		background: var(--color-primary-button);
	}

	.switch input:checked + .track .thumb {
		transform: translateX(20px);
	}

	.switch input:focus-visible + .track {
		box-shadow: var(--focus-ring);
	}

	.switch:hover:not(.disabled) input:not(:checked) + .track {
		background: var(--color-text-light);
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.label {
		line-height: 24px;
	}

	.desc {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		line-height: 1.45;
	}

	@media (prefers-reduced-motion: reduce) {
		.track,
		.thumb {
			transition: none;
		}
	}
</style>
