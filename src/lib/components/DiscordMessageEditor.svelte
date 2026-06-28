<script lang="ts">
	/**
	 * Discord Message Editor Component
	 * A rich text editor for Discord messages with:
	 * - Markdown formatting (bold, italic, underline, strikethrough, code)
	 * - Channel mentions (@#channel)
	 * - Role mentions
	 * - Template variable insertion
	 * - Real-time preview
	 */

	let {
		value = $bindable(''),
		name = 'content',
		placeholder = 'Enter your message...',
		required = false,
		rows = 4,
		channels = null, // Pre-loaded channels array
		roles = null, // Pre-loaded roles array
		templateVariables = {}, // Available template variables
		showPreview = true, // Show live preview
		guildId: _guildId = null, // Guild ID for fetching data if not pre-loaded
	} = $props();

	let textareaRef = $state(null);
	let showMentionMenu = $state(false);
	let showVariableMenu = $state(false);
	let mentionType = $state('channel'); // 'channel' | 'role'
	let mentionSearch = $state('');
	let channelSearch = $state('');
	let roleSearch = $state('');
	let variableSearch = $state('');
	const _menuPosition = $state({ top: 0, left: 0 });
	let highlightedIndex = $state(0);

	// Flatten channels for easy access
	const flatChannels = $derived.by(() => {
		if (!channels || !Array.isArray(channels)) return [];
		const flat = [];
		for (const group of channels) {
			if (group.channels) {
				for (const ch of group.channels) {
					flat.push({
						...ch,
						categoryName: group.categoryName,
					});
				}
			}
		}
		return flat;
	});

	// Filter channels based on search
	const filteredChannels = $derived.by(() => {
		if (!mentionSearch.trim()) return flatChannels.slice(0, 10);
		const query = mentionSearch.toLowerCase();
		return flatChannels.filter((ch) => ch.name.toLowerCase().includes(query)).slice(0, 10);
	});

	// Filter roles based on search
	const filteredRoles = $derived.by(() => {
		if (!roles || !Array.isArray(roles)) return [];
		const query = mentionSearch.toLowerCase();
		if (!query) return roles.slice(0, 10);
		return roles.filter((r) => r.name.toLowerCase().includes(query)).slice(0, 10);
	});

	// Get currently active items based on mention type
	const activeItems = $derived(mentionType === 'channel' ? filteredChannels : filteredRoles);

	// Variable categories for organized display (filtered by realtime search)
	const variableCategories = $derived.by(() => {
		const query = variableSearch.trim().toLowerCase();
		const categories: Record<string, Array<{ key: string; desc: any }>> = {};
		for (const [key, desc] of Object.entries(templateVariables)) {
			if (query) {
				const hay = `${key} ${desc}`.toLowerCase();
				if (!hay.includes(query)) continue;
			}
			const [category] = key.split('.');
			if (!categories[category]) {
				categories[category] = [];
			}
			categories[category].push({ key, desc });
		}
		return categories;
	});

	// Filtered channels for the toolbar Channel dropdown (separate from inline @-mention search)
	const toolbarChannels = $derived.by(() => {
		const query = channelSearch.trim().toLowerCase();
		if (!query) return flatChannels.slice(0, 25);
		return flatChannels.filter((ch) => ch.name.toLowerCase().includes(query)).slice(0, 25);
	});

	// Filtered roles for the toolbar Role dropdown
	const toolbarRoles = $derived.by(() => {
		if (!roles || !Array.isArray(roles)) return [];
		const query = roleSearch.trim().toLowerCase();
		if (!query) return roles.slice(0, 25);
		return roles.filter((r) => r.name.toLowerCase().includes(query)).slice(0, 25);
	});

	// Icon for a variable category — matches the kind of "event/entity" the variable describes
	function getCategoryIcon(category) {
		switch (category) {
			case 'user':
				return '👤';
			case 'target':
				return '🎯';
			case 'channel':
				return '#⃣';
			case 'guild':
				return '🏠';
			case 'trigger':
				return '⚡';
			case 'github':
				return '🐙';
			case 'github_logo_url':
				return '🐙';
			case 'option':
				return '⚙️';
			case 'message':
				return '💬';
			case 'role':
				return '🛡️';
			case 'reaction':
				return '😀';
			case 'voice':
				return '🔊';
			default:
				return '🔖';
		}
	}

	function getCategoryLabel(category) {
		if (!category) return '';
		return category.charAt(0).toUpperCase() + category.slice(1);
	}

	// Formatting commands - organized by category
	const textFormats = [
		{ icon: 'B', label: 'Bold', prefix: '**', suffix: '**', shortcut: 'Ctrl+B' },
		{ icon: 'I', label: 'Italic', prefix: '*', suffix: '*', shortcut: 'Ctrl+I' },
		{ icon: 'U', label: 'Underline', prefix: '__', suffix: '__', shortcut: 'Ctrl+U' },
		{ icon: 'S', label: 'Strikethrough', prefix: '~~', suffix: '~~', shortcut: '' },
		{ icon: '||', label: 'Spoiler', prefix: '||', suffix: '||', shortcut: '' },
	];

	const headerFormats = [
		{ icon: 'H1', label: 'Heading 1', prefix: '# ', suffix: '', lineStart: true },
		{ icon: 'H2', label: 'Heading 2', prefix: '## ', suffix: '', lineStart: true },
		{ icon: 'H3', label: 'Heading 3', prefix: '### ', suffix: '', lineStart: true },
		{ icon: '-H', label: 'Subtext', prefix: '-# ', suffix: '', lineStart: true },
	];

	const blockFormats = [
		{ icon: '>', label: 'Quote', prefix: '> ', suffix: '', lineStart: true },
		{ icon: '>>', label: 'Multi-line Quote', prefix: '>>> ', suffix: '', lineStart: true },
		{ icon: '•', label: 'Bullet List', prefix: '- ', suffix: '', lineStart: true },
		{ icon: '1.', label: 'Numbered List', prefix: '1. ', suffix: '', lineStart: true },
	];

	const codeFormats = [
		{ icon: '`', label: 'Inline Code', prefix: '`', suffix: '`', shortcut: '' },
		{ icon: '```', label: 'Code Block', prefix: '```\n', suffix: '\n```', shortcut: '' },
	];

	const linkFormat = { icon: '🔗', label: 'Link', prefix: '[', suffix: '](url)', shortcut: '' };
	const _maskedLinkFormat = {
		icon: '🔗+',
		label: 'Masked Link',
		prefix: '[text](',
		suffix: ')',
		shortcut: '',
	};

	// Apply formatting around selection
	function applyFormat(prefix, suffix, lineStart = false) {
		if (!textareaRef) return;

		const start = textareaRef.selectionStart;
		const end = textareaRef.selectionEnd;
		const selectedText = value.substring(start, end);

		let newText;
		let newCursorStart;
		let newCursorEnd;

		if (lineStart) {
			// For line-start formatting (headers, quotes, lists), ensure we're at line start
			const beforeCursor = value.substring(0, start);
			const lineStartPos = beforeCursor.lastIndexOf('\n') + 1;
			const linePrefix = value.substring(lineStartPos, start);

			// If there's content before cursor on this line, add a newline first
			if (linePrefix.trim().length > 0 && start === end) {
				newText = value.substring(0, start) + '\n' + prefix + suffix + value.substring(end);
				newCursorStart = newCursorEnd = start + 1 + prefix.length;
			} else if (linePrefix.length === 0 || linePrefix.trim().length === 0) {
				// We're at or near line start
				newText =
					value.substring(0, lineStartPos) +
					prefix +
					value.substring(lineStartPos, start) +
					selectedText +
					suffix +
					value.substring(end);
				newCursorStart = lineStartPos + prefix.length + (start - lineStartPos);
				newCursorEnd = newCursorStart + selectedText.length;
			} else {
				newText =
					value.substring(0, start) +
					'\n' +
					prefix +
					selectedText +
					suffix +
					value.substring(end);
				newCursorStart = start + 1 + prefix.length;
				newCursorEnd = newCursorStart + selectedText.length;
			}
		} else {
			newText =
				value.substring(0, start) + prefix + selectedText + suffix + value.substring(end);
			newCursorStart = start + prefix.length;
			newCursorEnd = newCursorStart + selectedText.length;
		}

		value = newText;

		// Move cursor appropriately
		requestAnimationFrame(() => {
			textareaRef.focus();
			if (selectedText) {
				textareaRef.selectionStart = newCursorStart;
				textareaRef.selectionEnd = newCursorEnd;
			} else {
				textareaRef.selectionStart = textareaRef.selectionEnd = newCursorStart;
			}
		});
	}

	// Insert text at cursor
	function insertAtCursor(text) {
		if (!textareaRef) return;

		const start = textareaRef.selectionStart;
		const end = textareaRef.selectionEnd;

		value = value.substring(0, start) + text + value.substring(end);

		requestAnimationFrame(() => {
			textareaRef.focus();
			textareaRef.selectionStart = textareaRef.selectionEnd = start + text.length;
		});
	}

	// Handle keyboard shortcuts
	function handleKeydown(e) {
		// Handle mention menu navigation
		if (showMentionMenu) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				highlightedIndex = Math.min(highlightedIndex + 1, activeItems.length - 1);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				highlightedIndex = Math.max(highlightedIndex - 1, 0);
			} else if (e.key === 'Enter' || e.key === 'Tab') {
				e.preventDefault();
				if (activeItems[highlightedIndex]) {
					insertMention(activeItems[highlightedIndex]);
				}
			} else if (e.key === 'Escape') {
				closeMentionMenu();
			}
			return;
		}

		// Handle variable menu navigation
		if (showVariableMenu) {
			if (e.key === 'Escape') {
				closeVariableMenu();
			}
			return;
		}

		// Formatting shortcuts
		if (e.ctrlKey || e.metaKey) {
			switch (e.key.toLowerCase()) {
				case 'b':
					e.preventDefault();
					applyFormat('**', '**');
					break;
				case 'i':
					e.preventDefault();
					applyFormat('*', '*');
					break;
				case 'u':
					e.preventDefault();
					applyFormat('__', '__');
					break;
			}
		}
	}

	// Handle input to detect mention triggers
	function handleInput(_e) {
		const cursorPos = textareaRef.selectionStart;
		const textBefore = value.substring(0, cursorPos);

		// Check for channel mention trigger: #
		const channelMatch = textBefore.match(/#(\w*)$/);
		if (channelMatch) {
			mentionType = 'channel';
			mentionSearch = channelMatch[1];
			highlightedIndex = 0;
			openMentionMenu();
			return;
		}

		// Check for role mention trigger: @&
		const roleMatch = textBefore.match(/@&(\w*)$/);
		if (roleMatch) {
			mentionType = 'role';
			mentionSearch = roleMatch[1];
			highlightedIndex = 0;
			openMentionMenu();
			return;
		}

		// Check for variable trigger: {
		const varMatch = textBefore.match(/\{([^}]*)$/);
		if (varMatch) {
			showVariableMenu = true;
			return;
		}

		// Close menus if no trigger
		if (showMentionMenu) {
			closeMentionMenu();
		}
		if (showVariableMenu && !textBefore.includes('{')) {
			closeVariableMenu();
		}
	}

	function openMentionMenu() {
		showMentionMenu = true;
		// Position menu near cursor (simplified - just show below textarea)
	}

	function closeMentionMenu() {
		showMentionMenu = false;
		mentionSearch = '';
		highlightedIndex = 0;
	}

	function closeVariableMenu() {
		showVariableMenu = false;
	}

	function insertMention(item) {
		const cursorPos = textareaRef.selectionStart;
		const textBefore = value.substring(0, cursorPos);

		// Find the trigger position
		let triggerPos;
		let mentionText;

		if (mentionType === 'channel') {
			triggerPos = textBefore.lastIndexOf('#');
			mentionText = `<#${item.id}>`;
		} else {
			triggerPos = textBefore.lastIndexOf('@&');
			mentionText = `<@&${item.id}>`;
		}

		// Replace trigger and search text with mention
		value = value.substring(0, triggerPos) + mentionText + value.substring(cursorPos);

		closeMentionMenu();

		requestAnimationFrame(() => {
			textareaRef.focus();
			const newPos = triggerPos + mentionText.length;
			textareaRef.selectionStart = textareaRef.selectionEnd = newPos;
		});
	}

	function _insertVariable(varKey) {
		insertAtCursor(`{${varKey}}`);
		closeVariableMenu();
	}

	function insertVariableFromButton(varKey) {
		insertAtCursor(`{${varKey}}`);
	}

	function insertChannelMention(channel) {
		insertAtCursor(`<#${channel.id}>`);
	}

	function insertRoleMention(role) {
		insertAtCursor(`<@&${role.id}>`);
	}

	// Get channel icon
	function getChannelIcon(type) {
		switch (type) {
			case 'text':
				return '#';
			case 'voice':
				return '🔊';
			case 'announcement':
				return '📢';
			case 'forum':
				return '💬';
			case 'stage':
				return '🎭';
			default:
				return '#';
		}
	}

	// Render preview with Discord-style formatting
	function renderPreview(text) {
		if (!text) return '';

		let html = text;

		// Escape HTML first
		html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

		// Template variables - highlight them
		html = html.replace(/\{([^}]+)\}/g, '<span class="preview-variable">{$1}</span>');

		// Channel mentions
		html = html.replace(/&lt;#(\d+)&gt;/g, (match, id) => {
			const channel = flatChannels.find((c) => c.id === id);
			const name = channel ? channel.name : 'unknown';
			return `<span class="preview-channel">#${name}</span>`;
		});

		// Role mentions
		html = html.replace(/&lt;@&amp;(\d+)&gt;/g, (match, id) => {
			const role = roles?.find((r) => r.id === id);
			const name = role ? role.name : 'unknown';
			const color = role?.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#99aab5';
			return `<span class="preview-role" style="background-color: ${color}20; color: ${color}">@${name}</span>`;
		});

		// User mentions (template-generated)
		html = html.replace(/&lt;@(\d+)&gt;/g, '<span class="preview-mention">@user</span>');

		// Code blocks (must be before other formatting)
		html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
			return `<pre class="preview-codeblock"${lang ? ` data-lang="${lang}"` : ''}>${code}</pre>`;
		});

		// Inline code (must be before other inline formatting)
		html = html.replace(/`([^`\n]+)`/g, '<code class="preview-code">$1</code>');

		// Links [text](url) - must be before other bracket handling
		// Strip any <span> tags from the URL part (template variables get wrapped in spans earlier)
		html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, rawUrl) => {
			const url = rawUrl.replace(/<[^>]+>/g, '');
			return `<a class="preview-link" href="${url}" target="_blank" rel="noopener">${text}</a>`;
		});

		// Bold (must be before italic)
		html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

		// Italic
		html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

		// Underline (must check it's not part of __)
		html = html.replace(/__(.+?)__/g, '<u>$1</u>');

		// Strikethrough
		html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

		// Spoiler
		html = html.replace(/\|\|(.+?)\|\|/g, '<span class="preview-spoiler">$1</span>');

		// Process line-by-line for block elements
		const lines = html.split('\n');
		const processedLines = lines.map((line) => {
			// Headers (must have space after #)
			if (/^# /.test(line)) {
				return `<h1 class="preview-h1">${line.substring(2)}</h1>`;
			}
			if (/^## /.test(line)) {
				return `<h2 class="preview-h2">${line.substring(3)}</h2>`;
			}
			if (/^### /.test(line)) {
				return `<h3 class="preview-h3">${line.substring(4)}</h3>`;
			}

			// Subtext
			if (/^-# /.test(line)) {
				return `<small class="preview-subtext">${line.substring(3)}</small>`;
			}

			// Multi-line quote block (>>> captures rest of message - simplified here)
			if (/^&gt;&gt;&gt; /.test(line)) {
				return `<div class="preview-blockquote">${line.substring(12)}</div>`;
			}

			// Single-line quote block
			if (/^&gt; /.test(line)) {
				return `<div class="preview-quote">${line.substring(5)}</div>`;
			}

			// Unordered list items
			if (/^[-*] /.test(line)) {
				return `<div class="preview-list-item"><span class="list-bullet">•</span>${line.substring(2)}</div>`;
			}

			// Ordered list items
			if (/^\d+\. /.test(line)) {
				const match = line.match(/^(\d+)\. (.*)$/);
				if (match) {
					return `<div class="preview-list-item"><span class="list-number">${match[1]}.</span>${match[2]}</div>`;
				}
			}

			return line;
		});

		html = processedLines.join('<br>');

		// Clean up extra <br> after block elements
		html = html.replace(/(<\/h[123]>)<br>/g, '$1');
		html = html.replace(/(<\/div>)<br>/g, '$1');
		html = html.replace(/(<\/pre>)<br>/g, '$1');
		html = html.replace(/(<\/small>)<br>/g, '$1');

		return html;
	}
</script>

<div class="discord-editor">
	<!-- Toolbar -->
	<div class="editor-toolbar">
		<!-- Text formatting -->
		<div class="format-group">
			{#each textFormats as cmd}
				<button
					type="button"
					class="toolbar-btn"
					title="{cmd.label}{cmd.shortcut ? ` (${cmd.shortcut})` : ''}"
					onclick={() => applyFormat(cmd.prefix, cmd.suffix)}
				>
					{cmd.icon}
				</button>
			{/each}
		</div>

		<div class="toolbar-divider"></div>

		<!-- Headers dropdown -->
		<div class="dropdown-container">
			<button type="button" class="toolbar-btn" title="Headings"> H </button>
			<div class="dropdown-menu compact-dropdown">
				{#each headerFormats as cmd}
					<button
						type="button"
						class="dropdown-item"
						onclick={() => applyFormat(cmd.prefix, cmd.suffix, cmd.lineStart)}
					>
						<span class="format-icon">{cmd.icon}</span>
						<span>{cmd.label}</span>
					</button>
				{/each}
			</div>
		</div>

		<!-- Block formatting dropdown -->
		<div class="dropdown-container">
			<button type="button" class="toolbar-btn" title="Blocks & Lists"> ≡ </button>
			<div class="dropdown-menu compact-dropdown">
				{#each blockFormats as cmd}
					<button
						type="button"
						class="dropdown-item"
						onclick={() => applyFormat(cmd.prefix, cmd.suffix, cmd.lineStart)}
					>
						<span class="format-icon">{cmd.icon}</span>
						<span>{cmd.label}</span>
					</button>
				{/each}
			</div>
		</div>

		<!-- Code formatting -->
		<div class="format-group">
			{#each codeFormats as cmd}
				<button
					type="button"
					class="toolbar-btn"
					title={cmd.label}
					onclick={() => applyFormat(cmd.prefix, cmd.suffix)}
				>
					{cmd.icon}
				</button>
			{/each}
		</div>

		<!-- Link -->
		<button
			type="button"
			class="toolbar-btn"
			title="Insert Link"
			onclick={() => applyFormat(linkFormat.prefix, linkFormat.suffix)}
		>
			🔗
		</button>

		<div class="toolbar-divider"></div>

		<!-- Mentions and Variables -->
		<div class="insert-buttons">
			<div class="dropdown-container">
				<button type="button" class="toolbar-btn insert-btn" title="Insert channel mention">
					# Channel
				</button>
				<div class="dropdown-menu channel-dropdown">
					<div class="dropdown-search">
						<input
							type="text"
							placeholder="Search channels..."
							bind:value={channelSearch}
						/>
					</div>
					<div class="dropdown-items">
						{#each toolbarChannels as channel}
							<button
								type="button"
								class="dropdown-item"
								onclick={() => insertChannelMention(channel)}
							>
								<span class="channel-icon">{getChannelIcon(channel.type)}</span>
								<span class="channel-name">{channel.name}</span>
								{#if channel.categoryName}
									<span class="channel-category">{channel.categoryName}</span>
								{/if}
							</button>
						{/each}
						{#if toolbarChannels.length === 0}
							<div class="dropdown-empty">No channels match “{channelSearch}”</div>
						{/if}
					</div>
				</div>
			</div>

			{#if roles && roles.length > 0}
				<div class="dropdown-container">
					<button
						type="button"
						class="toolbar-btn insert-btn"
						title="Insert role mention"
					>
						@ Role
					</button>
					<div class="dropdown-menu role-dropdown">
						<div class="dropdown-search">
							<input
								type="text"
								placeholder="Search roles..."
								bind:value={roleSearch}
							/>
						</div>
						<div class="dropdown-items">
							{#each toolbarRoles as role}
								{@const roleColor = role.color
									? `#${role.color.toString(16).padStart(6, '0')}`
									: '#99aab5'}
								<button
									type="button"
									class="dropdown-item"
									onclick={() => insertRoleMention(role)}
								>
									<span class="role-dot" style="background-color: {roleColor}"
									></span>
									<span class="role-name">{role.name}</span>
								</button>
							{/each}
							{#if toolbarRoles.length === 0}
								<div class="dropdown-empty">No roles match “{roleSearch}”</div>
							{/if}
						</div>
					</div>
				</div>
			{/if}

			<div class="dropdown-container">
				<button
					type="button"
					class="toolbar-btn insert-btn"
					title="Insert template variable"
				>
					{'{}'} Variable
				</button>
				<div class="dropdown-menu variable-dropdown">
					<div class="dropdown-search">
						<input
							type="text"
							placeholder="Search variables..."
							bind:value={variableSearch}
							autocomplete="off"
						/>
					</div>
					<div class="dropdown-items variable-items">
						{#each Object.entries(variableCategories) as [category, vars]}
							<div class="variable-category">
								<div class="variable-category-name">
									<span class="variable-category-icon" aria-hidden="true"
										>{getCategoryIcon(category)}</span
									>
									<span>{getCategoryLabel(category)}</span>
								</div>
								{#each vars as v}
									<button
										type="button"
										class="dropdown-item variable-item"
										onclick={() => insertVariableFromButton(v.key)}
									>
										<span class="variable-item-icon" aria-hidden="true"
											>{getCategoryIcon(category)}</span
										>
										<code>{`{${v.key}}`}</code>
										<span class="variable-desc">{v.desc}</span>
									</button>
								{/each}
							</div>
						{/each}
						{#if Object.keys(variableCategories).length === 0}
							<div class="dropdown-empty">No variables match “{variableSearch}”</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Editor area -->
	<div class="editor-container">
		<textarea
			bind:this={textareaRef}
			bind:value
			{name}
			{required}
			{rows}
			{placeholder}
			class="editor-textarea"
			onkeydown={handleKeydown}
			oninput={handleInput}></textarea>

		<!-- Autocomplete menu for mentions -->
		{#if showMentionMenu && activeItems.length > 0}
			<div class="autocomplete-menu">
				<div class="autocomplete-header">
					{mentionType === 'channel' ? 'Channels' : 'Roles'} matching "{mentionSearch}"
				</div>
				{#each activeItems as item, i}
					<button
						type="button"
						class="autocomplete-item"
						class:highlighted={i === highlightedIndex}
						onclick={() => insertMention(item)}
						onmouseenter={() => (highlightedIndex = i)}
					>
						{#if mentionType === 'channel'}
							<span class="channel-icon">{getChannelIcon(item.type)}</span>
							<span>{item.name}</span>
						{:else}
							{@const roleColor = item.color
								? `#${item.color.toString(16).padStart(6, '0')}`
								: '#99aab5'}
							<span class="role-dot" style="background-color: {roleColor}"></span>
							<span>{item.name}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Preview -->
	{#if showPreview && value}
		<div class="editor-preview">
			<div class="preview-label">Preview</div>
			<div class="preview-content">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderPreview() HTML-escapes & < > before building markup (see escaping near top of the function), so the output is sanitized -->
				{@html renderPreview(value)}
			</div>
		</div>
	{/if}

	<!-- Help text -->
	<div class="editor-help">
		<span
			>Type <kbd>#</kbd> for channels, <kbd>@&</kbd> for roles, <kbd>{'{'}</kbd> for variables</span
		>
		<span class="help-divider">|</span>
		<span
			><kbd>**bold**</kbd> <kbd>*italic*</kbd> <kbd># heading</kbd> <kbd>- list</kbd>
			<kbd>[text](url)</kbd></span
		>
	</div>
</div>

<style>
	.discord-editor {
		display: flex;
		flex-direction: column;
		gap: 0;
		border: 1px solid var(--color-border, #40444b);
		border-radius: 8px;
		background: var(--color-surface, #2f3136);
		overflow: hidden;
	}

	/* Toolbar */
	.editor-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem;
		background: var(--color-surface-raised, #36393f);
		border-bottom: 1px solid var(--color-border, #40444b);
	}

	.format-group {
		display: flex;
		gap: 2px;
	}

	.toolbar-divider {
		width: 1px;
		height: 20px;
		background: var(--color-border, #40444b);
		margin: 0 0.25rem;
	}

	.insert-buttons {
		display: flex;
		gap: 0.5rem;
		margin-left: auto;
	}

	.toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 28px;
		height: 28px;
		padding: 0 0.5rem;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-secondary, #b9bbbe);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.toolbar-btn:hover {
		background: var(--color-surface, #2f3136);
		color: var(--color-text, #fff);
	}

	.insert-btn {
		font-size: 0.75rem;
		gap: 0.25rem;
	}

	/* Dropdown menus */
	.dropdown-container {
		position: relative;
	}

	.dropdown-menu {
		position: absolute;
		top: 100%;
		right: 0;
		z-index: 1000;
		min-width: 220px;
		max-height: 300px;
		margin-top: 4px;
		padding: 0.5rem 0;
		background: var(--color-surface-raised, #36393f);
		border: 1px solid var(--color-border, #40444b);
		border-radius: 8px;
		box-shadow: 0 8px 16px rgba(0, 0, 0, 0.24);
		opacity: 0;
		visibility: hidden;
		transform: translateY(-8px);
		transition: all 0.15s ease;
		overflow-y: auto;
	}

	.dropdown-container:hover .dropdown-menu,
	.dropdown-container:focus-within .dropdown-menu {
		opacity: 1;
		visibility: visible;
		transform: translateY(0);
	}

	.compact-dropdown {
		min-width: 160px;
		left: 0;
		right: auto;
	}

	.compact-dropdown .dropdown-item {
		padding: 0.375rem 0.75rem;
	}

	.format-icon {
		min-width: 24px;
		font-weight: 600;
		font-family: 'Consolas', 'Monaco', monospace;
		color: var(--color-text-secondary, #b9bbbe);
	}

	.dropdown-search {
		padding: 0.5rem;
		border-bottom: 1px solid var(--color-border, #40444b);
	}

	.dropdown-search input {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid var(--color-border, #40444b);
		border-radius: 4px;
		background: var(--color-surface, #2f3136);
		color: var(--color-text, #fff);
		font-size: 0.85rem;
	}

	.dropdown-items {
		display: flex;
		flex-direction: column;
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: none;
		background: transparent;
		color: var(--color-text, #fff);
		font-size: 0.85rem;
		text-align: left;
		cursor: pointer;
		transition: background 0.1s ease;
	}

	.dropdown-item:hover {
		background: var(--color-primary, #5865f2);
	}

	.dropdown-empty {
		padding: 1rem;
		color: var(--color-text-secondary, #b9bbbe);
		text-align: center;
		font-size: 0.85rem;
	}

	.channel-icon {
		color: var(--color-text-secondary, #b9bbbe);
		font-size: 1rem;
	}

	.channel-category {
		margin-left: auto;
		color: var(--color-text-muted, #72767d);
		font-size: 0.75rem;
	}

	.role-dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	/* Variable dropdown */
	.variable-dropdown {
		min-width: 280px;
	}

	.variable-items {
		padding: 0.25rem;
	}

	.variable-category {
		margin-bottom: 0.5rem;
	}

	.variable-category-name {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem 0.25rem;
		color: var(--color-text-secondary, #b9bbbe);
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.variable-category-icon {
		font-size: 0.9rem;
		line-height: 1;
	}

	.variable-item {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		border-radius: 4px;
		flex-wrap: wrap;
	}

	.variable-item-icon {
		font-size: 0.95rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.variable-item code {
		color: var(--color-primary, #5865f2);
		font-size: 0.8rem;
		font-family: 'Consolas', 'Monaco', monospace;
	}

	.variable-desc {
		color: var(--color-text-secondary, #b9bbbe);
		font-size: 0.75rem;
	}

	/* Editor textarea */
	.editor-container {
		position: relative;
	}

	.editor-textarea {
		width: 100%;
		min-height: 100px;
		padding: 0.75rem;
		border: none;
		background: var(--color-surface, #2f3136);
		color: var(--color-text, #fff);
		font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
		font-size: 0.95rem;
		line-height: 1.5;
		resize: vertical;
	}

	.editor-textarea:focus {
		outline: none;
	}

	.editor-textarea::placeholder {
		color: var(--color-text-muted, #72767d);
	}

	/* Autocomplete menu */
	.autocomplete-menu {
		position: absolute;
		bottom: 100%;
		left: 0.5rem;
		right: 0.5rem;
		z-index: 1000;
		max-height: 200px;
		margin-bottom: 4px;
		background: var(--color-surface-raised, #36393f);
		border: 1px solid var(--color-border, #40444b);
		border-radius: 8px;
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.2);
		overflow-y: auto;
	}

	.autocomplete-header {
		padding: 0.5rem 0.75rem;
		color: var(--color-text-secondary, #b9bbbe);
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		border-bottom: 1px solid var(--color-border, #40444b);
	}

	.autocomplete-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: none;
		background: transparent;
		color: var(--color-text, #fff);
		font-size: 0.9rem;
		text-align: left;
		cursor: pointer;
	}

	.autocomplete-item:hover,
	.autocomplete-item.highlighted {
		background: var(--color-primary, #5865f2);
	}

	/* Preview */
	.editor-preview {
		padding: 0.75rem;
		background: var(--color-surface-dim, #292b2f);
		border-top: 1px solid var(--color-border, #40444b);
	}

	.preview-label {
		margin-bottom: 0.5rem;
		color: var(--color-text-secondary, #b9bbbe);
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.preview-content {
		color: var(--color-text, #dcddde);
		font-size: 0.95rem;
		line-height: 1.5;
		word-wrap: break-word;
	}

	/* Preview formatting styles */
	.preview-content :global(strong) {
		font-weight: 700;
	}

	.preview-content :global(em) {
		font-style: italic;
	}

	.preview-content :global(u) {
		text-decoration: underline;
	}

	.preview-content :global(del) {
		text-decoration: line-through;
	}

	.preview-content :global(.preview-code) {
		padding: 0.1rem 0.3rem;
		background: var(--color-surface, #2f3136);
		border-radius: 3px;
		font-family: 'Consolas', 'Monaco', monospace;
		font-size: 0.85em;
	}

	.preview-content :global(.preview-codeblock) {
		display: block;
		margin: 0.5rem 0;
		padding: 0.75rem;
		background: var(--color-surface, #2f3136);
		border-radius: 4px;
		font-family: 'Consolas', 'Monaco', monospace;
		font-size: 0.85em;
		white-space: pre-wrap;
		overflow-x: auto;
	}

	.preview-content :global(.preview-quote) {
		padding-left: 0.75rem;
		border-left: 4px solid var(--color-text-muted, #72767d);
		color: var(--color-text-secondary, #b9bbbe);
	}

	.preview-content :global(.preview-blockquote) {
		padding-left: 0.75rem;
		border-left: 4px solid var(--color-text-muted, #72767d);
		color: var(--color-text-secondary, #b9bbbe);
		margin: 0.25rem 0;
	}

	/* Headers */
	.preview-content :global(.preview-h1) {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0.5rem 0 0.25rem;
		line-height: 1.3;
	}

	.preview-content :global(.preview-h2) {
		font-size: 1.25rem;
		font-weight: 700;
		margin: 0.5rem 0 0.25rem;
		line-height: 1.3;
	}

	.preview-content :global(.preview-h3) {
		font-size: 1.1rem;
		font-weight: 700;
		margin: 0.5rem 0 0.25rem;
		line-height: 1.3;
	}

	/* Subtext */
	.preview-content :global(.preview-subtext) {
		display: block;
		font-size: 0.8rem;
		color: var(--color-text-muted, #72767d);
		margin: 0.25rem 0;
	}

	/* Lists */
	.preview-content :global(.preview-list-item) {
		display: flex;
		gap: 0.5rem;
		margin: 0.125rem 0;
	}

	.preview-content :global(.list-bullet) {
		color: var(--color-text-muted, #72767d);
		user-select: none;
	}

	.preview-content :global(.list-number) {
		color: var(--color-text-muted, #72767d);
		min-width: 1.5rem;
		user-select: none;
	}

	/* Links */
	.preview-content :global(.preview-link) {
		color: #00aff4;
		text-decoration: none;
	}

	.preview-content :global(.preview-link:hover) {
		text-decoration: underline;
	}

	.preview-content :global(.preview-spoiler) {
		padding: 0 0.25rem;
		background: var(--color-text-muted, #72767d);
		border-radius: 3px;
		color: transparent;
		cursor: pointer;
	}

	.preview-content :global(.preview-spoiler:hover) {
		color: var(--color-text, #fff);
		background: var(--color-surface, #2f3136);
	}

	.preview-content :global(.preview-variable) {
		padding: 0.1rem 0.3rem;
		background: rgba(88, 101, 242, 0.2);
		border-radius: 3px;
		color: var(--color-primary, #5865f2);
		font-family: 'Consolas', 'Monaco', monospace;
		font-size: 0.9em;
	}

	.preview-content :global(.preview-channel) {
		padding: 0 0.25rem;
		background: rgba(88, 101, 242, 0.15);
		border-radius: 3px;
		color: #8ab4f8;
		cursor: pointer;
	}

	.preview-content :global(.preview-channel:hover) {
		background: rgba(88, 101, 242, 0.25);
		text-decoration: underline;
	}

	.preview-content :global(.preview-role) {
		padding: 0 0.25rem;
		border-radius: 3px;
		font-weight: 500;
	}

	.preview-content :global(.preview-mention) {
		padding: 0 0.25rem;
		background: rgba(88, 101, 242, 0.3);
		border-radius: 3px;
		color: #dee0fc;
		font-weight: 500;
	}

	/* Help text */
	.editor-help {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-surface-dim, #292b2f);
		border-top: 1px solid var(--color-border, #40444b);
		color: var(--color-text-muted, #72767d);
		font-size: 0.75rem;
	}

	.editor-help kbd {
		display: inline-block;
		padding: 0.1rem 0.3rem;
		background: var(--color-surface, #2f3136);
		border-radius: 3px;
		font-family: 'Consolas', 'Monaco', monospace;
		font-size: 0.85em;
	}

	.help-divider {
		color: var(--color-border, #40444b);
	}

	/* Responsive */
	@media (max-width: 600px) {
		.editor-toolbar {
			flex-direction: column;
			align-items: stretch;
		}

		.insert-buttons {
			justify-content: flex-end;
		}

		.editor-help {
			flex-direction: column;
			align-items: flex-start;
		}

		.help-divider {
			display: none;
		}
	}
</style>
