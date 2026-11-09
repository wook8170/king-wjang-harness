/**
 * 게이트 승인의 확인 창 · 슬래시 명령 경로.
 *
 * 훅은 조건이 전부 맞을 때만 `ask` 를 돌려주고, 그때 낸 표가 있어야 CLI 가 TTY 없는 호출을 받는다.
 * Claude Code 의 실제 동작(창 표시 · 모드별 차이)은 단위 시험으로 잴 수 없어 2.1.319 실측으로
 * 확인했고, 여기서는 그 위에 세운 판정과 표의 규칙을 고정한다.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { handleHook } from '../src/hook';
import { runDoctor as doctor } from '../src/doctor';
import { callTool } from '../src/mcp';
import { consumeTicket } from '../src/approve';
import { harnessCliPath, humanCmd } from '../src/paths';
import { initHarness, readState, writeState } from '../src/state';
import { readEvents } from '../src/events';
import type { Phase } from '../src/types';

const repo = path.resolve(__dirname, '../..');
const SLASH_NAME = 'king-wjang-harness:approve';
const saved = { entry: process.env.CLAUDE_CODE_ENTRYPOINT, config: process.env.CLAUDE_CONFIG_DIR, tty: process.env.HARNESS_APPROVE_NO_TTY };

beforeEach(() => {
  process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
  // 시험이 실행자의 실제 사용자 설정을 읽지 않게 한다.
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-cfg-'));
  delete process.env.HARNESS_APPROVE_NO_TTY;
});

afterEach(() => {
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('CLAUDE_CODE_ENTRYPOINT', saved.entry);
  restore('CLAUDE_CONFIG_DIR', saved.config);
  restore('HARNESS_APPROVE_NO_TTY', saved.tty);
});

function submitted(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-approve-'));
  initHarness(root);
  writeState(root, { ...readState(root), phase: 'P0' as Phase });
  fs.writeFileSync(path.join(root, 'concept.md'), `# 개념\n${'실측한 내용을 적는다. '.repeat(12)}\n`);
  run(['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', 'concept.md'], root);
  return root;
}

const bash = (root: string, command: string, extra: Record<string, unknown> = { permission_mode: 'default' }) =>
  handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command, description: 'd' }, ...extra }) as any;
const decision = (o: any): string | undefined => o?.hookSpecificOutput?.permissionDecision;
const ticketFile = (root: string) => path.join(root, '.harness', '.runtime', 'approve-ticket');
const status = (root: string) => readState(root).gates?.P0?.status;
const approvedEvent = (root: string) => readEvents(root).find(e => e.type === 'gate-approved');

/** 훅이 돌려준 명령을 CLI 인자로 편다 — 사람이 창에서 승인한 뒤 실제로 도는 명령이다. */
function runApproved(root: string, out: any): number {
  const command: string = out.hookSpecificOutput.updatedInput.command;
  return quiet(() => run(command.split(' ').slice(1), root));
}

function quiet<T>(fn: () => T): T {
  const { log, error } = console;
  console.log = () => {}; console.error = () => {};
  try { return fn(); } finally { console.log = log; console.error = error; }
}

function expand(root: string, over: Record<string, unknown> = {}): void {
  handleHook(root, 'user-prompt-expansion', {
    command_name: SLASH_NAME, command_args: 'P0', command_source: 'plugin', ...over,
  } as any);
}

