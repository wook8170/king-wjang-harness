/**
 * 라운드 3-I 엔지니어링 LOW — **뮤테이션 생존 3건 + 거짓말하는 주석 1건.**
 *
 * [ENG-155] 재생 evidence 폴드([LOGIC-21])가 무테스트 — `doctor --repair` 후 근거 등급이
 *   사라지는 **과거 실사고**의 재발을 아무 테스트도 못 잡았다.
 * [ENG-156] `.harness/` 무조건 허용 가드가 무테스트 — 과차단 방향이라 위협모델 밖이지만,
 *   주석이 「자물쇠가 된다」고 경고해 둔 바로 그 절이 무가드였다.
 * [ENG-157] `gate.ts`·`ship.ts` 머리말이 **현재 사실과 정반대**였다(「아직 미배선」이라 적혀
 *   있는데 전부 배선돼 있었다). 계약 문서가 거짓이면 다음 수리자가 이미 있는 것을 다시 만든다.
 * [ENG-158] `mcp/server.js`(JSON-RPC 전송)를 참조하는 테스트가 하나도 없었다.
 *
 * 넷 다 「초록인데 지켜지는 게 없다」는 같은 모양이다 — **테스트가 없으면 회귀는 침묵한다.**
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { handleHook } from '../src/hook';
import { initHarness, readState, writeState } from '../src/state';
import { submitGate, approveGate, invalidateStaleGates } from '../src/gate';
import { runDoctor } from '../src/doctor';
import type { Phase } from '../src/types';

const repo = path.resolve(__dirname, '../..');

const sandbox = (phase: Phase = 'P0'): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-eng3i-'));
  initHarness(root);
  writeState(root, { ...readState(root), phase });
  return root;
};

/** 게이트 제출이 실질성 검사를 통과할 만큼의 산출물. */
const artifact = (root: string, name = 'concept.md'): string => {
  fs.writeFileSync(path.join(root, name), `# 개념\n${'실측한 내용을 적는다. '.repeat(12)}\n`);
  return name;
};

describe('[ENG-155] `doctor --repair` 가 근거 등급을 지우지 않는다', () => {
  /** [LOGIC-21] 실사고: 저널은 갖고 있는데 재생 리듀서가 반영하지 않아 복구가 증거를 지웠다. */
  it('state.json 을 지우고 재생해도 evidence·submittedAt 이 살아남는다', () => {
    const root = sandbox('P0');
    submitGate(root, 'P0', { evidence: 'measured', paths: [artifact(root)] });
    const before = readState(root).gates.P0;
    expect(before?.evidence).toBe('measured');
    expect(before?.submittedAt).toBeTruthy();

    fs.rmSync(path.join(root, '.harness/state.json'));      // 열화 — 저널이 유일한 진실
    expect(runDoctor(root, { repair: true }).repaired).toBe(true);

    const after = readState(root).gates.P0;
    expect(after?.evidence, '복구가 근거 등급을 지웠다 — LOGIC-21 재발').toBe('measured');
    expect(after?.submittedAt, '복구가 제출 시각을 지웠다').toBe(before?.submittedAt);
  });

  it('무효화도 재생에서 살아남는다 — 승인이 되살아나지 않는다 [LOGIC-56]', () => {
    const root = sandbox('P0');
    const name = artifact(root);
    submitGate(root, 'P0', { evidence: 'measured', paths: [name] });
    approveGate(root, 'P0');
    fs.writeFileSync(path.join(root, name), `# 개념(수정)\n${'다른 내용으로 바꿨다. '.repeat(12)}\n`);
    expect(invalidateStaleGates(root)).toContain('P0');

    fs.rmSync(path.join(root, '.harness/state.json'));
    runDoctor(root, { repair: true });
    expect(readState(root).gates.P0?.status, '복구가 무효 게이트를 승인으로 되살렸다').not.toBe('approved');
  });
});

