import { json } from '@sveltejs/kit';
import { parseBody, parseIndex, validateMessageTarget } from '$lib/server/api';
import { apiHandler } from '$lib/server/api';
import { IndexError, ValueError } from '$lib/server/errors';
import { prepareMediaText } from '$lib/server/game';
import { HttpError } from '$lib/server/http';
import { runLlmOperation } from '$lib/server/llmOperation';
import { sessionLock } from '$lib/server/lock';
import { MediaPrepareRequestSchema } from '$lib/server/models';
import { getSession } from '$lib/server/session';

export const POST = apiHandler(async ({ params, request }) => {
	const index = parseIndex(params.index);
	const body = await parseBody(request, MediaPrepareRequestSchema);
	if (!body.instruction.trim()) {
		throw new HttpError(400, 'describe the specific subject or moment to show before preparing media');
	}
	await sessionLock.runExclusive(() => {
		validateMessageTarget(getSession(), index, body.message_id);
	});
	const text = await runLlmOperation(request, (llm, signal) =>
		sessionLock.runExclusive(() => {
			try {
				validateMessageTarget(getSession(), index, body.message_id);
				return prepareMediaText(getSession(), index, body.kind, {
					instruction: body.instruction,
					llm,
					signal
				});
			} catch (exc) {
				if (exc instanceof IndexError) throw new HttpError(404, 'message not found');
				if (exc instanceof ValueError) throw new HttpError(400, exc.message);
				throw exc;
			}
		})
	);
	return json({ text });
});
