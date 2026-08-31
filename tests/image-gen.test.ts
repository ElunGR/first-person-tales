/** Image generation tests with stubbed fetch. Port of tests/test_image_gen.py. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateToFile, ImageGenError, saveImageBytes } from '../src/lib/server/imageGen';
import { deleteApiKey, setApiKey } from '../src/lib/server/keyring';
import { clearModelCapabilitiesForTests } from '../src/lib/server/providerApi';
import { imagesDir } from '../src/lib/server/paths';
import { saveSettings, defaultSettings, resetSettingsStateForTests } from '../src/lib/server/settings';
import { useTempDataDir } from './helpers';

useTempDataDir();

const PNG_BYTES = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from('fake-png-body')
]);
const PNG_B64 = PNG_BYTES.toString('base64');

function configureImageModel(model = 'flux-dev'): void {
	const settings = defaultSettings();
	settings.providers['venice']!.image_model = model;
	saveSettings(settings);
}

function catalogResponse(
	modelId: string,
	constraints: Record<string, unknown> = {
		resolutions: ['512x512', '720x1280'],
		defaultResolution: '720x1280',
		aspectRatios: ['16:9', '1:1'],
		defaultAspectRatio: '16:9'
	}
): unknown {
	return {
		data: [
			{
				id: modelId,
				name: modelId,
				model_spec: {
					type: 'image',
					constraints
				}
			}
		]
	};
}

beforeEach(async () => {
	await setApiKey('venice', 'test-key');
	clearModelCapabilitiesForTests();
});

afterEach(() => {
	resetSettingsStateForTests();
	vi.unstubAllGlobals();
});

describe('generateToFile', () => {
	it('requires a selected image model', async () => {
		configureImageModel('');
		await expect(generateToFile('a cat')).rejects.toThrow('no image model selected');
	});

	it('generates and saves a PNG', async () => {
		configureImageModel();
		const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
			if (String(url).includes('/models')) {
				return new Response(JSON.stringify(catalogResponse('flux-dev')), { status: 200 });
			}
			return new Response(JSON.stringify({ images: [PNG_B64] }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		const name = await generateToFile('a cat');

		expect(name).toMatch(/\.png$/);
		const saved = fs.readFileSync(path.join(imagesDir(), name));
		expect(saved.equals(PNG_BYTES)).toBe(true);
		// The generation call used catalog-driven options.
		const generateCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/image/generate'));
		expect(generateCall).toBeTruthy();
		const body = JSON.parse(generateCall![1].body as string);
		expect(body.model).toBe('flux-dev');
		expect(body.format).toBe('png');
		expect(body.resolution).toBe('720x1280');
		expect(body.aspect_ratio).toBe('16:9');
		expect(body.width).toBeUndefined();
		expect(body.height).toBeUndefined();
		expect(body.hide_watermark).toBe(true);
	});

	it('rejects a prompt over the selected model limit before the paid request', async () => {
		configureImageModel();
		const fetchMock = vi.fn(async (url: string) => {
			if (String(url).includes('/models')) {
				return new Response(
					JSON.stringify(catalogResponse('flux-dev', { promptCharacterLimit: 5 })),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ images: [PNG_B64] }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(generateToFile('six!!!')).rejects.toThrow(
			'image prompt exceeds the selected model limit of 5 characters'
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('uses and validates pixel sizing without relying on a non-contract sizingType field', async () => {
		configureImageModel();
		const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
			if (String(url).includes('/models')) {
				return new Response(
					JSON.stringify(
						catalogResponse('flux-dev', {
							defaultWidth: 1024,
							defaultHeight: 768,
							widthHeightDivisor: 64
						})
					),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ images: [PNG_B64] }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		await generateToFile('a cat');

		const generateCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/image/generate'));
		const body = JSON.parse(generateCall![1].body as string);
		expect(body.width).toBe(1024);
		expect(body.height).toBe(768);
		expect(body.aspect_ratio).toBeUndefined();
		expect(body.resolution).toBeUndefined();
	});

	it('does not mix pixel fields into a resolution-based request', async () => {
		configureImageModel();
		const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
			if (String(url).includes('/models')) {
				return new Response(
					JSON.stringify(
						catalogResponse('flux-dev', {
							resolutions: ['1K', '2K'],
							defaultResolution: '1K',
							defaultWidth: 1024,
							defaultHeight: 1024,
							widthHeightDivisor: 64
						})
					),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ images: [PNG_B64] }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		await generateToFile('a cat');

		const generateCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/image/generate'));
		const body = JSON.parse(generateCall![1].body as string);
		expect(body.resolution).toBe('1K');
		expect(body.width).toBeUndefined();
		expect(body.height).toBeUndefined();
	});

	it('rejects pixel dimensions that violate the selected model divisor before the paid request', async () => {
		configureImageModel();
		const fetchMock = vi.fn(async (url: string) => {
			if (String(url).includes('/models')) {
				return new Response(
					JSON.stringify(
						catalogResponse('flux-dev', {
							defaultWidth: 1000,
							defaultHeight: 768,
							widthHeightDivisor: 64
						})
					),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ images: [PNG_B64] }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(generateToFile('a cat')).rejects.toThrow(
			'selected image model dimensions must be divisible by 64'
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('maps provider HTTP errors', async () => {
		configureImageModel();
		const fetchMock = vi.fn(async (url: string) => {
			if (String(url).includes('/models')) {
				return new Response(JSON.stringify(catalogResponse('flux-dev')), { status: 200 });
			}
			return new Response(JSON.stringify({ error: 'nope' }), { status: 500 });
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(generateToFile('a cat')).rejects.toThrow(
			'image provider rejected the request (HTTP 500)'
		);
	});

	it('rejects invalid base64 payloads', async () => {
		configureImageModel();
		const fetchMock = vi.fn(async (url: string) => {
			if (String(url).includes('/models')) {
				return new Response(JSON.stringify(catalogResponse('flux-dev')), { status: 200 });
			}
			return new Response(JSON.stringify({ images: ['!!!not-base64!!!'] }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(generateToFile('a cat')).rejects.toThrow(ImageGenError);
	});

	it('requires an API key', async () => {
		configureImageModel();
		await deleteApiKey('venice');
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(generateToFile('a cat')).rejects.toThrow(/API key|not configured/i);
	});
});

describe('saveImageBytes', () => {
	it('sanitizes filenames and enforces PNG signature', () => {
		const name = saveImageBytes(PNG_BYTES, '.png', 'weird/../name');
		expect(path.basename(name)).toBe(name);
		expect(fs.existsSync(path.join(imagesDir(), name))).toBe(true);

		expect(() => saveImageBytes(Buffer.from('not a png'), '.png')).toThrow(ImageGenError);
	});
});
