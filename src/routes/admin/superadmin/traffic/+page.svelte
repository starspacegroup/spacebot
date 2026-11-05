<script lang="ts">
	import BarList from '$lib/components/superadmin-traffic/BarList.svelte';
	import Trend from '$lib/components/superadmin-traffic/Trend.svelte';
	import { LISTING_CATEGORIES } from '$lib/db/server-listings.js';
	import { TABS } from '$lib/traffic-tabs.js';

	const { data } = $props();

	const windows = [
		{ days: 1, label: '24 hours' },
		{ days: 7, label: '7 days' },
		{ days: 30, label: '30 days' },
		{ days: 90, label: '90 days' },
	];
	const tabNames: Record<(typeof TABS)[number], string> = {
		overview: 'Overview',
		browser: 'Server browser',
		audience: 'Audience',
	};

	const PAGE_NAMES: Record<string, string> = {
		'/': 'Home',
		'/invite': 'Invite',
		'/servers': 'Server browser',
		'/servers/[guildId]': 'A server’s page',
		'/leaderboards': 'Leaderboards',
		'/docs': 'Docs',
		'/docs/dev': 'Developer docs',
		'/docs/dev/[slug]': 'A developer doc',
		'/login': 'Sign in',
		'/support': 'Support',
		'/vote': 'Vote',
		'/privacy': 'Privacy',
		'/terms': 'Terms',
	};
	const categoryName = (value: string | null) =>
		LISTING_CATEGORIES.find((c) => c.value === value)?.label ?? value ?? 'Other';

	const fmt = (n: number) => n.toLocaleString();
	const pct = (part: number, whole: number) =>
		whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
	const rate = (r: number | null) =>
		r === null ? '–' : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`;

	/** "up 12%" against the window before this one. Null when there is nothing to compare. */
	function delta(now: number, before: number | null | undefined) {
		if (before === null || before === undefined) return null;
		if (before === 0) return now === 0 ? null : { text: 'new', dir: 'up' as const };
		const change = Math.round(((now - before) / before) * 100);
		if (change === 0) return { text: 'no change', dir: 'flat' as const };
		return {
			text: `${change > 0 ? '+' : ''}${change}%`,
			dir: change > 0 ? 'up' : 'down',
		} as const;
	}

	const windowLabel = $derived(windows.find((w) => w.days === data.window)?.label ?? '');
	const href = (over: Record<string, string>) => {
		const q = new URLSearchParams({ tab: data.tab, window: String(data.window), ...over });
		if (q.get('sort') === 'joins') q.delete('sort');
		return `?${q}`;
	};
	const hourLabel = (label: string) => `${label.slice(11)}:00`;
	const dayLabel = (label: string) => label.slice(5);

	const sortColumns = [
		{ key: 'joins', label: 'Joins' },
		{ key: 'views', label: 'Views' },
		{ key: 'impressions', label: 'Seen' },
		{ key: 'rate', label: 'Join rate' },
		{ key: 'members', label: 'Members' },
	] as const;

	const browserSteps = $derived(
		data.tab === 'browser' && data.totals
			? [
					{ label: 'Card on a page that loaded', n: data.totals.impressions },
					{ label: 'Opened the server’s page', n: data.totals.views },
					{ label: 'Pressed Join', n: data.totals.joins },
				]
			: []
	);
	const overviewSteps = $derived(
		data.tab === 'overview' && data.funnel
			? [
					{ label: 'Home page views', n: data.funnel.visits },
					{ label: 'Invite page views', n: data.funnel.invitePage },
					{ label: 'Sign-ins started', n: data.funnel.loginStarts },
					{ label: 'Installs started', n: data.funnel.installStarts },
					{ label: 'Installs finished', n: data.funnel.installs },
				]
			: []
	);
	const pageRows = $derived(
		data.tab === 'overview' && data.pages
			? data.pages.map((p) => ({ label: p.label, views: p.views }))
			: []
	);
</script>

<svelte:head>
	<title>Site traffic | Superadmin | SpaceBot</title>
</svelte:head>

<div class="page">
	<header class="head">
		<div class="head-text">
			<h1>Site traffic</h1>
			<p class="lede">
				How the public pages and the server browser are doing. Counts only: nothing per
				visitor is stored, no cookies, no IP addresses.
			</p>
		</div>
		<nav class="windows" aria-label="Time window">
			{#each windows as w (w.days)}
				<a
					href={href({ window: String(w.days) })}
					class:active={data.window === w.days}
					aria-current={data.window === w.days ? 'true' : undefined}
					data-sveltekit-noscroll>{w.label}</a
				>
			{/each}
		</nav>
	</header>

	<nav class="tabs" aria-label="Sections">
		{#each TABS as t (t)}
			<a
				href={href({ tab: t })}
				class:active={data.tab === t}
				aria-current={data.tab === t ? 'page' : undefined}
				data-sveltekit-noscroll>{tabNames[t]}</a
			>
		{/each}
	</nav>

	{#if !data.available}
		<p class="empty">The database is not available here.</p>
	{:else if data.tab === 'overview'}
		{@const viewsDelta = data.hourly ? null : delta(data.total, data.previousTotal)}
		<section class="tiles">
			<div class="tile">
				<span class="l">Views</span>
				<span class="n">{fmt(data.total)}</span>
				<span class="sub">
					{#if viewsDelta}
						<span class="delta {viewsDelta.dir}">{viewsDelta.text}</span> vs the {windowLabel}
						before
					{:else}
						in the last {windowLabel}
					{/if}
				</span>
			</div>
			<div class="tile">
				<span class="l">From signed-in members</span>
				<span class="n">{pct(data.signedIn, data.total)}</span>
				<span class="sub">of views, not of people</span>
			</div>
			<div class="tile">
				<span class="l">Installs finished</span>
				<span class="n">{fmt(data.funnel.installs)}</span>
				<span class="sub">{fmt(data.funnel.installStarts)} started</span>
			</div>
			<div class="tile">
				<span class="l">Home view to install</span>
				<span class="n">{pct(data.funnel.installs, data.funnel.visits)}</span>
				<span class="sub">a ratio of totals</span>
			</div>
		</section>

		<section class="card">
			<h2>Views {data.hourly ? 'by hour' : 'by day'}</h2>
			{#if data.total === 0}
				<p class="empty">
					No views in this window yet. Counting began when this shipped, so a new window
					fills in from there.
				</p>
			{:else}
				<Trend
					labels={data.series.map((b) => b.label)}
					series={[
						{ key: 'views', label: 'Views', values: data.series.map((b) => b.views) },
						{
							key: 'signed',
							label: 'Signed in',
							tone: 'success',
							values: data.series.map((b) => b.signedIn ?? 0),
						},
					]}
					format={data.hourly ? hourLabel : dayLabel}
					unit={data.hourly ? 'hour' : 'day'}
				/>
				{#if data.hourly}
					<p class="note">
						The lists below count whole UTC days, so they can run ahead of this chart.
					</p>
				{/if}
			{/if}
		</section>

		<div class="split">
			<section class="card">
				<h2>From first look to installed</h2>
				<ol class="steps">
					{#each overviewSteps as s, i (s.label)}
						<li>
							<span
								class="bar"
								style="width:{Math.max(
									3,
									Math.round((s.n / Math.max(1, overviewSteps[0].n)) * 100)
								)}%"
							></span>
							<span class="sl">{s.label}</span>
							<span class="sn">{fmt(s.n)}</span>
							<span class="sp">{i > 0 ? pct(s.n, overviewSteps[i - 1].n) : ''}</span>
						</li>
					{/each}
				</ol>
				<p class="note">
					Each step is its own count, not a track of one person, so a percentage is a
					ratio of two totals, not a conversion rate.
				</p>
			</section>
			<BarList title="Pages" rows={pageRows} name={(l) => PAGE_NAMES[l] ?? l} />
		</div>
	{:else if data.tab === 'browser'}
		{@const joinsDelta = delta(data.totals.joins, data.previous.joins)}
		{@const viewsDelta = delta(data.totals.views, data.previous.views)}
		{@const seenDelta = delta(data.totals.impressions, data.previous.impressions)}
		<section class="tiles">
			<div class="tile">
				<span class="l">Servers listed</span>
				<span class="n">{fmt(data.counts.live)}</span>
				<span class="sub">
					{#if data.counts.waiting || data.counts.hidden}
						{data.counts.waiting} waiting, {data.counts.hidden} hidden
					{:else}
						live in the browser now
					{/if}
				</span>
			</div>
			<div class="tile">
				<span class="l">Cards seen</span>
				<span class="n">{fmt(data.totals.impressions)}</span>
				<span class="sub">
					{#if seenDelta}<span class="delta {seenDelta.dir}">{seenDelta.text}</span> vs before{:else}in
						the {windowLabel}{/if}
				</span>
			</div>
			<div class="tile">
				<span class="l">Server pages opened</span>
				<span class="n">{fmt(data.totals.views)}</span>
				<span class="sub">
					{#if viewsDelta}<span class="delta {viewsDelta.dir}">{viewsDelta.text}</span> vs before{:else}{pct(
							data.totals.views,
							data.totals.impressions
						)} of cards seen{/if}
				</span>
			</div>
			<div class="tile">
				<span class="l">Joins</span>
				<span class="n">{fmt(data.totals.joins)}</span>
				<span class="sub">
					{#if joinsDelta}<span class="delta {joinsDelta.dir}">{joinsDelta.text}</span> vs before{:else}in
						the {windowLabel}{/if}
				</span>
			</div>
			<div class="tile">
				<span class="l">Join rate</span>
				<span class="n">{pct(data.totals.joins, data.totals.views)}</span>
				<span class="sub">joins per page opened</span>
			</div>
			<div class="tile">
				<span class="l">Searches</span>
				<span class="n">{fmt(data.counts.searches)}</span>
				<span class="sub">words are never stored</span>
			</div>
		</section>

		<div class="split">
			<section class="card">
				<h2>Opened and joined, by day</h2>
				{#if data.totals.views + data.totals.joins + data.totals.impressions === 0}
					<p class="empty">
						Nothing counted in this window yet. Listing counters began when this
						shipped.
					</p>
				{:else}
					<Trend
						labels={data.series.map((b) => b.label)}
						series={[
							{
								key: 'views',
								label: 'Pages opened',
								values: data.series.map((b) => b.views),
							},
							{
								key: 'joins',
								label: 'Joins',
								tone: 'success',
								values: data.series.map((b) => b.joins),
							},
						]}
						format={dayLabel}
					/>
					{#if data.chartDays > data.window}
						<p class="note">
							A day-by-day chart needs at least a week, so this one shows {data.chartDays}
							days.
						</p>
					{/if}
				{/if}
			</section>
			<section class="card">
				<h2>From a card to a join</h2>
				<ol class="steps">
					{#each browserSteps as s, i (s.label)}
						<li>
							<span
								class="bar"
								style="width:{Math.max(
									3,
									Math.round((s.n / Math.max(1, browserSteps[0].n)) * 100)
								)}%"
							></span>
							<span class="sl">{s.label}</span>
							<span class="sn">{fmt(s.n)}</span>
							<span class="sp">{i > 0 ? pct(s.n, browserSteps[i - 1].n) : ''}</span>
						</li>
					{/each}
				</ol>
				<p class="note">
					The list page opened {fmt(data.counts.browsePageViews)} times and a server’s own page
					{fmt(data.counts.listingPageViews)} times (full page loads). Steps are separate counts,
					not one person followed through.
				</p>
			</section>
		</div>

		<section class="card">
			<h2>Listings</h2>
			{#if data.listings.length === 0}
				<p class="empty">No server is listed yet.</p>
			{:else}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th class="name-col" scope="col">Server</th>
								<th scope="col" class="cat-col">Category</th>
								{#each sortColumns as c (c.key)}
									<th
										scope="col"
										class="num"
										aria-sort={data.sort === c.key ? 'descending' : undefined}
									>
										<a
											href={href({ sort: c.key })}
											class:active={data.sort === c.key}
											data-sveltekit-noscroll
											>{c.label}{data.sort === c.key ? ' ↓' : ''}</a
										>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each data.listings as l (l.guildId)}
								<tr class:quiet={l.views === 0 && l.impressions === 0}>
									<th scope="row" class="name-col">
										<span class="ident">
											{#if l.icon}
												<img
													class="icon"
													src="https://cdn.discordapp.com/icons/{l.guildId}/{l.icon}.png?size=64"
													alt=""
													loading="lazy"
												/>
											{:else}
												<span class="icon fallback"
													>{l.name.slice(0, 1).toUpperCase()}</span
												>
											{/if}
											<span class="who">
												<a href="/servers/{l.guildId}">{l.name}</a>
												{#if !l.live}<span class="badge">not live</span
													>{/if}
											</span>
										</span>
									</th>
									<td class="cat-col">{categoryName(l.category)}</td>
									<td class="num strong">{fmt(l.joins)}</td>
									<td class="num">{fmt(l.views)}</td>
									<td class="num">{fmt(l.impressions)}</td>
									<td class="num">{rate(l.joinRate)}</td>
									<td class="num">{l.members === null ? '–' : fmt(l.members)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="card">
			<h2>Categories</h2>
			{#if data.categories.length === 0}
				<p class="empty">No categories to show yet.</p>
			{:else}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th class="name-col" scope="col">Category</th>
								<th scope="col" class="num">Listed</th>
								<th scope="col" class="num">Seen</th>
								<th scope="col" class="num">Views</th>
								<th scope="col" class="num">Joins</th>
								<th scope="col" class="num">Filtered by</th>
							</tr>
						</thead>
						<tbody>
							{#each data.categories as c (c.category)}
								<tr>
									<th scope="row" class="name-col">{categoryName(c.category)}</th>
									<td class="num">{fmt(c.listings)}</td>
									<td class="num">{fmt(c.impressions)}</td>
									<td class="num">{fmt(c.views)}</td>
									<td class="num strong">{fmt(c.joins)}</td>
									<td class="num">{fmt(c.filtered)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="note">
					“Filtered by” is how often the category was picked in the browser’s sidebar. A
					category people pick a lot but few servers fill is a gap.
				</p>
			{/if}
		</section>
	{:else}
		<div class="grid">
			<BarList title="Where visitors come from" rows={data.referrers} />
			<BarList title="Countries" rows={data.countries} />
			<BarList title="Device" rows={data.audience.device} />
			<BarList title="System" rows={data.audience.os} />
			<BarList title="Browser" rows={data.audience.browser} />
			<BarList title="Language" rows={data.audience.language} />
		</div>
		<p class="note">
			Counted from the headers of each page view and then dropped; only the label (for example
			“Firefox”, “mobile”) is kept, and only as a daily total.
		</p>
	{/if}
</div>

<style>
	.page {
		display: grid;
		gap: 1rem;
		margin-top: 1rem;
		min-width: 0;
		max-width: 1500px;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.5rem;
		align-items: flex-end;
		justify-content: space-between;
	}
	.head-text {
		min-width: 0;
		flex: 1 1 22rem;
	}
	h1 {
		margin: 0 0 0.25rem;
		font-size: 1.6rem;
	}
	h2 {
		margin: 0 0 0.75rem;
		font-size: 0.95rem;
		font-weight: 600;
	}
	.lede {
		margin: 0;
		color: var(--color-text-muted);
		max-width: 46rem;
	}
	.windows {
		display: inline-flex;
		padding: 3px;
		gap: 2px;
		background: var(--color-background-alt);
		border: 1px solid var(--color-border);
		border-radius: 999px;
	}
	.page .windows a {
		padding: 0.35rem 0.85rem;
		border-radius: 999px;
		text-decoration: none;
		color: var(--color-text-secondary);
		font-size: 0.85rem;
		font-weight: 500;
	}
	.page .windows a.active {
		background: var(--color-primary-soft);
		color: var(--color-primary);
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--color-border);
		overflow-x: auto;
	}
	.page .tabs a {
		padding: 0.6rem 1rem;
		text-decoration: none;
		color: var(--color-text-secondary);
		font-weight: 500;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		white-space: nowrap;
	}
	.page .tabs a.active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
		gap: 0.75rem;
	}
	.tile,
	.card {
		background: var(--color-background-alt);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 1rem 1.1rem;
		min-width: 0;
	}
	.tile {
		display: grid;
		gap: 0.1rem;
		align-content: start;
	}
	.tile .l {
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}
	.tile .n {
		font-size: 1.85rem;
		font-weight: 700;
		line-height: 1.15;
		font-variant-numeric: tabular-nums;
	}
	.tile .sub {
		color: var(--color-text-muted);
		font-size: 0.78rem;
	}
	.delta {
		font-weight: 600;
	}
	.delta.up {
		color: var(--color-success);
	}
	.delta.down {
		color: var(--color-danger);
	}
	.delta.flat {
		color: var(--color-text-muted);
	}
	.split {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
		gap: 1rem;
		align-items: start;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
		gap: 1rem;
	}
	.note {
		margin: 0.75rem 0 0;
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}
	.empty {
		margin: 0;
		color: var(--color-text-muted);
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	.steps li {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 3rem;
		gap: 0.6rem;
		align-items: center;
		padding: 0.45rem 0.6rem;
		border-radius: 6px;
		overflow: hidden;
		font-size: 0.9rem;
	}
	.steps .bar {
		position: absolute;
		inset: 0 auto 0 0;
		background: color-mix(in srgb, var(--color-primary) 18%, transparent);
	}
	.steps .sl,
	.steps .sn,
	.steps .sp {
		position: relative;
	}
	.steps .sn {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.steps .sp {
		text-align: right;
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}
	.table-wrap {
		overflow-x: auto;
		margin: 0 -0.25rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88rem;
	}
	th,
	td {
		padding: 0.55rem 0.6rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
	}
	thead th {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	tbody tr:last-child th,
	tbody tr:last-child td {
		border-bottom: none;
	}
	tbody tr:hover {
		background: var(--color-surface-hover);
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.strong {
		font-weight: 700;
	}
	.name-col {
		min-width: 14rem;
		font-weight: 500;
	}
	.ident {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		white-space: normal;
	}
	.cat-col {
		color: var(--color-text-secondary);
	}
	.quiet {
		opacity: 0.65;
	}
	.page th a {
		color: inherit;
		text-decoration: none;
	}
	.page th a.active {
		color: var(--color-primary);
	}
	.page th a:hover {
		text-decoration: underline;
	}
	.icon {
		flex: none;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		object-fit: cover;
		background: var(--color-surface);
	}
	.icon.fallback {
		display: grid;
		place-items: center;
		font-weight: 700;
		font-size: 0.85rem;
		background: var(--color-primary-soft);
		color: var(--color-primary);
	}
	.who {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}
	.page .who a {
		color: var(--color-text);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.page .who a:hover {
		color: var(--color-primary);
		text-decoration: underline;
	}
	.badge {
		font-size: 0.68rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--color-warning-soft);
		color: var(--color-warning);
		font-weight: 600;
	}
	@media (max-width: 640px) {
		.tiles {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.tile {
			padding: 0.8rem 0.85rem;
		}
		.tile .n {
			font-size: 1.5rem;
		}
		.name-col {
			min-width: 9rem;
		}
		.cat-col {
			display: none;
		}
		.page .tabs a {
			padding: 0.6rem 0.7rem;
		}
		.windows {
			width: 100%;
		}
		.page .windows a {
			flex: 1;
			text-align: center;
			padding: 0.35rem 0.4rem;
		}
	}
</style>
