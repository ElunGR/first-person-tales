/**
 * Game orchestration: narrator chat, branch summary, and explicit utilities.
 * Port of backend/game.py. LLM clients are always injected so routes and
 * tests control the exact client instance.
 */
import crypto from 'node:crypto';
import { UTILITY_TEMPERATURE } from './config';
import { IndexError, ValueError } from './errors';
import type { CompletionProvider } from './llm';
import { newMessage, type MediaKind, type Message } from './models';
import { formatPrompt, getPrompt } from './prompts';
import { cleanupUnreferencedMediaFiles, type Session } from './session';
import { loadSettings, type AppSettings } from './settings';
import { utcNowIso } from './time';

function systemWithCharacter(promptName: string): string {
	return `${getPrompt(promptName)}\n\n${getPrompt('player_character')}`.trim();
}

/** Active compact branch, preserving chat roles for provider requests. */
function activeBranchMessages(session: Session, endIndex?: number | null): Array<Record<string, string>> {
	const messages: Array<Record<string, string>> = [];
	const start = Math.max(0, Math.min(session.narratorStart, session.messages.length));
	const end = endIndex === undefined || endIndex === null
		? session.messages.length
		: Math.max(start, Math.min(session.messages.length, endIndex + 1));
	for (const m of session.messages.slice(start, end)) {
		if (m.kind === 'branch') {
			const content = (m.content || '').trim();
			if (content) {
				messages.push({ role: 'user', content: formatPrompt('branch_user_wrap', { content }) });
			}
			continue;
		}
		const role = m.role === 'user' || m.role === 'assistant' ? m.role : 'user';
		messages.push({ role, content: m.content });
	}
	return messages;
}

/** Narrator rules + the single player character + the active branch. */
export function buildNarratorMessages(session: Session): Array<Record<string, string>> {
	return [
		{ role: 'system', content: systemWithCharacter('narrator') },
		...activeBranchMessages(session)
	];
}

/** Summary rules + the single player character + the active branch. */
export function buildSummaryMessages(session: Session): Array<Record<string, string>> {
	return [
		{ role: 'system', content: systemWithCharacter('summary_request') },
		...activeBranchMessages(session),
		{ role: 'user', content: getPrompt('summary_user_request') }
	];
}

