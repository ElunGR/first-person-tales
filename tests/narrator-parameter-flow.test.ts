/**
 * End-to-end dictionary flow: what the settings form saves is what a narrator
 * request finally sends to the provider.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { chat } from '../src/lib/server/game';
import type { CompletionOptions, CompletionProvider } from '../src/lib/server/llm';
import { newMessage } from '../src/lib/server/models';
import { dataDir } from '../src/lib/server/paths';
import { Session } from '../src/lib/server/session';
import { loadSettings, resetSettingsStateForTests, settingsPath } from '../src/lib/server/settings';
import { useTempDataDir, useTempPromptRoot } from './helpers';

useTempDataDir();
useTempPromptRoot();

/** Records the exact options the narrator request used. */
class RecordingProvider implements CompletionProvider {
	lastUsage = null;
	seen: CompletionOptions | null = null;
	async complete(_messages: Array<Record<string, string>>, options: CompletionOptions = {}): Promise<string> {
		this.seen = options;
		return 'A reply.';
	}
}

function settingsRequest(fields: Record<string, unknown>): Request {
	return new Request('http://localhost/settings', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ providers: {}, ...fields })
	});
}

beforeEach(() => {
	resetSettingsStateForTests();
});

afterEach(() => {
	resetSettingsStateForTests();
});

describe('narrator parameters reach the request', () => {
	it('sends the dictionary saved through the settings route, defaults included', async () => {
		const { PUT } = await import('../src/routes/settings/+server');
		const saved = await PUT({
			request: settingsRequest({ narrator_parameters: { temperature: 1.05, top_k: 40, stop: ['###'] } })
		} as never);
		expect(saved.status).toBe(200);
		resetSettingsStateForTests();

		const provider = new RecordingProvider();
		const session = new Session({ messages: [] });
		await chat(session, 'I look around.', provider);

		expect(provider.seen?.parameters).toEqual({
			max_completion_tokens: 8000,
			temperature: 1.05,
			top_k: 40,
			stop: ['###']
		});
	});

	it('stores every field including the defaults, and the dialog is told the same set', async () => {
		const { PUT } = await import('../src/routes/settings/+server');
		const response = await PUT({
			request: settingsRequest({ narrator_parameters: { temperature: 0.8 } })
		} as never);
		const published = (await response.json()) as { narrator_parameters: Record<string, unknown> };
		const expected = { temperature: 0.8, max_completion_tokens: 8000 };
		// The answer and the file agree, so the open form matches the next request.
		expect(published.narrator_parameters).toEqual(expected);
		resetSettingsStateForTests();
		expect(loadSettings().narrator_parameters).toEqual(expected);

		const provider = new RecordingProvider();
		await chat(new Session({ messages: [] }), 'I look around.', provider);
		expect(provider.seen?.parameters).toEqual(expected);
	});

	it('uses the saved dictionary for a normal turn and raises temperature on regenerate', async () => {
		const { PUT } = await import('../src/routes/settings/+server');
		await PUT({ request: settingsRequest({ narrator_parameters: { temperature: 0.5 } }) } as never);
		resetSettingsStateForTests();

		const provider = new RecordingProvider();
		const session = new Session({ messages: [newMessage({ role: 'user', content: 'I wait.' })] });
		await chat(session, 'I look around.', provider);
		expect(provider.seen?.parameters).toEqual({ temperature: 0.5, max_completion_tokens: 8000 });

		// Regenerate asks for a fresh sample without touching the saved value.
		const { regenerate } = await import('../src/lib/server/game');
		const replyIndex = session.messages.length - 1;
		await regenerate(session, replyIndex, provider, { temperature: 1.1 });
		expect(provider.seen?.parameters).toEqual({ temperature: 1.1, max_completion_tokens: 8000 });
		// The saved value is untouched by the temporary regenerate override.
		expect(loadSettings().narrator_parameters).toEqual({
			temperature: 0.5,
			max_completion_tokens: 8000
		});
	});

	it('keeps the narrator dictionary out of utility requests', async () => {
		const { PUT } = await import('../src/routes/settings/+server');
		await PUT({ request: settingsRequest({ narrator_parameters: { top_k: 40 } }) } as never);
		resetSettingsStateForTests();

		const provider = new RecordingProvider();
		const { translateText } = await import('../src/lib/server/game');
		await translateText('Hello', provider);
		expect(provider.seen?.parameters).toEqual({ temperature: 0.3 });
	});
});

describe('settings form output', () => {
	it('parses typed row values the same way the form does', async () => {
		const { parseParameterValueText } = await import('../src/lib/narratorParameters');
		const rows = {
			temperature: '0.95',
			top_k: '40',
			stop: '["###"]',
			ignore_eos: 'true',
			guided: 'json'
		};
		const parsed: Record<string, unknown> = {};
		for (const [name, text] of Object.entries(rows)) {
			const result = parseParameterValueText(text);
			if ('error' in result) throw new Error(`${name}: ${result.error}`);
			parsed[name] = result.value;
		}

		const { PUT } = await import('../src/routes/settings/+server');
		const response = await PUT({ request: settingsRequest({ narrator_parameters: parsed }) } as never);
		expect(response.status).toBe(200);
		resetSettingsStateForTests();

		const provider = new RecordingProvider();
		await chat(new Session({ messages: [] }), 'I look around.', provider);
		expect(provider.seen?.parameters).toEqual({
			max_completion_tokens: 8000,
			temperature: 0.95,
			top_k: 40,
			stop: ['###'],
			ignore_eos: true,
			guided: 'json'
		});
	});
});

describe('a hand-edited settings file', () => {
	it('keeps its usable fields and repairs the rest without discarding the file', async () => {
		fs.mkdirSync(dataDir(), { recursive: true });
		fs.writeFileSync(
			settingsPath(),
			JSON.stringify({
				narrator_parameters: {
					temperature: 1.2,
					Model: 'someone-else',
					'top k': 1,
					top_k: 40,
					nested: { a: 1 }
				}
			}),
			'utf-8'
		);

		const provider = new RecordingProvider();
		await chat(new Session({ messages: [] }), 'I look around.', provider);
		expect(provider.seen?.parameters).toEqual({
			temperature: 1.2,
			max_completion_tokens: 8000,
			top_k: 40
		});
		expect(fs.existsSync(settingsPath())).toBe(true);
		expect(fs.readdirSync(dataDir()).some((name) => name.startsWith('settings.invalid-'))).toBe(false);
	});
});
