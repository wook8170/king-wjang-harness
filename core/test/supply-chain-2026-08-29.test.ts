/**
 * v0.1.3 공급망 위생 라운드 + [PERF-09] 의 회귀 검사.
 *
 * 이 라운드가 닫은 것들은 전부 **문서가 아니라 파일의 사실**이라 기계로 고정할 수 있다.
 * 고정하지 않으면 다음 의존성 갱신 한 번에 조용히 되돌아간다 — 실제로 [DEP-01] 이 그렇게
 * 생겼다(`package.json` 만 올리고 락파일은 안 올려서, 첫 `npm install` 이 락을 다시 썼다).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.join(__dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');
const json = (rel: string): any => JSON.parse(read(rel));

describe('[DEP-01] 락파일이 package.json 과 어긋나지 않는다', () => {
  /**
   * 어긋나 있으면 **사용자의 첫 `npm install` 이 락파일을 다시 쓴다** — 재현 가능한 설치가
   * 아니게 되고, 그 diff 를 본 사람은 자기가 무언가 잘못했다고 생각한다.
   * 실측으로 잡힌 값은 셋이었다: `version` · `license` · `engines`.
   */
  const pkg = json('package.json');
  const lock = json('package-lock.json');

  it('락파일의 두 version 표기가 package.json 과 같다', () => {
    expect(lock.version, '락파일 루트 version 이 낡았다').toBe(pkg.version);
    expect(lock.packages[''].version, '락파일 packages[""] version 이 낡았다').toBe(pkg.version);
  });

  it('락파일이 package.json 의 메타(license·engines)를 반영한다', () => {
    // npm 은 설치할 때 이 둘을 락에 적는다 — 없으면 첫 설치가 락을 고쳐 쓴다.
    expect(lock.packages[''].license, '락파일에 license 가 없다').toBe(pkg.license);
    expect(lock.packages[''].engines, '락파일에 engines 가 없다').toEqual(pkg.engines);
  });
});

describe('[SHIP-09] 번들이 겨눈 Node 를 package.json 이 실제로 강제한다', () => {
  /**
   * `tsup` 은 `target: 'node18'` 로 굽는데 `engines` 가 없어 **아무것도 강제하지 않았다.**
   * node16 사용자는 설치에 성공하고 실행에서 깨진다 — 가장 나쁜 실패 순서다.
   *
   * 숫자를 여기 베껴 두지 않는다. `tsup.config.ts` 의 target 에서 읽어 대조한다 —
   * 그래야 target 을 올릴 때 이 검사가 **같이** 빨개진다.
   */
  it('engines.node 의 하한이 tsup target 과 같다', () => {
    const target = /target:\s*'node(\d+)'/.exec(read('tsup.config.ts'));
    expect(target, 'tsup.config.ts 에서 target 을 못 찾았다').not.toBeNull();
    const engines = json('package.json').engines?.node;
    expect(engines, 'package.json 에 engines.node 가 없다').toBeTruthy();
    const floor = /(\d+)/.exec(String(engines));
    expect(floor![1], `engines.node(${engines}) 가 tsup target(node${target![1]}) 과 다르다`)
      .toBe(target![1]);
  });
});

