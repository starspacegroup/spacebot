<script lang="ts">
	/**
	 * Everything the server recorded about one member. For server admins only.
	 * Counts and lists from the gateway's own records; message text is not shown here.
	 */
	import { getAvatarUrl } from '$lib/utils/avatar.js';
	import { formatDiscordEventTypeLabel } from '$lib/discord/event-metadata.js';
	import MemberLink from '$lib/components/MemberLink.svelte';

	const { data } = $props();
	const p = $derived(data.profile);
	const who = $derived(p.identity);

	function duration(seconds: number) {
		const s = Math.max(0, Math.round(seconds));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		if (h >= 10) return `${h}h`;
		if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
		if (m > 0) return `${m}m`;
		return s > 0 ? `${s}s` : '0';
	}
	function date(sql: string | null) {
		if (!sql) return 'unknown';
		const d = new Date(sql.replace(' ', 'T') + 'Z');
		return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}
	function when(sql: string | null) {
		if (!sql) return '';
		const d = new Date(sql.replace(' ', 'T') + 'Z');
		return d.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	}
	function ago(sql: string | null) {
		if (!sql) return 'never';
		const diff = Date.now() - new Date(sql.replace(' ', 'T') + 'Z').getTime();
		const mins = Math.round(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.round(mins / 60);
		if (hrs < 48) return `${hrs}h ago`;
		return `${Math.round(hrs / 24)}d ago`;
	}
	function ordinal(n: number) {
		const v = n % 100;
		const suffix =
			v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as any)[n % 10] || 'th';
		return `${n}${suffix}`;
	}
	function rank(r: number | null, population: number) {
		return r && population ? `${ordinal(r)} of ${population}` : '';
	}
	const color = (c: number) => (c ? `#${c.toString(16).padStart(6, '0')}` : 'currentColor');

	// the busiest hours, in the viewer's own time rather than UTC
	const shift = $derived(-Math.round(new Date().getTimezoneOffset() / 60));
	function localHours(utc: number[]) {
		const out = new Array(24).fill(0);
		utc.forEach((v, h) => (out[(((h + shift) % 24) + 24) % 24] += v));
		return out;
	}
	const msgHours = $derived(localHours(p.hours.messages));
	const voiceHours = $derived(localHours(p.hours.voice));
	const maxMsg = $derived(Math.max(1, ...msgHours));
	const maxVoice = $derived(Math.max(1, ...voiceHours));
	const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;

	const maxChanVoice = $derived(Math.max(1, ...p.voiceChannels.map((c) => c.seconds)));
	const maxChanMsg = $derived(Math.max(1, ...p.messageChannels.map((c) => c.messages)));
	const a = $derived(p.activity);

	const partLabels: Record<string, string> = {
		member: 'member record',
		activity: 'totals',
		'voice sessions': 'voice',
		'message channels': 'messages',
		'message hours': 'message hours',
		commands: 'commands',
		'recent events': 'recent events',
		moderation: 'moderation',
		roles: 'roles',
		people: 'people they talk with',
	};
</script>

<svelte:head>
	<title>{who.name} - Member | SpaceBot</title>
</svelte:head>

