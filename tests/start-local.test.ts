import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('local game launcher', () => {
	it('builds automatically on first launch and keeps the server local', () => {
		const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-person-tales-start-'));
		const scriptsDir = path.join(projectDir, 'scripts');
		const viteDir = path.join(projectDir, 'node_modules', 'vite');

		try {
			fs.mkdirSync(scriptsDir, { recursive: true });
			fs.mkdirSync(path.join(viteDir, 'bin'), { recursive: true });
			fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ type: 'module' }));
			fs.writeFileSync(path.join(viteDir, 'package.json'), JSON.stringify({ type: 'module' }));
			fs.copyFileSync(
				path.join(process.cwd(), 'scripts', 'start-local.mjs'),
				path.join(scriptsDir, 'start-local.mjs')
			);
			fs.writeFileSync(
				path.join(viteDir, 'bin', 'vite.js'),
				[
					"import { mkdirSync, writeFileSync } from 'node:fs';",
					"mkdirSync('build', { recursive: true });",
					'writeFileSync("build/index.js", "console.log(\\\"SERVER_HOST=\\\" + process.env.HOST); console.log(\\\"SERVER_ORIGIN=\\\" + process.env.ORIGIN); console.log(\\\"BODY_SIZE_LIMIT=\\\" + process.env.BODY_SIZE_LIMIT)");',
					"console.log('BUILD_COMPLETED');"
				].join('\n')
			);

			const testEnv: NodeJS.ProcessEnv = {
				...process.env,
				HOST: '0.0.0.0',
				BODY_SIZE_LIMIT: '512K',
				PORT: '3123'
			};
			delete testEnv.ORIGIN;
			const run = () =>
				spawnSync(process.execPath, [path.join(scriptsDir, 'start-local.mjs')], {
					cwd: projectDir,
					encoding: 'utf8',
					env: testEnv
				});

			const firstLaunch = run();
			expect(firstLaunch.status, firstLaunch.stderr).toBe(0);
			expect(firstLaunch.stdout).toContain('Preparing First Person Tales for first launch...');
			expect(firstLaunch.stdout).toContain('BUILD_COMPLETED');
			expect(firstLaunch.stdout).toContain('SERVER_HOST=127.0.0.1');
			expect(firstLaunch.stdout).toContain('SERVER_ORIGIN=http://127.0.0.1:3123');
			expect(firstLaunch.stdout).toContain('BODY_SIZE_LIMIT=4M');

			const nextLaunch = run();
			expect(nextLaunch.status, nextLaunch.stderr).toBe(0);
			expect(nextLaunch.stdout).not.toContain('Preparing First Person Tales');
			expect(nextLaunch.stdout).not.toContain('BUILD_COMPLETED');
			expect(nextLaunch.stdout).toContain('SERVER_HOST=127.0.0.1');
			expect(nextLaunch.stdout).toContain('SERVER_ORIGIN=http://127.0.0.1:3123');
			expect(nextLaunch.stdout).toContain('BODY_SIZE_LIMIT=4M');
		} finally {
			fs.rmSync(projectDir, { recursive: true, force: true });
		}
	});
});
