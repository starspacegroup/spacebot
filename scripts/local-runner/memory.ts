/**
 * Persistent runner memory, stored as markdown inside the runner home.
 *
 * - SYSTEM.md   – machine profile. The block between the auto markers is
 *                 rewritten on every refresh; everything outside it (manual
 *                 notes) is preserved. Profile changes between refreshes are
 *                 logged to the journal, so the runner's knowledge of the
 *                 system keeps accumulating instead of being a one-shot dump.
 * - MEMORY.md   – one-line index of stored memories.
 * - memory/*.md – one file per remembered fact.
 * - journal/    – daily activity logs the runner appends to as it works.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
	appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { gatherSystemProfile, type RunnerSystemProfile } from './capabilities';

const AUTO_BEGIN =
	'<!-- spacebot:auto:begin — this block is rewritten on every runner start; edit outside it -->';
const AUTO_END = '<!-- spacebot:auto:end -->';

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export function appendJournal(root: string, message: string): void {
	try {
		const now = new Date();
		const day = now.toISOString().slice(0, 10);
		const dir = join(root, 'journal');
		mkdirSync(dir, { recursive: true });
		const file = join(dir, `${day}.md`);
		if (!existsSync(file)) {
			writeFileSync(file, `# Journal — ${day}\n\n`, 'utf8');
		}
		const time = now.toISOString().slice(11, 19);
		appendFileSync(file, `- ${time}Z ${message}\n`, 'utf8');
	} catch {
		// Memory writes must never break the runner.
	}
}

// ---------------------------------------------------------------------------
// SYSTEM.md
// ---------------------------------------------------------------------------

function formatGiB(bytes: number): string {
	return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB`;
}

function renderAutoSection(profile: RunnerSystemProfile): string {
	const tools = Object.entries(profile.installedApps.tools).sort(([a], [b]) =>
		a.localeCompare(b)
	);
	const available = tools.filter(([, ok]) => ok).map(([name]) => name);
	const missing = tools.filter(([, ok]) => !ok).map(([name]) => name);

	const lines = [
		AUTO_BEGIN,
		'',
		`_Last refreshed: ${profile.collectedAt}_`,
		'',
		'## Machine',
		'',
		`- Hostname: ${profile.os.hostname}`,
		`- OS: ${profile.machine.osFamily} (${profile.os.platform} ${profile.os.release}, ${profile.os.arch})`,
		`- User: ${profile.os.username ?? 'unknown'}`,
		`- Class: ${profile.machine.class}${profile.machine.hasDisplay ? ', display attached' : ', headless'}`,
		`- CPUs: ${profile.hardware.cpuCount}, Memory: ${formatGiB(profile.hardware.totalMemoryBytes)}`,
		'',
		'## Displays',
		'',
		profile.displays.count > 0
			? profile.displays.items
					.map(
						(d) =>
							`- ${d.id}: ${d.width}x${d.height} at ${d.x},${d.y}${d.primary ? ' (primary)' : ''}`
					)
					.join('\n')
			: '- None detected',
		'',
		'## Package managers',
		'',
		profile.installedApps.packageManagers.length > 0
			? profile.installedApps.packageManagers.map((p) => `- ${p}`).join('\n')
			: '- None detected',
		'',
		'## Tools',
		'',
		`- Available: ${available.join(', ') || 'none detected'}`,
		`- Not found: ${missing.join(', ') || 'none'}`,
		'',
		'## Runner capabilities',
		'',
		`- Screenshots: ${profile.capabilities.screenshotAvailable ? 'yes' : 'no'}`,
		`- VS Code control: ${profile.capabilities.vscodeControlAvailable ? 'yes' : 'no'}`,
		`- Copilot bridge: ${profile.capabilities.copilotMessageAvailable ? 'yes' : 'no'}`,
		'',
		AUTO_END,
	];
	return lines.join('\n');
}

function diffProfiles(previous: RunnerSystemProfile | null, next: RunnerSystemProfile): string[] {
	if (!previous) return ['System profile collected for the first time.'];
	const changes: string[] = [];

	const prevTools = previous.installedApps?.tools ?? {};
	const nextTools = next.installedApps.tools;
	for (const [name, ok] of Object.entries(nextTools)) {
		const before = prevTools[name];
		if (before === undefined && ok) changes.push(`New tool detected: ${name}`);
		else if (before === true && !ok) changes.push(`Tool no longer found: ${name}`);
		else if (before === false && ok) changes.push(`Tool now available: ${name}`);
	}

	const prevPm = new Set(previous.installedApps?.packageManagers ?? []);
	for (const pm of next.installedApps.packageManagers) {
		if (!prevPm.has(pm)) changes.push(`New package manager detected: ${pm}`);
	}

	if ((previous.displays?.count ?? 0) !== next.displays.count) {
		changes.push(
			`Display count changed: ${previous.displays?.count ?? 0} → ${next.displays.count}`
		);
	}
	if (previous.os?.release !== next.os.release) {
		changes.push(`OS release changed: ${previous.os?.release} → ${next.os.release}`);
	}
	if ((previous.hardware?.totalMemoryBytes ?? 0) !== next.hardware.totalMemoryBytes) {
		changes.push(
			`Total memory changed: ${formatGiB(previous.hardware?.totalMemoryBytes ?? 0)} → ${formatGiB(next.hardware.totalMemoryBytes)}`
		);
	}

	return changes;
}

/**
 * Refresh SYSTEM.md from a freshly gathered profile, preserving any content
 * outside the auto-generated markers, and journal what changed since the last
 * refresh. Returns the detected changes.
 */
