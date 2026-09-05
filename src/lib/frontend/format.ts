/** Chat text formatting. Port of escapeHtml/formatChatHtml from app.js. */

export function escapeHtml(raw: string): string {
	// Both quote styles are encoded so the result stays inert even if a caller
	// ever interpolates it into a single- or double-quoted HTML attribute.
	return String(raw)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// Each string token is one UTF-16 code unit; generated HTML is a separate object.
// Match offsets therefore identify tokens without interpreting user text as IDs.
type ChatToken = string | { html: string };

function renderTokens(tokens: ChatToken[]): string {
	return tokens.map((token) => typeof token === 'string' ? escapeHtml(token) : token.html).join('');
}

export function formatChatHtml(raw: string): string {
	let tokens: ChatToken[] = raw.split('');
	const rules: Array<[RegExp, number, string, string]> = [
		[/\*\*([^*]+?)\*\*/g, 2, '<strong>', '</strong>'],
		[/\*([^*\n]+?)\*/g, 1, '<em>', '</em>'],
		[/\[([^\]]+)\](?!\()/g, 1, '<span class="msg-note">[', ']</span>']
	];
	// Preserve the original precedence in exactly three passes. Earlier markup
	// is opaque to later matches, but can be wrapped (e.g. bold inside an OOC note).
	for (const [pattern, delimiterLength, open, close] of rules) {
		const source = tokens.map((token) => typeof token === 'string' ? token : '\0').join('');
		const next: ChatToken[] = [];
		let cursor = 0;
		for (const match of source.matchAll(pattern)) {
			const start = match.index!;
			const end = start + match[0].length;
			while (cursor < start) next.push(tokens[cursor++]);
			// The scan's null character only occupies a position. Rendering reads
			// the actual token, so even literal null/private-use text stays literal.
			next.push({ html: open + renderTokens(tokens.slice(start + delimiterLength, end - delimiterLength)) + close });
			cursor = end;
		}
		while (cursor < tokens.length) next.push(tokens[cursor++]);
		tokens = next;
	}
	return renderTokens(tokens);
}
