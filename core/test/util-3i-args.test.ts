/**
 * 라운드 3-I LOW — **인자 해석이 아홉 벌이라 같은 실수가 세 갈래로 났다.**
 *
 * [UX-A7]  인자를 생략하면 "Invalid phase: **undefined**" — 내부 값이 사용자에게 샌다.
 *          [UX-86] 이 여섯 경로에서 닫은 부류인데, 이 세 경로는 그 목록에 없었다.
 * [QUAL-D] `gate feedback` 무인자도 같은 문구 — **또 목록 밖이었다.**
 * [UX-A8]  `p1` 처럼 소문자로 치면 거부만 하고 제안이 없다.
 * [UTIL-A3] `harness hook` 무인자·`--help` 가 무출력 exit 0 이면서 `hook-errors.log` 에
 *          `unknown-hook-event` 를 쌓아 `doctor` 경고를 만들었다 — **도움말을 물어본 것이
 *          진단 경고가 되면 사람은 그 경고를 무시하기 시작한다.**
 * [UTIL-A4] `loop critical raise` 가 비문서화된 exit 2 — `set -e` 스크립트와 「exit≠0 = 실패」로
 *          읽는 에이전트가 성공을 실패로 오독한다.
 *
 * 셋(A7·D·A8)의 뿌리는 하나다: **같은 판정이 아홉 벌이면 목록은 언제나 하나를 빠뜨린다.**
 * 이름을 하나씩 잡는 대신 판정을 한 벌(`requirePhase`)로 내렸다 — [UX-102] 와 같은 처방이다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { initHarness, readState, writeState } from '../src/state';
import { runtimeDir } from '../src/paths';
import type { Phase } from '../src/types';

const sandbox = (phase: Phase = 'P0'): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-args-'));
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

/** 페이즈를 위치인자로 받는 명령 전부 — 하나라도 빠지면 이 검사의 의미가 준다. */
const PHASE_COMMANDS: string[][] = [
  ['gate', 'submit'],
  ['gate', 'verify'],
  ['gate', 'feedback'],
  ['phase', 'set'],
  ['backtrack'],
];

describe('[UX-A7·QUAL-D] 인자를 생략해도 `undefined` 가 새지 않는다', () => {
  it.each(PHASE_COMMANDS)('%s %s 무인자', (...argv) => {
    const r = cli(sandbox(), argv);
    expect(r.code).toBe(1);
    expect(r.err, '내부 값이 사용자에게 샜다').not.toMatch(/undefined/);
    expect(r.err, '무엇을 쳐야 하는지 말하지 않는다').toMatch(/P0/);
  });

  it('묻는 문장으로 답한다 — 「유효하지 않다」가 아니라 「어느 페이즈인가」', () => {
    const r = cli(sandbox(), ['gate', 'verify']);
    expect(r.err).toMatch(/Which phase|어느 페이즈/);
  });

  it('`gate approve` 무인자는 **승인 잠금이 먼저** 답한다 — 더 무거운 사유가 앞선다', () => {
    // [SEC-136] 이 세운 순서다: 가장 무거운 사유를 먼저 말해야 거부가 엉뚱한 곳을 안 가리킨다.
    const r = cli(sandbox(), ['gate', 'approve']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/terminal|TTY|터미널/);
    expect(r.err).not.toMatch(/undefined/);
  });

  it('승인 잠금을 지나면 페이즈 판정도 같은 한 벌을 쓴다', () => {
    process.env.HARNESS_APPROVE_NO_TTY = '1';
    try {
      const r = cli(sandbox(), ['gate', 'approve']);
      expect(r.err).toMatch(/Which phase|어느 페이즈/);
      expect(r.err).not.toMatch(/undefined/);
    } finally { delete process.env.HARNESS_APPROVE_NO_TTY; }
  });
});

describe('[UX-A8] 대소문자는 사람의 실수지 다른 의도가 아니다', () => {
  it('`p0` 을 받아들인다 — 위치인자', () => {
    const root = sandbox('P0');
    fs.writeFileSync(path.join(root, 'concept.md'), `# 개념\n${'실측한 내용을 적는다. '.repeat(12)}\n`);
    const r = cli(root, ['gate', 'submit', 'p0', '--evidence', 'measured', '--paths', 'concept.md']);
    expect(r.code, '소문자를 거부하면서 제안도 안 하면 사용자는 무엇이 틀렸는지 모른다').toBe(0);
  });

  it('`p7` 을 받아들인다 — 플래그', () => {
    const root = sandbox();
    fs.writeFileSync(path.join(root, 'spec.md'), '# 스펙\n내용\n');
    expect(cli(root, ['doc', 'upsert', '--id', 'DOC-1', '--path', 'spec.md', '--phase', 'p7']).code).toBe(0);
  });

  it('진짜 틀린 값은 여전히 거부하고 목록을 보여 준다', () => {
    const r = cli(sandbox(), ['gate', 'verify', 'P99']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/P99/);
    expect(r.err).toMatch(/P12/);
  });
});

describe('[UTIL-A3] `harness hook` 이 사람의 질문과 배선 오타를 구분한다', () => {
  it.each([[], ['--help'], ['-h'], ['help']])('hook %s 가 이벤트 목록을 인쇄한다', (...args) => {
    const r = cli(sandbox(), ['hook', ...(args as string[])]);
    expect(r.code).toBe(0);
    expect(r.out, '무출력 exit 0 이면 사람은 도구가 깨졌다고 읽는다').toMatch(/pre-tool|session-start/);
  });

  it('도움말을 물어본 것이 `doctor` 경고가 되지 않는다', () => {
    const root = sandbox();
    cli(root, ['hook', '--help']);
    const log = path.join(runtimeDir(root), 'hook-errors.log');
    const body = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    expect(body, '도움말 요청이 진단 경고를 만들면 사람은 그 경고를 무시하기 시작한다')
      .not.toMatch(/unknown-hook-event/);
  });

  it('진짜 배선 오타는 예전대로 흔적을 남긴다 — 조용히 죽는 것이 가장 위험하다', () => {
    const root = sandbox();
    cli(root, ['hook', 'no-such-event']);
    const log = path.join(runtimeDir(root), 'hook-errors.log');
    expect(fs.readFileSync(log, 'utf8')).toMatch(/unknown-hook-event/);
  });
});

describe('[UTIL-A4] 비영 종료코드를 출력에 적는다', () => {
  it('`loop critical raise` 가 exit 2 의 뜻을 말한다', () => {
    const r = cli(sandbox(), ['loop', 'critical', 'raise', '--reason', 'external-blocker',
      '--detail', '외부 API 키가 없어 더 못 간다']);
    expect(r.code, 'exit 2 는 계약이다 — 값은 바꾸지 않는다').toBe(2);
    expect(r.out, '비문서화된 비영 종료코드는 성공을 실패로 오독시킨다').toMatch(/2/);
    expect(r.out).toMatch(/not failure|실패가 아니라/);
    expect(r.out, '해제 방법도 함께').toMatch(/loop critical clear/);
  });
});
