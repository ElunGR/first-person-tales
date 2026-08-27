import fs from 'node:fs';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import { stateResponse } from '$lib/server/api';
import { apiHandler } from '$lib/server/api';
import { MAX_IMPORT_BODY_BYTES } from '$lib/server/config';
import { HttpError } from '$lib/server/http';
import { sessionLock } from '$lib/server/lock';
import { HistoryExportSchema } from '$lib/server/models';
import { backupsDir, sessionPath } from '$lib/server/paths';
import {
	cleanupUnreferencedMediaFiles,
	Session,
	setSession,
	validateSessionIntegrity
} from '$lib/server/session';
import { utcStamp } from '$lib/server/time';

/** Validate and atomically import a versioned history after explicit confirmation. */
export const POST = apiHandler(async ({ request }) => {
	const contentLength = request.headers.get('content-length');
	let declaredSize: number;
	if (contentLength) {
		declaredSize = parseInt(contentLength, 10);
		if (Number.isNaN(declaredSize)) declaredSize = MAX_IMPORT_BODY_BYTES + 1;
	} else {
		declaredSize = 0;
	}
	if (declaredSize > MAX_IMPORT_BODY_BYTES) {
		throw new HttpError(413, 'import payload is too large');
	}
	let body: unknown;
	try {
		const rawText = await request.text();
		if (Buffer.byteLength(rawText, 'utf-8') > MAX_IMPORT_BODY_BYTES) {
			throw new HttpError(413, 'import payload is too large');
		}
		body = JSON.parse(rawText);
	} catch (exc) {
		if (exc instanceof HttpError) throw exc;
		throw new HttpError(422, 'There was an error parsing the body');
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new HttpError(422, 'There was an error parsing the body');
	}
	const bodyObj = body as Record<string, unknown>;
	if (bodyObj['confirm'] !== true) {
		throw new HttpError(400, 'explicit import confirmation is required');
	}
	let raw: unknown = bodyObj['data'];
	if (raw === null || raw === undefined) {
		raw = Object.fromEntries(Object.entries(bodyObj).filter(([key]) => key !== 'confirm'));
	}
	if (
		typeof raw !== 'object' ||
		raw === null ||
		Array.isArray(raw) ||
		(raw as Record<string, unknown>)['version'] !== 1 ||
		typeof (raw as Record<string, unknown>)['version'] === 'boolean'
	) {
		throw new HttpError(400, 'unsupported history export version');
	}
	const rawObj = raw as Record<string, unknown>;
	let candidate: Session;
	try {
		const keys = Object.keys(rawObj);
		const expected = [
			'version',
			'messages',
			'narrator_start',
			'summary_checkpoints',
			'last_narrator_prompt_tokens'
		];
		if (keys.length !== expected.length || !keys.every((key) => expected.includes(key))) {
			throw new Error('invalid top-level fields');
		}
		const exported = HistoryExportSchema.parse(rawObj);
		candidate = validateSessionIntegrity({
			messages: exported.messages,
			media: [],
			narrator_start: exported.narrator_start,
			summary_checkpoints: exported.summary_checkpoints,
			last_narrator_prompt_tokens: exported.last_narrator_prompt_tokens
		});
	} catch (exc) {
		throw new HttpError(400, `invalid history export: ${(exc as Error)?.message ?? exc}`);
	}
	const state = await sessionLock.runExclusive(() => {
		const source = sessionPath();
		let backup: string | null = null;
		if (fs.existsSync(source)) {
			const backupRoot = backupsDir();
			fs.mkdirSync(backupRoot, { recursive: true });
			backup = path.join(backupRoot, `session.pre-import-${utcStamp()}.json`);
			fs.copyFileSync(source, backup);
		}
		try {
			candidate.save();
		} catch {
			if (backup !== null) {
				try {
					fs.copyFileSync(backup, source);
					fs.unlinkSync(backup);
				} catch {
					// Best-effort restore.
				}
			}
			throw new HttpError(500, 'could not save imported history');
		}
		setSession(candidate);
		cleanupUnreferencedMediaFiles(candidate);
		return stateResponse();
	});
	return json(state);
});