/** 최신 회차에 HIGH-7 하나가 있고, 주어진 처리표를 둔 프로젝트. */
function auditRoot(table: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-approve-'));
  initHarness(root);
  fs.mkdirSync(path.join(root, '.harness/audit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness/audit/audit-r1.md'), [
    'Audit-Kind: full', 'Lenses: logical coherence, ambiguity, blockers, UX walkthrough', '## Findings',
    '| ID | Severity | Evidence | Phase | What | Direction |', '| HIGH-7 | HIGH | 03-feature.md:8 | P3 | the count is wrong | recount |', '', 'HIGH 1', '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, '.harness/audit/reconcile-r1.md'), table);
  return root;
}

const slash = (root: string, args: string) => handleHook(root, 'user-prompt-expansion', { command_name: SLASH_NAME, command_source: 'plugin', command_args: args });

describe('M3: 창이 없는 슬래시 경로도 승인 전에 오너 결정을 보여 준다', () => {
  const ready = (): string => {
    const root = auditRoot('| HIGH-7 | HIGH | owner-accepted | — | the owner takes this |\n');
    quiet(() => run(['gate', 'submit', 'P6', '--evidence', 'claimed', '--paths', '.harness/audit/audit-r1.md,.harness/audit/reconcile-r1.md'], root));
    return root;
  };

  it('첫 입력은 목록을 보이고 거부하며, 상태를 바꾸지 않는다', () => {
    const root = ready();
    slash(root, 'P6');
    const errors: string[] = [];
    const e = vi.spyOn(console, 'error').mockImplementation(m => { errors.push(String(m)); });
    const code = run(['gate', 'approve', 'P6', '--via', 'slash'], root);
    e.mockRestore();
    expect(code).not.toBe(0);
    expect(errors.join('\n')).toContain('HIGH-7');
    expect(errors.join('\n')).toContain('--accept-risk');
    expect(readState(root).gates.P6?.status).toBe('submitted');
  });

  it('`--accept-risk` 를 다시 입력하면 승인되고 저널에 남는다', () => {
    const root = ready();
    slash(root, 'P6 --accept-risk');
    expect(quiet(() => run(['gate', 'approve', 'P6', '--accept-risk', '--via', 'slash'], root))).toBe(0);
    expect(readState(root).gates.P6?.status).toBe('approved');
    expect(approvedEvent(root)?.data.auditAcceptedHighs).toHaveLength(1);
  });

  it('`--accept-risk` 만으로는 사람의 표를 대신하지 못한다', () => {
    const root = ready();
    expect(quiet(() => run(['gate', 'approve', 'P6', '--accept-risk'], root))).not.toBe(0);
    expect(readState(root).gates.P6?.status).toBe('submitted');
  });

  it('오너 결정이 없는 P6 은 입력을 늘리지 않는다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-approve-'));
    initHarness(root);
    fs.mkdirSync(path.join(root, '.harness/audit'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness/audit/audit-r1.md'), 'Audit-Kind: full\nLenses: logical coherence, ambiguity, blockers, UX walkthrough\n## Findings\nNo finding was recorded by any of the four lenses in this round.\n\nHIGH 0\n');
    quiet(() => run(['gate', 'submit', 'P6', '--evidence', 'claimed', '--paths', '.harness/audit/audit-r1.md'], root));
    slash(root, 'P6');
    expect(quiet(() => run(['gate', 'approve', 'P6', '--via', 'slash'], root))).toBe(0);
  });
});

describe('확인 창 — 조건이 맞으면 ask 를 돌려준다', () => {
  for (const mode of ['default', 'acceptEdits']) {
    it(`권한 모드 ${mode}`, () => {
      const out = bash(submitted(), 'harness gate approve P0', { permission_mode: mode });
      expect(decision(out)).toBe('ask');
    });
  }

  it('창에 단계 · 산출물 · 근거 등급이 보인다', () => {
    const reason: string = bash(submitted(), 'harness gate approve P0').hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('P0');
    expect(reason).toContain('concept.md');
    expect(reason).toContain('measured');
  });

  it('P6 창에는 이 승인으로 위험을 수용하는 HIGH 가 보인다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-approve-'));
    initHarness(root);
    fs.mkdirSync(path.join(root, '.harness/audit'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness/audit/audit-r1.md'), [
      'Audit-Kind: full', 'Lenses: logical coherence, ambiguity, blockers, UX walkthrough', '## Findings',
      '| ID | Severity | Evidence | Phase | What | Direction |', '| HIGH-7 | HIGH | 03-feature.md:8 | P3 | the count is wrong | recount |', '', 'HIGH 1', '',
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.harness/audit/reconcile-r1.md'), '| HIGH-7 | HIGH | owner-accepted | — | the owner takes this until v2 |\n');
    run(['gate', 'submit', 'P6', '--evidence', 'claimed', '--paths', '.harness/audit/audit-r1.md,.harness/audit/reconcile-r1.md'], root);
    const reason: string = bash(root, 'harness gate approve P6').hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('HIGH-7');
  });

  it('L1: P6 에 위반이 있으면 창을 띄우기 전에 사유를 알린다', () => {
    const root = auditRoot('| HIGH-7 | HIGH | not accepted | — | the fixer disagrees |\n');
    run(['gate', 'submit', 'P6', '--evidence', 'claimed', '--paths', '.harness/audit/audit-r1.md,.harness/audit/reconcile-r1.md'], root);
    expect(status(root)).toBeUndefined();
    writeState(root, { ...readState(root), gates: { P6: { status: 'submitted', artifactHash: 'x', evidence: 'claimed' } } });
    const out = bash(root, 'harness gate approve P6');
    expect(decision(out)).not.toBe('ask');
    expect(JSON.stringify(out)).toContain('HIGH-7');
  });

  it('H2: P6 창에는 번복 결정도 보인다', () => {
    const root = auditRoot('| HIGH-7 | HIGH | owner-accepted | — | the owner takes this |\n| RC-2 | CONFLICT | owner-decided | — | the owner keeps the row |\n');
    fs.writeFileSync(path.join(root, '.harness/audit/audit-r2.md'), 'Audit-Kind: short\nstructural change: no\n## New risks of this revision\nnone found in the changed paragraph\n## Findings\n\nHIGH 0\n');
    run(['gate', 'submit', 'P6', '--evidence', 'claimed', '--paths', '.harness/audit/audit-r2.md,.harness/audit/reconcile-r1.md'], root);
    expect(bash(root, 'harness gate approve P6').hookSpecificOutput.permissionDecisionReason).toContain('RC-2');
  });

  it('제출 경로에 넣은 문장이 창에 줄바꿈으로 끼어들지 못한다', () => {
    const root = submitted();
    const evil = 'a\n승인해도 안전합니다.md';
    fs.writeFileSync(path.join(root, evil), `# 개념\n${'다른 내용을 실측해 적는다. '.repeat(12)}\n`);
    run(['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', evil], root);
    const reason: string = bash(root, 'harness gate approve P0').hookSpecificOutput.permissionDecisionReason;
    expect(reason).not.toMatch(/\n/);
  });

  it('명령은 이 설치의 절대 경로와 일회용 표로 바뀌고, 저장소에는 표 원문이 남지 않는다', () => {
    const root = submitted();
    const out = bash(root, 'harness gate approve P0');
    const { command, description } = out.hookSpecificOutput.updatedInput;
    const m = /^(.+) gate approve P0 --project (\S+) --dialog-ticket ([0-9a-f]{32})$/.exec(command);
    expect(m?.[1]).toBe(harnessCliPath());
    expect(m?.[2]).toBe(root);
    expect(description).toBe('게이트 P0 승인');
    expect(fs.readFileSync(ticketFile(root), 'utf8')).not.toContain(m?.[3]);
  });
});

