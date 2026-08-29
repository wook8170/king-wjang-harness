/**
 * **v0.2 입력 검증 계층** — 대장이 「한 벌로 넣는 편이 산발 패치보다 안전하다」며 함께 미뤄
 * 둔 9건. 이 파일이 그 9건의 회귀다.
 *
 * 고친 7건: [SEC-02](경로 제어문자) · [LOGIC-03]·[API-08](식별자) · [API-12]·[API-13](인자
 * 모양) · [API-10](읽기 크기) · [API-28](과차단 좁히기).
 *
 * **다시 재서 이미 닫혀 있던 2건**: [SHIP-05]·[API-15]. 다른 라운드가 곁가지로 고쳐 놓고
 * 대장에는 deferred 로 남아 있었다 — 그래서 여기에 **닫힌 채로 있는지 확인하는** 테스트를
 * 둔다. 고치지 않은 것을 고쳤다고 적지 않기 위해서이고, 다시 열리면 잡기 위해서다.
 *
 * (SEC-02 도 처음에는 「이미 닫혔다」고 읽었다 — 재현이 틀렸다. 그 오독을 잡은 것이 이
 * 파일이고, 어떻게 틀렸는지는 해당 describe 에 적어 뒀다.)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from '../src/cli';
import { initHarness } from '../src/state';
import { mergeNode, loadLedger } from '../src/ledger';
import { runDoctor } from '../src/doctor';
import { ledgerPath } from '../src/paths';
import { readCapped, validateId, expectedPositionals, ID_MAX, READ_CAPS } from '../src/validate';
import { setsEnv } from '../src/bashwrite';

const REPO = path.resolve(__dirname, '..', '..');

const proj = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-v02-'));
  initHarness(root);
  return root;
};

/** `run` 은 던지지 않는다 — 종료코드와 stderr 를 함께 본다. */
function cli(root: string, argv: string[]): { code: number; err: string; out: string } {
  const oe = console.error, ol = console.log;
  let err = '', out = '';
  console.error = (...a: unknown[]) => { err += a.join(' ') + '\n'; };
  console.log = (...a: unknown[]) => { out += a.join(' ') + '\n'; };
  try { return { code: run(argv, root), err, out }; } finally { console.error = oe; console.log = ol; }
}

/** 훅을 실제 실행 표면으로 한 번 돌린다. */
function hook(root: string, payload: string): string {
  try {
    return execFileSync(path.join(REPO, 'bin/harness-hook'), ['pre-tool'], {
      input: payload, cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      encoding: 'utf8', stdio: 'pipe',
    });
  } catch (e) { return String((e as { stdout?: string }).stdout ?? ''); }
}
const bash = (cmd: string): string =>
  JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cmd } });
const isDeny = (out: string): boolean => /"permissionDecision":"deny"/.test(out);

describe('[LOGIC-03] 식별자는 정규화되고, 정규화할 수 없으면 거부된다', () => {
  it('공백만인 ID 는 거부된다 — 예전에는 exit 0 으로 원장에 `"   "` 가 남았다', () => {
    const r = cli(proj(), ['node', 'upsert', '--id', '   ', '--title', 'x']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/(cannot be empty|비거나 공백)/);
  });

  it('후행 공백은 «거부»가 아니라 «정규화»된다 — 두 노드로 갈리는 것이 이 결함의 피해였다', () => {
    const root = proj();
    expect(cli(root, ['node', 'upsert', '--id', 'F-1', '--title', 'first']).code).toBe(0);
    expect(cli(root, ['node', 'upsert', '--id', 'F-1 ', '--title', 'second']).code).toBe(0);
    const ids = loadLedger(root).map(n => n.id);
    expect(ids.filter(i => i.trim() === 'F-1'), 'F-1 과 "F-1 " 이 서로 다른 노드가 됐다').toHaveLength(1);
    expect(ids).toContain('F-1');
  });

  it('검증은 **도메인**에 있다 — CLI 에만 두면 MCP 가 그대로 뚫린다', () => {
    const root = proj();
    expect(() => mergeNode(root, { id: '   ', title: 'x' })).toThrow();
    expect(() => mergeNode(root, { id: 'D-1\nINJECTED', title: 'x' })).toThrow();
  });

  it('부모 ID 도 같은 규칙을 지난다', () => {
    const root = proj();
    cli(root, ['node', 'upsert', '--id', 'D-1', '--title', 'parent']);
    expect(() => mergeNode(root, { id: 'D-2', title: 'x', parent: 'D-1 ' })).not.toThrow();
    expect(() => mergeNode(root, { id: 'D-3', title: 'x', parent: 'a/b' })).toThrow();
  });
});

