<script lang="ts">
	import { enhance } from '$app/forms';
	import Switch from '$lib/components/Switch.svelte';

	const { data, form } = $props();

	// svelte-ignore state_referenced_locally
	let enabled = $state(data.enabled);
	// Which built-in tests are ticked (shown). Reseeded after each save so a box never shows a
	// value that was not stored.
	// svelte-ignore state_referenced_locally
	let shown = $state<string[]>(
		data.catalog.filter((t) => !data.hidden.includes(t.id)).map((t) => t.id)
	);
	$effect(() => {
		enabled = data.enabled;
		shown = data.catalog.filter((t) => !data.hidden.includes(t.id)).map((t) => t.id);
	});

	let busy = $state<string | null>(null);
	let name = $state('');
	let url = $state('');
	let note = $state('');
	let category = $state('hubs');

	const run = (key: string, after?: () => void) => () => {
		busy = key;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = null;
			after?.();
		};
	};

	const savedShown = $derived(
		data.catalog.filter((t) => !data.hidden.includes(t.id)).map((t) => t.id)
	);
	const changed = $derived(
		shown.length !== savedShown.length || shown.some((id) => !savedShown.includes(id))
	);
	const groups = $derived(
		data.categories
			.map((c) => ({ ...c, tests: data.catalog.filter((t) => t.category === c.id) }))
			.filter((g) => g.tests.length > 0)
	);
	const label = (id: string) => data.categories.find((c) => c.id === id)?.label ?? id;

	const setGroup = (ids: string[], on: boolean) => {
		shown = on ? [...new Set([...shown, ...ids])] : shown.filter((id) => !ids.includes(id));
	};
</script>

<svelte:head>
	<title>Personality tests · SpaceBot</title>
</svelte:head>

