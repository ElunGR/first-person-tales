/**
 * Provider catalog and shared Venice request handling.
 * Port of backend/provider_api.py.
 */
import { APPLICATION_USER_AGENT } from './config';
import { getApiKey, type ProviderName } from './keyring';
import { providerSettings, providerUrl, type AppSettings } from './settings';

export class ProviderError extends Error {
	constructor(message: string) {
		// Provider response bodies may contain prompts, account details, or
		// other sensitive data; only retain the stable HTTP category.
		super(message.replace(/(HTTP\s+\d{3})(?::.*)$/i, '$1'));
		this.name = 'ProviderError';
	}
}

const MAX_REQUEST_ATTEMPTS = 3;
const MODEL_CAPABILITIES = new Map<string, Record<string, unknown>>();

/** Test hook. */
export function clearModelCapabilitiesForTests(): void {
	MODEL_CAPABILITIES.clear();
}

function sleep(seconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/** Use Venice's rate-limit reset when supplied, otherwise back off. */
function retryDelay(headers: Headers, attempt: number): number {
	const retryAfter = headers.get('Retry-After');
	if (retryAfter) {
		let delay = Number(retryAfter);
		if (!Number.isFinite(delay)) delay = 0;
		if (delay >= 0) return Math.min(delay, 30.0);
	}
	const reset = headers.get('x-ratelimit-reset-requests');
	if (reset) {
		let delay = Number(reset) - Date.now() / 1000;
		if (!Number.isFinite(delay)) delay = 0;
		if (delay >= 0) return Math.min(delay, 30.0);
	}
	return Math.min(1.0 * 2 ** attempt, 10.0);
}

/** Retry 429 always. Retry 500/503 only for safe reads, never paid POSTs. */
function mayRetryStatus(method: string, statusCode: number): boolean {
	if (statusCode === 429) return true;
	return method.toUpperCase() === 'GET' && (statusCode === 500 || statusCode === 503);
}

export interface VeniceRequestOptions {
	json?: unknown;
	headers?: Record<string, string>;
	timeoutSeconds?: number;
	signal?: AbortSignal;
}

/**
 * Retry only explicit Venice transient responses.
 *
 * A timeout or a broken connection leaves a paid request's outcome unknown.
 * It is deliberately not repeated: retrying it could create and charge for a
 * second image. The same rule applies to 500/503 on POST: the first request
 * may already have been billed.
 */
export async function veniceRequest(
	method: string,
	url: string,
	options: VeniceRequestOptions = {}
): Promise<Response> {
	for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
		let response: Response;
		const timeoutSignal = AbortSignal.timeout((options.timeoutSeconds ?? 180) * 1000);
		const signals = options.signal ? [timeoutSignal, options.signal] : [timeoutSignal];
		try {
			response = await fetch(url, {
				method,
				headers: { ...options.headers, 'User-Agent': APPLICATION_USER_AGENT },
				body: options.json === undefined ? undefined : JSON.stringify(options.json),
				signal: AbortSignal.any(signals)
			});
		} catch (exc) {
			if (options.signal?.aborted) throw exc;
			if ((exc as Error)?.name === 'TimeoutError') {
				throw new ProviderError(
					'connection to Venice timed out; generation status is unknown and was not retried'
				);
			}
			throw new ProviderError(
				'connection to Venice was interrupted; generation status is unknown and was not retried'
			);
		}
		if (!mayRetryStatus(method, response.status) || attempt === MAX_REQUEST_ATTEMPTS - 1) {
			return response;
		}
		await sleep(retryDelay(response.headers, attempt));
	}
	throw new Error('unreachable');
}

async function providerHeaders(provider: ProviderName): Promise<Record<string, string>> {
	const key = await getApiKey(provider);
	if (!key) {
		throw new ProviderError(`API key for ${provider} is not configured; open Settings and save the key`);
	}
	return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Python `a or b` truthiness (empty arrays/strings fall through). */
function orValue(a: unknown, b: unknown): unknown {
	if (a === null || a === undefined || a === '' || a === 0 || a === false) return b;
	if (Array.isArray(a) && a.length === 0) return b;
	return a;
}

function items(payload: unknown): Record<string, unknown>[] {
	if (!isPlainObject(payload)) return [];
	const raw = orValue(payload['data'], payload['models']) ?? [];
	if (!Array.isArray(raw)) return [];
	return raw.filter((item): item is Record<string, unknown> => isPlainObject(item));
}

function constraintsOf(item: Record<string, unknown>): Record<string, unknown> {
	const spec = item['model_spec'];
	const specObj = isPlainObject(spec) ? spec : {};
	const constraints = specObj['constraints'];
	return isPlainObject(constraints) ? constraints : item;
}

function capabilitiesOf(item: Record<string, unknown>): Record<string, unknown> {
	const spec = item['model_spec'];
	if (!isPlainObject(spec)) return {};
	const capabilities = spec['capabilities'];
	return isPlainObject(capabilities) ? capabilities : {};
}

function strings(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		if (typeof item === 'string' || (typeof item === 'number' && Number.isInteger(item))) {
			out.push(String(item));
		}
	}
	return out;
}

