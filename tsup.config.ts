import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'core/src/cli.ts' },
  outDir: 'core/dist',
  format: ['cjs'],
  bundle: true,
  // yaml(유일한 런타임 의존)을 번들에 인라인한다 — core/dist 를 커밋해 클론만으로 동작시키려면
  // dist 가 node_modules 없이 self-contained 여야 한다(SHIP-11). external 로 두면 순수 클론에서
  // require('yaml') 가 MODULE_NOT_FOUND 로 훅이 inert 가 된다.
  noExternal: ['yaml'],
  clean: true,
  minify: false,
  target: 'node18',
});
