import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamePageController } from '../src/lib/frontend/gamePage.svelte';
import { ERROR_DURATION_MS, toast, toastState } from '../src/lib/frontend/toast.svelte';
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

describe('toast visibility', () => {
	it('keeps errors visible long enough to read', () => {
		vi.useFakeTimers();

		toast('Could not create image', 'err');
		vi.advanceTimersByTime(6500);
		expect(toastState.visible).toBe(true);

		vi.advanceTimersByTime(ERROR_DURATION_MS - 6500);
		expect(toastState.visible).toBe(false);
	});
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

describe('GamePageController world editor', () => {
	it('loads the world in its own modal', async () => {
		const fetchMock = vi.fn().mockResolvedValue(response({ content: 'A quiet kingdom.' }));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();

		await controller.openWorld();

		expect(fetchMock).toHaveBeenCalledWith('/world', expect.any(Object));
		expect(controller.worldOpen).toBe(true);
		expect(controller.worldText).toBe('A quiet kingdom.');
	});

	it('saves a blank world as an explicit removal', async () => {
		const fetchMock = vi.fn().mockResolvedValue(response({ content: '' }));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.worldOpen = true;

		await controller.saveWorld('   ');

		expect(fetchMock).toHaveBeenCalledWith('/world', expect.objectContaining({
			method: 'PUT',
			body: JSON.stringify({ content: '   ' })
		}));
		expect(controller.worldOpen).toBe(false);
		expect(controller.worldText).toBe('');
		expect(toastState.message).toBe('World description removed');
	});

	it('waits for the world load before opening the editor or allowing Save', async () => {
		let resolveWorld!: (value: Response) => void;
		const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
			resolveWorld = resolve;
		}));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();

		const opening = controller.openWorld();

		expect(controller.worldOpen).toBe(false);
		expect(controller.busy).toBe(true);
		await controller.saveWorld('');
		expect(fetchMock).toHaveBeenCalledTimes(1);

		resolveWorld(response({ content: 'Loaded world' }));
		await opening;

		expect(controller.worldOpen).toBe(true);
		expect(controller.worldText).toBe('Loaded world');
		expect(controller.busy).toBe(false);
	});

	it('waits for the character load before opening the editor', async () => {
		let resolveCharacter!: (value: Response) => void;
		vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
			resolveCharacter = resolve;
		})));
		const controller = new GamePageController();

		const opening = controller.openCharacter();

		expect(controller.characterOpen).toBe(false);
		expect(controller.busy).toBe(true);
		resolveCharacter(response({ content: 'Loaded character' }));
		await opening;

		expect(controller.characterOpen).toBe(true);
		expect(controller.characterText).toBe('Loaded character');
		expect(controller.busy).toBe(false);
	});
});

