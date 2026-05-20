<script>
	import { goto, invalidateAll } from '$app/navigation';
	import { getAvatarUrl as getDiscordAvatarUrl } from '$lib/utils/avatar.js';
	
	let { data } = $props();
	
	const users = $derived(data?.users ?? []);
	const total = $derived(data?.total ?? 0);
	const currentPage = $derived(data?.page ?? 1);
	const limit = $derived(data?.limit ?? 50);
	const totalPages = $derived(Math.ceil(total / limit));
	
	const initialSearch = $derived(data?.search || '');
	let search = $state('');
	$effect(() => { search = initialSearch; });
	let editingUser = $state(null);
	let saving = $state(false);
	let toast = $state(null);
	
	function formatDate(dateStr) {
		if (!dateStr) return 'Never';
		return new Date(dateStr).toLocaleDateString('en-US', { 
			month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
		});
	}
	
	function getAvatarUrl(user) {
		return getDiscordAvatarUrl(user?.id, user?.avatar, user?.discriminator, 32);
	}
	
	async function doSearch() {
		const params = new URLSearchParams();
		if (search) params.set('search', search);
		await goto(`/admin/superadmin/users?${params.toString()}`, { invalidateAll: true });
	}
	
	async function goToPage(page) {
		const params = new URLSearchParams();
		if (search) params.set('search', search);
		params.set('page', page.toString());
		await goto(`/admin/superadmin/users?${params.toString()}`, { invalidateAll: true });
	}
	
	function startEditUser(user) {
		editingUser = { ...user };
	}
	
	async function saveUser() {
		if (!editingUser) return;
		saving = true;
		toast = null;
		
		try {
			const response = await fetch(`/api/superadmin/users/${editingUser.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					notes: editingUser.notes,
					banned: editingUser.banned,
					is_superadmin: editingUser.is_superadmin,
				}),
			});
			
			const result = await response.json();
			
			if (response.ok) {
				toast = { type: 'success', message: `User ${editingUser.username} updated` };
				editingUser = null;
				await invalidateAll();
			} else {
				toast = { type: 'error', message: result.error || 'Failed to update user' };
			}
		} catch (error) {
			toast = { type: 'error', message: error.message };
		} finally {
			saving = false;
		}
	}
	
	async function deleteUser(user) {
		if (!confirm(`Delete tracked user ${user.username} (${user.id})? This only removes them from the tracking table.`)) return;
		
		try {
			const response = await fetch(`/api/superadmin/users/${user.id}`, {
				method: 'DELETE',
			});
			
			if (response.ok) {
				toast = { type: 'success', message: `User ${user.username} removed` };
				await invalidateAll();
			} else {
				const result = await response.json();
				toast = { type: 'error', message: result.error || 'Failed to delete user' };
			}
		} catch (error) {
			toast = { type: 'error', message: error.message };
		}
	}
	
	async function toggleBan(user) {
		const newBanned = !user.banned;
		try {
			const response = await fetch(`/api/superadmin/users/${user.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ banned: newBanned }),
			});
			
			if (response.ok) {
				toast = { type: 'success', message: `${user.username} ${newBanned ? 'banned' : 'unbanned'}` };
				await invalidateAll();
			} else {
				const result = await response.json();
				toast = { type: 'error', message: result.error || 'Failed to update user' };
			}
		} catch (error) {
			toast = { type: 'error', message: error.message };
		}
	}
</script>

<svelte:head>
	<title>User Management | Superadmin | SpaceBot</title>
</svelte:head>