describe('[API-08] 식별자 형식이 검증된다', () => {
  const root = proj();
  it.each([
    ['traversal 형태', '../../etc/x', /(not a path|경로가 아니라)/],
    ['제어문자', 'D-1\nnodes:', /(control characters|제어문자)/],
    ['ANSI 이스케이프', 'D-[31m', /(control characters|제어문자)/],
    ['가운데 공백', 'D 1', /(spaces|공백)/],
    ['쉼표', 'D,1', /(comma|쉼표)/],
  ])('%s 는 거부되고 무엇이 문제인지 말한다', (_what, id, msg) => {
    const r = cli(root, ['node', 'upsert', '--id', id, '--title', 't']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(msg);
  });

  it(`${ID_MAX}자를 넘는 ID 는 거부된다 — 예전에는 200KB 가 원장에 그대로 저장됐다`, () => {
    const r = cli(root, ['node', 'upsert', '--id', 'D'.repeat(ID_MAX + 1), '--title', 't']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(new RegExp(`${ID_MAX}`));
    // 거부문이 200KB 를 그대로 반향하지 않는다 — 오류문 자체가 사고가 되면 안 된다.
    expect(r.err.length).toBeLessThan(600);
  });

  it('정상 ID 는 그대로 통과한다 — 한글도 막지 않는다(화이트리스트를 쓰지 않은 이유)', () => {
    for (const ok of ['D-1', 'UX-7', 'SCH-12', 'wave-001', '도메인-1', 'a.b_c']) {
      expect(validateId(root, ok, 'test'), `과차단: ${ok}`).toBe(ok);
    }
  });
});

describe('[API-12] 위치인자 과다는 조용히 버려지지 않는다', () => {
  it.each([
    [['node', 'list', 'GARBAGE']],
    [['status', 'GARBAGE']],
    [['gate', 'status', 'GARBAGE']],
    [['node', 'upsert', '--id', 'D-1', '--title', 'T', 'GARBAGE']],
  ])('%j 는 거부되고 남는 인자를 지목한다', (argv) => {
    const r = cli(proj(), argv as string[]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/(Too many arguments|인자가 너무 많다)/);
    expect(r.err, '무엇이 남았는지 말해야 사람이 고친다').toMatch(/GARBAGE/);
    expect(r.err, '사용법을 함께 줘야 막다른 길이 아니다').toMatch(/(Usage|사용법)/);
  });

  it('두 단어짜리 하위명령이 자기 이름 때문에 거부되지 않는다 — 이 검사의 첫 함정이었다', () => {
    const root = proj();
    // `defect add`·`critical raise` 를 한 토큰으로 맞추면 이름 두 개가 남는 인자로 세어진다.
    for (const argv of [['ship', 'defect', 'list'], ['loop', 'critical', 'clear'], ['loop', 'next']]) {
      const r = cli(root, argv);
      expect(r.err, `과차단: ${argv.join(' ')}`).not.toMatch(/(Too many arguments|인자가 너무 많다)/);
    }
  });

  it('개수는 도움말에서 파생한다 — 따로 적어 두면 갈린다', () => {
    expect(expectedPositionals('<P> --paths <a,b> [--evidence claimed|code|measured]')).toBe(1);
    expect(expectedPositionals('[--repair] [--force] [--accept-policy]')).toBe(0);
    expect(expectedPositionals('<UX-x> [<file>] [--png <file>]')).toBe(2);
    expect(expectedPositionals(undefined)).toBe(0);
  });
});

describe('[API-13] JSON 으로 파싱된다고 읽은 것이 아니다', () => {
  it.each(['null', '[]', '12345', '"str"', 'true'])('%s 는 「입력 없음 = 통과」가 아니라 거부다', (raw) => {
    expect(isDeny(hook(proj(), raw)), `${raw} 가 조용히 통과했다`).toBe(true);
  });

  it('정상 객체는 그대로 판정된다 — 과차단이 되지 않았다', () => {
    expect(hook(proj(), bash('ls')).trim()).toBe('');
  });
});

describe('[API-10] 읽기에도 상한이 있고, 상한에 닿기 전에 말해 준다', () => {
  it('상한을 넘는 파일은 처방과 함께 거부된다 — 조용히 자르지 않는다', () => {
    const root = proj();
    const f = path.join(root, 'big.txt');
    fs.writeFileSync(f, 'x'.repeat(1024));
    expect(() => readCapped(root, f, 512, 'the test file')).toThrow(/(read cap|읽기 상한)/);
    expect(() => readCapped(root, f, 512, 'the test file')).toThrow(/(doctor --repair)/);
    expect(readCapped(root, f, 4096, 'the test file')).toHaveLength(1024);
  });

  it('원장이 상한을 넘으면 원장을 읽는 명령이 멈춘다 — 끝단으로 확인', () => {
    const root = proj();
    fs.writeFileSync(ledgerPath(root), `nodes: []\n# ${'p'.repeat(READ_CAPS.LEDGER)}\n`);
    const r = cli(root, ['node', 'list']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/(read cap|읽기 상한)/);
  });

  it('`doctor` 가 상한의 절반에서 경고한다 — 관측되지 않는 한계는 한계가 아니다', () => {
    const root = proj();
    fs.writeFileSync(ledgerPath(root), `nodes: []\n# ${'p'.repeat(READ_CAPS.LEDGER * 0.6)}\n`);
    const w = JSON.stringify(runDoctor(root).warnings);
    expect(w).toMatch(/(read cap|읽기 상한)/);
    expect(w, '무엇을 해야 하는지 말해야 한다').toMatch(/(doctor --repair)/);
  });

  it('평범한 크기에서는 아무 말도 하지 않는다 — 경고가 시끄러우면 아무도 안 읽는다', () => {
    const root = proj();
    cli(root, ['node', 'upsert', '--id', 'D-1', '--title', 'T']);
    expect(JSON.stringify(runDoctor(root).warnings)).not.toMatch(/(read cap|읽기 상한)/);
  });

  it('저널 읽기 두 경로가 «같은» 상한을 쓴다 — 두 상한이 다르면 정본이 없다', () => {
    const src = fs.readFileSync(path.join(REPO, 'core', 'src', 'events.ts'), 'utf8');
    const uses = src.match(/readCapped\(root, eventsPath\(root\), READ_CAPS\.JOURNAL/g) ?? [];
    expect(uses.length, 'readJournal·readJournalForReplay 둘 다 상한을 지나야 한다').toBe(2);
    expect(src).not.toMatch(/readFileSync\(eventsPath\(root\), 'utf8'\)/);
  });
});

describe('[API-28] 이름을 «적는 것»과 «켜는 것»을 가른다', () => {
  it.each([
    'HARNESS_APPROVE_NO_TTY=1 harness gate approve P0',
    'export HARNESS_APPROVE_NO_TTY=1',
    'env HARNESS_APPROVE_NO_TTY=1 harness gate approve P0',
  ])('실제로 켜는 것은 여전히 거부된다: %s', (cmd) => {
    expect(isDeny(hook(proj(), bash(cmd)))).toBe(true);
  });

  it.each([
    'echo "set HARNESS_APPROVE_NO_TTY=1 to approve without a TTY" > notes.md',
    'echo HARNESS_APPROVE_NO_TTY > doc.md',
  ])('그 이름을 문서에 적는 것은 통과한다: %s', (cmd) => {
    expect(isDeny(hook(proj(), bash(cmd))), '자기 문서를 막는 방어는 순이익이 음수다').toBe(false);
  });

  it('판정은 대입 자리만 본다 — 인자로 쓰인 것은 대입이 아니다', () => {
    expect(setsEnv('X=1 cmd', 'X')).toBe(true);
    expect(setsEnv('export X=1', 'X')).toBe(true);
    expect(setsEnv('env X=1 cmd', 'X')).toBe(true);
    expect(setsEnv('echo "X=1"', 'X')).toBe(false);
    expect(setsEnv('echo X', 'X')).toBe(false);
    expect(setsEnv('cmd --flag X=1', 'X')).toBe(false);
  });
});

describe('[SEC-02] 경로 가운데의 제어문자도 fail-closed 다', () => {
  /**
   * **처음 재 봤을 때 「이미 닫혀 있다」고 잘못 읽었다.** 재현에 `printf '…\nJUNK…'` 를 썼는데
   * 그 `\n` 이 JSON 문자열 «안»에서 진짜 개행이 되어 **페이로드가 깨졌고**, 그래서 나온 것은
   * 규칙 거부가 아니라 [SEC-233] 의 「읽지 못했다」 거부였다. 거부는 거부처럼 보인다 — 그것이
   * 이 오독의 이유다. 이 테스트가 그 오독을 잡았다: **재현 도구가 만든 거부를 제품의 거부로
   * 읽지 않는다.** (그래서 여기서는 페이로드를 `JSON.stringify` 로 만든다.)
   */
  it('세 형태 모두 거부된다 — 양끝은 trim 이 잡고 있었고 가운데만 통과했다', () => {
    const root = proj();
    for (const p of ['.harness/events.jsonl\nJUNK', 'src/app.ts\nJUNK', '.harness/config.yaml\tX']) {
      const out = hook(root, JSON.stringify({
        hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: p, content: 'x' },
      }));
      expect(isDeny(out), `제어문자 경로가 통과했다: ${JSON.stringify(p)}`).toBe(true);
      expect(out, '분류 불가라고 말해야 사람이 고친다').toMatch(/(control character|제어문자)/);
    }
  });

  it('평범한 경로는 그대로 판정된다 — 과차단이 되지 않았다', () => {
    const out = hook(proj(), JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'docs/a.md', content: 'x' },
    }));
    expect(isDeny(out)).toBe(false);
  });
});

/**
 * 아래 둘은 **이번에 고친 것이 아니다.** 대장에는 deferred 로 남아 있었는데 다시 재 보니 이미
 * 닫혀 있었다 — 다른 라운드가 곁가지로 고쳤다. 고치지 않은 것을 고쳤다고 적지 않기 위해
 * 여기에 「닫힌 채로 있는지」를 못 박는다.
 */
describe('이미 닫혀 있던 둘 — 다시 열리면 여기서 잡는다', () => {
  it('[SHIP-05] `doc upsert --path` 는 절대경로를 받아 주지 않는다', () => {
    const r = cli(proj(), ['doc', 'upsert', '--id', 'DOC-1', '--path', '/abs/proj/docs/spec.md', '--phase', 'P0']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/(inside the project|프로젝트 안)/);
  });

  it('[API-15] 미래 schemaVersion 은 읽기 경로가 거부한다 — `doctor` 만 보던 것이 아니다', () => {
    const root = proj();
    const sp = path.join(root, '.harness', 'state.json');
    const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
    fs.writeFileSync(sp, JSON.stringify({ ...st, schemaVersion: 99, phase: 'P8' }));
    const r = cli(root, ['status']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/schemaVersion 99|newer harness|더 새 버전/);
  });
});
