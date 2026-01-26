<script>
	import { enhance } from '$app/forms';
	
	let { data, form } = $props();
	let loading = $state(null);
</script>

<div class="admin-container">
	<h1>Admin Dashboard</h1>
	
	{#if form?.message}
		<div class="alert {form.success ? 'alert-success' : 'alert-error'}">
			{form.message}
		</div>
	{/if}
	
	{#if !data.isAdmin}
		<div class="access-denied">
			<h2>Access Denied</h2>
			<p>You need to be an administrator of a server where the bot is installed to access this page.</p>
			{#if data.user}
				<p class="access-hint">If you're a server admin, make sure the bot is added to your server first.</p>
				<a href="/api/auth/discord?flow=install" class="btn">Add Bot to a Server</a>
			{:else}
				<a href="/login" class="btn">Go to Login</a>
			{/if}
		</div>
	{:else}
		<div class="user-info">
			<p>Logged in as: <strong>{data.user?.username || 'Unknown'}</strong></p>
			{#if data.isSuperAdmin}
				<span class="badge badge-superadmin">Superadmin</span>
			{:else}
				<span class="badge badge-admin">Server Admin</span>
			{/if}
			<form method="POST" action="?/logout" use:enhance>
				<button type="submit" class="btn btn-small">Logout</button>
			</form>
		</div>
		
		<div class="section server-selector">
			<h2>Select Server</h2>
			{#if data.isSuperAdmin}
				<p class="superadmin-note">As superadmin, you can view all servers where the bot is installed.</p>
			{/if}
			{#if data.adminGuilds && data.adminGuilds.length > 0}
				<div class="server-dropdown-wrapper">
					<select 
						class="server-dropdown"
						value={data.selectedGuildId}
						onchange={(e) => {
							const guildId = e.target.value;
							if (guildId) {
								window.location.href = `/admin?guild=${guildId}`;
							}
						}}
					>
						{#each data.adminGuilds as guild}
							<option value={guild.id}>
								{guild.name}{guild.owner ? ' (Owner)' : ''}{guild.botNotIn ? ' (Bot not installed)' : ''}
							</option>
						{/each}
					</select>
					{#if data.selectedGuildId}
						{@const selectedGuild = data.adminGuilds.find(g => g.id === data.selectedGuildId)}
						{#if selectedGuild}
							<div class="selected-server-info">
								{#if selectedGuild.icon}
									<img 
										src="https://cdn.discordapp.com/icons/{selectedGuild.id}/{selectedGuild.icon}.png" 
										alt="{selectedGuild.name} icon"
										class="server-icon"
									/>
								{:else}
									<div class="server-icon-placeholder">
										{selectedGuild.name.charAt(0).toUpperCase()}
									</div>
								{/if}
								<span class="server-name">{selectedGuild.name}</span>
								{#if selectedGuild.botNotIn}
									<span class="badge badge-warning">Bot not installed</span>
								{/if}
							</div>
						{/if}
					{/if}
				</div>
			{:else}
				<p class="no-servers">No servers found where you have admin permissions.</p>
				<a href="/api/auth/discord?flow=install" class="btn">Add Bot to a Server</a>
			{/if}
		</div>
		
		<div class="admin-content">
			<div class="section">
				<h2>Bot Status</h2>
				<div class="status-card">
					<p><strong>Status:</strong> <span class="status-online">Online</span></p>
					<p><strong>Uptime:</strong> {data.uptime || 'N/A'}</p>
					<p><strong>Latency:</strong> {data.latency || 'N/A'}ms</p>
				</div>
			</div>
			
			<div class="section">
				<h2>Server Statistics</h2>
				<div class="stats-grid">
					<div class="stat-card">
						<h3>Total Servers</h3>
						<p class="stat-value">{data.stats?.servers || 0}</p>
					</div>
					<div class="stat-card">
						<h3>Total Users</h3>
						<p class="stat-value">{data.stats?.users || 0}</p>
					</div>
					<div class="stat-card">
						<h3>Commands Used</h3>
						<p class="stat-value">{data.stats?.commandsUsed || 0}</p>
					</div>
				</div>
			</div>
			
			<div class="section">
				<h2>Registered Commands</h2>
				<div class="commands-list">
					{#if data.commands && data.commands.length > 0}
						<ul>
							{#each data.commands as command}
								<li>
									<code>/{command.name}</code> - {command.description}
								</li>
							{/each}
						</ul>
					{:else}
						<p>No commands registered.</p>
					{/if}
				</div>
			</div>
			
			{#if data.isSuperAdmin}
			<div class="section">
				<h2>Bot Management <span class="badge badge-superadmin">Superadmin Only</span></h2>
				<div class="actions">
					<form method="POST" action="?/refreshCommands" use:enhance={() => {
						loading = 'refreshCommands';
						return async ({ update }) => {
							await update();
							loading = null;
						};
					}}>
						<button type="submit" class="btn" disabled={loading === 'refreshCommands'}>
							{loading === 'refreshCommands' ? 'Registering...' : 'Refresh Commands'}
						</button>
					</form>
					
					<form method="POST" action="?/clearCache" use:enhance={() => {
						loading = 'clearCache';
						return async ({ update }) => {
							await update();
							loading = null;
						};
					}}>
						<button type="submit" class="btn btn-warning" disabled={loading === 'clearCache'}>
							{loading === 'clearCache' ? 'Clearing...' : 'Clear Cache'}
						</button>
					</form>
					
					<form method="POST" action="?/restartBot" use:enhance={() => {
						loading = 'restartBot';
						return async ({ update }) => {
							await update();
							loading = null;
						};
					}}>
						<button type="submit" class="btn btn-danger" disabled={loading === 'restartBot'}>
							{loading === 'restartBot' ? 'Restarting...' : 'Restart Bot'}
						</button>
					</form>
				</div>
			</div>
			{/if}
			
			<div class="section">
				<h2>Server Configuration</h2>
				<p>Configure bot settings and permissions for the selected server.</p>
				{#if data.selectedGuildId}
					<a href="/admin/config?guild={data.selectedGuildId}" class="btn">Edit Server Config</a>
				{:else}
					<p class="no-servers">Select a server above to configure it.</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.admin-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}
	
	h1 {
		font-size: 2.5rem;
		margin-bottom: 2rem;
		color: var(--color-primary);
	}
	
	h2 {
		font-size: 1.75rem;
		margin-bottom: 1rem;
		color: var(--color-text);
	}
	
	.alert {
		padding: 1rem;
		border-radius: var(--radius-md);
		margin-bottom: 1.5rem;
		font-weight: 500;
	}
	
	.alert-success {
		background: rgba(87, 242, 135, 0.15);
		color: var(--color-success-hover);
		border: 1px solid var(--color-success);
	}
	
	.alert-error {
		background: rgba(237, 66, 69, 0.15);
		color: var(--color-danger);
		border: 1px solid var(--color-danger);
	}
	
	.user-info {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 2rem;
		padding: 1rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
	}
	
	.user-info p {
		margin: 0;
	}
	
	.access-denied {
		text-align: center;
		padding: 4rem 2rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}
	
	.section {
		margin-bottom: 2rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		padding: 1.5rem;
		border-radius: var(--radius-lg);
	}
	
	.status-card {
		background: var(--color-surface-elevated);
		padding: 1rem;
		border-radius: var(--radius-md);
	}
	
	.status-online {
		color: var(--color-success);
		font-weight: bold;
	}
	
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}
	
	.stat-card {
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
		padding: 1.5rem;
		text-align: center;
	}
	
	.stat-card h3 {
		margin: 0 0 0.5rem 0;
		color: var(--color-text-muted);
		font-size: 1rem;
	}
	
	.stat-value {
		font-size: 2rem;
		font-weight: bold;
		color: var(--color-primary);
		margin: 0;
	}
	
	.actions {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}
	
	.actions form {
		display: inline-block;
	}
	
	.commands-list {
		background: var(--color-surface-elevated);
		padding: 1rem;
		border-radius: var(--radius-md);
	}
	
	.commands-list ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	
	.commands-list li {
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-border);
	}
	
	.commands-list li:last-child {
		border-bottom: none;
	}
	
	.commands-list code {
		background: var(--color-surface-hover);
		padding: 0.2rem 0.5rem;
		border-radius: var(--radius-sm);
		font-weight: bold;
		color: var(--color-primary);
	}
	
	.btn {
		padding: 0.75rem 1.5rem;
		border-radius: var(--radius-sm);
		border: none;
		text-decoration: none;
		background: var(--color-primary);
		color: white;
		font-weight: 500;
		cursor: pointer;
		transition: background var(--transition-fast), opacity var(--transition-fast);
		display: inline-block;
	}
	
	.btn:hover:not(:disabled) {
		background: var(--color-primary-hover);
		color: white;
	}
	
	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	
	.btn-small {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
	}
	
	.btn-warning {
		background: var(--color-warning);
		color: #000;
	}
	
	.btn-warning:hover:not(:disabled) {
		background: var(--color-warning-hover);
	}
	
	.btn-danger {
		background: var(--color-danger);
	}
	
	.btn-danger:hover:not(:disabled) {
		background: var(--color-danger-hover);
	}
	
	.server-selector {
		margin-bottom: 2rem;
	}
	
	.server-dropdown-wrapper {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	
	.server-dropdown {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
		color: var(--color-text);
		font-size: 1rem;
		min-width: 250px;
		cursor: pointer;
	}
	
	.server-dropdown:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.25);
	}
	
	.selected-server-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
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
		background: var(--color-primary);
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: bold;
		font-size: 1rem;
	}
	
	.server-name {
		font-weight: 500;
		color: var(--color-text);
	}
	
	.no-servers {
		color: var(--color-text-muted);
		margin-bottom: 1rem;
	}
	
	/* Badge styles */
	.badge {
		display: inline-block;
		padding: 0.25rem 0.75rem;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	
	.badge-superadmin {
		background: linear-gradient(135deg, #7c3aed, #c026d3);
		color: white;
	}
	
	.badge-admin {
		background: rgba(88, 101, 242, 0.15);
		color: var(--color-primary);
		border: 1px solid var(--color-primary);
	}
	
	.badge-warning {
		background: rgba(250, 177, 22, 0.15);
		color: #fab116;
		border: 1px solid #fab116;
		margin-left: 0.5rem;
	}
	
	.superadmin-note {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin-bottom: 1rem;
		font-style: italic;
	}
	
	.access-hint {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin-bottom: 1.5rem;
	}
</style>