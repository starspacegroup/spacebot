/**
 * Converts between the simple ordered step-list the workflow editor UI works
 * with, and the canvas_json graph shape the runtime actually executes
 * (src/lib/server/superadmin-workflow-runtime.ts). The runtime itself is
 * never touched — this only changes how the client constructs/reads that
 * JSON blob.
 *
 * IMPORTANT — verified directly against the runtime, not assumed:
 * - A node with 0 outbound edges is a valid terminal step (run completes).
 * - A node with exactly 1 outbound edge is followed unconditionally — its
 *   label/source_handle is never checked. Real preset edges use arbitrary
 *   descriptive labels for this case ("guilds_found", "prepared", ...), not
 *   the route keywords below.
 * - Task nodes never have a real "error" route — on a thrown error the
 *   runtime just marks the run failed and stops; there is no edge-following
 *   for failures. So task steps have no routing UI at all.
 * - Branch nodes only ever route "true" or "false" (see evaluateBranchNode)
 *   — there is no "else" in practice despite the editor's old port labels
 *   suggesting one.
 * - Approval nodes route "approved" or "rejected" (the decision key in
 *   run input_json.approvals[stepId]).
 *
 * v1 scope limit (intentional, see plan): a step is only representable in
 * the simple list if it's reachable via the PRIMARY route chain (task's
 * single edge; approval's "approved"; branch's "true"). Any node only
 * reachable via a non-primary route ("rejected/false" leading somewhere new,
 * not back into the main chain) is treated as too complex for v1 and the
 * whole graph is rejected — the editor falls back to a read-only raw view
 * rather than risk silently mangling it. None of the 7 real seeded
 * templates need more than this.
 */

export type WorkflowNodeType = "trigger" | "task" | "approval" | "branch";

export interface WorkflowGraphNode {
  id: string;
  type: WorkflowNodeType;
  title?: string;
  position?: { x: number; y: number };
  data?: Record<string, any>;
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  source_handle?: string;
  label?: string;
}

export interface WorkflowCanvasJson {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export interface WorkflowStep {
  id: string;
  type: "task" | "approval" | "branch";
  title: string;
  data: Record<string, any>;
  /** routeName -> target step id, or null to end the workflow on that route */
  routes: Record<string, string | null>;
}

export type ParsedWorkflow =
  | { valid: true; triggerData: Record<string, any>; steps: WorkflowStep[] }
  | { valid: false; reason: string; raw: any };

const ROUTES_BY_TYPE: Record<string, string[]> = {
  approval: ["approved", "rejected"],
  branch: ["true", "false"],
};

export function routesForType(type: string): string[] {
  return ROUTES_BY_TYPE[type] || [];
}

export function createStepId(): string {
  return `step-${crypto.randomUUID()}`;
}

export function createStep(type: "task" | "approval" | "branch", title: string): WorkflowStep {
  const routes: Record<string, string | null> = {};
  for (const routeName of routesForType(type)) routes[routeName] = null;
  return {
    id: createStepId(),
    type,
    title,
    data: type === "task" ? { operation: "" } : {},
    routes,
  };
}

function resolveRouteTarget(outgoing: Map<string, WorkflowGraphEdge[]>, node: WorkflowGraphNode, routeName: string): string | null {
  const edgesFromNode = outgoing.get(String(node.id)) || [];
  if (edgesFromNode.length === 0) return null;
  const byHandle = edgesFromNode.find((e) => String(e.source_handle || "").trim() === routeName);
  if (byHandle) return String(byHandle.target);
  const byLabel = edgesFromNode.find((e) => String(e.label || "").trim().toLowerCase() === routeName.toLowerCase());
  if (byLabel) return String(byLabel.target);
  return null;
}

/** Returns the primary-chain successor id, null if terminal, or undefined if "too complex" (2+ edges on a plain task/trigger node). */
function primaryTarget(outgoing: Map<string, WorkflowGraphEdge[]>, node: WorkflowGraphNode): string | null | undefined {
  if (node.type === "task" || node.type === "trigger") {
    const edgesFromNode = outgoing.get(String(node.id)) || [];
    if (edgesFromNode.length === 0) return null;
    if (edgesFromNode.length > 1) return undefined;
    return String(edgesFromNode[0].target);
  }
  for (const routeName of routesForType(node.type)) {
    const target = resolveRouteTarget(outgoing, node, routeName);
    if (target) return target;
  }
  return null;
}

export function parseCanvasJson(canvasJson: unknown): ParsedWorkflow {
  let parsed: WorkflowCanvasJson;
  try {
    parsed = typeof canvasJson === "string" ? JSON.parse(canvasJson || "{}") : ((canvasJson as WorkflowCanvasJson) || { nodes: [], edges: [] });
  } catch {
    return { valid: false, reason: "canvas_json is not valid JSON", raw: canvasJson };
  }

  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const edges = Array.isArray(parsed?.edges) ? parsed.edges : [];
  if (nodes.length === 0) return { valid: true, triggerData: {}, steps: [] };

  const nodeById = new Map(nodes.map((n) => [String(n.id), n]));
  const outgoing = new Map<string, WorkflowGraphEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(String(edge.source)) || [];
    list.push(edge);
    outgoing.set(String(edge.source), list);
  }

