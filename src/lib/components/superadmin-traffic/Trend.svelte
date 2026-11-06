<script lang="ts">
	/**
	 * A small area chart for counters over time. Pure SVG, no library: one or two series,
	 * three gridlines, a hover line with a tooltip. Colours come from theme tokens.
	 */
	type Series = { key: string; label: string; values: number[]; tone?: 'primary' | 'success' };
	const {
		labels,
		series,
		format = (label: string) => label.slice(5),
		unit = 'day',
	}: {
		labels: string[];
		series: Series[];
		/** How an x label is shown on the axis and in the tooltip. */
		format?: (label: string) => string;
		unit?: string;
	} = $props();

	const W = 800;
	const H = 220;
	const PAD = { top: 12, right: 8, bottom: 4, left: 8 };

	const fmt = (n: number) => n.toLocaleString();
	/** A round top for the y axis: 1, 2, 5 times a power of ten. */
	function niceMax(v: number) {
		if (v <= 4) return 4;
		const pow = 10 ** Math.floor(Math.log10(v));
		for (const m of [1, 2, 5, 10]) if (v <= m * pow) return m * pow;
		return 10 * pow;
	}
	const top = $derived(niceMax(Math.max(0, ...series.flatMap((s) => s.values))));
	const count = $derived(labels.length);
	const x = (i: number) =>
		PAD.left + (count <= 1 ? 0 : (i / (count - 1)) * (W - PAD.left - PAD.right));
	const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
	const line = (values: number[]) => values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
	const area = (values: number[]) =>
		`${x(0)},${y(0)} ${line(values)} ${x(values.length - 1)},${y(0)}`;

	let hover = $state<number | null>(null);
	let box: HTMLDivElement | undefined = $state();
	function move(event: PointerEvent) {
		if (!box || count === 0) return;
		const rect = box.getBoundingClientRect();
		const ratio = (event.clientX - rect.left) / rect.width;
		hover = Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
	}
	const tooltipLeft = $derived(hover === null ? 0 : (x(hover) / W) * 100);
</script>

<div class="trend">
	{#if series.length > 1}
		<ul class="legend">
			{#each series as s (s.key)}
				<li><span class="swatch {s.tone ?? 'primary'}"></span>{s.label}</li>
			{/each}
		</ul>
	{/if}
	<div
		class="plot"
		bind:this={box}
		onpointermove={move}
		onpointerleave={() => (hover = null)}
		role="img"
		aria-label={series.map((s) => s.label).join(', ') + ` by ${unit}`}
	>
		<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
			{#each [0, 0.5, 1] as g (g)}
				<line
					class="grid"
					x1={PAD.left}
					x2={W - PAD.right}
					y1={y(top * g)}
					y2={y(top * g)}
				/>
			{/each}
			{#each series as s (s.key)}
				<polygon class="fill {s.tone ?? 'primary'}" points={area(s.values)} />
				<polyline class="stroke {s.tone ?? 'primary'}" points={line(s.values)} />
			{/each}
			{#if hover !== null}
				<line class="cursor" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} />
			{/if}
		</svg>
		<div class="scale" aria-hidden="true">
			<span>{fmt(top)}</span><span>{fmt(top / 2)}</span><span>0</span>
		</div>
		{#if hover !== null}
			<div
				class="tip"
				class:right={tooltipLeft > 60}
				style="left:{tooltipLeft}%"
				role="status"
			>
				<strong>{format(labels[hover])}</strong>
				{#each series as s (s.key)}
					<span
						><i class="swatch {s.tone ?? 'primary'}"></i>{s.label}: {fmt(
							s.values[hover]
						)}</span
					>
				{/each}
			</div>
		{/if}
	</div>
	<div class="axis" aria-hidden="true">
		<span>{labels.length ? format(labels[0]) : ''}</span>
		<span>{labels.length > 2 ? format(labels[Math.floor(labels.length / 2)]) : ''}</span>
		<span>{labels.length ? format(labels[labels.length - 1]) : ''}</span>
	</div>
</div>

<style>
	.trend {
		min-width: 0;
	}
	.legend {
		display: flex;
		gap: 1rem;
		list-style: none;
		margin: 0 0 0.5rem;
		padding: 0;
		font-size: 0.85rem;
		color: var(--color-text-secondary);
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.swatch {
		display: inline-block;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 3px;
		background: var(--color-primary);
	}
	.swatch.success {
		background: var(--color-success);
	}
	.plot {
		position: relative;
		height: 14rem;
		margin-left: 2.6rem;
		touch-action: pan-y;
	}
	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.grid {
		stroke: var(--color-border);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.fill {
		fill: var(--color-primary);
		opacity: 0.16;
	}
	.fill.success {
		fill: var(--color-success);
	}
	.stroke {
		fill: none;
		stroke: var(--color-primary);
		stroke-width: 2;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
	.stroke.success {
		stroke: var(--color-success);
	}
	.cursor {
		stroke: var(--color-text-muted);
		stroke-width: 1;
		stroke-dasharray: 3 3;
		vector-effect: non-scaling-stroke;
	}
	.scale {
		position: absolute;
		inset: 0 100% 0 auto;
		width: 2.4rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: flex-end;
		padding: 0 0.4rem 0 0;
		box-sizing: border-box;
		font-size: 0.7rem;
		color: var(--color-text-muted);
		pointer-events: none;
	}
	.tip {
		position: absolute;
		top: 0.25rem;
		transform: translateX(0.75rem);
		display: grid;
		gap: 0.15rem;
		padding: 0.45rem 0.65rem;
		font-size: 0.8rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
		pointer-events: none;
		white-space: nowrap;
	}
	.tip.right {
		transform: translateX(calc(-100% - 0.75rem));
	}
	.tip i {
		margin-right: 0.35rem;
		vertical-align: -1px;
	}
	.axis {
		margin-left: 2.6rem;
		display: flex;
		justify-content: space-between;
		margin-top: 0.3rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
