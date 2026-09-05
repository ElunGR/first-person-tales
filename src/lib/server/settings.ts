/**
 * Persistent provider/model settings with secrets kept outside settings.json.
 * Port of backend/settings_store.py (the settings-file half).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import * as config from './config';
import { getApiKeyStatus, type KeySource, type ProviderName } from './keyring';
import { dataDir } from './paths';
import { utcStamp } from './time';
import {
	DEFAULT_TRANSLATION_LANGUAGE,
	isTranslationLanguage,
	TRANSLATION_LANGUAGES
} from '$lib/translationLanguages';

export const PROVIDER_URLS: Record<ProviderName, string> = {
	venice: 'https://api.venice.ai/api/v1'
};

const INVALID_SETTINGS_KEEP = 5;
const INVALID_SETTINGS_RE = /^settings\.invalid-.*\.json$/;

export const ProviderSettingsSchema = z.strictObject({
	text_model: z.string().default(config.DEFAULT_NARRATOR_MODEL),
	image_model: z.string().default(config.DEFAULT_IMAGE_MODEL)
});
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export const AppSettingsSchema = z.strictObject({
	active_provider: z.literal('venice').default('venice'),
	narrator_temperature: z.number().min(0).max(2).default(config.NARRATOR_TEMPERATURE),
	narrator_frequency_penalty: z.number().min(-2).max(2).default(config.NARRATOR_FREQUENCY_PENALTY),
	narrator_presence_penalty: z.number().min(-2).max(2).default(config.NARRATOR_PRESENCE_PENALTY),
	narrator_max_tokens: z.number().int().min(16).max(8192).default(config.NARRATOR_MAX_COMPLETION_TOKENS),
	narrator_top_p: z.number().min(0.01).max(1).default(config.NARRATOR_TOP_P),
	translation_language: z.enum(TRANSLATION_LANGUAGES).default(DEFAULT_TRANSLATION_LANGUAGE),
	providers: z.record(z.literal('venice'), ProviderSettingsSchema).default({})
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

let settingsCorruptPath: string | null = null;

interface SettingsCacheEntry {
	path: string;
	mtimeMs: number;
	size: number;
	value: AppSettings;
}

/**
 * Parsed settings cached by file mtime/size (same invalidation strategy as
 * prompts.ts). Saves a synchronous read + JSON + zod parse on every LLM
 * request. Fallback defaults are never cached: the file may appear later.
 */
let settingsCache: SettingsCacheEntry | null = null;

/** Clone the small settings object so callers may mutate their copy freely. */
function cloneSettings(value: AppSettings): AppSettings {
	const providers: AppSettings['providers'] = {};
	for (const [name, provider] of Object.entries(value.providers)) {
		providers[name as ProviderName] = { ...provider };
	}
	return { ...value, providers };
}

export function settingsPath(): string {
	return path.join(dataDir(), 'settings.json');
}

export function settingsIsCorrupt(): boolean {
	return settingsCorruptPath === settingsPath();
}

/** Reset the corrupt flag and parsed-settings cache (tests). */
export function resetSettingsStateForTests(): void {
	settingsCorruptPath = null;
	settingsCache = null;
}

function invalidSettingsBackups(): string[] {
	const root = dataDir();
	if (!fs.existsSync(root)) return [];
	const names = fs.readdirSync(root).filter((name) => {
		if (!INVALID_SETTINGS_RE.test(name)) return false;
		try {
			return fs.statSync(path.join(root, name)).isFile();
		} catch {
			return false;
		}
	});
	names.sort((a, b) => {
		if (a !== b) return b.localeCompare(a);
		const mtimeA = fs.statSync(path.join(root, a)).mtimeMs;
		const mtimeB = fs.statSync(path.join(root, b)).mtimeMs;
		return mtimeB - mtimeA;
	});
	return names.map((name) => path.join(root, name));
}

function cleanupInvalidSettingsBackups(): void {
	for (const backupPath of invalidSettingsBackups().slice(INVALID_SETTINGS_KEEP)) {
		try {
			fs.unlinkSync(backupPath);
		} catch {
			// Keep going; cleanup is best effort.
		}
	}
}

