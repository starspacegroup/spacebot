<script>
	let { data } = $props();
</script>

<svelte:head>
	<title>SpaceBot – Discord Bot Platform</title>
	<meta name="description" content="A powerful, self-hosted Discord bot platform. Create custom slash commands, build event-driven automations, and monitor all activity through a beautiful admin dashboard." />
</svelte:head>

<div class="landing">
	<!-- Hero Section -->
	<section class="hero">
		<div class="hero-content">
			<h1>🚀 SpaceBot</h1>
			<p class="tagline">The powerful Discord bot platform you control</p>
			<p class="description">
				Create custom slash commands, build event-driven automations, and monitor all Discord activity through a beautiful admin dashboard. <strong>100% open source.</strong>
			</p>
			<div class="cta-buttons">
				{#if data.isLoggedIn}
					<a href="/admin" class="btn btn-primary">Go to Dashboard</a>
				{:else}
					<a href="/login" class="btn btn-primary">Get Started</a>
				{/if}
				<a href="https://github.com/starspacegroup/spacebot" target="_blank" rel="noopener noreferrer" class="btn btn-secondary"><svg class="github-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg> View on GitHub</a>
			</div>
		</div>
		<div class="hero-screenshot">
			<img src="/server-admin.png" alt="SpaceBot Admin Dashboard" />
		</div>
	</section>

	<!-- Features Section -->
	<section id="features" class="features">
		<h2>Everything you need to supercharge your Discord server</h2>
		
		<div class="feature-grid">
			<div class="feature-card">
				<span class="feature-icon">🤖</span>
				<h3>Custom Slash Commands</h3>
				<p>Create your own commands with parameters, choices, and custom responses. No coding required.</p>
			</div>
			
			<div class="feature-card">
				<span class="feature-icon">⚡</span>
				<h3>Event-Driven Automations</h3>
				<p>Trigger actions automatically when Discord events occur—member joins, messages, voice changes, and more.</p>
			</div>
			
			<div class="feature-card">
				<span class="feature-icon">📊</span>
				<h3>Detailed Event Logs</h3>
				<p>View comprehensive logs of all Discord activity including members, messages, voice, and moderation events.</p>
			</div>
			
			<div class="feature-card">
				<span class="feature-icon">🎨</span>
				<h3>Visual Automation Builder</h3>
				<p>Design complex automations with an intuitive visual interface. Set triggers, conditions, and actions with ease.</p>
			</div>
			
			<div class="feature-card">
				<span class="feature-icon">🔐</span>
				<h3>Secure & Private</h3>
				<p>Discord OAuth2 authentication and cryptographic verification keep your server data safe.</p>
			</div>
			
			<div class="feature-card">
				<span class="feature-icon">🌍</span>
				<h3>Lightning Fast</h3>
				<p>Deployed on Cloudflare's global edge network for fast response times worldwide with zero cold starts.</p>
			</div>
			
			<div class="feature-card">
				<span class="feature-icon">📖</span>
				<h3>Open Source</h3>
				<p>Fully open source and self-hostable. Inspect the code, contribute features, or fork it for your own use. <a href="https://github.com/starspacegroup/spacebot" target="_blank" rel="noopener noreferrer" class="github-link"><svg class="github-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg> GitHub</a></p>
			</div>
		</div>
	</section>

	<!-- How It Works Section -->
	<section class="how-it-works">
		<h2>How It Works</h2>
		
		<div class="steps">
			<div class="step">
				<div class="step-number">1</div>
				<h3>Login with Discord</h3>
				<p>Securely authenticate with your Discord account to access the admin dashboard.</p>
			</div>
			
			<div class="step">
				<div class="step-number">2</div>
				<h3>Add Bot to Server</h3>
				<p>Add SpaceBot to your Discord server with the required permissions.</p>
			</div>
			
			<div class="step">
				<div class="step-number">3</div>
				<h3>Create Commands & Automations</h3>
				<p>Use the visual builder to create custom slash commands and event automations.</p>
			</div>
			
			<div class="step">
				<div class="step-number">4</div>
				<h3>Monitor & Manage</h3>
				<p>View logs, track events, and fine-tune your bot's behavior from the dashboard.</p>
			</div>
		</div>
	</section>

	<!-- CTA Section -->
	<section class="cta-section">
		<h2>Ready to supercharge your Discord server?</h2>
		<p>Get started in minutes with SpaceBot's intuitive dashboard.</p>
		{#if data.isLoggedIn}
			<a href="/admin" class="btn btn-primary btn-large">Go to Dashboard</a>
		{:else}
			<a href="/login" class="btn btn-primary btn-large">Login with Discord</a>
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

	.hero h1 {
		font-size: 3.5rem;
		margin-bottom: 0.5rem;
		background: linear-gradient(135deg, var(--color-primary), #8b5cf6);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
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
		max-width: 1000px;
		margin-left: auto;
		margin-right: auto;
	}

	.hero-screenshot img {
		width: 100%;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		border: 1px solid var(--color-border);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.75rem 1.5rem;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: 1rem;
		text-decoration: none;
		transition: all var(--transition-fast);
		cursor: pointer;
		border: none;
	}

	.btn-primary {
		background: var(--color-primary);
		color: white;
	}

	.btn-primary:hover {
		background: var(--color-primary-hover);
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

	.btn-secondary {
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}

	.btn-secondary:hover {
		background: var(--color-surface-hover);
	}

	.btn-large {
		padding: 1rem 2rem;
		font-size: 1.125rem;
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
		transition: transform var(--transition-fast), box-shadow var(--transition-fast);
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

	/* How It Works Section */
	.how-it-works {
		padding: 4rem 0;
		background: var(--color-surface);
		margin: 0 -1.5rem;
		padding-left: 1.5rem;
		padding-right: 1.5rem;
	}

	.how-it-works h2 {
		text-align: center;
		font-size: 2rem;
		margin-bottom: 3rem;
		color: var(--color-text);
	}

	.steps {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 2rem;
		max-width: 1000px;
		margin: 0 auto;
	}

	.step {
		text-align: center;
	}

	.step-number {
		width: 3rem;
		height: 3rem;
		background: var(--color-primary);
		color: white;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.25rem;
		font-weight: 700;
		margin: 0 auto 1rem;
	}

	.step h3 {
		font-size: 1.125rem;
		margin-bottom: 0.5rem;
		color: var(--color-text);
	}

	.step p {
		color: var(--color-text-muted);
		font-size: 0.95rem;
		line-height: 1.5;
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
		.how-it-works h2,
		.cta-section h2 {
			font-size: 1.5rem;
		}

		.feature-grid {
			grid-template-columns: 1fr;
		}

		.steps {
			grid-template-columns: 1fr;
		}
	}
</style>
