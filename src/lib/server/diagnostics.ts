/**
 * Small local failure journal for support without retaining story text or keys.
 * Port of backend/diagnostics.py.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths';

const MAX_BYTES = 256 * 1024;

export interface FailureRecord {
	requestId: string;
	method: string;
	path: string;
	status: number;
	category?: string;
	source?: string;
	provider?: string | null;
	providerStatus?: number | null;
}

/** Keep a bounded, metadata-only log of failed server operations. */
export function recordFailure(record: FailureRecord): void {
	const logPath = path.join(dataDir(), 'diagnostics.log');
	const line =
		JSON.stringify({
			timestamp: new Date().toISOString(),
			request_id: record.requestId,
			category: record.category ?? 'http_error',
			source: record.source ?? 'server',
			status: record.status,
			method: record.method,
			path: record.path,
			provider: record.provider ?? null,
			provider_status: record.providerStatus ?? null
		}) + '\n';
	try {
		fs.mkdirSync(path.dirname(logPath), { recursive: true });
		if (fs.existsSync(logPath) && fs.statSync(logPath).size >= MAX_BYTES) {
			fs.renameSync(logPath, path.join(path.dirname(logPath), 'diagnostics.previous.log'));
		}
		fs.appendFileSync(logPath, line, 'utf-8');
	} catch {
		// Diagnostics must never interfere with the game itself.
	}
}
