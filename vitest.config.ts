import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    reporters: ['verbose', 'json'],
    outputFile: { json: 'test-reports/unit.json' },
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/email.ts'],
      reporter: ['text', 'json'],
      reportsDirectory: 'test-reports/coverage',
      thresholds: {
        statements: 50,
        functions: 50,
        lines: 50,
      },
    },
  },
});
