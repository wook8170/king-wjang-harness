/**
 * 독립 재감정(사용성·가치 축)이 찾은 CLI 계약 결함들의 회귀 가드.
 *
 * 공통 뿌리는 하나다 — **오류문이 원인과 다른 곳을 가리킨다.** 인자를 안 줬는데 「등록되지
 * 않았다」고 하고(undefined 누출), init 을 안 했는데 내부 tmp 경로가 박힌 ENOENT 를 뱉고,
 * 도움말이 광고한 형태가 실제로는 안 먹는다. 사람은 오류문이 가리키는 곳을 고치려 들기
 * 때문에, **틀린 곳을 가리키는 오류문은 없느니만 못하다.**
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { nearestCommand } from '../src/help';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-contract-'));

/** stdout·stderr·throw 메시지를 한 곳에 모은다 — 안내가 어디로 나가든 계약은 「사람이 읽는 것」이다. */
function capture(fn: () => number): { code: number; text: string } {
  const out: string[] = [];
  const l = vi.spyOn(console, 'log').mockImplementation(m => { out.push(String(m)); });
  const e = vi.spyOn(console, 'error').mockImplementation(m => { out.push(String(m)); });
  try {
    const code = fn();
    return { code, text: out.join('\n') };
  } finally { l.mockRestore(); e.mockRestore(); }
}

const init = (): string => {
  const root = tmp();
  capture(() => run(['init'], root));
  return root;
};

describe('UX-85: 미초기화 안내는 한 곳에서, 아는 명령에만', () => {
  const NEEDS_INIT: string[][] = [
    ['status'], ['doctor'], ['gate', 'status'], ['wave', 'create', '--goal', 'x'],
    ['phase', 'set', 'P1'], ['node', 'upsert', '--id', 'N-1', '--title', 't'],
    ['trace', 'F-1'], ['ship', 'verdict'], ['loop', 'next'], ['doc', 'list'],
  ];

  it.each(NEEDS_INIT)('%s → init 안내 (raw ENOENT 금지)', (...argv) => {
    const root = tmp();
    const { code, text } = capture(() => run(argv, root));
    expect(code).toBe(1);
    expect(text).toContain('harness init');
    expect(text).not.toContain('ENOENT');
    expect(text).not.toContain(root);   // 내부 경로를 사람에게 던지지 않는다
  });

  it('미지 명령은 init 안내가 아니라 「알 수 없는 명령」이다 — 오타에 init 을 시키지 않는다', () => {
    const root = tmp();
    const { code, text } = capture(() => run(['stauts'], root));
    expect(code).toBe(1);
    expect(text).toMatch(/Unknown command|알 수 없는 명령/);
    expect(text).not.toContain('harness init');
  });

  it('--help·--version 은 init 전에도 동작한다', () => {
    const root = tmp();
    expect(capture(() => run(['--help'], root)).code).toBe(0);
    expect(capture(() => run(['--version'], root)).code).toBe(0);
  });
});

/**
 * [OPS-94] **복구 경로가 막다른 길이 되면 안 된다.**
 *
 * 미초기화 가드([UX-85])를 `state.json` 존재로 재던 탓에, 그 파일만 사라진 순간 모든 명령이
 * 「`harness init` 을 먼저 실행하라」고 하고 `init` 은 「이미 있다」로 거부했다 — **저널은
 * 멀쩡하고 `doctor --repair` 가 재생할 수 있는데 그 명령까지 같이 막혔다.**
 * 가드는 「.harness/ 가 있는가」를, 복구는 「state.json 이 성한가」를 본다. 둘은 다른 질문이다.
 */
describe('OPS-94: state.json 이 사라져도 복구가 막히지 않는다', () => {
  const brokenState = (): string => {
    const root = init();
    capture(() => run(['wave', 'create', '--goal', 'g'], root));
    fs.rmSync(path.join(root, '.harness/state.json'));
    return root;
  };

  it('doctor --repair 가 저널로 상태를 되살린다', () => {
    const root = brokenState();
    const { code } = capture(() => run(['doctor', '--repair'], root));
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(root, '.harness/state.json'))).toBe(true);
  });

  it('진단·조회도 막히지 않는다 — 안내가 실행 가능해야 한다', () => {
    const root = brokenState();
    expect(capture(() => run(['doctor'], root)).text).not.toContain('harness init');
    capture(() => run(['doctor', '--repair'], root));
    expect(capture(() => run(['status'], root)).code).toBe(0);
    expect(capture(() => run(['wave', 'list'], root)).code).toBe(0);
  });

  it('.harness/ 자체가 없으면 init 안내는 그대로다', () => {
    const root = tmp();
    const { code, text } = capture(() => run(['doctor'], root));
    expect(code).toBe(1);
    expect(text).toContain('harness init');
  });
});

