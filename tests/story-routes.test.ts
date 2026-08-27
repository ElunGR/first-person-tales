/**
 * Regression test: story routes must await the async game operation before
 * embedding `state` into the response. Returning the promise inside an
 * object leaked it un-awaited: the handler answered instantly with
 * `message: {}` and a torn state while generation kept running without the
 * session lock.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newMessage } from '../src/lib/server/models';
import { resetDataDir, setDataDir } from '../src/lib/server/paths';
import { Session, setSession } from '../src/lib/server/session';
import { useTempPromptRoot } from './helpers';

vi.mock('$lib/server/llmFactory', () => ({
	makeLlmClient: async () => ({
		lastUsage: null,
		complete: async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			return 'fresh reply';
		},
		aclose: async () => {}
	})
}));

let dir = '';
const promptRoot = useTempPromptRoot();
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-route-test-'));
	setDataDir(dir);
	setSession(
		new Session({
			messages: [
				newMessage({ role: 'user', content: 'move one' }),
				newMessage({ role: 'assistant', content: 'old reply' })
			]
		})
	);
});
afterEach(() => {
	resetDataDir();
	fs.rmSync(dir, { recursive: true, force: true });
});

function jsonResponse(response: Response): Promise<Record<string, any>> {
	return response.json() as Promise<Record<string, any>>;
}

describe('story route responses', () => {
	it('resend awaits the LLM and embeds the complete state', async () => {
		const { POST } = await import('../src/routes/messages/[index]/resend/+server');
		const request = new Request('http://localhost/messages/0/resend', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ content: 'edited move', message_id: null })
		});
		const response = await POST({ params: { index: '0' }, request } as never);
		expect(response.status).toBe(200);
		const data = await jsonResponse(response);
		// The awaited reply, not a serialized promise ({})
		expect(data.message.content).toBe('fresh reply');
		expect(data.state.messages.length).toBe(2);
		expect(data.state.messages[0].content).toBe('edited move');
		expect(data.state.messages[1].content).toBe('fresh reply');
	});

	it('regenerate awaits the LLM and embeds the complete state', async () => {
		const { POST } = await import('../src/routes/messages/[index]/regenerate/+server');
		const request = new Request('http://localhost/messages/1/regenerate', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ message_id: null })
		});
		const response = await POST({ params: { index: '1' }, request } as never);
		expect(response.status).toBe(200);
		const data = await jsonResponse(response);
		expect(data.message.content).toBe('fresh reply');
		expect(data.state.messages.length).toBe(2);
		expect(data.state.messages[1].content).toBe('fresh reply');
	});
});

describe('character route validation', () => {
	it('rejects an empty character', async () => {
		const { PUT } = await import('../src/routes/character/+server');
		const request = new Request('http://localhost/character', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ content: '   ' })
		});

		const response = await PUT({ request } as never);
		expect(response.status).toBe(422);
	});

	it('rejects a character longer than 10,000 characters', async () => {
		const { PUT } = await import('../src/routes/character/+server');
		const request = new Request('http://localhost/character', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ content: 'x'.repeat(10001) })
		});

		const response = await PUT({ request } as never);
		expect(response.status).toBe(422);
	});

	it('accepts and persists a valid character', async () => {
		const { PUT } = await import('../src/routes/character/+server');
		const request = new Request('http://localhost/character', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ content: 'A careful explorer.' })
		});

		const response = await PUT({ request } as never);
		expect(response.status).toBe(200);
		expect(fs.readFileSync(path.join(promptRoot.dir(), 'prompts.local.yaml'), 'utf8')).toContain(
			'A careful explorer.'
		);
	});
});
