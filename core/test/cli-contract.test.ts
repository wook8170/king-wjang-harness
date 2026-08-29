/**
 * 독립 재감정(사용성·가치 축)이 찾은 CLI 계약 결함들의 회귀 가드.
 *
 * 공통 뿌리는 하나다 — **오류문이 원인과 다른 곳을 가리킨다.** 인자를 안 줬는데 「등록되지
 * 않았다」고 하고(undefined 누출), init 을 안 했는데 내부 tmp 경로가 박힌 ENOENT 를 뱉고,
 * 도움말이 광고한 형태가 실제로는 안 먹는다. 사람은 오류문이 가리키는 곳을 고치려 들기
 * 때문에, **틀린 곳을 가리키는 오류문은 없느니만 못하다.**
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run, unknownFlags, VALUE_FLAGS, BOOL_FLAGS } from '../src/cli';
import { nearestCommand } from '../src/help';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-contract-'));

/**
 * stdout·stderr·throw 메시지를 한 곳에 모은다 — 안내가 어디로 나가든 계약은 「사람이 읽는 것」이다.
 *
 * **중첩 안전해야 한다.** 이 파일에는 `capture(() => run(..., init()))` 처럼 캡처 «안에서»
 * 설정 헬퍼를 부르는 곳이 있고, `init()` 자신이 또 capture 를 쓴다. 예전에는 `vi.spyOn(...)`
 * + `mockRestore()` 였는데 `mockRestore()` 는 **원본으로** 되돌린다 — 안쪽이 끝나는 순간
 * 바깥 캡처가 조용히 풀려 바깥은 빈 문자열을 받았다. 그러면 단언이 「출력이 없다」로 실패하는데
 * 화면에는 출력이 보여서, 읽는 사람이 제품을 의심하게 된다.
 *
 * 그래서 **직전 값으로** 되돌린다. 안쪽이 끝나면 바깥 캡처가 그대로 살아난다.
 * (vitest 2 에서는 우연히 안 드러났고, 4 로 올리며 3건이 한꺼번에 빨개져 잡혔다.)
 */
