import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiHandler, parseBody } from '$lib/server/api';
import {
	getPlayerCharacterDescription,
	savePlayerCharacterDescription
} from '$lib/server/prompts';

const CharacterUpdateSchema = z.strictObject({
	content: z
		.string()
		.max(10000)
		.refine((value) => value.trim().length > 0, 'Character must not be empty')
});

/** Return only the editable character description; the system heading stays server-owned. */
export const GET = apiHandler(async () => {
	return json({ content: getPlayerCharacterDescription() });
});

/** Persist only the editable character description. */
export const PUT = apiHandler(async ({ request }) => {
	const body = await parseBody(request, CharacterUpdateSchema);
	return json({ content: savePlayerCharacterDescription(body.content) });
});
