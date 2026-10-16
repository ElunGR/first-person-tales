import { json } from '@sveltejs/kit';
import { apiHandler, parseBody } from '$lib/server/api';
import { HttpError } from '$lib/server/http';
import { SettingsUpdateRequestSchema } from '$lib/server/models';
import { Mutex } from '$lib/server/mutex';
import { deleteApiKey, EnvironmentCredentialError, setApiKey } from '$lib/server/keyring';
import {
	effectiveNarratorParameters, loadSettings, ProviderSettingsSchema, providerSettings,
	publicSettings, saveSettings, type AppSettings
} from '$lib/server/settings';

// Keychain writes may await. Serialize the entire read/merge/save operation so
// a later settings request cannot be overwritten by an earlier delayed one.
const settingsLock = new Mutex();

export const GET = apiHandler(async () => {
	return settingsLock.runExclusive(async () => json(await publicSettings()));
});

export const PUT = apiHandler(async ({ request }) => {
	const body = await parseBody(request, SettingsUpdateRequestSchema);
	return settingsLock.runExclusive(async () => {
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
			// An older client that does not send the dictionary keeps the saved
			// one; an empty dictionary is a deliberate "send no fields" choice.
			narrator_parameters: body.narrator_parameters ?? current.narrator_parameters,
			translation_language: body.translation_language,
			image_style: body.image_style ?? current.image_style,
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
		// Answer with the effective dictionary (defaults merged in), so the open
		// form shows exactly the fields the next narrator request will carry.
		return json(
			await publicSettings({
				...settings,
				narrator_parameters: effectiveNarratorParameters(settings)
			})
		);
	});
});
