import { describe, expect, it } from 'vitest';
import { GET } from '../src/routes/favicon.ico/+server';

describe('favicon route', () => {
	it('redirects to the static icon instead of reading the data root', () => {
		// Reading <RPG_ROOT_DIR>/static/favicon.svg returned 500 whenever the data
		// root was moved away from the application folder.
		const response = GET({ url: new URL('http://localhost/favicon.ico') } as never);

		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe('/favicon.svg');
	});
});
