/**
 * 수정 라운드 2 회귀 테스트 — 출하 검증 `docs/release-readiness/2026-08-27/` 의 적색 게이트를
 * 닫은 수정들을 **재현하는 테스트**다. 라운드 1(차단 3건)은 별도 두 파일에 있다.
 *
 * 한 파일에 모으는 이유: 광고하는 테스트 파일 수(`doc-claims.test.ts`)가 파일마다 흔들리면
 * 그 자체가 반복 결함이 된다. 주제별 `describe` 로 나눈다.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '../..');

/** 터미널 표시 폭 — 한글·CJK·이모지는 두 칸이다. */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    const wide = (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf)
      || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
      || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60)
      || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1f9ff);
    w += wide ? 2 : 1;
  }
  return w;
}

const help = (args: string[], columns: number, lang: string): string => {
  try {
    return execFileSync(process.execPath, [path.join(REPO, 'bin/harness'), ...args], {
      env: { ...process.env, COLUMNS: String(columns), HARNESS_LANG: lang },
      encoding: 'utf8',
    });
  } catch (e: any) {
    return e.stdout ?? '';
  }
};

describe('[UX-01] 도움말이 좁은 터미널에서 표 정렬을 잃지 않는다', () => {
  /**
   * 예전에는 173~231자 요약을 패딩 뒤에 그대로 이어 붙였다. 80열 터미널에서 둘째 줄부터
   * **왼쪽 끝으로 돌아가** 어느 명령의 설명인지 추적할 수 없었다 — 표가 표가 아니게 된다.
   * 재는 단위는 바이트도 글자 수도 아닌 **표시 폭**이다: 한글은 한 글자가 두 칸이라
   * `str.length` 로 재면 한국어 출력이 통과처럼 보인다([UX-12] 의 잠재 결함이 여기서 실현된다).
   */
  const GROUPS = ['', 'gate', 'wave', 'node', 'tokens', 'design', 'ship', 'doc', 'adr',
    'evidence', 'loop', 'profile', 'usage', 'report', 'trace', 'phase', 'backtrack', 'migrate'];

  for (const columns of [80, 100]) {
    for (const lang of ['en', 'ko']) {
      it(`${lang} · COLUMNS=${columns} 에서 표 행이 폭을 넘지 않는다`, () => {
        const over: string[] = [];
        for (const g of GROUPS) {
          const out = help(g ? [g, '--help'] : ['--help'], columns, lang);
          for (const line of out.split('\n')) {
            if (!/^ {2,}\S/.test(line)) continue;               // 표 행만 — 산문은 자연 줄바꿈이 정상
            if (displayWidth(line) > columns) over.push(`[${g || 'root'}] ${displayWidth(line)}칸: ${line.slice(0, 50)}`);
          }
        }
        expect(over).toEqual([]);
        // [PERF-09] 명시 타임아웃. 이 테스트의 **단언**은 표시 폭이라 부하와 무관하지만,
        // 여기서 CLI 프로세스를 18번 띄우므로 **실행 시간**은 부하를 그대로 탄다.
        // 기본값(5초)에 기대면 바쁜 머신에서 「폭이 넘었다」가 아니라 「시간이 넘었다」로
        // 죽는다 — 재는 것과 다른 이유로 빨간 불이 켜지는 것이 [PERF-09] 의 부류다.
        // 문턱을 넉넉히 두는 것은 감추는 것이 아니다: 단언은 그대로이고, 시간은 이 테스트가
        // 재려는 대상이 아니다.
      }, 180_000);
    }
  }

  it('접힌 설명이 설명 칸에 맞춰 들여쓰인다 — 표 구조가 유지된다', () => {
    const out = help(['--help'], 80, 'en');
    const lines = out.split('\n');
    const i = lines.findIndex(l => /^ {2}doctor\s/.test(l));
    expect(i, 'doctor 항목을 못 찾았다').toBeGreaterThanOrEqual(0);
    // 설명이 접혔다면 다음 줄은 설명 칸 위치에서 시작해야 한다(왼쪽 끝이 아니라).
    const lead = (lines[i].match(/^ {2}\S+\s+/) ?? [''])[0].length;
    const next = lines[i + 1];
    if (next && /^\s/.test(next) && next.trim() !== '') {
      expect(next.match(/^ */)![0].length, '이어지는 줄이 왼쪽으로 흘렀다').toBe(lead);
    }
  });

  it('사용법 서식이 길어도 잘려서 뜻이 깨지지 않는다 — 구분자에서만 접는다', () => {
    const out = help(['loop', '--help'], 80, 'en');
    // `<a|b|c>` 열거가 접히더라도 각 조각은 온전해야 한다.
    expect(out).toMatch(/repeated-failure\|/);
    expect(out).toMatch(/acceptance-unclear/);
  });

  it('폭을 안 주면 결정적이다 — CI 로그가 환경에 따라 흔들리지 않는다', () => {
    const a = execFileSync(process.execPath, [path.join(REPO, 'bin/harness'), '--help'],
      { env: { ...process.env, COLUMNS: '' }, encoding: 'utf8' });
    const b = execFileSync(process.execPath, [path.join(REPO, 'bin/harness'), '--help'],
      { env: { ...process.env, COLUMNS: '' }, encoding: 'utf8' });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as os from 'node:os';
import { initHarness, readState, writeState } from '../src/state';
import { submitGate, approveGate, canEnterPhase, setPhaseViaGate } from '../src/gate';
import { readJournal } from '../src/events';

/**
 * [PERF-09] 부하 창 판정은 벤치와 **같은 한 벌**을 읽는다 — `scripts/load-window.mjs`.
 * 여기에 규칙을 베껴 두면 벤치와 테스트가 같은 제품을 다르게 채점하게 된다(그것이 [PERF-08] 소동이었다).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadWindow, busyReason } = require(path.join(__dirname, '..', '..', 'scripts', 'load-window.mjs'));

const proj = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-r2-'));
  initHarness(root);
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  return root;
};

const LONG_DOC = ['# Concept',  '', 'This document is long enough to pass the gate substance check, which requires at least',  'eighty non-whitespace characters so that a gate is a review and not a ritual.', ''].join('\n');

const approveWith = (root: string, phase: any, rel: string, body: string): void => {
  fs.writeFileSync(path.join(root, rel), body);
  submitGate(root, phase, { paths: [rel], evidence: 'measured' });
  approveGate(root, phase);
};

describe('[LOGIC-01] 승인 뒤에 고친 산출물로는 다음 페이즈에 들어갈 수 없다', () => {
  /**
   * 계약(`gate.ts` 머리)은 「승인 후 몰래 고친 문서로 다음 페이즈에 들어갈 수 없다」인데,
   * 자동 무효화가 **수동 `gate sweep` 한 곳에만** 배선돼 있어 전이가 그대로 통과했다.
   * 설계 영역(`docs/`)은 에이전트가 정당하게 쓰는 곳이라 이 경로는 실제로 열려 있었다.
   */
  it('산출물이 그대로면 전이한다 — 대조군', () => {
    const root = proj();
    approveWith(root, 'P0', 'docs/00-concept.md', LONG_DOC);
    expect(() => setPhaseViaGate(root, 'P1')).not.toThrow();
    expect(readState(root).phase).toBe('P1');
  });

  it('승인 후 산출물을 고치면 전이가 막히고 게이트가 무효화된다', () => {
    const root = proj();
    approveWith(root, 'P0', 'docs/00-concept.md', LONG_DOC);
    fs.appendFileSync(path.join(root, 'docs/00-concept.md'), 'a line nobody approved\n');

    expect(() => setPhaseViaGate(root, 'P1')).toThrow();
    expect(readState(root).phase).toBe('P0');                 // 전이하지 않았다
    expect(readState(root).gates.P0?.status).toBe('invalidated');
    expect(readState(root).gates.P0?.invalidatedReason ?? '').not.toBe('');
  });

  it('무효화가 저널에 남는다 — 조용히 일어나지 않는다', () => {
    const root = proj();
    approveWith(root, 'P0', 'docs/00-concept.md', LONG_DOC);
    fs.appendFileSync(path.join(root, 'docs/00-concept.md'), 'drift\n');
    try { setPhaseViaGate(root, 'P1'); } catch { /* 막히는 것이 기대값이다 */ }
    const types = readJournal(root).events.map((e: any) => e.type);
    expect(types).toContain('gate-invalidated');
  });

  it('판정 함수는 순수하게 남는다 — canEnterPhase 는 쓰지 않는다', () => {
    const root = proj();
    approveWith(root, 'P0', 'docs/00-concept.md', LONG_DOC);
    fs.appendFileSync(path.join(root, 'docs/00-concept.md'), 'drift\n');
    const before = readJournal(root).events.length;
    canEnterPhase(root, 'P1');
    expect(readJournal(root).events.length).toBe(before);
  });
});

describe('[LOGIC-02] harness 명령은 소유 파일을 덮는 길이 아니다', () => {
  /**
   * `assertOutputAllowed` 가 「루트 안인가」와 「설계 트랙 소스인가」만 봤다. 그래서
   * `harness evidence spec … --out .harness/events.jsonl` 이 exit 0 으로 **정본 저널을
   * 생성 스펙 텍스트로 교체**했고, 그 뒤 `harness doctor` 는 `ok: true` 라고 답했다.
   */
  const cli = (root: string, args: string[]): { code: number; err: string } => {
    try {
      execFileSync(process.execPath, [path.join(REPO, 'bin/harness'), ...args],
        { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, err: '' };
    } catch (e: any) {
      return { code: e.status ?? -1, err: String(e.stderr ?? '') };
    }
  };

  for (const owned of ['.harness/events.jsonl', '.harness/state.json', '.harness/config.yaml']) {
    it(`--out 으로 ${owned} 를 덮을 수 없다`, () => {
      const root = proj();
      const before = fs.readFileSync(path.join(root, owned), 'utf8');
      const r = cli(root, ['evidence', 'spec', 'UX-1', '--wave', 'wave-001', '--out', owned]);
      expect(r.code).not.toBe(0);
      expect(fs.readFileSync(path.join(root, owned), 'utf8')).toBe(before);   // 한 바이트도 안 바뀐다
    });
  }

  it('무해한 --out 은 그대로 동작한다 — 과차단이 아니다', () => {
    const root = proj();
    const r = cli(root, ['evidence', 'spec', 'UX-1', '--wave', 'wave-001', '--out', 'docs/spec.md']);
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(root, 'docs/spec.md'))).toBe(true);
  });

  it('빌드 트랙에서도 소유 파일 보호가 풀리지 않는다', () => {
    const root = proj();
    writeState(root, { ...readState(root), phase: 'P8' as any });
    const before = fs.readFileSync(path.join(root, '.harness/events.jsonl'), 'utf8');
    const r = cli(root, ['evidence', 'spec', 'UX-1', '--wave', 'wave-001', '--out', '.harness/events.jsonl']);
    expect(r.code).not.toBe(0);
    expect(fs.readFileSync(path.join(root, '.harness/events.jsonl'), 'utf8')).toBe(before);
  });
});

describe('[API-05] 종료코드가 「판정이 아니오」와 「명령이 못 돌았다」를 가른다', () => {
  /**
   * 예전에는 둘 다 `1` 이었다. `harness ship verdict` 는 출하 게이트라 CI 가
   * `harness ship verdict || exit 1` 로 쓰는 것이 정상 사용인데, **엉뚱한 디렉토리에서
   * 실행했거나 하위명령을 오타 냈을 때도 같은 exit 1** 이 나와 릴리스가 멈춘 이유를 오해했다.
   */
  const code = (root: string, args: string[]): number => {
    try {
      execFileSync(process.execPath, [path.join(REPO, 'bin/harness'), ...args],
        { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: 'pipe' });
      return 0;
    } catch (e: any) { return e.status ?? -1; }
  };

  it('0 — 성공', () => {
    const root = proj();
    expect(code(root, ['status'])).toBe(0);
    expect(code(root, ['doctor'])).toBe(0);
  });

  it('1 — 사용법·환경 오류', () => {
    const root = proj();
    expect(code(root, ['ship', 'verdikt'])).toBe(1);          // 하위명령 오타
    expect(code(root, ['frobnicate'])).toBe(1);               // 없는 최상위 명령
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-plain-'));
    expect(code(plain, ['status'])).toBe(1);                  // .harness/ 가 없는 곳
  });

  it('2 — 판정이 「아니오」', () => {
    const root = proj();
    expect(code(root, ['ship', 'verdict'])).toBe(2);          // 출하 게이트 미승인 → NO-GO
    expect(code(root, ['gate', 'verify', 'P0'])).toBe(2);     // 승인된 적 없음
  });

  it('두 부류가 실제로 구분된다 — 이게 이 결함의 전부다', () => {
    const root = proj();
    const verdictNo = code(root, ['ship', 'verdict']);
    const usageErr = code(root, ['ship', 'verdikt']);
    expect(verdictNo).not.toBe(usageErr);
    expect(verdictNo).not.toBe(0);
    expect(usageErr).not.toBe(0);                             // 둘 다 여전히 스크립트를 멈춘다
  });

  it('규약이 도움말에 적혀 있다 — 문서화돼야 계약이다', () => {
    const out = help(['--help'], 100, 'en');
    expect(out).toMatch(/Exit codes/);
    expect(out).toMatch(/verdict is no/);
  });
});

describe('[SHIP-06] 미래 스키마를 조용히 읽고 그 위에 쓰지 않는다', () => {
  /**
   * 검사가 `doctor` 한 곳뿐이었고 그것도 `warnings` 였다 — **사용자가 일부러 돌려야만 보인다.**
   * `status`·`phase set`·`wave …`·훅은 전부 무검사 경로를 탔다. 다운그레이드한 사용자는
   * 「새 스키마를 구 코드가 오독한 상태」로 판정을 계속 받는다 — 「조용한 기본값」 그 자체다.
   */
  const bump = (root: string, v: number): void => {
    const p = path.join(root, '.harness/state.json');
    const s = JSON.parse(fs.readFileSync(p, 'utf8'));
    fs.writeFileSync(p, JSON.stringify({ ...s, schemaVersion: v }, null, 2));
  };

  const run = (root: string, args: string[]): { code: number; out: string } => {
    try {
      const out = execFileSync(process.execPath, [path.join(REPO, 'bin/harness'), ...args],
        { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, out };
    } catch (e: any) {
      return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
    }
  };

  it('일반 명령이 미래 스키마를 조용히 읽지 않는다', () => {
    const root = proj();
    bump(root, 2);
    const r = run(root, ['status']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/newer harness|더 새 버전/);
    expect(r.out).toMatch(/schemaVersion 2/);
  });

  it('그 위에 쓰지도 않는다 — 새 빌드가 기록한 것을 잃지 않는다', () => {
    const root = proj();
    bump(root, 2);
    const before = fs.readFileSync(path.join(root, '.harness/state.json'), 'utf8');
    run(root, ['wave', 'create', '--goal', 'downgrade probe']);
    expect(fs.readFileSync(path.join(root, '.harness/state.json'), 'utf8')).toBe(before);
  });

  it('처방이 있다 — 무엇을 하면 되는지 말한다', () => {
    const root = proj();
    bump(root, 2);
    expect(run(root, ['status']).out).toMatch(/Upgrade the harness|업그레이드/);
  });

  it('현재·과거 버전은 막지 않는다 — 업그레이드 경로는 제품이 광고하는 것이다', () => {
    const root = proj();
    expect(run(root, ['status']).code).toBe(0);               // v1 그대로
    bump(root, 0);
    expect(run(root, ['status']).code).toBe(0);               // 구 버전은 마이그레이션의 몫
  });

  it('손상과 버전 불일치의 처방이 섞이지 않는다 — 둘은 다른 문제다', () => {
    const root = proj();
    bump(root, 2);
    const out = run(root, ['status']).out;
    expect(out).not.toMatch(/doctor --repair/);               // 재생은 여기서 답이 아니다
  });
});

describe('[API-04] 훅이 상한에서도 10초 예산 안에 끝난다', () => {
  /**
   * 상한(`MAX_BYTES`)은 **훅 타임아웃에서 역산한 값**인데 그 역산이 낡아 있었다. 근거였던
   * 「1MB 당 약 1초」가 규칙이 늘면서 사실이 아니게 됐고, 출하 검증이 1.03MB 명령에서
   * **10.1~12.8초**를 실측했다 — 상한 아래 구간이 통째로 **fail-open**(타임아웃 → 무판정 → 통과)
   * 이었다.
   *
   * **숫자를 주석에 적어 두는 것만으로는 또 낡는다.** 그래서 여기서 상한에서의 e2e 를
   * **매번 다시 잰다.** 문턱은 넉넉하게 둔다 — 이 테스트는 「예산에 붙었는지」를 잡는 것이지
   * 성능을 재는 것이 아니고, CI 는 대개 조용하지 않다.
   */
  const BUDGET_MS = 10_000;
  const ALARM_MS = 8_000;                                    // 예산의 80% — 여기 닿으면 상한을 다시 역산할 때다

  it('상한 바로 아래 페이로드가 예산의 80% 안에 끝난다', (ctx: any) => {
    /**
     * [PERF-09] **부하 창에서는 시간 판정을 하지 않는다.**
     *
     * 이 단언은 wall-clock 이고, wall-clock 은 바쁜 머신에서 제품이 아니라 경쟁 프로세스를
     * 잰다 — 벤치가 처음부터 그렇게 적어 뒀는데(`scripts/bench-hook-latency.mjs`) 이 테스트만
     * 그 판정을 갖고 있지 않았다. 그 결과 [PERF-08] 이 열려 판정이 하루 멈췄고, 유휴 창을
     * 50분 기다렸는데도 열리지 않았다. 실제로는 제품에 아무 문제가 없었다.
     *
     * **대체 단언을 넣지 않은 이유는 실측이다.** 같은 페이로드로 세 후보를 재 봤더니
     * 부하 창에서 전부 흔들렸다 — wall 7.6배 · CPU 시간 1.7배 · 같은 창 기준값 대비 비율
     * 3.7배(수치는 `scripts/load-window.mjs` 주석). **CPU 시간조차 대체재가 아니다.**
     * 그러므로 여기서 할 수 있는 정직한 일은 「판정 불가」를 사유와 함께 적는 것뿐이다.
     */
    const w = loadWindow();
    if (w.busy) {
      const why = busyReason(w, '[API-04] 상한 e2e');
      console.warn(why);
      ctx.skip(why);
      return;
    }
    const root = proj();
    // 가장 비싼 형태(반복 `cd` + 리다이렉트). 상한 1MB 바로 아래를 겨눈다.
    // 조각 길이가 자릿수에 따라 늘어나므로 **바이트를 세어 가며** 채운다(고정 계산은 넘친다).
    const parts: string[] = [];
    let bytes = 0;
    for (let i = 0; bytes < 1024 * 1024 - 8192; i++) {
      const p = `cd d${i} > f${i}`;
      parts.push(p);
      bytes += p.length + 2;
    }
    const cmd = parts.join('; ');
    expect(Buffer.byteLength(cmd)).toBeLessThan(1024 * 1024);

    const t0 = Date.now();
    let out = '';
    try {
      out = execFileSync(path.join(REPO, 'bin/harness-hook'), ['pre-tool'], {
        input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cmd } }),
        cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: 'pipe',
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) { out = String((e as { stdout?: string }).stdout ?? ''); /* deny 여도 시간은 잰다 */ }
    const ms = Date.now() - t0;
    const where = `상한에서 ${ms}ms (유휴 창 load1m ${w.load1m.toFixed(2)}/${w.cores}코어, ${w.cores}코어)`;

    /**
     * [API-31] **이 단언은 「이 머신에서 빠른가」가 아니라 「어떤 머신에서도 조용히 통과하지
     * 않는가」다.**
     *
     * 예전에는 `ms < ALARM_MS` 하나였다. 그것은 **역산을 한 대의 머신에서 했다는 사실**을
     * 단언으로 굳힌 것이었고, CI 첫 실행이 그 값을 깼다 — 4코어 러너에서 같은 페이로드가
     * 10029ms 였다(개발기 4272ms). 그리고 그 실패는 눈금 문제가 아니었다: 예산을 넘긴
     * 훅은 플랫폼이 죽이고 **죽은 훅은 통과**이므로, [API-04] 가 닫았다고 적은 fail-open 이
     * 평범한 러너에서 열려 있었다는 뜻이었다.
     *
     * [API-31] 이 그것을 시간으로 닫았다(판정 마감 → 초과하면 거부). 그래서 여기서 지킬
     * 불변식은 둘이다 — 느린 머신에서도 성립한다:
     */
    // (1) 예산 «안에서» 판정을 내보내고 끝난다. 넘기면 플랫폼이 죽이고, 죽은 훅은 통과다.
    expect(ms, `${where} — 예산 ${BUDGET_MS}ms 를 넘겼다. 넘긴 훅은 죽고 죽은 훅은 통과다`)
      .toBeLessThan(BUDGET_MS);
    // (2) 알람을 넘겼다면 이 머신이 느리다는 뜻이고, 그때 허용되는 결말은 **시간초과 거부**뿐이다.
    //     조용한 통과는 닫아 둔 fail-open 이 다시 열린 것이다.
    if (ms >= ALARM_MS) {
      expect(/"permissionDecision":"deny"/.test(out) && /(judging budget|시간 예산)/.test(out),
        `${where} — 알람 ${ALARM_MS}ms 를 넘겼는데 시간초과 거부가 아니다: ${out.slice(0, 200) || '(무출력 = 통과)'}`)
        .toBe(true);
    }
  }, 60_000);

  it('상한을 넘는 입력은 즉시 거부된다 — 읽다 타임아웃 나지 않는다', () => {
    const root = proj();
    const cmd = 'echo ' + 'a'.repeat(3 * 1024 * 1024) + ' > out.txt';
    const t0 = Date.now();
    let denied = false;
    try {
      const out = execFileSync(path.join(REPO, 'bin/harness-hook'), ['pre-tool'], {
        input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cmd } }),
        cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8',
        stdio: 'pipe', maxBuffer: 64 * 1024 * 1024,
      });
      denied = /deny/.test(out);
    } catch (e: any) { denied = /deny/.test(String(e.stdout ?? '')); }
    const ms = Date.now() - t0;
    expect(denied, '상한 초과가 거부되지 않았다 — 통과시킬 근거가 아니다').toBe(true);
    expect(ms, '상한 초과인데 오래 걸렸다 — 읽지 말고 바로 거부해야 한다').toBeLessThan(5_000);
  }, 60_000);
});

