import { json } from '@sveltejs/kit';
import { stateResponse } from '$lib/server/api';
import { apiHandler } from '$lib/server/api';
import { HttpError } from '$lib/server/http';
import { sessionLock } from '$lib/server/lock';
import { getSession, KeyError } from '$lib/server/session';

export const DELETE = apiHandler(async ({ params }) => {
	const mediaId = params.mediaId ?? '';
	const state = await sessionLock.runExclusive(() => {
		try {
			getSession().deleteMedia(mediaId);
		} catch (exc) {
			if (exc instanceof KeyError) throw new HttpError(404, 'media not found');
			throw exc;
		}
		return stateResponse();
	});
	return json(state);
});
