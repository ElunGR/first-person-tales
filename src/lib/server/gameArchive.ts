/** Portable text-only game save. Credentials, provider settings and images stay local. */
import { GameExportSchema, type GameExport } from './models';
import { MAX_IMPORT_BODY_BYTES } from './config';
import { HttpError } from './http';
import { getPlayerCharacterDescription, getWorldDescription } from './prompts';
import type { Session } from './session';

/** Caller holds sessionLock so descriptions and transcript come from one game. */
export function createGameExport(
	session: Session,
	options: { requireImportable?: boolean } = {}
): GameExport {
	const payload = GameExportSchema.parse({
		version: 2,
		messages: session.messages.map((message) => ({ ...message })),
		narrator_start: session.narratorStart,
		summary_checkpoints: session.summaryCheckpoints.map((checkpoint) => ({ ...checkpoint })),
		last_narrator_prompt_tokens: session.lastNarratorPromptTokens,
		player_character_description: getPlayerCharacterDescription(),
		world_description: getWorldDescription()
	});
	// Include the confirmation wrapper the UI sends so every exported save is importable.
	if (options.requireImportable !== false &&
		Buffer.byteLength(JSON.stringify({ confirm: true, data: payload }), 'utf-8') > MAX_IMPORT_BODY_BYTES) {
		throw new HttpError(413, 'The game save exceeds the 4 MiB import limit. Nothing was changed.');
	}
	return payload;
}

/** Markdown is readable documentation, not an import format. */
export function gameExportMarkdown(payload: GameExport): string {
	const lines = [
		'# First Person Tales game', '', '<!-- export-version: 2 -->', '',
		'JSON exports can be imported to restore a game. This Markdown file is for reading only; images are not included.', '',
		'## Player character', '', payload.player_character_description, '',
		'## World', '', payload.world_description || '*No world description.*', '',
		'## History', ''
	];
	for (const message of payload.messages) {
		const role = message.kind === 'branch' ? 'Summary' : message.role === 'user' ? 'You' : 'Narrator';
		lines.push(`### ${role}`, '', message.content, '');
		if (message.translation_ru) lines.push(`> Translation: ${message.translation_ru}`, '');
	}
	return lines.join('\n');
}
