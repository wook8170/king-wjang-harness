import { defineConfig } from 'tsup';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

/**
 * [DEP-02] **번들이 삼킨 남의 코드는 그 저작권 고지도 함께 들고 다녀야 한다.**
 *
 * `noExternal: ['yaml']` 로 yaml(ISC)의 소스가 `core/dist/*.js` 안에 그대로 들어간다 —
 * 그 파일이 곧 「배포되는 사본」이고, ISC 는 **모든 사본에 저작권·허가 고지가 나타날 것**을
 * 요구한다. 산출물 어디에도 그 고지가 없었다.
 *
 * 고지는 **빌드 시점에 `node_modules/yaml/LICENSE` 에서 읽는다** — 여기에 문구를 베껴 두면
 * yaml 을 올릴 때마다 조용히 낡아 「고지는 있는데 틀린 고지」가 된다. 버전도 같이 박아
 * 무엇의 고지인지 읽는 사람이 알 수 있게 한다.
 *
 * 리포에 파일 하나(THIRD-PARTY-NOTICES)를 두는 것으로는 부족하다 — dist 만 떼어 복사하면
 * 고지가 떨어져 나간다. 고지는 사본 «안»에 있어야 한다.
 */
function thirdPartyBanner(): string {
  const req = createRequire(import.meta.url);
  const root = path.dirname(req.resolve('yaml/package.json'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    version: string; license: string;
  };
  const text = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').trim();
  const body = text.split('\n').map((l) => (l ? ` * ${l}` : ' *')).join('\n');
  return [
    '/*!',
    ' * This file bundles third-party source. Notices required by their licenses:',
    ' *',
    ` * ---- yaml v${pkg.version} (${pkg.license}) ----`,
    body,
    ' */',
  ].join('\n');
}


export default defineConfig({
  // mcp 는 별도 진입점이다 — MCP 어댑터(mcp/server.js)가 CLI 번들 전체를 끌고 오지 않도록.
  entry: { cli: 'core/src/cli.ts', mcp: 'core/src/mcp.ts' },
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
  // [DEP-02] 인라인된 yaml 의 ISC 고지를 두 번들 모두에 싣는다.
  banner: { js: thirdPartyBanner() },
});
