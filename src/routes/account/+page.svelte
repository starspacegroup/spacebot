<script lang="ts">
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { getAvatarUrl } from '$lib/utils/avatar.js';
	import { toast } from '$lib/toast.svelte.js';
	import { getTranslator, getLocale } from '$lib/i18n.js';

	const tr = getTranslator();
	const dateLocale = getLocale() === 'es' ? 'es-ES' : 'en-US';

	const { data } = $props();

	let portalLoading = $state(null);

	// Active section for navigation
	let activeSection = $state('profile');

	const dbUser = $derived(data.dbUser);
	const user = $derived(data.user);
	const serverPlans = $derived(data.serverPlans || []);
	const planTiers = $derived(data.planTiers);
	const aiJobSummary = $derived(
		data.aiJobSummary || {
			total: 0,
			pending: 0,
			running: 0,
			completed: 0,
			failed_terminal: 0,
			canceled: 0,
			latest: null,
		}
	);

	// Billing summary
	const totalServers = $derived(serverPlans.length);
	const proServers = $derived(serverPlans.filter((s) => s.plan === 'pro').length);
	const starterServers = $derived(serverPlans.filter((s) => s.plan === 'free').length);
	const totalMonthlySpend = $derived(
		serverPlans
			.filter((s) => s.stripeSubscriptionId) // Only count paid subscriptions
			.reduce((sum, s) => sum + (s.priceCents || 0), 0)
	);

	// Servers with active Stripe billing (have a customer ID)
	const serversWithBilling = $derived(serverPlans.filter((s) => s.stripeCustomerId));

	const activeBillingSubscriptions = $derived(
		serversWithBilling.filter((s) => s.stripeSubscriptionId)
	);

	function formatDate(dateStr) {
		if (!dateStr) return tr('account.na');
		return new Date(dateStr).toLocaleDateString(dateLocale, {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		});
	}

	function formatPrice(cents) {
		if (!cents) return tr('account.starter');
		return `$${(cents / 100).toFixed(2)}`;
	}

	function getStatusBadgeClass(plan, stripeStatus, stripeSubscriptionId?) {
		if (
			plan === 'pro' &&
			!stripeSubscriptionId &&
			!['active', 'trialing'].includes(stripeStatus)
		)
			return 'badge-admin';
		if (plan === 'pro' && ['active', 'trialing'].includes(stripeStatus)) return 'badge-success';
		if (stripeStatus === 'canceling') return 'badge-warning';
		if (stripeStatus === 'past_due') return 'badge-danger';
		return 'badge-neutral';
	}

	function getStatusLabel(plan, stripeStatus, stripeSubscriptionId?) {
		if (
			plan === 'pro' &&
			!stripeSubscriptionId &&
			!['active', 'trialing'].includes(stripeStatus)
		)
			return tr('account.status.adminGranted');
		if (plan === 'pro' && ['active', 'trialing'].includes(stripeStatus))
			return tr('account.status.active');
		if (stripeStatus === 'canceling') return tr('account.status.canceling');
		if (stripeStatus === 'past_due') return tr('account.status.pastDue');
		if (plan === 'pro') return tr('account.pro');
		return tr('account.starter');
	}

	// Aggregate billing history from all servers, sorted by date (newest first)
	const allBillingHistory = $derived(
		serverPlans
			.flatMap((s) =>
				(s.recentBilling || []).map((e) => ({
					...e,
					guildName: s.guildName,
					guildIcon: s.guildIcon,
					guildId: s.guildId,
				}))
			)
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
	);

	function getEventIcon(eventType) {
		switch (eventType) {
			case 'checkout_completed':
				return '🎉';
			case 'plan_upgrade':
				return '⬆️';
			case 'plan_downgrade':
				return '⬇️';
			case 'admin_edit':
				return '🔧';
			case 'payment_success':
				return '✅';
			case 'payment_failed':
				return '❌';
			case 'subscription_canceled':
				return '⏸️';
			case 'subscription_reactivated':
				return '▶️';
			case 'subscription_renewed':
				return '🔄';
			case 'plan_reset':
				return '↩️';
			default:
				return '📋';
		}
	}

	function getEventLabel(eventType) {
		switch (eventType) {
			case 'checkout_completed':
				return tr('account.event.upgrade');
			case 'plan_upgrade':
				return tr('account.event.planUpgrade');
			case 'plan_downgrade':
				return tr('account.event.downgrade');
			case 'admin_edit':
				return tr('account.event.adminEdit');
			case 'payment_success':
				return tr('account.event.payment');
			case 'payment_failed':
				return tr('account.event.paymentFailed');
			case 'subscription_canceled':
				return tr('account.event.canceled');
			case 'subscription_reactivated':
				return tr('account.event.reactivated');
			case 'subscription_renewed':
				return tr('account.event.renewed');
			case 'plan_reset':
				return tr('account.event.planReset');
			default:
				return tr('account.event.generic');
		}
	}

	function getEventDotClass(eventType) {
		switch (eventType) {
			case 'checkout_completed':
			case 'plan_upgrade':
			case 'payment_success':
			case 'subscription_renewed':
				return 'dot-success';
			case 'payment_failed':
			case 'plan_downgrade':
				return 'dot-danger';
			case 'subscription_canceled':
				return 'dot-warning';
			case 'admin_edit':
			case 'plan_reset':
				return 'dot-admin';
			case 'subscription_reactivated':
				return 'dot-info';
			default:
				return 'dot-neutral';
		}
	}

	function formatDateTime(dateStr) {
		if (!dateStr) return tr('account.na');
		return new Date(dateStr).toLocaleDateString(dateLocale, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	}

	function formatAIJobStatus(status) {
		switch (status) {
			case 'pending':
				return { label: tr('account.job.queued'), cls: 'badge-neutral' };
			case 'running':
				return { label: tr('account.job.running'), cls: 'badge-info' };
			case 'completed':
				return { label: tr('account.job.completed'), cls: 'badge-success' };
			case 'failed_terminal':
				return { label: tr('account.job.failed'), cls: 'badge-danger' };
			case 'canceled':
				return { label: tr('account.job.canceled'), cls: 'badge-warning' };
			default:
				return { label: status || tr('account.job.unknown'), cls: 'badge-neutral' };
		}
	}

	function getBillingReturnUrl() {
		if (typeof window === 'undefined') return '/account';
		const url = new URL(window.location.href);
		url.search = '';
		url.hash = '';
		return url.toString();
	}

	async function openBillingPortal(guildId, guildName) {
		portalLoading = guildId;
		try {
			const res = await fetch('/api/billing', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'portal',
					guildId,
					guildName,
					returnUrl: getBillingReturnUrl(),
				}),
			});

			const result = await res.json().catch(() => ({}));

			if (!res.ok) {
				toast.error(result.error || tr('account.toast.portalError'));
				return;
			}

			if (result.url) {
				window.location.href = result.url;
				return;
			}

			toast.error(tr('account.toast.portalUnavailable'));
		} catch {
			toast.error(tr('account.toast.portalFailed'));
		} finally {
			portalLoading = null;
		}
	}

	function scrollToSection(section) {
		activeSection = section;
		const el = document.getElementById(`section-${section}`);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}
