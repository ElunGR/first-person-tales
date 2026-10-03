import { json } from '@sveltejs/kit';
import { apiHandler } from '$lib/server/api';
import { createGameExport, gameExportMarkdown } from '$lib/server/gameArchive';
import { HttpError } from '$lib/server/http';
import { sessionLock } from '$lib/server/lock';
import { getSession } from '$lib/server/session';

/** Export story, summary state, and editable descriptions; images stay excluded. */
export const GET = apiHandler(async ({ url }) => {
	const format = url.searchParams.get('format') ?? 'json';
	const markdown = ['md', 'markdown'].includes(format.toLowerCase());
	const payload = await sessionLock.runExclusive(() => {
		try {
			return createGameExport(getSession(), { requireImportable: !markdown });
		} catch (error) {
			if (error instanceof HttpError) throw error;
			// YAML parser errors can contain private description text; do not echo them.
			throw new HttpError(500, 'Could not export the game. Check that the character and world descriptions are valid.');
		}
	});
	if (markdown) {
		return new Response(gameExportMarkdown(payload), {
			headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
		});
	}
	return json(payload, {
		headers: { 'Content-Disposition': 'attachment; filename=history.json' }
	});
});
