/** Shared helpers for API route handlers. */
import { type RequestHandler } from '@sveltejs/kit';
import type { z } from 'zod';
import { HttpError, jsonError } from './http';
import type { StateResponse } from './models';
import { getSession, recoveryMessage, type Session } from './session';

/**
 * Wrap an endpoint so HttpError instances become JSON { detail } responses.
 * SvelteKit converts uncaught endpoint errors into generic 500 pages before
 * the handle hook sees them, so mapping must happen inside the handler.
 */
export function apiHandler<
	Params extends Partial<Record<string, string>> = Partial<Record<string, string>>
>(fn: RequestHandler<Params>): RequestHandler<Params> {
	return async (event) => {
		try {
			return await fn(event);
		} catch (exc) {
			if (exc instanceof HttpError) {
				return jsonError(exc.status, exc.detail);
			}
			throw exc;
		}
	};
}

/** Parse and validate a JSON body; mirrors FastAPI's 422 behavior. */
export async function parseBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw new HttpError(422, 'There was an error parsing the body');
	}
	const result = schema.safeParse(raw);
	if (!result.success) {
		throw new HttpError(422, result.error.issues);
	}
	return result.data;
}

/** Parse an optional JSON body (FastAPI `body: Model | None = None`). */
export async function parseOptionalBody<T extends z.ZodTypeAny>(
	request: Request,
	schema: T
): Promise<z.infer<T> | null> {
	const text = await request.text();
	if (!text.trim()) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new HttpError(422, 'There was an error parsing the body');
	}
	if (raw === null) return null;
	const result = schema.safeParse(raw);
	if (!result.success) {
		throw new HttpError(422, result.error.issues);
	}
	return result.data;
}

export function stateResponse(): StateResponse {
	const s = getSession();
	return {
		messages: [...s.messages],
		media: [...s.media],
		can_undo_summary: s.canUndoSummary,
		last_narrator_prompt_tokens: s.lastNarratorPromptTokens,
		recovery_message: recoveryMessage()
	};
}

/** Keep legacy index URLs safe when a browser has stale state. */
export function validateMessageTarget(
	session: Session,
	index: number,
	messageId: string | null | undefined
): void {
	if (index < 0 || index >= session.messages.length) {
		throw new HttpError(404, 'message not found');
	}
	if (messageId != null && session.messages[index].id !== messageId) {
		throw new HttpError(409, 'message changed; refresh state and retry');
	}
}

/** Parse a {index} path parameter the way FastAPI parses `int`. */
export function parseIndex(raw: string | undefined): number {
	if (raw === undefined || !/^[+-]?\d+$/.test(raw)) {
		throw new HttpError(422, [
			{ type: 'int_parsing', loc: ['path', 'index'], msg: 'Input should be a valid integer' }
		]);
	}
	return parseInt(raw, 10);
}
