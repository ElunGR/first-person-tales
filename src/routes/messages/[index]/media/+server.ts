import fs from 'node:fs';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import { parseBody, parseIndex, stateResponse, validateMessageTarget } from '$lib/server/api';
import { apiHandler } from '$lib/server/api';
import { HttpError, isAbortError } from '$lib/server/http';
import { generateToFile, ImageGenError } from '$lib/server/imageGen';
import { sessionLock } from '$lib/server/lock';
import { unmarkMediaFilePending } from '$lib/server/mediaIo';
import { MediaGenerateRequestSchema } from '$lib/server/models';
import { imagesDir } from '$lib/server/paths';
import { ProviderError } from '$lib/server/providerApi';
import { registerOperation, unregisterOperation } from '$lib/server/operations';
import { getSession, KeyError } from '$lib/server/session';
import { loadSettings } from '$lib/server/settings';
import { imagePromptWithStyle } from '$lib/imageStyles';

export const POST = apiHandler(async ({ params, request }) => {
	const targetSession = getSession();
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
		if (session !== targetSession) throw new HttpError(409, 'game changed before generation');
		validateMessageTarget(session, index, body.message_id);
		const message = session.messages[index];
		if (message.role !== 'assistant' || message.kind === 'branch') {
			throw new HttpError(400, 'only narrator messages can have media');
		}
		messageId = message.id;
	});
	// Use the style shown in the dialog; legacy clients fall back to saved settings.
	const imagePrompt = imagePromptWithStyle(preparedText, body.image_style ?? loadSettings().image_style);
	const controller = registerOperation(operationId);
	let name: string;
	try {
		name = await generateToFile(imagePrompt, { signal: controller?.signal });
	} catch (exc) {
		if (isAbortError(exc)) throw new HttpError(499, 'operation cancelled');
		if (exc instanceof ProviderError || exc instanceof ImageGenError) {
			throw new HttpError(502, exc.message);
		}
		throw exc;
	} finally {
		unregisterOperation(operationId, controller);
	}
	let attached = false;
	try {
		const state = await sessionLock.runExclusive(() => {
			try {
				const session = getSession();
				if (session !== targetSession!) throw new HttpError(409, 'game changed during generation');
				session.addMedia({
					messageId: messageId!,
					kind: 'image',
					file: name,
					sourceText: imagePrompt
				});
				attached = true;
			} catch (exc) {
				if (exc instanceof KeyError) {
					throw new HttpError(409, 'message changed during generation');
				}
				throw exc;
			} finally {
				if (!attached) {
					const orphan = path.join(imagesDir(), path.basename(name));
					try {
						fs.unlinkSync(orphan);
					} catch {
						// Already gone.
					}
				}
			}
			return stateResponse();
		});
		return json(state);
	} finally {
		unmarkMediaFilePending(name);
	}
});
