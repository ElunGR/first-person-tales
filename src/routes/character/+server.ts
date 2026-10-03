import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiHandler, parseBody } from '$lib/server/api';
import { HttpError } from '$lib/server/http';
import { sessionLock } from '$lib/server/lock';
import { CharacterDescriptionSchema } from '$lib/server/models';
import { getPlayerCharacterDescription, savePlayerCharacterDescription } from '$lib/server/prompts';
import { getGameRevision, getSession } from '$lib/server/session';

const CharacterUpdateSchema = z.strictObject({
	content: CharacterDescriptionSchema,
	game_revision: z.string().optional()
});

/** System headings stay server-owned; the token protects a stale description editor. */
export const GET = apiHandler(async () => {
	return json(await sessionLock.runExclusive(() => ({
		content: getPlayerCharacterDescription(), game_revision: getGameRevision()
	})));
});

export const PUT = apiHandler(async ({ request }) => {
	const targetSession = getSession();
	const body = await parseBody(request, CharacterUpdateSchema);
	return json(await sessionLock.runExclusive(() => {
		if (getSession() !== targetSession || (body.game_revision !== undefined && body.game_revision !== getGameRevision())) {
			throw new HttpError(409, 'Game changed; reopen the character editor before saving');
		}
		return { content: savePlayerCharacterDescription(body.content), game_revision: getGameRevision() };
	}));
});
