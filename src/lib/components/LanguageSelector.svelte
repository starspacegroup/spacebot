<script lang="ts">
	import {
		LOCALE_NAMES,
		LOCALE_SHORT_NAMES,
		SUPPORTED_LOCALES,
		normalizeLocale,
		t,
		type Locale,
	} from '$lib/i18n.js';

	const { locale = 'en' }: { locale?: Locale } = $props();
	const current = $derived(normalizeLocale(locale));

	let isOpen = $state(false);

	function toggleMenu() {
		isOpen = !isOpen;
	}

	function closeMenu() {
		isOpen = false;
	}

	function selectLanguage(next: Locale) {
		closeMenu();
		if (next === current) return;
		document.cookie = `spacebot_locale=${next};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
		location.reload();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') closeMenu();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="language-selector" class:open={isOpen}>
	<button
		class="language-button"
		onclick={toggleMenu}
		aria-expanded={isOpen}
		aria-haspopup="menu"
		aria-label={t(current, 'language.label')}
		title={t(current, 'language.label')}
	>
		<!-- Globe icon signals language selection -->
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="10" />
			<line x1="2" y1="12" x2="22" y2="12" />
			<path
				d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
			/>
		</svg>
		<span class="current-code">{LOCALE_SHORT_NAMES[current]}</span>
		<svg
			class="chevron"
			width="12"
			height="12"
			viewBox="0 0 12 12"
			fill="none"
			aria-hidden="true"
		>
			<path
				d="M3 4.5L6 7.5L9 4.5"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</button>

	{#if isOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="menu-backdrop" onclick={closeMenu}></div>
		<div class="dropdown" role="menu">
			{#each SUPPORTED_LOCALES as code}
				<button
					class="dropdown-item"
					class:active={code === current}
					role="menuitemradio"
					aria-checked={code === current}
					onclick={() => selectLanguage(code)}
					title={LOCALE_NAMES[code]}
				>
					<span class="item-code">{LOCALE_SHORT_NAMES[code]}</span>
					<span class="item-name">{LOCALE_NAMES[code]}</span>
					{#if code === current}
						<svg
							class="check"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<polyline points="20 6 9 17 4 12" />
						</svg>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.language-selector {
		position: relative;
	}

	.language-button {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem;
		background: var(--color-surface-elevated);
		border: none;
		border-radius: 8px;
		color: var(--color-text);
		cursor: pointer;
		font-family: inherit;
		transition:
			background-color 0.2s,
			transform 0.1s;
	}

	.language-button:hover {
		background: var(--color-surface-hover);
	}

	.language-button:active {
		transform: scale(0.95);
	}

	.language-button svg {
		display: block;
	}

	.current-code {
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.chevron {
		color: var(--color-text-muted);
		transition: transform var(--transition-fast);
	}

	.open .chevron {
		transform: rotate(180deg);
	}

	.menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
	}

	.dropdown {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		min-width: 160px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		z-index: 100;
		overflow: hidden;
		padding: 0.25rem;
		animation: dropdown-in 0.15s ease-out;
	}

	@keyframes dropdown-in {
		from {
			opacity: 0;
			transform: translateY(-8px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.5rem 0.6rem;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text);
		font-family: inherit;
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
		transition: background var(--transition-fast);
	}

	.dropdown-item:hover {
		background: var(--color-surface-hover);
	}

	.dropdown-item.active {
		color: var(--color-primary);
	}

	.item-code {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		color: var(--color-text-muted);
		min-width: 1.6rem;
	}

	.dropdown-item.active .item-code {
		color: var(--color-primary);
	}

	.item-name {
		flex: 1;
	}

	.check {
		color: var(--color-primary);
		flex-shrink: 0;
	}
</style>
