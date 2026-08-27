import fs from 'node:fs';
import path from 'node:path';
import { rootDir } from '$lib/server/config';

export function GET() {
	const file = path.join(rootDir(), 'static', 'favicon.svg');
	const bytes = fs.readFileSync(file);
	return new Response(bytes, {
		headers: { 'Content-Type': 'image/svg+xml' }
	});
}
