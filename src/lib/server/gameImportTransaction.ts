/** Undo journal for a synchronous two-file import. No game data is logged. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { HttpError } from './http';
import { dataDir, localPromptsPath, sessionPath } from './paths';

const SnapshotSchema = z.strictObject({
	path: z.string(),
	bytes: z.string().nullable(),
	sha256: z.string().nullable()
});
const JournalSchema = z.strictObject({
	version: z.literal(1),
	session: SnapshotSchema,
	local_prompts: SnapshotSchema
});
type Snapshot = z.infer<typeof SnapshotSchema>;

export function importJournalPath(): string {
	return path.join(dataDir(), 'game-import.pending.json');
}

export function hasPendingGameImport(): boolean {
	try {
		fs.lstatSync(importJournalPath());
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw new HttpError(503, 'Could not check game import recovery state. Resolve the file access problem and restart the app.');
	}
}

/** Also guards requests that queued before a failed rollback left a journal. */
export function assertNoPendingGameImport(): void {
	if (hasPendingGameImport()) {
		throw new HttpError(503, 'An interrupted game import needs recovery. Restart the app; no game data will be changed until recovery succeeds.');
	}
}

/** Same-directory temp, fsync, then rename; preserves exact UTF-8 bytes on restore. */
export function writeImportFileAtomic(target: string, bytes: Buffer): void {
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const temporary = path.join(path.dirname(target), `.game-import-${crypto.randomUUID()}.tmp`);
	try {
		const fd = fs.openSync(temporary, 'wx', 0o600);
		try {
			fs.writeFileSync(fd, bytes);
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(temporary, target);
	} catch (error) {
		try { fs.unlinkSync(temporary); } catch { /* Never remove a durable target. */ }
		throw error;
	}
}

function snapshot(target: string): Snapshot {
	let bytes: Buffer | null;
	try {
		bytes = fs.readFileSync(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		bytes = null;
	}
	return {
		path: path.resolve(target),
		bytes: bytes?.toString('base64') ?? null,
		sha256: bytes === null ? null : crypto.createHash('sha256').update(bytes).digest('hex')
	};
}

function validatedBytes(snapshot: Snapshot, target: string): Buffer | null {
	// A local journal cannot redirect recovery outside the configured game files.
	if (snapshot.path !== path.resolve(target)) throw new Error('Import recovery paths do not match this app');
	if (snapshot.bytes === null) {
		if (snapshot.sha256 !== null) throw new Error('Invalid import recovery snapshot');
		return null;
	}
	const bytes = Buffer.from(snapshot.bytes, 'base64');
	if (bytes.toString('base64') !== snapshot.bytes ||
		crypto.createHash('sha256').update(bytes).digest('hex') !== snapshot.sha256) {
		throw new Error('Invalid import recovery snapshot');
	}
	return bytes;
}

function restore(target: string, bytes: Buffer | null): void {
	if (bytes === null) {
		try { fs.unlinkSync(target); } catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
		return;
	}
	try {
		if (fs.readFileSync(target).equals(bytes)) return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	writeImportFileAtomic(target, bytes);
}

/** Must run before session bootstrap, prompt reads, or orphan-image cleanup. */
export function recoverPendingGameImport(): boolean {
	if (!hasPendingGameImport()) return false;
	try {
		const journal = JournalSchema.parse(JSON.parse(fs.readFileSync(importJournalPath(), 'utf-8')));
		// Validate BOTH snapshots before touching either target.
		const session = validatedBytes(journal.session, sessionPath());
		const local = validatedBytes(journal.local_prompts, localPromptsPath());
		restore(sessionPath(), session);
		restore(localPromptsPath(), local);
		fs.unlinkSync(importJournalPath());
		return true;
	} catch {
		// Keep the journal and both targets for retry; never bootstrap a mixed game.
		throw new HttpError(503, 'Could not recover an interrupted game import. The recovery journal was kept; resolve the file access problem and restart the app.');
	}
}

/** Caller holds sessionLock. Absence of the journal is the durable commit marker. */
export function commitGameImport(saveSession: () => void, localDescriptions?: string): void {
	assertNoPendingGameImport();
	try {
		const journal = {
			version: 1,
			session: snapshot(sessionPath()),
			local_prompts: snapshot(localPromptsPath())
		};
		writeImportFileAtomic(importJournalPath(), Buffer.from(JSON.stringify(journal), 'utf-8'));
	} catch {
		throw new HttpError(500, 'Could not prepare a safe game import. Nothing was imported.');
	}
	try {
		saveSession();
		if (localDescriptions !== undefined) {
			writeImportFileAtomic(localPromptsPath(), Buffer.from(localDescriptions, 'utf-8'));
		}
		fs.unlinkSync(importJournalPath());
	} catch {
		recoverPendingGameImport();
		throw new HttpError(500, 'Could not import the game. The previous history, character, and world were restored.');
	}
}
