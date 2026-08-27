import { json } from '@sveltejs/kit';
import { parseBody } from '$lib/server/api';
import { apiHandler } from '$lib/server/api';
import { HttpError } from '$lib/server/http';
import { SettingsUpdateRequestSchema } from '$lib/server/models';
import { deleteApiKey, EnvironmentCredentialError, setApiKey } from '$lib/server/keyring';
import {
	AppSettingsSchema,
	loadSettings,
	ProviderSettingsSchema,
	providerSettings,
	publicSettings,
	saveSettings,
	type AppSettings
} from '$lib/server/settings';

export const GET = apiHandler(async () => {
	return json(await publicSettings());
});

export const PUT = apiHandler(async ({ request }) => {
	const body = await parseBody(request, SettingsUpdateRequestSchema);
	const current = loadSettings();
	const merged = { ...providerSettings(current, 'venice'), ...(body.providers.venice ?? {}) };
	let providers: AppSettings['providers'];
	try {
		providers = { venice: ProviderSettingsSchema.parse(merged) };
	} catch (exc) {
		throw new HttpError(422, String((exc as Error)?.message ?? exc));
	}
	const settings: AppSettings = {
		active_provider: body.active_provider,
		narrator_temperature: body.narrator_temperature,
		narrator_frequency_penalty: body.narrator_frequency_penalty,
		narrator_presence_penalty: body.narrator_presence_penalty,
		narrator_max_tokens: body.narrator_max_tokens,
		narrator_top_p: body.narrator_top_p,
		translation_language: body.translation_language,
		providers
	};
	if (body.clear_api_key) {
		try {
			await deleteApiKey(body.active_provider);
		} catch (exc) {
			if (exc instanceof EnvironmentCredentialError) throw new HttpError(409, exc.message);
			throw new HttpError(503, String((exc as Error)?.message ?? exc));
		}
	}
	if (body.api_key && body.api_key.trim()) {
		try {
			await setApiKey(body.active_provider, body.api_key);
		} catch (exc) {
			if (exc instanceof EnvironmentCredentialError) throw new HttpError(409, exc.message);
			throw new HttpError(503, String((exc as Error)?.message ?? exc));
		}
	}
	saveSettings(settings);
	return json(await publicSettings(settings));
});

