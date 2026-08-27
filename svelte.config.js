import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		csrf: {
			// Local single-user tool. Keep the explicit local origins while
			// avoiding a wildcard that would trust arbitrary network origins.
			trustedOrigins: [
				'http://127.0.0.1:5173',
				'http://127.0.0.1:4173',
				'http://127.0.0.1:3000'
			]
		}
	}
};

export default config;