export function refreshSystemMemory(root: string): { changes: string[] } {
	try {
		const profile = gatherSystemProfile();
		const cacheFile = join(root, '.state', 'system-profile.json');

		let previous: RunnerSystemProfile | null = null;
		try {
			if (existsSync(cacheFile)) previous = JSON.parse(readFileSync(cacheFile, 'utf8'));
		} catch {
			previous = null;
		}

		const autoSection = renderAutoSection(profile);
		const systemMd = join(root, 'SYSTEM.md');

		let content: string;
		if (!existsSync(systemMd)) {
			content = [
				`# System Memory — ${profile.os.hostname}`,
				'',
				autoSection,
				'',
				'## Notes',
				'',
				'Durable observations about this machine live here — the runner and you can',
				'both add to this section; it is never overwritten.',
				'',
			].join('\n');
		} else {
			const existing = readFileSync(systemMd, 'utf8');
			const beginIdx = existing.indexOf(AUTO_BEGIN);
			const endIdx = existing.indexOf(AUTO_END);
			if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
				content =
					existing.slice(0, beginIdx) +
					autoSection +
					existing.slice(endIdx + AUTO_END.length);
			} else {
				// No markers yet (e.g. migrated legacy file) — put the auto block on top
				// and keep everything that was there.
				content = `${autoSection}\n\n${existing}`;
			}
		}

		writeFileSync(systemMd, content, 'utf8');
		mkdirSync(join(root, '.state'), { recursive: true });
		writeFileSync(cacheFile, JSON.stringify(profile, null, 2) + '\n', 'utf8');

		const changes = diffProfiles(previous, profile);
		for (const change of changes) {
			appendJournal(root, `system: ${change}`);
		}
		return { changes };
	} catch {
		return { changes: [] };
	}
}

// ---------------------------------------------------------------------------
// Memory entries + MEMORY.md index
// ---------------------------------------------------------------------------

function slugify(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
	return slug || `memory-${Date.now()}`;
}

