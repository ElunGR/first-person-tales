import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../src/lib/server/http';
import { LLMError, type TokenUsage } from '../src/lib/server/llm';
import {
	runLlmOperation,
	type ClosableCompletionProvider,
	type LlmOperationDependencies
} from '../src/lib/server/llmOperation';

function fixture() {
	const close = vi.fn(async () => {});
	const controller = new AbortController();
	const llm: ClosableCompletionProvider = {
		lastUsage: null as TokenUsage | null,
		complete: vi.fn(async () => 'ok'),
		aclose: close
	};
	const unregister = vi.fn();
	const dependencies: LlmOperationDependencies = {
		makeClient: vi.fn(async () => llm),
		register: vi.fn(() => controller),
		unregister
	};
	const request = new Request('http://local.test/chat', {
		headers: { 'X-Operation-ID': 'operation-1' }
	});
	return { close, controller, dependencies, llm, request, unregister };
}

describe('runLlmOperation', () => {
	it('returns work and releases resources on success', async () => {
		const f = fixture();
		await expect(runLlmOperation(f.request, async (_llm, signal) => signal, f.dependencies)).resolves.toBe(
			f.controller.signal
		);
		expect(f.unregister).toHaveBeenCalledWith('operation-1', f.controller);
		expect(f.close).toHaveBeenCalledOnce();
	});

	it('maps LLM errors and still releases resources', async () => {
		const f = fixture();
		await expect(
			runLlmOperation(
				f.request,
				async () => {
					throw new LLMError('provider failed');
				},
				f.dependencies
			)
		).rejects.toMatchObject({ status: 502, detail: 'provider failed' } satisfies Partial<HttpError>);
		expect(f.unregister).toHaveBeenCalledOnce();
		expect(f.close).toHaveBeenCalledOnce();
	});

	it('maps caller aborts and still releases resources', async () => {
		const f = fixture();
		await expect(
			runLlmOperation(
				f.request,
				async () => {
					throw new DOMException('stopped', 'AbortError');
				},
				f.dependencies
			)
		).rejects.toMatchObject({ status: 499, detail: 'operation cancelled' } satisfies Partial<HttpError>);
		expect(f.unregister).toHaveBeenCalledOnce();
		expect(f.close).toHaveBeenCalledOnce();
	});
});
