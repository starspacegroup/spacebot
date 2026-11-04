/**
 * Each game's settings panel, by registry id (`$lib/games/registry.ts`).
 *
 * A game with no entry here has no Settings button. A panel gets the whole page
 * data and the page's `keepValues` enhance callback, and every form in it must
 * use `use:enhance={keepValues}` (see activity-form-keeps-values.test.ts).
 */
import type { Component } from 'svelte';
import AgentGameSettings from './AgentGameSettings.svelte';
import ShiritoriSettings from './ShiritoriSettings.svelte';

export interface GameSettingsProps {
	/** The Activity admin page's data. */
	data: any;
	keepValues: () => (opts: {
		update: (o?: { reset?: boolean }) => Promise<void>;
	}) => Promise<void>;
}

export const GAME_SETTINGS: Record<string, Component<GameSettingsProps>> = {
	agent: AgentGameSettings,
	shiritori: ShiritoriSettings,
};
