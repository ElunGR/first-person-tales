import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/lib/frontend/api';

afterEach(() => { vi.unstubAllGlobals(); });

describe('frontend API failure classification', () => {
	it('preserves HTTP status, detail and request id without treating them as an import commit marker', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Import rolled back' }), {
			status: 500, headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'request-fixture' }
		})));
		await expect(api('/import')).rejects.toBeInstanceOf(ApiError);
		await expect(api('/import')).rejects.toMatchObject({
			status: 500, message: 'Import rolled back [ID: request-fixture]'
		});
	});

	it('retains the completed HTTP failure status even with an unreadable error body', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{broken error', {
			status: 503, statusText: 'Unavailable'
		})));
		await expect(api('/import')).rejects.toMatchObject({ name: 'ApiError', status: 503, message: 'Unavailable' });
	});

	it('does not classify a lost transport as a definite HTTP refusal', async () => {
		const error = new TypeError('Failed to fetch');
		vi.stubGlobal('fetch', vi.fn(async () => { throw error; }));
		await expect(api('/import')).rejects.toBe(error);
		expect(error).not.toBeInstanceOf(ApiError);
	});

	it('does not classify unreadable success JSON as a definite HTTP refusal', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{broken success', { status: 200 })));
		await expect(api('/import')).rejects.toBeInstanceOf(SyntaxError);
		await expect(api('/import')).rejects.not.toBeInstanceOf(ApiError);
	});

	it('keeps successful empty and JSON responses compatible', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(Response.json({ text: 'fixture' })));
		expect(await api('/empty')).toBeNull();
		expect(await api('/json')).toEqual({ text: 'fixture' });
	});
});
