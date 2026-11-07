<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n.js';

	const { data, form } = $props();

	const AREAS = [
		'commands',
		'dashboard',
		'games',
		'automations',
		'logging',
		'server_browser',
		'other',
	];
	const STATUSES = ['new', 'reviewing', 'planned', 'shipped', 'declined', 'duplicate'];
	let sending = $state(false);
	const date = (iso: string) => iso.slice(0, 10);
</script>

<svelte:head><title>{t(data.locale, 'ideas.pageTitle')}</title></svelte:head>

<section class="ideas">
	<h1>{t(data.locale, 'ideas.title')}</h1>
	<p class="lead">{t(data.locale, 'ideas.intro')}</p>

	{#if !data.signedIn}
		<div class="card">
			<p>{t(data.locale, 'ideas.signInNeeded')}</p>
			<a class="primary" href="/login?return_to=/ideas">{t(data.locale, 'ideas.signIn')}</a>
		</div>
	{:else}
		{#if form?.saved}
			<div class="notice ok" role="status">{t(data.locale, 'ideas.saved')}</div>
		{/if}
		{#if form?.error}
			<div class="notice bad" role="alert">{form.error}</div>
		{/if}

		<form
			method="POST"
			class="card"
			use:enhance={() => {
				sending = true;
				return async ({ update }) => {
					await update();
					sending = false;
				};
			}}
		>
			<label for="idea-body">{t(data.locale, 'ideas.bodyLabel')}</label>
			<textarea
				id="idea-body"
				name="body"
				rows="6"
				minlength="20"
				maxlength="2000"
				required
				placeholder={t(data.locale, 'ideas.bodyPlaceholder')}
				>{form?.values?.body ?? ''}</textarea
			>

			<div class="row">
				<div class="field">
					<label for="idea-title">{t(data.locale, 'ideas.titleLabel')}</label>
					<input
						id="idea-title"
						name="title"
						maxlength="100"
						value={form?.values?.title ?? ''}
					/>
				</div>
				<div class="field">
					<label for="idea-area">{t(data.locale, 'ideas.areaLabel')}</label>
					<select id="idea-area" name="area">
						{#each AREAS as a}
							<option value={a} selected={(form?.values?.area ?? 'other') === a}
								>{t(data.locale, `ideas.area.${a}`)}</option
							>
						{/each}
					</select>
				</div>
			</div>

			<p class="small">{t(data.locale, 'ideas.disclosure')}</p>
			<button class="primary" type="submit" disabled={sending}>
				{t(data.locale, 'ideas.submit')}
			</button>
		</form>

		<h2>{t(data.locale, 'ideas.mineTitle')}</h2>
		{#if data.mine.length === 0}
			<p class="small">{t(data.locale, 'ideas.mineEmpty')}</p>
		{:else}
			<ul class="mine">
				{#each data.mine as idea (idea.id)}
					<li>
						<span class="mine-title">{idea.title}</span>
						<span class="mine-meta">
							<span class="chip">
								{t(
									data.locale,
									`ideas.status.${STATUSES.includes(idea.status) ? idea.status : 'new'}`
								)}
							</span>
							<time datetime={idea.created_at}>{date(idea.created_at)}</time>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<style>
	.ideas {
		max-width: 760px;
		margin: 0 auto;
		padding: 3rem 1rem 4rem;
	}
	h1 {
		font-size: 2.25rem;
		margin: 0 0 0.75rem;
	}
	h2 {
		margin: 2.5rem 0 0.75rem;
		font-size: 1.25rem;
	}
	.lead {
		color: var(--color-text-secondary);
		margin: 0 0 1.5rem;
		line-height: 1.5;
	}
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	label {
		font-weight: 600;
		font-size: 0.9rem;
	}
	textarea,
	input,
	select {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}
	textarea {
		resize: vertical;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	@media (max-width: 560px) {
		.row {
			grid-template-columns: 1fr;
		}
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.small {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		margin: 0.25rem 0;
	}
	.primary {
		align-self: flex-start;
		display: inline-block;
		padding: 0.7rem 1.1rem;
		border: 0;
		border-radius: var(--radius-md);
		background: var(--color-primary-button);
		color: white;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.notice {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		margin-bottom: 1rem;
		border: 1px solid var(--color-border);
	}
	.notice.ok {
		border-color: var(--color-success, #2e9e5b);
	}
	.notice.bad {
		border-color: var(--color-danger, #d64545);
	}
	.mine {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.mine li {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		padding: 0.7rem 0.9rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}
	.mine-title {
		overflow-wrap: anywhere;
	}
	.mine-meta {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		white-space: nowrap;
		font-size: 0.85rem;
		color: var(--color-text-secondary);
	}
	.chip {
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
	}
	@media (max-width: 560px) {
		.mine li {
			flex-direction: column;
		}
	}
</style>