<div class="users-management">
	<header class="page-header">
		<div class="header-text">
			<h1>
				<span class="header-icon">👥</span>
				User Management
			</h1>
			<p class="header-subtitle">{total} tracked users</p>
		</div>
	</header>
	
	{#if toast}
		<div class="toast toast-{toast.type}">
			<span>{toast.type === 'success' ? '✓' : '✗'}</span> {toast.message}
			<button class="toast-close" onclick={() => toast = null}>✕</button>
		</div>
	{/if}
	
	<!-- Search -->
	<form class="search-bar" onsubmit={(e) => { e.preventDefault(); doSearch(); }}>
		<input 
			type="text" 
			placeholder="Search by username, display name, or ID..." 
			bind:value={search}
			class="search-input"
		/>
		<button type="submit" class="btn btn-primary btn-sm">Search</button>
	</form>
	
	<!-- Edit Modal -->
	{#if editingUser}
		<div class="modal-backdrop" onclick={() => editingUser = null} role="presentation">
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_interactive_supports_focus -->
			<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
				<div class="modal-header">
					<div class="modal-user-info">
						<img src={getAvatarUrl(editingUser)} alt="" class="modal-avatar" />
						<div>
							<h2>{editingUser.global_name || editingUser.username}</h2>
							<span class="user-tag">@{editingUser.username}</span>
						</div>
					</div>
					<button class="modal-close" onclick={() => editingUser = null}>✕</button>
				</div>
				<div class="modal-body">
					<div class="user-details-grid">
						<div class="detail-item">
							<span class="detail-label">User ID</span>
							<span class="detail-value mono">{editingUser.id}</span>
						</div>
						<div class="detail-item">
							<span class="detail-label">Last Login</span>
							<span class="detail-value">{formatDate(editingUser.last_login_at)}</span>
						</div>
						<div class="detail-item">
							<span class="detail-label">Login Count</span>
							<span class="detail-value">{editingUser.login_count || 0}</span>
						</div>
						<div class="detail-item">
							<span class="detail-label">First Seen</span>
							<span class="detail-value">{formatDate(editingUser.created_at)}</span>
						</div>
					</div>
					
					<div class="form-group">
						<label>
							<input type="checkbox" bind:checked={editingUser.banned} />
							<span>Banned from dashboard</span>
						</label>
					</div>
					
					<div class="form-group">
						<label>
							<input type="checkbox" bind:checked={editingUser.is_superadmin} />
							<span>Superadmin (DB flag only — must also be in ADMIN_USER_IDS env var)</span>
						</label>
					</div>
					
					<div class="form-group">
						<label for="user-notes">Notes</label>
						<textarea id="user-notes" bind:value={editingUser.notes} class="form-textarea" rows="3" placeholder="Internal notes about this user..."></textarea>
					</div>
				</div>
				<div class="modal-footer">
					<button class="btn btn-primary" onclick={saveUser} disabled={saving}>
						{saving ? 'Saving...' : 'Save'}
					</button>
					<button class="btn btn-secondary" onclick={() => editingUser = null}>Cancel</button>
				</div>
			</div>
		</div>
	{/if}
	
	<!-- Users Table -->
	{#if users.length > 0}
		<div class="table-wrapper">
			<table class="data-table">
				<thead>
					<tr>
						<th>User</th>
						<th>ID</th>
						<th>Last Login</th>
						<th class="numeric">Logins</th>
						<th>Status</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each users as user (user.id)}
						<tr class:banned={user.banned}>
							<td class="user-cell">
								<img src={getAvatarUrl(user)} alt="" class="user-avatar" />
								<div class="user-info">
									<span class="user-name">{user.global_name || user.username}</span>
									<span class="user-tag">@{user.username}</span>
								</div>
							</td>
							<td class="mono id-cell">{user.id}</td>
							<td class="date-cell">{formatDate(user.last_login_at)}</td>
							<td class="numeric">{user.login_count || 0}</td>
							<td>
								<div class="status-badges">
									{#if user.is_superadmin}
										<span class="status-badge badge-admin">Admin</span>
									{/if}
									{#if user.banned}
										<span class="status-badge badge-banned">Banned</span>
									{:else}
										<span class="status-badge badge-active">Active</span>
									{/if}
								</div>
							</td>
							<td class="actions-cell">
								<button class="btn btn-sm btn-secondary" onclick={() => startEditUser(user)}>
									Edit
								</button>
								<button 
									class="btn btn-sm {user.banned ? 'btn-success' : 'btn-warning'}" 
									onclick={() => toggleBan(user)}
									title={user.banned ? 'Unban' : 'Ban'}
								>
									{user.banned ? 'Unban' : 'Ban'}
								</button>
								<button class="btn btn-sm btn-danger" onclick={() => deleteUser(user)}>
									Delete
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		
		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="pagination">
				<button class="btn btn-sm btn-secondary" onclick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
					← Prev
				</button>
				<span class="page-info">Page {currentPage} of {totalPages}</span>
				<button class="btn btn-sm btn-secondary" onclick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}>
					Next →
				</button>
			</div>
		{/if}
	{:else}
		<div class="empty-state">
			<div class="empty-icon">👥</div>
			<p>{search ? 'No users match your search.' : 'No tracked users yet. Users appear here when they log in via Discord OAuth.'}</p>
		</div>
	{/if}
</div>

<style>
	.users-management {
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

	/* Search */
	.search-bar {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.search-input {
		flex: 1;
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
		min-width: 650px;
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

	.data-table tbody tr:hover { background: var(--color-surface-hover); }
	.data-table tbody tr.banned { opacity: 0.6; }

	.numeric { text-align: right; }
	.mono { font-family: monospace; font-size: 0.75rem; }

	@media (min-width: 768px) {
		.mono { font-size: 0.8rem; }
	}

	/* User cell */
	.user-cell {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	@media (min-width: 768px) {
		.user-cell {
			gap: 0.75rem;
		}
	}

	.user-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	@media (min-width: 768px) {
		.user-avatar {
			width: 32px;
			height: 32px;
		}
	}

	.user-info {
		display: flex;
		flex-direction: column;
	}

	.user-name {
		font-weight: 600;
		color: var(--color-text);
	}

	.user-tag {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	@media (min-width: 768px) {
		.user-tag {
			font-size: 0.75rem;
		}
	}

	.id-cell {
		color: var(--color-text-muted);
	}

	.date-cell { font-size: 0.85rem; color: var(--color-text-muted); }

	/* Status badges */
	.status-badges {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.status-badge {
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-full);
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	@media (min-width: 768px) {
		.status-badge {
			font-size: 0.7rem;
		}
	}

	.badge-active { background: var(--color-success-soft); color: var(--color-success); }
	.badge-banned { background: var(--color-danger-soft); color: var(--color-danger); }
	.badge-admin { background: var(--color-warning-soft); color: var(--color-warning); }

	.actions-cell {
		display: flex;
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

	.btn-sm { padding: 0.25rem 0.5rem; font-size: 0.75rem; }

	@media (min-width: 640px) {
		.btn-sm { padding: 0.3rem 0.65rem; font-size: 0.8rem; }
	}

	.btn-primary { background: var(--color-primary-button); color: var(--color-primary-button-text); }
	.btn-primary:hover { background: var(--color-primary-button-hover); }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-secondary { background: transparent; border-color: var(--color-border); color: var(--color-text-muted); }
	.btn-secondary:hover { border-color: var(--color-text); color: var(--color-text); }
	.btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-warning { background: var(--color-warning-soft); color: var(--color-warning); border-color: rgba(234, 179, 8, 0.3); }
	.btn-warning:hover { background: rgba(234, 179, 8, 0.25); }
	.btn-success { background: var(--color-success-soft); color: var(--color-success); border-color: rgba(34, 197, 94, 0.3); }
	.btn-success:hover { background: rgba(34, 197, 94, 0.25); }
	.btn-danger { background: var(--color-danger-soft); color: var(--color-danger); border-color: rgba(239, 68, 68, 0.3); }
	.btn-danger:hover { background: rgba(239, 68, 68, 0.25); }

	/* Pagination */
	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 1rem 0;
	}

	@media (min-width: 640px) {
		.pagination {
			gap: 1rem;
		}
	}

	.page-info { font-size: 0.85rem; color: var(--color-text-muted); }

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

	.modal-user-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.modal-avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
	}

	@media (min-width: 640px) {
		.modal-avatar {
			width: 40px;
			height: 40px;
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

	.user-details-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
		padding: 1rem;
		background: rgba(255, 255, 255, 0.03);
		border-radius: var(--radius-md);
	}

	@media (min-width: 480px) {
		.user-details-grid {
			grid-template-columns: 1fr 1fr;
		}
	}

	.detail-item {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.detail-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.detail-value {
		font-size: 0.9rem;
		color: var(--color-text);
	}

	/* Form */
	.form-group {
		margin-bottom: 1rem;
	}

	.form-group > label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.form-group label[for] {
		display: block;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-muted);
		margin-bottom: 0.35rem;
		cursor: default;
	}

	.form-textarea {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
		font-family: inherit;
		resize: vertical;
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
