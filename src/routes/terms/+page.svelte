<script lang="ts">
	import LegalPage from '$lib/components/LegalPage.svelte';

	const toc = [
		{ id: 'acceptance', label: 'Acceptance of Terms' },
		{ id: 'eligibility', label: 'Eligibility' },
		{ id: 'description', label: 'Description of Service' },
		{ id: 'accounts', label: 'User Accounts & Authentication' },
		{ id: 'acceptable-use', label: 'Acceptable Use' },
		{ id: 'intellectual-property', label: 'User Content & Intellectual Property' },
		{ id: 'api-access', label: 'API Access' },
		{ id: 'availability', label: 'Service Availability & Modifications' },
		{ id: 'warranties', label: 'Disclaimer of Warranties' },
		{ id: 'liability', label: 'Limitation of Liability' },
		{ id: 'indemnification', label: 'Indemnification' },
		{ id: 'termination', label: 'Termination' },
		{ id: 'privacy', label: 'Privacy' },
		{ id: 'governing-law', label: 'Governing Law' },
		{ id: 'disputes', label: 'Dispute Resolution' },
		{ id: 'changes', label: 'Changes to Terms' },
		{ id: 'general', label: 'General Provisions' },
		{ id: 'contact', label: 'Contact' },
		{ id: 'changelog', label: 'Changelog' }
	];

	const versions = [
		{ version: '1.0', date: 'February 21, 2026', current: true }
	];

	const changelog = [
		{
			version: '1.0',
			date: 'February 21, 2026',
			changes: ['Initial terms of service']
		}
	];
</script>

<LegalPage
	title="Terms of Service"
	{toc}
	{versions}
	{changelog}
