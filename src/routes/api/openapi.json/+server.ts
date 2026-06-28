import { json } from '@sveltejs/kit';
import { openApiDocument } from '$lib/openapi.js';

export function GET() {
	return json(openApiDocument);
}
