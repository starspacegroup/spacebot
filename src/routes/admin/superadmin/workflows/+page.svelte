<script>
	import { onMount } from 'svelte';
	import { formatDate as tzFormatDate } from '$lib/timezone.js';

	let { data } = $props();

	let templates = $state(data?.templates ?? []);
	let runs = $state(data?.runs ?? []);
	const legacyStarters = $derived(data?.legacyStarters ?? []);

	let selectedTemplateId = $state(templates[0]?.id ?? null);
	let saving = $state(false);
	let loading = $state(false);
	let archivingTemplateId = $state(null);
	let runningTemplateId = $state(null);
	let toast = $state(null);
	let canvasElement = $state(null);
	let dragState = $state(null);

	function emptyDraft() {
		return {
			id: null,
			name: '',
			slug: '',
			description: '',
			category: 'operations',
			enabled: true,
			execution_backend: 'cloudflare_workflows',
			legacy_job_name: '',
			schedule_type: 'manual',
			cron_expression: '',
			published_version: 1,
			config_json: null,
			canvas_json: {
				nodes: [
					{ id: 'start', type: 'trigger', title: 'Start', position: { x: 24, y: 32 }, data: {} },
				],
				edges: [],
			},
		};
	}

	function cloneTemplate(template) {
		return JSON.parse(JSON.stringify(template));
	}

	let draft = $state(selectedTemplateId
		? cloneTemplate(templates.find((template) => template.id === selectedTemplateId) || emptyDraft())
		: emptyDraft());

	$effect(() => {
		const selected = templates.find((template) => template.id === selectedTemplateId);
		if (selected) {
			draft = cloneTemplate(selected);
		}
	});

	function formatDate(dateStr) {
		if (!dateStr) return 'Never';
		return tzFormatDate(dateStr, null);
	}

	function showToast(message, type = 'success') {
		toast = { message, type };
		window.clearTimeout(showToast.timeoutId);
		showToast.timeoutId = window.setTimeout(() => {
			toast = null;
		}, 3200);
	}

	function slugify(value) {
		return String(value || '')
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 80);
	}

	function ensureDraftShape() {
		if (!draft.canvas_json) {
			draft.canvas_json = { nodes: [], edges: [] };
		}
		if (!Array.isArray(draft.canvas_json.nodes)) draft.canvas_json.nodes = [];
		if (!Array.isArray(draft.canvas_json.edges)) draft.canvas_json.edges = [];
	}

	function applyStarter(starter) {
		selectedTemplateId = null;
		draft = {
			...emptyDraft(),
			...cloneTemplate(starter),
			id: null,
			slug: `${starter.slug}-${Date.now()}`.slice(0, 80),
		};
	}

	function startNewWorkflow() {
		selectedTemplateId = null;
		draft = emptyDraft();
	}

	function selectTemplate(template) {
		selectedTemplateId = template.id;
		draft = cloneTemplate(template);
	}

	function addNode(type = 'task') {
		ensureDraftShape();
		const nextIndex = draft.canvas_json.nodes.length + 1;
		draft.canvas_json.nodes = [
			...draft.canvas_json.nodes,
			{
				id: `step-${Date.now()}`,
				type,
				title: `${type[0].toUpperCase()}${type.slice(1)} ${nextIndex}`,
				position: { x: 32, y: 48 + (nextIndex - 1) * 110 },
				data: {},
			},
		];
	}

	function removeNode(nodeId) {
		ensureDraftShape();
		draft.canvas_json.nodes = draft.canvas_json.nodes.filter((node) => node.id !== nodeId);
		draft.canvas_json.edges = draft.canvas_json.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
	}

	let pendingEdgeSource = $state('');
	let pendingEdgeTarget = $state('');

	function addEdge() {
		ensureDraftShape();
		if (!pendingEdgeSource || !pendingEdgeTarget || pendingEdgeSource === pendingEdgeTarget) return;
		const existing = draft.canvas_json.edges.some((edge) => edge.source === pendingEdgeSource && edge.target === pendingEdgeTarget);
		if (existing) return;
		draft.canvas_json.edges = [
			...draft.canvas_json.edges,
			{ id: `edge-${Date.now()}`, source: pendingEdgeSource, target: pendingEdgeTarget, label: '' },
		];
		pendingEdgeSource = '';
		pendingEdgeTarget = '';
	}

	function removeEdge(edgeId) {
		ensureDraftShape();
		draft.canvas_json.edges = draft.canvas_json.edges.filter((edge) => edge.id !== edgeId);
	}

	function updateNode(nodeId, field, value) {
		ensureDraftShape();
		draft.canvas_json.nodes = draft.canvas_json.nodes.map((node) => node.id === nodeId ? { ...node, [field]: value } : node);
	}

	function getNodeById(nodeId) {
		return draft.canvas_json?.nodes?.find((node) => node.id === nodeId) || null;
	}

	function edgePath(edge) {
		const source = getNodeById(edge.source);
		const target = getNodeById(edge.target);
		if (!source || !target) return '';

		const sourceX = (source.position?.x || 0) + 110;
		const sourceY = (source.position?.y || 0) + 36;
		const targetX = (target.position?.x || 0) + 110;
		const targetY = (target.position?.y || 0) + 36;
		const midX = (sourceX + targetX) / 2;
		return `M ${sourceX} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX} ${targetY}`;
	}

	function beginDrag(event, nodeId) {
		if (!canvasElement) return;
		const node = getNodeById(nodeId);
		if (!node) return;

		const rect = canvasElement.getBoundingClientRect();
		dragState = {
			nodeId,
			offsetX: event.clientX - rect.left - (node.position?.x || 0),
			offsetY: event.clientY - rect.top - (node.position?.y || 0),
		};
	}

	function handlePointerMove(event) {
		if (!dragState || !canvasElement) return;
		const rect = canvasElement.getBoundingClientRect();
		const nextX = Math.max(12, Math.min(rect.width - 220, event.clientX - rect.left - dragState.offsetX));
		const nextY = Math.max(12, Math.min(rect.height - 84, event.clientY - rect.top - dragState.offsetY));

		ensureDraftShape();
		draft.canvas_json.nodes = draft.canvas_json.nodes.map((node) => node.id === dragState.nodeId
			? { ...node, position: { x: nextX, y: nextY } }
			: node);
	}

	function endDrag() {
		dragState = null;
	}

	onMount(() => {
		const onMove = (event) => handlePointerMove(event);
		const onUp = () => endDrag();
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);

		return () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		};
	});

	async function refresh() {
		loading = true;
		try {
			const response = await fetch('/api/superadmin/workflows?limit=100&runLimit=100');
			const result = await response.json();
			if (!response.ok) {
				throw new Error(result.error || 'Failed to refresh workflows');
			}
			templates = result.templates || [];
			runs = result.runs || [];
			if (selectedTemplateId) {
				const fresh = templates.find((template) => template.id === selectedTemplateId);
				if (fresh) draft = cloneTemplate(fresh);
			}
		} catch (error) {
			showToast(error.message, 'error');
		} finally {
			loading = false;
		}
	}

	async function saveDraft() {
		ensureDraftShape();
		if (!draft.name.trim()) {
			showToast('Workflow name is required', 'error');
			return;
		}

		saving = true;
		try {
			const payload = {
				...draft,
				slug: slugify(draft.slug || draft.name),
				legacy_job_name: draft.legacy_job_name || undefined,
				cron_expression: draft.schedule_type === 'cron' ? draft.cron_expression || undefined : undefined,
			};
			const isUpdate = Boolean(draft.id);
			const response = await fetch(isUpdate ? `/api/superadmin/workflows/${draft.id}` : '/api/superadmin/workflows', {
				method: isUpdate ? 'PATCH' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const result = await response.json();
			if (!response.ok) {
				throw new Error(result.error || 'Failed to save workflow');
			}

			const savedTemplate = result.template;
			if (isUpdate) {
				templates = templates.map((template) => template.id === savedTemplate.id ? savedTemplate : template);
			} else {
				templates = [savedTemplate, ...templates];
			}
			selectedTemplateId = savedTemplate.id;
			draft = cloneTemplate(savedTemplate);
			showToast(isUpdate ? 'Workflow updated' : 'Workflow created');
		} catch (error) {
			showToast(error.message, 'error');
		} finally {
			saving = false;
		}
	}

	async function archiveTemplate(template) {
		archivingTemplateId = template.id;
		try {
			const response = await fetch(`/api/superadmin/workflows/${template.id}`, { method: 'DELETE' });
			const result = await response.json();
			if (!response.ok) {
				throw new Error(result.error || 'Failed to archive workflow');
			}
			templates = templates.map((item) => item.id === template.id ? result.template : item).filter((item) => !item.archived);
			if (selectedTemplateId === template.id) {
				selectedTemplateId = templates[0]?.id ?? null;
				draft = selectedTemplateId
					? cloneTemplate(templates.find((item) => item.id === selectedTemplateId) || emptyDraft())
					: emptyDraft();
			}
			showToast('Workflow archived');
		} catch (error) {
			showToast(error.message, 'error');
		} finally {
			archivingTemplateId = null;
		}
	}

	async function toggleEnabled(template, enabled) {
		try {
			const response = await fetch(`/api/superadmin/workflows/${template.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled }),
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error || 'Failed to update workflow');
			templates = templates.map((item) => item.id === template.id ? result.template : item);
			if (selectedTemplateId === template.id) draft = cloneTemplate(result.template);
		} catch (error) {
			showToast(error.message, 'error');
		}
	}

	async function runTemplate(template) {
		runningTemplateId = template.id;
		try {
			const response = await fetch(`/api/superadmin/workflows/${template.id}/runs`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					trigger_source: 'manual',
					execute_now: Boolean(template.legacy_job_name),
					input_json: {
						requested_from: 'superadmin_workflows_ui',
						legacy_job_name: template.legacy_job_name || null,
					},
				}),
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error || 'Failed to queue workflow run');
			runs = [result.run, ...runs].slice(0, 100);
			showToast(template.legacy_job_name
				? `Workflow run #${result.run.id} finished via legacy cron bridge`
				: `Workflow run #${result.run.id} queued`);
		} catch (error) {
			showToast(error.message, 'error');
		} finally {
			runningTemplateId = null;
		}
	}

	const selectedRuns = $derived(selectedTemplateId
		? runs.filter((run) => run.template_id === selectedTemplateId)
		: runs);

	const totalEnabled = $derived(templates.filter((template) => template.enabled).length);
	const migrationCandidates = $derived(templates.filter((template) => template.legacy_job_name).length);
</script>

<svelte:head>
	<title>Superadmin Workflows | SpaceBot</title>
</svelte:head>

<div class="workflow-shell">
	<section class="hero panel">
		<div>
			<p class="eyebrow">Operations designer</p>
			<h1>Cloudflare Workflow migration board</h1>
			<p class="hero-copy">
				Model legacy cron work as CRUD-able workflow templates, shape steps on a touch-friendly canvas,
				and queue runs from one superadmin surface.
			</p>
		</div>
		<div class="hero-stats">
			<div class="stat-card">
				<strong>{templates.length}</strong>
				<span>templates</span>
			</div>
			<div class="stat-card">
				<strong>{totalEnabled}</strong>
				<span>enabled</span>
			</div>
			<div class="stat-card">
				<strong>{migrationCandidates}</strong>
				<span>cron-linked</span>
			</div>
		</div>
	</section>

	{#if toast}
		<div class:toast-success={toast.type !== 'error'} class:toast-error={toast.type === 'error'} class="toast">
			{toast.message}
		</div>
	{/if}

	<section class="starter-strip panel">
		<div class="section-head compact">
			<div>
				<h2>Legacy starters</h2>
				<p>Bootstrap common cron migrations before you fine-tune the graph.</p>
			</div>
			<button class="btn btn-outline" onclick={startNewWorkflow}>Blank workflow</button>
		</div>
		<div class="starter-grid">
			{#each legacyStarters as starter}
				<button class="starter-card" onclick={() => applyStarter(starter)}>
					<strong>{starter.name}</strong>
					<span>{starter.description}</span>
					<small>{starter.legacy_job_name || 'new'} {starter.cron_expression ? `- ${starter.cron_expression}` : '- manual'}</small>
				</button>
			{/each}
		</div>
	</section>

	<div class="workflow-grid">
		<section class="inventory panel">
			<div class="section-head compact">
				<div>
					<h2>Templates</h2>
					<p>Tap a template to edit, run, or archive it.</p>
				</div>
				<button class="btn btn-outline" onclick={refresh} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</button>
			</div>

			<div class="inventory-list">
				{#if templates.length === 0}
					<p class="empty-state">No templates yet. Start from a legacy preset or create a blank workflow.</p>
				{:else}
					{#each templates as template (template.id)}
						<article class:selected={selectedTemplateId === template.id} class="inventory-card">
							<button class="inventory-main" onclick={() => selectTemplate(template)}>
								<div class="inventory-title-row">
									<strong>{template.name}</strong>
									<span class:tag-live={template.enabled} class="tag">{template.enabled ? 'Enabled' : 'Paused'}</span>
								</div>
								<p>{template.description || 'No description yet.'}</p>
								<div class="meta-row">
									<span>{template.category}</span>
									<span>{template.schedule_type === 'cron' ? template.cron_expression || 'cron' : 'manual'}</span>
									<span>{template.execution_backend}</span>
								</div>
							</button>
							<div class="inventory-actions">
								<label class="toggle-row">
									<input type="checkbox" checked={template.enabled} onchange={(event) => toggleEnabled(template, event.currentTarget.checked)} />
									<span>{template.enabled ? 'On' : 'Off'}</span>
								</label>
								<button class="btn btn-outline btn-sm" onclick={() => runTemplate(template)} disabled={runningTemplateId === template.id}>
									{runningTemplateId === template.id ? 'Queueing...' : 'Run'}
								</button>
								<button class="btn btn-danger btn-sm" onclick={() => archiveTemplate(template)} disabled={archivingTemplateId === template.id}>
									{archivingTemplateId === template.id ? 'Archiving...' : 'Archive'}
								</button>
							</div>
						</article>
					{/each}
				{/if}
			</div>
		</section>

		<section class="editor panel">
			<div class="section-head">
				<div>
					<h2>{draft.id ? 'Edit workflow' : 'New workflow'}</h2>
					<p>Mobile-first editor for template details, schedule, and step layout.</p>
				</div>
				<button class="btn btn-primary" onclick={saveDraft} disabled={saving}>{saving ? 'Saving...' : draft.id ? 'Save changes' : 'Create workflow'}</button>
			</div>

			<div class="form-grid">
				<label>
					<span>Name</span>
					<input class="input" type="text" bind:value={draft.name} oninput={() => { if (!draft.id && !draft.slug) draft.slug = slugify(draft.name); }} placeholder="Daily refresh v2" />
				</label>
				<label>
					<span>Slug</span>
					<input class="input" type="text" bind:value={draft.slug} placeholder="daily-refresh-v2" />
				</label>
				<label class="full-width">
					<span>Description</span>
					<textarea class="input textarea" bind:value={draft.description} rows="3" placeholder="Explain what this workflow owns and why it exists."></textarea>
				</label>
				<label>
					<span>Category</span>
					<input class="input" type="text" bind:value={draft.category} placeholder="cron-migration" />
				</label>
				<label>
					<span>Execution backend</span>
					<select class="input" bind:value={draft.execution_backend}>
						<option value="cloudflare_workflows">cloudflare_workflows</option>
						<option value="legacy_cron_bridge">legacy_cron_bridge</option>
						<option value="queue_orchestrator">queue_orchestrator</option>
					</select>
				</label>
				<label>
					<span>Schedule type</span>
					<select class="input" bind:value={draft.schedule_type}>
						<option value="manual">manual</option>
						<option value="cron">cron</option>
					</select>
				</label>
				<label>
					<span>Cron expression</span>
					<input class="input" type="text" bind:value={draft.cron_expression} placeholder="0 0 * * *" disabled={draft.schedule_type !== 'cron'} />
				</label>
				<label>
					<span>Legacy job</span>
					<select class="input" bind:value={draft.legacy_job_name}>
						<option value="">None</option>
						<option value="hourly_aggregation">hourly_aggregation</option>
						<option value="daily_refresh">daily_refresh</option>
						<option value="rebuild_stats">rebuild_stats</option>
						<option value="send_scheduled_messages">send_scheduled_messages</option>
					</select>
				</label>
				<label class="toggle-row checkbox-row">
					<input type="checkbox" bind:checked={draft.enabled} />
					<span>Enabled</span>
				</label>
			</div>

			<div class="canvas-toolbar">
				<div class="toolbar-title">
					<h3>Canvas</h3>
					<p>Drag steps to map the mobile workflow layout. Connections remain editable below.</p>
				</div>
				<div class="toolbar-actions">
					<button class="btn btn-outline btn-sm" onclick={() => addNode('trigger')}>Add trigger</button>
					<button class="btn btn-outline btn-sm" onclick={() => addNode('task')}>Add task</button>
					<button class="btn btn-outline btn-sm" onclick={() => addNode('approval')}>Add approval</button>
					<button class="btn btn-outline btn-sm" onclick={() => addNode('branch')}>Add branch</button>
				</div>
			</div>

			<div bind:this={canvasElement} class="canvas-surface">
				<svg class="edge-layer" viewBox="0 0 900 520" preserveAspectRatio="none">
					{#each draft.canvas_json?.edges || [] as edge (edge.id)}
						<path d={edgePath(edge)}></path>
					{/each}
				</svg>
				{#each draft.canvas_json?.nodes || [] as node (node.id)}
					<div
						class:dragging={dragState?.nodeId === node.id}
						class="canvas-node"
						style:left={`${node.position?.x || 0}px`}
						style:top={`${node.position?.y || 0}px`}
					>
						<div class="canvas-node-head" onpointerdown={(event) => beginDrag(event, node.id)}>
							<span class="node-type">{node.type}</span>
							<button class="node-remove" onclick={() => removeNode(node.id)}>x</button>
						</div>
						<input class="node-input" type="text" value={node.title} oninput={(event) => updateNode(node.id, 'title', event.currentTarget.value)} />
						<div class="node-meta">{node.id}</div>
					</div>
				{/each}
			</div>

			<div class="connection-editor">
				<div class="connection-form">
					<select class="input" bind:value={pendingEdgeSource}>
						<option value="">Connect from</option>
						{#each draft.canvas_json?.nodes || [] as node (node.id)}
							<option value={node.id}>{node.title}</option>
						{/each}
					</select>
					<select class="input" bind:value={pendingEdgeTarget}>
						<option value="">Connect to</option>
						{#each draft.canvas_json?.nodes || [] as node (node.id)}
							<option value={node.id}>{node.title}</option>
						{/each}
					</select>
					<button class="btn btn-outline btn-sm" onclick={addEdge}>Add connection</button>
				</div>
				<div class="edge-list">
					{#if (draft.canvas_json?.edges || []).length === 0}
						<p class="empty-state compact">No connections yet.</p>
					{:else}
						{#each draft.canvas_json.edges as edge (edge.id)}
							<div class="edge-row">
								<span>{edge.source} -> {edge.target}</span>
								<button class="btn btn-danger btn-sm" onclick={() => removeEdge(edge.id)}>Remove</button>
							</div>
						{/each}
					{/if}
				</div>
			</div>
		</section>
	</div>

	<section class="runs panel">
		<div class="section-head compact">
			<div>
				<h2>Recent runs</h2>
				<p>{selectedTemplateId ? 'Showing runs for the selected workflow.' : 'Showing recent workflow runs.'}</p>
			</div>
		</div>
		<div class="runs-list">
			{#if selectedRuns.length === 0}
				<p class="empty-state">No runs yet. Queue one from the template inventory.</p>
			{:else}
				{#each selectedRuns as run (run.id)}
					<article class="run-card">
						<div class="run-topline">
							<strong>Run #{run.id}</strong>
							<span class:run-ok={run.status === 'completed'} class:run-pending={run.status !== 'completed'} class="run-status">{run.status}</span>
						</div>
						<div class="meta-row">
							<span>template #{run.template_id}</span>
							<span>{run.trigger_source}</span>
							<span>{formatDate(run.created_at)}</span>
						</div>
						{#if run.error_message}
							<p class="run-error">{run.error_message}</p>
						{/if}
					</article>
				{/each}
			{/if}
		</div>
	</section>
</div>

<style>
	:global(.superadmin-layout) {
		max-width: 1500px;
	}

	.workflow-shell {
		display: grid;
		gap: 1rem;
	}

	.panel {
		background:
			radial-gradient(circle at top left, rgba(38, 109, 211, 0.16), transparent 38%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(246, 248, 252, 0.98));
		border: 1px solid var(--color-border);
		border-radius: 1.25rem;
		padding: 1rem;
		box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
	}

	.hero {
		display: grid;
		gap: 1rem;
	}

	.eyebrow {
		margin: 0 0 0.4rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 0.72rem;
		font-weight: 700;
		color: #266dd3;
	}

	h1,
	h2,
	h3,
	p {
		margin: 0;
	}

	.hero h1 {
		font-size: clamp(1.65rem, 4vw, 2.7rem);
		line-height: 1.05;
	}

	.hero-copy {
		margin-top: 0.75rem;
		max-width: 72ch;
		color: var(--color-text-muted);
	}

	.hero-stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.stat-card {
		display: grid;
		gap: 0.2rem;
		padding: 0.85rem;
		background: rgba(255, 255, 255, 0.76);
		border-radius: 1rem;
		border: 1px solid rgba(38, 109, 211, 0.16);
	}

	.stat-card strong {
		font-size: 1.4rem;
	}

	.section-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.section-head.compact {
		margin-bottom: 0.85rem;
	}

	.section-head p,
	.toolbar-title p {
		color: var(--color-text-muted);
		margin-top: 0.2rem;
	}

	.starter-grid,
	.inventory-list,
	.runs-list {
		display: grid;
		gap: 0.75rem;
	}

	.starter-card,
	.inventory-card,
	.run-card {
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 1rem;
		background: rgba(255, 255, 255, 0.84);
	}

	.starter-card {
		display: grid;
		gap: 0.35rem;
		padding: 0.95rem;
		text-align: left;
	}

	.starter-card span,
	.starter-card small,
	.inventory-main p,
	.run-error,
	.empty-state {
		color: var(--color-text-muted);
	}

	.workflow-grid {
		display: grid;
		gap: 1rem;
	}

	.inventory-main {
		display: grid;
		gap: 0.45rem;
		width: 100%;
		padding: 0.95rem;
		text-align: left;
	}

	.inventory-card.selected {
		outline: 2px solid rgba(38, 109, 211, 0.4);
		outline-offset: 2px;
	}

	.inventory-title-row,
	.run-topline,
	.edge-row,
	.inventory-actions,
	.toggle-row,
	.canvas-node-head,
	.meta-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.inventory-actions {
		padding: 0 0.95rem 0.95rem;
		flex-wrap: wrap;
	}

	.tag,
	.run-status {
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
		background: rgba(15, 23, 42, 0.08);
	}

	.tag-live,
	.run-ok {
		background: rgba(31, 161, 98, 0.16);
		color: #0f7a45;
	}

	.run-pending {
		background: rgba(38, 109, 211, 0.12);
		color: #265ea8;
	}

	.form-grid {
		display: grid;
		gap: 0.8rem;
		grid-template-columns: repeat(1, minmax(0, 1fr));
	}

	.form-grid label {
		display: grid;
		gap: 0.4rem;
		font-size: 0.92rem;
		font-weight: 600;
	}

	.full-width {
		grid-column: 1 / -1;
	}

	.checkbox-row {
		justify-content: flex-start;
		align-self: end;
		padding: 0.85rem 0;
	}

	.canvas-toolbar,
	.connection-editor {
		display: grid;
		gap: 0.8rem;
		margin-top: 1rem;
	}

	.toolbar-actions,
	.connection-form {
		display: grid;
		gap: 0.65rem;
		grid-template-columns: repeat(1, minmax(0, 1fr));
	}

	.canvas-surface {
		position: relative;
		min-height: 520px;
		margin-top: 0.85rem;
		border-radius: 1rem;
		border: 1px dashed rgba(38, 109, 211, 0.24);
		background:
			linear-gradient(transparent 31px, rgba(38, 109, 211, 0.06) 32px),
			linear-gradient(90deg, transparent 31px, rgba(38, 109, 211, 0.06) 32px),
			linear-gradient(180deg, rgba(245, 249, 255, 0.96), rgba(239, 244, 252, 0.96));
		background-size: 32px 32px, 32px 32px, 100% 100%;
		overflow: hidden;
	}

	.edge-layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.edge-layer path {
		fill: none;
		stroke: rgba(38, 109, 211, 0.42);
		stroke-width: 3;
		stroke-linecap: round;
	}

	.canvas-node {
		position: absolute;
		width: 220px;
		padding: 0.7rem;
		border-radius: 1rem;
		background: rgba(255, 255, 255, 0.96);
		border: 1px solid rgba(15, 23, 42, 0.08);
		box-shadow: 0 14px 28px rgba(15, 23, 42, 0.12);
	}

	.canvas-node.dragging {
		box-shadow: 0 18px 34px rgba(38, 109, 211, 0.24);
		transform: scale(1.01);
	}

	.canvas-node-head {
		cursor: grab;
		margin-bottom: 0.55rem;
	}

	.node-type,
	.node-meta {
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.node-remove {
		width: 1.8rem;
		height: 1.8rem;
		border-radius: 999px;
		background: rgba(220, 38, 38, 0.1);
		color: #b91c1c;
	}

	.node-input,
	.input,
	.textarea {
		width: 100%;
		padding: 0.75rem 0.9rem;
		border-radius: 0.85rem;
		border: 1px solid rgba(15, 23, 42, 0.12);
		background: rgba(255, 255, 255, 0.94);
		font: inherit;
	}

	.textarea {
		resize: vertical;
	}

	.edge-list {
		display: grid;
		gap: 0.55rem;
	}

	.edge-row,
	.run-card {
		padding: 0.85rem 0.95rem;
	}

	.run-card {
		display: grid;
		gap: 0.45rem;
	}

	.toast {
		padding: 0.9rem 1rem;
		border-radius: 1rem;
		font-weight: 600;
	}

	.toast-success {
		background: rgba(31, 161, 98, 0.14);
		color: #0f7a45;
	}

	.toast-error,
	.run-error {
		background: rgba(220, 38, 38, 0.1);
		color: #b91c1c;
	}

	.compact {
		font-size: 0.92rem;
	}

	@media (min-width: 900px) {
		.workflow-grid {
			grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.5fr);
			align-items: start;
		}

		.hero {
			grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.7fr);
			align-items: end;
		}

		.form-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.toolbar-actions,
		.connection-form {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}

		.starter-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (max-width: 899px) {
		.hero-stats {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.section-head,
		.inventory-actions {
			flex-direction: column;
			align-items: stretch;
		}

		.canvas-node {
			width: min(220px, calc(100vw - 6rem));
		}
	}

	@media (max-width: 640px) {
		.panel {
			padding: 0.85rem;
			border-radius: 1rem;
		}

		.hero-stats {
			grid-template-columns: 1fr;
		}

		.canvas-surface {
			min-height: 440px;
		}
	}
</style>