describe('[LOGIC-02 잔여] 손상된 웨이브 지시서를 doctor 가 본다 — 쓰기를 막지 않고 손실을 관측 가능하게', () => {
  /**
   * 웨이브 지시서는 제품이 스스로 밝힌 **저널·git 백업이 없는 유일한 파일**이고, README 는
   * `.harness/` 아래를 「언제나 쓸 수 있다」고 광고한다. 그래서 에이전트가 `Write` 로 통째로
   * 덮을 수 있고, 그러면 턴 로그·완료기준이 복구 불가로 사라지며 웨이브가 완료 불능이 된다.
   *
   * 예전 `doctor` 는 **부재만** 봤다 — 파일이 있으면 통과였다. 즉 가장 조용한 데이터 손실
   * 경로가 진단의 사각이었다. **쓰기를 막는 대신**(막으면 광고를 함께 고쳐야 하고 그건
   * 사람이 정할 일이다) 손실을 **보이게** 만든다.
   */
  const cli = (root: string, args: string[]): { code: number; out: string } => {
    try {
      const out = execFileSync(process.execPath, [path.join(REPO, 'bin/harness'), ...args],
        { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, out };
    } catch (e: any) { return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }; }
  };

  const hookWrite = (root: string, file: string): string => {
    try {
      const out = execFileSync(path.join(REPO, 'bin/harness-hook'), ['pre-tool'], {
        input: JSON.stringify({
          hook_event_name: 'PreToolUse', tool_name: 'Write',
          tool_input: { file_path: file, content: 'x' },
        }),
        cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', stdio: 'pipe',
      });
      if (!out.trim()) return 'allow';
      return JSON.parse(out)?.hookSpecificOutput?.permissionDecision ?? 'allow';
    } catch { return 'error'; }
  };

  /** 활성 웨이브가 있는 프로젝트와 그 웨이브 id. */
  const withActiveWave = (): { root: string; id: string } => {
    const root = proj();
    cli(root, ['wave', 'create', '--goal', 'a goal long enough to read as a real wave goal here']);
    let id = '';
    try { id = (JSON.parse(cli(root, ['wave', 'list']).out)[0] ?? {}).id ?? ''; } catch { id = ''; }
    // `create` 는 만들기만 한다 — `activeWave` 는 `activate` 가 세운다(축① 이 실측한 수명주기).
    if (id) cli(root, ['wave', 'activate', id]);
    return { root, id };
  };

  const sheet = (root: string, id: string): string => path.join(root, '.harness', 'waves', `${id}.md`);

  it('멀쩡한 지시서에는 조용하다 — 과보고 없음', () => {
    const { root, id } = withActiveWave();
    expect(id, '웨이브가 만들어지지 않았다').not.toBe('');
    expect(cli(root, ['doctor']).out).not.toMatch(/cannot be parsed|해석할 수 없다/);
  });

  it('지시서를 덮으면 doctor 가 그것을 말한다', () => {
    const { root, id } = withActiveWave();
    expect(id).not.toBe('');
    fs.writeFileSync(sheet(root, id), 'clobbered by a plain Write\n');
    const out = cli(root, ['doctor']).out;
    expect(out).toMatch(/cannot be parsed|해석할 수 없다/);
    expect(out).toMatch(/no journal or git backup|저널·git 백업이 없는/);
  });

  it('처방이 부재와 같다 — 이미 있는 복구 경로를 쓴다', () => {
    const { root, id } = withActiveWave();
    expect(id).not.toBe('');
    fs.writeFileSync(sheet(root, id), 'clobbered\n');
    expect(cli(root, ['doctor']).out).toMatch(/doctor --repair/);
  });

  it('쓰기 자체는 여전히 허용된다 — 광고를 바꾸지 않았다', () => {
    const { root, id } = withActiveWave();
    expect(id).not.toBe('');
    expect(hookWrite(root, `.harness/waves/${id}.md`)).toBe('allow');
  });
});

