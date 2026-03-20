<script>
	import { invalidateAll } from '$app/navigation';
	
	let { data } = $props();
	
	const servers = $derived(data?.servers ?? []);
	const planTiers = $derived(data?.planTiers ?? {});
	
	// State
	let search = $state('');
	let filterPlan = $state('all');
	let editingServer = $state(null);
	let saving = $state(false);
	let toast = $state(null);
	
	// Filtered servers
	const filteredServers = $derived(() => {
		let list = servers;
		if (search) {
			const q = search.toLowerCase();
			list = list.filter(s => 
				s.name?.toLowerCase().includes(q) || 
				s.guild_id?.includes(q)
			);
		}
		if (filterPlan !== 'all') {
			list = list.filter(s => (s.plan?.plan || 'free') === filterPlan);
		}
		return list;
	});
	
	// Plan counts
	const planCounts = $derived(() => {
		const counts = { free: 0, pro: 0, enterprise: 0 };
		for (const s of servers) {
			const tier = s.plan?.plan || 'free';
			if (counts[tier] !== undefined) counts[tier]++;
		}
		return counts;
	});
	
	function formatNumber(num) {
		return new Intl.NumberFormat().format(num || 0);
	}
	
	function formatDate(dateStr) {
		if (!dateStr) return 'Never';
		return new Date(dateStr).toLocaleDateString('en-US', { 
			month: 'short', day: 'numeric', year: 'numeric' 
		});
	}
	
	function getPlanBadgeClass(plan) {
		switch (plan) {
			case 'pro': return 'badge-pro';
			case 'enterprise': return 'badge-enterprise';
			default: return 'badge-free';
		}
	}
	
	function startEditPlan(server) {
		const plan = server.plan || {};
		const tier = plan.plan || 'free';
		const defaults = planTiers[tier] || planTiers.free;
		editingServer = {
			guild_id: server.guild_id,
			name: server.name,
			plan: tier,
			max_commands: plan.max_commands ?? defaults.max_commands,
			max_automations: plan.max_automations ?? defaults.max_automations,
			max_api_keys: plan.max_api_keys ?? defaults.max_api_keys,
			max_webhooks: plan.max_webhooks ?? defaults.max_webhooks,
			log_retention_days: plan.log_retention_days ?? defaults.log_retention_days,
			stats_retention_days: plan.stats_retention_days ?? defaults.stats_retention_days,
			price_cents: plan.price_cents ?? defaults.price_cents,
			billing_email: plan.billing_email || '',
			billing_notes: plan.billing_notes || '',
			expires_at: plan.expires_at || '',
		};
	}
	
	function onTierChange() {
		if (!editingServer) return;
		const defaults = planTiers[editingServer.plan] || planTiers.free;
		editingServer.max_commands = defaults.max_commands;
		editingServer.max_automations = defaults.max_automations;
		editingServer.max_api_keys = defaults.max_api_keys;
		editingServer.max_webhooks = defaults.max_webhooks;
		editingServer.log_retention_days = defaults.log_retention_days;
		editingServer.stats_retention_days = defaults.stats_retention_days;
		editingServer.price_cents = defaults.price_cents;
	}
	
	async function savePlan() {
		if (!editingServer) return;
		saving = true;
		toast = null;
		
		try {
			const response = await fetch(`/api/superadmin/servers/${editingServer.guild_id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					plan: editingServer.plan,
					max_commands: editingServer.max_commands,
					max_automations: editingServer.max_automations,
					max_api_keys: editingServer.max_api_keys,
					max_webhooks: editingServer.max_webhooks,
					log_retention_days: editingServer.log_retention_days,
					stats_retention_days: editingServer.stats_retention_days,
					price_cents: editingServer.price_cents,
					billing_email: editingServer.billing_email || null,
					billing_notes: editingServer.billing_notes || null,
					expires_at: editingServer.expires_at || null,
				}),
			});
			
			const result = await response.json();
			
			if (response.ok) {
				toast = { type: 'success', message: `Plan updated for ${editingServer.name}` };
				editingServer = null;
				await invalidateAll();
			} else {
				toast = { type: 'error', message: result.error || 'Failed to save plan' };
			}
		} catch (error) {
			toast = { type: 'error', message: error.message };
		} finally {
			saving = false;
		}
	}
	
	async function resetPlan(server) {
		if (!confirm(`Reset ${server.name} to the Free plan? This will remove any custom limits.`)) return;
		
		try {
			const response = await fetch(`/api/superadmin/servers/${server.guild_id}`, {
				method: 'DELETE',
			});
			
			if (response.ok) {
				toast = { type: 'success', message: `${server.name} reset to Free plan` };
				await invalidateAll();
			} else {
				const result = await response.json();
				toast = { type: 'error', message: result.error || 'Failed to reset plan' };
			}
		} catch (error) {
			toast = { type: 'error', message: error.message };
		}
	}
	
	function formatLimit(val) {
		if (val === null || val === undefined) return '∞';
		return val.toString();
	}
</script>

<svelte:head>
	<title>Server Management | Superadmin | SpaceBot</title>
</svelte:head>

<div class="servers-management">
	<header class="page-header">
		<div class="header-text">
			<h1>
				<span class="header-icon">🏠</span>
				Server Management
			</h1>
			<p class="header-subtitle">{servers.length} servers tracked</p>
		</div>
	</header>
	
	{#if toast}
		<div class="toast toast-{toast.type}">
			<span>{toast.type === 'success' ? '✓' : '✗'}</span> {toast.message}
			<button class="toast-close" onclick={() => toast = null}>✕</button>
		</div>
	{/if}
	
	<!-- Plan Summary -->
	<div class="plan-summary">
		<button class="plan-pill {filterPlan === 'all' ? 'active' : ''}" onclick={() => filterPlan = 'all'}>
			All ({servers.length})
		</button>
		<button class="plan-pill plan-free {filterPlan === 'free' ? 'active' : ''}" onclick={() => filterPlan = 'free'}>
			Free ({planCounts().free})
		</button>
		<button class="plan-pill plan-pro {filterPlan === 'pro' ? 'active' : ''}" onclick={() => filterPlan = 'pro'}>
			Pro ({planCounts().pro})
		</button>
		<button class="plan-pill plan-enterprise {filterPlan === 'enterprise' ? 'active' : ''}" onclick={() => filterPlan = 'enterprise'}>
			Enterprise ({planCounts().enterprise})
		</button>
	</div>
	
	<!-- Search -->
	<div class="search-bar">
		<input 
			type="text" 
			placeholder="Search servers by name or ID..." 
			bind:value={search}
			class="search-input"
		/>
	</div>
	
	<!-- Editing Modal -->
	{#if editingServer}
		<div class="modal-backdrop" onclick={() => editingServer = null} role="presentation">
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_interactive_supports_focus -->
			<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
				<div class="modal-header">
					<h2>Edit Plan — {editingServer.name}</h2>
					<button class="modal-close" onclick={() => editingServer = null}>✕</button>
				</div>
				<div class="modal-body">
					<div class="form-group">
						<label for="plan-tier">Plan Tier</label>
						<select id="plan-tier" bind:value={editingServer.plan} onchange={onTierChange} class="form-select">
							{#each Object.entries(planTiers) as [key, tier]}
								<option value={key}>{tier.label}</option>
							{/each}
						</select>
					</div>
					
					<div class="form-grid">
						<div class="form-group">
							<label for="max-commands">Max Commands</label>
							<input id="max-commands" type="number" bind:value={editingServer.max_commands} class="form-input" placeholder="null = unlimited" />
							<small>Leave empty for unlimited</small>
						</div>
						<div class="form-group">
							<label for="max-automations">Max Automations</label>
							<input id="max-automations" type="number" bind:value={editingServer.max_automations} class="form-input" placeholder="null = unlimited" />
						</div>
						<div class="form-group">
							<label for="max-api-keys">Max API Keys</label>
							<input id="max-api-keys" type="number" bind:value={editingServer.max_api_keys} class="form-input" />
						</div>
						<div class="form-group">
							<label for="max-webhooks">Max Webhooks</label>
							<input id="max-webhooks" type="number" bind:value={editingServer.max_webhooks} class="form-input" />
						</div>
						<div class="form-group">
							<label for="log-retention">Log Retention (days)</label>
							<input id="log-retention" type="number" bind:value={editingServer.log_retention_days} class="form-input" />
						</div>
						<div class="form-group">
							<label for="stats-retention">Stats Retention (days)</label>
							<input id="stats-retention" type="number" bind:value={editingServer.stats_retention_days} class="form-input" />
						</div>
					</div>
					
					<div class="form-grid">
						<div class="form-group">
							<label for="price">Monthly Price (cents)</label>
							<input id="price" type="number" bind:value={editingServer.price_cents} class="form-input" />
							<small>${((editingServer.price_cents || 0) / 100).toFixed(2)}/mo</small>
						</div>
						<div class="form-group">
							<label for="expires">Expires At</label>
							<input id="expires" type="date" bind:value={editingServer.expires_at} class="form-input" />
						</div>
					</div>
					
					<div class="form-group">
						<label for="billing-email">Billing Email</label>
						<input id="billing-email" type="email" bind:value={editingServer.billing_email} class="form-input" placeholder="Optional" />
					</div>
					<div class="form-group">
						<label for="billing-notes">Billing Notes</label>
						<textarea id="billing-notes" bind:value={editingServer.billing_notes} class="form-textarea" rows="2" placeholder="Internal notes..."></textarea>
					</div>
				</div>
				<div class="modal-footer">
					<button class="btn btn-primary" onclick={savePlan} disabled={saving}>
						{saving ? 'Saving...' : 'Save Plan'}
					</button>
					<button class="btn btn-secondary" onclick={() => editingServer = null}>
						Cancel
					</button>
				</div>
			</div>
		</div>
	{/if}
	
	<!-- Server Table -->
	{#if filteredServers().length > 0}
		<div class="table-wrapper">
			<table class="data-table">
				<thead>
					<tr>
						<th>Server</th>
						<th>Plan</th>
						<th class="numeric">Members</th>
						<th class="numeric">Commands</th>
						<th class="numeric">Automations</th>
						<th>Expires</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredServers() as server (server.guild_id)}
						{@const plan = server.plan?.plan || 'free'}
						{@const planData = server.plan || {}}
						<tr>
							<td>
								<a href="/admin/{server.guild_id}" class="server-cell">
									{#if server.icon}
										<img 
											src="https://cdn.discordapp.com/icons/{server.guild_id}/{server.icon}.png?size=32" 
											alt=""
											class="server-icon"
										/>
									{:else}
										<div class="server-icon-placeholder">
											{server.name?.charAt(0).toUpperCase() || '?'}
										</div>
									{/if}
									<div class="server-info">
										<span class="server-name">{server.name}</span>
										<span class="server-id">{server.guild_id}</span>
									</div>
								</a>
							</td>
							<td>
								<span class="plan-badge {getPlanBadgeClass(plan)}">
									{planTiers[plan]?.label || 'Free'}
								</span>
							</td>
							<td class="numeric">{formatNumber(server.approximate_member_count)}</td>
							<td class="numeric">
								<span class="usage-counts">
									<span class="usage-active" title="{server.usage.commands_active} active / {server.usage.commands_total} total">{server.usage.commands_active}</span><span class="usage-sep">/</span><span class="usage-total">{server.usage.commands_total}</span>
									<span class="usage-limit">of {formatLimit(server.plan ? planData.max_commands : planTiers.free?.max_commands)}</span>
								</span>
							</td>
							<td class="numeric">
								<span class="usage-counts">
									<span class="usage-active" title="{server.usage.automations_active} active / {server.usage.automations_total} total">{server.usage.automations_active}</span><span class="usage-sep">/</span><span class="usage-total">{server.usage.automations_total}</span>
									<span class="usage-limit">of {formatLimit(server.plan ? planData.max_automations : planTiers.free?.max_automations)}</span>
								</span>
							</td>
							<td class="date-cell">
								{#if planData.expires_at}
									{formatDate(planData.expires_at)}
								{:else}
									<span class="text-muted">—</span>
								{/if}
							</td>
							<td>
								<div class="actions-cell">
									<button class="btn btn-sm btn-secondary" onclick={() => startEditPlan(server)}>
										Edit Plan
									</button>
									{#if plan !== 'free'}
										<button class="btn btn-sm btn-danger" onclick={() => resetPlan(server)}>
											Reset
										</button>
									{/if}
									<a href="/admin/{server.guild_id}" class="btn btn-sm btn-secondary">
										Manage
									</a>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<div class="empty-state">
			<div class="empty-icon">🏠</div>
			<p>No servers match your search.</p>
		</div>
	{/if}
</div>

<style>
	.servers-management {
		max-width: 100%;
	}
	
	.page-header {
		margin-bottom: 1.25rem;
	}

	@media (min-width: 640px) {
		.page-header {
			margin-bottom: 1.5rem;
		}
	}

	.page-header h1 {
		font-size: 1.25rem;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}

	@media (min-width: 640px) {
		.page-header h1 {
			font-size: 1.5rem;
		}
	}

	.header-subtitle {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		margin: 0.25rem 0 0;
	}

	/* Toast */
	.toast {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		margin-bottom: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	.toast-success { background: var(--color-success-soft); color: var(--color-success); border: 1px solid rgba(34, 197, 94, 0.3); }
	.toast-error { background: var(--color-danger-soft); color: var(--color-danger); border: 1px solid rgba(239, 68, 68, 0.3); }
	.toast-close { background: none; border: none; color: inherit; cursor: pointer; margin-left: auto; }

	/* Plan Summary Pills */
	.plan-summary {
		display: flex;
		gap: 0.35rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	@media (min-width: 640px) {
		.plan-summary {
			gap: 0.5rem;
		}
	}

	.plan-pill {
		padding: 0.35rem 0.75rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 0.8rem;
		transition: all var(--transition-fast);
	}

	@media (min-width: 640px) {
		.plan-pill {
			padding: 0.4rem 0.9rem;
			font-size: 0.85rem;
		}
	}

	.plan-pill:hover { border-color: var(--color-text); color: var(--color-text); }
	.plan-pill.active { background: var(--color-accent-soft); color: var(--color-primary); border-color: var(--color-primary); }

	/* Search */
	.search-bar { margin-bottom: 1rem; }
	.search-input {
		width: 100%;
		padding: 0.6rem 1rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
	}

	@media (min-width: 640px) {
		.search-input {
			max-width: 400px;
		}
	}

	.search-input::placeholder { color: var(--color-text-muted); }

	/* Table */
	.table-wrapper {
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		border-radius: var(--radius-lg);
		border: 1px solid var(--color-border);
	}

	.data-table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		font-size: 0.8rem;
		min-width: 700px;
	}

	@media (min-width: 768px) {
		.data-table {
			font-size: 0.9rem;
			min-width: auto;
		}
	}

	.data-table th,
	.data-table td {
		padding: 0.5rem 0.75rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
	}

	@media (min-width: 768px) {
		.data-table th,
		.data-table td {
			padding: 0.75rem 1rem;
		}
	}

	.data-table tbody tr:last-child td {
		border-bottom: none;
	}

	.data-table th {
		background: var(--color-surface);
		color: var(--color-text-muted);
		font-weight: 600;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		position: sticky;
		top: 0;
		white-space: nowrap;
	}

	@media (min-width: 768px) {
		.data-table th {
			font-size: 0.8rem;
			letter-spacing: 0.04em;
		}
	}

	.data-table tbody tr:hover {
		background: var(--color-surface-hover);
	}

	.numeric { text-align: right; }

	/* Server cell */
	.server-cell {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		text-decoration: none;
		color: inherit;
	}

	@media (min-width: 768px) {
		.server-cell {
			gap: 0.75rem;
		}
	}

	.server-cell:hover .server-name {
		color: var(--color-primary);
	}

	.server-icon {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	@media (min-width: 768px) {
		.server-icon {
			width: 32px;
			height: 32px;
		}
	}

	.server-icon-placeholder {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--color-accent-soft);
		color: var(--color-primary);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	@media (min-width: 768px) {
		.server-icon-placeholder {
			width: 32px;
			height: 32px;
			font-size: 0.85rem;
		}
	}

	.server-info {
		display: flex;
		flex-direction: column;
	}

	.server-name {
		font-weight: 600;
		color: var(--color-text);
		transition: color var(--transition-fast);
	}

	.server-id {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		font-family: monospace;
	}

	@media (min-width: 768px) {
		.server-id {
			font-size: 0.75rem;
		}
	}

	/* Plan Badges */
	.plan-badge {
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-full);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	@media (min-width: 768px) {
		.plan-badge {
			padding: 0.2rem 0.6rem;
			font-size: 0.75rem;
		}
	}

	.badge-free { background: rgba(100, 116, 139, 0.2); color: #94a3b8; }
	.badge-pro { background: rgba(99, 102, 241, 0.2); color: #818cf8; }
	.badge-enterprise { background: rgba(234, 179, 8, 0.2); color: #facc15; }

	/* Usage counts */
	.usage-counts {
		display: inline-flex;
		align-items: baseline;
		gap: 0.15rem;
		font-variant-numeric: tabular-nums;
	}
	.usage-active {
		color: var(--color-text);
		font-weight: 600;
	}
	.usage-sep {
		color: var(--color-text-light);
		font-size: 0.8em;
	}
	.usage-total {
		color: var(--color-text-muted);
		font-size: 0.85em;
	}
	.usage-limit {
		color: var(--color-text-light);
		font-size: 0.75em;
		margin-left: 0.25rem;
	}

	.date-cell { font-size: 0.85rem; color: var(--color-text-muted); }
	.text-muted { color: var(--color-text-muted); }

	.actions-cell {
		display: inline-flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.75rem;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		cursor: pointer;
		font-size: 0.8rem;
		font-weight: 500;
		text-decoration: none;
		transition: all var(--transition-fast);
		white-space: nowrap;
	}

	@media (min-width: 640px) {
		.btn {
			padding: 0.5rem 1rem;
			font-size: 0.85rem;
		}
	}

	.btn-sm { padding: 0.3rem 0.65rem; font-size: 0.75rem; }

	@media (min-width: 640px) {
		.btn-sm { font-size: 0.8rem; }
	}

	.btn-primary { background: var(--color-primary-button); color: var(--color-primary-button-text); }
	.btn-primary:hover { background: var(--color-primary-button-hover); }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-secondary { background: transparent; border-color: var(--color-border); color: var(--color-text-muted); }
	.btn-secondary:hover { border-color: var(--color-text); color: var(--color-text); }
	.btn-danger { background: var(--color-danger-soft); color: var(--color-danger); border-color: rgba(239, 68, 68, 0.3); }
	.btn-danger:hover { background: rgba(239, 68, 68, 0.25); }

	/* Modal */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 0.75rem;
	}

	@media (min-width: 640px) {
		.modal-backdrop {
			padding: 1rem;
		}
	}

	.modal {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		width: 100%;
		max-width: 600px;
		max-height: 90vh;
		overflow-y: auto;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
	}

	@media (min-width: 640px) {
		.modal-header {
			padding: 1.25rem 1.5rem;
		}
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1rem;
		color: var(--color-text);
	}

	@media (min-width: 640px) {
		.modal-header h2 {
			font-size: 1.1rem;
		}
	}

	.modal-close {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 1.2rem;
		padding: 0.25rem;
	}

	.modal-body {
		padding: 1.25rem;
	}

	@media (min-width: 640px) {
		.modal-body {
			padding: 1.5rem;
		}
	}

	.modal-footer {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		padding: 1rem 1.25rem;
		border-top: 1px solid var(--color-border);
	}

	@media (min-width: 640px) {
		.modal-footer {
			padding: 1rem 1.5rem;
		}
	}

	/* Form */
	.form-group {
		margin-bottom: 1rem;
	}

	.form-group label {
		display: block;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-muted);
		margin-bottom: 0.35rem;
	}

	.form-group small {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
		display: block;
	}

	.form-input,
	.form-select,
	.form-textarea {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
	}

	.form-textarea { resize: vertical; font-family: inherit; }

	.form-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0 1rem;
	}

	@media (min-width: 640px) {
		.form-grid {
			grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		}
	}

	/* Empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 2rem 1rem;
		color: var(--color-text-muted);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	@media (min-width: 640px) {
		.empty-state {
			padding: 3rem 1.5rem;
		}
	}

	.empty-icon { font-size: 2.5rem; margin-bottom: 0.5rem; }
</style>
