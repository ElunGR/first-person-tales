import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The application is intentionally local-only. Do not inherit a HOST value
// that could expose the unauthenticated single-user server to the network.
process.env.HOST = '127.0.0.1';
// Keep adapter-node's pre-route cap aligned with the application's 4 MiB import cap.
process.env.BODY_SIZE_LIMIT = '4M';

const serverEntry = new URL('../build/index.js', import.meta.url);

if (!existsSync(serverEntry)) {
	console.log('Preparing First Person Tales for first launch...');

	const viteCli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
	const build = spawnSync(process.execPath, [viteCli, 'build'], {
		cwd: fileURLToPath(new URL('..', import.meta.url)),
		stdio: 'inherit',
		env: process.env
	});

	if (build.error) {
		console.error(`Could not prepare First Person Tales: ${build.error.message}`);
		process.exit(1);
	}

	if (build.status !== 0) process.exit(build.status ?? 1);
}

await import(serverEntry.href);
