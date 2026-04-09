<script>
	/**
	 * Unified chart tooltip – fixed-positioned so it never clips.
	 * Supports single-value (area chart) and multi-item (bar chart) content.
	 *
	 * @type {{ tooltip: { visible: boolean, clientX: number, clientY: number, date: string, value?: string, label?: string, chartColor?: string, items?: Array<{label: string, value: number, color: string}>, hasData: boolean } }}
	 */
	let { tooltip = {} } = $props();

	let el = $state(null);
	let left = $state(0);
	let top = $state(0);
	let positioned = $state(false);

	$effect(() => {
		if (!tooltip.visible) {
			positioned = false;
			return;
		}
		if (!el) return;

		const rect = el.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const gap = 10;
		const edgePad = 8;

		// Centre horizontally on cursor, clamp to viewport
		let x = tooltip.clientX - rect.width / 2;
		x = Math.max(edgePad, Math.min(x, vw - rect.width - edgePad));

		// Prefer above cursor; flip below if no room
		let y = tooltip.clientY - rect.height - gap;
		if (y < edgePad) {
			y = tooltip.clientY + gap;
			if (y + rect.height > vh - edgePad) {
				y = vh - rect.height - edgePad;
			}
		}

		left = x;
		top = y;
		positioned = true;
	});
</script>

{#if tooltip.visible}
	<div
		bind:this={el}
		class="chart-tooltip"
		class:visible={positioned}
		style:left="{left}px"
		style:top="{top}px"
	>
		{#if tooltip.label}
			<div class="tooltip-label" style:color={tooltip.chartColor}>{tooltip.label}</div>
		{/if}
		<div class="tooltip-date">{tooltip.date}</div>
		{#if tooltip.items}
			{#each tooltip.items as item}
				{#if item.value > 0}
					<div class="tooltip-item">
						<span class="tooltip-color" style:background={item.color}></span>
						<span class="tooltip-item-label">{item.label}</span>
						<span class="tooltip-value">{item.value.toLocaleString()}</span>
					</div>
				{/if}
			{/each}
		{:else if tooltip.value !== undefined}
			<div class="tooltip-value">{tooltip.value}</div>
		{/if}
		{#if !tooltip.hasData}
			<div class="tooltip-note">No recorded data for this point</div>
		{/if}
	</div>
{/if}

<style>
	.chart-tooltip {
		position: fixed;
		pointer-events: none;
		background: rgba(20, 20, 28, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.1);
		z-index: 9999;
		white-space: nowrap;
		opacity: 0;
		transition: opacity 0.1s ease;
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	.chart-tooltip.visible {
		opacity: 1;
	}

	.tooltip-label {
		font-weight: 600;
		font-size: 0.8rem;
		margin-bottom: 0.15rem;
	}

	.tooltip-date {
		color: rgba(255, 255, 255, 0.6);
		font-size: 0.75rem;
		margin-bottom: 0.2rem;
	}

	.tooltip-value {
		color: #fff;
		font-weight: 600;
		font-size: 1rem;
		font-variant-numeric: tabular-nums;
	}

	.tooltip-note {
		color: rgba(255, 255, 255, 0.5);
		font-size: 0.7rem;
		margin-top: 0.2rem;
		font-style: italic;
	}

	.tooltip-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.1rem 0;
	}

	.tooltip-color {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		flex-shrink: 0;
	}

	.tooltip-item-label {
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.8rem;
	}

	.tooltip-item .tooltip-value {
		font-size: 0.9rem;
		margin-left: auto;
		padding-left: 1rem;
	}
</style>