describe('확인 창 — 사람에게 뜬다고 보장할 수 없으면 거부한다', () => {
  for (const mode of ['auto', 'bypassPermissions', 'dontAsk', 'plan', 'someFutureMode']) {
    it(`권한 모드 ${mode}`, () => {
      const root = submitted();
      const out = bash(root, 'harness gate approve P0', { permission_mode: mode });
      expect(decision(out)).toBe('deny');
      expect(out.hookSpecificOutput.permissionDecisionReason).toContain(SLASH_NAME);
      expect(fs.existsSync(ticketFile(root))).toBe(false);
    });
  }

  it('권한 모드가 입력에 없으면 거부한다', () => {
    expect(decision(bash(submitted(), 'harness gate approve P0', {}))).toBe('deny');
  });

  it('-p · SDK 진입점에서는 거부한다', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk-cli';
    expect(decision(bash(submitted(), 'harness gate approve P0'))).toBe('deny');
  });

  it('서브에이전트 호출은 거부한다', () => {
    expect(decision(bash(submitted(), 'harness gate approve P0', { permission_mode: 'default', agent_id: 'a1' }))).toBe('deny');
  });

  it('제출되지 않은 게이트는 창을 띄우지 않는다', () => {
    expect(decision(bash(submitted(), 'harness gate approve P1'))).toBe('deny');
  });

  for (const cmd of [
    'harness gate approve P0 && echo done',
    'harness gate approve P0; echo done',
    'harness gate approve P0 | tee x',
    'harness gate approve P0 > out.txt',
    'harness gate approve P0\necho done',
    'echo $(harness gate approve P0)',
    'echo `harness gate approve P0`',
    'FOO=1 harness gate approve P0',
    'bash -c "harness gate approve P0"',
    'time harness gate approve P0',
    '/tmp/elsewhere/harness gate approve P0',
    `${harnessCliPath()} gate approve P0`,
    './bin/harness gate approve P0',
    'node core/dist/cli.js gate approve P0',
    'harness gate approve P0 --dialog-ticket 0123',
    'harness gate approve P0 --via slash',
    'HARNESS_APPROVE_NO_TTY=1 harness gate approve P0',
  ]) {
    it(`묶이거나 변형된 호출: ${JSON.stringify(cmd)}`, () => {
      const root = submitted();
      expect(decision(bash(root, cmd))).toBe('deny');
      expect(fs.existsSync(ticketFile(root))).toBe(false);
    });
  }

  it('승인을 실행하지 않고 언급만 하는 명령은 그대로 통과한다', () => {
    expect(bash(submitted(), 'echo "docs: harness gate approve P0"')).toBeNull();
  });

  it('하위 Claude 세션으로 슬래시 명령을 치는 호출을 거부한다', () => {
    expect(decision(bash(submitted(), `claude -p "/${SLASH_NAME} P0"`))).toBe('deny');
  });
});

