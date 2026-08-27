/** Pure validation for the current session payload shape and references. */
import path from 'node:path';
import {
	MediaRecordSchema,
	MessageSchema,
	SummaryCheckpointSchema,
	type MediaRecord,
	type Message,
	type SummaryCheckpoint
} from './models';

const CURRENT_SESSION_KEYS = [
	'messages',
	'media',
	'narrator_start',
	'summary_checkpoints',
	'last_narrator_prompt_tokens'
];

export interface ValidatedSessionData {
	messages: Message[];
	media: MediaRecord[];
	narratorStart: number;
	summaryCheckpoints: SummaryCheckpoint[];
	lastNarratorPromptTokens: number | null;
}

export class SessionFormatError extends Error {
	constructor(message: string = 'incompatible session format') {
		super(message);
		this.name = 'SessionFormatError';
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accept only the current top-level shape; historical formats are rejected. */
export function validateCurrentSessionShape(data: unknown): Record<string, unknown> | null {
	if (!isPlainObject(data)) return null;
	const keys = Object.keys(data);
	if (keys.length !== CURRENT_SESSION_KEYS.length || !keys.every((key) => CURRENT_SESSION_KEYS.includes(key))) {
		return null;
	}
	if (!Array.isArray(data['messages'])) return null;
	if (!Array.isArray(data['media'])) return null;
	if (!Array.isArray(data['summary_checkpoints'])) return null;
	const narratorStart = data['narrator_start'];
	if (typeof narratorStart !== 'number' || !Number.isInteger(narratorStart)) return null;
	const rawTokens = data['last_narrator_prompt_tokens'];
	if (rawTokens !== null && (typeof rawTokens !== 'number' || !Number.isInteger(rawTokens) || rawTokens < 0)) {
		return null;
	}
	return data;
}

/** Validate values and all cross-record references without filesystem access. */
export function validateSessionPayload(data: unknown): ValidatedSessionData {
	const current = validateCurrentSessionShape(data);
	if (current === null) throw new SessionFormatError();

	const messages: Message[] = [];
	const messageIndexes = new Map<string, number>();
	(current['messages'] as unknown[]).forEach((rawMessage, index) => {
		if (!isPlainObject(rawMessage)) throw new Error('message must be an object');
		const messageId = rawMessage['id'];
		if (typeof messageId !== 'string' || !messageId.trim()) {
			throw new Error('message IDs must be non-empty strings');
		}
		if (messageIndexes.has(messageId)) throw new Error('duplicate message IDs');
		if (rawMessage['kind'] === 'branch' && rawMessage['role'] !== 'user') {
			throw new Error('summary branches must use the user role');
		}
		let message: Message;
		try {
			message = MessageSchema.parse(rawMessage);
		} catch {
			throw new Error(`invalid message at index ${index}`);
		}
		messageIndexes.set(messageId, index);
		messages.push(message);
	});

	const media: MediaRecord[] = [];
	const mediaIds = new Set<string>();
	(current['media'] as unknown[]).forEach((rawMedia, index) => {
		if (!isPlainObject(rawMedia)) throw new Error('media record must be an object');
		if (rawMedia['kind'] === 'video') return;
		const mediaId = rawMedia['id'];
		if (typeof mediaId !== 'string' || !mediaId.trim()) throw new Error('media IDs must be non-empty strings');
		if (mediaIds.has(mediaId)) throw new Error('duplicate media IDs');
		const messageId = rawMedia['message_id'];
		if (typeof messageId !== 'string' || !messageId.trim()) {
			throw new Error('media message_id must be a non-empty string');
		}
		if (!messageIndexes.has(messageId)) throw new Error('media references a missing message');
		const fileName = rawMedia['file'];
		if (typeof fileName !== 'string' || !fileName || path.basename(fileName) !== fileName) {
			throw new Error(`invalid media filename at index ${index}`);
		}
		let item: MediaRecord;
		try {
			item = MediaRecordSchema.parse(rawMedia);
		} catch {
			throw new Error(`invalid media at index ${index}`);
		}
		mediaIds.add(mediaId);
		media.push(item);
	});

	const narratorStart = current['narrator_start'] as number;
	if (narratorStart < 0 || narratorStart > messages.length) throw new Error('invalid narrator_start');
	const lastNarratorPromptTokens = current['last_narrator_prompt_tokens'] as number | null;

	const summaryCheckpoints: SummaryCheckpoint[] = [];
	const checkpointIds = new Set<string>();
	let previousBranchIndex: number | null = null;
	(current['summary_checkpoints'] as unknown[]).forEach((rawCheckpoint, index) => {
		if (!isPlainObject(rawCheckpoint)) throw new Error('summary checkpoint must be an object');
		const checkpointId = rawCheckpoint['id'];
		if (typeof checkpointId !== 'string' || !checkpointId.trim()) {
			throw new Error('checkpoint IDs must be non-empty strings');
		}
		if (checkpointIds.has(checkpointId)) throw new Error('duplicate checkpoint IDs');
		const previousStart = rawCheckpoint['previous_narrator_start'];
		if (typeof previousStart !== 'number' || !Number.isInteger(previousStart) || previousStart < 0) {
			throw new Error('invalid checkpoint cursor');
		}
		const branchId = rawCheckpoint['branch_message_id'];
		if (typeof branchId !== 'string' || !messageIndexes.has(branchId)) {
			throw new Error('summary checkpoint references a missing message');
		}
		const branchIndex = messageIndexes.get(branchId)!;
		const branch = messages[branchIndex];
		if (branch.kind !== 'branch' || branch.role !== 'user') {
			throw new Error('summary checkpoint references a non-branch message');
		}
		const expectedPreviousStart = previousBranchIndex === null ? 0 : previousBranchIndex;
		if ((previousBranchIndex !== null && branchIndex <= previousBranchIndex) || previousStart !== expectedPreviousStart) {
			throw new Error('invalid summary checkpoint cursor');
		}
		let checkpoint: SummaryCheckpoint;
		try {
			checkpoint = SummaryCheckpointSchema.parse(rawCheckpoint);
		} catch {
			throw new Error(`invalid summary checkpoint at index ${index}`);
		}
		checkpointIds.add(checkpointId);
		summaryCheckpoints.push(checkpoint);
		previousBranchIndex = branchIndex;
	});

	if (narratorStart !== (previousBranchIndex ?? 0)) {
		throw new Error('narrator_start does not match summary checkpoints');
	}

	return { messages, media, narratorStart, summaryCheckpoints, lastNarratorPromptTokens };
}