function quarantineInvalidSettings(filePath: string, reason: string): void {
	settingsCorruptPath = filePath;
	settingsCache = null;
	const stamp = utcStamp();
	const backup = path.join(path.dirname(filePath), `settings.invalid-${stamp}.json`);
	try {
		fs.renameSync(filePath, backup);
	} catch (exc) {
		console.warn(`Could not quarantine invalid settings ${filePath}: ${exc}`);
		return;
	}
	console.warn(`Invalid settings quarantined to ${backup} (${reason})`);
	cleanupInvalidSettingsBackups();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keep Venice fields even if the file still has leftover provider keys. */
function veniceFromRaw(data: unknown): AppSettings {
	const raw = isPlainObject(data) ? data : {};
	const clean: Record<string, unknown> = { active_provider: 'venice' };

	const temperature = raw['narrator_temperature'];
	if (typeof temperature === 'number') clean['narrator_temperature'] = temperature;
	const frequencyPenalty = raw['narrator_frequency_penalty'];
	if (typeof frequencyPenalty === 'number') clean['narrator_frequency_penalty'] = frequencyPenalty;
	const presencePenalty = raw['narrator_presence_penalty'];
	if (typeof presencePenalty === 'number') clean['narrator_presence_penalty'] = presencePenalty;
	const maxTokens = raw['narrator_max_tokens'];
	if (typeof maxTokens === 'number' && Number.isInteger(maxTokens)) {
		clean['narrator_max_tokens'] = maxTokens;
	}
	const topP = raw['narrator_top_p'];
	if (typeof topP === 'number') clean['narrator_top_p'] = topP;
	const translationLanguage = raw['translation_language'];
	if (isTranslationLanguage(translationLanguage)) {
		clean['translation_language'] = translationLanguage;
	}

	const providersRaw = raw['providers'];
	if (isPlainObject(providersRaw)) {
		const veniceRaw = providersRaw['venice'];
		const venice: Record<string, unknown> = {};
		if (isPlainObject(veniceRaw)) {
			if (typeof veniceRaw['text_model'] === 'string') venice['text_model'] = veniceRaw['text_model'];
			if (typeof veniceRaw['image_model'] === 'string') venice['image_model'] = veniceRaw['image_model'];
		}
		clean['providers'] = { venice };
	}
	return AppSettingsSchema.parse(clean);
}

export function loadSettings(): AppSettings {
	const filePath = settingsPath();
	let stats: fs.Stats | null = null;
	try {
		stats = fs.statSync(filePath);
	} catch {
		stats = null;
	}
	if (
		stats !== null &&
		stats.isFile() &&
		settingsCache !== null &&
		settingsCache.path === filePath &&
		settingsCache.mtimeMs === stats.mtimeMs &&
		settingsCache.size === stats.size
	) {
		return cloneSettings(settingsCache.value);
	}
	let data: unknown = {};
	try {
		data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
	} catch {
		if (fs.existsSync(filePath)) {
			quarantineInvalidSettings(filePath, 'unreadable settings file');
		}
		settingsCache = null;
		return defaultSettings();
	}
	try {
		const parsed = veniceFromRaw(data);
		if (stats !== null && stats.isFile()) {
			settingsCache = { path: filePath, mtimeMs: stats.mtimeMs, size: stats.size, value: parsed };
		}
		return cloneSettings(parsed);
	} catch (exc) {
		quarantineInvalidSettings(filePath, String(exc));
		return defaultSettings();
	}
}

export function saveSettings(settings: AppSettings): void {
	const filePath = settingsPath();
	const payload = JSON.stringify(settings, null, 2);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tmpName = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${crypto.randomBytes(8).toString('hex')}.tmp`
	);
	try {
		const fd = fs.openSync(tmpName, 'w');
		try {
			fs.writeSync(fd, payload, undefined, 'utf-8');
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(tmpName, filePath);
	} catch (err) {
		try {
			fs.unlinkSync(tmpName);
		} catch {
			// Already renamed or never created.
		}
		throw err;
	}
	if (settingsCorruptPath === filePath) {
		settingsCorruptPath = null;
	}
	try {
		const stats = fs.statSync(filePath);
		settingsCache = {
			path: filePath,
			mtimeMs: stats.mtimeMs,
			size: stats.size,
			value: cloneSettings(settings)
		};
	} catch {
		settingsCache = null;
	}
}

/** Provider-specific model selection with lazy defaults (settings.provider()). */
export function providerSettings(settings: AppSettings, name?: ProviderName): ProviderSettings {
	const key = name ?? settings.active_provider;
	if (!settings.providers[key]) {
		settings.providers[key] = ProviderSettingsSchema.parse({});
	}
	return settings.providers[key];
}

export function providerUrl(provider: ProviderName): string {
	return PROVIDER_URLS[provider];
}

export async function publicSettings(settings?: AppSettings): Promise<Record<string, unknown>> {
	const current = settings ?? loadSettings();
	const sources: Partial<Record<ProviderName, KeySource>> = {};
	const keyConfigured: Partial<Record<ProviderName, boolean>> = {};
	for (const name of Object.keys(PROVIDER_URLS) as ProviderName[]) {
		const credentialSource = await getApiKeyStatus(name);
		sources[name] =
			credentialSource === 'environment'
				? 'environment'
				: settingsIsCorrupt()
					? 'settings_corrupt'
					: credentialSource;
		keyConfigured[name] = credentialSource === 'environment' || credentialSource === 'keychain';
	}
	return {
		...current,
		key_configured: keyConfigured,
		key_source: sources
	};
}

export function defaultSettings(): AppSettings {
	return AppSettingsSchema.parse({
		active_provider: 'venice',
		providers: { venice: {} }
	});
}
