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
import { getNode } from '../src/ledger';
import { handleHook, WRITE_TOOLS, isSelfCall, isReadOnlyCommand } from '../src/hook';
import { initHarness } from '../src/state';
import { execFileSync } from 'node:child_process';

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

/** stdout·throw 를 한 곳에 모은다 — CLI 표면의 판정은 「사람이 읽는 것」으로 잰다. */
const capture = (fn: () => number): { code: number; text: string } => {
  const out: string[] = [];
  const l = vi.spyOn(console, 'log').mockImplementation(m => { out.push(String(m)); });
  const e = vi.spyOn(console, 'error').mockImplementation(m => { out.push(String(m)); });
  try {
    return { code: fn(), text: out.join('\n') };
  } catch (err) {
    return { code: 1, text: [...out, String(err instanceof Error ? err.message : err)].join('\n') };
  } finally { l.mockRestore(); e.mockRestore(); }
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
      'sudo apt-get install harness', 'time make harness',
      'nice cargo build harness', 'sudo npm install -g harness']
      .filter(c => !stopBlocksAfter(root, c));
    expect(missed).toEqual([]);
  });

  /**
   * [COST-111] `grep harness README.md` 는 예전에 이 목록에 있었다 — **자기호출이 아니다**를
   * 「활동으로 센다」로 재고 있었기 때문이다. 이제 순수 조회는 활동으로 세지 않으므로
   * (탐색만 한 턴마다 정산 왕복이 붙던 비용), 원래 재려던 것을 **직접** 잰다.
   * 둘은 다른 질문이다: 「하네스 자기 명령인가」와 「작업을 했는가」.
   */
  it('조회 명령은 자기호출도 아니고 활동도 아니다 — 두 질문을 섞지 않는다', () => {
    expect(isSelfCall('grep harness README.md'), '자기호출로 오판했다').toBe(false);
    expect(isReadOnlyCommand('grep harness README.md')).toBe(true);
    // 반대 방향: 같은 낱말이 들어간 진짜 작업은 조회가 아니다.
    expect(isReadOnlyCommand('git commit -m "harness 도입"')).toBe(false);
    expect(isReadOnlyCommand('echo "harness status" >> notes.md')).toBe(false);
    expect(isReadOnlyCommand('sudo npm install -g harness')).toBe(false);
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

/**
 * [SEC-96] **잠금은 「무엇을 실행하는가」로 판정한다** — 어떤 이름으로 부르는지가 아니라.
 *
 * 독립 감정이 실측: `node <repo>/core/dist/cli.js doctor --accept-policy` 가 훅을 통과해
 * **정책 드리프트 경고가 1 → 0 으로 사라졌다.** `--force` 쪽이 우연히 막힌 것은 그 가드에만
 * `HARNESS_ALLOW_FORCE` 리터럴 절이 있어서였지 형태를 인식해서가 아니었다.
 */
describe('SEC-96: 코어를 직접 부르는 형태도 harness 호출이다', () => {
  const repoCli = path.resolve(__dirname, '../dist/cli.js');
  const deniedBash = (root: string, command: string): boolean => {
    const out = handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } }) as any;
    return out?.hookSpecificOutput?.permissionDecision === 'deny';
  };

  it('node 로 코어를 직접 불러도 두 잠금이 모두 산다', () => {
    const root = init();
    const allowed = [
      `node ${repoCli} doctor --accept-policy`,
      `HARNESS_ACCEPT_POLICY=1 node ${repoCli} doctor --accept-policy`,
      `node ${repoCli} phase set P7 --force`,
      `HARNESS_ALLOW_FORCE=1 node ${repoCli} phase set P7 --force`,
      `sudo node ${repoCli} doctor --accept-policy`,
      'harness doctor --accept-policy',
      'harness phase set P7 --force',
    ].filter(c => !deniedBash(root, c));
    expect(allowed).toEqual([]);
  });

  it('진단·조회는 그대로 열려 있다 — 막는 것은 수용과 강제뿐', () => {
    const root = init();
    for (const c of [`node ${repoCli} status`, `node ${repoCli} doctor`, `node ${repoCli} doctor --repair`,
      'harness doctor', 'node build.js', 'npm test', 'cat core/dist/cli.js']) {
      expect(deniedBash(root, c), c).toBe(false);
    }
  });
});

/**
 * [UTIL-A] **문서가 시킨 대로 하면 먹어야 한다.** `commands.yaml` 헤더는 그 파일만 복사하라고
 * 하는데 `profile.yaml` 이 없다고 디렉토리를 통째로 건너뛰면, 채운 값이 조용히 무시되고
 * `profile cmd deploy` 는 다시 「commands.yaml 을 채우라」고 답해 **순환**한다.
 */
