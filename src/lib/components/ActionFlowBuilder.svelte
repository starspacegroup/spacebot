<script>
	/**
	 * ActionFlowBuilder - Mobile-first drag-and-drop action sequence builder
	 * Used for building action sequences in automations, commands, and button actions
	 * Supports reordering via drag-and-drop (desktop) and touch (mobile)
	 */
	import ChannelSelector from './ChannelSelector.svelte';
	import RoleSelector from './RoleSelector.svelte';
	import DiscordMessageEditor from './DiscordMessageEditor.svelte';
	
	let {
		actions = $bindable([]),
		actionTypes = {},
		templateVariables = {},
		channels = null,
		roles = null,
		guildId = '',
		userSources = [],
		numberOptions = [],
		compact = false,
	} = $props();
	
	// Drag state
	let dragIndex = $state(null);
	let dragOverIndex = $state(null);
	
	// Touch drag state
	let touchDrag = $state(null);
	let touchClone = $state(null);
	
	// Collapsed state per action
	let collapsedActions = $state(new Set());
	
	function getActionConfigSchema(actionType) {
		if (!actionType || actionType === 'NONE') return {};
		return actionTypes[actionType]?.configSchema || {};
	}
	
	function getActionInfo(actionType) {
		return actionTypes[actionType] || { name: actionType, icon: '⚡', description: '' };
	}
	
	function addAction() {
		actions = [...actions, { type: '', config: {} }];
	}
	
	function removeAction(index) {
		actions = actions.filter((_, i) => i !== index);
		collapsedActions.delete(index);
	}
	
	function updateActionType(index, newType) {
		const schema = getActionConfigSchema(newType);
		const newConfig = {};
		for (const configKey of Object.keys(schema)) {
			newConfig[configKey] = schema[configKey].default ?? '';
		}
		actions = actions.map((a, i) => 
			i === index ? { ...a, type: newType, config: newConfig } : a
		);
	}
	
	function moveAction(fromIndex, toIndex) {
		if (fromIndex === toIndex) return;
		const newActions = [...actions];
		const [moved] = newActions.splice(fromIndex, 1);
		newActions.splice(toIndex, 0, moved);
		actions = newActions;
	}
	
	function toggleCollapse(index) {
		const newSet = new Set(collapsedActions);
		if (newSet.has(index)) {
			newSet.delete(index);
		} else {
			newSet.add(index);
		}
		collapsedActions = newSet;
	}
	
	// Desktop drag and drop
	function handleDragStart(index, e) {
		dragIndex = index;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', '');
	}
	
	function handleDragOver(index, e) {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		if (dragIndex !== null && dragIndex !== index) {
			dragOverIndex = index;
		}
	}
	
	function handleDragLeave() {
		dragOverIndex = null;
	}
	
	function handleDrop(index, e) {
		e.preventDefault();
		if (dragIndex !== null && dragIndex !== index) {
			moveAction(dragIndex, index);
		}
		dragIndex = null;
		dragOverIndex = null;
	}
	
	function handleDragEnd() {
		dragIndex = null;
		dragOverIndex = null;
	}
	
	// Mobile touch drag
	function handleTouchStart(index, e) {
		const touch = e.touches[0];
		touchDrag = {
			index,
			startY: touch.clientY,
			currentY: touch.clientY,
			startX: touch.clientX,
			moved: false,
		};
	}
	
	function handleTouchMove(e) {
		if (!touchDrag) return;
		const touch = e.touches[0];
		const dy = Math.abs(touch.clientY - touchDrag.startY);
		const dx = Math.abs(touch.clientX - touchDrag.startX);
		
		if (dy > 8 || dx > 8) {
			touchDrag.moved = true;
			touchDrag.currentY = touch.clientY;
			
			// Find which action the touch is over
			const elements = document.querySelectorAll('.flow-action-item');
			for (let i = 0; i < elements.length; i++) {
				const rect = elements[i].getBoundingClientRect();
				if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
					if (i !== touchDrag.index) {
						dragOverIndex = i;
					}
					break;
				}
			}
			
			e.preventDefault(); // Prevent scrolling while dragging
		}
	}
	
	function handleTouchEnd() {
		if (touchDrag && touchDrag.moved && dragOverIndex !== null) {
			moveAction(touchDrag.index, dragOverIndex);
		}
		touchDrag = null;
		dragOverIndex = null;
	}
	
	// Color rules helpers
	function getColorRules(action, configKey) {
		try {
			const v = action.config[configKey];
			if (Array.isArray(v)) return v;
			if (typeof v === 'string' && v) return JSON.parse(v);
		} catch {}
		return [];
	}

	function updateColorRule(action, configKey, ruleIndex, field, value) {
		const rules = getColorRules(action, configKey);
		rules[ruleIndex] = { ...rules[ruleIndex], [field]: value };
		action.config[configKey] = [...rules];
	}

	function removeColorRule(action, configKey, ruleIndex) {
		const rules = getColorRules(action, configKey);
		rules.splice(ruleIndex, 1);
		action.config[configKey] = [...rules];
	}

	function addColorRule(action, configKey) {
		const rules = getColorRules(action, configKey);
		action.config[configKey] = [...rules, { variable: '', operator: 'equals', value: '', color: '#57F287' }];
	}
	
	// Helper to check if a number_source field is using an option reference
	function isOptionReference(value) {
		return typeof value === 'string' && value.startsWith('option:');
	}

	/**
	 * Format a delay value for display
	 * Supports: 5m, 1h, 2d, or custom like "30mc" (custom minutes)
	 */
	function formatDelay(value) {
		if (!value) return '';
		const isCustom = value.endsWith('c');
		const clean = isCustom ? value.slice(0, -1) : value;
		const match = clean.match(/^(\d+)(m|h|d)$/);
		if (!match) return value;
		const num = parseInt(match[1]);
		const unit = match[2];
		const labels = { m: 'minute', h: 'hour', d: 'day' };
		const label = labels[unit] || unit;
		return `${num} ${label}${num !== 1 ? 's' : ''}`;
	}
