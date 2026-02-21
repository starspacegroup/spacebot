<script>
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import ChannelSelector from '$lib/components/ChannelSelector.svelte';
	import RoleSelector from '$lib/components/RoleSelector.svelte';
	import DiscordMessageEditor from '$lib/components/DiscordMessageEditor.svelte';
	import { log } from '$lib/log.js';
	
	let { data, form } = $props();
	
	// Form submission state
	let isSubmitting = $state(false);
	
	let actions = $state([]);
	let selectedResponseType = $state('message');
	let responseContent = $state('');
	let options = $state([]);
	
	// Permission controls
	let selectedPermissionPreset = $state('everyone');
	let selectedCustomPermissions = $state([]);
	
	// Compute the permission value based on preset or custom selection
	const computedPermissions = $derived(
		selectedPermissionPreset === 'everyone'
			? ''
			: selectedPermissionPreset === 'custom'
				? (selectedCustomPermissions.length === 0 ? '' : selectedCustomPermissions[0])
				: (data.permissionPresets[selectedPermissionPreset]?.value || '')
	);
	
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
			log.error('Error fetching channels:', err);
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
			log.error('Error fetching roles:', err);
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
	
	// Initialize config values when action type changes to avoid undefined bind errors
	function initializeActionConfig(actionIndex, actionType) {
		const schema = getActionConfigSchema(actionType);
		const action = actions[actionIndex];
		const newConfig = { ...action.config };
		for (const configKey of Object.keys(schema)) {
			if (newConfig[configKey] === undefined) {
				newConfig[configKey] = '';
			}
		}
		// Create a new array to trigger reactivity
		actions = actions.map((a, i) => 
			i === actionIndex ? { ...a, config: newConfig } : a
		);
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
	
	// Combined template variables for DiscordMessageEditor (base + option variables)
	const commandTemplateVariables = $derived.by(() => {
		const vars = { ...data.templateVariables };
		// Remove the generic option.<name> placeholder since we'll add specific ones
		delete vars['option.<name>'];
		// Add specific option variables
		for (const optVar of optionVariables) {
			vars[optVar.name] = optVar.desc;
		}
		return vars;
	});
	
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
	
	<form method="POST" use:enhance={() => {
		isSubmitting = true;
		return async ({ result }) => {
			isSubmitting = false;
			if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true });
			} else if (result.type === 'success' && result.data?.id) {
				// Navigate to the new command's edit page
				await goto(`/admin/${selectedGuildId}/commands/${result.data.id}`, { invalidateAll: true });
			} else if (result.type === 'failure') {
				form = result.data;
			}
		};
	}} class="command-form">
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
			
			<div class="form-row">
				<div class="form-group">
					<label class="checkbox-label">
						<input type="checkbox" name="context_menu_user" value="true" />
						<span>👤 User Context Menu</span>
					</label>
					<p class="field-hint">Also show in Apps menu when right-clicking a user</p>
				</div>
				
				<div class="form-group">
					<label class="checkbox-label">
						<input type="checkbox" name="require_voice" value="true" />
						<span>🔊 Require Voice Channel</span>
					</label>
					<p class="field-hint">Only usable by members currently in a voice channel. Enables <code>{'{voice_channel.mention}'}</code> variable</p>
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
									<label>Name
									<input 
										type="text" 
										name="option_name[]"
										bind:value={option.name}
										placeholder="option_name"
										pattern="[a-zA-Z0-9_-]{1,32}"
									/>
									</label>
								</div>
								<div class="form-group">
									<label>Description
									<input 
										type="text" 
										name="option_description[]"
										bind:value={option.description}
										placeholder="What is this option for?"
									/>
									</label>
								</div>
								<div class="form-group">
									<label>Type
									<select name="option_type[]" bind:value={option.type}>
										{#each data.commonOptionTypes as optType}
											<option value={optType.value}>{optType.label} - {optType.description}</option>
										{/each}
									</select>
									</label>
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
										<label>Default Value
										<input 
											type="text" 
											name="option_default[]"
											bind:value={option.defaultValue}
											placeholder="Leave empty for no default"
										/>
										</label>
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
					<DiscordMessageEditor
						name="response_content"
						bind:value={responseContent}
						channels={sharedChannels}
						roles={sharedRoles}
						templateVariables={commandTemplateVariables}
						placeholder={'Hello {user.mention}! You used the command.'}
						rows={3}
					/>
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
								<select 
									id="action_type_{index}" 
									value={action.type} 
									onchange={(e) => {
										const newType = e.target.value;
										const schema = getActionConfigSchema(newType);
										const newConfig = { ...action.config };
										for (const configKey of Object.keys(schema)) {
											if (newConfig[configKey] === undefined) {
												newConfig[configKey] = '';
											}
										}
										// Update both type and config together to avoid undefined bindings
										actions = actions.map((a, i) => 
											i === index ? { ...a, type: newType, config: newConfig } : a
										);
									}} 
									required
								>
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
												{#if config.supportsVariables}
													<DiscordMessageEditor
														name="action_config.{index}.{configKey}"
														required={config.required}
														bind:value={action.config[configKey]}
														channels={sharedChannels}
														roles={sharedRoles}
														templateVariables={commandTemplateVariables}
														placeholder="Enter your message..."
														rows={4}
													/>
												{:else}
													<textarea 
														id="config_{index}_{configKey}" 
														name="action_config.{index}.{configKey}"
														required={config.required}
														placeholder=""
														rows="3"
														bind:value={action.config[configKey]}
													></textarea>
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
											{:else if config.type === 'roles'}
												<RoleSelector
													roles={sharedRoles}
													name="action_config.{index}.{configKey}"
													required={config.required}
													multiple={true}
													placeholder="Search and select role(s)..."
													bind:value={action.config[configKey]}
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
											{:else if config.type === 'webhook'}
												<select 
													id="config_{index}_{configKey}" 
													name="action_config.{index}.{configKey}"
													required={config.required}
													bind:value={action.config[configKey]}
												>
													<option value="">Select a webhook...</option>
													{#each data.webhooks || [] as webhook}
														<option value={webhook.id}>
															{webhook.name} ({webhook.method})
														</option>
													{/each}
												</select>
												{#if config.description}
													<p class="field-hint">{config.description}</p>
												{/if}
												{#if !data.webhooks?.length}
													<p class="field-hint hint-warning">
														No webhooks configured. <a href="/admin/{selectedGuildId}/settings">Add webhooks in Settings</a>
													</p>
												{/if}
											{:else if config.type === 'json'}
												<textarea 
													id="config_{index}_{configKey}" 
													name="action_config.{index}.{configKey}"
													required={config.required}
													placeholder={'{"key": "value"}'}
													rows="4"
													class="code-textarea"
													bind:value={action.config[configKey]}
												></textarea>
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
			{:else}
				<p class="no-actions-message">No actions configured. Add an action below to execute when this command is used.</p>
			{/if}
			
			<button type="button" class="btn btn-secondary" onclick={addAction}>
				➕ Add Action
			</button>
		</section>
		
		<!-- Permissions Section -->
		<section class="form-section">
			<h2>🔐 Permissions</h2>
			<p class="section-description">Control who can see and use this command</p>
			
			<div class="form-group">
				<label for="permission_preset">Permission Level</label>
				<select id="permission_preset" name="permission_preset" bind:value={selectedPermissionPreset}>
					{#each Object.entries(data.permissionPresets) as [key, preset]}
						<option value={key}>{preset.label} - {preset.description}</option>
					{/each}
				</select>
				<p class="field-hint">Discord will hide the command from users who don't have the required permissions</p>
			</div>
			
			{#if selectedPermissionPreset === 'custom'}
				<div class="custom-permissions">
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label>Required Permissions (user must have at least one):</label>
					<div class="permissions-grid">
						{#each Object.entries(data.permissionFlags) as [key, perm]}
							<label class="permission-checkbox">
								<input 
									type="checkbox" 
									name="custom_permission[]" 
									value={perm.value}
									bind:group={selectedCustomPermissions}
								/>
								<span class="permission-label">
									<span class="permission-name">{perm.label}</span>
									<span class="permission-desc">{perm.description}</span>
								</span>
							</label>
						{/each}
					</div>
				</div>
			{/if}
			
			<!-- Hidden field to pass the computed permission value -->
			<input type="hidden" name="default_member_permissions" value={computedPermissions}>
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
		background: var(--color-danger-soft);
		border: 1px solid var(--color-danger);
		border-radius: 8px;
		color: var(--color-danger);
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
		color: var(--color-danger);
	}
	
	.field-hint {
		margin: 0.375rem 0 0;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	
	.field-hint a {
		color: var(--color-primary);
		text-decoration: underline;
	}
	
	.code-textarea {
		font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
		font-size: 0.85rem;
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
		color: var(--color-warning);
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
		color: var(--color-danger);
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
	
	/* Permission styles */
	.custom-permissions {
		margin-top: 1rem;
	}
	
	.custom-permissions > label {
		display: block;
		margin-bottom: 0.75rem;
		font-weight: 500;
		color: var(--text-primary);
	}
	
	.permissions-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.75rem;
	}
	
	.permission-checkbox {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
		cursor: pointer;
		transition: background 0.2s;
	}
	
	.permission-checkbox:hover {
		background: var(--border-color, #40444b);
	}
	
	.permission-checkbox input[type="checkbox"] {
		margin-top: 0.25rem;
	}
	
	.permission-label {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	
	.permission-name {
		font-weight: 500;
		color: var(--text-primary);
	}
	
	.permission-desc {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
</style>
