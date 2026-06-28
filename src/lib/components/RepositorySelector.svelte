<script lang="ts">
	/**
	 * Repository Selector Component
	 * Searchable multi-select for GitHub repositories with an optional Any state.
	 */
	const ANY_REPOSITORY = 'ALL';

	let {
		repositories = [],
		value = $bindable(),
		name = 'repository',
		required = false,
		multiple = true,
		placeholder = 'Search repositories...',
		showAnyOption = true,
	} = $props();

	$effect(() => {
		if (value === undefined) {
			value = '';
		}
	});

	let searchQuery = $state('');
	let isOpen = $state(false);
	let highlightedIndex = $state(-1);

	let inputRef = $state(null);
	let dropdownRef = $state(null);

	const selectedRepositories = $derived.by(() => {
		if (!value) return [];
		if (multiple) {
			return value
				.split(',')
				.map((repo) => repo.trim())
				.filter(Boolean);
		}
		return [value];
	});

	const isAnySelected = $derived(selectedRepositories.includes(ANY_REPOSITORY));

	const filteredRepositories = $derived.by(() => {
		if (!searchQuery.trim()) return repositories;
		const query = searchQuery.toLowerCase();
		return repositories.filter((repo) => repo.toLowerCase().includes(query));
	});

	function isSelected(repo) {
		return selectedRepositories.includes(repo);
	}

	function selectAny() {
		value = ANY_REPOSITORY;
		searchQuery = '';
	}

	function toggleRepository(repo) {
		if (!multiple) {
			value = repo;
			searchQuery = '';
			isOpen = false;
			highlightedIndex = -1;
			return;
		}

		if (isSelected(repo)) {
			const newRepos = selectedRepositories.filter((selectedRepo) => selectedRepo !== repo);
			value = newRepos.length === 0 && showAnyOption ? ANY_REPOSITORY : newRepos.join(',');
		} else {
			const newRepos = selectedRepositories.filter(
				(selectedRepo) => selectedRepo !== ANY_REPOSITORY
			);
			value = [...newRepos, repo].join(',');
		}
	}

	function removeRepository(repo) {
		const newRepos = selectedRepositories.filter((selectedRepo) => selectedRepo !== repo);
		value = newRepos.length === 0 && showAnyOption ? ANY_REPOSITORY : newRepos.join(',');
	}

	function handleInputFocus() {
		isOpen = true;
	}

	function handleInputBlur() {
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
				highlightedIndex = Math.min(highlightedIndex + 1, filteredRepositories.length - 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				highlightedIndex = Math.max(highlightedIndex - 1, -1);
				break;
			case 'Enter':
				e.preventDefault();
				if (highlightedIndex >= 0 && filteredRepositories[highlightedIndex]) {
					toggleRepository(filteredRepositories[highlightedIndex]);
				}
				break;
			case 'Escape':
				isOpen = false;
				highlightedIndex = -1;
				break;
		}
	}

	function handleClickOutside(e) {
		if (dropdownRef && !dropdownRef.contains(e.target) && !inputRef?.contains(e.target)) {
			isOpen = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="repo-selector" class:multi={multiple}>
	<input type="hidden" {name} bind:value {required} />

	<div class="selector-input-wrapper">
		{#if multiple && selectedRepositories.length > 0}
			<div class="selected-tags">
				{#each selectedRepositories as repo}
					<span class="repo-tag">
						{repo === ANY_REPOSITORY ? '* Any' : repo}
						{#if repo !== ANY_REPOSITORY}
							<button
								type="button"
								class="tag-remove"
								onclick={() => removeRepository(repo)}>x</button
							>
						{/if}
					</span>
				{/each}
				<input
					type="text"
					bind:this={inputRef}
					bind:value={searchQuery}
					onfocus={handleInputFocus}
					onblur={handleInputBlur}
					onkeydown={handleKeydown}
					placeholder={selectedRepositories.length > 0 ? '' : placeholder}
					class="search-input inline"
					autocomplete="off"
				/>
			</div>
		{:else}
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
	</div>

	{#if isOpen}
		<div class="dropdown" bind:this={dropdownRef}>
			{#if showAnyOption && multiple && !searchQuery}
				<button
					type="button"
					class="repo-option any-option"
					class:selected={isAnySelected}
					onclick={selectAny}
				>
					<span class="checkbox">{isAnySelected ? '[x]' : '[ ]'}</span>
					<span class="repo-name">Any</span>
				</button>
				<div class="dropdown-divider"></div>
			{/if}

			{#if filteredRepositories.length === 0}
				<div class="dropdown-empty">No repositories found</div>
			{:else}
				{#each filteredRepositories as repo, index}
					<button
						type="button"
						class="repo-option"
						class:selected={isSelected(repo)}
						class:highlighted={highlightedIndex === index}
						onclick={() => toggleRepository(repo)}
						onmouseenter={() => (highlightedIndex = index)}
					>
						{#if multiple}
							<span class="checkbox">{isSelected(repo) ? '[x]' : '[ ]'}</span>
						{/if}
						<span class="repo-name">{repo}</span>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.repo-selector {
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
		border: 1px solid var(--border-color, #5a4a3f);
		border-radius: 0.5rem;
		background: var(--bg-input, rgba(0, 0, 0, 0.12));
		color: var(--text-primary, #f5f5f5);
		font-size: 0.9rem;
	}

	.search-input.inline {
		min-width: 120px;
		flex: 1;
		border: none;
		background: transparent;
		padding: 0.25rem;
	}

	.selected-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--border-color, #5a4a3f);
		border-radius: 0.5rem;
		background: var(--bg-input, rgba(0, 0, 0, 0.12));
		width: 100%;
	}

	.repo-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.15rem 0.45rem;
		border-radius: 0.35rem;
		background: var(--btn-bg, #d8a679);
		color: var(--btn-text, #2c1f16);
		font-size: 0.8rem;
		font-weight: 600;
	}

	.tag-remove {
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0;
		font-size: 0.85rem;
		line-height: 1;
	}

	.dropdown {
		position: absolute;
		top: calc(100% + 0.25rem);
		left: 0;
		right: 0;
		max-height: 260px;
		overflow-y: auto;
		border: 1px solid var(--border-color, #5a4a3f);
		border-radius: 0.5rem;
		background: var(--bg-panel, #3b2a20);
		z-index: 50;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
	}

	.repo-option {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0.75rem;
		border: none;
		background: transparent;
		color: var(--text-primary, #f5f5f5);
		text-align: left;
		cursor: pointer;
	}

	.repo-option:hover,
	.repo-option.highlighted {
		background: rgba(255, 255, 255, 0.08);
	}

	.repo-option.selected {
		background: rgba(216, 166, 121, 0.18);
	}

	.repo-name {
		font-size: 0.88rem;
	}

	.checkbox {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.75rem;
		color: var(--text-muted, #d7c1ae);
	}

	.dropdown-divider {
		height: 1px;
		background: var(--border-color, #5a4a3f);
		margin: 0.25rem 0;
	}

	.dropdown-empty {
		padding: 0.65rem 0.75rem;
		font-size: 0.85rem;
		color: var(--text-muted, #d7c1ae);
	}
</style>
