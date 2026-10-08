/** Limits for the two editable descriptions.
 * Player text is stored verbatim: the limit counts exactly the characters the player
 * typed, and nothing is rewritten on save, read, import or export.
 * The character limit keeps the v1.2.0 value so existing saves stay importable;
 * the world limit is deliberately larger because a setting description is not
 * sent as a per-message instruction.
 */
export const MAX_CHARACTER_DESCRIPTION_CHARS = 10000;
export const MAX_WORLD_DESCRIPTION_CHARS = 30000;

export interface DescriptionUsage {
	/** Characters currently in the field, counted verbatim. */
	count: number;
	limit: number;
	over: boolean;
}

/** Single source for the editor counter and the save-time limit check. */
export function descriptionUsage(content: string, limit: number): DescriptionUsage {
	const count = content.length;
	return { count, limit, over: count > limit };
}
