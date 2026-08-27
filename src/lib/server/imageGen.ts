/**
 * Image generation through Venice.ai's native POST /image/generate API.
 *
 * The provider, key and exactly one selected image model come from persistent
 * application settings. Results are saved to data/images/.
 * Port of backend/image_gen.py.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { IMAGE_SAFE_MODE } from './config';
import { getApiKey } from './keyring';
import { atomicWriteBytes, MediaValidationError, validateImageBytes } from './mediaIo';
import { imagesDir } from './paths';
import { ProviderError, selectedModelCapabilities, veniceRequest } from './providerApi';
import { loadSettings, providerSettings, providerUrl } from './settings';

export class ImageGenError extends Error {
	/** Raised when image generation fails. */
	constructor(message: string) {
		super(message);
		this.name = 'ImageGenError';
	}
}

function apiServer(): string {
	const settings = loadSettings();
	return providerUrl(settings.active_provider).replace(/\/+$/, '');
}

async function imageHeaders(): Promise<Record<string, string>> {
	const settings = loadSettings();
	const key = await getApiKey(settings.active_provider);
	if (!key.trim()) {
		throw new ImageGenError('image API key is not configured; open Settings and save the key');
	}
	return {
		Authorization: `Bearer ${key}`,
		'Content-Type': 'application/json'
	};
}

/** Write already-decoded image bytes under data/images/. Returns file name. */
export function saveImageBytes(raw: Buffer, ext: string, filename?: string): string {
	try {
		validateImageBytes(raw);
	} catch (exc) {
		if (exc instanceof MediaValidationError) throw new ImageGenError(exc.message);
		throw exc;
	}
	let name = filename ?? `${crypto.randomUUID().replace(/-/g, '')}${ext}`;
	name = path.basename(name).replace(/[^A-Za-z0-9._-]/g, '_');
	if (!path.extname(name)) {
		name = `${name}${ext}`;
	}
	try {
		atomicWriteBytes(imagesDir(), name, raw);
	} catch {
		throw new ImageGenError('could not save image atomically');
	}
	return name;
}

function positiveInt(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isInteger(value)) return null;
	return value > 0 ? value : null;
}

/** Single generation attempt via Venice POST /image/generate. Returns { raw, ext }. */
async function requestImageViaVenice(
	prompt: string,
	model: string,
	capabilities: Record<string, unknown> | null,
	signal?: AbortSignal
): Promise<{ raw: Buffer; ext: string }> {
	const body: Record<string, unknown> = {
		model,
		prompt,
		safe_mode: IMAGE_SAFE_MODE,
		hide_watermark: true,
		format: 'png'
	};
	const caps = capabilities ?? {};
	const resolutions = (caps['resolutions'] as string[] | undefined) ?? [];
	const aspectRatios = (caps['aspect_ratios'] as string[] | undefined) ?? [];
	if (resolutions.length > 0) {
		body['resolution'] = (caps['default_resolution'] as string) || resolutions[0];
	}
	if (aspectRatios.length > 0) {
		const preferred = String(caps['default_aspect_ratio'] || '');
		body['aspect_ratio'] = aspectRatios.includes(preferred) ? preferred : aspectRatios[0];
	}
	const sizingType = String(caps['sizing_type'] || '').toLowerCase();
	if (['pixel', 'pixels', 'width_height', 'width-height'].includes(sizingType)) {
		const width = positiveInt(caps['default_width']);
		const height = positiveInt(caps['default_height']);
		if (width !== null && height !== null) {
			body['width'] = width;
			body['height'] = height;
		}
	}
	const qualities = (caps['qualities'] as string[] | undefined) ?? [];
	const defaultQuality = caps['default_quality'];
	if (caps['supports_quality'] === true && typeof defaultQuality === 'string' && qualities.includes(defaultQuality)) {
		body['quality'] = defaultQuality;
	}
	const url = `${apiServer()}/image/generate`;
	let response: Response;
	try {
		response = await veniceRequest('POST', url, {
			json: body,
			headers: await imageHeaders(),
			timeoutSeconds: 180,
			signal
		});
	} catch (exc) {
		if (signal?.aborted) throw exc;
		if (exc instanceof ProviderError) throw new ImageGenError(exc.message);
		throw new ImageGenError(String((exc as Error)?.message ?? exc));
	}
	if (response.status >= 400) {
		throw new ImageGenError(`image provider rejected the request (HTTP ${response.status})`);
	}
	let data: unknown;
	try {
		data = await response.json();
	} catch {
		throw new ImageGenError('invalid JSON from Venice image endpoint');
	}
	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		throw new ImageGenError('invalid JSON object from Venice image endpoint');
	}
	const images = (data as Record<string, unknown>)['images'];
	if (!Array.isArray(images) || images.length === 0 || typeof images[0] !== 'string') {
		throw new ImageGenError('no base64 image in Venice response');
	}
	const encoded = images[0];
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded.replace(/\s/g, '')) || encoded.replace(/\s/g, '').length % 4 !== 0) {
		throw new ImageGenError('invalid base64 image in Venice response');
	}
	const raw = Buffer.from(encoded, 'base64');
	if (raw.length === 0) {
		throw new ImageGenError('empty image data in Venice response');
	}
	try {
		validateImageBytes(raw);
	} catch (exc) {
		if (exc instanceof MediaValidationError) throw new ImageGenError(exc.message);
		throw exc;
	}
	return { raw, ext: '.png' };
}

/** Generate an image from a text prompt and save it. Returns file name. */
export async function generateToFile(
	prompt: string,
	options: { filename?: string; signal?: AbortSignal } = {}
): Promise<string> {
	const settings = loadSettings();
	const model = providerSettings(settings).image_model;
	if (!model) {
		throw new ImageGenError('no image model selected; open Settings and choose one');
	}
	let capabilities: Record<string, unknown>;
	try {
		capabilities = await selectedModelCapabilities(settings, 'image', options.signal);
	} catch (exc) {
		if (options.signal?.aborted) throw exc;
		if (exc instanceof ProviderError) throw new ImageGenError(exc.message);
		throw new ImageGenError(String((exc as Error)?.message ?? exc));
	}
	const { raw, ext } = await requestImageViaVenice(prompt, model, capabilities, options.signal);
	return saveImageBytes(raw, ext, options.filename);
}
