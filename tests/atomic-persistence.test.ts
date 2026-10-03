/** Byte-complete atomic writes: only temp roots, real prefix writes, and injected failures. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { importJournalPath } from '../src/lib/server/gameImportTransaction';
import { saveImageBytes } from '../src/lib/server/imageGen';
import { pendingMediaFiles, unmarkMediaFilePending } from '../src/lib/server/mediaIo';
import { newMessage } from '../src/lib/server/models';
import { imagesDir, localPromptsPath, sessionPath } from '../src/lib/server/paths';
import { getPlayerCharacterDescription, savePlayerCharacterDescription, saveWorldDescription } from '../src/lib/server/prompts';
import { getSession, Session, setSession } from '../src/lib/server/session';
import { defaultSettings, loadSettings, resetSettingsStateForTests, saveSettings, settingsPath } from '../src/lib/server/settings';
import { POST as importGame } from '../src/routes/import/+server';
import { useTempDataDir, useTempPromptRoot } from './helpers';

useTempDataDir();
useTempPromptRoot();

afterEach(() => {
	vi.restoreAllMocks();
	resetSettingsStateForTests();
});

const PNG_BYTES = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from('fixture caf\u00e9 \u2603 \ud83d\ude80', 'utf-8')
]);
const WRITERS = ['session', 'descriptions', 'settings', 'media'] as const;
type Writer = (typeof WRITERS)[number];

interface Fixture {
	target: string;
	expected: Buffer;
	write: () => unknown;
}

function writerFixture(writer: Writer): Fixture {
	const session = new Session({ messages: [newMessage({ role: 'assistant', content: 'Previous scene' })] });
	setSession(session);
	session.save();
	if (writer === 'session') {
		const next = newMessage({ role: 'user', content: 'New scene caf\u00e9 \u2603 \ud83d\ude80' });
		const candidate = new Session({ messages: [...session.messages, next] });
		return {
			target: sessionPath(), expected: Buffer.from(JSON.stringify(candidate.toDict(), null, 2), 'utf-8'),
			write: () => session.appendMessage(next)
		};
	}
	if (writer === 'descriptions') {
		savePlayerCharacterDescription('Previous hero');
		saveWorldDescription('Previous world');
		return {
			target: localPromptsPath(),
			expected: Buffer.from(YAML.stringify({
				player_character_description: 'New hero caf\u00e9 \u2603 \ud83d\ude80', world_description: 'Previous world'
			}), 'utf-8'),
			write: () => savePlayerCharacterDescription('New hero caf\u00e9 \u2603 \ud83d\ude80')
		};
	}
	if (writer === 'settings') {
		const previous = defaultSettings();
		saveSettings(previous);
		const next = { ...previous, narrator_temperature: 1.1,
			providers: { venice: { text_model: 'fixture-caf\u00e9', image_model: 'fixture-\u2603' } } };
		return {
			target: settingsPath(), expected: Buffer.from(JSON.stringify(next, null, 2), 'utf-8'),
			write: () => saveSettings(next)
		};
	}
	const target = path.join(imagesDir(), 'fixture.png');
	fs.writeFileSync(target, Buffer.from('previous image bytes'));
	return { target, expected: PNG_BYTES, write: () => saveImageBytes(PNG_BYTES, '.png', 'fixture.png') };
}

interface WriteRecord {
	fd: number;
	offset: number;
	length: number;
	written: number;
	position: unknown;
	temporary: string;
}

/** Intercept only the selected writer temp, never the durable journal or backup. */
function injectPrefixWrites(target: string, failure?: 'throw' | 'zero') {
	const open = fs.openSync;
	const write = fs.writeSync;
	const descriptors = new Map<number, string>();
	const records: WriteRecord[] = [];
	const basename = path.basename(target);
	vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
		const fd: number = Reflect.apply(open, fs, args);
		descriptors.set(fd, String(args[0]));
		return fd;
	});
	const spy = vi.spyOn(fs, 'writeSync').mockImplementation((...args) => {
		const [fd, supplied, suppliedOffset, suppliedLength, suppliedPosition] = args as unknown as
			[number, Buffer | string, number | null | undefined, number | BufferEncoding | undefined, number | null | undefined];
		const temporary = descriptors.get(fd) ?? '';
		const tempName = path.basename(temporary);
		const selected = path.dirname(temporary) === path.dirname(target) &&
			(basename === 'session.json' ? /^session\.[a-f0-9]+\.tmp$/.test(tempName) :
				tempName.startsWith(`.${basename}.`) && tempName.endsWith('.tmp'));
		if (!selected) return Reflect.apply(write, fs, args);
		if (records.length > 0 && failure === 'throw') {
			throw Object.assign(new Error('injected failure after prefix write'), { code: 'EIO' });
		}
		if (records.length > 0 && failure === 'zero') return 0;
		// Support the old string/two-argument Buffer writers too: they must fail
		// by persisting only a real prefix, not merely by a mock argument assertion.
		const raw = Buffer.isBuffer(supplied) ? supplied :
			Buffer.from(supplied, typeof suppliedLength === 'string' ? suppliedLength : 'utf-8');
		const offset = Buffer.isBuffer(supplied) ? suppliedOffset ?? 0 : 0;
		const length = Buffer.isBuffer(supplied) && typeof suppliedLength === 'number' ? suppliedLength : raw.length;
		const position = Buffer.isBuffer(supplied) ? suppliedPosition ?? null : suppliedOffset ?? null;
		const written: number = Reflect.apply(write, fs, [fd, raw, offset, Math.min(length, 7), position]);
		records.push({ fd, offset, length, written, position, temporary });
		return written;
	});
	return { records, spy };
}

