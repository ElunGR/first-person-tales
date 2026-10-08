import crypto from 'node:crypto';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import { apiHandler, stateResponse } from '$lib/server/api';
import { MAX_IMPORT_BODY_BYTES } from '$lib/server/config';
import { createGameExport } from '$lib/server/gameArchive';
import { assertNoPendingGameImport, commitGameImport, writeImportFileAtomic } from '$lib/server/gameImportTransaction';
import { HttpError } from '$lib/server/http';
import { sessionLock } from '$lib/server/lock';
import { GameExportSchema } from '$lib/server/models';
import { backupsDir } from '$lib/server/paths';
import { clearPromptCache, serializeGameDescriptions } from '$lib/server/prompts';
import { cleanupUnreferencedMediaFiles, getSession, Session, setSession, validateSessionIntegrity } from '$lib/server/session';
import { utcStamp } from '$lib/server/time';

/** Validate first; back up and restore history plus descriptions as one operation. */
export const POST = apiHandler(async ({ request }) => {
	const contentLength = request.headers.get('content-length');
	const declaredSize = contentLength ? Number(contentLength) : 0;
	if (!Number.isFinite(declaredSize) || declaredSize < 0 || declaredSize > MAX_IMPORT_BODY_BYTES) {
		throw new HttpError(413, 'import payload is too large');
	}
	let body: unknown;
	try {
		const rawText = await request.text();
		if (Buffer.byteLength(rawText, 'utf-8') > MAX_IMPORT_BODY_BYTES) {
			throw new HttpError(413, 'import payload is too large');
		}
		body = JSON.parse(rawText);
	} catch (error) {
		if (error instanceof HttpError) throw error;
		throw new HttpError(422, 'There was an error parsing the body');
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new HttpError(422, 'There was an error parsing the body');
	}
	const bodyObj = body as Record<string, unknown>;
	if (bodyObj.confirm !== true) throw new HttpError(400, 'explicit import confirmation is required');
	const raw = bodyObj.data ?? Object.fromEntries(Object.entries(bodyObj).filter(([key]) => key !== 'confirm'));
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw) ||
		(raw as Record<string, unknown>).version !== 2) {
		throw new HttpError(400, 'unsupported game save version: only version 2 JSON saves can be imported');
	}
	let candidate: Session;
	let descriptions: string;
	try {
		const exported = GameExportSchema.parse(raw);
		candidate = validateSessionIntegrity({
			messages: exported.messages,
			media: [],
			narrator_start: exported.narrator_start,
			summary_checkpoints: exported.summary_checkpoints,
			last_narrator_prompt_tokens: exported.last_narrator_prompt_tokens
		});
		descriptions = serializeGameDescriptions(exported.player_character_description, exported.world_description);
	} catch {
		throw new HttpError(400, 'invalid game export: check its fields, descriptions, message IDs, and summary references');
	}
	const state = await sessionLock.runExclusive(() => {
		assertNoPendingGameImport();
		// A portable backup can itself be imported to switch back, including both descriptions.
		try {
			const backup = createGameExport(getSession());
			const target = path.join(backupsDir(), `game.pre-import-${utcStamp()}-${crypto.randomUUID()}.json`);
			writeImportFileAtomic(target, Buffer.from(JSON.stringify(backup, null, 2), 'utf-8'));
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(500, 'Could not back up the current game. Nothing was imported.');
		}
		try {
			commitGameImport(() => candidate.save(), descriptions);
		} finally {
			// Also clear cached descriptions after a successful rollback.
			clearPromptCache();
		}
		setSession(candidate);
		try {
			cleanupUnreferencedMediaFiles(candidate);
		} catch {
			// Import is committed. Cleanup must not turn success into an apparent failure.
			console.warn('Game imported; old image cleanup will resume on the next app start.');
		}
		return stateResponse();
	});
	return json(state);
});
