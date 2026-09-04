/** Load public prompts and optional Git-ignored character/world descriptions. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { localPromptsPath, promptsPath } from './paths';

const PROMPTS_NAME = 'prompts.yaml';
const LOCAL_PROMPTS_NAME = 'prompts.local.yaml';
const PLAYER_DESCRIPTION_KEY = 'player_character_description';
const WORLD_DESCRIPTION_KEY = 'world_description';
const LOCAL_DESCRIPTION_KEYS = [PLAYER_DESCRIPTION_KEY, WORLD_DESCRIPTION_KEY] as const;

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

function validateLocalDescriptions(local: Record<string, unknown>): void {
	if ('player_character' in local) {
		throw new Error(
			`${LOCAL_PROMPTS_NAME} uses the old player_character format. ` +
				`Copy your character and world descriptions, delete ${LOCAL_PROMPTS_NAME}, ` +
				'run npm run build, and restart the app.'
		);
	}
	for (const [key, value] of Object.entries(local)) {
		if (!(LOCAL_DESCRIPTION_KEYS as readonly string[]).includes(key)) {
			throw new Error(
				`${LOCAL_PROMPTS_NAME} may only override ${PLAYER_DESCRIPTION_KEY} and ${WORLD_DESCRIPTION_KEY}`
			);
		}
		if (typeof value !== 'string') {
			throw new Error(`${LOCAL_PROMPTS_NAME} value ${key} must be text`);
		}
	}
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
	if (!force && cache !== null && signature === cacheSignature) return cache;

	const raw = loadRaw(filePath, PROMPTS_NAME);
	const local = loadRaw(localFilePath, LOCAL_PROMPTS_NAME, true);
	validateLocalDescriptions(local);
	Object.assign(raw, local);
	const prompts = new Map<string, string>();
	for (const [key, value] of Object.entries(raw)) {
		if (value !== null && value !== undefined) prompts.set(String(key), String(value).trim());
	}
	cache = prompts;
	cacheSignature = signature;
	return prompts;
}

/** Return a single required prompt by name. */
export function getPrompt(name: string): string {
	const value = loadPrompts().get(name);
	if (value === undefined) throw new Error(`prompt not found: ${name}`);
	return value;
}

/** Return a single optional prompt by name. */
export function getOptionalPrompt(name: string): string {
	return loadPrompts().get(name) ?? '';
}

/** Load a prompt template and replace {placeholders} without executing expressions. */
export function formatPrompt(name: string, kwargs: Record<string, unknown>): string {
	let text = getPrompt(name);
	for (const [key, value] of Object.entries(kwargs)) text = text.split(`{${key}}`).join(String(value));
	return text;
}

/** Reserve Markdown H1 for application-owned system sections. */
export function normalizeUserDescription(content: string): string {
	return content.trim().replace(/^([ \t]{0,3})#(?=[ \t]|$)/gm, '$1##');
}

export function getPlayerCharacterDescription(): string {
	const content = normalizeUserDescription(getPrompt(PLAYER_DESCRIPTION_KEY));
	if (!content) throw new Error('player character description is empty');
	return content;
}

export function getWorldDescription(): string {
	return normalizeUserDescription(getOptionalPrompt(WORLD_DESCRIPTION_KEY));
}

/** Render prompt-file-owned system sections around editable descriptions. */
export function composeRoleplayContext(): string {
	const blocks = [
		formatPrompt('player_character', {
			player_character_description: getPlayerCharacterDescription()
		}).trim()
	];
	const world = getWorldDescription();
	if (world) blocks.push(formatPrompt('world', { world_description: world }).trim());
	return blocks.join('\n\n');
}

/** Drop the cached prompts (tests and successful local writes). */
export function clearPromptCache(): void {
	cache = null;
	cacheSignature = null;
}

function writeLocalDescriptions(local: Record<string, string>): void {
	const filePath = localPromptsPath();
	const ordered: Record<string, string> = {};
	for (const key of LOCAL_DESCRIPTION_KEYS) {
		const value = local[key];
		if (typeof value === 'string' && value) ordered[key] = value;
	}

	if (Object.keys(ordered).length === 0) {
		if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
		clearPromptCache();
		return;
	}

	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const temporary = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${crypto.randomBytes(8).toString('hex')}.tmp`
	);
	try {
		const fd = fs.openSync(temporary, 'w');
		try {
			fs.writeSync(fd, YAML.stringify(ordered), undefined, 'utf-8');
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(temporary, filePath);
	} catch (exc) {
		try {
			fs.unlinkSync(temporary);
		} catch {
			// Already renamed or never created.
		}
		throw exc;
	}
	clearPromptCache();
}

function saveDescription(key: (typeof LOCAL_DESCRIPTION_KEYS)[number], content: string): string {
	const local = loadRaw(localPromptsPath(), LOCAL_PROMPTS_NAME, true);
	validateLocalDescriptions(local);
	const normalized = normalizeUserDescription(content);
	const next: Record<string, string> = {};
	for (const allowedKey of LOCAL_DESCRIPTION_KEYS) {
		const existing = local[allowedKey];
		if (typeof existing === 'string' && existing.trim()) {
			next[allowedKey] = normalizeUserDescription(existing);
		}
	}
	if (normalized) next[key] = normalized;
	else delete next[key];
	writeLocalDescriptions(next);
	return normalized;
}

export function savePlayerCharacterDescription(content: string): string {
	const normalized = normalizeUserDescription(content);
	if (!normalized) throw new Error('Character must not be empty');
	return saveDescription(PLAYER_DESCRIPTION_KEY, normalized);
}

export function saveWorldDescription(content: string): string {
	return saveDescription(WORLD_DESCRIPTION_KEY, content);
}
