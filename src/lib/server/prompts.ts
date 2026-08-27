/**
 * Load public prompts and an optional Git-ignored player-character override.
 * Port of backend/prompts.py.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { localPromptsPath, promptsPath } from './paths';

const PROMPTS_NAME = 'prompts.yaml';
const LOCAL_PROMPTS_NAME = 'prompts.local.yaml';

let cache: Map<string, string> | null = null;
let cacheSignature: string | null = null;

function loadRaw(filePath: string, fileName: string, optional = false): Record<string, unknown> {
	if (!fs.existsSync(filePath)) {
		if (optional) return {};
		throw new Error(`Missing ${fileName}`);
	}
	const data: unknown = YAML.parse(fs.readFileSync(filePath, 'utf-8')) ?? {};
	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		throw new Error(`${fileName} must be a mapping of name -> text`);
	}
	return data as Record<string, unknown>;
}

function fileSignature(filePath: string): string {
	try {
		const stats = fs.statSync(filePath);
		return `${filePath}:${stats.mtimeMs}:${stats.size}`;
	} catch {
		return `${filePath}:missing`;
	}
}

/** Return all prompts, reloading when either public or private prompt data changes. */
export function loadPrompts(force = false): Map<string, string> {
	const filePath = promptsPath();
	const localFilePath = localPromptsPath();
	const signature = `${fileSignature(filePath)}\n${fileSignature(localFilePath)}`;
	if (!force && cache !== null && signature === cacheSignature) {
		return cache;
	}
	const raw = loadRaw(filePath, PROMPTS_NAME);
	const local = loadRaw(localFilePath, LOCAL_PROMPTS_NAME, true);
	for (const key of Object.keys(local)) {
		if (key !== 'player_character') {
			throw new Error(`${LOCAL_PROMPTS_NAME} may only override player_character`);
		}
	}
	Object.assign(raw, local);
	const prompts = new Map<string, string>();
	for (const [key, value] of Object.entries(raw)) {
		if (value !== null && value !== undefined) {
			prompts.set(String(key), String(value).trim());
		}
	}
	cache = prompts;
	cacheSignature = signature;
	return prompts;
}

/** Return a single prompt by name. Throws if missing. */
export function getPrompt(name: string): string {
	const prompts = loadPrompts();
	const value = prompts.get(name);
	if (value === undefined) {
		throw new Error(`prompt not found: ${name}`);
	}
	return value;
}

/**
 * Load a prompt template and replace {placeholders} safely.
 * Uses plain string replacement so unrelated braces in prompt text
 * are left untouched.
 */
export function formatPrompt(name: string, kwargs: Record<string, unknown>): string {
	let text = getPrompt(name);
	for (const [key, value] of Object.entries(kwargs)) {
		text = text.split(`{${key}}`).join(String(value));
	}
	return text;
}

/** Drop the cached prompts (tests). */
export function clearPromptCache(): void {
	cache = null;
	cacheSignature = null;
}

/**
 * Persist the active player character to the Git-ignored prompts.local.yaml
 * override, preserving the loader contract that only `player_character` may be
 * overridden there. Changes take effect without a restart.
 */
export function savePlayerCharacter(content: string): void {
	const filePath = localPromptsPath();
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, YAML.stringify({ player_character: content }), 'utf-8');
	} catch (exc) {
		throw new Error(`Could not save character: ${(exc as Error)?.message ?? exc}`);
	}
	clearPromptCache();
}
