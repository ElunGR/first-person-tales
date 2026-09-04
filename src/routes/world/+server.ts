import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiHandler, parseBody } from '$lib/server/api';
import { getWorldDescription, saveWorldDescription } from '$lib/server/prompts';

const WorldUpdateSchema = z.strictObject({
	content: z.string().max(10000)
});

/** Return only the optional editable world description. */
export const GET = apiHandler(async () => {
	return json({ content: getWorldDescription() });
});

/** Persist the optional world description; blank content removes the override. */
export const PUT = apiHandler(async ({ request }) => {
	const body = await parseBody(request, WorldUpdateSchema);
	return json({ content: saveWorldDescription(body.content) });
});