describe('허용 목록 감지', () => {
  const writeSettings = (dir: string, name: string, allow: string[]) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify({ permissions: { allow } }));
  };

  for (const rule of ['Bash(harness gate approve:*)', 'Bash(harness gate approve *)', 'Bash(harness:*)', 'Bash(*)', 'Bash', 'Bash(harness gate approve P0)', 'Bash(*/harness gate approve *)']) {
    it(`거부한다: ${rule}`, () => {
      const root = submitted();
      writeSettings(path.join(root, '.claude'), 'settings.local.json', [rule]);
      const out = bash(root, 'harness gate approve P0');
      expect(decision(out)).toBe('deny');
      expect(out.hookSpecificOutput.permissionDecisionReason).toContain(rule);
      expect(doctor(root).warnings.join('\n')).toContain(rule);
    });
  }

  it('사용자 전역 설정의 규칙도 본다', () => {
    const root = submitted();
    writeSettings(process.env.CLAUDE_CONFIG_DIR as string, 'settings.json', ['Bash(harness gate approve:*)']);
    expect(decision(bash(root, 'harness gate approve P0'))).toBe('deny');
  });

  it('무관한 규칙은 창을 막지 않고 doctor 도 경고하지 않는다', () => {
    const root = submitted();
    writeSettings(path.join(root, '.claude'), 'settings.json', ['Bash(git status)', 'Bash(npm:*)', 'Read']);
    expect(decision(bash(root, 'harness gate approve P0'))).toBe('ask');
    expect(doctor(root).warnings.join('\n')).not.toContain('gate approve');
  });
});

