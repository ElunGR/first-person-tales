/**
 * OpenAI-compatible LLM client with catalog-aware reasoning options.
 * Port of backend/llm.py.
 */
import { APPLICATION_USER_AGENT, DEFAULT_API_SERVER } from './config';

export class LLMError extends Error {
	constructor(message: string) {
		// Keep accidental HTTP-body suffixes out of public errors.
		super(message.replace(/(HTTP\s+\d{3})(?::.*)$/i, '$1'));
		this.name = 'LLMError';
	}
}

export interface TokenUsage {
	prompt_tokens: number | null;
	completion_tokens: number | null;
	total_tokens: number | null;
}

const DEFAULT_TIMEOUT_SECONDS = 180.0;

export function optionalTokenCount(value: unknown): number | null {
	if (typeof value === 'boolean') return null;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) return null;
		const count = Math.trunc(value);
		return count >= 0 ? count : null;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!/^-?\d+$/.test(trimmed)) return null;
		const count = parseInt(trimmed, 10);
		return count >= 0 ? count : null;
	}
	return null;
}

export function parseUsage(value: unknown): TokenUsage | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	const usage: TokenUsage = {
		prompt_tokens: optionalTokenCount(raw['prompt_tokens']),
		completion_tokens: optionalTokenCount(raw['completion_tokens']),
		total_tokens: optionalTokenCount(raw['total_tokens'])
	};
	if (usage.prompt_tokens === null && usage.completion_tokens === null && usage.total_tokens === null) {
		return null;
	}
	return usage;
}

/** Choose a catalog-supported reasoning effort, or omit the field. */
function reasoningOptionsPayload(
	supportsReasoningEffort: boolean,
	options: string[] | null | undefined
): Record<string, unknown> | null {
	if (!supportsReasoningEffort) return null;
	const normalized = (options ?? []).map((value) => value.trim().toLowerCase()).filter((value) => value);
	const effort = normalized.includes('high')
		? 'high'
		: normalized.length > 0
			? normalized[normalized.length - 1]
			: 'high';
	return { effort };
}

export interface LLMClientOptions {
	apiServer?: string;
	apiKey?: string;
	model?: string;
	timeoutSeconds?: number;
	supportsReasoningEffort?: boolean;
	reasoningEffortOptions?: string[];
}

export interface CompletionOptions {
	temperature?: number | null;
	frequencyPenalty?: number | null;
	presencePenalty?: number | null;
	maxCompletionTokens?: number | null;
	maxTokens?: number | null;
	topP?: number | null;
	signal?: AbortSignal;
}

/** Structural interface satisfied by LLMClient; lets tests inject fakes. */
export interface CompletionProvider {
	lastUsage: TokenUsage | null;
	complete(messages: Array<Record<string, string>>, options?: CompletionOptions): Promise<string>;
}

export class LLMClient {
	readonly apiServer: string;
	readonly apiKey: string;
	readonly model: string;
	readonly timeoutSeconds: number;
	readonly supportsReasoningEffort: boolean;
	readonly reasoningEffortOptions: string[];
	lastUsage: TokenUsage | null = null;

	constructor(options: LLMClientOptions = {}) {
		this.apiServer = options.apiServer ?? DEFAULT_API_SERVER;
		this.apiKey = options.apiKey ?? '';
		this.model = options.model ?? '';
		this.timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
		this.supportsReasoningEffort = options.supportsReasoningEffort ?? false;
		this.reasoningEffortOptions = options.reasoningEffortOptions ?? [];
	}

	private headers(): Record<string, string> {
		if (!this.apiKey.trim()) {
			throw new LLMError('Text API key is not configured; open Settings and save the key');
		}
		return {
			Authorization: `Bearer ${this.apiKey}`,
			'Content-Type': 'application/json',
			'User-Agent': APPLICATION_USER_AGENT
		};
	}

	/**
	 * Make exactly one narrator request.
	 *
	 * Retrying a non-idempotent completion after a timeout can bill a second
	 * response even when the first one reached Venice. The user can explicitly
	 * regenerate instead, so an uncertain network outcome is reported once.
	 */
	private async postOnce(url: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
		const headers = this.headers();
		const timeoutSignal = AbortSignal.timeout(this.timeoutSeconds * 1000);
		const signals = signal ? [timeoutSignal, signal] : [timeoutSignal];
		try {
			return await fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
				signal: AbortSignal.any(signals)
			});
		} catch (exc) {
			if (signal?.aborted) throw exc;
			if ((exc as Error)?.name === 'TimeoutError') {
				throw new LLMError('LLM request timed out; status is unknown and was not retried');
			}
			throw new LLMError('LLM connection failed; status is unknown and was not retried');
		}
	}

	/** Non-streaming completion using the provider's total token budget. */
	async complete(messages: Array<Record<string, string>>, options: CompletionOptions = {}): Promise<string> {
		if (!this.model) {
			throw new LLMError('text model is not configured; choose a model in Settings');
		}
		if (options.maxCompletionTokens != null && options.maxTokens != null) {
			throw new Error('pass max_completion_tokens instead of both token limit names');
		}
		const completionLimit = options.maxCompletionTokens ?? options.maxTokens ?? null;
		this.lastUsage = null;
		const reasoning = reasoningOptionsPayload(this.supportsReasoningEffort, this.reasoningEffortOptions);
		const payload: Record<string, unknown> = {
			model: this.model,
			messages,
			stream: false
		};
		if (reasoning !== null) payload['reasoning'] = reasoning;
		if (options.temperature != null) payload['temperature'] = options.temperature;
		if (options.frequencyPenalty != null) payload['frequency_penalty'] = options.frequencyPenalty;
		if (options.presencePenalty != null) payload['presence_penalty'] = options.presencePenalty;
		if (completionLimit != null) payload['max_completion_tokens'] = completionLimit;
		if (options.topP != null) payload['top_p'] = options.topP;

		const response = await this.postOnce(
			`${this.apiServer.replace(/\/+$/, '')}/chat/completions`,
			payload,
			options.signal
		);
		if (response.status >= 400) {
			throw new LLMError(`text provider rejected the request (HTTP ${response.status})`);
		}
		let data: unknown;
		try {
			data = await response.json();
		} catch {
			throw new LLMError('invalid JSON from completion endpoint');
		}
		if (typeof data !== 'object' || data === null || Array.isArray(data)) {
			throw new LLMError('text provider returned an invalid completion payload');
		}
		const body = data as Record<string, unknown>;
		this.lastUsage = parseUsage(body['usage']);
		const choices = body['choices'];
		if (!Array.isArray(choices) || choices.length === 0 || typeof choices[0] !== 'object' || choices[0] === null) {
			throw new LLMError('completion returned no choices');
		}
		const choice = choices[0] as Record<string, unknown>;
		if (String(choice['finish_reason'] ?? '').toLowerCase() === 'length') {
			throw new LLMError('completion stopped at max_completion_tokens; increase the total budget');
		}
		const message = choice['message'];
		if (typeof message !== 'object' || message === null) {
			throw new LLMError('completion returned no assistant message');
		}
		const messageBody = message as Record<string, unknown>;
		let content: unknown = messageBody['content'];
		if (content === null || content === undefined) {
			// Some reasoning models put the final answer under other keys.
			content = messageBody['reasoning_content'] ?? messageBody['reasoning'];
		}
		if (content === null || content === undefined) {
			throw new LLMError('completion returned no assistant content');
		}
		return String(content);
	}

	/** Kept for API symmetry with the Python client; fetch needs no close. */
	async aclose(): Promise<void> {
		// No shared resources to release.
	}

}
