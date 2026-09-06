<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { toast } from '$lib/toast.svelte.js';

	let { data, form } = $props();

	let editing = $state(null);
	let channels = $state([]);
	let roles = $state([]);

	const categories = $derived(channels.filter((c) => c.type === 'category'));
	const voiceChannels = $derived(channels.filter((c) => c.type === 'voice'));

	/** A blank preset with the same defaults the schema uses. */
	function blankPreset() {
		return {
			id: null,
			name: '',
			enabled: true,
			channel_type: data.channelTypes.voice,
			parent_id: '',
			name_pattern: "{user.name}'s room",
			default_user_limit: '',
			lobby_channel_id: '',
			allow_role_ids: [],
			deny_role_ids: [],
			lifetime_mode: 'idle',
			ttl_minutes: 120,
			idle_minutes: 15,
			grace_minutes: 5,
			extend_minutes: 30,
			max_extensions: 2,
			max_per_user: 1,
			max_per_guild: 25,
			max_renames: 2,
			owner_can: ['rename', 'invite', 'kick', 'lock', 'limit', 'extend', 'delete'],
			owner_allow: ['VIEW_CHANNEL', 'CONNECT'],
			everyone_deny: ['VIEW_CHANNEL', 'CONNECT'],
		};
	}

	function startCreate() {
		editing = blankPreset();
	}

	function startEdit(preset) {
		editing = {
			...blankPreset(),
			...preset,
			parent_id: preset.parent_id || '',
			lobby_channel_id: preset.lobby_channel_id || '',
			default_user_limit: preset.default_user_limit ?? '',
		};
	}

	function toggle(list, value) {
		return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
	}

	function roomsFor(presetId) {
		return data.rooms.filter((room) => room.preset_id === presetId).length;
	}

	function channelName(channelId) {
		return channels.find((c) => c.id === channelId)?.name || channelId;
	}

	onMount(async () => {
		try {
			const [channelRes, roleRes] = await Promise.all([
				fetch(`/api/discord/guilds/${data.serverId}/channels`),
				fetch(`/api/discord/guilds/${data.serverId}/roles`),
			]);
			if (channelRes.ok) channels = (await channelRes.json()).channels || [];
			if (roleRes.ok) roles = (await roleRes.json()).roles || [];
		} catch {
			// Pickers fall back to plain id entry; the page still works.
		}
	});

	$effect(() => {
		if (form?.message) {
			toast[form.success ? 'success' : 'error'](form.message);
			if (form.success) editing = null;
		}
	});
</script>

<svelte:head>
	<title>Rooms · {data.guild?.name || 'Server'}</title>
</svelte:head>

