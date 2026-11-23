/**
 * Catalog metadata for the model pickers.
 *
 * Venice reports price, privacy mode, uncensored flag, context limits and
 * deprecation in the same free `/models` answer the Refresh button already
 * requests (`providerApi.modelRows` stores the parsed copy key by key). This
 * module turns those keys into the one short line the settings dialog shows
 * under each picker.
 *
 * It is shared by client and server code, so it must not import `$lib/server/*`.
 */

/** What the server stores per model row; UI-relevant keys only. */
export interface ModelInfoRow {
	id?: unknown;
	name?: unknown;
	price_input?: unknown;
	price_output?: unknown;
	price_cache_input?: unknown;
	price_generation?: unknown;
	price_upscale_2x?: unknown;
	privacy?: unknown;
	uncensored?: unknown;
	beta?: unknown;
	context_tokens?: unknown;
	max_completion_tokens?: unknown;
	deprecation_date?: unknown;
	supports_e2ee?: unknown;
	supports_tee_attestation?: unknown;
}

export interface ModelInfo {
	name: string;
	/** USD per 1M tokens. */
	inputPrice: number | null;
	outputPrice: number | null;
	cacheInputPrice: number | null;
	/** USD per generated image, and per upscale step. */
	generationPrice: number | null;
	upscale2xPrice: number | null;
	/** `private` (zero data retention) or `anonymized` (identity hidden). */
	privacy: string | null;
	uncensored: boolean;
	beta: boolean;
	contextTokens: number | null;
	maxCompletionTokens: number | null;
	/** ISO date the model is removed, or null. */
	removesAt: string | null;
	supportsE2ee: boolean;
	supportsTeeAttestation: boolean;
}

/**
 * Venice privacy modes, in their own words:
 * `anonymized` — the provider does not see the account, but does see the prompt;
 * `private` — the provider keeps no prompt or response content.
 */
export const PRIVACY_LABELS: Record<string, string> = {
	private: 'Private',
	anonymized: 'Anonymous'
};

/** Provider-supplied catalog data, refreshed on demand; not a promise. */
export const MODEL_INFO_SOURCE_NOTE = 'Venice data, price and privacy.';

const UNAVAILABLE_PRIVACY = 'Privacy not reported';

function usd(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
	return value;
}

