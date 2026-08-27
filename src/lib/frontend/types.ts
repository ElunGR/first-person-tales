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

export interface ModelRow {
	id: string;
	name: string;
	resolutions?: string[];
	aspect_ratios?: string[];
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

export interface SettingsPayload {
	active_provider: string;
	narrator_temperature: number;
	narrator_frequency_penalty: number;
	narrator_presence_penalty: number;
	narrator_max_tokens: number;
	narrator_top_p: number;
	translation_language: import('$lib/translationLanguages').TranslationLanguage;
	providers: Record<string, { text_model?: string; image_model?: string }>;
	key_configured?: Record<string, boolean>;
	key_source?: Record<string, KeySource>;
}
