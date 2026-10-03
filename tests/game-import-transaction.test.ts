/** Undo-journal transactions and startup/request guards, using only private temp fixtures. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	assertNoPendingGameImport,
	commitGameImport,
	hasPendingGameImport,
	importJournalPath,
	recoverPendingGameImport,
	writeImportFileAtomic
} from '../src/lib/server/gameImportTransaction';
import { HttpError } from '../src/lib/server/http';
import { newMessage } from '../src/lib/server/models';
import { imagesDir, localPromptsPath, sessionPath } from '../src/lib/server/paths';
import {
	clearPromptCache,
	getPlayerCharacterDescription,
	getPrompt,
	getWorldDescription,
	loadPrompts,
	savePlayerCharacterDescription,
	saveWorldDescription,
	serializeGameDescriptions
} from '../src/lib/server/prompts';
import {
	clearRecoveryMessage,
	getSession,
	loadOrCreate,
	Session,
	setSession
} from '../src/lib/server/session';
import * as sessionStorage from '../src/lib/server/sessionStorage';
import { useTempDataDir, useTempPromptRoot } from './helpers';

const dataFixture = useTempDataDir();
const promptFixture = useTempPromptRoot();

interface Snapshot {
	path: string;
	bytes: string | null;
	sha256: string | null;
}
interface Journal {
	version: number;
	session: Snapshot;
	local_prompts: Snapshot;
}

const IMAGE_BYTES = Buffer.from('isolated-image-fixture');
const IMAGE_NAMES = ['old-scene.png', 'unreferenced.png'];
let oldSession: Session;
let candidate: Session;
let oldSessionBytes: Buffer;
let oldLocalBytes: Buffer;
let importedDescriptions: string;
let handle: typeof import('../src/hooks.server').handle;

function digest(bytes: Buffer): string {
	return crypto.createHash('sha256').update(bytes).digest('hex');
}

function snapshot(target: string, bytes: Buffer | null): Snapshot {
	return {
		path: path.resolve(target),
		bytes: bytes === null ? null : bytes.toString('base64'),
		sha256: bytes === null ? null : digest(bytes)
	};
}

function journal(session: Buffer | null = oldSessionBytes, local: Buffer | null = oldLocalBytes): Journal {
	return {
		version: 1,
		session: snapshot(sessionPath(), session),
		local_prompts: snapshot(localPromptsPath(), local)
	};
}

function writeJournal(value: Journal = journal()): Buffer {
	const bytes = Buffer.from(JSON.stringify(value), 'utf-8');
	fs.writeFileSync(importJournalPath(), bytes);
	return bytes;
}

function expectImagesUntouched(): void {
	for (const name of IMAGE_NAMES) {
		expect(fs.readFileSync(path.join(imagesDir(), name))).toEqual(IMAGE_BYTES);
	}
}

function expectOldBytes(): void {
	expect(fs.readFileSync(sessionPath())).toEqual(oldSessionBytes);
	expect(fs.readFileSync(localPromptsPath())).toEqual(oldLocalBytes);
}

function expectHttpError(action: () => unknown, status: number, detail: RegExp): void {
	let caught: unknown;
	try {
		action();
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(HttpError);
	expect(caught).toMatchObject({ status, detail: expect.stringMatching(detail) });
}

beforeEach(async () => {
	// Import hooks only after both helpers established private paths. Its bootstrap
	// runs once, without a journal; subsequent tests exercise the real request guard.
	expect(path.dirname(sessionPath())).toBe(path.resolve(dataFixture.dir()));
	expect(path.dirname(localPromptsPath())).toBe(path.resolve(promptFixture.dir()));
	({ handle } = await import('../src/hooks.server'));
	clearRecoveryMessage();
	clearPromptCache();
	const message = newMessage({ role: 'assistant', content: 'Previous scene: caf\u00e9' });
	oldSession = new Session({
		messages: [message],
		media: [{
			id: 'old-media', message_id: message.id, kind: 'image', file: 'old-scene.png',
			source_text: 'previous prompt', created_at: ''
		}]
	});
	candidate = new Session({ messages: [newMessage({ role: 'assistant', content: 'Imported scene' })] });
	// Valid JSON/YAML with CRLF, comments, whitespace and Unicode: rollback must
	// restore the exact bytes rather than serialize semantically equivalent data.
	oldSessionBytes = Buffer.from(`\t${JSON.stringify(oldSession.toDict(), null, 2).replace(/\n/g, '\r\n')}  \r\n`, 'utf-8');
	oldLocalBytes = Buffer.from(
		'# Previous fixture; preserve comments and CRLF\r\n' +
		'player_character_description: "Previous character caf\u00e9"\r\n' +
		'world_description: "Previous world \u2603"\r\n', 'utf-8'
	);
	importedDescriptions = serializeGameDescriptions('Imported character', 'Imported world');
	fs.mkdirSync(imagesDir(), { recursive: true });
	fs.writeFileSync(sessionPath(), oldSessionBytes);
	fs.writeFileSync(localPromptsPath(), oldLocalBytes);
	for (const name of IMAGE_NAMES) fs.writeFileSync(path.join(imagesDir(), name), IMAGE_BYTES);
	setSession(oldSession);
});

afterEach(() => {
	vi.restoreAllMocks();
	clearPromptCache();
	clearRecoveryMessage();
});

describe('protected import undo journal', () => {
	it('persists protected old byte snapshots before either write and commits by journal absence', () => {
		const open = vi.spyOn(fs, 'openSync');
		const sync = vi.spyOn(fs, 'fsyncSync');
		const rename = vi.spyOn(fs, 'renameSync');
		const save = vi.fn(() => {
			expectOldBytes();
			expect(hasPendingGameImport()).toBe(true);
			expect(JSON.parse(fs.readFileSync(importJournalPath(), 'utf-8'))).toEqual(journal());
			const journalOpenIndex = open.mock.calls.findIndex(([name]) =>
				path.dirname(String(name)) === dataFixture.dir() && path.basename(String(name)).startsWith('.game-import-'));
			expect(journalOpenIndex).toBeGreaterThanOrEqual(0);
			expect(open.mock.calls[journalOpenIndex].slice(1)).toEqual(['wx', 0o600]);
			expect(sync).toHaveBeenCalled();
			const journalRenameIndex = rename.mock.calls.findIndex(([, target]) => String(target) === importJournalPath());
			expect(journalRenameIndex).toBeGreaterThanOrEqual(0);
			expect(sync.mock.invocationCallOrder[0]).toBeLessThan(rename.mock.invocationCallOrder[journalRenameIndex]);
			candidate.save();
			expect(hasPendingGameImport()).toBe(true);
		});

		commitGameImport(save, importedDescriptions);

		expect(save).toHaveBeenCalledTimes(1);
		expect(hasPendingGameImport()).toBe(false);
		expect(fs.readFileSync(sessionPath(), 'utf-8')).toBe(JSON.stringify(candidate.toDict(), null, 2));
		expect(fs.readFileSync(localPromptsPath(), 'utf-8')).toBe(importedDescriptions);
		expect(recoverPendingGameImport()).toBe(false);
		expectImagesUntouched();
	});

	it('can commit history only without changing existing description bytes', () => {
		commitGameImport(() => candidate.save());

		expect(Session.load()!.toDict()).toEqual(candidate.toDict());
		expect(fs.readFileSync(localPromptsPath())).toEqual(oldLocalBytes);
		expect(hasPendingGameImport()).toBe(false);
		expectImagesUntouched();
	});

	it('does not call the session writer if durable journal preparation fails', () => {
		const rename = fs.renameSync;
		vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
			if (String(target) === importJournalPath()) throw new Error('journal rename failed');
			return rename(source, target);
		});
		const save = vi.fn(() => candidate.save());

		expectHttpError(() => commitGameImport(save, importedDescriptions), 500, /Nothing was imported/);

		expect(save).not.toHaveBeenCalled();
		expectOldBytes();
		expect(hasPendingGameImport()).toBe(false);
		expect(fs.readdirSync(dataFixture.dir()).filter((name) => name.startsWith('.game-import-'))).toEqual([]);
		expectImagesUntouched();
	});

	it('rolls back both byte snapshots when the second file write fails', () => {
		const rename = fs.renameSync;
		let fail = true;
		vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
			if (String(target) === localPromptsPath() && fail) {
				fail = false;
				expect(Session.load()!.toDict()).toEqual(candidate.toDict());
				throw new Error('second write failed');
			}
			return rename(source, target);
		});

		expectHttpError(() => commitGameImport(() => candidate.save(), importedDescriptions), 500, /previous history.*restored/);

		expectOldBytes();
		expect(getSession()).toBe(oldSession);
		expect(hasPendingGameImport()).toBe(false);
		expect(fs.readdirSync(promptFixture.dir()).filter((name) => name.startsWith('.game-import-'))).toEqual([]);
		expectImagesUntouched();
	});

	it('rolls back both writes when the final journal unlink fails once', () => {
		const unlink = fs.unlinkSync;
		let fail = true;
		vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
			if (String(target) === importJournalPath() && fail) {
				fail = false;
				expect(Session.load()!.toDict()).toEqual(candidate.toDict());
				expect(fs.readFileSync(localPromptsPath(), 'utf-8')).toBe(importedDescriptions);
				throw new Error('commit marker unlink failed');
			}
			return unlink(target);
		});

		expectHttpError(() => commitGameImport(() => candidate.save(), importedDescriptions), 500, /previous history.*restored/);

		expectOldBytes();
		expect(hasPendingGameImport()).toBe(false);
		expectImagesUntouched();
	});

	it('restores even if the session callback writes and then throws', () => {
		expectHttpError(() => commitGameImport(() => {
			candidate.save();
			throw new Error('session callback failed after write');
		}, importedDescriptions), 500, /previous history.*restored/);

		expectOldBytes();
		expect(hasPendingGameImport()).toBe(false);
		expectImagesUntouched();
	});

	it('keeps a durable target and removes its temporary file when atomic rename fails', () => {
		const rename = fs.renameSync;
		vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
			if (String(target) === localPromptsPath()) throw new Error('atomic rename failed');
			return rename(source, target);
		});

		expect(() => writeImportFileAtomic(localPromptsPath(), Buffer.from(importedDescriptions))).toThrow('atomic rename failed');
		expect(fs.readFileSync(localPromptsPath())).toEqual(oldLocalBytes);
		expect(fs.readdirSync(promptFixture.dir()).filter((name) => name.startsWith('.game-import-'))).toEqual([]);
	});
});

describe('interrupted import cutpoints', () => {
	it.each(['before either write', 'only session changed', 'both changed before journal unlink'])(
		'recovers old bytes at cutpoint: %s', (cutpoint) => {
			writeJournal();
			if (cutpoint !== 'before either write') candidate.save();
			if (cutpoint === 'both changed before journal unlink') fs.writeFileSync(localPromptsPath(), importedDescriptions);

			expect(recoverPendingGameImport()).toBe(true);

			expectOldBytes();
			expect(hasPendingGameImport()).toBe(false);
			expect(recoverPendingGameImport()).toBe(false);
			expectImagesUntouched();
		}
	);

	it('does not undo a committed import after the journal has been removed', () => {
		commitGameImport(() => candidate.save(), importedDescriptions);
		const committedSession = fs.readFileSync(sessionPath());
		const committedLocal = fs.readFileSync(localPromptsPath());

		expect(recoverPendingGameImport()).toBe(false);
		const loaded = loadOrCreate();

		expect(loaded.toDict()).toEqual(candidate.toDict());
		expect(fs.readFileSync(sessionPath())).toEqual(committedSession);
		expect(fs.readFileSync(localPromptsPath())).toEqual(committedLocal);
		expect(getPlayerCharacterDescription()).toBe('Imported character');
	});

	it.each([
		['session absent', false, true],
		['local descriptions absent', true, false],
		['both absent', false, false]
	] as const)('recovers original absence: %s', (_name, sessionPresent, localPresent) => {
		writeJournal(journal(sessionPresent ? oldSessionBytes : null, localPresent ? oldLocalBytes : null));
		candidate.save();
		fs.writeFileSync(localPromptsPath(), importedDescriptions);

		expect(recoverPendingGameImport()).toBe(true);

		expect(fs.existsSync(sessionPath())).toBe(sessionPresent);
		expect(fs.existsSync(localPromptsPath())).toBe(localPresent);
		if (sessionPresent) expect(fs.readFileSync(sessionPath())).toEqual(oldSessionBytes);
		if (localPresent) expect(fs.readFileSync(localPromptsPath())).toEqual(oldLocalBytes);
		expect(hasPendingGameImport()).toBe(false);
		expect(recoverPendingGameImport()).toBe(false);
		expectImagesUntouched();
	});

	it.each([
		['session absent', false, true],
		['local descriptions absent', true, false],
		['both absent', false, false]
	] as const)('snapshots missing originals and restores absence on commit failure: %s', (_name, sessionPresent, localPresent) => {
		if (!sessionPresent) fs.unlinkSync(sessionPath());
		if (!localPresent) fs.unlinkSync(localPromptsPath());
		const unlink = fs.unlinkSync;
		let fail = true;
		vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
			if (String(target) === importJournalPath() && fail) {
				fail = false;
				expect(JSON.parse(fs.readFileSync(importJournalPath(), 'utf-8'))).toEqual(
					journal(sessionPresent ? oldSessionBytes : null, localPresent ? oldLocalBytes : null)
				);
				throw new Error('final unlink failed');
			}
			return unlink(target);
		});

		expectHttpError(() => commitGameImport(() => candidate.save(), importedDescriptions), 500, /restored/);

		expect(fs.existsSync(sessionPath())).toBe(sessionPresent);
		expect(fs.existsSync(localPromptsPath())).toBe(localPresent);
		if (sessionPresent) expect(fs.readFileSync(sessionPath())).toEqual(oldSessionBytes);
		if (localPresent) expect(fs.readFileSync(localPromptsPath())).toEqual(oldLocalBytes);
		expect(hasPendingGameImport()).toBe(false);
		expectImagesUntouched();
	});
});

describe('journal validation before any recovery writes', () => {
	const invalidJournals: Array<[string, (value: Journal) => void]> = [
		['session path mismatch', (value) => { value.session.path = path.join(dataFixture.dir(), 'wrong-session.json'); }],
		['local path mismatch after valid session snapshot', (value) => { value.local_prompts.path = path.join(promptFixture.dir(), 'wrong-prompts.yaml'); }],
		['relative session path', (value) => { value.session.path = 'session.json'; }],
		['relative local path', (value) => { value.local_prompts.path = 'prompts.local.yaml'; }],
		['session hash mismatch', (value) => { value.session.sha256 = '0'.repeat(64); }],
		['local hash mismatch after valid session snapshot', (value) => { value.local_prompts.sha256 = '0'.repeat(64); }],
		['noncanonical session base64', (value) => { value.session.bytes += '\n'; }],
		['noncanonical local base64', (value) => { value.local_prompts.bytes += '\n'; }],
		['session bytes without hash', (value) => { value.session.sha256 = null; }],
		['local bytes without hash', (value) => { value.local_prompts.sha256 = null; }],
		['absent session with hash', (value) => { value.session.bytes = null; }],
		['absent local with hash', (value) => { value.local_prompts.bytes = null; }],
		['unsupported journal version', (value) => { value.version = 2; }],
		['unknown journal fields', (value) => { Object.assign(value, { redirect: 'not allowed' }); }],
		['unknown snapshot fields', (value) => { Object.assign(value.local_prompts, { redirect: 'not allowed' }); }]
	];

	it.each(invalidJournals)('rejects %s without changing either target or journal', (_name, mutate) => {
		candidate.save();
		fs.writeFileSync(localPromptsPath(), importedDescriptions);
		const currentSession = fs.readFileSync(sessionPath());
		const currentLocal = fs.readFileSync(localPromptsPath());
		const value = journal();
		mutate(value);
		const journalBytes = writeJournal(value);
		const open = vi.spyOn(fs, 'openSync');
		const mkdir = vi.spyOn(fs, 'mkdirSync');
		const write = vi.spyOn(fs, 'writeFileSync');
		const rename = vi.spyOn(fs, 'renameSync');
		const unlink = vi.spyOn(fs, 'unlinkSync');

		expectHttpError(() => recoverPendingGameImport(), 503, /recovery journal was kept/);

		expect(open.mock.calls.filter(([, flags]) => flags === 'wx' || flags === 'w')).toEqual([]);
		expect(mkdir).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
		expect(rename).not.toHaveBeenCalled();
		expect(unlink).not.toHaveBeenCalled();
		expect(fs.readFileSync(sessionPath())).toEqual(currentSession);
		expect(fs.readFileSync(localPromptsPath())).toEqual(currentLocal);
		expect(fs.readFileSync(importJournalPath())).toEqual(journalBytes);
		expectImagesUntouched();
	});

	it('keeps malformed JSON without starting bootstrap or image cleanup', () => {
		const bytes = Buffer.from('{broken journal');
		fs.writeFileSync(importJournalPath(), bytes);
		const load = vi.spyOn(Session, 'load');
		const cleanup = vi.spyOn(sessionStorage, 'cleanupUnreferencedMediaFilesOnDisk');
		const rename = vi.spyOn(fs, 'renameSync');

		expectHttpError(() => loadOrCreate(), 503, /recovery journal was kept/);

		expect(load).not.toHaveBeenCalled();
		expect(cleanup).not.toHaveBeenCalled();
		expect(rename).not.toHaveBeenCalled();
		expectOldBytes();
		expect(fs.readFileSync(importJournalPath())).toEqual(bytes);
		expectImagesUntouched();
	});
});

describe('fail-closed filesystem errors', () => {
	it('does not bypass recovery guards when journal metadata is inaccessible', () => {
		const journalBytes = writeJournal();
		const lstat = fs.lstatSync;
		vi.spyOn(fs, 'lstatSync').mockImplementation((...args) => {
			if (String(args[0]) === importJournalPath()) {
				throw Object.assign(new Error('journal metadata denied'), { code: 'EACCES' });
			}
			return Reflect.apply(lstat, fs, args);
		});
		const save = vi.fn(() => candidate.save());
		const load = vi.spyOn(Session, 'load');
		const cleanup = vi.spyOn(sessionStorage, 'cleanupUnreferencedMediaFilesOnDisk');

		for (const action of [
			() => hasPendingGameImport(),
			() => assertNoPendingGameImport(),
			() => getSession(),
			() => loadPrompts(),
			() => loadOrCreate(),
			() => commitGameImport(save, importedDescriptions)
		]) expectHttpError(action, 503, /Could not check game import recovery state/);

		expect(save).not.toHaveBeenCalled();
		expect(load).not.toHaveBeenCalled();
		expect(cleanup).not.toHaveBeenCalled();
		expect(fs.readFileSync(importJournalPath())).toEqual(journalBytes);
		expectOldBytes();
		expectImagesUntouched();
	});

	it.each(['session', 'local descriptions'])('does not snapshot an inaccessible %s file as absent', (targetName) => {
		const deniedTarget = targetName === 'session' ? sessionPath() : localPromptsPath();
		// existsSync can report false for an inaccessible existing file. Only the
		// authoritative read's ENOENT may represent a missing old snapshot.
		const exists = fs.existsSync;
		const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((target) =>
			String(target) === deniedTarget ? false : exists(target));
		const read = fs.readFileSync;
		const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((...args) => {
			if (String(args[0]) === deniedTarget) {
				throw Object.assign(new Error('snapshot read denied'), { code: 'EACCES' });
			}
			return Reflect.apply(read, fs, args);
		});
		const write = vi.spyOn(fs, 'writeFileSync');
		const rename = vi.spyOn(fs, 'renameSync');
		const save = vi.fn(() => candidate.save());

		expectHttpError(() => commitGameImport(save, importedDescriptions), 500, /Nothing was imported/);

		expect(save).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
		expect(rename).not.toHaveBeenCalled();
		expect(hasPendingGameImport()).toBe(false);
		readSpy.mockRestore();
		existsSpy.mockRestore();
		expectOldBytes();
		expectImagesUntouched();
	});

	it.each(['session', 'local descriptions'])('keeps the journal when unlink cannot restore original %s absence', (targetName) => {
		const sessionAbsent = targetName === 'session';
		const absentTarget = sessionAbsent ? sessionPath() : localPromptsPath();
		const journalBytes = writeJournal(journal(sessionAbsent ? null : oldSessionBytes, sessionAbsent ? oldLocalBytes : null));
		candidate.save();
		fs.writeFileSync(localPromptsPath(), importedDescriptions);
		const exists = fs.existsSync;
		const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((target) =>
			String(target) === absentTarget ? false : exists(target));
		const unlink = fs.unlinkSync;
		const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
			if (String(target) === absentTarget) {
				throw Object.assign(new Error('restore unlink denied'), { code: 'EACCES' });
			}
			return unlink(target);
		});

		expectHttpError(() => recoverPendingGameImport(), 503, /recovery journal was kept/);
		existsSpy.mockRestore();

		expect(fs.existsSync(absentTarget)).toBe(true);
		expect(fs.readFileSync(importJournalPath())).toEqual(journalBytes);
		expect(unlinkSpy.mock.calls.some(([target]) => String(target) === importJournalPath())).toBe(false);
		expectHttpError(() => getSession(), 503, /interrupted game import needs recovery/);
		expectImagesUntouched();
		unlinkSpy.mockRestore();

		expect(recoverPendingGameImport()).toBe(true);
		expect(fs.existsSync(absentTarget)).toBe(false);
		if (sessionAbsent) expect(fs.readFileSync(localPromptsPath())).toEqual(oldLocalBytes);
		else expect(fs.readFileSync(sessionPath())).toEqual(oldSessionBytes);
		expect(hasPendingGameImport()).toBe(false);
		expectImagesUntouched();
	});
});

describe('failed rollback and recovery guards', () => {
	it.each(['session restore', 'local restore'])('keeps the journal and blocks reads/writes after %s fails', async (failure) => {
		// Prime the prompt cache first: a pending journal must block cache hits too.
		expect(getPlayerCharacterDescription()).toBe('Previous character caf\u00e9');
		const rename = fs.renameSync;
		const unlink = fs.unlinkSync;
		let commitUnlinkFailed = false;
		vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
			if (String(target) === importJournalPath() && !commitUnlinkFailed) {
				commitUnlinkFailed = true;
				throw new Error('commit marker failure starts rollback');
			}
			return unlink(target);
		});
		vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
			const blockedTarget = failure === 'session restore' ? sessionPath() : localPromptsPath();
			if (commitUnlinkFailed && String(target) === blockedTarget) throw new Error('rollback target locked');
			return rename(source, target);
		});

		expectHttpError(() => commitGameImport(() => candidate.save(), importedDescriptions), 503, /recovery journal was kept/);

		const journalBytes = fs.readFileSync(importJournalPath());
		expect(JSON.parse(journalBytes.toString('utf-8'))).toEqual(journal());
		for (const readOrWrite of [
			() => assertNoPendingGameImport(),
			() => getSession(),
			() => loadPrompts(),
			() => loadPrompts(true),
			() => getPrompt('narrator'),
			() => getPlayerCharacterDescription(),
			() => getWorldDescription(),
			() => savePlayerCharacterDescription('do not write'),
			() => saveWorldDescription('do not write')
		]) expectHttpError(readOrWrite, 503, /interrupted game import needs recovery/);
		const save = vi.fn();
		expectHttpError(() => commitGameImport(save, importedDescriptions), 503, /interrupted game import needs recovery/);
		expect(save).not.toHaveBeenCalled();

		const load = vi.spyOn(Session, 'load');
		const cleanup = vi.spyOn(sessionStorage, 'cleanupUnreferencedMediaFilesOnDisk');
		expectHttpError(() => loadOrCreate(), 503, /recovery journal was kept/);
		expect(load).not.toHaveBeenCalled();
		expect(cleanup).not.toHaveBeenCalled();
		for (const [method, pathname] of [['GET', '/state'], ['PUT', '/character'], ['POST', '/reset']]) {
			const request = new Request(`http://localhost${pathname}`, {
				method,
				headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
				...(method === 'PUT' ? { body: JSON.stringify({ content: 'do not write' }) } : {})
			});
			const resolve = vi.fn(async () => new Response('must not resolve'));
			const response = await handle({ event: { request, url: new URL(request.url) }, resolve } as never);
			expect(response.status).toBe(503);
			expect((await response.json()).detail).toMatch(/interrupted game import needs recovery/);
			expect(response.headers.get('X-Request-ID')).toMatch(/^[a-f0-9]{12}$/);
			expect(resolve).not.toHaveBeenCalled();
		}
		expect(fs.readFileSync(importJournalPath())).toEqual(journalBytes);
		expectImagesUntouched();

		vi.restoreAllMocks();
		expect(recoverPendingGameImport()).toBe(true);
		expectOldBytes();
		expect(getSession()).toBe(oldSession);
		expect(hasPendingGameImport()).toBe(false);
		expectImagesUntouched();
	});

	it('retries an already-restored journal idempotently after recovery unlink failure', () => {
		writeJournal();
		candidate.save();
		fs.writeFileSync(localPromptsPath(), importedDescriptions);
		const rename = vi.spyOn(fs, 'renameSync');
		const open = vi.spyOn(fs, 'openSync');
		const unlink = fs.unlinkSync;
		let fail = true;
		vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
			if (String(target) === importJournalPath() && fail) {
				fail = false;
				throw new Error('recovery journal still locked');
			}
			return unlink(target);
		});

		expectHttpError(() => recoverPendingGameImport(), 503, /recovery journal was kept/);
		expectOldBytes();
		expect(hasPendingGameImport()).toBe(true);
		const renameCount = rename.mock.calls.length;
		const writeOpenCount = open.mock.calls.filter(([, flags]) => flags === 'wx' || flags === 'w').length;

		expect(recoverPendingGameImport()).toBe(true);
		expect(rename).toHaveBeenCalledTimes(renameCount);
		expect(open.mock.calls.filter(([, flags]) => flags === 'wx' || flags === 'w')).toHaveLength(writeOpenCount);
		expect(recoverPendingGameImport()).toBe(false);
		expectOldBytes();
		expectImagesUntouched();
	});
});

describe('loadOrCreate recovery ordering', () => {
	it('recovers both files and invalidates cached prompts before Session.load and image cleanup', () => {
		candidate.save();
		fs.writeFileSync(localPromptsPath(), importedDescriptions);
		expect(getPlayerCharacterDescription()).toBe('Imported character');
		writeJournal();
		const events: string[] = [];
		const originalLoad = Session.load;
		vi.spyOn(Session, 'load').mockImplementation((target) => {
			events.push('load');
			expect(hasPendingGameImport()).toBe(false);
			expectOldBytes();
			expect(getPlayerCharacterDescription()).toBe('Previous character caf\u00e9');
			return originalLoad(target);
		});
		const originalCleanup = sessionStorage.cleanupUnreferencedMediaFilesOnDisk;
		vi.spyOn(sessionStorage, 'cleanupUnreferencedMediaFilesOnDisk').mockImplementation((files) => {
			events.push('cleanup');
			expect(events).toEqual(['load', 'cleanup']);
			expect(hasPendingGameImport()).toBe(false);
			expectOldBytes();
			const referenced = [...files];
			expect(referenced).toEqual(['old-scene.png']);
			return originalCleanup(referenced);
		});

		const loaded = loadOrCreate();

		expect(loaded.toDict()).toEqual(oldSession.toDict());
		expect(getSession()).toBe(loaded);
		expect(events).toEqual(['load', 'cleanup']);
		expect(fs.readFileSync(path.join(imagesDir(), 'old-scene.png'))).toEqual(IMAGE_BYTES);
		expect(fs.existsSync(path.join(imagesDir(), 'unreferenced.png'))).toBe(false);
		expectOldBytes();
	});
});
