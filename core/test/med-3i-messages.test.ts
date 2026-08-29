/**
 * 라운드 3-I MED — **거부·안내가 틀린 곳을 가리키는** 계열 4건.
 *
 * 네 건의 뿌리가 같다: **원인과 처방이 어긋난다.** 사용자는 문구를 믿고 움직이므로,
 * 틀린 곳을 가리키는 거부는 거부하지 않는 것보다 나쁘다 — 사람을 엉뚱한 수리로 보낸다.
 *
 * [VAL-134] 프로젝트 **안**의 없는 파일을 「프로젝트 밖」으로 오진.
 * [UX-144]  usage 티어 하향이 기록되지 않아 stale 지시가 무기한 주입(해제 명령 없음).
 * [UX-145]  `evidence packet` 이 원인 둘을 usage 한 줄로 뭉침 — 형제 명령은 설명하는데.
 * [UX-147]  `profile cmd` 처방이 **번들 플러그인 디렉토리**를 가리킴(고치면 업데이트에 유실).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { handleHook } from '../src/hook';
import { initHarness, readState, writeState } from '../src/state';
import { localProfileDir } from '../src/profile';
import { lastTier } from '../src/usage';

const sandbox = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-med3i-'));
  initHarness(root);
  return root;
};

/**
 * [FLAKE-02] **심링크 루트를 «직접» 만든다.**
 *
 * 예전에는 그냥 `sandbox()` 를 쓰고 「macOS 의 `mktemp` 은 심링크 루트를 준다
 * (`/var` → `/private/var`)」에 기댔다. 그 우연이 이 결함의 조건이었기 때문이다. 그런데
 * 리눅스의 `/tmp` 는 실경로라 **가드(`realpath(root) !== root`)가 거기서 깨진다** — CI 첫
 * 실행이 그것을 잡았다. 우연에 기댄 조건은 그 우연이 없는 곳에서 사라진다.
 *
 * 그래서 심링크를 직접 세운다: 어느 플랫폼에서도 조건이 **실제로** 성립하고, macOS 에서
 * 우연히 성립하던 것이 이제는 의도적으로 성립한다.
 */
const symlinkedSandbox = (): string => {
  const base = fs.realpathSync(os.tmpdir());
  const real = fs.mkdtempSync(path.join(base, 'kwh-med3i-real-'));
  const link = path.join(base, `kwh-med3i-link-${path.basename(real)}`);
  fs.symlinkSync(real, link);
  initHarness(link);
  return link;
};

/** `run` 은 던지지 않는다 — stderr 와 종료코드를 함께 본다. */
function cli(root: string, argv: string[]): { code: number; err: string; out: string } {
  const oe = console.error, ol = console.log;
  let err = '', out = '';
  console.error = (...a: unknown[]) => { err += a.join(' ') + '\n'; };
  console.log = (...a: unknown[]) => { out += a.join(' ') + '\n'; };
  try { return { code: run(argv, root), err, out }; } finally { console.error = oe; console.log = ol; }
}

afterEach(() => { delete process.env.HARNESS_APPROVE_NO_TTY; });

describe('[VAL-134] 없는 파일을 「프로젝트 밖」이라고 하지 않는다', () => {
  it('프로젝트 안의 없는 파일은 위치가 아니라 **읽을 수 없음**으로 거부된다', () => {
    const root = sandbox();
    writeState(root, { ...readState(root), phase: 'P0' });
    const r = cli(root, ['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', 'docs/concept.md']);
    expect(r.code).toBe(1);
    expect(r.err, '원인은 파일 없음인데 위치 문제로 안내했다').not.toMatch(/outside paths|루트 밖 경로/);
  });

  it('진짜 루트 밖은 여전히 거부된다 — 과소차단이 되지 않았다', () => {
    const root = sandbox();
    writeState(root, { ...readState(root), phase: 'P0' });
    const r = cli(root, ['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', '../../../etc/passwd']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/outside paths|루트 밖 경로/);
  });

  it('심링크 루트에서도 안의 파일은 안이라고 판정한다 — 이 결함의 실제 조건', () => {
    const root = symlinkedSandbox();
    // 루트가 실제로 심링크를 경유하는지 먼저 확인한다(그렇지 않으면 이 테스트는 무의미).
    expect(fs.realpathSync(root)).not.toBe(root);
    writeState(root, { ...readState(root), phase: 'P0' });
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'concept.md'), `# 개념\n${'실측한 내용. '.repeat(20)}\n`);
    const r = cli(root, ['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', 'docs/concept.md']);
    expect(r.err).not.toMatch(/outside paths|루트 밖 경로/);
    expect(r.code, '정상 제출이 막혔다 — 과차단이다').toBe(0);
  });
});

describe('[UX-144] usage 티어는 오르내림을 모두 기록한다', () => {
  it('하향이 기록된다 — 한 번의 실험이 모든 미래 세션을 오염시키지 않는다', () => {
    const root = sandbox();
    cli(root, ['usage', 'tier', '--percent', '91']);
    expect(lastTier(root)).toBe('reduce');
    cli(root, ['usage', 'tier', '--percent', '10']);
    expect(lastTier(root), '하향이 기록되지 않아 stale 지시가 남았다').toBe('normal');
  });

  it('SessionStart 가 더 이상 낡은 지시를 주입하지 않는다 — 끝단으로 확인', () => {
    const root = sandbox();
    cli(root, ['usage', 'tier', '--percent', '91']);
    const hot = JSON.stringify(handleHook(root, 'session-start', {}));
    expect(hot).toMatch(/usage at 90%|사용량 90%/);
    cli(root, ['usage', 'tier', '--percent', '10']);
    const cold = JSON.stringify(handleHook(root, 'session-start', {}));
    expect(cold, '10% 인데 90% 지시가 계속 주입된다').not.toMatch(/usage at 90%|사용량 90%/);
  });

  it('주입은 여전히 상승에만 — 같은 티어 반복이 잡음이 되지 않는다', () => {
    const root = sandbox();
    expect(cli(root, ['usage', 'tier', '--percent', '91']).out).toMatch(/"inject": true/);
    expect(cli(root, ['usage', 'tier', '--percent', '92']).out).toMatch(/"inject": false/);
    // 내려갔다 다시 오르면 한 번 더 알려야 한다 — 그것이 경보의 목적이다.
    cli(root, ['usage', 'tier', '--percent', '10']);
    expect(cli(root, ['usage', 'tier', '--percent', '91']).out).toMatch(/"inject": true/);
  });
});