>
	<section>
		<h2 id="acceptance">1. Acceptance of Terms</h2>
		<p>
			By accessing or using SpaceBot ("the Service"), operated by Starspace Group ("Starspace",
			"we", "us", or "our"), you agree to be bound by these Terms of Service ("Terms"). If you
			do not agree to these Terms, you may not use the Service.
		</p>
		<p>
			These Terms incorporate by reference our
			<a href="/privacy">Privacy Policy</a>, which describes how we collect, use, and protect
			your information.
		</p>
	</section>

	<section>
		<h2 id="eligibility">2. Eligibility</h2>
		<p>
			You must meet the minimum age requirements set by Discord's
			<a href="https://discord.com/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
			to use SpaceBot. Generally, this means you must be at least 13 years old, or the minimum
			digital consent age in your country if higher (e.g., 16 in some EEA member states, 14 in
			South Korea). If you are under the applicable minimum age, you may not use the Service.
		</p>
		<p>
			By using the Service, you represent and warrant that you meet these eligibility requirements
			and that you have the legal capacity to enter into these Terms.
		</p>
	</section>

	<section>
		<h2 id="description">3. Description of Service</h2>
		<p>
			SpaceBot is a Discord bot platform that allows server administrators to create custom slash
			commands, build event-driven automations, view server analytics, and monitor Discord activity
			through a web-based admin dashboard. The Service operates as a Discord application and
			requires a Discord account to use.
		</p>
	</section>

	<section>
		<h2 id="accounts">4. User Accounts &amp; Authentication</h2>
		<p>
			You access SpaceBot by authenticating through Discord OAuth2. You are responsible for
			maintaining the security of your Discord account and are fully responsible for all
			activities that occur through your use of the Service. You must promptly notify us if
			you become aware of any unauthorized use of your account.
		</p>
		<p>
			We are not responsible for any loss or damage arising from your failure to secure your
			Discord account.
		</p>
	</section>

	<section>
		<h2 id="acceptable-use">5. Acceptable Use</h2>
		<p>You agree that you will not, and will not permit others to:</p>
		<ul>
			<li>Use the Service in any way that violates any applicable local, state, national, or international law or regulation</li>
			<li>Use the Service in violation of
				<a href="https://discord.com/terms" target="_blank" rel="noopener noreferrer">Discord's Terms of Service</a>,
				<a href="https://discord.com/guidelines" target="_blank" rel="noopener noreferrer">Community Guidelines</a>, or
				<a href="https://discord.com/developers/docs/policies-and-agreements/developer-policy" target="_blank" rel="noopener noreferrer">Developer Policy</a></li>
			<li>Attempt to gain unauthorized access to the Service, other users' accounts, or any related systems or networks</li>
			<li>Use the Service to send spam, unsolicited messages, or engage in any form of harassment</li>
			<li>Use the Service to distribute malware, phishing content, or other malicious material</li>
			<li>Interfere with or disrupt the integrity, performance, or availability of the Service</li>
			<li>Reverse-engineer, decompile, disassemble, or attempt to derive the source code of the Service, except where permitted by applicable law</li>
			<li>Use the Service to collect, store, or process personal data of other users in violation of applicable privacy laws</li>
			<li>Use the Service in any manner that could expose us, Discord, or other users to liability or harm</li>
			<li>Create automations or commands that violate any third party's intellectual property rights</li>
		</ul>
		<p>
			We reserve the right to investigate and take appropriate action, including suspension or
			termination of access, against anyone who violates these provisions.
		</p>
	</section>

	<section>
		<h2 id="intellectual-property">6. User Content &amp; Intellectual Property</h2>
		<h3>6.1 Your Content</h3>
		<p>
			You retain ownership of any content you create through the Service, including custom
			commands, automations, and configuration data ("User Content"). We do not claim
			ownership of your User Content.
		</p>
		<p>
			By using the Service, you grant us a limited, non-exclusive, royalty-free, worldwide
			license to store, process, display, and transmit your User Content solely as
			necessary to provide and operate the Service. This license terminates when you delete
			your User Content or remove SpaceBot from your server.
		</p>

		<h3>6.2 Our Intellectual Property</h3>
		<p>
			The Service, including its original code, design, features, and documentation, is owned
			by Starspace Group and is licensed under the terms specified in our
			<a href="https://github.com/starspacegroup/spacebot" target="_blank" rel="noopener noreferrer">GitHub repository</a>.
			These Terms do not grant you any rights to use our trademarks, logos, or branding without
			prior written consent.
		</p>

		<h3>6.3 Responsibility for User Content</h3>
		<p>
			You are solely responsible for your User Content and the consequences of using it through
			the Service. You represent and warrant that your User Content does not violate any
			applicable law, regulation, or third-party rights. We do not endorse or assume liability
			for any User Content.
		</p>
	</section>

	<section>
		<h2 id="api-access">7. API Access</h2>
		<p>
			The Service may provide API access for programmatic interaction. API keys are issued
			per-server and are the responsibility of the server administrator. You agree not to share
			API keys with unauthorized third parties and to revoke compromised keys immediately.
			We reserve the right to rate-limit, restrict, or revoke API access at any time.
		</p>
	</section>

	<section>
		<h2 id="availability">8. Service Availability &amp; Modifications</h2>
		<p>
			We strive to keep SpaceBot available and functioning reliably, but we do not guarantee
			uninterrupted, error-free, or secure access. The Service may be temporarily unavailable
			due to maintenance, updates, Discord API changes, or circumstances beyond our control.
		</p>
		<p>
			We reserve the right to modify, suspend, or discontinue any part of the Service at any
			time, with or without notice. We will make reasonable efforts to notify users of
			significant changes.
		</p>
	</section>

	<section>
		<h2 id="warranties">9. Disclaimer of Warranties</h2>
		<p>
			THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER
			EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY,
			FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT
			THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT DEFECTS WILL BE
			CORRECTED.
		</p>
		<p>
			SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OF CERTAIN WARRANTIES. IN SUCH
			JURISDICTIONS, THE ABOVE EXCLUSIONS SHALL APPLY TO THE FULLEST EXTENT PERMITTED BY
			APPLICABLE LAW.
		</p>
	</section>

	<section>
		<h2 id="liability">10. Limitation of Liability</h2>
		<p>
			TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL STARSPACE GROUP, ITS
			MEMBERS, CONTRIBUTORS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
			CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, USE, GOODWILL, OR
			OTHER INTANGIBLE LOSSES, RESULTING FROM:
		</p>
		<ul class="uppercase-list">
			<li>Your access to, use of, or inability to use the Service</li>
			<li>Any conduct or content of any third party on or through the Service</li>
			<li>Any User Content or automations created through the Service</li>
			<li>Unauthorized access to or alteration of your data or transmissions</li>
			<li>Any interruption, suspension, or termination of the Service</li>
		</ul>
		<p>
			SOME JURISDICTIONS DO NOT ALLOW THE LIMITATION OR EXCLUSION OF LIABILITY FOR INCIDENTAL
			OR CONSEQUENTIAL DAMAGES. IN SUCH JURISDICTIONS, OUR LIABILITY SHALL BE LIMITED TO THE
			FULLEST EXTENT PERMITTED BY LAW.
		</p>
	</section>

	<section>
		<h2 id="indemnification">11. Indemnification</h2>
		<p>
			You agree to indemnify, defend, and hold harmless Starspace Group and its members,
			contributors, and affiliates from and against any claims, liabilities, damages, losses,
			and expenses (including reasonable legal fees) arising out of or in any way connected
			with: (a) your use of the Service; (b) your violation of these Terms; (c) your violation
			of any third-party rights, including Discord's terms; or (d) your User Content.
		</p>
		<p>
			This indemnification obligation shall apply to the fullest extent permitted by applicable
			law. In jurisdictions where indemnification clauses are restricted, this section applies
			to the maximum extent allowed.
		</p>
	</section>

	<section>
		<h2 id="termination">12. Termination</h2>
		<p>
			We reserve the right to suspend or terminate your access to the Service at any time, with
			or without cause, and with or without notice. Grounds for termination include, but are not
			limited to, violation of these Terms, Discord's policies, or applicable law.
		</p>
		<p>
			You may stop using the Service at any time by removing SpaceBot from your Discord server
			and revoking OAuth2 access through your
			<a href="https://discord.com/settings/authorized-apps" target="_blank" rel="noopener noreferrer">Discord Authorized Apps settings</a>.
		</p>
		<p>
			Upon termination, your right to use the Service ceases immediately. Sections 6
			(Intellectual Property), 9 (Disclaimer), 10 (Limitation of Liability), 11
			(Indemnification), 14 (Governing Law), and 15 (Dispute Resolution) shall survive
			termination.
		</p>
	</section>

	<section>
		<h2 id="privacy">13. Privacy</h2>
		<p>
			Your use of the Service is also governed by our <a href="/privacy">Privacy Policy</a>,
			which describes how we collect, use, store, and protect your data. By using the Service,
			you consent to the practices described in the Privacy Policy.
		</p>
	</section>

	<section>
		<h2 id="governing-law">14. Governing Law</h2>
		<p>
			These Terms shall be governed by and construed in accordance with the laws of the United
			States, without regard to conflict of law principles.
		</p>
		<p>
			Nothing in these Terms shall affect any mandatory consumer protection rights you may have
			under the laws of your jurisdiction. If you are a consumer in the European Union, United
			Kingdom, or any other jurisdiction with mandatory consumer protection laws, those laws
			shall apply to the extent required.
		</p>
	</section>

	<section>
		<h2 id="disputes">15. Dispute Resolution</h2>
		<p>
			In the event of any dispute arising out of or relating to these Terms or the Service, the
			parties agree to first attempt to resolve the dispute informally by contacting us. If the
			dispute cannot be resolved informally within 30 days, either party may pursue the remedies
			available under applicable law.
		</p>
		<p>
			If you are a consumer in the European Union, you may also be entitled to submit a dispute
			to the
			<a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">EU Online Dispute Resolution platform</a>.
		</p>
	</section>

	<section>
		<h2 id="changes">16. Changes to Terms</h2>
		<p>
			We may update these Terms from time to time. We will notify users of material changes by
			updating the "Last updated" date at the top of this page, and we will make reasonable
			efforts to provide notice of significant changes through our GitHub repository or Discord
			support server. Your continued use of the Service after changes become effective
			constitutes your acceptance of the revised Terms.
		</p>
		<p>
			If you do not agree with the revised Terms, you must discontinue your use of the Service.
		</p>
	</section>

	<section>
		<h2 id="general">17. General Provisions</h2>
		<h3>17.1 Entire Agreement</h3>
		<p>
			These Terms, together with the Privacy Policy, constitute the entire agreement between you
			and Starspace Group regarding the Service and supersede all prior agreements and
			understandings.
		</p>

		<h3>17.2 Severability</h3>
		<p>
			If any provision of these Terms is found to be invalid, illegal, or unenforceable by a
			court of competent jurisdiction, that provision shall be modified to the minimum extent
			necessary to make it enforceable, or if modification is not possible, severed from these
			Terms. The remaining provisions shall continue in full force and effect.
		</p>

		<h3>17.3 Waiver</h3>
		<p>
			Our failure to enforce any right or provision of these Terms shall not constitute a waiver
			of that right or provision. Any waiver must be in writing and signed by us.
		</p>

		<h3>17.4 Assignment</h3>
		<p>
			You may not assign or transfer these Terms or your rights under them without our prior
			written consent. We may assign these Terms without restriction.
		</p>
	</section>

	<section>
		<h2 id="contact">18. Contact</h2>
		<p>
			If you have any questions about these Terms, please contact us via:
		</p>
		<ul>
			<li><strong>GitHub:</strong>
				<a href="https://github.com/starspacegroup/spacebot/issues" target="_blank" rel="noopener noreferrer">github.com/starspacegroup/spacebot/issues</a></li>
			<li><strong>Email:</strong>
				<a href="mailto:spacebot@starspace.group">spacebot@starspace.group</a></li>
		</ul>
	</section>
</LegalPage>
