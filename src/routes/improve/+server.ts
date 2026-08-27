import { json } from '@sveltejs/kit';
import { parseBody } from '$lib/server/api';
import { apiHandler } from '$lib/server/api';
import { improveText } from '$lib/server/game';
import { HttpError } from '$lib/server/http';
import { runLlmOperation } from '$lib/server/llmOperation';
import { TextRequestSchema } from '$lib/server/models';

export const POST = apiHandler(async ({ request }) => {
	const body = await parseBody(request, TextRequestSchema);
	const text = body.text || '';
	if (!text.trim()) {
		throw new HttpError(400, 'text is required');
	}
	const improved = await runLlmOperation(request, (llm, signal) => improveText(text, llm, signal));
	return json({ text: improved });
});