function capture(fn: () => number): { code: number; text: string } {
  const out: string[] = [];
  const prevLog = console.log;
  const prevErr = console.error;
  console.log = (m?: unknown): void => { out.push(String(m)); };
  console.error = (m?: unknown): void => { out.push(String(m)); };
  try {
    const code = fn();
    return { code, text: out.join('\n') };
  } finally { console.log = prevLog; console.error = prevErr; }
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

/**
 * [UTIL-D] 미지 플래그는 **조용히 무시되지 않는다.**
 *
 * 이 가드의 진짜 위험은 반대편이다 — 목록에 빠진 플래그가 있으면 **정당한 입력이 막힌다.**
 * 그래서 차단 측정에는 「막으면 안 되는 것」을 반드시 짝으로 두고, 목록이 소스와 갈리는지를
 * 소스 파싱으로 직접 잰다(사람이 기억해야 하는 목록은 결국 갈린다).
 */
describe('UTIL-D: 미지 플래그를 거부한다', () => {
  it('오타 플래그는 exit 1 이고 「그럼 무엇이었나」를 준다', () => {
    const root = init();
    const { code, text } = capture(() => run(['node', 'upsert', '--id', 'F-1', '--title', 't', '--titel', 'oops'], root));
    expect(code).toBe(1);
    expect(text).toContain('--titel');
    expect(text).toContain('--title');   // 편집거리 제안
  });

  it('거부된 명령은 레코드를 남기지 않는다 — 조용한 오작동이 아니라 실패다', () => {
    const root = init();
    capture(() => run(['node', 'upsert', '--id', 'F-1', '--title', 't', '--nosuchflag', 'x'], root));
    const { text } = capture(() => run(['node', 'list'], root));
    expect(text).not.toContain('F-1');
  });

  it('`--title=x` 는 지원하지 않는 형태라 거부하고 올바른 형태를 알려 준다', () => {
    const root = init();
    const { code, text } = capture(() => run(['node', 'upsert', '--id', 'F-1', '--title=x'], root));
    expect(code).toBe(1);
    expect(text).toContain('--title <value>');
  });

  // ── 막으면 안 되는 것 (과차단 0) ──
  it('정상 호출은 그대로 통과한다', () => {
    const root = init();
    expect(capture(() => run(['node', 'upsert', '--id', 'F-2', '--title', 't'], root)).code).toBe(0);
  });

  it('`--` 로 시작하는 값을 삼키지 않는다 — 값은 거르지 않는 것이 계약이다', () => {
    const root = init();
    const { code } = capture(() => run(['node', 'upsert', '--id', 'F-3', '--title', '--force'], root));
    expect(code).toBe(0);
  });

  it('미지 명령은 여전히 「알 수 없는 명령」이 먼저다 (UX-24 계약)', () => {
    const root = init();
    const { text } = capture(() => run(['nosuchcmd', '--nosuchflag'], root));
    expect(text).toContain('nosuchcmd');
    expect(text).not.toContain('--nosuchflag');   // 플래그 검사가 먼저 울면 원인을 다른 곳으로 가리킨다
  });

  it('`--help` 는 플래그 검사보다 먼저다', () => {
    const root = init();
    expect(capture(() => run(['node', '--help'], root)).code).toBe(0);
  });

  it('목록이 소스와 갈리지 않는다 — cli.ts 가 읽는 플래그가 전부 등록돼 있다', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/cli.ts'), 'utf8');
    const known = new Set([...VALUE_FLAGS, ...BOOL_FLAGS]);
    const missing: string[] = [];
    for (const m of src.matchAll(/flag\([^,]+,\s*'([a-zA-Z0-9-]+)'/g)) {
      if (!known.has(m[1])) missing.push(`flag(…, '${m[1]}')`);
    }
    // `'--x'` 리터럴 — 상수 선언부(이 목록 자신)와 도움말·오류문 예시는 제외한다.
    const decl = src.slice(src.indexOf('export const VALUE_FLAGS'), src.indexOf('function editDistance'));
    for (const m of src.matchAll(/'--([a-zA-Z0-9-]+)'/g)) {
      if (decl.includes(`'--${m[1]}'`)) continue;
      if (['help', 'version'].includes(m[1])) continue;   // 명령 토큰으로도 쓰인다
      if (!known.has(m[1])) missing.push(`'--${m[1]}'`);
    }
    expect(missing, '새 플래그를 VALUE_FLAGS/BOOL_FLAGS 에 등록하지 않으면 정당한 입력이 막힌다').toEqual([]);
  });

  it('unknownFlags 는 값 자리의 `--` 토큰을 플래그로 세지 않는다', () => {
    expect(unknownFlags(['node', 'upsert', '--title', '--force'])).toEqual([]);
    expect(unknownFlags(['node', 'upsert', '--nope', 'x'])).toEqual(['--nope']);
  });
});

/**
 * 재감정(사용성·효용성 축)이 낸 「안내가 원인과 다른 곳을 가리킨다」 부류 3건.
 * 공통점은 하나다 — **막힌 사람이 빠져나올 길을 찾을 수 없다.**
 */
describe('UX-A1: 에스컬레이션은 해제할 길이 보여야 한다', () => {
  it('`loop --help` 가 해제 명령을 알려 준다', () => {
    const root = init();
    const { text } = capture(() => run(['loop', '--help'], root));
    expect(text).toContain('critical clear');
  });

  it('해제 명령이 실제로 동작한다 — 안내가 가리키는 곳이 실재한다', () => {
    const root = init();
    capture(() => run(['loop', 'critical', 'raise', '--reason', 'repeated-failure'], root));
    const { code, text } = capture(() => run(['loop', 'critical', 'clear'], root));
    expect(code).toBe(0);
    expect(text).toMatch(/cleared|해제/i);
  });

  it('소환 안내가 실재하지 않는 `loop clear` 를 가리키지 않는다', () => {
    const root = init();
    capture(() => run(['loop', 'critical', 'raise', '--reason', 'repeated-failure'], root));
    const { text } = capture(() => run(['loop', 'next'], root));
    if (/harness loop/.test(text)) expect(text).not.toMatch(/harness loop clear(?!\w)/);
  });

  /**
   * [UX-102] **안내를 그대로 쳤을 때 되는가** — 이름이 실재하는 것으로는 부족하다.
   *
   * 이 결함은 두 겹이었다: 없는 하위명령(`loop check`)을 가리켰고, 이름을 고친 뒤에도
   * `--reason <why>` 라고 적으면 enum 이 아니라 usage 에러가 났다. 위 두 테스트는 **이름**만
   * 봤기 때문에 둘 다 못 잡는다. 그래서 안내문에서 명령을 **기계로 뽑아 실제로 실행**한다.
   */
  it('4연속 실패 안내를 그대로 실행하면 성공한다 (이름이 아니라 실행 가능성)', () => {
    const root = init();
    capture(() => run(['node', 'upsert', '--id', 'F-1', '--title', 't'], root));
    capture(() => run(['wave', 'create', '--goal', 'g', '--refs', 'F-1'], root));
    capture(() => run(['wave', 'activate', 'wave-001'], root));
    for (let i = 0; i < 4; i++) {
      capture(() => run(['loop', 'attempt', 'wave-001', '--outcome', 'fail'], root));
    }
    capture(() => run(['loop', 'critical', 'clear'], root));

    const { text } = capture(() => run(['loop', 'next'], root));
    const guided = /`harness ([^`]+)`/.exec(text);
    expect(guided, '가장 막힌 순간의 안내에 명령이 없다').not.toBeNull();

    // 자리표시자가 남아 있으면 그건 「그대로 치면 되는 안내」가 아니다.
    const argv = guided![1].split(/\s+/);
    expect(argv.join(' '), '안내에 자리표시자가 남아 있다').not.toMatch(/[<>]/);

    // 소환은 성공해도 종료코드 2 다(「사람을 불렀다」는 신호). 여기서 보는 것은
    // **안내가 거부당하지 않았는가** — 없는 하위명령·usage·필수 인자 누락이 아닌가다.
    const { code, text: out } = capture(() => run(argv, root));
    expect(code, `안내대로 실행했는데 거부당했다: harness ${argv.join(' ')} → ${out}`).not.toBe(1);
    expect(out).not.toMatch(/Usage:|사용법|Unknown/);
  });
});

describe('UX-A3: 읽지 못한 파일을 「깨끗하다」로 보고하지 않는다', () => {
  it('없는 파일을 린트하면 실패하고 경로를 말한다', () => {
    const root = init();
    const { code, text } = capture(() => run(['tokens', 'lint', 'nofile.css'], root));
    expect(code).toBe(1);
    expect(text).toContain('nofile.css');
  });

  it('있는 파일은 그대로 린트된다 (과차단 0)', () => {
    const root = init();
    fs.writeFileSync(path.join(root, 'a.css'), '.x { color: red; }\n');
    expect(capture(() => run(['tokens', 'lint', 'a.css'], root)).code).toBeLessThanOrEqual(1);
  });
});

describe('UTIL-A2: state.json 만 없는 상태를 열화로 안내한다', () => {
  const degraded = (): string => {
    const root = init();
    fs.rmSync(path.join(root, '.harness', 'state.json'));
    return root;
  };

  it('내부 경로가 박힌 raw ENOENT 를 뱉지 않는다', () => {
    const { text } = capture(() => run(['status'], degraded()));
    expect(text).not.toMatch(/ENOENT/);
    expect(text).toMatch(/doctor --repair/);
  });

  it('안내가 가리키는 복구 경로가 실제로 통한다', () => {
    const root = degraded();
    expect(capture(() => run(['doctor', '--repair'], root)).code).toBe(0);
    expect(capture(() => run(['status'], root)).code).toBe(0);
  });
});

/**
 * [UX-A4·UX-A2] **안내가 가리키는 곳에 답이 있어야 한다.**
 * `trace <미지 id>` 는 `report rtm` 을 가리켰는데 rtm 은 F- 노드만 싣는다 — UX-·FEAT- 노드는
 * 어느 명령으로도 볼 수 없었다. `ship defect add` 는 플래그를 알아낼 방법 자체가 없었다.
 */
describe('UX-A4: 등록된 노드를 볼 수 있다', () => {
  it('`node list` 가 원장 전체를 낸다 — 종류를 가리지 않는다', () => {
    const root = init();
    for (const id of ['F-1', 'UX-3', 'FEAT-9']) {
      capture(() => run(['node', 'upsert', '--id', id, '--title', 't'], root));
    }
    const { code, text } = capture(() => run(['node', 'list'], root));
    expect(code).toBe(0);
    for (const id of ['F-1', 'UX-3', 'FEAT-9']) expect(text).toContain(id);
  });

  it('미지 노드 안내가 실제로 답이 있는 곳을 가리킨다', () => {
    const root = init();
    const { text } = capture(() => run(['trace', 'NOPE-7'], root));
    expect(text).toContain('harness node list');
    expect(text).not.toContain('report rtm');
  });

  it('`node --help` 에 list 가 있다', () => {
    expect(capture(() => run(['node', '--help'], init())).text).toContain('list');
  });
});

describe('UX-A2: ship defect 의 인자를 알아낼 수 있다', () => {
  it('`ship --help` 가 defect 의 플래그를 적는다', () => {
    const { text } = capture(() => run(['ship', '--help'], init()));
    expect(text).toContain('--severity');
    expect(text).toContain('--title');
    expect(text).toContain('--evidence');
  });

  it('요약 누락 오류가 어떤 플래그인지 말한다', () => {
    const root = init();
    const { text } = capture(() => run(['ship', 'defect', 'add', '--id', 'SEC-01'], root));
    expect(text).toContain('--title');
  });
});