describe('USE-82: backtrack 은 사유 없이 성공하지 않는다', () => {
  it('--reason 이 없으면 exit 1 이고 상태가 바뀌지 않는다', () => {
    const root = init();
    const before = fs.readFileSync(path.join(root, '.harness/state.json'), 'utf8');
    const { code, text } = capture(() => run(['backtrack', 'P0'], root));
    expect(code).toBe(1);
    expect(text).toContain('--reason');
    expect(fs.readFileSync(path.join(root, '.harness/state.json'), 'utf8')).toBe(before);
  });

  it('빈 문자열도 사유가 아니다', () => {
    const root = init();
    expect(capture(() => run(['backtrack', 'P0', '--reason', '   '], root)).code).toBe(1);
  });

  it('사유가 있으면 기록된다 — 그리고 영문 기본 출력에 한국어가 섞이지 않는다', () => {
    // 스위트 전역은 HARNESS_LANG=ko 다(setup.ts). **기본값을 검사하려면 기본값 상태를 만든다** —
    // 예전 `(미기재)` 는 영문 출력에도 박혔고, ko 로만 재면 그것이 안 보인다.
    const prev = process.env.HARNESS_LANG;
    delete process.env.HARNESS_LANG;
    const root = init();
    const { code, text } = capture(() => run(['backtrack', 'P0', '--reason', 'design was wrong'], root));
    if (prev !== undefined) process.env.HARNESS_LANG = prev;
    expect(code).toBe(0);
    expect(text).not.toMatch(/[가-힣]/);          // 예전에는 `(미기재)` 가 박혔다
    const state = JSON.parse(fs.readFileSync(path.join(root, '.harness/state.json'), 'utf8'));
    expect(state.backtrack).toEqual({ to: 'P0', reason: 'design was wrong' });
  });
});

describe('UX-86: 오류문에 undefined 를 노출하지 않는다', () => {
  const CASES: string[][] = [
    ['wave', 'activate'], ['doc', 'submit'], ['doc', 'approve'], ['doc', 'revise'],
    ['adr', 'show'], ['phase', 'set'],
  ];

  it.each(CASES)('%s %s → 사용법을 말한다', (...argv) => {
    const root = init();
    const { code, text } = capture(() => run(argv, root));
    expect(code).toBe(1);
    expect(text).not.toContain('undefined');
    expect(text).toMatch(/usage|사용법/i);
    expect(text).toContain(`harness ${argv[0]}`);   // 어느 명령의 사용법인지까지 말한다
  });

  it('오타에는 가장 가까운 명령을 제안한다', () => {
    expect(nearestCommand('stauts')).toBe('status');
    expect(nearestCommand('wav')).toBe('wave');
    // 너무 먼 것에는 제안하지 않는다 — 틀린 제안은 제안 없음보다 나쁘다.
    expect(nearestCommand('xyzzy')).toBeUndefined();
  });
});

describe('API-84: ship defect 는 add·update 가 같은 인자 형태를 받는다', () => {
  const seed = (root: string, id: string) =>
    capture(() => run(['ship', 'defect', 'add', '--id', id, '--severity', 'high',
      '--title', 't', '--evidence', 'src/a.ts:1'], root));

  it('add 는 위치인자와 --id 를 모두 받는다', () => {
    const root = init();
    expect(capture(() => run(['ship', 'defect', 'add', 'SEC-01', '--severity', 'high',
      '--title', 't', '--evidence', 'src/a.ts:1'], root)).code).toBe(0);
    expect(seed(root, 'SEC-02').code).toBe(0);
  });

  it('update 는 위치인자와 --id 를 모두 받는다', () => {
    const root = init();
    seed(root, 'SEC-01');
    expect(capture(() => run(['ship', 'defect', 'update', 'SEC-01', '--status', 'fixed'], root)).code).toBe(0);
    expect(capture(() => run(['ship', 'defect', 'update', '--id', 'SEC-01', '--status', 'verified',
      '--evidence', 'e2e.log'], root)).code).toBe(0);
  });
});

describe('LOGIC-87: 원장 부모는 존재해야 한다', () => {
  it('없는 부모는 거부하고 등록 방법을 알려준다', () => {
    const root = init();
    const { code, text } = capture(() => run(['node', 'upsert', '--id', 'X-1', '--title', 't',
      '--parent', 'NOPE-9'], root));
    expect(code).toBe(1);
    expect(text).toContain('NOPE-9');
    expect(text).toContain('node upsert');
  });

  it('자기 자신은 부모가 될 수 없다', () => {
    const root = init();
    expect(capture(() => run(['node', 'upsert', '--id', 'X-1', '--title', 't', '--parent', 'X-1'], root)).code).toBe(1);
  });

  it('있는 부모는 통과하고, 부모 없이도 등록된다', () => {
    const root = init();
    expect(capture(() => run(['node', 'upsert', '--id', 'C-1', '--title', 'concept'], root)).code).toBe(0);
    expect(capture(() => run(['node', 'upsert', '--id', 'D-1', '--title', 'domain', '--parent', 'C-1'], root)).code).toBe(0);
  });
});
