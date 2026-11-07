<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	const { data, form } = $props();

	const STATUS_LABEL: Record<string, string> = {
		new: 'New',
		reviewing: 'Reviewing',
		planned: 'Planned',
		shipped: 'Shipped',
		declined: 'Declined',
		duplicate: 'Duplicate',
	};
	const AREA_LABEL: Record<string, string> = {
		commands: 'Commands',
		dashboard: 'Dashboard',
		games: 'Games',
		automations: 'Automations',
		logging: 'Logging',
		server_browser: 'Server browser',
		other: 'Something else',
	};

	const selected = $derived(data.selected);
	const f = $derived(data.filters);

	/** A link that keeps the filters and changes the open idea. */
	function linkTo(id: number | null) {
		const p = new URLSearchParams(page.url.search);
		if (id) p.set('id', String(id));
		else p.delete('id');
		const qs = p.toString();
		return qs ? `?${qs}` : '?';
	}

	/** A form action that keeps the filters and the open idea in the address. */
	function act(name: string) {
		const qs = page.url.search.replace(/^\?/, '');
		return qs ? `?/${name}&${qs}` : `?/${name}`;
	}

	function parseIds(json: string | null): number[] {
		try {
			const v = JSON.parse(json ?? '[]');
			return Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : [];
		} catch {
			return [];
		}
	}
	const aiDuplicates = $derived(selected ? parseIds(selected.ai_duplicates) : []);
	let statusDraft = $state('new');
	$effect(() => {
		statusDraft = selected?.status ?? 'new';
	});

	const day = (iso: string) => iso.slice(0, 10);
	const fmtScore = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));

	/** j and k step through the list, like a mail client. */
	function onKey(e: KeyboardEvent) {
		const el = e.target as HTMLElement | null;
		if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key !== 'j' && e.key !== 'k') return;
		const ids = data.ideas.map((i) => i.id);
		if (!ids.length) return;
		const at = selected ? ids.indexOf(selected.id) : -1;
		const next = e.key === 'j' ? Math.min(at + 1, ids.length - 1) : Math.max(at - 1, 0);
		void goto(linkTo(ids[next]), { reset: false });
	}
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>Ideas - Superadmin</title></svelte:head>

