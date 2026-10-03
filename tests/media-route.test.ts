/** Media attachment transaction tests with a stubbed, local image result. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newMessage } from '../src/lib/server/models';
import { imagesDir } from '../src/lib/server/paths';
import { Session, setSession } from '../src/lib/server/session';
import { useTempDataDir, useTempPromptRoot } from './helpers';

vi.mock('$lib/server/imageGen', () => ({
	generateToFile: vi.fn(async () => 'generated.png'),
	ImageGenError: class ImageGenError extends Error {}
}));

useTempDataDir();
useTempPromptRoot();

afterEach(() => { vi.restoreAllMocks(); });

let session: Session;

beforeEach(() => {
	vi.clearAllMocks();
	const message = newMessage({ role: 'assistant', content: 'A scene' });
	session = new Session({ messages: [message] });
	setSession(session);
	session.save();
	fs.writeFileSync(path.join(imagesDir(), 'generated.png'), Buffer.from('generated image'));
});

describe('media attachment route', () => {
	it('rejects a request from the previous game before generation when body parsing is delayed', async () => {
		const { POST } = await import('../src/routes/messages/[index]/media/+server');
		const { POST: importGame } = await import('../src/routes/import/+server');
		const { generateToFile } = await import('../src/lib/server/imageGen');
		const body = { kind: 'image', text: 'Old scene', message_id: session.messages[0].id };
		const request = new Request('http://localhost/messages/0/media', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
		});
		let finishRead!: (value: unknown) => void;
		vi.spyOn(request, 'json').mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
		const pending = POST({ params: { index: '0' }, request } as never);
		try {
			const imported = await importGame({ request: new Request('http://localhost/import', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ confirm: true, data: {
					version: 2, messages: session.messages, narrator_start: 0,
					summary_checkpoints: [], last_narrator_prompt_tokens: null,
					player_character_description: 'Other hero', world_description: 'Other world'
				} })
			}) } as never);
			expect(imported.status).toBe(200);
		} finally {
			finishRead(body);
		}
		const response = await pending;
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ detail: 'game changed before generation' });
		expect(generateToFile).not.toHaveBeenCalled();
	});

	it('removes its generated file when the session record cannot be saved', async () => {
		vi.spyOn(session, 'save').mockImplementation(() => {
			throw new Error('EPERM: rename failed');
		});
		const { POST } = await import('../src/routes/messages/[index]/media/+server');

		await expect(
			POST({
				params: { index: '0' },
				request: new Request('http://localhost/messages/0/media', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ kind: 'image', text: 'A scene', message_id: session.messages[0].id })
				})
			} as never)
		).rejects.toThrow('rename failed');

		expect(session.media).toEqual([]);
		expect(fs.existsSync(path.join(imagesDir(), 'generated.png'))).toBe(false);
	});
});
