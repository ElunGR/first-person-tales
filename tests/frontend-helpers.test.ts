/** Frontend pure-helper smoke tests. Port of tests/frontend_smoke.mjs. */
import { describe, expect, it } from 'vitest';
import { matchesSearch, messageTargetPayload, MessageSearchIndex } from '../src/lib/frontend/helpers';
import { mergeReused, sameMedia, sameMessage } from '../src/lib/frontend/state';
import { escapeHtml, formatChatHtml } from '../src/lib/frontend/format';

describe('frontend helpers', () => {
	it('formats supported markup without placeholder expansion or HTML injection', () => {
		expect(formatChatHtml('**bold** *italic* [note] <script>alert(1)</script>')).toBe(
			'<strong>bold</strong> <em>italic</em> <span class="msg-note">[note]</span> &lt;script&gt;alert(1)&lt;/script&gt;'
		);
	});

	it('renders private-use marker text in finite time', () => {
		expect(formatChatHtml('**\uE0000\uE001**')).toBe('<strong>\uE0000\uE001</strong>');
	});

	it('encodes both quote styles so escaped text is attribute-safe', () => {
		expect(escapeHtml(`he said "stop" & it's over <br>`)).toBe(
			'he said &quot;stop&quot; &amp; it&#39;s over &lt;br&gt;'
		);
		expect(formatChatHtml(`**it's**`)).toBe('<strong>it&#39;s</strong>');
	});

	it.each([
		['[OOC: use *italics* and **bold**]', '<span class="msg-note">[OOC: use <em>italics</em> and <strong>bold</strong>]</span>'],
		['**heading\nsecond line**', '<strong>heading\nsecond line</strong>'],
		['[first line\n**second**]', '<span class="msg-note">[first line\n<strong>second</strong>]</span>'],
		['*quiet **footsteps** nearby*', '<em>quiet <strong>footsteps</strong> nearby</em>'],
		['***both***', '<em><strong>both</strong></em>'],
		['**[literal note]**', '<strong>[literal note]</strong>'],
		['[link](https://example.invalid)', '[link](https://example.invalid)'],
		['unfinished **bold and [note', 'unfinished **bold and [note'],
		['*first\nsecond*', '*first\nsecond*']
	])('preserves supported formatting for %j', (input, expected) => {
		expect(formatChatHtml(input)).toBe(expected);
	});

	it('escapes HTML inside nested formatting and preserves literal marker characters', () => {
		expect(formatChatHtml('[**<img src=x onerror="bad()">** & *<script>bad()</script>*]')).toBe(
		'<span class="msg-note">[<strong>&lt;img src=x onerror=&quot;bad()&quot;&gt;</strong> &amp; <em>&lt;script&gt;bad()&lt;/script&gt;</em>]</span>'
		);
		expect(formatChatHtml('[*\uE0000\uE001* **\u0000**] \uE000999\uE001')).toBe(
		'<span class="msg-note">[<em>\uE0000\uE001</em> <strong>\u0000</strong>]</span> \uE000999\uE001'
		);
	});

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
