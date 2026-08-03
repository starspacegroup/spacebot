/**
 * Turning MCP tool definitions into real function calls.
 *
 * The DM assistant used to advertise its tools only as prose in the system
 * prompt and then regex-scan the reply for a ```tool JSON blob. When the model
 * answered in prose instead — which it does, especially for a multi-turn
 * reference like "publish that" — nothing was parsed, the loop exited, and the
 * prose went to the user verbatim. For a question that is merely unhelpful; for
 * an action it means the bot confidently describes work it never did.
 *
 * So: tools are now sent natively and `tool_calls` is read back. The prose
 * parser stays as a fallback, because the Ollama dev path and older models
 * never get a native `tools` array.
 *
 * Everything here is pure so it can be tested without a model.
 */

/** MCP params are prose (`'string (required) - The Discord server ID'`). */
const PARAM_SPEC =
	/^\s*(string|number|integer|boolean|array|object)\b\s*(?:\(\s*(required|optional)\s*\))?\s*[-–—:]?\s*([\s\S]*)$/i;

const JSON_TYPES: Record<string, string> = {
	string: 'string',
	number: 'number',
	integer: 'integer',
	boolean: 'boolean',
	array: 'array',
	object: 'object',
};

/**
 * Convert one tool's prose parameter map into a JSON Schema object.
 * Anything unrecognised degrades to an optional string rather than being
 * dropped — a slightly loose schema beats a tool the model cannot call.
 */
export function toolParamsToJsonSchema(parameters?: Record<string, string> | null) {
	const properties: Record<string, any> = {};
	const required: string[] = [];

	for (const [name, spec] of Object.entries(parameters || {})) {
		const match = PARAM_SPEC.exec(String(spec ?? ''));
		const rawType = match?.[1]?.toLowerCase();
		const type = (rawType && JSON_TYPES[rawType]) || 'string';
		const description = (match?.[3] || String(spec ?? '')).trim();

		properties[name] = { type, description };
		if (type === 'array') properties[name].items = { type: 'string' };
		if (match?.[2]?.toLowerCase() === 'required') required.push(name);
	}

	const schema: Record<string, any> = { type: 'object', properties };
	if (required.length) schema.required = required;
	return schema;
}

/** MCP_TOOLS → the `tools` array Workers AI / OpenAI-style APIs expect. */
export function buildFunctionTools(tools: Array<Record<string, any>>) {
	return (tools || [])
		.filter((tool) => tool && typeof tool.name === 'string')
		.map((tool) => ({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description || '',
				parameters: toolParamsToJsonSchema(tool.parameters),
			},
		}));
}

/**
 * Normalize a native `tool_calls` payload into the `{tool, args}` shape the
 * executor already speaks.
 *
 * Providers disagree on the wire format: Workers AI returns
 * `{name, arguments: {...}}` while OpenAI-style returns
 * `{function: {name, arguments: "<json string>"}}`. Accept both rather than
 * betting on one.
 */
export function normalizeNativeToolCalls(rawToolCalls: any): Array<{ tool: string; args: any }> {
	if (!Array.isArray(rawToolCalls)) return [];

	const calls: Array<{ tool: string; args: any }> = [];
	for (const raw of rawToolCalls) {
		const name = raw?.name || raw?.function?.name;
		if (typeof name !== 'string' || !name) continue;

		let args = raw?.arguments ?? raw?.function?.arguments ?? raw?.parameters ?? {};
		if (typeof args === 'string') {
			try {
				args = JSON.parse(args);
			} catch {
				args = {};
			}
		}
		if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};

		calls.push({ tool: name, args });
	}
	return calls;
}

/**
 * Tools that change something, as opposed to answering a question.
 *
 * Used to tell "the model looked something up and then narrated" apart from
 * "the model actually did the thing".
 */
export function isActionTool(toolName: string): boolean {
	return /^(create|preview|confirm|send|start|cancel|retry|open|delete|update|apply)_/.test(
		String(toolName || '')
	);
}

// A request to *do* something…
const ACTION_VERBS =
	/\b(creat(?:e|ing)|mak(?:e|ing)|schedul(?:e|ing)|publish(?:ing)?|post(?:ing)?|send(?:ing)?|announc(?:e|ing)|add(?:ing)?|delet(?:e|ing)|remov(?:e|ing)|cancel(?:ling|ing)?|renam(?:e|ing)|updat(?:e|ing)|enabl(?:e|ing)|disabl(?:e|ing)|kick(?:ing)?|ban(?:ning)?|set\s+up)\b/i;

// …as opposed to a request to *look at* something. Deliberately does not
// include "can"/"could"/"will": "can you create an event" is an action.
const READ_ONLY_OPENERS = /^\s*[^a-z]*\b(what|who|whom|when|where|why|which|how|show|list|tell)\b/i;

/**
 * Whether the user asked for something to be done.
 *
 * Conservative by design: this only ever *adds* a failure message when no
 * action tool ran, so a false positive would tell a user something didn't
 * happen when nothing needed to. Read-style openers are therefore excluded even
 * when they contain an action verb ("what events did you create").
 */
export function detectActionIntent(message: string): boolean {
	const text = String(message || '').trim();
	if (!text) return false;
	if (READ_ONLY_OPENERS.test(text)) return false;
	return ACTION_VERBS.test(text);
}

/**
 * Did this turn actually perform the action the user asked for?
 *
 * `false` means the reply is about to describe work that never happened.
 */
export function actionWasAttempted(toolsUsed: string[]): boolean {
	return (toolsUsed || []).some(isActionTool);
}
