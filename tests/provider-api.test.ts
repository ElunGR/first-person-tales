/** Provider retry-policy tests. Port of the retry sections in test_image_gen/test_api. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { veniceRequest } from '../src/lib/server/providerApi';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('veniceRequest retry policy', () => {
	it('identifies the application without replacing authentication headers', async () => {
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('ok', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await veniceRequest('GET', 'http://x.test/models', {
			headers: { Authorization: 'Bearer test-key' }
		});
		await veniceRequest('POST', 'http://x.test/image/generate', {
			json: {},
			headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' }
		});

		for (const [, init] of fetchMock.mock.calls) {
			const headers = init.headers as Record<string, string>;
			expect(headers.Authorization).toBe('Bearer test-key');
			expect(headers['User-Agent']).toMatch(/^first-person-tales\/\d+\.\d+\.\d+$/);
		}
	});

	it('retries 429 up to three attempts', async () => {
		const responses = [
			new Response('', { status: 429, headers: { 'Retry-After': '0' } }),
			new Response('', { status: 429, headers: { 'Retry-After': '0' } }),
			new Response('ok', { status: 200 })
		];
		const fetchMock = vi.fn(async () => responses.shift()!);
		vi.stubGlobal('fetch', fetchMock);

		const response = await veniceRequest('GET', 'http://x.test/models');

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('never retries 500 for paid POST requests', async () => {
		const fetchMock = vi.fn(async () => new Response('', { status: 500 }));
		vi.stubGlobal('fetch', fetchMock);

		const response = await veniceRequest('POST', 'http://x.test/image/generate', { json: {} });

		expect(response.status).toBe(500);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('retries 503 for safe GET reads', async () => {
		const responses = [
			new Response('', { status: 503 }),
			new Response('ok', { status: 200 })
		];
		const fetchMock = vi.fn(async () => responses.shift()!);
		vi.stubGlobal('fetch', fetchMock);

		const response = await veniceRequest('GET', 'http://x.test/models');

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('reports timeouts as uncertain, without retrying', async () => {
		const fetchMock = vi.fn(async () => {
			throw new DOMException('timeout', 'TimeoutError');
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(veniceRequest('POST', 'http://x.test/image/generate', { json: {} })).rejects.toThrow(
			'generation status is unknown and was not retried'
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('propagates caller aborts', async () => {
		const controller = new AbortController();
		controller.abort();
		const fetchMock = vi.fn(async () => {
			throw Object.assign(new Error('aborted'), { name: 'AbortError' });
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			veniceRequest('GET', 'http://x.test/models', { signal: controller.signal })
		).rejects.toMatchObject({ name: 'AbortError' });
	});
});
