<script>
	import { enhance } from '$app/forms';
	import ChannelSelector from '$lib/components/ChannelSelector.svelte';
	import RoleSelector from '$lib/components/RoleSelector.svelte';
	
	let { data, form } = $props();
	
	// Initialize from existing command data
	let selectedActionType = $state(data.command.action_type || 'NONE');
	let selectedResponseType = $state(data.command.response_type || 'message');
	let options = $state(data.command.options || []);
	
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
	
	const selectedGuildId = $derived(data.selectedGuildId);
	const command = $derived(data.command);
	
	function getActionConfigSchema(actionType) {
		if (!actionType || actionType === 'NONE') return {};
		return data.actionTypes[actionType]?.configSchema || {};
	}
	
	function addOption() {
		options = [...options, {
			name: '',
			description: '',
			type: 3,
			required: false
		}];
	}
	
	function removeOption(index) {
		options = options.filter((_, i) => i !== index);
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
	
	<form method="POST" action="?/update" use:enhance class="command-form">
		<input type="hidden" name="guild_id" value={selectedGuildId}>
		
		<!-- Status Banner -->
		{#if !command.registered && command.enabled}
			<div class="warning-banner">
				<span>⚠️</span>
				<span>This command has changes that need to be synced with Discord.</span>
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
		</section>
		
		<!-- Options Section -->
		<section class="form-section">
			<h2>⚙️ Command Options</h2>
			
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
											<option value={optType.value}>{optType.label}</option>
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
							</div>
						</div>
					{/each}
				</div>
			{/if}
			
			<button type="button" class="btn btn-secondary" onclick={addOption}>
				➕ Add Option
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
					<textarea 
						id="response_content" 
						name="response_content"
						rows="3"
						placeholder={'Hello {user.mention}!'}
					>{command.response_content || ''}</textarea>
					<div class="variables-help">
						<span class="variables-label">Available variables:</span>
						<div class="variables-list">
							{#each Object.entries(data.templateVariables) as [varName, desc]}
								<code title={desc}>{`{${varName}}`}</code>
							{/each}
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
			<h2>⚡ Action (Optional)</h2>
			
			<div class="form-group">
				<label for="action_type">Action Type</label>
				<select id="action_type" name="action_type" bind:value={selectedActionType}>
					<option value="NONE">🚫 No Action (Response Only)</option>
					{#each Object.entries(data.actionTypes) as [actionType, info]}
						<option value={actionType}>{info.icon} {info.name}</option>
					{/each}
				</select>
			</div>
			
			{#if selectedActionType && selectedActionType !== 'NONE'}
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
									rows="3"
								>{command.action_config?.[configKey] || ''}</textarea>
							{:else if config.type === 'number'}
								<input 
									type="number" 
									id="config_{configKey}" 
									name="action_config.{configKey}"
									value={command.action_config?.[configKey] ?? config.default ?? ''}
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
										checked={command.action_config?.[configKey] === 'true' || command.action_config?.[configKey] === true || config.default}
									/>
									<span>Enable</span>
								</label>
							{:else if config.type === 'channel_multi'}
								<ChannelSelector
									channels={sharedChannels}
									name="action_config.{configKey}"
									required={config.required}
									multiple={true}
									showAllOption={config.showAllOption}
									value={command.action_config?.[configKey] || config.default || ''}
								/>
							{:else if config.type === 'channel'}
								<ChannelSelector
									channels={sharedChannels}
									name="action_config.{configKey}"
									required={config.required}
									value={command.action_config?.[configKey] || ''}
								/>
							{:else if config.type === 'role'}
								<RoleSelector
									roles={sharedRoles}
									name="action_config.{configKey}"
									required={config.required}
									value={command.action_config?.[configKey] || ''}
								/>
							{:else}
								<input 
									type="text" 
									id="config_{configKey}" 
									name="action_config.{configKey}"
									required={config.required}
									value={command.action_config?.[configKey] || ''}
								/>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>
		
		<!-- Form Actions -->
		<div class="form-actions">
			<form method="POST" action="?/delete" use:enhance onsubmit={(e) => { if (!confirm('Delete this command?')) e.preventDefault(); }}>
				<input type="hidden" name="guild_id" value={selectedGuildId}>
				<button type="submit" class="btn btn-danger">
					🗑️ Delete Command
				</button>
			</form>
			<div class="form-actions-right">
				<a href="/admin/{selectedGuildId}/commands" class="btn btn-secondary">
					Cancel
				</a>
				<button type="submit" class="btn btn-primary">
					<span>✓</span>
					Save Changes
				</button>
			</div>
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
	
	.error-banner,
	.warning-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		border-radius: 8px;
		margin-bottom: 1.5rem;
	}
	
	.error-banner {
		background: rgba(237, 66, 69, 0.15);
		border: 1px solid #ED4245;
		color: #ED4245;
	}
	
	.warning-banner {
		background: rgba(254, 231, 92, 0.15);
		border: 1px solid #FEE75C;
		color: #FEE75C;
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
	
	/* Embed config */
	.embed-config {
		background: var(--bg-tertiary, #36393f);
		padding: 1rem;
		border-radius: 8px;
		border-left: 4px solid var(--accent-color, #5865F2);
	}
	
	/* Action config */
	.action-config {
		margin-top: 1.5rem;
		padding: 1rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
	}
	
	.action-config h3 {
		margin: 0 0 1rem;
		font-size: 1rem;
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
		.form-row,
		.option-fields {
			grid-template-columns: 1fr;
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
</style>
