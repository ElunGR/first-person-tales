/**
 * POST /world/expand: one explicit request that returns a world draft.
 * The route must send the idea verbatim, spend no call on an empty idea, and
 * never persist anything — saving stays a separate, explicit action.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMError } from '../src/lib/server/llm';
import { useTempPromptRoot } from './helpers';

const llm = vi.hoisted(() => ({
	messages: [] as Array<{ role: string; content: string }>,
	parameters: null as Record<string, unknown> | null,
	reply: 'EXPANDED WORLD',
	failure: null as Error | null
}));

vi.mock('$lib/server/llmFactory', () => ({
	makeLlmClient: async () => ({
		lastUsage: null,
		complete: async (
			messages: Array<{ role: string; content: string }>,
			options?: { parameters?: Record<string, unknown> | null }
		) => {
			llm.messages = messages;
			llm.parameters = options?.parameters ?? null;
			if (llm.failure) throw llm.failure;
			return llm.reply;
		},
		aclose: async () => {}
	})
}));

useTempPromptRoot();

afterEach(() => {
	llm.messages = [];
	llm.parameters = null;
	llm.reply = 'EXPANDED WORLD';
	llm.failure = null;
});

function expandRequest(body: unknown): Request {
	return new Request('http://localhost/world/expand', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

describe('world expansion route', () => {
	it('returns the expanded text and sends the idea verbatim after the prompt', async () => {
		const { POST } = await import('../src/routes/world/expand/+server');

		const response = await POST({ request: expandRequest({ text: 'Rain-soaked noir city with tea houses' }) } as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ text: 'EXPANDED WORLD' });
		expect(llm.messages).toEqual([
			{ role: 'system', content: 'EXPAND_WORLD_SENTINEL' },
			// The idea is the user message, so instruction-like text inside it is
			// material for the prompt rather than a template substitution.
			{ role: 'user', content: 'Rain-soaked noir city with tea houses' }
		]);
		expect(llm.parameters?.temperature).toBe(0.7);
		// The visible text is ~2500 tokens; reasoning shares the same budget, so
		// the cap must stay well above a bare text estimate.
		expect(llm.parameters?.max_completion_tokens).toBe(9000);
	});

	it('rejects an empty idea without calling the model', async () => {
		const { POST } = await import('../src/routes/world/expand/+server');

		const response = await POST({ request: expandRequest({ text: '   ' }) } as never);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ detail: 'text is required' });
		expect(llm.messages).toEqual([]);
	});

	it('reports a provider failure as a gateway error', async () => {
		llm.failure = new LLMError('text provider rejected the request (HTTP 401)');
		const { POST } = await import('../src/routes/world/expand/+server');

		const response = await POST({ request: expandRequest({ text: 'idea' }) } as never);

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({ detail: 'text provider rejected the request (HTTP 401)' });
	});
});