describe('표 — 확인 창 경로', () => {
  it('창에서 승인한 명령이 돌면 게이트가 열리고 저널에 dialog 가 남는다', () => {
    const root = submitted();
    expect(runApproved(root, bash(root, 'harness gate approve P0'))).toBe(0);
    expect(status(root)).toBe('approved');
    expect(approvedEvent(root)?.data.via).toBe('dialog');
    expect(fs.existsSync(ticketFile(root))).toBe(false);
  });

  it('표는 한 번만 쓴다', () => {
    const root = submitted();
    const out = bash(root, 'harness gate approve P0');
    const command: string = out.hookSpecificOutput.updatedInput.command;
    const nonce = command.split(' ').pop();
    expect(runApproved(root, out)).toBe(0);
    expect(consumeTicket(root, 'dialog', 'P0', readState(root).gates.P0?.artifactHash, nonce)).toBe(false);
  });

  it('창을 거절하면 표 원문이 없어 게이트를 열 수 없다', () => {
    const root = submitted();
    bash(root, 'harness gate approve P0');
    expect(quiet(() => run(['gate', 'approve', 'P0'], root))).toBe(1);
    expect(quiet(() => run(['gate', 'approve', 'P0', '--dialog-ticket', 'guess'], root))).toBe(1);
    expect(quiet(() => run(['gate', 'approve', 'P0', '--via', 'slash'], root))).toBe(1);
    expect(status(root)).toBe('submitted');
  });

  it('틀린 표는 사람이 보고 있는 창의 표를 지우지 않는다', () => {
    const root = submitted();
    const out = bash(root, 'harness gate approve P0');
    expect(quiet(() => run(['gate', 'approve', 'P0', '--dialog-ticket', 'guess'], root))).toBe(1);
    expect(runApproved(root, out)).toBe(0);
  });

  it('유효 시간이 지난 표는 받지 않는다', () => {
    const root = submitted();
    const out = bash(root, 'harness gate approve P0');
    const nonce = (out.hookSpecificOutput.updatedInput.command as string).split(' ').pop();
    const hash = readState(root).gates.P0?.artifactHash;
    expect(consumeTicket(root, 'dialog', 'P0', hash, nonce, Date.now() + 11 * 60 * 1000)).toBe(false);
    expect(consumeTicket(root, 'dialog', 'P0', hash, nonce)).toBe(true);
  });

  it('창이 뜬 뒤 재제출로 내용이 바뀌면 그 표로는 승인할 수 없다', () => {
    const root = submitted();
    const out = bash(root, 'harness gate approve P0');
    fs.writeFileSync(path.join(root, 'concept.md'), `# 개념\n${'내용을 바꿔서 다시 실측해 적는다. '.repeat(12)}\n`);
    quiet(() => run(['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', 'concept.md'], root));
    expect(runApproved(root, out)).toBe(1);
    expect(status(root)).toBe('submitted');
  });

  it('표 파일을 쓰기 도구와 셸로 직접 쓸 수 없다', () => {
    const root = submitted();
    const file = ticketFile(root);
    expect(decision(handleHook(root, 'pre-tool', { tool_name: 'Write', tool_input: { file_path: file, content: '{}' } }))).toBe('deny');
    expect(decision(bash(root, 'echo x > .harness/.runtime/approve-ticket'))).toBe('deny');
  });
});

