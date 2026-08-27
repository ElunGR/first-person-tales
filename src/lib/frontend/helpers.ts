/**
 * Dependency-free state helpers shared by UI components and tests.
 * Port of static/frontend_state.js.
 */

export function messageTargetPayload(
	messages: Array<{ id: string }>,
	index: number
): { message_id: string | null } {
	return { message_id: messages[index]?.id ?? null };
}

export function matchesSearch(
	message: { content?: string; translation_ru?: string | null },
	query: string
): boolean {
	if (!query) return true;
	return `${message.content || ''}\n${message.translation_ru || ''}`
		.toLocaleLowerCase()
		.includes(query.toLocaleLowerCase());
}

/**
 * Incremental history-search matcher.
 *
 * The query is normalized once, and each message's lower-cased haystack is
 * cached by object identity (WeakMap). Together with structural sharing in
 * the UI state — unchanged messages keep their object identity across state
 * reloads — typing in the search box no longer re-normalizes the whole
 * transcript on every keystroke.
 */
export class MessageSearchIndex {
	private haystacks = new WeakMap<object, string>();

	/** Lower-cased searchable text for a message (cached per object). */
	haystack(message: { content?: string; translation_ru?: string | null }): string {
		let value = this.haystacks.get(message);
		if (value === undefined) {
			value = `${message.content || ''}\n${message.translation_ru || ''}`.toLocaleLowerCase();
			this.haystacks.set(message, value);
		}
		return value;
	}

	/** Match against an already lower-cased query; empty query matches all. */
	matches(
		message: { content?: string; translation_ru?: string | null },
		lowerQuery: string
	): boolean {
		if (!lowerQuery) return true;
		return this.haystack(message).includes(lowerQuery);
	}
}
