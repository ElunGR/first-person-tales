import { json } from '@sveltejs/kit';
import { stateResponse } from '$lib/server/api';
import { sessionLock } from '$lib/server/lock';
import { clearRecoveryMessage, getSession } from '$lib/server/session';

export async function POST() {
	const state = await sessionLock.runExclusive(() => {
		getSession().reset();
		clearRecoveryMessage();
		return stateResponse();
	});
	return json(state);
}