<div class="rooms-page">
	<header class="page-header">
		<a href="/admin/{data.serverId}" class="back-link">← Back to dashboard</a>
		<h1>🚪 Member Rooms</h1>
		<p class="page-desc">
			Let members make their own channels with <code>/room create</code>, or by joining a
			lobby. A preset decides who may make one, what they can do to it, and when it closes.
		</p>
	</header>

	<section class="presets-section">
		<div class="section-header">
			<h2>Presets</h2>
			<button class="btn btn-primary" onclick={startCreate}>+ New preset</button>
		</div>

		{#if data.presets.length === 0}
			<div class="empty-state">
				<span class="empty-icon">🚪</span>
				<p>No room presets yet.</p>
				<span class="empty-hint">
					Add one, then enable the <code>/room</code> command for this server.
				</span>
			</div>
		{:else}
			<div class="preset-list">
				{#each data.presets as preset (preset.id)}
					<div class="preset-card" class:disabled={!preset.enabled}>
						<div class="preset-head">
							<h3>{preset.name}</h3>
							<span class="badge">
								{preset.channel_type === data.channelTypes.voice ? 'Voice' : 'Text'}
							</span>
							<span class="badge">{preset.lifetime_mode}</span>
							{#if !preset.enabled}<span class="badge badge-off">Disabled</span>{/if}
						</div>

						<p class="preset-meta">
							{preset.name_pattern}
							· {roomsFor(preset.id)} open · max {preset.max_per_user} per member
							{#if preset.lobby_channel_id}
								· lobby: {channelName(preset.lobby_channel_id)}
							{/if}
						</p>

						<p class="preset-meta">
							{#if preset.allow_role_ids.length === 0}
								Anyone who can use <code>/room</code> may create one.
							{:else}
								Restricted to {preset.allow_role_ids.length} role(s).
							{/if}
						</p>

						<div class="preset-actions">
							<button class="btn btn-small" onclick={() => startEdit(preset)}>
								Edit
							</button>
							<form
								method="POST"
								action="?/deletePreset"
								use:enhance
								class="inline-form"
							>
								<input type="hidden" name="presetId" value={preset.id} />
								<button class="btn btn-small btn-danger" type="submit">
									Delete
								</button>
							</form>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if editing}
		<section class="editor">
			<h2>{editing.id ? `Edit “${editing.name}”` : 'New preset'}</h2>

			<form
				method="POST"
				action={editing.id ? '?/updatePreset' : '?/createPreset'}
				use:enhance
			>
				{#if editing.id}
					<input type="hidden" name="presetId" value={editing.id} />
				{/if}

				<div class="grid">
					<label class="field">
						<span>Name</span>
						<input name="name" bind:value={editing.name} required />
					</label>

					<label class="field">
						<span>Channel type</span>
						<select name="channel_type" bind:value={editing.channel_type}>
							<option value={data.channelTypes.voice}>Voice</option>
							<option value={data.channelTypes.text}>Text</option>
						</select>
					</label>

					<label class="field">
						<span>Category</span>
						<select name="parent_id" bind:value={editing.parent_id}>
							<option value="">(none)</option>
							{#each categories as category (category.id)}
								<option value={category.id}>{category.name}</option>
							{/each}
						</select>
					</label>

					<label class="field">
						<span>Name pattern</span>
						<input name="name_pattern" bind:value={editing.name_pattern} />
						<small>Variables like <code>{'{user.name}'}</code> are expanded.</small>
					</label>

					<label class="field">
						<span>Join-to-create lobby</span>
						<select name="lobby_channel_id" bind:value={editing.lobby_channel_id}>
							<option value="">(no lobby)</option>
							{#each voiceChannels as channel (channel.id)}
								<option value={channel.id}>{channel.name}</option>
							{/each}
						</select>
						<small
							>Joining this channel makes a room and moves the member into it.</small
						>
					</label>

					<label class="field">
						<span>Default user limit</span>
						<input
							name="default_user_limit"
							type="number"
							min="0"
							max="99"
							bind:value={editing.default_user_limit}
						/>
					</label>

					<label class="field">
						<span>Lifetime</span>
						<select name="lifetime_mode" bind:value={editing.lifetime_mode}>
							<option value="idle">Idle — closes once empty</option>
							<option value="fixed">Fixed — closes after a set time</option>
							<option value="manual">Manual — never closes on its own</option>
						</select>
						{#if editing.channel_type === data.channelTypes.text}
							<small>Text rooms have no occupancy, so idle uses the fixed TTL.</small>
						{/if}
					</label>

					<label class="field">
						<span>Fixed lifetime (minutes)</span>
						<input
							name="ttl_minutes"
							type="number"
							min="1"
							bind:value={editing.ttl_minutes}
						/>
					</label>

					<label class="field">
						<span>Idle window (minutes)</span>
						<input
							name="idle_minutes"
							type="number"
							min="1"
							bind:value={editing.idle_minutes}
						/>
					</label>

					<label class="field">
						<span>Grace window (minutes)</span>
						<input
							name="grace_minutes"
							type="number"
							min="0"
							bind:value={editing.grace_minutes}
						/>
						<small>A new room is never closed inside this window.</small>
					</label>

					<label class="field">
						<span>Extension length (minutes)</span>
						<input
							name="extend_minutes"
							type="number"
							min="1"
							bind:value={editing.extend_minutes}
						/>
					</label>

					<label class="field">
						<span>Max extensions</span>
						<input
							name="max_extensions"
							type="number"
							min="0"
							bind:value={editing.max_extensions}
						/>
					</label>

					<label class="field">
						<span>Rooms per member</span>
						<input
							name="max_per_user"
							type="number"
							min="1"
							bind:value={editing.max_per_user}
						/>
					</label>

					<label class="field">
						<span>Rooms per server</span>
						<input
							name="max_per_guild"
							type="number"
							min="1"
							bind:value={editing.max_per_guild}
						/>
						<small>Discord caps a server at 500 channels and a category at 50.</small>
					</label>

					<label class="field">
						<span>Renames allowed</span>
						<input
							name="max_renames"
							type="number"
							min="0"
							bind:value={editing.max_renames}
						/>
						<small>Discord throttles renames to 2 per 10 minutes per channel.</small>
					</label>
				</div>

				<fieldset class="checks">
					<legend>Who may create a room</legend>
					<p class="hint">
						Leave both empty to allow anyone who can use the command. A denied role
						always wins.
					</p>
					<div class="check-grid">
						{#each roles as role (role.id)}
							<label class="check">
								<input
									type="checkbox"
									name="allow_role_ids"
									value={role.id}
									checked={editing.allow_role_ids.includes(role.id)}
									onchange={() =>
										(editing.allow_role_ids = toggle(
											editing.allow_role_ids,
											role.id
										))}
								/>
								<span>{role.name}</span>
							</label>
						{/each}
					</div>
				</fieldset>

				<fieldset class="checks">
					<legend>Roles that may never create a room</legend>
					<div class="check-grid">
						{#each roles as role (role.id)}
							<label class="check">
								<input
									type="checkbox"
									name="deny_role_ids"
									value={role.id}
									checked={editing.deny_role_ids.includes(role.id)}
									onchange={() =>
										(editing.deny_role_ids = toggle(
											editing.deny_role_ids,
											role.id
										))}
								/>
								<span>{role.name}</span>
							</label>
						{/each}
					</div>
				</fieldset>

				<fieldset class="checks">
					<legend>What the creator may do</legend>
					<div class="check-grid">
						{#each data.verbs as verb (verb)}
							<label class="check">
								<input
									type="checkbox"
									name="owner_can"
									value={verb}
									checked={editing.owner_can.includes(verb)}
									onchange={() =>
										(editing.owner_can = toggle(editing.owner_can, verb))}
								/>
								<span>{verb}</span>
							</label>
						{/each}
					</div>
				</fieldset>

				<fieldset class="checks">
					<legend>Permissions granted to the creator</legend>
					<p class="hint">
						Manage Channels is never granted — every action runs through SpaceBot with
						an ownership check, so the room can't be edited or deleted out from under
						it.
					</p>
					<div class="check-grid">
						{#each data.permissions as permission (permission)}
							<label class="check">
								<input
									type="checkbox"
									name="owner_allow"
									value={permission}
									checked={editing.owner_allow.includes(permission)}
									onchange={() =>
										(editing.owner_allow = toggle(
											editing.owner_allow,
											permission
										))}
								/>
								<span>{permission}</span>
							</label>
						{/each}
					</div>
				</fieldset>

				<fieldset class="checks">
					<legend>Denied to @everyone</legend>
					<div class="check-grid">
						{#each data.permissions as permission (permission)}
							<label class="check">
								<input
									type="checkbox"
									name="everyone_deny"
									value={permission}
									checked={editing.everyone_deny.includes(permission)}
									onchange={() =>
										(editing.everyone_deny = toggle(
											editing.everyone_deny,
											permission
										))}
								/>
								<span>{permission}</span>
							</label>
						{/each}
					</div>
				</fieldset>

				<label class="check standalone">
					<input type="checkbox" name="enabled" checked={editing.enabled} />
					<span>Enabled</span>
				</label>

				<div class="editor-actions">
					<button class="btn btn-primary" type="submit">Save preset</button>
					<button
						class="btn btn-secondary"
						type="button"
						onclick={() => (editing = null)}
					>
						Cancel
					</button>
				</div>
			</form>
		</section>
	{/if}

	{#if data.rooms.length > 0}
		<section class="rooms-section">
			<h2>Open rooms ({data.rooms.length})</h2>
			<div class="room-list">
				{#each data.rooms as room (room.channel_id)}
					<div class="room-row">
						<span class="room-name">{room.channel_name || room.channel_id}</span>
						<span class="room-meta">
							owner <code>{room.owner_user_id}</code>
							{#if room.expires_at}· closes {room.expires_at}{/if}
							{#if room.locked}· locked{/if}
						</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	.rooms-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	.page-header {
		margin-bottom: 2rem;
	}

	.back-link {
		display: inline-block;
		color: var(--color-text-muted);
		text-decoration: none;
		margin-bottom: 0.5rem;
		font-size: 0.875rem;
	}

	.back-link:hover {
		color: var(--color-primary);
	}

	.page-header h1 {
		margin: 0 0 0.5rem 0;
		font-size: 1.5rem;
		color: var(--color-text);
	}

	.page-desc {
		color: var(--color-text-muted);
		margin: 0;
		font-size: 0.9rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.section-header h2,
	.editor h2,
	.rooms-section h2 {
		margin: 0;
		font-size: 1.1rem;
		color: var(--color-text);
	}

	.empty-state {
		text-align: center;
		padding: 2.5rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		color: var(--color-text-muted);
	}

	.empty-icon {
		font-size: 2rem;
		display: block;
		margin-bottom: 0.5rem;
	}

	.empty-hint {
		font-size: 0.85rem;
	}

	.preset-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.preset-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
	}

	.preset-card.disabled {
		opacity: 0.6;
	}

	.preset-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.preset-head h3 {
		margin: 0;
		font-size: 1rem;
		color: var(--color-text);
	}

	.badge {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.15rem 0.45rem;
		border-radius: var(--radius-md);
		background: var(--color-surface-elevated);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	.badge-off {
		color: #f59e0b;
	}

	.preset-meta {
		margin: 0.5rem 0 0 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.preset-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.inline-form {
		display: inline;
	}

	.editor {
		margin-top: 2rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 1rem;
		margin: 1rem 0;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.field input,
	.field select {
		padding: 0.5rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
		color: var(--color-text);
	}

	.field small {
		font-size: 0.75rem;
		opacity: 0.8;
	}

	.checks {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.75rem 1rem 1rem;
		margin-bottom: 1rem;
	}

	.checks legend {
		font-size: 0.85rem;
		color: var(--color-text);
		padding: 0 0.35rem;
	}

	.hint {
		margin: 0 0 0.6rem 0;
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.check-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 0.35rem;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

	.check.standalone {
		margin-bottom: 1rem;
	}

	.editor-actions {
		display: flex;
		gap: 0.5rem;
	}

	.rooms-section {
		margin-top: 2rem;
	}

	.room-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-top: 0.75rem;
	}

	.room-row {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.6rem 0.8rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.85rem;
	}

	.room-name {
		color: var(--color-text);
	}

	.room-meta {
		color: var(--color-text-muted);
	}
</style>
