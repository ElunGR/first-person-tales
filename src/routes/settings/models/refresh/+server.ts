import { apiHandler } from '$lib/server/api';
import { json } from '@sveltejs/kit';
import { HttpError } from '$lib/server/http';
import { ProviderError, refreshModels } from '$lib/server/providerApi';

export const POST = apiHandler(async () => {
	try {
		return json(await refreshModels('venice'));
	} catch (exc) {
		if (exc instanceof ProviderError) throw new HttpError(502, exc.message);
		throw exc;
	}
});
