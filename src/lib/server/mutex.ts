/**
 * Simple promise-chain mutex replacing the asyncio lock that serializes
 * all session mutations in the original backend.
 */
export class Mutex {
	private tail: Promise<void> = Promise.resolve();

	runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
		const previous = this.tail;
		let release!: () => void;
		this.tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		return previous.then(async () => {
			try {
				return await fn();
			} finally {
				release();
			}
		});
	}
}
