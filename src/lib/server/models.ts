/**
 * Zod schemas mirroring the pydantic models of the original backend
 * (backend/models.py). Strict objects reject unknown keys exactly like
 * pydantic's extra="forbid".
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import {
	MAX_TEXT_INPUT_CHARS,
	NARRATOR_FREQUENCY_PENALTY,
	NARRATOR_MAX_COMPLETION_TOKENS,
	NARRATOR_PRESENCE_PENALTY,
	NARRATOR_TEMPERATURE,
	NARRATOR_TOP_P
} from './config';
import { DEFAULT_TRANSLATION_LANGUAGE, TRANSLATION_LANGUAGES } from '$lib/translationLanguages';
import { IMAGE_STYLES } from '$lib/imageStyles';
import { MAX_DESCRIPTION_CHARS, normalizeUserDescription } from '$lib/descriptions';

export const MEDIA_KINDS = ['image'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

const newId = () => crypto.randomUUID();

export const MessageSchema = z.strictObject({
	id: z.string().default(newId),
	role: z.enum(['user', 'assistant']),
	content: z.string().max(MAX_TEXT_INPUT_CHARS),
	translation_ru: z.string().nullable().default(null),
	kind: z.literal('branch').nullable().default(null)
});
export type Message = z.infer<typeof MessageSchema>;

export function newMessage(input: {
	role: 'user' | 'assistant';
	content: string;
	translation_ru?: string | null;
	kind?: 'branch' | null;
}): Message {
	return {
		id: newId(),
		role: input.role,
		content: input.content,
		translation_ru: input.translation_ru ?? null,
		kind: input.kind ?? null
	};
}

export const SummaryCheckpointSchema = z.strictObject({
	id: z.string().default(newId),
	created_at: z.string().default(''),
	previous_narrator_start: z.number().int().default(0),
	branch_message_id: z.string()
});
export type SummaryCheckpoint = z.infer<typeof SummaryCheckpointSchema>;

export function newCheckpoint(input: {
	previous_narrator_start: number;
	branch_message_id: string;
}): SummaryCheckpoint {
	return {
		id: newId(),
		created_at: '',
		previous_narrator_start: input.previous_narrator_start,
		branch_message_id: input.branch_message_id
	};
}

export const MediaRecordSchema = z.strictObject({
	id: z.string().default(newId),
	message_id: z.string(),
	kind: z.enum(MEDIA_KINDS),
	file: z.string(),
	source_text: z.string().default(''),
	created_at: z.string().default('')
});
export type MediaRecord = z.infer<typeof MediaRecordSchema>;

export const ChatRequestSchema = z.strictObject({
	content: z.string().max(MAX_TEXT_INPUT_CHARS)
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const TextRequestSchema = z.strictObject({
	text: z.string().max(MAX_TEXT_INPUT_CHARS)
});
export type TextRequest = z.infer<typeof TextRequestSchema>;

export const MessageUpdateSchema = z.strictObject({
	content: z.string().max(MAX_TEXT_INPUT_CHARS),
	message_id: z.string().nullable().optional()
});
export type MessageUpdate = z.infer<typeof MessageUpdateSchema>;

/** Optional stable target used with legacy index routes. */
export const MessageTargetSchema = z.strictObject({
	message_id: z.string().nullable().optional()
});
export type MessageTarget = z.infer<typeof MessageTargetSchema>;

export const TranslationUpdateSchema = z.strictObject({
	translation: z.string(),
	message_id: z.string().nullable().optional()
});
export type TranslationUpdate = z.infer<typeof TranslationUpdateSchema>;

export const MediaPrepareRequestSchema = z.strictObject({
	kind: z.enum(MEDIA_KINDS),
	instruction: z.string().max(1000).default(''),
	message_id: z.string().nullable().optional()
});
export type MediaPrepareRequest = z.infer<typeof MediaPrepareRequestSchema>;

export const MediaGenerateRequestSchema = z.strictObject({
	kind: z.enum(MEDIA_KINDS),
	text: z.string().max(10000),
	image_style: z.enum(IMAGE_STYLES).optional(),
	message_id: z.string().nullable().optional()
});
export type MediaGenerateRequest = z.infer<typeof MediaGenerateRequestSchema>;

export const ProviderModelsSchema = z.strictObject({
	text_model: z.string().optional(),
	image_model: z.string().optional()
});

export const SettingsUpdateRequestSchema = z.strictObject({
	active_provider: z.literal('venice').default('venice'),
	narrator_temperature: z.number().min(0).max(2).default(NARRATOR_TEMPERATURE),
	narrator_frequency_penalty: z.number().min(-2).max(2).default(NARRATOR_FREQUENCY_PENALTY),
	narrator_presence_penalty: z.number().min(-2).max(2).default(NARRATOR_PRESENCE_PENALTY),
	narrator_max_tokens: z.number().int().min(16).max(8192).default(NARRATOR_MAX_COMPLETION_TOKENS),
	narrator_top_p: z.number().min(0.01).max(1).default(NARRATOR_TOP_P),
	translation_language: z.enum(TRANSLATION_LANGUAGES).default(DEFAULT_TRANSLATION_LANGUAGE),
	image_style: z.enum(IMAGE_STYLES).optional(),
	providers: z.strictObject({ venice: ProviderModelsSchema.optional() }),
	api_key: z.string().nullable().optional(),
	clear_api_key: z.boolean().default(false)
});
export type SettingsUpdateRequest = z.infer<typeof SettingsUpdateRequestSchema>;

/** Validate normalized size too: demoting headings may add characters. */
export const WorldDescriptionSchema = z.string().max(MAX_DESCRIPTION_CHARS)
	.transform(normalizeUserDescription).pipe(z.string().max(MAX_DESCRIPTION_CHARS));
export const CharacterDescriptionSchema = WorldDescriptionSchema.refine(
	(value) => value.length > 0, 'Character must not be empty'
);

/** v1 restores history only; v2 also restores the editable character and world. */
export const HistoryExportV1Schema = z.strictObject({
	version: z.literal(1),
	messages: z.array(MessageSchema.extend({ id: z.string().min(1) })),
	narrator_start: z.number().int(),
	summary_checkpoints: z.array(SummaryCheckpointSchema.extend({ id: z.string().min(1) })),
	last_narrator_prompt_tokens: z.number().int().nullable()
});
export const GameExportSchema = HistoryExportV1Schema.extend({
	version: z.literal(2),
	player_character_description: CharacterDescriptionSchema,
	world_description: WorldDescriptionSchema
});
export const HistoryExportSchema = z.discriminatedUnion('version', [HistoryExportV1Schema, GameExportSchema]);
export type HistoryExport = z.infer<typeof HistoryExportSchema>;
export type GameExport = z.infer<typeof GameExportSchema>;

export interface StateResponse {
	messages: Message[];
	media: MediaRecord[];
	can_undo_summary: boolean;
	last_narrator_prompt_tokens: number | null;
	recovery_message: string | null;
}
