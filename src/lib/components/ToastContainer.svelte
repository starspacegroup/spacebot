<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { toast } from '$lib/toast.svelte.js';
	import { getTranslator } from '$lib/i18n.js';

	const tr = getTranslator();
	const icons = { success: '✓', error: '✕', info: 'ℹ' } as const;
</script>

{#if toast.items.length > 0}
	<div
		class="toast-stack"
		role="region"
		aria-live="polite"
		aria-label={tr('toast.notifications')}
	>
		{#each toast.items as item (item.id)}
			<div
				class="toast toast-{item.type}"
				role="alert"
				in:fly={{ x: 32, duration: 250 }}
				out:fade={{ duration: 200 }}
				animate:flip={{ duration: 200 }}
			>
				<span class="toast-icon" aria-hidden="true">{icons[item.type]}</span>
				<span class="toast-message">{item.message}</span>
				<button
					class="toast-close"
					onclick={() => toast.dismiss(item.id)}
					aria-label={tr('toast.dismiss')}>×</button
				>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-stack {
		position: fixed;
		bottom: 1.5rem;
		right: 1.5rem;
		z-index: 1100;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: min(400px, calc(100vw - 2rem));
		pointer-events: none;
	}

	.toast {
		pointer-events: auto;
		padding: 0.85rem 1.1rem;
		border-radius: var(--radius-md, 8px);
		display: flex;
		align-items: center;
		gap: 0.75rem;
		box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.3));
		border: 1px solid transparent;
		font-size: 0.9rem;
	}

	.toast-success {
		background: var(--color-success);
		color: #1b1730;
	}

	.toast-error {
		background: var(--color-danger);
		color: #1b1730;
	}

	.toast-info {
		background: var(--color-surface-elevated);
		color: var(--color-text);
		border-color: var(--color-border);
	}

	.toast-icon {
		font-weight: bold;
		font-size: 1.05rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.toast-message {
		flex: 1;
		line-height: 1.35;
	}

	.toast-close {
		background: none;
		border: none;
		color: inherit;
		font-size: 1.25rem;
		cursor: pointer;
		padding: 0;
		margin-left: 0.25rem;
		opacity: 0.7;
		transition: opacity var(--transition-fast, 0.15s ease);
		line-height: 1;
		flex-shrink: 0;
	}

	.toast-close:hover {
		opacity: 1;
	}

	@media (max-width: 640px) {
		.toast-stack {
			left: 1rem;
			right: 1rem;
			bottom: 1rem;
			max-width: none;
		}
	}
</style>
