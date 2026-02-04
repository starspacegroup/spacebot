<script>
	/**
	 * Chart card wrapper with summary stats
	 * @type {{ title?: string, subtitle?: string, icon?: string, stats?: Array<{value: string|number, label: string, color?: string, icon?: string}>, children?: import('svelte').Snippet }}
	 */
	let { 
		title = '',
		subtitle = '',
		icon = '📊',
		stats = [],
		children
	} = $props();
</script>

<div class="chart-card">
	<!-- Header -->
	{#if title}
		<header class="chart-header">
			<h3 class="chart-title">
				<span class="chart-icon">{icon}</span>
				<span class="title-text">{title}</span>
				{#if subtitle}
					<span class="chart-subtitle">{subtitle}</span>
				{/if}
			</h3>
		</header>
	{/if}
	
	<!-- Summary Stats -->
	{#if stats.length > 0}
		<div class="chart-stats">
			{#each stats as stat}
				<div class="stat-item">
					{#if stat.icon}
						<span class="stat-icon">{stat.icon}</span>
					{/if}
					<div class="stat-content">
						<span class="stat-value" style:color={stat.color}>{stat.value}</span>
						<span class="stat-label">{stat.label}</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
	
	<!-- Chart Slot -->
	<div class="chart-body">
		{@render children?.()}
	</div>
</div>

<style>
	.chart-card {
		background: var(--color-surface, #1a1a1a);
		border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
		border-radius: var(--radius-lg, 12px);
		padding: 1rem;
		container-type: inline-size;
	}
	
	@container (min-width: 400px) {
		.chart-card {
			padding: 1.25rem;
		}
	}
	
	@container (min-width: 600px) {
		.chart-card {
			padding: 1.5rem;
		}
	}
	
	.chart-header {
		margin-bottom: 1rem;
	}
	
	.chart-title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text, #fff);
	}
	
	@container (min-width: 400px) {
		.chart-title {
			font-size: 1.1rem;
		}
	}
	
	.chart-icon {
		font-size: 1.1rem;
	}
	
	.chart-subtitle {
		font-size: 0.8rem;
		font-weight: 400;
		color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
	}
	
	.chart-stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
	}
	
	@container (min-width: 400px) {
		.chart-stats {
			grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
			gap: 1rem;
		}
	}
	
	.stat-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	
	.stat-icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}
	
	.stat-content {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	
	.stat-value {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--color-text, #fff);
		line-height: 1.2;
		white-space: nowrap;
	}
	
	@container (min-width: 400px) {
		.stat-value {
			font-size: 1.25rem;
		}
	}
	
	.stat-label {
		font-size: 0.7rem;
		color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	
	@container (min-width: 400px) {
		.stat-label {
			font-size: 0.75rem;
		}
	}
	
	.chart-body {
		position: relative;
	}
</style>
