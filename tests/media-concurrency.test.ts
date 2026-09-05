/** Real generation/storage/route/lock integration; only provider HTTP is stubbed. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { setApiKey } from '../src/lib/server/keyring';
import { sessionLock } from '../src/lib/server/lock';
import { pendingMediaFiles } from '../src/lib/server/mediaIo';
import { newMessage } from '../src/lib/server/models';
import { imagesDir } from '../src/lib/server/paths';
import { clearModelCapabilitiesForTests } from '../src/lib/server/providerApi';
import { cleanupUnreferencedMediaFiles, Session, setSession } from '../src/lib/server/session';
import { defaultSettings, resetSettingsStateForTests, saveSettings } from '../src/lib/server/settings';
import { useTempDataDir } from './helpers';

useTempDataDir();

afterEach(() => {
	clearModelCapabilitiesForTests();
	resetSettingsStateForTests();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

it('keeps a generated pending image through cleanup while its attachment waits for the session lock', async () => {
	clearModelCapabilitiesForTests();
	const settings = defaultSettings();
	settings.providers.venice!.image_model = 'fixture-image-model';
	saveSettings(settings);
	await setApiKey('venice', 'test-key'); // tests/setup.ts supplies an in-memory store.
	const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=', 'base64');
	const generationStarted = deferred();
	const finishGeneration = deferred();
	const fetchMock = vi.fn(async (url: string | URL | Request) => {
		const pathname = new URL(String(url)).pathname;
		if (pathname.endsWith('/models')) {
			return Response.json({ data: [{ id: 'fixture-image-model', model_spec: { type: 'image', constraints: {} } }] });
		}
		if (!pathname.endsWith('/image/generate')) throw new Error('Unexpected provider endpoint');
		generationStarted.resolve();
		await finishGeneration.promise;
		return Response.json({ images: [bytes.toString('base64')] });
	});
	vi.stubGlobal('fetch', fetchMock);
	const message = newMessage({ role: 'assistant', content: 'A scene' });
	const session = new Session({ messages: [message] });
	setSession(session);
	session.save();
	fs.writeFileSync(path.join(imagesDir(), 'orphan.png'), bytes);
	const { POST } = await import('../src/routes/messages/[index]/media/+server');
	// Pass-through spy observes the attachment queue without replacing mutex behavior.
	const lockSpy = vi.spyOn(sessionLock, 'runExclusive');
	const responsePromise = POST({ params: { index: '0' }, request: new Request('http://localhost/messages/0/media', {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ kind: 'image', text: 'A scene', message_id: message.id })
	}) } as never);
	await generationStarted.promise;
	const lockHeld = deferred();
	const runCleanup = deferred();
	const cleanupFinished = deferred();
	const releaseLock = deferred();
	let removed: string[] = [];
	const competingMutation = sessionLock.runExclusive(async () => {
		lockHeld.resolve();
		await runCleanup.promise;
		removed = cleanupUnreferencedMediaFiles(session);
		cleanupFinished.resolve();
		await releaseLock.promise;
	});
	let name = '';
	try {
		await lockHeld.promise;
		finishGeneration.resolve();
		await vi.waitFor(() => {
			expect(lockSpy).toHaveBeenCalledTimes(3); // validation, competing mutation, queued attachment
			expect(pendingMediaFiles.size).toBe(1);
		});
		name = [...pendingMediaFiles][0];
		expect(session.media).toEqual([]);
		expect(fs.readFileSync(path.join(imagesDir(), name))).toEqual(bytes);
		runCleanup.resolve();
		await cleanupFinished.promise;
		expect(removed).toEqual(['orphan.png']);
		expect(session.media).toEqual([]);
		expect(fs.readFileSync(path.join(imagesDir(), name))).toEqual(bytes);
	} finally {
		finishGeneration.resolve();
		runCleanup.resolve();
		releaseLock.resolve();
		await competingMutation;
		await responsePromise;
	}
	const response = await responsePromise;
	expect(response.status).toBe(200);
	expect((await response.json()).media).toEqual(session.media);
	expect(session.media).toHaveLength(1);
	expect(session.media[0]).toMatchObject({ message_id: message.id, file: name });
	expect(Session.load()!.media).toEqual(session.media);
	expect(pendingMediaFiles.size).toBe(0);
	expect(cleanupUnreferencedMediaFiles(session)).toEqual([]);
	expect(fs.readFileSync(path.join(imagesDir(), name))).toEqual(bytes);
	expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/image/generate'))).toHaveLength(1);
});
