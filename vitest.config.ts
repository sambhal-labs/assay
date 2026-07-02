import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    testTimeout: 15_000,
    hookTimeout: 15_000,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {
        'src/rules/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'src/core/scorer.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  },
});
