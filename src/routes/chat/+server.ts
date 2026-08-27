import { json } from '@sveltejs/kit';
import { parseBody } from '$lib/server/api';
import { apiHandler, stateResponse } from '$lib/server/api';
import { ValueError } from '$lib/server/errors';
import { chat } from '$lib/server/game';
import { HttpError } from '$lib/server/http';
import { runLlmOperation } from '$lib/server/llmOperation';
import { sessionLock } from '$lib/server/lock';
import { ChatRequestSchema } from '$lib/server/models';
import { getSession } from '$lib/server/session';

export const POST = apiHandler(async ({ request }) => {
	const body = await parseBody(request, ChatRequestSchema);
	const content = body.content.trim();
	if (!content) {
		throw new HttpError(400, 'content is required');
	}
	try {
		const result = await runLlmOperation(request, (llm, signal) =>
			sessionLock.runExclusive(async () => {
				const message = await chat(getSession(), content, llm, { signal });
				return { message, state: stateResponse() };
			})
		);
		return json(result);
	} catch (exc) {
		if (exc instanceof ValueError) throw new HttpError(400, exc.message);
		throw exc;
	}
});
