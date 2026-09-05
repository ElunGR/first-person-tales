/** Media attachment transaction tests with a stubbed, local image result. */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newMessage } from '../src/lib/server/models';
import { imagesDir } from '../src/lib/server/paths';
import { Session, setSession } from '../src/lib/server/session';
import { useTempDataDir } from './helpers';

vi.mock('$lib/server/imageGen', () => ({
	generateToFile: vi.fn(async () => 'generated.png'),
	ImageGenError: class ImageGenError extends Error {}
}));

useTempDataDir();

let session: Session;

beforeEach(() => {
	const message = newMessage({ role: 'assistant', content: 'A scene' });
	session = new Session({ messages: [message] });
	setSession(session);
	session.save();
	fs.writeFileSync(path.join(imagesDir(), 'generated.png'), Buffer.from('generated image'));
});

describe('media attachment route', () => {
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
