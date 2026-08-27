import { json } from '@sveltejs/kit';
import { sessionLock } from '$lib/server/lock';
import { getSession } from '$lib/server/session';

/** Export canon and summary state; media files are intentionally excluded. */
export async function GET({ url }) {
	const format = url.searchParams.get('format') ?? 'json';
	const payload = await sessionLock.runExclusive(() => {
		const session = getSession();
		return {
			version: 1 as const,
			messages: session.messages.map((m) => ({
				id: m.id,
				role: m.role,
				content: m.content,
				translation_ru: m.translation_ru,
				kind: m.kind
			})),
			narrator_start: session.narratorStart,
			summary_checkpoints: session.summaryCheckpoints.map((c) => ({
				id: c.id,
				created_at: c.created_at,
				previous_narrator_start: c.previous_narrator_start,
				branch_message_id: c.branch_message_id
			})),
			last_narrator_prompt_tokens: session.lastNarratorPromptTokens
		};
	});
	if (['md', 'markdown'].includes(format.toLowerCase())) {
		const lines: string[] = ['# First Person Tales history', '', '<!-- export-version: 1 -->', ''];
		for (const message of payload.messages) {
			const role =
				message.kind === 'branch' ? 'Summary' : message.role === 'user' ? 'You' : 'Narrator';
			lines.push(`## ${role}`, '', String(message.content), '');
			if (message.translation_ru) {
				lines.push(`> Translation: ${message.translation_ru}`, '');
			}
		}
		return new Response(lines.join('\n'), {
			headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
		});
	}
	return json(payload, {
		headers: { 'Content-Disposition': 'attachment; filename=history.json' }
	});
}
