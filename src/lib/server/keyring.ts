/**
 * Provider API keys stored in the current user's native OS keychain.
 *
 * VENICE_API_KEY always wins and is intentionally read-only. The legacy
 * data/ credential files are read only for one-time migration and removed
 * after a successful keychain write.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AsyncEntry } from '@napi-rs/keyring';
import YAML from 'yaml';
import { credentialsPath, dataDir } from './paths';

export const KEYRING_SERVICE = 'RPG Engine';

export type ProviderName = 'venice';
export type KeySource =
	| 'environment'
	| 'keychain'
	| 'absent'
	| 'legacy_encrypted'
	| 'storage_unavailable'
	| 'settings_corrupt';

const ENVIRONMENT_KEYS: Record<ProviderName, 'VENICE_API_KEY'> = {
	venice: 'VENICE_API_KEY'
};
const LEGACY_ENCRYPTED_PREFIX = 'enc:v1:';
const LEGACY_BACKUP_RE = /^credentials\.legacy-encrypted(?:-\d+)?\.yaml$/;

export class CredentialStoreError extends Error {
	constructor(message: string = 'System credential storage is unavailable') {
		super(message);
		this.name = 'CredentialStoreError';
	}
}

export class EnvironmentCredentialError extends CredentialStoreError {
	constructor() {
		super('The API key is provided by VENICE_API_KEY and cannot be changed in Settings');
		this.name = 'EnvironmentCredentialError';
	}
}

class LegacyCredentialError extends CredentialStoreError {
	constructor() {
		super('The encrypted credential file is from an older version; enter the API key again');
		this.name = 'LegacyCredentialError';
	}
}

/** Small backend contract used by the native adapter and isolated tests. */
export interface CredentialStore {
	getPassword(account: string): Promise<string | null>;
	setPassword(account: string, password: string): Promise<void>;
	deletePassword(account: string): Promise<boolean>;
}

const nativeStore: CredentialStore = {
	async getPassword(account) {
		return (await new AsyncEntry(KEYRING_SERVICE, account).getPassword()) ?? null;
	},
	async setPassword(account, password) {
		await new AsyncEntry(KEYRING_SERVICE, account).setPassword(password);
	},
	async deletePassword(account) {
		return await new AsyncEntry(KEYRING_SERVICE, account).deleteCredential();
	}
};

const UNSET = Symbol('credential store unset');
let testOverride: CredentialStore | typeof UNSET = UNSET;

/** Test hook: inject an in-memory or intentionally broken backend. */
export function setCredentialStoreForTests(store: CredentialStore | undefined): void {
	testOverride = store === undefined ? UNSET : store;
}

function activeStore(): CredentialStore {
	return testOverride !== UNSET ? (testOverride as CredentialStore) : nativeStore;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type LegacyCredential =
	| { kind: 'absent' }
	| { kind: 'plaintext'; value: string }
	| { kind: 'encrypted' };

function readLegacyCredential(provider: ProviderName): LegacyCredential {
	const filePath = credentialsPath();
	if (!fs.existsSync(filePath)) return { kind: 'absent' };

	let raw: unknown;
	try {
		raw = YAML.parse(fs.readFileSync(filePath, 'utf8')) ?? {};
	} catch {
		throw new CredentialStoreError('Legacy credential file is invalid or unreadable');
	}
	if (!isPlainObject(raw)) {
		throw new CredentialStoreError('Legacy credential file must be a YAML mapping');
	}
	if (
		Object.values(raw).some(
			(entry) => typeof entry === 'string' && entry.startsWith(LEGACY_ENCRYPTED_PREFIX)
		)
	) {
		return { kind: 'encrypted' };
	}

	const expectedKey = ENVIRONMENT_KEYS[provider];
	for (const [key, value] of Object.entries(raw)) {
		if (key !== expectedKey || typeof value !== 'string') {
			throw new CredentialStoreError('Legacy credential file contains unsupported entries');
		}
	}
	const value = typeof raw[expectedKey] === 'string' ? raw[expectedKey].trim() : '';
	return value ? { kind: 'plaintext', value } : { kind: 'absent' };
}

function legacyCredentialPaths(): string[] {
	const root = dataDir();
	const paths = [credentialsPath(), path.join(root, '.credentials-key')];
	if (!fs.existsSync(root)) return paths;
	for (const name of fs.readdirSync(root)) {
		if (LEGACY_BACKUP_RE.test(name)) paths.push(path.join(root, name));
	}
	return [...new Set(paths)];
}

function removeLegacyCredentialFiles(): void {
	for (const filePath of legacyCredentialPaths()) {
		try {
			fs.rmSync(filePath, { force: true });
		} catch {
			throw new CredentialStoreError('The API key was saved, but an obsolete credential file could not be removed');
		}
	}
}

async function readOrMigrateStoredApiKey(provider: ProviderName): Promise<string> {
	const legacy = readLegacyCredential(provider);
	if (legacy.kind === 'plaintext') {
		await activeStore().setPassword(provider, legacy.value);
		removeLegacyCredentialFiles();
		return legacy.value;
	}

	const stored = (await activeStore().getPassword(provider))?.trim() || '';
	if (stored) {
		if (legacy.kind === 'encrypted') removeLegacyCredentialFiles();
		return stored;
	}
	if (legacy.kind === 'encrypted') throw new LegacyCredentialError();
	return '';
}

function environmentApiKey(provider: ProviderName): string {
	return (process.env[ENVIRONMENT_KEYS[provider]] ?? '').trim();
}

export async function getStoredApiKey(provider: ProviderName): Promise<string> {
	try {
		return await readOrMigrateStoredApiKey(provider);
	} catch (exc) {
		if (exc instanceof CredentialStoreError) throw exc;
		throw new CredentialStoreError();
	}
}

export async function getApiKey(provider: ProviderName): Promise<string> {
	const fromEnvironment = environmentApiKey(provider);
	if (fromEnvironment) return fromEnvironment;
	try {
		return await getStoredApiKey(provider);
	} catch (exc) {
		if (exc instanceof CredentialStoreError) return '';
		throw exc;
	}
}

export async function getApiKeyStatus(provider: ProviderName): Promise<KeySource> {
	if (environmentApiKey(provider)) return 'environment';
	try {
		return (await getStoredApiKey(provider)) ? 'keychain' : 'absent';
	} catch (exc) {
		if (exc instanceof LegacyCredentialError) return 'legacy_encrypted';
		if (exc instanceof CredentialStoreError) return 'storage_unavailable';
		throw exc;
	}
}

export async function setApiKey(provider: ProviderName, value: string): Promise<boolean> {
	if (environmentApiKey(provider)) throw new EnvironmentCredentialError();
	const cleaned = value.trim();
	if (!cleaned) return false;
	try {
		await activeStore().setPassword(provider, cleaned);
		removeLegacyCredentialFiles();
	} catch (exc) {
		if (exc instanceof CredentialStoreError) throw exc;
		throw new CredentialStoreError('Could not store the API key in the system keychain');
	}
	return true;
}

export async function deleteApiKey(provider: ProviderName): Promise<boolean> {
	if (environmentApiKey(provider)) throw new EnvironmentCredentialError();
	try {
		const deleted = await activeStore().deletePassword(provider);
		if (deleted) removeLegacyCredentialFiles();
		return deleted;
	} catch (exc) {
		if (exc instanceof CredentialStoreError) throw exc;
		throw new CredentialStoreError('Could not delete the API key from the system keychain');
	}
}
