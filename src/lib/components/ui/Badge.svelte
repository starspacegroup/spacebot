<script lang="ts">
	export let tone: 'neutral' | 'success' | 'warning' | 'danger' = 'neutral';
	export let label = 'Badge';
</script>

<span class="ui-badge {tone}"><slot>{label}</slot></span>

<style>
	.ui-badge {
		display: inline-flex;
		align-items: center;
		border-radius: var(--radius-full);
		padding: 0.25rem 0.55rem;
		font-size: 0.8rem;
		font-weight: 700;
		background: var(--color-surface-elevated);
		color: var(--color-text-secondary);
	}
	.success {
		background: var(--color-success-soft);
		color: var(--color-success);
	}
	.warning {
		background: var(--color-warning-soft);
		color: var(--color-warning);
	}
	.danger {
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}
</style>
