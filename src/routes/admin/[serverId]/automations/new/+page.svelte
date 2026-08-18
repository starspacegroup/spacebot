<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import ChannelSelector from '$lib/components/ChannelSelector.svelte';
	import RoleSelector from '$lib/components/RoleSelector.svelte';
	import RepositorySelector from '$lib/components/RepositorySelector.svelte';
	import UserSelector from '$lib/components/UserSelector.svelte';
	import BotCommandSelector from '$lib/components/BotCommandSelector.svelte';
	import EmojiSelector from '$lib/components/EmojiSelector.svelte';
	import DiscordMessageEditor from '$lib/components/DiscordMessageEditor.svelte';
	import ButtonEditor from '$lib/components/ButtonEditor.svelte';
	import {
		fetchChannelsWithCache,
		fetchRolesWithCache,
		fetchEmojisWithCache,
	} from '$lib/discord/cache.js';
	import { log } from '$lib/log.js';

	interface EventTypeInfo {
		category?: string;
		description?: string;
		[key: string]: any;
	}

	interface EventTypeEntry extends EventTypeInfo {
		type: string;
	}

	interface CategoryInfo {
		name: string;
		icon: string;
		color: string;
		[key: string]: any;
	}

	interface ActionTypeInfo {
		icon?: string;
		name?: string;
		description?: string;
		configSchema?: Record<string, ConfigFieldSchema>;
		[key: string]: any;
	}

	interface ConfigOption {
		value: any;
		label?: string;
		[key: string]: any;
	}

	interface ConfigFieldSchema {
		type?: string;
		label?: string;
		description?: string;
		required?: boolean;
		supportsVariables?: boolean;
		showWhen?: string;
		showAllOption?: boolean;
		allOptionLabel?: string;
		placeholder?: string;
		max?: number;
		default?: any;
		options?: any[];
		[key: string]: any;
	}

	interface FilterTypeInfo {
		label?: string;
		type?: string;
		description?: string;
		voiceOnly?: boolean;
		default?: any;
		applicableEvents?: string[];
		options?: any[];
		[key: string]: any;
	}

	interface ColorRule {
		variable?: string;
		operator?: string;
		value?: string;
		color?: string;
		[key: string]: any;
	}

	interface AutomationAction {
		type: string;
		config: Record<string, any>;
	}

	interface PageDataShape {
		selectedGuildId: string;
		eventTypes: Record<string, EventTypeInfo>;
		eventCategories: Record<string, CategoryInfo>;
		actionTypes: Record<string, ActionTypeInfo>;
		filterTypes: Record<string, FilterTypeInfo>;
		templateVariables?: any;
		githubRepositories?: string[];
		webhooks?: Array<{ id: string; name: string; method: string; [key: string]: any }>;
		[key: string]: any;
	}

	interface FormShape {
		error?: any;
		values?: {
			name?: string;
			description?: string;
			[key: string]: any;
		};
		[key: string]: any;
	}

	let { data, form }: { data: PageDataShape; form?: FormShape } = $props();

	let selectedEventTypes = $state<string[]>([]);
	let actions = $state<AutomationAction[]>([]);
	let showFilters = $state(false);
	let showTriggerPicker = $state(false);

	// Event type search
	let eventSearchQuery = $state('');

	// Bot command filter state
	let botFilterValue = $state('');
	let commandFilterValue = $state('');
	let resultFilterValue = $state('any');

	// Shared channel data - fetched once for all ChannelSelectors (with caching)
	let sharedChannels = $state(null);
	let channelsLoading = $state(false);

	// Shared role data - fetched once for all RoleSelectors (with caching)
	let sharedRoles = $state(null);
	let rolesLoading = $state(false);

	// Shared emoji data - fetched once for all EmojiSelectors (with caching)
	let sharedEmojis = $state(null);
	let emojisLoading = $state(false);

	// Fetch channels once when guild changes
	$effect(() => {
		const guildId = data.selectedGuildId;
		log.debug(
			'[ChannelLoad] Effect check - guildId:',
			guildId,
			'sharedChannels:',
			sharedChannels,
			'channelsLoading:',
			channelsLoading
		);
		if (guildId && sharedChannels === null && !channelsLoading) {
			log.debug('[ChannelLoad] Loading channels for guild:', guildId);
			loadChannels();
		}
	});

	// Fetch roles once when guild changes
	$effect(() => {
		const guildId = data.selectedGuildId;
		log.debug(
			'[RoleLoad] Effect check - guildId:',
			guildId,
			'sharedRoles:',
			sharedRoles,
			'rolesLoading:',
			rolesLoading
		);
		if (guildId && sharedRoles === null && !rolesLoading) {
			log.debug('[RoleLoad] Loading roles for guild:', guildId);
			loadRoles();
		}
	});

	// Fetch emojis once when guild changes
	$effect(() => {
		const guildId = data.selectedGuildId;
		if (guildId && sharedEmojis === null && !emojisLoading) {
			loadEmojis();
		}
	});

	async function loadChannels() {
		channelsLoading = true;
		log.debug('[ChannelLoad] Starting fetch for guild:', data.selectedGuildId);
		try {
			sharedChannels = await fetchChannelsWithCache(data.selectedGuildId);
			log.debug('[ChannelLoad] Loaded channels:', sharedChannels?.length, sharedChannels);
		} catch (err) {
			log.error('Error loading channels:', err);
			sharedChannels = [];
		} finally {
			channelsLoading = false;
		}
	}

	async function loadRoles() {
		rolesLoading = true;
		log.debug('[RoleLoad] Starting fetch for guild:', data.selectedGuildId);
		try {
			sharedRoles = await fetchRolesWithCache(data.selectedGuildId);
			log.debug('[RoleLoad] Loaded roles:', sharedRoles?.length, sharedRoles);
		} catch (err) {
			log.error('Error loading roles:', err);
			sharedRoles = [];
		} finally {
			rolesLoading = false;
		}
	}

	async function loadEmojis() {
		emojisLoading = true;
		try {
			sharedEmojis = await fetchEmojisWithCache(data.selectedGuildId);
		} catch (err) {
			log.error('Error loading emojis:', err);
			sharedEmojis = [];
		} finally {
			emojisLoading = false;
		}
	}

	// Get parent data for guild info
	const selectedGuildId = $derived(data.selectedGuildId);

	// Get category info
	function getCategoryInfo(category: string): CategoryInfo {
		return data.eventCategories[category] || { name: category, icon: '📌', color: '#888' };
	}

	// Group events by category for dropdown (with optional search filter)
	function getEventsByCategory(searchQuery = ''): Record<string, EventTypeEntry[]> {
		const grouped: Record<string, EventTypeEntry[]> = {};
		const query = searchQuery.toLowerCase().trim();

		for (const [eventType, info] of Object.entries(data.eventTypes)) {
			// Apply search filter
			if (query) {
				const matchesType = eventType.toLowerCase().includes(query);
				const matchesDesc = info.description?.toLowerCase().includes(query);
				const matchesCategory = info.category?.toLowerCase().includes(query);
				if (!matchesType && !matchesDesc && !matchesCategory) continue;
			}

			const category = info.category;
			if (!grouped[category]) {
				grouped[category] = [];
			}
			grouped[category].push({ type: eventType, ...info });
		}
		return grouped;
	}

	// Filtered events based on search
	const filteredEventsByCategory = $derived(getEventsByCategory(eventSearchQuery));
	const hasFilteredResults = $derived(Object.keys(filteredEventsByCategory).length > 0);

	// Get action config schema
	function getActionConfigSchema(actionType: string): Record<string, ConfigFieldSchema> {
		return data.actionTypes[actionType]?.configSchema || {};
	}

	// Color rules helpers for embed conditional colors
	function getColorRules(action: AutomationAction, configKey: string): ColorRule[] {
		try {
			const v = action.config[configKey];
			if (Array.isArray(v)) return v;
			if (typeof v === 'string' && v) return JSON.parse(v);
		} catch {}
		return [];
	}

	function updateColorRule(
		action: AutomationAction,
		configKey: string,
		ruleIndex: number,
		field: string,
		value: any
	) {
		const rules = getColorRules(action, configKey);
		rules[ruleIndex] = { ...rules[ruleIndex], [field]: value };
		action.config[configKey] = [...rules];
	}

	function removeColorRule(action: AutomationAction, configKey: string, ruleIndex: number) {
		const rules = getColorRules(action, configKey);
		rules.splice(ruleIndex, 1);
		action.config[configKey] = [...rules];
	}

	function addColorRule(action: AutomationAction, configKey: string) {
		const rules = getColorRules(action, configKey);
		action.config[configKey] = [
			...rules,
			{ variable: '', operator: 'equals', value: '', color: '#57F287' },
		];
	}

	function getFilterOptionValues(filterKey: string): ConfigOption[] {
		const options = data.filterTypes?.[filterKey]?.options || [];
		return options
			.map((opt) => {
				if (typeof opt === 'object' && opt !== null) {
					return { value: opt.value, label: opt.label || String(opt.value) };
				}
				return { value: opt, label: String(opt) };
			})
			.filter((opt) => opt.value !== 'any' && opt.value !== 'ALL');
	}

	function getColorRuleValueOptions(variable: string | undefined): ConfigOption[] {
		switch (variable) {
			case 'trigger.event':
				return Object.keys(data.eventTypes || {})
					.sort()
					.map((eventType) => ({
						value: eventType,
						label: eventType.replace(/_/g, ' '),
					}));
			case 'trigger.category':
				return Object.entries(data.eventCategories || {}).map(([key, info]) => ({
					value: key,
					label: info?.name || key,
				}));
			case 'github.action':
				return getFilterOptionValues('github_action');
			case 'github.conclusion':
				return getFilterOptionValues('github_workflow_conclusion');
			case 'github.status':
				return [
					{ value: 'queued', label: 'queued' },
					{ value: 'in_progress', label: 'in progress' },
					{ value: 'completed', label: 'completed' },
					{ value: 'requested', label: 'requested' },
					{ value: 'waiting', label: 'waiting' },
					{ value: 'pending', label: 'pending' },
				];
			case 'github.repo':
				return (data.githubRepositories || []).map((repo) => ({
					value: repo,
					label: repo,
				}));
			default:
				return [];
		}
	}

	function getColorRuleValueOptionsWithCurrent(
		variable: string | undefined,
		currentValue: any
	): ConfigOption[] {
		const options = getColorRuleValueOptions(variable);
		if (!currentValue || options.some((opt) => opt.value === currentValue)) {
			return options;
		}
		return [{ value: currentValue, label: `${currentValue} (custom)` }, ...options];
	}

	function shouldUseColorRuleValueSelect(rule: ColorRule) {
		const operator = rule?.operator || 'equals';
		if (operator !== 'equals' && operator !== 'not_equals') return false;
		return getColorRuleValueOptions(rule?.variable).length > 0;
	}

	// Stacked actions management
	function addAction() {
		actions = [...actions, { type: '', config: {} }];
	}

	function removeAction(index: number) {
		actions = actions.filter((_, i) => i !== index);
	}

	function moveActionUp(index: number) {
		if (index <= 0) return;
		const newActions = [...actions];
		[newActions[index - 1], newActions[index]] = [newActions[index], newActions[index - 1]];
		actions = newActions;
	}

	function moveActionDown(index: number) {
		if (index >= actions.length - 1) return;
		const newActions = [...actions];
		[newActions[index], newActions[index + 1]] = [newActions[index + 1], newActions[index]];
		actions = newActions;
	}

	// Check if a filter applies to the selected event type
	function filterAppliesToEvent(filterInfo: FilterTypeInfo, eventType: string) {
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
	function filterAppliesToAnyEvent(filterInfo: FilterTypeInfo) {
		if (selectedEventTypes.length === 0) return false;
		return selectedEventTypes.some((eventType) => filterAppliesToEvent(filterInfo, eventType));
	}

	// Toggle event type selection
	function toggleEventType(eventType: string) {
		if (selectedEventTypes.includes(eventType)) {
			selectedEventTypes = selectedEventTypes.filter((e) => e !== eventType);
		} else {
			selectedEventTypes = [...selectedEventTypes, eventType];
		}
	}

	// Remove a trigger from the list
	function removeTrigger(eventType: string) {
		selectedEventTypes = selectedEventTypes.filter((e) => e !== eventType);
	}

	// Show the bot-command filter UI for BOTH slash-command triggers. The filters
	// themselves (target bot, command name, result, embed text) already declare
	// `applicableEvents: ['SLASH_COMMAND_USE', 'SLASH_COMMAND_RESPONSE']` and the
	// engine reads them the same way for either, but this gate only checked USE —
	// so an automation built on RESPONSE, which is the one the event picker
	// recommends for detecting success, rendered no filter UI at all and could
	// only be saved unfiltered.
	const hasSlashCommandTrigger = $derived(
		selectedEventTypes.some((t) => t === 'SLASH_COMMAND_USE' || t === 'SLASH_COMMAND_RESPONSE')
	);

	// Check if only voice events are selected (to filter channel selectors to voice channels)
	const onlyVoiceEvents = $derived(
		selectedEventTypes.length > 0 && selectedEventTypes.every((e) => e.startsWith('VOICE_'))
	);

	// Check if only VOICE_MOVE is selected (from/to replace generic channel filters)
	const onlyVoiceMoveEvent = $derived(
		selectedEventTypes.length > 0 && selectedEventTypes.every((e) => e === 'VOICE_MOVE')
	);

	// Get filters applicable to the current event type (excluding bot-specific ones handled separately)
	const applicableFilters = $derived.by((): Record<string, FilterTypeInfo> => {
		if (selectedEventTypes.length === 0) return {};
		const result: Record<string, FilterTypeInfo> = {};
		for (const [filterKey, filterInfo] of Object.entries(data.filterTypes)) {
			// Skip bot command filters - they're handled by BotCommandSelector
			if (['target_bot_id', 'command_name', 'command_result'].includes(filterKey)) continue;
			// When only VOICE_MOVE is selected, hide generic channel filters (from/to replace them)
			if (
				onlyVoiceMoveEvent &&
				(filterKey === 'channel_id' || filterKey === 'not_channel_id')
			)
				continue;
			if (filterAppliesToAnyEvent(filterInfo)) {
				result[filterKey] = filterInfo;
			}
		}
		return result;
	});

	// Check if there are any applicable filters
	const hasApplicableFilters = $derived(
		Object.keys(applicableFilters).length > 0 || hasSlashCommandTrigger
	);

	// User sources for automation actions
	const availableUserSources = $derived(() => {
		return [
			{
				value: 'actor',
				label: '👤 Event Actor',
				description: 'The user who triggered the event',
			},
			{
				value: 'target',
				label: '🎯 Event Target',
				description: 'The user who was the target of the event (if any)',
			},
			{
				value: 'specific_user',
				label: '🔍 Specific User',
				description: 'A specific user selected from the server members list',
			},
		];
	});
</script>

<svelte:head>
	<title>Create Automation | SpaceBot Admin</title>
</svelte:head>

<div class="automation-form-page">
	<header class="page-header">
		<a href="/admin/{selectedGuildId}/automations" class="back-link"> ← Back to Automations </a>
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

	<form
		method="POST"
		use:enhance={() => {
			return async ({ result }) => {
				if (result.type === 'redirect') {
					await goto(result.location, { invalidateAll: true });
				} else if (result.type === 'success' && result.data?.id) {
					// Navigate to the new automation's edit page
					await goto(`/admin/${selectedGuildId}/automations/${result.data.id}`, {
						invalidateAll: true,
					});
				} else if (result.type === 'failure') {
					form = result.data;
				}
			};
		}}
		class="automation-form"
	>
		<input type="hidden" name="guild_id" value={selectedGuildId} />

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
					rows="2">{form?.values?.description || ''}</textarea
				>
			</div>
		</section>

		<!-- Trigger Section -->
		<section class="form-section">
			<div class="section-header-row">
				<div>
					<h2>📥 Triggers (When)</h2>
					<p class="section-description">
						Choose what events will trigger this automation
					</p>
				</div>
				<button
					type="button"
					class="btn btn-secondary btn-sm"
					onclick={() => (showTriggerPicker = !showTriggerPicker)}
				>
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
					{#each selectedEventTypes as eventType}
						{@const eventInfo = data.eventTypes[eventType]}
						{@const catInfo = getCategoryInfo(eventInfo?.category)}
						<div class="trigger-item">
							<div class="trigger-info">
								<span class="trigger-icon" style="color: {catInfo.color}"
									>{catInfo.icon}</span
								>
								<span class="trigger-name">{eventType.replace(/_/g, ' ')}</span>
								<span class="trigger-description"
									>{eventInfo?.description || ''}</span
								>
							</div>
							<button
								type="button"
								class="btn-icon btn-danger"
								onclick={() => removeTrigger(eventType)}
								title="Remove trigger"
							>
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
						<button
							type="button"
							class="btn-icon"
							onclick={() => (showTriggerPicker = false)}
							title="Close">×</button
						>
					</div>
					<div class="trigger-search">
						<input
							type="text"
							placeholder="Search events... (e.g., bump, message, join)"
							bind:value={eventSearchQuery}
							class="search-input"
						/>
						{#if eventSearchQuery}
							<button
								type="button"
								class="clear-search"
								onclick={() => (eventSearchQuery = '')}
								title="Clear search">×</button
							>
						{/if}
					</div>
					<div class="trigger-categories">
						{#if hasFilteredResults}
							{#each Object.entries(filteredEventsByCategory) as [category, events]}
								{@const catInfo = getCategoryInfo(category)}
								<div class="trigger-category">
									<h5 class="category-header">
										<span style="color: {catInfo.color}">{catInfo.icon}</span>
										{catInfo.name}
									</h5>
									<div class="trigger-options">
										{#each events as event}
											<label
												class="trigger-option"
												class:selected={selectedEventTypes.includes(
													event.type
												)}
											>
												<input
													type="checkbox"
													checked={selectedEventTypes.includes(
														event.type
													)}
													onchange={() => toggleEventType(event.type)}
												/>
												<span class="trigger-option-name"
													>{event.type.replace(/_/g, ' ')}</span
												>
												<span class="trigger-option-desc"
													>{event.description}</span
												>
											</label>
										{/each}
									</div>
								</div>
							{/each}
						{:else}
							<div class="no-results">
								<p>No events found matching "{eventSearchQuery}"</p>
								<button
									type="button"
									class="btn btn-secondary btn-sm"
									onclick={() => (eventSearchQuery = '')}>Clear search</button
								>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			{#if selectedEventTypes.length > 0 && hasApplicableFilters}
				<div class="filters-toggle">
					<button
						type="button"
						class="btn btn-secondary btn-sm"
						onclick={() => (showFilters = !showFilters)}
					>
						{showFilters ? '➖ Hide Filters' : '➕ Add Filters'}
					</button>
					<span class="toggle-hint"
						>Filters narrow down when this automation triggers</span
					>
				</div>

				{#if showFilters}
					<!-- Bot Command Filter (shown for either slash-command trigger) -->
					{#if hasSlashCommandTrigger}
						<div class="bot-command-filter-section">
							<h4>🤖 Bot Command Filter</h4>
							<p class="section-hint">
								Filter by which bot and command was used, with success/failure
								detection
							</p>
							<BotCommandSelector
								bind:botValue={botFilterValue}
								bind:commandValue={commandFilterValue}
								bind:resultValue={resultFilterValue}
								botName="filter.target_bot_id"
								commandName="filter.command_name"
								resultName="filter.command_result"
							/>
						</div>
					{/if}

					<div class="filters-grid">
						{#each Object.entries(applicableFilters) as [filterKey, filterInfo]}
							<div class="form-group">
								<label for="filter_{filterKey}">{filterInfo.label}</label>
								{#if filterInfo.type === 'channel'}
									{#if onlyVoiceEvents || filterInfo.voiceOnly}
										<ChannelSelector
											guildId={data.selectedGuildId}
											typeFilter="voice,stage"
											name="filter.{filterKey}"
											placeholder={filterInfo.description}
											multiple={true}
											showAllOption={[
												'channel_id',
												'voice_from_channel_id',
												'voice_to_channel_id',
											].includes(filterKey)}
											value={[
												'channel_id',
												'voice_from_channel_id',
												'voice_to_channel_id',
											].includes(filterKey)
												? 'ALL'
												: ''}
										/>
									{:else}
										<ChannelSelector
											channels={sharedChannels}
											name="filter.{filterKey}"
											placeholder={filterInfo.description}
											multiple={true}
											showAllOption={[
												'channel_id',
												'voice_from_channel_id',
												'voice_to_channel_id',
											].includes(filterKey)}
											value={[
												'channel_id',
												'voice_from_channel_id',
												'voice_to_channel_id',
											].includes(filterKey)
												? 'ALL'
												: ''}
										/>
									{/if}
								{:else if filterInfo.type === 'role'}
									<RoleSelector
										roles={sharedRoles}
										name="filter.{filterKey}"
										placeholder={filterInfo.description}
										multiple={true}
										showAnyOption={filterKey === 'actor_has_role' ||
											filterKey === 'target_has_role'}
										value={filterKey === 'actor_has_role' ||
										filterKey === 'target_has_role'
											? 'ALL'
											: ''}
									/>
								{:else if filterInfo.type === 'user'}
									<UserSelector
										guildId={data.selectedGuildId}
										name="filter.{filterKey}"
										placeholder={filterInfo.description}
										multiple={true}
										showAnyOption={filterKey === 'actor_id'}
										value={filterKey === 'actor_id' ? 'ALL' : ''}
									/>
								{:else if filterInfo.type === 'select'}
									<select id="filter_{filterKey}" name="filter.{filterKey}">
										{#each filterInfo.options as option}
											<option
												value={option.value}
												selected={option.value === filterInfo.default}
												>{option.label}</option
											>
										{/each}
									</select>
								{:else if filterKey === 'github_repo'}
									<RepositorySelector
										repositories={data.githubRepositories || []}
										name="filter.{filterKey}"
										placeholder={filterInfo.description}
										multiple={true}
										showAnyOption={true}
										value="ALL"
									/>
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
					<p class="section-description">
						Configure actions to execute when the trigger fires (in order)
					</p>
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
									<button
										type="button"
										class="btn-icon"
										onclick={() => moveActionUp(index)}
										disabled={index === 0}
										title="Move up"
									>
										↑
									</button>
									<button
										type="button"
										class="btn-icon"
										onclick={() => moveActionDown(index)}
										disabled={index === actions.length - 1}
										title="Move down"
									>
										↓
									</button>
									<button
										type="button"
										class="btn-icon btn-danger"
										onclick={() => removeAction(index)}
										title="Remove action"
									>
										×
									</button>
								</div>
							</div>

							<div class="form-group">
								<label for="action_type_{index}"
									>Action Type <span class="required">*</span></label
								>
								<select
									id="action_type_{index}"
									name="action_type[]"
									required
									value={action.type}
									onchange={(e) => {
										const newType = (e.target as HTMLSelectElement).value;
										const schema = getActionConfigSchema(newType);
										const newConfig = { ...action.config };
										for (const configKey of Object.keys(schema)) {
											if (newConfig[configKey] === undefined) {
												newConfig[configKey] = '';
											}
										}
										// Update both type and config together to avoid undefined bindings
										actions = actions.map((a, i) =>
											i === index
												? { ...a, type: newType, config: newConfig }
												: a
										);
									}}
								>
									<option value="">Select an action...</option>
									{#each Object.entries(data.actionTypes) as [actionType, info]}
										<option value={actionType}
											>{info.icon} {info.name} - {info.description}</option
										>
									{/each}
								</select>
							</div>

							{#if action.type}
								{@const schema = getActionConfigSchema(action.type)}
								<div class="action-config">
									<h3>Configure Action</h3>
									{#each Object.entries(schema) as [configKey, config]}
										{#if !config.showWhen || action.config[config.showWhen] === 'true' || action.config[config.showWhen] === true}
											<div class="form-group">
												<label for="config_{index}_{configKey}">
													{config.label}
													{#if config.required}<span class="required"
															>*</span
														>{/if}
												</label>
												{#if config.type === 'text'}
													{#if config.supportsVariables}
														<DiscordMessageEditor
															name="action_config.{index}.{configKey}"
															required={config.required}
															bind:value={action.config[configKey]}
															channels={sharedChannels}
															roles={sharedRoles}
															templateVariables={data.templateVariables}
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
												{:else if config.type === 'color'}
													<div class="color-picker-row">
														<input
															type="color"
															id="config_{index}_{configKey}"
															name="action_config.{index}.{configKey}"
															value={action.config[configKey] ||
																config.default ||
																'#5865F2'}
															oninput={(e) => {
																action.config[configKey] = (
																	e.target as HTMLInputElement
																).value;
															}}
															class="color-input"
														/>
														<span class="color-value"
															>{action.config[configKey] ||
																config.default ||
																'#5865F2'}</span
														>
													</div>
												{:else if config.type === 'color_rules'}
													<input
														type="hidden"
														name="action_config.{index}.{configKey}"
														value={JSON.stringify(
															getColorRules(action, configKey)
														)}
													/>
													<div class="color-rules">
														{#each getColorRules(action, configKey) as rule, ruleIndex}
															<div class="color-rule-row">
																<input
																	type="color"
																	class="color-rule-picker"
																	value={rule.color || '#5865F2'}
																	oninput={(e) =>
																		updateColorRule(
																			action,
																			configKey,
																			ruleIndex,
																			'color',
																			(
																				e.target as HTMLInputElement
																			).value
																		)}
																/>
																<span class="color-rule-word"
																	>If</span
																>
																<select
																	class="color-rule-field"
																	value={rule.variable || ''}
																	onchange={(e) =>
																		updateColorRule(
																			action,
																			configKey,
																			ruleIndex,
																			'variable',
																			(
																				e.target as HTMLSelectElement
																			).value
																		)}
																>
																	<option value="" disabled
																		>pick a field...</option
																	>
																	<optgroup label="Trigger">
																		<option
																			value="trigger.event"
																			>event type</option
																		>
																		<option
																			value="trigger.category"
																			>event category</option
																		>
																	</optgroup>
																	<optgroup label="Actor">
																		<option value="user.name"
																			>actor name</option
																		>
																		<option value="user.id"
																			>actor id</option
																		>
																	</optgroup>
																	<optgroup label="Channel">
																		<option value="channel.name"
																			>channel name</option
																		>
																	</optgroup>
																	<optgroup label="GitHub">
																		<option
																			value="github.action"
																			>action</option
																		>
																		<option
																			value="github.conclusion"
																			>conclusion</option
																		>
																		<option value="github.repo"
																			>repo</option
																		>
																		<option
																			value="github.branch"
																			>branch</option
																		>
																		<option
																			value="github.status"
																			>status</option
																		>
																	</optgroup>
																</select>
																<select
																	class="color-rule-op"
																	value={rule.operator ||
																		'equals'}
																	onchange={(e) =>
																		updateColorRule(
																			action,
																			configKey,
																			ruleIndex,
																			'operator',
																			(
																				e.target as HTMLSelectElement
																			).value
																		)}
																>
																	<option value="equals"
																		>is</option
																	>
																	<option value="not_equals"
																		>is not</option
																	>
																	<option value="contains"
																		>contains</option
																	>
																	<option value="starts_with"
																		>starts with</option
																	>
																	<option value="ends_with"
																		>ends with</option
																	>
																</select>
																{#if shouldUseColorRuleValueSelect(rule)}
																	<select
																		class="color-rule-value"
																		value={rule.value || ''}
																		onchange={(e) =>
																			updateColorRule(
																				action,
																				configKey,
																				ruleIndex,
																				'value',
																				(
																					e.target as HTMLSelectElement
																				).value
																			)}
																	>
																		<option value=""
																			>pick a value...</option
																		>
																		{#each getColorRuleValueOptionsWithCurrent(rule.variable, rule.value) as option}
																			<option
																				value={option.value}
																				>{option.label}</option
																			>
																		{/each}
																	</select>
																{:else}
																	<input
																		type="text"
																		class="color-rule-value"
																		placeholder="value..."
																		value={rule.value || ''}
																		oninput={(e) =>
																			updateColorRule(
																				action,
																				configKey,
																				ruleIndex,
																				'value',
																				(
																					e.target as HTMLInputElement
																				).value
																			)}
																	/>
																{/if}
																<button
																	type="button"
																	class="btn-remove-rule"
																	title="Remove rule"
																	onclick={() =>
																		removeColorRule(
																			action,
																			configKey,
																			ruleIndex
																		)}>✕</button
																>
															</div>
														{/each}
														{#if getColorRules(action, configKey).length === 0}
															<p class="color-rules-hint">
																No rules yet. Add a rule to change
																the embed color based on event data.
															</p>
														{/if}
														<button
															type="button"
															class="btn btn-sm btn-add-rule"
															onclick={() =>
																addColorRule(action, configKey)}
														>
															+ Add color rule
														</button>
													</div>
												{:else if config.type === 'channel_multi'}
													<ChannelSelector
														channels={sharedChannels}
														name="action_config.{index}.{configKey}"
														required={config.required}
														placeholder="Select channel(s)..."
														multiple={true}
														showAllOption={config.showAllOption}
														{...{
															allOptionLabel:
																config.allOptionLabel ||
																'All Text Channels',
														}}
														bind:value={action.config[configKey]}
													/>
													{#if config.description}
														<p class="field-hint">
															{config.description}
														</p>
													{/if}
												{:else if config.type === 'channel'}
													<ChannelSelector
														channels={sharedChannels}
														name="action_config.{index}.{configKey}"
														required={config.required}
														placeholder="Select a channel..."
														bind:value={action.config[configKey]}
													/>
												{:else if config.type === 'roles'}
													<RoleSelector
														roles={sharedRoles}
														name="action_config.{index}.{configKey}"
														bind:value={action.config[configKey]}
														required={config.required}
														multiple={true}
														placeholder="Search and select role(s)..."
													/>
												{:else if config.type === 'role'}
													<RoleSelector
														roles={sharedRoles}
														name="action_config.{index}.{configKey}"
														bind:value={action.config[configKey]}
														required={config.required}
														placeholder="Select a role..."
													/>
												{:else if config.type === 'select'}
													<select
														id="config_{index}_{configKey}"
														name="action_config.{index}.{configKey}"
														required={config.required}
														bind:value={action.config[configKey]}
													>
														{#each config.options as opt}
															{@const optVal =
																typeof opt === 'object'
																	? opt.value
																	: opt}
															{@const optLabel =
																typeof opt === 'object'
																	? opt.label
																	: opt}
															<option value={optVal}
																>{optLabel}</option
															>
														{/each}
													</select>
												{:else if config.type === 'user_source'}
													<select
														id="config_{index}_{configKey}"
														required={config.required}
														bind:value={action.config[configKey]}
													>
														<option value="">Select a user...</option>
														{#each availableUserSources() as source}
															<option
																value={source.value}
																title={source.description}
															>
																{source.label}
															</option>
														{/each}
													</select>
													{#if action.config[configKey] === 'specific_user'}
														<div class="specific-user-picker">
															<UserSelector
																guildId={selectedGuildId}
																name="action_config.{index}.{configKey}_specific_id"
																multiple={false}
																showAnyOption={false}
																placeholder="Search for a server member..."
																bind:value={
																	action.config[
																		configKey + '_specific_id'
																	]
																}
															/>
														</div>
													{/if}
													<!-- Submit the resolved value: either the source type or specific:<userId> -->
													<input
														type="hidden"
														name="action_config.{index}.{configKey}"
														value={action.config[configKey] ===
														'specific_user'
															? 'specific:' +
																(action.config[
																	configKey + '_specific_id'
																] || '')
															: action.config[configKey] || ''}
													/>
													{#if config.description}
														<p class="field-hint">
															{config.description}
														</p>
													{/if}
												{:else if config.type === 'emoji'}
													<EmojiSelector
														emojis={sharedEmojis}
														name="action_config.{index}.{configKey}"
														required={config.required}
														placeholder="Select an emoji..."
														bind:value={action.config[configKey]}
													/>
													{#if config.description}
														<p class="field-hint">
															{config.description}
														</p>
													{/if}
												{:else if config.type === 'webhook'}
													<select
														id="config_{index}_{configKey}"
														name="action_config.{index}.{configKey}"
														required={config.required}
														bind:value={action.config[configKey]}
													>
														<option value="">Select a webhook...</option
														>
														{#each data.webhooks || [] as webhook}
															<option value={webhook.id}>
																{webhook.name} ({webhook.method})
															</option>
														{/each}
													</select>
													{#if config.description}
														<p class="field-hint">
															{config.description}
														</p>
													{/if}
													{#if !data.webhooks?.length}
														<p class="field-hint warning">
															No webhooks configured. <a
																href="/admin/{selectedGuildId}/settings"
																>Add webhooks in Settings</a
															>
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
														<p class="field-hint">
															{config.description}
														</p>
													{/if}
												{:else if config.type === 'button_rows'}
													<input
														type="hidden"
														name="action_config.{index}.{configKey}"
														value={JSON.stringify(
															action.config[configKey] || []
														)}
													/>
													<ButtonEditor
														bind:value={action.config[configKey]}
														actionTypes={data.actionTypes}
														templateVariables={data.templateVariables}
														channels={sharedChannels}
														roles={sharedRoles}
														emojis={sharedEmojis}
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
										{/if}
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
			<a href="/admin/{selectedGuildId}/automations" class="btn btn-secondary"> Cancel </a>
			<button type="submit" class="btn btn-primary">
				<span>✓</span>
				Create Automation
			</button>
		</div>
	</form>
</div>

<style>
	.automation-form-page {
		padding: 1rem;
		max-width: 800px;
		margin: 0 auto;
	}

	@media (min-width: 640px) {
		.automation-form-page {
			padding: 1.5rem;
		}
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
		margin-bottom: 1.5rem;
	}

	@media (min-width: 640px) {
		.page-header {
			margin-bottom: 2rem;
		}
	}

	.page-header h1 {
		font-size: 1.375rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}

	@media (min-width: 640px) {
		.page-header h1 {
			font-size: 1.75rem;
		}
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

	.automation-form {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.form-section {
		background: var(--bg-secondary, #2f3136);
		border-radius: 12px;
		padding: 1rem;
	}

	@media (min-width: 640px) {
		.form-section {
			padding: 1.5rem;
		}
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
		border-color: var(--accent-color, #5865f2);
	}

	.required {
		color: var(--color-danger);
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
		grid-template-columns: 1fr;
		gap: 1rem;
		margin-top: 1rem;
		padding: 1rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
	}

	@media (min-width: 640px) {
		.filters-grid {
			grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		}
	}

	.filters-grid .form-group {
		margin-bottom: 0;
	}

	/* Bot Command Filter Section */
	.bot-command-filter-section {
		margin-top: 1rem;
		padding: 1.25rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
	}

	.bot-command-filter-section h4 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
		color: var(--text-primary);
	}

	.bot-command-filter-section .section-hint {
		margin: 0 0 1rem;
		font-size: 0.85rem;
		color: var(--text-muted);
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
		align-items: flex-start;
		justify-content: space-between;
		padding: 0.625rem 0.75rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		gap: 0.5rem;
	}

	@media (min-width: 640px) {
		.trigger-item {
			align-items: center;
			padding: 0.75rem 1rem;
		}
	}

	.trigger-info {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		flex-wrap: wrap;
	}

	@media (min-width: 640px) {
		.trigger-info {
			align-items: center;
			gap: 0.75rem;
			flex-wrap: nowrap;
		}
	}

	.trigger-icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.trigger-name {
		font-weight: 500;
		word-break: break-word;
	}

	@media (min-width: 640px) {
		.trigger-name {
			white-space: nowrap;
			word-break: normal;
		}
	}

	.trigger-description {
		color: var(--text-muted);
		font-size: 0.8rem;
		display: none;
	}

	@media (min-width: 640px) {
		.trigger-description {
			display: block;
			font-size: 0.875rem;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
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

	.trigger-search {
		position: relative;
		margin-bottom: 1rem;
	}

	.trigger-search .search-input {
		width: 100%;
		padding: 0.625rem 2.5rem 0.625rem 1rem;
		background: var(--bg-secondary, #2f3136);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 6px;
		color: var(--text-primary, #fff);
		font-size: 0.9rem;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}

	.trigger-search .search-input:focus {
		outline: none;
		border-color: var(--accent-color, #5865f2);
		box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.2);
	}

	.trigger-search .search-input::placeholder {
		color: var(--text-tertiary, #72767d);
	}

	.clear-search {
		position: absolute;
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
		background: transparent;
		border: none;
		color: var(--text-muted, #72767d);
		font-size: 1.25rem;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		transition:
			color 0.2s,
			background 0.2s;
	}

	.clear-search:hover {
		color: var(--text-primary, #fff);
		background: var(--bg-primary, #202225);
	}

	.no-results {
		padding: 2rem;
		text-align: center;
		color: var(--text-muted, #72767d);
	}

	.no-results p {
		margin: 0 0 1rem;
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
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s;
		flex-wrap: wrap;
	}

	@media (min-width: 640px) {
		.trigger-option {
			align-items: center;
			gap: 0.75rem;
			padding: 0.5rem 0.75rem;
			flex-wrap: nowrap;
		}
	}

	.trigger-option:hover {
		background: var(--bg-primary, #202225);
	}

	.trigger-option.selected {
		background: rgba(88, 101, 242, 0.2);
		border: 1px solid var(--accent-color, #5865f2);
	}

	.trigger-option input[type='checkbox'] {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.trigger-option-name {
		font-weight: 500;
		font-size: 0.8rem;
		word-break: break-word;
	}

	@media (min-width: 640px) {
		.trigger-option-name {
			font-size: 0.875rem;
			white-space: nowrap;
			word-break: normal;
		}
	}

	.trigger-option-desc {
		color: var(--text-muted);
		font-size: 0.7rem;
		word-break: break-word;
	}

	@media (min-width: 640px) {
		.trigger-option-desc {
			font-size: 0.75rem;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			word-break: normal;
		}
	}

	.action-config {
		margin-top: 1rem;
		padding: 1rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
	}

	@media (min-width: 640px) {
		.action-config {
			margin-top: 1.25rem;
			padding: 1.25rem;
		}
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
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	@media (min-width: 480px) {
		.section-header-row {
			flex-direction: row;
			justify-content: space-between;
			align-items: flex-start;
			gap: 1rem;
		}
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
		background: var(--color-danger-soft);
		border-color: var(--color-danger);
		color: var(--color-danger);
	}

	.field-hint {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin: 0.375rem 0 0;
	}

	.field-hint.warning {
		color: var(--color-warning, #ffc107);
	}

	.field-hint a {
		color: var(--color-primary);
		text-decoration: underline;
	}

	.specific-user-picker {
		margin-top: 0.5rem;
	}

	.code-textarea {
		font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
		font-size: 0.85rem;
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
		flex-direction: column-reverse;
		gap: 0.75rem;
		padding-top: 1rem;
	}

	.form-actions .btn {
		width: 100%;
		justify-content: center;
	}

	@media (min-width: 480px) {
		.form-actions {
			flex-direction: row;
			justify-content: flex-end;
		}

		.form-actions .btn {
			width: auto;
		}
	}

	/* Mobile Responsive */
	@media (max-width: 640px) {
		.filters-toggle {
			flex-direction: column;
			align-items: flex-start;
		}
	}

	/* Color Picker */
	.color-picker-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.color-input {
		width: 40px;
		height: 34px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 2px;
		cursor: pointer;
		background: transparent;
	}

	.color-input::-webkit-color-swatch-wrapper {
		padding: 0;
	}

	.color-input::-webkit-color-swatch {
		border: none;
		border-radius: 3px;
	}

	.color-value {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		font-family: monospace;
	}

	.color-rules {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.color-rule-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		flex-wrap: wrap;
	}

	.color-rule-picker {
		width: 32px;
		height: 32px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 2px;
		cursor: pointer;
		background: transparent;
		flex-shrink: 0;
	}

	.color-rule-picker::-webkit-color-swatch-wrapper {
		padding: 0;
	}

	.color-rule-picker::-webkit-color-swatch {
		border: none;
		border-radius: 3px;
	}

	.color-rule-word {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.color-rule-field {
		padding: 0.3rem 0.5rem;
		font-size: 0.8rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-primary);
		color: var(--color-text-primary);
	}

	.color-rule-op {
		padding: 0.3rem 0.5rem;
		font-size: 0.8rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-primary);
		color: var(--color-text-primary);
	}

	.color-rule-value {
		padding: 0.3rem 0.5rem;
		font-size: 0.8rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-primary);
		color: var(--color-text-primary);
		flex: 1;
		min-width: 80px;
	}

	.btn-remove-rule {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 0.875rem;
		padding: 0.25rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.btn-remove-rule:hover {
		color: var(--color-danger);
	}

	.color-rules-hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0;
		font-style: italic;
	}

	.btn-add-rule {
		align-self: flex-start;
		font-size: 0.8rem;
		padding: 0.35rem 0.75rem;
	}
</style>
