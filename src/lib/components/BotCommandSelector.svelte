<script>
	import { log } from '$lib/log.js';
	import { BOT_REGISTRY, getAllBots, getBotCommands } from '$lib/discord/bots.js';
	
	/**
	 * Bot Command Selector Component
	 * A two-stage dropdown for selecting an external bot and optionally a specific command
	 * Used for filtering SLASH_COMMAND_USE events
	 */
	
	let { 
		botValue = $bindable(''),
		commandValue = $bindable(''),
		botName = 'target_bot_id',
		commandName = 'command_name',
		showCommandFilter = true,
		showResultFilter = true,
		resultValue = $bindable('any'),
		resultName = 'command_result'
	} = $props();
	
	// UI state
	let botSearchQuery = $state('');
	let commandSearchQuery = $state('');
	let isBotDropdownOpen = $state(false);
	let isCommandDropdownOpen = $state(false);
	let botHighlightedIndex = $state(-1);
	let commandHighlightedIndex = $state(-1);
	
	let botInputRef = $state(null);
	let commandInputRef = $state(null);
	let botDropdownRef = $state(null);
	let commandDropdownRef = $state(null);
	
	// Get all bots for the first dropdown
	const bots = $derived(getAllBots());
	
	// Get selected bot info
	const selectedBot = $derived(botValue ? BOT_REGISTRY[botValue] : null);
	
	// Get commands for selected bot
	const availableCommands = $derived(selectedBot ? Object.values(selectedBot.commands) : []);
	
	// Get selected command info
	const selectedCommand = $derived(
		selectedBot && commandValue 
			? selectedBot.commands[commandValue] 
			: null
	);
	
	// Filter bots by search query
	const filteredBots = $derived.by(() => {
		const query = botSearchQuery.toLowerCase().trim();
		if (!query) return bots;
		return bots.filter(bot => 
			bot.name.toLowerCase().includes(query) ||
			bot.description.toLowerCase().includes(query)
		);
	});
	
	// Filter commands by search query
	const filteredCommands = $derived.by(() => {
		const query = commandSearchQuery.toLowerCase().trim();
		if (!query) return availableCommands;
		return availableCommands.filter(cmd => 
			cmd.name.toLowerCase().includes(query) ||
			cmd.description.toLowerCase().includes(query)
		);
	});
	
	// Handle bot selection
	function selectBot(bot) {
		botValue = bot.id;
		botSearchQuery = '';
		isBotDropdownOpen = false;
		// Reset command when bot changes
		commandValue = '';
		resultValue = 'any';
	}
	
	// Handle command selection
	function selectCommand(cmd) {
		commandValue = cmd.name;
		commandSearchQuery = '';
		isCommandDropdownOpen = false;
	}
	
	// Clear bot selection
	function clearBot() {
		botValue = '';
		commandValue = '';
		resultValue = 'any';
		botSearchQuery = '';
	}
	
	// Clear command selection
	function clearCommand() {
		commandValue = '';
		commandSearchQuery = '';
	}
	
	// Handle keyboard navigation for bot dropdown
	function handleBotKeydown(event) {
		if (!isBotDropdownOpen) {
			if (event.key === 'ArrowDown' || event.key === 'Enter') {
				event.preventDefault();
				isBotDropdownOpen = true;
				botHighlightedIndex = 0;
			}
			return;
		}
		
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				botHighlightedIndex = Math.min(botHighlightedIndex + 1, filteredBots.length - 1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				botHighlightedIndex = Math.max(botHighlightedIndex - 1, 0);
				break;
			case 'Enter':
				event.preventDefault();
				if (botHighlightedIndex >= 0 && filteredBots[botHighlightedIndex]) {
					selectBot(filteredBots[botHighlightedIndex]);
				}
				break;
			case 'Escape':
				event.preventDefault();
				isBotDropdownOpen = false;
				botHighlightedIndex = -1;
				break;
		}
	}
	
	// Handle keyboard navigation for command dropdown
	function handleCommandKeydown(event) {
		if (!isCommandDropdownOpen) {
			if (event.key === 'ArrowDown' || event.key === 'Enter') {
				event.preventDefault();
				isCommandDropdownOpen = true;
				commandHighlightedIndex = 0;
			}
			return;
		}
		
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				commandHighlightedIndex = Math.min(commandHighlightedIndex + 1, filteredCommands.length - 1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				commandHighlightedIndex = Math.max(commandHighlightedIndex - 1, 0);
				break;
			case 'Enter':
				event.preventDefault();
				if (commandHighlightedIndex >= 0 && filteredCommands[commandHighlightedIndex]) {
					selectCommand(filteredCommands[commandHighlightedIndex]);
				}
				break;
			case 'Escape':
				event.preventDefault();
				isCommandDropdownOpen = false;
				commandHighlightedIndex = -1;
				break;
		}
	}
	
	// Close dropdowns when clicking outside
	function handleClickOutside(event) {
		if (botDropdownRef && !botDropdownRef.contains(event.target) && 
			botInputRef && !botInputRef.contains(event.target)) {
			isBotDropdownOpen = false;
		}
		if (commandDropdownRef && !commandDropdownRef.contains(event.target) && 
			commandInputRef && !commandInputRef.contains(event.target)) {
			isCommandDropdownOpen = false;
		}
	}
	
	// Check if selected command has result detection
	const hasResultDetection = $derived(
		selectedCommand && 
		((selectedCommand.successPatterns?.embedContains?.length > 0) ||
		 (selectedCommand.successPatterns?.contentContains?.length > 0) ||
		 (selectedCommand.failurePatterns?.embedContains?.length > 0) ||
		 (selectedCommand.failurePatterns?.contentContains?.length > 0))
	);
