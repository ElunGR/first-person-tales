/** Shared image-style choices; styles are plain prompt text, not provider presets. */
export const IMAGE_STYLES = [
	'none',
	'anime',
	'photorealistic',
	'cinematic',
	'digital art',
	'fantasy illustration',
	'oil painting',
	'watercolor',
	'comic book',
	'manga',
	'3D render',
	'pixel art',
	'pencil sketch'
] as const;

export type ImageStyle = (typeof IMAGE_STYLES)[number];

export const DEFAULT_IMAGE_STYLE: ImageStyle = 'none';

export const IMAGE_STYLE_LABELS: Record<ImageStyle, string> = {
	none: 'None (prompt only)',
	anime: 'Anime',
	photorealistic: 'Photorealistic',
	cinematic: 'Cinematic',
	'digital art': 'Digital art',
	'fantasy illustration': 'Fantasy illustration',
	'oil painting': 'Oil painting',
	watercolor: 'Watercolor',
	'comic book': 'Comic book',
	manga: 'Manga',
	'3D render': '3D render',
	'pixel art': 'Pixel art',
	'pencil sketch': 'Pencil sketch'
};

export function isImageStyle(value: unknown): value is ImageStyle {
	return typeof value === 'string' && IMAGE_STYLES.includes(value as ImageStyle);
}

/** Append once at the generation boundary; leave the editable scene prompt intact. */
export function imagePromptWithStyle(prompt: string, style: ImageStyle): string {
	return style === 'none' ? prompt : `${prompt}\n\nStyle: ${style}`;
}
