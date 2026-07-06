import { listDocSections } from '$lib/server/docs';

export function load() {
	return { sections: listDocSections() };
}
