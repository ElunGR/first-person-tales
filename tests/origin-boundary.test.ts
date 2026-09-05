/** Regression tests for the production request-origin boundary. */
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { newMessage } from '../src/lib/server/models';
import { sessionPath } from '../src/lib/server/paths';
import { getSession, Session, setSession } from '../src/lib/server/session';
import { useTempDataDir } from './helpers';

useTempDataDir();

async function runThroughHandle(request: Request, resolve = vi.fn(async () => new Response('resolved'))): Promise<{
	response: Response;
	resolve: typeof resolve;
}> {
	const { handle } = await import('../src/hooks.server');
	const response = await handle({
		event: { request, url: new URL(request.url) },
		resolve
	} as never);
	return { response, resolve };
}

describe('unsafe request boundary', () => {
	it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=test'])(
		'rejects a nonempty %s body before resolving even a bodyless endpoint',
		async (contentType) => {
			for (const [method, pathname] of [['POST', '/reset'], ['PUT', '/messages/0']]) {
				const { response, resolve } = await runThroughHandle(new Request(`http://localhost${pathname}`, {
					method,
					headers: { Origin: 'http://localhost', 'Content-Type': contentType },
					body: '{"content":"must not be saved"}'
				}));
				expect(response.status).toBe(415);
				expect(resolve).not.toHaveBeenCalled();
			}
		}
	);

	it('passes same-origin JSON PUT and POST to real handlers and persists their changes', async () => {
		await import('../src/hooks.server');
		const message = newMessage({ role: 'user', content: 'before' });
		const session = new Session({ messages: [message] });
		setSession(session);
		session.save();
		const { PUT } = await import('../src/routes/messages/[index]/+server');
		const updateRequest = new Request('http://localhost/messages/0', {
			method: 'PUT',
			headers: { Origin: 'http://localhost', 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ content: 'updated', message_id: message.id })
		});
		const updateResolver = vi.fn(async () => PUT({ request: updateRequest, params: { index: '0' } } as never));
		const update = await runThroughHandle(updateRequest, updateResolver);
		expect(update.response.status).toBe(200);
		expect(updateResolver).toHaveBeenCalledTimes(1);
		expect(session.messages[0].content).toBe('updated');
		expect(Session.load()!.messages[0].content).toBe('updated');

		const { POST } = await import('../src/routes/import/+server');
		const imported = newMessage({ role: 'user', content: 'imported through middleware' });
		const importRequest = new Request('http://localhost/import', {
			method: 'POST',
			headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
			body: JSON.stringify({ confirm: true, data: {
				version: 1, messages: [imported], narrator_start: 0,
				summary_checkpoints: [], last_narrator_prompt_tokens: null
			} })
		});
		const importResolver = vi.fn(async () => POST({ request: importRequest } as never));
		const result = await runThroughHandle(importRequest, importResolver);
		expect(result.response.status).toBe(200);
		expect(importResolver).toHaveBeenCalledTimes(1);
		expect(getSession().messages).toEqual([imported]);
		expect(Session.load()!.messages).toEqual([imported]);
	});

	it('rejects a foreign or missing Origin before a destructive handler runs', async () => {
		const session = new Session({ messages: [newMessage({ role: 'user', content: 'keep this' })] });
		setSession(session);
		session.save();
		const persistedBefore = fs.readFileSync(sessionPath());

		for (const origin of ['http://untrusted.invalid', null]) {
			const headers = origin ? { Origin: origin } : undefined;
			const { response, resolve } = await runThroughHandle(
				new Request('http://localhost/reset', { method: 'POST', headers })
			);
			expect(response.status).toBe(403);
			expect(resolve).not.toHaveBeenCalled();
			expect(fs.readFileSync(sessionPath())).toEqual(persistedBefore);
			expect(session.messages).toHaveLength(1);
		}
	});

	it('allows same-origin bodyless reset and runs the production reset handler', async () => {
		const session = new Session({ messages: [newMessage({ role: 'user', content: 'discard me' })] });
		setSession(session);
		session.save();
		const { POST } = await import('../src/routes/reset/+server');
		const resolve = vi.fn(async () => POST());

		const { response } = await runThroughHandle(
			new Request('http://localhost/reset', {
				method: 'POST',
				headers: { Origin: 'http://localhost' }
			}),
			resolve
		);

		expect(response.status).toBe(200);
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(session.messages).toEqual([]);
	});

	it('requires JSON for unsafe endpoints that require a body', async () => {
		const { response, resolve } = await runThroughHandle(
			new Request('http://localhost/character', {
				method: 'PUT',
				headers: { Origin: 'http://localhost' }
			})
		);

		expect(response.status).toBe(415);
		expect(resolve).not.toHaveBeenCalled();
	});
});
