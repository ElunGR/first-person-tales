/** UTC timestamp helpers matching the Python original's formats. */

/** Equivalent of Python strftime("%Y%m%dT%H%M%S%fZ"), e.g. 20260822T153045123000Z. */
export function utcStamp(date: Date = new Date()): string {
	const iso = date.toISOString(); // 2026-08-22T15:30:45.123Z
	const head = iso.slice(0, 19).replace(/[-:]/g, '');
	const fraction = (iso.slice(20, 23) + '000').slice(0, 6);
	return `${head}${fraction}Z`;
}

/** Equivalent of datetime.now(timezone.utc).replace(microsecond=0).isoformat(). */
export function utcNowIso(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
}
