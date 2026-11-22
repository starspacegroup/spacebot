<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from '$lib/toast.svelte.js';
	import { getTranslator } from '$lib/i18n.js';
	import { formatMemberCount, serverHue, serverInitials } from '$lib/server-listing-display.js';

	const tr = getTranslator();
	const { data, form } = $props();

	// ---------------------------------------------------------------- form state
	// Publishing is opt-in: `listed` starts as whatever is stored and only changes when
	// the admin presses Publish or Unpublish.
	// svelte-ignore state_referenced_locally
	const initial = data.listing;
	let listed = $state(Boolean(initial?.listed));
	let headline = $state(initial?.headline || '');
	let description = $state(initial?.description || '');
	let category = $state(initial?.category || 'community');
	let tags = $state<string[]>([...(initial?.tags || [])]);
	let invite = $state(initial?.invite_url || '');
	let showMembers = $state(initial?.show_member_count !== false);
	let nsfw = $state(Boolean(initial?.nsfw));
	let tagDraft = $state('');

	const limits = $derived(
		data.limits || { headline: 120, description: 1000, tags: 8, tagLength: 24 }
	);
	const server = $derived(data.server);

	const CATEGORY_ICONS: Record<string, string> = {
		community: '🏘️',
		gaming: '🎮',
		tech: '💻',
		creative: '🎨',
		music: '🎵',
		education: '📚',
		business: '💼',
		science: '🔬',
		support: '🛟',
		other: '✨',
	};

	// Starting points, not rules. Tags are public text, so these stay in English.
	const TAG_IDEAS: Record<string, string[]> = {
		community: ['friendly', 'chill', 'hangout', 'events', 'all ages'],
		gaming: ['multiplayer', 'co-op', 'ranked', 'casual', 'lfg'],
		tech: ['coding', 'open source', 'web dev', 'help', 'projects'],
		creative: ['art', 'feedback', 'writing', 'design', 'showcase'],
		music: ['producers', 'listening', 'feedback', 'live', 'beats'],
		education: ['study', 'homework help', 'languages', 'tutoring', 'courses'],
		business: ['networking', 'startups', 'freelance', 'marketing', 'careers'],
		science: ['research', 'space', 'discussion', 'learning', 'news'],
		support: ['help', 'friendly', 'questions', 'guides', 'community'],
		other: ['friendly', 'active', 'events', 'chat', 'new members'],
	};

	const categoryLabel = $derived(
		data.categories?.find((c) => c.value === category)?.label || category
	);

	// --------------------------------------------------------------- readiness
	const INVITE_SHAPE =
		/^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)[A-Za-z0-9-]{2,64}\/?$/i;
	const inviteLooksRight = $derived(INVITE_SHAPE.test(invite.trim()));
	const inviteHref = $derived(
		inviteLooksRight
			? invite.trim().startsWith('http')
				? invite.trim()
				: `https://${invite.trim()}`
			: null
	);

	/** Needed before the server can go public. */
	const blockers = $derived(
		[
			headline.trim() ? null : { id: 'headline', text: tr('lst.needHeadline') },
			invite.trim() && inviteLooksRight
				? null
				: {
						id: 'invite',
						text: invite.trim() ? tr('lst.needInviteValid') : tr('lst.needInvite'),
					},
		].filter((b): b is { id: string; text: string } => Boolean(b))
	);

	/** Not needed, but listings with these get joined more. */
	const checklist = $derived([
		{
			id: 'headline',
			label: tr('lst.checkHeadline'),
			done: Boolean(headline.trim()),
			required: true,
		},
		{
			id: 'invite',
			label: tr('lst.checkInvite'),
			done: Boolean(invite.trim()) && inviteLooksRight,
			required: true,
		},
		{
			id: 'description',
			label: tr('lst.checkDescription'),
			done: description.trim().length >= 80,
			required: false,
		},
		{ id: 'tags', label: tr('lst.checkTags'), done: tags.length >= 3, required: false },
		{ id: 'icon', label: tr('lst.checkIcon'), done: Boolean(server?.iconUrl), required: false },
	]);
	const doneCount = $derived(checklist.filter((c) => c.done).length);
	const percent = $derived(Math.round((doneCount / checklist.length) * 100));

	const rejected = $derived(data.listing?.review_status === 'rejected');

	type Mode = 'removed' | 'hidden' | 'fix' | 'live' | 'draft' | 'ready';
	const mode: Mode = $derived(
		rejected
			? 'removed'
			: listed && blockers.length > 0
				? 'fix'
				: listed && !data.listingVisible
					? 'hidden'
					: listed
						? 'live'
						: blockers.length > 0
							? 'draft'
							: 'ready'
	);

	// ------------------------------------------------------------------ saving
	let formEl = $state<HTMLFormElement | null>(null);
	let saveState = $state<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
	let savedAt = $state<number | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let listedAtSubmit = false;

	// A pending AI draft is never saved by itself: this copy is public, and nobody should
	// have machine-written text go live before reading it.
	let draftPending = $state(false);
	const canSave = $derived(!draftPending && (!listed || blockers.length === 0));

	function queueSave(immediately = false) {
		if (timer) clearTimeout(timer);
		saveState = 'dirty';
		if (!canSave) return;
		timer = setTimeout(
			() => {
				formEl?.requestSubmit();
			},
			immediately ? 0 : 700
		);
	}

	function setListed(value: boolean) {
		listed = value;
		queueSave(true);
	}

	// Where the caret is, kept current as the admin types. A save round trip can take the
	// focus away; this is how the caret goes back to where they actually are.
	let caret: { el: HTMLInputElement | HTMLTextAreaElement; start: number; end: number } | null =
		null;
	function trackCaret(event: Event) {
		const el = event.target as HTMLInputElement | HTMLTextAreaElement;
		if (el && typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
			caret = { el, start: el.selectionStart, end: el.selectionEnd };
		}
	}

	const submitEnhance = () => {
		saveState = 'saving';
		listedAtSubmit = listed;
		// SvelteKit moves focus to the page body after a form action, which would kick the
		// cursor out of whatever the admin is typing in. Remember it and put it back.
		const active = document.activeElement as HTMLElement | null;
		const typing = active && formEl?.contains(active) ? active : null;
		return async ({ result, update }: { result: any; update: (o?: any) => Promise<void> }) => {
			// Refresh page data only when going live or going private, since that is when
			// "is it actually visible" can change. Ordinary edits stay put.
			const changedVisibility = listedAtSubmit !== Boolean(data.listing?.listed);
			await update({ reset: false, invalidateAll: changedVisibility });
			if (typing) {
				// SvelteKit resets the selection a tick after the action settles, so wait it out.
				await new Promise((resolve) => setTimeout(resolve, 0));
				await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
			}
			if (typing && typing.isConnected) {
				if (document.activeElement !== typing) typing.focus({ preventScroll: true });
				if (caret && caret.el === typing && typing.isConnected) {
					try {
						(typing as HTMLTextAreaElement).setSelectionRange(caret.start, caret.end);
					} catch {
						// Not a text field: nothing to restore.
					}
				}
			}
			if (result.type === 'success') {
				saveState = 'saved';
				savedAt = Date.now();
			} else {
				saveState = 'error';
				const message = result.data?.message;
				if (message) toast.error(message);
			}
		};
	};

	const inviteError = $derived.by(() => {
		const errors = (form as { errors?: Record<string, string> } | null | undefined)?.errors;
		return errors?.invite_url ? String(errors.invite_url) : null;
	});

	let now = $state(Date.now());
	$effect(() => {
		const interval = setInterval(() => (now = Date.now()), 15000);
		return () => clearInterval(interval);
	});

	const saveText = $derived.by(() => {
		if (saveState === 'saving') return tr('lst.saving');
		if (saveState === 'error') return tr('lst.saveFailed');
		if (draftPending) return tr('lst.notSavedDraft');
		if (saveState === 'dirty') return canSave ? tr('lst.saving') : tr('lst.notSavedFix');
		if (saveState === 'saved' && savedAt) {
			const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
			return seconds < 10
				? tr('lst.savedJustNow')
				: tr('lst.savedAgo', { minutes: Math.max(1, Math.round(seconds / 60)) });
		}
		return tr('lst.allSaved');
	});

	// -------------------------------------------------------------------- tags
	function normalizeTag(raw: string) {
		return raw.replace(/^#+/, '').trim().replace(/\s+/g, ' ').slice(0, limits.tagLength);
	}

	function addTag(raw: string) {
		const tag = normalizeTag(raw);
		if (!tag || tags.length >= limits.tags) return;
		if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
		tags = [...tags, tag];
		queueSave();
	}

	function removeTag(index: number) {
		tags = tags.filter((_, i) => i !== index);
		queueSave();
	}

	function onTagKey(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			addTag(tagDraft);
			tagDraft = '';
		} else if (event.key === 'Backspace' && !tagDraft && tags.length) {
			removeTag(tags.length - 1);
		}
	}

	function onTagBlur() {
		if (tagDraft.trim()) addTag(tagDraft);
		tagDraft = '';
	}

	function onTagPaste(event: ClipboardEvent) {
		const text = event.clipboardData?.getData('text') || '';
		if (!text.includes(',')) return;
		event.preventDefault();
		for (const part of text.split(',')) addTag(part);
	}

	const tagIdeas = $derived(
		(TAG_IDEAS[category] || TAG_IDEAS.other).filter(
			(idea) => !tags.some((t) => t.toLowerCase() === idea.toLowerCase())
		)
	);

	// ---------------------------------------------------------------- AI + invite
	let draftLoading = $state(false);
	let draftBackup: {
		headline: string;
		description: string;
		category: string;
		tags: string[];
	} | null = null;

	async function draftWithAI() {
		if (draftLoading) return;
		draftLoading = true;
		try {
			const res = await fetch(`/api/admin/${data.serverId}/listing/suggest`, {
				method: 'POST',
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				toast.error(body?.error || tr('listing.aiFailed'));
				return;
			}
			// Snapshot first so Discard is a real undo.
			draftBackup = { headline, description, category, tags: [...tags] };
			headline = body.draft?.headline || headline;
			description = body.draft?.description || description;
			category = body.draft?.category || category;
			if (Array.isArray(body.draft?.tags) && body.draft.tags.length) {
				tags = body.draft.tags.map(normalizeTag).filter(Boolean).slice(0, limits.tags);
			}
			draftPending = true;
			saveState = 'dirty';
			toast.success(tr('listing.aiFilled'));
		} catch {
			toast.error(tr('listing.aiFailed'));
		} finally {
			draftLoading = false;
		}
	}

	function keepDraft() {
		draftPending = false;
		draftBackup = null;
		queueSave(true);
	}

	function discardDraft() {
		if (draftBackup) {
			headline = draftBackup.headline;
			description = draftBackup.description;
			category = draftBackup.category;
			tags = draftBackup.tags;
		}
		draftPending = false;
		draftBackup = null;
		saveState = 'idle';
	}

	let inviteLoading = $state(false);

	async function generateInvite() {
		if (inviteLoading) return;
		inviteLoading = true;
		try {
			const res = await fetch(`/api/admin/${data.serverId}/listing/invite`, {
				method: 'POST',
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok || !body?.invite_url) {
				toast.error(body?.error || tr('listing.inviteFailed'));
				return;
			}
			invite = body.invite_url;
			queueSave();
			toast.success(
				body.source === 'created' ? tr('listing.inviteCreated') : tr('listing.inviteFound')
			);
		} catch {
			toast.error(tr('listing.inviteFailed'));
		} finally {
			inviteLoading = false;
		}
	}

	// ----------------------------------------------------------------- preview
	let previewTab = $state<'card' | 'page'>('card');
	const previewMembers = $derived(showMembers ? formatMemberCount(server?.members) : null);
	const previewOnline = $derived(showMembers ? formatMemberCount(server?.online) : null);
	const fullMembers = $derived(
		showMembers && server?.members ? new Intl.NumberFormat().format(server.members) : null
	);

	function focusField(id: string) {
		const el = document.getElementById(`lst-${id}`);
		if (!el) return;
		el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		(el as HTMLElement).focus?.({ preventScroll: true });
	}

	const headlineLeft = $derived(limits.headline - headline.length);
	const descriptionLeft = $derived(limits.description - description.length);
</script>

<svelte:head>
	<title>{tr('lst.pageTitle')} — {data.guild?.name || 'SpaceBot'}</title>
</svelte:head>

<div class="lst">
	<header class="lst-head">
		<div class="lst-head-text">
			<a class="lst-back" href="/admin/{data.serverId}/settings"
				>← {tr('lst.backToSettings')}</a
			>
			<h1>{tr('lst.pageTitle')}</h1>
			<p>{tr('lst.pageDesc')}</p>
		</div>
		{#if data.canEdit}
			<div
				class="lst-save"
				class:saving={saveState === 'saving' || (saveState === 'dirty' && canSave)}
				class:error={saveState === 'error' || (saveState === 'dirty' && !canSave)}
				role="status"
				aria-live="polite"
			>
				<span class="lst-save-dot"></span>{saveText}
			</div>
		{/if}
	</header>

	{#if !data.canEdit}
		<section class="lst-denied">
			<span class="lst-denied-icon">🔒</span>
			<h2>{tr('lst.deniedTitle')}</h2>
			<p>{tr('lst.deniedDesc')}</p>
			<a class="btn-main" href="/admin/{data.serverId}">{tr('lst.deniedBack')}</a>
		</section>
	{:else}
		<!-- Bubbled events only, to remember the caret; the form itself is not interactive. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<form
			bind:this={formEl}
			method="POST"
			action="?/save"
			use:enhance={submitEnhance}
			oninput={trackCaret}
			onkeyup={trackCaret}
			onclick={trackCaret}
			class="lst-grid"
		>
			<!-- What the server stores. Everything the visitor sees is edited below. -->
			<input type="hidden" name="listed" value={listed ? 'on' : ''} />
			<input type="hidden" name="tags" value={tags.join(', ')} />

			<div class="lst-main">
				<!-- Status ------------------------------------------------------------ -->
				<section class="lst-status mode-{mode}">
					<div class="lst-status-top">
						<div class="lst-status-copy">
							<span class="lst-status-badge">
								{#if mode === 'live'}● {tr('lst.badgeLive')}
								{:else if mode === 'ready'}● {tr('lst.badgeReady')}
								{:else if mode === 'draft'}○ {tr('lst.badgeDraft')}
								{:else if mode === 'fix'}▲ {tr('lst.badgeFix')}
								{:else if mode === 'hidden'}▲ {tr('lst.badgeHidden')}
								{:else}■ {tr('lst.badgeRemoved')}{/if}
							</span>
							<h2>
								{#if mode === 'live'}{tr('lst.liveTitle')}
								{:else if mode === 'ready'}{tr('lst.readyTitle')}
								{:else if mode === 'draft'}{tr('lst.draftTitle', {
										count: blockers.length,
									})}
								{:else if mode === 'fix'}{tr('lst.fixTitle')}
								{:else if mode === 'hidden'}{tr('lst.hiddenTitle')}
								{:else}{tr('lst.removedTitle')}{/if}
							</h2>
							<p>
								{#if mode === 'live'}{tr('lst.liveDesc')}
								{:else if mode === 'ready'}{tr('lst.readyDesc')}
								{:else if mode === 'draft'}{tr('lst.draftDesc')}
								{:else if mode === 'fix'}{tr('lst.fixDesc')}
								{:else if mode === 'hidden'}{tr('lst.hiddenDesc', {
										days: data.freshnessDays ?? 7,
									})}
								{:else}{data.listing?.review_note || tr('lst.removedDesc')}{/if}
							</p>
						</div>

						<div class="lst-status-actions">
							{#if mode === 'live' || mode === 'hidden' || mode === 'fix'}
								{#if mode === 'live'}
									<a
										class="btn-main"
										href="/servers/{data.serverId}"
										target="_blank"
										rel="noopener">{tr('lst.viewPage')} ↗</a
									>
								{/if}
								<button
									type="button"
									class="btn-quiet"
									onclick={() => setListed(false)}>{tr('lst.unpublish')}</button
								>
							{:else if mode !== 'removed'}
								<button
									type="button"
									class="btn-main"
									disabled={mode === 'draft' || draftPending}
									onclick={() => setListed(true)}>{tr('lst.publish')}</button
								>
							{/if}
						</div>
					</div>

					<div class="lst-progress" aria-label={tr('lst.progressLabel', { percent })}>
						<div class="lst-progress-bar"><span style="width: {percent}%"></span></div>
						<ul class="lst-checks">
							{#each checklist as item (item.id)}
								<li class:done={item.done}>
									<button
										type="button"
										class="lst-check"
										disabled={item.done || item.id === 'icon'}
										onclick={() => focusField(item.id)}
									>
										<span class="lst-check-mark"
											>{item.done ? '✓' : item.required ? '!' : '+'}</span
										>
										{item.label}
										{#if item.required && !item.done}<em
												>{tr('lst.required')}</em
											>{/if}
									</button>
								</li>
							{/each}
						</ul>
						{#if !server?.iconUrl}
							<p class="lst-hint">{tr('lst.iconHint')}</p>
						{/if}
					</div>
				</section>

				<!-- Pitch -------------------------------------------------------------- -->
				<section class="lst-card">
					<header class="lst-card-head">
						<div>
							<h2>{tr('lst.pitchTitle')}</h2>
							<p>{tr('lst.pitchDesc')}</p>
						</div>
						<button
							type="button"
							class="btn-quiet"
							onclick={draftWithAI}
							disabled={draftLoading}
						>
							{draftLoading
								? tr('listing.aiWorking')
								: `✨ ${tr('listing.aiButton')}`}
						</button>
					</header>

					{#if draftPending}
						<div class="lst-draft">
							<div>
								<strong>{tr('listing.aiPendingTitle')}</strong>
								<span>{tr('listing.aiPendingDesc')}</span>
							</div>
							<div class="lst-draft-actions">
								<button type="button" class="btn-main small" onclick={keepDraft}
									>{tr('listing.aiKeep')}</button
								>
								<button type="button" class="btn-quiet small" onclick={discardDraft}
									>{tr('listing.aiDiscard')}</button
								>
							</div>
						</div>
					{/if}

					<div class="field">
						<div class="field-label-row">
							<label for="lst-headline">{tr('listing.headline')}</label>
							<span
								class="counter"
								class:warn={headlineLeft < 20}
								class:over={headlineLeft <= 0}
								>{headline.length}/{limits.headline}</span
							>
						</div>
						<input
							id="lst-headline"
							name="headline"
							class="input"
							bind:value={headline}
							maxlength={limits.headline}
							placeholder={tr('listing.headlinePlaceholder')}
							oninput={() => queueSave()}
						/>
						<p class="field-hint">{tr('lst.headlineTip')}</p>
					</div>

					<div class="field">
						<div class="field-label-row">
							<label for="lst-description">{tr('listing.description')}</label>
							<span
								class="counter"
								class:warn={descriptionLeft < 100}
								class:over={descriptionLeft <= 0}
								>{description.length}/{limits.description}</span
							>
						</div>
						<textarea
							id="lst-description"
							name="description"
							class="input area"
							bind:value={description}
							maxlength={limits.description}
							rows="6"
							placeholder={tr('listing.descriptionPlaceholder')}
							oninput={() => queueSave()}></textarea>
						<p class="field-hint">{tr('lst.descriptionTip')}</p>
					</div>
				</section>

				<!-- Discover ----------------------------------------------------------- -->
				<section class="lst-card">
					<header class="lst-card-head">
						<div>
							<h2>{tr('lst.discoverTitle')}</h2>
							<p>{tr('lst.discoverDesc')}</p>
						</div>
					</header>

					<fieldset class="field">
						<legend>{tr('listing.category')}</legend>
						<div class="cats">
							{#each data.categories || [] as cat (cat.value)}
								<label class="cat" class:active={category === cat.value}>
									<input
										type="radio"
										name="category"
										value={cat.value}
										bind:group={category}
										onchange={() => queueSave()}
									/>
									<span class="cat-icon">{CATEGORY_ICONS[cat.value] || '✨'}</span
									>
									<span class="cat-name">{cat.label}</span>
								</label>
							{/each}
						</div>
					</fieldset>

					<div class="field">
						<div class="field-label-row">
							<label for="lst-tags">{tr('listing.tags')}</label>
							<span class="counter" class:warn={tags.length >= limits.tags}
								>{tags.length}/{limits.tags}</span
							>
						</div>
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<div
							class="chips"
							class:full={tags.length >= limits.tags}
							onclick={() => document.getElementById('lst-tags')?.focus()}
						>
							{#each tags as tag, index (tag)}
								<span class="chip"
									>{tag}<button
										type="button"
										aria-label={tr('lst.removeTag', { tag })}
										onclick={(e) => {
											e.stopPropagation();
											removeTag(index);
										}}>×</button
									></span
								>
							{/each}
							<input
								id="lst-tags"
								class="chip-input"
								bind:value={tagDraft}
								maxlength={limits.tagLength}
								disabled={tags.length >= limits.tags}
								placeholder={tags.length ? '' : tr('lst.tagsPlaceholder')}
								onkeydown={onTagKey}
								onblur={onTagBlur}
								onpaste={onTagPaste}
							/>
						</div>
						{#if tagIdeas.length && tags.length < limits.tags}
							<div class="ideas">
								<span>{tr('lst.tagIdeas')}</span>
								{#each tagIdeas.slice(0, 6) as idea (idea)}
									<button type="button" class="idea" onclick={() => addTag(idea)}
										>+ {idea}</button
									>
								{/each}
							</div>
						{/if}
					</div>
				</section>

				<!-- Join --------------------------------------------------------------- -->
				<section class="lst-card">
					<header class="lst-card-head">
						<div>
							<h2>{tr('lst.joinTitle')}</h2>
							<p>{tr('lst.joinDesc')}</p>
						</div>
					</header>

					<div class="field">
						<label for="lst-invite">{tr('listing.invite')}</label>
						<div class="invite-row">
							<input
								id="lst-invite"
								name="invite_url"
								class="input"
								class:bad={Boolean(inviteError) ||
									(invite.trim() && !inviteLooksRight)}
								bind:value={invite}
								placeholder="https://discord.gg/your-invite"
								oninput={() => queueSave()}
								autocomplete="off"
								spellcheck="false"
							/>
							<button
								type="button"
								class="btn-quiet"
								onclick={generateInvite}
								disabled={inviteLoading}
							>
								{inviteLoading
									? tr('listing.inviteWorking')
									: tr('listing.inviteButton')}
							</button>
						</div>
						{#if inviteError}
							<p class="field-error">{inviteError}</p>
						{:else if invite.trim() && !inviteLooksRight}
							<p class="field-error">{tr('lst.inviteBadShape')}</p>
						{:else if inviteHref}
							<p class="field-ok">
								✓ {tr('lst.inviteLooksGood')}
								<a href={inviteHref} target="_blank" rel="noopener noreferrer"
									>{tr('lst.inviteTest')} ↗</a
								>
							</p>
						{:else}
							<p class="field-hint">{tr('lst.inviteTip')}</p>
						{/if}
					</div>
				</section>

				<!-- Privacy ------------------------------------------------------------ -->
				<section class="lst-card">
					<header class="lst-card-head">
						<div>
							<h2>{tr('lst.showTitle')}</h2>
							<p>{tr('lst.showDesc')}</p>
						</div>
					</header>

					<label class="switch-row">
						<span class="switch-text">
							<strong>{tr('listing.showMembers')}</strong>
							<span>{tr('listing.showMembersDesc')}</span>
						</span>
						<input
							type="checkbox"
							name="show_member_count"
							bind:checked={showMembers}
							onchange={() => queueSave()}
						/>
						<span class="switch" aria-hidden="true"></span>
					</label>

					<label class="switch-row">
						<span class="switch-text">
							<strong>{tr('listing.nsfw')}</strong>
							<span>{tr('listing.nsfwDesc')}</span>
						</span>
						<input
							type="checkbox"
							name="nsfw"
							bind:checked={nsfw}
							onchange={() => queueSave()}
						/>
						<span class="switch" aria-hidden="true"></span>
					</label>
				</section>
			</div>

			<!-- Live preview ------------------------------------------------------------ -->
			<aside class="lst-side" aria-label={tr('lst.previewTitle')}>
				<div class="pv-head">
					<h2>{tr('lst.previewTitle')}</h2>
					<div class="pv-tabs" role="tablist">
						<button
							type="button"
							role="tab"
							aria-selected={previewTab === 'card'}
							class:active={previewTab === 'card'}
							onclick={() => (previewTab = 'card')}>{tr('lst.previewCard')}</button
						>
						<button
							type="button"
							role="tab"
							aria-selected={previewTab === 'page'}
							class:active={previewTab === 'page'}
							onclick={() => (previewTab = 'page')}>{tr('lst.previewPage')}</button
						>
					</div>
				</div>

				{#if previewTab === 'card'}
					<article class="pv-card">
						<div class="pv-banner">
							{#if server?.bannerUrl}
								<img src={server.bannerUrl} alt="" />
							{:else}
								<span style="--hue: {serverHue(data.serverId)}"></span>
							{/if}
						</div>
						<div class="pv-body">
							<div class="pv-top">
								{#if server?.iconUrl}
									<img class="pv-icon" src={server.iconUrl} alt="" />
								{:else}
									<span
										class="pv-icon pv-icon-fallback"
										style="--hue: {serverHue(data.serverId)}"
										>{serverInitials(server?.name || '')}</span
									>
								{/if}
								<div class="pv-titles">
									<strong>{server?.name}</strong>
									<span>{categoryLabel}</span>
								</div>
							</div>
							<p class="pv-headline" class:empty={!headline.trim()}>
								{headline.trim() || tr('lst.previewNoHeadline')}
							</p>
							{#if tags.length}
								<ul class="pv-tags">
									{#each tags.slice(0, 4) as tag (tag)}<li>{tag}</li>{/each}
								</ul>
							{/if}
							<div class="pv-foot">
								<div class="pv-stats">
									{#if previewMembers}<span
											><i class="d m"></i>{previewMembers}
											{tr('browse.members')}</span
										>{/if}
									{#if previewOnline}<span
											><i class="d o"></i>{previewOnline}
											{tr('browse.online')}</span
										>{/if}
									{#if nsfw}<span class="pv-nsfw">18+</span>{/if}
								</div>
								<span class="pv-join">{tr('browse.join')}</span>
							</div>
						</div>
					</article>
					<p class="pv-note">{tr('lst.previewCardNote')}</p>
				{:else}
					<article class="pv-page">
						<div class="pv-banner tall">
							{#if server?.bannerUrl}
								<img src={server.bannerUrl} alt="" />
							{:else}
								<span style="--hue: {serverHue(data.serverId)}"></span>
							{/if}
						</div>
						<div class="pv-page-body">
							<div class="pv-page-top">
								{#if server?.iconUrl}
									<img class="pv-icon big" src={server.iconUrl} alt="" />
								{:else}
									<span
										class="pv-icon big pv-icon-fallback"
										style="--hue: {serverHue(data.serverId)}"
										>{serverInitials(server?.name || '')}</span
									>
								{/if}
								<div class="pv-titles">
									<strong class="lg">{server?.name}</strong>
									<span>{categoryLabel}</span>
								</div>
								<span class="pv-join">{tr('browse.joinServer')}</span>
							</div>
							<p class="pv-headline lg" class:empty={!headline.trim()}>
								{headline.trim() || tr('lst.previewNoHeadline')}
							</p>
							{#if fullMembers || previewOnline}
								<div class="pv-statbox">
									{#if fullMembers}<div>
											<small>{tr('lst.statMembers')}</small><b
												>{fullMembers}</b
											>
										</div>{/if}
									{#if server?.online && showMembers}<div>
											<small>{tr('lst.statOnline')}</small><b
												>{new Intl.NumberFormat().format(server.online)}</b
											>
										</div>{/if}
								</div>
							{/if}
							{#if description.trim()}
								<h3>{tr('browse.aboutHeading')}</h3>
								<p class="pv-about">{description}</p>
							{/if}
							{#if tags.length}
								<ul class="pv-tags">
									{#each tags as tag (tag)}<li>{tag}</li>{/each}
								</ul>
							{/if}
						</div>
					</article>
					<p class="pv-note">{tr('lst.previewPageNote')}</p>
				{/if}
			</aside>
		</form>
	{/if}
</div>

<style>
	.lst {
		max-width: 1180px;
		margin: 0 auto;
		padding: 1.5rem 1rem 4rem;
		color: var(--color-text);
	}

	@media (min-width: 768px) {
		.lst {
			padding: 2rem 1.5rem 4rem;
		}
	}

	@media (min-width: 1024px) {
		.lst {
			padding: 2.5rem 2rem 4rem;
		}
	}

	/* Header */
	.lst-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.lst-back {
		display: inline-block;
		margin-bottom: 0.5rem;
		font-size: 0.82rem;
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.lst-back:hover {
		color: var(--color-primary);
	}

	.lst-head h1 {
		margin: 0 0 0.25rem;
		font-size: 1.7rem;
		line-height: 1.2;
	}

	.lst-head p {
		margin: 0;
		max-width: 46rem;
		color: var(--color-text-muted);
		font-size: 0.92rem;
	}

	.lst-save {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.8rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-muted);
		font-size: 0.8rem;
		white-space: nowrap;
		position: sticky;
		top: 0.75rem;
		z-index: 5;
	}

	.lst-save-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-success);
	}

	.lst-save.saving .lst-save-dot {
		background: var(--color-warning);
		animation: pulse 1s ease-in-out infinite;
	}

	.lst-save.error .lst-save-dot {
		background: var(--color-danger);
	}

	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}

	/* Two columns: the form, and a preview that follows you down the page */
	.lst-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 360px;
		gap: 1.5rem;
		align-items: start;
	}

	.lst-main {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
	}

	.lst-side {
		position: sticky;
		top: 1rem;
	}

	@media (max-width: 960px) {
		.lst-grid {
			grid-template-columns: 1fr;
		}

		/* On a phone the preview comes first: it is what you are making. */
		.lst-side {
			position: static;
			order: -1;
		}

		.lst-head {
			flex-direction: column;
		}

		.lst-save {
			position: static;
		}
	}

	/* Status */
	.lst-status {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		overflow: hidden;
		--tone: var(--color-text-muted);
	}

	.lst-status.mode-live,
	.lst-status.mode-ready {
		--tone: var(--color-success);
	}

	.lst-status.mode-fix,
	.lst-status.mode-hidden {
		--tone: var(--color-warning);
	}

	.lst-status.mode-removed {
		--tone: var(--color-danger);
	}

	.lst-status-top {
		display: flex;
		justify-content: space-between;
		gap: 1.25rem;
		padding: 1.25rem 1.5rem;
		border-left: 4px solid var(--tone);
		background: color-mix(in srgb, var(--tone) 7%, transparent);
	}

	.lst-status-badge {
		display: inline-block;
		margin-bottom: 0.4rem;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--tone);
	}

	.lst-status h2 {
		margin: 0 0 0.25rem;
		font-size: 1.2rem;
	}

	.lst-status p {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.88rem;
		max-width: 38rem;
	}

	.lst-status-actions {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		flex-shrink: 0;
	}

	.lst-progress {
		padding: 1rem 1.5rem 1.25rem;
		border-top: 1px solid var(--color-border);
	}

	.lst-progress-bar {
		height: 6px;
		border-radius: 999px;
		background: var(--color-background-alt);
		overflow: hidden;
		margin-bottom: 0.9rem;
	}

	.lst-progress-bar span {
		display: block;
		height: 100%;
		background: var(--color-primary);
		transition: width 0.3s ease;
	}

	.lst-checks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.lst-check {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.35rem 0.75rem 0.35rem 0.4rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
		font-size: 0.8rem;
		cursor: pointer;
	}

	.lst-check:disabled {
		cursor: default;
	}

	.lst-check:not(:disabled):hover {
		border-color: var(--color-primary);
	}

	.lst-check em {
		font-style: normal;
		font-size: 0.7rem;
		color: var(--color-warning);
	}

	.lst-check-mark {
		display: inline-flex;
		width: 1.3rem;
		height: 1.3rem;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: var(--color-background-alt);
		color: var(--color-text-muted);
		font-size: 0.75rem;
		font-weight: 700;
	}

	li.done .lst-check {
		color: var(--color-text-muted);
	}

	li.done .lst-check-mark {
		background: var(--color-success-soft);
		color: var(--color-success);
	}

	.lst-progress .lst-hint {
		margin: 0.75rem 0 0;
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	/* Cards */
	.lst-card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		padding: 1.25rem 1.5rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.lst-card-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
	}

	.lst-card-head h2 {
		margin: 0 0 0.2rem;
		font-size: 1.05rem;
	}

	.lst-card-head p {
		margin: 0;
		font-size: 0.84rem;
		color: var(--color-text-muted);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}

	.field label:not(.cat),
	.field legend {
		font-size: 0.85rem;
		font-weight: 600;
		padding: 0;
		margin-top: 0;
		/* A legend is not a flex item, so the field's gap does not reach it. */
		margin-bottom: 0.55rem;
	}

	.lst .field .field-label-row label {
		margin: 0;
	}

	.field-label-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.counter {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.counter.warn {
		color: var(--color-warning);
	}

	.counter.over {
		color: var(--color-danger);
	}

	.input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.8rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-background-alt);
		color: var(--color-text);
		font: inherit;
		font-size: 0.92rem;
	}

	.input:focus,
	.chips:focus-within {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 22%, transparent);
	}

	.input.bad {
		border-color: var(--color-danger);
	}

	.area {
		resize: vertical;
		min-height: 8rem;
		line-height: 1.5;
	}

	.field-hint,
	.field-ok,
	.field-error {
		margin: 0;
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.field-ok {
		color: var(--color-success);
	}

	.field-ok a {
		margin-left: 0.5rem;
		color: var(--color-primary);
	}

	.field-error {
		color: var(--color-danger);
	}

	/* Category picker */
	.cats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 0.5rem;
	}

	.field .cat {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.55rem 0.75rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-background-alt);
		cursor: pointer;
		font-weight: 500;
		font-size: 0.85rem;
	}

	.cat input {
		position: absolute;
		opacity: 0;
		inset: 0;
		cursor: pointer;
	}

	.cat:hover {
		border-color: var(--color-primary);
	}

	.cat:has(input:focus-visible) {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.cat.active {
		border-color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 14%, transparent);
	}

	.cat-icon {
		font-size: 1.1rem;
	}

	/* Tag chips */
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding: 0.45rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-background-alt);
		cursor: text;
		min-height: 2.9rem;
		align-items: center;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.35rem 0.2rem 0.7rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-primary) 18%, transparent);
		font-size: 0.82rem;
	}

	.chip button {
		display: inline-flex;
		width: 1.2rem;
		height: 1.2rem;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}

	.chip button:hover {
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}

	.chip-input {
		flex: 1;
		min-width: 8rem;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--color-text);
		font: inherit;
		font-size: 0.9rem;
		padding: 0.25rem 0.35rem;
	}

	.ideas {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.idea {
		padding: 0.2rem 0.65rem;
		border-radius: 999px;
		border: 1px dashed var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.78rem;
		cursor: pointer;
	}

	.idea:hover {
		border-color: var(--color-primary);
		color: var(--color-text);
	}

	/* Invite */
	.invite-row {
		display: flex;
		gap: 0.5rem;
	}

	/* Switches */
	.switch-row {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.25rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-background-alt);
		cursor: pointer;
	}

	.switch-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

	.switch-text strong {
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.switch-row input {
		position: absolute;
		opacity: 0;
		inset: 0;
		cursor: pointer;
	}

	.switch {
		position: relative;
		flex-shrink: 0;
		width: 40px;
		height: 22px;
		border-radius: 999px;
		background: var(--color-border);
		transition: background 0.15s;
	}

	.switch::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--color-text);
		transition: transform 0.15s;
	}

	.switch-row input:checked ~ .switch {
		background: var(--color-primary);
	}

	.switch-row input:checked ~ .switch::after {
		transform: translateX(18px);
	}

	.switch-row:has(input:focus-visible) {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	/* Buttons */
	.btn-main,
	.btn-quiet {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.55rem 1.1rem;
		border-radius: var(--radius-md);
		font: inherit;
		font-size: 0.88rem;
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}

	.btn-main {
		border: 1px solid transparent;
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
	}

	.btn-main:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.btn-quiet {
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
	}

	.btn-quiet:hover:not(:disabled) {
		border-color: var(--color-primary);
	}

	.small {
		padding: 0.35rem 0.8rem;
		font-size: 0.82rem;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* AI draft bar */
	.lst-draft {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		padding: 0.8rem 1rem;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-primary) 40%, transparent);
		background: color-mix(in srgb, var(--color-primary) 9%, transparent);
		font-size: 0.84rem;
	}

	.lst-draft div:first-child {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.lst-draft span {
		color: var(--color-text-muted);
	}

	.lst-draft-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	/* Preview */
	.pv-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.pv-head h2 {
		margin: 0;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}

	.pv-tabs {
		display: inline-flex;
		padding: 2px;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.pv-tabs button {
		padding: 0.25rem 0.8rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--color-text-muted);
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}

	.pv-tabs button.active {
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
	}

	.pv-card,
	.pv-page {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		overflow: hidden;
	}

	.pv-banner {
		height: 86px;
		position: relative;
	}

	.pv-banner.tall {
		height: 110px;
	}

	.pv-banner img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.pv-banner span {
		display: block;
		height: 100%;
		background: linear-gradient(
			135deg,
			hsl(var(--hue) 70% 52%),
			hsl(calc(var(--hue) + 40) 65% 42%)
		);
	}

	.pv-body {
		padding: 0 1rem 1rem;
	}

	.pv-top,
	.pv-page-top {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		margin-top: -22px;
		/* Paint above the banner, which is positioned. */
		position: relative;
		z-index: 1;
	}

	.pv-icon {
		width: 52px;
		height: 52px;
		border-radius: 14px;
		object-fit: cover;
		border: 3px solid var(--color-surface);
		background: var(--color-surface);
		flex-shrink: 0;
	}

	.pv-icon.big {
		width: 68px;
		height: 68px;
		border-radius: 18px;
	}

	.pv-icon-fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: hsl(var(--hue) 45% 40%);
		color: var(--color-primary-button-text);
		font-weight: 700;
	}

	.pv-titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
		/* Start below the banner edge: the icon overlaps it by 22px. */
		padding-top: 28px;
		flex: 1;
	}

	.pv-titles strong {
		font-size: 0.98rem;
		color: var(--color-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pv-titles strong.lg {
		font-size: 1.25rem;
		color: var(--color-text);
		white-space: normal;
		overflow-wrap: break-word;
	}

	.pv-titles span {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}

	.pv-headline {
		margin: 0.8rem 0 0.6rem;
		font-size: 0.88rem;
		line-height: 1.45;
	}

	.pv-headline.lg {
		font-size: 0.98rem;
	}

	.pv-headline.empty {
		color: var(--color-text-muted);
		font-style: italic;
	}

	.pv-tags {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.pv-tags li {
		padding: 0.1rem 0.55rem;
		border-radius: 999px;
		background: var(--color-background-alt);
		color: var(--color-text-muted);
		font-size: 0.72rem;
	}

	.pv-foot {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
	}

	.pv-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		font-size: 0.74rem;
		color: var(--color-text-muted);
	}

	.pv-stats span {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.d {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		display: inline-block;
	}

	.d.m {
		background: var(--color-text-muted);
	}

	.d.o {
		background: var(--color-success);
	}

	.pv-nsfw {
		padding: 0 0.35rem;
		border-radius: 4px;
		background: var(--color-danger-soft);
		color: var(--color-danger);
		font-weight: 700;
	}

	.pv-page-top {
		flex-wrap: wrap;
	}

	.pv-page-top .pv-titles {
		flex-basis: 9rem;
	}

	.pv-page-top .pv-join {
		margin-top: 0.15rem;
	}

	.pv-join {
		padding: 0.3rem 0.85rem;
		border-radius: var(--radius-md);
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		font-size: 0.8rem;
		font-weight: 500;
	}

	.pv-page-body {
		padding: 0 1.1rem 1.1rem;
	}

	.pv-statbox {
		display: flex;
		gap: 1.5rem;
		margin: 0.5rem 0 1rem;
		padding: 0.7rem 0.9rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-background-alt);
	}

	.pv-statbox small {
		display: block;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}

	.pv-statbox b {
		font-size: 1.1rem;
	}

	.pv-page-body h3 {
		margin: 0.5rem 0 0.35rem;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}

	.pv-about {
		margin: 0 0 0.9rem;
		font-size: 0.85rem;
		line-height: 1.55;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.pv-note {
		margin: 0.6rem 0 0;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* No access */
	.lst-denied {
		max-width: 32rem;
		margin: 3rem auto;
		padding: 2rem;
		text-align: center;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}

	.lst-denied-icon {
		font-size: 2rem;
	}

	.lst-denied h2 {
		margin: 0.5rem 0;
	}

	.lst-denied p {
		margin: 0 0 1.25rem;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	@media (max-width: 640px) {
		.lst-status-top {
			flex-direction: column;
		}

		.lst-card {
			padding: 1rem;
		}

		.invite-row {
			flex-direction: column;
		}

		.lst-draft {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
