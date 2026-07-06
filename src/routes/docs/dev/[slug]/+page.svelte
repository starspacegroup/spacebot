<script lang="ts">
	let { data } = $props();
	const doc = $derived(data.doc);
</script>

<svelte:head>
	<title>{doc.title} – SpaceBot Docs</title>
	<meta name="description" content={doc.description} />
	<meta property="og:title" content="{doc.title} – SpaceBot Docs" />
	<meta property="og:description" content={doc.description} />
	<meta property="og:url" content="https://spacebot.starspace.group/docs/dev/{doc.slug}" />
</svelte:head>

<div class="doc-layout">
	<aside class="doc-nav" aria-label="Documentation">
		<a class="nav-home" href="/docs/dev">← All docs</a>
		{#each data.sections as section (section.title)}
			<div class="nav-group">
				<span class="nav-group-title">{section.title}</span>
				<ul>
					{#each section.docs as entry (entry.slug)}
						<li>
							<a
								class="nav-link"
								class:active={entry.slug === doc.slug}
								href="/docs/dev/{entry.slug}"
							>
								{entry.title}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</aside>

	<main class="doc-main">
		<article class="doc-article">
			<h1>{doc.title}</h1>
			<!-- Trusted content: compiled from our own repo docs at build time. -->
			{@html doc.html}
		</article>
	</main>

	{#if doc.headings.length > 1}
		<nav class="doc-toc" aria-label="On this page">
			<span class="toc-title">On this page</span>
			<ul>
				{#each doc.headings as heading (heading.id)}
					<li class:sub={heading.level >= 3}>
						<a href="#{heading.id}">{heading.text}</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}
</div>

<style>
	.doc-layout {
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr) 200px;
		gap: 2.5rem;
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
		align-items: start;
	}

	/* Left nav */
	.doc-nav {
		position: sticky;
		top: 1.5rem;
		font-size: 0.9rem;
	}

	.nav-home {
		display: block;
		color: var(--color-text-muted);
		text-decoration: none;
		margin-bottom: 1.25rem;
		font-weight: 500;
	}

	.nav-home:hover {
		color: var(--color-primary);
	}

	.nav-group {
		margin-bottom: 1.25rem;
	}

	.nav-group-title {
		display: block;
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 0.4rem;
	}

	.doc-nav ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.nav-link {
		display: block;
		padding: 0.25rem 0.6rem;
		margin-left: -0.6rem;
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		text-decoration: none;
		border-left: 2px solid transparent;
	}

	.nav-link:hover {
		color: var(--color-text);
	}

	.nav-link.active {
		color: var(--color-primary);
		border-left-color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 8%, transparent);
	}

	/* Article */
	.doc-article h1 {
		font-size: 2rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 1.5rem;
		line-height: 1.2;
	}

	.doc-article :global(h2) {
		font-size: 1.4rem;
		font-weight: 700;
		color: var(--color-text);
		margin: 2.25rem 0 0.75rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--color-border);
		scroll-margin-top: 1.5rem;
	}

	.doc-article :global(h3) {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 1.75rem 0 0.5rem;
		scroll-margin-top: 1.5rem;
	}

	.doc-article :global(p),
	.doc-article :global(li) {
		color: var(--color-text-secondary);
		line-height: 1.75;
	}

	.doc-article :global(p) {
		margin-bottom: 1rem;
	}

	.doc-article :global(ul),
	.doc-article :global(ol) {
		margin: 0 0 1rem;
		padding-left: 1.5rem;
	}

	.doc-article :global(li) {
		margin-bottom: 0.4rem;
	}

	.doc-article :global(a) {
		color: var(--color-primary);
		text-decoration: none;
	}

	.doc-article :global(a:hover) {
		text-decoration: underline;
	}

	.doc-article :global(strong) {
		color: var(--color-text);
		font-weight: 600;
	}

	.doc-article :global(code) {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.86em;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 0.1rem 0.35rem;
	}

	.doc-article :global(pre) {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem 1.25rem;
		overflow-x: auto;
		margin: 0 0 1.25rem;
		line-height: 1.6;
	}

	.doc-article :global(pre code) {
		background: none;
		border: none;
		padding: 0;
		font-size: 0.85rem;
		color: var(--color-text);
	}

	.doc-article :global(blockquote) {
		border-left: 3px solid var(--color-primary);
		margin: 0 0 1.25rem;
		padding: 0.25rem 0 0.25rem 1.1rem;
		color: var(--color-text-muted);
	}

	.doc-article :global(blockquote p) {
		margin-bottom: 0.5rem;
	}

	.doc-article :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 0 0 1.25rem;
		font-size: 0.9rem;
	}

	.doc-article :global(th),
	.doc-article :global(td) {
		border: 1px solid var(--color-border);
		padding: 0.5rem 0.75rem;
		text-align: left;
		vertical-align: top;
	}

	.doc-article :global(th) {
		background: var(--color-surface);
		color: var(--color-text);
		font-weight: 600;
	}

	.doc-article :global(td) {
		color: var(--color-text-secondary);
	}

	.doc-article :global(hr) {
		border: none;
		border-top: 1px solid var(--color-border);
		margin: 2rem 0;
	}

	.doc-article :global(img) {
		max-width: 100%;
		border-radius: var(--radius-md);
	}

	/* Right TOC */
	.doc-toc {
		position: sticky;
		top: 1.5rem;
		font-size: 0.85rem;
	}

	.toc-title {
		display: block;
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 0.6rem;
	}

	.doc-toc ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border-left: 1px solid var(--color-border);
	}

	.doc-toc li {
		padding: 0.2rem 0;
	}

	.doc-toc li.sub {
		padding-left: 0.75rem;
	}

	.doc-toc a {
		color: var(--color-text-muted);
		text-decoration: none;
		display: block;
		padding-left: 0.75rem;
		margin-left: -1px;
		border-left: 2px solid transparent;
	}

	.doc-toc a:hover {
		color: var(--color-primary);
		border-left-color: var(--color-primary);
	}

	@media (max-width: 1024px) {
		.doc-layout {
			grid-template-columns: 200px minmax(0, 1fr);
		}
		.doc-toc {
			display: none;
		}
	}

	@media (max-width: 720px) {
		.doc-layout {
			grid-template-columns: 1fr;
			gap: 1.5rem;
		}
		.doc-nav {
			position: static;
			border-bottom: 1px solid var(--color-border);
			padding-bottom: 1rem;
		}
	}
</style>
