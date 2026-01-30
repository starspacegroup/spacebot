<script>
	import { theme } from '$lib/theme.svelte.js';
</script>

<div class="theme-selector">
	<span class="selector-label" id="theme-label">Theme</span>
	<div class="options" role="group" aria-labelledby="theme-label">
		<button
			class="option"
			class:active={theme.preference === 'light'}
			onclick={() => theme.set('light')}
			aria-pressed={theme.preference === 'light'}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="5"/>
				<line x1="12" y1="1" x2="12" y2="3"/>
				<line x1="12" y1="21" x2="12" y2="23"/>
				<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
				<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
				<line x1="1" y1="12" x2="3" y2="12"/>
				<line x1="21" y1="12" x2="23" y2="12"/>
				<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
				<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
			</svg>
			<span>Light</span>
		</button>
		
		<button
			class="option"
			class:active={theme.preference === 'dark'}
			onclick={() => theme.set('dark')}
			aria-pressed={theme.preference === 'dark'}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
			</svg>
			<span>Dark</span>
		</button>
		
		<button
			class="option"
			class:active={theme.preference === 'system'}
			onclick={() => theme.set('system')}
			aria-pressed={theme.preference === 'system'}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
				<line x1="8" y1="21" x2="16" y2="21"/>
				<line x1="12" y1="17" x2="12" y2="21"/>
			</svg>
			<span>System</span>
		</button>
	</div>
</div>

<style>
	.theme-selector {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.selector-label {
		font-weight: 500;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}
	
	.options {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	
	.option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		border: 2px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
		font-size: 0.875rem;
		font-weight: 500;
	}
	
	.option:hover {
		border-color: var(--color-primary);
		background: var(--color-surface-hover);
	}
	
	.option.active {
		border-color: var(--color-primary);
		background: var(--color-primary-soft);
		color: var(--color-primary);
	}
	
	.option svg {
		flex-shrink: 0;
	}
</style>
