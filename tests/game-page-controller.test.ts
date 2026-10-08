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
	image_style: 'none',
	providers: { venice: { text_model: 'narrator', image_model: 'image' } },
	key_configured: { venice: true },
	key_source: { venice: 'keychain' }
};

function response(data: unknown): Response {
	return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
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

describe('GamePageController bootstrap ownership', () => {
	it('blocks import until both initial requests finish so an old state cannot overwrite a loaded game', async () => {
		let finishState!: (value: Response) => void;
		let finishSettings!: (value: Response) => void;
		const oldState = { ...EMPTY_STATE, messages: [{ id: 'a', role: 'user', content: 'Game A' }] };
		const newState = { ...EMPTY_STATE, messages: [{ id: 'b', role: 'user', content: 'Game B' }] };
		const fetchMock = vi.fn((url: string) => {
			if (url === '/state') return new Promise<Response>((resolve) => { finishState = resolve; });
			if (url === '/settings') return new Promise<Response>((resolve) => { finishSettings = resolve; });
			if (url === '/import') return Promise.resolve(response(newState));
			throw new Error('Unexpected request');
		});
		vi.stubGlobal('fetch', fetchMock);
		const confirmMock = vi.fn(() => true);
		vi.stubGlobal('confirm', confirmMock);
		const text = vi.fn(async () => JSON.stringify({ version: 2 }));
		const file = { text } as unknown as File;
		const controller = new GamePageController();
		const initial = controller.initialize();

		expect(controller.busy).toBe(true);
		expect(controller.statusText).toBe('Loading game…');
		await controller.importHistory(file);
		await controller.initialize();
		expect(text).not.toHaveBeenCalled();
		expect(confirmMock).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		finishSettings(response(SAVED_SETTINGS));
		await vi.waitFor(() => expect(controller.settings).toEqual(SAVED_SETTINGS));
		expect(controller.busy).toBe(true);
		await controller.importHistory(file);
		expect(text).not.toHaveBeenCalled();
		finishState(response(oldState));
		await initial;
		expect(controller.busy).toBe(false);
		await controller.importHistory(file);
		expect(controller.messages).toEqual(newState.messages);
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/state', '/settings', '/import']);
	});

	it.each(['/state', '/settings'])('does not release bootstrap busy when %s fails before the other request finishes', async (failedPath) => {
		let finishOther!: (value: Response) => void;
		vi.stubGlobal('fetch', vi.fn((url: string) => url === failedPath
			? Promise.reject(new Error('Initial request failed'))
			: new Promise<Response>((resolve) => { finishOther = resolve; })));
		const controller = new GamePageController();
		const initial = controller.initialize();
		const rejected = expect(initial).rejects.toThrow('Initial request failed');
		for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
		expect(controller.busy).toBe(true);
		expect(controller.statusText).toBe('Loading game…');
		finishOther(response(failedPath === '/state' ? SAVED_SETTINGS : EMPTY_STATE));
		await rejected;
		expect(controller.busy).toBe(false);
		expect(controller.statusText).toBe('Ready');
	});
});

describe('GamePageController game import and export', () => {
	function savePayload(): Record<string, unknown> {
		return {
			version: 2,
			messages: [],
			narrator_start: 0,
			summary_checkpoints: [],
			last_narrator_prompt_tokens: null,
			player_character_description: 'Imported explorer',
			world_description: ''
		};
	}

	function savedFile(raw: unknown) {
		const text = vi.fn(async () => JSON.stringify(raw));
		return { file: { text } as unknown as File, text };
	}

	function controllerWithDrafts() {
		const controller = new GamePageController();
		controller.applyState({
			...EMPTY_STATE,
			messages: [{ id: 'old-user', role: 'user', content: 'Old history' }],
			media: [{ id: 'old-image', message_id: 'old-user', kind: 'image', file: 'old.png' }]
		});
		controller.editingMessageId = 'old-user';
		controller.inputDraft = 'Unsent draft';
		controller.characterOpen = true;
		controller.characterText = 'Old character draft';
		controller.characterGameRevision = 'old-game';
		controller.worldOpen = true;
		controller.worldText = 'Old world draft';
		controller.worldGameRevision = 'old-game';
		controller.mediaOpen = true;
		controller.mediaTargetIndex = 0;
		controller.mediaPreparedText = 'Old image prompt';
		return controller;
	}

	function expectDraftsPreserved(controller: GamePageController) {
		expect(controller.messages).toEqual([{ id: 'old-user', role: 'user', content: 'Old history' }]);
		expect(controller.media).toHaveLength(1);
		expect(controller.editingMessageId).toBe('old-user');
		expect(controller.inputDraft).toBe('Unsent draft');
		expect(controller.characterOpen).toBe(true);
		expect(controller.characterText).toBe('Old character draft');
		expect(controller.characterGameRevision).toBe('old-game');
		expect(controller.worldOpen).toBe(true);
		expect(controller.worldText).toBe('Old world draft');
		expect(controller.worldGameRevision).toBe('old-game');
		expect(controller.mediaOpen).toBe(true);
		expect(controller.mediaTargetIndex).toBe(0);
		expect(controller.mediaPreparedText).toBe('Old image prompt');
	}

	it('ignores import while busy before reading the file or asking for confirmation', async () => {
		const { file, text } = savedFile(savePayload());
		const confirmMock = vi.fn((_message: string) => true);
		const fetchMock = vi.fn();
		vi.stubGlobal('confirm', confirmMock);
		vi.stubGlobal('fetch', fetchMock);
		const controller = controllerWithDrafts();
		controller.busy = true;
		controller.statusText = 'Narrator is thinking…';

		await controller.importHistory(file);

		expect(text).not.toHaveBeenCalled();
		expect(confirmMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(controller.busy).toBe(true);
		expect(controller.statusText).toBe('Narrator is thinking…');
		expectDraftsPreserved(controller);
	});

	it('owns busy state during file reading and the import request and blocks repeated actions', async () => {
		let finishRead!: (text: string) => void;
		let finishImport!: (result: Response) => void;
		const text = vi.fn(() => new Promise<string>((resolve) => { finishRead = resolve; }));
		const file = { text } as unknown as File;
		const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finishImport = resolve; }));
		vi.stubGlobal('confirm', vi.fn(() => true));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();

		const importing = controller.importHistory(file);
		expect(controller.busy).toBe(true);
		expect(controller.statusText).toBe('Reading game save…');
		await controller.importHistory(file);
		await controller.downloadHistory('json');
		await controller.sendCurrent();
		expect(text).toHaveBeenCalledTimes(1);
		expect(fetchMock).not.toHaveBeenCalled();
		finishRead(JSON.stringify(savePayload()));
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(controller.statusText).toBe('Importing game…');
		await controller.importHistory(file);
		expect(text).toHaveBeenCalledTimes(1);
		finishImport(response(EMPTY_STATE));
		await importing;

		expect(controller.busy).toBe(false);
		expect(controller.statusText).toBe('Ready');
	});

	it('explains the version 2 replacement and clears stale editors only after success', async () => {
		const payload = savePayload();
		const { file } = savedFile(payload);
		const confirmMock = vi.fn((_message: string) => true);
		const fetchMock = vi.fn().mockResolvedValue(response(EMPTY_STATE));
		vi.stubGlobal('confirm', confirmMock);
		vi.stubGlobal('fetch', fetchMock);
		const controller = controllerWithDrafts();

		await controller.importHistory(file);

		const confirmation = confirmMock.mock.calls[0][0] as string;
		expect(confirmation).toContain('replace the current history, character description, and world description');
		expect(confirmation).toContain('Export the current game as JSON first');
		expect(confirmation).toContain('Current images will be deleted');
		expect(confirmation).toContain('cannot be restored from the JSON save or backup');
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ confirm: true, data: payload });
		expect(controller.messages).toEqual([]);
		expect(controller.media).toEqual([]);
		expect(controller.editingMessageId).toBeNull();
		expect(controller.inputDraft).toBe('');
		expect(controller.characterOpen).toBe(false);
		expect(controller.characterText).toBe('');
		expect(controller.characterGameRevision).toBeUndefined();
		expect(controller.worldOpen).toBe(false);
		expect(controller.worldText).toBe('');
		expect(controller.worldGameRevision).toBeUndefined();
		expect(controller.mediaOpen).toBe(false);
		expect(controller.mediaTargetIndex).toBeNull();
		expect(controller.mediaPreparedText).toBe('');
		expect(controller.busy).toBe(false);
		expect(toastState.message).toBe('Game imported');
	});

	it('keeps history and drafts on cancelled confirmation and releases busy', async () => {
		const { file } = savedFile(savePayload());
		const fetchMock = vi.fn();
		vi.stubGlobal('confirm', vi.fn(() => false));
		vi.stubGlobal('fetch', fetchMock);
		const controller = controllerWithDrafts();

		await controller.importHistory(file);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(controller.busy).toBe(false);
		expectDraftsPreserved(controller);
	});

	it.each([null, [], {}, { version: 1 }, { version: 3 }, { version: '2' }, { version: true }])(
		'rejects unsupported JSON root or version %j before confirmation or request', async (raw) => {
			const { file } = savedFile(raw);
			const confirmMock = vi.fn((_message: string) => true);
			const fetchMock = vi.fn();
			vi.stubGlobal('confirm', confirmMock);
			vi.stubGlobal('fetch', fetchMock);
			const controller = controllerWithDrafts();

			await expect(controller.importHistory(file)).rejects.toThrow('Unsupported game save version');

			expect(confirmMock).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
			expect(controller.busy).toBe(false);
			expectDraftsPreserved(controller);
		}
	);

	it('rejects malformed JSON without replacing history or descriptions', async () => {
		const file = { text: vi.fn(async () => '{not json') } as unknown as File;
		const confirmMock = vi.fn((_message: string) => true);
		const fetchMock = vi.fn();
		vi.stubGlobal('confirm', confirmMock);
		vi.stubGlobal('fetch', fetchMock);
		const controller = controllerWithDrafts();

		await expect(controller.importHistory(file)).rejects.toThrow();

		expect(confirmMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(controller.busy).toBe(false);
		expectDraftsPreserved(controller);
	});

	it('preserves drafts and releases busy if reading the file fails', async () => {
		const file = { text: vi.fn(async () => { throw new Error('Read failed'); }) } as unknown as File;
		const controller = controllerWithDrafts();

		await expect(controller.importHistory(file)).rejects.toThrow('Read failed');

		expect(controller.busy).toBe(false);
		expectDraftsPreserved(controller);
	});

	it.each([400, 409, 413, 422])('preserves drafts and releases busy on a definite HTTP %s import refusal', async (status) => {
		const { file } = savedFile(savePayload());
		vi.stubGlobal('confirm', vi.fn(() => true));
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Import rolled back' }), {
			status, headers: { 'Content-Type': 'application/json' }
		})));
		const controller = controllerWithDrafts();

		await expect(controller.importHistory(file)).rejects.toThrow('Import rolled back');

		expect(controller.requiresReload).toBe(false);
		expect(controller.busy).toBe(false);
		expect(controller.statusText).toBe('Ready');
		expectDraftsPreserved(controller);
	});

	it('preserves drafts but requires reload even when an HTTP 500 message claims rollback', async () => {
		const { file } = savedFile(savePayload());
		vi.stubGlobal('confirm', vi.fn(() => true));
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Import rolled back' }), {
			status: 500, headers: { 'Content-Type': 'application/json' }
		}));
		vi.stubGlobal('fetch', fetchMock);
		const controller = controllerWithDrafts();
		await expect(controller.importHistory(file)).rejects.toThrow('Import rolled back');
		expect(controller.requiresReload).toBe(true);
		expect(controller.busy).toBe(true);
		expect(controller.statusText).toBe('Import outcome unknown — reload the page');
		expectDraftsPreserved(controller);
		await controller.sendCurrent();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each(['lost transport', 'HTTP 500 after commit', 'HTTP 503 after commit', 'malformed success JSON', 'missing state', 'null state'])
		('blocks old-game actions after a possibly committed import with %s without retrying or erasing drafts', async (failure) => {
			const { file, text } = savedFile(savePayload());
			const confirmMock = vi.fn(() => true);
			vi.stubGlobal('confirm', confirmMock);
			let serverGame = 'A';
			const fetchMock = vi.fn(async () => {
				serverGame = 'B'; // The import committed, but its acknowledgement cannot be trusted.
				if (failure === 'lost transport') throw new TypeError('Failed to fetch');
				if (failure.startsWith('HTTP ')) return new Response(JSON.stringify({ detail: 'Could not acknowledge the committed import' }), {
					status: failure.includes('503') ? 503 : 500, headers: { 'Content-Type': 'application/json' }
				});
				if (failure === 'malformed success JSON') return new Response('{broken success', { status: 200 });
				return response(failure === 'null state' ? null : {});
			});
			vi.stubGlobal('fetch', fetchMock);
			const controller = controllerWithDrafts();
			controller.settings = SAVED_SETTINGS;
			controller.canUndoSummary = true;

			await expect(controller.importHistory(file)).rejects.toThrow('game actions are blocked until reload');
			expect(serverGame).toBe('B');
			expect(controller.requiresReload).toBe(true);
			expect(controller.busy).toBe(true);
			expect(controller.statusText).toBe('Import outcome unknown — reload the page');
			expectDraftsPreserved(controller);
			const values = { ...SAVED_SETTINGS, text_model: 'narrator', image_model: 'image', api_key: '' };
			for (const invoke of [
				() => controller.sendCurrent(), () => controller.improveDraft(),
				() => controller.saveEdit(0, 'Old edit'), () => controller.resendEdit(0, 'Old resend'),
				() => controller.deleteMessage(0), () => controller.regenerateMessage(0),
				() => controller.translateMessage(0), () => controller.summarize(),
				() => controller.undoSummary(), () => controller.newGame(),
				() => controller.prepareMedia('Old scene'), () => controller.generateMedia('Old prompt'),
				() => controller.deleteMedia('old-image'), () => controller.saveCharacter('Old hero'),
				() => controller.saveWorld('Old world'), () => controller.saveSettings(values),
				() => controller.refreshModels(values), () => controller.openMedia(0),
				() => controller.openSettings(), () => controller.openCharacter(),
				() => controller.openWorld(), () => controller.importHistory(file),
				() => controller.downloadHistory('json'), () => controller.initialize()
			]) await invoke();
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(text).toHaveBeenCalledTimes(1);
			expect(confirmMock).toHaveBeenCalledTimes(1);
			expect(controller.busy).toBe(true);
			expect(controller.showStop).toBe(false);
			expectDraftsPreserved(controller);
		});

	it('ignores export while another action owns busy state', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.busy = true;
		controller.statusText = 'Importing game…';

		await controller.downloadHistory('json');

		expect(fetchMock).not.toHaveBeenCalled();
		expect(controller.busy).toBe(true);
		expect(controller.statusText).toBe('Importing game…');
	});

	it.each(['json', 'markdown'] as const)('downloads %s with compatible filename and cleans its temporary URL', async (format) => {
		const click = vi.fn();
		const anchor = { href: '', download: '', click };
		const createElement = vi.fn(() => anchor);
		vi.stubGlobal('document', { createElement });
		const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-download');
		const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const fetchMock = vi.fn().mockResolvedValue(response(savePayload()));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();

		await controller.downloadHistory(format);

		expect(fetchMock).toHaveBeenCalledWith(`/export?format=${format}`);
		expect(createElement).toHaveBeenCalledWith('a');
		expect(createUrl).toHaveBeenCalledOnce();
		expect(anchor.href).toBe('blob:test-download');
		expect(anchor.download).toBe(format === 'json' ? 'history.json' : 'history.md');
		expect(click).toHaveBeenCalledOnce();
		expect(revokeUrl).toHaveBeenCalledWith('blob:test-download');
		expect(controller.busy).toBe(false);
	});

	it('keeps busy throughout export and blocks import before its file is read', async () => {
		let finishExport!: (result: Response) => void;
		const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finishExport = resolve; }));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		const { file, text } = savedFile(savePayload());

		const exporting = controller.downloadHistory('json');
		expect(controller.busy).toBe(true);
		expect(controller.statusText).toBe('Exporting game save…');
		await controller.importHistory(file);
		await controller.downloadHistory('markdown');
		expect(text).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		finishExport(new Response(null, { status: 500 }));
		await expect(exporting).rejects.toThrow('Could not export game');

		expect(controller.busy).toBe(false);
		expect(controller.statusText).toBe('Ready');
	});

	it('cleans the download URL and releases busy even if browser download fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(savePayload())));
		vi.stubGlobal('document', { createElement: vi.fn(() => ({
			href: '', download: '', click: () => { throw new Error('Download blocked'); }
		})) });
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed-download');
		const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const controller = new GamePageController();

		await expect(controller.downloadHistory('json')).rejects.toThrow('Download blocked');

		expect(revokeUrl).toHaveBeenCalledWith('blob:failed-download');
		expect(controller.busy).toBe(false);
	});
});

