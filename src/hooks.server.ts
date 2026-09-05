/**
 * Server middleware: session bootstrap, recovery-lock, request IDs,
 * failure journaling and JSON error mapping.
 * Port of the FastAPI lifespan + middleware from backend/main.py.
 */
import crypto from 'node:crypto';
import type { Handle } from '@sveltejs/kit';
import { recordFailure } from '$lib/server/diagnostics';
import { HttpError, jsonError, validateUnsafeRequest } from '$lib/server/http';
import { loadOrCreate, recoveryMessage } from '$lib/server/session';

// FastAPI ran load_or_create() in its lifespan hook; SvelteKit imports this
// module once when the server (dev or node build) starts.
loadOrCreate();

export const handle: Handle = async ({ event, resolve }) => {
	const requestId = crypto.randomBytes(16).toString('hex').slice(0, 12);
	let response: Response;
	try {
		const method = event.request.method;
		const pathname = event.url.pathname;
		if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
			validateUnsafeRequest(event.request, event.url.origin, pathname);
		}
		// While recovery is pending, only /reset may mutate anything.
		if (recoveryMessage() && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && pathname !== '/reset') {
			response = jsonError(409, recoveryMessage());
		} else {
			response = await resolve(event);
		}
	} catch (exc) {
		if (exc instanceof HttpError) {
			response = jsonError(exc.status, exc.detail);
		} else {
			throw exc;
		}
	}
	response.headers.set('X-Request-ID', requestId);
	if (response.status >= 500) {
		const provider = response.status === 502 ? 'venice' : null;
		recordFailure({
			requestId,
			method: event.request.method,
			path: event.url.pathname,
			status: response.status,
			category: response.status === 502 ? 'provider_error' : 'http_error',
			source: response.status === 502 ? 'venice' : 'server',
			provider,
			providerStatus: null
		});
	}
	return response;
};
