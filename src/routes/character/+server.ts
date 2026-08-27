import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiHandler, parseBody } from '$lib/server/api';
import { getPrompt, savePlayerCharacter } from '$lib/server/prompts';

const CharacterUpdateSchema = z.strictObject({
	content: z
		.string()
		.max(10000)
		.refine((value) => value.trim().length > 0, 'Character must not be empty')
});

/** Return the active player character (prompts.yaml merged with the local override). */
export const GET = apiHandler(async () => {
	return json({ content: getPrompt('player_character') });
});

/** Persist the player character to prompts.local.yaml (Git-ignored override). */
export const PUT = apiHandler(async ({ request }) => {
	const body = await parseBody(request, CharacterUpdateSchema);
	savePlayerCharacter(body.content);
	return json({ content: body.content });
});
