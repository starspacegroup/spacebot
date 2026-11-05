<script lang="ts">
	import { getTranslator } from '$lib/i18n.js';
	import { formatMemberCount, serverHue, serverInitials } from '$lib/server-listing-display.js';

	const tr = getTranslator();
	const { data } = $props();

	const categoryLabels = $derived(
		Object.fromEntries((data.categories || []).map((c) => [c.value, c.label]))
	);

	const sorts = $derived([
		{ value: 'recent', label: tr('browse.sortRecent') },
		{ value: 'members', label: tr('browse.sortMembers') },
		{ value: 'name', label: tr('browse.sortName') },
	]);

	const filtered = $derived(Boolean(data.q || data.category));

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

{#snippet invite()}
	<footer class="browse-cta">
		<div>
			<h2>{tr('browse.ctaTitle')}</h2>
			<p>{tr('browse.ctaDesc')}</p>
		</div>
		<a href="/admin" class="btn-primary">{tr('browse.ctaButton')}</a>
	</footer>
{/snippet}

<svelte:head>
	<title>{tr('browse.metaTitle')}</title>
	<meta name="description" content={tr('browse.metaDescription')} />
	<meta property="og:title" content={tr('browse.metaTitle')} />
	<meta property="og:description" content={tr('browse.metaDescription')} />
	<meta property="og:url" content="https://spacebot.starspace.group/servers" />
</svelte:head>

<div class="browse-page">
	<header class="hero">
		<div class="hero-inner">
			<div class="hero-text">
				<div class="hero-title">
					<span class="discord-badge" aria-hidden="true">
						<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"
							><path
								d="M20.317 4.37a19.8 19.8 0 0 0-4.885-1.515.07.07 0 0 0-.079.036c-.21.375-.444.864-.608 1.25a18.3 18.3 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.08.08 0 0 0-.079-.036A19.7 19.7 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.08.08 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.075.075 0 0 1 .078-.01c3.927 1.793 8.18 1.793 12.061 0a.075.075 0 0 1 .079.01c.12.1.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.8 19.8 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
							/></svg
						>
					</span>
					<h1>{tr('browse.title')}</h1>
				</div>
				<p class="hero-sub">{tr('browse.subtitle')}</p>
			</div>

			<form class="search-form" method="GET" action="/servers" role="search">
				<div class="search-field">
					<svg
						class="search-icon"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						aria-hidden="true"
						><circle cx="11" cy="11" r="8" /><line
							x1="21"
							y1="21"
							x2="16.65"
							y2="16.65"
						/></svg
					>
					<input
						type="search"
						name="q"
						value={data.q}
						placeholder={tr('browse.searchPlaceholder')}
						aria-label={tr('browse.searchPlaceholder')}
						maxlength="80"
					/>
					<button type="submit" class="btn-search">{tr('browse.searchButton')}</button>
				</div>
				{#if data.category}
					<input type="hidden" name="category" value={data.category} />
				{/if}
				{#if data.sort !== 'recent'}
					<input type="hidden" name="sort" value={data.sort} />
				{/if}
				{#if data.includeNsfw}
					<input type="hidden" name="nsfw" value="1" />
				{/if}
			</form>
		</div>
	</header>

	<div class="browse-layout">
		<aside class="sidebar">
			<nav class="category-nav" aria-label={tr('browse.categoriesLabel')}>
				<h2 class="side-title">{tr('browse.categoriesLabel')}</h2>
				<ul class="category-list">
					<li>
						<a
							href={browseUrl({ category: '', page: '' })}
							class="category-link"
							class:active={!data.category}
							aria-current={!data.category ? 'page' : undefined}
						>
							<span>{tr('browse.allCategories')}</span>
						</a>
					</li>
					{#each data.categories || [] as cat}
						{#if data.categoryCounts?.[cat.value]}
							<li>
								<a
									href={browseUrl({ category: cat.value, page: '' })}
									class="category-link"
									class:active={data.category === cat.value}
									aria-current={data.category === cat.value ? 'page' : undefined}
								>
									<span>{cat.label}</span>
									<span class="category-count"
										>{data.categoryCounts[cat.value]}</span
									>
								</a>
							</li>
						{/if}
					{/each}
				</ul>
			</nav>

			<a
				href={browseUrl({ nsfw: data.includeNsfw ? '' : '1', page: '' })}
				class="nsfw-switch"
				class:on={data.includeNsfw}
				role="switch"
				aria-checked={data.includeNsfw}
			>
				<span class="switch-track"><span class="switch-thumb"></span></span>
				<span>{data.includeNsfw ? tr('browse.hideNsfw') : tr('browse.showNsfw')}</span>
			</a>
		</aside>

		<section class="results" aria-live="polite">
			<div class="results-bar">
				<p class="results-count">
					{data.total === 1
						? tr('browse.resultCountOne')
						: tr('browse.resultCount', { count: data.total })}
					{#if filtered}
						<a href="/servers" class="clear-link">{tr('browse.clearFilters')}</a>
					{/if}
				</p>
				<div class="sort-group" role="group" aria-label={tr('browse.sortLabel')}>
					{#each sorts as option (option.value)}
						<a
							href={browseUrl({
								sort: option.value === 'recent' ? '' : option.value,
								page: '',
							})}
							class="sort-link"
							class:active={data.sort === option.value}
							aria-current={data.sort === option.value ? 'true' : undefined}
							>{option.label}</a
						>
					{/each}
				</div>
			</div>

			{#if data.listings.length === 0}
				<div class="empty-state">
					<span class="empty-icon">🛰️</span>
					<h2>{tr('browse.emptyTitle')}</h2>
					<p>{filtered ? tr('browse.emptyFiltered') : tr('browse.emptyNone')}</p>
					{#if filtered}
						<a href="/servers" class="btn-primary">{tr('browse.clearFilters')}</a>
					{/if}
				</div>
			{:else}
				<ul class="server-grid">
					{#each data.listings as listing (listing.guild_id)}
						<li class="server-card" style="--card-hue: {hueFor(listing.guild_id)}">
							<div class="card-media">
								{#if listing.banner_url}
									<img src={listing.banner_url} alt="" loading="lazy" />
								{/if}
								{#await data.manageable then yours}
									{#if yours.some((guild) => guild.id === listing.guild_id)}
										<a
											class="card-edit"
											href="/admin/{listing.guild_id}/listing"
											title={tr('browse.manageThisListing')}
											>✎ {tr('browse.editListing')}</a
										>
									{/if}
								{:catch}
									<!-- Discord did not answer: no edit link, the card still works. -->
								{/await}
							</div>

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
										<span class="card-icon card-icon-fallback"
											>{initials(listing.name)}</span
										>
									{/if}
									<div class="card-titles">
										<h3>
											<a class="card-link" href="/servers/{listing.guild_id}"
												>{listing.name}</a
											>
										</h3>
										<span class="card-category">
											{categoryLabels[listing.category] || listing.category}
											{#if listing.nsfw}
												<span class="badge-nsfw">18+</span>
											{/if}
										</span>
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
									</div>
									{#if listing.invite_url}
										<a
											class="btn-join"
											href="/servers/{listing.guild_id}/join"
											target="_blank"
											rel="noopener noreferrer nofollow ugc"
											>{tr('browse.join')}</a
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
						{:else}
							<span class="page-link disabled">← {tr('browse.previous')}</span>
						{/if}
						<span class="page-status"
							>{tr('browse.pageStatus', {
								page: data.page,
								total: data.totalPages,
							})}</span
						>
						{#if data.page < data.totalPages}
							<a href={browseUrl({ page: data.page + 1 })} class="page-link"
								>{tr('browse.next')} →</a
							>
						{:else}
							<span class="page-link disabled">{tr('browse.next')} →</span>
						{/if}
					</nav>
				{/if}
			{/if}
		</section>
	</div>

	<div class="below">
		{#await data.manageable then yours}
			{#if yours.length > 0}
				<section class="your-servers" aria-labelledby="your-servers-title">
					<header class="your-head">
						<div>
							<h2 id="your-servers-title">{tr('browse.yoursTitle')}</h2>
							<p>{tr('browse.yoursDesc')}</p>
						</div>
						<a href="/admin" class="your-dashboard">{tr('browse.ctaButton')} →</a>
					</header>
					<ul class="your-list">
						{#each yours as guild (guild.id)}
							<li class="your-row">
								{#if guild.icon}
									<img
										class="your-icon"
										src="https://cdn.discordapp.com/icons/{guild.id}/{guild.icon}.png?size=64"
										alt=""
										loading="lazy"
									/>
								{:else}
									<span
										class="your-icon your-icon-fallback"
										style="--card-hue: {hueFor(guild.id)}"
										>{initials(guild.name)}</span
									>
								{/if}
								<div class="your-text">
									<span class="your-name">{guild.name}</span>
									{#if guild.listed}
										<span class="your-status live"
											><span class="dot dot-online"></span>{tr(
												'browse.statusListed'
											)}</span
										>
									{:else}
										<span class="your-status"
											><span class="dot dot-members"></span>{tr(
												'browse.statusUnlisted'
											)}</span
										>
									{/if}
								</div>
								<div class="your-actions">
									{#if guild.listed}
										<a class="btn-quiet" href="/servers/{guild.id}"
											>{tr('browse.view')}</a
										>
									{/if}
									<a
										class={guild.listed
											? 'btn-quiet strong'
											: 'btn-primary btn-small'}
										href="/admin/{guild.id}/listing"
										>{guild.listed
											? tr('browse.manageListing')
											: tr('browse.listThisServer')}</a
									>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{:else}
				{@render invite()}
			{/if}
		{:catch}
			{@render invite()}
		{/await}
	</div>
</div>

<style>
	.your-servers {
		margin-top: 3rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		overflow: hidden;
	}

	.your-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		padding: 1.25rem 1.5rem 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.your-head h2 {
		margin: 0 0 0.25rem;
		font-size: 1.1rem;
		color: var(--color-text);
	}

	.your-head p {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.browse-page a.your-dashboard {
		font-size: 0.85rem;
		color: var(--color-primary);
		text-decoration: none;
		white-space: nowrap;
	}

	.browse-page a.your-dashboard:hover {
		text-decoration: underline;
	}

	.your-list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 24rem;
		overflow-y: auto;
	}

	.your-row {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.7rem 1.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.your-row:last-child {
		border-bottom: none;
	}

	.your-row:hover {
		background: var(--color-surface-hover);
	}

	.your-icon {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.your-icon-fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: hsl(var(--card-hue) 45% 40%);
		color: var(--color-primary-button-text);
		font-size: 0.8rem;
		font-weight: 600;
	}

	.your-text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		flex: 1;
	}

	.your-name {
		font-weight: 600;
		font-size: 0.92rem;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.your-status {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.your-status.live {
		color: var(--color-text);
	}

	.your-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-shrink: 0;
	}

	.browse-page a.btn-quiet {
		padding: 0.4rem 0.9rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
		font-size: 0.82rem;
		text-decoration: none;
		white-space: nowrap;
	}

	.browse-page a.btn-quiet:hover {
		border-color: var(--color-primary);
	}

	.browse-page a.btn-quiet.strong {
		background: var(--color-surface-hover);
	}

	.btn-small {
		padding: 0.4rem 0.9rem;
		font-size: 0.82rem;
		white-space: nowrap;
	}

	@media (max-width: 560px) {
		.your-head {
			flex-direction: column;
		}

		.your-row {
			flex-wrap: wrap;
			padding: 0.75rem 1rem;
		}

		.your-actions {
			width: 100%;
			justify-content: flex-end;
		}
	}

	.browse-page a.btn-primary {
		display: inline-block;
		padding: 0.6rem 1.25rem;
		border-radius: var(--radius-md);
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		font-size: 0.9rem;
		font-weight: 500;
		text-decoration: none;
	}

	.browse-page a.btn-primary:hover {
		filter: brightness(1.08);
	}

	.browse-page {
		--gutter: clamp(1rem, 3vw, 2.5rem);
		width: 100%;
		max-width: 2200px;
		margin: 0 auto;
		padding: 0 var(--gutter) 3.5rem;
	}

	/* Hero */
	.hero {
		margin: 0 calc(var(--gutter) * -1) 1.75rem;
		padding: clamp(1.75rem, 4vw, 3rem) var(--gutter);
		background:
			radial-gradient(60rem 18rem at 85% -20%, var(--color-primary-soft), transparent 70%),
			var(--color-background-alt);
		border-bottom: 1px solid var(--color-border);
	}

	.hero-inner {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1.5rem 3rem;
		flex-wrap: wrap;
	}

	.hero-text {
		min-width: 0;
	}

	.hero-title {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		margin-bottom: 0.5rem;
	}

	.discord-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: clamp(2.6rem, 5vw, 3.4rem);
		height: clamp(2.6rem, 5vw, 3.4rem);
		border-radius: var(--radius-lg);
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		box-shadow: var(--shadow-md);
	}

	.hero h1 {
		margin: 0;
		font-size: clamp(1.9rem, 4.2vw, 3rem);
		line-height: 1.1;
		letter-spacing: -0.02em;
		color: var(--color-text);
	}

	.hero-sub {
		margin: 0;
		max-width: 38rem;
		font-size: clamp(0.95rem, 1.4vw, 1.1rem);
		color: var(--color-text-muted);
	}

	.search-form {
		flex: 1 1 24rem;
		min-width: 0;
		max-width: 40rem;
	}

	.search-field {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.35rem 0.35rem 2.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.search-field:focus-within {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 3px var(--color-primary-soft);
	}

	.search-icon {
		position: absolute;
		left: 1.1rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.search-field input {
		flex: 1;
		min-width: 0;
		padding: 0.55rem 0;
		border: none;
		background: transparent;
		color: var(--color-text);
		font-size: 1rem;
	}

	.search-field input:focus {
		outline: none;
	}

	.btn-search {
		padding: 0.6rem 1.35rem;
		border: none;
		border-radius: var(--radius-full);
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-search:hover {
		filter: brightness(1.08);
	}

	/* Layout */
	.browse-layout {
		display: grid;
		grid-template-columns: 15.5rem minmax(0, 1fr);
		gap: 2rem;
		align-items: start;
	}

	.sidebar {
		position: sticky;
		top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.side-title {
		margin: 0 0 0.5rem;
		padding: 0 0.75rem;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.category-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.browse-page a.category-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-size: 0.9rem;
		text-decoration: none;
		transition:
			background var(--transition-fast),
			color var(--transition-fast);
	}

	.browse-page a.category-link:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.browse-page a.category-link.active {
		background: var(--color-primary-soft);
		color: var(--color-primary);
		font-weight: 600;
	}

	.category-count {
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.browse-page a.category-link.active .category-count {
		color: inherit;
	}

	.browse-page a.nsfw-switch {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 0.82rem;
		text-decoration: none;
	}

	.browse-page a.nsfw-switch:hover {
		border-color: var(--color-primary);
		color: var(--color-text);
	}

	.switch-track {
		position: relative;
		flex-shrink: 0;
		width: 2rem;
		height: 1.1rem;
		border-radius: var(--radius-full);
		background: var(--color-border);
		transition: background var(--transition-fast);
	}

	.switch-thumb {
		position: absolute;
		top: 0.15rem;
		left: 0.15rem;
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 50%;
		background: var(--color-surface);
		transition: transform var(--transition-fast);
	}

	.browse-page a.nsfw-switch.on .switch-track {
		background: var(--color-primary-button);
	}

	.browse-page a.nsfw-switch.on .switch-thumb {
		transform: translateX(0.9rem);
	}

	/* Results */
	.results {
		min-width: 0;
	}

	.results-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1.5rem;
		flex-wrap: wrap;
		margin-bottom: 1.1rem;
	}

	.results-count {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	.browse-page a.clear-link {
		font-size: 0.82rem;
		color: var(--color-primary);
		text-decoration: none;
	}

	.browse-page a.clear-link:hover {
		text-decoration: underline;
	}

	.sort-group {
		display: inline-flex;
		padding: 0.2rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		background: var(--color-surface);
		max-width: 100%;
		overflow-x: auto;
	}

	.browse-page a.sort-link {
		padding: 0.35rem 0.9rem;
		border-radius: var(--radius-full);
		font-size: 0.8rem;
		white-space: nowrap;
		color: var(--color-text-secondary);
		text-decoration: none;
	}

	.browse-page a.sort-link:hover {
		color: var(--color-text);
	}

	.browse-page a.sort-link.active {
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		font-weight: 600;
	}

	/* Cards */
	.server-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
		gap: 1.25rem;
	}

	.server-card {
		position: relative;
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

	.server-card:hover,
	.server-card:focus-within {
		border-color: var(--color-primary);
		box-shadow: var(--shadow-md);
		transform: translateY(-2px);
	}

	.card-media {
		position: relative;
		height: 6.5rem;
		background:
			radial-gradient(circle at 20% 0%, hsl(var(--card-hue) 70% 62% / 0.9), transparent 60%),
			linear-gradient(
				135deg,
				hsl(var(--card-hue) 60% 50%),
				hsl(calc(var(--card-hue) + 45) 60% 40%)
			);
	}

	.card-media img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.browse-page a.card-edit {
		position: absolute;
		top: 0.6rem;
		right: 0.6rem;
		z-index: 2;
		padding: 0.25rem 0.65rem;
		border-radius: var(--radius-full);
		font-size: 0.75rem;
		font-weight: 600;
		text-decoration: none;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		box-shadow: var(--shadow-sm);
	}

	.browse-page a.card-edit:hover,
	.browse-page a.card-edit:focus-visible {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.card-body {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		gap: 0.7rem;
		padding: 0 1.1rem 1.1rem;
	}

	.card-identity {
		display: flex;
		align-items: flex-start;
		gap: 0.8rem;
		margin-top: -1.75rem;
	}

	.card-icon {
		width: 3.5rem;
		height: 3.5rem;
		flex-shrink: 0;
		border-radius: var(--radius-lg);
		border: 3px solid var(--color-surface);
		background: var(--color-surface-elevated);
		object-fit: cover;
	}

	.card-icon-fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(
			135deg,
			hsl(var(--card-hue) 55% 48%),
			hsl(calc(var(--card-hue) + 45) 55% 38%)
		);
		color: var(--color-primary-button-text);
		font-size: 1.1rem;
		font-weight: 700;
	}

	.card-titles {
		min-width: 0;
		padding-top: 2rem;
	}

	.card-titles h3 {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.25;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The whole card is the target for this link. */
	.browse-page a.card-link {
		color: var(--color-text);
		text-decoration: none;
	}

	.browse-page a.card-link::after {
		content: '';
		position: absolute;
		inset: -6.5rem 0 0 0;
		z-index: 1;
	}

	.browse-page a.card-link:focus-visible {
		outline: none;
	}

	.server-card:has(.card-link:focus-visible) {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.browse-page .server-card:hover a.card-link {
		color: var(--color-primary);
	}

	.card-category {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.card-headline {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.card-tags {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.card-tags li {
		padding: 0.15rem 0.55rem;
		border-radius: var(--radius-full);
		background: var(--color-surface-elevated);
		color: var(--color-text-muted);
		font-size: 0.72rem;
	}

	.card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: auto;
		padding-top: 0.8rem;
		border-top: 1px solid var(--color-border);
	}

	.card-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.85rem;
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.stat {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		white-space: nowrap;
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
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
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		padding: 0.08rem 0.35rem;
		border-radius: var(--radius-sm);
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}

	.browse-page a.btn-join {
		position: relative;
		z-index: 2;
		padding: 0.45rem 1rem;
		border-radius: var(--radius-full);
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		font-size: 0.8rem;
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}

	.browse-page a.btn-join:hover {
		filter: brightness(1.1);
	}

	/* Empty + pagination + CTA */
	.empty-state {
		text-align: center;
		padding: 4rem 1rem;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
		color: var(--color-text-muted);
	}

	.empty-icon {
		font-size: 2.5rem;
		display: block;
		margin-bottom: 0.6rem;
	}

	.empty-state h2 {
		margin: 0 0 0.35rem;
		font-size: 1.15rem;
		color: var(--color-text);
	}

	.empty-state p {
		margin: 0 0 1.1rem;
		font-size: 0.9rem;
	}

	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		margin-top: 2rem;
		font-size: 0.85rem;
	}

	.browse-page a.page-link {
		padding: 0.5rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		text-decoration: none;
	}

	.browse-page a.page-link:hover {
		border-color: var(--color-primary);
		color: var(--color-text);
	}

	.browse-page .page-link.disabled {
		opacity: 0.4;
		pointer-events: none;
	}

	.page-status {
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.below {
		margin-top: 3rem;
	}

	.browse-cta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem 2rem;
		flex-wrap: wrap;
		padding: 1.75rem clamp(1.25rem, 3vw, 2.25rem);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background:
			radial-gradient(30rem 10rem at 100% 0%, var(--color-primary-soft), transparent 70%),
			var(--color-surface);
	}

	.browse-cta h2 {
		margin: 0 0 0.3rem;
		font-size: 1.2rem;
		color: var(--color-text);
	}

	.browse-cta p {
		margin: 0;
		max-width: 38rem;
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	.your-servers {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		overflow: hidden;
	}

	.your-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 26rem), 1fr));
		max-height: 24rem;
		overflow-y: auto;
	}

	.your-row {
		border-right: 1px solid var(--color-border);
	}

	/* Tablet and down: the sidebar becomes a scrolling chip row. */
	@media (max-width: 1000px) {
		.browse-layout {
			grid-template-columns: minmax(0, 1fr);
			gap: 1.25rem;
		}

		.sidebar {
			position: static;
			flex-direction: row;
			align-items: center;
			gap: 0.75rem;
			min-width: 0;
		}

		.category-nav {
			flex: 1;
			min-width: 0;
		}

		.side-title {
			display: none;
		}

		.category-list {
			flex-direction: row;
			gap: 0.4rem;
			overflow-x: auto;
			padding-bottom: 0.25rem;
			scrollbar-width: thin;
		}

		.category-link {
			white-space: nowrap;
			border: 1px solid var(--color-border);
			border-radius: var(--radius-full);
			background: var(--color-surface);
			padding: 0.35rem 0.8rem;
			font-size: 0.82rem;
			gap: 0.45rem;
		}

		.category-link.active {
			border-color: var(--color-primary);
		}

		.nsfw-switch {
			flex-shrink: 0;
		}
	}

	@media (max-width: 640px) {
		.hero-inner {
			align-items: stretch;
		}

		.search-form {
			flex: 1 1 100%;
			max-width: none;
		}

		.sidebar {
			flex-direction: column;
			align-items: stretch;
		}

		.results-bar {
			flex-direction: column;
			align-items: stretch;
		}

		.sort-group {
			align-self: flex-start;
		}

		.your-row {
			border-right: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.server-card,
		.switch-thumb {
			transition: none;
		}

		.server-card:hover,
		.server-card:focus-within {
			transform: none;
		}
	}
</style>
