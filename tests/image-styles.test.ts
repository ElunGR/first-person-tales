import { describe, expect, it } from 'vitest';
import {
	DEFAULT_IMAGE_STYLE,
	IMAGE_STYLES,
	IMAGE_STYLE_LABELS,
	imagePromptWithStyle,
	isImageStyle
} from '../src/lib/imageStyles';
import { SettingsUpdateRequestSchema } from '../src/lib/server/models';

describe('image styles', () => {
	it('keeps the original prompt unchanged with the default style', () => {
		expect(DEFAULT_IMAGE_STYLE).toBe('none');
		expect(imagePromptWithStyle('Medium shot of a traveler.', DEFAULT_IMAGE_STYLE))
			.toBe('Medium shot of a traveler.');
	});

	it.each(IMAGE_STYLES.filter((style) => style !== 'none'))('appends %s as plain prompt text', (style) => {
		expect(imagePromptWithStyle('A stone bridge.', style)).toBe(`A stone bridge.\n\nStyle: ${style}`);
		expect(IMAGE_STYLE_LABELS[style]).toBeTruthy();
		expect(isImageStyle(style)).toBe(true);
		expect(SettingsUpdateRequestSchema.parse({ providers: {}, image_style: style }).image_style).toBe(style);
	});

	it.each(['unknown', '', null, 42])('rejects unsupported API style %s', (style) => {
		expect(isImageStyle(style)).toBe(false);
		expect(SettingsUpdateRequestSchema.safeParse({ providers: {}, image_style: style }).success).toBe(false);
	});

	it('leaves omitted style undefined so older settings clients preserve the saved selection', () => {
		expect(SettingsUpdateRequestSchema.parse({ providers: {} }).image_style).toBeUndefined();
	});
});
