/**
 * Catalog metadata shown next to the model pickers.
 *
 * The vocabulary below is a trimmed copy of a real Venice answer (the fields
 * `providerApi.modelRows` stores), so a change in wording or units fails here.
 */
import { describe, expect, it } from 'vitest';
import {
	formatTokenCount,
	formatUsd,
	hasCatalogDetails,
	imageModelNote,
	modelDetails,
	modelInfoFromRow,
	MODEL_INFO_SOURCE_NOTE,
	narratorModelNote,
	privacyLabel,
	type ModelInfoRow
} from '../src/lib/modelInfo';

/** Row as `providerApi.modelRows` builds it for `qwen-3-8-27b`. */
const NARRATOR_ROW = {
	id: 'qwen-3-8-27b',
	name: 'Qwen 3.8 27B',
	price_input: 0.45,
	price_output: 3.2,
	privacy: 'private',
	uncensored: true,
	beta: true,
	context_tokens: 262144,
	max_completion_tokens: 65536,
	supports_reasoning_effort: true
};

describe('formatting catalog numbers', () => {
	it('keeps cents honest and does not invent precision', () => {
		expect(formatUsd(30)).toBe('$30.00');
		expect(formatUsd(2.5)).toBe('$2.50');
		expect(formatUsd(0.45)).toBe('$0.45');
		expect(formatUsd(0.013)).toBe('$0.01');
		expect(formatUsd(0.0055)).toBe('$0.0055');
		expect(formatUsd(null)).toBe('—');
	});

	it('shortens token counts, rounding to the nearest step', () => {
		expect(formatTokenCount(262144)).toBe('262K');
		expect(formatTokenCount(65536)).toBe('66K');
		expect(formatTokenCount(8388608)).toBe('8.4M');
		expect(formatTokenCount(999)).toBe('999');
		expect(formatTokenCount(null)).toBe('—');
	});

	it('names the Venice privacy modes with their raw value', () => {
		expect(privacyLabel('private')).toBe('Private (private)');
		expect(privacyLabel('anonymized')).toBe('Anonymous (anonymized)');
		expect(privacyLabel('something-new')).toBe('something-new');
		expect(privacyLabel(null)).toBe('Privacy not reported');
	});
});

describe('modelInfoFromRow', () => {
	it('reads a text row as reported', () => {
		const info = modelInfoFromRow(NARRATOR_ROW);
		expect(info).toMatchObject({
			name: 'Qwen 3.8 27B',
			inputPrice: 0.45,
			outputPrice: 3.2,
			privacy: 'private',
			uncensored: true,
			beta: true,
			contextTokens: 262144,
			maxCompletionTokens: 65536,
			removesAt: null
		});
		expect(hasCatalogDetails(info)).toBe(true);
	});

	it('keeps the deprecation date and the encrypted-flow flags apart', () => {
		const info = modelInfoFromRow({
			id: 'e2ee-old-model',
			privacy: 'private',
			deprecation_date: '2026-10-21T00:00:00.000Z',
			supports_e2ee: true,
			supports_tee_attestation: false
		});
		expect(info.removesAt).toBe('2026-10-21T00:00:00.000Z');
		expect(info.supportsE2ee).toBe(true);
		expect(info.supportsTeeAttestation).toBe(false);
		// The name falls back to the id, never to "undefined".
		expect(info.name).toBe('e2ee-old-model');
	});

	it('treats a row without catalog fields as unknown rather than free', () => {
		// A geometry-only image row: the catalog answered, but not about price.
		const info = modelInfoFromRow({ id: 'legacy-model', resolutions: ['1024x1024'] } as ModelInfoRow);
		expect(info.inputPrice).toBeNull();
		expect(info.privacy).toBeNull();
		expect(hasCatalogDetails(info)).toBe(false);
	});
});

describe('the line under the narrator picker', () => {
	it('states price and the privacy flags', () => {
		const note = narratorModelNote(modelInfoFromRow(NARRATOR_ROW));
		expect(note).toBe('in $0.45 / out $3.20 per 1M tokens · Private (private) · uncensored · beta');
	});

	it('keeps limits, cache price and deprecation out of the short line', () => {
		const note = narratorModelNote(modelInfoFromRow({ ...NARRATOR_ROW, price_cache_input: 0.375 }));
		expect(note).not.toContain('context');
		expect(note).not.toContain('cached input');
		// They are still one hover away, with the model's own name.
		const title = modelDetails(modelInfoFromRow({ ...NARRATOR_ROW, price_cache_input: 0.375 }));
		expect(title).toContain('262K context');
		expect(title).toContain('cached input $0.38 per 1M');
	});

	it('never claims the encrypted flow works just because the catalog supports it', () => {
		const row = { ...NARRATOR_ROW, supports_e2ee: true };
		expect(narratorModelNote(modelInfoFromRow(row))).not.toContain('E2EE');
		expect(modelDetails(modelInfoFromRow(row))).toContain(
			'this app does not implement the encrypted flow'
		);
	});

	it('asks for a refresh instead of guessing before the catalog is loaded', () => {
		expect(narratorModelNote(null)).toBe('Refresh models to see price and privacy');
		expect(narratorModelNote(modelInfoFromRow({ id: 'legacy-model' }))).toContain(
			'no price or privacy reported'
		);
	});
});

describe('the line under the image picker', () => {
	it('shows a per-image price, the upscale price and the privacy mode', () => {
		const note = imageModelNote(
			modelInfoFromRow({
				id: 'venice-sd35',
				price_generation: 0.01,
				price_upscale_2x: 0.02,
				privacy: 'private'
			})
		);
		expect(note).toContain('$0.01 per image');
		expect(note).toContain('$0.02 per 2x upscale');
		expect(note).toContain('Private (private)');
	});

	it('does not pretend a generation price is a token price', () => {
		const note = imageModelNote(modelInfoFromRow({ id: 'free-ish', price_generation: 0 }));
		expect(note).not.toContain('per 1M tokens');
		expect(note).toContain('no price or privacy reported');
	});
});

describe('the hover title', () => {
	it('names the model, repeats every fact and names the source', () => {
		const title = modelDetails(modelInfoFromRow({ ...NARRATOR_ROW, price_cache_input: 0.375 }));
		expect(title).toMatch(/^Qwen 3\.8 27B: /);
		expect(title).toContain('cached input $0.38 per 1M');
		expect(title).toContain('reply up to 66K tokens');
		expect(title).toContain(MODEL_INFO_SOURCE_NOTE);
	});

	it('warns when Venice plans to remove the model', () => {
		const title = modelDetails(
			modelInfoFromRow({ id: 'x', name: 'X', deprecation_date: '2026-10-30T00:00:00.000Z' })
		);
		expect(title).toContain('Venice removes it on 2026-10-30');
	});

	it('has something to say with no selection', () => {
		expect(modelDetails(null)).toBe('No model selected.');
	});
});
