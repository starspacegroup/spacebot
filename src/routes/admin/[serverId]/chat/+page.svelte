<script>
	import { onMount, tick } from 'svelte';
	import { browser } from '$app/environment';

	let { data } = $props();

	// ─── Chat session management ───
	const STORAGE_KEY = $derived(`spacebot_chats_${data.serverId}`);

	/** @typedef {{ id: string, title: string, createdAt: string, messages: any[] }} ChatSession */

	let sessions = $state(/** @type {ChatSession[]} */ ([]));
	let activeSessionId = $state(/** @type {string|null} */ (null));
	let sidebarOpen = $state(false);

	// DM history
	let dmMessages = $state([]);
	let dmLoaded = $state(false);
	let dmLoading = $state(false);
	let dmHasMore = $state(false);
	let dmLoadingMore = $state(false);
	let showDMHistory = $state(false);

	// Chat state
	let input = $state('');
	let sending = $state(false);
	let chatContainer = $state(null);
	let inputEl = $state(null);
	let editingSessionId = $state(null);
	let editTitle = $state('');
	let confirmDeleteId = $state(null);

	// ─── Persistence helpers ───
	function saveSessions() {
		if (!browser) return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
		} catch { /* quota exceeded – silently ignore */ }
	}

	function loadSessions() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				sessions = JSON.parse(raw);
			}
		} catch {
			sessions = [];
		}
	}

	// Current active session
	const activeSession = $derived(sessions.find(s => s.id === activeSessionId) || null);
	const messages = $derived(activeSession?.messages || []);

	// ─── Session CRUD ───
	function createSession() {
		const id = crypto.randomUUID();
		const session = {
			id,
			title: 'New Chat',
			createdAt: new Date().toISOString(),
			messages: [],
		};
		sessions = [session, ...sessions];
		activeSessionId = id;
		showDMHistory = false;
		sidebarOpen = false;
		saveSessions();
		inputEl?.focus();
	}

	function switchSession(id) {
		activeSessionId = id;
		showDMHistory = false;
		sidebarOpen = false;
		scrollToBottom(false);
		inputEl?.focus();
	}

	function deleteSession(id) {
		sessions = sessions.filter(s => s.id !== id);
		if (activeSessionId === id) {
			activeSessionId = sessions[0]?.id || null;
		}
		confirmDeleteId = null;
		saveSessions();
	}

	function renameSession(id, newTitle) {
		sessions = sessions.map(s => s.id === id ? { ...s, title: newTitle.trim() || s.title } : s);
		editingSessionId = null;
		editTitle = '';
		saveSessions();
	}

	function startRename(id, currentTitle) {
		editingSessionId = id;
		editTitle = currentTitle;
	}

	// Auto-title from first user message
	function autoTitle(sessionId, firstMessage) {
		const s = sessions.find(s => s.id === sessionId);
		if (s && s.title === 'New Chat' && firstMessage) {
			const title = firstMessage.length > 40 ? firstMessage.substring(0, 40) + '…' : firstMessage;
			sessions = sessions.map(s => s.id === sessionId ? { ...s, title } : s);
		}
	}

	// Helper: append a message to a session by ID (immutable update)
	function appendMessage(sessionId, msg) {
		sessions = sessions.map(s =>
			s.id === sessionId ? { ...s, messages: [...s.messages, msg] } : s
		);
	}

	// Helper: remove a message from a session by message ID (immutable update)
	function removeMessage(sessionId, msgId) {
		sessions = sessions.map(s =>
			s.id === sessionId ? { ...s, messages: s.messages.filter(m => m.id !== msgId) } : s
		);
	}

	// Helper: get messages for a session
	function getSessionMessages(sessionId) {
		const s = sessions.find(s => s.id === sessionId);
		return s?.messages || [];
	}

	// ─── DM History ───
	async function loadDMHistory() {
		if (dmLoaded || dmLoading) return;
		dmLoading = true;
		showDMHistory = true;
		activeSessionId = null;
		sidebarOpen = false;

		try {
			const res = await fetch('/api/chat?limit=50');
			if (res.ok) {
				const result = await res.json();
				dmMessages = result.messages || [];
				dmHasMore = result.hasMore || false;
			}
		} catch (err) {
			console.error('Failed to load DM history:', err);
		} finally {
			dmLoading = false;
			dmLoaded = true;
			scrollToBottom(false);
		}
	}

	async function loadMoreDMs() {
		if (dmLoadingMore || !dmHasMore || dmMessages.length === 0) return;
		dmLoadingMore = true;

		const oldestId = dmMessages[0]?.id;
		if (!oldestId) { dmLoadingMore = false; return; }

		try {
			const res = await fetch(`/api/chat?limit=50&before=${oldestId}`);
			if (res.ok) {
				const result = await res.json();
				const older = result.messages || [];
				dmHasMore = result.hasMore || false;
				if (older.length > 0) {
					const prevHeight = chatContainer?.scrollHeight || 0;
					dmMessages = [...older, ...dmMessages];
					await tick();
					if (chatContainer) {
						chatContainer.scrollTop = chatContainer.scrollHeight - prevHeight;
					}
				}
			}
		} catch (err) {
			console.error('Failed to load more DMs:', err);
		} finally {
			dmLoadingMore = false;
		}
	}

	function viewDMHistory() {
		loadDMHistory();
	}

	// ─── Scroll ───
	async function scrollToBottom(smooth = true) {
		await tick();
		if (chatContainer) {
			chatContainer.scrollTo({
				top: chatContainer.scrollHeight,
				behavior: smooth ? 'smooth' : 'instant',
			});
		}
	}

	// ─── Send message ───
	async function sendMessage(overrideText) {
		const text = (overrideText || input).trim();
		if (!text || sending) return;

		// Ensure we have an active session
		if (!activeSession) {
			createSession();
			await tick();
		}

		const sid = activeSessionId;
		if (!sid || !sessions.find(s => s.id === sid)) return;

		// Add user message
		const userMsg = {
			id: 'msg-' + Date.now(),
			role: 'user',
			content: text,
			timestamp: new Date().toISOString(),
			author: {
				id: data.user.id,
				username: data.user.username,
				globalName: data.user.globalName,
				avatar: data.user.avatar,
				bot: false,
			},
		};

		appendMessage(sid, userMsg);
		autoTitle(sid, text);
		input = '';
		sending = true;
		showDMHistory = false;
		scrollToBottom();

		// Build history for AI context
		const history = getSessionMessages(sid)
			.filter(m => !m.typing)
			.slice(-10)
			.map(m => ({ role: m.role, content: m.content }));

		// Add typing indicator
		const typingMsg = { id: 'typing', role: 'assistant', content: '', typing: true, timestamp: new Date().toISOString() };
		appendMessage(sid, typingMsg);
		scrollToBottom();

		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: text,
					history,
					selectedGuildId: data.serverId,
				}),
			});

			// Remove typing
			removeMessage(sid, 'typing');

			if (res.ok) {
				const result = await res.json();
				appendMessage(sid, {
					id: 'msg-' + Date.now(),
					role: 'assistant',
					content: result.response,
					timestamp: new Date().toISOString(),
					toolsUsed: result.toolsUsed,
					author: { bot: true, username: 'SpaceBot' },
				});
			} else {
				const err = await res.json().catch(() => ({}));
				appendMessage(sid, {
					id: 'err-' + Date.now(),
					role: 'assistant',
					content: `Sorry, something went wrong: ${err.error || 'Unknown error'}`,
					timestamp: new Date().toISOString(),
					error: true,
					author: { bot: true, username: 'SpaceBot' },
				});
			}
		} catch {
			removeMessage(sid, 'typing');
			appendMessage(sid, {
				id: 'err-' + Date.now(),
				role: 'assistant',
				content: 'Sorry, I could not reach the server. Please try again.',
				timestamp: new Date().toISOString(),
				error: true,
				author: { bot: true, username: 'SpaceBot' },
			});
		} finally {
			sending = false;
			saveSessions();
			scrollToBottom();
			inputEl?.focus();
		}
	}

	function handleKeydown(e) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	}

	// ─── Helpers ───
	function formatTime(timestamp) {
		if (!timestamp) return '';
		return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function formatDate(timestamp) {
		if (!timestamp) return '';
		const d = new Date(timestamp);
		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		if (d.toDateString() === today.toDateString()) return 'Today';
		if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
		return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
	}

	function formatSessionDate(isoString) {
		if (!isoString) return '';
		const d = new Date(isoString);
		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		if (d.toDateString() === today.toDateString()) return formatTime(isoString);
		if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
		return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
	}

	function groupByDate(msgs) {
		const groups = [];
		let currentDate = null;
		for (const msg of msgs) {
			const date = formatDate(msg.timestamp);
			if (date !== currentDate) {
				currentDate = date;
				groups.push({ date, messages: [] });
			}
			groups[groups.length - 1].messages.push(msg);
		}
		return groups;
	}

	const groupedMessages = $derived(groupByDate(showDMHistory ? dmMessages : messages));

	const displayMessages = $derived(showDMHistory ? dmMessages : messages);
	const sessionCount = $derived(sessions.length);
	const messageCount = $derived(displayMessages.length);

	// ─── Init ───
	onMount(() => {
		loadSessions();
		// auto-select most recent or create new
		if (sessions.length > 0) {
			activeSessionId = sessions[0].id;
		}
		inputEl?.focus();
	});
</script>

<svelte:head>
	<title>AI Chat - {data.guild?.name || 'Server'} | SpaceBot</title>
</svelte:head>

<div class="chat-layout">
	<!-- Sidebar overlay (mobile) -->
	{#if sidebarOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="sidebar-overlay" onclick={() => sidebarOpen = false}></div>
	{/if}

	<!-- Sidebar -->
	<aside class="sidebar" class:open={sidebarOpen}>
		<div class="sidebar-header">
			<button class="new-chat-btn" onclick={createSession}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
				New Chat
			</button>
			<button class="sidebar-close" onclick={() => sidebarOpen = false} aria-label="Close sidebar">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
			</button>
		</div>

		<div class="sidebar-sessions">
			<!-- DM History link -->
			<button
				class="session-item dm-history-item"
				class:active={showDMHistory}
				onclick={viewDMHistory}
			>
				<span class="session-icon">💬</span>
				<div class="session-info">
					<span class="session-title">Discord DM History</span>
					<span class="session-sub">Imported from Discord</span>
				</div>
			</button>

			{#if sessions.length > 0}
				<div class="sidebar-divider">
					<span>Chats</span>
				</div>
			{/if}

			{#each sessions as session (session.id)}
				<div class="session-item-wrapper">
					{#if editingSessionId === session.id}
						<form class="rename-form" onsubmit={(e) => { e.preventDefault(); renameSession(session.id, editTitle); }}>
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="rename-input"
								type="text"
								bind:value={editTitle}
								onblur={() => renameSession(session.id, editTitle)}
								autofocus
							/>
						</form>
					{:else}
						<button
							class="session-item"
							class:active={activeSessionId === session.id && !showDMHistory}
							onclick={() => switchSession(session.id)}
						>
							<div class="session-info">
								<span class="session-title">{session.title}</span>
								<span class="session-sub">{session.messages.length} messages · {formatSessionDate(session.createdAt)}</span>
							</div>
						</button>
						<div class="session-actions">
							<button class="session-action-btn" onclick={() => startRename(session.id, session.title)} aria-label="Rename" title="Rename">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
							</button>
							{#if confirmDeleteId === session.id}
								<button class="session-action-btn danger" onclick={() => deleteSession(session.id)} aria-label="Confirm delete" title="Confirm delete">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
								</button>
							{:else}
								<button class="session-action-btn" onclick={() => confirmDeleteId = session.id} aria-label="Delete" title="Delete">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6L18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V3h6v3"/></svg>
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<div class="sidebar-footer">
			<a href="/admin/{data.serverId}" class="sidebar-back">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
				Back to Dashboard
			</a>
		</div>
	</aside>

	<!-- Main chat area -->
	<div class="chat-main">
		<!-- Chat header -->
		<header class="chat-header">
			<button class="menu-btn" onclick={() => sidebarOpen = true} aria-label="Open chat menu">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
			</button>
			<div class="chat-header-info">
				{#if showDMHistory}
					<h1>💬 Discord DM History</h1>
					<p class="chat-header-sub">Read-only timeline from Discord</p>
				{:else if activeSession}
					<h1><img src="/logo.webp" alt="" class="inline-logo" /> {activeSession.title}</h1>
					<p class="chat-header-sub">
						{#if data.guild?.name}
							Server: <strong>{data.guild.name}</strong>
						{:else}
							SpaceBot Assistant
						{/if}
					</p>
				{:else}
					<h1><img src="/logo.webp" alt="" class="inline-logo" /> AI Assistant</h1>
					<p class="chat-header-sub">Start a chat or open DM history</p>
				{/if}
			</div>
			<button class="new-chat-header-btn" onclick={createSession} aria-label="New chat" title="New chat">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
			</button>
		</header>

		<div class="chat-meta-bar" aria-label="Chat context">
			<span class="meta-chip">{showDMHistory ? 'DM History' : 'Live Chat'}</span>
			<span class="meta-chip">{messageCount} messages</span>
			<span class="meta-chip">{sessionCount} chats</span>
			<span class="meta-note">Verify critical actions before applying them.</span>
		</div>

		<!-- Chat messages -->
		<div class="chat-container" bind:this={chatContainer}>
				{#if !data.aiEnabled && !showDMHistory}
					<div class="chat-disabled">
						<div class="chat-disabled-icon"><img src="/logo.webp" alt="SpaceBot" class="bot-logo-lg" /></div>
						<h2>AI Chat Not Available</h2>
						<p>This server has AI disabled. You can still browse Discord DM history.</p>
					</div>
				{:else if showDMHistory && dmLoading}
					<div class="chat-loading">
						<div class="typing-dots"><span></span><span></span><span></span></div>
						<p>Loading DM history...</p>
					</div>
				{:else if showDMHistory}
					{#if dmHasMore}
						<div class="load-more">
							<button class="btn btn-secondary btn-sm" onclick={loadMoreDMs} disabled={dmLoadingMore}>
								{dmLoadingMore ? 'Loading...' : 'Load older messages'}
							</button>
						</div>
					{/if}
					{#if dmMessages.length === 0}
						<div class="chat-empty">
							<div class="chat-empty-icon">💬</div>
							<h3>No DM History</h3>
							<p>You haven't chatted with SpaceBot via Discord DM yet. You can DM the bot directly on Discord, or start a new chat here.</p>
							<button class="suggestion" onclick={createSession}>✨ Start a new chat</button>
						</div>
					{:else}
						{#each groupedMessages as group}
							<div class="date-divider"><span>{group.date}</span></div>
							{#each group.messages as msg (msg.id)}
								{@render messageBlock(msg)}
							{/each}
						{/each}
					{/if}
				{:else if !activeSession}
					<!-- No session selected -->
					<div class="chat-empty">
						<div class="chat-empty-icon"><img src="/logo.webp" alt="SpaceBot" class="bot-logo-lg" /></div>
						<h3>SpaceBot AI Assistant</h3>
						<p>Ask about stats, automations, logs, and settings.</p>
						<div class="chat-suggestions">
							<button class="suggestion" onclick={() => { createSession(); tick().then(() => sendMessage('How active has my server been this week?')); }}>📊 Server activity</button>
							<button class="suggestion" onclick={() => { createSession(); tick().then(() => sendMessage('List my automations')); }}>⚡ Automations</button>
							<button class="suggestion" onclick={() => { createSession(); tick().then(() => sendMessage('Who are the most active members?')); }}>👥 Active members</button>
							<button class="suggestion" onclick={() => { createSession(); tick().then(() => sendMessage('Show server stats')); }}>📈 Stats</button>
						</div>
					</div>
				{:else if messages.length === 0}
					<div class="chat-empty">
						<div class="chat-empty-icon">💬</div>
						<h3>Start a conversation</h3>
						<p>Try one of these quick prompts.</p>
						<div class="chat-suggestions">
							<button class="suggestion" onclick={() => sendMessage('How active has my server been this week?')}>📊 Server activity this week</button>
							<button class="suggestion" onclick={() => sendMessage('List my automations')}>⚡ List automations</button>
							<button class="suggestion" onclick={() => sendMessage('Who are the most active members?')}>👥 Most active members</button>
							<button class="suggestion" onclick={() => sendMessage('Show my server stats')}>📈 Server stats</button>
						</div>
					</div>
				{:else}
					{#each groupedMessages as group}
						<div class="date-divider"><span>{group.date}</span></div>
						{#each group.messages as msg (msg.id)}
							{@render messageBlock(msg)}
						{/each}
					{/each}
				{/if}
		</div>

		<!-- Input area -->
		{#if !showDMHistory}
			<div class="chat-input-area">
				<div class="chat-input-wrapper">
					<textarea
						bind:this={inputEl}
						bind:value={input}
						onkeydown={handleKeydown}
						placeholder={data.aiEnabled ? (activeSession ? 'Type a message...' : 'Type to start a new chat...') : 'AI is disabled for this server'}
						rows="1"
						disabled={sending || !data.aiEnabled}
						class="chat-input"
					></textarea>
					<button
						class="send-btn"
						onclick={() => sendMessage()}
						disabled={sending || !input.trim() || !data.aiEnabled}
						aria-label="Send message"
					>
						{#if sending}
							<svg class="send-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/><animate attributeName="stroke-dashoffset" values="32;0;32" dur="1.5s" repeatCount="indefinite"/></circle></svg>
						{:else}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
						{/if}
					</button>
				</div>
				<p class="chat-disclaimer">AI can be wrong. Confirm important changes.</p>
			</div>
		{/if}
	</div>
</div>

{#snippet messageBlock(msg)}
	<div class="message {msg.role}" class:error={msg.error}>
		<div class="message-avatar">
			{#if msg.role === 'assistant'}
				<img src="/logo.webp" alt="SpaceBot" class="avatar-img" />
			{:else if msg.author?.avatar}
				<img
					src="https://cdn.discordapp.com/avatars/{msg.author.id}/{msg.author.avatar}.png?size=64"
					alt={msg.author?.username}
					class="avatar-img"
				/>
			{:else}
				<div class="avatar-fallback">{(msg.author?.username || 'U').charAt(0).toUpperCase()}</div>
			{/if}
		</div>
		<div class="message-body">
			<div class="message-meta">
				<span class="message-author">
					{msg.role === 'assistant' ? 'SpaceBot' : (msg.author?.globalName || msg.author?.username || 'You')}
				</span>
				{#if msg.timestamp}
					<span class="message-time">{formatTime(msg.timestamp)}</span>
				{/if}
			</div>
			{#if msg.typing}
				<div class="typing-dots"><span></span><span></span><span></span></div>
			{:else}
				<div class="message-content">{msg.content}</div>
			{/if}
			{#if msg.toolsUsed?.length}
				<div class="tools-used">🔧 Used: {msg.toolsUsed.join(', ')}</div>
			{/if}
		</div>
	</div>
{/snippet}

<style>
	/* ─── Layout ─── */
	.chat-layout {
		display: flex;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		position: relative;
	}

	/* ─── Sidebar ─── */
	.sidebar {
		width: 280px;
		min-width: 280px;
		background: var(--color-surface);
		border-right: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		border-bottom: 1px solid var(--color-border);
	}

	.sidebar-close {
		display: none;
		background: none;
		border: none;
		color: var(--color-text-secondary);
		cursor: pointer;
		padding: 0.35rem;
		border-radius: var(--radius-md, 0.375rem);
	}

	.sidebar-close:hover {
		color: var(--color-text);
		background: var(--color-border);
	}

	.new-chat-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		border: none;
		border-radius: var(--radius-md, 0.375rem);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.new-chat-btn:hover { opacity: 0.9; }

	.sidebar-sessions {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem;
	}

	.sidebar-divider {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 0.5rem 0.35rem;
	}

	.sidebar-divider span {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.sidebar-divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--color-border);
	}

	.session-item-wrapper {
		display: flex;
		align-items: center;
		border-radius: var(--radius-md, 0.375rem);
		transition: background 0.1s;
	}

	.session-item-wrapper:hover {
		background: var(--color-border);
	}

	.session-item-wrapper:hover .session-actions {
		opacity: 1;
	}

	.session-item {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0.65rem;
		background: none;
		border: none;
		border-radius: var(--radius-md, 0.375rem);
		cursor: pointer;
		text-align: left;
		color: var(--color-text);
		transition: background 0.1s;
		min-width: 0;
	}

	.session-item.active {
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
	}

	.session-item.active .session-sub {
		color: rgba(255,255,255,0.7);
	}

	.session-icon {
		font-size: 1.1rem;
		flex-shrink: 0;
	}

	.session-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.session-title {
		font-size: 0.85rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-sub {
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dm-history-item {
		border-bottom: 1px solid var(--color-border);
		border-radius: 0;
		margin-bottom: 0.25rem;
	}

	.session-actions {
		display: flex;
		gap: 2px;
		padding-right: 0.35rem;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.session-action-btn {
		background: none;
		border: none;
		color: var(--color-text-secondary);
		cursor: pointer;
		padding: 0.3rem;
		border-radius: var(--radius-sm, 0.25rem);
		display: flex;
		align-items: center;
	}

	.session-action-btn:hover {
		color: var(--color-text);
		background: var(--color-surface);
	}

	.session-action-btn.danger {
		color: var(--color-error, #ef4444);
	}

	.rename-form {
		flex: 1;
		padding: 0.3rem;
	}

	.rename-input {
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-sm, 0.25rem);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.85rem;
		outline: none;
	}

	.sidebar-footer {
		padding: 0.75rem;
		border-top: 1px solid var(--color-border);
	}

	.sidebar-back {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: 0.8rem;
		padding: 0.4rem 0.5rem;
		border-radius: var(--radius-md, 0.375rem);
		transition: all 0.1s;
	}

	.sidebar-back:hover {
		color: var(--color-text);
		background: var(--color-border);
	}

	.sidebar-overlay {
		display: none;
	}

	/* ─── Main chat ─── */
	.chat-main {
		flex: 1;
		display: grid;
		grid-template-rows: auto auto minmax(0, 1fr) auto;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	/* Chat header */
	.chat-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 1rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface);
		flex-shrink: 0;
		min-height: 48px;
		max-height: 72px;
		overflow: hidden;
	}

	.chat-meta-bar {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg, var(--color-surface));
		overflow-x: auto;
		white-space: nowrap;
	}

	.meta-chip {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.5rem;
		border-radius: var(--radius-full, 999px);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
	}

	.meta-note {
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		margin-left: 0.2rem;
	}

	.menu-btn {
		display: none;
		background: none;
		border: none;
		color: var(--color-text-secondary);
		cursor: pointer;
		padding: 0.35rem;
		border-radius: var(--radius-md, 0.375rem);
	}

	.menu-btn:hover {
		color: var(--color-text);
		background: var(--color-border);
	}

	.chat-header-info {
		flex: 1;
		min-width: 0;
	}

	.chat-header-info h1 {
		font-size: 16px;
		margin: 0;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		line-height: 1.2;
	}

	.chat-header-sub {
		font-size: 12px;
		color: var(--color-text-secondary);
		margin: 0.1rem 0 0;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.new-chat-header-btn {
		background: none;
		border: 1px solid var(--color-border);
		color: var(--color-text-secondary);
		cursor: pointer;
		padding: 0.4rem;
		border-radius: var(--radius-md, 0.375rem);
		display: flex;
		align-items: center;
		transition: all 0.1s;
	}

	.new-chat-header-btn:hover {
		color: var(--color-primary);
		border-color: var(--color-primary);
	}

	/* Chat disabled */
	.chat-disabled {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex: 1;
		text-align: center;
		padding: 2rem;
		color: var(--color-text-secondary);
	}

	.chat-disabled-icon { font-size: 3rem; margin-bottom: 1rem; }
	.chat-disabled h2 { color: var(--color-text); margin-bottom: 0.5rem; }

	/* Chat container */
	.chat-container {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	/* Loading */
	.chat-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex: 1;
		gap: 0.75rem;
		color: var(--color-text-secondary);
	}

	/* Load more */
	.load-more {
		text-align: center;
		padding: 0.5rem;
		margin-bottom: 0.5rem;
	}

	/* Empty state */
	.chat-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex: 1;
		text-align: center;
		padding: 1.5rem;
	}

	.chat-empty-icon { font-size: 2.5rem; margin-bottom: 0.6rem; }
	.chat-empty h3 { color: var(--color-text); margin-bottom: 0.4rem; font-size: 1.1rem; }
	.chat-empty p {
		color: var(--color-text-secondary);
		max-width: 400px;
		line-height: 1.5;
		margin-bottom: 0.9rem;
		font-size: 0.9rem;
	}

	.chat-suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
	}

	.suggestion {
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md, 0.5rem);
		padding: 0.5rem 0.85rem;
		font-size: 0.8rem;
		color: var(--color-text);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.suggestion:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	/* Date divider */
	.date-divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 0.75rem 0 0.35rem;
	}

	.date-divider::before,
	.date-divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--color-border);
	}

	.date-divider span {
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
	}

	/* Messages */
	.message {
		display: flex;
		gap: 0.65rem;
		padding: 0.45rem 0;
	}

	.message-avatar {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
	}

	.avatar-bot {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--color-primary);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.95rem;
	}

	.avatar-img {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		object-fit: cover;
	}

	.avatar-fallback {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--color-text-secondary);
		color: var(--color-surface);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.8rem;
	}

	.message-body {
		flex: 1;
		min-width: 0;
	}

	.message-meta {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		margin-bottom: 0.1rem;
	}

	.message-author {
		font-weight: 600;
		font-size: 0.85rem;
		color: var(--color-text);
	}

	.message.assistant .message-author {
		color: var(--color-primary);
	}

	.message-time {
		font-size: 0.65rem;
		color: var(--color-text-secondary);
	}

	.message-content {
		font-size: 0.9rem;
		line-height: 1.55;
		color: var(--color-text);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.message.error .message-content {
		color: var(--color-error, #ef4444);
	}

	.tools-used {
		margin-top: 0.25rem;
		font-size: 0.7rem;
		color: var(--color-text-secondary);
	}

	/* Typing indicator */
	.typing-dots {
		display: inline-flex;
		gap: 4px;
		padding: 0.3rem 0;
	}

	.typing-dots span {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-text-secondary);
		animation: typingBounce 1.4s infinite ease-in-out;
	}

	.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
	.typing-dots span:nth-child(3) { animation-delay: 0.4s; }

	@keyframes typingBounce {
		0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
		30% { transform: translateY(-5px); opacity: 1; }
	}

	/* Input area */
	.chat-input-area {
		position: sticky;
		bottom: 0;
		z-index: 20;
		border-top: 1px solid var(--color-border);
		padding: 0.65rem 1rem calc(0.65rem + env(safe-area-inset-bottom));
		background: var(--color-surface);
		flex-shrink: 0;
	}

	.chat-input-wrapper {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		background: var(--color-bg, var(--color-surface));
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg, 0.75rem);
		padding: 0.45rem 0.65rem;
		transition: border-color 0.15s ease;
	}

	.chat-input-wrapper:focus-within {
		border-color: var(--color-primary);
	}

	.chat-input {
		flex: 1;
		border: none;
		background: none;
		color: var(--color-text);
		font-size: 14px;
		font-family: inherit;
		resize: none;
		outline: none;
		padding: 0.2rem 0;
		min-height: 1.4em;
		max-height: 84px;
		line-height: 1.4;
	}

	.chat-input::placeholder {
		color: var(--color-text-secondary);
	}

	.send-btn {
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		border: none;
		border-radius: 50%;
		width: 30px;
		height: 30px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		flex-shrink: 0;
		transition: opacity 0.15s ease;
	}

	.send-btn:disabled { opacity: 0.35; cursor: not-allowed; }
	.send-btn:not(:disabled):hover { opacity: 0.85; }

	.chat-disclaimer {
		text-align: center;
		font-size: 11px;
		color: var(--color-text-light);
		margin: 0.3rem 0 0;
	}

	/* Keep composer visible under oversized fonts / short viewports */
	@media (max-height: 900px) {
		.chat-meta-bar {
			display: none;
		}

		.chat-header-sub {
			display: none;
		}

		.chat-header {
			padding: 0.45rem 0.75rem;
			min-height: 44px;
		}

		.chat-container {
			padding: 0.5rem 0.75rem;
		}

		.chat-input-area {
			padding: 0.45rem 0.75rem calc(0.45rem + env(safe-area-inset-bottom));
		}

		.chat-disclaimer {
			display: none;
		}
	}

	@media (max-height: 700px) {
		.sidebar {
			display: none;
		}

		.sidebar-overlay {
			display: none;
		}

		.menu-btn {
			display: none;
		}

		.new-chat-header-btn {
			padding: 0.3rem;
		}

		.chat-header-info h1 {
			font-size: 14px;
		}
	}

	/* ─── Mobile: < 768px ─── */
	@media (max-width: 768px) {
		.chat-layout {
			flex: 1;
			min-height: 0;
		}

		.sidebar {
			position: fixed;
			top: 0;
			left: 0;
			bottom: 0;
			z-index: 100;
			width: 85vw;
			max-width: 320px;
			transform: translateX(-100%);
			transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
			box-shadow: none;
		}

		.sidebar.open {
			transform: translateX(0);
			box-shadow: var(--shadow-lg, 0 10px 40px rgba(0,0,0,0.3));
		}

		.sidebar-close {
			display: flex;
		}

		.sidebar-overlay {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 99;
			background: rgba(0, 0, 0, 0.45);
			-webkit-backdrop-filter: blur(2px);
			backdrop-filter: blur(2px);
		}

		.menu-btn {
			display: flex;
		}

		.session-actions {
			opacity: 1;
		}

		.chat-suggestions {
			flex-direction: column;
			width: 100%;
			max-width: 300px;
		}

		.chat-meta-bar {
			padding: 0.45rem 0.75rem;
		}

		.meta-note {
			display: none;
		}

		.suggestion {
			width: 100%;
		}
	}

	/* ─── Tablet: 769px – 1024px ─── */
	@media (min-width: 769px) and (max-width: 1024px) {
		.sidebar {
			width: 240px;
			min-width: 240px;
		}
	}

	/* ─── Desktop: > 1024px ─── */
	@media (min-width: 1025px) {
		.chat-container {
			padding: 1rem 1.5rem;
		}

		.chat-input-area {
			padding: 0.75rem 1.5rem calc(0.75rem + env(safe-area-inset-bottom));
		}
	}

	/* Bot logo replacements */
	.inline-logo {
		height: 1.2em;
		width: auto;
		vertical-align: middle;
		margin-right: 0.15em;
		border-radius: 4px;
	}

	.bot-logo-lg {
		height: 3rem;
		width: auto;
		border-radius: 8px;
	}
</style>