describe('UTIL-A: 로컬 프로파일은 commands.yaml 만으로도 먹는다', () => {
  it('문서가 시킨 그대로 복사하면 명령이 반영된다', () => {
    const root = init();
    const dir = path.join(root, '.harness/profile');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'commands.yaml'), "test: 'npm test'\ndeploy: 'vercel deploy --prod'\n");
    const { text } = ((): { text: string } => {
      const out: string[] = [];
      const l = vi.spyOn(console, 'log').mockImplementation(m => { out.push(String(m)); });
      try { run(['profile', 'cmd', 'deploy'], root); } finally { l.mockRestore(); }
      return { text: out.join('\n') };
    })();
    expect(text).toContain('vercel deploy --prod');
  });

  it('commands.yaml 도 profile.yaml 도 없으면 기존대로 건너뛴다 — 조용한 오작동 금지', () => {
    const root = init();
    fs.mkdirSync(path.join(root, '.harness/profile'), { recursive: true });
    const out: string[] = [];
    const l = vi.spyOn(console, 'log').mockImplementation(m => { out.push(String(m)); });
    try { run(['profile', 'show'], root); } finally { l.mockRestore(); }
    expect(out.join('\n')).toContain('generic');
  });
});

/**
 * [PERF-95] 훅 배선이 셸 가드 래퍼(`bin/harness-hook`)를 탄다 — 비간섭 프로젝트에서 node 를
 * 띄우지 않기 위해서다. **이 가드가 틀리면 방어가 조용히 꺼진다**(이 제품 최악의 실패).
 * 그래서 여기서 고정하는 것은 속도가 아니라 **판정 동치**다: 래퍼의 조건과 코어의 루트
 * 해석이 같은 것을 가리켜야 한다.
 */
describe('PERF-95: 훅 가드 래퍼가 코어와 같은 판정을 한다', () => {
  const repo = path.resolve(__dirname, '../..');
  const wrapper = path.join(repo, 'bin', 'harness-hook');
  const WRITE = (p: string) => JSON.stringify({ tool_name: 'Write', tool_input: { file_path: p } });
  const runWrapper = (event: string, cwd: string, env: NodeJS.ProcessEnv, input: string) =>
    execFileSync(wrapper, [event], { cwd, env, input, encoding: 'utf8' });

  it('배선이 전부 래퍼를 가리킨다 — 한 이벤트라도 빠지면 그 표면만 비싸다', () => {
    const wiring = JSON.parse(fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8'));
    const cmds: string[] = [];
    for (const entries of Object.values(wiring.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>)) {
      for (const e of entries) for (const h of e.hooks) cmds.push(h.command);
    }
    expect(cmds.length).toBe(4);
    for (const c of cmds) expect(c).toContain('/bin/harness-hook');
  });

  it('래퍼의 루트 판정이 코어(cli.ts main)와 같은 식이다', () => {
    const sh = fs.readFileSync(wrapper, 'utf8');
    const cli = fs.readFileSync(path.join(repo, 'core', 'src', 'cli.ts'), 'utf8');
    // 코어: CLAUDE_PROJECT_DIR ?? process.cwd() — 부모를 거슬러 올라가지 않는다.
    expect(cli).toContain('process.env.CLAUDE_PROJECT_DIR ?? process.cwd()');
    expect(sh).toContain('"${CLAUDE_PROJECT_DIR:-.}/.harness"');
  });

  it('하네스가 걸린 프로젝트에서는 방어가 그대로 산다 — deny 가 나온다', () => {
    const root = init();
    const out = runWrapper('pre-tool', root, { ...process.env, CLAUDE_PROJECT_DIR: root },
      WRITE(path.join(root, '.harness', 'state.json')));
    expect(out).toContain('"permissionDecision":"deny"');
  });

  it('CLAUDE_PROJECT_DIR 이 없어도 cwd 로 판정해 방어가 산다', () => {
    const root = init();
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    const out = runWrapper('pre-tool', root, env, WRITE('.harness/state.json'));
    expect(out).toContain('"permissionDecision":"deny"');
  });

  it('하네스 없는 프로젝트에서는 출력도 부작용도 없다 (비간섭 불변식)', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-plain-'));
    const before = fs.readdirSync(plain);
    const out = runWrapper('pre-tool', plain, { ...process.env, CLAUDE_PROJECT_DIR: plain }, WRITE('a.ts'));
    expect(out).toBe('');
    expect(fs.readdirSync(plain)).toEqual(before);
  });
});

/**
 * [ENG-A] **배선의 도구 집합과 판정기의 도구 집합은 같은 것의 두 벌이다.**
 *
 * `hooks/hooks.json` 의 matcher 에서 도구 하나가 빠지면 그 도구 호출에는 훅이 **아예 뜨지
 * 않는다** — 코어가 아무리 정확해도 판정할 기회가 없다. 실측으로 matcher 에서 `Bash` 를
 * 지워도 전건 green 이었다: 두 벌 중 어느 쪽도 다른 쪽을 고정하지 않고 있었고, 그 사이
 * 실배포에서는 Bash 강제(리다이렉트·`--force`·배포 차단) 전체가 조용히 꺼진다.
 */