</script>

<svelte:window onclick={handleClickOutside} />

<div class="bot-command-selector">
	<!-- Hidden inputs for form submission -->
	<input type="hidden" name={botName} value={botValue} />
	{#if showCommandFilter}
		<input type="hidden" name={commandName} value={commandValue} />
	{/if}
	{#if showResultFilter}
		<input type="hidden" name={resultName} value={resultValue} />
	{/if}
	
	<!-- Bot Selector -->
	<div class="selector-group">
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<label class="selector-label">
			<span class="label-icon">🤖</span>
			Target Bot
		</label>
		
		<div class="selector-container">
			{#if selectedBot}
				<!-- Selected bot display -->
				<div class="selected-item">
					<span class="bot-icon" style="color: {selectedBot.color}">{selectedBot.icon}</span>
					<span class="bot-name">{selectedBot.name}</span>
					<button type="button" class="clear-btn" onclick={clearBot} title="Clear selection">×</button>
				</div>
			{:else}
				<!-- Bot search input -->
				<div class="search-wrapper">
					<input
						type="text"
						bind:this={botInputRef}
						bind:value={botSearchQuery}
						placeholder="Search bots..."
						onfocus={() => isBotDropdownOpen = true}
						onkeydown={handleBotKeydown}
						class="search-input"
					/>
					<span class="search-icon">🔍</span>
				</div>
			{/if}
			
			<!-- Bot dropdown -->
			{#if isBotDropdownOpen && !selectedBot}
				<div class="dropdown" bind:this={botDropdownRef}>
					{#if filteredBots.length === 0}
						<div class="dropdown-empty">
							No bots found matching "{botSearchQuery}"
						</div>
					{:else}
						{#each filteredBots as bot, index}
							<button
								type="button"
								class="dropdown-item"
								class:highlighted={index === botHighlightedIndex}
								onclick={() => selectBot(bot)}
								onmouseenter={() => botHighlightedIndex = index}
							>
								<span class="bot-icon" style="color: {bot.color}">{bot.icon}</span>
								<div class="bot-info">
									<span class="bot-name">{bot.name}</span>
									<span class="bot-desc">{bot.description}</span>
								</div>
								<span class="command-count">{Object.keys(bot.commands).length} commands</span>
							</button>
						{/each}
					{/if}
					
					<div class="dropdown-footer">
						<span class="footer-hint">💡 Don't see your bot? You can still filter by bot ID directly.</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
	
	<!-- Command Selector (only show if bot is selected) -->
	{#if selectedBot && showCommandFilter}
		<div class="selector-group">
			<!-- svelte-ignore a11y_label_has_associated_control -->
			<label class="selector-label">
				<span class="label-icon">⚡</span>
				Command <span class="optional">(optional)</span>
			</label>
			
			<div class="selector-container">
				{#if selectedCommand}
					<!-- Selected command display -->
					<div class="selected-item">
						<span class="command-slash">/</span>
						<span class="command-name">{selectedCommand.name}</span>
						<button type="button" class="clear-btn" onclick={clearCommand} title="Clear selection">×</button>
					</div>
				{:else}
					<!-- Command search input -->
					<div class="search-wrapper">
						<input
							type="text"
							bind:this={commandInputRef}
							bind:value={commandSearchQuery}
							placeholder="Any command (or search...)"
							onfocus={() => isCommandDropdownOpen = true}
							onkeydown={handleCommandKeydown}
							class="search-input"
						/>
						<span class="search-icon">/</span>
					</div>
				{/if}
				
				<!-- Command dropdown -->
				{#if isCommandDropdownOpen && !selectedCommand}
					<div class="dropdown" bind:this={commandDropdownRef}>
						{#if availableCommands.length === 0}
							<div class="dropdown-empty">
								No known commands for {selectedBot.name}
							</div>
						{:else if filteredCommands.length === 0}
							<div class="dropdown-empty">
								No commands found matching "{commandSearchQuery}"
							</div>
						{:else}
							<!-- "Any command" option -->
							<button
								type="button"
								class="dropdown-item any-option"
								onclick={() => { commandValue = ''; isCommandDropdownOpen = false; }}
							>
								<span class="command-slash">*</span>
								<div class="bot-info">
									<span class="bot-name">Any Command</span>
									<span class="bot-desc">Match any /{selectedBot.name.toLowerCase()} command</span>
								</div>
							</button>
							
							{#each filteredCommands as cmd, index}
								<button
									type="button"
									class="dropdown-item"
									class:highlighted={index === commandHighlightedIndex}
									onclick={() => selectCommand(cmd)}
									onmouseenter={() => commandHighlightedIndex = index}
								>
									<span class="command-slash">/</span>
									<div class="bot-info">
										<span class="bot-name">{cmd.name}</span>
										<span class="bot-desc">{cmd.description}</span>
									</div>

								</button>
							{/each}
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
	
	<!-- Result Filter (only show if command with detection is selected) -->
	{#if selectedCommand && showResultFilter && hasResultDetection}
		<div class="selector-group">
			<!-- svelte-ignore a11y_label_has_associated_control -->
			<label class="selector-label">
				<span class="label-icon">✅</span>
				Command Result
			</label>
			
			<div class="result-options">
				<label class="result-option" class:selected={resultValue === 'any'}>
					<input 
						type="radio" 
						name="{resultName}_radio" 
						value="any" 
						bind:group={resultValue}
					/>
					<span class="result-icon">🔄</span>
					<span class="result-text">Any Result</span>
				</label>
				
				<label class="result-option" class:selected={resultValue === 'success'}>
					<input 
						type="radio" 
						name="{resultName}_radio" 
						value="success" 
						bind:group={resultValue}
					/>
					<span class="result-icon">✅</span>
					<span class="result-text">Success Only</span>
				</label>
				
				<label class="result-option" class:selected={resultValue === 'failure'}>
					<input 
						type="radio" 
						name="{resultName}_radio" 
						value="failure" 
						bind:group={resultValue}
					/>
					<span class="result-icon">❌</span>
					<span class="result-text">Failure Only</span>
				</label>
			</div>
		</div>
	{/if}
</div>

<style>
	.bot-command-selector {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	
	.selector-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.selector-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 500;
		color: var(--text-primary, #fff);
	}
	
	.label-icon {
		font-size: 1rem;
	}
	
	.optional {
		font-weight: normal;
		color: var(--text-secondary, #888);
		font-size: 0.875rem;
	}
	
	.selector-container {
		position: relative;
	}
	
	.search-wrapper {
		position: relative;
	}
	
	.search-input {
		width: 100%;
		padding: 0.75rem 1rem 0.75rem 2.5rem;
		background: var(--bg-secondary, #2a2a2a);
		border: 1px solid var(--border-color, #444);
		border-radius: 8px;
		color: var(--text-primary, #fff);
		font-size: 0.95rem;
		transition: border-color 0.2s, box-shadow 0.2s;
	}
	
	.search-input:focus {
		outline: none;
		border-color: var(--accent-color, #5865f2);
		box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.2);
	}
	
	.search-input::placeholder {
		color: var(--text-tertiary, #666);
	}
	
	.search-icon {
		position: absolute;
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-tertiary, #666);
		pointer-events: none;
	}
	
	.selected-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: var(--bg-secondary, #2a2a2a);
		border: 1px solid var(--accent-color, #5865f2);
		border-radius: 8px;
	}
	
	.bot-icon {
		font-size: 1.25rem;
	}
	
	.bot-name {
		font-weight: 500;
		color: var(--text-primary, #fff);
	}
	
	.command-slash {
		color: var(--accent-color, #5865f2);
		font-weight: bold;
		font-family: monospace;
	}
	
	.command-name {
		font-family: monospace;
		color: var(--text-primary, #fff);
	}
	

	
	.clear-btn {
		margin-left: auto;
		padding: 0.25rem 0.5rem;
		background: transparent;
		border: none;
		color: var(--text-secondary, #888);
		cursor: pointer;
		font-size: 1.25rem;
		line-height: 1;
		border-radius: 4px;
		transition: color 0.2s, background 0.2s;
	}
	
	.clear-btn:hover {
		color: var(--danger-color, #f44);
		background: var(--bg-tertiary, #333);
	}
	
	.dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		margin-top: 0.25rem;
		background: var(--bg-secondary, #2a2a2a);
		border: 1px solid var(--border-color, #444);
		border-radius: 8px;
		max-height: 300px;
		overflow-y: auto;
		z-index: 100;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
	}
	
	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.75rem 1rem;
		background: transparent;
		border: none;
		text-align: left;
		cursor: pointer;
		transition: background 0.15s;
		color: inherit;
	}
	
	.dropdown-item:hover,
	.dropdown-item.highlighted {
		background: var(--bg-tertiary, #333);
	}
	
	.dropdown-item.any-option {
		border-bottom: 1px solid var(--border-color, #444);
	}
	
	.bot-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex: 1;
		min-width: 0;
	}
	
	.bot-desc {
		font-size: 0.8rem;
		color: var(--text-secondary, #888);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	
	.command-count {
		font-size: 0.75rem;
		color: var(--text-tertiary, #666);
		white-space: nowrap;
	}
	
	.dropdown-empty {
		padding: 1rem;
		text-align: center;
		color: var(--text-secondary, #888);
	}
	
	.dropdown-footer {
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--border-color, #444);
		background: var(--bg-tertiary, #1a1a1a);
	}
	
	.footer-hint {
		font-size: 0.8rem;
		color: var(--text-tertiary, #666);
	}
	
	/* Result options */
	.result-options {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	
	.result-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: var(--bg-secondary, #2a2a2a);
		border: 1px solid var(--border-color, #444);
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}
	
	.result-option:hover {
		border-color: var(--text-secondary, #888);
	}
	
	.result-option.selected {
		border-color: var(--accent-color, #5865f2);
		background: rgba(88, 101, 242, 0.1);
	}
	
	.result-option input[type="radio"] {
		display: none;
	}
	
	.result-icon {
		font-size: 1rem;
	}
	
	.result-text {
		font-size: 0.9rem;
		color: var(--text-primary, #fff);
	}
	

</style>
