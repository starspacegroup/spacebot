<script>
	import { enhance } from '$app/forms';
	import ChannelSelector from '$lib/components/ChannelSelector.svelte';
	
	let { data, form } = $props();
	
	let selectedEventType = $state('');
	let selectedActionType = $state('');
	let showFilters = $state(false);
	
	// Get parent data for guild info
	const selectedGuildId = $derived(data.selectedGuildId);
	
	// Get category info
	function getCategoryInfo(category) {
		return data.eventCategories[category] || { name: category, icon: '📌', color: '#888' };
	}
	
	// Group events by category for dropdown
	function getEventsByCategory() {
		const grouped = {};
		for (const [eventType, info] of Object.entries(data.eventTypes)) {
			const category = info.category;
			if (!grouped[category]) {
				grouped[category] = [];
			}
			grouped[category].push({ type: eventType, ...info });
		}
		return grouped;
	}
	
	// Get action config schema
	function getActionConfigSchema(actionType) {
		return data.actionTypes[actionType]?.configSchema || {};
	}
</script>

<svelte:head>
	<title>Create Automation | SpaceBot Admin</title>
</svelte:head>

<div class="automation-form-page">
	<header class="page-header">
		<a href="/admin/{selectedGuildId}/automations" class="back-link">
			← Back to Automations
		</a>
		<h1>
			<span class="header-icon">➕</span>
			Create Automation
		</h1>
		<p class="header-subtitle">Set up an automatic action triggered by Discord events</p>
	</header>
	
	{#if form?.error}
		<div class="error-banner">
			<span>⚠️</span>
			<span>{form.error}</span>
		</div>
	{/if}
	
	<form method="POST" use:enhance class="automation-form">
		<input type="hidden" name="guild_id" value={selectedGuildId}>
		
		<!-- Basic Info Section -->
		<section class="form-section">
			<h2>📝 Basic Info</h2>
			
			<div class="form-group">
				<label for="name">Automation Name <span class="required">*</span></label>
				<input 
					type="text" 
					id="name" 
					name="name" 
					required 
					placeholder="e.g., Welcome Message"
					value={form?.values?.name || ''}
				/>
			</div>
			
			<div class="form-group">
				<label for="description">Description</label>
				<textarea 
					id="description" 
					name="description" 
					placeholder="What does this automation do?"
					rows="2"
				>{form?.values?.description || ''}</textarea>
			</div>
		</section>
		
		<!-- Trigger Section -->
		<section class="form-section">
			<h2>📥 Trigger (When)</h2>
			<p class="section-description">Choose what event will trigger this automation</p>
			
			<div class="form-group">
				<label for="trigger_event">Event Type <span class="required">*</span></label>
				<select id="trigger_event" name="trigger_event" required bind:value={selectedEventType}>
					<option value="">Select an event...</option>
					{#each Object.entries(getEventsByCategory()) as [category, events]}
						{@const catInfo = getCategoryInfo(category)}
						<optgroup label="{catInfo.icon} {catInfo.name}">
							{#each events as event}
								<option value={event.type}>{event.type.replace(/_/g, ' ')} - {event.description}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</div>
			
			<div class="filters-toggle">
				<button type="button" class="btn btn-secondary btn-sm" onclick={() => showFilters = !showFilters}>
					{showFilters ? '➖ Hide Filters' : '➕ Add Filters'}
				</button>
				<span class="toggle-hint">Filters narrow down when this automation triggers</span>
			</div>
			
			{#if showFilters}
				<div class="filters-grid">
					{#each Object.entries(data.filterTypes) as [filterKey, filterInfo]}
						<div class="form-group">
							<label for="filter_{filterKey}">{filterInfo.label}</label>
							<input 
								type={filterInfo.type === 'number' ? 'number' : 'text'} 
								id="filter_{filterKey}" 
								name="filter.{filterKey}" 
								placeholder={filterInfo.description}
							/>
						</div>
					{/each}
				</div>
			{/if}
		</section>
		
		<!-- Action Section -->
		<section class="form-section">
			<h2>📤 Action (Then)</h2>
			<p class="section-description">Choose what happens when the trigger fires</p>
			
			<div class="form-group">
				<label for="action_type">Action Type <span class="required">*</span></label>
				<select id="action_type" name="action_type" required bind:value={selectedActionType}>
					<option value="">Select an action...</option>
					{#each Object.entries(data.actionTypes) as [actionType, info]}
						<option value={actionType}>{info.icon} {info.name} - {info.description}</option>
					{/each}
				</select>
			</div>
			
			{#if selectedActionType}
				{@const schema = getActionConfigSchema(selectedActionType)}
				<div class="action-config">
					<h3>Configure Action</h3>
					{#each Object.entries(schema) as [configKey, config]}
						<div class="form-group">
							<label for="config_{configKey}">
								{config.label}
								{#if config.required}<span class="required">*</span>{/if}
							</label>
							{#if config.type === 'text'}
								<textarea 
									id="config_{configKey}" 
									name="action_config.{configKey}"
									required={config.required}
									placeholder={config.supportsVariables ? 'Supports variables like {user.mention}' : ''}
									rows="3"
								></textarea>
								{#if config.supportsVariables}
									<div class="variables-help">
										<span class="variables-label">Available variables:</span>
										<div class="variables-list">
											{#each Object.entries(data.templateVariables) as [varName, desc]}
												<code title={desc}>{`{${varName}}`}</code>
											{/each}
										</div>
									</div>
								{/if}
							{:else if config.type === 'number'}
								<input 
									type="number" 
									id="config_{configKey}" 
									name="action_config.{configKey}"
									value={config.default || ''}
									min="0"
									max={config.max || 999999}
									required={config.required}
								/>
							{:else if config.type === 'boolean'}
								<label class="checkbox-label">
									<input 
										type="checkbox" 
										name="action_config.{configKey}"
										value="true"
										checked={config.default}
									/>
									<span>Enable</span>
								</label>
							{:else if config.type === 'channel'}
								<ChannelSelector
									guildId={selectedGuildId}
									name="action_config.{configKey}"
									required={config.required}
									placeholder="Search for a channel..."
									typeFilter="sendable"
								/>
							{:else if config.type === 'role'}
								<input 
									type="text" 
									id="config_{configKey}" 
									name="action_config.{configKey}"
									placeholder="Enter role ID"
									required={config.required}
								/>
								<p class="field-hint">Right-click on the role in Discord and select "Copy ID"</p>
							{:else if config.type === 'select'}
								<select 
									id="config_{configKey}" 
									name="action_config.{configKey}"
									required={config.required}
								>
									{#each config.options as opt}
										<option value={opt} selected={opt === config.default}>{opt}</option>
									{/each}
								</select>
							{:else}
								<input 
									type="text" 
									id="config_{configKey}" 
									name="action_config.{configKey}"
									required={config.required}
								/>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>
		
		<!-- Form Actions -->
		<div class="form-actions">
			<a href="/admin/{selectedGuildId}/automations" class="btn btn-secondary">
				Cancel
			</a>
			<button type="submit" class="btn btn-primary">
				<span>✓</span>
				Create Automation
			</button>
		</div>
	</form>
</div>

<style>
	.automation-form-page {
		padding: 1.5rem;
		max-width: 800px;
		margin: 0 auto;
	}
	
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--text-muted);
		text-decoration: none;
		font-size: 0.875rem;
		margin-bottom: 1rem;
		transition: color 0.2s;
	}
	
	.back-link:hover {
		color: var(--text-primary);
	}
	
	.page-header {
		margin-bottom: 2rem;
	}
	
	.page-header h1 {
		font-size: 1.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}
	
	.header-icon {
		font-size: 1.5rem;
	}
	
	.header-subtitle {
		color: var(--text-muted);
		margin: 0.5rem 0 0;
	}
	
	.error-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		background: rgba(237, 66, 69, 0.15);
		border: 1px solid #ED4245;
		border-radius: 8px;
		color: #ED4245;
		margin-bottom: 1.5rem;
	}
	
	.automation-form {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	
	.form-section {
		background: var(--bg-secondary, #2f3136);
		border-radius: 12px;
		padding: 1.5rem;
	}
	
	.form-section h2 {
		margin: 0 0 0.5rem;
		font-size: 1.125rem;
	}
	
	.section-description {
		color: var(--text-muted);
		font-size: 0.875rem;
		margin: 0 0 1.25rem;
	}
	
	.form-group {
		margin-bottom: 1rem;
	}
	
	.form-group:last-child {
		margin-bottom: 0;
	}
	
	.form-group label {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: 500;
		font-size: 0.875rem;
	}
	
	.form-group input,
	.form-group select,
	.form-group textarea {
		width: 100%;
		padding: 0.75rem 1rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		color: var(--text-primary, #fff);
		font-size: 1rem;
	}
	
	.form-group textarea {
		resize: vertical;
		min-height: 60px;
	}
	
	.form-group input:focus,
	.form-group select:focus,
	.form-group textarea:focus {
		outline: none;
		border-color: var(--accent-color, #5865F2);
	}
	
	.required {
		color: #ED4245;
	}
	
	.filters-toggle {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	
	.toggle-hint {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	
	.filters-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 1rem;
		margin-top: 1rem;
		padding: 1rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
	}
	
	.filters-grid .form-group {
		margin-bottom: 0;
	}
	
	.action-config {
		margin-top: 1.25rem;
		padding: 1.25rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
	}
	
	.action-config h3 {
		margin: 0 0 1rem;
		font-size: 0.875rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	
	.variables-help {
		margin-top: 0.5rem;
		font-size: 0.75rem;
	}
	
	.variables-label {
		color: var(--text-muted);
		display: block;
		margin-bottom: 0.375rem;
	}
	
	.variables-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	
	.variables-list code {
		background: var(--bg-primary, #202225);
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 0.7rem;
		cursor: help;
	}
	
	.field-hint {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin: 0.375rem 0 0;
	}
	
	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}
	
	.checkbox-label input {
		width: auto;
	}
	
	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		padding-top: 1rem;
	}
	
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem;
		border: none;
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		transition: all 0.2s;
	}
	
	.btn-primary {
		background: var(--accent-color, #5865F2);
		color: white;
	}
	
	.btn-primary:hover {
		background: var(--accent-hover, #4752C4);
	}
	
	.btn-secondary {
		background: var(--bg-secondary, #2f3136);
		color: var(--text-primary, #fff);
		border: 1px solid var(--border-color, #40444b);
	}
	
	.btn-secondary:hover {
		background: var(--bg-tertiary, #36393f);
	}
	
	.btn-sm {
		padding: 0.5rem 0.875rem;
		font-size: 0.875rem;
	}
	
	/* Mobile Responsive */
	@media (max-width: 640px) {
		.automation-form-page {
			padding: 1rem;
		}
		
		.form-section {
			padding: 1rem;
		}
		
		.form-actions {
			flex-direction: column;
		}
		
		.form-actions .btn {
			width: 100%;
			justify-content: center;
		}
		
		.filters-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
