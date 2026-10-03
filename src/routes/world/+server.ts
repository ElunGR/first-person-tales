import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiHandler, parseBody } from '$lib/server/api';
import { HttpError } from '$lib/server/http';
import { sessionLock } from '$lib/server/lock';
import { WorldDescriptionSchema } from '$lib/server/models';
import { getWorldDescription, saveWorldDescription } from '$lib/server/prompts';
import { getGameRevision, getSession } from '$lib/server/session';

const WorldUpdateSchema = z.strictObject({
	content: WorldDescriptionSchema,
	game_revision: z.string().optional()
});

export const GET = apiHandler(async () => {
	return json(await sessionLock.runExclusive(() => ({
		content: getWorldDescription(), game_revision: getGameRevision()
	})));
});

/** Blank explicitly clears the world, including a nonempty public default. */
export const PUT = apiHandler(async ({ request }) => {
	const targetSession = getSession();
	const body = await parseBody(request, WorldUpdateSchema);
	return json(await sessionLock.runExclusive(() => {
		if (getSession() !== targetSession || (body.game_revision !== undefined && body.game_revision !== getGameRevision())) {
			throw new HttpError(409, 'Game changed; reopen the world editor before saving');
		}
		return { content: saveWorldDescription(body.content), game_revision: getGameRevision() };
	}));
});
