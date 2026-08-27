/** Typed fetch wrapper mirroring static/app.js api(). */

export interface ApiOptions {
	method?: string;
	body?: unknown;
	signal?: AbortSignal;
	operationId?: string | null;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
	const init: RequestInit = { method: options.method ?? 'GET', headers: {} };
	if (options.operationId) {
		(init.headers as Record<string, string>)['X-Operation-ID'] = options.operationId;
	}
	if (options.signal) init.signal = options.signal;
	if (options.body !== undefined) {
		(init.headers as Record<string, string>)['Content-Type'] = 'application/json';
		init.body = JSON.stringify(options.body);
	}
	const resp = await fetch(path, init);
	if (!resp.ok) {
		let detail: unknown = resp.statusText;
		try {
			const data = (await resp.json()) as { detail?: unknown };
			detail = data.detail ?? detail;
		} catch {
			// Keep statusText.
		}
		const requestId = resp.headers.get('X-Request-ID');
		const suffix = requestId ? ` [ID: ${requestId}]` : '';
		throw new Error((typeof detail === 'string' ? detail : JSON.stringify(detail)) + suffix);
	}
	if (resp.status === 204) return null as T;
	return (await resp.json()) as T;
}

export function isAbortError(err: unknown): boolean {
	return (
		(err instanceof Error && err.name === 'AbortError') ||
		(err instanceof Error && typeof err.message === 'string' && /abort/i.test(err.message))
	);
}
