/** Game orchestration tests with an injected fake LLM. */
import { beforeEach, describe, expect, it } from 'vitest';
import { LLMError, type TokenUsage } from '../src/lib/server/llm';
import {
	buildImageRewriteMessages,
	buildNarratorMessages,
	buildSummaryMessages,
	chat,
	regenerate,
	resend,
	resummary,
	translateText,
	undoResummary
} from '../src/lib/server/game';
import { newMessage } from '../src/lib/server/models';
import { loadSettings, saveSettings } from '../src/lib/server/settings';
import { Session, setSession } from '../src/lib/server/session';
import { useTempDataDir, useTempPromptRoot } from './helpers';

useTempDataDir();
useTempPromptRoot();

class FakeLLM {
	replies: string[];
	calls: Array<Array<Record<string, string>>> = [];
	lastUsage: TokenUsage | null = { prompt_tokens: 42, completion_tokens: 1, total_tokens: 43 };
	failNext = false;

	constructor(replies: string[]) {
		this.replies = [...replies];
	}

	async complete(messages: Array<Record<string, string>>): Promise<string> {
		this.calls.push(messages);
		if (this.failNext) {
			this.failNext = false;
			throw new LLMError('provider exploded');
		}
		const reply = this.replies.shift();
		if (reply === undefined) throw new Error('no scripted reply left');
		return reply;
	}
}

beforeEach(() => {
	setSession(new Session());
});

describe('narrator context building', () => {
	it('uses the compact window after a summary branch', () => {
		const s = new Session({
			messages: [
				newMessage({ role: 'user', content: 'old turn' }),
				newMessage({ role: 'assistant', content: 'old reply' }),
				newMessage({ role: 'user', kind: 'branch', content: 'digest' }),
				newMessage({ role: 'user', content: 'new turn' })
			],
			narratorStart: 2
		});

		const messages = buildNarratorMessages(s);

		expect(messages[0].role).toBe('system');
		const bodies = messages.slice(1).map((m) => m.content);
		expect(bodies.some((c) => c.includes('old turn'))).toBe(false);
		expect(messages[0].content).toContain('NARRATOR_SYSTEM_SENTINEL');
		expect(messages[0].content).toContain('CHARACTER_SENTINEL');
		expect(bodies.some((c) => c.includes('# Story Summary'))).toBe(true);
		expect(bodies.some((c) => c.includes('new turn'))).toBe(true);
	});

	it('summary uses its own system prompt, character, and active branch', () => {
		const s = new Session({
			messages: [
				newMessage({ role: 'user', content: 'old turn' }),
				newMessage({ role: 'user', kind: 'branch', content: 'earlier digest' }),
				newMessage({ role: 'assistant', content: 'current scene' })
			],
			narratorStart: 1
		});

		const messages = buildSummaryMessages(s);

		expect(messages[0].role).toBe('system');
		expect(messages[0].content).toContain('SUMMARY_SYSTEM_SENTINEL');
		expect(messages[0].content).toContain('CHARACTER_SENTINEL');
		expect(messages[0].content).not.toContain('NARRATOR_SYSTEM_SENTINEL');
		expect(messages.some((message) => message.content.includes('old turn'))).toBe(false);
		expect(messages.some((message) => message.content.includes('earlier digest'))).toBe(true);
		expect(messages.some((message) => message.content.includes('current scene'))).toBe(true);
		expect(messages.at(-1)).toEqual({ role: 'user', content: 'SUMMARY_USER_SENTINEL' });
	});

	it('image rewrite uses image rules, character, and only the active branch', () => {
		const s = new Session({
			messages: [
				newMessage({ role: 'user', content: 'old visual detail' }),
				newMessage({ role: 'user', kind: 'branch', content: 'current digest' }),
				newMessage({ role: 'assistant', content: 'current room' })
			],
			narratorStart: 1
		});

		const messages = buildImageRewriteMessages(s, 2, 'the room');

		expect(messages[0].content).toContain('IMAGE_SYSTEM_SENTINEL');
		expect(messages[0].content).toContain('CHARACTER_SENTINEL');
		expect(messages[0].content).not.toContain('NARRATOR_SYSTEM_SENTINEL');
		expect(messages[1].content).toContain('SUBJECT: the room');
		expect(messages[1].content).toContain('current digest');
		expect(messages[1].content).toContain('current room');
		expect(messages[1].content).not.toContain('old visual detail');
	});

});