describe('ENG-A: hooks.json matcher 가 판정 대상 도구 집합과 일치한다', () => {
  const wiring = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../hooks/hooks.json'), 'utf8'),
  ) as { hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>> };

  const matchers = Object.values(wiring.hooks)
    .flat()
    .filter(e => typeof e.matcher === 'string')
    .map(e => e.matcher as string);

  it('matcher 를 쓰는 이벤트가 있고, 전부 같은 집합을 건다', () => {
    expect(matchers.length).toBeGreaterThan(0);
    expect(new Set(matchers).size).toBe(1);
  });

  it('경로 판정 도구 전부 + Bash 를 빠짐없이 건다', () => {
    const wired = new Set(matchers[0].split('|'));
    for (const t of WRITE_TOOLS) expect(wired).toContain(t);
    // Bash 는 명령 문자열로 판정한다 — 여기서 빠지면 리다이렉트·래퍼·배포 차단이 통째로 꺼진다.
    expect(wired).toContain('Bash');
  });

  it('판정하지 않는 도구를 걸지 않는다 — 비용만 무는 기동이 되지 않게', () => {
    const wired = matchers[0].split('|');
    expect([...wired].sort()).toEqual([...WRITE_TOOLS, 'Bash'].sort());
  });
});

/**
 * [PROD-B1] **플러그인으로 깐 사람의 첫 명령이 실행되지 않았다.** 스킬·README·MCP 오류문구가
 * 전부 맨 `harness init` 을 지시하는데 그 바이너리는 PATH 에 없다 — 첫 줄에서 막히면
 * 나머지 문서가 아무리 정확해도 소용이 없다. 배선이 쓰는 경로가 곧 정답이므로 그 둘을 고정한다.
 */
describe('PROD-B1: 첫 명령을 실행할 경로가 문서에 있다', () => {
  const repo = path.resolve(__dirname, '../..');
  const skill = fs.readFileSync(path.join(repo, 'skills/king-wjang-harness/SKILL.md'), 'utf8');

  it('스킬이 CLI 가 PATH 에 없다는 사실과 그 위치를 말한다', () => {
    expect(skill).toMatch(/not on your PATH/);
    expect(skill).toContain('${CLAUDE_PLUGIN_ROOT}/bin');
  });

  it('스킬이 안내하는 경로가 훅 배선이 실제로 쓰는 경로와 같다', () => {
    const wiring = fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8');
    expect(wiring).toContain('${CLAUDE_PLUGIN_ROOT}/bin/');
  });
});

/**
 * [ENG-C·D·E] 엔지니어링 축의 4.8 조건은 「**중복 규칙 0**」이다. 재감정이 세 벌을 더 찾았고,
 * 셋 다 이 리포가 이미 두 번 고친 형태였다([LOGIC-93]·[API-92]) — 규칙을 어댑터에 두면
 * 표면이 하나 늘 때마다 빠진다. 처방도 같다: **도메인에 한 벌.**
 */
