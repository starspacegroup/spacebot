<script lang="ts">
	import { getTranslator } from '$lib/i18n.js';
	import { serverHue, serverInitials } from '$lib/server-listing-display.js';

	const tr = getTranslator();
	const { data } = $props();
	const listing = $derived(data.listing);

	// The detail page has room for the exact figure, unlike the compact cards.
	function formatCount(value: number | null) {
		if (!value) return null;
		return new Intl.NumberFormat().format(value);
	}

	const hueFor = serverHue;
	const initials = serverInitials;

	const listedOn = $derived(
		listing.listed_at
			? new Date(listing.listed_at).toLocaleDateString(undefined, {
					year: 'numeric',
					month: 'long',
					day: 'numeric',
				})
			: null
	);
</script>

<svelte:head>
	<title>{listing.name} — {tr('browse.title')}</title>
	<meta name="description" content={listing.headline || tr('browse.metaDescription')} />
	<meta property="og:title" content={listing.name} />
	<meta property="og:description" content={listing.headline || tr('browse.metaDescription')} />
	{#if listing.icon_url}
		<meta property="og:image" content={listing.icon_url} />
	{/if}
</svelte:head>

<div class="detail-page">
	<a class="back-link" href="/servers">← {tr('browse.backToBrowser')}</a>

	<article class="detail-card">
		<div class="detail-banner">
			{#if listing.banner_url}
				<img src={listing.banner_url} alt="" />
			{:else}
				<span class="banner-fallback" style="--card-hue: {hueFor(listing.guild_id)}"></span>
			{/if}
		</div>

		<div class="detail-body">
			<header class="detail-header">
				{#if listing.icon_url}
					<img class="detail-icon" src={listing.icon_url} alt="" />
				{:else}
					<span
						class="detail-icon detail-icon-fallback"
						style="--card-hue: {hueFor(listing.guild_id)}"
						>{initials(listing.name)}</span
					>
				{/if}
				<div class="detail-titles">
					<h1>{listing.name}</h1>
					<div class="detail-meta">
						<span class="detail-category">{data.categoryLabel}</span>
						{#if listing.nsfw}
							<span class="badge-nsfw">18+</span>
						{/if}
					</div>
				</div>
				{#if listing.invite_url}
					<a
						class="btn-join"
						href={listing.invite_url}
						target="_blank"
						rel="noopener noreferrer nofollow ugc">{tr('browse.joinServer')}</a
					>
				{/if}
			</header>

			{#if listing.headline}
				<p class="detail-headline">{listing.headline}</p>
			{/if}

			{#if listing.member_count || listing.online_count}
				<dl class="detail-stats">
					{#if listing.member_count}
						<div>
							<dt>{tr('browse.members')}</dt>
							<dd>{formatCount(listing.member_count)}</dd>
						</div>
					{/if}
					{#if listing.online_count}
						<div>
							<dt>{tr('browse.online')}</dt>
							<dd>{formatCount(listing.online_count)}</dd>
						</div>
					{/if}
					{#if listing.boost_tier > 0}
						<div>
							<dt>{tr('browse.boostTier')}</dt>
							<dd>{listing.boost_tier}</dd>
						</div>
					{/if}
				</dl>
			{/if}

			{#if listing.description}
				<section class="detail-section">
					<h2>{tr('browse.aboutHeading')}</h2>
					<p class="detail-description">{listing.description}</p>
				</section>
			{/if}

			{#if listing.tags.length}
				<section class="detail-section">
					<h2>{tr('browse.tagsHeading')}</h2>
					<ul class="detail-tags">
						{#each listing.tags as tag}
							<li>
								<a href="/servers?q={encodeURIComponent(tag)}">{tag}</a>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<footer class="detail-footer">
				{#if listedOn}
					<span>{tr('browse.listedOn', { date: listedOn })}</span>
				{/if}
				<span class="disclaimer">{tr('browse.disclaimer')}</span>
			</footer>
		</div>
	</article>
</div>

<style>
	.detail-page {
		max-width: 780px;
		margin: 0 auto;
		padding: 2rem 1rem 3rem;
	}

	.back-link {
		display: inline-block;
		margin-bottom: 1rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.back-link:hover {
		color: var(--color-primary);
	}

	.detail-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.detail-banner {
		height: 9rem;
		background: var(--color-surface-elevated);
	}

	.detail-banner img,
	.banner-fallback {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.banner-fallback {
		background: linear-gradient(
			135deg,
			hsl(var(--card-hue) 65% 55%) 0%,
			hsl(calc(var(--card-hue) + 45) 65% 45%) 100%
		);
	}

	.detail-body {
		padding: 0 1.5rem 1.5rem;
	}

	.detail-header {
		display: flex;
		align-items: flex-end;
		gap: 1rem;
		margin-top: -2.5rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	.detail-icon {
		width: 5rem;
		height: 5rem;
		border-radius: var(--radius-lg);
		border: 4px solid var(--color-surface);
		background: var(--color-surface-elevated);
		object-fit: cover;
		flex-shrink: 0;
	}

	.detail-icon-fallback {
		display: grid;
		place-items: center;
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-fixed-text-bright);
		background: linear-gradient(
			135deg,
			hsl(var(--card-hue) 60% 50%),
			hsl(calc(var(--card-hue) + 45) 60% 42%)
		);
	}

	.detail-titles {
		flex: 1;
		min-width: 0;
	}

	.detail-titles h1 {
		margin: 0 0 0.25rem;
		font-size: clamp(1.25rem, 3vw, 1.6rem);
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.detail-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.detail-category {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
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
		padding: 0.55rem 1.25rem;
		border-radius: var(--radius-md);
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		font-size: 0.88rem;
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
	}

	.btn-join:hover {
		filter: brightness(1.08);
	}

	.detail-headline {
		margin: 0 0 1.25rem;
		font-size: 1rem;
		line-height: 1.55;
		color: var(--color-text-secondary);
		overflow-wrap: anywhere;
	}

	.detail-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
		margin: 0 0 1.5rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-elevated);
	}

	.detail-stats dt {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
		margin-bottom: 0.15rem;
	}

	.detail-stats dd {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}

	.detail-section {
		margin-bottom: 1.5rem;
	}

	.detail-section h2 {
		margin: 0 0 0.5rem;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.detail-description {
		margin: 0;
		font-size: 0.92rem;
		line-height: 1.65;
		color: var(--color-text-secondary);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.detail-tags {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
	}

	.detail-tags a {
		display: inline-block;
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-full);
		background: var(--color-surface-elevated);
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		text-decoration: none;
	}

	.detail-tags a:hover {
		color: var(--color-primary);
	}

	.detail-footer {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}

	@media (max-width: 560px) {
		.detail-header {
			align-items: flex-start;
		}

		.btn-join {
			width: 100%;
			text-align: center;
		}
	}
</style>
