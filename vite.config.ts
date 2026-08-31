import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		host: '127.0.0.1'
	},
	preview: {
		host: '127.0.0.1'
	},
	test: {
		include: ['tests/**/*.test.ts'],
		setupFiles: ['tests/setup.ts'],
		environment: 'node',
		testTimeout: 20000
	}
});
