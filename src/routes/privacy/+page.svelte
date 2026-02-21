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
			This Privacy Policy describes how Starspace Group ("Starspace", "we", "us", or "our"),
			the operator of SpaceBot ("the Service"), collects, uses, stores, and protects information
			when you use our Discord bot platform and associated web dashboard. By using the Service,
			you acknowledge that you have read and understood this Privacy Policy.
		</p>
		<p>
			SpaceBot operates as a Discord application subject to
			<a href="https://discord.com/developers/docs/policies-and-agreements/developer-terms-of-service" target="_blank" rel="noopener noreferrer">Discord's Developer Terms of Service</a> and
			<a href="https://discord.com/developers/docs/policies-and-agreements/developer-policy" target="_blank" rel="noopener noreferrer">Discord's Developer Policy</a>.
			We encourage you to also review
			<a href="https://discord.com/privacy" target="_blank" rel="noopener noreferrer">Discord's Privacy Policy</a>
			to understand how Discord collects and processes your data.
		</p>
	</section>

	<section>
		<h2>2. Data Controller</h2>
		<p>
			Starspace Group is the data controller responsible for the personal data processed through
			the Service. For privacy inquiries, you may contact us via the methods described in the
			Contact section below.
		</p>
	</section>

	<section>
		<h2>3. Information We Collect</h2>

		<h3>3.1 Information from Discord OAuth2</h3>
		<p>When you log in via Discord OAuth2, we request the following scopes and receive:</p>
		<ul>
			<li><strong>identify</strong> &mdash; Your Discord user ID, username, display name, avatar, and discriminator</li>
			<li><strong>guilds</strong> &mdash; A list of Discord servers (guilds) you are a member of, including your permissions in each</li>
		</ul>
		<p>
			We do not request or receive your email address, password, or private messages through
			Discord OAuth2.
		</p>

		<h3>3.2 Discord Server Data</h3>
		<p>When SpaceBot is installed and active in a Discord server, we may process:</p>
		<ul>
			<li>Server (guild) metadata: server ID, name, icon, member count, channel count, role count, emoji count, boost count, and boost level</li>
			<li>Event metadata: event types (e.g., member join/leave, role updates, channel changes), actor IDs, actor usernames, target IDs, target names, channel IDs, and channel names</li>
			<li>Command usage and interaction data (slash commands, context menu interactions)</li>
			<li>Member role assignments for permission checking</li>
		</ul>
		<p>
			<strong>We do not read or store message content.</strong> SpaceBot does not use the
			Discord MESSAGE_CONTENT privileged intent. Event logs capture metadata about events (such
			as the fact that a message was sent), but not the content of messages.
		</p>

		<h3>3.3 Server Statistics</h3>
		<p>
			We periodically record aggregated server statistics (member counts, channel counts, role
			counts, boost levels) to provide historical analytics in the admin dashboard. These
			statistics are associated with server IDs, not individual users.
		</p>

		<h3>3.4 Automations &amp; Custom Commands</h3>
		<p>
			Server administrators may create automations and custom commands through the dashboard.
			These configurations (trigger conditions, action definitions, response templates) are
			stored in association with the server ID.
		</p>

		<h3>3.5 AI Interactions</h3>
		<p>
			If your server uses SpaceBot's AI chat features, conversation messages sent to the bot are
			processed via Cloudflare Workers AI. These messages are processed in real time and are not
			persistently stored by us beyond the duration of the conversation session.
		</p>

		<h3>3.6 Cookies</h3>
		<p>We use strictly necessary first-party cookies to maintain your authenticated session:</p>
		<ul>
			<li><strong>discord_user_id</strong> &mdash; Your Discord user ID</li>
			<li><strong>discord_username</strong> &mdash; Your Discord username</li>
			<li><strong>discord_global_name</strong> &mdash; Your Discord display name</li>
			<li><strong>discord_avatar</strong> &mdash; Your Discord avatar hash</li>
			<li><strong>discord_discriminator</strong> &mdash; Your Discord discriminator</li>
			<li><strong>discord_access_token</strong> &mdash; Your OAuth2 access token (used to communicate with Discord's API on your behalf)</li>
		</ul>
		<p>
			These cookies expire after 7 days and are essential for the Service to function. We do not
			use tracking cookies, advertising cookies, or third-party analytics cookies.
		</p>

		<h3>3.7 API Keys</h3>
		<p>
			Server administrators may generate API keys for programmatic access. These keys are stored
			securely and are associated with the server and the user who created them.
		</p>
	</section>

	<section>
		<h2>4. Legal Basis for Processing (GDPR)</h2>
		<p>If you are located in the European Economic Area (EEA), United Kingdom, or Switzerland, we process your personal data on the following legal bases:</p>
		<ul>
			<li><strong>Contract performance (Art. 6(1)(b) GDPR)</strong> &mdash; Processing necessary to provide the Service you have requested, including authentication and dashboard functionality</li>
			<li><strong>Legitimate interests (Art. 6(1)(f) GDPR)</strong> &mdash; Processing necessary for our legitimate interests in operating, maintaining, and improving the Service, provided these interests are not overridden by your rights</li>
			<li><strong>Consent (Art. 6(1)(a) GDPR)</strong> &mdash; Where you have given consent, such as when authorizing SpaceBot via Discord OAuth2. You may withdraw consent at any time by revoking SpaceBot's access through your Discord account settings</li>
		</ul>
	</section>

	<section>
		<h2>5. How We Use Your Information</h2>
		<p>We use the information we collect to:</p>
		<ul>
			<li>Authenticate you and authorize access to your admin dashboard</li>
			<li>Execute automations, custom commands, and webhooks you configure</li>
			<li>Display server statistics, event logs, and analytics</li>
			<li>Enforce permission controls within the Service</li>
			<li>Process AI chat interactions when you use that feature</li>
			<li>Maintain, protect, and improve the Service</li>
			<li>Comply with legal obligations</li>
		</ul>
	</section>

	<section>
		<h2>6. Data Sharing &amp; Third-Party Services</h2>
		<p>
			We do <strong>not</strong> sell, rent, trade, or otherwise share your personal information
			with third parties for their marketing purposes.
		</p>
		<p>We share data only with the following categories of service providers, strictly as necessary to operate the Service:</p>
		<ul>
			<li><strong>Discord</strong> &mdash; We communicate with
				<a href="https://discord.com/developers/docs/intro" target="_blank" rel="noopener noreferrer">Discord's API</a>
				to authenticate users, retrieve server data, and perform bot actions. Your data shared with Discord is governed by
				<a href="https://discord.com/privacy" target="_blank" rel="noopener noreferrer">Discord's Privacy Policy</a>.</li>
			<li><strong>Cloudflare</strong> &mdash; The Service is hosted on Cloudflare's infrastructure (Cloudflare Workers/Pages and D1 databases). Data processed through Cloudflare is subject to
				<a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare's Privacy Policy</a>.</li>
			<li><strong>Cloudflare Workers AI</strong> &mdash; If you use AI chat features, conversation data is processed through Cloudflare's AI inference services.</li>
		</ul>
		<p>
			We may also disclose information if required by law, regulation, legal process, or
			governmental request, or to protect the rights, property, or safety of us, our users,
			or the public.
		</p>
	</section>

	<section>
		<h2>7. International Data Transfers</h2>
		<p>
			The Service is hosted on Cloudflare's global network. Your data may be processed in
			countries other than your country of residence, including the United States and other
			jurisdictions where Cloudflare operates edge nodes. Where data is transferred outside the
			EEA, UK, or Switzerland, we rely on Cloudflare's data processing agreements and appropriate
			safeguards, including Standard Contractual Clauses (SCCs) where applicable, to ensure
			adequate protection of your data.
		</p>
	</section>

	<section>
		<h2>8. Data Retention</h2>
		<ul>
			<li><strong>Authentication data</strong> &mdash; Session cookies expire after 7 days. OAuth2 tokens are not stored server-side beyond the cookie.</li>
			<li><strong>Event logs</strong> &mdash; Retained for as long as the server remains active on the Service. Server administrators may request deletion.</li>
			<li><strong>Server statistics</strong> &mdash; Historical statistics are retained for as long as the server remains active. Aggregated statistics may be retained indefinitely.</li>
			<li><strong>Automations &amp; commands</strong> &mdash; Retained until deleted by the server administrator or until the bot is removed from the server.</li>
			<li><strong>API keys</strong> &mdash; Retained until revoked by the server administrator or until the bot is removed.</li>
		</ul>
		<p>
			When SpaceBot is removed from a server, server administrators may request complete
			deletion of all associated data. We will process such requests within 30 days.
		</p>
	</section>

	<section>
		<h2>9. Data Storage &amp; Security</h2>
		<p>
			Data is stored in Cloudflare D1 databases with encryption at rest and in transit. We
			implement reasonable technical and organizational security measures including:
		</p>
		<ul>
			<li>Encrypted connections (HTTPS/TLS) for all data in transit</li>
			<li>Access controls and authentication for the admin dashboard</li>
			<li>Role-based permission checks for server data access</li>
			<li>Secure cookie attributes (HttpOnly, SameSite) for session management</li>
		</ul>
		<p>
			Despite these measures, no method of electronic transmission or storage is 100%
			secure. We cannot guarantee absolute security of your data.
		</p>
	</section>

	<section>
		<h2>10. Your Rights</h2>

		<h3>10.1 General Rights (All Users)</h3>
		<p>Regardless of your location, you have the right to:</p>
		<ul>
			<li>Access the personal data we hold about you</li>
			<li>Request correction of inaccurate data</li>
			<li>Request deletion of your data</li>
			<li>Remove SpaceBot from your server to stop further data collection</li>
			<li>Revoke SpaceBot's OAuth2 access through your
				<a href="https://discord.com/settings/authorized-apps" target="_blank" rel="noopener noreferrer">Discord Authorized Apps settings</a></li>
		</ul>

		<h3>10.2 European Economic Area, UK &amp; Switzerland (GDPR/UK GDPR)</h3>
		<p>If you are located in the EEA, UK, or Switzerland, you additionally have the right to:</p>
		<ul>
			<li><strong>Data portability</strong> &mdash; Receive your personal data in a structured, commonly used, machine-readable format</li>
			<li><strong>Restriction of processing</strong> &mdash; Request that we restrict processing of your personal data under certain circumstances</li>
			<li><strong>Object to processing</strong> &mdash; Object to processing based on legitimate interests</li>
			<li><strong>Withdraw consent</strong> &mdash; Where processing is based on consent, withdraw that consent at any time without affecting the lawfulness of prior processing</li>
			<li><strong>Lodge a complaint</strong> &mdash; File a complaint with your local data protection supervisory authority</li>
		</ul>

		<h3>10.3 California Residents (CCPA/CPRA)</h3>
		<p>If you are a California resident, you have the right to:</p>
		<ul>
			<li><strong>Know</strong> &mdash; Request disclosure of the categories and specific pieces of personal information we have collected about you</li>
			<li><strong>Delete</strong> &mdash; Request deletion of your personal information</li>
			<li><strong>Opt-out of sale</strong> &mdash; We do not sell your personal information. We do not share your personal information for cross-context behavioral advertising.</li>
			<li><strong>Non-discrimination</strong> &mdash; We will not discriminate against you for exercising your privacy rights</li>
		</ul>

		<h3>10.4 Brazil (LGPD)</h3>
		<p>If you are located in Brazil, you have the right to:</p>
		<ul>
			<li>Confirm the existence of processing of your data</li>
			<li>Access, correct, or anonymize your data</li>
			<li>Request data portability</li>
			<li>Request deletion of data processed with your consent</li>
			<li>Obtain information about public and private entities with which your data has been shared</li>
			<li>Revoke consent at any time</li>
		</ul>

		<h3>10.5 Other Jurisdictions</h3>
		<p>
			If you are located in another jurisdiction that grants specific privacy rights (including
			but not limited to Canada under PIPEDA, Australia under the Privacy Act, Japan under APPI,
			South Korea under PIPA, or other applicable laws), we will respect those rights to the
			extent required by applicable law. Please contact us to exercise your rights.
		</p>

		<h3>10.6 Exercising Your Rights</h3>
		<p>
			To exercise any of the above rights, please contact us using the methods in the Contact
			section below. We will respond to verified requests within 30 days (or the applicable
			timeframe required by your local law). We may ask you to verify your identity before
			processing your request.
		</p>
	</section>

	<section>
		<h2>11. Automated Decision-Making</h2>
		<p>
			The Service uses automated processing to execute automations and commands configured by
			server administrators (e.g., auto-moderation rules, event-triggered actions). These
			automated processes operate based on rules explicitly set by server administrators and do
			not involve profiling or automated decision-making that produces legal effects or similarly
			significant effects on individuals.
		</p>
	</section>

	<section>
		<h2>12. Children's Privacy</h2>
		<p>
			The Service is not directed at, and we do not knowingly collect personal information from,
			children under the age of 13 (or the minimum age required in your jurisdiction). This aligns
			with Discord's own age requirements. In the European Economic Area, the minimum age is 16
			(or lower if your member state has set a lower age, but no lower than 13). In South Korea,
			the minimum age is 14.
		</p>
		<p>
			If we become aware that we have collected personal data from a child below the applicable
			minimum age without verified parental consent, we will take steps to delete that
			information promptly. If you believe we have collected data from a child, please contact us
			immediately.
		</p>
	</section>

	<section>
		<h2>13. Do Not Track</h2>
		<p>
			We do not track users across third-party websites. The Service does not respond to "Do Not
			Track" (DNT) browser signals because we do not engage in the type of cross-site tracking
			that such signals are designed to prevent.
		</p>
	</section>

	<section>
		<h2>14. Changes to This Policy</h2>
		<p>
			We may update this Privacy Policy from time to time. We will notify users of material
			changes by updating the "Last updated" date at the top of this page. For significant
			changes, we will make reasonable efforts to provide additional notice (such as via
			our GitHub repository or Discord support server). Your continued use of the Service
			after changes become effective constitutes your acceptance of the revised policy.
		</p>
	</section>

	<section>
		<h2>15. Contact</h2>
		<p>
			If you have questions, concerns, or requests regarding this Privacy Policy or our data
			practices, please contact us via:
		</p>
		<ul>
			<li><strong>GitHub:</strong>
				<a href="https://github.com/starspacegroup/spacebot/issues" target="_blank" rel="noopener noreferrer">github.com/starspacegroup/spacebot/issues</a></li>
			<li><strong>Email:</strong>
				<a href="mailto:privacy@starspace.group">privacy@starspace.group</a></li>
		</ul>
		<p>
			For users in the EEA, UK, or Switzerland, you also have the right to lodge a complaint
			with your local data protection supervisory authority.
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
