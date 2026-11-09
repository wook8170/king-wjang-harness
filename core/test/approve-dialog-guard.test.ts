/**
 * 확인 창 승인의 불변식을 지키는 회귀 시험.
 *
 * 승인은 사람이 직접 입력하거나 창을 눌러야만 생긴다. 그래서 창 조건 · 표의 묶임뿐 아니라, 표와 승인
 * 파일을 이름 없이 만드는 형태(대소문자 · 해제 · 상위 폴더 대상 복사)와 사람 대신 입력하는 형태를 함께 본다.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const fsHook = vi.hoisted(() => ({ afterRead: null as null | (() => void) }));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    const out = actual.readFileSync(...args);
    if (fsHook.afterRead && String(args[0]).endsWith('approve-ticket')) {
      const fn = fsHook.afterRead;
      fsHook.afterRead = null;
      fn();
    }
    return out;
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync, default: { ...actual, readFileSync } };
});

import { run } from '../src/cli';
import { handleHook } from '../src/hook';
import { consumeTicket, dialogJustRaised } from '../src/approve';
import { initHarness, readState, writeState } from '../src/state';
import { readEvents } from '../src/events';
import type { Phase } from '../src/types';

const SLASH = 'king-wjang-harness:approve';
const RT = '.harness/.runtime';
const saved = { entry: process.env.CLAUDE_CODE_ENTRYPOINT, code: process.env.CLAUDECODE, config: process.env.CLAUDE_CONFIG_DIR, tty: process.env.HARNESS_APPROVE_NO_TTY };

beforeEach(() => {
  process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-cfg-'));
  delete process.env.HARNESS_APPROVE_NO_TTY;
});

afterEach(() => {
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('CLAUDE_CODE_ENTRYPOINT', saved.entry);
  restore('CLAUDECODE', saved.code);
  restore('CLAUDE_CONFIG_DIR', saved.config);
  restore('HARNESS_APPROVE_NO_TTY', saved.tty);
  Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
});

function submitted(phase: Phase = 'P0'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-guard-'));
  initHarness(root);
  writeState(root, { ...readState(root), phase });
  fs.writeFileSync(path.join(root, 'concept.md'), `# 개념\n${'실측한 내용을 적는다. '.repeat(12)}\n`);
  quiet(() => run(['gate', 'submit', phase, '--evidence', 'measured', '--paths', 'concept.md'], root));
  return root;
}

function quiet<T>(fn: () => T): T {
  const { log, error } = console;
  console.log = () => {}; console.error = () => {};
  try { return fn(); } finally { console.log = log; console.error = error; }
}

const bash = (root: string, command: string, extra: Record<string, unknown> = { permission_mode: 'default' }) =>
  handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command, description: 'd' }, ...extra }) as any;
const write = (root: string, file: string) =>
  handleHook(root, 'pre-tool', { tool_name: 'Write', tool_input: { file_path: file, content: '{}' }, permission_mode: 'default' }) as any;
const decision = (o: any): string | undefined => o?.hookSpecificOutput?.permissionDecision;
const reason = (o: any): string => o?.hookSpecificOutput?.permissionDecisionReason ?? '';
const ticketFile = (root: string) => path.join(root, RT, 'approve-ticket');
const status = (root: string, p: Phase = 'P0') => readState(root).gates?.[p]?.status;

describe('창이 뜨지 않는 모드는 거부하고 슬래시 입력을 안내한다', () => {
  for (const mode of ['auto', 'bypassPermissions']) {
    it(mode, () => {
      const root = submitted();
      const out = bash(root, 'harness gate approve P0', { permission_mode: mode });
      expect(decision(out)).toBe('deny');
      expect(reason(out)).toContain(`/${SLASH}`);
      expect(fs.existsSync(ticketFile(root))).toBe(false);
    });
  }
});

describe('허용 규칙이 새 명령 형태를 덮어도 창 없이 통과하지 않는다', () => {
  for (const rule of ['Bash(harness gate approve P0 --project *)', 'Bash(*--dialog-ticket*)', 'Bash(*/harness gate approve *)']) {
    it(rule, () => {
      const root = submitted();
      fs.mkdirSync(path.join(root, '.claude'));
      fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: [rule] } }));
      expect(decision(bash(root, 'harness gate approve P0'))).toBe('deny');
      expect(fs.existsSync(ticketFile(root))).toBe(false);
    });
  }
});

