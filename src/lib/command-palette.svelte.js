/**
 * Shared signal for opening the command palette from anywhere.
 * Import and call `commandPalette.open()` to trigger it.
 */

let _version = $state(0);

export const commandPalette = {
	/** Incremented each time open is requested */
	get version() { return _version; },
	
	/** Request the palette to open */
	open() { _version++; }
};
