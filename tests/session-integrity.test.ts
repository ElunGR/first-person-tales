/** Strict session validation tests. Port of tests/test_session_integrity.py. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { newMessage } from '../src/lib/server/models';
import { backupsDir, sessionPath } from '../src/lib/server/paths';
import { loadOrCreate, Session, validateSessionIntegrity } from '../src/lib/server/session';
import { useTempDataDir } from './helpers';

useTempDataDir();

function payload(): Record<string, unknown> {
	return new Session({
		messages: [
			{ id: 'm-user', role: 'user', content: 'action', translation_ru: null, kind: null },
			{ id: 'm-assistant', role: 'assistant', content: 'answer', translation_ru: null, kind: null }
		]
	}).toDict();
}

function writePayload(data: unknown): Buffer {
	const original = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
	fs.mkdirSync(path.dirname(sessionPath()), { recursive: true });
	fs.writeFileSync(sessionPath(), original);
	return original;
}

const mutations: Array<[string, (p: Record<string, unknown>) => void]> = [
	[
		'duplicate message id',
		(p) =>
			(p['messages'] as unknown[]).push({
				id: 'm-user',
				role: 'assistant',
				content: 'duplicate',
				translation_ru: null,
				kind: null
			})
	],
	[
		'media referencing missing message',
		(p) =>
			(p['media'] as unknown[]).push({
				id: 'media-1',
				message_id: 'missing',
				kind: 'image',
				file: 'scene.png',
				source_text: '',
				created_at: ''
			})
	],
	[
		'media with traversal filename',
		(p) =>
			(p['media'] as unknown[]).push({
				id: 'media-1',
				message_id: 'm-assistant',
				kind: 'image',
				file: '../scene.png',
				source_text: '',
				created_at: ''
			})
	],
	[
		'branch message with assistant role',
		(p) =>
			(p['messages'] as unknown[]).push({
				id: 'branch',
				role: 'assistant',
				content: 'summary',
				translation_ru: null,
				kind: 'branch'
			})
	],
	['narrator_start without checkpoints', (p) => (p['narrator_start'] = 1)],
	['boolean last_narrator_prompt_tokens', (p) => (p['last_narrator_prompt_tokens'] = true)]
];

describe('integrity violations', () => {
	for (const [name, mutate] of mutations) {
		it(`load rejects ${name} without overwriting`, () => {
			const p = payload();
			mutate(p);
			const original = writePayload(p);

			expect(Session.load()).toBeNull();
			expect(fs.readFileSync(sessionPath())).toEqual(original);
			expect(fs.readdirSync(backupsDir()).filter((n) => /^session\..*\.json$/.test(n)).length)
				.toBeGreaterThan(0);
		});
	}

	it('stale checkpoint cursor is not reconciled over the original', () => {
		const p = payload();
		(p['messages'] as unknown[]).push({
			id: 'branch-1',
			role: 'user',
			content: 'summary',
			translation_ru: null,
			kind: 'branch'
		});
		p['summary_checkpoints'] = [
			{ id: 'checkpoint-1', created_at: '', previous_narrator_start: 0, branch_message_id: 'branch-1' }
		];
		p['narrator_start'] = 0;
		const original = writePayload(p);

		expect(loadOrCreate().messages).toEqual([]);
		expect(fs.readFileSync(sessionPath())).toEqual(original);
	});

	it('validate boundary roundtrips a valid payload', () => {
		const p = payload();
		const candidate = validateSessionIntegrity(structuredClone(p));
		expect(candidate.toDict()).toEqual(p);
	});

	it('load does not re-save a valid session', () => {
		const source = new Session({
			messages: [{ id: 'm-1', role: 'user', content: 'saved', translation_ru: null, kind: null }]
		});
		source.save();
		const mtimeBefore = fs.statSync(sessionPath()).mtimeMs;

		const loaded = loadOrCreate();

		expect(loaded.messages[0].content).toBe('saved');
		expect(fs.statSync(sessionPath()).mtimeMs).toBe(mtimeBefore);
	});

	it('newMessage helper produces valid ids', () => {
		const m = newMessage({ role: 'user', content: 'x' });
		expect(m.id.length).toBeGreaterThan(0);
		expect(m.translation_ru).toBeNull();
		expect(m.kind).toBeNull();
	});
});