describe('chat', () => {
	it('appends player message and narrator reply', async () => {
		const s = new Session();
		setSession(s);
		const llm = new FakeLLM(['  The door creaks.  ']);

		const reply = await chat(s, 'I open the door', llm);

		expect(s.messages.length).toBe(2);
		expect(s.messages[0].role).toBe('user');
		expect(reply.content).toBe('The door creaks.');
		expect(s.lastNarratorPromptTokens).toBe(42);
	});

	it('rolls back the appended user message when the LLM fails', async () => {
		const s = new Session({ messages: [newMessage({ role: 'assistant', content: 'before' })] });
		setSession(s);
		const llm = new FakeLLM([]);
		llm.failNext = true;

		await expect(chat(s, 'doomed', llm)).rejects.toThrow('provider exploded');

		expect(s.messages.length).toBe(1);
		expect(s.messages[0].content).toBe('before');
	});
});
describe('regenerate / resend', () => {
	it('regenerate replaces the tail with a fresh reply', async () => {
		const s = new Session({
			messages: [
				newMessage({ role: 'user', content: 'move' }),
				newMessage({ role: 'assistant', content: 'stale' })
			]
		});
		setSession(s);
		const llm = new FakeLLM(['fresh']);

		const reply = await regenerate(s, 1, llm);

		expect(s.messages.length).toBe(2);
		expect(s.messages[1].id).toBe(reply.id);
		expect(reply.content).toBe('fresh');
	});

	it('regenerate restores history on LLM failure', async () => {
		const original = newMessage({ role: 'assistant', content: 'stale' });
		const s = new Session({
			messages: [newMessage({ role: 'user', content: 'move' }), original]
		});
		setSession(s);
		const llm = new FakeLLM([]);
		llm.failNext = true;

		await expect(regenerate(s, 1, llm)).rejects.toThrow('provider exploded');

		expect(s.messages.map((m) => m.content)).toEqual(['move', 'stale']);
	});

	it('resend rejects branch and assistant targets', async () => {
		const s = new Session({
			messages: [
				newMessage({ role: 'user', kind: 'branch', content: 'digest' }),
				newMessage({ role: 'assistant', content: 'reply' })
			]
		});
		setSession(s);
		const llm = new FakeLLM(['x']);

		await expect(resend(s, 0, 'text', llm)).rejects.toThrow('branch messages cannot be resent');
		await expect(resend(s, 1, 'text', llm)).rejects.toThrow('only user messages can be resent');
		await expect(resend(s, 0, '   ', llm)).rejects.toThrow('content is required');
	});

	it('resend rewrites the turn and appends a new reply', async () => {
		const s = new Session({
			messages: [
				newMessage({ role: 'user', content: 'old' }),
				newMessage({ role: 'assistant', content: 'old reply' })
			]
		});
		setSession(s);
		const llm = new FakeLLM(['new reply']);

		await resend(s, 0, 'new', llm);

		expect(s.messages.map((m) => m.content)).toEqual(['new', 'new reply']);
	});
});

describe('summarization', () => {
	it('resummary appends a branch and moves the narrator cursor', async () => {
		const s = new Session({
			messages: [
				newMessage({ role: 'user', content: 'a' }),
				newMessage({ role: 'assistant', content: 'b' })
			]
		});
		setSession(s);
		const llm = new FakeLLM(['digest of events']);

		const branch = await resummary(s, llm);

		expect(branch.kind).toBe('branch');
		expect(branch.role).toBe('user');
		expect(s.narratorStart).toBe(s.messages.length - 1);
		expect(s.summaryCheckpoints.length).toBe(1);
		expect(s.canUndoSummary).toBe(true);
		// The summary request turn must not be persisted.
		expect(s.messages.every((m) => !m.content.includes('SUMMARY_REQUEST'))).toBe(true);
		expect(llm.calls[0][0].content).toContain('SUMMARY_SYSTEM_SENTINEL');
		expect(llm.calls[0][0].content).toContain('CHARACTER_SENTINEL');
		expect(llm.calls[0][0].content).not.toContain('NARRATOR_SYSTEM_SENTINEL');
		expect(llm.calls[0].at(-1)?.role).toBe('user');
		expect(llm.calls[0].some((message) => message.content.includes('SUMMARY_REQUEST'))).toBe(false);
	});

	it('undo restores the previous narrator window', async () => {
		const s = new Session({
			messages: [
				newMessage({ role: 'user', content: 'a' }),
				newMessage({ role: 'assistant', content: 'b' })
			]
		});
		setSession(s);
		const llm = new FakeLLM(['digest', 'next chapter']);
		await resummary(s, llm);
		await chat(s, 'after summary', llm);

		undoResummary(s);

		expect(s.canUndoSummary).toBe(false);
		expect(s.narratorStart).toBe(0);
		expect(s.messages.map((m) => m.content)).toEqual(['a', 'b']);
	});

	it('undo with no checkpoints raises', () => {
		const s = new Session();
		setSession(s);
		expect(() => undoResummary(s)).toThrow();
	});

	it('resummary on empty history raises', async () => {
		const s = new Session();
		setSession(s);
		const llm = new FakeLLM(['x']);
		await expect(resummary(s, llm)).rejects.toThrow();
	});
});

describe('utilities', () => {
	it('translate returns trimmed text', async () => {
		const settings = loadSettings();
		settings.translation_language = 'Italian';
		saveSettings(settings);
		const llm = new FakeLLM(['  Привет  ']);
		await expect(translateText('Hi', llm)).resolves.toBe('Привет');
		expect(llm.calls[0][0].content).toBe('TRANSLATE_SYSTEM_SENTINEL Italian');
		expect(llm.calls[0][0].content).not.toContain('{translation_language}');
	});
});
