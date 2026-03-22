<script>
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { theme } from '$lib/theme.svelte.js';
	import { commandPalette } from '$lib/command-palette.svelte.js';
	import { onMount, tick } from 'svelte';
	
	/** @type {{ isLoggedIn?: boolean, user?: any, adminGuilds?: any[], selectedGuildId?: string|null, isSuperAdmin?: boolean }} */
	let {
		isLoggedIn = false,
		user = null,
		adminGuilds = [],
		selectedGuildId = null,
		isSuperAdmin = false
	} = $props();
	
	let isOpen = $state(false);
	let query = $state('');
	let selectedIndex = $state(0);
	/** @type {HTMLInputElement|null} */
	let inputEl = $state(null);
	/** @type {HTMLElement|null} */
	let listEl = $state(null);
	
	/**
	 * @typedef {{ id: string, label: string, description?: string, icon: string, iconHtml?: string, group: string, action: () => void, keywords?: string[] }} Command
	 */
	
	/** Active server ID from current URL or selected guild */
	const activeServerId = $derived(
		$page.url.pathname.match(/^\/admin\/(\d{17,20})/)?.[1] ?? selectedGuildId
	);
	
	const activeGuild = $derived(
		adminGuilds.find(g => g.id === activeServerId)
	);
	
	/** Build the full list of commands depending on context */
	const allCommands = $derived.by(() => {
		/** @type {Command[]} */
		const commands = [];
		
		// --- Navigation ---
		commands.push({
			id: 'nav-home',
			label: 'Home',
			description: 'Go to the landing page',
			icon: '🏠',
			group: 'Navigation',
			action: () => goto('/'),
			keywords: ['landing', 'index', 'start']
		});
		
		if (isLoggedIn) {
			commands.push({
				id: 'nav-dashboard',
				label: 'Dashboard',
				description: 'Server selection overview',
				icon: '🚀',
				group: 'Navigation',
				action: () => goto('/admin'),
				keywords: ['admin', 'servers', 'overview']
			});
		}
		
		/** @type {{ label: string, icon: string, path: string, desc: string, keywords: string[] }[]} */
		const serverPages = [
			{ label: 'Overview',           icon: '📊', path: '',                        desc: 'Server dashboard',                      keywords: ['dashboard', 'home', 'overview', 'stats'] },
			{ label: 'Automations',        icon: '⚡', path: '/automations',             desc: 'Manage event-driven automations',       keywords: ['triggers', 'actions', 'events', 'workflow'] },
			{ label: 'Slash Commands',     icon: '💬', path: '/commands',                desc: 'Create and edit slash commands',         keywords: ['command', 'slash', 'bot'] },
			{ label: 'Scheduled Events',   icon: '📅', path: '/scheduled-server-events', desc: 'Manage Discord scheduled events',        keywords: ['calendar', 'events', 'schedule'] },
			{ label: 'Integrations',       icon: '🔌', path: '/integrations',            desc: 'Connect apps and services',             keywords: ['plugins', 'apps', 'connect', 'external'] },
			{ label: 'Event Logs',         icon: '📋', path: '/logs',                    desc: 'View server event history',             keywords: ['events', 'history', 'audit', 'activity'] },
			{ label: 'Statistics',         icon: '📈', path: '/stats',                   desc: 'Charts and analytics',                  keywords: ['analytics', 'charts', 'metrics', 'data', 'graphs'] },
			{ label: 'API Keys',           icon: '🔑', path: '/api-keys',                desc: 'Manage REST API access keys',           keywords: ['api', 'tokens', 'keys', 'rest', 'access'] },
			{ label: 'Server Settings',    icon: '⚙️', path: '/settings',                desc: 'Bot and server configuration',          keywords: ['config', 'configure', 'preferences'] },
			{ label: 'Import & Export',    icon: '📦', path: '/import-export',            desc: 'Share or back up automations & commands', keywords: ['backup', 'share', 'transfer', 'migrate'] },
			{ label: 'AI Assistant',       icon: '🤖', iconHtml: '<img src="/logo.webp" alt="" style="height:1.2em;width:auto;vertical-align:middle;border-radius:4px;" />', path: '/chat',                   desc: 'Chat with SpaceBot about this server',  keywords: ['chat', 'ai', 'assistant', 'dm', 'message', 'ask', 'help'] },
			{ label: 'Account & Billing',  icon: '💳', path: '/account',                 desc: 'Plan, usage, and subscription',         keywords: ['billing', 'plan', 'subscription', 'payment', 'upgrade'] },
		];
		
		// Servers with the bot installed, active server first
		const serversWithBot = adminGuilds.filter(g => g.botIsInServer !== false);
		serversWithBot.sort((a, b) => {
			if (a.id === activeServerId) return -1;
			if (b.id === activeServerId) return 1;
			return 0;
		});
		const hasMultipleServers = serversWithBot.length > 1;
		
		// For each server with the bot, generate page commands
		// Active server gets its own top-level group; others are nested
		for (const guild of serversWithBot) {
			const isActive = guild.id === activeServerId;
			const groupName = hasMultipleServers
				? (isActive ? guild.name : guild.name)
				: 'Server';
			
			for (const pg of serverPages) {
				commands.push({
					id: `server-${guild.id}-${pg.path || 'home'}`,
					label: hasMultipleServers ? `${pg.label}` : pg.label,
					description: hasMultipleServers ? `${guild.name} · ${pg.desc}` : pg.desc,
					icon: pg.icon,
					group: groupName,
					action: () => goto(`/admin/${guild.id}${pg.path}`),
					keywords: [...pg.keywords, guild.name.toLowerCase(), 'server']
				});
			}
		}
		
		if (isSuperAdmin) {
			commands.push({
				id: 'nav-superadmin',
				label: 'Superadmin Panel',
				description: 'Global administration',
				icon: '👑',
				group: 'Navigation',
				action: () => goto('/admin/superadmin'),
				keywords: ['super', 'admin', 'global', 'system']
			});
		}
		
		// --- Actions ---
		commands.push({
			id: 'action-theme',
			label: theme.isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode',
			description: 'Toggle the color theme',
			icon: theme.isDark ? '☀️' : '🌙',
			group: 'Actions',
			action: () => theme.toggle(),
			keywords: ['theme', 'dark', 'light', 'mode', 'toggle', 'color']
		});
		
		if (isLoggedIn) {
			commands.push({
				id: 'action-logout',
				label: 'Logout',
				description: 'Sign out of SpaceBot',
				icon: '🚪',
				group: 'Actions',
				action: () => { window.location.href = '/api/auth/logout'; },
				keywords: ['sign out', 'log out', 'exit']
			});
		} else {
			commands.push({
				id: 'action-login',
				label: 'Login with Discord',
				description: 'Sign in to manage your servers',
				icon: '🔐',
				iconHtml: '<svg width="16" height="16" viewBox="0 0 71 55" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M60.1 4.9A58.5 58.5 0 0 0 45.4.2a.2.2 0 0 0-.2.1 40.8 40.8 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0A37.4 37.4 0 0 0 25.4.3a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.5 4.9a.2.2 0 0 0-.1.1C1.5 18.7-.9 32.2.3 45.5v.2a58.9 58.9 0 0 0 17.7 9 .2.2 0 0 0 .3-.1 42.1 42.1 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.8 38.8 0 0 1-5.5-2.6.2.2 0 0 1 0-.4c.4-.3.7-.6 1.1-.9a.2.2 0 0 1 .2 0c11.6 5.3 24.2 5.3 35.7 0a.2.2 0 0 1 .2 0l1.1.9a.2.2 0 0 1 0 .4c-1.8 1-3.6 1.9-5.6 2.6a.2.2 0 0 0-.1.3 47.3 47.3 0 0 0 3.7 5.9.2.2 0 0 0 .2.1 58.7 58.7 0 0 0 17.7-9 .2.2 0 0 0 .1-.2c1.4-15-2.3-28.4-9.8-40.1a.2.2 0 0 0-.1-.1ZM23.7 37.3c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.1 6.3-7.1 6.4 3.2 6.3 7.1c0 3.9-2.8 7.1-6.3 7.1Zm23.3 0c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.1 6.3-7.1 6.4 3.2 6.3 7.1c0 3.9-2.7 7.1-6.3 7.1Z"/></svg>',
				group: 'Actions',
				action: () => goto('/login'),
				keywords: ['sign in', 'log in', 'discord', 'auth']
			});
		}
		
		commands.push({
			id: 'nav-pricing',
			label: 'Pricing',
			description: 'View plans and pricing',
			icon: '💰',
			group: 'Navigation',
			action: () => goto('/#pricing'),
			keywords: ['pricing', 'plans', 'cost', 'free', 'pro', 'subscription', 'upgrade']
		});
		
		commands.push({
			id: 'nav-docs',
			label: 'Documentation',
			description: 'Guides and feature reference',
			icon: '📖',
			group: 'Navigation',
			action: () => goto('/docs'),
			keywords: ['docs', 'documentation', 'help', 'guide', 'manual', 'reference', 'how to']
		});
		
		commands.push({
			id: 'action-github',
			label: 'View on GitHub',
			description: 'Open the source code repository',
			icon: '🐙',
			group: 'Actions',
			action: () => { window.open('https://github.com/starspacegroup/spacebot', '_blank'); },
			keywords: ['github', 'source', 'code', 'repo', 'repository', 'open source']
		});
		
		return commands;
	});
	
	/**
	 * Simple fuzzy match — checks if all query chars appear in order.
	 * Returns a score (lower = better match). -1 means no match.
	 * @param {string} text
	 * @param {string} q
	 * @returns {number}
	 */
	function fuzzyScore(text, q) {
		const lower = text.toLowerCase();
		const ql = q.toLowerCase();
		let ti = 0;
		let score = 0;
		
		for (let qi = 0; qi < ql.length; qi++) {
			const idx = lower.indexOf(ql[qi], ti);
			if (idx === -1) return -1;
			// Reward consecutive matches and word-start matches
			score += idx - ti;
			if (idx === 0 || lower[idx - 1] === ' ' || lower[idx - 1] === '-') {
				score -= 5; // bonus for word boundary
			}
			ti = idx + 1;
		}
		return score;
	}
	
	/** Filtered & scored commands based on search query */
	const filteredCommands = $derived.by(() => {
		if (!query.trim()) return allCommands;
		
		const q = query.trim();
		
		/** @type {{ command: Command, score: number }[]} */
		const scored = [];
		
		for (const cmd of allCommands) {
			// Check label, description, and keywords
			const labelScore = fuzzyScore(cmd.label, q);
			const descScore = cmd.description ? fuzzyScore(cmd.description, q) : -1;
			const keywordScores = (cmd.keywords ?? []).map(k => fuzzyScore(k, q));
			
			// Exact substring bonus
			const exactLabel = cmd.label.toLowerCase().includes(q.toLowerCase()) ? -100 : 0;
			const exactDesc = cmd.description?.toLowerCase().includes(q.toLowerCase()) ? -50 : 0;
			
			const allScores = [labelScore, descScore, ...keywordScores]
				.filter(s => s !== -1);
			
			if (allScores.length > 0 || exactLabel < 0 || exactDesc < 0) {
				const bestFuzzy = allScores.length > 0 ? Math.min(...allScores) : 100;
				scored.push({ command: cmd, score: bestFuzzy + exactLabel + exactDesc });
			}
		}
		
		// Sort within each group, but preserve group ordering
		// Group by group name first
		/** @type {Map<string, typeof scored>} */
		const byGroup = new Map();
		for (const item of scored) {
			if (!byGroup.has(item.command.group)) byGroup.set(item.command.group, []);
			byGroup.get(item.command.group)?.push(item);
		}
		// Sort within each group by score
		for (const items of byGroup.values()) {
			items.sort((a, b) => a.score - b.score);
		}
		
		// Determine group order: Navigation, active server, other servers, Actions
		const activeGuildName = activeGuild?.name;
		const orderedKeys = ['Navigation'];
		if (activeGuildName && byGroup.has(activeGuildName)) orderedKeys.push(activeGuildName);
		for (const key of byGroup.keys()) {
			if (!orderedKeys.includes(key) && key !== 'Actions') orderedKeys.push(key);
		}
		orderedKeys.push('Actions');
		
		/** @type {Command[]} */
		const result = [];
		for (const key of orderedKeys) {
			const items = byGroup.get(key);
			if (items) result.push(...items.map(i => i.command));
		}
		return result;
	});
	
	// Reset selection when filter changes
	$effect(() => {
		void filteredCommands.length;
		selectedIndex = 0;
	});
	
	// Watch for external open requests
	$effect(() => {
		const v = commandPalette.version;
		if (v > 0) open();
	});
	
	/** Open the palette */
	async function open() {
		isOpen = true;
		query = '';
		selectedIndex = 0;
		document.body.style.overflow = 'hidden';
		await tick();
		inputEl?.focus();
	}
	
	/** Close the palette */
	function close() {
		isOpen = false;
		query = '';
		document.body.style.overflow = '';
	}
	
	/** Execute the currently selected command */
	function executeSelected() {
		const cmd = filteredCommands[selectedIndex];
		if (cmd) {
			close();
			cmd.action();
		}
	}
	
	/** Scroll the active item into view */
	function scrollActiveIntoView() {
		tick().then(() => {
			const active = listEl?.querySelector('[data-active="true"]');
			active?.scrollIntoView({ block: 'nearest' });
		});
	}
	
	/** Handle keyboard shortcuts for navigation */
	function handleKeydown(e) {
		if (!isOpen) {
			// Open with Cmd/Ctrl + K
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				open();
			}
			return;
		}
		
		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				close();
				break;
			case 'ArrowDown':
				e.preventDefault();
				selectedIndex = (selectedIndex + 1) % filteredCommands.length;
				scrollActiveIntoView();
				break;
			case 'ArrowUp':
				e.preventDefault();
				selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
				scrollActiveIntoView();
				break;
			case 'Enter':
				e.preventDefault();
				executeSelected();
				break;
		}
	}
	
	/** Close when clicking backdrop */
	function handleBackdropClick(e) {
		if (e.target === e.currentTarget) {
			close();
		}
	}

	/** Forward wheel events anywhere on the backdrop to the palette list */
	function handleWheel(e) {
		if (listEl) {
			e.preventDefault();
			listEl.scrollTop += e.deltaY;
		}
	}
	
	/** Detect OS for showing correct shortcut key */
	let isMac = $state(false);
	onMount(() => {
		isMac = navigator.platform?.toLowerCase().includes('mac') ?? 
			navigator.userAgent?.toLowerCase().includes('mac') ?? false;
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="palette-backdrop" onclick={handleBackdropClick} onwheel={handleWheel}>
		<div class="palette" role="dialog" aria-label="Command palette">
			<div class="palette-header">
				<svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8"/>
					<line x1="21" y1="21" x2="16.65" y2="16.65"/>
				</svg>
				<input
					bind:this={inputEl}
					bind:value={query}
					type="text"
					class="palette-input"
					placeholder="Type a command or search..."
					spellcheck="false"
					autocomplete="off"
				/>
				<kbd class="palette-esc">Esc</kbd>
			</div>
			
			<div class="palette-list" bind:this={listEl} role="listbox">
				{#if filteredCommands.length === 0}
					<div class="palette-empty">
						<span class="empty-icon">🔍</span>
						<span>No results for "<strong>{query}</strong>"</span>
					</div>
				{:else}
					{#each filteredCommands as cmd, idx}
						{#if idx === 0 || cmd.group !== filteredCommands[idx - 1].group}
							<div class="palette-group-label">{cmd.group}</div>
						{/if}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_interactive_supports_focus -->
						<div
							class="palette-item"
							class:active={idx === selectedIndex}
							data-active={idx === selectedIndex}
							role="option"
							aria-selected={idx === selectedIndex}
							tabindex="-1"
							onmouseenter={() => selectedIndex = idx}
							onclick={() => { close(); cmd.action(); }}
						>
							<span class="item-icon">{#if cmd.iconHtml}{@html cmd.iconHtml}{:else}{cmd.icon}{/if}</span>
							<div class="item-text">
								<span class="item-label">{cmd.label}</span>
								{#if cmd.description}
									<span class="item-desc">{cmd.description}</span>
								{/if}
							</div>
							{#if idx === selectedIndex}
								<kbd class="item-hint">↵</kbd>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
			
			<div class="palette-footer">
				<span class="footer-hint">
					<kbd>↑</kbd><kbd>↓</kbd> navigate
				</span>
				<span class="footer-hint">
					<kbd>↵</kbd> select
				</span>
				<span class="footer-hint">
					<kbd>esc</kbd> close
				</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.palette-backdrop {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: min(20vh, 120px);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		animation: fadeIn 0.12s ease-out;
	}
	
	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	
	@keyframes slideIn {
		from {
			opacity: 0;
			transform: scale(0.98) translateY(-8px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}
	
	.palette {
		width: min(640px, calc(100vw - 2rem));
		max-height: min(480px, calc(100vh - 200px));
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-xl), 0 0 0 1px var(--color-border-light);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: slideIn 0.15s ease-out;
	}
	
	.palette-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-bottom: 1px solid var(--color-border);
	}
	
	.search-icon {
		flex-shrink: 0;
		color: var(--color-text-muted);
	}
	
	.palette-input {
		flex: 1;
		border: none;
		background: transparent;
		font-size: 1rem;
		color: var(--color-text);
		outline: none;
		font-family: inherit;
		min-width: 0;
	}
	
	.palette-input::placeholder {
		color: var(--color-text-light);
	}
	
	.palette-esc {
		flex-shrink: 0;
		padding: 0.125rem 0.5rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 0.7rem;
		color: var(--color-text-muted);
		font-family: inherit;
		line-height: 1.4;
	}
	
	.palette-list {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem;
	}
	
	.palette-group-label {
		padding: 0.5rem 0.5rem 0.25rem;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		user-select: none;
	}
	
	.palette-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background var(--transition-fast);
		user-select: none;
	}
	
	.palette-item:hover,
	.palette-item.active {
		background: var(--color-primary-soft);
	}
	
	.palette-item.active {
		outline: 1px solid var(--color-primary);
		outline-offset: -1px;
	}
	
	.item-icon {
		font-size: 1.125rem;
		flex-shrink: 0;
		width: 1.5rem;
		text-align: center;
		line-height: 1;
	}
	
	.item-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	
	.item-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	
	.active .item-label {
		color: var(--color-primary);
	}
	
	.item-desc {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	
	.item-hint {
		flex-shrink: 0;
		padding: 0.0625rem 0.375rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 0.7rem;
		color: var(--color-text-muted);
		font-family: inherit;
	}
	
	.palette-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2rem 1rem;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}
	
	.empty-icon {
		font-size: 1.5rem;
	}
	
	.palette-footer {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 1rem;
		border-top: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
	}
	
	.footer-hint {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}
	
	.footer-hint kbd {
		padding: 0.0625rem 0.375rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 0.675rem;
		font-family: inherit;
		line-height: 1.4;
	}
	
	/* Mobile adjustments */
	@media (max-width: 640px) {
		.palette-backdrop {
			padding-top: 0;
			align-items: flex-start;
		}
		
		.palette {
			width: 100vw;
			max-height: 100vh;
			border-radius: 0;
			border: none;
		}
		
		.palette-footer {
			display: none;
		}
	}
</style>