export function saveMemory(
	root: string,
	title: string,
	body: string
): { ok: boolean; file?: string; error?: string } {
	try {
		const slug = slugify(title);
		const dir = join(root, 'memory');
		mkdirSync(dir, { recursive: true });
		const file = join(dir, `${slug}.md`);
		const savedAt = new Date().toISOString();
		writeFileSync(
			file,
			[`# ${title.trim()}`, '', `_Saved: ${savedAt}_`, '', body.trim(), ''].join('\n'),
			'utf8'
		);

		const indexFile = join(root, 'MEMORY.md');
		const header =
			'# SpaceBot Memory Index\n\nOne line per stored memory. Full content lives in `memory/`.\n\n';
		const existing = existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : header;
		const entryLine = `- [${title.trim()}](memory/${slug}.md) — saved ${savedAt.slice(0, 10)}`;
		const kept = existing
			.split('\n')
			.filter((line) => !line.includes(`(memory/${slug}.md)`))
			.join('\n')
			.replace(/\n+$/, '');
		const lastLine = kept.split('\n').pop() ?? '';
		const separator = lastLine.startsWith('- ') ? '\n' : '\n\n';
		writeFileSync(indexFile, `${kept}${separator}${entryLine}\n`, 'utf8');

		appendJournal(root, `memory: saved "${title.trim()}" (memory/${slug}.md)`);
		return { ok: true, file };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

// ---------------------------------------------------------------------------
// Prompt context
// ---------------------------------------------------------------------------

/**
 * Build a compact context string (system summary + stored memories) to prepend
 * to LLM prompts so local answers reflect what the runner knows.
 */
export function buildMemoryContext(root: string, maxChars = 4000): string {
	const parts: string[] = [];

	try {
		const cacheFile = join(root, '.state', 'system-profile.json');
		if (existsSync(cacheFile)) {
			const profile: RunnerSystemProfile = JSON.parse(readFileSync(cacheFile, 'utf8'));
			const tools = Object.entries(profile.installedApps?.tools ?? {})
				.filter(([, ok]) => ok)
				.map(([name]) => name);
			const osFamily = profile.machine?.osFamily ? `${profile.machine.osFamily}, ` : '';
			const release = profile.os?.release ? ` ${profile.os.release}` : '';
			const displayCount = profile.displays?.count ?? 0;
			const displaySummary =
				displayCount > 0
					? ` ${displayCount} display${displayCount === 1 ? '' : 's'}/monitor${displayCount === 1 ? '' : 's'}` +
						(Array.isArray(profile.displays?.items) && profile.displays.items.length > 0
							? ` (${profile.displays.items
									.map(
										(d) =>
											`${d.width}x${d.height}${d.primary ? ' primary' : ''}`
									)
									.join(', ')})`
							: '') +
						'.'
					: ' No displays detected (headless).';
			parts.push(
				`This machine: ${profile.os.hostname} (${osFamily}${profile.os.platform}${release}/${profile.os.arch}), ` +
					`${profile.hardware.cpuCount} CPUs, ${formatGiB(profile.hardware.totalMemoryBytes)} RAM.` +
					displaySummary +
					` Available tools: ${tools.join(', ') || 'unknown'}.`
			);
		}
	} catch {
		// Context is best-effort.
	}

	try {
		const dir = join(root, 'memory');
		if (existsSync(dir)) {
			const files = readdirSync(dir)
				.filter((name) => name.endsWith('.md'))
				.map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
				.sort((a, b) => b.mtime - a.mtime);

			let used = parts.join('\n').length;
			const memoryBlocks: string[] = [];
			for (const { name } of files) {
				const text = readFileSync(join(dir, name), 'utf8').trim();
				if (used + text.length > maxChars) break;
				memoryBlocks.push(text);
				used += text.length;
			}
			if (memoryBlocks.length > 0) {
				parts.push(`Stored memories:\n\n${memoryBlocks.join('\n\n---\n\n')}`);
			}
		}
	} catch {
		// Context is best-effort.
	}

	return parts.join('\n\n').slice(0, maxChars);
}
