<script>
	import { enhance } from '$app/forms';
	import ChannelSelector from '$lib/components/ChannelSelector.svelte';
	import RoleSelector from '$lib/components/RoleSelector.svelte';
	
	let { data, form } = $props();
	
	let selectedEventTypes = $state([]);
	let actions = $state([]);
	let showFilters = $state(false);
	let showTriggerPicker = $state(false);
	
	// Shared channel data - fetched once for all ChannelSelectors
	let sharedChannels = $state(null);
	let channelsLoading = $state(false);
	
	// Shared role data - fetched once for all RoleSelectors
	let sharedRoles = $state(null);
	let rolesLoading = $state(false);
	
	// Fetch channels once when guild changes
	$effect(() => {
		if (data.selectedGuildId && !sharedChannels && !channelsLoading) {
			fetchChannels();
		}
	});
	
	// Fetch roles once when guild changes
	$effect(() => {
		if (data.selectedGuildId && !sharedRoles && !rolesLoading) {
			fetchRoles();
		}
	});
	
	async function fetchChannels() {
		channelsLoading = true;
		try {
			const response = await fetch(`/api/discord/guilds/${data.selectedGuildId}/channels?type=sendable`);
			if (response.ok) {
				const result = await response.json();
				sharedChannels = result.channels || [];
			}
		} catch (err) {
			console.error('Error fetching channels:', err);
		} finally {
			channelsLoading = false;
		}
	}
	
	async function fetchRoles() {
		rolesLoading = true;
		try {
			const response = await fetch(`/api/discord/guilds/${data.selectedGuildId}/roles`);
			if (response.ok) {
				const result = await response.json();
				sharedRoles = result.roles || [];
			}
		} catch (err) {
			console.error('Error fetching roles:', err);
		} finally {
			rolesLoading = false;
		}
	}
	
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
	
	// Stacked actions management
	function addAction() {
		actions = [...actions, { type: '', config: {} }];
	}
	
	function removeAction(index) {
		actions = actions.filter((_, i) => i !== index);
	}
	
	function moveActionUp(index) {
		if (index <= 0) return;
		const newActions = [...actions];
		[newActions[index - 1], newActions[index]] = [newActions[index], newActions[index - 1]];
		actions = newActions;
	}
	
	function moveActionDown(index) {
		if (index >= actions.length - 1) return;
		const newActions = [...actions];
		[newActions[index], newActions[index + 1]] = [newActions[index + 1], newActions[index]];
		actions = newActions;
	}
	
	// Check if a filter applies to the selected event type
	function filterAppliesToEvent(filterInfo, eventType) {
		if (!filterInfo.applicableEvents || !eventType) {
			return true;
		}
		
		for (const pattern of filterInfo.applicableEvents) {
			if (pattern === '*') {
				return true;
			}
			// Check if it's a prefix match (ends with _) or exact match
			if (pattern.endsWith('_')) {
				if (eventType.startsWith(pattern)) {
					return true;
				}
			} else if (eventType === pattern) {
				return true;
			}
		}
		
		return false;
	}
	
	// Check if a filter applies to any of the selected event types
	function filterAppliesToAnyEvent(filterInfo) {
		if (selectedEventTypes.length === 0) return false;
		return selectedEventTypes.some(eventType => filterAppliesToEvent(filterInfo, eventType));
	}
	
	// Toggle event type selection
	function toggleEventType(eventType) {
		if (selectedEventTypes.includes(eventType)) {
			selectedEventTypes = selectedEventTypes.filter(e => e !== eventType);
		} else {
			selectedEventTypes = [...selectedEventTypes, eventType];
		}
	}
	
	// Remove a trigger from the list
	function removeTrigger(eventType) {
		selectedEventTypes = selectedEventTypes.filter(e => e !== eventType);
	}
	
	// Get filters applicable to the current event type
	const applicableFilters = $derived.by(() => {
		if (selectedEventTypes.length === 0) return {};
		const result = {};
		for (const [filterKey, filterInfo] of Object.entries(data.filterTypes)) {
			if (filterAppliesToAnyEvent(filterInfo)) {
				result[filterKey] = filterInfo;
			}
		}
		return result;
	});
	
	// Check if there are any applicable filters
	const hasApplicableFilters = $derived(Object.keys(applicableFilters).length > 0);
	
	// User sources for automation actions
	const availableUserSources = $derived(() => {
		return [
			{ value: 'actor', label: '👤 Event Actor', description: 'The user who triggered the event' },
			{ value: 'target', label: '🎯 Event Target', description: 'The user who was the target of the event (if any)' }
		];
	});
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
			<div class="section-header-row">
				<div>
					<h2>📥 Triggers (When)</h2>
					<p class="section-description">Choose what events will trigger this automation</p>
				</div>
				<button type="button" class="btn btn-secondary btn-sm" onclick={() => showTriggerPicker = !showTriggerPicker}>
					<span>+</span> Add Trigger
				</button>
			</div>
			
			<!-- Hidden inputs to pass selected triggers to form -->
			{#each selectedEventTypes as eventType}
				<input type="hidden" name="trigger_events[]" value={eventType} />
			{/each}
			
			{#if selectedEventTypes.length === 0}
				<div class="empty-triggers">
					<p>No triggers configured. Click "Add Trigger" to get started.</p>
				</div>
			{:else}
				<div class="triggers-list">
					{#each selectedEventTypes as eventType, index}
						{@const eventInfo = data.eventTypes[eventType]}
						{@const catInfo = getCategoryInfo(eventInfo?.category)}
						<div class="trigger-item">
							<div class="trigger-info">
								<span class="trigger-icon" style="color: {catInfo.color}">{catInfo.icon}</span>
								<span class="trigger-name">{eventType.replace(/_/g, ' ')}</span>
								<span class="trigger-description">{eventInfo?.description || ''}</span>
							</div>
							<button type="button" class="btn-icon btn-danger" onclick={() => removeTrigger(eventType)} title="Remove trigger">
								×
							</button>
						</div>
					{/each}
				</div>
			{/if}
			
			{#if showTriggerPicker}
				<div class="trigger-picker">
					<div class="trigger-picker-header">
						<h4>Select Event Types</h4>
						<button type="button" class="btn-icon" onclick={() => showTriggerPicker = false} title="Close">×</button>
					</div>
					<div class="trigger-categories">
						{#each Object.entries(getEventsByCategory()) as [category, events]}
							{@const catInfo = getCategoryInfo(category)}
							<div class="trigger-category">
								<h5 class="category-header">
									<span style="color: {catInfo.color}">{catInfo.icon}</span>
									{catInfo.name}
								</h5>
								<div class="trigger-options">
									{#each events as event}
										<label class="trigger-option" class:selected={selectedEventTypes.includes(event.type)}>
											<input 
												type="checkbox" 
												checked={selectedEventTypes.includes(event.type)}
												onchange={() => toggleEventType(event.type)}
											/>
											<span class="trigger-option-name">{event.type.replace(/_/g, ' ')}</span>
											<span class="trigger-option-desc">{event.description}</span>
										</label>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
			
			{#if selectedEventTypes.length > 0 && hasApplicableFilters}
				<div class="filters-toggle">
					<button type="button" class="btn btn-secondary btn-sm" onclick={() => showFilters = !showFilters}>
						{showFilters ? '➖ Hide Filters' : '➕ Add Filters'}
					</button>
					<span class="toggle-hint">Filters narrow down when this automation triggers</span>
				</div>
				
				{#if showFilters}
					<div class="filters-grid">
						{#each Object.entries(applicableFilters) as [filterKey, filterInfo]}
							<div class="form-group">
								<label for="filter_{filterKey}">{filterInfo.label}</label>
								{#if filterInfo.type === 'channel'}
									<ChannelSelector
										channels={sharedChannels}
										name="filter.{filterKey}"
										placeholder={filterInfo.description}
										multiple={true}
										showAllOption={filterKey === 'channel_id'}
										value={filterKey === 'channel_id' ? 'ALL' : ''}
									/>
								{:else if filterInfo.type === 'role'}
									<RoleSelector
										roles={sharedRoles}
										name="filter.{filterKey}"
										placeholder={filterInfo.description}
										multiple={true}
										showAnyOption={filterKey === 'actor_has_role' || filterKey === 'target_has_role'}
										value={filterKey === 'actor_has_role' || filterKey === 'target_has_role' ? 'ALL' : ''}
									/>
								{:else if filterInfo.type === 'select'}
									<select
										id="filter_{filterKey}"
										name="filter.{filterKey}"
									>
										{#each filterInfo.options as option}
											<option value={option.value} selected={option.value === filterInfo.default}>{option.label}</option>
										{/each}
									</select>
							{:else}
								<input 
									type={filterInfo.type === 'number' ? 'number' : 'text'} 
									id="filter_{filterKey}" 
									name="filter.{filterKey}" 
									placeholder={filterInfo.description}
								/>
							{/if}
						</div>
					{/each}
				</div>
				{/if}
			{/if}
		</section>
		
		<!-- Action Section -->
		<section class="form-section">
			<div class="section-header-row">
				<div>
					<h2>📤 Actions (Then)</h2>
					<p class="section-description">Configure actions to execute when the trigger fires (in order)</p>
				</div>
				<button type="button" class="btn btn-secondary btn-sm" onclick={addAction}>
					<span>+</span> Add Action
				</button>
			</div>
			
			{#if actions.length === 0}
				<div class="empty-actions">
					<p>No actions configured. Click "Add Action" to get started.</p>
				</div>
			{:else}
				<div class="actions-list">
					{#each actions as action, index}
						<div class="action-item">
							<div class="action-header">
								<span class="action-number">Action {index + 1}</span>
								<div class="action-controls">
									<button type="button" class="btn-icon" onclick={() => moveActionUp(index)} disabled={index === 0} title="Move up">
										↑
									</button>
									<button type="button" class="btn-icon" onclick={() => moveActionDown(index)} disabled={index === actions.length - 1} title="Move down">
										↓
									</button>
									<button type="button" class="btn-icon btn-danger" onclick={() => removeAction(index)} title="Remove action">
										×
									</button>
								</div>
							</div>
							
							<div class="form-group">
								<label for="action_type_{index}">Action Type <span class="required">*</span></label>
								<select id="action_type_{index}" name="action_type[]" required bind:value={action.type}>
									<option value="">Select an action...</option>
									{#each Object.entries(data.actionTypes) as [actionType, info]}
										<option value={actionType}>{info.icon} {info.name} - {info.description}</option>
									{/each}
								</select>
							</div>
							
							{#if action.type}
								{@const schema = getActionConfigSchema(action.type)}
								<div class="action-config">
									<h3>Configure Action</h3>
									{#each Object.entries(schema) as [configKey, config]}
										<div class="form-group">
											<label for="config_{index}_{configKey}">
												{config.label}
												{#if config.required}<span class="required">*</span>{/if}
											</label>
											{#if config.type === 'text'}
												<textarea 
													id="config_{index}_{configKey}" 
													name="action_config.{index}.{configKey}"
													required={config.required}
													placeholder={config.supportsVariables ? 'Supports variables like {user.mention}' : ''}
													rows="3"
													bind:value={action.config[configKey]}
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
													id="config_{index}_{configKey}" 
													name="action_config.{index}.{configKey}"
													min="0"
													max={config.max || 999999}
													required={config.required}
													placeholder={config.placeholder || ''}
													bind:value={action.config[configKey]}
												/>
											{:else if config.type === 'boolean'}
												<label class="checkbox-label">
													<input 
														type="checkbox" 
														name="action_config.{index}.{configKey}"
														value="true"
														bind:checked={action.config[configKey]}
													/>
													<span>Enable</span>
												</label>
											{:else if config.type === 'channel_multi'}
												<ChannelSelector
													channels={sharedChannels}
													name="action_config.{index}.{configKey}"
													required={config.required}
													placeholder="Select channel(s)..."
													multiple={true}
													showAllOption={config.showAllOption}
													allOptionLabel={config.allOptionLabel || 'All Text Channels'}
													bind:value={action.config[configKey]}
												/>
												{#if config.description}
													<p class="field-hint">{config.description}</p>
												{/if}
											{:else if config.type === 'channel'}
												<ChannelSelector
													channels={sharedChannels}
													name="action_config.{index}.{configKey}"
													required={config.required}
													placeholder="Search for a channel..."
													bind:value={action.config[configKey]}
												/>
											{:else if config.type === 'role'}
												<input 
													type="text" 
													id="config_{index}_{configKey}" 
													name="action_config.{index}.{configKey}"
													placeholder="Enter role ID"
													required={config.required}
													bind:value={action.config[configKey]}
												/>
												<p class="field-hint">Right-click on the role in Discord and select "Copy ID"</p>
											{:else if config.type === 'select'}
												<select 
													id="config_{index}_{configKey}" 
													name="action_config.{index}.{configKey}"
													required={config.required}
													bind:value={action.config[configKey]}
												>
													{#each config.options as opt}
														<option value={opt}>{opt}</option>
													{/each}
												</select>
											{:else if config.type === 'user_source'}
												<select 
													id="config_{index}_{configKey}" 
													name="action_config.{index}.{configKey}"
													required={config.required}
													bind:value={action.config[configKey]}
												>
													<option value="">Select a user...</option>
													{#each availableUserSources() as source}
														<option value={source.value} title={source.description}>
															{source.label}
														</option>
													{/each}
												</select>
												{#if config.description}
													<p class="field-hint">{config.description}</p>
												{/if}
											{:else}
												<input 
													type="text" 
													id="config_{index}_{configKey}" 
													name="action_config.{index}.{configKey}"
													required={config.required}
													bind:value={action.config[configKey]}
												/>
											{/if}
										</div>
									{/each}
								</div>
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
	
	/* Multi-trigger styles */
	.empty-triggers {
		padding: 2rem;
		text-align: center;
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
		color: var(--text-muted);
	}
	
	.empty-triggers p {
		margin: 0;
	}
	
	.triggers-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.trigger-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
	}
	
	.trigger-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: 1;
		min-width: 0;
	}
	
	.trigger-icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}
	
	.trigger-name {
		font-weight: 500;
		white-space: nowrap;
	}
	
	.trigger-description {
		color: var(--text-muted);
		font-size: 0.875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	
	.trigger-picker {
		margin-top: 1rem;
		padding: 1rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
	}
	
	.trigger-picker-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border-color, #40444b);
	}
	
	.trigger-picker-header h4 {
		margin: 0;
		font-size: 1rem;
	}
	
	.trigger-categories {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-height: 400px;
		overflow-y: auto;
	}
	
	.trigger-category {
		padding: 0.75rem;
		background: var(--bg-secondary, #2f3136);
		border-radius: 8px;
	}
	
	.category-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.75rem;
		font-size: 0.875rem;
		font-weight: 600;
	}
	
	.trigger-options {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	
	.trigger-option {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s;
	}
	
	.trigger-option:hover {
		background: var(--bg-primary, #202225);
	}
	
	.trigger-option.selected {
		background: rgba(88, 101, 242, 0.2);
		border: 1px solid var(--accent-color, #5865F2);
	}
	
	.trigger-option input[type="checkbox"] {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}
	
	.trigger-option-name {
		font-weight: 500;
		font-size: 0.875rem;
		white-space: nowrap;
	}
	
	.trigger-option-desc {
		color: var(--text-muted);
		font-size: 0.75rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
	
	/* Stacked Actions Styles */
	.section-header-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	
	.section-header-row h2 {
		margin: 0;
	}
	
	.section-header-row .section-description {
		margin: 0.25rem 0 0;
	}
	
	.empty-actions {
		padding: 2rem;
		text-align: center;
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
		color: var(--text-muted);
	}
	
	.empty-actions p {
		margin: 0;
	}
	
	.actions-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	
	.action-item {
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		padding: 1rem;
	}
	
	.action-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border-color, #40444b);
	}
	
	.action-number {
		font-weight: 600;
		color: var(--text-primary);
	}
	
	.action-controls {
		display: flex;
		gap: 0.375rem;
	}
	
	.btn-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		background: var(--bg-secondary, #2f3136);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 4px;
		color: var(--text-muted);
		font-size: 1rem;
		cursor: pointer;
		transition: all 0.2s;
	}
	
	.btn-icon:hover:not(:disabled) {
		background: var(--bg-primary, #202225);
		color: var(--text-primary);
	}
	
	.btn-icon:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	
	.btn-icon.btn-danger:hover:not(:disabled) {
		background: rgba(237, 66, 69, 0.2);
		border-color: #ED4245;
		color: #ED4245;
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
