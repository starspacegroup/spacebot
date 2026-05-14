<script>
	import Toast from '$lib/components/Toast.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { untrack } from 'svelte';
	
	let { data } = $props();
	
	let toastMessage = $state(null);
	let toastSuccess = $state(true);
	let showToast = $state(false);
	let portalLoading = $state(null); // guildId of server currently loading portal
	
	// Active section for navigation
	let activeSection = $state('profile');

	// -------------------------------------------------------------------------
	// Runner state
	// -------------------------------------------------------------------------
	let runnerTokens = $state(untrack(() => data.runnerTokens ?? []));
	let runnerJobs = $state(untrack(() => data.runnerJobs ?? []));
	let runnerInstances = $state(untrack(() => data.runnerInstances ?? []));

	// Create-token form
	let newRunnerName = $state('');
	let creatingRunner = $state(false);
	// Shown ONCE after creation – user must copy it before dismissing
	let newRawToken = $state(null);
	let newRawTokenCopied = $state(false);

	// Dispatch-job form
	let dispatchTokenId = $state(null); // which runner to dispatch to
	let dispatchCommand = $state('');
	let dispatchWorkDir = $state('');
	let dispatchLabel = $state('');
	let dispatching = $state(false);
	let copilotPrompt = $state('');

	/** Returns true if the runner checked in within the last 45 seconds */
	function isRunnerOnline(token) {
		if (!token.last_seen_at) return false;
		const age = Date.now() - new Date(token.last_seen_at + 'Z').getTime();
		return age < 45_000;
	}

	async function createRunner() {
		if (!newRunnerName.trim()) return;
		creatingRunner = true;
		try {
			const res = await fetch('/api/account/runners', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newRunnerName.trim() }),
			});
			const body = await res.json();
			if (!res.ok) {
				toastMessage = body.error || 'Failed to create runner';
				toastSuccess = false;
				showToast = true;
				return;
			}
			runnerTokens = [body.token, ...runnerTokens];
			newRawToken = body.rawToken;
			newRawTokenCopied = false;
			newRunnerName = '';
		} catch {
			toastMessage = 'Network error. Please try again.';
			toastSuccess = false;
			showToast = true;
		} finally {
			creatingRunner = false;
		}
	}

	async function revokeRunner(id) {
		if (!confirm('Revoke this runner token? The runner will stop working immediately.')) return;
		try {
			const res = await fetch(`/api/account/runners/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				const body = await res.json();
				toastMessage = body.error || 'Failed to revoke runner';
				toastSuccess = false;
				showToast = true;
				return;
			}
			runnerTokens = runnerTokens.map(t => t.id === id ? { ...t, revoked: true } : t);
			toastMessage = 'Runner revoked.';
			toastSuccess = true;
			showToast = true;
		} catch {
			toastMessage = 'Network error. Please try again.';
			toastSuccess = false;
			showToast = true;
		}
	}

	async function dispatchJob() {
		if (!dispatchCommand.trim() || !dispatchTokenId) return;
		dispatching = true;
		try {
			const res = await fetch(`/api/account/runners/${dispatchTokenId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					command: dispatchCommand.trim(),
					working_dir: dispatchWorkDir.trim() || undefined,
					label: dispatchLabel.trim() || undefined,
				}),
			});
			const body = await res.json();
			if (!res.ok) {
				toastMessage = body.error || 'Failed to queue job';
				toastSuccess = false;
				showToast = true;
				return;
			}
			toastMessage = `Job #${body.jobId} queued — runner will pick it up shortly.`;
			toastSuccess = true;
			showToast = true;
			dispatchCommand = '';
			dispatchWorkDir = '';
			dispatchLabel = '';
			dispatchTokenId = null;
			// Refresh job list
			const listRes = await fetch('/api/account/runners');
			if (listRes.ok) {
				const listBody = await listRes.json();
				runnerJobs = listBody.jobs || runnerJobs;
				runnerInstances = listBody.instances || runnerInstances;
			}
		} catch {
			toastMessage = 'Network error. Please try again.';
			toastSuccess = false;
			showToast = true;
		} finally {
			dispatching = false;
		}
	}

	async function queueTypedJob(tokenId, jobType, payload = {}, label = null, targetInstanceId = undefined) {
		dispatching = true;
		try {
			const res = await fetch(`/api/account/runners/${tokenId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					job_type: jobType,
					payload_json: payload,
					label,
					target_instance_id: targetInstanceId,
				}),
			});
			const body = await res.json();
			if (!res.ok) {
				toastMessage = body.error || `Failed to queue ${jobType}`;
				toastSuccess = false;
				showToast = true;
				return;
			}

			toastMessage = `Job #${body.jobId} queued (${jobType}).`;
			toastSuccess = true;
			showToast = true;

			const listRes = await fetch('/api/account/runners');
			if (listRes.ok) {
				const listBody = await listRes.json();
				runnerJobs = listBody.jobs || runnerJobs;
				runnerInstances = listBody.instances || runnerInstances;
			}
		} catch {
			toastMessage = 'Network error. Please try again.';
			toastSuccess = false;
			showToast = true;
		} finally {
			dispatching = false;
		}
	}

	function instancesForToken(tokenId) {
		return runnerInstances.filter((i) => i.runner_token_id === tokenId);
	}

	function capabilityLabel(instance, key) {
		const caps = instance?.metadata?.capabilities || {};
		return caps[key] ? 'yes' : 'no';
	}

	function copyRawToken() {
		if (!newRawToken) return;
		navigator.clipboard.writeText(newRawToken).then(() => {
			newRawTokenCopied = true;
		});
	}

	function formatJobStatus(status) {
		switch (status) {
			case 'pending': return { label: 'Pending', cls: 'badge-neutral' };
			case 'running': return { label: 'Running', cls: 'badge-info' };
			case 'completed': return { label: 'Done', cls: 'badge-success' };
			case 'failed': return { label: 'Failed', cls: 'badge-danger' };
			case 'canceled': return { label: 'Canceled', cls: 'badge-warning' };
			default: return { label: status, cls: 'badge-neutral' };
		}
	}
	
	const dbUser = $derived(data.dbUser);
	const user = $derived(data.user);
	const serverPlans = $derived(data.serverPlans || []);
	const planTiers = $derived(data.planTiers);
	
	// Billing summary
	const totalServers = $derived(serverPlans.length);
	const proServers = $derived(serverPlans.filter(s => s.plan === 'pro').length);
	const starterServers = $derived(serverPlans.filter(s => s.plan === 'free').length);
	const totalMonthlySpend = $derived(
		serverPlans
			.filter(s => s.stripeSubscriptionId) // Only count paid subscriptions
			.reduce((sum, s) => sum + (s.priceCents || 0), 0)
	);
	
	// Servers with active Stripe billing (have a customer ID)
	const serversWithBilling = $derived(
		serverPlans.filter(s => s.stripeCustomerId)
	);
	
	function getAvatarUrl(userId, avatar, discriminator = '0') {
		if (avatar) {
			const ext = avatar.startsWith('a_') ? 'gif' : 'png';
			return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${ext}?size=128`;
		}
		const index = discriminator === '0' 
			? (BigInt(userId) >> 22n) % 6n
			: parseInt(discriminator) % 5;
		return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
	}
	
	function formatDate(dateStr) {
		if (!dateStr) return 'N/A';
		return new Date(dateStr).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		});
	}
	
	function formatPrice(cents) {
		if (!cents) return 'Starter';
		return `$${(cents / 100).toFixed(2)}`;
	}
	
	function getStatusBadgeClass(plan, stripeStatus, stripeSubscriptionId) {
		if (plan === 'pro' && !stripeSubscriptionId && !['active', 'trialing'].includes(stripeStatus)) return 'badge-admin';
		if (plan === 'pro' && ['active', 'trialing'].includes(stripeStatus)) return 'badge-success';
		if (stripeStatus === 'canceling') return 'badge-warning';
		if (stripeStatus === 'past_due') return 'badge-danger';
		return 'badge-neutral';
	}
	
	function getStatusLabel(plan, stripeStatus, stripeSubscriptionId) {
		if (plan === 'pro' && !stripeSubscriptionId && !['active', 'trialing'].includes(stripeStatus)) return 'Admin Granted';
		if (plan === 'pro' && ['active', 'trialing'].includes(stripeStatus)) return 'Active';
		if (stripeStatus === 'canceling') return 'Canceling';
		if (stripeStatus === 'past_due') return 'Past Due';
		if (plan === 'pro') return 'Pro';
		return 'Starter';
	}
	
	// Aggregate billing history from all servers, sorted by date (newest first)
	const allBillingHistory = $derived(
		serverPlans
			.flatMap(s => (s.recentBilling || []).map(e => ({
				...e,
				guildName: s.guildName,
				guildIcon: s.guildIcon,
				guildId: s.guildId,
			})))
			.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
	);
	
	function getEventIcon(eventType) {
		switch (eventType) {
			case 'checkout_completed': return '🎉';
			case 'plan_upgrade': return '⬆️';
			case 'plan_downgrade': return '⬇️';
			case 'admin_edit': return '🔧';
			case 'payment_success': return '✅';
			case 'payment_failed': return '❌';
			case 'subscription_canceled': return '⏸️';
			case 'subscription_reactivated': return '▶️';
			case 'subscription_renewed': return '🔄';
			case 'plan_reset': return '↩️';
			default: return '📋';
		}
	}
	
	function getEventLabel(eventType) {
		switch (eventType) {
			case 'checkout_completed': return 'Upgrade';
			case 'plan_upgrade': return 'Plan Upgrade';
			case 'plan_downgrade': return 'Downgrade';
			case 'admin_edit': return 'Admin Edit';
			case 'payment_success': return 'Payment';
			case 'payment_failed': return 'Payment Failed';
			case 'subscription_canceled': return 'Canceled';
			case 'subscription_reactivated': return 'Reactivated';
			case 'subscription_renewed': return 'Renewed';
			case 'plan_reset': return 'Plan Reset';
			default: return 'Event';
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
		if (!dateStr) return 'N/A';
		return new Date(dateStr).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
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
					returnUrl: window.location.href,
				}),
			});
			const result = await res.json();
			if (result.url) {
				window.location.href = result.url;
				return;
			}
			if (result.error) {
				toastMessage = result.error;
				toastSuccess = false;
				showToast = true;
			}
		} catch {
			toastMessage = 'Failed to open billing portal. Please try again.';
			toastSuccess = false;
			showToast = true;
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
	<title>My Account | SpaceBot</title>
</svelte:head>

<div class="account-page">
	{#if showToast && toastMessage}
		<Toast message={toastMessage} success={toastSuccess} onDismiss={() => showToast = false} />
	{/if}
	
	<header class="page-header">
		<a href={data.selectedGuildId ? `/admin/${data.selectedGuildId}` : '/admin'} class="back-link">&#8592; Back to Dashboard</a>
		<div class="header-content">
			<h1>
				<span class="header-icon">👤</span>
				My Account
			</h1>
			<p class="header-desc">Manage your profile, billing, and preferences</p>
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
			Profile
		</button>
		<button 
			class="section-nav-item" 
			class:active={activeSection === 'billing'}
			onclick={() => scrollToSection('billing')}
		>
			<span class="nav-icon">💳</span>
			Billing
		</button>
		<button 
			class="section-nav-item" 
			class:active={activeSection === 'payment'}
			onclick={() => scrollToSection('payment')}
		>
			<span class="nav-icon">💰</span>
			Payment
		</button>
		<button 
			class="section-nav-item" 
			class:active={activeSection === 'settings'}
			onclick={() => scrollToSection('settings')}
		>
			<span class="nav-icon">⚙️</span>
			Settings
		</button>
		<button 
			class="section-nav-item" 
			class:active={activeSection === 'runners'}
			onclick={() => scrollToSection('runners')}
		>
			<span class="nav-icon">🖥️</span>
			Runners
		</button>
	</nav>
	
	<!-- Profile Section -->
	<section id="section-profile" class="content-section">
		<h2><span class="section-icon">👤</span> Profile</h2>
		
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
							<span class="detail-label">Email</span>
							<span class="detail-value">{dbUser.email}</span>
						</div>
					{/if}
					<div class="detail-item">
						<span class="detail-label">Member Since</span>
						<span class="detail-value">{formatDate(dbUser?.created_at)}</span>
					</div>
					<div class="detail-item">
						<span class="detail-label">Last Login</span>
						<span class="detail-value">{formatDate(dbUser?.last_login_at)}</span>
					</div>
					<div class="detail-item">
						<span class="detail-label">Login Count</span>
						<span class="detail-value">{dbUser?.login_count || 0}</span>
					</div>
				</div>
			</div>
			
			{#if data.isSuperAdmin}
				<div class="profile-badge superadmin-badge">
					<span class="badge-icon">👑</span>
					<span>Superadmin</span>
				</div>
			{/if}
		</div>
		
		<div class="servers-summary">
			<h3>Your Servers</h3>
			<div class="server-stats-row">
				<div class="stat-chip">
					<span class="stat-value">{totalServers}</span>
					<span class="stat-label">Total</span>
				</div>
				<div class="stat-chip pro">
					<span class="stat-value">{proServers}</span>
					<span class="stat-label">Pro</span>
				</div>
				<div class="stat-chip starter">
					<span class="stat-value">{starterServers}</span>
					<span class="stat-label">Starter</span>
				</div>
			</div>
		</div>
	</section>
	
	<!-- Billing Section -->
	<section id="section-billing" class="content-section">
		<h2><span class="section-icon">💳</span> Billing</h2>
		
		{#if totalMonthlySpend > 0}
			<div class="billing-overview">
				<div class="billing-total">
					<span class="billing-total-label">Current Monthly Spend</span>
					<span class="billing-total-value">{formatPrice(totalMonthlySpend)}<span class="billing-period">/mo</span></span>
				</div>
			</div>
		{/if}
		
		{#if serverPlans.length === 0}
			<div class="empty-state">
				<span class="empty-icon">📭</span>
				<p>No servers found. Add SpaceBot to a server to get started.</p>
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
									{server.plan === 'pro' ? '⚡ Pro' : '🚀 Starter'}
								</span>
								{#if server.stripeStatus}
									<span class="status-badge {getStatusBadgeClass(server.plan, server.stripeStatus)}">
										{getStatusLabel(server.plan, server.stripeStatus)}
									</span>
								{/if}
							</div>
						</div>
						
						{#if server.plan !== 'free'}
							<div class="server-plan-details">
							{#if server.plan === 'pro' && !server.stripeSubscriptionId}
								<div class="plan-detail">
									<span class="plan-detail-label">Price</span>
									<span class="plan-detail-value admin-granted-price">Granted by admin</span>
								</div>
							{:else if server.priceCents}
								<div class="plan-detail">
									<span class="plan-detail-label">Price</span>
									<span class="plan-detail-value">{formatPrice(server.priceCents)}/mo</span>
								</div>
							{/if}
								{#if server.stripeCurrentPeriodEnd}
									<div class="plan-detail">
										<span class="plan-detail-label">{server.stripeStatus === 'canceling' ? 'Access Until' : 'Next Billing'}</span>
										<span class="plan-detail-value">{formatDate(server.stripeCurrentPeriodEnd)}</span>
									</div>
								{/if}
							</div>
						{/if}
						
						<div class="server-plan-actions">
							<a href="/admin/{server.guildId}/account" class="btn btn-secondary btn-sm">
								Manage
							</a>
						</div>
					</div>
				{/each}
			</div>
		{/if}
		
		{#if allBillingHistory.length > 0}
			<div class="billing-history">
				<h3>Billing History</h3>
				<div class="timeline">
					{#each allBillingHistory as event}
						<div class="timeline-item">
							<div class="timeline-dot {getEventDotClass(event.event_type)}"></div>
							<div class="timeline-content">
								<div class="timeline-header">
									<span class="timeline-icon">{getEventIcon(event.event_type)}</span>
									<span class="timeline-label">{getEventLabel(event.event_type)}</span>
									<span class="timeline-server">{event.guildName}</span>
								</div>
								{#if event.description}
									<p class="timeline-desc">{event.description}</p>
								{/if}
								<div class="timeline-meta">
									<span class="timeline-date">{formatDateTime(event.created_at)}</span>
									{#if event.amount_cents}
										<span class="timeline-amount">{formatPrice(event.amount_cents)}</span>
									{/if}
									{#if event.plan_before && event.plan_after}
										<span class="timeline-plan-change">{event.plan_before} → {event.plan_after}</span>
									{/if}
									{#if event.actor_name}
										<span class="timeline-actor">by {event.actor_name}</span>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
		
		<div class="plan-comparison">
			<h3>Plan Comparison</h3>
			<div class="plan-table-wrapper">
				<table class="plan-table">
					<thead>
						<tr>
							<th>Feature</th>
							<th>Starter</th>
							<th class="highlight">Pro</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Commands</td>
							<td>{planTiers.free.max_commands}</td>
							<td class="highlight">Unlimited</td>
						</tr>
						<tr>
							<td>Automations</td>
							<td>{planTiers.free.max_automations}</td>
							<td class="highlight">Unlimited</td>
						</tr>
						<tr>
							<td>API Keys</td>
							<td>{planTiers.free.max_api_keys}</td>
							<td class="highlight">{planTiers.pro.max_api_keys}</td>
						</tr>
						<tr>
							<td>Webhooks</td>
							<td>{planTiers.free.max_webhooks}</td>
							<td class="highlight">{planTiers.pro.max_webhooks}</td>
						</tr>
						<tr>
							<td>Log Retention</td>
							<td>{planTiers.free.log_retention_days} days</td>
							<td class="highlight">Unlimited</td>
						</tr>
						<tr>
							<td>Stats Retention</td>
							<td>{planTiers.free.stats_retention_days} days</td>
							<td class="highlight">Unlimited</td>
						</tr>
						<tr>
							<td>Price</td>
							<td>FREE</td>
							<td class="highlight">{formatPrice(planTiers.pro.price_cents)}/mo</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</section>
	
	<!-- Payment Methods Section -->
	<section id="section-payment" class="content-section">
		<h2><span class="section-icon">💳</span> Payment Methods</h2>
		
		{#if serversWithBilling.length === 0}
			<div class="empty-state">
				<span class="empty-icon">💳</span>
				<p>No payment methods on file. Payment methods are added when you upgrade a server to Pro.</p>
			</div>
		{:else}
			<div class="payment-portal-card">
				<div class="payment-portal-info">
					<h3>Manage Payment Methods</h3>
					<p>Add, update, or remove your credit cards and payment methods. View invoices and receipts.</p>
				</div>
				<button 
					class="btn btn-primary btn-sm" 
					onclick={() => openBillingPortal(serversWithBilling[0].guildId, serversWithBilling[0].guildName)}
					disabled={portalLoading !== null}
				>
					{portalLoading !== null ? 'Opening...' : 'Open Billing Portal'}
				</button>
			</div>
			
			{#if serversWithBilling.some(s => s.stripeSubscriptionId)}
				<div class="active-subscriptions">
					<h4>Active Subscriptions</h4>
					{#each serversWithBilling.filter(s => s.stripeSubscriptionId) as server}
						<div class="subscription-row">
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
								<span class="subscription-name">{server.guildName}</span>
							</div>
							<span class="subscription-price">{formatPrice(server.priceCents)}/mo</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</section>
	
	<!-- Local Runners Section -->
	<section id="section-runners" class="content-section">
		<h2><span class="section-icon">🖥️</span> Local Runners</h2>

		<p class="section-intro">
			Local runners let you run shell commands and scripts on your own machine, triggered from
			SpaceBot. Each runner authenticates with a secret token and polls for queued jobs.
		</p>

		<!-- Token creation -->
		<div class="runner-create-row">
			<input
				class="input runner-name-input"
				type="text"
				placeholder="Runner name (e.g. Home Server)"
				bind:value={newRunnerName}
				onkeydown={(e) => e.key === 'Enter' && createRunner()}
				disabled={creatingRunner}
			/>
			<button class="btn btn-primary btn-sm" onclick={createRunner} disabled={creatingRunner || !newRunnerName.trim()}>
				{creatingRunner ? 'Creating…' : 'Create Runner'}
			</button>
		</div>

		<!-- Show raw token once after creation -->
		{#if newRawToken}
			<div class="token-reveal">
				<p class="token-reveal-warning">
					⚠️ Copy this token now — it won't be shown again.
				</p>
				<div class="token-reveal-row">
					<code class="token-reveal-value">{newRawToken}</code>
					<button class="btn btn-outline btn-sm" onclick={copyRawToken}>
						{newRawTokenCopied ? '✓ Copied' : 'Copy'}
					</button>
				</div>
				<p class="token-reveal-hint">
					Add it to your runner config file as <code>SPACEBOT_RUNNER_TOKEN</code>.
				</p>
				<button class="btn btn-sm btn-ghost" onclick={() => newRawToken = null}>Dismiss</button>
			</div>
		{/if}

		<!-- Runners list -->
		{#if runnerTokens.length === 0}
			<div class="empty-state">
				<span class="empty-icon">🖥️</span>
				No runners yet. Create one above and run <code>bun run scripts/local-runner/index.ts</code> on your machine.
			</div>
		{:else}
			<div class="runners-list">
				{#each runnerTokens as t (t.id)}
					<div class="runner-card" class:revoked={t.revoked}>
						<div class="runner-card-header">
							<div class="runner-identity">
								<span class="runner-status-dot" class:online={!t.revoked && isRunnerOnline(t)}></span>
								<span class="runner-name">{t.name}</span>
								<code class="runner-prefix">{t.token_prefix}…</code>
							</div>
							<div class="runner-meta">
								{#if t.revoked}
									<span class="status-badge badge-danger">Revoked</span>
								{:else if isRunnerOnline(t)}
									<span class="status-badge badge-success">Online</span>
								{:else}
									<span class="status-badge badge-neutral">Offline</span>
								{/if}
								{#if t.last_seen_at}
									<span class="runner-last-seen">Last seen {formatDate(t.last_seen_at)}</span>
								{/if}
								{#if !t.revoked}
									<button class="btn btn-danger btn-sm" onclick={() => revokeRunner(t.id)}>Revoke</button>
									<button class="btn btn-outline btn-sm" onclick={() => { dispatchTokenId = t.id; dispatchCommand = ''; }}>
										Run Script
									</button>
								{/if}
							</div>
						</div>

						{#if instancesForToken(t.id).length > 0}
							<div class="runner-instances">
								{#each instancesForToken(t.id) as inst (inst.id)}
									<div class="runner-instance-row">
										<div class="runner-instance-main">
											<strong>{inst.display_name}</strong>
											<span class="runner-instance-meta">{inst.platform || 'unknown'} / {inst.arch || 'unknown'}</span>
											<span class="runner-instance-meta">screenshots: {capabilityLabel(inst, 'screenshotAvailable')}</span>
											<span class="runner-instance-meta">vscode: {capabilityLabel(inst, 'vscodeControlAvailable')}</span>
											<span class="runner-instance-meta">copilot: {capabilityLabel(inst, 'copilotMessageAvailable')}</span>
										</div>
										{#if !t.revoked}
											<div class="runner-instance-actions">
												<button class="btn btn-outline btn-sm" onclick={() => queueTypedJob(t.id, 'system_profile', {}, 'Collect System Profile', inst.id)} disabled={dispatching}>Profile</button>
												<button class="btn btn-outline btn-sm" onclick={() => queueTypedJob(t.id, 'screenshot_capture', { mode: 'all_displays' }, 'Capture Screenshot', inst.id)} disabled={dispatching}>Screenshot</button>
												<button class="btn btn-outline btn-sm" onclick={() => queueTypedJob(t.id, 'vscode_discover_instances', {}, 'Discover VS Code', inst.id)} disabled={dispatching}>VS Code</button>
											</div>
										{/if}
									</div>
								{/each}
							</div>
						{/if}

						<!-- Inline dispatch form for this runner -->
						{#if dispatchTokenId === t.id}
							<div class="dispatch-form">
								<input
									class="input"
									type="text"
									placeholder="Shell command (e.g. bash ~/scripts/deploy.sh)"
									bind:value={dispatchCommand}
								/>
								<input
									class="input"
									type="text"
									placeholder="Working directory (optional)"
									bind:value={dispatchWorkDir}
								/>
								<input
									class="input"
									type="text"
									placeholder="Label (optional)"
									bind:value={dispatchLabel}
								/>
								<div class="dispatch-actions">
									<button class="btn btn-primary btn-sm" onclick={dispatchJob} disabled={dispatching || !dispatchCommand.trim()}>
										{dispatching ? 'Queuing…' : 'Queue Job'}
									</button>
									<input
										class="input"
										type="text"
										placeholder="Send to Copilot (requires bridge)"
										bind:value={copilotPrompt}
									/>
									<button
										class="btn btn-outline btn-sm"
										onclick={() => queueTypedJob(t.id, 'vscode_send_copilot_message', { message: copilotPrompt }, 'Send Copilot Message')}
										disabled={dispatching || !copilotPrompt.trim()}
									>
										Send to Copilot
									</button>
									<button class="btn btn-ghost btn-sm" onclick={() => dispatchTokenId = null}>Cancel</button>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<!-- Job history -->
		{#if runnerJobs.length > 0}
			<div class="runner-jobs">
				<h3>Recent Jobs</h3>
				<div class="jobs-list">
					{#each runnerJobs as job (job.id)}
						{@const s = formatJobStatus(job.status)}
						<div class="job-card">
							<div class="job-header">
								<span class="job-runner-name">{job.runner_name}</span>
								<span class="status-badge {s.cls}">{s.label}</span>
								{#if job.job_type && job.job_type !== 'shell_command'}
									<span class="job-type-badge">{job.job_type}</span>
								{/if}
								{#if job.exit_code !== null}
									<code class="job-exit-code">exit {job.exit_code}</code>
								{/if}
								<span class="job-time">{formatDate(job.created_at)}</span>
							</div>
							<code class="job-command">{job.label || job.command}</code>
							{#if job.output}
								<pre class="job-output">{job.output.length > 2000 ? job.output.slice(-2000) + '\n…(truncated)' : job.output}</pre>
							{/if}
							{#if job.result_json}
								<pre class="job-result-json">{JSON.stringify(job.result_json, null, 2)}</pre>
							{/if}
							{#if job.artifact_refs_json && job.artifact_refs_json.length > 0}
								<div class="job-artifacts">
									{#each job.artifact_refs_json as a}
										{#if a.id}
											<a class="btn btn-outline btn-sm" href={`/api/account/runners/artifacts/${a.id}?raw=1`} target="_blank" rel="noreferrer">
												Open {a.artifactType || 'Artifact'} #{a.id}
											</a>
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</section>

	<!-- Settings Section -->
	<section id="section-settings" class="content-section">
		<h2><span class="section-icon">⚙️</span> Settings</h2>
		
		<div class="settings-group">
			<div class="setting-item">
				<div class="setting-info">
					<span class="setting-label">Theme</span>
					<span class="setting-desc">Switch between light and dark mode, or follow your system preference.</span>
				</div>
				<div class="setting-control">
					<ThemeToggle />
				</div>
			</div>
		</div>
		
		<div class="settings-group">
			<h3>Connected Account</h3>
			<div class="setting-item">
				<div class="setting-info">
					<span class="setting-label">Discord</span>
					<span class="setting-desc">Logged in as <strong>@{user.username}</strong> via Discord OAuth.</span>
				</div>
				<div class="setting-control">
					<span class="connected-badge">Connected</span>
				</div>
			</div>
		</div>
		
		<div class="settings-group danger-zone">
			<h3>Session</h3>
			<div class="setting-item">
				<div class="setting-info">
					<span class="setting-label">Log Out</span>
					<span class="setting-desc">Sign out of SpaceBot. You'll need to log in again via Discord.</span>
				</div>
				<div class="setting-control">
					<a href="/api/auth/logout" class="btn btn-danger btn-sm">Log Out</a>
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

	:global([data-theme="dark"]) .superadmin-badge {
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
	
	:global([data-theme="dark"]) .badge-admin {
		color: hsl(40, 90%, 65%);
	}
	
	.admin-granted-price {
		color: hsl(35, 80%, 45%);
	}
	
	:global([data-theme="dark"]) .admin-granted-price {
		color: hsl(40, 90%, 65%);
	}
	
	/* Payment Methods Section */
	.payment-portal-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	
	.payment-portal-info h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0 0 0.25rem;
	}
	
	.payment-portal-info p {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		margin: 0;
		line-height: 1.4;
	}
	
	.active-subscriptions {
		margin-top: 1rem;
	}
	
	.active-subscriptions h4 {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin: 0 0 0.5rem;
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
		.payment-portal-card {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.75rem;
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
	
	.dot-success { background: var(--color-success); }
	.dot-danger { background: var(--color-danger); }
	.dot-warning { background: var(--color-warning); }
	.dot-info { background: var(--color-info); }
	.dot-admin { background: hsl(35, 80%, 50%); }
	.dot-neutral { background: var(--color-text-muted); }
	
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
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		font-style: italic;
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

	/* -------------------------------------------------------------------------
	 * Local Runners Section
	 * ----------------------------------------------------------------------- */

	.section-intro {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin: 0 0 1.25rem;
		line-height: 1.5;
	}

	.runner-create-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.runner-name-input {
		flex: 1;
	}

	/* Token reveal banner */
	.token-reveal {
		background: hsla(38, 92%, 50%, 0.08);
		border: 1px solid hsla(38, 92%, 50%, 0.3);
		border-radius: var(--radius-md);
		padding: 1rem 1.25rem;
		margin-bottom: 1.25rem;
	}

	.token-reveal-warning {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-warning);
		margin: 0 0 0.625rem;
	}

	.token-reveal-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		flex-wrap: wrap;
	}

	.token-reveal-value {
		flex: 1;
		font-family: monospace;
		font-size: 0.8125rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 0.375rem 0.625rem;
		word-break: break-all;
		color: var(--color-text);
	}

	.token-reveal-hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		margin: 0 0 0.625rem;
	}

	/* Runner card list */
	.runners-list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		margin-bottom: 1.5rem;
	}

	.runner-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.875rem 1rem;
		transition: border-color var(--transition-fast);
	}

	.runner-card:hover {
		border-color: var(--color-primary);
	}

	.runner-card.revoked {
		opacity: 0.6;
		border-color: var(--color-border);
	}

	.runner-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.runner-identity {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.runner-status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-text-muted);
		flex-shrink: 0;
	}

	.runner-status-dot.online {
		background: var(--color-success);
		box-shadow: 0 0 0 3px hsla(142, 71%, 45%, 0.2);
	}

	.runner-name {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.runner-prefix {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-family: monospace;
	}

	.runner-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.runner-last-seen {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.runner-instances {
		margin-top: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.runner-instance-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.5rem 0.625rem;
		background: var(--color-surface-elevated, hsla(var(--hue), 25%, 96%, 0.2));
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.runner-instance-main {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.runner-instance-meta {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.runner-instance-actions {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	/* Job dispatch form */
	.dispatch-form {
		margin-top: 0.875rem;
		padding-top: 0.875rem;
		border-top: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.dispatch-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	/* Job history */
	.runner-jobs h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0 0 0.75rem;
	}

	.jobs-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.job-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.75rem 1rem;
	}

	.job-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 0.375rem;
	}

	.job-runner-name {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.job-exit-code {
		font-family: monospace;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.job-time {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-left: auto;
	}

	.job-type-badge {
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.125rem 0.375rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated, hsla(var(--hue), 25%, 96%, 0.2));
		color: var(--color-text-muted);
	}

	.job-command {
		display: block;
		font-family: monospace;
		font-size: 0.8125rem;
		color: var(--color-text);
		margin-bottom: 0.375rem;
	}

	.job-output {
		background: var(--color-code-bg, hsla(var(--hue), 10%, 8%, 0.6));
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 0.5rem 0.75rem;
		font-family: monospace;
		font-size: 0.75rem;
		color: var(--color-text);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 200px;
		overflow-y: auto;
		margin: 0;
	}

	.job-result-json {
		margin-top: 0.375rem;
		background: var(--color-surface-elevated, hsla(var(--hue), 25%, 96%, 0.2));
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 0.5rem 0.75rem;
		font-family: monospace;
		font-size: 0.7rem;
		max-height: 180px;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.job-artifacts {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
		margin-top: 0.5rem;
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