export function modelRows(payload: unknown, provider: ProviderName, kind: string): Record<string, unknown>[] {
	const rows: Record<string, unknown>[] = [];
	const seen = new Set<string>();
	for (const item of items(payload)) {
		const modelId = String(item['id'] || item['model'] || '').trim();
		if (!modelId || seen.has(modelId)) continue;
		seen.add(modelId);
		const constraints = constraintsOf(item);
		const row: Record<string, unknown> = { id: modelId, name: String(item['name'] || modelId) };
		if (kind === 'text') {
			const capabilities = capabilitiesOf(item);
			const supports = capabilities['supportsReasoningEffort'];
			const options = strings(
				orValue(capabilities['reasoningEffortOptions'], capabilities['reasoning_effort_options'])
			);
			if (typeof supports === 'boolean') {
				row['supports_reasoning_effort'] = supports;
			} else if (options.length > 0) {
				row['supports_reasoning_effort'] = true;
			}
			if (options.length > 0) {
				row['reasoning_effort_options'] = options;
			}
		} else if (kind === 'image') {
			row['resolutions'] = strings(constraints['resolutions']);
			row['aspect_ratios'] = strings(orValue(constraints['aspectRatios'], constraints['aspect_ratios']));
			row['default_resolution'] = String(constraints['defaultResolution'] || '');
			row['default_aspect_ratio'] = String(constraints['defaultAspectRatio'] || '');
			row['sizing_type'] = String(
				orValue(orValue(constraints['sizingType'], constraints['sizing_type']), constraints['sizing']) || ''
			);
			row['widths'] = strings(constraints['widths']);
			row['heights'] = strings(constraints['heights']);
			row['default_width'] = orValue(constraints['defaultWidth'], constraints['width']) ?? null;
			row['default_height'] = orValue(constraints['defaultHeight'], constraints['height']) ?? null;
			row['width_height_divisor'] =
				orValue(constraints['widthHeightDivisor'], constraints['width_height_divisor']) ?? null;
			const qualities = strings(
				orValue(orValue(constraints['qualityOptions'], constraints['quality_options']), constraints['qualities'])
			);
			row['qualities'] = qualities;
			row['supports_quality'] = constraints['supportsQuality'] === true || qualities.length > 0;
			row['default_quality'] = String(constraints['defaultQuality'] || '');
			row['prompt_character_limit'] = constraints['promptCharacterLimit'] ?? null;
		}
		rows.push(row);
		MODEL_CAPABILITIES.set(`${provider}|${kind}|${modelId}`, { ...row });
	}
	return rows;
}

export interface RefreshModelsResult {
	provider: ProviderName;
	models: Record<string, Record<string, unknown>[]>;
	errors: Record<string, string>;
}

/** Fetch independent model lists for text and image generation. */
export async function refreshModels(provider: ProviderName): Promise<RefreshModelsResult> {
	const result: Record<string, Record<string, unknown>[]> = {};
	const errors: Record<string, string> = {};
	const kinds = ['text', 'image'] as const;
	const fetched = await Promise.all(
		kinds.map((kind) => fetchModelRows(provider, kind, modelPath(provider, kind)))
	);
	for (const [kind, rows, error] of fetched) {
		result[kind] = rows;
		if (error) errors[kind] = error;
	}
	return { provider, models: result, errors };
}

function modelPath(_provider: ProviderName, kind: string): string {
	return `/models?type=${kind}`;
}

async function fetchModelRows(
	provider: ProviderName,
	kind: string,
	urlPath: string,
	signal?: AbortSignal
): Promise<[string, Record<string, unknown>[], string | null]> {
	try {
		const response = await veniceRequest('GET', `${providerUrl(provider)}${urlPath}`, {
			headers: await providerHeaders(provider),
			timeoutSeconds: 30,
			signal
		});
		if (response.status >= 400) {
			throw new ProviderError(`model catalog request failed (HTTP ${response.status})`);
		}
		const rows = modelRows(await response.json(), provider, kind);
		return [kind, rows, null];
	} catch (exc) {
		if (signal?.aborted) throw exc;
		return [kind, [], String((exc as Error)?.message ?? exc)];
	}
}

function selectedModelId(settings: AppSettings, kind: 'text' | 'image'): string {
	const selected = providerSettings(settings);
	return kind === 'text' ? selected.text_model : selected.image_model;
}

/** Return the selected model row from the provider's live catalog. */
export async function selectedModelCapabilities(
	settings: AppSettings,
	kind: 'text' | 'image',
	signal?: AbortSignal
): Promise<Record<string, unknown>> {
	const modelId = selectedModelId(settings, kind);
	if (!modelId) {
		throw new ProviderError(`${kind} model is not selected`);
	}
	const [, rows, error] = await fetchModelRows(
		settings.active_provider,
		kind,
		modelPath(settings.active_provider, kind),
		signal
	);
	const row = rows.find((item) => item['id'] === modelId) ?? null;
	if (row === null) {
		if (error) {
			throw new ProviderError(`cannot validate ${kind} model: ${error}`);
		}
		throw new ProviderError(`selected ${kind} model is unavailable: ${modelId}`);
	}
	return row;
}

/** Return catalog capabilities cached by the latest model refresh. */
export function cachedModelCapabilities(settings: AppSettings, kind: 'text' | 'image'): Record<string, unknown> {
	const modelId = selectedModelId(settings, kind);
	if (!modelId) return {};
	return { ...(MODEL_CAPABILITIES.get(`${settings.active_provider}|${kind}|${modelId}`) ?? {}) };
}
