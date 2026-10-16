<script lang="ts">
	/**
	 * The Activity's Quorum tab: the server's open yes/no questions, a vote on
	 * each, and a box to ask one. It shows only what the server says this viewer
	 * may see (a question in a private channel never arrives), and the viewer's
	 * own vote is the only vote it knows. The page polls, and after every move.
	 */
	import { onMount } from 'svelte';

	type Choice = 'yes' | 'no' | 'abstain';
	type Item = {
		id: number;
		question: string;
		channel_id: string;
		channel_name: string | null;
		closes_at: number | null;
		quorum: number;
		yes: number;
		no: number;
		abstain: number;
		total: number;
		reached: boolean;
		my_vote: Choice | null;
		status: 'open' | 'closed' | 'no_quorum' | 'vetoed';
		result: 'yes' | 'no' | 'tie' | null;
		asked_by_me: boolean;
	};
	type View = {
		ask_channel_id: string | null;
		can_ask: boolean;
		min_closes: string;
		max_closes: string;
		default_closes: string;
		open: Item[];
		settled: Item[];
	};

	const {
		base,
		token,
		guildId,
		preview = null,
	} = $props<{
		base: string;
		token: string;
		guildId: string;
		/** Dev only: a canned view, so layouts can be checked without Discord. */
		preview?: View | null;
	}>();

	let view = $state<View | null>(null);
	let problem = $state('');
	let busy = $state(false);
	let text = $state('');
	let closes = $state('');
	let now = $state(Date.now());

	const CHOICES: { value: Choice; label: string }[] = [
		{ value: 'yes', label: 'Yes' },
		{ value: 'no', label: 'No' },
		{ value: 'abstain', label: 'Abstain' },
	];

	function left(unix: number | null): string {
		if (!unix) return '';
		const s = Math.max(0, Math.floor(unix - now / 1000));
		if (s < 60) return 'closes in under a minute';
		const m = Math.floor(s / 60);
		if (m < 60) return `closes in ${m} min`;
		const h = Math.floor(m / 60);
		if (h < 48) return `closes in ${h} h`;
		return `closes in ${Math.floor(h / 24)} days`;
	}

	function outcome(q: Item): string {
		if (q.status === 'vetoed') return 'Vetoed by the owner';
		if (q.status === 'no_quorum') return `No quorum (${q.total} of ${q.quorum})`;
		if (q.result === 'tie') return 'Tied';
		return q.result === 'yes' ? 'Passed' : 'Did not pass';
	}

	const pct = (n: number, q: Item) => (q.total === 0 ? 0 : Math.round((n / q.total) * 100));

	async function call(body: Record<string, unknown>) {
		const res = await fetch(`${base}/api/activity/quorum`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
			body: JSON.stringify({ guild_id: guildId, ...body }),
		});
		const json = await res.json().catch(() => ({}));
		return { ok: res.ok, json };
	}

	async function load() {
		if (preview) return;
		try {
			const { ok, json } = await call({});
			if (ok) {
				view = json;
				problem = '';
			} else if (json.message) {
				problem = json.message;
			}
		} catch {
			// Keep what is on screen; the next poll tries again.
		}
	}

	async function act(body: Record<string, unknown>): Promise<boolean> {
		if (busy || preview) return false;
		busy = true;
		problem = '';
		let ok = false;
		try {
			const res = await call(body);
			ok = res.ok;
			if (!ok) problem = res.json.error || res.json.message || 'That did not work.';
		} catch {
			problem = 'Could not reach the server.';
		} finally {
			busy = false;
			await load();
		}
		return ok;
	}

	async function ask(e: SubmitEvent) {
		e.preventDefault();
		if (await act({ action: 'ask', question: text, closes })) {
			text = '';
			closes = '';
		}
	}

	onMount(() => {
		if (preview) view = preview;
		else load();
		const poll = setInterval(load, 5000);
		const tick = setInterval(() => (now = Date.now()), 30000);
		return () => {
			clearInterval(poll);
			clearInterval(tick);
		};
	});
