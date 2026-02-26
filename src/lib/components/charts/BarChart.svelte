<script>
	/**
	 * Beautiful, responsive bar chart component
	 * @type {{ data: Array<{date: string, values: {label: string, value: number, color: string}[]}>, title?: string, emptyMessage?: string, height?: string, showLegend?: boolean }}
	 */
	let { 
		data = [], 
		title = '',
		emptyMessage = 'No data available',
		height = 'auto',
		showLegend = true
	} = $props();
	
	// Tooltip state
	let tooltip = $state({ visible: false, x: 0, y: 0, date: '', items: [] });
	
	function showTooltip(event, group) {
		const rect = event.currentTarget.closest('svg').getBoundingClientRect();
		const svgX = event.clientX - rect.left;
		const svgY = event.clientY - rect.top;
		tooltip = {
			visible: true,
			x: svgX,
			y: svgY,
			date: group.label || formatDate(group.date),
			items: group.bars.map(b => ({ label: b.label, value: b.value, color: b.color }))
		};
	}
	
	function hideTooltip() {
		tooltip.visible = false;
	}
	
	// Responsive chart dimensions
	const viewBoxWidth = 800;
	const viewBoxHeight = 200;
	const padding = { top: 20, right: 20, bottom: 35, left: 50 };
	
	const innerWidth = viewBoxWidth - padding.left - padding.right;
	const innerHeight = viewBoxHeight - padding.top - padding.bottom;
	
	// Extract unique legend items from data
	const legendItems = $derived.by(() => {
		if (!data || data.length === 0) return [];
		const first = data[0];
		if (!first.values) return [];
		return first.values.map(v => ({ label: v.label, color: v.color }));
	});
	
	// Compute chart data
	const chartData = $derived.by(() => {
		if (!data || data.length === 0) return null;
		
		// Find max value across all bars
		const allValues = data.flatMap(d => d.values?.map(v => v.value) || []);
		const maxValue = Math.max(...allValues, 1);
		
		// Calculate bar positions
		const barGroupWidth = innerWidth / data.length;
		const numBars = data[0]?.values?.length || 1;
		const barWidth = Math.min((barGroupWidth * 0.7) / numBars, 20);
		const groupGap = (barGroupWidth - barWidth * numBars) / 2;
		
		const bars = data.map((d, groupIndex) => {
			const groupX = padding.left + groupIndex * barGroupWidth;
			return {
				...d,
				bars: d.values?.map((v, barIndex) => {
					const barHeight = (v.value / maxValue) * innerHeight;
					return {
						...v,
						x: groupX + groupGap + barIndex * barWidth,
						y: padding.top + innerHeight - barHeight,
						width: barWidth - 2,
						height: barHeight,
					};
				}) || [],
				labelX: groupX + barGroupWidth / 2,
			};
		});
		
		// Grid lines
		const gridLines = [0, 0.25, 0.5, 0.75, 1].map(tick => ({
			y: padding.top + innerHeight * (1 - tick),
			value: Math.round(maxValue * tick),
			label: formatAxisValue(maxValue * tick)
		}));
		
		// X-axis labels (show ~10 labels max)
		const labelInterval = Math.max(1, Math.ceil(data.length / 10));
		const xLabels = bars.filter((_, i) => i === 0 || i === bars.length - 1 || i % labelInterval === 0);
		
		return {
			bars,
			gridLines,
			xLabels,
			maxValue,
			barWidth,
		};
	});
	
	// Format axis values
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

<div class="chart-wrapper" style:--chart-height={height}>
	{#if tooltip.visible}
		<div
			class="chart-tooltip"
			style:left="{tooltip.x}px"
			style:top="{tooltip.y}px"
		>
			<div class="tooltip-date">{tooltip.date}</div>
			{#each tooltip.items as item}
				{#if item.value > 0}
					<div class="tooltip-item">
						<span class="tooltip-color" style:background={item.color}></span>
						<span class="tooltip-label">{item.label}</span>
						<span class="tooltip-value">{item.value.toLocaleString()}</span>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
	{#if chartData && chartData.bars.length > 0}
		<svg 
			viewBox="0 0 {viewBoxWidth} {viewBoxHeight}" 
			class="bar-chart"
			preserveAspectRatio="xMidYMid meet"
			role="img"
			aria-label={title || 'Bar chart'}
		>
			<defs>
				<!-- Glow filters for each bar color -->
				{#each legendItems as item, i}
					<filter id="bar-glow-{i}" x="-50%" y="-50%" width="200%" height="200%">
						<feGaussianBlur stdDeviation="2" result="blur" />
						<feFlood flood-color={item.color} flood-opacity="0.3" />
						<feComposite in2="blur" operator="in" />
						<feMerge>
							<feMergeNode />
							<feMergeNode in="SourceGraphic" />
						</feMerge>
					</filter>
				{/each}
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
					{line.label}
				</text>
			{/each}
			
			<!-- Bars -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			{#each chartData.bars as group}
				{#each group.bars as bar, barIndex}
					<rect
						x={bar.x}
						y={bar.y}
						width={bar.width}
						height={Math.max(bar.height, 0)}
						fill={bar.color}
						rx="3"
						ry="3"
						class="bar"
						filter="url(#bar-glow-{barIndex})"
						onmouseenter={(e) => showTooltip(e, group)}
						onmouseleave={hideTooltip}
					/>
				{/each}
			{/each}
			
			<!-- X-axis labels -->
			{#each chartData.xLabels as group}
				<text 
					x={group.labelX} 
					y={viewBoxHeight - 8} 
					class="axis-label x-label"
					text-anchor="middle"
				>
					{group.label || formatDate(group.date)}
				</text>
			{/each}
		</svg>
		
		<!-- Legend -->
		{#if showLegend && legendItems.length > 0}
			<div class="chart-legend">
				{#each legendItems as item}
					<div class="legend-item">
						<span class="legend-color" style:background={item.color}></span>
						<span class="legend-label">{item.label}</span>
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
	
	.bar-chart {
		display: block;
		width: 100%;
		height: var(--chart-height, auto);
		min-height: 180px;
	}
	
	@container (min-width: 400px) {
		.bar-chart {
			min-height: 220px;
		}
	}
	
	@container (min-width: 600px) {
		.bar-chart {
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
	
	.bar {
		transition: opacity 0.15s ease, filter 0.15s ease;
		cursor: pointer;
	}
	
	.bar:hover {
		opacity: 0.85;
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
	
	.tooltip-date {
		color: var(--color-text-muted, rgba(255, 255, 255, 0.7));
		font-size: 0.8rem;
		margin-bottom: 0.25rem;
	}
	
	.tooltip-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	
	.tooltip-color {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		flex-shrink: 0;
	}
	
	.tooltip-label {
		color: var(--color-text-muted, rgba(255, 255, 255, 0.7));
		font-size: 0.8rem;
	}
	
	.tooltip-value {
		color: var(--color-text, #fff);
		font-weight: 600;
		font-size: 0.9rem;
		margin-left: auto;
	}
	
	.chart-legend {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 1rem;
		margin-top: 0.75rem;
		padding: 0 0.5rem;
	}
	
	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	
	.legend-color {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		flex-shrink: 0;
	}
	
	.legend-label {
		font-size: 0.8rem;
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
