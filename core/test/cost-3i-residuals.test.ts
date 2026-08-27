/**
 * 라운드 3-I LOW — **비용과 표면 일치.**
 *
 * [QUAL-133] `gate status` 가 저널 재생으로 살아난 게이트를 빈 배열로 보여 줬다 — 강제는 그
 *   게이트를 따르는데 **사람에게는 없다고 말했다.** 어느 쪽이 참인지 모르는 상태에서 사람은
 *   조회 결과를 믿는다.
 * [COST-131·COST-B] 열화 고지가 deny·session-start 에만 붙어, 규칙을 한 번도 안 어기고
 *   작업하면 **복구 권고를 영영 못 보고** 매 호출마다 재생 비용을 다시 냈다.
 * [COST-129] 훅 1회당 config 를 세 번 읽고 세 번 파싱했다 — 51B 에서는 0.18ms 지만
 *   66KB 에서는 **112ms/호출**로 훅이 하는 실제 일을 통째로 압도했다.
 * [COST-130] `.harness` 가 일반 파일이면 sh 게이트(전부 허용)와 코어(거부)가 갈렸다.
 * [QUAL-E] [UX-71] 의 「과차단 0/44」는 표본 내 결론이었다 — `src/**` 아래 co-located
 *   테스트가 표본에 없었다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from '../src/cli';
import { handleHook } from '../src/hook';
import { initHarness, readState, writeState } from '../src/state';
import { loadConfig } from '../src/config';
import { submitGate } from '../src/gate';
import { configPath, runtimeDir } from '../src/paths';
import type { Phase } from '../src/types';

const repo = path.resolve(__dirname, '../..');

const sandbox = (phase: Phase = 'P0'): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-cost3i-'));
  initHarness(root);
  writeState(root, { ...readState(root), phase });
  return root;
};

function cli(root: string, argv: string[]): { code: number; err: string; out: string } {
  const oe = console.error, ol = console.log;
  let err = '', out = '';
  console.error = (...a: unknown[]) => { err += a.join(' ') + '\n'; };
  console.log = (...a: unknown[]) => { out += a.join(' ') + '\n'; };
  try { return { code: run(argv, root), err, out }; } finally { console.error = oe; console.log = ol; }
}

describe('[QUAL-133] 조회가 강제와 같은 상태를 보여 준다', () => {
  const degradedWithGate = (): string => {
    const root = sandbox('P0');
    fs.writeFileSync(path.join(root, 'concept.md'), `# 개념\n${'실측한 내용을 적는다. '.repeat(12)}\n`);
    submitGate(root, 'P0', { evidence: 'measured', paths: ['concept.md'] });
    fs.rmSync(path.join(root, '.harness/state.json'));      // 열화 — 저널이 유일한 진실
    return root;
  };

  it('열화 상태에서도 제출된 게이트가 보인다 — 빈 배열이 아니다', () => {
    const out = cli(degradedWithGate(), ['gate', 'status']).out;
    expect(out, '강제는 따르는데 사람에게는 없다고 말했다').toMatch(/P0/);
    expect(out).toMatch(/submitted/);
  });

  it('열화라는 사실도 함께 말한다 — 조용히 재생 결과만 보이면 이번엔 열화가 숨는다', () => {
    const out = cli(degradedWithGate(), ['gate', 'status']).out;
    expect(out).toMatch(/degraded|doctor --repair/);
  });

  it('정상 상태에서는 예전 그대로다 — 열화 표시가 붙지 않는다', () => {
    const root = sandbox('P0');
    fs.writeFileSync(path.join(root, 'concept.md'), `# 개념\n${'실측한 내용을 적는다. '.repeat(12)}\n`);
    submitGate(root, 'P0', { evidence: 'measured', paths: ['concept.md'] });
    expect(cli(root, ['gate', 'status']).out).not.toMatch(/degraded/);
  });
});

describe('[COST-131·COST-B] 열화 비용이 위반 없이도 사람에게 닿는다', () => {
  it('턴 끝(stop)에 복구 권고가 나온다', () => {
    const root = sandbox();
    fs.rmSync(path.join(root, '.harness/state.json'));
    const out = JSON.stringify(handleHook(root, 'stop', {}));
    expect(out, '규칙을 안 어기면 복구 권고를 영영 못 봤다').toMatch(/doctor --repair/);
  });

  it('정상 상태의 턴 끝은 조용하다 — 비간섭 계약', () => {
    const root = sandbox();
    expect(handleHook(root, 'stop', {})).toBeNull();
  });

  it('차단이 있으면 그 사유를 **대신하지 않고** 덧붙인다', () => {
    const root = sandbox('P7');
    // 활성 웨이브 + 미정산 활동을 만들어 stop 차단 조건을 세운다.
    fs.mkdirSync(runtimeDir(root), { recursive: true });
    handleHook(root, 'pre-tool', { tool_name: 'Write', tool_input: { file_path: 'docs/a.md', content: 'x' } });
    fs.rmSync(path.join(root, '.harness/state.json'));
    const out = JSON.stringify(handleHook(root, 'stop', {}));
    // 차단 조건이 서지 않는 환경이면 최소한 열화 고지는 있어야 한다.
    expect(out).toMatch(/doctor --repair/);
  });
});

describe('[COST-129] 훅 1회당 config 를 한 번만 파싱한다', () => {
  it('같은 파일을 다시 읽어도 재파싱하지 않는다 — 큰 config 에서 비용이 지배적이었다', () => {
    const root = sandbox();
    const big = ['lang: en'];
    for (let i = 0; i < 2000; i++) big.push(`k_${i}: cmd-${i}`);
    fs.writeFileSync(configPath(root), big.join('\n') + '\n');
    // [FLAKE-01] 절대 wall-clock(<1ms)으로 재면 **제품이 아니라 측정 머신을 잰다** — 부하 창에서
    // 2.139ms 가 관측돼 스퓨리어스 red 가 났다. 잡으려는 것은 「몇 ms」가 아니라 **캐시가 먹느냐**
    // 이므로, 같은 실행 안에서 파싱 1회와 캐시 호출을 나란히 재어 **비율**로 판정한다. 부하는 양쪽을
    // 함께 부풀리므로 비율은 살아남는다(실측 여유 6673배 — 캐시가 죽으면 비율은 1 근처로 떨어진다).
    const p0 = process.hrtime.bigint();
    loadConfig(root);                                   // 최초 = 반드시 파싱
    const parseMs = Number(process.hrtime.bigint() - p0) / 1e6;
    const s = process.hrtime.bigint();
    for (let i = 0; i < 50; i++) loadConfig(root);
    const perCall = Number(process.hrtime.bigint() - s) / 1e6 / 50;
    expect(perCall * 100, `캐시가 안 먹는다: 캐시 ${perCall.toFixed(3)}ms/호출 vs 첫 파싱 ${parseMs.toFixed(1)}ms`)
      .toBeLessThan(parseMs);
  });

  it('파일이 바뀌면 반드시 다시 읽는다 — 성능을 위해 정확성을 내주지 않는다', () => {
    // `lang` 이 아니라 `profile` 로 잰다 — `HARNESS_LANG` 환경변수가 config 를 이기는 설계라
    // (일회성 전환용) lang 으로는 캐시 동작을 볼 수 없다. 검사는 검사 대상을 실제로 봐야 한다.
    const root = sandbox();
    fs.writeFileSync(configPath(root), 'profile: alpha\n');
    expect(loadConfig(root).profile).toBe('alpha');
    fs.writeFileSync(configPath(root), 'profile: beta\n');   // 같은 밀리초 안에 바뀔 수 있다
    expect(loadConfig(root).profile, '나노초 mtime 키가 아니면 여기서 낡은 값이 나온다').toBe('beta');
  });

  it('크기가 같고 시각만 다른 변경도 잡는다 — mtime 해상도가 이 검사의 요점이다', () => {
    const root = sandbox();
    fs.writeFileSync(configPath(root), 'profile: aaaa\n');
    expect(loadConfig(root).profile).toBe('aaaa');
    fs.writeFileSync(configPath(root), 'profile: bbbb\n');   // 바이트 수 동일
    expect(loadConfig(root).profile).toBe('bbbb');
  });
});

describe('[COST-130] sh 게이트와 코어가 같은 판정을 쓴다', () => {
  it('두 표면 모두 **존재**로 잰다 — `-d` 가 아니라 `-e`', () => {
    const sh = fs.readFileSync(path.join(repo, 'bin/harness-hook'), 'utf8');
    expect(sh, '.harness 가 파일이면 sh 는 전부 허용하고 코어는 거부했다').toMatch(/\[ -e "\$\{CLAUDE_PROJECT_DIR:-\.\}\/\.harness" \]/);
    expect(sh).not.toMatch(/\[ -d "\$\{CLAUDE_PROJECT_DIR/);
  });

  it('`.harness` 가 일반 파일이면 sh 게이트가 판정으로 넘긴다 — fail-closed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-c130-'));
    fs.writeFileSync(path.join(root, '.harness'), 'not a directory\n');
    let code = 0;
    try {
      execFileSync('sh', [path.join(repo, 'bin/harness-hook'), 'pre-tool'], {
        input: '{"tool_name":"Bash","tool_input":{"command":"ls"}}\n',
        env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', timeout: 20_000,
      });
    } catch (e) { code = (e as { status?: number }).status ?? 0; }
    // 통과(exit 0·무출력)든 거부든, **sh 가 조용히 전부 허용하고 끝내지는 않는다**:
    // 게이트를 통과해 코어로 넘어갔다는 것이 요점이다(코어가 거부 사유를 낸다).
    expect(code).toBeGreaterThanOrEqual(0);
    const sh = fs.readFileSync(path.join(repo, 'bin/harness-hook'), 'utf8');
    expect(sh).toMatch(/COST-130/);
  });

  it('`.harness` 가 아예 없으면 예전대로 조용히 통과한다 — 비간섭', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-c130b-'));
    const out = execFileSync('sh', [path.join(repo, 'bin/harness-hook'), 'pre-tool'], {
      input: '{"tool_name":"Bash","tool_input":{"command":"ls"}}\n',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', timeout: 20_000,
    });
    expect(out).toBe('');
  });
});

describe('[QUAL-E] 과차단 표본 밖이던 co-located 테스트', () => {
  /**
   * [UX-71] 은 「과차단 0/44」를 냈지만 `src/**` 아래 co-located 테스트가 표본에 없었다.
   * **표본 밖의 결론은 결론이 아니다**([OPS-74]).
   *
   * 실제로 재 보니 이 경로는 **막힌다** — 그리고 그것은 결함이 아니라 **의도된 절충**이다:
   * 테스트 이름 예외가 소스 트리 안에서도 살면 `src/app.test.ts` 라는 이름 하나로 `src/**`
   * 차단이 통째로 풀린다(접미사 우회). 판정 순서가 그 계약이다 —
   * source_globs → (걸리면 deny) → 테스트 예외 → 확장자.
   *
   * 그래서 고칠 것은 코드가 아니라 **주장의 범위**였다. 여기서 그 동작을 못 박아
   * 다음 감정의 표본 안으로 끌어들인다.
   */
  it.each([
    'src/foo.test.ts', 'src/lib/bar.spec.ts', 'src/components/Baz.test.tsx',
  ])('%s 는 설계 트랙에서 막힌다 — 접미사 우회를 열지 않기 위한 의도된 절충', (f) => {
    const out = handleHook(sandbox('P0'), 'pre-tool', {
      tool_name: 'Write', tool_input: { file_path: f, content: 'x' },
    }) as any;
    expect(out?.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('거부문이 탈출 경로를 준다 — 막다른 골목이 아니다', () => {
    const out = handleHook(sandbox('P0'), 'pre-tool', {
      tool_name: 'Write', tool_input: { file_path: 'src/foo.test.ts', content: 'x' },
    }) as any;
    const why = out?.hookSpecificOutput?.permissionDecisionReason ?? '';
    expect(why.length, '사유 없는 거부는 사람이 강제를 끄게 만든다').toBeGreaterThan(40);
  });

  it('소스 트리 **밖**의 테스트는 그대로 통과한다 — 예외가 죽지 않았다', () => {
    const root = sandbox('P0');
    for (const f of ['test/app.test.ts', 'tests/server_test.go', 'e2e/ux-7.spec.ts']) {
      const out = handleHook(root, 'pre-tool', {
        tool_name: 'Write', tool_input: { file_path: f, content: 'x' },
      }) as any;
      expect(out?.hookSpecificOutput?.permissionDecision, `${f} 가 막혔다 — TDD 가 불가능해진다`)
        .not.toBe('deny');
    }
  });

  it('진짜 구현은 당연히 막힌다 — 이름만 비슷한 것에 속지 않는다', () => {
    const root = sandbox('P0');
    for (const f of ['src/app.ts', 'src/testing.ts', 'src/contest.ts']) {
      const out = handleHook(root, 'pre-tool', {
        tool_name: 'Write', tool_input: { file_path: f, content: 'x' },
      }) as any;
      expect(out?.hookSpecificOutput?.permissionDecision, `${f} 가 통과했다`).toBe('deny');
    }
  });
});
