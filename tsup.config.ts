import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'core/src/cli.ts' },
  outDir: 'core/dist',
  format: ['cjs'],
  bundle: true,
  clean: true,
  minify: false,
  target: 'node18',
});
