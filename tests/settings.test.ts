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
	setCredentialStoreForTests(undefined);
	resetSettingsStateForTests();
	vi.unstubAllEnvs();
});

describe('settings recovery', () => {
	it('missing settings file returns defaults', () => {
		const settings = loadSettings();
		expect(settings.active_provider).toBe('venice');
		expect(settings.narrator_temperature).toBeCloseTo(0.75);
		expect(settings.translation_language).toBe('Russian');
		expect(providerSettings(settings).text_model).toBe('aion-labs-aion-3-0');
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
		expect(providerSettings(settings).text_model).toBe('aion-labs-aion-3-0');
		expect(providerSettings(settings).image_model).toBe('krea-2-turbo');
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
		saveSettings(settings);

		const reloaded = loadSettings();
		expect(providerSettings(reloaded).text_model).toBe('llama');
		expect(providerSettings(reloaded).image_model).toBe('flux');
		expect(reloaded.narrator_temperature).toBeCloseTo(1.1);
		expect(reloaded.translation_language).toBe('Korean');
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