describe('사람 대신 입력하거나 터미널을 만드는 형태를 거부한다', () => {
  for (const cmd of [
    'script -q /dev/null harness gate approve P0',
    'script -q /dev/null harness gate $A P0',
    'script -qc "harness gate approve P0" /dev/null',
    'unbuffer harness gate approve P0',
    'expect -c \'spawn harness gate approve P0; interact\'',
    'python3 -c "import pty;pty.spawn([\'harness\',\'gate\',\'approve\',\'P0\'])"',
    'tmux new -d \'harness gate approve P0\'',
    'tmux send-keys \'harness gate approve P0\' Enter',
    `tmux send-keys '/${SLASH} P0' Enter`,
    `screen -X stuff '/${SLASH} P0'`,
    `osascript -e 'tell app "System Events" to keystroke "/${SLASH} P0"'`,
    `orca terminal send --text '/${SLASH} P0'`,
    `paseo send x '/${SLASH} P0'`,
    `echo $(tmux send-keys '/${SLASH} P0' Enter)`,
    'unset CLAUDECODE; harness gate $A P0',
    'env -u CLAUDECODE harness gate $A P0',
  ]) {
    it(cmd, () => {
      const root = submitted();
      expect(decision(bash(root, cmd))).toBe('deny');
      expect(status(root)).toBe('submitted');
    });
  }

  it('같은 도구의 평범한 사용은 막지 않는다', () => {
    const root = submitted();
    for (const cmd of ['tmux ls', 'script -q /dev/null npm test', 'python3 -c "import pty; print(1)"', 'orca terminal list', 'unset CLAUDECODE; claude --version']) {
      expect(decision(bash(root, cmd)), cmd).not.toBe('deny');
    }
  });
});

describe('Claude Code 도구 호출 안에서는 TTY 와 환경 변수로 승인되지 않는다', () => {
  for (const marker of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) {
    it(`${marker} 가 있으면 만든 TTY 를 믿지 않는다`, () => {
      const root = submitted();
      delete process.env.CLAUDE_CODE_ENTRYPOINT;
      process.env[marker] = marker === 'CLAUDECODE' ? '1' : 'cli';
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      expect(quiet(() => run(['gate', 'approve', 'P0'], root))).toBe(1);
      expect(status(root)).toBe('submitted');
    });
  }

  it('파일에서 읽어 온 HARNESS_APPROVE_NO_TTY 도 받지 않는다', () => {
    const root = submitted();
    process.env.CLAUDECODE = '1';
    process.env.HARNESS_APPROVE_NO_TTY = '1';
    expect(quiet(() => run(['gate', 'approve', 'P0'], root))).toBe(1);
    expect(status(root)).toBe('submitted');
  });

  it('도구 호출 밖의 실제 터미널은 그대로 승인한다', () => {
    const root = submitted();
    delete process.env.CLAUDE_CODE_ENTRYPOINT;
    delete process.env.CLAUDECODE;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    expect(quiet(() => run(['gate', 'approve', 'P0'], root))).toBe(0);
    expect(readEvents(root).find(e => e.type === 'gate-approved')?.data.via).toBe('terminal');
  });
});