function positive(value: unknown): number | null {
	const number = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(number) && number > 0 ? number : null;
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalBoolean(value: unknown): boolean {
	return value === true;
}

/** Format a per-million-token price: cents for normal prices, more for cheap ones. */
export function formatUsd(value: number | null): string {
	if (value === null) return '—';
	if (value < 0.01) return `$${value.toFixed(4)}`;
	return `$${value.toFixed(2)}`;
}

/** `262144` → `262K`, `65536` → `66K`, `8388608` → `8.4M`. */
export function formatTokenCount(value: number | null): string {
	if (value === null) return '—';
	if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
	if (value >= 1000) return `${Math.round(value / 1000)}K`;
	return String(value);
}

/** Human label for a Venice privacy mode, falling back to the raw value. */
export function privacyLabel(privacy: string | null): string {
	if (!privacy) return UNAVAILABLE_PRIVACY;
	const label = PRIVACY_LABELS[privacy];
	return label ? `${label} (${privacy})` : privacy;
}

/** Read one model row from the catalog into plain, displayable values. */
export function modelInfoFromRow(row: ModelInfoRow): ModelInfo {
	const id = nonEmptyString(row.id) ?? '';
	const removesAt = nonEmptyString(row.deprecation_date);
	return {
		name: nonEmptyString(row.name) ?? id,
		inputPrice: usd(row.price_input),
		outputPrice: usd(row.price_output),
		cacheInputPrice: usd(row.price_cache_input),
		generationPrice: usd(row.price_generation),
		upscale2xPrice: usd(row.price_upscale_2x),
		privacy: nonEmptyString(row.privacy),
		uncensored: optionalBoolean(row.uncensored),
		beta: optionalBoolean(row.beta),
		contextTokens: positive(row.context_tokens),
		maxCompletionTokens: positive(row.max_completion_tokens),
		removesAt,
		supportsE2ee: optionalBoolean(row.supports_e2ee),
		supportsTeeAttestation: optionalBoolean(row.supports_tee_attestation)
	};
}

/** Was anything at all reported for this model? */
export function hasCatalogDetails(info: ModelInfo | null): boolean {
	if (!info) return false;
	return (
		info.inputPrice !== null ||
		info.outputPrice !== null ||
		info.cacheInputPrice !== null ||
		info.generationPrice !== null ||
		info.upscale2xPrice !== null ||
		info.privacy !== null ||
		info.contextTokens !== null ||
		info.maxCompletionTokens !== null
	);
}

function priceParts(info: ModelInfo): string | null {
	const input = info.inputPrice;
	const output = info.outputPrice;
	if (input !== null && output !== null) {
		return `in ${formatUsd(input)} / out ${formatUsd(output)} per 1M tokens`;
	}
	if (input !== null) return `${formatUsd(input)} per 1M tokens in`;
	if (output !== null) return `${formatUsd(output)} per 1M tokens out`;
	// Image models price per generation, not per token.
	if (info.generationPrice !== null) {
		const upscale = info.upscale2xPrice !== null ? `, ${formatUsd(info.upscale2xPrice)} per 2x upscale` : '';
		return `${formatUsd(info.generationPrice)} per image${upscale}`;
	}
	return null;
}

function flagParts(info: ModelInfo): string[] {
	const parts: string[] = [];
	if (info.privacy) parts.push(privacyLabel(info.privacy));
	if (info.uncensored) parts.push('uncensored');
	if (info.beta) parts.push('beta');
	return parts;
}

function limitParts(info: ModelInfo): string[] {
	const parts: string[] = [];
	if (info.contextTokens !== null) parts.push(`${formatTokenCount(info.contextTokens)} context`);
	if (info.maxCompletionTokens !== null) {
		parts.push(`reply up to ${formatTokenCount(info.maxCompletionTokens)} tokens`);
	}
	return parts;
}

/**
 * Everything the catalog knows about the model, as separate parts. The compact
 * note keeps the first three; the hover title shows the rest as well. TEE/E2EE
 * deliberately lives in the title only: the catalog reports the capability, but
 * this app does not implement the encrypted flow, so a one-line note must not
 * read like a privacy promise.
 */
function descriptorParts(info: ModelInfo): string[] {
	const extra: string[] = [];
	if (info.inputPrice !== null && info.cacheInputPrice !== null) {
		extra.push(`cached input ${formatUsd(info.cacheInputPrice)} per 1M`);
	}
	if (info.removesAt) extra.push(`Venice removes it on ${info.removesAt.slice(0, 10)}`);
	if (info.supportsE2ee || info.supportsTeeAttestation) {
		extra.push('TEE/E2EE capable, but this app does not implement the encrypted flow');
	}
	return [
		priceParts(info),
		flagParts(info).join(' · ') || null,
		limitParts(info).join(' · ') || null,
		extra.length > 0 ? extra.join(' · ') : null
	].filter((part): part is string => Boolean(part));
}

/** Everything the catalog knows, with the model name and the data source. */
export function modelDetails(info: ModelInfo | null): string {
	if (!info) return 'No model selected.';
	const parts = descriptorParts(info);
	const body = parts.length > 0 ? parts.join(' · ') : 'the catalog reports no price or privacy';
	return `${info.name}: ${body}. ${MODEL_INFO_SOURCE_NOTE}`;
}

/**
 * Compact line: the two things a player compares models by — price and privacy
 * flags. Limits, cache price, deprecation and E2EE live in the hover title, so
 * the line under the picker stays short. The provider is already named in the
 * Connection section above, so the short line does not repeat it.
 */
function compactNote(parts: string[]): string {
	const facts = parts.length > 0 ? parts : ['no price or privacy reported in the catalog'];
	return facts.slice(0, 2).join(' · ');
}

/** One line under the narrator model picker. */
export function narratorModelNote(info: ModelInfo | null): string {
	if (!info) return 'Refresh models to see price and privacy';
	return compactNote(descriptorParts(info));
}

/** One line under the image model picker; the geometry note is appended by the UI. */
export function imageModelNote(info: ModelInfo | null): string {
	if (!info) return 'Refresh models to see price and privacy';
	const parts = [priceParts(info), flagParts(info).join(' · ') || null].filter(
		(part): part is string => Boolean(part)
	);
	return compactNote(parts);
}
