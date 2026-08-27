/** Frontend pure-helper smoke tests. Port of tests/frontend_smoke.mjs. */
import { describe, expect, it } from 'vitest';
import { matchesSearch, messageTargetPayload, MessageSearchIndex } from '../src/lib/frontend/helpers';
import { mergeReused, sameMedia, sameMessage } from '../src/lib/frontend/state';

describe('frontend helpers', () => {
	it('messageTargetPayload returns the id at index or null', () => {
		const messages = [{ id: 'a' }, { id: 'b' }] as Array<{ id: string }>;
		expect(messageTargetPayload(messages, 0)).toEqual({ message_id: 'a' });
		expect(messageTargetPayload(messages, 5)).toEqual({ message_id: null });
	});

	it('matchesSearch checks content and translation case-insensitively', () => {
		const message = { content: 'Hello World', translation_ru: 'Привет мир' };
		expect(matchesSearch(message, '')).toBe(true);
		expect(matchesSearch(message, 'hello')).toBe(true);
		expect(matchesSearch(message, 'ПРИВЕТ')).toBe(true);
		expect(matchesSearch(message, 'missing')).toBe(false);
	});
});

describe('state reconciliation', () => {
	it('reuses unchanged messages and replaces changed records', () => {
		const previous = [
			{ id: '1', role: 'user' as const, content: 'same' },
			{ id: '2', role: 'assistant' as const, content: 'before' }
		];
		const incoming = [
			{ id: '1', role: 'user' as const, content: 'same' },
			{ id: '2', role: 'assistant' as const, content: 'after' }
		];
		const merged = mergeReused(previous, incoming, sameMessage);
		expect(merged[0]).toBe(previous[0]);
		expect(merged[1]).toBe(incoming[1]);
	});

	it('compares all media fields that affect rendering', () => {
		const item = { id: 'm', message_id: '1', kind: 'image' as const, file: 'a.png' };
		expect(sameMedia(item, { ...item })).toBe(true);
		expect(sameMedia(item, { ...item, source_text: 'changed' })).toBe(false);
	});
});

describe('MessageSearchIndex', () => {
	it('matches content and translation with a pre-lowercased query', () => {
		const index = new MessageSearchIndex();
		const message = { content: 'Hello World', translation_ru: 'Привет мир' };
		expect(index.matches(message, '')).toBe(true);
		expect(index.matches(message, 'hello')).toBe(true);
		expect(index.matches(message, 'привет')).toBe(true);
		expect(index.matches(message, 'missing')).toBe(false);
	});

	it('caches the haystack per message object', () => {
		const index = new MessageSearchIndex();
		const message = { content: 'Cached Text', translation_ru: null };
		const first = index.haystack(message);
		expect(index.haystack(message)).toBe(first);
		// A replaced object (as produced by state reloads for changed
		// messages) gets its own fresh haystack.
		const replaced = { content: 'Other Text', translation_ru: null };
		expect(index.haystack(replaced)).toBe('other text\n');
		expect(index.matches(message, 'cached')).toBe(true);
		expect(index.matches(replaced, 'cached')).toBe(false);
	});

	it('handles messages with missing fields', () => {
		const index = new MessageSearchIndex();
		expect(index.matches({}, 'anything')).toBe(false);
		expect(index.matches({}, '')).toBe(true);
		expect(index.haystack({ content: undefined, translation_ru: undefined })).toBe('\n');
	});
});