describe('[DEP-02] 번들이 삼킨 남의 코드의 저작권 고지를 산출물이 들고 다닌다', () => {
  /**
   * `noExternal: ['yaml']` 로 yaml(ISC) 소스가 `core/dist/*.js` 안에 그대로 들어간다.
   * 그 파일이 배포되는 «사본»이고, ISC 는 모든 사본에 고지가 나타날 것을 요구한다.
   *
   * **리포에 고지 파일 하나를 두는 것으로는 부족하다** — dist 만 떼어 복사하면 고지가 떨어져
   * 나간다. 그래서 고지는 사본 «안»에 있어야 하고, 이 검사는 두 번들 «모두»를 본다.
   */
  const LICENSE = path.join(REPO, 'node_modules', 'yaml', 'LICENSE');
  const has = fs.existsSync(LICENSE);

  for (const bundle of ['core/dist/cli.js', 'core/dist/mcp.js']) {
    it(`${bundle} 이 yaml 의 ISC 고지를 담는다`, () => {
      const head = read(bundle).slice(0, 4096);
      expect(head, '저작권 표시가 없다').toContain('Copyright Eemeli Aro');
      expect(head, '허가 문구가 없다').toContain('Permission to use, copy, modify');
      expect(head, '무엇의 고지인지(패키지·라이선스) 안 적혀 있다').toMatch(/yaml v[\d.]+ \(ISC\)/);
    });
  }

  it.skipIf(!has)('고지 문구가 실제 설치된 yaml 의 LICENSE 와 일치한다 — 베껴 두면 낡는다', () => {
    const want = fs.readFileSync(LICENSE, 'utf8').trim().split('\n');
    const head = read('core/dist/cli.js').slice(0, 4096);
    for (const line of want) {
      if (!line.trim()) continue;
      expect(head, `LICENSE 의 이 줄이 번들 고지에 없다: ${line.slice(0, 40)}`).toContain(line);
    }
  });
});

describe('[PERF-09] 부하 창 판정은 한 벌이다', () => {
  /**
   * 시간 문턱을 단정하는 곳이 둘인데 **부하 창 판정은 벤치에만** 있었다. 그래서 같은 제품을
   * 두 곳이 다르게 채점했고, 회귀 테스트가 부하 창에서 제품 대신 기계를 쟀다 — [PERF-08] 이
   * 그 소동이다(판정 하루 보류 · 유휴 창 50분 대기 · 실제로는 제품 무결).
   *
   * 목록이 둘이면 언제나 한쪽이 낡는다. 그래서 「문턱을 계산하는 곳은 정의 한 곳뿐」을
   * 검사한다 — 새 측정 코드가 규칙을 또 베끼면 여기서 걸린다([UX-102] 가 세운 원칙).
   */
  const RULE = 'scripts/load-window.mjs';
  const SELF = 'core/test/supply-chain-2026-08-29.test.ts';

  it('정의 파일이 있고 판정에 필요한 것을 전부 내보낸다', async () => {
    const mod = await import(path.join(REPO, RULE));
    const w = mod.loadWindow();
    expect(typeof w.cores, 'cores').toBe('number');
    expect(typeof w.load1m, 'load1m').toBe('number');
    expect(w.threshold, '문턱 = 코어수 × BUSY_FACTOR').toBeCloseTo(w.cores * mod.BUSY_FACTOR, 6);
    expect(typeof w.busy, 'busy').toBe('boolean');
    expect(mod.busyReason(w, 'X'), '사유에 잰 값이 들어가야 한다 — 사유 없는 skip 을 만들지 않기 위해')
      .toContain(w.load1m.toFixed(2));
  });

  it('「바쁜가」의 문턱을 계산하는 파일은 정의 한 곳뿐이다', () => {
    /**
     * 재는 것은 **문턱 계산**(코어수 × 계수)이지 `loadavg` 읽기 자체가 아니다 — 벤치는 지금도
     * 세 평균을 헤더에 «표시»하고, 그것은 판정이 아니라 기록이라 정당하다. 금지해야 하는 것은
     * 「바쁜가」를 **또 정의하는 것**이다.
     */
    const dirs = ['scripts', 'core/test', 'core/src'];
    const offenders: string[] = [];
    for (const d of dirs) {
      const abs = path.join(REPO, d);
      if (!fs.existsSync(abs)) continue;
      for (const f of fs.readdirSync(abs)) {
        if (!/\.(ts|mjs|js)$/.test(f)) continue;
        const rel = `${d}/${f}`;
        if (rel === RULE || rel === SELF) continue;          // 정의 자신과 이 검사 자신은 뺀다
        const src = read(rel);
        if (/cpus\(\)\.length\s*\*/.test(src)) offenders.push(rel);
      }
    }
    expect(offenders, `부하 문턱을 또 정의한 곳이 있다 — ${RULE} 의 loadWindow() 를 읽어라`)
      .toEqual([]);
  });
});