describe('GamePageController settings status', () => {
	it('owns busy during Save and prevents duplicate saves, model refreshes and image-settings loads', async () => {
		let finishSave!: (value: Response) => void;
		const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finishSave = resolve; }));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.settings = SAVED_SETTINGS;
		controller.settingsOpen = true;
		const values = { ...SAVED_SETTINGS, image_style: 'anime' as const, text_model: 'narrator', image_model: 'image', api_key: '' };
		const saving = controller.saveSettings(values);
		expect(controller.busy).toBe(true);
		expect(controller.statusText).toBe('Saving settings…');
		await controller.saveSettings({ ...values, image_style: 'watercolor' });
		controller.refreshModels(values);
		await controller.openMedia(0);
		await controller.openSettings();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(controller.mediaOpen).toBe(false);
		finishSave(response({ ...SAVED_SETTINGS, image_style: 'anime' }));
		await saving;
		expect(controller.busy).toBe(false);
		expect(controller.statusText).toBe('Ready');
		expect(controller.settings?.image_style).toBe('anime');
		expect(controller.settingsOpen).toBe(false);
	});

	it('preserves settings and the open form after a failed Save and releases busy for manual retry', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Could not save settings' }), {
			status: 500, headers: { 'Content-Type': 'application/json' }
		}));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.settings = SAVED_SETTINGS;
		controller.settingsOpen = true;
		await controller.saveSettings({ ...SAVED_SETTINGS, image_style: 'anime', text_model: 'narrator', image_model: 'image', api_key: '' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(controller.settings).toBe(SAVED_SETTINGS);
		expect(controller.settingsOpen).toBe(true);
		expect(controller.busy).toBe(false);
		expect(controller.statusText).toBe('Ready');
		expect(toastState.message).toContain('Could not save settings');
	});

	it('does not let Save release the busy ownership of a model refresh', async () => {
		let finishSave!: (value: Response) => void;
		let finishModels!: (value: Response) => void;
		const fetchMock = vi.fn()
			.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishSave = resolve; }))
			.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishModels = resolve; }));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.settings = SAVED_SETTINGS;
		controller.settingsOpen = true;
		const values = { ...SAVED_SETTINGS, image_style: 'anime' as const, text_model: 'narrator', image_model: 'image', api_key: '' };
		controller.refreshModels(values);
		expect(controller.busy).toBe(true);
		await controller.saveSettings(values);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		finishSave(response({ ...SAVED_SETTINGS, image_style: 'anime' }));
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(controller.busy).toBe(true);
		await controller.saveSettings(values);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		finishModels(response({ models: { image: [] } }));
		await vi.waitFor(() => expect(controller.busy).toBe(false));
		expect(controller.settingsOpen).toBe(true);
		expect(controller.settings?.image_style).toBe('anime');
	});

	it('persists image style through Save and restores it from the API response', async () => {
		const fetchMock = vi.fn().mockResolvedValue(response({ ...SAVED_SETTINGS, image_style: 'anime' }));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.settingsOpen = true;

		controller.saveSettings({
			...SAVED_SETTINGS,
			text_model: 'narrator',
			image_model: 'image',
			image_style: 'anime',
			api_key: ''
		});
		await vi.waitFor(() => expect(controller.settingsOpen).toBe(false));

		expect(controller.settings?.image_style).toBe('anime');
		expect(fetchMock).toHaveBeenCalledWith('/settings', expect.objectContaining({
			method: 'PUT',
			body: expect.any(String)
		}));
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ image_style: 'anime' });
	});

	it('preserves the selected image style when Refresh models saves the form', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(response({ ...SAVED_SETTINGS, image_style: 'watercolor' }))
			.mockResolvedValueOnce(response({ models: { image: [] } }));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.settings = SAVED_SETTINGS;
		controller.settingsOpen = true;

		controller.refreshModels({
			...SAVED_SETTINGS,
			text_model: 'narrator',
			image_model: 'image',
			image_style: 'watercolor',
			api_key: ''
		});
		await vi.waitFor(() => expect(controller.busy).toBe(false));

		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ image_style: 'watercolor' });
		expect(controller.settings?.image_style).toBe('watercolor');
		expect(controller.settingsOpen).toBe(true);
		expect(fetchMock.mock.calls[1][0]).toBe('/settings/models/refresh?provider=venice');
	});

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

