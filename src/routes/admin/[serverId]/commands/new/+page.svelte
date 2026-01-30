<script>
	import { enhance } from '$app/forms';
	import ChannelSelector from '$lib/components/ChannelSelector.svelte';
	import RoleSelector from '$lib/components/RoleSelector.svelte';
	
	let { data, form } = $props();
	
	let actions = $state([]);
	let selectedResponseType = $state('message');
	let options = $state([]);
	
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
	
	// Get action config schema
	function getActionConfigSchema(actionType) {
		if (!actionType || actionType === 'NONE') return {};
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
	
	// Add a new option
	function addOption() {
		options = [...options, {
			name: '',
			description: '',
			type: 3, // STRING
			required: false,
			defaultValue: ''
		}];
	}
	
	// Remove an option
	function removeOption(index) {
		options = options.filter((_, i) => i !== index);
	}
	
	// Get option type label
	function getOptionTypeLabel(type) {
		for (const [key, info] of Object.entries(data.optionTypes)) {
			if (info.value === type) return info.label;
		}
		return 'Unknown';
	}
	
	// Computed option variables for template help
	const optionVariables = $derived(
		options
			.filter(opt => opt.name)
			.map(opt => ({
				name: `option.${opt.name.toLowerCase().replace(/\s+/g, '_')}`,
				desc: opt.description || `Value of ${opt.name} option`
			}))
	);
	
	// Computed user sources for actions (command invoker + any user-type options)
	const availableUserSources = $derived(() => {
		const sources = [
			{ value: 'invoker', label: '👤 Command Invoker', description: 'The user who ran the command' }
		];
		// Add user-type options (type 6 = USER)
		for (const opt of options) {
			if (opt.type === 6 && opt.name) {
				const optName = opt.name.toLowerCase().replace(/\s+/g, '_');
				sources.push({
					value: `option:${optName}`,
					label: `🎯 Option: ${opt.name}`,
					description: opt.description || `User from "${opt.name}" option`
				});
			}
		}
		return sources;
	});
	
	// Computed number sources for actions (static value + any integer/number type options)
	const availableNumberOptions = $derived(() => {
		const sources = [];
		// Add integer-type options (type 4 = INTEGER, type 10 = NUMBER)
		for (const opt of options) {
			if ((opt.type === 4 || opt.type === 10) && opt.name) {
				const optName = opt.name.toLowerCase().replace(/\s+/g, '_');
				sources.push({
					value: `option:${optName}`,
					label: opt.name,
					description: opt.description || `Value from "${opt.name}" option`
				});
			}
		}
		return sources;
	});
	
	// Helper to check if a number_source field is using an option reference
	function isOptionReference(value) {
		return typeof value === 'string' && value.startsWith('option:');
	}
	
	// Helper to get numeric value from number_source field
	function getStaticValue(value) {
		if (isOptionReference(value)) return '';
		if (value === undefined || value === null || value === '') return '';
		return value;
	}
	
	// Helper to get option reference from number_source field
	function getOptionValue(value) {
		if (isOptionReference(value)) return value;
		return '';
	}
</script>

<svelte:head>
	<title>Create Command | SpaceBot Admin</title>
</svelte:head>

<div class="command-form-page">
	<header class="page-header">
		<a href="/admin/{selectedGuildId}/commands" class="back-link">
			← Back to Commands
		</a>
		<h1>
			<span class="header-icon">➕</span>
			Create Slash Command
		</h1>
		<p class="header-subtitle">Create a custom slash command with automated actions</p>
	</header>
	
	{#if form?.error}
		<div class="error-banner">
			<span>⚠️</span>
			<span>{form.error}</span>
		</div>
	{/if}
	
	<form method="POST" use:enhance class="command-form">
		<input type="hidden" name="guild_id" value={selectedGuildId}>
		
		<!-- Basic Info Section -->
		<section class="form-section">
			<h2>📝 Command Info</h2>
			
			<div class="form-group">
				<label for="name">Command Name <span class="required">*</span></label>
				<div class="command-name-input">
					<span class="slash-prefix">/</span>
					<input 
						type="text" 
						id="name" 
						name="name" 
						required 
						placeholder="mycommand"
						pattern="[\w-]{1,32}"
						value={form?.values?.name || ''}
					/>
				</div>
				<p class="field-hint">Lowercase letters, numbers, hyphens only. 1-32 characters.</p>
			</div>
			
			<div class="form-group">
				<label for="description">Description <span class="required">*</span></label>
				<input 
					type="text" 
					id="description" 
					name="description" 
					required
					maxlength="100"
					placeholder="What does this command do?"
					value={form?.values?.description || ''}
				/>
				<p class="field-hint">This appears in Discord's command menu. Max 100 characters.</p>
			</div>
			
			<div class="form-row">
				<div class="form-group">
					<label class="checkbox-label">
						<input type="checkbox" name="ephemeral" value="true" />
						<span>🔒 Ephemeral (Private Response)</span>
					</label>
					<p class="field-hint">Response only visible to the user who ran the command</p>
				</div>
				
				<div class="form-group">
					<label class="checkbox-label">
						<input type="checkbox" name="defer" value="true" />
						<span>⏳ Defer Response</span>
					</label>
					<p class="field-hint">For long-running actions (shows "thinking..." indicator)</p>
				</div>
			</div>
		</section>
		
		<!-- Options Section -->
		<section class="form-section">
			<h2>⚙️ Command Options</h2>
			<p class="section-description">Add parameters that users can provide when using the command</p>
			
			{#if options.length > 0}
				<div class="options-list">
					{#each options as option, index}
						<div class="option-item">
							<div class="option-header">
								<span class="option-number">Option {index + 1}</span>
								<button type="button" class="btn btn-sm btn-danger" onclick={() => removeOption(index)}>
									🗑️ Remove
								</button>
							</div>
							<div class="option-fields">
								<div class="form-group">
									<label>Name</label>
									<input 
										type="text" 
										name="option_name[]"
										bind:value={option.name}
										placeholder="option_name"
										pattern="[a-zA-Z0-9_-]{1,32}"
									/>
								</div>
								<div class="form-group">
									<label>Description</label>
									<input 
										type="text" 
										name="option_description[]"
										bind:value={option.description}
										placeholder="What is this option for?"
									/>
								</div>
								<div class="form-group">
									<label>Type</label>
									<select name="option_type[]" bind:value={option.type}>
										{#each data.commonOptionTypes as optType}
											<option value={optType.value}>{optType.label} - {optType.description}</option>
										{/each}
									</select>
								</div>
								<div class="form-group">
									<label class="checkbox-label">
										<input 
											type="checkbox" 
											name="option_required[]"
											value={index}
											bind:checked={option.required}
										/>
										<span>Required</span>
									</label>
								</div>
								{#if !option.required}
									<div class="form-group">
										<label>Default Value</label>
										<input 
											type="text" 
											name="option_default[]"
											bind:value={option.defaultValue}
											placeholder="Leave empty for no default"
										/>
										<p class="field-hint">Value used when user doesn't provide this option</p>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
			
			<button type="button" class="btn btn-secondary" onclick={addOption}>
				➕ Add Option
			</button>
			
			{#if options.length > 0}
				<div class="options-preview">
					<span class="preview-label">Preview:</span>
					<code class="preview-command">
						/command
						{#each options as opt}
							<span class="preview-option" class:required={opt.required}>
								{opt.name || 'option'}
								{#if opt.required}<span class="required-star">*</span>{/if}
							</span>
						{/each}
					</code>
				</div>
			{/if}
		</section>
		
		<!-- Response Section -->
		<section class="form-section">
			<h2>💬 Response</h2>
			<p class="section-description">Configure what the command responds with</p>
			
			<div class="form-group">
				<label for="response_type">Response Type</label>
				<select id="response_type" name="response_type" bind:value={selectedResponseType}>
					{#each Object.entries(data.responseTypes) as [type, info]}
						<option value={type}>{info.label} - {info.description}</option>
					{/each}
				</select>
			</div>
			
			{#if selectedResponseType === 'message'}
				<div class="form-group">
					<label for="response_content">Response Message</label>
					<textarea 
						id="response_content" 
						name="response_content"
						rows="3"
						placeholder={'Hello {user.mention}! You used the command.'}
					></textarea>
					<div class="variables-help">
						<span class="variables-label">Available variables:</span>
						<div class="variables-list">
							{#each Object.entries(data.templateVariables).filter(([k]) => k !== 'option.<name>') as [varName, desc]}
								<code title={desc}>{`{${varName}}`}</code>
							{/each}
							{#each optionVariables as optVar}
								<code title={optVar.desc} class="option-var">{`{${optVar.name}}`}</code>
							{/each}
							{#if optionVariables.length === 0}
								<code title="Add options above to use their values" class="placeholder-var">{'{option.<name>}'}</code>
							{/if}
						</div>
					</div>
				</div>
			{:else if selectedResponseType === 'embed'}
				<div class="embed-config">
					<div class="form-group">
						<label for="embed_title">Embed Title</label>
						<input 
							type="text" 
							id="embed_title" 
							name="embed_title"
							placeholder="Command Response"
						/>
					</div>
					<div class="form-group">
						<label for="embed_description">Embed Description</label>
						<textarea 
							id="embed_description" 
							name="embed_description"
							rows="3"
							placeholder="Hello {user.mention}!"
						></textarea>
					</div>
					<div class="form-group">
						<label for="embed_color">Embed Color</label>
						<input 
							type="color" 
							id="embed_color" 
							name="embed_color"
							value="#5865F2"
						/>
					</div>
				</div>
			{/if}
		</section>
		
		<!-- Action Section -->
		<section class="form-section">
			<h2>⚡ Action(s)</h2>
			<p class="section-description">Stack multiple actions to execute in sequence when the command is used</p>
			
			{#if actions.length > 0}
				<div class="actions-list">
					{#each actions as action, index}
						<div class="action-item">
							<div class="action-header">
								<span class="action-number">Action {index + 1}</span>
								<div class="action-controls">
									<button type="button" class="btn btn-sm btn-secondary" onclick={() => moveActionUp(index)} disabled={index === 0} title="Move up">
										↑
									</button>
									<button type="button" class="btn btn-sm btn-secondary" onclick={() => moveActionDown(index)} disabled={index === actions.length - 1} title="Move down">
										↓
									</button>
									<button type="button" class="btn btn-sm btn-danger" onclick={() => removeAction(index)}>
										🗑️
									</button>
								</div>
							</div>
							
							<div class="form-group">
								<label for="action_type_{index}">Action Type <span class="required">*</span></label>
								<input type="hidden" name="action_type[]" value={action.type}>
								<select id="action_type_{index}" bind:value={action.type} required>
									<option value="">Select an action...</option>
									{#each Object.entries(data.actionTypes) as [actionType, info]}
										<option value={actionType}>{info.icon} {info.name}</option>
									{/each}
								</select>
							</div>
							
							{#if action.type}
								{@const schema = getActionConfigSchema(action.type)}
								<div class="action-config">
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
													placeholder={config.supportsVariables ? 'Supports variables like {user.mention} and {option.name}' : ''}
													rows="3"
													bind:value={action.config[configKey]}
												></textarea>
												{#if config.supportsVariables}
													<div class="variables-help compact">
														<span class="variables-label">Variables:</span>
														<div class="variables-list">
															<code title="Mention the user">{'{user.mention}'}</code>
															<code title="Channel mention">{'{channel.mention}'}</code>
															{#each optionVariables as optVar}
																<code title={optVar.desc} class="option-var">{`{${optVar.name}}`}</code>
															{/each}
														</div>
													</div>
												{/if}
											{:else if config.type === 'number'}
												<input 
													type="number" 
													id="config_{index}_{configKey}" 
													name="action_config.{index}.{configKey}"
													bind:value={action.config[configKey]}
													min="0"
													max={config.max || 999999}
													required={config.required}
													placeholder={config.placeholder || ''}
												/>
											{:else if config.type === 'number_source'}
												{@const hasNumberOptions = availableNumberOptions().length > 0}
												{@const isUsingOption = isOptionReference(action.config[configKey])}
												<div class="number-source-field">
													<div class="number-source-toggle">
														<label class="radio-label">
															<input 
																type="radio" 
																name="number_source_type_{index}_{configKey}"
																value="static"
																checked={!isUsingOption}
																onchange={() => action.config[configKey] = ''}
															/>
															<span>Static Value</span>
														</label>
														{#if hasNumberOptions}
															<label class="radio-label">
																<input 
																	type="radio" 
																	name="number_source_type_{index}_{configKey}"
																	value="option"
																	checked={isUsingOption}
																	onchange={() => action.config[configKey] = availableNumberOptions()[0]?.value || ''}
																/>
																<span>From Command Option</span>
															</label>
														{/if}
													</div>
													{#if isUsingOption && hasNumberOptions}
														<select 
															id="config_{index}_{configKey}" 
															name="action_config.{index}.{configKey}"
															bind:value={action.config[configKey]}
															required={config.required}
														>
															<option value="">Select an option...</option>
															{#each availableNumberOptions() as opt}
																<option value={opt.value} title={opt.description}>
																	🔢 {opt.label}
																</option>
															{/each}
														</select>
													{:else}
														<input 
															type="number" 
															id="config_{index}_{configKey}" 
															name="action_config.{index}.{configKey}"
															value={getStaticValue(action.config[configKey])}
															oninput={(e) => action.config[configKey] = e.target.value}
															min="0"
															max={config.max || 999999}
															placeholder={config.placeholder || ''}
															required={config.required}
														/>
													{/if}
													{#if !hasNumberOptions}
														<p class="field-hint hint-info">💡 Add an Integer or Number type option above to use dynamic values</p>
													{/if}
												</div>
												{#if config.description}
													<p class="field-hint">{config.description}</p>
												{/if}
											{:else if config.type === 'boolean'}
												<label class="checkbox-label">
													<input 
														type="checkbox" 
														name="action_config.{index}.{configKey}"
														value="true"
														checked={action.config[configKey] === 'true' || action.config[configKey] === true || config.default}
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
													value={action.config[configKey] || config.default || ''}
												/>
											{:else if config.type === 'channel'}
												<ChannelSelector
													channels={sharedChannels}
													name="action_config.{index}.{configKey}"
													required={config.required}
													placeholder="Search for a channel..."
													value={action.config[configKey] || ''}
												/>
											{:else if config.type === 'role'}
												<RoleSelector
													roles={sharedRoles}
													name="action_config.{index}.{configKey}"
													required={config.required}
													placeholder="Select a role..."
													value={action.config[configKey] || ''}
												/>
											{:else if config.type === 'select'}
												<select 
													id="config_{index}_{configKey}" 
													name="action_config.{index}.{configKey}"
													required={config.required}
													bind:value={action.config[configKey]}
												>
													{#each config.options as opt}
														<option value={opt} selected={opt === config.default}>{opt}</option>
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
												{#if availableUserSources().length === 1}
													<p class="field-hint hint-warning">💡 Add a User type option above to target specific users</p>
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
			{:else}
				<p class="no-actions-message">No actions configured. Add an action below to execute when this command is used.</p>
			{/if}
			
			<button type="button" class="btn btn-secondary" onclick={addAction}>
				➕ Add Action
			</button>
		</section>
		
		<!-- Form Actions -->
		<div class="form-actions">
			<a href="/admin/{selectedGuildId}/commands" class="btn btn-secondary">
				Cancel
			</a>
			<button type="submit" class="btn btn-primary">
				<span>✓</span>
				Create Command
			</button>
		</div>
	</form>
</div>

<style>
	.command-form-page {
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
	
	.command-form {
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
		font-size: 1.25rem;
	}
	
	.section-description {
		color: var(--text-muted);
		margin: 0 0 1.5rem;
		font-size: 0.875rem;
	}
	
	.form-group {
		margin-bottom: 1.25rem;
	}
	
	.form-group:last-child {
		margin-bottom: 0;
	}
	
	.form-group label {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: 500;
	}
	
	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	
	.command-name-input {
		display: flex;
		align-items: center;
		background: var(--bg-primary, #202225);
		border-radius: 8px;
		border: 1px solid var(--border-color, #40444b);
	}
	
	.slash-prefix {
		padding: 0 0.75rem;
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--accent-color, #5865F2);
	}
	
	.command-name-input input {
		flex: 1;
		border: none;
		background: transparent;
		padding: 0.75rem 0.75rem 0.75rem 0;
	}
	
	input[type="text"],
	input[type="number"],
	textarea,
	select {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-primary, #202225);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		color: var(--text-primary, #fff);
		font-size: 0.875rem;
		transition: border-color 0.2s;
	}
	
	input:focus,
	textarea:focus,
	select:focus {
		outline: none;
		border-color: var(--accent-color, #5865F2);
	}
	
	input[type="color"] {
		width: 60px;
		height: 40px;
		padding: 0.25rem;
		cursor: pointer;
	}
	
	.required {
		color: #ED4245;
	}
	
	.field-hint {
		margin: 0.375rem 0 0;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	
	.checkbox-label {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-weight: normal !important;
	}
	
	.checkbox-label input[type="checkbox"] {
		width: auto;
		accent-color: var(--accent-color, #5865F2);
	}
	
	/* Radio label */
	.radio-label {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-weight: normal !important;
	}
	
	.radio-label input[type="radio"] {
		width: auto;
		accent-color: var(--accent-color, #5865F2);
	}
	
	/* Number source field */
	.number-source-field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.number-source-toggle {
		display: flex;
		gap: 1rem;
		margin-bottom: 0.25rem;
	}
	
	.hint-info {
		color: var(--accent-color, #5865F2);
	}
	
	.hint-warning {
		color: #FEE75C;
	}
	
	/* Options */
	.options-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	
	.option-item {
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
		padding: 1rem;
	}
	
	.option-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	
	.option-number {
		font-weight: 600;
		font-size: 0.875rem;
	}
	
	.option-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	
	.options-preview {
		margin-top: 1rem;
		padding: 0.75rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
		font-size: 0.875rem;
	}
	
	.preview-label {
		color: var(--text-muted);
		margin-right: 0.5rem;
	}
	
	.preview-command {
		font-family: monospace;
	}
	
	.preview-option {
		display: inline-block;
		padding: 0.125rem 0.375rem;
		background: var(--bg-primary, #202225);
		border-radius: 4px;
		margin-left: 0.25rem;
	}
	
	.preview-option.required {
		border: 1px solid var(--accent-color, #5865F2);
	}
	
	.required-star {
		color: #ED4245;
	}
	
	/* Variables help */
	.variables-help {
		margin-top: 0.75rem;
		padding: 0.75rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
	}
	
	.variables-label {
		font-size: 0.75rem;
		color: var(--text-muted);
		display: block;
		margin-bottom: 0.5rem;
	}
	
	.variables-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	
	.variables-list code {
		padding: 0.125rem 0.5rem;
		background: var(--bg-primary, #202225);
		border-radius: 4px;
		font-size: 0.75rem;
		cursor: help;
	}
	
	.variables-list code.option-var {
		background: rgba(87, 242, 135, 0.15);
		border: 1px solid rgba(87, 242, 135, 0.3);
	}
	
	.variables-list code.placeholder-var {
		opacity: 0.5;
		font-style: italic;
	}
	
	.variables-help.compact {
		margin-top: 0.5rem;
	}
	
	.variables-help.compact .variables-label {
		display: inline;
		margin-right: 0.5rem;
	}
	
	.variables-help.compact .variables-list {
		display: inline-flex;
	}
	
	/* Embed config */
	.embed-config {
		background: var(--bg-tertiary, #36393f);
		padding: 1rem;
		border-radius: 8px;
		border-left: 4px solid var(--accent-color, #5865F2);
	}
	
	/* Action config */
	.action-config {
		margin-top: 1rem;
		padding: 1rem;
		background: var(--bg-primary, #202225);
		border-radius: 8px;
	}
	
	.action-config h3 {
		margin: 0 0 1rem;
		font-size: 1rem;
	}
	
	/* Stacked actions */
	.actions-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	
	.action-item {
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
		padding: 1rem;
		border-left: 3px solid var(--accent-color, #5865F2);
	}
	
	.action-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	
	.action-number {
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--accent-color, #5865F2);
	}
	
	.action-controls {
		display: flex;
		gap: 0.375rem;
	}
	
	.action-controls .btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	
	.no-actions-message {
		color: var(--text-muted);
		font-size: 0.875rem;
		padding: 1rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
		margin-bottom: 1rem;
	}
	
	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		border: none;
		border-radius: 8px;
		font-size: 0.875rem;
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
		background: var(--bg-tertiary, #36393f);
		color: var(--text-primary, #fff);
	}
	
	.btn-secondary:hover {
		background: var(--border-color, #40444b);
	}
	
	.btn-danger {
		background: #ED4245;
		color: white;
	}
	
	.btn-danger:hover {
		background: #c93b3e;
	}
	
	.btn-sm {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
	}
	
	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		padding-top: 1rem;
	}
	
	/* Responsive */
	@media (max-width: 640px) {
		.form-row,
		.option-fields {
			grid-template-columns: 1fr;
		}
	}
</style>
