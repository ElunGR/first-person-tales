/** Shared vitest helpers: isolated temp data dir + fresh session per test. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { resetDataDir, setDataDir } from '../src/lib/server/paths';
import { clearPromptCache } from '../src/lib/server/prompts';
import { Session, setSession } from '../src/lib/server/session';

export function useTempDataDir() {
	const state = { dir: '' };
	beforeEach(() => {
		state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-test-'));
		setDataDir(state.dir);
		setSession(new Session());
	});
	afterEach(() => {
		resetDataDir();
		try {
			fs.rmSync(state.dir, { recursive: true, force: true });
		} catch {
			// Best effort.
		}
	});
	return {
		dir: () => state.dir
	};
}

/**
 * Give prompt-composition tests a deterministic project root.
 *
 * The real checkout may contain an ignored prompts.local.yaml with a private
 * player character. Tests must never read it or couple assertions to the
 * editable prose in the public prompt file.
 */
export function useTempPromptRoot() {
	const state = { dir: '' };
	beforeEach(() => {
		state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-prompts-fixture-'));
		vi.stubEnv('RPG_ROOT_DIR', state.dir);
		fs.writeFileSync(
			path.join(state.dir, 'prompts.yaml'),
			[
				'narrator: NARRATOR_SYSTEM_SENTINEL',
				'player_character: "# PC (Player character)\\n{player_character_description}"',
				'world: "# World Description\\n{world_description}"',
				'player_character_description: CHARACTER_SENTINEL',
				'world_description: WORLD_SENTINEL',
				'summary_request: SUMMARY_SYSTEM_SENTINEL',
				'summary_user_request: SUMMARY_USER_SENTINEL',
				'branch_user_wrap: "# Story Summary\\n{content}"',
				'image_prompt_rewrite: IMAGE_SYSTEM_SENTINEL',
				'image_rewrite_user: "SUBJECT: {subject}\\nTRANSCRIPT:\\n{transcript}"',
				'translate: "TRANSLATE_SYSTEM_SENTINEL {translation_language}"',
				'improve: IMPROVE_SYSTEM_SENTINEL',
				''
			].join('\n'),
			'utf-8'
		);
		clearPromptCache();
	});
	afterEach(() => {
		clearPromptCache();
		vi.unstubAllEnvs();
		try {
			fs.rmSync(state.dir, { recursive: true, force: true });
		} catch {
			// Best effort.
		}
	});
	return {
		dir: () => state.dir
	};
}