function expectCompleteOffsets(records: WriteRecord[], expected: Buffer) {
	expect(records.length).toBeGreaterThan(1);
	let offset = 0;
	for (const record of records) {
		expect(record.offset).toBe(offset);
		expect(record.length).toBe(expected.length - offset);
		expect(record.written).toBe(Math.min(record.length, 7));
		offset += record.written;
	}
	expect(offset).toBe(expected.length);
}

function expectNoTemps(target: string) {
	expect(fs.readdirSync(path.dirname(target)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
}

describe('byte-complete atomic persistence', () => {
	it.each(WRITERS)('retries real short writes with byte offsets for %s before fsync/rename', (writer) => {
		const fixture = writerFixture(writer);
		const { records, spy } = injectPrefixWrites(fixture.target);
		const sync = vi.spyOn(fs, 'fsyncSync');
		const rename = vi.spyOn(fs, 'renameSync');
		fixture.write();

		expect(fs.readFileSync(fixture.target)).toEqual(fixture.expected);
		expectCompleteOffsets(records, fixture.expected);
		const lastWrite = spy.mock.invocationCallOrder[spy.mock.invocationCallOrder.length - 1];
		expect(lastWrite).toBeLessThan(sync.mock.invocationCallOrder[0]);
		expect(sync.mock.invocationCallOrder[0]).toBeLessThan(rename.mock.invocationCallOrder[0]);
		expectNoTemps(fixture.target);
		if (writer === 'media') unmarkMediaFilePending('fixture.png');
	});

	it.each(WRITERS)('preserves the previous %s target and state after a prefix write followed by an error', (writer) => {
		const fixture = writerFixture(writer);
		const before = fs.readFileSync(fixture.target);
		const previousSession = getSession().toDict();
		const previousSettings = loadSettings();
		const { records } = injectPrefixWrites(fixture.target, 'throw');
		const sync = vi.spyOn(fs, 'fsyncSync');
		const rename = vi.spyOn(fs, 'renameSync');

		expect(() => fixture.write()).toThrow();
		expect(records).toHaveLength(1);
		expect(fs.readFileSync(fixture.target)).toEqual(before);
		expect(getSession().toDict()).toEqual(previousSession);
		expect(loadSettings()).toEqual(previousSettings);
		expect(pendingMediaFiles.size).toBe(0);
		expect(sync).not.toHaveBeenCalled();
		expect(rename).not.toHaveBeenCalled();
		expectNoTemps(fixture.target);
	});

	it.each(WRITERS)('rejects zero progress for %s rather than looping or replacing the target', (writer) => {
		const fixture = writerFixture(writer);
		const before = fs.readFileSync(fixture.target);
		const { records, spy } = injectPrefixWrites(fixture.target, 'zero');

		expect(() => fixture.write()).toThrow();
		expect(records).toHaveLength(1);
		expect(spy).toHaveBeenCalledTimes(2);
		expect(fs.readFileSync(fixture.target)).toEqual(before);
		expect(pendingMediaFiles.size).toBe(0);
		expectNoTemps(fixture.target);
	});
});

describe('import cannot commit an incomplete session write', () => {
	it.each([1, 2])('writes the complete UTF-8 session before committing archive v%s', async (version) => {
		writerFixture('session');
		const oldSession = getSession();
		const { records } = injectPrefixWrites(sessionPath());
		const message = newMessage({ role: 'assistant', content: 'Imported caf\u00e9 \u2603 \ud83d\ude80' });
		const data = {
			version, messages: [message], narrator_start: 0, summary_checkpoints: [],
			last_narrator_prompt_tokens: null,
			...(version === 2 ? { player_character_description: 'Imported hero', world_description: '' } : {})
		};
		const response = await importGame({ request: new Request('http://localhost/import', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, data })
		}) } as never);

		expect(response.status).toBe(200);
		expect(getSession()).not.toBe(oldSession);
		const expected = Buffer.from(JSON.stringify(getSession().toDict(), null, 2), 'utf-8');
		expect(fs.readFileSync(sessionPath())).toEqual(expected);
		expectCompleteOffsets(records, expected);
		expect(Session.load()!.messages).toEqual([message]);
		expect(fs.existsSync(importJournalPath())).toBe(false);
		if (version === 2) expect(getPlayerCharacterDescription()).toBe('Imported hero');
	});

	it.each([1, 2])('rolls back archive v%s on an error after a partial session write, without deleting media', async (version) => {
		writerFixture('session');
		const oldSession = getSession();
		oldSession.addMedia({ messageId: oldSession.messages[0].id, kind: 'image', file: 'previous.png' });
		const oldImage = path.join(imagesDir(), 'previous.png');
		fs.writeFileSync(oldImage, PNG_BYTES);
		const before = fs.readFileSync(sessionPath());
		const localExisted = fs.existsSync(localPromptsPath());
		injectPrefixWrites(sessionPath(), 'throw');
		const data = {
			version, messages: [], narrator_start: 0, summary_checkpoints: [], last_narrator_prompt_tokens: null,
			...(version === 2 ? { player_character_description: 'Imported hero', world_description: '' } : {})
		};
		const response = await importGame({ request: new Request('http://localhost/import', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, data })
		}) } as never);

		expect(response.status).toBe(500);
		expect(getSession()).toBe(oldSession);
		expect(fs.readFileSync(sessionPath())).toEqual(before);
		expect(fs.readFileSync(oldImage)).toEqual(PNG_BYTES);
		expect(fs.existsSync(localPromptsPath())).toBe(localExisted);
		expect(fs.existsSync(importJournalPath())).toBe(false);
	});
});