<div class="page">
	<header class="head">
		<div>
			<h1>Ideas</h1>
			<p class="lede">
				What people asked for, ranked by <strong
					>impact × reach × confidence ÷ effort</strong
				>. Rows marked <span class="mark">AI</span> are the model's draft; your own score
				always wins. Effort sizes are rough. Keys: <kbd>j</kbd> next, <kbd>k</kbd> previous.
			</p>
		</div>
	</header>

	{#if !data.available}
		<p class="empty">The database is not available here.</p>
	{:else}
		<div class="counts">
			<div><b>{data.counts.newThisWeek}</b><span>new this week</span></div>
			<div><b>{data.counts.needsScore}</b><span>waiting for your score</span></div>
			<div><b>{data.counts.planned}</b><span>planned</span></div>
			<div><b>{data.counts.shipped}</b><span>shipped</span></div>
		</div>

		<form class="filters" method="GET">
			{#if selected}<input type="hidden" name="id" value={selected.id} />{/if}
			<select
				name="status"
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
				aria-label="Status"
			>
				<option value="open" selected={f.status === 'open'}>New and reviewing</option>
				<option value="all" selected={f.status === 'all'}>Every status</option>
				{#each data.options.statuses as s}
					<option value={s} selected={f.status === s}>{STATUS_LABEL[s]}</option>
				{/each}
			</select>
			<select
				name="area"
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
				aria-label="Area"
			>
				<option value="">Any area</option>
				{#each data.options.areas as a}
					<option value={a} selected={f.area === a}>{AREA_LABEL[a]}</option>
				{/each}
			</select>
			<select
				name="effort"
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
				aria-label="Effort"
			>
				<option value="">Any effort</option>
				{#each data.options.efforts as e}
					<option value={e} selected={f.effort === e}>{e}</option>
				{/each}
			</select>
			<select
				name="sort"
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
				aria-label="Sort"
			>
				<option value="score" selected={f.sort === 'score'}>Best score first</option>
				<option value="newest" selected={f.sort === 'newest'}>Newest first</option>
			</select>
			<label class="check"
				><input
					type="checkbox"
					name="needs"
					value="1"
					checked={f.needs}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
				/> Needs my score</label
			>
			<label class="check"
				><input
					type="checkbox"
					name="dups"
					value="1"
					checked={f.dups}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
				/> Has duplicates</label
			>
			<input
				type="search"
				name="q"
				value={f.q}
				placeholder="Search title and text"
				aria-label="Search"
			/>
			<button type="submit">Search</button>
		</form>

		{#if form?.error}<p class="msg bad" role="alert">{form.error}</p>{/if}
		{#if form?.ok}<p class="msg ok" role="status">{form.ok}</p>{/if}

		<div class="split" class:has-detail={selected}>
			<section class="list" aria-label="Ideas">
				{#if data.ideas.length === 0}
					<p class="empty">Nothing here with these filters.</p>
				{/if}
				{#each data.ideas as row (row.id)}
					<div
						class="row"
						class:active={selected?.id === row.id}
						class:draft={row.scoreSource !== 'admin'}
					>
						<a class="row-main" href={linkTo(row.id)} data-sveltekit-noscroll>
							<span
								class="score"
								title={row.scoreSource === 'admin'
									? 'Your score'
									: row.scoreSource === 'ai'
										? 'AI draft'
										: 'Not scored'}
							>
								{row.scoreSource ? fmtScore(row.score) : '–'}
								{#if row.scoreSource === 'ai'}<small class="mark">AI</small>{/if}
							</span>
							<span class="title">
								{row.title}
								{#if row.risk}<span
										class="flag"
										title="Touches billing, privacy or member data">risk</span
									>{/if}
								{#if row.hasDuplicates}<span
										class="flag dup"
										title="The AI thinks this repeats another idea">dup?</span
									>{/if}
							</span>
							<span class="meta">
								{#if row.effort}<span class="chip">{row.effort}</span>{/if}
								{#if row.impact && row.reach}<span
										class="chip"
										title="Impact × reach">{row.impact}×{row.reach}</span
									>{/if}
								<span>{AREA_LABEL[row.area] ?? row.area}</span>
								<span>{row.userName ?? 'removed'} · {day(row.createdAt)}</span>
								<span class="chip st st-{row.status}"
									>{STATUS_LABEL[row.status]}</span
								>
							</span>
						</a>
						<form class="quick" method="POST" action={act('quick')} use:enhance>
							<input type="hidden" name="id" value={row.id} />
							<select
								name="effort"
								aria-label="Effort for {row.title}"
								onchange={(e) => e.currentTarget.form?.requestSubmit()}
							>
								<option value="" selected={!row.effort}>effort</option>
								{#each data.options.efforts as e}
									<option value={e} selected={row.effort === e}>{e}</option>
								{/each}
							</select>
							{#if row.status !== 'declined'}
								<button name="status" value="declined" type="submit" class="ghost"
									>Decline</button
								>
							{:else}
								<button name="status" value="reviewing" type="submit" class="ghost"
									>Reopen</button
								>
							{/if}
						</form>
					</div>
				{/each}
			</section>

			{#if selected}
				<aside class="detail" aria-label="Idea {selected.id}">
					<a class="back" href={linkTo(null)}>← Back to the list</a>
					<h2>{selected.title}</h2>
					<p class="who">
						{#if selected.user_id}
							<a href="/admin/superadmin/users?search={selected.user_id}"
								>{selected.user_name ?? selected.user_id}</a
							>
							<span class="dim">({selected.user_id})</span>
						{:else}
							<span class="dim">Name removed</span>
						{/if}
						· {selected.created_at.replace('T', ' ').slice(0, 16)} UTC · via {selected.source ===
						'command'
							? '/idea'
							: 'the web page'}
						{#if selected.guild_id}· server <span class="dim">{selected.guild_id}</span
							>{/if}
						· {AREA_LABEL[selected.area] ?? selected.area}
					</p>
					<p class="body">{selected.body}</p>

					<div class="ai">
						<h3>AI draft</h3>
						{#if selected.ai_scored_at}
							<p>{selected.ai_summary}</p>
							<p class="dim">
								Impact {selected.ai_impact}, reach {selected.ai_reach}, effort {selected.ai_effort},
								confidence
								{selected.ai_confidence}%{selected.ai_risk
									? ', flagged as risky'
									: ''}. {selected.ai_reasoning}
							</p>
							{#if aiDuplicates.length}
								<p class="dim">
									Looks like:
									{#each aiDuplicates as d (d)}<a href={linkTo(d)}>#{d}</a>
									{/each}
								</p>
							{/if}
						{:else}
							<p class="dim">No draft yet.</p>
						{/if}
						<form method="POST" action={act('redraft')} use:enhance>
							<input type="hidden" name="id" value={selected.id} />
							<button type="submit" class="ghost"
								>{selected.ai_scored_at ? 'Draft again' : 'Ask for a draft'}</button
							>
						</form>
					</div>

					<form class="review" method="POST" action={act('review')} use:enhance>
						<input type="hidden" name="id" value={selected.id} />
						<h3>Your call</h3>
						<div class="grid">
							<label
								>Impact
								<select name="impact">
									<option value="">–</option>
									{#each [1, 2, 3, 4, 5] as n}<option
											value={n}
											selected={selected.impact === n}>{n}</option
										>{/each}
								</select>
							</label>
							<label
								>Reach
								<select name="reach">
									<option value="">–</option>
									{#each [1, 2, 3, 4, 5] as n}<option
											value={n}
											selected={selected.reach === n}>{n}</option
										>{/each}
								</select>
							</label>
							<label
								>Effort
								<select name="effort">
									<option value="">–</option>
									{#each data.options.efforts as e}<option
											value={e}
											selected={selected.effort === e}>{e}</option
										>{/each}
								</select>
							</label>
							<label
								>Confidence
								<select name="confidence">
									<option value="">–</option>
									{#each data.options.confidences as c}<option
											value={c}
											selected={selected.confidence === c}>{c}%</option
										>{/each}
								</select>
							</label>
						</div>
						<label class="check"
							><input type="checkbox" name="risk" checked={Boolean(selected.risk)} /> Needs
							a decision first (billing, privacy, member data)</label
						>
						<label
							>Status
							<select name="status" bind:value={statusDraft}>
								{#each data.options.statuses as s}<option value={s}
										>{STATUS_LABEL[s]}</option
									>{/each}
							</select>
						</label>
						{#if statusDraft === 'duplicate'}
							<label
								>Repeats
								<select name="duplicate_of">
									<option value="">Pick an idea</option>
									{#each data.picker as p}
										<option
											value={p.id}
											selected={selected.duplicate_of === p.id ||
												(aiDuplicates[0] === p.id &&
													!selected.duplicate_of)}
											>#{p.id} {p.title}</option
										>
									{/each}
								</select>
							</label>
						{/if}
						{#if statusDraft === 'shipped'}
							<label
								>Where it shipped (a commit, a doc, a version)
								<input
									name="shipped_ref"
									maxlength="200"
									value={selected.shipped_ref ?? ''}
								/>
							</label>
						{/if}
						<label
							>Note (only you see it)
							<textarea name="note" rows="3" maxlength="2000"
								>{selected.admin_note ?? ''}</textarea
							>
						</label>
						<p class="dim">
							Rank now: {selected.score_source
								? fmtScore(selected.score)
								: 'not scored'}{selected.score_source === 'ai'
								? ' (the AI draft)'
								: ''}.
						</p>
						<button type="submit" class="primary">Save</button>
					</form>

					{#if selected.user_id}
						<div class="danger">
							<form method="POST" action={act('ban')} use:enhance>
								<input type="hidden" name="user_id" value={selected.user_id} />
								<input
									name="reason"
									maxlength="200"
									placeholder="Reason (only you see it)"
									aria-label="Reason"
								/>
								<button type="submit" class="ghost"
									>Stop this person sending ideas</button
								>
							</form>
							<form method="POST" action={act('anonymize')} use:enhance>
								<input type="hidden" name="id" value={selected.id} />
								<button type="submit" class="ghost"
									>Remove their name from this idea</button
								>
							</form>
						</div>
					{/if}
				</aside>
			{/if}
		</div>

		{#if data.bans.length}
			<section class="bans">
				<h3>Blocked senders</h3>
				{#each data.bans as b (b.user_id)}
					<form method="POST" action={act('unban')} use:enhance class="ban">
						<span
							>{b.user_id}{b.reason ? ` - ${b.reason}` : ''}
							<span class="dim">({day(b.created_at)})</span></span
						>
						<input type="hidden" name="user_id" value={b.user_id} />
						<button type="submit" class="ghost">Allow again</button>
					</form>
				{/each}
			</section>
		{/if}
	{/if}
</div>

<style>
	.page {
		display: grid;
		gap: 1rem;
		margin-top: 1rem;
		min-width: 0;
	}
	h1 {
		margin: 0 0 0.25rem;
		font-size: 1.6rem;
	}
	h2 {
		margin: 0.25rem 0;
		font-size: 1.2rem;
		overflow-wrap: anywhere;
	}
	h3 {
		margin: 0 0 0.4rem;
		font-size: 0.95rem;
	}
	.lede,
	.dim {
		color: var(--color-text-muted);
	}
	.lede {
		margin: 0;
		max-width: 52rem;
	}
	kbd {
		padding: 0 0.3rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		font-size: 0.8em;
	}
	.counts {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.75rem;
	}
	.counts div {
		display: flex;
		flex-direction: column;
		padding: 0.7rem 0.9rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}
	.counts b {
		font-size: 1.4rem;
	}
	.counts span {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.filters input[type='search'] {
		flex: 1 1 14rem;
	}
	select,
	input:not([type='checkbox']):not([type='hidden']),
	textarea,
	button {
		font: inherit;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
		min-width: 0;
	}
	button {
		cursor: pointer;
	}
	button.primary {
		background: var(--color-primary-button);
		color: white;
		border: 0;
		font-weight: 700;
		padding: 0.6rem 1rem;
		align-self: flex-start;
	}
	button.ghost {
		background: transparent;
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.9rem;
	}
	.msg {
		margin: 0;
		padding: 0.5rem 0.8rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
	}
	.msg.bad {
		border-color: var(--color-danger, #d64545);
	}
	.msg.ok {
		border-color: var(--color-success, #2e9e5b);
	}
	.empty {
		color: var(--color-text-muted);
	}
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
		align-items: start;
	}
	.split.has-detail {
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}
	.row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		padding: 0.4rem 0.6rem;
	}
	.row.draft {
		opacity: 0.85;
	}
	.row.active {
		border-color: var(--color-primary-button);
		opacity: 1;
	}
	.row a.row-main {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: 3.2rem minmax(0, 1fr);
		grid-template-areas: 'score title' 'score meta';
		gap: 0.1rem 0.6rem;
		color: var(--color-text);
		text-decoration: none;
	}
	.score {
		grid-area: score;
		font-weight: 700;
		font-size: 1.1rem;
		align-self: center;
		text-align: right;
	}
	.title {
		grid-area: title;
		overflow-wrap: anywhere;
	}
	.meta {
		grid-area: meta;
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.6rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	.chip,
	.mark,
	.flag {
		padding: 0 0.4rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 0.75rem;
	}
	.mark {
		margin-left: 0.2rem;
	}
	.flag {
		margin-left: 0.3rem;
		border-color: var(--color-danger, #d64545);
	}
	.flag.dup {
		border-color: var(--color-border);
	}
	.quick {
		display: flex;
		gap: 0.3rem;
		flex-shrink: 0;
	}
	.quick select,
	.quick button {
		padding: 0.2rem 0.4rem;
		font-size: 0.8rem;
	}
	.detail {
		position: sticky;
		top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		min-width: 0;
		max-height: calc(100vh - 2rem);
		overflow: auto;
	}
	.back {
		display: none;
	}
	.who {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}
	.body {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.ai,
	.review,
	.danger {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
	}
	.ai p {
		margin: 0;
	}
	.review label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.85rem;
	}
	.review label.check {
		flex-direction: row;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.danger form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.danger input {
		flex: 1 1 10rem;
	}
	.bans .ban {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		padding: 0.3rem 0;
	}
	@media (max-width: 900px) {
		.split.has-detail {
			grid-template-columns: minmax(0, 1fr);
		}
		/* The idea opens full-width and the list steps aside. */
		.split.has-detail .list {
			display: none;
		}
		.detail {
			position: static;
			max-height: none;
		}
		.back {
			display: inline-block;
		}
		.counts {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.row {
			flex-direction: column;
			align-items: stretch;
		}
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
