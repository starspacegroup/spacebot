<script lang="ts">
	import { getTranslator } from '$lib/i18n.js';
	import HowItWorks from '$lib/components/HowItWorks.svelte';

	const { data } = $props();
	const tr = getTranslator();

	// Build admin URL - use guild-specific if available
	const adminUrl = $derived(data.selectedGuildId ? `/admin/${data.selectedGuildId}` : '/admin');

	let billingInterval = $state('monthly');
</script>

<svelte:head>
	<title>{tr('home.meta.title')}</title>
	<meta name="description" content={tr('home.meta.description')} />
</svelte:head>

<div class="landing">
	<!-- Hero Section -->
	<section class="hero">
		<div class="hero-content">
			<h1 class="hero-identity">
				<img src="/logo.webp" alt={tr('home.hero.logoAlt')} class="hero-logo" /> SpaceBot
			</h1>
			<p class="tagline">{tr('home.hero.tagline')}</p>
			<p class="description">
				{tr('home.hero.description')} <strong>{tr('home.hero.openSource')}</strong>
			</p>
			<div class="cta-buttons">
				{#if data.isLoggedIn}
					<a href={adminUrl} class="btn btn-primary">{tr('common.goToDashboard')}</a>
				{:else}
					<a href="/login" class="btn btn-primary">{tr('common.getStartedFree')}</a>
				{/if}
				<a
					href="https://github.com/starspacegroup/spacebot"
					target="_blank"
					rel="noopener noreferrer"
					class="btn btn-secondary"
					><svg class="github-icon" viewBox="0 0 24 24" fill="currentColor"
						><path
							d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
						/></svg
					>
					{tr('home.hero.viewOnGitHub')}</a
				>
			</div>
		</div>
		<div class="hero-screenshot">
			<img
				src="/server-admin-light.webp"
				alt={tr('home.hero.dashboardAlt')}
				class="screenshot-light"
			/>
			<img
				src="/server-admin-dark.webp"
				alt={tr('home.hero.dashboardAlt')}
				class="screenshot-dark"
			/>
		</div>
	</section>

	<!-- Features Section -->
	<section id="features" class="features">
		<h2>{tr('home.features.heading')}</h2>

		<div class="feature-grid">
			<div class="feature-card">
				<span class="feature-icon"
					><img src="/logo.webp" alt="" style="height:1.8rem;width:auto;" /></span
				>
				<h3>{tr('home.features.commands.title')}</h3>
				<p>{tr('home.features.commands.body')}</p>
			</div>

			<div class="feature-card">
				<span class="feature-icon">⚡</span>
				<h3>{tr('home.features.automations.title')}</h3>
				<p>{tr('home.features.automations.body')}</p>
			</div>

			<div class="feature-card">
				<span class="feature-icon">🧠</span>
				<h3>{tr('home.features.ai.title')}</h3>
				<p>{tr('home.features.ai.body')}</p>
			</div>

			<div class="feature-card">
				<span class="feature-icon">📊</span>
				<h3>{tr('home.features.analytics.title')}</h3>
				<p>{tr('home.features.analytics.body')}</p>
			</div>

			<div class="feature-card">
				<span class="feature-icon">🔗</span>
				<h3>{tr('home.features.webhooks.title')}</h3>
				<p>{tr('home.features.webhooks.body')}</p>
			</div>

			<div class="feature-card">
				<span class="feature-icon">🔑</span>
				<h3>{tr('home.features.api.title')}</h3>
				<p>{tr('home.features.api.body')}</p>
			</div>

			<div class="feature-card">
				<span class="feature-icon">📅</span>
				<h3>{tr('home.features.events.title')}</h3>
				<p>{tr('home.features.events.body')}</p>
			</div>

			<div class="feature-card">
				<span class="feature-icon">🔐</span>
				<h3>{tr('home.features.permissions.title')}</h3>
				<p>{tr('home.features.permissions.body')}</p>
			</div>

			<div class="feature-card">
				<span class="feature-icon">📖</span>
				<h3>{tr('home.features.openSource.title')}</h3>
				<p>
					{tr('home.features.openSource.pre')}
					<a
						href="https://github.com/starspacegroup/spacebot"
						target="_blank"
						rel="noopener noreferrer"
						class="github-link"
						><svg class="github-icon" viewBox="0 0 24 24" fill="currentColor"
							><path
								d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
							/></svg
						> GitHub</a
					>{tr('home.features.openSource.post')}
				</p>
			</div>
		</div>
	</section>

	<!-- Pricing Section -->
	<section id="pricing" class="pricing">
		<h2>{tr('home.pricing.heading')}</h2>
		<p class="pricing-subtitle">{tr('home.pricing.subtitle')}</p>

		<div class="billing-toggle">
			<button
				class="billing-option"
				class:active={billingInterval === 'monthly'}
				onclick={() => (billingInterval = 'monthly')}>{tr('home.pricing.monthly')}</button
			>
			<button
				class="billing-option"
				class:active={billingInterval === 'yearly'}
				onclick={() => (billingInterval = 'yearly')}
				>{tr('home.pricing.yearly')}
				<span class="billing-save">{tr('home.pricing.save')}</span></button
			>
		</div>

		<div class="pricing-grid">
			<div class="pricing-card">
				<div class="pricing-badge">{tr('home.pricing.starter.badge')}</div>
				<div class="pricing-price">
					<span class="price-amount price-free">{tr('home.pricing.free')}</span>
				</div>
				<p class="pricing-description">{tr('home.pricing.starter.description')}</p>
				<ul class="pricing-features">
					<li><span class="check">✓</span> {tr('home.pricing.starter.f1')}</li>
					<li><span class="check">✓</span> {tr('home.pricing.starter.f2')}</li>
					<li><span class="check">✓</span> {tr('home.pricing.starter.f3')}</li>
					<li><span class="check">✓</span> {tr('home.pricing.starter.f4')}</li>
					<li><span class="check">✓</span> {tr('home.pricing.starter.f5')}</li>
					<li><span class="check">✓</span> {tr('home.pricing.starter.f6')}</li>
					<li><span class="check">✓</span> {tr('home.pricing.starter.f7')}</li>
					<li><span class="check">✓</span> {tr('home.pricing.starter.f8')}</li>
					<li><span class="check">✓</span> {tr('home.pricing.starter.f9')}</li>
					<li><span class="check">✓</span> {tr('home.pricing.starter.f10')}</li>
				</ul>
				{#if data.isLoggedIn}
					<a href={adminUrl} class="btn btn-secondary btn-block"
						>{tr('common.goToDashboard')}</a
					>
				{:else}
					<a href="/login" class="btn btn-secondary btn-block"
						>{tr('home.pricing.starter.cta')}</a
					>
				{/if}
			</div>

			<div class="pricing-card pricing-card-featured">
				<div class="pricing-badge pricing-badge-featured">
					{tr('home.pricing.pro.badge')}
				</div>
				<div class="pricing-price">
					{#if billingInterval === 'yearly'}
						<span class="price-amount">$2.50</span>
						<span class="price-period">{tr('home.pricing.perServerMonth')}</span>
						<div class="price-billed-note">
							{tr('home.pricing.billedYearly', { amount: '$30' })}
						</div>
					{:else}
						<span class="price-amount">$3</span>
						<span class="price-period">{tr('home.pricing.perServerMonth')}</span>
					{/if}
				</div>
				<p class="pricing-description">{tr('home.pricing.pro.description')}</p>
				<ul class="pricing-features">
					<li><span class="check">✓</span> {tr('home.pricing.pro.f1')}</li>
					<li><span class="check-pro">✓</span> {tr('home.pricing.pro.f2')}</li>
					<li><span class="check-pro">✓</span> {tr('home.pricing.pro.f3')}</li>
					<li><span class="check-pro">✓</span> {tr('home.pricing.pro.f4')}</li>
				</ul>
				{#if data.isLoggedIn}
					<a
						href="/admin/upgrade?interval={billingInterval}"
						class="btn btn-primary btn-block">{tr('common.signUp')}</a
					>
				{:else}
					<a
						href="/admin/upgrade?interval={billingInterval}"
						class="btn btn-primary btn-block">{tr('common.signUp')}</a
					>
				{/if}
			</div>

			<div class="pricing-card pricing-card-coming-soon">
				<div class="pricing-badge">{tr('home.pricing.ultimate.badge')}</div>
				<div class="pricing-price">
					{#if billingInterval === 'yearly'}
						<span class="price-amount">$35</span>
						<span class="price-period">{tr('home.pricing.perServerMonth')}</span>
						<div class="price-billed-note">
							{tr('home.pricing.billedYearly', { amount: '$420' })}
						</div>
					{:else}
						<span class="price-amount">$42</span>
						<span class="price-period">{tr('home.pricing.perServerMonth')}</span>
					{/if}
				</div>
				<p class="pricing-description">{tr('home.pricing.ultimate.description')}</p>
				<ul class="pricing-features">
					<li><span class="check">✓</span> {tr('home.pricing.ultimate.f1')}</li>
					<li><span class="check-ultimate">✓</span> {tr('home.pricing.ultimate.f2')}</li>
					<li><span class="check-ultimate">✓</span> {tr('home.pricing.ultimate.f3')}</li>
					<li><span class="check-ultimate">✓</span> {tr('home.pricing.ultimate.f4')}</li>
				</ul>
				<button class="btn btn-secondary btn-block" disabled
					>{tr('common.comingSoon')}</button
				>
			</div>
		</div>
	</section>

	<!-- How It Works Section: animated SVG scenes -->
	<HowItWorks />

	<!-- CTA Section -->
	<section class="cta-section">
		<h2>{tr('home.cta.heading')}</h2>
		<p>{tr('home.cta.body')}</p>
		{#if data.isLoggedIn}
			<a href={adminUrl} class="btn btn-primary btn-large">{tr('common.goToDashboard')}</a>
		{:else}
			<a href="/login" class="btn btn-primary btn-large"
				><svg
					class="discord-icon"
					width="20"
					height="16"
					viewBox="0 0 71 55"
					fill="currentColor"
					xmlns="http://www.w3.org/2000/svg"
					><path
						d="M60.1 4.9A58.5 58.5 0 0 0 45.4.2a.2.2 0 0 0-.2.1 40.8 40.8 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0A37.4 37.4 0 0 0 25.4.3a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.5 4.9a.2.2 0 0 0-.1.1C1.5 18.7-.9 32.2.3 45.5v.2a58.9 58.9 0 0 0 17.7 9 .2.2 0 0 0 .3-.1 42.1 42.1 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.8 38.8 0 0 1-5.5-2.6.2.2 0 0 1 0-.4c.4-.3.7-.6 1.1-.9a.2.2 0 0 1 .2 0c11.6 5.3 24.2 5.3 35.7 0a.2.2 0 0 1 .2 0l1.1.9a.2.2 0 0 1 0 .4c-1.8 1-3.6 1.9-5.6 2.6a.2.2 0 0 0-.1.3 47.3 47.3 0 0 0 3.7 5.9.2.2 0 0 0 .2.1 58.7 58.7 0 0 0 17.7-9 .2.2 0 0 0 .1-.2c1.4-15-2.3-28.4-9.8-40.1a.2.2 0 0 0-.1-.1ZM23.7 37.3c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.1 6.3-7.1 6.4 3.2 6.3 7.1c0 3.9-2.8 7.1-6.3 7.1Zm23.3 0c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.1 6.3-7.1 6.4 3.2 6.3 7.1c0 3.9-2.7 7.1-6.3 7.1Z"
					/></svg
				>
				{tr('home.cta.login')}</a
			>
		{/if}
	</section>
</div>

<style>
	.landing {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 1.5rem;
	}

	/* Hero Section */
	.hero {
		text-align: center;
		padding: 4rem 1rem 5rem;
	}

	@media (min-width: 900px) {
		.hero {
			display: flex;
			align-items: center;
			gap: 3rem;
			text-align: left;
		}

		.hero-content {
			flex: 1;
			min-width: 0;
		}

		.description {
			margin-left: 0;
		}

		.hero-screenshot {
			flex: 1.2;
			min-width: 0;
			margin-top: 0;
		}
	}

	.hero-identity {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		font-size: 3rem;
		line-height: 1;
		background: linear-gradient(135deg, var(--color-primary), var(--color-accent-light));
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	@media (min-width: 900px) {
		.hero-identity {
			font-size: 4rem;
			gap: 0.75rem;
		}
	}

	.hero-logo {
		height: 1em;
		width: 1em;
		border-radius: 50%;
		flex-shrink: 0;
		object-fit: cover;
	}

	.tagline {
		font-size: 1.5rem;
		color: var(--color-text);
		margin-bottom: 1rem;
		font-weight: 500;
	}

	.description {
		font-size: 1.125rem;
		color: var(--color-text-muted);
		max-width: 600px;
		margin: 0 auto 2rem;
		line-height: 1.6;
	}

	.cta-buttons {
		display: flex;
		gap: 1rem;
		justify-content: center;
		flex-wrap: wrap;
	}

	.hero-screenshot {
		margin-top: 3rem;
	}

	.hero-screenshot img {
		width: 100%;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		border: 1px solid var(--color-border);
	}

	/* Theme-based screenshot visibility */
	.screenshot-dark {
		display: none;
	}
	.screenshot-light {
		display: block;
	}
	:global([data-theme='dark']) .screenshot-dark {
		display: block;
	}
	:global([data-theme='dark']) .screenshot-light {
		display: none;
	}

	.btn-primary:hover {
		transform: translateY(-1px);
	}

	.github-icon {
		width: 1.1em;
		height: 1.1em;
		vertical-align: -0.15em;
		margin-right: 0.4em;
	}

	.github-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
	}

	/* Features Section */
	.features {
		padding: 4rem 0;
	}

	.features h2 {
		text-align: center;
		font-size: 2rem;
		margin-bottom: 3rem;
		color: var(--color-text);
	}

	.feature-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1.5rem;
	}

	.feature-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 2rem;
		transition:
			transform var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.feature-card:hover {
		transform: translateY(-4px);
		box-shadow: var(--shadow-lg);
	}

	.feature-icon {
		font-size: 2.5rem;
		display: block;
		margin-bottom: 1rem;
	}

	.feature-card h3 {
		font-size: 1.25rem;
		margin-bottom: 0.75rem;
		color: var(--color-text);
	}

	.feature-card p {
		color: var(--color-text-muted);
		line-height: 1.6;
	}

	/* Pricing Section */
	.pricing {
		padding: 6rem 0;
		text-align: center;
	}

	.pricing h2 {
		font-size: 2rem;
		margin-bottom: 0.5rem;
		color: var(--color-text);
	}

	.pricing-subtitle {
		font-size: 1.125rem;
		color: var(--color-text-muted);
		margin-bottom: 1.5rem;
	}

	.billing-toggle {
		display: inline-flex;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full, 9999px);
		padding: 0.4rem;
		margin-top: 0.5rem;
		margin-bottom: 9rem;
		gap: 0.25rem;
	}

	.billing-option {
		padding: 0.5rem 1.25rem;
		border-radius: var(--radius-full, 9999px);
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		transition: all var(--transition-fast);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.billing-option:hover {
		color: var(--color-text);
	}

	.billing-option.active {
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
	}

	.billing-save {
		font-size: 0.75rem;
		font-weight: 700;
		background: rgba(255, 255, 255, 0.15);
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-full, 9999px);
	}

	.billing-option.active .billing-save {
		background: rgba(255, 255, 255, 0.25);
	}

	.price-billed-note {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}

	.pricing-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 2rem;
		max-width: 1100px;
		margin: 0 auto;
	}

	.pricing-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 2.5rem 2rem;
		text-align: left;
		position: relative;
		transition:
			transform var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.pricing-card:hover {
		transform: translateY(-4px);
		box-shadow: var(--shadow-lg);
	}

	.pricing-card-featured:hover {
		box-shadow:
			0 0 25px color-mix(in srgb, var(--color-primary) 50%, transparent),
			0 0 50px color-mix(in srgb, var(--color-primary) 30%, transparent),
			0 0 80px color-mix(in srgb, var(--color-primary) 15%, transparent);
	}

	.pricing-card-featured {
		border-color: var(--color-primary);
		border-width: 1px;
		box-shadow:
			0 0 15px color-mix(in srgb, var(--color-primary) 40%, transparent),
			0 0 30px color-mix(in srgb, var(--color-primary) 20%, transparent);
		margin: -1.5rem 0;
		padding: 4rem 2rem;
		z-index: 1;
	}

	@media (min-width: 640px) {
		.pricing-card-featured {
			box-shadow:
				0 0 20px color-mix(in srgb, var(--color-primary) 50%, transparent),
				0 0 60px color-mix(in srgb, var(--color-primary) 30%, transparent),
				0 0 100px color-mix(in srgb, var(--color-primary) 15%, transparent);
		}
	}

	.pricing-card-coming-soon {
		border: 5px dashed var(--color-border);
		opacity: 0.55;
		filter: grayscale(0.5);
		background: color-mix(in srgb, var(--color-surface) 60%, transparent);
	}

	.pricing-card-coming-soon:hover {
		transform: none;
		box-shadow: none;
		cursor: default;
	}

	.pricing-badge {
		display: inline-block;
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 1rem;
	}

	.pricing-badge-featured {
		color: var(--color-primary);
	}

	.pricing-price {
		margin-bottom: 0.75rem;
	}

	.price-amount {
		font-size: 3rem;
		font-weight: 800;
		color: var(--color-text);
		line-height: 1;
	}

	.price-amount.price-free {
		font-weight: 800;
		opacity: 0.67;
	}

	.price-period {
		font-size: 1.125rem;
		color: var(--color-text-muted);
		font-weight: 400;
	}

	.pricing-description {
		color: var(--color-text-muted);
		margin-bottom: 1.5rem;
		font-size: 0.95rem;
		line-height: 1.5;
	}

	.pricing-features {
		list-style: none;
		padding: 0;
		margin: 0 0 2rem;
	}

	.pricing-features li {
		padding: 0.4rem 0;
		color: var(--color-text-secondary);
		font-size: 0.95rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.check {
		color: var(--color-success);
		font-weight: 700;
		flex-shrink: 0;
	}

	.check-pro {
		color: var(--color-primary);
		font-weight: 700;
		flex-shrink: 0;
	}

	.check-ultimate {
		color: var(--color-warning, #f59e0b);
		font-weight: 700;
		flex-shrink: 0;
	}

	.btn-block {
		display: block;
		width: 100%;
		text-align: center;
	}

	/* CTA Section */
	.cta-section {
		text-align: center;
		padding: 5rem 1rem;
	}

	.cta-section h2 {
		font-size: 2rem;
		margin-bottom: 0.75rem;
		color: var(--color-text);
	}

	.cta-section p {
		color: var(--color-text-muted);
		font-size: 1.125rem;
		margin-bottom: 2rem;
	}

	/* Responsive */
	@media (max-width: 640px) {
		.hero {
			padding: 2rem 0 3rem;
		}

		.hero h1 {
			font-size: 2.5rem;
		}

		.tagline {
			font-size: 1.25rem;
		}

		.description {
			font-size: 1rem;
		}

		.features h2,
		.cta-section h2 {
			font-size: 1.5rem;
		}

		.feature-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
