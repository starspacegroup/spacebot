<script lang="ts">
	/**
	 * The Open Graph and Twitter tags that make a shared link a card. The root layout renders one
	 * for every page from `socialFor()`. A page whose content is data (a listed server, a document)
	 * renders its own with its own title, description and, if it has one, its own image.
	 */
	import {
		OG_CARDS,
		OG_HEIGHT,
		OG_WIDTH,
		SITE_URL,
		ogImageUrl,
		type OgCardKey,
	} from '$lib/seo/social.js';

	const {
		title,
		description,
		path,
		card,
		image = null,
	}: {
		title: string;
		description: string;
		/** The page's own path, e.g. "/status". */
		path: string;
		/** The share card used when the page has no image of its own. */
		card: OgCardKey;
		/** An absolute URL to a square picture (a server icon). Shown as a small card. */
		image?: string | null;
	} = $props();

	const url = $derived(path === '/' ? SITE_URL : SITE_URL + path);
	const picture = $derived(image ?? ogImageUrl(card));
	const alt = $derived(image ? title : `${OG_CARDS[card].title} · ${OG_CARDS[card].subtitle}`);
</script>

<svelte:head>
	<meta property="og:site_name" content="SpaceBot" />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={url} />
	<meta property="og:image" content={picture} />
	<meta property="og:image:alt" content={alt} />
	{#if !image}
		<meta property="og:image:type" content="image/png" />
		<meta property="og:image:width" content={String(OG_WIDTH)} />
		<meta property="og:image:height" content={String(OG_HEIGHT)} />
	{/if}

	<meta name="twitter:card" content={image ? 'summary' : 'summary_large_image'} />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={picture} />
	<meta name="twitter:image:alt" content={alt} />
</svelte:head>
