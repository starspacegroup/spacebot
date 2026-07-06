<script lang="ts">
	import { getTranslator } from '$lib/i18n.js';
	const year = new Date().getFullYear();
	const tr = getTranslator();
</script>

<footer class="app-footer">
	<div class="footer-content">
		<span class="footer-copy"
			>&copy; {year}
			{tr('footer.tagline')}
			<a href="https://starspace.group" target="_blank" rel="noopener noreferrer">*Space</a
			></span
		>
		<nav class="footer-links">
			<a href="/terms">{tr('footer.terms')}</a>
			<a href="/privacy">{tr('footer.privacy')}</a>
			<a
				href="https://github.com/starspacegroup/spacebot"
				target="_blank"
				rel="noopener noreferrer">{tr('footer.github')}</a
			>
		</nav>
	</div>
</footer>

<style>
	.app-footer {
		border-top: 1px solid var(--color-border);
		background: var(--color-surface);
		padding: 1.25rem 1rem;
		margin-top: auto;
	}

	.footer-content {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.footer-copy {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.footer-copy a {
		color: var(--color-text-secondary);
		text-decoration: none;
		transition: color var(--transition-fast);
	}

	.footer-copy a:hover {
		color: var(--color-primary);
	}

	.footer-links {
		display: flex;
		align-items: center;
		gap: 1.25rem;
	}

	.footer-links a {
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: 0.85rem;
		transition: color var(--transition-fast);
	}

	.footer-links a:hover {
		color: var(--color-primary);
	}

	@media (max-width: 480px) {
		.footer-content {
			flex-direction: column;
			text-align: center;
		}
	}
</style>