describe('승인 파일과 표를 대소문자 차이로 만들 수 없다', () => {
  for (const file of [`${RT}/APPROVE-TICKET`, '.HARNESS/.RUNTIME/APPROVE-TICKET', '.Harness/State.json', '.harness/EVENTS.JSONL', '.HARNESS/CONFIG.YAML']) {
    it(`Write ${file}`, () => expect(decision(write(submitted(), file))).toBe('deny'));
    it(`Bash ${file}`, () => {
      const root = submitted();
      expect(decision(bash(root, `echo x > ${file}`))).toBe('deny');
      expect(decision(bash(root, `cp /tmp/t ${file}`))).toBe('deny');
    });
  }

  it('절대 경로와 폴더를 옮긴 뒤의 이름도 같다', () => {
    const root = submitted();
    expect(decision(write(root, path.join(root, '.Harness/.Runtime/Approve-Ticket')))).toBe('deny');
    expect(decision(bash(root, `cd ${RT} && cp /tmp/t APPROVE-TICKET`))).toBe('deny');
  });

  it('소유 파일이 아닌 이름은 대소문자와 상관없이 쓸 수 있다', () => {
    const root = submitted();
    expect(decision(write(root, '.harness/design/00-Concept.md'))).not.toBe('deny');
    expect(decision(write(root, 'State.md'))).not.toBe('deny');
  });
});

describe('표가 있는 폴더 안에서 이름을 적지 않고 쓸 수 없다', () => {
  for (const cmd of [
    `cd ${RT} && tee approve-ticket < /tmp/t`,
    `cd ${RT} && curl -O http://x/approve-ticket`,
    'cd .HARNESS/.RUNTIME && curl -O http://x/approve-ticket',
    `cd ${RT} && tar -xf /tmp/x.tar`,
  ]) {
    it(cmd, () => expect(decision(bash(submitted(), cmd))).toBe('deny'));
  }

  it('그 폴더에서 읽기만 하는 명령은 통과한다', () => {
    const root = submitted();
    expect(decision(bash(root, `cd ${RT} && ls -la`))).not.toBe('deny');
    expect(decision(bash(root, `cd ${RT} && cat denials.log`))).not.toBe('deny');
  });
});

describe('해제로 승인 파일과 표를 만들 수 없다', () => {
  const archive = (entries: string[]): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-tar-'));
    for (const e of entries) {
      fs.mkdirSync(path.dirname(path.join(dir, e)), { recursive: true });
      fs.writeFileSync(path.join(dir, e), '{}');
    }
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-tarout-')), 'a.tar');
    execFileSync('tar', ['-cf', file, '-C', dir, '.']);
    return file;
  };

  for (const entry of ['.harness/state.json', `${RT}/approve-ticket`, '.HARNESS/events.jsonl', 'proj/.harness/state.json']) {
    it(`내용에 ${entry} 가 있으면 거부한다`, () => {
      const root = submitted();
      const file = archive([entry]);
      for (const cmd of [`tar -xf ${file}`, `tar xf ${file}`, `tar -xf ${file} -C .`, `tar -xf ${file} -C ..`, `tar --extract --file=${file}`, `bsdtar -xf ${file}`, `tar -xf ${file} --strip-components=1`]) {
        expect(decision(bash(root, cmd)), cmd).toBe('deny');
      }
    });
  }

  it('내용에 하네스 폴더가 없으면 루트에 풀어도 통과한다', () => {
    const root = submitted();
    const file = archive(['vendor/lib.txt']);
    expect(decision(bash(root, `tar -xf ${file}`))).not.toBe('deny');
    expect(decision(bash(root, `tar -xf ${file} -C .`))).not.toBe('deny');
  });

  it('하네스 폴더 안에 푸는 것은 내용과 상관없이 거부한다', () => {
    const root = submitted();
    const file = archive(['state.json']);
    for (const cmd of [`tar -xf ${file} -C .harness`, `tar -xf ${file} -C .HARNESS`, `cd .harness && tar -xf ${file}`]) {
      expect(decision(bash(root, cmd)), cmd).toBe('deny');
    }
  });

  it('내용을 읽을 수 없으면 거부한다', () => {
    const root = submitted();
    for (const cmd of [
      'gunzip -c /tmp/x.tgz | tar -x',
      'tar -xf -',
      'pax -r -f /tmp/x.pax',
      'cpio -idm < /tmp/x.cpio',
      '7z x /tmp/x.7z',
      'tar -czf /tmp/n.tgz /tmp/d && tar -xzf /tmp/n.tgz',
      `tar -xf ${archive(['a.txt'])} --transform=s/a/.harness/`,
      `tar -xf ${archive(['a.txt'])} -s /a/.harness/`,
    ]) {
      expect(decision(bash(root, cmd)), cmd).toBe('deny');
    }
    const broken = path.join(root, 'broken.tar');
    fs.writeFileSync(broken, 'not an archive');
    expect(decision(bash(root, 'tar -xf broken.tar'))).toBe('deny');
  });

  it('하위 폴더에 풀거나 없는 파일을 푸는 명령은 통과한다', () => {
    const root = submitted();
    for (const cmd of ['tar -xf /tmp/none.tgz', 'mkdir h && tar -xf /tmp/e.tar -C h', 'tar -C docs -xf /tmp/a.tar', 'unzip /tmp/none.zip -d vendor']) {
      expect(decision(bash(root, cmd)), cmd).not.toBe('deny');
    }
  });
});

