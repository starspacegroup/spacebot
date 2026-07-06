<svelte:head>
	<title>Documentation – SpaceBot</title>
	<meta
		name="description"
		content="SpaceBot documentation — learn how to set up and use custom commands, automations, integrations, the REST API, and more."
	/>
	<meta property="og:title" content="Documentation – SpaceBot" />
	<meta
		property="og:description"
		content="SpaceBot documentation — learn how to set up and use custom commands, automations, integrations, the REST API, and more."
	/>
	<meta property="og:url" content="https://spacebot.starspace.group/docs" />
	<meta property="og:image" content="https://spacebot.starspace.group/logo.jpg" />
	<meta name="twitter:title" content="Documentation – SpaceBot" />
	<meta
		name="twitter:description"
		content="SpaceBot documentation — learn how to set up and use custom commands, automations, integrations, the REST API, and more."
	/>
	<meta name="twitter:image" content="https://spacebot.starspace.group/logo.jpg" />
</svelte:head>

<div class="docs-page">
	<header class="docs-header">
		<h1>Documentation</h1>
		<p class="docs-subtitle">Everything you need to get the most out of SpaceBot.</p>
	</header>

	<a class="dev-docs-callout" href="/docs/dev">
		<span class="callout-label">Building on SpaceBot?</span>
		<span class="callout-text"
			>See the developer docs — architecture, REST API, local runner, and workflows →</span
		>
	</a>

	<nav class="docs-toc" aria-label="Table of Contents">
		<h2 class="toc-title">On this page</h2>
		<ol>
			<li><a href="#getting-started">Getting Started</a></li>
			<li><a href="#dashboard">Dashboard Overview</a></li>
			<li><a href="#commands">Slash Commands</a></li>
			<li><a href="#automations">Automations</a></li>
			<li><a href="#scheduled-events">Scheduled Events</a></li>
			<li><a href="#event-logs">Event Logs</a></li>
			<li><a href="#statistics">Statistics</a></li>
			<li><a href="#integrations">Integrations</a></li>
			<li><a href="#api">REST API &amp; API Keys</a></li>
			<li><a href="#ai-assistant">AI Assistant</a></li>
			<li><a href="#scheduled-messages">Scheduled Messages</a></li>
			<li><a href="#button-actions">Button Actions</a></li>
			<li><a href="#server-settings">Server Settings</a></li>
			<li><a href="#billing">Plans &amp; Billing</a></li>
		</ol>
	</nav>

	<div class="docs-content">
		<!-- Getting Started -->
		<section id="getting-started">
			<h2>Getting Started</h2>
			<p>
				SpaceBot is a Discord bot platform that gives server admins full control over custom
				commands, event-driven automations, analytics, and more — all through a web
				dashboard.
			</p>
			<ol>
				<li>
					<strong>Invite the bot</strong> — <a href="/login">Log in with Discord</a> and select
					a server where you have admin permissions.
				</li>
				<li>
					<strong>Open the dashboard</strong> — Once logged in, pick your server from the dashboard
					to start configuring.
				</li>
				<li>
					<strong>Explore</strong> — Use the sidebar (or press <kbd>Ctrl</kbd>+<kbd>K</kbd
					> to open the command palette) to navigate between features.
				</li>
			</ol>
		</section>

		<!-- Dashboard -->
		<section id="dashboard">
			<h2>Dashboard Overview</h2>
			<p>
				The server dashboard is your home base. It shows a quick summary of recent activity,
				member counts, and shortcuts to every feature. Select a server from the top-level
				dashboard to enter its admin panel.
			</p>
		</section>

		<!-- Slash Commands -->
		<section id="commands">
			<h2>Slash Commands</h2>
			<p>
				Create custom slash commands your members can use in Discord. Each command can have
				parameters, permission requirements, and rich responses including embeds.
			</p>
			<h3>Key features</h3>
			<ul>
				<li>
					<strong>Parameters</strong> — Add options like strings, numbers, users, channels,
					roles, and choices.
				</li>
				<li>
					<strong>Permissions</strong> — Restrict commands to specific roles or require the
					user to be in a voice channel.
				</li>
				<li>
					<strong>Context menus</strong> — Create right-click actions for users and messages.
				</li>
				<li>
					<strong>Actions</strong> — Attach one or more actions to run when the command is invoked
					(send a message, assign a role, call a webhook, etc.).
				</li>
			</ul>
		</section>

		<!-- Automations -->
		<section id="automations">
			<h2>Automations</h2>
			<p>
				Automations let you respond to Discord events automatically. When a trigger event
				fires and your filters match, SpaceBot runs your configured actions.
			</p>
			<h3>How it works</h3>
			<ol>
				<li>
					<strong>Trigger</strong> — Choose one or more events (member join, message create,
					voice state change, reaction add, etc.).
				</li>
				<li>
					<strong>Filters</strong> — Narrow down when the automation fires (specific channel,
					role, keyword, etc.).
				</li>
				<li>
					<strong>Actions</strong> — Define what happens: send a message, add/remove roles,
					call a webhook, kick/ban, create a thread, and more.
				</li>
			</ol>
			<p>
				Automations are evaluated in order. You can enable or disable them individually and
				share them via import/export.
			</p>
		</section>

		<!-- Scheduled Events -->
		<section id="scheduled-events">
			<h2>Scheduled Events</h2>
			<p>
				Manage Discord scheduled events directly from the dashboard. Create, edit, and
				delete events that appear in your server's event list for members to RSVP.
			</p>
		</section>

		<!-- Event Logs -->
		<section id="event-logs">
			<h2>Event Logs</h2>
			<p>
				SpaceBot captures Discord events in real time and stores them in a searchable log.
				Use the log viewer to filter by event type, channel, user, or time range.
			</p>
			<h3>Logged events include</h3>
			<ul>
				<li>Member joins, leaves, bans, and unbans</li>
				<li>Message creates, edits, and deletes</li>
				<li>Voice channel joins, moves, and disconnects</li>
				<li>Role and channel updates</li>
				<li>Reaction adds and removes</li>
				<li>And many more</li>
			</ul>
		</section>

		<!-- Statistics -->
		<section id="statistics">
			<h2>Statistics</h2>
			<p>
				The statistics page shows time-series charts for member growth, message activity,
				voice usage, and other key metrics. Data is aggregated hourly and can be viewed over
				different time ranges.
			</p>
		</section>

		<!-- Integrations -->
		<section id="integrations">
			<h2>Integrations</h2>
			<p>
				Connect external services and plugins to your server. Integrations can add their own
				slash commands, receive lifecycle events, and interact with SpaceBot via a
				manifest-based protocol.
			</p>
			<h3>For integration developers</h3>
			<p>
				If you're building an integration, see the
				<a href="/docs/dev/integrations">Integration Protocol docs</a>
				for the full manifest spec, sync API, and webhook format.
			</p>
		</section>

		<!-- REST API -->
		<section id="api">
			<h2>REST API &amp; API Keys</h2>
			<p>
				SpaceBot exposes a versioned REST API for programmatic access. Generate scoped API
				keys from the dashboard to authenticate requests.
			</p>
			<h3>What you can do</h3>
			<ul>
				<li>Read and search event logs</li>
				<li>List, create, update, and delete automations and commands</li>
				<li>Query server statistics</li>
				<li>Manage scheduled events and integrations</li>
			</ul>
			<p>
				API keys are scoped per server and can be revoked at any time from the API Keys page
				in the dashboard.
			</p>
		</section>

		<!-- AI Assistant -->
		<section id="ai-assistant">
			<h2>AI Assistant</h2>
			<p>
				DM the bot or use the in-dashboard chat to interact with an AI assistant that
				understands your server context. It can answer questions about your configuration,
				help create automations, query stats, send messages, and manage scheduled events —
				all through natural language.
			</p>
		</section>

		<!-- Scheduled Messages -->
		<section id="scheduled-messages">
			<h2>Scheduled Messages</h2>
			<p>
				Set up messages to be sent to any channel at a specific date and time, or on a
				recurring schedule. Useful for announcements, reminders, and recurring updates.
			</p>
		</section>

		<!-- Button Actions -->
		<section id="button-actions">
			<h2>Button Actions</h2>
			<p>
				Attach interactive buttons to bot messages. When a user clicks a button, SpaceBot
				runs the configured action — assign a role, send an ephemeral response, open a link,
				and more.
			</p>
		</section>

		<!-- Server Settings -->
		<section id="server-settings">
			<h2>Server Settings</h2>
			<p>
				Configure server-level options like the timezone, log embed colors, and which
				features are enabled. Changes apply immediately and affect how the bot behaves in
				your server.
			</p>
		</section>

		<!-- Billing -->
		<section id="billing">
			<h2>Plans &amp; Billing</h2>
			<p>
				SpaceBot is free for servers with up to 9,000 members. Larger servers can upgrade to
				a paid plan, managed through the Account &amp; Billing page. Billing is handled
				securely via Stripe.
			</p>
		</section>
	</div>
</div>

<style>
	.docs-page {
		max-width: 740px;
		margin: 0 auto;
		padding: 2.5rem 1.25rem 4rem;
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

	/* Table of contents */
	.docs-toc {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem 1.5rem;
		margin-bottom: 2.5rem;
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
		columns: 2;
		column-gap: 2rem;
	}

	.docs-toc li {
		break-inside: avoid;
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

	@media (max-width: 540px) {
		.docs-toc ol {
			columns: 1;
		}
	}
</style>
