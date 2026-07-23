<script lang="ts">
	import { getTranslator } from '$lib/i18n.js';

	const tr = getTranslator();
</script>

<svelte:head>
	<title>{tr('docs.meta.title')}</title>
	<meta name="description" content={tr('docs.meta.description')} />
	<meta property="og:title" content={tr('docs.meta.title')} />
	<meta property="og:description" content={tr('docs.meta.description')} />
	<meta property="og:url" content="https://spacebot.starspace.group/docs" />
	<meta property="og:image" content="https://spacebot.starspace.group/logo.jpg" />
	<meta name="twitter:title" content={tr('docs.meta.title')} />
	<meta name="twitter:description" content={tr('docs.meta.description')} />
	<meta name="twitter:image" content="https://spacebot.starspace.group/logo.jpg" />
</svelte:head>

<div class="docs-page">
	<header class="docs-header">
		<h1>{tr('docs.title')}</h1>
		<p class="docs-subtitle">{tr('docs.subtitle')}</p>
	</header>

	<a class="dev-docs-callout" href="/docs/dev">
		<span class="callout-label">{tr('docs.devCallout.label')}</span>
		<span class="callout-text">{tr('docs.devCallout.text')}</span>
	</a>

	<div class="docs-body">
		<nav class="docs-toc" aria-label={tr('legal.tocAria')}>
			<h2 class="toc-title">{tr('docs.toc.onThisPage')}</h2>
			<ol>
				<li><a href="#getting-started">{tr('docs.section.gettingStarted')}</a></li>
				<li><a href="#dashboard">{tr('docs.section.dashboard')}</a></li>
				<li><a href="#commands">{tr('docs.section.commands')}</a></li>
				<li><a href="#automations">{tr('docs.section.automations')}</a></li>
				<li><a href="#scheduled-events">{tr('docs.section.scheduledEvents')}</a></li>
				<li><a href="#event-logs">{tr('docs.section.eventLogs')}</a></li>
				<li><a href="#statistics">{tr('docs.section.statistics')}</a></li>
				<li><a href="#integrations">{tr('docs.section.integrations')}</a></li>
				<li><a href="#api">{tr('docs.section.api')}</a></li>
				<li><a href="#ai-assistant">{tr('docs.section.ai')}</a></li>
				<li><a href="#scheduled-messages">{tr('docs.section.scheduledMessages')}</a></li>
				<li><a href="#button-actions">{tr('docs.section.buttonActions')}</a></li>
				<li><a href="#server-settings">{tr('docs.section.serverSettings')}</a></li>
				<li><a href="#billing">{tr('docs.section.billing')}</a></li>
			</ol>
		</nav>

		<div class="docs-content">
			<!-- Getting Started -->
			<section id="getting-started">
				<h2>{tr('docs.section.gettingStarted')}</h2>
				<p>{tr('docs.start.intro')}</p>
				<ol>
					<li>{@html tr('docs.start.item1')}</li>
					<li>{@html tr('docs.start.item2')}</li>
					<li>{@html tr('docs.start.item3')}</li>
				</ol>
			</section>

			<!-- Dashboard -->
			<section id="dashboard">
				<h2>{tr('docs.section.dashboard')}</h2>
				<p>{tr('docs.dashboard.body')}</p>
			</section>

			<!-- Slash Commands -->
			<section id="commands">
				<h2>{tr('docs.section.commands')}</h2>
				<p>{tr('docs.commands.body')}</p>
				<h3>{tr('docs.commands.keyFeatures')}</h3>
				<ul>
					<li>{@html tr('docs.commands.f1')}</li>
					<li>{@html tr('docs.commands.f2')}</li>
					<li>{@html tr('docs.commands.f3')}</li>
					<li>{@html tr('docs.commands.f4')}</li>
				</ul>
			</section>

			<!-- Automations -->
			<section id="automations">
				<h2>{tr('docs.section.automations')}</h2>
				<p>{tr('docs.automations.body')}</p>
				<h3>{tr('docs.automations.howItWorks')}</h3>
				<ol>
					<li>{@html tr('docs.automations.t1')}</li>
					<li>{@html tr('docs.automations.t2')}</li>
					<li>{@html tr('docs.automations.t3')}</li>
				</ol>
				<p>{tr('docs.automations.body2')}</p>
				<p>{@html tr('docs.automations.ownBot')}</p>
			</section>

			<!-- Scheduled Events -->
			<section id="scheduled-events">
				<h2>{tr('docs.section.scheduledEvents')}</h2>
				<p>{tr('docs.scheduledEvents.body')}</p>
			</section>

			<!-- Event Logs -->
			<section id="event-logs">
				<h2>{tr('docs.section.eventLogs')}</h2>
				<p>{tr('docs.eventLogs.body')}</p>
				<h3>{tr('docs.eventLogs.loggedInclude')}</h3>
				<ul>
					<li>{tr('docs.eventLogs.l1')}</li>
					<li>{tr('docs.eventLogs.l2')}</li>
					<li>{tr('docs.eventLogs.l3')}</li>
					<li>{tr('docs.eventLogs.l4')}</li>
					<li>{tr('docs.eventLogs.l5')}</li>
					<li>{tr('docs.eventLogs.l6')}</li>
				</ul>
			</section>

			<!-- Statistics -->
			<section id="statistics">
				<h2>{tr('docs.section.statistics')}</h2>
				<p>{tr('docs.statistics.body')}</p>
			</section>

			<!-- Integrations -->
			<section id="integrations">
				<h2>{tr('docs.section.integrations')}</h2>
				<p>{tr('docs.integrations.body')}</p>
				<h3>{tr('docs.integrations.forDevs')}</h3>
				<p>{@html tr('docs.integrations.devBody')}</p>
			</section>

			<!-- REST API -->
			<section id="api">
				<h2>{tr('docs.section.api')}</h2>
				<p>{tr('docs.api.body')}</p>
				<h3>{tr('docs.api.whatYouCanDo')}</h3>
				<ul>
					<li>{tr('docs.api.w1')}</li>
					<li>{tr('docs.api.w2')}</li>
					<li>{tr('docs.api.w3')}</li>
					<li>{tr('docs.api.w4')}</li>
				</ul>
				<p>{tr('docs.api.body2')}</p>
			</section>

			<!-- AI Assistant -->
			<section id="ai-assistant">
				<h2>{tr('docs.section.ai')}</h2>
				<p>{tr('docs.ai.body')}</p>
			</section>

			<!-- Scheduled Messages -->
			<section id="scheduled-messages">
				<h2>{tr('docs.section.scheduledMessages')}</h2>
				<p>{tr('docs.scheduledMessages.body')}</p>
			</section>

			<!-- Button Actions -->
			<section id="button-actions">
				<h2>{tr('docs.section.buttonActions')}</h2>
				<p>{tr('docs.buttonActions.body')}</p>
			</section>

			<!-- Server Settings -->
			<section id="server-settings">
				<h2>{tr('docs.section.serverSettings')}</h2>
				<p>{tr('docs.serverSettings.body')}</p>
			</section>

			<!-- Billing -->
			<section id="billing">
				<h2>{tr('docs.section.billing')}</h2>
				<p>{tr('docs.billing.body')}</p>
			</section>
		</div>
	</div>
