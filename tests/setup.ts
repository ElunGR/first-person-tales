/** Every test gets private credentials; native OS credentials are off limits. */
import { afterEach, beforeEach, vi } from 'vitest';
import { setCredentialStoreForTests } from '../src/lib/server/keyring';

// Block the native boundary even if a test forgets its override or resets it.
// Do not import the real module: tests must never open the player's keychain.
vi.mock('@napi-rs/keyring', () => ({
	AsyncEntry: class {
		constructor() {
			throw new Error('Native credential storage is forbidden in automated tests');
		}
	}
}));

beforeEach(() => {
	const passwords = new Map<string, string>();
	setCredentialStoreForTests({
		getPassword: async (account) => passwords.get(account) ?? null,
		setPassword: async (account, password) => { passwords.set(account, password); },
		deletePassword: async (account) => passwords.delete(account)
	});
	// A developer's environment key must not leak into mocked provider requests.
	vi.stubEnv('VENICE_API_KEY', '');
});

afterEach(() => {
	setCredentialStoreForTests(undefined);
	vi.unstubAllEnvs();
});
