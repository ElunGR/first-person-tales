/**
 * Narrator parameter dictionary: the name/value rules shared by the settings
 * form, the API route and the persisted file.
 */
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_NARRATOR_PARAMETERS,
	MAX_NARRATOR_PARAMETERS,
	NarratorParametersInputSchema,
	describeParameterProblem,
	isReservedParameterName,
	normalizeParameterName,
	normalizeParameterValue,
	parameterValueToText,
	parseParameterValueText,
	sanitizeNarratorParameters,
	withDefaultNarratorParameters,
	type NarratorParameterValue
} from '../src/lib/narratorParameters';

describe('parameter names', () => {
	it('accepts lowercase names with digits and underscores', () => {
		expect(normalizeParameterName('top_k')).toBe('top_k');
		expect(normalizeParameterName('  Frequency_Penalty  ')).toBe('frequency_penalty');
		expect(normalizeParameterName('max_completion_tokens')).toBe('max_completion_tokens');
		expect(normalizeParameterName('stop2')).toBe('stop2');
	});

	it.each(['', '   ', 'top k', 'top-k', 'top.k', 'ключ', 'a'.repeat(65)])(
		'rejects the unusable name %j',
		(name) => {
			expect(normalizeParameterName(name)).toBeNull();
		}
	);

	it.each(['model', 'messages', 'stream', 'Model', 'STREAM'])(
		'refuses to take over %s',
		(name) => {
			expect(isReservedParameterName(name.toLowerCase())).toBe(true);
			expect(normalizeParameterName(name)).toBeNull();
		}
	);
});

describe('parameter values', () => {
	it('keeps every JSON-safe shape the provider may accept', () => {
		expect(normalizeParameterValue(0.75)).toBe(0.75);
		expect(normalizeParameterValue(-2)).toBe(-2);
		expect(normalizeParameterValue(true)).toBe(true);
		expect(normalizeParameterValue(false)).toBe(false);
		expect(normalizeParameterValue('high')).toBe('high');
		expect(normalizeParameterValue(['###', 'OOC:'])).toEqual(['###', 'OOC:']);
		expect(normalizeParameterValue([0, 1])).toEqual([0, 1]);
	});

	it.each([
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
		['null', null],
		['undefined', undefined],
		['a nested object', { effort: 'high' }],
		['a mixed array', [1, 'two']],
		['an array of objects', [{ role: 'user' }]],
		['an empty array of nothing', [[]]]
	])('rejects %s', (_label, value) => {
		expect(normalizeParameterValue(value)).toBeNull();
	});
});

describe('problem reporting', () => {
	it('names the exact reason the form shows', () => {
		expect(describeParameterProblem('', 1)).toBe('parameter name is required');
		expect(describeParameterProblem('top k', 1)).toContain('lowercase letters, digits or underscore');
		expect(describeParameterProblem('model', 'x')).toContain('reserved');
		expect(describeParameterProblem('top_k', { nested: true })).toContain('must be a number');
		expect(describeParameterProblem('top_k', 40)).toBeNull();
	});
});

describe('recovery of a hand-edited settings file', () => {
	it('keeps usable entries and drops the rest without throwing', () => {
		expect(
			sanitizeNarratorParameters({
				Temperature: 0.9,
				model: 'someone-else',
				'max tokens': 100,
				top_k: 40,
				stop: ['###'],
				broken: null,
				nested: { a: 1 }
			})
		).toEqual({ temperature: 0.9, top_k: 40, stop: ['###'] });
	});

	it('reports nothing usable as undefined so defaults still apply', () => {
		expect(sanitizeNarratorParameters('nope')).toBeUndefined();
		expect(sanitizeNarratorParameters({ model: 'x' })).toEqual({});
	});
});

describe('defaults', () => {
	it('ships temperature, top_p and the completion budget', () => {
		expect(DEFAULT_NARRATOR_PARAMETERS).toEqual({
			temperature: 1,
			top_p: 0.95,
			max_completion_tokens: 8000
		});
	});

	it('lets a saved value replace a default and adds unknown fields', () => {
		expect(withDefaultNarratorParameters({ temperature: 1.1, top_k: 40 })).toEqual({
			temperature: 1.1,
			top_p: 0.95,
			max_completion_tokens: 8000,
			top_k: 40
		});
		expect(withDefaultNarratorParameters(undefined)).toEqual(DEFAULT_NARRATOR_PARAMETERS);
	});

	it('a cleared dictionary still gets the defaults back on load', () => {
		expect(withDefaultNarratorParameters({})).toEqual(DEFAULT_NARRATOR_PARAMETERS);
	});
});

describe('form text conversion', () => {
	it('reads plain numbers and booleans as typed values, not strings', () => {
		expect(parseParameterValueText('40')).toEqual({ value: 40 });
		expect(parseParameterValueText(' 1.1 ')).toEqual({ value: 1.1 });
		expect(parseParameterValueText('-2e3')).toEqual({ value: -2000 });
		expect(parseParameterValueText('true')).toEqual({ value: true });
		expect(parseParameterValueText('false')).toEqual({ value: false });
	});

	it('keeps prose as a string', () => {
		expect(parseParameterValueText('high')).toEqual({ value: 'high' });
		expect(parseParameterValueText('###')).toEqual({ value: '###' });
	});

	it('parses JSON arrays when the text starts with a bracket', () => {
		expect(parseParameterValueText('["###", "OOC:"]')).toEqual({ value: ['###', 'OOC:'] });
		expect(parseParameterValueText('[1, 2]')).toEqual({ value: [1, 2] });
	});

	it('explains what to fix instead of throwing', () => {
		expect(parseParameterValueText('')).toEqual({ error: 'value is required' });
		expect(parseParameterValueText('   ')).toEqual({ error: 'value is required' });
		expect(parseParameterValueText('[1, "two"]')).toMatchObject({ error: expect.stringContaining('array') });
		expect(parseParameterValueText('{oops}')).toMatchObject({ error: expect.stringContaining('JSON') });
		expect(parseParameterValueText('x'.repeat(2001))).toMatchObject({
			error: expect.stringContaining('longer than')
		});
	});

	it('round-trips a saved value back into editable text', () => {
		const values: NarratorParameterValue[] = [0.75, true, 'high', ['###'], [1, 2]];
		for (const value of values) {
			const text = parameterValueToText(value);
			expect(parseParameterValueText(text)).toEqual({ value });
		}
	});
});

describe('request schema', () => {
	it('normalizes names and values on the way in', () => {
		const result = NarratorParametersInputSchema.parse({
			Temperature: 0.9,
			top_k: 40,
			Stop: ['###']
		});
		expect(result).toEqual({ temperature: 0.9, top_k: 40, stop: ['###'] });
	});

	it('accepts an empty dictionary as a deliberate choice', () => {
		expect(NarratorParametersInputSchema.parse({})).toEqual({});
	});

	it('rejects the maximum-plus-one parameter count', () => {
		const tooMany: Record<string, number> = {};
		for (let index = 0; index <= MAX_NARRATOR_PARAMETERS; index += 1) {
			tooMany[`param_${index}`] = index;
		}
		expect(NarratorParametersInputSchema.safeParse(tooMany).success).toBe(false);
	});
});
