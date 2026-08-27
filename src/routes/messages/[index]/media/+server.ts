import fs from 'node:fs';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import { parseBody, parseIndex, stateResponse, validateMessageTarget } from '$lib/server/api';
import { apiHandler } from '$lib/server/api';
import { HttpError, isAbortError } from '$lib/server/http';
import { generateToFile, ImageGenError } from '$lib/server/imageGen';
import { sessionLock } from '$lib/server/lock';
import { MediaGenerateRequestSchema } from '$lib/server/models';
import { imagesDir } from '$lib/server/paths';
import { ProviderError } from '$lib/server/providerApi';
import { registerOperation, unregisterOperation } from '$lib/server/operations';
import { getSession, KeyError } from '$lib/server/session';

export const POST = apiHandler(async ({ params, request }) => {
	const index = parseIndex(params.index);
	const operationId = request.headers.get('X-Operation-ID');
	const body = await parseBody(request, MediaGenerateRequestSchema);
	const preparedText = body.text.trim();
	if (!preparedText) {
		throw new HttpError(400, 'text is required');
	}
	let messageId: string;
	await sessionLock.runExclusive(() => {
		const session = getSession();
		validateMessageTarget(session, index, body.message_id);
		const message = session.messages[index];
		if (message.role !== 'assistant' || message.kind === 'branch') {
			throw new HttpError(400, 'only narrator messages can have media');
		}
		messageId = message.id;
	});
	const controller = registerOperation(operationId);
	let name: string;
	try {
		name = await generateToFile(preparedText, { signal: controller?.signal });
	} catch (exc) {
		if (isAbortError(exc)) throw new HttpError(499, 'operation cancelled');
		if (exc instanceof ProviderError || exc instanceof ImageGenError) {
			throw new HttpError(502, exc.message);
		}
		throw exc;
	} finally {
		unregisterOperation(operationId, controller);
	}
	const state = await sessionLock.runExclusive(() => {
		try {
			getSession().addMedia({
				messageId: messageId!,
				kind: 'image',
				file: name,
				sourceText: preparedText
			});
		} catch (exc) {
			if (exc instanceof KeyError) {
				const orphan = path.join(imagesDir(), path.basename(name));
				try {
					fs.unlinkSync(orphan);
				} catch {
					// Already gone.
				}
				throw new HttpError(409, 'message changed during generation');
			}
			throw exc;
		}
		return stateResponse();
	});
	return json(state);
});