describe('[UX-145] `evidence packet` 이 원인을 뭉개지 않는다', () => {
  it('활성 웨이브가 없으면 그렇게 말한다 — usage 한 줄이 아니다', () => {
    const root = sandbox();
    const r = cli(root, ['evidence', 'packet', '--ux', 'UX-7']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/No active wave|활성 웨이브가 없다/);
    expect(r.err, '실제 플래그명을 말해야 사람이 탈출한다').toMatch(/--wave/);
  });

  it('정말 `--ux` 가 빠진 경우에만 usage 를 낸다', () => {
    const root = sandbox();
    expect(cli(root, ['evidence', 'packet']).err).toMatch(/Usage|사용법/);
  });

  it('형제 명령 `evidence spec` 과 같은 사실을 같은 무게로 말한다', () => {
    const root = sandbox();
    const packet = cli(root, ['evidence', 'packet', '--ux', 'UX-7']).err;
    const spec = cli(root, ['evidence', 'spec', 'UX-7']).err;
    for (const msg of [packet, spec]) expect(msg).toMatch(/active wave|활성 웨이브/);
  });
});

describe('[UX-147] `profile cmd` 처방이 고쳐도 되는 곳을 가리킨다', () => {
  it('번들 프로파일일 때 프로젝트 로컬 경로를 안내한다', () => {
    const root = sandbox();
    const r = cli(root, ['profile', 'cmd', 'e2e']);
    if (r.code === 0) return;                       // 번들에 값이 있으면 이 절은 발화하지 않는다
    expect(r.err).toMatch(new RegExp(localProfileDir(root).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(r.err, '플러그인 설치본을 고치라고 하면 업데이트에 유실된다').not.toMatch(/profiles\/generic\/commands\.yaml/);
  });

  it('프로젝트 로컬 프로파일을 쓰고 있으면 그 파일을 그대로 가리킨다', () => {
    const root = sandbox();
    const dir = localProfileDir(root);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'profile.yaml'), 'name: mine\n');
    fs.writeFileSync(path.join(dir, 'commands.yaml'), 'test: npm test\n');
    const r = cli(root, ['profile', 'cmd', 'e2e']);
    if (r.code === 0) return;
    expect(r.err).toMatch(/commands\.yaml/);
    expect(r.err).toMatch(new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

/**
 * [ENG-143] **출하 measured-only 규칙이 두 벌이었다** — `approveGate`(승인 거부)와
 * `shipVerdict`(NO-GO 사유)가 같은 규칙을 각자 구현했다. 강제는 fail-safe 였지만 **문언이
 * 갈리면 verdict 와 approve 가 서로 다른 말을 한다** — 사람은 그때 덜 말하는 쪽을 믿는다.
 * `ship.ts` 머리말이 「다시 구현하지 않는다」고 선언해 둔 것과 코드가 어긋난 것 자체가,
 * 이 리포가 [LOGIC-93]·[API-92]·[ENG-106] 으로 세 번 물린 「같은 규칙 두 벌」이다.
 */
describe('[ENG-143] 두 표면이 같은 한 벌을 쓴다', () => {
  const setup = (): string => {
    const root = sandbox();
    writeState(root, { ...readState(root), phase: 'P10' });
    fs.writeFileSync(path.join(root, 'ship.md'), `# 출하\n${'실측한 내용을 적는다. '.repeat(12)}\n`);
    cli(root, ['gate', 'submit', 'P10', '--evidence', 'code', '--paths', 'ship.md']);
    return root;
  };

  it('승인 거부문과 verdict 사유가 **같은 문장**이다', () => {
    const root = setup();
    process.env.HARNESS_APPROVE_NO_TTY = '1';
    const approve = cli(root, ['gate', 'approve', 'P10']);
    const verdict = cli(root, ['ship', 'verdict']);
    expect(approve.code).toBe(1);
    // 규칙이 한 벌이므로 사유 문장도 한 벌이다 — 핵심 절을 그대로 공유한다.
    // (언어는 config 가 정하므로 두 표면이 **같은 언어의 같은 절**을 쓰는지로 본다.)
    const CORE = /only passes on measured evidence|measured 근거만 통과한다/;
    expect(approve.err).toMatch(CORE);
    expect(verdict.out + verdict.err).toMatch(CORE);
  });

  it('measured 로 재제출하면 두 표면 모두 그 사유를 더 이상 말하지 않는다', () => {
    const root = setup();
    cli(root, ['gate', 'submit', 'P10', '--evidence', 'measured', '--paths', 'ship.md']);
    process.env.HARNESS_APPROVE_NO_TTY = '1';
    const approve = cli(root, ['gate', 'approve', 'P10']);
    const verdict = cli(root, ['ship', 'verdict']);
    for (const msg of [approve.err, verdict.out + verdict.err]) {
      expect(msg).not.toMatch(/only passes on measured evidence|measured 근거만 통과한다/);
    }
  });
});
