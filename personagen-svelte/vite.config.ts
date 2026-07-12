import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		expect: { requireAssertions: true },
		// A suite that discovers no test files is a FAILURE, never a silent pass.
		// (This is vitest's default; pinned explicitly so nobody "fixes" a red
		// empty suite by flipping it and reintroducing the false green.)
		passWithNoTests: false,
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					// Unit: pure logic, everything external mocked. `npm run test:unit`
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.spec.{js,ts}'],
					exclude: ['src/**/*.svelte.spec.{js,ts}']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					// Integration: allowed to touch a real (local/test) supabase.
					// `npm run test:integration` — kept out of the default `npm test`
					// chain because it needs credentials.
					name: 'integration',
					environment: 'node',
					include: ['src/**/*.test.{js,ts}']
				}
			}
		]
	}
});
