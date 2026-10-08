/** Stale description editors must not overwrite a newly imported world. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { descriptionUsage, MAX_CHARACTER_DESCRIPTION_CHARS, MAX_WORLD_DESCRIPTION_CHARS } from '../src/lib/descriptions';
import { getGameRevision, Session, setSession } from '../src/lib/server/session';
import { getPlayerCharacterDescription, getWorldDescription } from '../src/lib/server/prompts';
import { GET as getCharacter, PUT as putCharacter } from '../src/routes/character/+server';
import { GET as getWorld, PUT as putWorld } from '../src/routes/world/+server';
import { POST as importGame } from '../src/routes/import/+server';
import { useTempDataDir, useTempPromptRoot } from './helpers';

useTempDataDir();
useTempPromptRoot();

beforeEach(() => {
	const session = new Session();
	setSession(session);
	session.save();
});

async function switchGame() {
	const result = await importGame({ request: new Request('http://localhost/import', {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ confirm: true, data: {
			version: 2, messages: [], narrator_start: 0, summary_checkpoints: [],
			last_narrator_prompt_tokens: null,
			player_character_description: 'Loaded hero', world_description: 'Loaded world'
		} })
	}) } as never);
	expect(result.status).toBe(200);
}

const routes = [
	['character', MAX_CHARACTER_DESCRIPTION_CHARS, getCharacter, putCharacter, getPlayerCharacterDescription],
	['world', MAX_WORLD_DESCRIPTION_CHARS, getWorld, putWorld, getWorldDescription]
] as const;

describe('description editor game revision', () => {
	it('returns the same opaque current-game revision from both editors', async () => {
		const character = await (await getCharacter({} as never)).json();
		const world = await (await getWorld({} as never)).json();
		expect(character.game_revision).toBe(getGameRevision());
		expect(world.game_revision).toBe(character.game_revision);
	});

	it.each(routes)('roundtrips the current %s editor token without changing it on a normal save', async (name, _limit, get, put, description) => {
		const opened = await (await get({} as never)).json();
		const result = await put({ request: new Request(`http://localhost/${name}`, {
			method: 'PUT', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: 'Edited description', game_revision: opened.game_revision })
		}) } as never);
		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ content: 'Edited description', game_revision: opened.game_revision });
		expect(description()).toBe('Edited description');
	});

	it.each(routes)('rejects a stale %s tab after loading another game', async (name, _limit, get, put, description) => {
		const opened = await (await get({} as never)).json();
		await switchGame();
		const loaded = description();
		expect(getGameRevision()).not.toBe(opened.game_revision);
		const result = await put({ request: new Request(`http://localhost/${name}`, {
			method: 'PUT', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: 'Old draft', game_revision: opened.game_revision })
		}) } as never);
		expect(result.status).toBe(409);
		expect(description()).toBe(loaded);
	});

	it.each(routes)('rejects an already-started legacy %s write if import commits while its body is being parsed', async (_name, _limit, _get, put, description) => {
		let completeBody!: (value: unknown) => void;
		const request = { json: vi.fn(() => new Promise((resolve) => { completeBody = resolve; })) } as unknown as Request;
		const pending = put({ request } as never);
		await switchGame();
		const loaded = description();
		completeBody({ content: 'Old in-flight draft' });
		const result = await pending;
		expect(result.status).toBe(409);
		expect(description()).toBe(loaded);
	});

	it.each(routes)('accepts %s text at its own limit and rejects one character more', async (name, limit, _get, put, description) => {
		// A heading used to be rejected at the limit because H1 -> H2 demotion added a
		// character; player text is now stored verbatim, so the limit is the typed length.
		const atLimit = '# ' + 'x'.repeat(limit - 2);
		expect(atLimit.length).toBe(limit);
		const accepted = await put({ request: new Request(`http://localhost/${name}`, {
			method: 'PUT', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: atLimit })
		}) } as never);
		expect(accepted.status).toBe(200);
		expect(description()).toBe(atLimit);

		const rejected = await put({ request: new Request(`http://localhost/${name}`, {
			method: 'PUT', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: 'x'.repeat(limit + 1) })
		}) } as never);
		expect(rejected.status).toBe(422);
		expect(description()).toBe(atLimit);
	});
});

describe('description counter', () => {
	it('counts exactly what was typed and flags only a real overflow', () => {
		expect(descriptionUsage('', MAX_CHARACTER_DESCRIPTION_CHARS)).toEqual({
			count: 0, limit: MAX_CHARACTER_DESCRIPTION_CHARS, over: false
		});

		const atLimit = 'x'.repeat(MAX_CHARACTER_DESCRIPTION_CHARS);
		expect(descriptionUsage(atLimit, MAX_CHARACTER_DESCRIPTION_CHARS).over).toBe(false);
		expect(descriptionUsage(`${atLimit}x`, MAX_CHARACTER_DESCRIPTION_CHARS).over).toBe(true);

		// Headings are no longer rewritten, so markdown never changes the count.
		expect(descriptionUsage('# Heading', MAX_WORLD_DESCRIPTION_CHARS)).toEqual({
			count: 9, limit: MAX_WORLD_DESCRIPTION_CHARS, over: false
		});
	});
});
