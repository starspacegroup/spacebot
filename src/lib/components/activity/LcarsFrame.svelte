<script lang="ts">
	/**
	 * The LCARS frame around every Activity screen: the elbows, the bars, the
	 * title in the state colour, and the module nav. The active tab is larger,
	 * carries the arrow marker and the state colour, and runs into the content, so
	 * it is always plain which app you are in. "SpaceBot" is a brand block, not
	 * a tab.
	 */
	import type { Snippet } from 'svelte';

	const {
		title,
		accent = '#ff9900',
		tab = null,
		footer = '',
		tabs = [],
		active = '',
		onselect = () => {},
		sample = false,
		top,
		children,
	}: {
		title: string;
		accent?: string;
		/** The active tab's colour, when it differs from the accent (grey when out). */
		tab?: string | null;
		footer?: string;
		tabs?: { id: string; label: string }[];
		active?: string;
		onselect?: (id: string) => void;
		/** Dev preview: canned data is on screen. */
		sample?: boolean;
		top?: Snippet;
		children: Snippet;
	} = $props();
</script>

<div class="lcars" style:--acc={accent} style:--tab={tab ?? accent}>
	<div class="eT" aria-hidden="true"></div>
	<header class="tb">
		<div class="seg" style="width:5em;background:var(--p)" aria-hidden="true"></div>
		<div class="seg" style="width:2.5em;background:var(--r)" aria-hidden="true"></div>
		<div class="seg" style="width:11.8em;background:var(--l)" aria-hidden="true"></div>
		{#if top}{@render top()}{/if}
		{#if sample}<span class="sample">Sample data</span>{/if}
		<h1>{title}</h1>
	</header>
	<nav class="sd" aria-label="Modules">
		{#each tabs as t (t.id)}
			<button
				type="button"
				class="tab"
				class:on={t.id === active}
				aria-current={t.id === active ? 'page' : undefined}
				onclick={() => onselect(t.id)}>{t.label}</button
			>
		{/each}
		<div class="brand">SpaceBot</div>
	</nav>
	<main class="m">
		{@render children()}
	</main>
	<div class="eB" aria-hidden="true"></div>
	<footer class="bb">
		<div class="seg" style="width:8.2em;background:var(--b)" aria-hidden="true"></div>
		<div class="seg" style="width:3.2em;background:var(--acc)" aria-hidden="true"></div>
		<div class="seg" style="width:16.4em;background:var(--l)" aria-hidden="true"></div>
		<span class="foot">{footer}</span>
	</footer>
</div>
