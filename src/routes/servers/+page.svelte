<script lang="ts">
	import { getTranslator } from '$lib/i18n.js';
	import { formatMemberCount, serverHue, serverInitials } from '$lib/server-listing-display.js';

	const tr = getTranslator();
	const { data } = $props();

	const categoryLabels = $derived(
		Object.fromEntries((data.categories || []).map((c) => [c.value, c.label]))
	);

	/** Build a browser URL that keeps the other filters intact. */
	function browseUrl(overrides: Record<string, string | number | null>) {
		const params = new URLSearchParams();
		const merged: Record<string, any> = {
			q: data.q,
			category: data.category,
			sort: data.sort === 'recent' ? '' : data.sort,
			nsfw: data.includeNsfw ? '1' : '',
			page: data.page > 1 ? data.page : '',
			...overrides,
		};
		for (const [key, value] of Object.entries(merged)) {
			if (value !== null && value !== undefined && value !== '') {
				params.set(key, String(value));
			}
		}
		const query = params.toString();
		return query ? `/servers?${query}` : '/servers';
	}

	const formatCount = formatMemberCount;
	const initials = serverInitials;
	const hueFor = serverHue;
</script>

<svelte:head>
	<title>{tr('browse.metaTitle')}</title>
	<meta name="description" content={tr('browse.metaDescription')} />
	<meta property="og:title" content={tr('browse.metaTitle')} />
	<meta property="og:description" content={tr('browse.metaDescription')} />
	<meta property="og:url" content="https://spacebot.starspace.group/servers" />
</svelte:head>