describe('표 — 슬래시 명령 경로', () => {
  const slash = (root: string) => quiet(() => run(['gate', 'approve', 'P0', '--via', 'slash', '--project', root], '/nonexistent-cwd'));

  it('사용자가 치면 표가 나오고, 본문 명령이 게이트를 열며 저널에 slash 가 남는다', () => {
    const root = submitted();
    expand(root);
    expect(slash(root)).toBe(0);
    expect(status(root)).toBe('approved');
    expect(approvedEvent(root)?.data.via).toBe('slash');
  });

  it('표 없이 --via slash 를 붙인 호출은 거부한다', () => {
    const root = submitted();
    expect(slash(root)).toBe(1);
    expect(status(root)).toBe('submitted');
  });

  it('슬래시 표는 짧게 유효하다', () => {
    const root = submitted();
    expand(root);
    const hash = readState(root).gates.P0?.artifactHash;
    expect(consumeTicket(root, 'slash', 'P0', hash, undefined, Date.now() + 61 * 1000)).toBe(false);
  });

  for (const [what, over] of [
    ['다른 명령', { command_name: 'other:approve' }],
    ['플러그인이 아닌 출처', { command_source: 'project' }],
    ['다른 페이즈', { command_args: 'P1' }],
    ['섞인 인자', { command_args: 'P0; echo x' }],
  ] as const) {
    it(`표를 내지 않는다: ${what}`, () => {
      const root = submitted();
      expand(root, over);
      expect(fs.existsSync(ticketFile(root))).toBe(false);
    });
  }

  it('-p · SDK 진입점에서는 표를 내지 않는다', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk-cli';
    const root = submitted();
    expand(root);
    expect(fs.existsSync(ticketFile(root))).toBe(false);
  });

  it('스킬은 사용자만 부를 수 있게 선언돼 있고 경로 없이 동작한다', () => {
    const skill = fs.readFileSync(path.join(repo, 'skills', 'approve', 'SKILL.md'), 'utf8');
    expect(skill).toMatch(/^disable-model-invocation: true$/m);
    expect(skill).toContain('--via slash');
    expect(skill).toContain('${CLAUDE_PLUGIN_ROOT}/bin/harness');
  });

  it('훅 배선이 슬래시 명령 이름에 걸려 있다', () => {
    const wiring = JSON.parse(fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8'));
    const entry = wiring.hooks.UserPromptExpansion[0];
    expect(entry.matcher).toBe(SLASH_NAME);
    expect(entry.hooks[0].command).toContain('user-prompt-expansion');
  });
});

describe('터미널 경로와 기록', () => {
  it('TTY 가 있으면 표 없이 승인되고 저널에 terminal 이 남는다', () => {
    const root = submitted();
    delete process.env.CLAUDE_CODE_ENTRYPOINT;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      expect(quiet(() => run(['gate', 'approve', 'P0'], root))).toBe(0);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
    }
    expect(approvedEvent(root)?.data.via).toBe('terminal');
  });

  it('HARNESS_APPROVE_NO_TTY 경로는 terminal 로 적지 않는다', () => {
    const root = submitted();
    delete process.env.CLAUDE_CODE_ENTRYPOINT;
    process.env.HARNESS_APPROVE_NO_TTY = '1';
    expect(quiet(() => run(['gate', 'approve', 'P0'], root))).toBe(0);
    expect(approvedEvent(root)?.data.via).toBe('no-tty');
  });
});

describe('안내 문구에 판 번호가 든 경로가 없다', () => {
  it('humanCmd 는 짧은 이름만 낸다', () => {
    expect(humanCmd('doctor')).toBe('!harness doctor');
    expect(humanCmd('phase set P1 --force', 'HARNESS_ALLOW_FORCE=1')).toBe('!HARNESS_ALLOW_FORCE=1 harness phase set P1 --force');
  });

  it('제출 안내 · 훅 거부 · MCP 거절이 슬래시 명령을 가리키고 절대 경로를 내지 않는다', () => {
    const root = submitted();
    const lines: string[] = [];
    const { log } = console;
    console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
    try { run(['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', 'concept.md'], root); } finally { console.log = log; }
    const surfaces = [
      lines.join('\n'),
      bash(root, 'harness gate approve P0 && x').hookSpecificOutput.permissionDecisionReason,
      callTool(root, 'harness_gate_approve', { phase: 'P0' }).content,
    ];
    for (const text of surfaces) {
      expect(text).toContain(`/${SLASH_NAME}`);
      expect(text).not.toContain(harnessCliPath());
    }
  });

  it('MCP 는 계속 승인하지 않는다', () => {
    const root = submitted();
    expect(callTool(root, 'harness_gate_approve', { phase: 'P0' }).ok).toBe(false);
    expect(status(root)).toBe('submitted');
  });
});