</script>

<svelte:head>
	<title>{tr('account.metaTitle')}</title>
</svelte:head>

<div class="account-page">
	<header class="page-header">
		<a
			href={data.selectedGuildId ? `/admin/${data.selectedGuildId}` : '/admin'}
			class="back-link">{tr('account.backToDashboard')}</a
		>
		<div class="header-content">
			<h1>
				<span class="header-icon">👤</span>
				{tr('account.title')}
			</h1>
			<p class="header-desc">{tr('account.headerDesc')}</p>
		</div>
	</header>

	<!-- Section Navigation -->
	<nav class="section-nav">
		<button
			class="section-nav-item"
			class:active={activeSection === 'profile'}
			onclick={() => scrollToSection('profile')}
		>
			<span class="nav-icon">👤</span>
			{tr('account.nav.profile')}
		</button>
		<button
			class="section-nav-item"
			class:active={activeSection === 'billing'}
			onclick={() => scrollToSection('billing')}
		>
			<span class="nav-icon">💳</span>
			{tr('account.nav.billing')}
		</button>
		<button
			class="section-nav-item"
			class:active={activeSection === 'payment'}
			onclick={() => scrollToSection('payment')}
		>
			<span class="nav-icon">💰</span>
			{tr('account.nav.payment')}
		</button>
		<a class="section-nav-item" href="/account/ai-workflows">
			<span class="nav-icon">🧭</span>
			{tr('account.nav.aiWorkflows')}
		</a>
		<a class="section-nav-item" href="/account/runners">
			<span class="nav-icon">🖥️</span>
			{tr('account.nav.localRunner')}
		</a>
		<button
			class="section-nav-item"
			class:active={activeSection === 'settings'}
			onclick={() => scrollToSection('settings')}
		>
			<span class="nav-icon">⚙️</span>
			{tr('account.nav.settings')}
		</button>
	</nav>

	<!-- Profile Section -->
	<section id="section-profile" class="content-section">
		<h2><span class="section-icon">👤</span> {tr('account.profile.heading')}</h2>

		<div class="profile-card">
			<div class="profile-header">
				<img
					src={getAvatarUrl(user.id, user.avatar, user.discriminator)}
					alt="{user.username}'s avatar"
					class="profile-avatar"
				/>
				<div class="profile-identity">
					<h3 class="profile-display-name">{user.globalName || user.username}</h3>
					{#if user.globalName && user.globalName !== user.username}
						<span class="profile-username">@{user.username}</span>
					{/if}
					<span class="profile-id">ID: {user.id}</span>
				</div>
			</div>

			<div class="profile-details">
				<div class="detail-grid">
					{#if dbUser?.email}
						<div class="detail-item">
							<span class="detail-label">{tr('account.profile.email')}</span>
							<span class="detail-value">{dbUser.email}</span>
						</div>
					{/if}
					<div class="detail-item">
						<span class="detail-label">{tr('account.profile.memberSince')}</span>
						<span class="detail-value">{formatDate(dbUser?.created_at)}</span>
					</div>
					<div class="detail-item">
						<span class="detail-label">{tr('account.profile.lastLogin')}</span>
						<span class="detail-value">{formatDate(dbUser?.last_login_at)}</span>
					</div>
					<div class="detail-item">
						<span class="detail-label">{tr('account.profile.loginCount')}</span>
						<span class="detail-value">{dbUser?.login_count || 0}</span>
					</div>
				</div>
			</div>

			{#if data.isSuperAdmin}
				<div class="profile-badge superadmin-badge">
					<span class="badge-icon">👑</span>
					<span>{tr('account.profile.superadmin')}</span>
				</div>
			{/if}
		</div>

		<div class="servers-summary">
			<h3>{tr('account.servers.heading')}</h3>
			<div class="server-stats-row">
				<div class="stat-chip">
					<span class="stat-value">{totalServers}</span>
					<span class="stat-label">{tr('account.total')}</span>
				</div>
				<div class="stat-chip pro">
					<span class="stat-value">{proServers}</span>
					<span class="stat-label">{tr('account.pro')}</span>
				</div>
				<div class="stat-chip starter">
					<span class="stat-value">{starterServers}</span>
					<span class="stat-label">{tr('account.starter')}</span>
				</div>
			</div>
		</div>

		<div class="autopilot-summary">
			<div class="autopilot-summary-header">
				<h3>{tr('account.autopilot.heading')}</h3>
				<a class="btn btn-outline btn-sm" href="/account/ai-jobs"
					>{tr('account.autopilot.openJobs')}</a
				>
			</div>
			<div class="server-stats-row">
				<div class="stat-chip">
					<span class="stat-value">{aiJobSummary.total}</span>
					<span class="stat-label">{tr('account.total')}</span>
				</div>
				<div class="stat-chip">
					<span class="stat-value">{aiJobSummary.pending + aiJobSummary.running}</span>
					<span class="stat-label">{tr('account.active')}</span>
				</div>
				<div class="stat-chip pro">
					<span class="stat-value">{aiJobSummary.completed}</span>
					<span class="stat-label">{tr('account.completed')}</span>
				</div>
				<div class="stat-chip">
					<span class="stat-value">{aiJobSummary.failed_terminal}</span>
					<span class="stat-label">{tr('account.failed')}</span>
				</div>
			</div>

			{#if aiJobSummary.latest}
				{@const latestState = formatAIJobStatus(aiJobSummary.latest.status)}
				<div class="autopilot-latest">
					<div class="autopilot-latest-main">
						<div class="autopilot-latest-row">
							<strong>{tr('account.autopilot.latestJob')}</strong>
							<span class="status-badge {latestState.cls}">{latestState.label}</span>
						</div>
						<div class="autopilot-latest-meta mono">
							{aiJobSummary.latest.correlationId}
						</div>
						<div class="autopilot-latest-meta">
							{aiJobSummary.latest.requestText?.slice(0, 140)}
						</div>
						<div class="autopilot-latest-meta">
							{tr('account.autopilot.attempts', {
								count: aiJobSummary.latest.attemptCount,
								max: aiJobSummary.latest.maxAttempts,
								date: formatDateTime(aiJobSummary.latest.updatedAt),
							})}
						</div>
					</div>
					<a
						class="btn btn-sm btn-outline"
						href={`/api/ai/jobs/${aiJobSummary.latest.id}`}
						target="_blank"
						rel="noreferrer">{tr('account.autopilot.timelineJson')}</a
					>
				</div>
			{/if}
		</div>
	</section>

	<!-- Billing Section -->
	<section id="section-billing" class="content-section">
		<h2><span class="section-icon">💳</span> {tr('account.billing.heading')}</h2>

		{#if totalMonthlySpend > 0}
			<div class="billing-overview">
				<div class="billing-total">
					<span class="billing-total-label">{tr('account.billing.monthlySpend')}</span>
					<span class="billing-total-value"
						>{formatPrice(totalMonthlySpend)}<span class="billing-period"
							>{tr('account.perMonth')}</span
						></span
					>
				</div>
			</div>
		{/if}

		{#if serverPlans.length === 0}
			<div class="empty-state">
				<span class="empty-icon">📭</span>
				<p>{tr('account.billing.noServers')}</p>
			</div>
		{:else}
			<div class="server-plans-list">
				{#each serverPlans as server}
					<div class="server-plan-card">
						<div class="server-plan-header">
							<div class="server-plan-identity">
								{#if server.guildIcon}
									<img
										class="server-plan-icon"
										src="https://cdn.discordapp.com/icons/{server.guildId}/{server.guildIcon}.webp?size=48"
										alt={server.guildName}
									/>
								{:else}
									<div class="server-plan-icon-placeholder">
										{(server.guildName || 'S').charAt(0)}
									</div>
								{/if}
								<div class="server-plan-info">
									<span class="server-plan-name">{server.guildName}</span>
									<span class="server-plan-id">{server.guildId}</span>
								</div>
							</div>
							<div class="server-plan-status">
								<span class="plan-badge {server.plan}">
									{server.plan === 'pro'
										? tr('account.billing.proBadge')
										: tr('account.billing.starterBadge')}
								</span>
								{#if server.stripeStatus}
									<span
										class="status-badge {getStatusBadgeClass(
											server.plan,
											server.stripeStatus
										)}"
									>
										{getStatusLabel(server.plan, server.stripeStatus)}
									</span>
								{/if}
							</div>
						</div>

						{#if server.plan !== 'free'}
							<div class="server-plan-details">
								{#if server.plan === 'pro' && !server.stripeSubscriptionId}
									<div class="plan-detail">
										<span class="plan-detail-label"
											>{tr('account.billing.price')}</span
										>
										<span class="plan-detail-value admin-granted-price"
											>{tr('account.billing.grantedByAdmin')}</span
										>
									</div>
								{:else if server.priceCents}
									<div class="plan-detail">
										<span class="plan-detail-label"
											>{tr('account.billing.price')}</span
										>
										<span class="plan-detail-value"
											>{formatPrice(server.priceCents)}{tr(
												'account.perMonth'
											)}</span
										>
									</div>
								{/if}
								{#if server.stripeCurrentPeriodEnd}
									<div class="plan-detail">
										<span class="plan-detail-label"
											>{server.stripeStatus === 'canceling'
												? tr('account.billing.accessUntil')
												: tr('account.billing.nextBilling')}</span
										>
										<span class="plan-detail-value"
											>{formatDate(server.stripeCurrentPeriodEnd)}</span
										>
									</div>
								{/if}
							</div>
						{/if}

						<div class="server-plan-actions">
							<a
								href="/admin/{server.guildId}/account"
								class="btn btn-secondary btn-sm"
							>
								{tr('account.billing.manage')}
							</a>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if allBillingHistory.length > 0}
			<div class="billing-history">
				<h3>{tr('account.billing.historyHeading')}</h3>
				<div class="timeline">
					{#each allBillingHistory as event}
						<div class="timeline-item">
							<div class="timeline-dot {getEventDotClass(event.event_type)}"></div>
							<div class="timeline-content">
								<div class="timeline-header">
									<span class="timeline-icon"
										>{getEventIcon(event.event_type)}</span
									>
									<span class="timeline-label"
										>{getEventLabel(event.event_type)}</span
									>
									<span class="timeline-server">{event.guildName}</span>
								</div>
								{#if event.description}
									<p class="timeline-desc">{event.description}</p>
								{/if}
								<div class="timeline-meta">
									<span class="timeline-date"
										>{formatDateTime(event.created_at)}</span
									>
									{#if event.amount_cents}
										<span class="timeline-amount"
											>{formatPrice(event.amount_cents)}</span
										>
									{/if}
									{#if event.plan_before && event.plan_after}
										<span class="timeline-plan-change"
											>{event.plan_before} → {event.plan_after}</span
										>
									{/if}
									{#if event.actor_name}
										<span class="timeline-actor">
											{#if event.actor_id}
												<img
													src={getAvatarUrl(
														event.actor_id,
														event.actor_avatar,
														event.actor_discriminator,
														20
													)}
													alt="{event.actor_name}'s avatar"
													class="timeline-actor-avatar"
													onerror={(e) => {
														(e.target as HTMLElement).style.display =
															'none';
													}}
												/>
											{/if}
											{tr('account.billing.byActor', {
												name: event.actor_name,
											})}
										</span>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<div class="plan-comparison">
			<h3>{tr('account.plans.heading')}</h3>
			<div class="plan-table-wrapper">
				<table class="plan-table">
					<thead>
						<tr>
							<th>{tr('account.plans.feature')}</th>
							<th>{tr('account.starter')}</th>
							<th class="highlight">{tr('account.pro')}</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>{tr('account.plans.commands')}</td>
							<td>{planTiers.free.max_commands}</td>
							<td class="highlight">{tr('account.unlimited')}</td>
						</tr>
						<tr>
							<td>{tr('account.plans.automations')}</td>
							<td>{planTiers.free.max_automations}</td>
							<td class="highlight">{tr('account.unlimited')}</td>
						</tr>
						<tr>
							<td>{tr('account.plans.apiKeys')}</td>
							<td>{planTiers.free.max_api_keys}</td>
							<td class="highlight">{planTiers.pro.max_api_keys}</td>
						</tr>
						<tr>
							<td>{tr('account.plans.webhooks')}</td>
							<td>{planTiers.free.max_webhooks}</td>
							<td class="highlight">{planTiers.pro.max_webhooks}</td>
						</tr>
						<tr>
							<td>{tr('account.plans.logRetention')}</td>
							<td
								>{tr('account.days', {
									count: planTiers.free.log_retention_days,
								})}</td
							>
							<td class="highlight">{tr('account.unlimited')}</td>
						</tr>
						<tr>
							<td>{tr('account.plans.statsRetention')}</td>
							<td
								>{tr('account.days', {
									count: planTiers.free.stats_retention_days,
								})}</td
							>
							<td class="highlight">{tr('account.unlimited')}</td>
						</tr>
						<tr>
							<td>{tr('account.billing.price')}</td>
							<td>{tr('account.free')}</td>
							<td class="highlight"
								>{formatPrice(planTiers.pro.price_cents)}{tr(
									'account.perMonth'
								)}</td
							>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</section>

	<!-- Payment Methods Section -->
	<section id="section-payment" class="content-section">
		<h2><span class="section-icon">💳</span> {tr('account.payment.heading')}</h2>

		{#if serversWithBilling.length === 0}
			<div class="empty-state">
				<span class="empty-icon">💳</span>
				<p>{tr('account.payment.none')}</p>
			</div>
		{:else}
			<div class="payment-hero-card">
				<div class="payment-hero-main">
					<h3>{tr('account.payment.portalHeading')}</h3>
					<p>{tr('account.payment.portalDesc')}</p>
				</div>
				<div class="payment-hero-metrics">
					<div class="payment-metric">
						<span class="payment-metric-label"
							>{tr('account.payment.billingAccounts')}</span
						>
						<strong>{serversWithBilling.length}</strong>
					</div>
					<div class="payment-metric">
						<span class="payment-metric-label">{tr('account.payment.activeSubs')}</span>
						<strong>{activeBillingSubscriptions.length}</strong>
					</div>
					<div class="payment-metric">
						<span class="payment-metric-label"
							>{tr('account.payment.monthlyTotal')}</span
						>
						<strong>{formatPrice(totalMonthlySpend)}</strong>
					</div>
				</div>
			</div>

			<div class="billing-servers-grid">
				{#each serversWithBilling as server}
					<div class="billing-server-card">
						<div class="billing-server-header">
							<div class="subscription-info">
								{#if server.guildIcon}
									<img
										class="subscription-icon"
										src="https://cdn.discordapp.com/icons/{server.guildId}/{server.guildIcon}.webp?size=32"
										alt={server.guildName}
									/>
								{:else}
									<div class="subscription-icon-placeholder">
										{(server.guildName || 'S').charAt(0)}
									</div>
								{/if}
								<div class="billing-server-title-wrap">
									<span class="subscription-name">{server.guildName}</span>
									<span class="billing-server-id">{server.guildId}</span>
								</div>
							</div>
							<span
								class="status-badge {getStatusBadgeClass(
									server.plan,
									server.stripeStatus,
									server.stripeSubscriptionId
								)}"
							>
								{getStatusLabel(
									server.plan,
									server.stripeStatus,
									server.stripeSubscriptionId
								)}
							</span>
						</div>

						<div class="billing-server-meta">
							<span>
								{#if server.stripeSubscriptionId}
									{formatPrice(server.priceCents)}{tr('account.perMonth')}
								{:else}
									{tr('account.payment.noSubscription')}
								{/if}
							</span>
							{#if server.stripeCurrentPeriodEnd}
								<span
									>{tr('account.payment.renews', {
										date: formatDate(server.stripeCurrentPeriodEnd),
									})}</span
								>
							{/if}
						</div>

						<div class="billing-server-actions">
							<button
								class="btn btn-primary btn-sm"
								onclick={() => openBillingPortal(server.guildId, server.guildName)}
								disabled={portalLoading !== null}
							>
								{portalLoading === server.guildId
									? tr('account.payment.opening')
									: tr('account.payment.openPortal')}
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Local Runner link card -->
	<a href="/account/runners" class="runner-link-card">
		<div class="runner-link-card-icon">🖥️</div>
		<div class="runner-link-card-body">
			<strong>{tr('account.runnerCard.title')}</strong>
			<span>{tr('account.runnerCard.desc')}</span>
		</div>
		<span class="runner-link-card-arrow">&#8594;</span>
	</a>

	<!-- Settings Section -->
	<section id="section-settings" class="content-section">
		<h2><span class="section-icon">⚙️</span> {tr('account.settings.heading')}</h2>

		<div class="settings-group">
			<div class="setting-item">
				<div class="setting-info">
					<span class="setting-label">{tr('account.settings.theme')}</span>
					<span class="setting-desc">{tr('account.settings.themeDesc')}</span>
				</div>
				<div class="setting-control">
					<ThemeToggle />
				</div>
			</div>
		</div>

		<div class="settings-group">
			<h3>{tr('account.settings.connectedAccount')}</h3>
			<div class="setting-item">
				<div class="setting-info">
					<span class="setting-label">{tr('account.settings.discord')}</span>
					<span class="setting-desc"
						>{@html tr('account.settings.loggedInAs', {
							username: user.username,
						})}</span
					>
				</div>
				<div class="setting-control">
					<span class="connected-badge">{tr('account.settings.connected')}</span>
				</div>
			</div>
		</div>

		<div class="settings-group danger-zone">
			<h3>{tr('account.settings.session')}</h3>
			<div class="setting-item">
				<div class="setting-info">
					<span class="setting-label">{tr('account.settings.logOut')}</span>
					<span class="setting-desc">{tr('account.settings.logOutDesc')}</span>
				</div>
				<div class="setting-control">
					<a href="/api/auth/logout" class="btn btn-danger btn-sm"
						>{tr('account.settings.logOut')}</a
					>
				</div>
			</div>
		</div>
	</section>
</div>

<style>
	.account-page {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}

	/* Page Header */
	.page-header {
		margin-bottom: 1.5rem;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		text-decoration: none;
		margin-bottom: 0.75rem;
		transition: color var(--transition-fast);
	}

	.back-link:hover {
		color: var(--color-primary);
	}

	.header-content h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}

	.header-icon {
		font-size: 1.25rem;
	}

	.header-desc {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin: 0.25rem 0 0;
	}

	/* Section Navigation */
	.section-nav {
		display: flex;
		gap: 0.25rem;
		padding: 0.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		margin-bottom: 2rem;
		overflow-x: auto;
	}

	.section-nav-item {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.625rem 1rem;
		background: transparent;
		border: none;
		border-radius: 6px;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all var(--transition-fast);
		white-space: nowrap;
		text-decoration: none;
	}

	.section-nav-item:hover {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.section-nav-item.active {
		color: var(--color-primary);
		background: var(--color-primary-soft);
		font-weight: 600;
	}

	.nav-icon {
		font-size: 1rem;
	}

	/* Content Sections */
	.content-section {
		margin-bottom: 2.5rem;
		scroll-margin-top: 5rem;
	}

	.content-section h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--color-border);
	}

	.section-icon {
		font-size: 1rem;
	}

	/* Profile Section */
	.profile-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1.25rem;
		position: relative;
	}

	.profile-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.profile-avatar {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		object-fit: cover;
		border: 3px solid var(--color-primary-soft);
	}

	.profile-identity {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.profile-display-name {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text);
		margin: 0;
	}

	.profile-username {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.profile-id {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-family: monospace;
	}

	.detail-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.75rem;
	}

	.detail-item {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.detail-label {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.detail-value {
		font-size: 0.875rem;
		color: var(--color-text);
		font-weight: 500;
	}

	.profile-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 1rem;
		padding: 0.375rem 0.75rem;
		border-radius: var(--radius-full);
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.superadmin-badge {
		background: linear-gradient(135deg, hsla(35, 90%, 55%, 0.15), hsla(45, 95%, 60%, 0.15));
		color: hsl(35, 80%, 45%);
		border: 1px solid hsla(35, 80%, 55%, 0.3);
	}

	:global([data-theme='dark']) .superadmin-badge {
		color: hsl(40, 90%, 65%);
	}

	.badge-icon {
		font-size: 0.875rem;
	}

	/* Server summary */
	.servers-summary {
		margin-top: 1.25rem;
	}

	.servers-summary h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0 0 0.75rem;
	}

	.autopilot-summary {
		margin-top: 1.25rem;
		padding: 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.autopilot-summary-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.autopilot-summary-header h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0;
	}

	.autopilot-latest {
		margin-top: 0.85rem;
		padding-top: 0.85rem;
		border-top: 1px solid var(--color-border);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.autopilot-latest-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.autopilot-latest-meta {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
		line-height: 1.35;
	}

	.server-stats-row {
		display: flex;
		gap: 0.75rem;
	}

	.stat-chip {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.75rem 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		min-width: 80px;
	}

	.stat-chip.pro {
		border-color: var(--color-primary);
		background: var(--color-primary-soft);
	}

	.stat-chip.starter {
		border-color: var(--color-border);
	}

	.stat-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	/* Billing Section */
	.billing-overview {
		background: var(--color-primary-soft);
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-md);
		padding: 1rem 1.25rem;
		margin-bottom: 1.25rem;
	}

	.billing-total {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}

	.billing-total-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.billing-total-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-primary);
	}

	.billing-period {
		font-size: 0.875rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
		color: var(--color-text-muted);
	}

	.empty-icon {
		font-size: 2rem;
		display: block;
		margin-bottom: 0.5rem;
	}

	/* Server Plan Cards */
	.server-plans-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.server-plan-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1rem 1.25rem;
		transition: border-color var(--transition-fast);
	}

	.server-plan-card:hover {
		border-color: var(--color-primary);
	}

	.server-plan-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.server-plan-identity {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.server-plan-icon {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		object-fit: cover;
	}

	.server-plan-icon-placeholder {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--color-primary-soft);
		color: var(--color-primary);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.875rem;
	}

	.server-plan-info {
		display: flex;
		flex-direction: column;
	}

	.server-plan-name {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.server-plan-id {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-family: monospace;
	}

	.server-plan-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.plan-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.625rem;
		border-radius: var(--radius-full);
		font-size: 0.75rem;
		font-weight: 600;
	}

	.plan-badge.pro {
		background: var(--color-primary-soft);
		color: var(--color-primary);
	}

	.plan-badge.free,
	.plan-badge.starter {
		background: var(--color-surface-hover, hsla(var(--hue), 10%, 50%, 0.1));
		color: var(--color-text-muted);
	}

	.status-badge {
		padding: 0.125rem 0.5rem;
		border-radius: var(--radius-full);
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.badge-success {
		background: hsla(142, 71%, 45%, 0.12);
		color: var(--color-success);
	}

	.badge-warning {
		background: hsla(38, 92%, 50%, 0.12);
		color: var(--color-warning);
	}

	.badge-danger {
		background: hsla(0, 84%, 60%, 0.12);
		color: var(--color-danger);
	}

	.badge-info {
		background: hsla(217, 91%, 60%, 0.12);
		color: var(--color-info);
	}

	.badge-neutral {
		background: var(--color-surface-hover, hsla(var(--hue), 10%, 50%, 0.1));
		color: var(--color-text-muted);
	}

	.badge-admin {
		background: linear-gradient(135deg, hsla(35, 90%, 55%, 0.15), hsla(45, 95%, 60%, 0.15));
		color: hsl(35, 80%, 45%);
	}

	:global([data-theme='dark']) .badge-admin {
		color: hsl(40, 90%, 65%);
	}

	.admin-granted-price {
		color: hsl(35, 80%, 45%);
	}

	:global([data-theme='dark']) .admin-granted-price {
		color: hsl(40, 90%, 65%);
	}

	/* Payment Methods Section */
	.payment-hero-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--color-primary) 10%, var(--color-surface)) 0%,
			var(--color-surface) 100%
		);
	}

	.payment-hero-main h3 {
		font-size: 1rem;
		font-weight: 700;
		margin: 0 0 0.25rem;
		color: var(--color-text);
	}

	.payment-hero-main p {
		font-size: 0.8125rem;
		line-height: 1.45;
		margin: 0;
		color: var(--color-text-muted);
	}

	.payment-hero-metrics {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		min-width: 19rem;
	}

	.payment-metric {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.5rem 0.625rem;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-surface) 82%, white 18%);
		border: 1px solid color-mix(in srgb, var(--color-border) 85%, var(--color-primary) 15%);
	}

	.payment-metric-label {
		font-size: 0.675rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}

	.payment-metric strong {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.billing-servers-grid {
		margin-top: 1rem;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 0.75rem;
	}

	.billing-server-card {
		padding: 0.875rem;
		border-radius: var(--radius-md);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.billing-server-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.billing-server-title-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.billing-server-id {
		font-size: 0.6875rem;
		font-family: monospace;
		color: var(--color-text-muted);
	}

	.billing-server-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.billing-server-actions {
		display: flex;
		justify-content: flex-end;
	}

	.subscription-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.subscription-row + .subscription-row {
		margin-top: 0.375rem;
	}

	.subscription-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.subscription-icon {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		object-fit: cover;
	}

	.subscription-icon-placeholder {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--color-primary-soft);
		color: var(--color-primary);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.6875rem;
	}

	.subscription-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.subscription-price {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-primary);
	}

	@media (max-width: 640px) {
		.payment-hero-card {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.75rem;
		}

		.payment-hero-metrics {
			width: 100%;
			min-width: 0;
		}

		.billing-server-meta {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.25rem;
		}
	}

	.server-plan-details {
		display: flex;
		gap: 1.5rem;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
	}

	.plan-detail {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.plan-detail-label {
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.plan-detail-value {
		font-size: 0.875rem;
		color: var(--color-text);
		font-weight: 500;
	}

	.server-plan-actions {
		margin-top: 0.75rem;
		display: flex;
		justify-content: flex-end;
	}

	/* Billing History Timeline */
	.billing-history {
		margin-top: 1.5rem;
	}

	.billing-history h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0 0 0.75rem;
	}

	.timeline {
		position: relative;
		padding-left: 1.5rem;
	}

	.timeline::before {
		content: '';
		position: absolute;
		left: 5px;
		top: 4px;
		bottom: 4px;
		width: 2px;
		background: var(--color-border);
		border-radius: 1px;
	}

	.timeline-item {
		position: relative;
		padding-bottom: 1rem;
		display: flex;
		gap: 0.75rem;
	}

	.timeline-item:last-child {
		padding-bottom: 0;
	}

	.timeline-dot {
		position: absolute;
		left: -1.5rem;
		top: 4px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid var(--color-surface);
		z-index: 1;
		flex-shrink: 0;
	}

	.dot-success {
		background: var(--color-success);
	}
	.dot-danger {
		background: var(--color-danger);
	}
	.dot-warning {
		background: var(--color-warning);
	}
	.dot-info {
		background: var(--color-info);
	}
	.dot-admin {
		background: hsl(35, 80%, 50%);
	}
	.dot-neutral {
		background: var(--color-text-muted);
	}

	.timeline-content {
		flex: 1;
		min-width: 0;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.625rem 0.875rem;
	}

	.timeline-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.timeline-icon {
		font-size: 0.875rem;
	}

	.timeline-label {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.timeline-server {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		background: var(--color-surface-hover, hsla(var(--hue), 10%, 50%, 0.1));
		padding: 0.0625rem 0.375rem;
		border-radius: var(--radius-full);
		margin-left: auto;
	}

	.timeline-desc {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		margin: 0.25rem 0 0;
		line-height: 1.4;
	}

	.timeline-meta {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		margin-top: 0.375rem;
		flex-wrap: wrap;
	}

	.timeline-date {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
	}

	.timeline-amount {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-primary);
	}

	.timeline-plan-change {
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--color-text-muted);
		background: var(--color-primary-soft);
		padding: 0.0625rem 0.375rem;
		border-radius: var(--radius-sm);
	}

	.timeline-actor {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		font-style: italic;
	}

	.timeline-actor-avatar {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	/* Plan Comparison Table */
	.plan-comparison {
		margin-top: 1.5rem;
	}

	.plan-comparison h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0 0 0.75rem;
	}

	.plan-table-wrapper {
		overflow-x: auto;
	}

	.plan-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.plan-table th,
	.plan-table td {
		padding: 0.625rem 0.875rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
	}

	.plan-table th {
		font-weight: 600;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		background: var(--color-surface);
	}

	.plan-table td {
		color: var(--color-text);
	}

	.plan-table .highlight {
		background: var(--color-primary-soft);
		color: var(--color-primary);
		font-weight: 600;
	}

	.plan-table th.highlight {
		color: var(--color-primary);
	}

	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-sm);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		border: none;
		transition: all var(--transition-fast);
	}

	.btn-sm {
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
	}

	.btn-primary {
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
	}

	.btn-primary:hover {
		background: var(--color-primary-button-hover);
	}

	.btn-secondary {
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}

	.btn-secondary:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.btn-danger {
		background: var(--color-danger);
		color: white;
	}

	.btn-danger:hover {
		opacity: 0.9;
	}

	/* Settings Section */
	.settings-group {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.25rem 0;
		margin-bottom: 1rem;
	}

	.settings-group h3 {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin: 0;
		padding: 0.75rem 1.25rem 0.25rem;
	}

	.settings-group.danger-zone {
		border-color: hsla(0, 84%, 60%, 0.3);
	}

	.setting-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.875rem 1.25rem;
	}

	.setting-item + .setting-item {
		border-top: 1px solid var(--color-border);
	}

	.setting-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.setting-label {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.setting-desc {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		line-height: 1.4;
	}

	.setting-control {
		flex-shrink: 0;
	}

	.connected-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.625rem;
		border-radius: var(--radius-full);
		font-size: 0.75rem;
		font-weight: 600;
		background: hsla(142, 71%, 45%, 0.12);
		color: var(--color-success);
	}

	/* Responsive */
	@media (max-width: 640px) {
		.account-page {
			padding: 1rem 0.75rem 2rem;
		}

		.header-content h1 {
			font-size: 1.25rem;
		}

		.profile-header {
			flex-direction: column;
			text-align: center;
		}

		.profile-identity {
			align-items: center;
		}

		.server-stats-row {
			flex-wrap: wrap;
		}

		.stat-chip {
			flex: 1;
			min-width: 70px;
		}

		.server-plan-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.billing-total {
			flex-direction: column;
			gap: 0.25rem;
		}

		.server-plan-details {
			flex-wrap: wrap;
			gap: 0.75rem;
		}

		.setting-item {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.75rem;
		}

		.detail-grid {
			grid-template-columns: 1fr 1fr;
		}
	}

	/* Local Runner link card */
	.runner-link-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		text-decoration: none;
		color: var(--color-text);
		transition:
			border-color var(--transition-fast),
			background var(--transition-fast);
		margin-bottom: 2rem;
	}

	.runner-link-card:hover {
		border-color: var(--color-primary);
		background: var(--color-primary-soft);
	}

	.runner-link-card-icon {
		font-size: 1.75rem;
		flex-shrink: 0;
	}

	.runner-link-card-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.runner-link-card-body strong {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.runner-link-card-body span {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.runner-link-card-arrow {
		font-size: 1.125rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	/* Generic input used in inline forms */
	.input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 0.875rem;
		color: var(--color-text);
		outline: none;
		transition: border-color var(--transition-fast);
		box-sizing: border-box;
	}

	.input:focus {
		border-color: var(--color-primary);
	}

	.input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-ghost {
		background: transparent;
		border: none;
		color: var(--color-text-muted);
	}

	.btn-ghost:hover {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}
</style>
