import { describe, expect, it } from 'vitest';
import { AsyncEntry } from '@napi-rs/keyring';
import {
	deleteApiKey,
	getApiKey,
	getApiKeyStatus,
	setApiKey,
	setCredentialStoreForTests
} from '../src/lib/server/keyring';
import { publicSettings } from '../src/lib/server/settings';
import { useTempDataDir } from './helpers';

useTempDataDir();

describe('test credential isolation', () => {
	it('supports the image-test key lifecycle without native storage', async () => {
		expect(await getApiKeyStatus('venice')).toBe('absent');
		await setApiKey('venice', 'test-key');
		expect(await getApiKey('venice')).toBe('test-key');
		expect((await publicSettings())['key_source']).toEqual({ venice: 'keychain' });
		expect(await deleteApiKey('venice')).toBe(true);
		expect(await getApiKeyStatus('venice')).toBe('absent');
		// Leave a value behind to verify the next test starts with a fresh store.
		await setApiKey('venice', 'previous-test-key');
	});

	it('starts with no credentials from other tests or the developer environment', async () => {
		expect(process.env.VENICE_API_KEY).toBe('');
		expect(await getApiKey('venice')).toBe('');
		expect(await getApiKeyStatus('venice')).toBe('absent');
	});

	it('blocks native access even when the test override is removed', async () => {
		setCredentialStoreForTests(undefined);
		expect(() => new AsyncEntry('RPG Engine', 'venice')).toThrow(
			'Native credential storage is forbidden in automated tests'
		);
		expect(await getApiKeyStatus('venice')).toBe('storage_unavailable');
		await expect(setApiKey('venice', 'test-key')).rejects.toThrow('Could not store the API key');
		await expect(deleteApiKey('venice')).rejects.toThrow('Could not delete the API key');
	});
});
