<script lang="ts">
	/**
	 * Reusable loading placeholder with a subtle shimmer.
	 *
	 * <Skeleton />                              // single line
	 * <Skeleton width="12rem" height="2rem" /> // sized block
	 * <Skeleton count={3} />                    // 3 stacked lines
	 * <Skeleton circle width="40px" height="40px" />
	 *
	 * Respects prefers-reduced-motion via the global rule in global.css.
	 */
	let {
		width = '100%',
		height = '1rem',
		radius = 'var(--radius-sm, 4px)',
		circle = false,
		count = 1,
		class: className = ''
	}: {
		width?: string;
		height?: string;
		radius?: string;
		circle?: boolean;
		count?: number;
		class?: string;
	} = $props();

	const resolvedRadius = $derived(circle ? '50%' : radius);
</script>

{#each Array(Math.max(1, count)) as _, i (i)}
	<span
		class="skeleton {className}"
		style="width:{width};height:{height};border-radius:{resolvedRadius};"
		aria-hidden="true"
	></span>
{/each}

<style>
	.skeleton {
		display: block;
		background: linear-gradient(
			90deg,
			var(--color-surface-elevated) 25%,
			var(--color-surface-hover) 50%,
			var(--color-surface-elevated) 75%
		);
		background-size: 200% 100%;
		animation: skeleton-shimmer 1.4s ease-in-out infinite;
	}

	.skeleton + .skeleton {
		margin-top: 0.5rem;
	}

	@keyframes skeleton-shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}
</style>
