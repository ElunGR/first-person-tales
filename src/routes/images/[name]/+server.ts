import { apiHandler } from '$lib/server/api';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { HttpError } from '$lib/server/http';
import { imagesDir } from '$lib/server/paths';

/** Serve an image file from data/images/ by filename (not record id). */
export const GET = apiHandler(({ params }) => {
	// Prevent path traversal.
	const safe = path.basename(params.name ?? '');
	const filePath = path.join(imagesDir(), safe);
	let stats: fs.Stats;
	try {
		stats = fs.statSync(filePath);
	} catch {
		throw new HttpError(404, 'image not found');
	}
	if (!stats.isFile()) {
		throw new HttpError(404, 'image not found');
	}
	// Generated files have random UUID names and are never mutated in place,
	// so browsers may cache them forever. Streaming avoids blocking the event
	// loop on multi-megabyte synchronous reads.
	return new Response(Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream, {
		headers: {
			'Content-Type': /\.jpe?g$/i.test(safe) ? 'image/jpeg' : 'image/png',
			'Content-Length': String(stats.size),
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	});
});
