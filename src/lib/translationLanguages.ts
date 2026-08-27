export const TRANSLATION_LANGUAGES = [
	'Russian',
	'Spanish',
	'French',
	'German',
	'Italian',
	'Portuguese',
	'Polish',
	'Ukrainian',
	'Turkish',
	'Japanese',
	'Korean',
	'Simplified Chinese'
] as const;

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

export const DEFAULT_TRANSLATION_LANGUAGE: TranslationLanguage = 'Russian';

export function isTranslationLanguage(value: unknown): value is TranslationLanguage {
	return typeof value === 'string' && TRANSLATION_LANGUAGES.includes(value as TranslationLanguage);
}