</script>

<div class="flow-builder" class:compact ontouchmove={handleTouchMove} ontouchend={handleTouchEnd}>
	{#if actions.length === 0}
		<div class="flow-empty">
			<div class="flow-empty-icon">⚡</div>
			<p>No actions configured</p>
			<button type="button" class="flow-add-first" onclick={addAction}>
				+ Add Action
			</button>
		</div>
	{:else}
		<div class="flow-list">
			{#each actions as action, index}
				{@const info = getActionInfo(action.type)}
				{@const schema = getActionConfigSchema(action.type)}
				{@const isCollapsed = collapsedActions.has(index)}
				
				<!-- Connector line -->
				{#if index > 0}
					<div class="flow-connector" class:drag-over={dragOverIndex === index}>
						<div class="connector-line"></div>
						<div class="connector-dot"></div>
					</div>
				{/if}
				
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div 
					class="flow-action-item"
					class:dragging={dragIndex === index || (touchDrag?.index === index && touchDrag?.moved)}
					class:drag-target={dragOverIndex === index}
					draggable="true"
					ondragstart={(e) => handleDragStart(index, e)}
					ondragover={(e) => handleDragOver(index, e)}
					ondragleave={handleDragLeave}
					ondrop={(e) => handleDrop(index, e)}
					ondragend={handleDragEnd}
					ontouchstart={(e) => handleTouchStart(index, e)}
				>
					<!-- Action Header -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="flow-action-header" onclick={() => action.type && toggleCollapse(index)}>
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span 
							class="flow-drag-handle" 
							title="Drag to reorder"
									onclick={(e) => e.stopPropagation()}
						>⠿</span>
						
						<span class="flow-action-number">{index + 1}</span>
						
						{#if action.type}
							<span class="flow-action-icon">{info.icon}</span>
							<span class="flow-action-name">{info.name}</span>
						{:else}
							<span class="flow-action-name flow-action-placeholder">Select action...</span>
						{/if}
						
						<div class="flow-action-controls">
							{#if action.type}
								<button 
									type="button" 
									class="flow-btn-collapse"
									title={isCollapsed ? 'Expand' : 'Collapse'}
										onclick={(e) => { e.stopPropagation(); toggleCollapse(index); }}
								>
									{isCollapsed ? '▸' : '▾'}
								</button>
							{/if}
							<button 
								type="button" 
								class="flow-btn-remove"
								title="Remove action"
									onclick={(e) => { e.stopPropagation(); removeAction(index); }}
							>×</button>
						</div>
					</div>
					
					<!-- Action Body -->
					{#if !isCollapsed}
						<div class="flow-action-body">
							<!-- Action Type Selector -->
							<!-- svelte-ignore a11y_label_has_associated_control -->
							<div class="flow-field">
								<label>Action Type</label>
								<select
									value={action.type}
									onchange={(e) => updateActionType(index, e.target.value)}
									class="flow-select"
								>
									<option value="">Select an action...</option>
									{#each Object.entries(actionTypes) as [type, typeInfo]}
										<option value={type}>{typeInfo.icon} {typeInfo.name}</option>
									{/each}
								</select>
							</div>
							
							<!-- Action Configuration -->
							{#if action.type && Object.keys(schema).length > 0}
								<div class="flow-config">
									{#each Object.entries(schema) as [configKey, config]}
										{#if !config.showWhen || action.config[config.showWhen] === 'true' || action.config[config.showWhen] === true}
											<!-- Skip button_rows type - handled by parent -->
											{#if config.type === 'button_rows'}
												<!-- Button rows are handled by ButtonEditor in the parent -->
											{:else}											<!-- svelte-ignore a11y_label_has_associated_control -->												<div class="flow-field">
													<label>
														{config.label}
														{#if config.required}<span class="required">*</span>{/if}
													</label>
													
													{#if config.type === 'text'}
														{#if config.supportsVariables}
															<DiscordMessageEditor
																bind:value={action.config[configKey]}
																{channels}
																{roles}
																{templateVariables}
																placeholder="Enter your message..."
																rows={compact ? 2 : 4}
															/>
														{:else}
															<textarea 
																required={config.required}
																rows={compact ? 2 : 3}
																bind:value={action.config[configKey]}
																class="flow-textarea"
															></textarea>
														{/if}
													{:else if config.type === 'number'}
														<input 
															type="number" 
															min="0"
															max={config.max || 999999}
															required={config.required}
															placeholder={config.placeholder || ''}
															bind:value={action.config[configKey]}
															class="flow-input"
														/>
													{:else if config.type === 'number_source'}
														{@const currentVal = action.config[configKey]}
														<div class="number-source">
															{#if numberOptions.length > 0}
																<select
																	class="flow-select flow-select-sm"
																	value={isOptionReference(currentVal) ? currentVal : ''}
																	onchange={(e) => {
																		if (e.target.value) {
																			action.config[configKey] = e.target.value;
																		} else {
																			action.config[configKey] = '';
																		}
																	}}
																>
																	<option value="">Static value</option>
																	{#each numberOptions as opt}
																		<option value={opt.value}>{opt.label}</option>
																	{/each}
																</select>
															{/if}
															{#if !isOptionReference(currentVal)}
																<input 
																	type="number" 
																	min="0"
																	max={config.max || 999999}
																	required={config.required}
																	placeholder={config.placeholder || ''}
																	bind:value={action.config[configKey]}
																	class="flow-input"
																/>
															{/if}
														</div>
													{:else if config.type === 'boolean'}
														<label class="flow-checkbox">
															<input 
																type="checkbox"
																bind:checked={action.config[configKey]}
															/>
															<span>Enable</span>
														</label>
													{:else if config.type === 'channel'}
														<ChannelSelector
															{channels}
															bind:value={action.config[configKey]}
															placeholder={config.description || 'Select channel'}
														/>
													{:else if config.type === 'channel_multi'}
														<ChannelSelector
															{channels}
															bind:value={action.config[configKey]}
															multiple={true}
															showAllOption={config.showAllOption}
															allOptionLabel={config.allOptionLabel}
															placeholder={config.description || 'Select channels'}
														/>
													{:else if config.type === 'roles'}
														<RoleSelector
															{roles}
															bind:value={action.config[configKey]}
															multiple={config.multiple}
															placeholder={config.description || 'Select role(s)'}
														/>
													{:else if config.type === 'user_source'}
														<select
															class="flow-select"
															bind:value={action.config[configKey]}
															required={config.required}
														>
															<option value="">Select target user...</option>
															{#each userSources as source}
																<option value={source.value}>{source.label}</option>
															{/each}
														</select>
														{#if config.description}
															<span class="flow-hint">{config.description}</span>
														{/if}
													{:else if config.type === 'color'}
														<div class="flow-color-row">
															<input
																type="color"
																value={action.config[configKey] || config.default || '#5865F2'}
																oninput={(e) => { action.config[configKey] = e.target.value; }}
																class="flow-color-input"
															/>
															<span class="flow-color-value">{action.config[configKey] || config.default || '#5865F2'}</span>
														</div>
													{:else if config.type === 'color_rules'}
														<div class="flow-color-rules">
															{#each getColorRules(action, configKey) as rule, ruleIndex}
																<div class="color-rule-row">
																	<input
																		type="color"
																		class="color-rule-picker"
																		value={rule.color || '#5865F2'}
																		oninput={(e) => updateColorRule(action, configKey, ruleIndex, 'color', e.target.value)}
																	/>
																	<span class="color-rule-word">If</span>
																	<select
																		class="color-rule-field"
																		value={rule.variable || ''}
																		onchange={(e) => updateColorRule(action, configKey, ruleIndex, 'variable', e.target.value)}
																	>
																		<option value="" disabled>pick field...</option>
																		<optgroup label="Trigger">
																			<option value="trigger.event">event type</option>
																			<option value="trigger.category">category</option>
																		</optgroup>
																		<optgroup label="Actor">
																			<option value="user.name">actor name</option>
																			<option value="user.id">actor id</option>
																		</optgroup>
																		<optgroup label="Details">
																			<option value="details.action">action</option>
																			<option value="details.conclusion">conclusion</option>
																		</optgroup>
																	</select>
																	<select
																		class="color-rule-op"
																		value={rule.operator || 'equals'}
																		onchange={(e) => updateColorRule(action, configKey, ruleIndex, 'operator', e.target.value)}
																	>
																		<option value="equals">is</option>
																		<option value="not_equals">isn't</option>
																		<option value="contains">contains</option>
																		<option value="starts_with">starts with</option>
																		<option value="ends_with">ends with</option>
																	</select>
																	<input
																		type="text"
																		class="color-rule-value"
																		placeholder="value..."
																		value={rule.value || ''}
																		oninput={(e) => updateColorRule(action, configKey, ruleIndex, 'value', e.target.value)}
																	/>
																	<button type="button" class="btn-remove-rule" onclick={() => removeColorRule(action, configKey, ruleIndex)}>✕</button>
																</div>
															{/each}
															<button type="button" class="flow-btn-add-rule" onclick={() => addColorRule(action, configKey)}>+ Add color rule</button>
														</div>
													{:else if config.type === 'select'}
														<select
															class="flow-select"
															bind:value={action.config[configKey]}
														>
															{#each config.options as option}
																{@const optVal = typeof option === 'object' ? option.value : option}
																{@const optLabel = typeof option === 'object' ? option.label : option}
																<option value={optVal} selected={optVal === config.default}>{optLabel}</option>
															{/each}
														</select>
													{:else if config.type === 'emoji'}
														<input 
															type="text"
															bind:value={action.config[configKey]}
															placeholder="👍 or custom emoji"
															class="flow-input"
															maxlength="32"
														/>
													{:else if config.type === 'json'}
														<textarea 
															rows={compact ? 3 : 5}
															bind:value={action.config[configKey]}
															placeholder={'{"key": "value"}'}
															class="flow-textarea flow-mono"
														></textarea>
													{:else if config.type === 'webhook'}
														<input 
															type="text"
															bind:value={action.config[configKey]}
															placeholder="Webhook ID"
															class="flow-input"
														/>
													{:else if config.type === 'delay'}
														<div class="flow-delay-picker">
															<div class="delay-presets">
																{#each [
																	{ value: '5m', label: '5 min' },
																	{ value: '15m', label: '15 min' },
																	{ value: '30m', label: '30 min' },
																	{ value: '1h', label: '1 hour' },
																	{ value: '2h', label: '2 hours' },
																	{ value: '6h', label: '6 hours' },
																	{ value: '12h', label: '12 hours' },
																	{ value: '1d', label: '1 day' },
																	{ value: '3d', label: '3 days' },
																	{ value: '7d', label: '7 days' },
																] as preset}
																	<button
																		type="button"
																		class="delay-preset-btn"
																		class:active={action.config[configKey] === preset.value}
																		onclick={() => { action.config[configKey] = preset.value; }}
																	>{preset.label}</button>
																{/each}
															</div>
															<div class="delay-custom">
																<span class="delay-or">or</span>
																<input
																	type="number"
																	min="1"
																	max="10080"
																	placeholder="Custom"
																	class="flow-input delay-custom-input"
																	value={action.config[configKey]?.endsWith?.('c') ? action.config[configKey].slice(0, -1) : ''}
																	oninput={(e) => {
																		const v = e.target.value;
																		if (v) {
																			const unit = action.config[configKey + '_unit'] || 'm';
																			action.config[configKey] = v + unit + 'c';
																		} else {
																			action.config[configKey] = '';
																		}
																	}}
																/>
																<select
																	class="flow-select delay-unit-select"
																	value={action.config[configKey + '_unit'] || 'm'}
																	onchange={(e) => {
																		action.config[configKey + '_unit'] = e.target.value;
																		const numPart = action.config[configKey]?.replace?.(/[^0-9]/g, '');
																		if (numPart) {
																			action.config[configKey] = numPart + e.target.value + 'c';
																		}
																	}}
																>
																	<option value="m">minutes</option>
																	<option value="h">hours</option>
																	<option value="d">days</option>
																</select>
															</div>
															{#if action.config[configKey]}
																<span class="delay-preview">⏱ Message will be sent {formatDelay(action.config[configKey])} after trigger</span>
															{/if}
														</div>
													{:else}
														<input 
															type="text"
															bind:value={action.config[configKey]}
															placeholder={config.description || ''}
															class="flow-input"
														/>
													{/if}
												</div>
											{/if}
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
		
		<!-- Add Action Button -->
		<button type="button" class="flow-add-action" onclick={addAction}>
			<span class="flow-add-icon">+</span>
			<span>Add Action</span>
		</button>
	{/if}
</div>

<style>
	.flow-builder {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	
	/* Empty State */
	.flow-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1.5rem;
		border: 2px dashed var(--color-border);
		border-radius: 0.75rem;
		text-align: center;
	}
	
	.flow-empty-icon {
		font-size: 1.5rem;
	}
	
	.flow-empty p {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}
	
	.flow-add-first {
		padding: 0.4rem 1rem;
		border: 1px solid var(--color-primary);
		border-radius: 0.35rem;
		background: var(--color-primary-soft);
		color: var(--color-primary);
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}
	
	.flow-add-first:hover {
		background: var(--color-primary);
		color: white;
	}
	
	/* Flow List */
	.flow-list {
		display: flex;
		flex-direction: column;
	}
	
	/* Connector */
	.flow-connector {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding-left: 1.35rem;
		height: 1.25rem;
		position: relative;
	}
	
	.connector-line {
		width: 2px;
		flex: 1;
		background: var(--color-border);
		transition: background 0.2s;
	}
	
	.connector-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-border-strong);
		margin-left: -2px;
	}
	
	.flow-connector.drag-over .connector-line {
		background: var(--color-primary);
	}
	
	.flow-connector.drag-over .connector-dot {
		background: var(--color-primary);
		box-shadow: 0 0 6px var(--color-primary);
	}
	
	/* Action Item */
	.flow-action-item {
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-surface);
		transition: all 0.2s;
		overflow: hidden;
	}
	
	.flow-action-item:hover {
		border-color: var(--color-border-strong);
	}
	
	.flow-action-item.dragging {
		opacity: 0.5;
		border-color: var(--color-primary);
	}
	
	.flow-action-item.drag-target {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px var(--color-primary-soft);
	}
	
	/* Action Header */
	.flow-action-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		cursor: pointer;
		user-select: none;
		transition: background 0.15s;
	}
	
	.flow-action-header:hover {
		background: var(--color-surface-hover);
	}
	
	.flow-drag-handle {
		cursor: grab;
		color: var(--color-text-light);
		font-size: 0.9rem;
		padding: 0.15rem;
		user-select: none;
		touch-action: none;
		flex-shrink: 0;
	}
	
	.flow-drag-handle:active {
		cursor: grabbing;
	}
	
	.flow-action-number {
		width: 1.3rem;
		height: 1.3rem;
		border-radius: 50%;
		background: var(--color-primary-soft);
		color: var(--color-primary);
		font-size: 0.7rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	
	.flow-action-icon {
		font-size: 0.9rem;
		flex-shrink: 0;
	}
	
	.flow-action-name {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	
	.flow-action-placeholder {
		color: var(--color-text-muted);
		font-style: italic;
		font-weight: 400;
	}
	
	.flow-action-controls {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}
	
	.flow-btn-collapse, .flow-btn-remove {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.8rem;
		padding: 0.2rem 0.35rem;
		border-radius: 0.2rem;
		color: var(--color-text-muted);
		transition: all 0.15s;
	}
	
	.flow-btn-collapse:hover {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}
	
	.flow-btn-remove:hover {
		color: var(--color-danger);
		background: var(--color-danger-soft);
	}
	
	/* Action Body */
	.flow-action-body {
		padding: 0.75rem;
		border-top: 1px solid var(--color-border-light);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	
	.compact .flow-action-body {
		padding: 0.5rem;
		gap: 0.5rem;
	}
	
	/* Fields */
	.flow-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	
	.flow-field label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}
	
	.flow-field .required {
		color: var(--color-danger);
	}
	
	.flow-config {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	
	.compact .flow-config {
		gap: 0.5rem;
	}
	
	/* Inputs */
	.flow-select, .flow-input, .flow-textarea {
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: 0.35rem;
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.85rem;
		font-family: inherit;
		width: 100%;
		box-sizing: border-box;
	}
	
	.flow-select:focus, .flow-input:focus, .flow-textarea:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px var(--color-primary-soft);
	}
	
	.flow-select-sm {
		padding: 0.3rem 0.5rem;
		font-size: 0.8rem;
	}
	
	.flow-textarea {
		resize: vertical;
		min-height: 2.5rem;
	}
	
	.flow-mono {
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.8rem;
	}
	
	.flow-checkbox {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		cursor: pointer;
	}
	
	.flow-hint {
		font-size: 0.65rem;
		color: var(--color-text-muted);
	}
	
	/* Number Source */
	.number-source {
		display: flex;
		gap: 0.35rem;
		align-items: center;
	}
	
	.number-source .flow-input {
		flex: 1;
	}
	
	/* Color Input */
	.flow-color-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	
	.flow-color-input {
		width: 2.5rem;
		height: 2rem;
		padding: 0.15rem;
		border: 1px solid var(--color-border);
		border-radius: 0.25rem;
		cursor: pointer;
		background: none;
	}
	
	.flow-color-value {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-family: monospace;
	}
	
	/* Color Rules */
	.flow-color-rules {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	
	.color-rule-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: wrap;
	}
	
	.color-rule-picker {
		width: 1.8rem;
		height: 1.6rem;
		padding: 0.1rem;
		border: 1px solid var(--color-border);
		border-radius: 0.2rem;
		background: none;
		cursor: pointer;
	}
	
	.color-rule-word {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}
	
	.color-rule-field, .color-rule-op {
		padding: 0.2rem 0.3rem;
		font-size: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.2rem;
		background: var(--color-surface);
		color: var(--color-text);
	}
	
	.color-rule-value {
		padding: 0.2rem 0.4rem;
		font-size: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.2rem;
		background: var(--color-surface);
		color: var(--color-text);
		flex: 1;
		min-width: 4rem;
	}
	
	.btn-remove-rule {
		background: none;
		border: none;
		color: var(--color-danger);
		cursor: pointer;
		font-size: 0.8rem;
		padding: 0.2rem;
	}
	
	.flow-btn-add-rule {
		background: none;
		border: 1px dashed var(--color-border);
		border-radius: 0.25rem;
		padding: 0.3rem 0.6rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		cursor: pointer;
		align-self: flex-start;
		transition: all 0.15s;
	}
	
	.flow-btn-add-rule:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
	
	/* Add Action Button */
	.flow-add-action {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.5rem;
		margin-top: 0.5rem;
		border: 2px dashed var(--color-border);
		border-radius: 0.5rem;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	
	.flow-add-action:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
		background: var(--color-primary-soft);
	}
	
	.flow-add-icon {
		font-size: 1rem;
		font-weight: 600;
	}
	
	/* Responsive */
	@media (max-width: 600px) {
		.flow-action-header {
			padding: 0.4rem 0.5rem;
			gap: 0.35rem;
		}
		
		.flow-action-body {
			padding: 0.5rem;
		}
		
		.flow-action-name {
			font-size: 0.8rem;
		}
		
		.color-rule-row {
			flex-direction: column;
			align-items: stretch;
		}
		
		.color-rule-field, .color-rule-op, .color-rule-value {
			width: 100%;
		}

		.delay-presets {
			gap: 0.25rem !important;
		}

		.delay-preset-btn {
			padding: 0.25rem 0.5rem !important;
			font-size: 0.7rem !important;
		}
	}

	/* Delay Picker */
	.flow-delay-picker {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.delay-presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.delay-preset-btn {
		padding: 0.3rem 0.65rem;
		border: 1px solid var(--color-border);
		border-radius: 0.35rem;
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.78rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.delay-preset-btn:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.delay-preset-btn.active {
		border-color: var(--color-primary);
		background: var(--color-primary-soft);
		color: var(--color-primary);
		font-weight: 600;
	}

	.delay-custom {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.delay-or {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.delay-custom-input {
		width: 5rem;
	}

	.delay-unit-select {
		width: auto;
		min-width: 5.5rem;
	}

	.delay-preview {
		font-size: 0.75rem;
		color: var(--color-primary);
		font-weight: 500;
	}
</style>
