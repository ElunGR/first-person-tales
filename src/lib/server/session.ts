/**
 * Single-game session with atomic autosave to data/session.json.
 * Port of backend/session.py.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
	type MediaKind,
	type MediaRecord,
	type Message,
	type SummaryCheckpoint
} from './models';
import { imagesDir, sessionPath } from './paths';
import {
	backupInvalidSave,
	cleanupInvalidSaveBackups,
	cleanupUnreferencedMediaFilesOnDisk,
	ensureSessionDirectories,
	recreateSessionDirectories,
	writeSessionFileAtomic
} from './sessionStorage';
import {
	SessionFormatError,
	validateCurrentSessionShape,
	validateSessionPayload
} from './sessionValidation';
import { utcNowIso } from './time';

export { cleanupInvalidSaveBackups, SessionFormatError };

let recoveryMessageValue: string | null = null;

/** Error mirroring Python's KeyError for missing message/media references. */
export class KeyError extends Error {
	constructor(key: string) {
		super(key);
		this.name = 'KeyError';
	}
}

/** Return a startup recovery warning until the owner explicitly resets. */
export function recoveryMessage(): string | null {
	return recoveryMessageValue;
}

export function clearRecoveryMessage(): void {
	recoveryMessageValue = null;
}

export interface TranscriptSnapshot {
	messages: Message[];
	media: MediaRecord[];
	narratorStart: number;
	summaryCheckpoints: SummaryCheckpoint[];
	lastNarratorPromptTokens: number | null;
}

/** In-memory game state. Mutating helpers call save() automatically. */
export class Session {
	messages: Message[];
	media: MediaRecord[];
	/** Index into messages where narrator context starts (after last summary). */
	narratorStart: number;
	summaryCheckpoints: SummaryCheckpoint[];
	/** Exact prompt_tokens from the latest successful narrator story request. */
	lastNarratorPromptTokens: number | null;

	constructor(init?: {
		messages?: Message[];
		media?: MediaRecord[];
		narratorStart?: number;
		summaryCheckpoints?: SummaryCheckpoint[];
		lastNarratorPromptTokens?: number | null;
	}) {
		this.messages = init?.messages ?? [];
		this.media = init?.media ?? [];
		this.narratorStart = init?.narratorStart ?? 0;
		this.summaryCheckpoints = init?.summaryCheckpoints ?? [];
		this.lastNarratorPromptTokens = init?.lastNarratorPromptTokens ?? null;
	}

	toDict(): Record<string, unknown> {
		return {
			messages: this.messages.map((m) => ({
				id: m.id,
				role: m.role,
				content: m.content,
				translation_ru: m.translation_ru,
				kind: m.kind
			})),
			media: this.media.map((item) => ({
				id: item.id,
				message_id: item.message_id,
				kind: item.kind,
				file: item.file,
				source_text: item.source_text,
				created_at: item.created_at
			})),
			narrator_start: this.narratorStart,
			summary_checkpoints: this.summaryCheckpoints.map((c) => ({
				id: c.id,
				created_at: c.created_at,
				previous_narrator_start: c.previous_narrator_start,
				branch_message_id: c.branch_message_id
			})),
			last_narrator_prompt_tokens: this.lastNarratorPromptTokens
		};
	}

	get canUndoSummary(): boolean {
		return this.summaryCheckpoints.length > 0;
	}

	/** Accept only the current session shape; no historical migrations. */
	static validateCurrent(data: unknown): Record<string, unknown> | null {
		return validateCurrentSessionShape(data);
	}

	messageIndexById(messageId: string | null | undefined): number | null {
		if (!messageId) return null;
		const index = this.messages.findIndex((message) => message.id === messageId);
		return index >= 0 ? index : null;
	}