describe('상위 폴더 대상 복사로 승인 파일과 표를 만들 수 없다', () => {
  for (const cmd of [
    'cp -R /tmp/tree/. .', 'cp -R /tmp/tree/. ./', 'cp -a /tmp/tree/.harness .', 'cp -R /tmp/tree/.HARNESS .',
    'cp -R /tmp/tree/.* .', 'cp -R "$X" .', 'cp -rt . /tmp/tree/.harness', 'mv /tmp/tree/.harness .',
    'rsync -a /tmp/tree/ ./', 'rsync -a /tmp/tree/.harness .', 'ditto /tmp/tree .', 'ln -s /tmp/tree/.harness .',
    'git clone /tmp/r .', 'git clone /tmp/.harness',
  ]) {
    it(cmd, () => expect(decision(bash(submitted(), cmd))).toBe('deny'));
  }

  it('루트를 담는 상위 폴더로 복사해도 같다', () => {
    const root = submitted();
    const name = path.basename(root);
    for (const cmd of [`cp -R /tmp/${name} ..`, `cp -R /tmp/tree/. ..`, `rsync -a /tmp/tree/ ../`, `cp -R /tmp/tree/. ${path.dirname(root)}`, `ditto /tmp/tree ${root}`]) {
      expect(decision(bash(root, cmd)), cmd).toBe('deny');
    }
  });

  it('이름이 정해진 폴더를 루트로 복사하는 일과 밖으로 복사하는 일은 통과한다', () => {
    const root = submitted();
    for (const cmd of ['cp -R /tmp/tree/assets .', 'cp -R /tmp/tree/* .', 'mv /tmp/notes.md .', 'cp -r docs /tmp/out', 'rsync -a /tmp/d/ docs', 'git clone /tmp/r vendor/r', 'ln -s /tmp/a.md note.md']) {
      expect(decision(bash(root, cmd)), cmd).not.toBe('deny');
    }
  });
});

