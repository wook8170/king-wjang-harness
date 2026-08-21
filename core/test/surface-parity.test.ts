/**
 * **같은 규칙이 표면마다 갈리지 않는다** — 독립 재감정(엔지니어링 축)이 실측한 세 갈래.
 *
 * 이 리포가 반복해 낸 사고다: [SEC-28] `sanitizeUntrusted` 두 벌 · [SEC-50] Write 만 막고
 * Bash 는 비어 있음 · [SEC-78]·[OPS-76] 같은 정규식을 두 용도에 씀. 이번에 또 세 개가 나왔다:
 *  - [LOGIC-93] 부모 검증이 CLI 에만 있어 **MCP 로는 댕글링 부모가 그대로 들어갔다**
 *  - [API-92] 목표 필수가 CLI 에만 있어 **MCP 로는 빈 껍데기 웨이브가 생겼다**
 *  - [LOGIC-94] 접두 명령 목록이 두 벌이라 **이미 갈려 있었다**
 *
 * 처방은 매번 같다 — **규칙을 도메인에 두고 표면이 상속하게 한다.** 이 파일은 그 계약을 고정한다.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { callTool } from '../src/mcp';
import { PREFIX_COMMANDS } from '../src/bashwrite';
import { handleHook } from '../src/hook';
import { initHarness } from '../src/state';

const init = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-parity-'));
  initHarness(root);
  return root;
};
const quiet = <T>(fn: () => T): T => {
  const l = vi.spyOn(console, 'log').mockImplementation(() => {});
  const e = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { return fn(); } finally { l.mockRestore(); e.mockRestore(); }
};

describe('LOGIC-93: 원장 부모 검증은 CLI·MCP 양쪽에서 같다', () => {
  it('MCP 도 없는 부모를 거부한다', () => {
    const root = init();
    const r = callTool(root, 'harness_node_upsert', { id: 'X-1', title: 't', parent: 'NOPE-9' });
    expect(r.ok).toBe(false);
    expect(String(r.content)).toContain('NOPE-9');
  });

  it('MCP 도 자기 자신을 부모로 두는 것을 거부한다', () => {
    const root = init();
    expect(callTool(root, 'harness_node_upsert', { id: 'Y-1', title: 't', parent: 'Y-1' }).ok).toBe(false);
  });

  it('CLI 와 MCP 가 같은 입력에 같은 판정을 낸다', () => {
    const root = init();
    const cli = quiet(() => run(['node', 'upsert', '--id', 'Z-1', '--title', 't', '--parent', 'NOPE-9'], root));
    const mcp = callTool(root, 'harness_node_upsert', { id: 'Z-1', title: 't', parent: 'NOPE-9' });
    expect(cli).toBe(1);
    expect(mcp.ok).toBe(false);
  });

  it('있는 부모는 양쪽 다 통과한다 — 과차단 금지', () => {
    const root = init();
    expect(callTool(root, 'harness_node_upsert', { id: 'C-1', title: 'concept' }).ok).toBe(true);
    expect(callTool(root, 'harness_node_upsert', { id: 'D-1', title: 'domain', parent: 'C-1' }).ok).toBe(true);
    expect(quiet(() => run(['node', 'upsert', '--id', 'D-2', '--title', 'd2', '--parent', 'C-1'], root))).toBe(0);
  });
});

describe('API-92: 웨이브 목표 필수도 양쪽에서 같다', () => {
  it('MCP 로도 목표 없는 웨이브를 만들 수 없다', () => {
    const root = init();
    const r = callTool(root, 'harness_wave_create', {});
    expect(r.ok).toBe(false);
    expect(fs.existsSync(path.join(root, '.harness/waves/wave-001.md'))).toBe(false);
  });

  it('목표가 있으면 양쪽 다 만든다', () => {
    const root = init();
    expect(callTool(root, 'harness_wave_create', { goal: 'finish checkout' }).ok).toBe(true);
    expect(quiet(() => run(['wave', 'create', '--goal', 'finish payments'], root))).toBe(0);
  });
});

describe('LOGIC-94: 접두 명령 목록은 한 곳이 정본이다', () => {
  const settle = (root: string) => quiet(() => run(['wave', 'update', 'settled'], root));
  const setup = (): string => {
    const root = init();
    quiet(() => run(['wave', 'create', '--goal', 'g'], root));
    quiet(() => run(['wave', 'activate', 'wave-001'], root));
    return root;
  };
  /**
   * 가드는 `lastTurnAt < lastActivityAt` 으로 판정한다 — **밀리초 해상도**다. 프로세스를 새로
   * 띄우는 실제 경로에서는 도구 호출 사이에 수십 ms 가 흐르지만, 인프로세스 테스트는 같은 ms 에
   * 끝나 버려 비교가 성립하지 않는다. 그래서 여기서만 1ms 를 확실히 흘린다 —
   * **가드를 약화시키는 것이 아니라 실제 시간 흐름을 재현하는 것**이다.
   */
  const tick = (): void => { const t = Date.now(); while (Date.now() === t) { /* 1ms */ } };
  const stopBlocksAfter = (root: string, command: string): boolean => {
    settle(root);
    tick();
    handleHook(root, 'post-tool', { tool_name: 'Bash', tool_input: { command } });
    const out = handleHook(root, 'stop', {}) as any;
    return out?.decision === 'block' || JSON.stringify(out ?? {}).includes('block');
  };

  it('접두 명령이 붙은 harness 호출은 자기호출로 인식된다 — 정산 직후 재차단 금지', () => {
    const root = setup();
    const blocked = ['harness wave update "x"', 'timeout 30 harness status', 'stdbuf -oL harness status',
      'setsid harness status', 'ionice harness status', 'unbuffer harness status', 'env harness status',
      'sudo harness status', 'nice -n 10 harness status', 'sudo -u me harness status',
      'timeout 5s harness status', 'command harness status', 'exec harness status']
      .filter(c => stopBlocksAfter(root, c));
    expect(blocked).toEqual([]);
  });

  /**
   * 이 패턴은 **좁게 틀려야 안전하다.** 한 번 맨 단어까지 건너뛰게 넓혔더니
   * `time make harness`·`sudo apt-get install harness` 가 자기호출로 잡혔다 — 진짜 작업 턴이
   * 활동 집계에서 빠지면 **정산 강제가 조용히 풀린다**(SEC-78 의 교훈).
   */
  it('진짜 작업 턴을 자기호출로 오판하지 않는다', () => {
    const root = setup();
    const missed = ['git commit -m "harness 도입"', 'echo "harness status" >> notes.md',
      'grep harness README.md', 'sudo apt-get install harness', 'time make harness',
      'nice cargo build harness', 'sudo npm install -g harness']
      .filter(c => !stopBlocksAfter(root, c));
    expect(missed).toEqual([]);
  });

  it('목록 자체가 공유된다 — 두 벌로 갈릴 자리를 남기지 않는다', () => {
    for (const p of ['sudo', 'timeout', 'stdbuf', 'setsid', 'ionice', 'unbuffer', 'nice', 'env']) {
      expect(PREFIX_COMMANDS.has(p), p).toBe(true);
    }
  });
});

describe('LOGIC-95: 설계 문서 보호는 한 곳에만 있고 전 표면에서 산다', () => {
  it('구축 트랙에서 Write·Edit·MultiEdit·Bash 전부 deny', () => {
    const root = init();
    quiet(() => run(['node', 'upsert', '--id', 'C-1', '--title', 'c'], root));
    const state = path.join(root, '.harness/state.json');
    fs.writeFileSync(state, JSON.stringify({ ...JSON.parse(fs.readFileSync(state, 'utf8')), phase: 'P8' }));
    const target = path.join(root, '.harness/design/00-concept.md');
    for (const tool of ['Write', 'Edit', 'MultiEdit']) {
      const out = handleHook(root, 'pre-tool', { tool_name: tool, tool_input: { file_path: target } }) as any;
      expect(out?.hookSpecificOutput?.permissionDecision, tool).toBe('deny');
    }
    const bash = handleHook(root, 'pre-tool', {
      tool_name: 'Bash', tool_input: { command: 'echo x > .harness/design/00-concept.md' },
    }) as any;
    expect(bash?.hookSpecificOutput?.permissionDecision).toBe('deny');
  });
});
