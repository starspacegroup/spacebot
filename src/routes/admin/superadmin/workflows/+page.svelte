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
	let selectedNodeId = $state('start');
	let selectedEdgeId = $state('');
	let pendingEdgeLabel = $state('');
	let pendingEdgeSourceHandle = $state('');
	let pendingEdgeTargetHandle = $state('');
	let historyStack = $state([]);
	let historyIndex = $state(-1);
	let skipHistorySnapshot = $state(false);
	let runFilter = $state('all');
	let runSearch = $state('');
	let runInputJson = $state('');
	let triggerSource = $state('manual');
	let edgeDragState = $state(null);
	let edgeDragHoverTarget = $state(null);

	const NODE_WIDTH = 220;
	const NODE_HEIGHT = 252;
	const STAGE_WIDTH = 1200;
	const STAGE_HEIGHT = 1280;
	const NODE_PADDING = 16;
	const AUTO_LAYOUT_BASE_X = 56;
	const AUTO_LAYOUT_BASE_Y = 72;
	const AUTO_LAYOUT_COLUMN_GAP = 300;
	const AUTO_LAYOUT_ROW_GAP = NODE_HEIGHT + 44;
	const CROWDED_VERTICAL_THRESHOLD = 170;
	const CROWDED_HORIZONTAL_THRESHOLD = 160;
	const NODE_TYPE_META = {
		trigger: {
			label: 'Trigger',
			description: 'Entry point that starts a workflow run.',
			accent: 'var(--color-info)',
			defaultRoute: 'start',
			outputs: [
				{ id: 'start', label: 'start' },
			],
		},
		task: {
			label: 'Task',
			description: 'Executes work on queue/runner infrastructure.',
			accent: 'var(--color-primary-button)',
			defaultRoute: 'next',
			inputs: [
				{ id: 'in', label: 'in' },
			],
			outputs: [
				{ id: 'next', label: 'next' },
				{ id: 'error', label: 'error' },
			],
		},
		approval: {
			label: 'Approval',
			description: 'Human gate requiring explicit accept/reject routing.',
			accent: 'var(--color-warning)',
			defaultRoute: 'approved',
			inputs: [
				{ id: 'in', label: 'in' },
			],
			outputs: [
				{ id: 'approved', label: 'approved' },
				{ id: 'rejected', label: 'rejected' },
			],
		},
		branch: {
			label: 'Branch',
			description: 'Conditional split. Route labels define path intent.',
			accent: 'var(--color-success)',
			defaultRoute: 'true',
			inputs: [
				{ id: 'in', label: 'in' },
			],
			outputs: [
				{ id: 'true', label: 'true' },
				{ id: 'false', label: 'false' },
				{ id: 'else', label: 'else' },
			],
		},
	};

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
					{ id: 'start', type: 'trigger', title: 'Start', position: { x: 56, y: 72 }, data: {} },
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
			draft.canvas_json = maybeSpaceCanvas(draft.canvas_json);
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

	function safeNodeTitle(type, index) {
		return `${type[0].toUpperCase()}${type.slice(1)} ${index}`;
	}

	function normalizeNode(node, index = 1) {
		const fallbackId = `step-${Date.now()}-${index}`;
		return {
			id: String(node?.id || fallbackId),
			type: String(node?.type || 'task'),
			title: String(node?.title || safeNodeTitle(String(node?.type || 'task'), index)),
			position: {
				x: Number(node?.position?.x ?? 56),
				y: Number(node?.position?.y ?? AUTO_LAYOUT_BASE_Y + (index - 1) * AUTO_LAYOUT_ROW_GAP),
			},
			data: typeof node?.data === 'object' && node?.data !== null ? node.data : {},
		};
	}

	function getNextNodePosition(index) {
		const maxColumns = 3;
		const baseX = AUTO_LAYOUT_BASE_X;
		const baseY = AUTO_LAYOUT_BASE_Y;
		const columnGap = 330;
		const rowGap = AUTO_LAYOUT_ROW_GAP;
		const col = index % maxColumns;
		const row = Math.floor(index / maxColumns);
		const x = Math.min(baseX + col * columnGap, STAGE_WIDTH - NODE_WIDTH - NODE_PADDING);
		const y = Math.min(baseY + row * rowGap, STAGE_HEIGHT - NODE_HEIGHT - NODE_PADDING);
		return { x, y };
	}

	function autoLayoutNodes(nodes = [], direction = 'vertical') {
		const ordered = [...nodes].sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0));
		const maxColumns = direction === 'horizontal' ? 4 : 1;
		return ordered.map((node, index) => {
			const col = index % maxColumns;
			const row = Math.floor(index / maxColumns);
			const x = AUTO_LAYOUT_BASE_X + col * AUTO_LAYOUT_COLUMN_GAP;
			const y = AUTO_LAYOUT_BASE_Y + row * AUTO_LAYOUT_ROW_GAP;
			return {
				...node,
				position: {
					x: Math.min(x, STAGE_WIDTH - NODE_WIDTH - NODE_PADDING),
					y: Math.min(y, STAGE_HEIGHT - NODE_HEIGHT - NODE_PADDING),
				},
			};
		});
	}

	function hasCrowdedLayout(nodes = []) {
		for (let index = 0; index < nodes.length; index += 1) {
			for (let compareIndex = index + 1; compareIndex < nodes.length; compareIndex += 1) {
				const left = nodes[index];
				const right = nodes[compareIndex];
				const deltaX = Math.abs((left.position?.x || 0) - (right.position?.x || 0));
				const deltaY = Math.abs((left.position?.y || 0) - (right.position?.y || 0));
				if (deltaX < CROWDED_HORIZONTAL_THRESHOLD && deltaY < CROWDED_VERTICAL_THRESHOLD) {
					return true;
				}
			}
		}
		return false;
	}

	function maybeSpaceCanvas(canvas) {
		const normalized = normalizedCanvas(canvas);
		if (!hasCrowdedLayout(normalized.nodes)) {
			return normalized;
		}
		return {
			...normalized,
			nodes: autoLayoutNodes(normalized.nodes, 'vertical'),
		};
	}

	function typeMeta(type) {
		return NODE_TYPE_META[type] || NODE_TYPE_META.task;
	}

	function inputHandles(nodeOrType) {
		const type = typeof nodeOrType === 'string' ? nodeOrType : nodeOrType?.type;
		return typeMeta(type).inputs || [];
	}

	function outputHandles(nodeOrType) {
		const type = typeof nodeOrType === 'string' ? nodeOrType : nodeOrType?.type;
		return typeMeta(type).outputs || [];
	}

	function defaultSourceHandle(sourceId) {
		const source = getNodeById(sourceId);
		return outputHandles(source)[0]?.id || '';
	}

	function defaultTargetHandle(targetId) {
		const target = getNodeById(targetId);
		return inputHandles(target)[0]?.id || '';
	}

	function outputHandleLabel(nodeId, handleId) {
		const node = getNodeById(nodeId);
		return outputHandles(node).find((handle) => handle.id === handleId)?.label || handleId || 'route';
	}

	function inputHandleLabel(nodeId, handleId) {
		const node = getNodeById(nodeId);
		return inputHandles(node).find((handle) => handle.id === handleId)?.label || handleId || 'in';
	}

	function nodeTitle(nodeId) {
		const node = getNodeById(nodeId);
		return node?.title || nodeId;
	}

	function nodeSubtitle(node) {
		const meta = typeMeta(node?.type);
		const parts = [meta.description];
		if (node?.data?.queue_key) {
			parts.push(`Queue: ${node.data.queue_key}`);
		}
		if (node?.data?.retry_policy) {
			parts.push(`Retry: ${node.data.retry_policy}`);
		}
		if (node?.data?.condition) {
			parts.push(`When: ${node.data.condition}`);
		}
		return parts.join(' ');
	}

	function suggestEdgeLabel(sourceId, sourceHandleId = '') {
		const source = getNodeById(sourceId);
		if (!source) return '';
		const sourceHandle = sourceHandleId || defaultSourceHandle(sourceId);
		if (sourceHandle) return outputHandleLabel(sourceId, sourceHandle);
		return typeMeta(source.type).defaultRoute;
	}

	function normalizeEdge(edge, index = 1) {
		const source = String(edge?.source || '');
		const target = String(edge?.target || '');
		const sourceHandle = String(edge?.source_handle || edge?.sourceHandle || '');
		const targetHandle = String(edge?.target_handle || edge?.targetHandle || '');
		return {
			id: String(edge?.id || `edge-${Date.now()}-${index}`),
			source,
			target,
			source_handle: sourceHandle || defaultSourceHandle(source),
			target_handle: targetHandle || defaultTargetHandle(target),
			label: String(edge?.label || ''),
		};
	}

	function normalizedCanvas(canvas) {
		const normalizedNodes = (canvas?.nodes || []).map((node, index) => normalizeNode(node, index + 1));
		const nodeIds = new Set(normalizedNodes.map((node) => node.id));
		const parsedEdges = (canvas?.edges || [])
			.map((edge, index) => normalizeEdge(edge, index + 1))
			.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source && edge.target);

		const bySourceHandle = new Map();
		const byTargetHandle = new Map();
		for (const edge of parsedEdges) {
			const sourceKey = `${edge.source}:${edge.source_handle}`;
			const targetKey = `${edge.target}:${edge.target_handle}`;
			bySourceHandle.set(sourceKey, edge);
			byTargetHandle.set(targetKey, edge);
		}

		const normalizedEdges = [];
		const seenIds = new Set();
		for (const edge of parsedEdges) {
			const sourceKey = `${edge.source}:${edge.source_handle}`;
			const targetKey = `${edge.target}:${edge.target_handle}`;
			const latestBySource = bySourceHandle.get(sourceKey);
			const latestByTarget = byTargetHandle.get(targetKey);
			if (!latestBySource || !latestByTarget) continue;
			if (latestBySource.id !== edge.id || latestByTarget.id !== edge.id) continue;
			if (seenIds.has(edge.id)) continue;
			seenIds.add(edge.id);
			normalizedEdges.push(edge);
		}
		return {
			nodes: normalizedNodes,
			edges: normalizedEdges,
		};
	}

	function cloneCanvasSnapshot(canvas) {
		return JSON.parse(JSON.stringify(normalizedCanvas(canvas)));
	}

	function commitCanvasSnapshot(reason = 'change') {
		ensureDraftShape();
		const snapshot = cloneCanvasSnapshot(draft.canvas_json);
		const previous = historyStack[historyIndex];
		if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) {
			return;
		}

		const nextStack = historyStack.slice(0, historyIndex + 1);
		nextStack.push(snapshot);
		if (nextStack.length > 80) {
			nextStack.shift();
		}
		historyStack = nextStack;
		historyIndex = historyStack.length - 1;
		if (reason !== 'seed' && reason !== 'drag') {
			skipHistorySnapshot = true;
		}
	}

	function restoreCanvasFromHistory(index) {
		const snapshot = historyStack[index];
		if (!snapshot) return;
		skipHistorySnapshot = true;
		draft.canvas_json = cloneCanvasSnapshot(snapshot);
		historyIndex = index;
		const nodes = draft.canvas_json.nodes || [];
		if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
			selectedNodeId = nodes[0]?.id || '';
		}
		if (selectedEdgeId && !draft.canvas_json.edges.some((edge) => edge.id === selectedEdgeId)) {
			selectedEdgeId = '';
		}
	}

	function canUndo() {
		return historyIndex > 0;
	}

	function canRedo() {
		return historyIndex >= 0 && historyIndex < historyStack.length - 1;
	}

	function undoCanvas() {
		if (!canUndo()) return;
		restoreCanvasFromHistory(historyIndex - 1);
	}

	function redoCanvas() {
		if (!canRedo()) return;
		restoreCanvasFromHistory(historyIndex + 1);
	}

	function selectNode(nodeId) {
		selectedNodeId = nodeId;
		selectedEdgeId = '';
	}

	function selectEdge(edgeId) {
		selectedEdgeId = edgeId;
		selectedNodeId = '';
	}

	function clearSelection() {
		selectedNodeId = '';
		selectedEdgeId = '';
	}

	function selectedNode() {
		return getNodeById(selectedNodeId);
	}

	function selectedEdge() {
		return draft.canvas_json?.edges?.find((edge) => edge.id === selectedEdgeId) || null;
	}

	function updateNodeData(nodeId, key, value) {
		ensureDraftShape();
		draft.canvas_json.nodes = draft.canvas_json.nodes.map((node) => {
			if (node.id !== nodeId) return node;
			const nextData = { ...(node.data || {}) };
			if (value === '' || value == null) {
				delete nextData[key];
			} else {
				nextData[key] = value;
			}
			return { ...node, data: nextData };
		});
		commitCanvasSnapshot('node-data');
	}

	function duplicateNode(nodeId) {
		const node = getNodeById(nodeId);
		if (!node) return;
		ensureDraftShape();
		const duplicateId = `step-${Date.now()}`;
		draft.canvas_json.nodes = [
			...draft.canvas_json.nodes,
			{
				...JSON.parse(JSON.stringify(node)),
				id: duplicateId,
				title: `${node.title} copy`,
				position: {
					x: Math.min((node.position?.x || 0) + 44, STAGE_WIDTH - NODE_WIDTH - NODE_PADDING),
					y: Math.min((node.position?.y || 0) + 44, STAGE_HEIGHT - NODE_HEIGHT - NODE_PADDING),
				},
			},
		];
		selectedNodeId = duplicateId;
		selectedEdgeId = '';
		commitCanvasSnapshot('duplicate');
	}

	function autoLayout(direction = 'vertical') {
		ensureDraftShape();
		const nodes = draft.canvas_json.nodes || [];
		if (nodes.length === 0) return;
		draft.canvas_json.nodes = autoLayoutNodes(nodes, direction);
		commitCanvasSnapshot('auto-layout');
	}

	function parseRunInputJson() {
		if (!runInputJson.trim()) {
			return {};
		}
		try {
			const parsed = JSON.parse(runInputJson);
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
				throw new Error('Run payload must be a JSON object');
			}
			return parsed;
		} catch (error) {
			throw new Error(error.message || 'Invalid JSON payload');
		}
	}

	function applyStarter(starter) {
		selectedTemplateId = null;
		draft = {
			...emptyDraft(),
			...cloneTemplate(starter),
			id: null,
			slug: `${starter.slug}-${Date.now()}`.slice(0, 80),
		};
		const normalizedCanvasDraft = normalizedCanvas(draft.canvas_json);
		draft.canvas_json = {
			...normalizedCanvasDraft,
			nodes: autoLayoutNodes(normalizedCanvasDraft.nodes, 'vertical'),
		};
		historyStack = [];
		historyIndex = -1;
		selectedNodeId = draft.canvas_json?.nodes?.[0]?.id || '';
		selectedEdgeId = '';
		clearPendingConnection();
	}

	function startNewWorkflow() {
		selectedTemplateId = null;
		draft = emptyDraft();
		historyStack = [];
		historyIndex = -1;
		selectedNodeId = 'start';
		selectedEdgeId = '';
		clearPendingConnection();
	}

	function selectTemplate(template) {
		selectedTemplateId = template.id;
		draft = cloneTemplate(template);
		draft.canvas_json = maybeSpaceCanvas(draft.canvas_json);
		historyStack = [];
		historyIndex = -1;
		selectedNodeId = draft.canvas_json?.nodes?.[0]?.id || '';
		selectedEdgeId = '';
		clearPendingConnection();
	}

	function addNode(type = 'task') {
		ensureDraftShape();
		const nextIndex = draft.canvas_json.nodes.length + 1;
		const nextPosition = getNextNodePosition(nextIndex - 1);
		const nodeId = `step-${Date.now()}`;
		draft.canvas_json.nodes = [
			...draft.canvas_json.nodes,
			{
				id: nodeId,
				type,
				title: safeNodeTitle(type, nextIndex),
				position: nextPosition,
				data: {},
			},
		];
		selectedNodeId = nodeId;
		selectedEdgeId = '';
		commitCanvasSnapshot('add-node');
	}

	function removeNode(nodeId) {
		ensureDraftShape();
		draft.canvas_json.nodes = draft.canvas_json.nodes.filter((node) => node.id !== nodeId);
		draft.canvas_json.edges = draft.canvas_json.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
		if (selectedNodeId === nodeId) selectedNodeId = draft.canvas_json.nodes[0]?.id || '';
		if (selectedEdgeId) {
			const stillExists = draft.canvas_json.edges.some((edge) => edge.id === selectedEdgeId);
			if (!stillExists) selectedEdgeId = '';
		}
		commitCanvasSnapshot('remove-node');
	}

	let pendingEdgeSource = $state('');
	let pendingEdgeTarget = $state('');

	function edgeRouteDisplay(edge) {
		const sourceName = nodeTitle(edge.source);
		const targetName = nodeTitle(edge.target);
		const sourceRoute = outputHandleLabel(edge.source, edge.source_handle);
		const targetPort = inputHandleLabel(edge.target, edge.target_handle);
		return `${sourceName}.${sourceRoute} -> ${targetName}.${targetPort}`;
	}

	function setPendingSource(nodeId, handleId = '') {
		pendingEdgeSource = nodeId;
		pendingEdgeSourceHandle = handleId || defaultSourceHandle(nodeId);
		if (!pendingEdgeLabel) {
			pendingEdgeLabel = suggestEdgeLabel(nodeId, pendingEdgeSourceHandle);
		}
	}

	function setPendingTarget(nodeId, handleId = '') {
		pendingEdgeTarget = nodeId;
		pendingEdgeTargetHandle = handleId || defaultTargetHandle(nodeId);
	}

	function clearPendingConnection() {
		pendingEdgeSource = '';
		pendingEdgeTarget = '';
		pendingEdgeSourceHandle = '';
		pendingEdgeTargetHandle = '';
		pendingEdgeLabel = '';
	}

	function canConnect(sourceId, sourceHandleId, targetId, targetHandleId) {
		if (!sourceId || !targetId) return false;
		if (!sourceHandleId || !targetHandleId) return false;
		if (sourceId === targetId) return false;

		const sourceNode = getNodeById(sourceId);
		const targetNode = getNodeById(targetId);
		if (!sourceNode || !targetNode) return false;

		const sourceHandleExists = outputHandles(sourceNode).some((handle) => handle.id === sourceHandleId);
		const targetHandleExists = inputHandles(targetNode).some((handle) => handle.id === targetHandleId);
		if (!sourceHandleExists || !targetHandleExists) return false;

		return true;
	}

	function edgeConflicts(edge, sourceId, sourceHandleId, targetId, targetHandleId) {
		if (edge.source === sourceId && edge.source_handle === sourceHandleId) {
			return true;
		}
		if (edge.target === targetId && edge.target_handle === targetHandleId) {
			return true;
		}
		return false;
	}

	function upsertEdge(sourceId, sourceHandleId, targetId, targetHandleId, label = '', reason = 'add-edge') {
		ensureDraftShape();
		if (!canConnect(sourceId, sourceHandleId, targetId, targetHandleId)) return false;

		const alreadyExists = draft.canvas_json.edges.some((edge) => edge.source === sourceId
			&& edge.source_handle === sourceHandleId
			&& edge.target === targetId
			&& edge.target_handle === targetHandleId);
		if (alreadyExists) return false;

		const edgeId = `edge-${Date.now()}`;
		const nextLabel = label.trim() || suggestEdgeLabel(sourceId, sourceHandleId);
		const nextEdges = (draft.canvas_json.edges || []).filter((edge) => !edgeConflicts(edge, sourceId, sourceHandleId, targetId, targetHandleId));
		draft.canvas_json.edges = [
			...nextEdges,
			{
				id: edgeId,
				source: sourceId,
				source_handle: sourceHandleId,
				target: targetId,
				target_handle: targetHandleId,
				label: nextLabel,
			},
		];
		selectedEdgeId = edgeId;
		selectedNodeId = '';
		commitCanvasSnapshot(reason);
		return true;
	}

	function addEdge() {
		const sourceHandle = pendingEdgeSourceHandle || defaultSourceHandle(pendingEdgeSource);
		const targetHandle = pendingEdgeTargetHandle || defaultTargetHandle(pendingEdgeTarget);
		const created = upsertEdge(pendingEdgeSource, sourceHandle, pendingEdgeTarget, targetHandle, pendingEdgeLabel, 'add-edge');
		if (created) {
			clearPendingConnection();
		}
	}

	function chooseEdgeEndpoint(nodeId, mode, handleId = '') {
		if (mode === 'source') {
			setPendingSource(nodeId, handleId);
			return;
		}
		setPendingTarget(nodeId, handleId);
	}

	function stagePointFromClient(clientX, clientY) {
		if (!canvasElement) return { x: 0, y: 0 };
		const rect = canvasElement.getBoundingClientRect();
		const scrollX = canvasElement.scrollLeft;
		const scrollY = canvasElement.scrollTop;
		return {
			x: clientX - rect.left + scrollX,
			y: clientY - rect.top + scrollY,
		};
	}

	function findNodeAtPoint(pointX, pointY, ignoredNodeId = '') {
		const nodes = draft.canvas_json?.nodes || [];
		for (let index = nodes.length - 1; index >= 0; index -= 1) {
			const node = nodes[index];
			if (node.id === ignoredNodeId) continue;
			const x = node.position?.x || 0;
			const y = node.position?.y || 0;
			if (pointX >= x && pointX <= x + NODE_WIDTH && pointY >= y && pointY <= y + NODE_HEIGHT) {
				return node;
			}
		}
		return null;
	}

	function handleOffsetY(index, total) {
		if (total <= 1) return NODE_HEIGHT / 2;
		const topPadding = 34;
		const bottomPadding = 34;
		const usableHeight = NODE_HEIGHT - topPadding - bottomPadding;
		return topPadding + (usableHeight / (total - 1)) * index;
	}

	function nodeHandleAnchor(node, direction, handleId = '') {
		const handles = direction === 'out' ? outputHandles(node) : inputHandles(node);
		const index = Math.max(0, handles.findIndex((handle) => handle.id === handleId));
		const localY = handleOffsetY(index, Math.max(1, handles.length));
		const baseX = node.position?.x || 0;
		const baseY = node.position?.y || 0;
		return {
			x: direction === 'out' ? baseX + NODE_WIDTH + 6 : baseX - 6,
			y: baseY + localY,
		};
	}

	function findInputHandleAtPoint(pointX, pointY, ignoredNodeId = '') {
		const nodes = draft.canvas_json?.nodes || [];
		const hitRadius = 18;
		for (let index = nodes.length - 1; index >= 0; index -= 1) {
			const node = nodes[index];
			if (node.id === ignoredNodeId) continue;
			const handles = inputHandles(node);
			for (const handle of handles) {
				const anchor = nodeHandleAnchor(node, 'in', handle.id);
				if (Math.abs(pointX - anchor.x) <= hitRadius && Math.abs(pointY - anchor.y) <= hitRadius) {
					return { nodeId: node.id, handleId: handle.id };
				}
			}
		}
		return null;
	}

	function startEdgeDrag(event, nodeId, sourceHandleId = '') {
		event.stopPropagation();
		ensureDraftShape();
		const source = getNodeById(nodeId);
		if (!source) return;
		const sourceHandle = sourceHandleId || defaultSourceHandle(source.id);
		if (!sourceHandle) return;

		const point = stagePointFromClient(event.clientX, event.clientY);
		setPendingSource(source.id, sourceHandle);
		if (!pendingEdgeLabel) {
			pendingEdgeLabel = suggestEdgeLabel(source.id, sourceHandle);
		}
		edgeDragHoverTarget = null;
		edgeDragState = {
			sourceId: source.id,
			sourceHandleId: sourceHandle,
			pointerX: point.x,
			pointerY: point.y,
		};
	}

	function edgeDragPath() {
		if (!edgeDragState) return '';
		const sourceNode = getNodeById(edgeDragState.sourceId);
		if (!sourceNode) return '';

		const from = nodeHandleAnchor(sourceNode, 'out', edgeDragState.sourceHandleId);
		const toX = edgeDragState.pointerX;
		const toY = edgeDragState.pointerY;
		const distanceX = Math.abs(toX - from.x);
		const curve = Math.max(60, Math.min(220, distanceX * 0.45));
		const towardRight = toX >= from.x ? 1 : -1;
		const c1x = from.x + curve;
		const c2x = toX - towardRight * curve;
		return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${toY}, ${toX} ${toY}`;
	}

	function completeEdgeDrag(targetNodeId, targetHandleId) {
		if (!edgeDragState) return;
		const created = upsertEdge(
			edgeDragState.sourceId,
			edgeDragState.sourceHandleId,
			targetNodeId,
			targetHandleId,
			pendingEdgeLabel,
			'drag-connect',
		);
		if (created) {
			clearPendingConnection();
		}
		edgeDragHoverTarget = null;
		edgeDragState = null;
	}

	function finishEdgeDrag() {
		if (!edgeDragState) return;
		if (edgeDragHoverTarget) {
			completeEdgeDrag(edgeDragHoverTarget.nodeId, edgeDragHoverTarget.handleId);
			return;
		}
		edgeDragHoverTarget = null;
		edgeDragState = null;
	}

	function upsertQuickEdge(fromNodeId, toNodeId) {
		if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
		upsertEdge(
			fromNodeId,
			defaultSourceHandle(fromNodeId),
			toNodeId,
			defaultTargetHandle(toNodeId),
			suggestEdgeLabel(fromNodeId, defaultSourceHandle(fromNodeId)),
			'quick-connect',
		);
	}

	function removeEdge(edgeId) {
		ensureDraftShape();
		draft.canvas_json.edges = draft.canvas_json.edges.filter((edge) => edge.id !== edgeId);
		if (selectedEdgeId === edgeId) selectedEdgeId = '';
		commitCanvasSnapshot('remove-edge');
	}

	function updateEdge(edgeId, updates) {
		ensureDraftShape();
		draft.canvas_json.edges = draft.canvas_json.edges.map((edge) => edge.id === edgeId ? { ...edge, ...updates } : edge);
		commitCanvasSnapshot('update-edge');
	}

	function updateNode(nodeId, field, value) {
		ensureDraftShape();
		draft.canvas_json.nodes = draft.canvas_json.nodes.map((node) => node.id === nodeId ? { ...node, [field]: value } : node);
		if (field === 'type') {
			const nextNode = getNodeById(nodeId);
			const validInputHandles = new Set(inputHandles(nextNode).map((handle) => handle.id));
			const validOutputHandles = new Set(outputHandles(nextNode).map((handle) => handle.id));
			const fallbackIn = defaultTargetHandle(nodeId);
			const fallbackOut = defaultSourceHandle(nodeId);
			draft.canvas_json.edges = (draft.canvas_json.edges || []).map((edge) => {
				if (edge.source === nodeId && !validOutputHandles.has(edge.source_handle)) {
					return {
						...edge,
						source_handle: fallbackOut,
						label: edge.label || suggestEdgeLabel(nodeId, fallbackOut),
					};
				}
				if (edge.target === nodeId && !validInputHandles.has(edge.target_handle)) {
					return {
						...edge,
						target_handle: fallbackIn,
					};
				}
				return edge;
			});
		}
		commitCanvasSnapshot('update-node');
	}

	function getNodeById(nodeId) {
		return draft.canvas_json?.nodes?.find((node) => node.id === nodeId) || null;
	}

	function edgeGeometry(edge) {
		const source = getNodeById(edge.source);
		const target = getNodeById(edge.target);
		if (!source || !target) return null;

		const from = nodeHandleAnchor(source, 'out', edge.source_handle || defaultSourceHandle(source.id));
		const to = nodeHandleAnchor(target, 'in', edge.target_handle || defaultTargetHandle(target.id));
		const horizontalDistance = Math.abs(to.x - from.x);
		const curve = Math.max(80, Math.min(280, horizontalDistance * 0.5));
		const towardRight = to.x >= from.x ? 1 : -1;
		const c1x = from.x + curve;
		const c2x = to.x - towardRight * curve;
		const path = `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
		return { from, to, path };
	}

	function edgePath(edge) {
		return edgeGeometry(edge)?.path || '';
	}

	function edgeMidpoint(edge) {
		const geometry = edgeGeometry(edge);
		if (!geometry) return { x: 0, y: 0 };
		const { from, to } = geometry;
		const midX = (from.x + to.x) / 2;
		const midY = (from.y + to.y) / 2;
		return { x: midX, y: midY };
	}

	function beginDrag(event, nodeId) {
		if (!canvasElement) return;
		if (edgeDragState) return;
		const node = getNodeById(nodeId);
		if (!node) return;
		selectNode(nodeId);

		const rect = canvasElement.getBoundingClientRect();
		const scrollX = canvasElement.scrollLeft;
		const scrollY = canvasElement.scrollTop;
		dragState = {
			nodeId,
			offsetX: (event.clientX - rect.left + scrollX) - (node.position?.x || 0),
			offsetY: (event.clientY - rect.top + scrollY) - (node.position?.y || 0),
		};
	}

	function handlePointerMove(event) {
		if (!canvasElement) return;
		const point = stagePointFromClient(event.clientX, event.clientY);

		if (edgeDragState) {
			edgeDragState = {
				...edgeDragState,
				pointerX: point.x,
				pointerY: point.y,
			};
			const hoveredHandle = findInputHandleAtPoint(point.x, point.y, edgeDragState.sourceId);
			if (hoveredHandle) {
				edgeDragHoverTarget = hoveredHandle;
				return;
			}

			const hoveredNode = findNodeAtPoint(point.x, point.y, edgeDragState.sourceId);
			if (hoveredNode) {
				edgeDragHoverTarget = {
					nodeId: hoveredNode.id,
					handleId: defaultTargetHandle(hoveredNode.id),
				};
			} else {
				edgeDragHoverTarget = null;
			}
			return;
		}

		if (!dragState) return;
		const pointerX = point.x;
		const pointerY = point.y;
		const nextX = Math.max(12, Math.min(STAGE_WIDTH - NODE_WIDTH - NODE_PADDING, pointerX - dragState.offsetX));
		const nextY = Math.max(12, Math.min(STAGE_HEIGHT - NODE_HEIGHT - NODE_PADDING, pointerY - dragState.offsetY));

		ensureDraftShape();
		draft.canvas_json.nodes = draft.canvas_json.nodes.map((node) => node.id === dragState.nodeId
			? { ...node, position: { x: nextX, y: nextY } }
			: node);
		skipHistorySnapshot = true;
	}

	function endDrag() {
		if (dragState) {
			commitCanvasSnapshot('drag');
		}
		dragState = null;
	}

	function endPointerInteraction() {
		if (dragState) {
			endDrag();
		}
		if (edgeDragState) {
			finishEdgeDrag();
		}
	}

	function nudgeSelectedNode(deltaX, deltaY) {
		const node = selectedNode();
		if (!node) return;
		const nextX = Math.max(12, Math.min(STAGE_WIDTH - NODE_WIDTH - NODE_PADDING, (node.position?.x || 0) + deltaX));
		const nextY = Math.max(12, Math.min(STAGE_HEIGHT - NODE_HEIGHT - NODE_PADDING, (node.position?.y || 0) + deltaY));
		updateNode(node.id, 'position', { x: nextX, y: nextY });
	}

	function runGraphValidation() {
		ensureDraftShape();
		const issues = [];
		const nodes = draft.canvas_json.nodes || [];
		const edges = draft.canvas_json.edges || [];
		if (nodes.length === 0) {
			issues.push('No nodes exist in this workflow.');
			return issues;
		}

		const triggerNodes = nodes.filter((node) => node.type === 'trigger');
		if (triggerNodes.length === 0) {
			issues.push('Add at least one trigger node to start the workflow.');
		}

		const incomingByNode = new Map(nodes.map((node) => [node.id, 0]));
		const outgoingByNode = new Map(nodes.map((node) => [node.id, 0]));
		const outgoingByHandle = new Map();
		const incomingByHandle = new Map();
		for (const edge of edges) {
			incomingByNode.set(edge.target, (incomingByNode.get(edge.target) || 0) + 1);
			outgoingByNode.set(edge.source, (outgoingByNode.get(edge.source) || 0) + 1);
			const sourceHandleKey = `${edge.source}:${edge.source_handle || defaultSourceHandle(edge.source)}`;
			const targetHandleKey = `${edge.target}:${edge.target_handle || defaultTargetHandle(edge.target)}`;
			outgoingByHandle.set(sourceHandleKey, (outgoingByHandle.get(sourceHandleKey) || 0) + 1);
			incomingByHandle.set(targetHandleKey, (incomingByHandle.get(targetHandleKey) || 0) + 1);
		}

		for (const node of nodes) {
			if (node.type !== 'trigger' && (incomingByNode.get(node.id) || 0) === 0) {
				issues.push(`Node "${node.title}" is unreachable.`);
			}
			if (node.type !== 'branch' && node.type !== 'approval' && (outgoingByNode.get(node.id) || 0) === 0) {
				issues.push(`Node "${node.title}" has no outbound path.`);
			}

			for (const handle of outputHandles(node)) {
				const key = `${node.id}:${handle.id}`;
				const count = outgoingByHandle.get(key) || 0;
				if (count > 1) {
					issues.push(`Node "${node.title}" route "${handle.label}" has multiple outbound connections.`);
				}
				if ((node.type === 'branch' || node.type === 'approval') && count === 0) {
					issues.push(`Node "${node.title}" route "${handle.label}" is not connected.`);
				}
			}

			for (const handle of inputHandles(node)) {
				const key = `${node.id}:${handle.id}`;
				const count = incomingByHandle.get(key) || 0;
				if (count > 1) {
					issues.push(`Node "${node.title}" input "${handle.label}" receives multiple inbound connections.`);
				}
			}
		}

		const adjacency = new Map(nodes.map((node) => [node.id, []]));
		for (const edge of edges) {
			if (adjacency.has(edge.source)) {
				adjacency.get(edge.source).push(edge.target);
			}
		}
		const visiting = new Set();
		const visited = new Set();
		let hasCycle = false;

		function dfs(nodeId) {
			if (visiting.has(nodeId)) {
				hasCycle = true;
				return;
			}
			if (visited.has(nodeId) || hasCycle) return;
			visiting.add(nodeId);
			for (const next of adjacency.get(nodeId) || []) {
				dfs(next);
			}
			visiting.delete(nodeId);
			visited.add(nodeId);
		}

		for (const node of nodes) {
			dfs(node.id);
			if (hasCycle) break;
		}

		if (hasCycle) {
			issues.push('Cycle detected in workflow graph. Use branch nodes for divergence and keep execution acyclic.');
		}

		return issues;
	}

	const graphIssues = $derived(runGraphValidation());
	const selectedNodeRef = $derived(selectedNode());
	const selectedEdgeRef = $derived(selectedEdge());

	onMount(() => {
		const onMove = (event) => handlePointerMove(event);
		const onUp = () => endPointerInteraction();
		const onKeyDown = (event) => {
			if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
				return;
			}

			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
				event.preventDefault();
				if (event.shiftKey) {
					redoCanvas();
				} else {
					undoCanvas();
				}
				return;
			}

			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
				event.preventDefault();
				redoCanvas();
				return;
			}

			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selectedNodeId) {
				event.preventDefault();
				duplicateNode(selectedNodeId);
				return;
			}

			if (event.key === 'Delete' || event.key === 'Backspace') {
				if (selectedNodeId && selectedNodeId !== 'start') {
					event.preventDefault();
					removeNode(selectedNodeId);
					return;
				}
				if (selectedEdgeId) {
					event.preventDefault();
					removeEdge(selectedEdgeId);
					return;
				}
			}

			if (selectedNodeId) {
				if (event.key === 'ArrowUp') {
					event.preventDefault();
					nudgeSelectedNode(0, -8);
				} else if (event.key === 'ArrowDown') {
					event.preventDefault();
					nudgeSelectedNode(0, 8);
				} else if (event.key === 'ArrowLeft') {
					event.preventDefault();
					nudgeSelectedNode(-8, 0);
				} else if (event.key === 'ArrowRight') {
					event.preventDefault();
					nudgeSelectedNode(8, 0);
				}
			}
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
		window.addEventListener('keydown', onKeyDown);

		return () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			window.removeEventListener('keydown', onKeyDown);
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
				if (fresh) {
					draft = cloneTemplate(fresh);
					draft.canvas_json = maybeSpaceCanvas(draft.canvas_json);
					historyStack = [];
					historyIndex = -1;
					selectedNodeId = draft.canvas_json?.nodes?.[0]?.id || '';
					selectedEdgeId = '';
				}
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
			draft.canvas_json = maybeSpaceCanvas(draft.canvas_json);
			historyStack = [];
			historyIndex = -1;
			selectedNodeId = draft.canvas_json?.nodes?.[0]?.id || '';
			selectedEdgeId = '';
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
				draft.canvas_json = maybeSpaceCanvas(draft.canvas_json);
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
			if (selectedTemplateId === template.id) {
				draft = cloneTemplate(result.template);
				draft.canvas_json = maybeSpaceCanvas(draft.canvas_json);
			}
		} catch (error) {
			showToast(error.message, 'error');
		}
	}

	async function runTemplate(template) {
		runningTemplateId = template.id;
		try {
			const mergedInput = {
				requested_from: 'superadmin_workflows_ui',
				legacy_job_name: template.legacy_job_name || null,
				...parseRunInputJson(),
			};
			const response = await fetch(`/api/superadmin/workflows/${template.id}/runs`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					trigger_source: triggerSource,
					execute_now: Boolean(template.legacy_job_name),
					input_json: mergedInput,
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

	const filteredRuns = $derived(selectedRuns.filter((run) => {
		if (runFilter !== 'all' && run.status !== runFilter) return false;
		if (!runSearch.trim()) return true;
		const search = runSearch.trim().toLowerCase();
		const haystack = [
			String(run.id || ''),
			String(run.status || ''),
			String(run.trigger_source || ''),
			String(run.error_message || ''),
			String(run.template_id || ''),
		].join(' ').toLowerCase();
		return haystack.includes(search);
	}));

	const totalEnabled = $derived(templates.filter((template) => template.enabled).length);
	const migrationCandidates = $derived(templates.filter((template) => template.legacy_job_name).length);

	$effect(() => {
		ensureDraftShape();
		if (skipHistorySnapshot) {
			skipHistorySnapshot = false;
			return;
		}
		if (historyIndex === -1 || historyStack.length === 0) {
			commitCanvasSnapshot('seed');
		}
	});
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
					<p>Phone-first graph composer with explicit flow direction, node intent, and queue routing visibility.</p>
				</div>
				<div class="toolbar-actions-scroller">
					<div class="toolbar-actions">
						<button class="btn btn-outline btn-sm" onclick={() => addNode('trigger')}>Add trigger</button>
						<button class="btn btn-outline btn-sm" onclick={() => addNode('task')}>Add task</button>
						<button class="btn btn-outline btn-sm" onclick={() => addNode('approval')}>Add approval</button>
						<button class="btn btn-outline btn-sm" onclick={() => addNode('branch')}>Add branch</button>
						<button class="btn btn-outline btn-sm" onclick={() => autoLayout('vertical')}>Auto stack</button>
						<button class="btn btn-outline btn-sm" onclick={() => autoLayout('horizontal')}>Auto row</button>
						<button class="btn btn-outline btn-sm" onclick={undoCanvas} disabled={!canUndo()}>Undo</button>
						<button class="btn btn-outline btn-sm" onclick={redoCanvas} disabled={!canRedo()}>Redo</button>
					</div>
				</div>
				<div class="keyboard-hints">
					<span>Shortcuts: arrows move node, Ctrl/Cmd+D duplicate, Delete remove, Ctrl/Cmd+Z/Y undo/redo.</span>
				</div>
				<div class="node-legend" role="list" aria-label="Node type legend">
					{#each Object.entries(NODE_TYPE_META) as [key, meta]}
						<div class="legend-item" role="listitem">
							<span class="legend-dot" style={`background: ${meta.accent};`}></span>
							<div>
								<strong>{meta.label}</strong>
								<small>{meta.description}</small>
							</div>
						</div>
					{/each}
				</div>
				<div class="pending-link-hint">
					<span>
						Link builder:
						<strong>{pendingEdgeSource ? `${nodeTitle(pendingEdgeSource)}.${outputHandleLabel(pendingEdgeSource, pendingEdgeSourceHandle || defaultSourceHandle(pendingEdgeSource))}` : 'choose source port'}</strong>
						->
						<strong>{pendingEdgeTarget ? `${nodeTitle(pendingEdgeTarget)}.${inputHandleLabel(pendingEdgeTarget, pendingEdgeTargetHandle || defaultTargetHandle(pendingEdgeTarget))}` : 'choose target port'}</strong>
					</span>
				</div>
			</div>

			{#if graphIssues.length > 0}
				<div class="validation-panel">
					<strong>Workflow checks ({graphIssues.length})</strong>
					<ul>
						{#each graphIssues as issue}
							<li>{issue}</li>
						{/each}
					</ul>
				</div>
			{:else}
				<div class="validation-panel ok">
					<strong>Workflow checks</strong>
					<span>Graph is structurally healthy and ready to run.</span>
				</div>
			{/if}

			<div class="canvas-surface" bind:this={canvasElement} onpointerdown={clearSelection}>
				<div class="canvas-stage" style={`width: ${STAGE_WIDTH}px; height: ${STAGE_HEIGHT}px;`}>
					<svg class="edge-layer" viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`} preserveAspectRatio="none">
						<defs>
							<marker id="workflow-edge-arrow" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
								<polygon points="0 0, 9 3.5, 0 7" fill="currentColor"></polygon>
							</marker>
						</defs>
						{#if edgeDragState}
							<path class="edge-ghost" d={edgeDragPath()} marker-end="url(#workflow-edge-arrow)"></path>
						{/if}
						{#each draft.canvas_json?.edges || [] as edge (edge.id)}
							{@const geometry = edgeGeometry(edge)}
							<path class="edge-hit" d={edgePath(edge)} onpointerdown={(event) => {
								event.stopPropagation();
								selectEdge(edge.id);
							}}></path>
							<path
								d={edgePath(edge)}
								class:selected={selectedEdgeId === edge.id}
								class="edge-visual"
								marker-end="url(#workflow-edge-arrow)"
							></path>
							{#if geometry}
								<circle class="edge-anchor" cx={geometry.from.x} cy={geometry.from.y} r="4"></circle>
								<circle class="edge-anchor" cx={geometry.to.x} cy={geometry.to.y} r="4"></circle>
							{/if}
						{/each}
					</svg>
					<div class="edge-label-layer">
						{#each draft.canvas_json?.edges || [] as edge (edge.id)}
							{@const mid = edgeMidpoint(edge)}
							<button
								type="button"
								class:selected={selectedEdgeId === edge.id}
								class="edge-chip"
								style:left={`${mid.x}px`}
								style:top={`${mid.y}px`}
								onpointerdown={(event) => {
									event.stopPropagation();
									selectEdge(edge.id);
								}}
							>
								{edge.label || outputHandleLabel(edge.source, edge.source_handle)}
							</button>
						{/each}
					</div>
					{#each draft.canvas_json?.nodes || [] as node (node.id)}
						{@const inputPorts = inputHandles(node)}
						{@const outputPorts = outputHandles(node)}
						<div
							class:dragging={dragState?.nodeId === node.id}
							class:selected={selectedNodeId === node.id}
							class:link-drag-source={edgeDragState?.sourceId === node.id}
							class:link-drag-target={edgeDragHoverTarget?.nodeId === node.id}
							class="canvas-node"
							style:left={`${node.position?.x || 0}px`}
							style:top={`${node.position?.y || 0}px`}
							onpointerdown={(event) => {
								event.stopPropagation();
								selectNode(node.id);
							}}
						>
							{#each inputPorts as handle, index (handle.id)}
								<button
									type="button"
									class:active={edgeDragHoverTarget?.nodeId === node.id && edgeDragHoverTarget?.handleId === handle.id}
									class="node-port node-port-in"
									style:top={`${handleOffsetY(index, Math.max(1, inputPorts.length))}px`}
									title={`Target port: ${handle.label}`}
									onpointerdown={(event) => {
										event.stopPropagation();
										if (edgeDragState) {
											completeEdgeDrag(node.id, handle.id);
										} else {
											chooseEdgeEndpoint(node.id, 'target', handle.id);
											selectNode(node.id);
										}
									}}
								></button>
								<span
									class="node-port-label node-port-label-in"
									style:top={`${handleOffsetY(index, Math.max(1, inputPorts.length))}px`}
								>{handle.label}</span>
							{/each}
							{#each outputPorts as handle, index (handle.id)}
								<button
									type="button"
									class:active={edgeDragState?.sourceId === node.id && edgeDragState?.sourceHandleId === handle.id}
									class="node-port node-port-out"
									style:top={`${handleOffsetY(index, Math.max(1, outputPorts.length))}px`}
									title={`Source route: ${handle.label}`}
									onpointerdown={(event) => {
										startEdgeDrag(event, node.id, handle.id);
										selectNode(node.id);
									}}
								></button>
								<span
									class="node-port-label node-port-label-out"
									style:top={`${handleOffsetY(index, Math.max(1, outputPorts.length))}px`}
								>{handle.label}</span>
							{/each}
							<div class="canvas-node-head" onpointerdown={(event) => beginDrag(event, node.id)}>
								<span class="node-type" style={`--node-accent: ${typeMeta(node.type).accent};`}>{typeMeta(node.type).label}</span>
								<button class="node-remove" onclick={() => removeNode(node.id)} disabled={node.id === 'start'}>x</button>
							</div>
							<input class="node-input" type="text" value={node.title} oninput={(event) => updateNode(node.id, 'title', event.currentTarget.value)} />
							<div class="node-purpose">{nodeSubtitle(node)}</div>
							<div class="node-meta">{node.id}</div>
							<div class="node-quick-actions">
								<button class="btn btn-outline btn-sm" onclick={() => duplicateNode(node.id)}>Duplicate</button>
								{#if selectedNodeId && selectedNodeId !== node.id}
									<button class="btn btn-outline btn-sm" onclick={() => upsertQuickEdge(selectedNodeId, node.id)}>
										Link from selected
									</button>
								{/if}
								<button class="btn btn-outline btn-sm" onclick={() => chooseEdgeEndpoint(node.id, 'source', defaultSourceHandle(node.id))}>Set as source</button>
								<button class="btn btn-outline btn-sm" onclick={() => chooseEdgeEndpoint(node.id, 'target', defaultTargetHandle(node.id))}>Set as target</button>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<div class="connection-editor">
				<div class="connection-form">
					<select class="input" bind:value={pendingEdgeSource} onchange={(event) => setPendingSource(event.currentTarget.value)}>
						<option value="">Connect from</option>
						{#each draft.canvas_json?.nodes || [] as node (node.id)}
							{#if outputHandles(node).length > 0}
								<option value={node.id}>{node.title}</option>
							{/if}
						{/each}
					</select>
					<select class="input" bind:value={pendingEdgeSourceHandle} disabled={!pendingEdgeSource}>
						<option value="">From route</option>
						{#each outputHandles(getNodeById(pendingEdgeSource)) as handle (handle.id)}
							<option value={handle.id}>{handle.label}</option>
						{/each}
					</select>
					<select class="input" bind:value={pendingEdgeTarget} onchange={(event) => setPendingTarget(event.currentTarget.value)}>
						<option value="">Connect to</option>
						{#each draft.canvas_json?.nodes || [] as node (node.id)}
							{#if inputHandles(node).length > 0}
								<option value={node.id}>{node.title}</option>
							{/if}
						{/each}
					</select>
					<select class="input" bind:value={pendingEdgeTargetHandle} disabled={!pendingEdgeTarget}>
						<option value="">To port</option>
						{#each inputHandles(getNodeById(pendingEdgeTarget)) as handle (handle.id)}
							<option value={handle.id}>{handle.label}</option>
						{/each}
					</select>
					<input class="input" type="text" bind:value={pendingEdgeLabel} placeholder="Connection label (optional)" />
					<button class="btn btn-outline btn-sm" onclick={addEdge}>Add connection</button>
				</div>
				<div class="edge-list">
					{#if (draft.canvas_json?.edges || []).length === 0}
						<p class="empty-state compact">No connections yet.</p>
					{:else}
						{#each draft.canvas_json.edges as edge (edge.id)}
							<div class:selected={selectedEdgeId === edge.id} class="edge-row" onpointerdown={() => selectEdge(edge.id)}>
								<span>{edgeRouteDisplay(edge)}</span>
								<input
									class="node-input edge-input"
									type="text"
									value={edge.label}
									placeholder="label"
									onclick={(event) => event.stopPropagation()}
									oninput={(event) => updateEdge(edge.id, { label: event.currentTarget.value })}
								/>
								<button class="btn btn-danger btn-sm" onclick={() => removeEdge(edge.id)}>Remove</button>
							</div>
						{/each}
					{/if}
				</div>
			</div>

			<div class="inspector-grid">
				<section class="inspector-card">
					<h4>Node inspector</h4>
					{#if selectedNodeRef}
						<label>
							<span>Type</span>
							<select class="input" value={selectedNodeRef.type} onchange={(event) => updateNode(selectedNodeRef.id, 'type', event.currentTarget.value)}>
								<option value="trigger">trigger</option>
								<option value="task">task</option>
								<option value="approval">approval</option>
								<option value="branch">branch</option>
							</select>
						</label>
						<label>
							<span>Queue key</span>
							<input class="input" type="text" value={selectedNodeRef.data?.queue_key || ''} oninput={(event) => updateNodeData(selectedNodeRef.id, 'queue_key', event.currentTarget.value)} placeholder="ingest.high-priority" />
						</label>
						<label>
							<span>Retry policy</span>
							<input class="input" type="text" value={selectedNodeRef.data?.retry_policy || ''} oninput={(event) => updateNodeData(selectedNodeRef.id, 'retry_policy', event.currentTarget.value)} placeholder="exponential:3" />
						</label>
						<label>
							<span>Timeout (seconds)</span>
							<input class="input" type="number" min="0" value={selectedNodeRef.data?.timeout_seconds || ''} oninput={(event) => updateNodeData(selectedNodeRef.id, 'timeout_seconds', event.currentTarget.value ? Number(event.currentTarget.value) : '')} placeholder="120" />
						</label>
						<label>
							<span>Condition expression</span>
							<textarea class="input textarea" rows="2" oninput={(event) => updateNodeData(selectedNodeRef.id, 'condition', event.currentTarget.value)}>{selectedNodeRef.data?.condition || ''}</textarea>
						</label>
					{:else}
						<p class="empty-state compact">Select a node to edit behavior and execution metadata.</p>
					{/if}
				</section>

				<section class="inspector-card">
					<h4>Edge inspector</h4>
					{#if selectedEdgeRef}
						<div class="meta-row">
							<span>{edgeRouteDisplay(selectedEdgeRef)}</span>
						</div>
						<label>
							<span>Route label</span>
							<input class="input" type="text" value={selectedEdgeRef.label || ''} oninput={(event) => updateEdge(selectedEdgeRef.id, { label: event.currentTarget.value })} placeholder="success / failure / else" />
						</label>
						<button class="btn btn-danger btn-sm" onclick={() => removeEdge(selectedEdgeRef.id)}>Remove edge</button>
					{:else}
						<p class="empty-state compact">Select a connection path to edit labels and routing intent.</p>
					{/if}
				</section>
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
		<div class="run-controls">
			<select class="input" bind:value={triggerSource}>
				<option value="manual">manual trigger</option>
				<option value="cron">cron replay</option>
				<option value="migration">migration</option>
			</select>
			<input class="input" type="text" bind:value={runSearch} placeholder="Search run id, status, trigger, error" />
			<select class="input" bind:value={runFilter}>
				<option value="all">all statuses</option>
				<option value="queued">queued</option>
				<option value="running">running</option>
				<option value="completed">completed</option>
				<option value="failed">failed</option>
			</select>
		</div>
		<textarea class="input textarea run-input" rows="2" bind:value={runInputJson} placeholder="Optional run payload JSON object"></textarea>
		<div class="runs-list">
			{#if filteredRuns.length === 0}
				<p class="empty-state">No runs yet. Queue one from the template inventory.</p>
			{:else}
				{#each filteredRuns as run (run.id)}
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
	.workflow-shell {
		display: grid;
		gap: 1rem;
		min-width: 0;
	}

	.panel {
		background:
			radial-gradient(circle at top left, hsla(var(--hue), 82%, 62%, 0.18), transparent 38%),
			linear-gradient(180deg, var(--color-surface), var(--color-surface-elevated));
		border: 1px solid var(--color-border);
		border-radius: 1.25rem;
		padding: 1rem;
		box-shadow: var(--shadow-lg);
		min-width: 0;
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
		grid-template-columns: repeat(1, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.stat-card {
		display: grid;
		gap: 0.2rem;
		padding: 0.85rem;
		background: var(--color-surface);
		border-radius: 1rem;
		border: 1px solid var(--color-border);
	}

	.stat-card strong {
		font-size: 1.4rem;
	}

	.section-head {
		display: flex;
		align-items: stretch;
		justify-content: flex-start;
		flex-direction: column;
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
		border: 1px solid var(--color-border);
		border-radius: 1rem;
		background: var(--color-surface-elevated);
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

	.workflow-grid > * {
		min-width: 0;
	}

	.inventory-main {
		display: grid;
		gap: 0.45rem;
		width: 100%;
		padding: 0.95rem;
		text-align: left;
	}

	.inventory-card.selected {
		outline: 2px solid hsla(var(--hue), 82%, 62%, 0.55);
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

	.inventory-title-row,
	.meta-row,
	.run-topline,
	.edge-row {
		flex-wrap: wrap;
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
		background: var(--color-surface-hover);
	}

	.tag-live,
	.run-ok {
		background: var(--color-success-soft);
		color: var(--color-success-hover);
	}

	.run-pending {
		background: var(--color-info-soft);
		color: var(--color-info-hover);
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

	.keyboard-hints {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.pending-link-hint {
		font-size: 0.82rem;
		color: var(--color-text-muted);
		padding: 0.4rem 0.1rem 0;
	}

	.pending-link-hint strong {
		color: var(--color-text);
		font-weight: 700;
	}

	.validation-panel {
		margin-top: 0.8rem;
		padding: 0.85rem 0.95rem;
		border-radius: 0.9rem;
		border: 1px solid var(--color-warning);
		background: var(--color-warning-soft);
		display: grid;
		gap: 0.45rem;
	}

	.validation-panel ul {
		margin: 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.2rem;
	}

	.validation-panel.ok {
		border-color: var(--color-success);
		background: var(--color-success-soft);
	}

	.toolbar-actions,
	.connection-form {
		display: grid;
		gap: 0.65rem;
		grid-template-columns: repeat(1, minmax(0, 1fr));
	}

	.toolbar-actions-scroller {
		overflow-x: auto;
		overflow-y: hidden;
		padding-bottom: 0.25rem;
		-webkit-overflow-scrolling: touch;
	}

	.toolbar-actions-scroller::-webkit-scrollbar {
		height: 6px;
	}

	.toolbar-actions {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: max-content;
		gap: 0.55rem;
		width: max-content;
	}

	.node-legend {
		display: grid;
		grid-template-columns: repeat(1, minmax(0, 1fr));
		gap: 0.45rem;
	}

	.legend-item {
		display: flex;
		gap: 0.55rem;
		align-items: flex-start;
		padding: 0.5rem 0.6rem;
		border-radius: 0.75rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.legend-item strong {
		display: block;
		font-size: 0.83rem;
		line-height: 1.2;
	}

	.legend-item small {
		display: block;
		margin-top: 0.15rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		line-height: 1.3;
	}

	.legend-dot {
		width: 11px;
		height: 11px;
		margin-top: 0.2rem;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.canvas-surface {
		position: relative;
		min-height: 600px;
		max-width: 100%;
		margin-top: 0.85rem;
		border-radius: 1rem;
		border: 1px dashed hsla(var(--hue), 82%, 62%, 0.36);
		background:
			linear-gradient(transparent 31px, hsla(var(--hue), 82%, 62%, 0.14) 32px),
			linear-gradient(90deg, transparent 31px, hsla(var(--hue), 82%, 62%, 0.14) 32px),
			linear-gradient(180deg, var(--color-surface), var(--color-surface-elevated));
		background-size: 32px 32px, 32px 32px, 100% 100%;
		overflow: auto;
		touch-action: pan-x pan-y;
	}

	.canvas-stage {
		position: relative;
		transform-origin: top left;
	}

	.edge-layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: auto;
	}

	.edge-layer path {
		fill: none;
		stroke: hsla(var(--hue), 82%, 62%, 0.66);
		stroke-width: 3;
		stroke-linecap: round;
		cursor: pointer;
		transition: stroke var(--transition-fast), stroke-width var(--transition-fast);
	}

	.edge-hit {
		fill: none;
		stroke: transparent;
		stroke-width: 16;
		cursor: pointer;
	}

	.edge-visual {
		fill: none;
		stroke: hsla(var(--hue), 82%, 62%, 0.72);
		stroke-width: 3;
		color: hsla(var(--hue), 82%, 62%, 0.72);
	}

	.edge-ghost {
		fill: none;
		stroke: hsla(var(--hue), 82%, 62%, 0.88);
		stroke-width: 3;
		stroke-dasharray: 7 7;
		color: hsla(var(--hue), 82%, 62%, 0.88);
		filter: drop-shadow(0 0 6px hsla(var(--hue), 82%, 62%, 0.35));
	}

	.edge-layer path.selected {
		stroke: var(--color-primary-button);
		stroke-width: 4;
	}

	.edge-anchor {
		fill: var(--color-primary-button);
		stroke: var(--color-surface);
		stroke-width: 1.5;
		opacity: 0.95;
	}

	.edge-label-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.edge-chip {
		position: absolute;
		transform: translate(-50%, -50%);
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
		color: var(--color-text);
		font-size: 0.72rem;
		font-weight: 700;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		pointer-events: auto;
	}

	.edge-chip.selected {
		border-color: var(--color-primary);
		background: var(--color-primary-soft);
	}

	.canvas-node {
		position: absolute;
		width: 220px;
		min-height: 252px;
		padding: 0.7rem;
		border-radius: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		box-shadow: var(--shadow-md);
		overflow: visible;
	}

	.canvas-node.dragging {
		box-shadow: 0 0 0 2px hsla(var(--hue), 82%, 62%, 0.5), var(--shadow-lg);
		transform: scale(1.01);
	}

	.canvas-node.selected {
		outline: 2px solid hsla(var(--hue), 82%, 62%, 0.58);
		outline-offset: 2px;
	}

	.canvas-node.link-drag-source {
		outline: 2px solid var(--color-info);
		outline-offset: 2px;
	}

	.canvas-node.link-drag-target {
		outline: 2px solid var(--color-success);
		outline-offset: 2px;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 20%, transparent), var(--shadow-lg);
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

	.node-type {
		background: color-mix(in srgb, var(--node-accent) 22%, transparent);
		color: var(--node-accent);
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		font-weight: 700;
	}

	.node-purpose {
		margin-top: 0.45rem;
		font-size: 0.76rem;
		line-height: 1.32;
		color: var(--color-text-muted);
		min-height: 2.3em;
	}

	.node-quick-actions {
		display: flex;
		gap: 0.45rem;
		flex-wrap: wrap;
		margin-top: 0.55rem;
	}

	.node-port {
		position: absolute;
		top: calc(50% - 10px);
		width: 20px;
		height: 20px;
		border-radius: 999px;
		border: 2px solid var(--color-surface);
		background: var(--color-primary-button);
		box-shadow: 0 0 0 2px hsla(var(--hue), 82%, 62%, 0.45), var(--shadow-sm);
		cursor: crosshair;
		transition: transform var(--transition-fast), box-shadow var(--transition-fast), background var(--transition-fast);
		z-index: 3;
	}

	.node-port.active {
		background: var(--color-success);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 25%, transparent), var(--shadow-md);
	}

	.node-port:hover {
		transform: scale(1.12);
		box-shadow: 0 0 0 3px hsla(var(--hue), 82%, 62%, 0.6), var(--shadow-md);
	}

	.node-port-in {
		left: -13px;
	}

	.node-port-out {
		right: -13px;
	}

	.node-port-label {
		position: absolute;
		transform: translateY(-50%);
		font-size: 0.66rem;
		line-height: 1;
		padding: 0.14rem 0.38rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-surface-elevated) 78%, transparent);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		pointer-events: none;
		z-index: 2;
	}

	.node-port-label-in {
		left: 14px;
	}

	.node-port-label-out {
		right: 14px;
	}

	.node-remove {
		width: 1.8rem;
		height: 1.8rem;
		border-radius: 999px;
		background: var(--color-danger-soft);
		color: var(--color-danger-hover);
	}

	.node-input,
	.input,
	.textarea {
		width: 100%;
		padding: 0.75rem 0.9rem;
		border-radius: 0.85rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
	}

	.textarea {
		resize: vertical;
	}

	.edge-list {
		display: grid;
		gap: 0.55rem;
	}

	.edge-input {
		max-width: 100%;
		padding: 0.45rem 0.6rem;
		font-size: 0.82rem;
	}

	.edge-row,
	.run-card {
		padding: 0.85rem 0.95rem;
	}

	.edge-row {
		border: 1px solid var(--color-border);
		border-radius: 0.85rem;
		background: var(--color-surface);
	}

	.edge-row.selected {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 1px var(--color-primary-soft);
	}

	.inspector-grid {
		display: grid;
		gap: 0.8rem;
		margin-top: 1rem;
	}

	.inspector-card {
		display: grid;
		gap: 0.65rem;
		padding: 0.85rem;
		border: 1px solid var(--color-border);
		border-radius: 0.95rem;
		background: var(--color-surface);
	}

	.inspector-card h4 {
		margin: 0;
		font-size: 0.92rem;
	}

	.inspector-card label {
		display: grid;
		gap: 0.3rem;
		font-size: 0.82rem;
		font-weight: 600;
	}

	.run-controls {
		display: grid;
		gap: 0.65rem;
		grid-template-columns: repeat(1, minmax(0, 1fr));
		margin-bottom: 0.7rem;
	}

	.run-input {
		margin-bottom: 0.8rem;
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
		background: var(--color-success-soft);
		color: var(--color-success-hover);
	}

	.toast-error,
	.run-error {
		background: var(--color-danger-soft);
		color: var(--color-danger-hover);
	}

	.compact {
		font-size: 0.92rem;
	}

	@media (min-width: 900px) {
		.workflow-grid {
			align-items: start;
		}

		.section-head {
			align-items: flex-start;
			justify-content: space-between;
			flex-direction: row;
		}

		.inventory-actions {
			flex-direction: row;
			align-items: center;
		}

		.hero {
			grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.7fr);
			align-items: end;
		}

		.form-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.connection-form {
			grid-template-columns: repeat(6, minmax(0, 1fr));
		}

		.toolbar-actions {
			grid-auto-flow: row;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			grid-auto-columns: unset;
			width: 100%;
		}

		.toolbar-actions-scroller {
			overflow: visible;
		}

		.connection-form {
			grid-template-columns: 1fr 0.9fr 1fr 0.9fr 1fr auto;
		}

		.inspector-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.node-legend {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.run-controls {
			grid-template-columns: 220px minmax(0, 1fr) 220px;
		}

		.starter-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (min-width: 640px) {
		.hero-stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.canvas-node {
			width: min(235px, calc(100vw - 4.5rem));
		}

		.canvas-stage {
			width: 1200px;
		}
	}

	@media (max-width: 640px) {
		.panel {
			padding: 0.85rem;
			border-radius: 1rem;
		}

		.canvas-surface {
			min-height: 500px;
		}

		.keyboard-hints {
			font-size: 0.75rem;
		}

		.pending-link-hint {
			font-size: 0.76rem;
		}

		.edge-row {
			align-items: stretch;
		}
	}

	@media (min-width: 1100px) {
		.hero-stats {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>
