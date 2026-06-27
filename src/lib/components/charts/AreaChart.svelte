<script lang="ts">
	import ChartTooltip from './ChartTooltip.svelte';

	/**
	 * Beautiful, responsive area chart component with optional secondary lines
	 * @type {{ data: Array<{date: string, value: number, label?: string, hasData?: boolean}>, color?: string, gradientId?: string, unit?: string, title?: string, emptyMessage?: string, showPoints?: boolean, height?: string, secondaryLines?: Array<{key: string, color: string, label: string, unit?: string}> }}
	 */
	const {
		data = [],
		color = '#FEE75C',
		gradientId = 'areaGradient',
		unit = '',
		title = '',
		emptyMessage = 'No data available',
		showPoints = true,
		height = 'auto',
		secondaryLines = [],
		loading = false,
	} = $props();

	// Tooltip state
	let tooltip = $state({
		visible: false,
		clientX: 0,
		clientY: 0,
		date: '',
		value: '',
		label: '',
		chartColor: '',
		hasData: true,
	});
	const missingPointColor = 'rgba(148, 163, 184, 0.7)';

	function showTooltip(event, point, labelOverride = null, unitOverride = null) {
		tooltip = {
			visible: true,
			clientX: event.clientX,
			clientY: event.clientY,
			date: point.label || formatDate(point.date),
			value: point.value.toLocaleString() + (unitOverride ?? unit),
			label: labelOverride,
			chartColor: color,
			hasData: point.hasData !== false,
		};
	}

	function hideTooltip() {
		tooltip.visible = false;
	}

	// Responsive chart dimensions - using viewBox for scaling
	const viewBoxWidth = 800;
	const viewBoxHeight = 200;
	const padding = { top: 20, right: 20, bottom: 35, left: 50 };

	const innerWidth = viewBoxWidth - padding.left - padding.right;
	const innerHeight = viewBoxHeight - padding.top - padding.bottom;

	// Compute chart data
	const chartData = $derived.by(() => {
		if (!data || data.length === 0) return null;

		const values = data.map((d) => d.value || 0);
		const maxValue = Math.max(...values, 1);
		const minValue = Math.min(...values);
		const range = maxValue - minValue || 1;

		// Calculate positions
		const xStep = innerWidth / Math.max(data.length - 1, 1);
		const points = data.map((d, i) => {
			const x = padding.left + i * xStep;
			const normalizedValue = (d.value - minValue) / range;
			const y = padding.top + innerHeight - normalizedValue * innerHeight;
			return { ...d, x, y, normalizedValue };
		});

		// Build smooth curve path using catmull-rom spline
		const linePath = buildSmoothPath(points);

		// Area path - strip the leading "M x y" from linePath to get just the curve/line commands
		const curveCommands = linePath.replace(/^M\s+\S+\s+\S+/, '');
		const areaPath =
			`M ${padding.left} ${padding.top + innerHeight} ` +
			`L ${points[0]?.x || padding.left} ${points[0]?.y || padding.top + innerHeight}` +
			curveCommands +
			` L ${points[points.length - 1]?.x || padding.left} ${padding.top + innerHeight} Z`;

		// Grid lines (5 horizontal)
		const gridLines = [0, 0.25, 0.5, 0.75, 1].map((tick) => ({
			y: padding.top + innerHeight * (1 - tick),
			value: Math.round(minValue + range * tick),
			label: formatAxisValue(minValue + range * tick),
		}));

		// X-axis labels (show ~7 labels max)
		const labelInterval = Math.max(1, Math.ceil(data.length / 7));
		const xLabels = points.filter(
			(_, i) => i === 0 || i === points.length - 1 || i % labelInterval === 0
		);

		return {
			points,
			linePath: linePath || `M ${points[0]?.x} ${points[0]?.y}`,
			areaPath,
			gridLines,
			xLabels,
			maxValue,
			minValue,
			range,
			total: values.reduce((a, b) => a + b, 0),
			average: values.reduce((a, b) => a + b, 0) / values.length,
			peak: Math.max(...values),
		};
	});

	// Compute secondary lines data (using their own scale on the right axis)
	const secondaryData = $derived.by(() => {
		if (!secondaryLines || secondaryLines.length === 0 || !data || data.length === 0) return [];

		const xStep = innerWidth / Math.max(data.length - 1, 1);

		return secondaryLines.map((line) => {
			const values = data.map((d) => d[line.key] || 0);
			const maxValue = Math.max(...values, 1);
			const minValue = 0; // Always start from 0 for secondary lines
			const range = maxValue - minValue || 1;

			const points = data.map((d, i) => {
				const x = padding.left + i * xStep;
				const rawValue = d[line.key] || 0;
				const normalizedValue = (rawValue - minValue) / range;
				const y = padding.top + innerHeight - normalizedValue * innerHeight;
				return { ...d, x, y, value: rawValue, normalizedValue };
			});

			const linePath = buildSmoothPath(points);

			return {
				...line,
				points,
				linePath: linePath || `M ${points[0]?.x} ${points[0]?.y}`,
				maxValue,
				minValue,
				range,
			};
		});
	});

	// Build straight line path through points
	function buildSmoothPath(points) {
		if (points.length < 2) return '';

		let path = `M ${points[0].x} ${points[0].y}`;

		for (let i = 1; i < points.length; i++) {
			path += ` L ${points[i].x} ${points[i].y}`;
		}

		return path;
	}

	// Format axis values nicely
	function formatAxisValue(value) {
		if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
		if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
		return Math.round(value).toString();
	}

	// Format date for labels
	function formatDate(dateStr) {
		if (!dateStr) return '';
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
</script>

<div class="chart-wrapper" style:--chart-color={color} style:--chart-height={height}>
	<ChartTooltip {tooltip} />
	{#if loading}
		<div class="chart-skeleton" aria-hidden="true">
			<div class="chart-skeleton-grid"></div>
			<div class="chart-skeleton-line"></div>
			<div class="chart-skeleton-points">
				{#each Array(8) as _, index}
					<span class="chart-skeleton-point" style:left={`${8 + index * 12}%`}></span>
				{/each}
			</div>
		</div>
	{:else if chartData && chartData.points.length > 0}
		<svg
			viewBox="0 0 {viewBoxWidth} {viewBoxHeight}"
			class="area-chart"
			preserveAspectRatio="xMidYMid meet"
			role="img"
			aria-label={title || 'Area chart'}
		>
			<defs>
				<!-- Gradient for area fill -->
				<linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
					<stop offset="0%" stop-color={color} stop-opacity="0.4" />
					<stop offset="50%" stop-color={color} stop-opacity="0.15" />
					<stop offset="100%" stop-color={color} stop-opacity="0.02" />
				</linearGradient>

				<!-- Glow filter for line -->
				<filter id="{gradientId}-glow" x="-20%" y="-20%" width="140%" height="140%">
					<feGaussianBlur stdDeviation="2" result="blur" />
					<feMerge>
						<feMergeNode in="blur" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>

				<!-- Point glow -->
				<filter id="{gradientId}-point-glow" x="-100%" y="-100%" width="300%" height="300%">
					<feGaussianBlur stdDeviation="3" result="blur" />
					<feMerge>
						<feMergeNode in="blur" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>

			<!-- Grid lines -->
			{#each chartData.gridLines as line}
				<line
					x1={padding.left}
					y1={line.y}
					x2={viewBoxWidth - padding.right}
					y2={line.y}
					class="grid-line"
				/>
				<text
					x={padding.left - 8}
					y={line.y + 4}
					class="axis-label y-label"
					text-anchor="end"
				>
					{line.label}{unit}
				</text>
			{/each}

			<!-- Area fill with gradient -->
			<path d={chartData.areaPath} class="chart-area" fill="url(#{gradientId})" />

			<!-- Main line with glow -->
			<path
				d={chartData.linePath}
				class="chart-line"
				fill="none"
				filter="url(#{gradientId}-glow)"
			/>

			<!-- Data points -->
			{#if showPoints}
				{#each chartData.points as point, i}
					<!-- Outer glow -->
					<circle
						cx={point.x}
						cy={point.y}
						r="6"
						class="point-glow"
						class:missing-data={point.hasData === false}
						style:fill={point.hasData === false ? missingPointColor : null}
						filter="url(#{gradientId}-point-glow)"
					/>
					<!-- Inner point -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<circle
						cx={point.x}
						cy={point.y}
						r="4"
						class="chart-point"
						class:missing-data={point.hasData === false}
						style:fill={point.hasData === false ? missingPointColor : null}
						onmouseenter={(e) => showTooltip(e, point)}
						onmouseleave={hideTooltip}
					/>
				{/each}
			{/if}

			<!-- Secondary lines -->
			{#each secondaryData as secondary, idx}
				<path
					d={secondary.linePath}
					class="secondary-line"
					style:stroke={secondary.color}
					fill="none"
				/>
				{#if showPoints}
					{#each secondary.points as point}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<circle
							cx={point.x}
							cy={point.y}
							r="3"
							class="secondary-point"
							style:fill={secondary.color}
							onmouseenter={(e) =>
								showTooltip(e, point, secondary.label, secondary.unit || '')}
							onmouseleave={hideTooltip}
						/>
					{/each}
				{/if}
			{/each}

			<!-- X-axis labels -->
			{#each chartData.xLabels as point}
				<text
					x={point.x}
					y={viewBoxHeight - 8}
					class="axis-label x-label"
					text-anchor="middle"
				>
					{point.label || formatDate(point.date)}
				</text>
			{/each}
		</svg>

		<!-- Legend for secondary lines -->
		{#if secondaryData.length > 0}
			<div class="chart-legend">
				<div class="legend-item">
					<span class="legend-line" style:background-color={color}></span>
					<span class="legend-label">{title || 'Primary'}</span>
				</div>
				{#each secondaryData as secondary}
					<div class="legend-item">
						<span class="legend-line" style:background-color={secondary.color}></span>
						<span class="legend-label">{secondary.label}</span>
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<div class="chart-empty">
			<span class="empty-icon">📊</span>
			<span class="empty-text">{emptyMessage}</span>
		</div>
	{/if}
</div>

<style>
	.chart-wrapper {
		width: 100%;
		position: relative;
		container-type: inline-size;
	}

	.chart-skeleton {
		position: relative;
		width: 100%;
		min-height: 180px;
		border-radius: var(--radius-lg, 12px);
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02));
		overflow: hidden;
	}

	.chart-skeleton-grid,
	.chart-skeleton-line,
	.chart-skeleton-points {
		position: absolute;
		inset: 0;
	}

	.chart-skeleton-grid {
		background-image:
			linear-gradient(
				to bottom,
				transparent 0%,
				transparent 24%,
				rgba(255, 255, 255, 0.05) 24%,
				rgba(255, 255, 255, 0.05) 25%,
				transparent 25%,
				transparent 49%,
				rgba(255, 255, 255, 0.05) 49%,
				rgba(255, 255, 255, 0.05) 50%,
				transparent 50%,
				transparent 74%,
				rgba(255, 255, 255, 0.05) 74%,
				rgba(255, 255, 255, 0.05) 75%,
				transparent 75%
			),
			linear-gradient(
				to right,
				transparent 0%,
				transparent 12%,
				rgba(255, 255, 255, 0.04) 12%,
				rgba(255, 255, 255, 0.04) 13%,
				transparent 13%,
				transparent 25%,
				rgba(255, 255, 255, 0.04) 25%,
				rgba(255, 255, 255, 0.04) 26%,
				transparent 26%,
				transparent 38%,
				rgba(255, 255, 255, 0.04) 38%,
				rgba(255, 255, 255, 0.04) 39%,
				transparent 39%,
				transparent 51%,
				rgba(255, 255, 255, 0.04) 51%,
				rgba(255, 255, 255, 0.04) 52%,
				transparent 52%,
				transparent 64%,
				rgba(255, 255, 255, 0.04) 64%,
				rgba(255, 255, 255, 0.04) 65%,
				transparent 65%,
				transparent 77%,
				rgba(255, 255, 255, 0.04) 77%,
				rgba(255, 255, 255, 0.04) 78%,
				transparent 78%,
				transparent 90%,
				rgba(255, 255, 255, 0.04) 90%,
				rgba(255, 255, 255, 0.04) 91%,
				transparent 91%
			);
		background-size: 100% 100%;
		opacity: 0.9;
	}

	.chart-skeleton-line {
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba(34, 197, 94, 0.15) 10%,
			rgba(34, 197, 94, 0.55) 50%,
			rgba(34, 197, 94, 0.15) 90%,
			transparent 100%
		);
		mask-image: linear-gradient(to top, transparent 58%, #000 58%, #000 76%, transparent 76%);
		animation: shimmer 1.8s ease-in-out infinite;
	}

	.chart-skeleton-points {
		pointer-events: none;
	}

	.chart-skeleton-point {
		position: absolute;
		top: 44%;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 999px;
		background: rgba(34, 197, 94, 0.65);
		box-shadow: 0 0 0 0.35rem rgba(34, 197, 94, 0.08);
	}

	@keyframes shimmer {
		0% {
			transform: translateX(-12%);
			opacity: 0.55;
		}
		50% {
			opacity: 0.95;
		}
		100% {
			transform: translateX(12%);
			opacity: 0.55;
		}
	}

	.area-chart {
		display: block;
		width: 100%;
		height: var(--chart-height, auto);
		min-height: 180px;
	}

	@container (min-width: 400px) {
		.area-chart {
			min-height: 220px;
		}
	}

	@container (min-width: 600px) {
		.area-chart {
			min-height: 260px;
		}
	}

	.grid-line {
		stroke: var(--color-border, rgba(255, 255, 255, 0.1));
		stroke-width: 1;
		stroke-dasharray: 4 4;
		opacity: 0.5;
	}

	.axis-label {
		fill: var(--color-text-muted, rgba(255, 255, 255, 0.5));
		font-size: 11px;
		font-family: var(--font-sans, system-ui, sans-serif);
	}

	.y-label {
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}

	.x-label {
		font-size: 10px;
	}

	.chart-area {
		opacity: 1;
	}

	.chart-line {
		stroke: var(--chart-color);
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.point-glow {
		fill: var(--chart-color);
		opacity: 0.3;
	}

	.point-glow.missing-data {
		opacity: 0.18;
	}

	.chart-point {
		fill: var(--chart-color);
		stroke: var(--color-surface, #1a1a1a);
		stroke-width: 2;
		cursor: pointer;
		transition:
			r 0.15s ease,
			fill 0.15s ease;
	}

	.chart-point:hover {
		r: 6;
	}

	.chart-point.missing-data {
		stroke: rgba(203, 213, 225, 0.45);
	}

	.secondary-line {
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0.85;
	}

	.secondary-point {
		stroke: var(--color-surface, #1a1a1a);
		stroke-width: 1.5;
		cursor: pointer;
		transition: r 0.15s ease;
	}

	.secondary-point:hover {
		r: 5;
	}

	.chart-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: center;
		padding: 0.75rem 0 0;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.legend-line {
		width: 16px;
		height: 3px;
		border-radius: 2px;
	}

	.legend-label {
		font-size: 0.75rem;
		color: var(--color-text-muted, rgba(255, 255, 255, 0.7));
	}

	.chart-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3rem 2rem;
		background: var(--color-surface, rgba(255, 255, 255, 0.05));
		border: 1px dashed var(--color-border, rgba(255, 255, 255, 0.1));
		border-radius: var(--radius-lg, 12px);
		min-height: 180px;
	}

	.empty-icon {
		font-size: 2rem;
		opacity: 0.5;
	}

	.empty-text {
		color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
		font-size: 0.9rem;
	}
</style>