describe('[DEP-03] 같은 버전 문자열이 다른 코드를 가리키는 것을 보이게 한다', () => {
  /**
   * 마켓플레이스 설치는 태그·SHA 가 아니라 **브랜치 HEAD** 를 따라가는데
   * `claude plugin update` 의 갱신 판단은 **버전 문자열 비교**다. 그래서 브랜치가 나아가도
   * 버전을 안 올리면 사용자는 낡은 코드에 **무증상으로** 고정된다 — 실제로 설치본(웨이브 32)과
   * 리포(웨이브 50)의 `core/src` 15파일이 전부 다른데 둘 다 `0.1.2` 였다.
   *
   * 마켓플레이스의 참조 방식은 이 리포가 못 고친다. **무증상은 고칠 수 있다** —
   * 실행 중인 번들의 지문을 버전 옆에 찍으면 두 설치를 한 줄로 비교할 수 있다.
   */
  it('`--version` 이 버전과 함께 실행 중인 번들의 지문을 낸다', () => {
    const { execFileSync } = require('node:child_process');
    const out = execFileSync(path.join(REPO, 'bin/harness'), ['--version'], { encoding: 'utf8' });
    expect(out, '버전 표기가 없다').toContain(json('package.json').version);
    expect(out, '지문이 없다 — 버전만으로는 어느 코드가 도는지 알 수 없다')
      .toMatch(/\(build [0-9a-f]{8}\)/);
  });

  it('지문이 번들에서 나온다 — 번들이 바뀌면 지문도 바뀐다', () => {
    const { execFileSync } = require('node:child_process');
    const { createHash } = require('node:crypto');
    const out = execFileSync(path.join(REPO, 'bin/harness'), ['--version'], { encoding: 'utf8' });
    const shown = /\(build ([0-9a-f]{8})\)/.exec(out)![1];
    const want = createHash('sha256')
      .update(fs.readFileSync(path.join(REPO, 'core/dist/cli.js'))).digest('hex').slice(0, 8);
    expect(shown, '지문이 실행 중인 번들과 다르다 — 그러면 비교해도 의미가 없다').toBe(want);
  });
});

describe('[SHIP-04] 설치본에 개발 도구를 내려보내지 않는다', () => {
  /**
   * `claude plugin install` 은 `npm ci --ignore-scripts` 를 돌린다. 기본값이면 devDependencies
   * 가 함께 내려와 버전마다 ~81MB 가 쌓였고, 실행 경로에는 하나도 닿지 않았다.
   * `.npmrc` 의 `omit=dev` 한 줄로 실측 **81MB → 1.3MB** 가 된다.
   *
   * 대신 **리포에서 개발할 때는 명시적으로 켜야 한다.** 그 사실이 문서에 없으면 기여자가
   * 「테스트가 안 돈다」로 막힌다 — 그래서 README 4언어가 그 플래그를 적는지 함께 본다.
   */
  it('.npmrc 가 devDependencies 를 빼고, 이유를 적는다', () => {
    const rc = read('.npmrc');
    expect(rc, 'omit=dev 가 없다').toMatch(/^omit=dev$/m);
    expect(rc, '왜 빼는지가 없으면 다음 사람이 되돌린다').toContain('SHIP-04');
  });

  it('README 4언어가 개발 설치에 --include=dev 를 적는다', () => {
    for (const f of ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh.md']) {
      expect(read(f), `${f} 가 npm install --include=dev 를 안 적는다 — omit=dev 때문에 기여자가 막힌다`)
        .toContain('npm install --include=dev');
    }
  });
});