	/** Drop stale checkpoints and derive narrator_start from the latest branch. */
	reconcileNarratorStart(): void {
		const kept: SummaryCheckpoint[] = [];
		for (const checkpoint of this.summaryCheckpoints) {
			if (checkpoint.previous_narrator_start < 0) continue;
			const branchIndex = this.messageIndexById(checkpoint.branch_message_id);
			if (branchIndex === null) continue;
			if (this.messages[branchIndex].kind !== 'branch') continue;
			if (checkpoint.previous_narrator_start > branchIndex) continue;
			kept.push(checkpoint);
		}
		this.summaryCheckpoints = kept;

		if (this.summaryCheckpoints.length === 0) {
			this.narratorStart = 0;
			return;
		}
		const lastIndex = this.messageIndexById(
			this.summaryCheckpoints[this.summaryCheckpoints.length - 1].branch_message_id
		);
		this.narratorStart = lastIndex ?? 0;
	}

	/** Copy transcript + summary cursor for rollback after failed LLM calls. */
	snapshotTranscript(): TranscriptSnapshot {
		return {
			messages: [...this.messages],
			media: [...this.media],
			narratorStart: this.narratorStart,
			summaryCheckpoints: [...this.summaryCheckpoints],
			lastNarratorPromptTokens: this.lastNarratorPromptTokens
		};
	}

	/** Restore a prior snapshotTranscript() result. Persist unless disk was never changed. */
	restoreTranscript(snapshot: TranscriptSnapshot, options: { persist?: boolean } = {}): void {
		this.messages = [...snapshot.messages];
		this.media = [...snapshot.media];
		this.narratorStart = snapshot.narratorStart;
		this.summaryCheckpoints = [...snapshot.summaryCheckpoints];
		this.lastNarratorPromptTokens = snapshot.lastNarratorPromptTokens;
		this.reconcileNarratorStart();
		if (options.persist !== false) {
			this.save();
		}
	}

