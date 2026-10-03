/** One limit and normalization contract for editors, APIs and portable game saves. */
export const MAX_DESCRIPTION_CHARS = 10000;

/** Reserve Markdown H1 for application-owned system sections. */
export function normalizeUserDescription(content: string): string {
	return content.trim().replace(/^([ \t]{0,3})#(?=[ \t]|$)/gm, '$1##');
}