describe('GamePageController request ownership', () => {
	it('ignores a repeated resend while the first operation is busy', async () => {
		const pending: Array<(value: Response) => void> = [];
		const fetchMock = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.messages = [{ id: 'u', role: 'user', content: 'go' }];

		const first = controller.resendEdit(0, 'go');
		const second = controller.resendEdit(0, 'go');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(controller.busy).toBe(true);
		pending[0](response({
			message: { id: 'a', role: 'assistant', content: 'reply' },
			state: { ...EMPTY_STATE, messages: [{ id: 'u', role: 'user', content: 'go' }] }
		}));
		await Promise.all([first, second]);

		expect(controller.busy).toBe(false);
		expect(controller.showStop).toBe(false);
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
		expect(controller.inputDraft).toBe('');
		expect(controller.statusText).toBe('Ready');
	});

	it('keeps the draft in the composer until chat succeeds', async () => {
		let resolveChat!: (value: Response) => void;
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>((resolve) => {
				resolveChat = resolve;
			}))
		);
		const controller = new GamePageController();
		controller.inputDraft = 'go';

		const sending = controller.sendCurrent();

		expect(controller.messages).toEqual([]);
		expect(controller.inputDraft).toBe('go');
		expect(controller.busy).toBe(true);
		expect(controller.statusText).toBe('Narrator is thinking…');
		resolveChat(
			response({
				message: { id: 'a', role: 'assistant', content: 'reply' },
				state: {
					...EMPTY_STATE,
					messages: [
						{ id: 'u', role: 'user', content: 'go' },
						{ id: 'a', role: 'assistant', content: 'reply' }
					]
				}
			})
		);
		await sending;

		expect(controller.inputDraft).toBe('');
		expect(controller.messages.map((message) => message.content)).toEqual(['go', 'reply']);
	});

	it('restores an editable draft when chat fails without adding a history card', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('provider exploded')));
		const controller = new GamePageController();
		controller.inputDraft = 'go';

		await controller.sendCurrent();

		expect(controller.messages).toEqual([]);
		expect(controller.inputDraft).toBe('go');
		expect(controller.busy).toBe(false);
		expect(controller.statusText).toBe('Ready');
		expect(toastState.message).toBe('Chat failed: provider exploded');
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

	it('names the discarded count before a resend rewinds the story', async () => {
		const confirmMock = vi.fn(() => false);
		const fetchMock = vi.fn();
		vi.stubGlobal('confirm', confirmMock);
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.messages = [
			{ id: 'u1', role: 'user', content: 'go north' },
			{ id: 'a1', role: 'assistant', content: 'reply 1' },
			{ id: 'u2', role: 'user', content: 'go south' },
			{ id: 'a2', role: 'assistant', content: 'reply 2' }
		];

		await controller.resendEdit(0, 'go west');

		expect(confirmMock).toHaveBeenCalledWith(
			'Save the edit and resend this turn? The 3 messages after it, and any attached images, will be deleted.'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('still confirms a resend when the edited text is unchanged', async () => {
		// The editor trims before calling in, so an unchanged string must not
		// bypass the warning: the tail is discarded either way.
		const confirmMock = vi.fn(() => false);
		const fetchMock = vi.fn();
		vi.stubGlobal('confirm', confirmMock);
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.messages = [
			{ id: 'u1', role: 'user', content: 'go north' },
			{ id: 'a1', role: 'assistant', content: 'reply 1' }
		];

		await controller.resendEdit(0, 'go north');

		expect(confirmMock).toHaveBeenCalledWith(
			'Save the edit and resend this turn? The 1 message after it, and any attached images, will be deleted.'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('resends the last turn without a confirmation', async () => {
		const confirmMock = vi.fn(() => false);
		const fetchMock = vi.fn(async () => response({ message: {}, state: EMPTY_STATE }));
		vi.stubGlobal('confirm', confirmMock);
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.messages = [{ id: 'u1', role: 'user', content: 'go north' }];

		await controller.resendEdit(0, 'go west');

		expect(confirmMock).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('names the discarded count before deleting a message and its tail', async () => {
		const confirmMock = vi.fn(() => false);
		vi.stubGlobal('confirm', confirmMock);
		vi.stubGlobal('fetch', vi.fn());
		const controller = new GamePageController();
		controller.messages = [
			{ id: 'u1', role: 'user', content: 'go north' },
			{ id: 'a1', role: 'assistant', content: 'reply 1' },
			{ id: 'u2', role: 'user', content: 'go south' }
		];

		await controller.deleteMessage(0);
		expect(confirmMock).toHaveBeenCalledWith('Delete this message and the 2 messages after it?');

		await controller.deleteMessage(2);
		expect(confirmMock).toHaveBeenLastCalledWith('Delete this message?');
	});

	it.each([
		['translateMessage', (c: GamePageController) => c.translateMessage(0)],
		['prepareMedia', (c: GamePageController) => c.prepareMedia('a glowing stone')],
		['generateMedia', (c: GamePageController) => c.generateMedia('a glowing stone')]
	])('%s starts no second paid request while one is running', async (_name, invoke) => {
		const pending: Array<(value: Response) => void> = [];
		const fetchMock = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.messages = [{ id: 'a1', role: 'assistant', content: 'reply' }];
		controller.mediaTargetIndex = 0;

		const first = invoke(controller);
		const second = invoke(controller);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		// Translation issues a second, sequential request, so keep draining
		// until the flow stops asking for one.
		for (let guard = 0; guard < 10 && pending.length > 0; guard += 1) {
			pending.splice(0).forEach((resolve) =>
				resolve(response({ text: 'prompt', translation: 'перевод', ...EMPTY_STATE }))
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		await Promise.all([first, second]);
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
