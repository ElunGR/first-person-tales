import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamePageController } from '../src/lib/frontend/gamePage.svelte';
import type { StatePayload } from '../src/lib/frontend/types';

const EMPTY_STATE: StatePayload = {
	messages: [],
	media: [],
	can_undo_summary: false,
	last_narrator_prompt_tokens: null,
	recovery_message: null
};

function response(data: unknown): Response {
	return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
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
