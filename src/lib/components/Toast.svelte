<script>
	let { message, success = true, onDismiss = () => {} } = $props();
	
	let visible = $state(true);
	let hiding = $state(false);
	
	$effect(() => {
		// Auto-dismiss after 5 seconds
		const timer = setTimeout(() => {
			hiding = true;
			// Wait for animation to complete before removing
			setTimeout(() => {
				visible = false;
				onDismiss();
			}, 300);
		}, 5000);
		
		return () => clearTimeout(timer);
	});
	
	function dismiss() {
		hiding = true;
		setTimeout(() => {
			visible = false;
			onDismiss();
		}, 300);
	}
</script>

{#if visible}
	<div 
		class="toast {success ? 'toast-success' : 'toast-error'} {hiding ? 'toast-hiding' : ''}"
		role="alert"
	>
		<span class="toast-icon">{success ? '✓' : '✕'}</span>
		<span class="toast-message">{message}</span>
		<button class="toast-close" onclick={dismiss} aria-label="Dismiss notification">×</button>
	</div>
{/if}

<style>
	.toast {
		position: fixed;
		bottom: 2rem;
		right: 2rem;
		padding: 1rem 1.5rem;
		border-radius: 8px;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		z-index: 1100;
		animation: slideIn 0.3s ease forwards;
		box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.3));
		max-width: 400px;
	}
	
	.toast-hiding {
		animation: slideOut 0.3s ease forwards;
	}
	
	@keyframes slideIn {
		from {
			transform: translateX(100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
	
	@keyframes slideOut {
		from {
			transform: translateX(0);
			opacity: 1;
		}
		to {
			transform: translateX(100%);
			opacity: 0;
		}
	}
	
	.toast-success {
		background: var(--color-success, #43b581);
		color: var(--color-text-inverse, #fff);
	}
	
	.toast-error {
		background: var(--color-danger, #f04747);
		color: var(--color-text-inverse, #fff);
	}
	
	.toast-icon {
		font-weight: bold;
		font-size: 1.1rem;
	}
	
	.toast-message {
		flex: 1;
	}
	
	.toast-close {
		background: none;
		border: none;
		color: inherit;
		font-size: 1.25rem;
		cursor: pointer;
		padding: 0;
		margin-left: 0.5rem;
		opacity: 0.7;
		transition: opacity 0.2s;
		line-height: 1;
	}
	
	.toast-close:hover {
		opacity: 1;
	}
</style>
