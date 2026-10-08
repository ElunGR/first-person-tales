/** Portable game archives: all history, prompts, credentials and files are fixtures. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { MAX_IMPORT_BODY_BYTES } from '../src/lib/server/config';
import { MAX_CHARACTER_DESCRIPTION_CHARS, MAX_WORLD_DESCRIPTION_CHARS } from '../src/lib/descriptions';
import { importJournalPath } from '../src/lib/server/gameImportTransaction';
import { setApiKey } from '../src/lib/server/keyring';
import { newMessage } from '../src/lib/server/models';
import { backupsDir, imagesDir, localPromptsPath, sessionPath } from '../src/lib/server/paths';
import {
	clearPromptCache, getPlayerCharacterDescription, getWorldDescription,
	savePlayerCharacterDescription, saveWorldDescription
} from '../src/lib/server/prompts';
import { getSession, Session, setSession } from '../src/lib/server/session';
import { defaultSettings, saveSettings } from '../src/lib/server/settings';
import { GET } from '../src/routes/export/+server';
import { POST } from '../src/routes/import/+server';
import { useTempDataDir, useTempPromptRoot } from './helpers';

useTempDataDir();
useTempPromptRoot();

beforeEach(() => {
	const session = new Session({ messages: [newMessage({ role: 'assistant', content: 'Original scene' })] });
	setSession(session);
	session.save();
});

afterEach(() => { vi.restoreAllMocks(); });

function incoming(): Record<string, unknown> {
	const { media: _media, ...history } = new Session({
		messages: [newMessage({ role: 'assistant', content: 'Imported scene', translation_ru: 'Translation fixture' })],
		lastNarratorPromptTokens: 1234
	}).toDict();
	return {
		version: 2, ...history,
		player_character_description: 'Imported hero', world_description: 'Imported world'
	};
}

async function exported(format = 'json') {
	return GET({ url: new URL(`http://localhost/export?format=${format}`) } as never);
}

async function load(data: unknown, confirm: unknown = true) {
	return POST({ request: new Request('http://localhost/import', {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ confirm, data })
	}) } as never);
}

function backups(): string[] {
	return fs.existsSync(backupsDir()) ? fs.readdirSync(backupsDir()).filter((name) => name.startsWith('game.pre-import-')) : [];
}

function addOldImage() {
	const session = getSession();
	session.addMedia({ messageId: session.messages[0].id, kind: 'image', file: 'original.png' });
	fs.writeFileSync(path.join(imagesDir(), 'original.png'), Buffer.from('old image bytes'));
}

describe('game export', () => {
	it('includes effective default descriptions but no images, credentials, settings or system prompts', async () => {
		addOldImage();
		await setApiKey('venice', 'private-test-secret');
		const settings = defaultSettings();
		settings.image_style = 'anime';
		saveSettings(settings);
		const before = fs.readFileSync(sessionPath());
		const response = await exported();
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(Object.keys(data).sort()).toEqual([
			'version', 'messages', 'narrator_start', 'summary_checkpoints',
			'last_narrator_prompt_tokens', 'player_character_description', 'world_description'
		].sort());
		expect(data.version).toBe(2);
		expect(data.player_character_description).toBe('CHARACTER_SENTINEL');
		expect(data.world_description).toBe('WORLD_SENTINEL');
		expect(JSON.stringify(data)).not.toContain('private-test-secret');
		expect(JSON.stringify(data)).not.toContain('NARRATOR_SYSTEM_SENTINEL');
		expect(fs.readFileSync(sessionPath())).toEqual(before);
		expect(fs.existsSync(localPromptsPath())).toBe(false);
	});

	it('exports current editable descriptions verbatim in JSON and readable Markdown', async () => {
		savePlayerCharacterDescription('Hero\n# Skills');
		saveWorldDescription('World\n# Rules');
		const data = await (await exported()).json();
		expect(data.player_character_description).toBe('Hero\n# Skills');
		expect(data.world_description).toBe('World\n# Rules');
		const markdown = await exported('markdown');
		expect(markdown.headers.get('Content-Type')).toContain('text/markdown');
		const text = await markdown.text();
		expect(text).toContain('## Player character\n\nHero\n# Skills');
		expect(text).toContain('## World\n\nWorld\n# Rules');
		expect(text).toContain('Original scene');
		expect(text).toContain('for reading only');
	});

	it('refuses an oversized export or pre-import backup that could not be loaded back', async () => {
		const oversized = new Session({ messages: Array.from({ length: 90 }, () =>
			newMessage({ role: 'assistant', content: 'x'.repeat(50000) })) });
		setSession(oversized);
		oversized.save();
		const before = fs.readFileSync(sessionPath());
		expect((await exported()).status).toBe(413);
		const markdown = await exported('markdown');
		expect(markdown.status).toBe(200);
		const text = await markdown.text();
		expect(text).toContain('CHARACTER_SENTINEL');
		expect(text).toContain('WORLD_SENTINEL');
		expect(text.split('### Narrator').length - 1).toBe(90);
		expect(text).toContain('x'.repeat(50000));
		expect((await load(incoming())).status).toBe(413);
		expect(getSession()).toBe(oversized);
		expect(fs.readFileSync(sessionPath())).toEqual(before);
		expect(backups()).toEqual([]);
	}, 45000); // Large, fsynced fixture can be slow under Windows antivirus.

	it('does not echo a malformed local YAML description in export errors', async () => {
		fs.writeFileSync(localPromptsPath(), 'player_character_description: [private-description-fixture', 'utf8');
		const response = await exported();
		expect(response.status).toBe(500);
		expect(JSON.stringify(await response.json())).not.toContain('private-description-fixture');
	});
});

describe('game import and switching', () => {
	it('restores history, descriptions, translations, summary state and tokens together', async () => {
		const summary = newMessage({ role: 'user', kind: 'branch', content: 'Digest fixture' });
		const data = incoming();
		(data.messages as unknown[]).push(summary);
		data.narrator_start = 1;
		data.summary_checkpoints = [{ id: 'checkpoint', created_at: 'stamp', previous_narrator_start: 0, branch_message_id: summary.id }];
		data.player_character_description = '# Character\nImported hero';
		data.world_description = '# World\nImported world';
		addOldImage();

		const result = await load(data);
		expect(result.status).toBe(200);
		expect(getPlayerCharacterDescription()).toBe('# Character\nImported hero');
		expect(getWorldDescription()).toBe('# World\nImported world');
		expect(getSession().messages).toEqual(data.messages);
		expect(getSession().messages[0].translation_ru).toBe('Translation fixture');
		expect(getSession().narratorStart).toBe(1);
		expect(getSession().canUndoSummary).toBe(true);
		expect(getSession().lastNarratorPromptTokens).toBe(1234);
		expect(Session.load()!.toDict()).toEqual(getSession().toDict());
		expect(fs.existsSync(path.join(imagesDir(), 'original.png'))).toBe(false);
		expect(fs.existsSync(importJournalPath())).toBe(false);
		clearPromptCache();
		expect(getWorldDescription()).toBe('# World\nImported world');
	});

	it('keeps a portable pre-import backup and permits switching between both complete games', async () => {
		savePlayerCharacterDescription('First hero');
		saveWorldDescription('First world');
		const first = await (await exported()).json();
		const second = incoming();
		expect((await load(second)).status).toBe(200);
		const backup = JSON.parse(fs.readFileSync(path.join(backupsDir(), backups()[0]), 'utf8'));
		expect(backup).toEqual(first);
		expect((await load(backup)).status).toBe(200);
		expect(await (await exported()).json()).toEqual(first);
		expect((await load(second)).status).toBe(200);
		expect(getPlayerCharacterDescription()).toBe('Imported hero');
		expect(getWorldDescription()).toBe('Imported world');
		expect(backups()).toHaveLength(3);
	});

	it('imports an explicitly empty world, overriding a nonempty public default even after character edits', async () => {
		const data = incoming();
		data.world_description = '';
		expect(getWorldDescription()).toBe('WORLD_SENTINEL');
		expect((await load(data)).status).toBe(200);
		expect(getWorldDescription()).toBe('');
		expect(YAML.parse(fs.readFileSync(localPromptsPath(), 'utf8'))).toEqual({
			player_character_description: 'Imported hero', world_description: ''
		});
		savePlayerCharacterDescription('Edited hero');
		clearPromptCache();
		expect(getWorldDescription()).toBe('');
		expect((await (await exported()).json()).world_description).toBe('');
	});
});

const invalidMutations: Array<[string, (data: Record<string, unknown>) => void]> = [
	['empty character', (data) => { data.player_character_description = '   '; }],
	['missing character', (data) => { delete data.player_character_description; }],
	['missing world', (data) => { delete data.world_description; }],
	['wrong world type', (data) => { data.world_description = null; }],
	['long world description', (data) => { data.world_description = 'x'.repeat(MAX_WORLD_DESCRIPTION_CHARS + 1); }],
	['long character description', (data) => { data.player_character_description = 'x'.repeat(MAX_CHARACTER_DESCRIPTION_CHARS + 1); }],
	['unknown top-level field', (data) => { data.api_key = 'fixture'; }],
	['duplicate message IDs', (data) => { (data.messages as unknown[]).push((data.messages as unknown[])[0]); }],
	['missing message ID', (data) => { delete (data.messages as Record<string, unknown>[])[0].id; }],
	['broken summary cursor', (data) => { data.narrator_start = 1; }],
	['invalid summary reference', (data) => { data.summary_checkpoints = [{ id: 'c', previous_narrator_start: 0, branch_message_id: 'missing' }]; }],
	['unknown version', (data) => { data.version = 3; }],
	['boolean version', (data) => { data.version = true; }],
	['unsupported version 1 save', (data) => { data.version = 1; }]
];

describe('import rejects unsafe or partial archives before writes', () => {
	it.each(invalidMutations)('rejects %s while preserving the entire active game', async (_name, mutate) => {
		savePlayerCharacterDescription('Keep hero');
		saveWorldDescription('Keep world');
		addOldImage();
		const oldSession = getSession();
		const before = fs.readFileSync(sessionPath());
		const localBefore = fs.readFileSync(localPromptsPath());
		const data = incoming();
		mutate(data);
		expect((await load(data)).status).toBe(400);
		expect(getSession()).toBe(oldSession);
		expect(fs.readFileSync(sessionPath())).toEqual(before);
		expect(fs.readFileSync(localPromptsPath())).toEqual(localBefore);
		expect(fs.existsSync(path.join(imagesDir(), 'original.png'))).toBe(true);
		expect(backups()).toEqual([]);
	});

	it('requires explicit confirmation before creating a backup or changing files', async () => {
		expect((await load(incoming(), false)).status).toBe(400);
		expect(getSession().messages[0].content).toBe('Original scene');
		expect(backups()).toEqual([]);
	});

	it('enforces the actual UTF-8 byte limit and declared size before changes', async () => {
		for (const oversizedHeader of [false, true]) {
			const headers = new Headers({ 'Content-Type': 'application/json' });
			if (oversizedHeader) headers.set('Content-Length', String(MAX_IMPORT_BODY_BYTES + 1));
			const response = await POST({ request: new Request('http://localhost/import', {
				method: 'POST', headers,
				body: oversizedHeader ? '{}' : 'x'.repeat(MAX_IMPORT_BODY_BYTES + 1)
			}) } as never);
			expect(response.status).toBe(413);
		}
		expect(backups()).toEqual([]);
		expect(getSession().messages[0].content).toBe('Original scene');
	});

	it('rolls back history after the description write fails without changing memory or deleting images', async () => {
		savePlayerCharacterDescription('Keep hero');
		saveWorldDescription('Keep world');
		addOldImage();
		const oldSession = getSession();
		const before = fs.readFileSync(sessionPath());
		const localBefore = fs.readFileSync(localPromptsPath());
		const rename = fs.renameSync;
		vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
			if (target === localPromptsPath()) throw new Error('EPERM fixture');
			return rename(source, target);
		});

		const result = await load(incoming());
		expect(result.status).toBe(500);
		expect(getSession()).toBe(oldSession);
		expect(fs.readFileSync(sessionPath())).toEqual(before);
		expect(fs.readFileSync(localPromptsPath())).toEqual(localBefore);
		expect(fs.existsSync(path.join(imagesDir(), 'original.png'))).toBe(true);
		expect(fs.existsSync(importJournalPath())).toBe(false);
		expect(backups()).toHaveLength(1);
	});

	it('can return a server error after commit, so HTTP 5xx alone is not proof of rollback', async () => {
		const data = incoming();
		const stat = fs.lstatSync;
		let postCommitFailure = false;
		vi.spyOn(fs, 'lstatSync').mockImplementation((...args) => {
			if (!postCommitFailure && String(args[0]) === importJournalPath() &&
				!fs.existsSync(importJournalPath()) &&
				fs.readFileSync(sessionPath(), 'utf8').includes('Imported scene')) {
				postCommitFailure = true;
				throw Object.assign(new Error('fixture post-commit metadata failure'), { code: 'EIO' });
			}
			return Reflect.apply(stat, fs, args);
		});

		const result = await load(data);
		expect(result.status).toBe(503);
		expect(postCommitFailure).toBe(true);
		expect(getSession().messages).toEqual(data.messages);
		expect(Session.load()!.messages).toEqual(data.messages);
		expect(getPlayerCharacterDescription()).toBe('Imported hero');
		expect(getWorldDescription()).toBe('Imported world');
		expect(fs.existsSync(importJournalPath())).toBe(false);
	});

	it('refuses to import if the complete pre-import backup cannot be saved', async () => {
		const rename = fs.renameSync;
		vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
			if (String(target).includes('game.pre-import-')) throw new Error('EPERM fixture');
			return rename(source, target);
		});
		const before = fs.readFileSync(sessionPath());
		expect((await load(incoming())).status).toBe(500);
		expect(fs.readFileSync(sessionPath())).toEqual(before);
		expect(fs.existsSync(localPromptsPath())).toBe(false);
		expect(backups()).toEqual([]);
	});
});