	/** Atomically write session state to data/session.json. */
	save(): void {
		const target = sessionPath();
		ensureSessionDirectories();
		const payload = JSON.stringify(this.toDict(), null, 2);
		try {
			writeSessionFileAtomic(target, payload);
		} catch (err) {
			if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
				// A directory vanished externally; recreate once and retry.
				recreateSessionDirectories();
				writeSessionFileAtomic(target, payload);
				return;
			}
			throw err;
		}
	}

	/** Load session from disk, or null if missing/invalid/incompatible. */
	static load(filePath?: string): Session | null {
		const target = filePath ?? sessionPath();
		if (!fs.existsSync(target)) return null;
		let raw: unknown;
		try {
			const text = fs.readFileSync(target, 'utf-8');
			raw = JSON.parse(text);
		} catch (exc) {
			backupInvalidSave(target, 'corrupt', `${(exc as Error)?.name ?? 'Error'}: ${exc}`);
			return null;
		}
		try {
			return validateSessionIntegrity(raw);
		} catch (exc) {
			if (exc instanceof SessionFormatError) {
				backupInvalidSave(target, 'incompatible', exc.message);
			} else {
				backupInvalidSave(target, 'corrupt', `${(exc as Error)?.name ?? 'Error'}: ${exc}`);
			}
			return null;
		}
	}

	appendMessage(message: Message, options: { persist?: boolean } = {}): Message {
		this.messages.push(message);
		if (options.persist !== false) {
			this.save();
		}
		return message;
	}

	updateMessage(index: number, content: string): Message {
		if (index < 0 || index >= this.messages.length) {
			throw new RangeError(String(index));
		}
		const msg = this.messages[index];
		const updated: Message = { ...msg, content };
		if (content !== msg.content) {
			updated.translation_ru = null;
		}
		this.messages[index] = updated;
		this.save();
		return this.messages[index];
	}

	/** Delete the message at `index` and everything after it. */
	truncateFrom(index: number, cleanupFiles = true, options: { persist?: boolean } = {}): void {
		if (index < 0 || index >= this.messages.length) {
			throw new RangeError(String(index));
		}
		const removedIds = new Set(this.messages.slice(index).map((message) => message.id));
		const removedMedia = this.media.filter((item) => removedIds.has(item.message_id));
		this.messages = this.messages.slice(0, index);
		this.media = this.media.filter((item) => !removedIds.has(item.message_id));
		this.reconcileNarratorStart();
		if (options.persist !== false) {
			this.save();
		}
		if (cleanupFiles) {
			this.deleteMediaFiles(removedMedia);
		}
	}

	setTranslation(index: number, translation: string): Message {
		if (index < 0 || index >= this.messages.length) {
			throw new RangeError(String(index));
		}
		const msg = this.messages[index];
		this.messages[index] = { ...msg, translation_ru: translation };
		this.save();
		return this.messages[index];
	}

	deleteMediaFiles(records: MediaRecord[]): void {
		for (const record of records) {
			const filePath = path.join(imagesDir(), path.basename(record.file));
			try {
				fs.unlinkSync(filePath);
			} catch (exc) {
				if ((exc as NodeJS.ErrnoException)?.code !== 'ENOENT') {
					console.warn(`Could not remove media file ${filePath}: ${exc}`);
				}
			}
		}
	}

	addMedia(input: { messageId: string; kind: MediaKind; file: string; sourceText?: string }): MediaRecord {
		if (this.messageIndexById(input.messageId) === null) {
			throw new KeyError(input.messageId);
		}
		const record: MediaRecord = {
			id: crypto.randomUUID(),
			message_id: input.messageId,
			kind: input.kind,
			file: path.basename(input.file),
			source_text: input.sourceText ?? '',
			created_at: utcNowIso()
		};
		this.media.push(record);
		this.save();
		return record;
	}

	deleteMedia(mediaId: string): void {
		const existing = this.media.find((item) => item.id === mediaId);
		if (!existing) {
			throw new KeyError(mediaId);
		}
		this.media = this.media.filter((item) => item.id !== mediaId);
		this.save();
		this.deleteMediaFiles([existing]);
	}

	/** New game: wipe the story and all generated media. */
	reset(): void {
		this.messages = [];
		this.media = [];
		this.narratorStart = 0;
		this.summaryCheckpoints = [];
		this.lastNarratorPromptTokens = null;
		const directory = imagesDir();
		if (fs.existsSync(directory)) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
		fs.mkdirSync(directory, { recursive: true });
		this.save();
		cleanupInvalidSaveBackups();
	}

}

/** Parse and strictly validate one current-format session payload. */
export function validateSessionIntegrity(data: unknown): Session {
	return new Session(validateSessionPayload(data));
}
let currentSession: Session = new Session();

export function getSession(): Session {
	return currentSession;
}

export function setSession(newSession: Session): Session {
	currentSession = newSession;
	return currentSession;
}

/** Load data/session.json if present, else start empty (and ensure dirs). */
export function loadOrCreate(): Session {
	recoveryMessageValue = null;
	const hadSave = fs.existsSync(sessionPath());
	const loaded = Session.load();
	if (loaded !== null) {
		setSession(loaded);
		cleanupUnreferencedMediaFiles(loaded);
		cleanupInvalidSaveBackups();
		return loaded;
	}
	const fresh = new Session();
	ensureSessionDirectories();
	if (hadSave) {
		// Keep the invalid original untouched. A mutation must never silently
		// turn a recoverable save into a fresh game.
		recoveryMessageValue =
			'Could not open the saved game. The original file was saved in ' +
			'data/backups/; choose “New game” only if you are ready to start over.';
	} else {
		fresh.save();
	}
	cleanupInvalidSaveBackups();
	setSession(fresh);
	return fresh;
}

/** Remove generated images that are not referenced by the current session. */
export function cleanupUnreferencedMediaFiles(current?: Session): string[] {
	const sessionState = current ?? getSession();
	return cleanupUnreferencedMediaFilesOnDisk(sessionState.media.map((item) => item.file));
}
