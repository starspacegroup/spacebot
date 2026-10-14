<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from '$lib/toast.svelte.js';

	const { data, form } = $props();

	$effect(() => {
		if (form?.message) {
			if (form.success) toast.success(form.message);
			else toast.error(form.message);
		}
	});
</script>

<svelte:head>
	<title>Activity · {data.guild?.name || 'Server'} · SpaceBot</title>
</svelte:head>

<div class="activity-page">
	<header class="page-header">
		<a href="/admin/{data.serverId}" class="back-link">← Back to dashboard</a>
		<h1>🚀 Activity</h1>
		<p class="page-desc">
			The SpaceBot Activity runs inside a voice channel for your members. This page turns its
			parts on for this server and sets their defaults.
		</p>
	</header>

	<section class="card">
		<h2>How members open it</h2>
		<p>
			A member joins a voice channel, opens <strong>Activities</strong> (the rocket button),
			and picks
			<strong>SpaceBot</strong>. It also launches from a DM with a member of this server.
			Nothing here has to be on for the Activity to open; the parts below decide what it
			shows.
		</p>
	</section>

	<section class="card">
		<h2>Parts of the Activity</h2>
		<p class="muted">A part you switch off also hides its slash command from members.</p>
		{#each data.modules as mod (mod.id)}
			<form method="POST" action="?/toggleModule" use:enhance class="module-row">
				<input type="hidden" name="module" value={mod.id} />
				<div class="module-info">
					<span class="module-name">{mod.name}</span>
					<span class="module-desc">{mod.summary}</span>
					<span class="module-desc">{mod.start}</span>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						name="enabled"
						checked={mod.enabled}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
					/>
					<span>{mod.enabled ? 'On' : 'Off'}</span>
				</label>
			</form>
		{/each}
	</section>

	<section class="card">
		<h2>Timebox defaults</h2>
		<p class="muted">
			What <code>/timebox start</code> uses when a member does not choose. Members can still override
			each one when they start.
		</p>
		<form method="POST" action="?/saveTimebox" use:enhance class="settings-form">
			<label>
				Focus (minutes)
				<input
					type="number"
					name="focus"
					min={data.limits.focus[0]}
					max={data.limits.focus[1]}
					value={data.timebox.focus}
					required
				/>
			</label>
			<label>
				Break (minutes)
				<input
					type="number"
					name="break"
					min={data.limits.break[0]}
					max={data.limits.break[1]}
					value={data.timebox.break}
					required
				/>
			</label>
			<label>
				Long break (minutes)
				<input
					type="number"
					name="longBreak"
					min={data.limits.longBreak[0]}
					max={data.limits.longBreak[1]}
					value={data.timebox.longBreak}
					required
				/>
			</label>
			<label>
				Rounds
				<input
					type="number"
					name="rounds"
					min={data.limits.rounds[0]}
					max={data.limits.rounds[1]}
					value={data.timebox.rounds}
					required
				/>
			</label>
			<label>
				Who can pause, skip or stop a shared timebox
				<select name="control" value={data.timebox.control}>
					<option value="crew">Moderators and the starter</option>
					<option value="anyone">Anyone in the timebox</option>
				</select>
			</label>
			<button type="submit" class="btn-primary">Save defaults</button>
		</form>
	</section>

	<p class="muted">
		Who may use <code>/timebox</code> is set under
		<a href="/admin/{data.serverId}/commands">Slash Commands</a>, including by role.
	</p>
</div>

<style>
	.activity-page {
		max-width: 760px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	.page-header {
		margin-bottom: 1.5rem;
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

	.page-desc,
	.muted {
		color: var(--color-text-muted);
		font-size: 0.9rem;
		margin: 0 0 0.75rem 0;
	}

	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
		margin-bottom: 1rem;
	}

	.card h2 {
		margin: 0 0 0.5rem 0;
		font-size: 1.1rem;
		color: var(--color-text);
	}

	.card p {
		margin: 0 0 0.75rem 0;
		color: var(--color-text);
		font-size: 0.925rem;
	}

	.card .muted {
		color: var(--color-text-muted);
	}

	.module-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 0;
		border-top: 1px solid var(--color-border);
	}

	.module-info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.module-name {
		font-weight: 600;
		color: var(--color-text);
	}

	.module-desc {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.switch {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		white-space: nowrap;
		color: var(--color-text);
	}

	.settings-form {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem 1rem;
	}

	.settings-form label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.settings-form input,
	.settings-form select {
		padding: 0.5rem 0.6rem;
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md, 6px);
		font-size: 0.95rem;
	}

	.settings-form label:nth-child(5),
	.settings-form button {
		grid-column: 1 / -1;
	}

	.btn-primary {
		justify-self: start;
		padding: 0.55rem 1.1rem;
		background: var(--color-primary);
		color: var(--color-text-inverse);
		border: none;
		border-radius: var(--radius-md, 6px);
		font-weight: 600;
		cursor: pointer;
	}

	.btn-primary:hover {
		filter: brightness(1.1);
	}

	@media (max-width: 560px) {
		.settings-form {
			grid-template-columns: 1fr;
		}
	}
</style>
