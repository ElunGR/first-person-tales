/** Chat text formatting. Port of escapeHtml/formatChatHtml from app.js. */

export function escapeHtml(raw: string): string {
	return String(raw)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function formatChatHtml(raw: string): string {
	let s = escapeHtml(raw);
	const chunks: string[] = [];
	function mark(html: string): string {
		const id = chunks.length;
		chunks.push(html);
		return `\uE000${id}\uE001`;
	}
	s = s.replace(/\*\*([^*]+?)\*\*/g, (_, inner: string) => mark(`<strong>${inner}</strong>`));
	s = s.replace(/\*([^*\n]+?)\*/g, (_, inner: string) => mark(`<em>${inner}</em>`));
	s = s.replace(/\[([^\]]+)\](?!\()/g, (_, inner: string) => mark(`<span class="msg-note">[${inner}]</span>`));
	let prev: string;
	do {
		prev = s;
		s = s.replace(/\uE000(\d+)\uE001/g, (_, id: string) => chunks[Number(id)]);
	} while (s !== prev);
	return s;
}
