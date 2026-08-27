import { json } from '@sveltejs/kit';
import { stateResponse } from '$lib/server/api';
import { apiHandler } from '$lib/server/api';
import { ValueError } from '$lib/server/errors';
import { HttpError } from '$lib/server/http';
import { sessionLock } from '$lib/server/lock';
import { undoResummary } from '$lib/server/game';
import { getSession } from '$lib/server/session';

export const POST = apiHandler(async () => {
	const state = await sessionLock.runExclusive(() => {
		try {
			undoResummary(getSession());
		} catch (exc) {
			if (exc instanceof ValueError) throw new HttpError(400, exc.message);
			throw exc;
		}
		return stateResponse();
	});
	return json(state);
});
