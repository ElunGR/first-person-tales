import type { RequestEvent } from '@sveltejs/kit';

/**
 * The icon itself lives in `static/`, which the app server serves directly.
 * Reading `<root>/static/favicon.svg` from here broke whenever RPG_ROOT_DIR
 * pointed away from the application folder (the request returned 500), so the
 * route only points at the static asset.
 */
export function GET({ url }: RequestEvent): Response {
	// A plain mutable response: the server hook adds X-Request-ID to every reply,
	// and Response.redirect() headers are immutable.
	return new Response(null, { status: 308, headers: { location: new URL('/favicon.svg', url).pathname } });
}
