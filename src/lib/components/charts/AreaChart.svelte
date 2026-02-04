<script>
	/**
	 * Beautiful, responsive area chart component with optional secondary lines
	 * @type {{ data: Array<{date: string, value: number, label?: string}>, color?: string, gradientId?: string, unit?: string, title?: string, emptyMessage?: string, showPoints?: boolean, height?: string, secondaryLines?: Array<{key: string, color: string, label: string, unit?: string}> }}
	 */
	let { 
		data = [], 
		color = '#FEE75C', 
		gradientId = 'areaGradient',
		unit = '',
		title = '',
		emptyMessage = 'No data available',
		showPoints = true,
		height = 'auto',
		secondaryLines = []
	} = $props();
	
	// Tooltip state
	let tooltip = $state({ visible: false, x: 0, y: 0, date: '', value: '', label: '' });
	
	function showTooltip(event, point, labelOverride = null, unitOverride = null) {
		const rect = event.currentTarget.closest('svg').getBoundingClientRect();
		const svgX = event.clientX - rect.left;
		const svgY = event.clientY - rect.top;
		tooltip = {
			visible: true,
			x: svgX,
			y: svgY,
			date: point.label || formatDate(point.date),
			value: point.value.toLocaleString() + (unitOverride ?? unit),
			label: labelOverride
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
		
		const values = data.map(d => d.value || 0);
		const maxValue = Math.max(...values, 1);
		const minValue = Math.min(...values);
		const range = maxValue - minValue || 1;
		
		// Calculate positions
		const xStep = innerWidth / Math.max(data.length - 1, 1);
		const points = data.map((d, i) => {
			const x = padding.left + i * xStep;
			const normalizedValue = (d.value - minValue) / range;
			const y = padding.top + innerHeight - (normalizedValue * innerHeight);
			return { ...d, x, y, normalizedValue };
		});
		
		// Build smooth curve path using catmull-rom spline
		const linePath = buildSmoothPath(points);
		
		// Area path
		const areaPath = `M ${padding.left} ${padding.top + innerHeight} ` +
			`L ${points[0]?.x || padding.left} ${points[0]?.y || padding.top + innerHeight} ` +
			linePath.slice(linePath.indexOf('L') + 1) +
			` L ${points[points.length - 1]?.x || padding.left} ${padding.top + innerHeight} Z`;
		
		// Grid lines (5 horizontal)
		const gridLines = [0, 0.25, 0.5, 0.75, 1].map(tick => ({
			y: padding.top + innerHeight * (1 - tick),
			value: Math.round(minValue + range * tick),
			label: formatAxisValue(minValue + range * tick)
		}));
		
		// X-axis labels (show ~7 labels max)
		const labelInterval = Math.max(1, Math.ceil(data.length / 7));
		const xLabels = points.filter((_, i) => i === 0 || i === points.length - 1 || i % labelInterval === 0);
		
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
		
		return secondaryLines.map(line => {
			const values = data.map(d => d[line.key] || 0);
			const maxValue = Math.max(...values, 1);
			const minValue = 0; // Always start from 0 for secondary lines
			const range = maxValue - minValue || 1;
			
			const points = data.map((d, i) => {
				const x = padding.left + i * xStep;
				const rawValue = d[line.key] || 0;
				const normalizedValue = (rawValue - minValue) / range;
				const y = padding.top + innerHeight - (normalizedValue * innerHeight);
				return { ...d, x, y, value: rawValue, normalizedValue };
			});
			
			const linePath = buildSmoothPath(points);
			
			return {
				...line,
				points,
				linePath: linePath || `M ${points[0]?.x} ${points[0]?.y}`,
				maxValue,
				minValue,
				range
			};
		});
	});
	
	// Build smooth bezier curve through points
	function buildSmoothPath(points) {
		if (points.length < 2) return '';
		if (points.length === 2) {
			return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
		}
		
		let path = `M ${points[0].x} ${points[0].y}`;
		
		for (let i = 0; i < points.length - 1; i++) {
			const p0 = points[Math.max(0, i - 1)];
			const p1 = points[i];
			const p2 = points[i + 1];
			const p3 = points[Math.min(points.length - 1, i + 2)];
			
			// Catmull-Rom to Bezier conversion
			const tension = 0.3;
			const cp1x = p1.x + (p2.x - p0.x) * tension;
			const cp1y = p1.y + (p2.y - p0.y) * tension;
			const cp2x = p2.x - (p3.x - p1.x) * tension;
			const cp2y = p2.y - (p3.y - p1.y) * tension;
			
			path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
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
	{#if tooltip.visible}
		<div 
			class="chart-tooltip"
			style:left="{tooltip.x}px"
			style:top="{tooltip.y}px"
		>
			{#if tooltip.label}<div class="tooltip-label">{tooltip.label}</div>{/if}
			<div class="tooltip-date">{tooltip.date}</div>
			<div class="tooltip-value">{tooltip.value}</div>
		</div>
	{/if}
	{#if chartData && chartData.points.length > 0}
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
						filter="url(#{gradientId}-point-glow)"
					/>
					<!-- Inner point -->
					<circle 
						cx={point.x} 
						cy={point.y} 
						r="4" 
						class="chart-point"
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
						<circle 
							cx={point.x} 
							cy={point.y} 
							r="3" 
							class="secondary-point"
							style:fill={secondary.color}
							onmouseenter={(e) => showTooltip(e, point, secondary.label, secondary.unit || '')}
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
	
	.chart-tooltip {
		position: absolute;
		pointer-events: none;
		background: var(--color-surface, rgba(30, 30, 30, 0.95));
		border: 1px solid var(--color-border, rgba(255, 255, 255, 0.15));
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		transform: translate(-50%, -120%);
		z-index: 10;
		white-space: nowrap;
	}
	
	.tooltip-label {
		color: var(--chart-color, #FEE75C);
		font-weight: 600;
		margin-bottom: 0.15rem;
	}
	
	.tooltip-date {
		color: var(--color-text-muted, rgba(255, 255, 255, 0.7));
		font-size: 0.8rem;
	}
	
	.tooltip-value {
		color: var(--color-text, #fff);
		font-weight: 600;
		font-size: 1rem;
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
	
	.chart-point {
		fill: var(--chart-color);
		stroke: var(--color-surface, #1a1a1a);
		stroke-width: 2;
		cursor: pointer;
		transition: r 0.15s ease, fill 0.15s ease;
	}
	
	.chart-point:hover {
		r: 6;
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
