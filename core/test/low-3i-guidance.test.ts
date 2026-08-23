/**
 * 라운드 3-I LOW — **말과 실제가 어긋나던 여덟 곳.**
 *
 * [UX-121]  `doctor --repair` 가 수리 **전** 이슈로 `ok` 를 계산해 성공한 복구가 `ok:false` 였다.
 * [UX-122]  `backtrack` 이 「시작」만 말해 페이즈가 옮겨진 줄 알게 했다(실제로는 마커만 선다).
 * [UX-123]  MCP 로 온 에이전트에게 CLI 명령을 처방했다(존재하지 않는 도구를 찾게 된다).
 * [UX-151]  깨진 `config.yaml` 이 **아무 말 없이** 기본값으로 폴백했다.
 * [UX-164]  배포성 deny 에 탈출 경로가 없어 「영영 못 한다」로 읽혔다.
 * [UX-165]  「명시적으로 넘겨라」면서 플래그명을 안 썼다 · help 가 별칭을 감췄다.
 * [UX-166]  패킷은 「승인 근거가 아니다」인데 `gate approve` 는 성공 — 두 표면이 모순.
 * [UTIL-149] P11 deny 가 **강제하지 않는 것**을 강제한다고 말했다.
 *
 * 공통 교훈: **강제하지 않는 것을 강제한다고 말하면, 사람은 있지도 않은 규칙에 맞춰 움직이거나
 * 도구 전체를 불신한다.** 사실을 말하는 것이 문구를 부드럽게 하는 것보다 중요하다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { handleHook } from '../src/hook';
import { initHarness, readState, writeState } from '../src/state';
import { runDoctor } from '../src/doctor';
import { createWave } from '../src/wave';
import { upsertNode } from '../src/ledger';
import { configPath } from '../src/paths';
import type { Phase } from '../src/types';

const sandbox = (phase: Phase = 'P0'): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-low3i-'));
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

const deny = (root: string, command: string) => {
  const out = handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } }) as any;
  return {
    denied: out?.hookSpecificOutput?.permissionDecision === 'deny',
    why: out?.hookSpecificOutput?.permissionDecisionReason ?? '',
  };
};

describe('[UX-121] `doctor --repair` 가 수리 **후** 상태로 판정한다', () => {
  it('성공한 복구가 ok:true 를 낸다 — 두 번 돌려야 알 수 있으면 보고가 아니다', () => {
    const root = sandbox();
    fs.writeFileSync(path.join(root, '.harness/state.json'), 'garbage{');
    const r = runDoctor(root, { repair: true });
    expect(r.repaired).toBe(true);
    expect(r.ok, '복구했는데 여전히 ok:false 다').toBe(true);
    expect(r.remaining, '수리 후 남은 문제 목록이 없다').toEqual([]);
  });

  it('수리 전에 무엇이 어긋나 있었는지는 그대로 남긴다 — 보고의 본체다', () => {
    const root = sandbox();
    fs.writeFileSync(path.join(root, '.harness/state.json'), 'garbage{');
    expect(runDoctor(root, { repair: true }).issues.length).toBeGreaterThan(0);
  });

  it('수리하지 않는 진단은 예전과 같다 — ok 는 발견한 문제로 정해진다', () => {
    const root = sandbox();
    fs.writeFileSync(path.join(root, '.harness/state.json'), 'garbage{');
    const r = runDoctor(root, {});
    expect(r.repaired).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBeUndefined();
  });
});

describe('[UX-122] 성공 문구가 실제로 무엇이 됐는지 말한다', () => {
  it('`backtrack` 이 「마커만 섰다」와 다음 수를 말한다', () => {
    const root = sandbox('P7');
    const r = cli(root, ['backtrack', 'P4', '--reason', '설계가 틀렸다']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/harness phase set P4/);
    expect(r.out, '페이즈가 옮겨진 줄 알게 된다').toMatch(/has not moved|아직 그대로/);
  });

  it('`gate submit` 이 다음 수(사람 승인)를 말한다', () => {
    const root = sandbox('P0');
    fs.writeFileSync(path.join(root, 'concept.md'), `# 개념\n${'실측한 내용을 적는다. '.repeat(12)}\n`);
    const r = cli(root, ['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', 'concept.md']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/harness gate approve P0/);
  });
});

describe('[UX-123] 처방이 부른 표면의 이름을 쓴다', () => {
  it('고스트 ref 오류가 MCP 도구명도 함께 말한다', () => {
    const root = sandbox();
    let msg = '';
    try {
      createWave(root, { milestone: 'M1', design_refs: ['F-404'], acceptance: [], goal: 'x' });
    } catch (e) { msg = String(e); }
    expect(msg).toMatch(/harness node upsert/);
    expect(msg, 'MCP 로 온 에이전트는 존재하지 않는 도구를 찾게 된다').toMatch(/harness_node_upsert/);
  });
});

describe('[UX-151] 깨진 config 의 조용한 폴백을 doctor 가 알린다', () => {
  it('파스 불가 config 를 경고로 올린다', () => {
    const root = sandbox();
    fs.writeFileSync(configPath(root), 'lang: [unclosed\n');
    const w = runDoctor(root).warnings.join('\n');
    expect(w, '적어 둔 정책이 안 걸린 줄 모르는 것이 사라진 것보다 나쁘다').toMatch(/config|설정/i);
  });

  it('훅은 여전히 죽지 않는다 — 무해 계약은 그대로다', () => {
    const root = sandbox();
    fs.writeFileSync(configPath(root), 'lang: [unclosed\n');
    expect(() => handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command: 'ls' } })).not.toThrow();
  });

  it('멀쩡한 config 에는 경고가 없다 — 과보고 금지', () => {
    const root = sandbox();
    fs.writeFileSync(configPath(root), 'lang: en\n');
    expect(runDoctor(root).warnings.join('\n')).not.toMatch(/could not be parsed|해석할 수 없어/);
  });
});

describe('[UX-164] 배포성 deny 가 탈출 경로를 준다', () => {
  it.each(['P0', 'P7'] as Phase[])('%s 에서 어느 트랙이 열어 주는지 말한다', (phase) => {
    const r = deny(sandbox(phase), 'npm publish');
    expect(r.denied).toBe(true);
    expect(r.why, '탈출 경로 없는 deny 는 강제를 끄고 싶게 만든다').toMatch(/P10|ship track|출하 트랙/);
  });

  it('출하 트랙에서는 게이트 제출 명령을 그대로 준다', () => {
    const r = deny(sandbox('P11'), 'npm publish');
    expect(r.denied).toBe(true);
    expect(r.why).toMatch(/harness gate submit P11/);
  });
});

describe('[UTIL-149] 강제하지 않는 것을 강제한다고 말하지 않는다', () => {
  it('P11 신규 파일 deny 가 「기존 파일 편집은 막지 않는다」를 밝힌다', () => {
    const root = sandbox('P11');
    const out = handleHook(root, 'pre-tool', {
      tool_name: 'Write', tool_input: { file_path: 'src/app.ts', content: 'x' },
    }) as any;
    expect(out?.hookSpecificOutput?.permissionDecision).toBe('deny');
    const why = out?.hookSpecificOutput?.permissionDecisionReason ?? '';
    expect(why, '실제 강제는 신규 파일 금지 하나뿐이다').toMatch(/not blocked here|막지 않는다/);
  });

  it('실제로 기존 파일 편집은 통과한다 — 문구가 사실과 맞는지 끝단으로 확인', () => {
    const root = sandbox('P11');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/app.ts'), 'export const a = 1;\n');
    const out = handleHook(root, 'pre-tool', {
      tool_name: 'Edit', tool_input: { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' },
    }) as any;
    expect(out?.hookSpecificOutput?.permissionDecision).not.toBe('deny');
  });
});

describe('[UX-166] 제출이 패킷과 게이트의 모순을 그 자리에서 잇는다', () => {
  it('등록 문서 없이 제출하면 패킷이 무슨 말을 할지와 잇는 법을 알려 준다', () => {
    const root = sandbox('P0');
    fs.writeFileSync(path.join(root, 'concept.md'), `# 개념\n${'실측한 내용을 적는다. '.repeat(12)}\n`);
    const r = cli(root, ['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', 'concept.md']);
    expect(r.out).toMatch(/not grounds|승인 근거가 아니다/);
    expect(r.out).toMatch(/harness doc upsert/);
    expect(r.out).toMatch(/harness doc url/);
  });

  it('문서가 등록돼 있으면 그 참고문은 나오지 않는다 — 과보고 금지', () => {
    const root = sandbox('P0');
    fs.writeFileSync(path.join(root, 'concept.md'), `# 개념\n${'실측한 내용을 적는다. '.repeat(12)}\n`);
    upsertNode(root, { id: 'F-1', title: '기능', version: 1, status: 'approved' });
    cli(root, ['doc', 'upsert', '--id', 'DOC-1', '--path', 'concept.md', '--phase', 'P0']);
    const r = cli(root, ['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', 'concept.md']);
    expect(r.out).not.toMatch(/not grounds|승인 근거가 아니다/);
  });
});

describe('[UX-165] 처방이 실제 플래그명을 쓴다', () => {
  it('`evidence spec` 오류가 `--wave` 를 말한다', () => {
    const r = cli(sandbox(), ['evidence', 'spec', 'UX-7']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--wave/);
  });

  it('help 가 `--acceptance` 의 별칭 `--accept` 를 감추지 않는다', () => {
    const r = cli(sandbox(), ['wave', '--help']);
    expect(r.out + r.err).toMatch(/--acceptance\|--accept/);
  });
});
