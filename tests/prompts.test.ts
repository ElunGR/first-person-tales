import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPromptCache, getPrompt } from '../src/lib/server/prompts';

let testRoot: string;

beforeEach(() => {
	testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-prompts-test-'));
	vi.stubEnv('RPG_ROOT_DIR', testRoot);
	clearPromptCache();
	fs.writeFileSync(
		path.join(testRoot, 'prompts.yaml'),
		'narrator: public narrator\nplayer_character: public character\n'
	);
});

afterEach(() => {
	clearPromptCache();
	vi.unstubAllEnvs();
	fs.rmSync(testRoot, { recursive: true, force: true });
});

describe('private player-character prompt', () => {
	it('uses the public character when no local override exists', () => {
		expect(getPrompt('player_character')).toBe('public character');
		expect(getPrompt('narrator')).toBe('public narrator');
	});

	it('overrides only the character while preserving public system prompts', () => {
		fs.writeFileSync(path.join(testRoot, 'prompts.local.yaml'), 'player_character: private character\n');

		expect(getPrompt('player_character')).toBe('private character');
		expect(getPrompt('narrator')).toBe('public narrator');
	});

	it('reloads when a private character appears, changes, or disappears', () => {
		const localPath = path.join(testRoot, 'prompts.local.yaml');
		expect(getPrompt('player_character')).toBe('public character');

		fs.writeFileSync(localPath, 'player_character: private\n');
		expect(getPrompt('player_character')).toBe('private');

		fs.writeFileSync(localPath, 'player_character: changed private character\n');
		expect(getPrompt('player_character')).toBe('changed private character');

		fs.unlinkSync(localPath);
		expect(getPrompt('player_character')).toBe('public character');
	});

	it('rejects attempts to override shared system prompts locally', () => {
		fs.writeFileSync(path.join(testRoot, 'prompts.local.yaml'), 'narrator: changed narrator\n');

		expect(() => getPrompt('narrator')).toThrow('prompts.local.yaml may only override player_character');
	});
});
