/**
 * Narrator sampling parameters as an extensible name/value dictionary.
 *
 * The app no longer owns a fixed list of sampling fields. It always sends the
 * defaults below plus whatever the player added in Settings, so a model that
 * needs an unusual knob (top_k, repetition_penalty, min_p, stop, ...) can be
 * tuned without a code change. Values are passed to the provider as written;
 * the player is responsible for provider-specific names and ranges.
 */
import { z } from 'zod';

export type NarratorParameterValue = string | number | boolean | string[] | number[];
export type NarratorParameters = Record<string, NarratorParameterValue>;

/** Narrator defaults; the only sampling fields the app sends on its own. */
export const NARRATOR_TEMPERATURE = 1;
export const NARRATOR_TOP_P = 0.95;
export const NARRATOR_MAX_COMPLETION_TOKENS = 8000;

/** Upper bound on the dictionary, so one settings file cannot grow forever. */
export const MAX_NARRATOR_PARAMETERS = 32;

/** Kept out of the dictionary: these decide the request, not the sampling. */
export const RESERVED_PARAMETER_NAMES = ['model', 'messages', 'stream'] as const;

const PARAMETER_NAME_PATTERN = /^[a-z0-9_]{1,64}$/;
const MAX_PARAMETER_STRING_CHARS = 2_000;
const MAX_PARAMETER_ARRAY_ITEMS = 128;

/** Sent on every narrator request and shown as editable rows in Settings. */
export const DEFAULT_NARRATOR_PARAMETERS: NarratorParameters = {
	temperature: NARRATOR_TEMPERATURE,
	top_p: NARRATOR_TOP_P,
	max_completion_tokens: NARRATOR_MAX_COMPLETION_TOKENS
};

export function isReservedParameterName(name: string): boolean {
	return (RESERVED_PARAMETER_NAMES as readonly string[]).includes(name);
}

/**
 * Parameter names are compared and sent lower-case so the dictionary cannot
 * hold two spellings of the same knob. Rejected names are reported by the
 * settings route instead of being silently dropped from a saved file.
 */
export function normalizeParameterName(name: string): string | null {
	const normalized = name.trim().toLowerCase();
	if (!PARAMETER_NAME_PATTERN.test(normalized)) return null;
	if (isReservedParameterName(normalized)) return null;
	return normalized;
}

export function normalizeParameterValue(value: unknown): NarratorParameterValue | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		return value.length <= MAX_PARAMETER_STRING_CHARS ? value : null;
	}
	if (Array.isArray(value)) {
		if (value.length > MAX_PARAMETER_ARRAY_ITEMS) return null;
		if (value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
			return value as number[];
		}
		if (value.every((item) => typeof item === 'string' && item.length <= MAX_PARAMETER_STRING_CHARS)) {
			return value as string[];
		}
		return null;
	}
	return null;
}

/** Shown verbatim in the settings error message so the player knows the reason. */
export function describeParameterProblem(name: string, value: unknown): string | null {
	const trimmed = name.trim();
	if (!trimmed) return 'parameter name is required';
	if (!PARAMETER_NAME_PATTERN.test(trimmed.toLowerCase())) {
		return `parameter name "${trimmed}" must use lowercase letters, digits or underscore (max 64)`;
	}
	if (isReservedParameterName(trimmed.toLowerCase())) {
		return `parameter name "${trimmed}" is reserved by the app`;
	}
	if (normalizeParameterValue(value) === null) {
		return `value of "${trimmed}" must be a number, boolean, string, or an array of numbers or strings`;
	}
	return null;
}

/** Strict form used by the persisted file, the API and the settings route. */
export const NarratorParametersSchema = z
	.record(z.string(), z.unknown())
	.superRefine((value, ctx) => {
		const entries = Object.entries(value);
		if (entries.length > MAX_NARRATOR_PARAMETERS) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `at most ${MAX_NARRATOR_PARAMETERS} narrator parameters are supported`
			});
		}
		for (const [name, item] of entries) {
			const problem = describeParameterProblem(name, item);
			if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
		}
	})
	.transform((value) => {
		const cleaned: NarratorParameters = {};
		for (const [name, item] of Object.entries(value)) {
			const normalized = normalizeParameterName(name);
			const parsed = normalizeParameterValue(item);
			if (normalized && parsed !== null) cleaned[normalized] = parsed;
		}
		return cleaned;
	});

