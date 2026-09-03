/**
 * Validation and atomic persistence for provider media responses.
 * Port of backend/media_io.py.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_IMAGE_RESPONSE_BYTES } from './config';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

export interface ImageFormat {
	extension: '.png' | '.jpg';
	contentType: 'image/png' | 'image/jpeg';
}

export class MediaValidationError extends Error {
	/** A provider media response is too large or not the expected format. */
}

export function validateImageBytes(raw: Buffer, contentType?: string | null): ImageFormat {
	if (raw.length > MAX_IMAGE_RESPONSE_BYTES) {
		throw new MediaValidationError('image response exceeds the configured byte limit');
	}
	const normalized = (contentType || '').split(';', 1)[0].trim().toLowerCase();
	if (normalized && normalized !== 'image/png' && normalized !== 'image/jpeg') {
		throw new MediaValidationError('image response has an unsupported content type');
	}
	let format: ImageFormat | null = null;
	if (raw.length >= PNG_SIGNATURE.length && raw.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
		format = { extension: '.png', contentType: 'image/png' };
	} else if (raw.length >= JPEG_SIGNATURE.length && raw.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
		format = { extension: '.jpg', contentType: 'image/jpeg' };
	}
	if (format === null) {
		throw new MediaValidationError('image response is not a supported PNG or JPEG file');
	}
	if (normalized && normalized !== format.contentType) {
		throw new MediaValidationError('image response content type does not match its bytes');
	}
	return format;
}

/** Write bytes through a same-directory temp file and atomic replace. */
export function atomicWriteBytes(directory: string, name: string, raw: Buffer): string {
	const safeName = path.basename(name);
	if (!safeName || safeName !== name) {
		throw new Error('media filename must be a basename');
	}
	fs.mkdirSync(directory, { recursive: true });
	const destination = path.join(directory, safeName);
	const temporary = path.join(directory, `.${safeName}.${crypto.randomBytes(8).toString('hex')}.tmp`);
	try {
		const fd = fs.openSync(temporary, 'w');
		try {
			fs.writeSync(fd, raw);
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(temporary, destination);
	} catch (err) {
		try {
			fs.unlinkSync(temporary);
		} catch {
			// Already renamed or never created.
		}
		throw err;
	}
	return destination;
}
