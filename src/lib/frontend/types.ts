/** Shared frontend types mirroring the JSON API payloads. */

export interface Message {
	id?: string;
	role: 'user' | 'assistant';
	content: string;
	translation_ru?: string | null;
	kind?: 'branch' | null;
}

export interface MediaRecord {
	id: string;
	message_id: string;
	kind: 'image';
	file: string;
	source_text?: string;
	created_at?: string;
}

export interface StatePayload {
	messages: Message[];
	media: MediaRecord[];
	can_undo_summary: boolean;
	last_narrator_prompt_tokens: number | null;
	recovery_message: string | null;
}

/** One model as the server sends it: identity, geometry, and catalog metadata. */
export interface ModelRow {
	id: string;
	name: string;
	resolutions?: string[];
	aspect_ratios?: string[];
	// Catalog facts shown next to the picker; parsed in `$lib/modelInfo`.
	price_input?: number;
	price_output?: number;
	price_cache_input?: number;
	price_generation?: number;
	price_upscale_2x?: number;
	privacy?: string;
	uncensored?: boolean;
	beta?: boolean;
	context_tokens?: number;
	max_completion_tokens?: number;
	deprecation_date?: string;
	supports_e2ee?: boolean;
	supports_tee_attestation?: boolean;
	[key: string]: unknown;
}

export interface ModelCatalogs {
	text?: ModelRow[];
	image?: ModelRow[];
}

export type KeySource =
	| 'environment'
	| 'keychain'
	| 'absent'
	| 'legacy_encrypted'
	| 'storage_unavailable'
	| 'settings_corrupt';

/** One sampling field sent to the provider exactly as the player typed it. */
export type NarratorParameterValue = string | number | boolean | string[] | number[];
export type NarratorParameters = Record<string, NarratorParameterValue>;

export interface SettingsPayload {
	active_provider: string;
	narrator_parameters: NarratorParameters;
	translation_language: import('$lib/translationLanguages').TranslationLanguage;
	image_style: import('$lib/imageStyles').ImageStyle;
	providers: Record<string, { text_model?: string; image_model?: string }>;
	key_configured?: Record<string, boolean>;
	key_source?: Record<string, KeySource>;
}
