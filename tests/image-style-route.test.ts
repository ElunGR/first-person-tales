/** Real media route/generator/storage integration with all provider HTTP mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageStyle } from '../src/lib/imageStyles';
import { setApiKey } from '../src/lib/server/keyring';
import { newMessage } from '../src/lib/server/models';
import { clearModelCapabilitiesForTests } from '../src/lib/server/providerApi';
import { Session, setSession } from '../src/lib/server/session';
import { defaultSettings, resetSettingsStateForTests, saveSettings } from '../src/lib/server/settings';
import { POST } from '../src/routes/messages/[index]/media/+server';
import { useTempDataDir } from './helpers';

useTempDataDir();

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=';
let session: Session;

beforeEach(async () => {
	clearModelCapabilitiesForTests();
	resetSettingsStateForTests();
	await setApiKey('venice', 'test-key');
	session = new Session({ messages: [newMessage({ role: 'assistant', content: 'A scene' })] });
	setSession(session);
	session.save();
});

afterEach(() => {
	clearModelCapabilitiesForTests();
	resetSettingsStateForTests();
	vi.unstubAllGlobals();
});

function configure(style: ImageStyle, promptCharacterLimit?: number) {
	const settings = defaultSettings();
	settings.image_style = style;
	settings.providers.venice!.image_model = 'fixture-image-model';
	saveSettings(settings);
	const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
		if (String(url).includes('/models')) {
			return Response.json({ data: [{
				id: 'fixture-image-model',
				model_spec: { type: 'image', constraints: { promptCharacterLimit } }
			}] });
		}
		if (!String(url).endsWith('/image/generate')) throw new Error('Unexpected provider endpoint');
		return Response.json({ images: [PNG_B64] });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function generate(text: string, imageStyle?: ImageStyle | string) {
	return POST({
		params: { index: '0' },
		request: new Request('http://localhost/messages/0/media', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ kind: 'image', text, image_style: imageStyle, message_id: session.messages[0].id })
		})
	} as never);
}

describe('image style generation boundary', () => {
	it.each([
		['anime', 'A stone bridge.\n\nStyle: anime'],
		['none', 'A stone bridge.']
	] as const)('uses the shown style %s even if saved settings changed', async (style, expectedPrompt) => {
		const fetchMock = configure('watercolor');
		const response = await generate('A stone bridge.', style);

		expect(response.status).toBe(200);
		const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/image/generate'))!;
		expect(JSON.parse(call[1]!.body as string).prompt).toBe(expectedPrompt);
		expect(session.media[0].source_text).toBe(expectedPrompt);
	});

	it('rejects an unsupported style snapshot without contacting the provider', async () => {
		const fetchMock = configure('anime');
		const response = await generate('A stone bridge.', 'unknown');

		expect(response.status).toBe(422);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(session.media).toEqual([]);
	});

	it('sends the selected style exactly once and persists the full provider prompt', async () => {
		const fetchMock = configure('anime');
		const response = await generate('  Medium shot of two travelers.  ');

		expect(response.status).toBe(200);
		const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/image/generate'));
		expect(calls).toHaveLength(1);
		const body = JSON.parse(calls[0][1]!.body as string);
		expect(body.prompt).toBe('Medium shot of two travelers.\n\nStyle: anime');
		expect(body.style_preset).toBeUndefined();
		expect(session.media[0].source_text).toBe(body.prompt);
		expect(Session.load()!.media[0].source_text).toBe(body.prompt);
		expect((await response.json()).media[0].source_text).toBe(body.prompt);
	});

	it('sends manual prompt text unchanged when no style is selected', async () => {
		const fetchMock = configure('none');
		const response = await generate('A stone bridge.\nStyle: custom ink drawing');

		expect(response.status).toBe(200);
		const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/image/generate'))!;
		expect(JSON.parse(call[1]!.body as string).prompt).toBe('A stone bridge.\nStyle: custom ink drawing');
		expect(session.media[0].source_text).toBe('A stone bridge.\nStyle: custom ink drawing');
	});

	it('counts the appended style against the model limit before paid generation', async () => {
		const fetchMock = configure('anime', 5);
		const response = await generate('a cat');

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({
			detail: 'image prompt exceeds the selected model limit of 5 characters'
		});
		expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/image/generate'))).toHaveLength(0);
		expect(session.media).toEqual([]);
	});
});
