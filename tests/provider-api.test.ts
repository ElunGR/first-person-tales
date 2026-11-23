/** Provider retry-policy tests. Port of the retry sections in test_image_gen/test_api. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearModelCapabilitiesForTests,
	cachedModelCapabilities,
	modelRows,
	refreshModels,
	veniceRequest
} from '../src/lib/server/providerApi';
import { setApiKey } from '../src/lib/server/keyring';
import { defaultSettings, resetSettingsStateForTests } from '../src/lib/server/settings';

beforeEach(async () => {
	await setApiKey('venice', 'test-key');
	clearModelCapabilitiesForTests();
});

afterEach(() => {
	vi.unstubAllGlobals();
	clearModelCapabilitiesForTests();
	resetSettingsStateForTests();
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

describe('model catalog metadata', () => {
	/** A trimmed copy of a real Venice text model entry. */
	const TEXT_PAYLOAD = {
		data: [
			{
				id: 'qwen-3-8-27b',
				name: 'Qwen 3.8 27B',
				model_spec: {
					pricing: {
						input: { usd: 0.45, diem: 0.45 },
						output: { usd: 3.2, diem: 3.2 },
						extended: { context_token_threshold: 200000 }
					},
					availableContextTokens: 262144,
					maxCompletionTokens: 65536,
					capabilities: {
						supportsReasoningEffort: true,
						reasoningEffortOptions: ['low', 'high'],
						supportsE2EE: true,
						supportsTeeAttestation: false
					},
					privacy: 'private',
					uncensored: true,
					betaModel: true,
					description: 'Long marketing copy that the picker must not show.'
				}
			},
			{
				id: 'openai-gpt-4o',
				name: 'GPT-4o',
				model_spec: {
					pricing: { input: { usd: 2.5 }, output: { usd: 10 } },
					privacy: 'anonymized',
					capabilities: { supportsE2EE: false, supportsTeeAttestation: true },
					deprecation: {
						autoRemap: false,
						date: '2026-10-21T00:00:00.000Z',
						removesAt: '2026-10-21T00:00:00.000Z'
					}
				}
			}
		]
	};

	it('keeps price, privacy and the other catalog facts on the row', () => {
		const rows = modelRows(TEXT_PAYLOAD, 'venice', 'text');
		expect(rows[0]).toMatchObject({
			id: 'qwen-3-8-27b',
			name: 'Qwen 3.8 27B',
			price_input: 0.45,
			price_output: 3.2,
			privacy: 'private',
			uncensored: true,
			beta: true,
			context_tokens: 262144,
			max_completion_tokens: 65536,
			supports_e2ee: true,
			supports_reasoning_effort: true
		});
		expect(rows[0]['reasoning_effort_options']).toEqual(['low', 'high']);
		expect(rows[0]['deprecation_date']).toBeUndefined();
		// The provider's own prose stays out of the payload.
		expect(rows[0]['description']).toBeUndefined();
	});

	it('reads a deprecation date in either field name and skips false flags', () => {
		const rows = modelRows(TEXT_PAYLOAD, 'venice', 'text');
		expect(rows[1]).toMatchObject({
			privacy: 'anonymized',
			deprecation_date: '2026-10-21T00:00:00.000Z',
			supports_tee_attestation: true
		});
		expect(rows[1]['uncensored']).toBeUndefined();
		expect(rows[1]['beta']).toBeUndefined();
		expect(rows[1]['supports_e2ee']).toBeUndefined();
	});

	it('keeps image generation and upscale prices', () => {
		const rows = modelRows(
			{
				data: [
					{
						id: 'venice-sd35',
						model_spec: {
							pricing: {
								generation: { usd: 0.01, diem: 0.01 },
								upscale: { '2x': { usd: 0.02 }, '4x': { usd: 0.08 } }
							},
							constraints: { promptCharacterLimit: 1500 },
							privacy: 'private',
							uncensored: true
						}
					}
				]
			},
			'venice',
			'image'
		);
		expect(rows[0]).toMatchObject({
			price_generation: 0.01,
			price_upscale_2x: 0.02,
			privacy: 'private',
			uncensored: true,
			prompt_character_limit: 1500
		});
		expect(rows[0]['price_input']).toBeUndefined();
	});

	it('reaches the narrator client through the same catalog cache', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(TEXT_PAYLOAD), { status: 200 }))
		);
		const result = await refreshModels('venice');
		expect(result.errors).toEqual({});
		expect(result.models['text'][0]['price_input']).toBe(0.45);

		const settings = defaultSettings();
		settings.providers['venice']!.text_model = 'qwen-3-8-27b';
		expect(cachedModelCapabilities(settings, 'text')['privacy']).toBe('private');
	});
});
