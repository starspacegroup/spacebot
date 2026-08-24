<script lang="ts">
	import { toast } from '$lib/toast.svelte.js';
	import { versionDiffSummary } from './workflow-ui.js';

	const { templateId, publishedVersion, onreverted } = $props();

	let versions = $state([]);
	let loading = $state(true);
	let revertingVersion = $state<number | null>(null);

	async function load() {
		loading = true;
		try {
			const res = await fetch(`/api/superadmin/workflows/${templateId}/versions?limit=100`);
			const body = await res.json();
			if (res.ok) {
				versions = body.versions || [];
			} else {
				toast.error(body.error || 'Failed to load version history');
			}
		} catch {
			toast.error('Failed to load version history');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (templateId) void load();
	});

	function diffFor(index: number): string[] {
		const newer = versions[index];
		const older = versions[index + 1];
		if (!older) return [];
		return versionDiffSummary(newer, older);
	}

	async function revertTo(version: number) {
		if (
			!confirm(
				`Revert to v${version}? The old definition is republished as v${publishedVersion + 1} — nothing is lost.`
			)
		)
			return;
		revertingVersion = version;
		try {
			const res = await fetch(
				`/api/superadmin/workflows/${templateId}/versions/${version}/revert`,
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
			);
			const body = await res.json();
			if (!res.ok) {
				toast.error(body.error || 'Revert failed');
				return;
			}
			toast.success(
				`Reverted to v${version} (published as v${body.template.published_version})`
			);
			await load();
			onreverted?.(body.template);
		} catch {
			toast.error('Revert failed');
		} finally {
			revertingVersion = null;
		}
	}
</script>

<div class="version-panel">
	{#if loading}
		<p class="muted">Loading version history…</p>
	{:else if versions.length === 0}
		<p class="muted">No versions recorded yet.</p>
	{:else}
		<ul class="version-list">
			{#each versions as v, index (v.version)}
				<li class="version-row" class:live={v.version === publishedVersion}>
					<div class="version-head">
						<span class="version-number">v{v.version}</span>
						{#if v.version === publishedVersion}<span class="live-badge">live</span
							>{/if}
						<span class="version-note">{v.change_note || 'No change note'}</span>
					</div>
					<div class="version-meta">
						<span
							>{v.created_at} · {v.created_by_user_id} · {v.node_count} step{v.node_count ===
							1
								? ''
								: 's'}</span
						>
						{#if diffFor(index).length > 0}
							<span class="version-diff">changed: {diffFor(index).join(', ')}</span>
						{/if}
					</div>
					{#if v.version !== publishedVersion}
						<button
							class="btn btn-secondary btn-sm"
							disabled={revertingVersion !== null}
							onclick={() => revertTo(v.version)}
						>
							{revertingVersion === v.version
								? 'Reverting…'
								: 'Revert to this version'}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.version-panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.muted {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		margin: 0;
	}
	.version-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.version-row {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.6rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.version-row.live {
		border-color: var(--color-primary);
	}
	.version-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.version-number {
		font-weight: 700;
		font-size: 0.9rem;
	}
	.live-badge {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--color-primary);
		border: 1px solid var(--color-primary);
		border-radius: 999px;
		padding: 0.05rem 0.4rem;
	}
	.version-note {
		font-size: 0.85rem;
	}
	.version-meta {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	.version-diff {
		color: var(--color-primary);
	}
	.btn {
		align-self: flex-start;
	}
</style>
