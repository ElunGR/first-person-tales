/** Error classes mirroring Python builtins used across the backend. */

export class ValueError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ValueError';
	}
}

export class IndexError extends Error {
	constructor(message: string = 'index out of range') {
		super(message);
		this.name = 'IndexError';
	}
}
