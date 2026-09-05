/** Shared HTTP error plumbing for API routes. */
import { json } from '@sveltejs/kit';

export class HttpError extends Error {
	readonly status: number;
	readonly detail: unknown;

	constructor(status: number, detail: unknown) {
		super(typeof detail === 'string' ? detail : `HTTP ${status}`);
		this.name = 'HttpError';
		this.status = status;
		this.detail = detail;
	}
}

export function jsonError(status: number, detail: unknown): Response {
	return json({ detail }, { status });
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

function acceptsJsonContentType(request: Request): boolean {
	const contentType = request.headers.get('content-type');
	return contentType !== null && contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function allowsEmptyBody(method: string, pathname: string): boolean {
	if (method === 'DELETE') return true;
	if (method !== 'POST') return false;
	return pathname === '/reset' || pathname === '/resummary/undo' || /\/regenerate$/.test(pathname);
}

/** Enforce the localhost API's browser-origin and JSON request boundary. */
export function validateUnsafeRequest(request: Request, expectedOrigin: string, pathname: string): void {
	if (!UNSAFE_METHODS.has(request.method)) return;
	const origin = request.headers.get('origin');
	if (!origin || origin !== expectedOrigin) {
		throw new HttpError(403, 'cross-origin requests are forbidden');
	}

	const contentLength = request.headers.get('content-length');
	const hasBody = request.body !== null && contentLength !== '0';
	if (hasBody && !acceptsJsonContentType(request)) {
		throw new HttpError(415, 'JSON requests must use Content-Type: application/json');
	}
	if (!hasBody && !allowsEmptyBody(request.method, pathname)) {
		throw new HttpError(415, 'JSON requests must use Content-Type: application/json');
	}
}

export function isAbortError(exc: unknown): boolean {
	return exc instanceof Error && exc.name === 'AbortError';
}
