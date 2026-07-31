/**
 * Global toast store — push notifications from anywhere in the app.
 *
 * Usage:
 *   import { toast } from '$lib/toast.svelte.js';
 *   toast.success('Saved!');
 *   toast.error('Something went wrong');
 *   const id = toast.push('Working…', { type: 'info', duration: 0 }); // sticky
 *   toast.dismiss(id);
 *
 * Render once near the app root with <ToastContainer /> (mounted in +layout.svelte).
 * Follows the same `*.svelte.ts` store convention as theme/command-palette.
 */

export type ToastType = 'success' | 'error' | 'info';

/**
 * An optional call-to-action rendered inside the toast.
 *
 * Exists so a toast that reports creating something can hand you straight to
 * it — "Added /verse" is only half an answer if finding the command is then
 * your problem. Internal hrefs only; the container renders a plain anchor, so
 * SvelteKit client-routes it.
 */
export interface ToastLink {
	href: string;
	label: string;
}

export interface ToastItem {
	id: number;
	message: string;
	type: ToastType;
	/** ms before auto-dismiss; 0 keeps it until dismissed manually */
	duration: number;
	link?: ToastLink;
}

export interface ToastOptions {
	type?: ToastType;
	duration?: number;
	link?: ToastLink;
}

/** Toasts carrying an action get longer on screen — 5s is not enough to read a
 *  message, notice a link, and decide to click it. */
const LINKED_DURATION = 9000;

let _items = $state<ToastItem[]>([]);
let _nextId = 0;
const _timers = new Map<number, ReturnType<typeof setTimeout>>();

const DEFAULT_DURATION = 5000;

function dismiss(id: number) {
	const timer = _timers.get(id);
	if (timer) {
		clearTimeout(timer);
		_timers.delete(id);
	}
	_items = _items.filter((t) => t.id !== id);
}

function push(message: string, options: ToastOptions = {}): number {
	const id = _nextId++;
	const duration = options.duration ?? (options.link ? LINKED_DURATION : DEFAULT_DURATION);
	const item: ToastItem = {
		id,
		message,
		type: options.type ?? 'info',
		duration,
		link: options.link,
	};
	_items = [..._items, item];

	if (duration > 0) {
		_timers.set(
			id,
			setTimeout(() => dismiss(id), duration)
		);
	}
	return id;
}

export const toast = {
	/** Reactive list of active toasts (read inside a component to subscribe). */
	get items(): ToastItem[] {
		return _items;
	},
	push,
	dismiss,
	success(message: string, options: Omit<ToastOptions, 'type'> = {}) {
		return push(message, { ...options, type: 'success' });
	},
	error(message: string, options: Omit<ToastOptions, 'type'> = {}) {
		return push(message, { ...options, type: 'error' });
	},
	info(message: string, options: Omit<ToastOptions, 'type'> = {}) {
		return push(message, { ...options, type: 'info' });
	},
	/** Remove every active toast (e.g. on logout / route reset). */
	clear() {
		for (const timer of _timers.values()) clearTimeout(timer);
		_timers.clear();
		_items = [];
	},
};