<div class="browse-page">
	<header class="browse-header">
		<h1>{tr('browse.title')}</h1>
		<p class="browse-sub">{tr('browse.subtitle')}</p>
	</header>

	<form class="filter-bar" method="GET" action="/servers">
		<div class="search-field">
			<svg
				class="search-icon"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				aria-hidden="true"
				><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg
			>
			<input
				type="search"
				name="q"
				value={data.q}
				placeholder={tr('browse.searchPlaceholder')}
				aria-label={tr('browse.searchPlaceholder')}
				maxlength="80"
			/>
		</div>

		<select name="sort" value={data.sort} aria-label={tr('browse.sortLabel')}>
			<option value="recent">{tr('browse.sortRecent')}</option>
			<option value="members">{tr('browse.sortMembers')}</option>
			<option value="name">{tr('browse.sortName')}</option>
		</select>

		{#if data.category}
			<input type="hidden" name="category" value={data.category} />
		{/if}
		{#if data.includeNsfw}
			<input type="hidden" name="nsfw" value="1" />
		{/if}

		<button type="submit" class="btn-search">{tr('browse.searchButton')}</button>
	</form>

	<nav class="category-bar" aria-label={tr('browse.categoriesLabel')}>
		<a href={browseUrl({ category: '', page: '' })} class="chip" class:active={!data.category}>
			{tr('browse.allCategories')}
		</a>
		{#each data.categories || [] as cat}
			{#if data.categoryCounts?.[cat.value]}
				<a
					href={browseUrl({ category: cat.value, page: '' })}
					class="chip"
					class:active={data.category === cat.value}
				>
					{cat.label}
					<span class="chip-count">{data.categoryCounts[cat.value]}</span>
				</a>
			{/if}
		{/each}
	</nav>

	<div class="results-meta">
		<span>
			{data.total === 1
				? tr('browse.resultCountOne')
				: tr('browse.resultCount', { count: data.total })}
		</span>
		<a href={browseUrl({ nsfw: data.includeNsfw ? '' : '1', page: '' })} class="nsfw-toggle">
			{data.includeNsfw ? tr('browse.hideNsfw') : tr('browse.showNsfw')}
		</a>
	</div>

	{#if data.listings.length === 0}
		<div class="empty-state">
			<span class="empty-icon">🛰️</span>
			<h2>{tr('browse.emptyTitle')}</h2>
			<p>{data.q || data.category ? tr('browse.emptyFiltered') : tr('browse.emptyNone')}</p>
			{#if data.q || data.category}
				<a href="/servers" class="btn-primary">{tr('browse.clearFilters')}</a>
			{/if}
		</div>
	{:else}
		<ul class="server-grid">
			{#each data.listings as listing (listing.guild_id)}
				<li class="server-card">
					<a class="card-media" href="/servers/{listing.guild_id}">
						{#if listing.banner_url}
							<img src={listing.banner_url} alt="" loading="lazy" />
						{:else}
							<span
								class="card-media-fallback"
								style="--card-hue: {hueFor(listing.guild_id)}"
							></span>
						{/if}
					</a>

					<div class="card-body">
						<div class="card-identity">
							{#if listing.icon_url}
								<img
									class="card-icon"
									src={listing.icon_url}
									alt=""
									loading="lazy"
								/>
							{:else}
								<span
									class="card-icon card-icon-fallback"
									style="--card-hue: {hueFor(listing.guild_id)}"
									>{initials(listing.name)}</span
								>
							{/if}
							<div class="card-titles">
								<h2><a href="/servers/{listing.guild_id}">{listing.name}</a></h2>
								<span class="card-category"
									>{categoryLabels[listing.category] || listing.category}</span
								>
							</div>
						</div>

						{#if listing.headline}
							<p class="card-headline">{listing.headline}</p>
						{/if}

						{#if listing.tags.length}
							<ul class="card-tags">
								{#each listing.tags.slice(0, 4) as tag}
									<li>{tag}</li>
								{/each}
							</ul>
						{/if}

						<div class="card-footer">
							<div class="card-stats">
								{#if listing.member_count}
									<span class="stat" title={tr('browse.membersTitle')}>
										<span class="dot dot-members"></span>
										{formatCount(listing.member_count)}
										{tr('browse.members')}
									</span>
								{/if}
								{#if listing.online_count}
									<span class="stat" title={tr('browse.onlineTitle')}>
										<span class="dot dot-online"></span>
										{formatCount(listing.online_count)}
										{tr('browse.online')}
									</span>
								{/if}
								{#if listing.nsfw}
									<span class="badge-nsfw">18+</span>
								{/if}
							</div>
							{#if listing.invite_url}
								<a
									class="btn-join"
									href={listing.invite_url}
									target="_blank"
									rel="noopener noreferrer nofollow ugc">{tr('browse.join')}</a
								>
							{/if}
						</div>
					</div>
				</li>
			{/each}
		</ul>

		{#if data.totalPages > 1}
			<nav class="pagination" aria-label={tr('browse.paginationLabel')}>
				{#if data.page > 1}
					<a href={browseUrl({ page: data.page - 1 })} class="page-link"
						>← {tr('browse.previous')}</a
					>
				{/if}
				<span class="page-status"
					>{tr('browse.pageStatus', { page: data.page, total: data.totalPages })}</span
				>
				{#if data.page < data.totalPages}
					<a href={browseUrl({ page: data.page + 1 })} class="page-link"
						>{tr('browse.next')} →</a
					>
				{/if}
			</nav>
		{/if}
	{/if}

	<footer class="browse-cta">
		<h2>{tr('browse.ctaTitle')}</h2>
		<p>{tr('browse.ctaDesc')}</p>
		<a href="/admin" class="btn-primary">{tr('browse.ctaButton')}</a>
	</footer>
</div>

<style>
	.browse-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem 1rem 3rem;
	}

	.browse-header {
		text-align: center;
		margin-bottom: 1.75rem;
	}

	.browse-header h1 {
		margin: 0 0 0.4rem;
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		color: var(--color-text);
	}

	.browse-sub {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.95rem;
	}

	/* Filters */
	.filter-bar {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.search-field {
		position: relative;
		flex: 1 1 18rem;
		min-width: 0;
	}

	.search-icon {
		position: absolute;
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.search-field input {
		width: 100%;
		padding: 0.6rem 0.85rem 0.6rem 2.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
	}

	.filter-bar select {
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
	}

	.search-field input:focus,
	.filter-bar select:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.btn-search {
		padding: 0.6rem 1.1rem;
		border: none;
		border-radius: var(--radius-md);
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
	}

	.btn-search:hover {
		filter: brightness(1.08);
	}

	.category-bar {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.75rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 0.8rem;
		text-decoration: none;
		transition:
			border-color var(--transition-fast),
			color var(--transition-fast);
	}

	.chip:hover {
		border-color: var(--color-primary);
		color: var(--color-text);
	}

	.chip.active {
		background: var(--color-primary-button);
		border-color: var(--color-primary-button);
		color: var(--color-primary-button-text);
	}

	.chip-count {
		font-size: 0.7rem;
		opacity: 0.75;
		font-variant-numeric: tabular-nums;
	}

	.results-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.25rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.nsfw-toggle {
		color: var(--color-text-muted);
		text-decoration: none;
		border-bottom: 1px dotted var(--color-border);
	}

	.nsfw-toggle:hover {
		color: var(--color-text);
	}

	/* Cards */
	.server-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 17.5rem), 1fr));
	}

	.server-card {
		display: flex;
		flex-direction: column;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast),
			transform var(--transition-fast);
	}

	.server-card:hover {
		border-color: var(--color-primary);
		box-shadow: var(--shadow-md);
		transform: translateY(-2px);
	}

	.card-media {
		display: block;
		height: 5.5rem;
		background: var(--color-surface-elevated);
	}

	.card-media img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.card-media-fallback {
		display: block;
		width: 100%;
		height: 100%;
		background: linear-gradient(
			135deg,
			hsl(var(--card-hue) 65% 55%) 0%,
			hsl(calc(var(--card-hue) + 45) 65% 45%) 100%
		);
	}

	.card-body {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: 0.9rem 1rem 1rem;
		flex: 1;
	}

	.card-identity {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		margin-top: -2.25rem;
	}

	.card-icon {
		width: 3rem;
		height: 3rem;
		border-radius: var(--radius-md);
		border: 3px solid var(--color-surface);
		background: var(--color-surface-elevated);
		flex-shrink: 0;
		object-fit: cover;
	}

	.card-icon-fallback {
		display: grid;
		place-items: center;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-fixed-text-bright);
		background: linear-gradient(
			135deg,
			hsl(var(--card-hue) 60% 50%),
			hsl(calc(var(--card-hue) + 45) 60% 42%)
		);
	}

	.card-titles {
		min-width: 0;
		padding-top: 1.75rem;
	}

	.card-titles h2 {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.3;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card-titles h2 a {
		color: var(--color-text);
		text-decoration: none;
	}

	.card-titles h2 a:hover {
		color: var(--color-primary);
	}

	.card-category {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.card-headline {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.45;
		color: var(--color-text-secondary);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.card-tags {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
	}

	.card-tags li {
		font-size: 0.68rem;
		padding: 0.15rem 0.45rem;
		border-radius: var(--radius-full);
		background: var(--color-surface-elevated);
		color: var(--color-text-muted);
	}

	.card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: auto;
		padding-top: 0.6rem;
		border-top: 1px solid var(--color-border);
	}

	.card-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}

	.stat {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
	}

	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.dot-members {
		background: var(--color-text-muted);
	}

	.dot-online {
		background: var(--color-success);
	}

	.badge-nsfw {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.1rem 0.35rem;
		border-radius: var(--radius-sm);
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}

	.btn-join {
		padding: 0.4rem 0.85rem;
		border-radius: var(--radius-md);
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		font-size: 0.78rem;
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
	}

	.btn-join:hover {
		filter: brightness(1.08);
	}

	/* Empty + pagination + CTA */
	.empty-state {
		text-align: center;
		padding: 3.5rem 1rem;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
		color: var(--color-text-muted);
	}

	.empty-icon {
		font-size: 2.25rem;
		display: block;
		margin-bottom: 0.6rem;
	}

	.empty-state h2 {
		margin: 0 0 0.35rem;
		font-size: 1.1rem;
		color: var(--color-text);
	}

	.empty-state p {
		margin: 0 0 1.1rem;
		font-size: 0.88rem;
	}

	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		margin-top: 1.75rem;
		font-size: 0.85rem;
	}

	.page-link {
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		text-decoration: none;
	}

	.page-link:hover {
		border-color: var(--color-primary);
		color: var(--color-text);
	}

	.page-status {
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.browse-cta {
		margin-top: 3rem;
		padding: 2rem 1.5rem;
		text-align: center;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}

	.browse-cta h2 {
		margin: 0 0 0.4rem;
		font-size: 1.15rem;
		color: var(--color-text);
	}

	.browse-cta p {
		margin: 0 0 1.1rem;
		font-size: 0.88rem;
		color: var(--color-text-muted);
	}

	.btn-primary {
		display: inline-block;
		padding: 0.6rem 1.25rem;
		border-radius: var(--radius-md);
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		font-size: 0.9rem;
		font-weight: 500;
		text-decoration: none;
	}

	.btn-primary:hover {
		filter: brightness(1.08);
	}

	@media (max-width: 640px) {
		.filter-bar {
			flex-direction: column;
		}

		.filter-bar select,
		.btn-search {
			width: 100%;
		}
	}
</style>