describe('GamePageController image style snapshot', () => {
	it('reloads image settings before opening the dialog rather than using a stale cache', async () => {
		let resolveSettings!: (value: Response) => void;
		const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveSettings = resolve; }));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.settings = SAVED_SETTINGS;

		const opening = controller.openMedia(0);
		expect(controller.mediaOpen).toBe(false);
		expect(controller.mediaTargetIndex).toBeNull();
		expect(controller.busy).toBe(true);
		await controller.generateMedia('A stone bridge.');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		resolveSettings(response({ ...SAVED_SETTINGS, image_style: 'anime' }));
		await opening;

		expect(controller.mediaOpen).toBe(true);
		expect(controller.mediaImageStyle).toBe('anime');
		expect(controller.busy).toBe(false);
	});

	it('does not open a dialog with an unknown style after a settings failure and permits retry', async () => {
		const fetchMock = vi.fn()
			.mockRejectedValueOnce(new Error('Settings unavailable'))
			.mockResolvedValueOnce(response({ ...SAVED_SETTINGS, image_style: 'anime' }));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.settings = null;

		await controller.openMedia(0);
		expect(controller.mediaOpen).toBe(false);
		expect(controller.mediaTargetIndex).toBeNull();
		expect(controller.busy).toBe(false);
		expect(toastState.message).toBe('Could not load image settings: Settings unavailable');
		await controller.generateMedia('A stone bridge.');
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await controller.openMedia(0);
		expect(controller.mediaOpen).toBe(true);
		expect(controller.mediaImageStyle).toBe('anime');
	});

	it('sends the shown style even when cached settings change and leaves the editable prompt intact', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(response({ ...SAVED_SETTINGS, image_style: 'anime' }))
			.mockResolvedValueOnce(response({ text: 'A stone bridge.' }))
			.mockResolvedValueOnce(response(EMPTY_STATE));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		controller.messages = [{ id: 'a1', role: 'assistant', content: 'A scene' }];

		await controller.openMedia(0);
		await controller.prepareMedia('the bridge');
		expect(controller.mediaPreparedText).toBe('A stone bridge.');
		controller.settings = { ...SAVED_SETTINGS, image_style: 'watercolor' };
		await controller.generateMedia(controller.mediaPreparedText);

		expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string)).toEqual({
			kind: 'image', text: 'A stone bridge.', image_style: 'anime', message_id: 'a1'
		});
		expect(controller.mediaPreparedText).toBe('A stone bridge.');
	});
});

