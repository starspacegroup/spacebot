import { redirect } from '@sveltejs/kit';
import { clearAuthCookies } from '$lib/server/auth-session.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies }) {
	clearAuthCookies(cookies);
	throw redirect(302, '/');
}
