export interface RunnerAssistantHistoryEntry {
	role: string;
	content: string;
}

export interface RunnerAssistantRequest {
	message: string;
	history?: RunnerAssistantHistoryEntry[];
	userName?: string | null;
	managedGuilds?: unknown[];
	selectedGuild?: Record<string, unknown> | null;
	selectedGuildId?: string | null;
	selectedGuildName?: string | null;
	maxToolIterations?: number;
	isSuperAdmin?: boolean;
}

export interface RunnerAssistantResponse {
	success: boolean;
	response?: string;
	toolsUsed?: string[];
	contextSource?: string;
	managedGuildCount?: number;
	selectedGuildId?: string | null;
	error?: string;
}

const MANAGEMENT_INTENT_RE =
	/\b(spacebot|discord|server|servers|guild|guilds|automation|automations|command|commands|slash\s+command|webhook|webhooks|event\s+logs?|logs?|stats?|members?|roles?|channels?|scheduled\s+events?|event\s+links?|voice\s+activity|settings|integrations?|api\s+keys?|billing|local\s+runner|local\s+runners|runner|runners)\b/i;

export function isSpaceBotManagementRequest(message: string): boolean {
	return MANAGEMENT_INTENT_RE.test(String(message || ''));
}

export interface RunnerGuildsResponse {
	success: boolean;
	scope?: 'all' | 'managed';
	guilds?: Array<Record<string, unknown>>;
	error?: string;
}

/**
 * Deterministic (non-LLM) Discord server listing — hits /api/runner/guilds
 * directly instead of round-tripping through the chat assistant.
 */
export async function fetchRunnerGuilds(
	apiUrl: string,
	token: string
): Promise<RunnerGuildsResponse> {
	if (!token?.startsWith('sbr_')) {
		return { success: false, error: 'Runner token is not configured' };
	}

	try {
		const response = await fetch(`${apiUrl.replace(/\/$/, '')}/api/runner/guilds`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		const body = await response.json().catch(() => ({}));
		if (!response.ok) {
			return {
				success: false,
				error: typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`,
			};
		}

		return {
			success: Boolean(body?.success),
			scope: body?.scope === 'all' ? 'all' : 'managed',
			guilds: Array.isArray(body?.guilds) ? body.guilds : [],
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function callRunnerAssistant(
	apiUrl: string,
	token: string,
	payload: RunnerAssistantRequest
): Promise<RunnerAssistantResponse> {
	if (!token?.startsWith('sbr_')) {
		return { success: false, error: 'Runner token is not configured' };
	}

	try {
		const response = await fetch(`${apiUrl.replace(/\/$/, '')}/api/runner/assistant`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(payload),
		});

		const body = await response.json().catch(() => ({}));
		if (!response.ok) {
			return {
				success: false,
				error: typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`,
			};
		}

		return {
			success: Boolean(body?.success),
			response: typeof body?.response === 'string' ? body.response : '',
			toolsUsed: Array.isArray(body?.toolsUsed) ? body.toolsUsed : [],
			contextSource: typeof body?.contextSource === 'string' ? body.contextSource : undefined,
			managedGuildCount:
				typeof body?.managedGuildCount === 'number' ? body.managedGuildCount : undefined,
			selectedGuildId:
				typeof body?.selectedGuildId === 'string' ? body.selectedGuildId : null,
			error: typeof body?.error === 'string' ? body.error : undefined,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
