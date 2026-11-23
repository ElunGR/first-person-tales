import { json } from '@sveltejs/kit';
import { apiHandler, parseBody } from '$lib/server/api';
import { expandWorldDescription } from '$lib/server/game';
import { HttpError } from '$lib/server/http';
import { runLlmOperation } from '$lib/server/llmOperation';
import { TextRequestSchema } from '$lib/server/models';

/**
 * Turn a short world idea into a full description for the editor.
 * Nothing is persisted: the player reviews the text and saves it explicitly.
 */
export const POST = apiHandler(async ({ request }) => {
	const body = await parseBody(request, TextRequestSchema);
	const idea = body.text || '';
	if (!idea.trim()) {
		throw new HttpError(400, 'text is required');
	}
	const world = await runLlmOperation(request, (llm, signal) => expandWorldDescription(idea, llm, signal));
	return json({ text: world });
});
