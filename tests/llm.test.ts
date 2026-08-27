/** LLM client tests. Port of tests/test_llm_client.py + test_reasoning_options.py. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMClient, LLMError, parseUsage } from '../src/lib/server/llm';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function completion(content: string, extra: Record<string, unknown> = {}): unknown {
	return {
		choices: [{ finish_reason: 'stop', message: { role: 'assistant', content }, ...extra }],
		usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('LLMClient', () => {
	it('requires a configured model', async () => {
		const client = new LLMClient({ apiKey: 'k', model: '' });
		await expect(client.complete([])).rejects.toThrow(LLMError);
		await expect(client.complete([])).rejects.toThrow('text model is not configured');
	});

	it('requires a configured API key', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const client = new LLMClient({ apiKey: '  ', model: 'm' });
		await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
			'Text API key is not configured'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns content and records usage', async () => {
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(completion('Привет')));
		vi.stubGlobal('fetch', fetchMock);
		const client = new LLMClient({ apiKey: 'k', model: 'm' });

		const result = await client.complete([{ role: 'user', content: 'hi' }]);

		expect(result).toBe('Привет');
		expect(client.lastUsage?.prompt_tokens).toBe(10);
		const call = fetchMock.mock.calls[0]!;
		const init = call[1] as RequestInit;
		const payload = JSON.parse(init.body as string);
		expect(payload.model).toBe('m');
		expect(payload.stream).toBe(false);
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer k');
		expect(headers['User-Agent']).toMatch(/^first-person-tales\/\d+\.\d+\.\d+$/);
	});

	it('sends sampling options', async () => {
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(completion('ok')));
		vi.stubGlobal('fetch', fetchMock);
		const client = new LLMClient({ apiKey: 'k', model: 'm' });

		await client.complete([], {
			temperature: 0.75,
			frequencyPenalty: 0.35,
			presencePenalty: 0,
			maxCompletionTokens: 1500,
			topP: 0.95
		});

		const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
		expect(payload.temperature).toBe(0.75);
		expect(payload.frequency_penalty).toBe(0.35);
		expect(payload.presence_penalty).toBe(0);
		expect(payload.max_completion_tokens).toBe(1500);
		expect(payload.top_p).toBe(0.95);
	});

	it('rejects both token limit names', async () => {
		const client = new LLMClient({ apiKey: 'k', model: 'm' });
		await expect(client.complete([], { maxCompletionTokens: 100, maxTokens: 100 })).rejects.toThrow(
			'pass max_completion_tokens'
		);
	});

	it('maps provider HTTP errors', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ error: 'secret details' }, 402));
		vi.stubGlobal('fetch', fetchMock);
		const client = new LLMClient({ apiKey: 'k', model: 'm' });

		await expect(client.complete([])).rejects.toThrow('text provider rejected the request (HTTP 402)');
	});

	it('never retries a failed connection', async () => {
		const fetchMock = vi.fn(async () => {
			throw Object.assign(new Error('socket hang up'), { name: 'Error' });
		});
		vi.stubGlobal('fetch', fetchMock);
		const client = new LLMClient({ apiKey: 'k', model: 'm' });

		await expect(client.complete([])).rejects.toThrow(
			'LLM connection failed; status is unknown and was not retried'
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('reports timeouts without retry', async () => {
		const fetchMock = vi.fn(async () => {
			throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
		});
		vi.stubGlobal('fetch', fetchMock);
		const client = new LLMClient({ apiKey: 'k', model: 'm' });

		await expect(client.complete([])).rejects.toThrow(
			'LLM request timed out; status is unknown and was not retried'
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('rejects finish_reason length', async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ choices: [{ finish_reason: 'length', message: { content: 'x' } }] })
		);
		vi.stubGlobal('fetch', fetchMock);
		const client = new LLMClient({ apiKey: 'k', model: 'm' });

		await expect(client.complete([])).rejects.toThrow('increase the total budget');
	});

	it('requires choices and content', async () => {
		const noChoices = vi.fn(async () => jsonResponse({ choices: [] }));
		vi.stubGlobal('fetch', noChoices);
		const client = new LLMClient({ apiKey: 'k', model: 'm' });
		await expect(client.complete([])).rejects.toThrow('completion returned no choices');

		const noContent = vi.fn(async () =>
			jsonResponse({ choices: [{ finish_reason: 'stop', message: {} }] })
		);
		vi.stubGlobal('fetch', noContent);
		await expect(client.complete([])).rejects.toThrow('completion returned no assistant content');
	});

	it('falls back to reasoning_content', async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				choices: [{ finish_reason: 'stop', message: { content: null, reasoning_content: 'deep' } }]
			})
		);
		vi.stubGlobal('fetch', fetchMock);
		const client = new LLMClient({ apiKey: 'k', model: 'm' });
		await expect(client.complete([])).resolves.toBe('deep');
	});

	it('propagates caller abort as AbortError', async () => {
		const controller = new AbortController();
		controller.abort();
		const fetchMock = vi.fn(async () => {
			throw Object.assign(new Error('aborted'), { name: 'AbortError' });
		});
		vi.stubGlobal('fetch', fetchMock);
		const client = new LLMClient({ apiKey: 'k', model: 'm' });

		await expect(client.complete([], { signal: controller.signal })).rejects.toMatchObject({
			name: 'AbortError'
		});
	});
});

describe('reasoning options', () => {
	async function payloadWith(supports: boolean, options: string[]): Promise<Record<string, unknown>> {
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(completion('ok')));
		vi.stubGlobal('fetch', fetchMock);
		const client = new LLMClient({
			apiKey: 'k',
			model: 'm',
			supportsReasoningEffort: supports,
			reasoningEffortOptions: options
		});
		await client.complete([]);
		const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
		vi.unstubAllGlobals();
		return payload;
	}

	it('omits reasoning when unsupported', async () => {
		const payload = await payloadWith(false, ['high']);
		expect(payload.reasoning).toBeUndefined();
	});

	it('prefers high when offered', async () => {
		const payload = await payloadWith(true, ['low', 'high']);
		expect(payload.reasoning).toEqual({ effort: 'high' });
	});

	it('uses the last option when high is absent', async () => {
		const payload = await payloadWith(true, ['low', 'medium']);
		expect(payload.reasoning).toEqual({ effort: 'medium' });
	});

	it('defaults to high with an empty option list', async () => {
		const payload = await payloadWith(true, []);
		expect(payload.reasoning).toEqual({ effort: 'high' });
	});
});

describe('parseUsage', () => {
	it('parses valid counts', () => {
		expect(parseUsage({ prompt_tokens: 5, completion_tokens: '7', total_tokens: 12 })).toEqual({
			prompt_tokens: 5,
			completion_tokens: 7,
			total_tokens: 12
		});
	});

	it('returns null when nothing usable', () => {
		expect(parseUsage({ prompt_tokens: -1 })).toBeNull();
		expect(parseUsage('nope')).toBeNull();
		expect(parseUsage(null)).toBeNull();
	});
});
