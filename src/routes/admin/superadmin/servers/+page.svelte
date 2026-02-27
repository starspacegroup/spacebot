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
						<th class="numeric">Cmds</th>
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
							<td class="server-cell">
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
							</td>
							<td>
								<span class="plan-badge {getPlanBadgeClass(plan)}">
									{planTiers[plan]?.label || 'Free'}
								</span>
							</td>
							<td class="numeric">{formatNumber(server.approximate_member_count)}</td>
							<td class="numeric">{formatLimit(planData.max_commands ?? planTiers.free?.max_commands)}</td>
							<td class="numeric">{formatLimit(planData.max_automations ?? planTiers.free?.max_automations)}</td>
							<td class="date-cell">
								{#if planData.expires_at}
									{formatDate(planData.expires_at)}
								{:else}
									<span class="text-muted">—</span>
								{/if}
							</td>
							<td class="actions-cell">
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
		margin-bottom: 1.5rem;
	}
	
	.page-header h1 {
		font-size: 1.5rem;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	
	.header-subtitle {
		color: var(--text-secondary, #aaa);
		font-size: 0.9rem;
		margin: 0.25rem 0 0;
	}
	
	/* Toast */
	.toast {
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		margin-bottom: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	.toast-success { background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); }
	.toast-error { background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
	.toast-close { background: none; border: none; color: inherit; cursor: pointer; margin-left: auto; }
	
	/* Plan Summary Pills */
	.plan-summary {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}
	
	.plan-pill {
		padding: 0.4rem 0.9rem;
		border-radius: 2rem;
		border: 1px solid var(--border-color, #333);
		background: transparent;
		color: var(--text-secondary, #aaa);
		cursor: pointer;
		font-size: 0.85rem;
		transition: all 0.15s ease;
	}
	.plan-pill:hover { border-color: var(--text-primary, #fff); color: var(--text-primary, #fff); }
	.plan-pill.active { background: var(--accent-bg, rgba(99, 102, 241, 0.15)); color: var(--accent-color, #818cf8); border-color: var(--accent-color, #818cf8); }
	
	/* Search */
	.search-bar { margin-bottom: 1rem; }
	.search-input {
		width: 100%;
		max-width: 400px;
		padding: 0.6rem 1rem;
		border-radius: 0.5rem;
		border: 1px solid var(--border-color, #333);
		background: var(--input-bg, #0d0d1a);
		color: var(--text-primary, #fff);
		font-size: 0.9rem;
	}
	.search-input::placeholder { color: var(--text-secondary, #666); }
	
	/* Table */
	.table-wrapper {
		overflow-x: auto;
		border-radius: 0.75rem;
		border: 1px solid var(--border-color, #333);
	}
	
	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	
	.data-table th,
	.data-table td {
		padding: 0.75rem 1rem;
		text-align: left;
		border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.06));
	}
	
	.data-table th {
		background: var(--card-bg, #1a1a2e);
		color: var(--text-secondary, #aaa);
		font-weight: 600;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		position: sticky;
		top: 0;
	}
	
	.data-table tbody tr:hover {
		background: rgba(255, 255, 255, 0.02);
	}
	
	.numeric { text-align: right; }
	
	/* Server cell */
	.server-cell {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	
	.server-icon {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		object-fit: cover;
	}
	
	.server-icon-placeholder {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--accent-bg, rgba(99, 102, 241, 0.2));
		color: var(--accent-color, #818cf8);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.85rem;
	}
	
	.server-info {
		display: flex;
		flex-direction: column;
	}
	
	.server-name {
		font-weight: 600;
		color: var(--text-primary, #fff);
	}
	
	.server-id {
		font-size: 0.75rem;
		color: var(--text-secondary, #666);
		font-family: monospace;
	}
	
	/* Plan Badges */
	.plan-badge {
		padding: 0.2rem 0.6rem;
		border-radius: 1rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.badge-free { background: rgba(100, 116, 139, 0.2); color: #94a3b8; }
	.badge-pro { background: rgba(99, 102, 241, 0.2); color: #818cf8; }
	.badge-enterprise { background: rgba(234, 179, 8, 0.2); color: #facc15; }
	
	.date-cell { font-size: 0.85rem; color: var(--text-secondary, #aaa); }
	.text-muted { color: var(--text-secondary, #666); }
	
	.actions-cell {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	
	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		border: 1px solid transparent;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 500;
		text-decoration: none;
		transition: all 0.15s ease;
		white-space: nowrap;
	}
	.btn-sm { padding: 0.3rem 0.65rem; font-size: 0.8rem; }
	.btn-primary { background: var(--accent-color, #6366f1); color: #fff; }
	.btn-primary:hover { opacity: 0.9; }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-secondary { background: transparent; border-color: var(--border-color, #333); color: var(--text-secondary, #aaa); }
	.btn-secondary:hover { border-color: var(--text-primary, #fff); color: var(--text-primary, #fff); }
	.btn-danger { background: rgba(239, 68, 68, 0.15); color: #ef4444; border-color: rgba(239, 68, 68, 0.3); }
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
		padding: 1rem;
	}
	
	.modal {
		background: var(--card-bg, #1a1a2e);
		border: 1px solid var(--border-color, #333);
		border-radius: 1rem;
		width: 100%;
		max-width: 600px;
		max-height: 90vh;
		overflow-y: auto;
	}
	
	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border-color, #333);
	}
	
	.modal-header h2 {
		margin: 0;
		font-size: 1.1rem;
	}
	
	.modal-close {
		background: none;
		border: none;
		color: var(--text-secondary, #aaa);
		cursor: pointer;
		font-size: 1.2rem;
		padding: 0.25rem;
	}
	
	.modal-body { padding: 1.5rem; }
	
	.modal-footer {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--border-color, #333);
	}
	
	/* Form */
	.form-group {
		margin-bottom: 1rem;
	}
	
	.form-group label {
		display: block;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-secondary, #aaa);
		margin-bottom: 0.35rem;
	}
	
	.form-group small {
		font-size: 0.75rem;
		color: var(--text-secondary, #666);
		margin-top: 0.25rem;
		display: block;
	}
	
	.form-input,
	.form-select,
	.form-textarea {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		border: 1px solid var(--border-color, #333);
		background: var(--input-bg, #0d0d1a);
		color: var(--text-primary, #fff);
		font-size: 0.9rem;
	}
	
	.form-textarea { resize: vertical; font-family: inherit; }
	
	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0 1rem;
	}
	
	/* Empty state */
	.empty-state {
		text-align: center;
		padding: 3rem;
		color: var(--text-secondary, #aaa);
	}
	.empty-icon { font-size: 2.5rem; margin-bottom: 0.5rem; }
	
	@media (max-width: 768px) {
		.data-table th,
		.data-table td {
			padding: 0.5rem;
			font-size: 0.8rem;
		}
		
		.server-cell { gap: 0.5rem; }
		.form-grid { grid-template-columns: 1fr; }
	}
</style>