<div class="mp">
	<a class="mp-back" href="/admin/{data.serverId}/stats?tab=voice">← Statistics</a>

	<header class="mp-head">
		<img
			class="mp-av"
			src={getAvatarUrl(who.id, who.avatar, who.discriminator, 128)}
			alt=""
			width="72"
			height="72"
		/>
		<div class="mp-id">
			<h1>
				{who.name}
				{#if who.bot}<span class="mp-tag">Bot</span>{/if}
				{#if who.owner}<span class="mp-tag">Owner</span>{/if}
				{#if !who.inServer}<span class="mp-tag warn">Not in the server</span>{/if}
				{#if who.timeoutUntil}<span class="mp-tag warn">Timed out</span>{/if}
			</h1>
			<p class="mp-sub">
				{#if who.username}@{who.username}{/if}
				<span class="mp-muted">· {who.id}</span>
			</p>
			<p class="mp-facts">
				<span>Joined the server {date(who.joinedAt)}</span>
				<span>Account created {date(who.createdAt)}</span>
				{#if who.boostingSince}<span>Boosting since {date(who.boostingSince)}</span>{/if}
			</p>
			{#if who.roles.length}
				<ul class="mp-roles">
					{#each who.roles as r, i (i)}
						<li style="--role: {color(r.color)}"><i></i>{r.name}</li>
					{/each}
				</ul>
			{/if}
		</div>
		<nav class="mp-days" aria-label="Range">
			{#each data.dayChoices as d (d)}
				<a
					href="?days={d}"
					class:on={p.days === d}
					aria-current={p.days === d ? 'page' : undefined}>{d}d</a
				>
			{/each}
		</nav>
	</header>

	{#if p.failedParts.length}
		<p class="mp-banner" role="alert">
			Could not read: {p.failedParts.map((k) => partLabels[k] || k).join(', ')}. Those parts
			are blank, not zero.
		</p>
	{/if}

	{#if a}
		<section class="mp-tiles" aria-label="Last {p.days} days">
			<div class="mp-tile">
				<b>{a.activity.messages.toLocaleString()}</b>
				<span>messages</span>
				<small>{rank(a.standing.messageRank, a.standing.messagePopulation)}</small>
			</div>
			<div class="mp-tile">
				<b>{duration(a.activity.voiceSeconds)}</b>
				<span>in voice</span>
				<small>{rank(a.standing.voiceRank, a.standing.voicePopulation)}</small>
			</div>
			<div class="mp-tile">
				<b>{a.activity.voiceSessions.toLocaleString()}</b>
				<span>voice visits</span>
				<small>{a.activity.voiceChannels} channels</small>
			</div>
			<div class="mp-tile">
				<b>{a.activity.commands.toLocaleString()}</b>
				<span>commands run</span>
			</div>
			<div class="mp-tile">
				<b>{a.activity.channels.toLocaleString()}</b>
				<span>text channels used</span>
			</div>
			<div class="mp-tile">
				<b>{ago(a.activity.lastMessageAt)}</b>
				<span>last message</span>
				<small>last voice {ago(a.activity.lastVoiceAt)}</small>
			</div>
		</section>
		{#if a.unrecordedChannels > 0}
			<p class="mp-note">
				{a.unrecordedChannels} channel{a.unrecordedChannels === 1 ? ' is' : 's are'} not recorded
				by this server, so activity there is not counted.
			</p>
		{/if}
	{/if}

	<div class="mp-grid">
		<section class="mp-card">
			<h2>Voice, by channel</h2>
			{#if p.voiceChannels.length === 0}
				<p class="mp-empty">No voice time in this range.</p>
			{:else}
				<ul class="mp-bars">
					{#each p.voiceChannels as c, i (i)}
						<li>
							<span class="mp-bar-name" title={c.channel}>{c.channel}</span>
							<span class="mp-bar"
								><i style="width:{(c.seconds / maxChanVoice) * 100}%"></i></span
							>
							<span class="mp-bar-val">{duration(c.seconds)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="mp-card">
			<h2>Messages, by channel</h2>
			{#if p.messageChannels.length === 0}
				<p class="mp-empty">No messages in this range.</p>
			{:else}
				<ul class="mp-bars">
					{#each p.messageChannels as c, i (i)}
						<li>
							<span class="mp-bar-name" title={c.channel}>{c.channel}</span>
							<span class="mp-bar"
								><i style="width:{(c.messages / maxChanMsg) * 100}%"></i></span
							>
							<span class="mp-bar-val">{c.messages.toLocaleString()}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="mp-card">
			<h2>Most time in voice with</h2>
			{#if p.withPeople.length === 0}
				<p class="mp-empty">Nobody else was in voice with them in this range.</p>
			{:else}
				<ul class="mp-people">
					{#each p.withPeople as o, i (i)}
						<li>
							<MemberLink id={o.id} serverId={data.serverId} label={o.name}>
								<img
									src={getAvatarUrl(o.id, o.avatar, o.discriminator, 64)}
									alt=""
									width="28"
									height="28"
									loading="lazy"
								/>
								<span class="mp-pname">{o.name}</span>
							</MemberLink>
							<span class="mp-bar-val">{duration(o.seconds)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="mp-card">
			<h2>When they are active <small>(your time)</small></h2>
			<div class="mp-hours" role="img" aria-label="Activity by hour of day">
				{#each msgHours as m, h (h)}
					<div
						class="mp-hour"
						title="{hourLabel(h)}: {m} messages, {duration(voiceHours[h])} voice"
					>
						<i class="msg" style="height:{(m / maxMsg) * 100}%"></i>
						<i class="voice" style="height:{(voiceHours[h] / maxVoice) * 100}%"></i>
						{#if h % 6 === 0}<em>{hourLabel(h)}</em>{/if}
					</div>
				{/each}
			</div>
			<p class="mp-legend"><i class="msg"></i> messages <i class="voice"></i> voice</p>
		</section>

		<section class="mp-card">
			<h2>Recent voice visits</h2>
			{#if p.voiceRecent.length === 0}
				<p class="mp-empty">None in this range.</p>
			{:else}
				<ul class="mp-rows">
					{#each p.voiceRecent as v, i (i)}
						<li>
							<span>{v.channel}</span>
							<span class="mp-muted">{when(v.joined_at)}</span>
							<span class="mp-bar-val"
								>{v.left_at ? duration(v.seconds) : 'in voice now'}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="mp-card">
			<h2>Commands</h2>
			{#if p.commands.length === 0}
				<p class="mp-empty">No commands run in this range.</p>
			{:else}
				<ul class="mp-rows">
					{#each p.commands as c, i (i)}
						<li>
							<span>/{c.command}</span>
							<span class="mp-muted">last {ago(c.last)}</span>
							<span class="mp-bar-val">{c.uses}×</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="mp-card wide">
			<h2>Recent events</h2>
			{#if p.recentEvents.length === 0}
				<p class="mp-empty">Nothing besides messages in this range.</p>
			{:else}
				<ul class="mp-rows">
					{#each p.recentEvents as e, i (i)}
						<li>
							<a href="/admin/{data.serverId}/logs/{e.id}"
								>{formatDiscordEventTypeLabel(e.type)}</a
							>
							<span class="mp-muted"
								>{e.channel ? `${e.channel}` : ''}{e.other
									? ` · ${e.as === 'actor' ? 'to' : 'by'} ${e.other}`
									: ''}</span
							>
							<span class="mp-muted">{when(e.at)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if p.moderation.length}
			<section class="mp-card wide">
				<h2>Moderation</h2>
				<ul class="mp-rows">
					{#each p.moderation as m, i (i)}
						<li>
							<a href="/admin/{data.serverId}/logs/{m.id}"
								>{formatDiscordEventTypeLabel(m.type)}</a
							>
							<span class="mp-muted">{m.by ? `by ${m.by}` : ''}</span>
							<span class="mp-muted">{when(m.at)}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>

	<p class="mp-foot">
		Events are kept {p.retentionDays} days, so nothing here reaches further back than that. Message
		text is not shown; read it in the <a href="/admin/{data.serverId}/logs">logs</a>.
	</p>
</div>

<style>
	.mp {
		max-width: 76rem;
		margin: 0 auto;
		padding: 1.25rem 1rem 3rem;
		display: grid;
		gap: 1rem;
	}
	.mp-back {
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.9rem;
	}
	.mp-head {
		display: flex;
		gap: 1.1rem;
		align-items: flex-start;
		flex-wrap: wrap;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.1rem 1.25rem;
		box-shadow: var(--shadow-sm);
	}
	.mp-av {
		border-radius: 50%;
		object-fit: cover;
		flex: none;
	}
	.mp-id {
		flex: 1 1 18rem;
		min-width: 0;
	}
	.mp-id h1 {
		margin: 0;
		font-size: 1.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.mp-tag {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
	}
	.mp-tag.warn {
		border-color: #c0553a;
		color: #e88a70;
	}
	.mp-sub,
	.mp-facts {
		margin: 0.25rem 0 0;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
	.mp-facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1.1rem;
	}
	.mp-muted {
		color: var(--color-text-muted);
	}
	.mp-roles {
		list-style: none;
		margin: 0.7rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.mp-roles li {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.78rem;
		padding: 0.15rem 0.55rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
	}
	.mp-roles i {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: var(--role);
	}
	.mp-days {
		display: flex;
		gap: 0.25rem;
	}
	.mp-days a {
		padding: 0.3rem 0.7rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		color: inherit;
		text-decoration: none;
		font-size: 0.85rem;
	}
	.mp-days a.on {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-primary-button-text, var(--color-text-inverse));
	}
	.mp-banner,
	.mp-note {
		margin: 0;
		padding: 0.6rem 0.9rem;
		border-radius: var(--radius-md);
		font-size: 0.88rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
	}
	.mp-banner {
		border-color: #c0553a;
	}
	.mp-tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
		gap: 0.75rem;
	}
	.mp-tile {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 0.8rem 1rem;
		display: grid;
		gap: 0.1rem;
	}
	.mp-tile b {
		font-size: 1.5rem;
	}
	.mp-tile span,
	.mp-tile small {
		color: var(--color-text-muted);
		font-size: 0.82rem;
	}
	.mp-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
		gap: 1rem;
	}
	.mp-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem 1.15rem;
		box-shadow: var(--shadow-sm);
		min-width: 0;
	}
	.mp-card.wide {
		grid-column: 1 / -1;
	}
	.mp-card h2 {
		margin: 0 0 0.7rem;
		font-size: 1rem;
	}
	.mp-card h2 small {
		font-weight: 400;
		color: var(--color-text-muted);
	}
	.mp-empty {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
	.mp-bars,
	.mp-people,
	.mp-rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.45rem;
	}
	.mp-bars li {
		display: grid;
		grid-template-columns: minmax(5rem, 9rem) 1fr auto;
		gap: 0.6rem;
		align-items: center;
		font-size: 0.88rem;
	}
	.mp-bar-name,
	.mp-pname {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mp-bar {
		height: 0.55rem;
		border-radius: 999px;
		background: var(--color-surface-elevated);
		overflow: hidden;
	}
	.mp-bar i {
		display: block;
		height: 100%;
		background: var(--color-primary);
		border-radius: 999px;
	}
	.mp-bar-val {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		font-size: 0.88rem;
	}
	.mp-people li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
		gap: 0.6rem;
	}
	.mp-people img {
		border-radius: 50%;
	}
	.mp-rows li {
		display: grid;
		grid-template-columns: minmax(6rem, 1.2fr) 1.4fr auto;
		gap: 0.6rem;
		font-size: 0.88rem;
		align-items: baseline;
	}
	.mp-rows a {
		color: inherit;
	}
	.mp-hours {
		display: grid;
		grid-template-columns: repeat(24, 1fr);
		gap: 2px;
		height: 6rem;
		align-items: end;
		padding-bottom: 1rem;
	}
	.mp-hour {
		position: relative;
		height: 100%;
		display: flex;
		align-items: flex-end;
		gap: 1px;
	}
	.mp-hour i,
	.mp-legend i {
		display: block;
		flex: 1;
		border-radius: 2px 2px 0 0;
		min-height: 1px;
	}
	.mp-hour em {
		position: absolute;
		bottom: -1rem;
		left: 0;
		font-size: 0.65rem;
		font-style: normal;
		color: var(--color-text-muted);
	}
	i.msg {
		background: var(--color-primary);
	}
	i.voice {
		background: #4fb3a3;
	}
	.mp-legend {
		margin: 0.4rem 0 0;
		font-size: 0.78rem;
		color: var(--color-text-muted);
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.mp-legend i {
		display: inline-block;
		width: 0.7rem;
		height: 0.7rem;
		flex: none;
		border-radius: 2px;
	}
	.mp-foot {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
</style>
