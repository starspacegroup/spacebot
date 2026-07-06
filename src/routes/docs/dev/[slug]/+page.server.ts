import { error } from '@sveltejs/kit';
import { getDoc, listDocSections } from '$lib/server/docs';

export function load({ params }) {
	const doc = getDoc(params.slug);
	if (!doc) throw error(404, 'Doc not found');
	return { doc, sections: listDocSections() };
}
