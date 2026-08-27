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
export const DEFAULT_NARRATOR_MODEL: string = 'aion-labs-aion-3-0';
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

// Role temperatures
export const NARRATOR_TEMPERATURE: number = 0.75;
export const NARRATOR_FREQUENCY_PENALTY: number = 0.35;
export const NARRATOR_PRESENCE_PENALTY: number = 0.0;
export const NARRATOR_MAX_COMPLETION_TOKENS: number = 1500;
export const NARRATOR_TOP_P: number = 0.95;
export const UTILITY_TEMPERATURE: number = 0.3;