<div class="personality-page">
	<header class="page-header">
		<a class="back-link" href="/admin/{data.serverId}">← Back to server</a>
		<h1>Personality tests</h1>
		<p class="page-desc">
			<code>/personality</code> gives your members links to free online personality tests: Myers-Briggs
			style, Big Five, autism, BDSM, attachment and more. Every test shows unless you hide it. SpaceBot
			only links; it never sees anyone's answers. Off unless you turn it on.
		</p>
	</header>

	{#if form?.error}
		<p class="alert alert-error" role="alert">{form.error}</p>
	{:else if form?.message}
		<p class="alert alert-success" role="status">{form.message}</p>
	{/if}

	{#if !data.available}
		<p class="alert alert-error">
			The personality test command is not available on this deployment yet.
		</p>
	{:else}
		<section class="card">
			<form method="POST" action="?/enable" use:enhance={run('enable')}>
				<input type="hidden" name="command_id" value={data.commandId} />
				<div class="card-head">
					<div>
						<h2>Turn on /personality</h2>
						<p class="muted">
							Members can then use <code>/personality list</code> and
							<code>/personality find</code>. Anyone with Manage Server can use the
							rest.
						</p>
					</div>
					<Switch
						name="enabled"
						bind:checked={enabled}
						label={enabled ? 'On' : 'Off'}
						disabled={busy === 'enable'}
					/>
				</div>
				<button
					class="btn btn-primary"
					type="submit"
					disabled={busy === 'enable' || enabled === data.enabled}
				>
					{busy === 'enable' ? 'Saving…' : 'Save'}
				</button>
			</form>
		</section>

		<section class="card">
			<h2>Which tests show</h2>
			<p class="muted">
				{shown.length} of {data.catalog.length} tests are ticked. Untick any you do not want in
				this server. Tests marked 🔞 are adult.
			</p>
			<form method="POST" action="?/selection" use:enhance={run('selection')}>
				<div class="groups">
					{#each groups as g (g.id)}
						<div class="group">
							<h3>
								{g.emoji}
								{g.label}
								<button
									type="button"
									class="btn btn-secondary btn-sm"
									onclick={() =>
										setGroup(
											g.tests.map((t) => t.id),
											true
										)}>All</button
								>
								<button
									type="button"
									class="btn btn-secondary btn-sm"
									onclick={() =>
										setGroup(
											g.tests.map((t) => t.id),
											false
										)}>None</button
								>
							</h3>
							<ul class="picks">
								{#each g.tests as t (t.id)}
									<li>
										<label class="pick">
											<input
												type="checkbox"
												name="shown"
												value={t.id}
												bind:group={shown}
											/>
											<span>
												<span class="pick-name"
													>{t.name}{#if t.adult}<span class="tag"
															>🔞 18+</span
														>{/if}</span
												>
												<span class="pick-blurb">{t.blurb}</span>
												<a
													class="link"
													href={t.url}
													target="_blank"
													rel="noopener noreferrer">Open link</a
												>
											</span>
										</label>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
				<div class="save-row">
					<button
						class="btn btn-primary"
						type="submit"
						disabled={busy === 'selection' || !changed}
					>
						{busy === 'selection' ? 'Saving…' : 'Save selection'}
					</button>
					<button
						class="btn btn-secondary"
						type="submit"
						formaction="?/showall"
						disabled={busy === 'selection' || data.hidden.length === 0}
						>Show every test</button
					>
				</div>
			</form>
		</section>

		<section class="card">
			<h2>Your own links</h2>
			<p class="muted">
				{data.custom.length} of {data.limits.links}. They appear in the list under the
				category you pick. https links only.
			</p>

			<form
				class="add-form"
				method="POST"
				action="?/add"
				use:enhance={run('add', () => {
					name = '';
					url = '';
					note = '';
				})}
			>
				<div class="add-grid">
					<label class="field">
						<span>Name</span>
						<input
							name="name"
							bind:value={name}
							maxlength={data.limits.name}
							required
						/>
					</label>
					<label class="field">
						<span>Link</span>
						<input
							name="url"
							type="url"
							bind:value={url}
							maxlength={data.limits.url}
							placeholder="https://"
							required
						/>
					</label>
					<label class="field">
						<span>Category</span>
						<select name="category" bind:value={category}>
							{#each data.categories as c (c.id)}
								<option value={c.id}>{c.label}</option>
							{/each}
						</select>
					</label>
					<label class="field">
						<span>Note (optional)</span>
						<input name="note" bind:value={note} maxlength={data.limits.note} />
					</label>
				</div>
				<button
					class="btn btn-primary"
					type="submit"
					disabled={busy === 'add' || name.trim() === '' || url.trim() === ''}
				>
					{busy === 'add' ? 'Adding…' : 'Add link'}
				</button>
			</form>

			{#if data.custom.length === 0}
				<p class="muted empty">No links of your own yet.</p>
			{:else}
				<ul class="list">
					{#each data.custom as c (c.id)}
						<li>
							<span class="text">
								<strong>{c.name}</strong>
								<span class="tag">{label(c.category)}</span><br />
								<a
									class="link"
									href={c.url}
									target="_blank"
									rel="noopener noreferrer">{c.url}</a
								>
								{#if c.note}<br /><span class="muted">{c.note}</span>{/if}
							</span>
							<form method="POST" action="?/remove" use:enhance={run(`rm${c.id}`)}>
								<input type="hidden" name="id" value={c.id} />
								<button
									class="btn btn-danger-outline btn-sm"
									type="submit"
									aria-label="Remove: {c.name}"
									disabled={busy === `rm${c.id}`}>Remove</button
								>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>

<style>
	.personality-page {
		max-width: 900px;
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
	h1 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
		color: var(--color-text);
	}
	.page-desc,
	.muted {
		color: var(--color-text-muted);
		margin: 0;
		font-size: 0.9rem;
	}
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}
	.card h2 {
		margin: 0 0 0.25rem;
		font-size: 1.1rem;
		color: var(--color-text);
	}
	.card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.9rem;
		color: var(--color-text);
	}
	.field input,
	.field select {
		padding: 0.5rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
		color: var(--color-text);
	}
	.field input:focus-visible,
	.field select:focus-visible {
		outline: none;
		border-color: var(--color-primary);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--color-border);
	}
	.list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--color-border);
	}
	.text {
		overflow-wrap: anywhere;
		color: var(--color-text);
	}
	.groups {
		display: grid;
		gap: 1.25rem;
		margin: 1rem 0;
	}
	.group h3 {
		margin: 0 0 0.5rem;
		font-size: 0.95rem;
		color: var(--color-text);
	}
	.picks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}
	.pick {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.pick:hover {
		border-color: var(--color-primary);
	}
	.pick input {
		margin-top: 0.2rem;
	}
	.pick-name {
		font-weight: 600;
		color: var(--color-text);
	}
	.pick-blurb {
		display: block;
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}
	.tag {
		font-size: 0.75rem;
		margin-left: 0.4rem;
		padding: 0.05rem 0.4rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		font-weight: 400;
	}
	.link {
		color: var(--color-primary);
		font-size: 0.8rem;
	}
	.add-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 1rem 1.5rem;
		margin: 1rem 0;
	}
	.save-row {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.empty {
		margin-top: 1rem;
	}
	.alert {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-sm);
		margin: 0 0 1rem;
		border: 1px solid var(--color-border);
	}
	.alert-error {
		color: var(--color-danger-text);
		border-color: var(--color-danger);
	}
	.alert-success {
		color: var(--color-success-text);
		border-color: var(--color-success);
	}
	@media (max-width: 600px) {
		.card-head {
			flex-direction: column;
		}
	}
</style>