describe('표는 창과 함께만 나가고 1회 · 짧은 시간 · 특정 대상에 묶인다', () => {
  const nonceOf = (out: any): string => (out.hookSpecificOutput.updatedInput.command as string).split(' ').pop() as string;

  it('10분이 지나면 무효다', () => {
    const root = submitted();
    const nonce = nonceOf(bash(root, 'harness gate approve P0'));
    const hash = readState(root).gates.P0?.artifactHash;
    expect(consumeTicket(root, 'dialog', 'P0', hash, nonce, Date.now() + 11 * 60 * 1000)).toBe(false);
    expect(consumeTicket(root, 'dialog', 'P0', hash, nonce, Date.now() + 9 * 60 * 1000)).toBe(true);
  });

  it('다른 호출이 먼저 표를 쓰면 두 번째 호출은 실패한다', () => {
    const root = submitted();
    const nonce = nonceOf(bash(root, 'harness gate approve P0'));
    const hash = readState(root).gates.P0?.artifactHash;
    // 표를 읽은 직후 다른 프로세스가 표를 가져간 상황을 만든다.
    fsHook.afterRead = () => fs.rmSync(ticketFile(root));
    expect(consumeTicket(root, 'dialog', 'P0', hash, nonce)).toBe(false);
  });

  it('다른 페이즈 · 다른 내용에는 쓰지 못한다', () => {
    const root = submitted();
    const nonce = nonceOf(bash(root, 'harness gate approve P0'));
    const hash = readState(root).gates.P0?.artifactHash;
    expect(consumeTicket(root, 'dialog', 'P1', hash, nonce)).toBe(false);
    expect(consumeTicket(root, 'dialog', 'P0', 'other', nonce)).toBe(false);
    expect(consumeTicket(root, 'slash', 'P0', hash, nonce)).toBe(false);
  });

  it('명령은 창에 보인 프로젝트에 묶인다 — 세션 폴더가 달라도 그 프로젝트의 게이트가 열린다', () => {
    const root = submitted();
    const other = submitted();
    const out = bash(root, 'harness gate approve P0');
    const argv = (out.hookSpecificOutput.updatedInput.command as string).split(' ').slice(1);
    expect(argv).toContain('--project');
    expect(argv[argv.indexOf('--project') + 1]).toBe(root);
    expect(quiet(() => run(argv, other))).toBe(0);
    expect(status(root)).toBe('approved');
    expect(status(other)).toBe('submitted');
  });

  it('프로젝트 경로에 공백이 있어도 한 낱말로 넘어간다', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh guard '));
    const root = path.join(parent, 'my project');
    fs.mkdirSync(root);
    initHarness(root);
    fs.writeFileSync(path.join(root, 'concept.md'), `# 개념\n${'실측한 내용을 적는다. '.repeat(12)}\n`);
    quiet(() => run(['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', 'concept.md'], root));
    const command: string = bash(root, 'harness gate approve P0').hookSpecificOutput.updatedInput.command;
    expect(command).toContain(`--project '${root}' `);
  });
});

describe('창의 문구로 오너가 무엇을 승인하는지 한 줄로 안다', () => {
  it('맨 앞에 승인 대상과 결과가 나오고 줄바꿈이 없다', () => {
    const reasonText = reason(bash(submitted(), 'harness gate approve P0'));
    expect(reasonText.startsWith('[king-wjang-harness] 게이트 P0 를 승인합니까? 허용하면 다음 단계(P1)로 넘어갈 수 있다.')).toBe(true);
    expect(reasonText).not.toMatch(/\n/);
    expect(reasonText).toContain('concept.md');
    expect(reasonText).toContain('measured');
  });

  it('마지막 게이트는 다음 단계를 지어내지 않는다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-guard-'));
    initHarness(root);
    writeState(root, { ...readState(root), gates: { P12: { status: 'submitted', artifactHash: 'x', evidence: 'measured' } } });
    const out = bash(root, 'harness gate approve P12');
    expect(decision(out)).toBe('ask');
    expect(reason(out)).toContain('마지막 게이트');
  });

  it('에이전트가 적은 설명과 다른 입력은 창에 실리지 않는다', () => {
    const root = submitted();
    const out = handleHook(root, 'pre-tool', {
      tool_name: 'Bash', permission_mode: 'default',
      tool_input: { command: 'harness gate approve P0', description: '테스트만 돌립니다', run_in_background: true, timeout: 1 },
    }) as any;
    const updated = out.hookSpecificOutput.updatedInput;
    expect(Object.keys(updated).sort()).toEqual(['command', 'description']);
    expect(updated.description).toBe('게이트 P0 승인');
  });

  it('제출 경로의 보이지 않는 서식 문자는 창에 실리지 않는다', () => {
    const root = submitted();
    const evil = 'a‮gnp.md';
    fs.writeFileSync(path.join(root, evil), `# 개념\n${'다른 내용을 실측해 적는다. '.repeat(12)}\n`);
    quiet(() => run(['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', evil], root));
    expect(reason(bash(root, 'harness gate approve P0'))).not.toMatch(/\p{Cf}/u);
  });
});

