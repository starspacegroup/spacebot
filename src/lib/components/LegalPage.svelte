<script>
	/** @type {string} */
	export let title;
	/** @type {{ id: string, label: string }[]} */
	export let toc = [];
	/** @type {{ version: string, date: string, current?: boolean }[]} */
	export let versions = [];
	/** @type {{ version: string, date: string, changes: string[] }[]} */
	export let changelog = [];

	$: currentVersion = versions.find(v => v.current) ?? versions[0];
</script>

<svelte:head>
	<title>{title} – SpaceBot</title>
	<meta name="description" content="SpaceBot {title}" />
	<meta property="og:title" content="{title} – SpaceBot" />
	<meta property="og:description" content="SpaceBot {title}" />
	<meta property="og:image" content="https://spacebot.starspace.group/{title === 'Privacy Policy' ? 'og-privacy' : 'og-terms'}.png" />
	<meta name="twitter:title" content="{title} – SpaceBot" />
	<meta name="twitter:description" content="SpaceBot {title}" />
	<meta name="twitter:image" content="https://spacebot.starspace.group/{title === 'Privacy Policy' ? 'og-privacy' : 'og-terms'}.png" />
</svelte:head>

<div class="legal-page">
	<header class="legal-header">
		<h1>{title}</h1>
		<div class="version-meta">
			{#if currentVersion}
				<span class="version-badge">Version {currentVersion.version}</span>
			{/if}
			{#if currentVersion}
				<p class="last-updated">Effective {currentVersion.date}</p>
			{/if}
		</div>
	</header>

	{#if toc.length > 0}
		<nav class="toc" aria-label="Table of Contents">
			<h2 class="toc-title">Table of Contents</h2>
			<ol class="toc-list">
				{#each toc as item}
					<li>
						<a href="#{item.id}">{item.label}</a>
					</li>
				{/each}
			</ol>
		</nav>
	{/if}

	<div class="legal-content">
		<slot />
	</div>

	{#if changelog.length > 0}
		<section class="changelog" id="changelog">
			<h2>Changelog</h2>
			{#each changelog as entry}
				<div class="changelog-entry">
					<div class="changelog-header">
						<span class="changelog-version">Version {entry.version}</span>
						<span class="changelog-date">{entry.date}</span>
					</div>
					<ul>
						{#each entry.changes as change}
							<li>{change}</li>
						{/each}
					</ul>
				</div>
			{/each}
		</section>
	{/if}
</div>

<style>
	.legal-page {
		max-width: 740px;
		margin: 0 auto;
		padding: 2.5rem 1.25rem 4rem;
	}

	.legal-header {
		margin-bottom: 2rem;
	}

	.legal-header h1 {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	.version-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.version-badge {
		display: inline-block;
		background: var(--color-primary-soft);
		color: var(--color-primary);
		font-size: 0.8rem;
		font-weight: 600;
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-full);
	}

	.last-updated {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin: 0;
	}

	/* Table of Contents */
	.toc {
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
		padding: 1.25rem 1.5rem;
		margin-bottom: 2rem;
	}

	.toc-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.75rem;
	}

	.toc-list {
		margin: 0;
		padding-left: 1.25rem;
		columns: 2;
		column-gap: 2rem;
	}

	.toc-list li {
		margin-bottom: 0.35rem;
		font-size: 0.9rem;
		break-inside: avoid;
	}

	.toc-list a {
		color: var(--color-text-secondary);
		text-decoration: none;
		transition: color var(--transition-fast);
	}

	.toc-list a:hover {
		color: var(--color-primary);
	}

	/* Content sections */
	.legal-content :global(section) {
		margin-bottom: 1.75rem;
	}

	.legal-content :global(h2) {
		font-size: 1.15rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 0.5rem;
		scroll-margin-top: 2rem;
	}

	.legal-content :global(h3) {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
		margin-top: 0.75rem;
		margin-bottom: 0.35rem;
	}

	.legal-content :global(p),
	.legal-content :global(li) {
		color: var(--color-text-secondary);
		line-height: 1.7;
		font-size: 0.95rem;
	}

	.legal-content :global(ul) {
		padding-left: 1.5rem;
		margin-top: 0.5rem;
	}

	.legal-content :global(li) {
		margin-bottom: 0.35rem;
	}

	.legal-content :global(a) {
		color: var(--color-primary);
		text-decoration: none;
	}

	.legal-content :global(a:hover) {
		text-decoration: underline;
	}

	/* Changelog */
	.changelog {
		margin-top: 3rem;
		border-top: 1px solid var(--color-border-light);
		padding-top: 2rem;
	}

	.changelog h2 {
		font-size: 1.15rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 1.25rem;
		scroll-margin-top: 2rem;
	}

	.changelog-entry {
		margin-bottom: 1.5rem;
		padding-left: 1rem;
		border-left: 3px solid var(--color-border-light);
	}

	.changelog-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.changelog-version {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.changelog-date {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.changelog-entry ul {
		padding-left: 1.25rem;
		margin: 0;
	}

	.changelog-entry li {
		color: var(--color-text-secondary);
		font-size: 0.9rem;
		line-height: 1.6;
		margin-bottom: 0.25rem;
	}

	/* Responsive: single column TOC on narrow screens */
	@media (max-width: 600px) {
		.toc-list {
			columns: 1;
		}
	}
</style>
