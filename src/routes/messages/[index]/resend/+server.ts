import { json } from '@sveltejs/kit';
import { parseBody, parseIndex, stateResponse, validateMessageTarget } from '$lib/server/api';
import { apiHandler } from '$lib/server/api';
import { IndexError, ValueError } from '$lib/server/errors';
import { resend } from '$lib/server/game';
import { HttpError } from '$lib/server/http';
import { runLlmOperation } from '$lib/server/llmOperation';
import { sessionLock } from '$lib/server/lock';
import { MessageUpdateSchema } from '$lib/server/models';
import { getSession } from '$lib/server/session';

/** Save an edited user message, drop later turns, and generate a new reply. */
export const POST = apiHandler(async ({ params, request }) => {
	const index = parseIndex(params.index);
	const body = await parseBody(request, MessageUpdateSchema);
	await sessionLock.runExclusive(() => {
		validateMessageTarget(getSession(), index, body.message_id);
	});
	try {
		const result = await runLlmOperation(request, (llm, signal) =>
			sessionLock.runExclusive(async () => {
				const s = getSession();
				validateMessageTarget(s, index, body.message_id);
				const message = await resend(s, index, body.content, llm, { signal });
				return { message, state: stateResponse() };
			})
		);
		return json(result);
	} catch (exc) {
		if (exc instanceof IndexError) throw new HttpError(404, 'message not found');
		if (exc instanceof ValueError) throw new HttpError(400, exc.message);
		throw exc;
	}
});
