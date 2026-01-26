<script>
	import { theme } from '$lib/theme.svelte.js';
	
	/** @type {{ showLabels?: boolean }} */
	let { showLabels = false } = $props();
</script>

<button 
	class="theme-toggle" 
	onclick={() => theme.toggle()}
	aria-label={theme.isDark ? 'Switch to light mode' : 'Switch to dark mode'}
	title={theme.isDark ? 'Switch to light mode' : 'Switch to dark mode'}
>
	{#if theme.isDark}
		<!-- Sun icon for dark mode (click to go light) -->
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
	{:else}
		<!-- Moon icon for light mode (click to go dark) -->
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
		</svg>
	{/if}
	{#if showLabels}
		<span class="label">{theme.isDark ? 'Light' : 'Dark'}</span>
	{/if}
</button>

<style>
	.theme-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border: none;
		background: var(--color-surface-elevated);
		color: var(--color-text);
		border-radius: 8px;
		cursor: pointer;
		transition: background-color 0.2s, transform 0.1s;
	}
	
	.theme-toggle:hover {
		background: var(--color-surface-hover);
	}
	
	.theme-toggle:active {
		transform: scale(0.95);
	}
	
	.label {
		font-size: 0.875rem;
		font-weight: 500;
	}
	
	svg {
		display: block;
	}
</style>
