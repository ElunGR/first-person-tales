/** Filesystem-only helpers for session persistence and recovery. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backupsDir, dataDir, imagesDir } from './paths';
import { utcStamp } from './time';
import { pendingMediaFiles } from './mediaIo';

const BACKUP_KEEP = 5;
const BACKUP_RE = /^session\..*\.json$/;
const BACKUP_TIMESTAMP_RE = /(\d{8}T\d{6})(\d*)Z/i;

let ensuredDataRoot: string | null = null;

/** Memoized data-dir creation so autosave skips repeated mkdir syscalls. */
export function ensureSessionDirectories(): void {
	const root = dataDir();
	if (ensuredDataRoot === root) return;
	fs.mkdirSync(root, { recursive: true });
	for (const directory of [imagesDir(), backupsDir()]) {
		fs.mkdirSync(directory, { recursive: true });
	}
	ensuredDataRoot = root;
}

/** Write a UTF-8 payload through a same-directory temporary file. */
export function writeSessionFileAtomic(target: string, payload: string): void {
	const tmpName = path.join(path.dirname(target), `session.${crypto.randomBytes(8).toString('hex')}.tmp`);
	try {
		const fd = fs.openSync(tmpName, 'w');
		try {
			fs.writeSync(fd, payload, undefined, 'utf-8');
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(tmpName, target);
	} catch (err) {
		try {
			fs.unlinkSync(tmpName);
		} catch {
			// Already renamed or never created.
		}
		throw err;
	}
}

/** Recreate the memoized directories after an external deletion. */
export function recreateSessionDirectories(): void {
	ensuredDataRoot = null;
	ensureSessionDirectories();
}

function backupSortKey(filePath: string): string {
	const match = BACKUP_TIMESTAMP_RE.exec(path.basename(filePath));
	if (match) {
		const fraction = (match[2] + '000000000').slice(0, 9);
		return `${match[1]}${fraction}Z|${path.basename(filePath)}`;
	}
	try {
		const iso = fs.statSync(filePath).mtime.toISOString();
		const head = iso.slice(0, 19).replace(/[-:]/g, '');
		const fraction = (iso.slice(20, 23) + '000').slice(0, 6);
		return `${head}${fraction}000Z|${path.basename(filePath)}`;
	} catch {
		return `|${path.basename(filePath)}`;
	}
}

function iterSessionBackups(): string[] {
	const root = backupsDir();
	if (!fs.existsSync(root)) return [];
	const found = fs.readdirSync(root).filter((name) => {
		if (!BACKUP_RE.test(name)) return false;
		try {
			return fs.statSync(path.join(root, name)).isFile();
		} catch {
			return false;
		}
	});
	found.sort((a, b) => backupSortKey(path.join(root, b)).localeCompare(backupSortKey(path.join(root, a))));
	return found.map((name) => path.join(root, name));
}

/** Remove old recovery backups while retaining the newest ones. */
export function cleanupInvalidSaveBackups(keep: number = BACKUP_KEEP): string[] {
	const removed: string[] = [];
	for (const backupPath of iterSessionBackups().slice(Math.max(keep, 0))) {
		try {
			fs.unlinkSync(backupPath);
			removed.push(path.basename(backupPath));
		} catch (exc) {
			console.warn(`Could not remove old session backup ${backupPath}: ${exc}`);
		}
	}
	return removed;
}

/** Preserve a corrupt or incompatible save without changing the original. */
export function backupInvalidSave(
	target: string,
	kind: 'corrupt' | 'incompatible',
	reason: string
): string | null {
	const stamp = utcStamp();
	const directory = backupsDir();
	let backup: string;
	try {
		fs.mkdirSync(directory, { recursive: true });
		backup = path.join(directory, `session.${kind}-${stamp}.json`);
		fs.copyFileSync(target, backup);
	} catch (exc) {
		console.warn(`Could not backup invalid save ${target}: ${exc}`);
		return null;
	}
	console.warn(`Invalid save backed up to ${backup} (${reason})`);
	return backup;
}

/** Remove generated images not named by the supplied active records. */
export function cleanupUnreferencedMediaFilesOnDisk(referencedFiles: Iterable<string>): string[] {
	const referenced = new Set([...referencedFiles, ...pendingMediaFiles].map((file) => path.basename(file)));
	const removed: string[] = [];
	const directory = imagesDir();
	if (!fs.existsSync(directory)) return removed;
	for (const name of fs.readdirSync(directory)) {
		const filePath = path.join(directory, name);
		try {
			if (!fs.statSync(filePath).isFile() || referenced.has(name)) continue;
			fs.unlinkSync(filePath);
			removed.push(name);
		} catch {
			// Best-effort startup cleanup.
		}
	}
	return removed;
}
