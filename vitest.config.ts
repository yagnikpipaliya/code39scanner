import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Browser-only adapter (getUserMedia / canvas) is exercised via the demo, not in Node.
      exclude: ['src/index.ts', 'src/camera/camera-frame-source.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        'src/core/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'src/image/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  },
});
