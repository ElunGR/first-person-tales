/** Pure reconciliation helpers used by the reactive page controller. */
import type { MediaRecord, Message } from './types';

export function sameMessage(a: Message, b: Message): boolean {
	return (
		a.id === b.id &&
		a.role === b.role &&
		a.content === b.content &&
		(a.translation_ru ?? null) === (b.translation_ru ?? null) &&
		(a.kind ?? null) === (b.kind ?? null)
	);
}

export function sameMedia(a: MediaRecord, b: MediaRecord): boolean {
	return (
		a.id === b.id &&
		a.message_id === b.message_id &&
		a.kind === b.kind &&
		a.file === b.file &&
		(a.source_text ?? '') === (b.source_text ?? '') &&
		(a.created_at ?? '') === (b.created_at ?? '')
	);
}

/** Preserve object identity for unchanged indexed records. */
export function mergeReused<T>(previous: T[], incoming: T[], same: (a: T, b: T) => boolean): T[] {
	const merged: T[] = new Array(incoming.length);
	for (let i = 0; i < incoming.length; i += 1) {
		const existing = previous[i];
		merged[i] = existing !== undefined && same(existing, incoming[i]) ? existing : incoming[i];
	}
	return merged;
}
