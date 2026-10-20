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
	}: {
		base: string;
		token: string;
		guildId: string;
		/** Dev only: a canned view, so layouts can be checked without Discord. */
		preview?: View | null;
	} = $props();

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
		if (h < 48) return `closes in ${h} h${m % 60 ? ` ${m % 60} m` : ''}`;
		return `closes in ${Math.floor(h / 24)} days`;
	}

	function outcome(q: Item): string {
		if (q.status === 'vetoed') return 'Vetoed by the owner';
		if (q.status === 'no_quorum') return `No quorum (${q.total} of ${q.quorum})`;
		if (q.result === 'tie') return 'Tied';
		return q.result === 'yes' ? 'Passed' : 'Did not pass';
	}

	// The bar is measured against the quorum until it is reached, so the grey end
	// shows how far a question still is from counting.
	const pct = (n: number, q: Item) => {
		const scale = Math.max(q.total, q.quorum, 1);
		return Math.round((n / scale) * 100);
	};

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
		<p class="st">Loading…</p>
	{:else}
		{#if view.open.length === 0}
			<p class="st">No open questions</p>
			<h2 class="hl md">Nothing to vote on</h2>
			<p class="sub">No open question you can see. Ask one below.</p>
		{/if}

		{#each view.open as q, i (q.id)}
			<article class="q" class:first={i === 0}>
				<p class="st">
					{[
						'Open question',
						q.channel_name ? `#${q.channel_name}` : '',
						left(q.closes_at),
					]
						.filter(Boolean)
						.join(' · ')}
				</p>
				<p class="text">{q.question}</p>
				<div class="bar" aria-hidden="true">
					<span style:width="{pct(q.yes, q)}%" style:background="var(--s)"></span>
					<span style:width="{pct(q.no, q)}%" style:background="var(--r)"></span>
					<span style:width="{pct(q.abstain, q)}%" style:background="var(--l)"></span>
				</div>
				<p class="st counts">
					{q.yes} yes · {q.no} no · {q.abstain} abstain · quorum {q.quorum}
					{q.reached ? 'reached' : `· ${q.quorum - q.total} to go`}
				</p>
				<div class="btns" role="group" aria-label="Your vote">
					{#each CHOICES as c (c.value)}
						<button
							type="button"
							class="btn {c.value === 'yes' ? 's' : c.value === 'no' ? 'r' : 'l'}"
							class:on={q.my_vote === c.value}
							aria-pressed={q.my_vote === c.value}
							disabled={busy}
							onclick={() =>
								act({ action: 'vote', question_id: q.id, choice: c.value })}
						>
							{c.label}{q.my_vote === c.value ? ' ✓' : ''}
						</button>
					{/each}
				</div>
			</article>
		{/each}

		<section class="ask-wrap" aria-label="Ask a question">
			<p class="st">Ask a question</p>
			{#if view.can_ask}
				<form class="ask" onsubmit={ask}>
					<label class="grow">
						<span class="sr">Yes or no question</span>
						<textarea
							bind:value={text}
							maxlength="240"
							rows="2"
							placeholder="Should we move game night to Friday?"
							required></textarea>
					</label>
					<label>
						<span class="note">Stays open (default {view.default_closes})</span>
						<input bind:value={closes} placeholder="24h, 90m, 2d" maxlength="12" />
					</label>
					<button class="btn o" disabled={busy || !text.trim()}>Post the question</button>
				</form>
				<p class="note">
					It goes to this voice channel's chat. Members vote there or here.
				</p>
			{:else}
				<p class="note">
					Open the Activity in a voice channel you can see to ask a question there.
				</p>
			{/if}
		</section>

		{#if view.settled.length > 0}
			<section aria-label="Decided lately">
				<p class="st">Decided lately</p>
				<ul class="settled">
					{#each view.settled as q (q.id)}
						<li>
							<span class="sq">{q.question}</span>
							<span
								class="out"
								class:pass={q.result === 'yes' && q.status === 'closed'}
								>{outcome(q)}</span
							>
							<span class="note">{q.yes} yes · {q.no} no · {q.abstain} abstain</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>

<style>
	.quorum {
		display: flex;
		flex-direction: column;
		gap: 1.4em;
	}
	.q {
		display: flex;
		flex-direction: column;
		gap: 0.7em;
	}
	.q .text {
		font-size: min(2.2em, 8vw);
		line-height: 1.1;
		font-weight: 600;
		color: var(--p);
		overflow-wrap: anywhere;
	}
	.q.first .text {
		font-size: min(2.9em, 9vw);
	}
	.bar {
		display: flex;
		height: 2em;
		border-radius: 1em;
		overflow: hidden;
		background: var(--well);
		max-width: 50em;
	}
	.counts {
		font-size: 1.4em;
	}
	.q :global(.btn.on) {
		box-shadow:
			0 0 0 0.12em var(--ink),
			0 0 0 0.26em var(--white);
	}
	.ask-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.6em;
	}
	.ask {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7em;
		align-items: flex-end;
	}
	.ask label {
		display: flex;
		flex-direction: column;
		gap: 0.25em;
		min-width: 0;
	}
	.ask .grow {
		flex: 1 1 18em;
	}
	.ask textarea,
	.ask input {
		font: inherit;
		font-size: 1.2em;
		letter-spacing: 0.05em;
		color: var(--p);
		background: var(--ink);
		border: 0.12em solid var(--l);
		border-radius: 0.9em;
		padding: 0.45em 0.8em;
		min-width: 0;
		resize: vertical;
	}
	.ask input {
		width: 9em;
		border-radius: 2em;
	}
	.settled {
		list-style: none;
		margin: 0.4em 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45em;
	}
	.settled li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3em 0.9em;
		border-left: 0.6em solid var(--l);
		padding-left: 0.7em;
	}
	.settled .sq {
		font-size: 1.2em;
		color: var(--p);
		overflow-wrap: anywhere;
	}
	.settled .out {
		color: var(--r);
		font-weight: 600;
	}
	.settled .out.pass {
		color: var(--s);
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
