<script lang="ts">
	import { catalogs, normalizeLocale, t, type Locale } from '$lib/i18n.js';

	const { locale = 'en' }: { locale?: Locale } = $props();
	const current = $derived(normalizeLocale(locale));

	function changeLanguage(event: Event) {
		const next = normalizeLocale((event.target as HTMLSelectElement).value);
		document.cookie = `spacebot_locale=${next};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
		location.reload();
	}
</script>

<label class="language-selector">
	<span>{t(current, 'language.label')}</span>
	<select aria-label={t(current, 'language.label')} onchange={changeLanguage} value={current}>
		{#each Object.keys(catalogs) as code}
			<option value={code}>{code.toUpperCase()}</option>
		{/each}
	</select>
</label>

<style>
	.language-selector {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--color-text-secondary);
		font-size: 0.85rem;
	}

	.language-selector select {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		padding: 0.35rem 0.45rem;
	}
</style>
