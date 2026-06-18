import { text } from '@sveltejs/kit';

const deployPort = typeof process !== 'undefined' ? (process.env.DEPLOY_WEBHOOK_PORT || '9090') : '9090';
const LOCAL_DEPLOY_URL = `http://127.0.0.1:${deployPort}`;

/** @type {import('./$types').RequestHandler} */
export async function GET() {
	return text('ok');
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	const body = await request.arrayBuffer();
	const headers = new Headers(request.headers);
	headers.delete('host');
	headers.delete('content-length');

	let response;
	try {
		response = await fetch(LOCAL_DEPLOY_URL, {
			method: 'POST',
			headers,
			body,
		});
	} catch {
		return text('Deploy service unavailable', { status: 503 });
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}