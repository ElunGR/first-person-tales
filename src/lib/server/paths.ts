/** Filesystem layout shared by session, settings and media modules. */
import path from 'node:path';
import { DATA_DIR, rootDir } from './config';

let dataDirSetting: string = DATA_DIR;

/** Override the data directory (tests). Absolute or root-relative. */
export function setDataDir(dir: string): void {
	dataDirSetting = dir;
}

export function resetDataDir(): void {
	dataDirSetting = DATA_DIR;
}

export function dataDir(): string {
	if (path.isAbsolute(dataDirSetting)) return dataDirSetting;
	return path.join(rootDir(), dataDirSetting);
}

export function sessionPath(): string {
	return path.join(dataDir(), 'session.json');
}

export function imagesDir(): string {
	return path.join(dataDir(), 'images');
}

export function backupsDir(): string {
	return path.join(dataDir(), 'backups');
}

export function promptsPath(): string {
	return path.join(rootDir(), 'prompts.yaml');
}

export function credentialsPath(): string {
	// Retained only to migrate and remove credential files created by older releases.
	return path.join(dataDir(), 'credentials.yaml');
}

export function localPromptsPath(): string {
	return path.join(rootDir(), 'prompts.local.yaml');
}
