/** Settings recovery tests. Port of tests/test_settings_recovery.py. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CredentialStore } from '../src/lib/server/keyring';

class FakeStore implements CredentialStore {
	private store = new Map<string, string>();
	getPassword(account: string): Promise<string | null> {
		return Promise.resolve(this.store.get(account) ?? null);
	}
	setPassword(account: string, password: string): Promise<void> {
		this.store.set(account, password);
		return Promise.resolve();
	}
	deletePassword(account: string): Promise<boolean> {
		return Promise.resolve(this.store.delete(account));
	}
}

import {
	deleteApiKey,
	getApiKey,
	getApiKeyStatus,
	setApiKey,
	setCredentialStoreForTests
} from '../src/lib/server/keyring';
import { credentialsPath, dataDir } from '../src/lib/server/paths';
import {
	loadSettings,
	providerSettings,
	publicSettings,
	resetSettingsStateForTests,
	saveSettings,
	settingsPath
} from '../src/lib/server/settings';
import { useTempDataDir } from './helpers';

useTempDataDir();

beforeEach(() => {
	vi.stubEnv('VENICE_API_KEY', '');
});

afterEach(() => {
	vi.restoreAllMocks();
	setCredentialStoreForTests(undefined);
	resetSettingsStateForTests();
	vi.unstubAllEnvs();
});

describe('settings recovery', () => {
	it('missing settings file returns defaults', () => {
		const settings = loadSettings();
		expect(settings.active_provider).toBe('venice');
		expect(settings.narrator_temperature).toBeCloseTo(0.75);
		expect(settings.narrator_max_tokens).toBe(8000);
		expect(settings.translation_language).toBe('Russian');
		expect(settings.image_style).toBe('none');
		expect(providerSettings(settings).text_model).toBe('aion-labs-aion-3-5');
		expect(providerSettings(settings).image_model).toBe('krea-2-turbo');
	});

	it('invalid JSON settings are quarantined', () => {
		fs.mkdirSync(dataDir(), { recursive: true });
		fs.writeFileSync(settingsPath(), '{not json', 'utf-8');

		const settings = loadSettings();
		expect(settings.active_provider).toBe('venice');
		const quarantined = fs
			.readdirSync(dataDir())
			.filter((name) => name.startsWith('settings.invalid-'));
		expect(quarantined.length).toBe(1);
		expect(fs.existsSync(settingsPath())).toBe(false);
	});

	it('still reports a configured environment key after settings recovery', async () => {
		fs.mkdirSync(dataDir(), { recursive: true });
		fs.writeFileSync(settingsPath(), '{not json', 'utf-8');
		vi.stubEnv('VENICE_API_KEY', 'environment-secret');
		loadSettings();

		const published = await publicSettings();
		expect(published['key_source']).toEqual({ venice: 'environment' });
		expect(published['key_configured']).toEqual({ venice: true });
	});

	it('settings with wrong types fall back to field defaults', () => {
		fs.mkdirSync(dataDir(), { recursive: true });
		fs.writeFileSync(
			settingsPath(),
			JSON.stringify({ narrator_temperature: 'hot', providers: 'nope' }),
			'utf-8'
		);

		const settings = loadSettings();
		expect(settings.narrator_temperature).toBeCloseTo(0.75);
		expect(providerSettings(settings).text_model).toBe('aion-labs-aion-3-5');
		expect(providerSettings(settings).image_model).toBe('krea-2-turbo');
	});

	it('preserves an explicitly saved Aion 3.0 selection after the default changes', () => {
		const settings = loadSettings();
		settings.providers.venice = { text_model: 'aion-labs-aion-3-0', image_model: 'krea-2-turbo' };
		saveSettings(settings);
		resetSettingsStateForTests();
		expect(providerSettings(loadSettings()).text_model).toBe('aion-labs-aion-3-0');
	});

	it('explicitly unselected models remain unselected', () => {
		const settings = loadSettings();
		settings.providers['venice'] = { text_model: '', image_model: '' };
		saveSettings(settings);

		const reloaded = loadSettings();
		expect(providerSettings(reloaded).text_model).toBe('');
		expect(providerSettings(reloaded).image_model).toBe('');
	});

	it('save and load roundtrip persists model selection', () => {
		const settings = loadSettings();
		settings.providers['venice'] = { text_model: 'llama', image_model: 'flux' };
		settings.narrator_temperature = 1.1;
		settings.translation_language = 'Korean';
		settings.image_style = 'anime';
		saveSettings(settings);
		resetSettingsStateForTests();

		const reloaded = loadSettings();
		expect(providerSettings(reloaded).text_model).toBe('llama');
		expect(providerSettings(reloaded).image_model).toBe('flux');
		expect(reloaded.narrator_temperature).toBeCloseTo(1.1);
		expect(reloaded.translation_language).toBe('Korean');
		expect(reloaded.image_style).toBe('anime');
	});

	it('removes the temporary settings file when atomic replace fails', () => {
		const settings = loadSettings();
		const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
			throw new Error('EPERM: rename failed');
		});

		expect(() => saveSettings(settings)).toThrow('rename failed');
		renameSpy.mockRestore();
		expect(fs.readdirSync(dataDir()).filter((name) => name.includes('.settings.json.') && name.endsWith('.tmp')))
			.toEqual([]);
	});
});
describe('image style settings', () => {
	it.each([{}, { image_style: 'unknown' }, { image_style: 42 }])(
		'loads old or unsupported style settings without losing model selection: %j', (fields) => {
			fs.mkdirSync(dataDir(), { recursive: true });
			fs.writeFileSync(settingsPath(), JSON.stringify({
				...fields,
				providers: { venice: { image_model: 'saved-image-model' } }
			}), 'utf-8');

			const settings = loadSettings();
			expect(settings.image_style).toBe('none');
			expect(providerSettings(settings).image_model).toBe('saved-image-model');
			expect(fs.existsSync(settingsPath())).toBe(true);
		}
	);

	it('saves and exposes the style through the settings API', async () => {
		const { PUT, GET } = await import('../src/routes/settings/+server');
		const result = await PUT({ request: new Request('http://localhost/settings', {
			method: 'PUT', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ providers: {}, image_style: 'watercolor' })
		}) } as never);

		expect(result.status).toBe(200);
		expect((await result.json()).image_style).toBe('watercolor');
		resetSettingsStateForTests();
		expect(loadSettings().image_style).toBe('watercolor');
		const fetched = await GET({} as never);
		expect((await fetched.json()).image_style).toBe('watercolor');
	});

	it('keeps the saved style for an older client that omits it and can explicitly disable it', async () => {
		const settings = loadSettings();
		settings.image_style = 'anime';
		saveSettings(settings);
		const { PUT } = await import('../src/routes/settings/+server');
		for (const [fields, expected] of [[{}, 'anime'], [{ image_style: 'none' }, 'none']] as const) {
			const result = await PUT({ request: new Request('http://localhost/settings', {
				method: 'PUT', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ providers: {}, ...fields })
			}) } as never);
			expect(result.status).toBe(200);
			expect((await result.json()).image_style).toBe(expected);
			expect(loadSettings().image_style).toBe(expected);
		}
	});

	it('rejects an unsupported API style without changing saved settings', async () => {
		const settings = loadSettings();
		settings.image_style = 'anime';
		saveSettings(settings);
		const { PUT } = await import('../src/routes/settings/+server');
		const result = await PUT({ request: new Request('http://localhost/settings', {
			method: 'PUT', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ providers: {}, image_style: 'unknown' })
		}) } as never);

		expect(result.status).toBe(422);
		expect(loadSettings().image_style).toBe('anime');
	});
});

describe('keyring status handling', () => {
	it('reports keychain when a key is stored', async () => {
		const keyring = new FakeStore();
		setCredentialStoreForTests(keyring);
		await setApiKey('venice', 'secret-key');

		expect(await getApiKeyStatus('venice')).toBe('keychain');
		const published = await publicSettings();
		expect(published['key_configured']).toEqual({ venice: true });
		expect(published['key_source']).toEqual({ venice: 'keychain' });
		expect(JSON.stringify(published)).not.toContain('secret-key');
	});

	it('reports absent when no key is stored', async () => {
		setCredentialStoreForTests(new FakeStore());
		expect(await getApiKeyStatus('venice')).toBe('absent');
		const published = await publicSettings();
		expect(published['key_configured']).toEqual({ venice: false });
	});

	it('reports storage_unavailable when the store cannot be reached', async () => {
		setCredentialStoreForTests({
			getPassword: () => Promise.reject(new Error('credential store unavailable')),
			setPassword: () => Promise.reject(new Error('credential store unavailable')),
			deletePassword: () => Promise.reject(new Error('credential store unavailable'))
		});

		expect(await getApiKeyStatus('venice')).toBe('storage_unavailable');
		const published = await publicSettings();
		expect(published['key_source']).toEqual({ venice: 'storage_unavailable' });
		await expect(setApiKey('venice', 'k')).rejects.toThrow('Could not store the API key');
		await expect(deleteApiKey('venice')).rejects.toThrow('Could not delete the API key');
	});

	it('delete removes a stored key', async () => {
		const keyring = new FakeStore();
		setCredentialStoreForTests(keyring);
		await setApiKey('venice', 'secret-key');
		expect(await deleteApiKey('venice')).toBe(true);
		expect(await getApiKeyStatus('venice')).toBe('absent');
		expect(await deleteApiKey('venice')).toBe(false);
	});

	it('blank key is not stored', async () => {
		setCredentialStoreForTests(new FakeStore());
		expect(await setApiKey('venice', '   ')).toBe(false);
		expect(await getApiKeyStatus('venice')).toBe('absent');
	});

	it('stores keys without creating a credential file', async () => {
		const keyring = new FakeStore();
		setCredentialStoreForTests(keyring);
		await setApiKey('venice', 'stored-secret');

		expect(await getApiKey('venice')).toBe('stored-secret');
		expect(await getApiKeyStatus('venice')).toBe('keychain');
		expect(fs.existsSync(credentialsPath())).toBe(false);
	});

	it('gives the read-only environment key highest priority', async () => {
		const keyring = new FakeStore();
		setCredentialStoreForTests(keyring);
		await keyring.setPassword('venice', 'stored-secret');
		vi.stubEnv('VENICE_API_KEY', ' environment-secret ');

		expect(await getApiKey('venice')).toBe('environment-secret');
		expect(await getApiKeyStatus('venice')).toBe('environment');
		await expect(setApiKey('venice', 'replacement')).rejects.toThrow('cannot be changed in Settings');
		await expect(deleteApiKey('venice')).rejects.toThrow('cannot be changed in Settings');
	});

	it('removes obsolete encrypted credential files when a new key is entered', async () => {
		fs.mkdirSync(dataDir(), { recursive: true });
		fs.writeFileSync(credentialsPath(), 'venice: enc:v1:iv:tag:ciphertext\n', 'utf8');
		fs.writeFileSync(path.join(dataDir(), '.credentials-key'), 'legacy-machine-key', 'utf8');
		fs.writeFileSync(
			path.join(dataDir(), 'credentials.legacy-encrypted.yaml'),
			'venice: enc:v1:old-backup\n',
			'utf8'
		);
		setCredentialStoreForTests(new FakeStore());

		expect(await getApiKeyStatus('venice')).toBe('legacy_encrypted');
		expect(await getApiKey('venice')).toBe('');

		await setApiKey('venice', 'new-secret');
		expect(fs.existsSync(credentialsPath())).toBe(false);
		expect(fs.existsSync(path.join(dataDir(), '.credentials-key'))).toBe(false);
		expect(fs.existsSync(path.join(dataDir(), 'credentials.legacy-encrypted.yaml'))).toBe(false);
		expect(await getApiKey('venice')).toBe('new-secret');
	});

	it('migrates a plaintext credential into the keychain and removes legacy files', async () => {
		const keyring = new FakeStore();
		setCredentialStoreForTests(keyring);
		fs.mkdirSync(dataDir(), { recursive: true });
		fs.writeFileSync(credentialsPath(), 'VENICE_API_KEY: file-secret\n', 'utf8');
		fs.writeFileSync(path.join(dataDir(), '.credentials-key'), 'obsolete-key', 'utf8');

		expect(await getApiKey('venice')).toBe('file-secret');
		expect(await keyring.getPassword('venice')).toBe('file-secret');
		expect(await getApiKeyStatus('venice')).toBe('keychain');
		expect(fs.existsSync(credentialsPath())).toBe(false);
		expect(fs.existsSync(path.join(dataDir(), '.credentials-key'))).toBe(false);
	});

	it('replaces an invalid legacy file after an explicit key save', async () => {
		setCredentialStoreForTests(new FakeStore());
		fs.mkdirSync(dataDir(), { recursive: true });
		fs.writeFileSync(credentialsPath(), 'VENICE_API_KEY: [broken\n', 'utf8');

		expect(await getApiKeyStatus('venice')).toBe('storage_unavailable');
		expect(await getApiKey('venice')).toBe('');
		expect(await setApiKey('venice', 'new-secret')).toBe(true);
		expect(fs.existsSync(credentialsPath())).toBe(false);
		expect(await getApiKey('venice')).toBe('new-secret');
	});

	it('rejects unsupported credential entries', async () => {
		fs.mkdirSync(dataDir(), { recursive: true });
		fs.writeFileSync(credentialsPath(), 'VENICE_API_KEY: valid\nEXTRA_KEY: unexpected\n', 'utf8');
		setCredentialStoreForTests(new FakeStore());

		expect(await getApiKeyStatus('venice')).toBe('storage_unavailable');
		expect(await getApiKey('venice')).toBe('');
	});
});

describe('settings route concurrency', () => {
	it('serializes a delayed credential save with later style updates and reads', async () => {
		const credentials = new FakeStore();
		let releaseKey!: () => void;
		let keyStarted!: () => void;
		const started = new Promise<void>((resolve) => { keyStarted = resolve; });
		const gate = new Promise<void>((resolve) => { releaseKey = resolve; });
		setCredentialStoreForTests({
			getPassword: (account) => credentials.getPassword(account),
			deletePassword: (account) => credentials.deletePassword(account),
			setPassword: async (account, password) => {
				keyStarted();
				await gate;
				await credentials.setPassword(account, password);
			}
		});
		const { PUT, GET } = await import('../src/routes/settings/+server');
		const request = (fields: Record<string, unknown>) => new Request('http://localhost/settings', {
			method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields)
		});
		const first = PUT({ request: request({
			providers: { venice: { text_model: 'first-narrator' } }, image_style: 'anime', api_key: 'fixture-key'
		}) } as never);
		await started;
		let laterCompleted = false;
		const secondRequest = request({ providers: { venice: { image_model: 'later-image' } }, image_style: 'watercolor' });
		const parsed = vi.spyOn(secondRequest, 'json');
		const second = Promise.resolve(PUT({ request: secondRequest } as never))
			.then((result) => { laterCompleted = true; return result; });
		try {
			await vi.waitFor(() => expect(parsed).toHaveBeenCalled());
			expect(laterCompleted).toBe(false);
			expect(loadSettings().image_style).toBe('none');
		} finally {
			releaseKey();
		}
		const [firstResponse, secondResponse] = await Promise.all([first, second]);
		const readResponse = await GET({} as never);
		expect(firstResponse.status).toBe(200);
		expect(secondResponse.status).toBe(200);
		expect((await firstResponse.json()).image_style).toBe('anime');
		expect((await secondResponse.json()).image_style).toBe('watercolor');
		expect((await readResponse.json()).image_style).toBe('watercolor');
		const settings = loadSettings();
		expect(settings.image_style).toBe('watercolor');
		expect(providerSettings(settings)).toEqual({ text_model: 'first-narrator', image_model: 'later-image' });
	});

	it('releases the settings lock after a credential write failure', async () => {
		setCredentialStoreForTests({
			getPassword: async () => null,
			deletePassword: async () => false,
			setPassword: async () => { throw new Error('fixture credential storage unavailable'); }
		});
		const { PUT } = await import('../src/routes/settings/+server');
		const request = (fields: Record<string, unknown>) => new Request('http://localhost/settings', {
			method: 'PUT', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ providers: {}, ...fields })
		});
		expect((await PUT({ request: request({ api_key: 'fixture-key', image_style: 'anime' }) } as never)).status).toBe(503);
		const retry = await PUT({ request: request({ image_style: 'watercolor' }) } as never);
		expect(retry.status).toBe(200);
		expect(loadSettings().image_style).toBe('watercolor');
	});
});

describe('settings route credential policy', () => {
	it('returns 409 when a request tries to replace an environment key', async () => {
		vi.stubEnv('VENICE_API_KEY', 'environment-secret');
		const { PUT } = await import('../src/routes/settings/+server');
		const request = new Request('http://localhost/settings', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ providers: { venice: {} }, api_key: 'replacement' })
		});

		const response = await PUT({ request } as never);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			detail: 'The API key is provided by VENICE_API_KEY and cannot be changed in Settings'
		});
	});

	it('still saves non-secret settings while an environment key is active', async () => {
		vi.stubEnv('VENICE_API_KEY', 'environment-secret');
		const { PUT } = await import('../src/routes/settings/+server');
		const request = new Request('http://localhost/settings', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				providers: { venice: { text_model: 'new-model' } },
				narrator_temperature: 1.2
			})
		});

		const response = await PUT({ request } as never);
		expect(response.status).toBe(200);
		const published = (await response.json()) as Record<string, unknown>;
		expect(published['narrator_temperature']).toBe(1.2);
		expect(published['key_source']).toEqual({ venice: 'environment' });
		expect(published['key_configured']).toEqual({ venice: true });
	});
});
