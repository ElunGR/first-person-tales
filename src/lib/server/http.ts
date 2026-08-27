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

export function isAbortError(exc: unknown): boolean {
	return exc instanceof Error && exc.name === 'AbortError';
}
