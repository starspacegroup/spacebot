<script>
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import ChannelSelector from '$lib/components/ChannelSelector.svelte';
	import RoleSelector from '$lib/components/RoleSelector.svelte';
	import DiscordMessageEditor from '$lib/components/DiscordMessageEditor.svelte';
	import ButtonEditor from '$lib/components/ButtonEditor.svelte';
	import { log } from '$lib/log.js';
	
	let { data, form } = $props();
	
	// Form submission state
	let isSubmitting = $state(false);
	
	// Get action config schema (used by parseExistingActions and initializeActionConfig)
	function getActionConfigSchema(actionType) {
		if (!actionType || actionType === 'NONE') return {};
		return data.actionTypes[actionType]?.configSchema || {};
	}
	
	// Initialize config values for an action based on schema
	function initializeConfigForAction(action) {
		const schema = getActionConfigSchema(action.type);
		for (const configKey of Object.keys(schema)) {
			if (action.config[configKey] === undefined) {
				action.config[configKey] = '';
			}
		}
		return action;
	}

	function normalizeOptionName(name) {
		return (name || '').toLowerCase().replace(/\s+/g, '_');
	}

	function withActionRoutingDefaults(action) {
		return {
			...action,
			group: (action.group || 'default').trim() || 'default',
			condition: {
				mode: action.condition?.mode || 'always',
				option: action.condition?.option || '',
				value: action.condition?.value ?? ''
			}
		};
	}

	function getConditionChoices(optionName) {
		const normalized = normalizeOptionName(optionName);
		if (!normalized) return [];

		const option = options.find((opt) => normalizeOptionName(opt.name) === normalized);
		if (!option) return [];

		if (option.type === 5) {
			return [
				{ value: 'true', label: 'True' },
				{ value: 'false', label: 'False' }
			];
		}

		if (option.choices && option.choices.length > 0) {
			return option.choices.map((choice) => ({
				value: String(choice.value ?? ''),
				label: choice.name || String(choice.value ?? '')
			}));
		}

		return [];
	}

	// Initialize from existing command data - support multiple actions
	function parseExistingActions() {
		// Handle legacy single action format or new array format
		if (data.command.actions && Array.isArray(data.command.actions)) {
			return data.command.actions.map(a => withActionRoutingDefaults(initializeConfigForAction({
				type: a.type || 'NONE',
				config: a.config || {},
				group: a.group,
				condition: a.condition
			})));
		}
		// Legacy format: single action_type and action_config
		if (data.command.action_type && data.command.action_type !== 'NONE') {
			return [withActionRoutingDefaults(initializeConfigForAction({
				type: data.command.action_type,
				config: data.command.action_config || {}
			}))];
		}
		return [];
	}
	
	let actions = $state(parseExistingActions());
	// svelte-ignore state_referenced_locally
	let selectedResponseType = $state(data.command.response_type || 'message');
	// svelte-ignore state_referenced_locally
	let responseContent = $state(data.command.response_content || '');
	let showDeleteConfirm = $state(false);
	
	// Map 'default' from DB to 'defaultValue' for UI binding
	// Also map types to choice types when choices are present
	function normalizeOptions(rawOptions) {
		return (rawOptions || []).map(opt => {
			let displayType = opt.type;
			// Map stored type to choice type UI if choices are present
			if (opt.choices && opt.choices.length > 0) {
				if (opt.type === 3) displayType = 103; // STR WITH CHOICES → CHOICE_TEXT
				else if (opt.type === 4) displayType = 104; // INT WITH CHOICES → CHOICE_INTEGER
			}
			return {
				...opt,
				type: displayType,
				defaultValue: opt.default || ''
			};
		});
	}
	
	// svelte-ignore state_referenced_locally
	let options = $state(normalizeOptions(data.command.options));
	
	// Permission controls - initialize from existing command data
	function getInitialPermissionPreset() {
		const perm = data.command.default_member_permissions;
		if (!perm) return 'everyone';
		// Check if it matches a known preset
		for (const [key, preset] of Object.entries(data.permissionPresets)) {
			if (preset.value === perm) return key;
		}
		return 'custom';
	}
	
	// svelte-ignore state_referenced_locally
	let selectedPermissionPreset = $state(getInitialPermissionPreset());
	// svelte-ignore state_referenced_locally
	let selectedCustomPermissions = $state(
		data.command.default_member_permissions && getInitialPermissionPreset() === 'custom'
			? [data.command.default_member_permissions]
			: []
	);
	
	// Compute the permission value based on preset or custom selection
	const computedPermissions = $derived(
		selectedPermissionPreset === 'everyone'
			? ''
			: selectedPermissionPreset === 'custom'
				? (selectedCustomPermissions.length === 0 ? '' : selectedCustomPermissions[0])
				: (data.permissionPresets[selectedPermissionPreset]?.value || '')
	);
	
	// Shared channel data
	let sharedChannels = $state(null);
	let channelsLoading = $state(false);
	
	// Shared role data
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
	
	const selectedGuildId = $derived(data.selectedGuildId);
	const command = $derived(data.command);
	
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

	function addAction() {
		actions = [...actions, withActionRoutingDefaults({ type: '', config: {} })];
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
	
	function addOption() {
		options = [...options, {
			name: '',
			description: '',
			type: 3,
			required: false,
			defaultValue: '',
			choices: []
		}];
	}
	
	function removeOption(index) {
		options = options.filter((_, i) => i !== index);
	}
	
	// Check if option type has choices
	function isChoiceType(type) {
		const typeInfo = data.commonOptionTypes.find(t => t.value === type);
		return typeInfo?.isChoice || false;
	}
	
	// Add a choice to an option
	function addChoice(optionIndex) {
		options = options.map((opt, i) =>
			i === optionIndex
				? { ...opt, choices: [...(opt.choices || []), { name: '', value: '' }] }
				: opt
		);
	}
	
	// Remove a choice from an option
	function removeChoice(optionIndex, choiceIndex) {
		options = options.map((opt, i) =>
			i === optionIndex
				? { ...opt, choices: opt.choices.filter((_, j) => j !== choiceIndex) }
				: opt
		);
	}
	
	// Drag reorder state for choices
	let dragState = $state({ optionIndex: -1, choiceIndex: -1, dropTarget: -1 });
	
	function choiceDragStart(optionIndex, choiceIndex, e) {
		dragState = { optionIndex, choiceIndex, dropTarget: -1 };
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', '');
		}
	}
	
	function choiceDragOver(optionIndex, choiceIndex, e) {
		e.preventDefault();
		if (dragState.optionIndex !== optionIndex) return;
		if (dragState.choiceIndex === choiceIndex) return;
		const rect = e.currentTarget.getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		const insertAt = e.clientY < midY ? choiceIndex : choiceIndex + 1;
		if (insertAt !== dragState.dropTarget) {
			dragState = { ...dragState, dropTarget: insertAt };
		}
	}
	
	function choiceDrop(optionIndex, e) {
		e.preventDefault();
		const { choiceIndex, dropTarget } = dragState;
		if (dropTarget === -1 || dropTarget === choiceIndex || dropTarget === choiceIndex + 1) {
			dragState = { optionIndex: -1, choiceIndex: -1, dropTarget: -1 };
			return;
		}
		options = options.map((opt, i) => {
			if (i === optionIndex) {
				const newChoices = [...opt.choices];
				const [moved] = newChoices.splice(choiceIndex, 1);
				const adjustedTarget = dropTarget > choiceIndex ? dropTarget - 1 : dropTarget;
				newChoices.splice(adjustedTarget, 0, moved);
				return { ...opt, choices: newChoices };
			}
			return opt;
		});
		dragState = { optionIndex: -1, choiceIndex: -1, dropTarget: -1 };
	}
	
	function choiceDragEnd() {
		dragState = { optionIndex: -1, choiceIndex: -1, dropTarget: -1 };
	}
	
	// Touch drag reorder for choices
	let touchState = $state({ optionIndex: -1, choiceIndex: -1, dropTarget: -1 });
	
	function choiceTouchStart(optionIndex, choiceIndex, e) {
		touchState = { optionIndex, choiceIndex, dropTarget: -1 };
	}
	
	function choiceTouchMove(optionIndex, e) {
		if (touchState.optionIndex !== optionIndex) return;
		e.preventDefault();
		const touch = e.touches[0];
		const items = [...e.currentTarget.querySelectorAll('.choice-item')];
		for (let idx = 0; idx < items.length; idx++) {
			const rect = items[idx].getBoundingClientRect();
			if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
				const midY = rect.top + rect.height / 2;
				const insertAt = touch.clientY < midY ? idx : idx + 1;
				if (insertAt !== touchState.dropTarget) {
					touchState = { ...touchState, dropTarget: insertAt };
				}
				break;
			}
		}
	}
	
	function choiceTouchEnd() {
		const { optionIndex, choiceIndex, dropTarget } = touchState;
		if (dropTarget !== -1 && dropTarget !== choiceIndex && dropTarget !== choiceIndex + 1) {
			options = options.map((opt, i) => {
				if (i === optionIndex) {
					const newChoices = [...opt.choices];
					const [moved] = newChoices.splice(choiceIndex, 1);
					const adjustedTarget = dropTarget > choiceIndex ? dropTarget - 1 : dropTarget;
					newChoices.splice(adjustedTarget, 0, moved);
					return { ...opt, choices: newChoices };
				}
				return opt;
			});
		}
		touchState = { optionIndex: -1, choiceIndex: -1, dropTarget: -1 };
	}
	
	function getDropIndicator(optIndex, choiceIdx) {
		const ds = dragState.optionIndex === optIndex ? dragState : 
					touchState.optionIndex === optIndex ? touchState : null;
		if (!ds || ds.dropTarget === -1) return 'none';
		if (ds.dropTarget === ds.choiceIndex || ds.dropTarget === ds.choiceIndex + 1) return 'none';
		if (ds.dropTarget === choiceIdx) return 'before';
		return 'none';
	}
	
	function showAfterIndicator(optIndex, lastIdx) {
		const ds = dragState.optionIndex === optIndex ? dragState : 
					touchState.optionIndex === optIndex ? touchState : null;
		if (!ds || ds.dropTarget === -1) return false;
		if (ds.dropTarget === ds.choiceIndex || ds.dropTarget === ds.choiceIndex + 1) return false;
		return ds.dropTarget === lastIdx + 1;
	}
	
	// Computed option variables for template help
	const optionVariables = $derived(
		options
			.filter(opt => opt.name)
			.flatMap(opt => {
				const optName = opt.name.toLowerCase().replace(/\s+/g, '_');
				const vars = [{
					name: `option.${optName}`,
					desc: opt.description || `Value of ${opt.name} option`
				}];
				// Add _mention variant for user, role, and channel type options
				if (opt.type === 6) { // USER
					vars.push({ name: `option.${optName}_mention`, desc: `Mention the ${opt.name} user` });
				} else if (opt.type === 7) { // CHANNEL
					vars.push({ name: `option.${optName}_mention`, desc: `Mention the ${opt.name} channel` });
				} else if (opt.type === 8) { // ROLE
					vars.push({ name: `option.${optName}_mention`, desc: `Mention the ${opt.name} role` });
				}
				return vars;
			})
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
	<title>Edit Command | SpaceBot Admin</title>
</svelte:head>

<div class="command-form-page">
	<header class="page-header">
		<a href="/admin/{selectedGuildId}/commands" class="back-link">
			← Back to Commands
		</a>
		<h1>
			<span class="header-icon">✏️</span>
			Edit Command
		</h1>
		<p class="header-subtitle">Update your slash command configuration</p>
	</header>
	
	{#if form?.error}
		<div class="error-banner">
			<span>⚠️</span>
			<span>{form.error}</span>
		</div>
	{/if}
	
	<form method="POST" action="?/update" use:enhance={() => {
		isSubmitting = true;
		return async ({ result }) => {
			isSubmitting = false;
			if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true });
			} else if (result.type === 'failure') {
				form = result.data;
			}
		};
	}} class="command-form">
		<input type="hidden" name="guild_id" value={selectedGuildId}>
		<input type="hidden" name="is_built_in" value={data.command.is_built_in ? 'true' : 'false'}>
		
		{#if data.command.is_built_in}
			<div class="builtin-notice">
				<span class="builtin-notice-icon">🔧</span>
				<div>
					<strong>Built-in Command</strong>
					{#if data.isSuperAdmin}
						<p>This is a built-in command. As superadmin, your changes apply globally.</p>
					{:else}
						<p>This is a built-in command. On this page, your changes apply to this server's permissions only.</p>
					{/if}
				</div>
			</div>
		{/if}
		
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
						value={command.name}
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
					value={command.description}
				/>
			</div>
			
			<div class="form-row">
				<div class="form-group">
					<label class="checkbox-label">
						<input type="checkbox" name="ephemeral" value="true" checked={command.ephemeral} />
						<span>🔒 Ephemeral (Private Response)</span>
					</label>
				</div>
				
				<div class="form-group">
					<label class="checkbox-label">
						<input type="checkbox" name="defer" value="true" checked={command.defer} />
						<span>⏳ Defer Response</span>
					</label>
				</div>
			</div>
			
			<div class="form-row">
				<div class="form-group">
					<label class="checkbox-label">
						<input type="checkbox" name="context_menu_user" value="true" checked={command.context_menu_user} />
						<span>👤 User Context Menu</span>
					</label>
					<p class="field-hint">Also show in Apps menu when right-clicking a user</p>
				</div>
				
				<div class="form-group">
					<label class="checkbox-label">
						<input type="checkbox" name="require_voice" value="true" checked={command.require_voice} />
						<span>🔊 Require Voice Channel</span>
					</label>
					<p class="field-hint">Only usable by members currently in a voice channel. Enables <code>{'{voice_channel.mention}'}</code> variable</p>
				</div>
			</div>
		</section>
		
		<!-- Options Section -->
		<section class="form-section">
			<h2>⚙️ Command Options</h2>
			
			{#if options.length > 0}
				<div class="options-list">
					{#each options as option, index}
						<div class="option-card">
							<div class="option-card-header">
								<div class="option-card-title">
									<span class="option-badge">{index + 1}</span>
									<span class="option-name-display">{option.name || 'unnamed'}</span>
									<span class="option-type-tag">{data.commonOptionTypes.find(t => t.value === option.type)?.label || 'Text'}</span>
									{#if option.required}<span class="option-required-tag">Required</span>{/if}
								</div>
								<button type="button" class="option-remove" onclick={() => removeOption(index)} title="Remove option">✕</button>
							</div>
							
							<div class="option-card-body">
								<div class="option-row">
									<div class="option-field option-field-name">
										<label>Name <span class="required">*</span>
										<input 
											type="text" 
											name="option_name[]"
											bind:value={option.name}
											placeholder="option_name"
											pattern="[a-zA-Z0-9_-]{'{1,32}'}"
											required
										/>
										</label>
									</div>
									<div class="option-field option-field-type">
										<label>Type
										<select name="option_type[]" bind:value={option.type}>
											{#each data.commonOptionTypes as optType}
												<option value={optType.value}>{optType.label}</option>
											{/each}
										</select>
										</label>
									</div>
								</div>
								
								<div class="option-field">
									<label>Description
									<input 
										type="text" 
										name="option_description[]"
										bind:value={option.description}
										placeholder="What does this option do?"
									/>
									</label>
								</div>
								
								<div class="option-inline-row">
									<label class="checkbox-label">
										<input 
											type="checkbox" 
											name="option_required[]"
											value={index}
											bind:checked={option.required}
										/>
										<span>Required</span>
									</label>
									{#if !option.required}
										<div class="option-default-inline">
											<label>Default:
											<input 
												type="text" 
												name="option_default[]"
												bind:value={option.defaultValue}
												placeholder="none"
											/>
											</label>
										</div>
									{/if}
								</div>
								
								{#if isChoiceType(option.type)}
									<div class="choices-section">
										<div class="choices-header">
											<span class="choices-label">Choices</span>
											<button type="button" class="btn-add-choice" onclick={() => addChoice(index)}>+ Add</button>
										</div>
										{#if option.choices && option.choices.length > 0}
											<div 
												role="list"
												class="choices-list" 
												ondrop={(e) => choiceDrop(index, e)}
												ondragover={(e) => e.preventDefault()}
												ontouchmove={(e) => choiceTouchMove(index, e)}
												ontouchend={choiceTouchEnd}
											>
												{#each option.choices as choice, choiceIndex}
													{#if getDropIndicator(index, choiceIndex) === 'before'}
														<div class="drop-indicator"></div>
													{/if}
													<div 
														role="listitem"
														class="choice-item"
														class:dragging={dragState.optionIndex === index && dragState.choiceIndex === choiceIndex}
														draggable="true"
														ondragstart={(e) => choiceDragStart(index, choiceIndex, e)}
														ondragover={(e) => choiceDragOver(index, choiceIndex, e)}
														ondragend={choiceDragEnd}
													>
														<span 
															class="drag-handle" 
															ontouchstart={(e) => choiceTouchStart(index, choiceIndex, e)}
															title="Drag to reorder"
														>⠿</span>
														<div class="choice-fields">
															<input 
																type="text" 
																name="option_choice_name[{index}][]"
																bind:value={choice.name}
																placeholder="Display name"
																required
															/>
															<input 
																type="text" 
																name="option_choice_value[{index}][]"
																bind:value={choice.value}
																placeholder="Value"
																required
															/>
														</div>
														<button type="button" class="choice-delete" onclick={() => removeChoice(index, choiceIndex)} title="Remove">✕</button>
													</div>
												{/each}
												{#if showAfterIndicator(index, option.choices.length - 1)}
													<div class="drop-indicator"></div>
												{/if}
											</div>
										{:else}
											<p class="choices-empty">No choices yet — add one above</p>
										{/if}
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
			
			<button type="button" class="btn btn-secondary" onclick={addOption}>
				+ Add Option
			</button>
		</section>
		
		<!-- Response Section -->
		<section class="form-section">
			<h2>💬 Response</h2>
			
			<div class="form-group">
				<label for="response_type">Response Type</label>
				<select id="response_type" name="response_type" bind:value={selectedResponseType}>
					{#each Object.entries(data.responseTypes) as [type, info]}
						<option value={type}>{info.label}</option>
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
						placeholder={'Hello {user.mention}!'}
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
							value={command.response_embed?.title || ''}
						/>
					</div>
					<div class="form-group">
						<label for="embed_description">Embed Description</label>
						<textarea 
							id="embed_description" 
							name="embed_description"
							rows="3"
						>{command.response_embed?.description || ''}</textarea>
					</div>
					<div class="form-group">
						<label for="embed_color">Embed Color</label>
						<input 
							type="color" 
							id="embed_color" 
							name="embed_color"
							value={command.response_embed?.color ? `#${command.response_embed.color.toString(16).padStart(6, '0')}` : '#5865F2'}
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

							<div class="action-routing">
								<div class="form-row">
									<div class="form-group">
										<label for="action_group_{index}">Action Group</label>
										<input
											type="text"
											id="action_group_{index}"
											name="action_group.{index}"
											bind:value={action.group}
											placeholder="default"
										/>
										<p class="field-hint">Actions with the same group share one option condition.</p>
									</div>
									<div class="form-group">
										<label for="action_condition_mode_{index}">Run Condition</label>
										<select
											id="action_condition_mode_{index}"
											name="action_condition_mode.{index}"
											bind:value={action.condition.mode}
											onchange={(e) => {
												action.condition.mode = e.target.value;
												if (action.condition.mode === 'always') {
													action.condition.option = '';
													action.condition.value = '';
												}
											}}
										>
											<option value="always">Always run</option>
											<option value="if_equals">Run when option equals value</option>
											<option value="if_not_equals">Run when option does not equal value</option>
										</select>
									</div>
								</div>

								{#if action.condition.mode !== 'always'}
									<div class="form-row">
										<div class="form-group">
											<label for="action_condition_option_{index}">Command Option</label>
											<select
												id="action_condition_option_{index}"
												name="action_condition_option.{index}"
												bind:value={action.condition.option}
												onchange={(e) => {
													action.condition.option = e.target.value;
													const choices = getConditionChoices(action.condition.option);
													action.condition.value = choices.length > 0 ? choices[0].value : '';
												}}
											>
												<option value="">Select an option...</option>
												{#each options.filter((opt) => opt.name) as opt}
													<option value={normalizeOptionName(opt.name)}>{opt.name}</option>
												{/each}
											</select>
										</div>

										{#if action.condition.option}
											{@const conditionChoices = getConditionChoices(action.condition.option)}
											<div class="form-group">
												<label for="action_condition_value_{index}">Match Value</label>
												{#if conditionChoices.length > 0}
													<select
														id="action_condition_value_{index}"
														name="action_condition_value.{index}"
														bind:value={action.condition.value}
													>
														{#each conditionChoices as choice}
															<option value={choice.value}>{choice.label}</option>
														{/each}
													</select>
												{:else}
													<input
														type="text"
														id="action_condition_value_{index}"
														name="action_condition_value.{index}"
														bind:value={action.condition.value}
														placeholder="Enter value"
													/>
												{/if}
											</div>
										{/if}
									</div>
								{/if}
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
													multiple={true}
													showAllOption={config.showAllOption}
													value={action.config[configKey] || config.default || ''}
												/>
											{:else if config.type === 'channel'}
												<ChannelSelector
													channels={sharedChannels}
													name="action_config.{index}.{configKey}"
													required={config.required}
													value={action.config[configKey] || ''}
												/>
											{:else if config.type === 'role'}
												<RoleSelector
													roles={sharedRoles}
													name="action_config.{index}.{configKey}"
													required={config.required}
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
											{:else if config.type === 'button_rows'}
												<input type="hidden" name="action_config.{index}.{configKey}" value={JSON.stringify(action.config[configKey] || [])} />
												<ButtonEditor
													bind:value={action.config[configKey]}
													actionTypes={data.actionTypes}
													templateVariables={commandTemplateVariables}
													channels={sharedChannels}
													roles={sharedRoles}
													guildId={selectedGuildId}
													userSources={availableUserSources()}
												/>
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
			{#if !data.command.is_built_in}
				<button type="button" class="btn btn-danger" onclick={() => showDeleteConfirm = true}>
					🗑️ Delete Command
				</button>
			{:else}
				<div></div>
			{/if}
			<div class="form-actions-right">
				<a href="/admin/{selectedGuildId}/commands" class="btn btn-secondary">
					Cancel
				</a>
				<button type="submit" class="btn btn-primary">
					<span>✓</span>
					{data.command.is_built_in && !data.isSuperAdmin ? 'Save Permission Override' : 'Save Changes'}
				</button>
			</div>
		</div>
	</form>
	
	<!-- Delete Confirmation Modal -->
	{#if showDeleteConfirm}
		<div class="confirm-overlay" onclick={() => showDeleteConfirm = false} role="presentation">
			<div class="confirm-dialog" role="alertdialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
				<h3>🗑️ Delete Command</h3>
				<p>Are you sure you want to delete <strong>/{command.name}</strong>? This action cannot be undone.</p>
				<div class="confirm-actions">
					<button type="button" class="btn btn-secondary" onclick={() => showDeleteConfirm = false}>
						Cancel
					</button>
					<form method="POST" action="?/delete" use:enhance={() => {
						isSubmitting = true;
						return async ({ result }) => {
							isSubmitting = false;
							if (result.type === 'redirect') {
								await goto(result.location, { invalidateAll: true });
							} else if (result.type === 'failure') {
								form = result.data;
								showDeleteConfirm = false;
							}
						};
					}}>
						<input type="hidden" name="guild_id" value={selectedGuildId}>
						<button type="submit" class="btn btn-danger" disabled={isSubmitting}>
							{isSubmitting ? 'Deleting...' : 'Delete'}
						</button>
					</form>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.command-form-page {
		padding: 1.5rem;
		max-width: 800px;
		margin: 0 auto;
	}
	
	.builtin-notice {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		background: color-mix(in srgb, var(--accent-color, #5865F2) 15%, transparent);
		border: 1px solid var(--accent-color, #5865F2);
		border-radius: 8px;
		margin-bottom: 1.5rem;
	}
	
	.builtin-notice-icon {
		font-size: 1.5rem;
	}
	
	.builtin-notice p {
		margin: 0.25rem 0 0;
		font-size: 0.85rem;
		color: var(--text-muted);
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
		border-radius: 8px;
		margin-bottom: 1.5rem;
	}
	
	.error-banner {
		background: var(--color-danger-soft);
		border: 1px solid var(--color-danger);
		color: var(--color-danger);
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
		margin: 0 0 1rem;
		font-size: 1.25rem;
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
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	
	.option-card {
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid transparent;
		transition: border-color 0.15s;
	}
	
	.option-card:hover {
		border-color: var(--border-color, #40444b);
	}
	
	.option-card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.75rem;
		background: var(--bg-primary, #202225);
		gap: 0.5rem;
	}
	
	.option-card-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		flex: 1;
		overflow: hidden;
	}
	
	.option-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.375rem;
		height: 1.375rem;
		background: var(--accent-color, #5865F2);
		border-radius: 50%;
		font-size: 0.75rem;
		font-weight: 700;
		color: white;
		flex-shrink: 0;
	}
	
	.option-name-display {
		font-weight: 600;
		font-size: 0.875rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text-primary);
	}
	
	.option-type-tag {
		font-size: 0.6875rem;
		padding: 0.125rem 0.5rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 999px;
		color: var(--text-muted);
		white-space: nowrap;
		flex-shrink: 0;
	}
	
	.option-required-tag {
		font-size: 0.6875rem;
		padding: 0.125rem 0.5rem;
		background: rgba(88, 101, 242, 0.15);
		color: var(--accent-color, #5865F2);
		border-radius: 999px;
		white-space: nowrap;
		flex-shrink: 0;
	}
	
	.option-remove {
		background: none;
		border: none;
		color: var(--text-muted, #72767d);
		cursor: pointer;
		padding: 0.25rem 0.375rem;
		font-size: 0.875rem;
		line-height: 1;
		border-radius: 4px;
		transition: color 0.15s, background 0.15s;
		flex-shrink: 0;
	}
	
	.option-remove:hover {
		color: var(--danger-color, #ed4245);
		background: rgba(237, 66, 69, 0.1);
	}
	
	.option-card-body {
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	
	.option-row {
		display: flex;
		gap: 0.625rem;
	}
	
	.option-field {
		flex: 1;
		min-width: 0;
	}
	
	.option-field label {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}
	
	.option-field input,
	.option-field select {
		margin-top: 0.25rem;
		font-size: 0.875rem;
	}
	
	.option-field-name {
		flex: 1.5;
	}
	
	.option-field-type {
		flex: 1;
	}
	
	.option-inline-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	
	.option-inline-row .checkbox-label {
		margin: 0;
	}
	
	.option-default-inline {
		flex: 1;
		min-width: 120px;
	}
	
	.option-default-inline label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--text-muted);
	}
	
	.option-default-inline input {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: 0.25rem 0.5rem;
		font-size: 0.8125rem;
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
	
	.section-description {
		color: var(--text-muted);
		font-size: 0.875rem;
		margin: -0.5rem 0 1rem;
	}
	
	.form-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding-top: 1rem;
	}
	
	.form-actions-right {
		display: flex;
		gap: 0.75rem;
	}
	
	/* Responsive */
	@media (max-width: 640px) {
		.form-row {
			grid-template-columns: 1fr;
		}
		
		.option-row {
			flex-direction: column;
		}
		
		.form-actions {
			flex-direction: column;
		}
		
		.form-actions-right {
			width: 100%;
		}
		
		.form-actions-right .btn {
			flex: 1;
		}
	}
	
	/* Delete Confirmation Modal */
	.confirm-overlay {
		position: fixed;
		inset: 0;
		background: var(--color-overlay-scrim);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		backdrop-filter: blur(4px);
	}
	
	.confirm-dialog {
		background: var(--card-bg, #2a2a2a);
		border: 1px solid var(--border-color, #3a3a3a);
		border-radius: 12px;
		padding: 1.5rem;
		max-width: 400px;
		width: 90%;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
	}
	
	.confirm-dialog h3 {
		margin: 0 0 0.75rem;
		font-size: 1.25rem;
	}
	
	.confirm-dialog p {
		margin: 0 0 1.5rem;
		color: var(--text-muted, #888);
	}
	
	.confirm-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
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
	
	/* Choices styles */
	.choices-section {
		border-top: 1px solid var(--border-color, #40444b);
		padding-top: 0.625rem;
		margin-top: 0.25rem;
	}
	
	.choices-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.375rem;
	}
	
	.choices-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-muted);
	}
	
	.btn-add-choice {
		background: none;
		border: none;
		color: var(--accent-color, #5865F2);
		cursor: pointer;
		font-size: 0.8125rem;
		font-weight: 500;
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		transition: background 0.15s;
	}
	
	.btn-add-choice:hover {
		background: rgba(88, 101, 242, 0.1);
	}
	
	.choices-empty {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin: 0;
		font-style: italic;
	}
	
	.choices-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-bottom: 0.5rem;
	}
	
	.choice-item {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 6px;
		transition: opacity 0.15s, box-shadow 0.15s;
	}
	
	.choice-item.dragging {
		opacity: 0.4;
	}
	
	.drop-indicator {
		height: 2px;
		background: var(--accent-color, #5865F2);
		border-radius: 1px;
		margin: -1px 0;
		position: relative;
		z-index: 1;
		box-shadow: 0 0 4px var(--accent-color, #5865F2);
	}
	
	.drag-handle {
		cursor: grab;
		color: var(--text-muted, #72767d);
		font-size: 1rem;
		line-height: 1;
		padding: 0.25rem;
		user-select: none;
		touch-action: none;
		flex-shrink: 0;
	}
	
	.drag-handle:active { cursor: grabbing; }
	
	.choice-fields {
		display: flex;
		gap: 0.375rem;
		flex: 1;
		min-width: 0;
	}
	
	.choice-fields input {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: 0.375rem 0.5rem;
		font-size: 0.8125rem;
		min-height: 36px;
	}
	
	.choice-delete {
		background: none;
		border: none;
		color: var(--text-muted, #72767d);
		cursor: pointer;
		padding: 0.25rem;
		font-size: 0.875rem;
		line-height: 1;
		border-radius: 4px;
		flex-shrink: 0;
		transition: color 0.15s, background 0.15s;
	}
	
	.choice-delete:hover {
		color: var(--danger-color, #ed4245);
		background: rgba(237, 66, 69, 0.1);
	}

	/* Mobile: stack fields vertically */
	@media (max-width: 480px) {
		.choice-fields {
			flex-direction: column;
		}
	}
	
	/* Tablet and up */
	@media (min-width: 768px) {
		.choice-item {
			flex-direction: row;
			align-items: center;
		}
	}
	
	/* Mobile responsive improvements */
	@media (max-width: 640px) {
		/* Better mobile touch targets */
		.btn {
			min-height: 48px;
			font-size: 1rem;
		}
		
		.btn-sm {
			min-height: 44px;
			padding: 0.5rem 0.75rem;
		}
	}
</style>
