<script lang="ts">
	import { log } from '$lib/log.js';

	/**
	 * Emoji Selector Component
	 * A searchable dropdown for selecting Discord emojis (both custom and standard)
	 *
	 * Can either fetch emojis itself (if guildId provided) or use pre-loaded emojis
	 */

	// Common standard emoji reactions
	const STANDARD_EMOJIS = [
		{
			id: null,
			name: '👍',
			displayString: '👍',
			reactionString: '👍',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '👎',
			displayString: '👎',
			reactionString: '👎',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '❤️',
			displayString: '❤️',
			reactionString: '❤️',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '😂',
			displayString: '😂',
			reactionString: '😂',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '😮',
			displayString: '😮',
			reactionString: '😮',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '😢',
			displayString: '😢',
			reactionString: '😢',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '😡',
			displayString: '😡',
			reactionString: '😡',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '🎉',
			displayString: '🎉',
			reactionString: '🎉',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '✅',
			displayString: '✅',
			reactionString: '✅',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '❌',
			displayString: '❌',
			reactionString: '❌',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '⭐',
			displayString: '⭐',
			reactionString: '⭐',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '🔥',
			displayString: '🔥',
			reactionString: '🔥',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '👀',
			displayString: '👀',
			reactionString: '👀',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '🤔',
			displayString: '🤔',
			reactionString: '🤔',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '💯',
			displayString: '💯',
			reactionString: '💯',
			animated: false,
			standard: true,
		},
		{
			id: null,
			name: '🙏',
			displayString: '🙏',
			reactionString: '🙏',
			animated: false,
			standard: true,
		},
	];

	/* eslint-disable prefer-const -- Svelte 5: this $props() block reassigns a $bindable, so the destructuring must use `let`; the sibling props cannot be split into a separate const. */
	let {
		guildId = null,
		emojis: preloadedEmojis = null, // Pre-loaded emojis to avoid multiple fetches
		value = $bindable(),
		name = 'emoji',
		required = false,
		placeholder = 'Search emojis...',
	} = $props();
	/* eslint-enable prefer-const */

	// Ensure value is never undefined internally
	$effect(() => {
		if (value === undefined) {
			value = '';
		}
	});

	let customEmojis = $state([]);
	let loading = $state(false);
	let error = $state(null);
	let searchQuery = $state('');
	let isOpen = $state(false);
	let highlightedIndex = $state(-1);

	let inputRef = $state(null);
	let dropdownRef = $state(null);

	// Use preloaded emojis if provided, otherwise fetch
	$effect(() => {
		if (preloadedEmojis) {
			customEmojis = preloadedEmojis;
		} else if (guildId) {
			fetchEmojis();
		} else {
			customEmojis = [];
		}
	});

	async function fetchEmojis() {
		loading = true;
		error = null;

		try {
			const response = await fetch(`/api/discord/guilds/${guildId}/emojis`);

			if (!response.ok) {
				throw new Error('Failed to fetch emojis');
			}

			const data = await response.json();
			customEmojis = data.emojis || [];
		} catch (err) {
			log.error('Error fetching emojis:', err);
			error = err.message;
			customEmojis = [];
		} finally {
			loading = false;
		}
	}

	// All emojis combined (standard + custom)
	const allEmojis = $derived([...STANDARD_EMOJIS, ...customEmojis]);

	// Filter emojis by search query
	const filteredEmojis = $derived.by(() => {
		if (!searchQuery.trim()) return allEmojis;

		const query = searchQuery.toLowerCase();
		return allEmojis.filter((emoji) => emoji.name.toLowerCase().includes(query));
	});

	// Split filtered emojis into standard and custom for grouped display
	const filteredStandard = $derived(filteredEmojis.filter((e) => e.standard));
	const filteredCustom = $derived(filteredEmojis.filter((e) => !e.standard));

	// Get selected emoji info for display
	const selectedEmoji = $derived.by(() => {
		if (!value) return null;
		return allEmojis.find((e) => e.reactionString === value);
	});

	function isSelected(emoji) {
		return value === emoji.reactionString;
	}

	function selectEmoji(emoji) {
		value = emoji.reactionString;
		searchQuery = '';
		isOpen = false;
		highlightedIndex = -1;
	}

	function clearSelection() {
		value = '';
		searchQuery = '';
		inputRef?.focus();
	}

	function handleInputFocus() {
		isOpen = true;
	}

	function handleInputBlur(_e) {
		// Delay closing to allow click events on dropdown items
		setTimeout(() => {
			if (!dropdownRef?.contains(document.activeElement)) {
				isOpen = false;
				highlightedIndex = -1;
			}
		}, 150);
	}

	function handleKeydown(e) {
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				highlightedIndex = Math.min(highlightedIndex + 1, filteredEmojis.length - 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				highlightedIndex = Math.max(highlightedIndex - 1, -1);
				break;
			case 'Enter':
				e.preventDefault();
				if (highlightedIndex >= 0 && filteredEmojis[highlightedIndex]) {
					selectEmoji(filteredEmojis[highlightedIndex]);
				}
				break;
			case 'Escape':
				isOpen = false;
				highlightedIndex = -1;
				break;
		}
	}

	// Close dropdown when clicking outside
	function handleClickOutside(e) {
		if (dropdownRef && !dropdownRef.contains(e.target) && !inputRef?.contains(e.target)) {
			isOpen = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="emoji-selector">
	<!-- Hidden input for form submission -->
	<input type="hidden" {name} bind:value {required} />

	<div class="selector-input-wrapper">
		{#if value && !isOpen}
			<!-- Show selected emoji -->
			<div
				class="selected-emoji"
				role="button"
				tabindex="0"
				onclick={() => (isOpen = true)}
				onkeydown={(e) => e.key === 'Enter' && (isOpen = true)}
			>
				<span class="emoji-display">
					{#if selectedEmoji?.url}
						<img src={selectedEmoji.url} alt={selectedEmoji.name} class="emoji-image" />
					{:else}
						{selectedEmoji?.displayString || value}
					{/if}
					<span class="emoji-name">{selectedEmoji?.name || value}</span>
				</span>
				<button
					type="button"
					class="clear-btn"
					onclick={(e) => {
						e.stopPropagation();
						clearSelection();
					}}
					title="Clear selection"
				>
					×
				</button>
			</div>
		{:else}
			<!-- Search input -->
			<input
				type="text"
				bind:this={inputRef}
				bind:value={searchQuery}
				onfocus={handleInputFocus}
				onblur={handleInputBlur}
				onkeydown={handleKeydown}
				{placeholder}
				class="search-input"
				autocomplete="off"
			/>
		{/if}

		{#if loading}
			<span class="loading-indicator">⏳</span>
		{/if}
	</div>

	{#if isOpen && !loading}
		<div class="dropdown" bind:this={dropdownRef}>
			{#if error}
				<div class="dropdown-error">
					<span>⚠️ {error}</span>
					<button type="button" class="retry-btn" onclick={fetchEmojis}>Retry</button>
				</div>
			{:else if filteredEmojis.length === 0}
				<div class="dropdown-empty">
					{#if allEmojis.length === 0}
						No emojis available
					{:else}
						No emojis match "{searchQuery}"
					{/if}
				</div>
			{:else}
				<!-- Standard Emojis Section -->
				{#if filteredStandard.length > 0}
					<div class="section-header">Standard</div>
					<div class="emoji-grid">
						{#each filteredStandard as emoji}
							<button
								type="button"
								class="emoji-option"
								class:selected={isSelected(emoji)}
								onclick={() => selectEmoji(emoji)}
								title={emoji.name}
							>
								<span class="emoji-preview">{emoji.displayString}</span>
							</button>
						{/each}
					</div>
				{/if}

				<!-- Custom Emojis Section -->
				{#if filteredCustom.length > 0}
					<div class="section-header">Server Emojis</div>
					<div class="emoji-grid">
						{#each filteredCustom as emoji}
							<button
								type="button"
								class="emoji-option"
								class:selected={isSelected(emoji)}
								class:animated={emoji.animated}
								onclick={() => selectEmoji(emoji)}
								title={emoji.name}
							>
								<img
									src={emoji.url}
									alt={emoji.name}
									class="emoji-preview-img"
									loading="lazy"
								/>
							</button>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.emoji-selector {
		position: relative;
		width: 100%;
	}

	.selector-input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-input {
		width: 100%;
		padding: 0.625rem 0.875rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		color: var(--text-primary, #fff);
		font-size: 0.875rem;
		transition: border-color 0.2s;
	}

	.search-input:focus {
		outline: none;
		border-color: var(--accent-color, #5865f2);
	}

	.search-input::placeholder {
		color: var(--text-muted, #72767d);
	}

	.selected-emoji {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.selected-emoji:hover {
		border-color: var(--accent-color, #5865f2);
	}

	.emoji-display {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.emoji-image {
		width: 24px;
		height: 24px;
		object-fit: contain;
	}

	.emoji-name {
		color: var(--text-primary, #fff);
	}

	.clear-btn {
		background: none;
		border: none;
		color: var(--text-muted, #72767d);
		cursor: pointer;
		font-size: 1.25rem;
		padding: 0 0.25rem;
		line-height: 1;
	}

	.clear-btn:hover {
		color: var(--text-primary, #fff);
	}

	.loading-indicator {
		position: absolute;
		right: 0.75rem;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		margin-top: 4px;
		background: var(--bg-secondary, #2f3136);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		max-height: 320px;
		overflow-y: auto;
		z-index: 100;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		padding: 0.5rem;
	}

	.dropdown-error,
	.dropdown-empty {
		padding: 1rem;
		text-align: center;
		color: var(--text-muted, #72767d);
	}

	.dropdown-error {
		color: var(--color-danger);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: center;
	}

	.retry-btn {
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 4px;
		color: var(--text-primary, #fff);
		padding: 0.25rem 0.75rem;
		cursor: pointer;
		font-size: 0.75rem;
	}

	.retry-btn:hover {
		background: var(--bg-tertiary, #40444b);
	}

	.section-header {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-muted, #72767d);
		text-transform: uppercase;
		padding: 0.5rem 0.25rem 0.25rem;
		margin-top: 0.25rem;
	}

	.section-header:first-child {
		margin-top: 0;
	}

	.emoji-grid {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 4px;
	}

	.emoji-option {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		aspect-ratio: 1;
		padding: 4px;
		background: none;
		border: 2px solid transparent;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.1s;
	}

	.emoji-option:hover {
		background: var(--bg-tertiary, #36393f);
	}

	.emoji-option.selected {
		border-color: var(--accent-color, #5865f2);
		background: rgba(88, 101, 242, 0.2);
	}

	.emoji-preview {
		font-size: 1.5rem;
		line-height: 1;
	}

	.emoji-preview-img {
		width: 28px;
		height: 28px;
		object-fit: contain;
	}

	.emoji-option.animated .emoji-preview-img {
		/* Animated emojis play automatically, no additional styling needed */
		border-radius: 4px;
	}

	@media (max-width: 600px) {
		.emoji-grid {
			grid-template-columns: repeat(6, 1fr);
		}
	}
</style>
