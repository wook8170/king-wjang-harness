import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['core/test/**/*.test.ts'],
    setupFiles: ['core/test/setup.ts'],
  },
});