</div>

<style>
	.docs-page {
		padding: 2.5rem 2rem 4rem;
	}

	/* Two-column body: sticky TOC sidebar + content, so the page fills the
	   viewport on desktop instead of a narrow centered column. */
	.docs-body {
		display: grid;
		grid-template-columns: 230px minmax(0, 1fr);
		gap: 3rem;
		align-items: start;
	}

	.docs-content {
		min-width: 0;
		overflow-wrap: break-word;
	}

	.docs-header {
		margin-bottom: 2rem;
	}

	.docs-header h1 {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.35rem;
	}

	.docs-subtitle {
		color: var(--color-text-muted);
		font-size: 1.05rem;
	}

	.dev-docs-callout {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		background: color-mix(in srgb, var(--color-primary) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
		border-radius: var(--radius-lg);
		padding: 0.9rem 1.25rem;
		margin-bottom: 2rem;
		text-decoration: none;
		transition: border-color 0.15s ease;
	}

	.dev-docs-callout:hover {
		border-color: var(--color-primary);
	}

	.callout-label {
		font-weight: 600;
		color: var(--color-text);
		font-size: 0.95rem;
	}

	.callout-text {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	/* Table of contents — sticky sidebar */
	.docs-toc {
		position: sticky;
		top: 1.5rem;
	}

	.toc-title {
		font-size: 0.85rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
	}

	.docs-toc ol {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.docs-toc li {
		padding: 0.2rem 0;
	}

	.docs-toc a {
		color: var(--color-primary);
		text-decoration: none;
		font-size: 0.92rem;
	}

	.docs-toc a:hover {
		text-decoration: underline;
	}

	/* Content sections */
	.docs-content section {
		margin-bottom: 2.5rem;
	}

	.docs-content h2 {
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.6rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border);
		padding-top: 1.5rem;
	}

	.docs-content section:first-child h2 {
		border-top: none;
		padding-top: 0;
	}

	.docs-content h3 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
		margin-top: 1rem;
		margin-bottom: 0.4rem;
	}

	.docs-content p {
		color: var(--color-text-secondary);
		line-height: 1.7;
		margin-bottom: 0.75rem;
	}

	.docs-content ul,
	.docs-content ol {
		color: var(--color-text-secondary);
		margin-bottom: 0.75rem;
		padding-left: 1.5rem;
		line-height: 1.7;
	}

	.docs-content li {
		margin-bottom: 0.3rem;
	}

	.docs-content a {
		color: var(--color-primary);
		text-decoration: none;
	}

	.docs-content a:hover {
		text-decoration: underline;
	}

	kbd {
		display: inline-block;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 0.1rem 0.4rem;
		font-size: 0.82rem;
		font-family: inherit;
		box-shadow: 0 1px 0 var(--color-border);
	}

	/* Stack the TOC above content on narrow screens. */
	@media (max-width: 820px) {
		.docs-page {
			padding: 2rem 1.25rem 3rem;
		}

		.docs-body {
			grid-template-columns: minmax(0, 1fr);
			gap: 1.5rem;
		}

		.docs-toc {
			position: static;
			background: var(--color-surface);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-lg);
			padding: 1.1rem 1.25rem;
		}

		.docs-toc ol {
			columns: 2;
			column-gap: 2rem;
		}
	}

	@media (max-width: 540px) {
		.docs-toc ol {
			columns: 1;
		}
	}
</style>
