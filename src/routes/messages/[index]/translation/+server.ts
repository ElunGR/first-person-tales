import { json } from '@sveltejs/kit';
import { parseBody, parseIndex, stateResponse, validateMessageTarget } from '$lib/server/api';
import { apiHandler } from '$lib/server/api';
import { HttpError } from '$lib/server/http';
import { sessionLock } from '$lib/server/lock';
import { TranslationUpdateSchema } from '$lib/server/models';
import type { Message } from '$lib/server/models';
import { getSession } from '$lib/server/session';

export const POST = apiHandler(async ({ params, request }) => {
	const index = parseIndex(params.index);
	const body = await parseBody(request, TranslationUpdateSchema);
	const result = await sessionLock.runExclusive(() => {
		const s = getSession();
		validateMessageTarget(s, index, body.message_id);
		let message: Message;
		try {
			message = s.setTranslation(index, body.translation);
		} catch (exc) {
			if (exc instanceof RangeError) throw new HttpError(404, 'message not found');
			throw exc;
		}
		// Embed fresh state so the UI skips a second full-transcript GET.
		return { message, state: stateResponse() };
	});
	return json(result);
});
