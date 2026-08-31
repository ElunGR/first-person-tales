import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamePageController } from '../src/lib/frontend/gamePage.svelte';
import { toastState } from '../src/lib/frontend/toast.svelte';
import type { SettingsPayload, StatePayload } from '../src/lib/frontend/types';

const EMPTY_STATE: StatePayload = {
	messages: [],
	media: [],
	can_undo_summary: false,
	last_narrator_prompt_tokens: null,
	recovery_message: null
};

const SAVED_SETTINGS: SettingsPayload = {
	active_provider: 'venice',
	narrator_temperature: 0.75,
	narrator_top_p: 0.95,
	narrator_frequency_penalty: 0.35,
	narrator_presence_penalty: 0,
	narrator_max_tokens: 8000,
	translation_language: 'Russian',
	providers: { venice: { text_model: 'narrator', image_model: 'image' } },
	key_configured: { venice: true },
	key_source: { venice: 'keychain' }
};

function response(data: unknown): Response {
	return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('GamePageController settings status', () => {
	it('refreshes the key status on every settings opening', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(response({
				...SAVED_SETTINGS,
				key_configured: { venice: false },
				key_source: { venice: 'absent' }
			}))
			.mockResolvedValueOnce(response(SAVED_SETTINGS));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.settings = SAVED_SETTINGS;

		await controller.openSettings();

		expect(controller.settingsOpen).toBe(true);
		expect(controller.settings?.key_source?.venice).toBe('absent');
		expect(controller.settings?.key_configured?.venice).toBe(false);
		controller.settingsOpen = false;

		await controller.openSettings();

		expect(controller.settingsOpen).toBe(true);
		expect(controller.settings?.key_source?.venice).toBe('keychain');
		expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/settings', '/settings']);
	});

	it('does not display cached settings while fresh status is loading', async () => {
		let resolveSettings!: (value: Response) => void;
		vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
			resolveSettings = resolve;
		})));
		const controller = new GamePageController();
		controller.settings = SAVED_SETTINGS;

		const opening = controller.openSettings();

		expect(controller.settings).toBeNull();
		expect(controller.settingsOpen).toBe(false);
		expect(controller.busy).toBe(true);
		expect(controller.statusText).toBe('Loading settings…');
		resolveSettings(response(SAVED_SETTINGS));
		await opening;

		expect(controller.settingsOpen).toBe(true);
		expect(controller.settings).toEqual(SAVED_SETTINGS);
		expect(controller.busy).toBe(false);
		expect(controller.statusText).toBe('Ready');
	});

	it('reports a settings refresh failure without presenting the old status and allows retry', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('fetch', vi.fn()
			.mockRejectedValueOnce(new Error('Settings unavailable'))
			.mockResolvedValueOnce(response(SAVED_SETTINGS)));
		const controller = new GamePageController();
		controller.settings = SAVED_SETTINGS;

		await controller.openSettings();

		expect(controller.settingsOpen).toBe(false);
		expect(controller.settings).toBeNull();
		expect(controller.busy).toBe(false);
		expect(controller.statusText).toBe('Ready');
		expect(toastState.message).toBe('Could not load settings: Settings unavailable');
		expect(toastState.kind).toBe('err');
		expect(toastState.visible).toBe(true);

		await controller.openSettings();

		expect(controller.settingsOpen).toBe(true);
		expect(controller.settings).toEqual(SAVED_SETTINGS);
	});
});

describe('GamePageController state responses', () => {
	it('uses embedded story state without a redundant state request', async () => {
		const calls: string[] = [];
		vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
			calls.push(String(input));
			return response({
				message: { id: 'a', role: 'assistant', content: 'reply' },
				state: {
					...EMPTY_STATE,
					messages: [
						{ id: 'u', role: 'user', content: 'go' },
						{ id: 'a', role: 'assistant', content: 'reply' }
					]
				}
			});
		}));
		const controller = new GamePageController();
		controller.inputDraft = 'go';

		await controller.sendCurrent();

		expect(calls).toEqual(['/chat']);
		expect(controller.messages.map((message) => message.content)).toEqual(['go', 'reply']);
		expect(controller.statusText).toBe('Ready');
	});

	it('falls back to state when an older story response omits it', async () => {
		const calls: string[] = [];
		vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
			const path = String(input);
			calls.push(path);
			if (path === '/chat') return response({ message: { id: 'a', role: 'assistant', content: 'reply' } });
			return response({ ...EMPTY_STATE, messages: [{ id: 'a', role: 'assistant', content: 'from state' }] });
		}));
		const controller = new GamePageController();
		controller.inputDraft = 'go';

		await controller.sendCurrent();

		expect(calls).toEqual(['/chat', '/state']);
		expect(controller.messages[0].content).toBe('from state');
	});

	it('does not request a summary for an empty history', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();

		await controller.summarize();

		expect(fetchMock).not.toHaveBeenCalled();
		expect(controller.statusText).toBe('Ready');
	});

	it('undoes a summary immediately when no messages follow it', async () => {
		const confirmMock = vi.fn();
		vi.stubGlobal('confirm', confirmMock);
		vi.stubGlobal('fetch', vi.fn(async () => response(EMPTY_STATE)));
		const controller = new GamePageController();
		controller.applyState({
			...EMPTY_STATE,
			can_undo_summary: true,
			messages: [{ id: 'summary', role: 'user', content: 'summary', kind: 'branch' }]
		});

		await controller.undoSummary();

		expect(confirmMock).not.toHaveBeenCalled();
		expect(fetch).toHaveBeenCalledWith('/resummary/undo', expect.any(Object));
	});

	it('requires confirmation before undo discards messages after a summary', async () => {
		const confirmMock = vi.fn(() => false);
		const fetchMock = vi.fn();
		vi.stubGlobal('confirm', confirmMock);
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.applyState({
			...EMPTY_STATE,
			can_undo_summary: true,
			messages: [
				{ id: 'summary', role: 'user', content: 'summary', kind: 'branch' },
				{ id: 'u', role: 'user', content: 'go' },
				{ id: 'a', role: 'assistant', content: 'reply' }
			]
		});

		await controller.undoSummary();

		expect(confirmMock).toHaveBeenCalledWith(
			'Undo this summary and delete 2 messages written after it?'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