  // Mirrors the runtime's own entry-point fallback exactly — not every
  // template has a trigger node (e.g. "Rebuild Stats Recovery Run" enters
  // directly on an approval node).
  const triggerNode = nodes.find((n) => n.type === "trigger") ?? null;
  const entryNode = triggerNode ?? nodes[0];

  let cursor: string | null | undefined = triggerNode
    ? primaryTarget(outgoing, triggerNode)
    : String(entryNode.id);

  if (cursor === undefined) {
    return { valid: false, reason: "the trigger node has more than one outgoing edge", raw: canvasJson };
  }

  const chainOrder: string[] = [];
  const chainSet = new Set<string>();

  while (cursor) {
    if (chainSet.has(cursor)) {
      return { valid: false, reason: "cycle detected in workflow graph", raw: canvasJson };
    }
    const node = nodeById.get(cursor);
    if (!node) {
      return { valid: false, reason: "an edge points to a missing node", raw: canvasJson };
    }
    if (node.type === "trigger") {
      return { valid: false, reason: "a trigger node appears mid-chain", raw: canvasJson };
    }
    chainSet.add(cursor);
    chainOrder.push(cursor);
    const next = primaryTarget(outgoing, node);
    if (next === undefined) {
      return { valid: false, reason: `step "${node.title || node.id}" has more than one outgoing edge`, raw: canvasJson };
    }
    cursor = next;
  }

  // v1 limit: every non-trigger node must be reachable via the primary chain.
  for (const node of nodes) {
    if (node.type === "trigger") continue;
    if (!chainSet.has(String(node.id))) {
      return {
        valid: false,
        reason: `step "${node.title || node.id}" is only reachable via a non-primary route — not supported by the simple editor yet`,
        raw: canvasJson,
      };
    }
  }

  const steps: WorkflowStep[] = chainOrder.map((id) => {
    const node = nodeById.get(id)!;
    const routes: Record<string, string | null> = {};
    for (const routeName of routesForType(node.type)) {
      routes[routeName] = resolveRouteTarget(outgoing, node, routeName);
    }
    return {
      id,
      type: node.type as "task" | "approval" | "branch",
      title: node.title || "",
      data: node.data || {},
      routes,
    };
  });

  return { valid: true, triggerData: triggerNode?.data || {}, steps };
}

export function compileCanvasJson(triggerData: Record<string, any>, steps: WorkflowStep[]): WorkflowCanvasJson {
  const nodes: WorkflowGraphNode[] = [];
  const edges: WorkflowGraphEdge[] = [];
  const triggerId = "start";
  const stamp = Date.now();

  nodes.push({ id: triggerId, type: "trigger", title: "Trigger", position: { x: 0, y: 0 }, data: triggerData });

  steps.forEach((step, index) => {
    nodes.push({
      id: step.id,
      type: step.type,
      title: step.title,
      position: { x: 0, y: (index + 1) * 200 },
      data: step.data,
    });
  });

  if (steps.length > 0) {
    edges.push({ id: `edge-${stamp}-trigger`, source: triggerId, target: steps[0].id, label: "start" });
  }

  steps.forEach((step, index) => {
    const nextStepId = steps[index + 1]?.id ?? null;
    const routeNames = routesForType(step.type);

    if (routeNames.length === 0) {
      // Plain task: a single implicit edge to the following step (or none if last).
      if (nextStepId) {
        edges.push({ id: `edge-${stamp}-${index}-next`, source: step.id, target: nextStepId, label: "next" });
      }
      return;
    }

    routeNames.forEach((routeName, routeIndex) => {
      const target = step.routes[routeName] ?? (routeIndex === 0 ? nextStepId : null);
      if (target) {
        edges.push({
          id: `edge-${stamp}-${index}-${routeName}`,
          source: step.id,
          target,
          source_handle: routeName,
          label: routeName,
        });
      }
    });
  });

  return { nodes, edges };
}
