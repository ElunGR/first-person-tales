/**
 * Small process-wide defaults; product settings live in data/settings.json.
 * Port of backend/config.py.
 */

import packageInfo from '../../../package.json';

/** Project root; prompts.yaml and a relative data/ resolve from here. */
export function rootDir(): string {
	return process.env.RPG_ROOT_DIR || process.cwd();
}

/** Public application identity; never includes player, device, or account data. */
export const APPLICATION_USER_AGENT: string = `${packageInfo.name}/${packageInfo.version}`;

// Defaults used by persistent narrator settings and low-level compatibility.
export const DEFAULT_API_SERVER: string = 'https://api.venice.ai/api/v1';
export const DEFAULT_NARRATOR_MODEL: string = 'glm-5-3-flash-uncensored';
export const DEFAULT_IMAGE_MODEL: string = 'krea-2-turbo';

// Venice-only image option. Provider, key and model come from AppSettings.
export const IMAGE_SAFE_MODE: boolean = false;

// Persistent data
export const DATA_DIR: string = 'data';

// Input and downloaded-media safety limits. Text is measured in Unicode
// characters; media and request bodies are measured in bytes.
export const MAX_TEXT_INPUT_CHARS: number = 50_000;
export const MAX_IMPORT_BODY_BYTES: number = 4 * 1024 * 1024;
export const MAX_IMAGE_RESPONSE_BYTES: number = 20 * 1024 * 1024;

// Utility temperature for internal, non-narrator requests (translate, improve,
// image-prompt rewrite, summary). Narrator defaults live with the parameter
// dictionary in src/lib/narratorParameters.ts so the settings UI can show them.
export const UTILITY_TEMPERATURE: number = 0.3;

// Utility requests that write new prose instead of correcting existing text
// (world expansion) keep more variety; they are still explicit, one-shot calls.
export const CREATIVE_UTILITY_TEMPERATURE: number = 0.7;

/**
 * Output budget for world expansion. The prompt asks for at most 10 000
 * characters, about 2 500 tokens of visible text. Reasoning models bill their
 * reasoning tokens against the same budget, so leave roughly three times the
 * visible text instead of the bare estimate.
 */
export const WORLD_EXPANSION_MAX_TOKENS: number = 9000;