</script>

<div class="quorum">
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

	{#if !view}
		<p class="quiet">Loading…</p>
	{:else}
		{#if view.open.length === 0}
			<p class="quiet">No open questions you can see. Ask one below.</p>
		{/if}

		{#each view.open as q (q.id)}
			<article class="q">
				<p class="text">{q.question}</p>
				<p class="quiet meta">
					{q.channel_name ? `#${q.channel_name} · ` : ''}{left(q.closes_at)} · {q.total}
					{q.total === 1 ? 'vote' : 'votes'}, {q.quorum} needed
				</p>
				<div class="bar" aria-hidden="true">
					<span class="yes" style:width="{pct(q.yes, q)}%"></span>
					<span class="no" style:width="{pct(q.no, q)}%"></span>
					<span class="abs" style:width="{pct(q.abstain, q)}%"></span>
				</div>
				<p class="quiet meta">{q.yes} yes · {q.no} no · {q.abstain} abstain</p>
				<div class="row" role="group" aria-label="Your vote">
					{#each CHOICES as c (c.value)}
						<button
							type="button"
							class="pick"
							class:on={q.my_vote === c.value}
							aria-pressed={q.my_vote === c.value}
							disabled={busy}
							onclick={() =>
								act({ action: 'vote', question_id: q.id, choice: c.value })}
						>
							{c.label}
						</button>
					{/each}
				</div>
			</article>
		{/each}

		<h3>Ask a question</h3>
		{#if view.can_ask}
			<form class="ask" onsubmit={ask}>
				<label>
					<span>Yes or no</span>
					<textarea
						bind:value={text}
						maxlength="240"
						rows="2"
						placeholder="Should we move game night to Friday?"
						required></textarea>
				</label>
				<label>
					<span>Stays open (default {view.default_closes})</span>
					<input bind:value={closes} placeholder="24h, 90m, 2d" maxlength="12" />
				</label>
				<button class="btn primary" disabled={busy || !text.trim()}
					>Post the question</button
				>
				<p class="quiet meta">
					It goes to this voice channel's chat. Members vote there or here.
				</p>
			</form>
		{:else}
			<p class="quiet">
				Open the Activity in a voice channel you can see to ask a question there.
			</p>
		{/if}

		{#if view.settled.length > 0}
			<h3>Decided lately</h3>
			{#each view.settled as q (q.id)}
				<article class="q settled">
					<p class="text">{q.question}</p>
					<p class="quiet meta">
						<strong>{outcome(q)}</strong> · {q.yes} yes · {q.no} no · {q.abstain} abstain
					</p>
				</article>
			{/each}
		{/if}
	{/if}
</div>

<style>
	.quorum {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	h3 {
		margin: 0.5rem 0 0;
		font-size: 1rem;
	}
	.quiet {
		color: var(--color-text-secondary);
		margin: 0;
	}
	.quorum .meta {
		font-size: 0.85rem;
	}
	.problem {
		margin: 0;
		color: var(--color-danger);
	}
	.q {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
	}
	.q .text {
		margin: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.bar {
		display: flex;
		height: 0.5rem;
		border-radius: 0.25rem;
		overflow: hidden;
		background: var(--color-border);
	}
	.bar .yes {
		background: var(--color-success, #3ba55d);
	}
	.bar .no {
		background: var(--color-danger);
	}
	.bar .abs {
		background: var(--color-text-secondary);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.pick,
	.btn {
		background: var(--color-surface);
		color: inherit;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		padding: 0.5rem 1rem;
		font: inherit;
		cursor: pointer;
	}
	.pick.on {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-fixed-text-bright);
		font-weight: 600;
	}
	.btn.primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-fixed-text-bright);
		font-weight: 600;
	}
	.pick:disabled,
	.btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.ask {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.ask label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.ask textarea,
	.ask input {
		font: inherit;
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		padding: 0.5rem;
		min-width: 0;
	}
	.settled {
		opacity: 0.85;
	}
</style>
