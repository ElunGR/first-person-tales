import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearPromptCache,
	composeRoleplayContext,
	getPlayerCharacterDescription,
	getPrompt,
	getWorldDescription,
	normalizeUserDescription,
	savePlayerCharacterDescription,
	saveWorldDescription
} from '../src/lib/server/prompts';

let testRoot: string;

beforeEach(() => {
	testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-prompts-test-'));
	vi.stubEnv('RPG_ROOT_DIR', testRoot);
	clearPromptCache();
	fs.writeFileSync(
		path.join(testRoot, 'prompts.yaml'),
		[
			'narrator: public narrator',
			'player_character: "# PC (Player character)\\n{player_character_description}"',
			'world: "# World Description\\n{world_description}"',
			'player_character_description: public character',
			'world_description: ""',
			''
		].join('\n')
	);
});

afterEach(() => {
	clearPromptCache();
	vi.unstubAllEnvs();
	fs.rmSync(testRoot, { recursive: true, force: true });
});

function localData(): Record<string, unknown> {
	return YAML.parse(fs.readFileSync(path.join(testRoot, 'prompts.local.yaml'), 'utf8'));
}

describe('private character and world descriptions', () => {
	it('uses the public character and no world when no local override exists', () => {
		expect(getPlayerCharacterDescription()).toBe('public character');
		expect(getWorldDescription()).toBe('');
		expect(getPrompt('narrator')).toBe('public narrator');
	});

	it('overrides only the allowed descriptions', () => {
		fs.writeFileSync(
			path.join(testRoot, 'prompts.local.yaml'),
			'player_character_description: private character\nworld_description: private world\n'
		);

		expect(getPlayerCharacterDescription()).toBe('private character');
		expect(getWorldDescription()).toBe('private world');
		expect(getPrompt('narrator')).toBe('public narrator');
	});

	it('reloads when local descriptions appear, change, or disappear', () => {
		const localPath = path.join(testRoot, 'prompts.local.yaml');
		expect(getPlayerCharacterDescription()).toBe('public character');

		fs.writeFileSync(localPath, 'player_character_description: private\n');
		expect(getPlayerCharacterDescription()).toBe('private');

		fs.writeFileSync(localPath, 'player_character_description: changed private character\n');
		expect(getPlayerCharacterDescription()).toBe('changed private character');

		fs.unlinkSync(localPath);
		expect(getPlayerCharacterDescription()).toBe('public character');
	});

	it('rejects the old schema without changing the file', () => {
		const localPath = path.join(testRoot, 'prompts.local.yaml');
		const oldContent = 'player_character: old private character\n';
		fs.writeFileSync(localPath, oldContent);

		expect(() => getPlayerCharacterDescription()).toThrow('uses the old player_character format');
		expect(() => saveWorldDescription('new world')).toThrow('uses the old player_character format');
		expect(fs.readFileSync(localPath, 'utf8')).toBe(oldContent);
	});

	it('rejects attempts to override shared system prompts locally', () => {
		fs.writeFileSync(path.join(testRoot, 'prompts.local.yaml'), 'narrator: changed narrator\n');

		expect(() => getPrompt('narrator')).toThrow(
			'prompts.local.yaml may only override player_character_description and world_description'
		);
	});

	it('demotes only Markdown first-level headings', () => {
		expect(normalizeUserDescription('# Appearance\n## Skills\n### Notes\n#hashtag\n   # Rules')).toBe(
			'## Appearance\n## Skills\n### Notes\n#hashtag\n   ## Rules'
		);
	});

	it('saves character and world independently without losing either', () => {
		expect(savePlayerCharacterDescription('Hero\n# Skills')).toBe('Hero\n## Skills');
		expect(saveWorldDescription('Kingdom\n# Rules')).toBe('Kingdom\n## Rules');
		expect(localData()).toEqual({
			player_character_description: 'Hero\n## Skills',
			world_description: 'Kingdom\n## Rules'
		});

		savePlayerCharacterDescription('Changed hero');
		expect(localData()).toEqual({
			player_character_description: 'Changed hero',
			world_description: 'Kingdom\n## Rules'
		});
	});

	it('removes a blank world while preserving the character', () => {
		savePlayerCharacterDescription('Hero');
		saveWorldDescription('Kingdom');

		expect(saveWorldDescription('   ')).toBe('');
		expect(localData()).toEqual({ player_character_description: 'Hero' });
		expect(composeRoleplayContext()).toBe('# PC (Player character)\nHero');
	});

	it('composes fixed system headings around normalized descriptions', () => {
		savePlayerCharacterDescription('# PC (Player character)\nHero\n# Skills');
		saveWorldDescription('# World Description\nKingdom\n# Rules');

		const context = composeRoleplayContext();
		expect(context).toBe(
			'# PC (Player character)\n## PC (Player character)\nHero\n## Skills\n\n' +
				'# World Description\n## World Description\nKingdom\n## Rules'
		);
		expect(context.split('\n').filter((line) => line === '# PC (Player character)')).toHaveLength(1);
		expect(context.split('\n').filter((line) => line === '# World Description')).toHaveLength(1);
	});

	it('takes system section structure from prompts.yaml rather than hidden code', () => {
		fs.writeFileSync(
			path.join(testRoot, 'prompts.yaml'),
			[
				'narrator: public narrator',
				'player_character: "# Custom PC\\n{player_character_description}"',
				'world: "# Custom World\\n{world_description}"',
				'player_character_description: public character',
				'world_description: public world',
				''
			].join('\n')
		);

		expect(composeRoleplayContext()).toBe('# Custom PC\npublic character\n\n# Custom World\npublic world');
	});
});
