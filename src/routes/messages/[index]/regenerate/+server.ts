import { json } from '@sveltejs/kit';
import { parseIndex, parseOptionalBody, stateResponse, validateMessageTarget } from '$lib/server/api';
import { apiHandler } from '$lib/server/api';
import { IndexError } from '$lib/server/errors';
import { regenerate } from '$lib/server/game';
import { HttpError } from '$lib/server/http';
import { runLlmOperation } from '$lib/server/llmOperation';
import { sessionLock } from '$lib/server/lock';
import { MessageTargetSchema } from '$lib/server/models';
import { getSession } from '$lib/server/session';

export const POST = apiHandler(async ({ params, request }) => {
	const index = parseIndex(params.index);
	const body = await parseOptionalBody(request, MessageTargetSchema);
	const messageId = body?.message_id ?? null;
	await sessionLock.runExclusive(() => {
		validateMessageTarget(getSession(), index, messageId);
	});
	try {
		const result = await runLlmOperation(request, (llm, signal) =>
			sessionLock.runExclusive(async () => {
				const s = getSession();
				validateMessageTarget(s, index, messageId);
				const message = await regenerate(s, index, llm, { signal });
				return { message, state: stateResponse() };
			})
		);
		return json(result);
	} catch (exc) {
		if (exc instanceof IndexError) throw new HttpError(404, 'message not found');
		throw exc;
	}
});