describe('오너는 창에 답하기만 한다 — 입력을 요구하지 않고 같은 것을 두 번 묻지 않는다', () => {
  const captured = (fn: () => void): string => {
    const out: string[] = [];
    const { log, error } = console;
    console.log = (...a: unknown[]) => { out.push(a.join(' ')); };
    console.error = (...a: unknown[]) => { out.push(a.join(' ')); };
    try { fn(); } finally { console.log = log; console.error = error; }
    return out.join('\n');
  };

  it('제출 안내는 에이전트가 실행할 줄을 먼저 적고 입력을 요청하지 말라고 한다', () => {
    const root = submitted();
    const text = captured(() => run(['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', 'concept.md'], root));
    expect(text).toContain('\n  harness gate approve P0');
    expect(text).toContain('입력을 요청하지 않는다');
    expect(text.indexOf('harness gate approve P0')).toBeLessThan(text.indexOf(`/${SLASH}`));
  });

  it('형태가 어긋난 호출은 다시 실행할 정확한 줄을 받는다', () => {
    const text = reason(bash(submitted(), 'harness gate approve P0 && echo done'));
    expect(text).toContain('`harness gate approve P0`');
    expect(text).toContain('창에 답하기만');
  });

  it('제출 전이면 제출 줄을, 이미 승인했으면 다음 페이즈 줄을 받는다', () => {
    const root = submitted();
    expect(reason(bash(root, 'harness gate approve P1'))).toContain('harness gate submit P1');
    const argv = (bash(root, 'harness gate approve P0').hookSpecificOutput.updatedInput.command as string).split(' ').slice(1);
    const printed = captured(() => run(argv, root));
    expect(printed).toContain('`harness phase set P1`');
    expect(printed).toContain('다시 묻지 않는다');
    const again = bash(root, 'harness gate approve P0');
    expect(decision(again)).toBe('deny');
    expect(reason(again)).toContain('이미 승인');
    expect(reason(again)).toContain('`harness phase set P1`');
  });

  it('허용되지 않은 창을 곧바로 다시 띄우지 않는다', () => {
    const root = submitted();
    expect(decision(bash(root, 'harness gate approve P0'))).toBe('ask');
    const again = bash(root, 'harness gate approve P0');
    expect(decision(again)).toBe('deny');
    expect(reason(again)).toContain('다시 묻지 않는다');
  });

  it('다시 묻지 않는 동안에도 앞서 띄운 창의 표는 그대로 쓸 수 있다', () => {
    const root = submitted();
    const first = bash(root, 'harness gate approve P0');
    bash(root, 'harness gate approve P0');
    const argv = (first.hookSpecificOutput.updatedInput.command as string).split(' ').slice(1);
    expect(quiet(() => run(argv, root))).toBe(0);
  });

  it('2분이 지나면 다시 띄울 수 있고, 재제출로 내용이 바뀌면 바로 띄운다', () => {
    const root = submitted();
    bash(root, 'harness gate approve P0');
    const hash = readState(root).gates.P0?.artifactHash ?? '';
    expect(dialogJustRaised(root, 'P0', hash, Date.now() + 60 * 1000)).toBe(true);
    expect(dialogJustRaised(root, 'P0', hash, Date.now() + 3 * 60 * 1000)).toBe(false);
    fs.writeFileSync(path.join(root, 'concept.md'), `# 개념\n${'내용을 바꿔 다시 실측해 적는다. '.repeat(12)}\n`);
    quiet(() => run(['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', 'concept.md'], root));
    expect(decision(bash(root, 'harness gate approve P0'))).toBe('ask');
  });

  it('소환 해제는 오너에게 입력을 요구하지 않는다', () => {
    const root = submitted();
    const text = captured(() => run(['loop', 'critical', 'raise', '--reason', 'external-blocker', '--detail', 'x'], root));
    expect(text).not.toContain('!harness loop critical clear');
  });
});