const ParameterValueInputSchema = z.union([
	z.number(),
	z.boolean(),
	z.string().max(MAX_PARAMETER_STRING_CHARS),
	z.array(z.number()),
	z.array(z.string().max(MAX_PARAMETER_STRING_CHARS))
]);

/**
 * Input shape for the settings request. The transform of a superRefine is not
 * applied until the value parses, so the route receives fully normalized data
 * or a validation error that names the offending parameter.
 */
export const NarratorParametersInputSchema = z
	.record(z.string(), ParameterValueInputSchema)
	.superRefine((value, ctx) => {
		const entries = Object.entries(value);
		if (entries.length > MAX_NARRATOR_PARAMETERS) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `at most ${MAX_NARRATOR_PARAMETERS} narrator parameters are supported`
			});
		}
		for (const [name, item] of entries) {
			const problem = describeParameterProblem(name, item);
			if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
		}
	})
	.transform((value) => {
		const cleaned: NarratorParameters = {};
		for (const [name, item] of Object.entries(value)) {
			const normalized = normalizeParameterName(name);
			const parsed = normalizeParameterValue(item);
			if (normalized && parsed !== null) cleaned[normalized] = parsed;
		}
		return cleaned;
	});

/** Defaults first, so a saved file can override or extend them. */
export function withDefaultNarratorParameters(
	parameters: NarratorParameters | null | undefined
): NarratorParameters {
	const merged: NarratorParameters = { ...DEFAULT_NARRATOR_PARAMETERS };
	for (const [name, value] of Object.entries(parameters ?? {})) {
		merged[name] = value;
	}
	return merged;
}

/** Best-effort recovery for a hand-edited settings file. */
export function sanitizeNarratorParameters(raw: unknown): NarratorParameters | undefined {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
	const cleaned: NarratorParameters = {};
	for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
		const normalized = normalizeParameterName(name);
		if (!normalized) continue;
		const parsed = normalizeParameterValue(value);
		if (parsed === null) continue;
		if (Object.keys(cleaned).length >= MAX_NARRATOR_PARAMETERS) break;
		cleaned[normalized] = parsed;
	}
	return cleaned;
}

const NUMBER_LITERAL = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

function stringifyValue(value: NarratorParameterValue): string {
	if (typeof value === 'string') return value;
	return JSON.stringify(value);
}

function parseScalar(trimmed: string): NarratorParameterValue | null {
	if (NUMBER_LITERAL.test(trimmed)) {
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : null;
	}
	if (trimmed === 'true') return true;
	if (trimmed === 'false') return false;
	return null;
}

/**
 * Turn what the player typed into a JSON value: a number, true/false, a JSON
 * array or object, or the text itself. Never throws; the caller reports the
 * message next to the field.
 */
export function parseParameterValueText(text: string): { value: NarratorParameterValue } | { error: string } {
	const trimmed = text.trim();
	if (!trimmed) return { error: 'value is required' };
	const scalar = parseScalar(trimmed);
	if (scalar !== null) return { value: scalar };
	if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			return { error: 'not valid JSON; fix the syntax or remove the leading bracket' };
		}
		const normalized = normalizeParameterValue(parsed);
		if (normalized === null) {
			return { error: 'JSON must be an array or object of numbers, strings or true/false' };
		}
		return { value: normalized };
	}
	if (trimmed.length > MAX_PARAMETER_STRING_CHARS) {
		return { error: `text is longer than ${MAX_PARAMETER_STRING_CHARS} characters` };
	}
	return { value: trimmed };
}

/** Row text for the settings form, so a saved array or object stays editable. */
export function parameterValueToText(value: NarratorParameterValue): string {
	return stringifyValue(value);
}
