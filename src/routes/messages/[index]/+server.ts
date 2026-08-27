import { json } from '@sveltejs/kit';
import { parseBody, parseIndex, parseOptionalBody, stateResponse, validateMessageTarget } from '$lib/server/api';
import { apiHandler } from '$lib/server/api';
import { HttpError } from '$lib/server/http';
import { sessionLock } from '$lib/server/lock';
import { MessageTargetSchema, MessageUpdateSchema } from '$lib/server/models';
import type { Message } from '$lib/server/models';
import { getSession } from '$lib/server/session';

export const PUT = apiHandler(async ({ params, request }) => {
	const index = parseIndex(params.index);
	const body = await parseBody(request, MessageUpdateSchema);
	const content = body.content.trim();
	if (!content) {
		throw new HttpError(400, 'content is required');
	}
	const result = await sessionLock.runExclusive(() => {
		const s = getSession();
		validateMessageTarget(s, index, body.message_id);
		let message: Message;
		try {
			message = s.updateMessage(index, content);
		} catch (exc) {
			if (exc instanceof RangeError) throw new HttpError(404, 'message not found');
			throw exc;
		}
		// Embed fresh state so the UI skips a second full-transcript GET.
		return { message, state: stateResponse() };
	});
	return json(result);
});

/** Delete the message at `index` and everything after it (rewind). */
export const DELETE = apiHandler(async ({ params, request }) => {
	const index = parseIndex(params.index);
	const body = await parseOptionalBody(request, MessageTargetSchema);
	const state = await sessionLock.runExclusive(() => {
		const s = getSession();
		validateMessageTarget(s, index, body?.message_id ?? null);
		try {
			s.truncateFrom(index);
		} catch (exc) {
			if (exc instanceof RangeError) throw new HttpError(404, 'message not found');
			throw exc;
		}
		return stateResponse();
	});
	return json(state);
});