describe('GamePageController description revision tokens', () => {
	it.each(['character', 'world'] as const)('roundtrips the loaded %s game revision and updates it after Save', async (kind) => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(response({ content: 'Loaded description', game_revision: 'loaded-game' }))
			.mockResolvedValueOnce(response({ content: 'Saved description', game_revision: 'saved-game' }));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		const revisionKey = kind === 'character' ? 'characterGameRevision' : 'worldGameRevision';
		const contentKey = kind === 'character' ? 'characterText' : 'worldText';
		const openKey = kind === 'character' ? 'characterOpen' : 'worldOpen';

		if (kind === 'character') await controller.openCharacter();
		else await controller.openWorld();
		expect(controller[revisionKey]).toBe('loaded-game');
		if (kind === 'character') await controller.saveCharacter('Edited description');
		else await controller.saveWorld('Edited description');

		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
			content: 'Edited description', game_revision: 'loaded-game'
		});
		expect(controller[revisionKey]).toBe('saved-game');
		expect(controller[contentKey]).toBe('Saved description');
		expect(controller[openKey]).toBe(false);
	});

	it.each(['character', 'world'] as const)('preserves the %s editor and token when a switched game rejects Save with 409', async (kind) => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(response({ content: 'Unsaved draft', game_revision: 'old-game' }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Game changed; reopen the editor' }), {
				status: 409, headers: { 'Content-Type': 'application/json' }
			}));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		const revisionKey = kind === 'character' ? 'characterGameRevision' : 'worldGameRevision';
		const contentKey = kind === 'character' ? 'characterText' : 'worldText';
		const openKey = kind === 'character' ? 'characterOpen' : 'worldOpen';

		if (kind === 'character') {
			await controller.openCharacter();
			await controller.saveCharacter('Unsaved draft');
		} else {
			await controller.openWorld();
			await controller.saveWorld('Unsaved draft');
		}

		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ content: 'Unsaved draft', game_revision: 'old-game' });
		expect(fetchMock).toHaveBeenCalledTimes(2); // One GET and one PUT, never a retry.
		expect(controller[openKey]).toBe(true);
		expect(controller[contentKey]).toBe('Unsaved draft');
		expect(controller[revisionKey]).toBe('old-game');
		expect(controller.busy).toBe(false);
		expect(toastState.message).toContain('Game changed; reopen the editor');
	});

	it.each(['character', 'world'] as const)('supports legacy %s responses without accidentally sending a cached token', async (kind) => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(response({ content: 'Legacy description' }))
			.mockResolvedValueOnce(response({ content: 'Saved legacy description' }));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new GamePageController();
		const revisionKey = kind === 'character' ? 'characterGameRevision' : 'worldGameRevision';
		controller[revisionKey] = 'cached-game';

		if (kind === 'character') {
			await controller.openCharacter();
			await controller.saveCharacter('Edited legacy description');
		} else {
			await controller.openWorld();
			await controller.saveWorld('Edited legacy description');
		}

		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ content: 'Edited legacy description' });
		expect(controller[revisionKey]).toBeUndefined();
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
