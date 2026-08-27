import { json } from '@sveltejs/kit';
import { stateResponse } from '$lib/server/api';
import { apiHandler } from '$lib/server/api';
import { ValueError } from '$lib/server/errors';
import { resummary } from '$lib/server/game';
import { HttpError } from '$lib/server/http';
import { runLlmOperation } from '$lib/server/llmOperation';
import { sessionLock } from '$lib/server/lock';
import { getSession } from '$lib/server/session';

export const POST = apiHandler(async ({ request }) => {
	try {
		const state = await runLlmOperation(request, (llm, signal) =>
			sessionLock.runExclusive(async () => {
				await resummary(getSession(), llm, { signal });
				return stateResponse();
			})
		);
		return json(state);
	} catch (exc) {
		if (exc instanceof ValueError) throw new HttpError(400, exc.message);
		throw exc;
	}
});