/** Persist exact prompt usage for a successful story completion, if any. */
function recordNarratorPromptTokens(session: Session, llm: CompletionProvider): void {
	const value = llm.lastUsage?.prompt_tokens ?? null;
	session.lastNarratorPromptTokens =
		typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Sampling options for a narrator completion from persisted settings. */
function narratorCompletionOptions(overrides: { temperature?: number } | null) {
	const settings: AppSettings = loadSettings();
	return {
		temperature: overrides?.temperature ?? settings.narrator_temperature,
		frequencyPenalty: settings.narrator_frequency_penalty,
		presencePenalty: settings.narrator_presence_penalty,
		maxCompletionTokens: settings.narrator_max_tokens,
		topP: settings.narrator_top_p
	};
}

export interface StoryOperationOptions {
	temperature?: number;
	signal?: AbortSignal;
}

/**
 * Append player message, run narrator, append assistant reply.
 * Single LLM call per turn - no hidden memory update.
 */
export async function chat(
	session: Session,
	content: string,
	llm: CompletionProvider,
	options: StoryOperationOptions = {}
): Promise<Message> {
	// Snapshot for explicit rollback if the LLM call fails after the user
	// message was already appended (and autosaved).
	const snapshot = session.snapshotTranscript();
	try {
		session.appendMessage(newMessage({ role: 'user', content }));
		const reply = await llm.complete(buildNarratorMessages(session), {
			...narratorCompletionOptions(options.temperature === undefined ? null : { temperature: options.temperature }),
			signal: options.signal
		});
		recordNarratorPromptTokens(session, llm);
		const assistant = newMessage({ role: 'assistant', content: reply.trim() });
		session.appendMessage(assistant);
		return assistant;
	} catch (err) {
		// Restore prior history and persist the rollback.
		session.restoreTranscript(snapshot);
		throw err;
	}
}

/**
 * Re-run the narrator from just before message `index`.
 *
 * Rewinds history to the turn that produced message `index` and asks the
 * narrator for a fresh reply. The LLM failure path keeps history unchanged.
 */
export async function regenerate(
	session: Session,
	index: number,
	llm: CompletionProvider,
	options: StoryOperationOptions = {}
): Promise<Message> {
	if (index < 0 || index >= session.messages.length) {
		throw new IndexError(String(index));
	}
	// Snapshot for explicit rollback if regenerate fails after truncate.
	const snapshot = session.snapshotTranscript();
	try {
		session.truncateFrom(index, false);
		const reply = await llm.complete(buildNarratorMessages(session), {
			...narratorCompletionOptions(options.temperature === undefined ? null : { temperature: options.temperature }),
			signal: options.signal
		});
		recordNarratorPromptTokens(session, llm);
		const assistant = newMessage({ role: 'assistant', content: reply.trim() });
		session.appendMessage(assistant);
		cleanupUnreferencedMediaFiles(session);
		return assistant;
	} catch (err) {
		// Restore prior history and persist the rollback.
		session.restoreTranscript(snapshot);
		throw err;
	}
}

/**
 * Edit a user message, drop everything after it, and request a new reply.
 *
 * Used when the player rewrites their own turn and wants a fresh narrator
 * answer from that point. Branch messages and non-user roles are rejected.
 */
export async function resend(
	session: Session,
	index: number,
	content: string,
	llm: CompletionProvider,
	options: StoryOperationOptions = {}
): Promise<Message> {
	const text = (content || '').trim();
	if (!text) {
		throw new ValueError('content is required');
	}
	if (index < 0 || index >= session.messages.length) {
		throw new IndexError(String(index));
	}
	const target = session.messages[index];
	if (target.kind === 'branch') {
		throw new ValueError('branch messages cannot be resent');
	}
	if (target.role !== 'user') {
		throw new ValueError('only user messages can be resent');
	}
	const snapshot = session.snapshotTranscript();
	try {
		session.messages[index] = { ...target, content: text, translation_ru: null };
		session.messages = session.messages.slice(0, index + 1);
		const remainingIds = new Set(session.messages.map((message) => message.id));
		session.media = session.media.filter((item) => remainingIds.has(item.message_id));
		session.reconcileNarratorStart();
		session.save();
		const reply = await llm.complete(buildNarratorMessages(session), {
			...narratorCompletionOptions(options.temperature === undefined ? null : { temperature: options.temperature }),
			signal: options.signal
		});
		recordNarratorPromptTokens(session, llm);
		const assistant = newMessage({ role: 'assistant', content: reply.trim() });
		session.appendMessage(assistant);
		cleanupUnreferencedMediaFiles(session);
		return assistant;
	} catch (err) {
		session.restoreTranscript(snapshot);
		throw err;
	}
}

/**
 * Append a branch digest and switch narrator context to the compact window.
 *
 * Visible chat history is kept. Summary uses its own system prompt plus the
 * player character and active branch; narrator instructions are not sent.
 * On success, appends role="user", kind="branch" with the digest, pushes an
 * undo checkpoint, and sets narrator_start to that branch. Images are left
 * untouched.
 */
export async function resummary(
	session: Session,
	llm: CompletionProvider,
	options: { signal?: AbortSignal } = {}
): Promise<Message> {
	if (session.messages.length === 0) {
		throw new ValueError('History is empty; there is nothing to summarize');
	}
	const raw = await llm.complete(buildSummaryMessages(session), {
		temperature: UTILITY_TEMPERATURE,
		signal: options.signal
	});
	const digest = raw.trim();
	if (!digest) {
		throw new ValueError('The narrator returned an empty summary');
	}

	const previousStart = session.narratorStart;
	const branch = newMessage({ role: 'user', kind: 'branch', content: digest });
	session.appendMessage(branch);
	session.summaryCheckpoints.push({
		id: crypto.randomUUID(),
		created_at: utcNowIso(),
		previous_narrator_start: previousStart,
		branch_message_id: branch.id
	});
	session.narratorStart = session.messages.length - 1;
	session.save();
	return branch;
}

/**
 * Undo the latest summarization checkpoint.
 *
 * Removes the branch card and every message after it, restores the previous
 * narrator compact window, and deletes media attached to the removed tail.
 */
export function undoResummary(session: Session): Message {
	if (session.summaryCheckpoints.length === 0) {
		throw new ValueError('Nothing to undo; there are no summaries');
	}

	const checkpoint = session.summaryCheckpoints[session.summaryCheckpoints.length - 1];
	const branchIdx = session.messageIndexById(checkpoint.branch_message_id);
	if (branchIdx === null || session.messages[branchIdx].kind !== 'branch') {
		// Stale checkpoint; drop and report nothing left / inconsistent.
		session.summaryCheckpoints.pop();
		session.reconcileNarratorStart();
		session.save();
		throw new ValueError('The summary checkpoint is stale');
	}

	const branch = session.messages[branchIdx];
	session.truncateFrom(branchIdx);
	session.narratorStart = checkpoint.previous_narrator_start;
	session.reconcileNarratorStart();
	session.save();
	return branch;
}

export async function translateText(text: string, llm: CompletionProvider, signal?: AbortSignal): Promise<string> {
	const translationLanguage = loadSettings().translation_language;
	const raw = await llm.complete(
		[
			{
				role: 'system',
				content: formatPrompt('translate', { translation_language: translationLanguage })
			},
			{ role: 'user', content: text }
		],
		{ temperature: UTILITY_TEMPERATURE, signal }
	);
	return raw.trim();
}

export async function improveText(text: string, llm: CompletionProvider, signal?: AbortSignal): Promise<string> {
	const raw = await llm.complete(
		[
			{ role: 'system', content: getPrompt('improve') },
			{ role: 'user', content: text }
		],
		{ temperature: UTILITY_TEMPERATURE, signal }
	);
	return raw.trim();
}

/** Active compact branch as plain text for image-prompt preparation. */
export function activeStoryTranscript(session: Session, endIndex?: number | null): string {
	return activeBranchMessages(session, endIndex)
		.map((message) => `${message.role.toUpperCase()}: ${message.content}`)
		.join('\n\n');
}

/** Image rules + the single player character + subject and active branch. */
export function buildImageRewriteMessages(
	session: Session,
	index: number,
	subject: string
): Array<Record<string, string>> {
	return [
		{ role: 'system', content: systemWithCharacter('image_prompt_rewrite') },
		{
			role: 'user',
			content: formatPrompt('image_rewrite_user', {
				subject,
				transcript: activeStoryTranscript(session, index)
			})
		}
	];
}

/** Prepare a visible, editable image prompt through one scene. */
export async function prepareMediaText(
	session: Session,
	index: number,
	kind: MediaKind,
	options: { instruction?: string; llm: CompletionProvider; signal?: AbortSignal }
): Promise<string> {
	if (index < 0 || index >= session.messages.length) {
		throw new IndexError(String(index));
	}
	const target = session.messages[index];
	if (target.role !== 'assistant' || target.kind === 'branch') {
		throw new ValueError('media can be prepared only for narrator messages');
	}
	if (kind !== 'image') {
		throw new ValueError(`invalid media kind: ${kind}`);
	}
	const requested = (options.instruction || '').trim();
	if (!requested) {
		throw new ValueError('describe the specific subject or moment to show before preparing media');
	}
	const raw = await options.llm.complete(
		buildImageRewriteMessages(session, index, requested),
		{ temperature: UTILITY_TEMPERATURE, signal: options.signal }
	);
	return raw.trim().replace(/^"+/, '').replace(/"+$/, '').slice(0, 1800);
}


