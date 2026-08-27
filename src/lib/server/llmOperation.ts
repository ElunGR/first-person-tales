/** Shared lifecycle for one explicit, cancellable LLM request. */
import { HttpError, isAbortError } from './http';
import { LLMError, type CompletionProvider } from './llm';
import { makeLlmClient } from './llmFactory';
import { registerOperation, unregisterOperation } from './operations';

export interface ClosableCompletionProvider extends CompletionProvider {
	aclose(): Promise<void>;
}

export interface LlmOperationDependencies {
	makeClient(): Promise<ClosableCompletionProvider>;
	register(operationId: string | null): AbortController | null;
	unregister(operationId: string | null, controller: AbortController | null): void;
}

const defaultDependencies: LlmOperationDependencies = {
	makeClient: makeLlmClient,
	register: registerOperation,
	unregister: unregisterOperation
};

/**
 * Create, register and always close one LLM client.
 * Domain-specific route errors remain the route's responsibility.
 */
export async function runLlmOperation<T>(
	request: Request,
	work: (llm: CompletionProvider, signal?: AbortSignal) => Promise<T>,
	dependencies: LlmOperationDependencies = defaultDependencies
): Promise<T> {
	const operationId = request.headers.get('X-Operation-ID');
	const llm = await dependencies.makeClient();
	const controller = dependencies.register(operationId);
	try {
		return await work(llm, controller?.signal);
	} catch (exc) {
		if (isAbortError(exc)) throw new HttpError(499, 'operation cancelled');
		if (exc instanceof LLMError) throw new HttpError(502, exc.message);
		throw exc;
	} finally {
		dependencies.unregister(operationId, controller);
		await llm.aclose();
	}
}
