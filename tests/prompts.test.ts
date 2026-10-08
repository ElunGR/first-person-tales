import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { GET as exportGame } from '../src/routes/export/+server';
import { Session, setSession } from '../src/lib/server/session';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearPromptCache,
	composeRoleplayContext,
	getPlayerCharacterDescription,
	getPrompt,
	getWorldDescription,
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
	vi.restoreAllMocks();
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

	it('saves character and world verbatim without losing either', () => {
		expect(savePlayerCharacterDescription('Hero\n# Skills')).toBe('Hero\n# Skills');
		expect(saveWorldDescription('Kingdom\n# Rules')).toBe('Kingdom\n# Rules');
		expect(localData()).toEqual({
			player_character_description: 'Hero\n# Skills',
			world_description: 'Kingdom\n# Rules'
		});

		savePlayerCharacterDescription('Changed hero');
		expect(localData()).toEqual({
			player_character_description: 'Changed hero',
			world_description: 'Kingdom\n# Rules'
		});
	});

	it('explicitly clears a blank world while preserving the character', () => {
		savePlayerCharacterDescription('Hero');
		saveWorldDescription('Kingdom');

		expect(saveWorldDescription('   ')).toBe('');
		expect(localData()).toEqual({ player_character_description: 'Hero', world_description: '' });
		expect(composeRoleplayContext()).toBe('# PC (Player character)\nHero');
	});

	it('composes system headings around player text without rewriting their headings', () => {
		savePlayerCharacterDescription('# PC (Player character)\nHero\n# Skills');
		saveWorldDescription('# World Description\nKingdom\n# Rules');

		const context = composeRoleplayContext();
		// The application heading still comes from prompts.yaml, and the player's own text —
		// including a heading that happens to repeat it — is passed through unchanged.
		expect(context.startsWith('# PC (Player character)\n')).toBe(true);
		expect(context).toContain('# PC (Player character)\nHero\n# Skills');
		expect(context).toContain('\n\n# World Description\n# World Description\nKingdom\n# Rules');
		expect(context).not.toContain('## PC (Player character)');
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

describe('description loader access failures', () => {
	it.each(['stat', 'read'])('does not export public defaults when private %s fails with EACCES', async (operation) => {
		const localPath = path.join(testRoot, 'prompts.local.yaml');
		const localBytes = Buffer.from('player_character_description: private fixture hero\nworld_description: private fixture world\n');
		fs.writeFileSync(localPath, localBytes);
		setSession(new Session());
		expect(getPlayerCharacterDescription()).toBe('private fixture hero');
		if (operation === 'read') clearPromptCache();
		const exists = fs.existsSync;
		vi.spyOn(fs, 'existsSync').mockImplementation((target) => String(target) === localPath ? false : exists(target));
		const stat = fs.statSync;
		vi.spyOn(fs, 'statSync').mockImplementation((...args) => {
			if (operation === 'stat' && String(args[0]) === localPath) {
				throw Object.assign(new Error('DENIED_PRIVATE_FIXTURE'), { code: 'EACCES' });
			}
			return Reflect.apply(stat, fs, args);
		});
		const read = fs.readFileSync;
		vi.spyOn(fs, 'readFileSync').mockImplementation((...args) => {
			if (operation === 'read' && String(args[0]) === localPath) {
				throw Object.assign(new Error('DENIED_PRIVATE_FIXTURE'), { code: 'EACCES' });
			}
			return Reflect.apply(read, fs, args);
		});

		expect(() => getPlayerCharacterDescription()).toThrow(/Could not/);
		const response = await exportGame({ url: new URL('http://localhost/export') } as never);
		expect(response.status).toBe(500);
		const output = await response.text();
		expect(output).not.toContain('private fixture');
		expect(output).not.toContain('public character');
		expect(output).not.toContain('DENIED_PRIVATE_FIXTURE');
		vi.restoreAllMocks();
		expect(fs.readFileSync(localPath)).toEqual(localBytes);
	});

	it('refuses a description update after read EACCES instead of erasing the inaccessible world', () => {
		const localPath = path.join(testRoot, 'prompts.local.yaml');
		const original = Buffer.from('player_character_description: previous hero\nworld_description: previous world\n');
		fs.writeFileSync(localPath, original);
		const exists = fs.existsSync;
		vi.spyOn(fs, 'existsSync').mockImplementation((target) => String(target) === localPath ? false : exists(target));
		const read = fs.readFileSync;
		vi.spyOn(fs, 'readFileSync').mockImplementation((...args) => {
			if (String(args[0]) === localPath) throw Object.assign(new Error('fixture access denied'), { code: 'EACCES' });
			return Reflect.apply(read, fs, args);
		});
		const rename = vi.spyOn(fs, 'renameSync');
		expect(() => savePlayerCharacterDescription('new hero')).toThrow('Could not read prompts.local.yaml');
		expect(rename).not.toHaveBeenCalled();
		vi.restoreAllMocks();
		expect(fs.readFileSync(localPath)).toEqual(original);
	});

	it('still uses optional empty world and defaults only for a genuinely absent local file', () => {
		fs.writeFileSync(path.join(testRoot, 'prompts.yaml'), [
			'narrator: public narrator',
			'player_character: "# PC\\n{player_character_description}"',
			'world: "# World\\n{world_description}"',
			'player_character_description: public hero', ''
		].join('\n'));
		expect(getPlayerCharacterDescription()).toBe('public hero');
		expect(getWorldDescription()).toBe('');
		expect(composeRoleplayContext()).toBe('# PC\npublic hero');
	});
});

describe('shared image prompt group rules', () => {
	// Read only the shared file, never the real local character/world overrides.
	const sharedPrompts = YAML.parse(
		fs.readFileSync(new URL('../prompts.yaml', import.meta.url), 'utf8')
	) as Record<string, string>;
	const imagePrompt = sharedPrompts.image_prompt_rewrite;

	it('includes groups in the input, category count, and shot selection', () => {
		expect(imagePrompt).toContain('SUBJECT: a person, a group of people, an item, or a location.');
		expect(imagePrompt).toContain('none of the four categories');
		expect(imagePrompt).not.toContain('none of the three categories');
		expect(imagePrompt).toMatch(
			/For a group of people, choose a medium shot, full-body shot, or wide establishing shot.*all participants and their interaction/
		);
	});

	it('requires distinct adult participants and concrete visible interaction', () => {
		const groupRule = imagePrompt.split('\n').find((line) => line.startsWith('- Group of people:'));
		expect(groupRule).toMatch(/two or more (?:adults|people) in one frame/);
		expect(groupRule).toContain('Person appearance, age, and gender rules to every participant');
		expect(groupRule).toContain('all participants are 18 or older');
		expect(groupRule).toContain('adult build and adult facial features');
		expect(groupRule).toContain('visible traits from the transcript');
		expect(groupRule).toContain('position in the frame');
		expect(groupRule).toContain('Clearly assign traits and actions to each participant');
		expect(groupRule).toContain('who is visibly interacting with whom');
		expect(groupRule).toContain('gestures, gaze, contact, or an object being passed or shared');
	});

	it('provides a single-string group example with two identifiable adults interacting', () => {
		const examples = imagePrompt.split('# Examples\n')[1];
		const example = examples.match(/^Group of people: "([^"\n]+)"$/m)?.[1];
		expect(example).toBeDefined();
		if (!example) throw new Error('Missing single-string Group of people example');

		expect(example).toMatch(/^Medium shot of a \d+-year-old woman on the left and a \d+-year-old man on the right/);
		const ages = [...example.matchAll(/(\d+)-year-old/g)].map((match) => Number(match[1]));
		expect(ages).toHaveLength(2);
		expect(ages.every((age) => age >= 18)).toBe(true);
		// The literal "adult build and adult facial features" wording is required from the
		// rule itself (checked above), not repeated in every example.
		expect(example).toContain('The woman has');
		expect(example).toContain('The man has');
		expect(example).toContain('she extends a small brass key toward the man');
		expect(example).toContain('holds out his open right hand beneath the key');
		expect(example).not.toMatch(/\b(?:girl|boy)\b/i);
	});
});
