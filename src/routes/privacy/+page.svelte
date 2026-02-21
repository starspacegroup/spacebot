<svelte:head>
	<title>Privacy Policy – SpaceBot</title>
	<meta name="description" content="SpaceBot Privacy Policy" />
</svelte:head>

<div class="legal-page">
	<h1>Privacy Policy</h1>
	<p class="last-updated">Last updated: February 21, 2026</p>

	<section>
		<h2>1. Introduction</h2>
		<p>
			This Privacy Policy describes how SpaceBot ("we", "us", or "the Service") collects, uses,
			and protects information when you use our Discord bot platform.
		</p>
	</section>

	<section>
		<h2>2. Information We Collect</h2>
		<h3>Information from Discord</h3>
		<p>When you log in via Discord OAuth2, we receive:</p>
		<ul>
			<li>Your Discord user ID, username, and avatar</li>
			<li>A list of servers (guilds) you have administrative access to</li>
		</ul>

		<h3>Discord Server Data</h3>
		<p>When SpaceBot is active in your server, we may process:</p>
		<ul>
			<li>Server (guild) metadata such as name, ID, and member count</li>
			<li>Event data (e.g. message events, member joins/leaves) as configured by your automations</li>
			<li>Command usage and interaction data</li>
		</ul>

		<h3>Log &amp; Analytics Data</h3>
		<p>
			We store event logs, server statistics, and command execution records to power the admin
			dashboard and automation engine.
		</p>
	</section>

	<section>
		<h2>3. How We Use Your Information</h2>
		<p>We use collected information to:</p>
		<ul>
			<li>Authenticate you and display your admin dashboard</li>
			<li>Execute automations and custom commands you configure</li>
			<li>Display server statistics and event logs</li>
			<li>Improve and maintain the Service</li>
		</ul>
	</section>

	<section>
		<h2>4. Data Storage &amp; Security</h2>
		<p>
			Data is stored in Cloudflare D1 databases. We implement reasonable security measures to
			protect your data, including encrypted connections and access controls. However, no method of
			electronic storage is 100% secure.
		</p>
	</section>

	<section>
		<h2>5. Data Sharing</h2>
		<p>
			We do not sell, rent, or share your personal information with third parties, except as
			necessary to provide the Service (e.g. communicating with Discord's API).
		</p>
	</section>

	<section>
		<h2>6. Data Retention</h2>
		<p>
			We retain your data for as long as your account is active or as needed to provide the Service.
			Event logs and statistics may be aggregated and retained for analytics purposes. You may
			request deletion of your data at any time.
		</p>
	</section>

	<section>
		<h2>7. Your Rights</h2>
		<p>You have the right to:</p>
		<ul>
			<li>Access the personal data we hold about you</li>
			<li>Request correction or deletion of your data</li>
			<li>Remove SpaceBot from your server to stop further data collection</li>
			<li>Revoke SpaceBot's OAuth2 access through your Discord account settings</li>
		</ul>
	</section>

	<section>
		<h2>8. Cookies</h2>
		<p>
			We use session cookies to keep you logged in. We do not use tracking cookies or third-party
			analytics cookies.
		</p>
	</section>

	<section>
		<h2>9. Children's Privacy</h2>
		<p>
			The Service is not intended for users under the age of 13 (or the minimum age required by
			Discord's Terms of Service in your jurisdiction). We do not knowingly collect information from
			children.
		</p>
	</section>

	<section>
		<h2>10. Changes to This Policy</h2>
		<p>
			We may update this Privacy Policy from time to time. We will notify users of material changes
			by updating the "Last updated" date above.
		</p>
	</section>

	<section>
		<h2>11. Contact</h2>
		<p>
			If you have questions or concerns about this Privacy Policy, please reach out via our
			<a href="https://github.com/starspacegroup/spacebot" target="_blank" rel="noopener noreferrer">GitHub repository</a>.
		</p>
	</section>
</div>

<style>
	.legal-page {
		max-width: 740px;
		margin: 0 auto;
		padding: 2.5rem 1.25rem 4rem;
	}

	h1 {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}

	.last-updated {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin-bottom: 2rem;
	}

	section {
		margin-bottom: 1.75rem;
	}

	h2 {
		font-size: 1.15rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	h3 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
		margin-top: 0.75rem;
		margin-bottom: 0.35rem;
	}

	p, li {
		color: var(--color-text-secondary);
		line-height: 1.7;
		font-size: 0.95rem;
	}

	ul {
		padding-left: 1.5rem;
		margin-top: 0.5rem;
	}

	li {
		margin-bottom: 0.35rem;
	}

	a {
		color: var(--color-primary);
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}
</style>
