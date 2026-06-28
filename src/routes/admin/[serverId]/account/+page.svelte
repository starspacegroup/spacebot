<script lang="ts">
	import { toast } from '$lib/toast.svelte.js';

	const { data } = $props();

	// URL params for post-checkout feedback
	const urlParams =
		typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
	const checkoutStatus = urlParams?.get('status');

	// Surface the post-checkout status once on mount (plain guard so it can't refire).
	let checkoutToastShown = false;
	$effect(() => {
		if (checkoutToastShown) return;
		checkoutToastShown = true;
		if (checkoutStatus === 'success') {
			toast.success('Welcome to Pro! Your upgrade is being processed.');
		} else if (checkoutStatus === 'canceled') {
			toast.error('Checkout was canceled. No charges were made.');
		}
	});

	let loading = $state(false);
	let error = $state(null);
	let billingInterval = $state('monthly');

	const plan = $derived(data.plan);
	const billingHistory = $derived(data.billingHistory || []);
	const usage = $derived(
		data.usage || {
			commands: 0,
			commandsActive: 0,
			commandsInactive: 0,
			automations: 0,
			automationsActive: 0,
			automationsInactive: 0,
			apiKeys: 0,
			apiKeysActive: 0,
			apiKeysRevoked: 0,
			webhooks: 0,
			webhooksActive: 0,
			webhooksInactive: 0,
		}
	);
	const isProActive = $derived(
		plan.plan === 'pro' && ['active', 'trialing'].includes(plan.stripe_status)
	);
	const isCanceling = $derived(plan.plan === 'pro' && plan.stripe_status === 'canceling');
	const isPastDue = $derived(plan.stripe_status === 'past_due');
	// Pro granted by superadmin without an active Stripe subscription
	const isAdminGrantedPro = $derived(
		plan.plan === 'pro' &&
			!plan.stripe_subscription_id &&
			!isProActive &&
			!isCanceling &&
			!isPastDue
	);

	// Derived pricing based on selected interval
	const monthlyPrice = $derived(data.planTiers.pro.price_cents);
	const yearlyPrice = $derived(data.planTiers.pro.price_cents_yearly);
	const yearlyMonthlyEquiv = $derived(Math.round(yearlyPrice / 12));
	const yearlySavingsPercent = $derived(
		Math.round((1 - yearlyPrice / (monthlyPrice * 12)) * 100)
	);

	// Usage percentages for progress bars
	function usagePercent(used, max) {
		if (!max) return 0; // unlimited
		return Math.min(100, Math.round((used / max) * 100));
	}

	function usageLabel(used, max) {
		if (!max) return `${used} / ∞`;
		return `${used} / ${max}`;
	}

	function usageStatus(used, max) {
		if (!max) return 'ok'; // unlimited
		const pct = (used / max) * 100;
		if (pct >= 100) return 'full';
		if (pct >= 80) return 'warning';
		return 'ok';
	}

	// Format price
	function formatPrice(cents) {
		if (!cents) return 'Starter';
		return `$${(cents / 100).toFixed(2)}`;
	}

	// Format date
	function formatDate(dateStr) {
		if (!dateStr) return 'N/A';
		return new Date(dateStr).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		});
	}

	// Billing history helpers
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
				return 'Upgrade';
			case 'plan_upgrade':
				return 'Plan Upgrade';
			case 'plan_downgrade':
				return 'Downgrade';
			case 'admin_edit':
				return 'Admin Edit';
			case 'payment_success':
				return 'Payment';
			case 'payment_failed':
				return 'Payment Failed';
			case 'subscription_canceled':
				return 'Canceled';
			case 'subscription_reactivated':
				return 'Reactivated';
			case 'subscription_renewed':
				return 'Renewed';
			case 'plan_reset':
				return 'Plan Reset';
			default:
				return 'Event';
		}
	}

	function getEventBadgeClass(eventType) {
		switch (eventType) {
			case 'checkout_completed':
			case 'plan_upgrade':
			case 'payment_success':
			case 'subscription_renewed':
				return 'badge-success';
			case 'payment_failed':
			case 'plan_downgrade':
				return 'badge-danger';
			case 'subscription_canceled':
				return 'badge-warning';
			case 'admin_edit':
			case 'plan_reset':
				return 'badge-admin';
			case 'subscription_reactivated':
				return 'badge-info';
			default:
				return 'badge-neutral';
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

	async function billingAction(action) {
		loading = true;
		error = null;

		try {
			const payload: Record<string, any> = {
				action,
				guildId: data.serverId,
				guildName: data.guild?.name || data.serverId,
				returnUrl: window.location.href.split('?')[0],
			};

			// Include billing interval for checkout
			if (action === 'checkout') {
				payload.interval = billingInterval;
			}

			const res = await fetch('/api/billing', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			const result = await res.json();

			if (!res.ok) {
				error = result.error || 'Something went wrong';
				return;
			}

			// Redirect to Stripe for checkout/portal
			if (result.url) {
				window.location.href = result.url;
				return;
			}

			// Success for cancel/reactivate — reload page
			if (result.success) {
				const message =
					action === 'cancel'
						? 'Subscription will cancel at the end of the billing period.'
						: 'Subscription reactivated!';
				toast[action === 'reactivate' ? 'success' : 'error'](message);
				// Reload to get fresh data
				setTimeout(() => window.location.reload(), 1500);
			}
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Account - {data.guild?.name || 'Server'} | SpaceBot</title>
</svelte:head>

<div class="account-page">
	<header class="page-header">
		<a href="/admin/{data.serverId}" class="back-link">&#8592; Back to Dashboard</a>
		<div class="header-content">
			<h1>
				<span class="header-icon">⚙️</span>
				Account &amp; Billing
			</h1>
			<p class="header-desc">
				Manage your plan, usage, and subscription for {data.guild?.name || 'this server'}
			</p>
		</div>
	</header>

	{#if data.loadError}
		<div class="alert alert-error">
			<span class="alert-icon">⚠️</span>
			<div>
				<strong>Failed to load account data.</strong> Some information may be unavailable. Please
				try refreshing.
			</div>
		</div>
	{/if}

	{#if error}
		<div class="alert alert-error">
			<span class="alert-icon">⚠️</span>
			{error}
		</div>
	{/if}

	{#if isPastDue}
		<div class="alert alert-warning">
			<span class="alert-icon">⚠️</span>
			<div>
				<strong>Payment past due.</strong> Your last payment failed. Please update your
				payment method to keep Pro features.
				<button
					class="alert-action"
					onclick={() => billingAction('portal')}
					disabled={loading}
				>
					Update Payment Method
				</button>
			</div>
		</div>
	{/if}

	<!-- Server Overview -->
	<section class="overview-section">
		<div class="overview-grid">
			<div class="overview-card server-card">
				<div class="server-identity">
					{#if data.guild?.icon}
						<img
							class="server-icon"
							src="https://cdn.discordapp.com/icons/{data.serverId}/{data.guild
								.icon}.webp?size=64"
							alt={data.guild.name}
						/>
					{:else}
						<div class="server-icon-placeholder">
							{(data.guild?.name || 'S').charAt(0)}
						</div>
					{/if}
					<div class="server-info">
						<h2 class="server-name">{data.guild?.name || 'Unknown Server'}</h2>
						<span class="server-id">ID: {data.serverId}</span>
					</div>
				</div>
				<div class="server-plan-row">
					<span
						class="plan-badge"
						class:pro={plan.plan === 'pro'}
						class:free={plan.plan === 'free'}
					>
						{plan.plan === 'pro' ? '⚡ Pro' : '🆓 Free'}
					</span>
					{#if isCanceling}
						<span class="status-tag canceling"
							>Cancels {formatDate(plan.stripe_current_period_end)}</span
						>
					{:else if isProActive}
						<span class="status-tag active">Active</span>
					{:else if isPastDue}
						<span class="status-tag past-due">Past Due</span>
					{:else if isAdminGrantedPro}
						<span class="status-tag admin-granted">Admin Granted</span>
					{/if}
				</div>
			</div>

			{#if isProActive || isCanceling}
				<div class="overview-card billing-summary-card">
					<h3>Billing Summary</h3>
					<div class="billing-details">
						<div class="detail-row">
							<span class="detail-label">Price</span>
							<span class="detail-value"
								>{formatPrice(plan.price_cents)}{plan.price_cents ===
								data.planTiers.pro.price_cents_yearly
									? '/yr'
									: '/mo'}</span
							>
						</div>
						{#if data.nextBillingDate}
							<div class="detail-row">
								<span class="detail-label"
									>{isCanceling ? 'Access until' : 'Next billing'}</span
								>
								<span class="detail-value">{formatDate(data.nextBillingDate)}</span>
							</div>
						{/if}
						{#if data.nextBillingAmount && !isCanceling}
							<div class="detail-row">
								<span class="detail-label">Next charge</span>
								<span class="detail-value"
									>{formatPrice(data.nextBillingAmount)}{data.billingInterval ===
									'year'
										? '/yr'
										: '/mo'}</span
								>
							</div>
						{/if}
						{#if data.billingInterval}
							<div class="detail-row">
								<span class="detail-label">Cycle</span>
								<span class="detail-value"
									>{data.billingInterval === 'year' ? 'Yearly' : 'Monthly'}</span
								>
							</div>
						{/if}
					</div>
					<div class="billing-actions">
						{#if isProActive}
							<button
								class="btn btn-secondary btn-sm"
								onclick={() => billingAction('portal')}
								disabled={loading}
							>
								{loading ? '...' : 'Manage Payment'}
							</button>
							<button
								class="btn btn-danger-outline btn-sm"
								onclick={() => billingAction('cancel')}
								disabled={loading}
							>
								{loading ? '...' : 'Cancel'}
							</button>
						{:else if isCanceling}
							<button
								class="btn btn-primary btn-sm"
								onclick={() => billingAction('reactivate')}
								disabled={loading}
							>
								{loading ? '...' : 'Reactivate'}
							</button>
							<button
								class="btn btn-secondary btn-sm"
								onclick={() => billingAction('portal')}
								disabled={loading}
							>
								{loading ? '...' : 'Billing Portal'}
							</button>
						{:else if isPastDue}
							<button
								class="btn btn-primary btn-sm"
								onclick={() => billingAction('portal')}
								disabled={loading}
							>
								{loading ? '...' : 'Fix Payment'}
							</button>
						{/if}
					</div>
				</div>
			{:else if isAdminGrantedPro}
				<div class="overview-card billing-summary-card">
					<h3>Plan Info</h3>
					<p class="admin-granted-note">
						Pro features were granted by an administrator. Subscribe below to manage
						your own billing and ensure uninterrupted access.
					</p>
				</div>
			{/if}
		</div>
	</section>

	<!-- Usage Overview -->
	<section class="usage-section">
		<h2>
			<span class="section-icon">📊</span>
			Plan Usage
		</h2>
		<div class="usage-grid">
			<div class="usage-card">
				<div class="usage-header">
					<span class="usage-icon">⌨️</span>
					<span class="usage-title">Commands</span>
				</div>
				<div class="usage-bar-container">
					{#if plan.max_commands}
						<div class="usage-bar">
							<div
								class="usage-bar-fill {usageStatus(
									usage.commandsActive,
									plan.max_commands
								)}"
								style="width: {usagePercent(
									usage.commandsActive,
									plan.max_commands
								)}%"
							></div>
						</div>
					{:else}
						<div class="usage-bar">
							<div class="usage-bar-fill unlimited" style="width: 100%"></div>
						</div>
					{/if}
					<span class="usage-count"
						>{usageLabel(usage.commandsActive, plan.max_commands)}</span
					>
				</div>
				{#if usage.commandsInactive > 0}
					<div class="usage-detail">
						<span class="detail-inactive">+{usage.commandsInactive} disabled</span>
					</div>
				{/if}
			</div>

			<div class="usage-card">
				<div class="usage-header">
					<span class="usage-icon"
						><img src="/logo.webp" alt="" class="inline-logo" /></span
					>
					<span class="usage-title">Automations</span>
				</div>
				<div class="usage-bar-container">
					{#if plan.max_automations}
						<div class="usage-bar">
							<div
								class="usage-bar-fill {usageStatus(
									usage.automationsActive,
									plan.max_automations
								)}"
								style="width: {usagePercent(
									usage.automationsActive,
									plan.max_automations
								)}%"
							></div>
						</div>
					{:else}
						<div class="usage-bar">
							<div class="usage-bar-fill unlimited" style="width: 100%"></div>
						</div>
					{/if}
					<span class="usage-count"
						>{usageLabel(usage.automationsActive, plan.max_automations)}</span
					>
				</div>
				{#if usage.automationsInactive > 0}
					<div class="usage-detail">
						<span class="detail-inactive">+{usage.automationsInactive} disabled</span>
					</div>
				{/if}
			</div>

			<div class="usage-card">
				<div class="usage-header">
					<span class="usage-icon">🔑</span>
					<span class="usage-title">API Keys</span>
				</div>
				<div class="usage-bar-container">
					{#if plan.max_api_keys}
						<div class="usage-bar">
							<div
								class="usage-bar-fill {usageStatus(
									usage.apiKeys,
									plan.max_api_keys
								)}"
								style="width: {usagePercent(usage.apiKeys, plan.max_api_keys)}%"
							></div>
						</div>
					{:else}
						<div class="usage-bar">
							<div class="usage-bar-fill unlimited" style="width: 100%"></div>
						</div>
					{/if}
					<span class="usage-count">{usageLabel(usage.apiKeys, plan.max_api_keys)}</span>
				</div>
			</div>

			<div class="usage-card">
				<div class="usage-header">
					<span class="usage-icon">🔗</span>
					<span class="usage-title">Webhooks</span>
				</div>
				<div class="usage-bar-container">
					{#if plan.max_webhooks}
						<div class="usage-bar">
							<div
								class="usage-bar-fill {usageStatus(
									usage.webhooksActive,
									plan.max_webhooks
								)}"
								style="width: {usagePercent(
									usage.webhooksActive,
									plan.max_webhooks
								)}%"
							></div>
						</div>
					{:else}
						<div class="usage-bar">
							<div class="usage-bar-fill unlimited" style="width: 100%"></div>
						</div>
					{/if}
					<span class="usage-count"
						>{usageLabel(usage.webhooksActive, plan.max_webhooks)}</span
					>
				</div>
			</div>
		</div>

		<div class="retention-info">
			<div class="retention-item">
				<span class="retention-label">Log Retention</span>
				<span class="retention-value"
					>{plan.log_retention_days
						? `${plan.log_retention_days} days`
						: 'Unlimited'}</span
				>
			</div>
			<div class="retention-item">
				<span class="retention-label">Stats Retention</span>
				<span class="retention-value"
					>{plan.stats_retention_days
						? plan.stats_retention_days >= 365
							? `${Math.round(plan.stats_retention_days / 365)} years`
							: `${plan.stats_retention_days} days`
						: 'Unlimited'}</span
				>
			</div>
		</div>
	</section>

	<!-- Quick Links -->
	<section class="quick-links-section">
		<h2>
			<span class="section-icon">🔗</span>
			Manage
		</h2>
		<div class="manage-grid">
			<a href="/admin/{data.serverId}/commands" class="manage-card">
				<span class="manage-icon">⌨️</span>
				<span class="manage-label">Commands</span>
				{#if usage.commands > 0}
					<span class="manage-summary">
						<span class="summary-active">{usage.commandsActive}</span>
						active{#if usage.commandsInactive > 0}<span class="summary-muted"
								>, {usage.commandsInactive} off</span
							>{/if}
					</span>
				{:else}
					<span class="manage-count">0</span>
				{/if}
			</a>
			<a href="/admin/{data.serverId}/automations" class="manage-card">
				<span class="manage-icon"><img src="/logo.webp" alt="" class="inline-logo" /></span>
				<span class="manage-label">Automations</span>
				{#if usage.automations > 0}
					<span class="manage-summary">
						<span class="summary-active">{usage.automationsActive}</span>
						active{#if usage.automationsInactive > 0}<span class="summary-muted"
								>, {usage.automationsInactive} off</span
							>{/if}
					</span>
				{:else}
					<span class="manage-count">0</span>
				{/if}
			</a>
			<a href="/admin/{data.serverId}/api-keys" class="manage-card">
				<span class="manage-icon">🔑</span>
				<span class="manage-label">API Keys</span>
				<span class="manage-count">{usage.apiKeys}</span>
			</a>
			<a href="/admin/{data.serverId}/integrations" class="manage-card">
				<span class="manage-icon">🔌</span>
				<span class="manage-label">Integrations</span>
			</a>
			<a href="/admin/{data.serverId}/settings" class="manage-card">
				<span class="manage-icon">⚙️</span>
				<span class="manage-label">Settings</span>
			</a>
			<a href="/admin/{data.serverId}/logs" class="manage-card">
				<span class="manage-icon">📋</span>
				<span class="manage-label">Logs</span>
			</a>
		</div>
	</section>

	<!-- Plan Comparison -->
	<section class="plans-section">
		<div class="plans-header">
			<h2>Choose Your Plan</h2>
			<div class="interval-toggle">
				<button
					class="interval-btn"
					class:active={billingInterval === 'monthly'}
					onclick={() => (billingInterval = 'monthly')}
				>
					Monthly
				</button>
				<button
					class="interval-btn"
					class:active={billingInterval === 'yearly'}
					onclick={() => (billingInterval = 'yearly')}
				>
					Yearly
					{#if yearlySavingsPercent > 0}
						<span class="save-badge">Save {yearlySavingsPercent}%</span>
					{/if}
				</button>
			</div>
		</div>

		<div class="plans-grid">
			<!-- Free Plan -->
			<div class="plan-card" class:current={plan.plan === 'free' && !isCanceling}>
				{#if plan.plan === 'free' && !isCanceling}
					<div class="current-label">Current Plan</div>
				{/if}
				<div class="plan-card-header">
					<h3>Starter</h3>
					<div class="plan-price">
						<span class="price-amount">FREE</span>
					</div>
				</div>
				<ul class="plan-features">
					<li>
						<span class="feature-icon">✓</span>
						{data.planTiers.free.max_commands} custom commands
					</li>
					<li>
						<span class="feature-icon">✓</span>
						{data.planTiers.free.max_automations} automations
					</li>
					<li>
						<span class="feature-icon">✓</span>
						{data.planTiers.free.max_api_keys} API keys
					</li>
					<li>
						<span class="feature-icon">✓</span>
						{data.planTiers.free.max_webhooks} webhooks
					</li>
					<li>
						<span class="feature-icon">✓</span>
						{data.planTiers.free.log_retention_days}-day log retention
					</li>
					<li>
						<span class="feature-icon">✓</span>
						{data.planTiers.free.stats_retention_days}-day stats retention
					</li>
				</ul>
				{#if plan.plan !== 'free' || isCanceling}
					<div class="plan-card-footer">
						<span class="plan-note">
							{#if isCanceling}
								Reverts to Starter after cancellation
							{:else}
								Included features
							{/if}
						</span>
					</div>
				{/if}
			</div>

			<!-- Pro Plan -->
			<div class="plan-card pro" class:current={plan.plan === 'pro' && !isCanceling}>
				{#if plan.plan === 'pro' && !isCanceling}
					<div class="current-label">Current Plan</div>
				{:else}
					<div class="recommended-label">Recommended</div>
				{/if}
				<div class="plan-card-header">
					<h3>Pro</h3>
					{#if billingInterval === 'yearly'}
						<div class="plan-price">
							<span class="price-amount">{formatPrice(yearlyPrice)}</span>
							<span class="price-period">/yr</span>
						</div>
						<div class="price-equiv">
							{formatPrice(yearlyMonthlyEquiv)}/mo equivalent
						</div>
					{:else}
						<div class="plan-price">
							<span class="price-amount">{formatPrice(monthlyPrice)}</span>
							<span class="price-period">/mo</span>
						</div>
					{/if}
				</div>
				<ul class="plan-features">
					<li>
						<span class="feature-icon pro">★</span> <strong>Unlimited</strong> commands
					</li>
					<li>
						<span class="feature-icon pro">★</span> <strong>Unlimited</strong> automations
					</li>
					<li>
						<span class="feature-icon pro">★</span>
						{data.planTiers.pro.max_api_keys} API keys
					</li>
					<li>
						<span class="feature-icon pro">★</span>
						{data.planTiers.pro.max_webhooks} webhooks
					</li>
					<li>
						<span class="feature-icon pro">★</span> <strong>Unlimited</strong> log retention
					</li>
					<li>
						<span class="feature-icon pro">★</span> <strong>1 year</strong> stats retention
					</li>
					<li><span class="feature-icon pro">★</span> Priority support</li>
				</ul>
				{#if plan.plan !== 'pro' || isCanceling || isAdminGrantedPro}
					<div class="plan-card-footer">
						{#if data.stripeConfigured}
							{#if isAdminGrantedPro}
								<p class="plan-note" style="margin-bottom: 0.5rem;">
									Your Pro access was granted manually. Subscribe to manage your
									own billing.
								</p>
							{/if}
							<button
								class="btn btn-primary btn-lg btn-full"
								onclick={() => billingAction('checkout')}
								disabled={loading}
							>
								{loading
									? 'Redirecting to Stripe...'
									: isAdminGrantedPro
										? 'Subscribe to Pro'
										: 'Upgrade to Pro'}
							</button>
						{:else}
							<span class="plan-note"
								>Payment processing is not configured yet. Contact an admin.</span
							>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</section>

	<!-- Billing History -->
	<section class="history-section">
		<h2>
			<span class="section-icon">📋</span>
			Billing History
		</h2>
		{#if billingHistory.length === 0}
			<div class="history-empty">
				<span class="empty-icon">📋</span>
				<p>
					No billing events yet. History will appear here as plan changes and payments
					occur.
				</p>
			</div>
		{:else}
			<div class="history-timeline">
				{#each billingHistory as event}
					<div
						class="history-event"
						class:admin-event={event.event_type === 'admin_edit' ||
							event.event_type === 'plan_reset'}
					>
						<div class="event-indicator">
							<span class="event-dot {getEventDotClass(event.event_type)}"></span>
							<span class="event-line"></span>
						</div>
						<div class="event-content">
							<div class="event-header">
								<span class="event-badge {getEventBadgeClass(event.event_type)}">
									{getEventIcon(event.event_type)}
									{getEventLabel(event.event_type)}
								</span>
								<time class="event-date">{formatDate(event.created_at)}</time>
							</div>
							<p class="event-description">{event.description}</p>
							{#if event.amount_cents}
								<span class="event-amount">{formatPrice(event.amount_cents)}</span>
							{/if}
							{#if event.plan_before && event.plan_after && event.plan_before !== event.plan_after}
								<div class="event-plan-change">
									<span class="plan-pill-sm {event.plan_before}"
										>{event.plan_before}</span
									>
									<span class="arrow">→</span>
									<span class="plan-pill-sm {event.plan_after}"
										>{event.plan_after}</span
									>
								</div>
							{/if}
							{#if event.actor_name}
								<span class="event-actor">by {event.actor_name}</span>
							{/if}
							{#if event.event_type === 'admin_edit' && event.details?.changes?.length}
								<details class="event-changes">
									<summary>View changes</summary>
									<ul>
										{#each event.details.changes as change}
											<li>{change}</li>
										{/each}
									</ul>
								</details>
							{/if}
						</div>
					</div>
				{/each}
			</div>
			{#if data.billingHistoryTotal > billingHistory.length}
				<p class="history-more">
					Showing {billingHistory.length} of {data.billingHistoryTotal} events
				</p>
			{/if}
		{/if}
	</section>

	<!-- FAQ Section -->
	<section class="faq-section">
		<h2>
			<span class="section-icon">❓</span>
			Frequently Asked Questions
		</h2>
		<div class="faq-list">
			<details class="faq-item">
				<summary>What happens to my data if I downgrade?</summary>
				<p>
					Your existing data is kept but new features will be limited by the Free plan's
					caps. For example, you won't be able to create new commands beyond the free
					limit, but existing ones will continue to work.
				</p>
			</details>
			<details class="faq-item">
				<summary>Can I cancel anytime?</summary>
				<p>
					Yes! Whether you choose monthly or yearly billing, there's no lock-in. When you
					cancel, you keep Pro features until the end of your current billing period.
				</p>
			</details>
			<details class="faq-item">
				<summary>Can I switch between monthly and yearly?</summary>
				<p>
					Yes! You can switch billing intervals from the Stripe Billing Portal. If you
					switch from monthly to yearly mid-cycle, Stripe will prorate the difference.
				</p>
			</details>
			<details class="faq-item">
				<summary>How does billing work?</summary>
				<p>
					Payments are handled securely through Stripe. We never see or store your card
					details. You'll receive email receipts for each payment.
				</p>
			</details>
			<details class="faq-item">
				<summary>What if my payment fails?</summary>
				<p>
					Stripe will automatically retry failed payments. You'll receive email
					notifications and can update your payment method from the Billing Portal. Your
					Pro features remain active during the retry period.
				</p>
			</details>
		</div>
	</section>
</div>

<style>
	.account-page {
		max-width: 820px;
		margin: 0 auto;
		padding: 0 1rem 3rem;
	}

	/* Page Header */
	.page-header {
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.back-link {
		display: inline-block;
		font-size: 0.85rem;
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
		margin: 0 0 0.25rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}

	.header-icon {
		font-size: 1.5rem;
	}

	.header-desc {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	/* Alerts */
	.alert {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-radius: var(--radius-md);
		margin-bottom: 1.5rem;
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.alert-error {
		background: var(--color-danger-soft);
		color: var(--color-danger);
		border: 1px solid var(--color-danger);
	}

	.alert-warning {
		background: var(--color-warning-soft);
		color: var(--color-warning);
		border: 1px solid var(--color-warning);
	}

	.alert-icon {
		flex-shrink: 0;
		font-size: 1.1rem;
	}

	.alert-action {
		display: inline-block;
		margin-top: 0.5rem;
		padding: 0.375rem 0.75rem;
		background: var(--color-warning);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity var(--transition-fast);
	}

	.alert-action:hover {
		opacity: 0.85;
	}

	/* Section headings */
	h2 {
		font-size: 1.15rem;
		font-weight: 600;
		margin: 0 0 1rem;
		color: var(--color-text);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.section-icon {
		font-size: 1.15rem;
	}

	/* Overview Section */
	.overview-section {
		margin-bottom: 2rem;
	}

	.overview-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	@media (max-width: 640px) {
		.overview-grid {
			grid-template-columns: 1fr;
		}
	}

	.overview-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
		box-shadow: var(--shadow-sm);
	}

	.server-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.server-identity {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.server-icon {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-md);
		object-fit: cover;
		flex-shrink: 0;
	}

	.server-icon-placeholder {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-md);
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.server-info {
		min-width: 0;
	}

	.server-name {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--color-text);
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.server-id {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-family: var(--font-mono, monospace);
	}

	.server-plan-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* Plan Badge */
	.plan-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.3rem 0.75rem;
		border-radius: var(--radius-full);
		font-weight: 700;
		font-size: 0.8rem;
	}

	.plan-badge.free {
		background: var(--color-surface-elevated);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.plan-badge.pro {
		background: linear-gradient(
			135deg,
			var(--color-primary-button),
			var(--color-primary-button-hover)
		);
		color: var(--color-primary-button-text);
	}

	.status-tag {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-full);
	}

	.status-tag.active {
		background: var(--color-success-soft);
		color: var(--color-success);
	}

	.status-tag.canceling {
		background: var(--color-warning-soft);
		color: var(--color-warning);
	}

	.status-tag.past-due {
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}

	.status-tag.admin-granted {
		background: color-mix(in srgb, var(--color-primary) 15%, transparent);
		color: var(--color-primary);
	}

	/* Billing Summary Card */
	.billing-summary-card h3 {
		font-size: 0.9rem;
		font-weight: 600;
		margin: 0 0 0.75rem;
		color: var(--color-text);
	}

	.admin-granted-note {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		line-height: 1.5;
	}

	.billing-details {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-bottom: 0.75rem;
	}

	.detail-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.825rem;
	}

	.detail-label {
		color: var(--color-text-muted);
	}

	.detail-value {
		font-weight: 600;
		color: var(--color-text);
	}

	.billing-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition: all var(--transition-fast);
		border: 1px solid transparent;
		text-decoration: none;
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-sm {
		padding: 0.375rem 0.75rem;
		font-size: 0.8rem;
	}

	.btn-primary {
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		border-color: var(--color-primary-button);
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-button-hover);
		border-color: var(--color-primary-button-hover);
	}

	.btn-secondary {
		background: var(--color-surface-elevated);
		color: var(--color-text);
		border-color: var(--color-border);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--color-surface-hover);
		border-color: var(--color-border-strong);
	}

	.btn-danger-outline {
		background: transparent;
		color: var(--color-danger);
		border-color: var(--color-danger);
	}

	.btn-danger-outline:hover:not(:disabled) {
		background: var(--color-danger-soft);
	}

	.btn-lg {
		padding: 0.75rem 1.5rem;
		font-size: 1rem;
	}

	.btn-full {
		width: 100%;
	}

	/* Usage Section */
	.usage-section {
		margin-bottom: 2rem;
	}

	.usage-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	@media (max-width: 480px) {
		.usage-grid {
			grid-template-columns: 1fr;
		}
	}

	.usage-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.875rem 1rem;
	}

	.usage-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 0.5rem;
	}

	.usage-icon {
		font-size: 0.9rem;
	}

	.usage-title {
		font-size: 0.825rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.usage-bar-container {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.usage-bar {
		flex: 1;
		height: 6px;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.usage-bar-fill {
		height: 100%;
		border-radius: var(--radius-full);
		transition: width 0.4s ease;
	}

	.usage-bar-fill.ok {
		background: var(--color-success);
	}

	.usage-bar-fill.warning {
		background: var(--color-warning);
	}

	.usage-bar-fill.full {
		background: var(--color-danger);
	}

	.usage-bar-fill.unlimited {
		background: linear-gradient(
			90deg,
			var(--color-primary),
			var(--color-accent-hover, var(--color-primary))
		);
		opacity: 0.3;
	}

	.usage-count {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		white-space: nowrap;
		min-width: 3.5rem;
		text-align: right;
	}

	.usage-detail {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.35rem;
		font-size: 0.7rem;
	}

	.detail-active {
		color: #22c55e;
	}

	.detail-inactive {
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.detail-sep {
		color: var(--color-text-muted);
		opacity: 0.4;
	}

	.retention-info {
		display: flex;
		gap: 1.5rem;
		padding: 0.75rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	@media (max-width: 480px) {
		.retention-info {
			flex-direction: column;
			gap: 0.5rem;
		}
	}

	.retention-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.retention-label {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.retention-value {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text);
	}

	/* Manage Quick Links */
	.quick-links-section {
		margin-bottom: 2rem;
	}

	.manage-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.625rem;
	}

	@media (max-width: 540px) {
		.manage-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.manage-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 0.875rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		text-decoration: none;
		transition: all var(--transition-fast);
	}

	.manage-card:hover {
		border-color: var(--color-primary);
		background: var(--color-surface-elevated);
		transform: translateY(-1px);
		box-shadow: var(--shadow-sm);
	}

	.manage-icon {
		font-size: 1.25rem;
	}

	.manage-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.manage-count {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		background: var(--color-surface-elevated);
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-full);
	}

	.manage-summary {
		font-size: 0.675rem;
		color: var(--color-text-muted);
	}

	.summary-active {
		color: #22c55e;
		font-weight: 600;
	}

	.summary-muted {
		opacity: 0.7;
	}

	/* Plans Grid */
	.plans-section {
		margin-bottom: 2rem;
	}

	.plans-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.plans-section h2 {
		margin: 0;
	}

	/* Interval Toggle */
	.interval-toggle {
		display: flex;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: 3px;
		gap: 2px;
	}

	.interval-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.875rem;
		border: none;
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.8rem;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition: all var(--transition-fast);
		white-space: nowrap;
	}

	.interval-btn:hover {
		color: var(--color-text);
	}

	.interval-btn.active {
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		box-shadow: var(--shadow-sm);
	}

	.save-badge {
		display: inline-block;
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-full);
		background: var(--color-success);
		color: white;
		font-size: 0.65rem;
		font-weight: 700;
		line-height: 1.3;
	}

	.interval-btn.active .save-badge {
		background: rgba(255, 255, 255, 0.25);
		color: white;
	}

	.price-equiv {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin-top: 0.125rem;
	}

	.plans-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	@media (max-width: 600px) {
		.plans-grid {
			grid-template-columns: 1fr;
		}
	}

	.plan-card {
		position: relative;
		background: var(--color-surface);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.plan-card:hover {
		border-color: var(--color-border-strong);
	}

	.plan-card.pro {
		border-color: var(--color-primary);
	}

	.plan-card.pro:hover {
		box-shadow:
			0 0 0 1px var(--color-primary),
			var(--shadow-md);
	}

	.plan-card.current {
		border-color: var(--color-success);
		background: var(--color-success-soft);
	}

	.current-label,
	.recommended-label {
		position: absolute;
		top: -0.6rem;
		left: 1rem;
		padding: 0.1rem 0.6rem;
		border-radius: var(--radius-full);
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.current-label {
		background: var(--color-success);
		color: white;
	}

	.recommended-label {
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
	}

	.plan-card-header {
		margin-bottom: 1rem;
	}

	.plan-card-header h3 {
		font-size: 1.1rem;
		font-weight: 700;
		margin: 0 0 0.375rem;
		color: var(--color-text);
	}

	.plan-price {
		display: flex;
		align-items: baseline;
		gap: 0.125rem;
	}

	.price-amount {
		font-size: 1.75rem;
		font-weight: 800;
		color: var(--color-text);
	}

	.price-period {
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	/* Plan Features */
	.plan-features {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.plan-features li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.feature-icon {
		flex-shrink: 0;
		width: 1.25rem;
		text-align: center;
		color: var(--color-success);
		font-weight: 700;
	}

	.feature-icon.pro {
		color: var(--color-primary);
	}

	.plan-card-footer {
		margin-top: auto;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border-light);
	}

	.plan-note {
		display: block;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		text-align: center;
	}

	/* FAQ Section */
	.faq-section {
		margin-bottom: 2rem;
	}

	/* Billing History Section */
	.history-section {
		margin-bottom: 2rem;
	}

	.history-empty {
		text-align: center;
		padding: 2rem 1rem;
		background: var(--color-surface);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
	}

	.empty-icon {
		font-size: 2rem;
		display: block;
		margin-bottom: 0.5rem;
	}

	.history-empty p {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.history-timeline {
		display: flex;
		flex-direction: column;
	}

	.history-event {
		display: flex;
		gap: 0.75rem;
		position: relative;
	}

	.history-event.admin-event .event-content {
		border-left: 2px solid var(--color-warning);
	}

	.event-indicator {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex-shrink: 0;
		width: 1rem;
		padding-top: 0.375rem;
	}

	.event-dot {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
		flex-shrink: 0;
		z-index: 1;
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
	.dot-admin {
		background: var(--color-primary);
	}
	.dot-info {
		background: var(--color-accent, #3b82f6);
	}
	.dot-neutral {
		background: var(--color-text-muted);
	}

	.event-line {
		width: 2px;
		flex: 1;
		background: var(--color-border);
		margin-top: 0.25rem;
	}

	.history-event:last-child .event-line {
		display: none;
	}

	.event-content {
		flex: 1;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.75rem 1rem;
		margin-bottom: 0.5rem;
	}

	.event-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.375rem;
		flex-wrap: wrap;
	}

	.event-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-full);
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.badge-success {
		background: var(--color-success-soft);
		color: var(--color-success);
	}

	.badge-danger {
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}

	.badge-warning {
		background: var(--color-warning-soft);
		color: var(--color-warning);
	}

	.badge-admin {
		background: color-mix(in srgb, var(--color-primary) 15%, transparent);
		color: var(--color-primary);
	}

	.badge-info {
		background: color-mix(in srgb, var(--color-accent, #3b82f6) 15%, transparent);
		color: var(--color-accent, #3b82f6);
	}

	.badge-neutral {
		background: var(--color-surface-elevated);
		color: var(--color-text-muted);
	}

	.event-date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.event-description {
		margin: 0 0 0.25rem;
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		line-height: 1.4;
	}

	.event-amount {
		display: inline-block;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text);
		margin-right: 0.5rem;
	}

	.event-plan-change {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.25rem;
		font-size: 0.8rem;
	}

	.plan-pill-sm {
		display: inline-block;
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-full);
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: capitalize;
	}

	.plan-pill-sm.free {
		background: var(--color-surface-elevated);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	.plan-pill-sm.pro {
		background: linear-gradient(
			135deg,
			var(--color-primary-button),
			var(--color-primary-button-hover)
		);
		color: var(--color-primary-button-text);
	}

	.plan-pill-sm.enterprise {
		background: var(--color-warning);
		color: white;
	}

	.event-plan-change .arrow {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	.event-actor {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
		font-style: italic;
	}

	.event-changes {
		margin-top: 0.375rem;
		font-size: 0.8rem;
	}

	.event-changes summary {
		cursor: pointer;
		color: var(--color-primary);
		font-weight: 600;
		font-size: 0.75rem;
		user-select: none;
	}

	.event-changes summary:hover {
		text-decoration: underline;
	}

	.event-changes ul {
		margin: 0.25rem 0 0;
		padding-left: 1.25rem;
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		line-height: 1.6;
	}

	.event-changes li {
		font-family: var(--font-mono, monospace);
	}

	.history-more {
		text-align: center;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin-top: 0.75rem;
	}

	.faq-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.faq-item {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.faq-item summary {
		padding: 0.875rem 1rem;
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
		color: var(--color-text);
		transition: background var(--transition-fast);
		list-style: none;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.faq-item summary::before {
		content: '▸';
		transition: transform var(--transition-fast);
		flex-shrink: 0;
		color: var(--color-text-muted);
	}

	.faq-item[open] summary::before {
		transform: rotate(90deg);
	}

	.faq-item summary:hover {
		background: var(--color-surface-elevated);
	}

	.faq-item summary::-webkit-details-marker {
		display: none;
	}

	.faq-item p {
		margin: 0;
		padding: 0 1rem 1rem 2rem;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		line-height: 1.6;
	}

	.inline-logo {
		height: 1.2em;
		width: auto;
		vertical-align: middle;
		border-radius: 4px;
	}
</style>