describe('[OPS-06] 재생할 수 없을 만큼 큰 저널에서 훅이 타임아웃 대신 fail-closed 로 떨어진다', () => {
  /**
   * 훅은 10초를 받고 **초과하면 죽고, 죽은 훅은 통과다.** 그런데 state.json 이 깨진 경로
   * (= 재생 경로)에는 상한이 없었다 — 감사 실측: 70MB 재생 1.2초 · **532MB 재생 12.4초 →
   * 타임아웃 초과 → fail-open.** 하필 그 조건이 `doctor --repair` 가 필요한 바로 그 순간이라
   * **무결성이 가장 필요할 때 강제가 꺼진다.**
   *
   * 테스트는 **희소 파일**로 크기만 만든다 — 128MB 를 실제로 쓰면 디스크와 시간을 태우는데,
   * 검사 대상은 «크기 판정»이지 내용이 아니다.
   */
  const huge = (root: string, mb: number): void => {
    const p = path.join(root, '.harness', 'events.jsonl');
    const fd = fs.openSync(p, 'r+');
    fs.ftruncateSync(fd, mb * 1024 * 1024);                   // 희소 — 실제 블록을 안 먹는다
    fs.closeSync(fd);
  };
  const breakState = (root: string): void =>
    fs.writeFileSync(path.join(root, '.harness', 'state.json'), '{ broken');

  const hook = (root: string, event: string, input: object): any => {
    try {
      const out = execFileSync(path.join(REPO, 'bin/harness-hook'), [event], {
        input: JSON.stringify(input), cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', stdio: 'pipe',
      });
      return out.trim() ? JSON.parse(out) : null;
    } catch (e: any) {
      const s = String(e.stdout ?? '').trim();
      return s ? JSON.parse(s) : null;
    }
  };
  const decision = (o: any): string => o?.hookSpecificOutput?.permissionDecision ?? 'allow';

  it('상한 아래에서는 예전처럼 재생한다 — 대조군', () => {
    const root = proj();
    breakState(root);
    const ctx = hook(root, 'session-start', { source: 'startup' })?.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toMatch(/journal replay|재생으로 동작/);
    expect(ctx).not.toMatch(/too large to replay|재생할 수 없다/);
  });

  it('상한을 넘으면 재생을 포기하되 **통과시키지 않는다**', () => {
    const root = proj();
    huge(root, 200);
    breakState(root);
    expect(decision(hook(root, 'pre-tool', {
      tool_name: 'Write', tool_input: { file_path: 'src/app.ts', content: 'x' },
    }))).toBe('deny');
  });

  it('사용자가 빠져나갈 길이 열려 있다 — 읽기와 harness 명령은 막지 않는다', () => {
    const root = proj();
    huge(root, 200);
    breakState(root);
    expect(decision(hook(root, 'pre-tool', {
      tool_name: 'Bash', tool_input: { command: 'cat README.md' },
    }))).toBe('allow');
    expect(decision(hook(root, 'pre-tool', {
      tool_name: 'Bash', tool_input: { command: 'harness doctor --repair' },
    }))).toBe('allow');
  });

  it('배너가 무슨 일인지와 다음 행동을 말한다', () => {
    const root = proj();
    huge(root, 200);
    breakState(root);
    const ctx = hook(root, 'session-start', { source: 'startup' })?.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toMatch(/too large to replay|재생할 수 없다/);
    expect(ctx).toMatch(/doctor --repair/);
    expect(ctx).toMatch(/200MB|200 ?MB/);
  });

  it('예산 안에 끝난다 — 타임아웃으로 죽지 않는다(이 결함의 본체)', () => {
    const root = proj();
    huge(root, 600);                                          // 감사가 fail-open 을 본 규모(532MB) 이상
    breakState(root);
    const t0 = Date.now();
    const d = decision(hook(root, 'pre-tool', {
      tool_name: 'Write', tool_input: { file_path: 'src/app.ts', content: 'x' },
    }));
    const ms = Date.now() - t0;
    expect(d).toBe('deny');
    expect(ms, `${ms}ms — 훅 예산 10초에 붙는다`).toBeLessThan(5_000);
  }, 60_000);
});