describe('ENG-C: 원장 상태 어휘가 한 벌이다', () => {
  const repo = path.resolve(__dirname, '../..');
  it('정본은 types.ts 이고, 어댑터가 자기 목록을 들지 않는다', () => {
    const types = fs.readFileSync(path.join(repo, 'core/src/types.ts'), 'utf8');
    expect(types).toContain("export const LEDGER_STATUSES");
    for (const f of ['core/src/cli.ts', 'core/src/mcp.ts']) {
      const src = fs.readFileSync(path.join(repo, f), 'utf8');
      expect(src, `${f} 가 목록을 다시 정의한다`).not.toMatch(/LEDGER_STATUSES\s*[:=][^;]*\[/);
    }
  });
});

describe('ENG-D: 유령 참조 검증이 도메인 한 곳이다', () => {
  it('두 표면이 같은 문구로 거부한다', () => {
    const root = init();
    const cli = capture(() => run(['wave', 'create', '--goal', 'g', '--refs', 'NOPE-9'], root));
    const mcp = callTool(root, 'harness_wave_create', { goal: 'g', design_refs: ['NOPE-9'] });
    expect(cli.code).toBe(1);
    expect(mcp.ok).toBe(false);
    expect(String(mcp.content)).toContain('NOPE-9');
    expect(cli.text).toContain('NOPE-9');
  });

  it('어댑터가 자기 검증을 다시 들지 않는다', () => {
    const repo = path.resolve(__dirname, '../..');
    for (const f of ['core/src/cli.ts', 'core/src/mcp.ts']) {
      const src = fs.readFileSync(path.join(repo, f), 'utf8');
      expect(src, `${f} 에 유령 참조 검증 사본이 남아 있다`).not.toMatch(/filter\(id => !getNode\(/);
    }
  });

  it('등록된 참조는 두 표면 모두 통과한다 (과차단 0)', () => {
    const root = init();
    capture(() => run(['node', 'upsert', '--id', 'F-1', '--title', 't'], root));
    expect(capture(() => run(['wave', 'create', '--goal', 'g', '--refs', 'F-1'], root)).code).toBe(0);
    expect(callTool(root, 'harness_wave_create', { goal: 'g2', design_refs: ['F-1'] }).ok).toBe(true);
  });
});

describe('ENG-E: 빈 부모 판정이 표면마다 갈리지 않는다', () => {
  it('두 표면 모두 「부모 없음」으로 받아들이고 빈 값을 기록하지 않는다', () => {
    const root = init();
    expect(capture(() => run(['node', 'upsert', '--id', 'A-1', '--title', 't', '--parent', ''], root)).code).toBe(0);
    expect(callTool(root, 'harness_node_upsert', { id: 'A-2', title: 't', parent: '' }).ok).toBe(true);
    const nodes = JSON.parse(capture(() => run(['node', 'list'], root)).text) as Array<Record<string, unknown>>;
    for (const n of nodes) expect(n.parent).toBeUndefined();
  });

  it('댕글링 부모는 두 표면 모두 거부한다', () => {
    const root = init();
    expect(capture(() => run(['node', 'upsert', '--id', 'A-3', '--title', 't', '--parent', 'NOPE'], root)).code).toBe(1);
    expect(callTool(root, 'harness_node_upsert', { id: 'A-4', title: 't', parent: 'NOPE' }).ok).toBe(false);
  });
});

/**
 * [ENG-106] **등록·갱신의 병합 의미론이 도메인 한 곳이다.**
 *
 * `cli.ts` 와 `mcp.ts` 가 「이전 값을 읽어 합치고 upsert 하고 저널에 적는다」를 각자 들고
 * 있었다. 뮤테이션으로 실증됐다 — MCP 사본의 `version` 보존을 망가뜨려도 전건 초록이었고,
 * 그러면 개정 카운터가 조용히 리셋돼 STALE 전파의 기준이 무너진다.
 * 여기서는 **두 표면의 결과**와 **사본이 남지 않았다는 사실**을 함께 고정한다.
 */
describe('ENG-106: 노드 병합 의미론이 도메인 한 곳이다', () => {
  const seedBumped = (root: string) => {
    capture(() => run(['node', 'upsert', '--id', 'F-1', '--title', 'auth'], root));
    capture(() => run(['node', 'bump', 'F-1'], root));      // v2
  };

  it('CLI 로 다시 upsert 해도 개정 카운터가 보존된다', () => {
    const root = init();
    seedBumped(root);
    capture(() => run(['node', 'upsert', '--id', 'F-1', '--title', 'auth v2'], root));
    expect(getNode(root, 'F-1')?.version).toBe(2);
  });

  it('MCP 로 다시 upsert 해도 개정 카운터가 보존된다 — 표면이 갈리지 않는다', () => {
    const root = init();
    seedBumped(root);
    expect(callTool(root, 'harness_node_upsert', { id: 'F-1', title: 'auth v2' }).ok).toBe(true);
    expect(getNode(root, 'F-1')?.version).toBe(2);
  });

  it('주지 않은 필드는 두 표면 모두 이전 값을 잇는다', () => {
    const root = init();
    capture(() => run(['node', 'upsert', '--id', 'P-1', '--title', 'parent'], root));
    capture(() => run(['node', 'upsert', '--id', 'F-2', '--title', 't', '--parent', 'P-1'], root));
    callTool(root, 'harness_node_upsert', { id: 'F-2', title: 'renamed' });
    const n = getNode(root, 'F-2');
    expect(n?.parent, 'MCP 갱신이 parent 를 지웠다').toBe('P-1');
    expect(n?.title).toBe('renamed');
  });

  it('어댑터가 병합 사본을 다시 들지 않는다', () => {
    const repo = path.resolve(__dirname, '../..');
    for (const f of ['core/src/cli.ts', 'core/src/mcp.ts']) {
      const src = fs.readFileSync(path.join(repo, f), 'utf8');
      // 어댑터가 `upsertNode` 를 직접 부르면 병합을 자기가 한다는 뜻이다 — 그 경로를 닫는다.
      // (문서 노드의 `version: prev?.version` 은 표면이 하나뿐이라 여기 해당하지 않는다.)
      expect(src, `${f} 가 upsertNode 를 직접 부른다 = 병합 사본`).not.toMatch(/\bupsertNode\(/);
    }
  });
});
