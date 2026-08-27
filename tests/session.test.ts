/** Session autosave / load tests. Port of tests/test_session.py. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { newMessage } from '../src/lib/server/models';
import { backupsDir, imagesDir, sessionPath } from '../src/lib/server/paths';
import {
	clearRecoveryMessage,
	cleanupUnreferencedMediaFiles,
	loadOrCreate,
	recoveryMessage,
	Session,
	setSession
} from '../src/lib/server/session';
import { useTempDataDir } from './helpers';

const tmp = useTempDataDir();

function allBackupPaths(): string[] {
	const bdir = backupsDir();
	if (!fs.existsSync(bdir)) return [];
	return fs
		.readdirSync(bdir)
		.filter((name) => /^session\..*\.json$/.test(name))
		.map((name) => path.join(bdir, name));
}

describe('session persistence', () => {
	it('save creates session.json', () => {
		const s = new Session();
		setSession(s);
		s.appendMessage(newMessage({ role: 'user', content: 'hello' }));
		const p = sessionPath();
		expect(fs.existsSync(p)).toBe(true);
		const raw = fs.readFileSync(p, 'utf-8');
		expect(raw).toContain('hello');
		expect(raw).toContain('"media"');
		expect(raw).not.toContain('"images"');
	});

	it('load roundtrip keeps translation, tokens and media', () => {
		const s = new Session({
			messages: [newMessage({ role: 'assistant', content: 'Hi', translation_ru: 'Привет' })],
			lastNarratorPromptTokens: 3210
		});
		s.addMedia({ messageId: s.messages[0].id, kind: 'image', file: 'scene.png', sourceText: 'p' });
		s.save();

		const loaded = Session.load();
		expect(loaded).not.toBeNull();
		expect(loaded!.messages.length).toBe(1);
		expect(loaded!.messages[0].translation_ru).toBe('Привет');
		expect(loaded!.lastNarratorPromptTokens).toBe(3210);
		expect(new Set(loaded!.media.map((m) => m.kind))).toEqual(new Set(['image']));
		expect(loaded!.media.every((m) => m.message_id === loaded!.messages[0].id)).toBe(true);
		expect(loaded!.media.find((m) => m.kind === 'image')!.source_text).toBe('p');
	});

	it('load ignores legacy video attachments without deleting files', () => {
		const message = newMessage({ role: 'assistant', content: 'Old scene' });
		const payload = new Session({ messages: [message] }).toDict();
		payload['media'] = [
			{
				id: 'legacy-video',
				message_id: message.id,
				kind: 'video',
				file: 'scene.mp4',
				source_text: 'old prompt',
				created_at: ''
			}
		];
		fs.mkdirSync(path.dirname(sessionPath()), { recursive: true });
		fs.writeFileSync(sessionPath(), JSON.stringify(payload), 'utf-8');
		const legacyVideo = path.join(tmp.dir(), 'videos', 'scene.mp4');
		fs.mkdirSync(path.dirname(legacyVideo), { recursive: true });
		fs.writeFileSync(legacyVideo, Buffer.from('legacy-video'));

		const loaded = loadOrCreate();

		expect(loaded.messages.length).toBe(1);
		expect(loaded.messages[0].content).toBe('Old scene');
		expect(loaded.media).toEqual([]);
		expect(fs.readFileSync(legacyVideo)).toEqual(Buffer.from('legacy-video'));
	});

	it('add_media keeps multiple images for the same message', () => {
		const message = newMessage({ role: 'assistant', content: 'Scene' });
		const session = new Session({ messages: [message] });
		const first = session.addMedia({ messageId: message.id, kind: 'image', file: 'first.png' });
		const second = session.addMedia({ messageId: message.id, kind: 'image', file: 'second.png' });
		expect(session.media.length).toBe(2);
		expect(first.id).not.toBe(second.id);
		expect(session.media.map((m) => m.file)).toEqual(['first.png', 'second.png']);
	});

	it('update_message resets stale translation when content changes', () => {
		const s = new Session({
			messages: [newMessage({ role: 'assistant', content: 'old', translation_ru: 'старое' })]
		});
		s.updateMessage(0, 'new');
		expect(s.messages[0].translation_ru).toBeNull();
		s.setTranslation(0, 'новое');
		s.updateMessage(0, 'new');
		expect(s.messages[0].translation_ru).toBe('новое');
	});

	it('truncate_from removes tail, media files and stale checkpoints', () => {
		const kept = newMessage({ role: 'user', content: 'kept' });
		const gone = newMessage({ role: 'assistant', content: 'gone' });
		const s = new Session({ messages: [kept, gone] });
		s.addMedia({ messageId: gone.id, kind: 'image', file: 'gone.png' });
		fs.mkdirSync(imagesDir(), { recursive: true });
		fs.writeFileSync(path.join(imagesDir(), 'gone.png'), Buffer.from('x'));

		s.truncateFrom(1);

		expect(s.messages.map((m) => m.id)).toEqual([kept.id]);
		expect(s.media).toEqual([]);
		expect(fs.existsSync(path.join(imagesDir(), 'gone.png'))).toBe(false);
	});

	it('reset wipes story, media files and keeps images dir', () => {
		const s = new Session({ messages: [newMessage({ role: 'user', content: 'one' })] });
		s.addMedia({ messageId: s.messages[0].id, kind: 'image', file: 'a.png' });
		fs.writeFileSync(path.join(imagesDir(), 'a.png'), Buffer.from('x'));

		s.reset();

		expect(s.messages).toEqual([]);
		expect(s.media).toEqual([]);
		expect(fs.readdirSync(imagesDir())).toEqual([]);
		expect(fs.existsSync(imagesDir())).toBe(true);
	});
});

describe('invalid save recovery', () => {
	it('incompatible top-level shape is backed up as incompatible', () => {
		fs.mkdirSync(path.dirname(sessionPath()), { recursive: true });
		fs.writeFileSync(sessionPath(), JSON.stringify({ messages: [] }), 'utf-8');

		expect(Session.load()).toBeNull();
		const backups = fs.readdirSync(backupsDir()).filter((n) => n.startsWith('session.incompatible-'));
		expect(backups.length).toBe(1);

		const fresh = loadOrCreate();
		expect(fresh.messages).toEqual([]);
	});

	it('keeps only newest five invalid backups', () => {
		const bdir = backupsDir();
		fs.mkdirSync(bdir, { recursive: true });
		for (let index = 0; index < 7; index++) {
			const name = `session.corrupt-20260808T00000000000${index}Z.json`;
			fs.writeFileSync(path.join(bdir, name), 'backup');
		}

		loadOrCreate();

		const remaining = allBackupPaths().map((p) => path.basename(p)).sort();
		expect(remaining).toEqual(
			[
				'session.corrupt-20260808T000000000002Z.json',
				'session.corrupt-20260808T000000000003Z.json',
				'session.corrupt-20260808T000000000004Z.json',
				'session.corrupt-20260808T000000000005Z.json',
				'session.corrupt-20260808T000000000006Z.json'
			].sort()
		);
	});

	it('invalid JSON save is backed up', () => {
		fs.mkdirSync(path.dirname(sessionPath()), { recursive: true });
		fs.writeFileSync(sessionPath(), '{not valid json', 'utf-8');

		expect(Session.load()).toBeNull();
		const backups = fs.readdirSync(backupsDir()).filter((n) => n.startsWith('session.corrupt-'));
		expect(backups.length).toBe(1);
		expect(fs.readFileSync(path.join(backupsDir(), backups[0]), 'utf-8')).toBe('{not valid json');
	});

	it('invalid save is not overwritten before explicit reset', () => {
		fs.mkdirSync(path.dirname(sessionPath()), { recursive: true });
		const original = '{not valid json';
		fs.writeFileSync(sessionPath(), original, 'utf-8');

		const fresh = loadOrCreate();

		expect(fresh.messages).toEqual([]);
		expect(fs.readFileSync(sessionPath(), 'utf-8')).toBe(original);
		expect(recoveryMessage()).not.toBeNull();
		clearRecoveryMessage();
	});

	it('empty valid session does not create backup', () => {
		fs.mkdirSync(path.dirname(sessionPath()), { recursive: true });
		fs.writeFileSync(sessionPath(), JSON.stringify(new Session().toDict()), 'utf-8');

		const loaded = loadOrCreate();
		expect(loaded).not.toBeNull();
		expect(loaded.messages).toEqual([]);
		expect(allBackupPaths()).toEqual([]);
	});

	it('load_or_create cleans unreferenced media', () => {
		const message = newMessage({ role: 'assistant', content: 'scene' });
		const session = new Session({ messages: [message] });
		setSession(session);
		session.addMedia({ messageId: message.id, kind: 'image', file: 'kept.png' });
		fs.writeFileSync(path.join(imagesDir(), 'kept.png'), Buffer.from('kept'));
		fs.writeFileSync(path.join(imagesDir(), 'orphan.png'), Buffer.from('orphan'));

		const loaded = loadOrCreate();

		expect(fs.existsSync(path.join(imagesDir(), 'kept.png'))).toBe(true);
		expect(fs.existsSync(path.join(imagesDir(), 'orphan.png'))).toBe(false);
		expect(cleanupUnreferencedMediaFiles(loaded)).toEqual([]);
	});

	it('validate_current accepts only the current shape', () => {
		const current = new Session().toDict();
		expect(Session.validateCurrent(current)).toEqual(current);
		expect(Session.validateCurrent({ messages: [] })).toBeNull();
		expect(Session.validateCurrent({ ...current, images: [] })).toBeNull();
		expect(Session.validateCurrent('nope')).toBeNull();
	});
});
