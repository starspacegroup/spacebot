<script lang="ts">
	import { getTranslator } from '$lib/i18n.js';
	import TrustedHtml from '$lib/components/TrustedHtml.svelte';

	const { data } = $props();
	const tr = getTranslator();
</script>

<svelte:head>
	<title>{tr('docs.dev.meta.title')}</title>
	<meta name="description" content={tr('docs.dev.meta.description')} />
	<meta property="og:title" content={tr('docs.dev.meta.title')} />
	<meta property="og:description" content={tr('docs.dev.meta.ogDescription')} />
	<meta property="og:url" content="https://spacebot.starspace.group/docs/dev" />
</svelte:head>

<div class="dev-index">
	<header class="dev-hero">
		<a class="back-link" href="/docs">{tr('docs.dev.backToUser')}</a>
		<h1>{tr('docs.dev.title')}</h1>
		<p class="hero-sub"><TrustedHtml html={tr('docs.dev.heroSub')} /></p>
	</header>

	{#each data.sections as section (section.title)}
		<section class="dev-section">
			<h2>{section.title}</h2>
			<div class="card-grid">
				{#each section.docs as doc (doc.slug)}
					<a class="doc-card" href="/docs/dev/{doc.slug}">
						<span class="doc-card-title">{doc.title}</span>
						{#if doc.description}
							<span class="doc-card-desc">{doc.description}</span>
						{/if}
					</a>
				{/each}
			</div>
		</section>
	{/each}
</div>

<style>
	.dev-index {
		padding: 2.5rem 2rem 4rem;
	}

	.dev-hero {
		margin-bottom: 2.5rem;
	}

	.back-link {
		display: inline-block;
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.9rem;
		margin-bottom: 1rem;
	}

	.back-link:hover {
		color: var(--color-primary);
	}

	.dev-hero h1 {
		font-size: 1.9rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	.hero-sub {
		color: var(--color-text-muted);
		font-size: 1.05rem;
		line-height: 1.6;
		max-width: 640px;
	}

	.hero-sub code {
		font-size: 0.9em;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 0.05rem 0.35rem;
	}

	.dev-section {
		margin-bottom: 2.5rem;
	}

	.dev-section h2 {
		font-size: 0.85rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 1rem;
	}

	.card-grid {
		display: grid;
		/* min(260px, 100%) lets the column shrink to the container on phones
		   narrower than 260px, so the grid never overflows the viewport. */
		grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
		gap: 1rem;
	}

	@media (max-width: 720px) {
		.dev-index {
			padding: 2rem 1.25rem 3rem;
		}
	}

	.doc-card {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.1rem 1.25rem;
		text-decoration: none;
		transition:
			border-color 0.15s ease,
			transform 0.15s ease;
	}

	.doc-card:hover {
		border-color: var(--color-primary);
		transform: translateY(-2px);
	}

	.doc-card-title {
		font-weight: 600;
		color: var(--color-text);
	}

	.doc-card-desc {
		font-size: 0.88rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}
</style>
