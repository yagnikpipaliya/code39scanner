import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        'src/core/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'src/image/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'src/camera/**': { statements: 85, branches: 80, functions: 85, lines: 85 },
      },
    },
  },
});
