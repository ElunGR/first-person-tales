import { json } from '@sveltejs/kit';
import { stateResponse } from '$lib/server/api';
import { sessionLock } from '$lib/server/lock';

export async function GET() {
	// Snapshot under the lock so concurrent writers cannot tear the view.
	const state = await sessionLock.runExclusive(() => stateResponse());
	return json(state);
}