describe('[ENG-156] `.harness/` 산출물 쓰기는 어느 트랙에서도 막지 않는다', () => {
  /**
   * 이 절이 없으면 하네스 자신이 **자물쇠**가 된다 — 지시서·증적을 못 써서 웨이브가 진행되지
   * 않는다. 과차단 방향이라 위협모델 밖이지만, 무가드면 회귀했을 때 아무도 모른다.
   */
  const artifacts = [
    '.harness/waves/wave-001.md',
    '.harness/evidence/wave-001/shot.png',
    '.harness/.runtime/scratch.txt',
    '.harness/ship/notes.md',
  ];

  it.each(['P0', 'P4', 'P7', 'P11'] as Phase[])('%s 에서 전부 허용된다', (phase) => {
    const root = sandbox(phase);
    const blocked = artifacts.filter(f => {
      const out = handleHook(root, 'pre-tool', {
        tool_name: 'Write', tool_input: { file_path: f, content: 'x' },
      }) as any;
      return out?.hookSpecificOutput?.permissionDecision === 'deny';
    });
    expect(blocked, `하네스가 자기 산출물을 막았다: ${blocked.join(', ')}`).toEqual([]);
  });

  it('설계 문서는 예외다 — 설계 트랙 밖에서는 역행 없이 못 고친다', () => {
    // 이것은 과차단이 아니라 **의도된 경계**다. 여기에 적어 두지 않으면 다음 사람이
    // 「.harness 는 다 열려 있다」로 읽고 이 절을 지운다.
    const out = handleHook(sandbox('P7'), 'pre-tool', {
      tool_name: 'Write', tool_input: { file_path: '.harness/design/tokens.json', content: 'x' },
    }) as any;
    expect(out?.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(out?.hookSpecificOutput?.permissionDecisionReason).toMatch(/backtrack|역행/);
  });

  it('그렇다고 보호 파일까지 열리지는 않는다 — 허용은 산출물에만', () => {
    const root = sandbox('P0');
    const out = handleHook(root, 'pre-tool', {
      tool_name: 'Write', tool_input: { file_path: '.harness/state.json', content: 'x' },
    }) as any;
    expect(out?.hookSpecificOutput?.permissionDecision).toBe('deny');
  });
});

describe('[ENG-157] 머리말이 사실과 반대인 채로 남지 않는다', () => {
  /**
   * 이름을 하나 고치면 다음에 또 낡는다. **부류를 잡는다** — 코드가 실제로 발행하는 이벤트가
   * 전부 `KNOWN_EVENT_TYPES` 에 있는지 전수 대조한다. 「아직 등록 안 됐다」는 주석이 다시
   * 생기면, 그 말이 참이 되는 순간 이 검사가 빨강이다.
   */
  const known = (): string[] => {
    const src = fs.readFileSync(path.join(repo, 'core/src/events.ts'), 'utf8');
    const body = src.slice(src.indexOf('EVENT_TYPES = ['));
    return [...body.slice(0, body.indexOf('];')).matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
  };
  const emitted = (): string[] => {
    const out = new Set<string>();
    for (const f of fs.readdirSync(path.join(repo, 'core/src'))) {
      if (!f.endsWith('.ts')) continue;
      const src = fs.readFileSync(path.join(repo, 'core/src', f), 'utf8');
      for (const m of src.matchAll(/appendEvent\(\s*root\s*,\s*'([a-z-]+)'/g)) out.add(m[1]);
    }
    return [...out];
  };

  it('검사 대상이 실제로 잡힌다 — 빈 집합을 통과시키지 않는다', () => {
    expect(known().length).toBeGreaterThan(10);
    expect(emitted().length).toBeGreaterThan(5);
  });

  it('발행하는 이벤트가 전부 등록돼 있다 — doctor 가 저널을 불신하지 않게 [OPS-55]', () => {
    const missing = emitted().filter(t => !known().includes(t));
    expect(missing, `발행하는데 미등록인 이벤트: ${missing.join(', ')}`).toEqual([]);
  });

  it('머리말이 부정하던 네 이벤트가 실제로 등록돼 있다 — 주석이 거짓이었다는 증거', () => {
    for (const t of ['defect-added', 'defect-updated', 'deployment-recorded', 'gate-invalidated']) {
      expect(known(), `${t} 가 등록돼 있지 않다`).toContain(t);
    }
  });

  it('그 머리말들이 이제 배선돼 있다고 **긍정으로** 적는다', () => {
    // 부정 패턴으로 잡으면 「예전에 이렇게 적혀 있었다」는 수정 이력 설명까지 걸린다.
    // 계약 문서에 필요한 것은 부재의 부재가 아니라 **현재 사실의 명시**다.
    for (const f of ['core/src/gate.ts', 'core/src/ship.ts']) {
      const src = fs.readFileSync(path.join(repo, f), 'utf8');
      const head = src.slice(0, src.indexOf('\nimport '));   // 파일 머리말 주석 블록만
      expect(head, `${f} 머리말이 현재 배선 상태를 말하지 않는다`).toMatch(/배선돼 있다|등록돼 있다/);
    }
  });
});

describe('[ENG-158] `mcp/server.js` 전송이 실제로 응답한다', () => {
  /** 얇지만 알림·버퍼링·감시 로직이 있고, 어느 테스트도 이 파일을 참조하지 않았다. */
  const rpc = (root: string, msgs: unknown[]): string => {
    try {
      return execFileSync('node', [path.join(repo, 'mcp/server.js')], {
        input: msgs.map(m => JSON.stringify(m) + '\n').join(''),
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        encoding: 'utf8',
        timeout: 20_000,
      });
    } catch (e: unknown) {
      return (e as { stdout?: string }).stdout ?? '';
    }
  };
  const init = {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
  };

  it('initialize 에 JSON-RPC 응답을 낸다', () => {
    const out = rpc(sandbox(), [init]);
    expect(out).toMatch(/"jsonrpc"\s*:\s*"2\.0"/);
    expect(out).toMatch(/"id"\s*:\s*1/);
  });

  it('tools/list 가 도구를 싣는다 — 전송이 본체와 이어져 있다', () => {
    const out = rpc(sandbox(), [init, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }]);
    expect(out).toContain('harness_');
  });

  it('깨진 줄에도 프로세스가 죽지 않는다 — 세션 불파괴 계약', () => {
    const root = sandbox();
    let out = '';
    try {
      out = execFileSync('node', [path.join(repo, 'mcp/server.js')], {
        input: 'not json at all\n' + JSON.stringify({ ...init, id: 9 }) + '\n',
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        encoding: 'utf8',
        timeout: 20_000,
      });
    } catch (e: unknown) {
      out = (e as { stdout?: string }).stdout ?? '';
    }
    expect(out, '깨진 줄 뒤의 정상 요청이 응답받지 못했다').toMatch(/"id"\s*:\s*9/);
  });
});
