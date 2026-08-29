/**
 * v0.1.3 문서 라운드(7건) + UX 라운드(2건)의 회귀 가드.
 *
 * 이 라운드의 결함은 전부 **「제품은 맞는데 문서가 그 사실을 말하지 않는다」** 부류였다 —
 * 되돌리는 법이 없고(USE-02·SHIP-10), 광고한 수치에 재현 절차가 없고(FEAT-02), 명령표가
 * 필수 단계를 빠뜨리고(USE-04), 자기 CI 가 없고(SHIP-08), 배포본 수치를 산술로 맞추고
 * (SHIP-23), 못 고치는 것을 못 고친다고 말하지 않는다(USE-03).
 *
 * 문서는 다음 라운드에 가장 먼저 낡는다. 그래서 **문장을 검사하지 않고 사실을 검사한다** —
 * 명령표는 «등록된 하위명령 목록»과, 재현 절차는 «실제로 도는가»와 대조한다.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = path.join(__dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'harness');
const HOOK = path.join(REPO, 'bin', 'harness-hook');
const READMES = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh.md'];
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

describe('[API-14] 등록된 하위명령은 전부 사용자 문서에 나온다', () => {
  /**
   * 감사 시점에 58개 중 20개가 어느 `.md` 에도 없었다. 「`--help` 가 있으니 됐다」는 답은
   * 부족하다 — 무엇이 있는지 모르면 `--help` 를 칠 대상도 모른다.
   *
   * **감사 리포트는 문서로 치지 않는다.** 거기에는 모든 이름이 등장하므로 그것까지 세면
   * 이 검사는 언제나 통과한다(실제로 그렇게 세면 0건이 나온다 — 확인했다).
   */
  it('사용자 문서에서 빠진 하위명령이 없다', () => {
    const help = read('core/src/help.ts');
    const subs = [...new Set([...help.matchAll(/name: '([a-z][a-z0-9 -]*)'/g)].map(m => m[1]))];
    expect(subs.length, 'help.ts 에서 하위명령을 못 뽑았다').toBeGreaterThan(30);

    const skip = /node_modules|\.git|docs\/release-readiness|docs\/appraisal|docs\/superpowers|progress\.md/;
    const docs: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (skip.test(p)) continue;
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md')) docs.push(fs.readFileSync(p, 'utf8'));
      }
    };
    walk(REPO);
    const hay = docs.join('\n');
    const missing = subs.filter(s => !hay.includes(s));
    expect(missing, '이 하위명령들이 사용자 문서 어디에도 없다').toEqual([]);
  });
});

describe('[USE-04] 명령표가 게이트의 두 단계를 싣는다', () => {
  /**
   * 페이즈 전이의 **필수 선행 단계**인데 표에 없었다. 특히 `gate approve` 는 사람만 실행할 수
   * 있는 명령이라, 표에 없으면 사람이 무엇을 눌러야 하는지 모른 채 막힌다.
   */
  it.each(READMES)('%s 의 명령표에 gate submit·approve 가 있다', (f) => {
    const t = read(f);
    expect(t, 'gate submit 이 표에 없다').toContain('`harness gate submit <P0..P12>`');
    expect(t, 'gate approve 가 표에 없다').toContain('`harness gate approve <P0..P12>`');
  });
});

describe('[USE-02·SHIP-10] 되돌리는 법이 문서에 있다', () => {
  /**
   * `harness init` 을 되돌리는 명령이 없고(의도된 설계 — 에이전트가 자기 규칙을 못 끄게),
   * 유일한 방법인 `.harness/` 삭제가 **어느 문서에도 없었다.** 의도된 설계일수록 적어야 한다:
   * 적혀 있지 않으면 사용자에게는 「빠져나갈 수 없다」와 구별되지 않는다.
   */
  it.each(READMES)('%s 가 제거 절차와 그 이유를 적는다', (f) => {
    const t = read(f);
    expect(t, '제거 명령이 없다').toContain('rm -rf .harness/');
    expect(t, '왜 uninstall 명령이 없는지 안 적혀 있다').toContain('harness uninstall');
    expect(t, '플러그인 자체를 지우는 법이 없다').toContain('claude plugin uninstall');
  });
});

describe('[FEAT-02] 광고한 수치에 재현 절차가 있고, 그 절차가 실제로 돈다', () => {
  /**
   * 같은 표의 지연 행은 `npm run bench:hook` 을 적는데 컨텍스트 비용 행만 재현 절차가 없었다.
   * **적어 두는 것만으로는 부족하다** — 광고된 절차가 실행되지 않으면 절차가 아니다.
   * 그래서 문구 존재와 «실행 가능»을 함께 본다.
   */
  it.each(READMES)('%s 가 컨텍스트 비용의 재현 명령을 적는다', (f) => {
    expect(read(f), '재현 명령이 없다').toContain('harness-hook session-start');
  });

  it('그 명령이 실제로 돌고, 광고한 크기와 같은 자릿수를 낸다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-feat02-'));
    execFileSync(BIN, ['init'], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: 'pipe' });
    const out = execFileSync(HOOK, ['session-start'], {
      input: JSON.stringify({ hook_event_name: 'SessionStart' }),
      cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8',
    });
    const bytes = Buffer.byteLength(out);
    expect(bytes, '브리핑이 비어 있다').toBeGreaterThan(200);
    /**
     * **고정 숫자로 단언하지 않는다.** 브리핑에는 프로젝트 경로가 들어가므로 크기가 경로 길이에
     * 따라 변한다 — 실제로 이 검사를 고정값으로 썼다가 임시 디렉토리 이름 하나로 빨개졌다.
     * 대신 **광고한 토큰 수가 실측과 같은 크기인지**를 본다(바이트/4 의 흔한 추정). 광고가
     * 자릿수부터 어긋나면 여기서 잡히고, 경로 길이로는 흔들리지 않는다.
     */
    const claimed = Number(/~(\d{2,4}) context tokens per session/.exec(read('README.md'))?.[1] ?? 0);
    expect(claimed, 'README 가 토큰 수를 안 적는다').toBeGreaterThan(0);
    const measured = bytes / 4;
    expect(Math.abs(measured - claimed) / claimed,
      `광고 ${claimed}토큰 vs 실측 ~${Math.round(measured)}토큰(${bytes}바이트) — 광고가 낡았다`)
      .toBeLessThan(0.4);
  });
});

describe('[SHIP-08] 이 리포도 자기 규율을 기계로 강제한다', () => {
  /**
   * 「1526 tests green · tsc 0」이 **누군가 손으로 돌린 결과**였다 — 커밋을 받은 사람은 그것이
   * 사실인지 알 수 없었다. 강제된 규율을 파는 제품이 자기 규율은 자율에 맡기고 있었다.
   */
  const ci = '.github/workflows/ci.yml';
  // CI 설정은 배포본에서 빠진다(`.gitattributes` export-ignore — 설치자에게는 제품이 아니라
  // 소음이다, PROD-113 과 같은 기준). 그래서 이 검사는 **리포 전용**이다. 사유 없이 건너뛰지
  // 않도록 조건을 여기 적어 둔다.
  const inRepo = fs.existsSync(path.join(REPO, '.gitattributes')) && fs.existsSync(path.join(REPO, ci));
  it.skipIf(!inRepo)('CI 설정이 있고, README 가 광고하는 두 게이트를 실제로 돌린다', () => {
    expect(fs.existsSync(path.join(REPO, ci)), 'CI 설정이 없다').toBe(true);
    const t = read(ci);
    expect(t, '타입 게이트가 없다').toContain('npm run check');
    expect(t, '테스트 게이트가 없다').toContain('npm test');
    // [SHIP-04] 로 설치자용 `.npmrc` 가 dev 를 빼므로 CI 는 명시적으로 켜야 한다.
    expect(t, 'devDependencies 없이 도는 CI 는 첫 실행에서 깨진다').toContain('--include=dev');
  });

  it.skipIf(!inRepo)('커밋된 번들이 소스에서 재현되는지도 CI 가 본다', () => {
    expect(read(ci), '번들 재현 게이트가 없다').toMatch(/git diff --exit-code.*core\/dist/);
  });
});

describe('[ORCH-02] 임시 디렉토리는 열고, 경계는 그대로 둔다', () => {
  /**
   * 설계 트랙이 루트 밖 쓰기를 전면 차단해 세션 표준 스크래치패드가 막혔고, 그래서 에이전트가
   * **저장소 안에** 중간 산출물을 쓰게 됐다 — 규칙이 저장소를 더럽히는 쪽으로 밀었다.
   * 통과시켜도 탈출이 안 된다는 것은 [SEC-15] 가 실측으로 확인했다(들여오기 10종 전건 차단).
   */
  const judge = (root: string, file: string): string => {
    const r = spawnSync(HOOK, ['pre-tool'], {
      input: JSON.stringify({
        hook_event_name: 'PreToolUse', tool_name: 'Write',
        tool_input: { file_path: file, content: 'x' },
      }),
      cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8',
    });
    const out = (r.stdout ?? '').trim();
    if (!out) return 'allow';
    return JSON.parse(out).hookSpecificOutput.permissionDecision as string;
  };

  it('프로젝트가 임시 밖일 때: 스크래치패드는 열리고 나머지는 그대로 막힌다', () => {
    /**
     * 프로젝트 루트를 **임시 디렉토리 밖**에 만든다 — 규칙이 「프로젝트가 임시 안이면 이 예외를
     * 쓰지 않는다」이기 때문이다(그렇지 않으면 예외가 프로젝트 이웃을 통째로 열어 `../` 탈출까지
     * 통과한다 — 배포본 스위트가 그것을 잡았다). 홈 아래 임시 이름 디렉토리를 쓰고 반드시 지운다.
     */
    const root = fs.mkdtempSync(path.join(os.homedir(), '.kwh-orch02-'));
    try {
      execFileSync(BIN, ['init'], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: 'pipe' });
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-scratch-'));

      expect(judge(root, path.join(scratch, 'probe.js')), '스크래치패드가 막히면 저장소를 더럽히게 된다')
        .toBe('allow');
      expect(judge(root, path.join(os.homedir(), 'kwh-orch02-probe.js')), '임시가 아닌 루트 밖까지 열면 안 된다')
        .toBe('deny');
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      expect(judge(root, path.join(root, 'src', 'a.ts')), '설계 트랙의 소스 보호가 풀렸다').toBe('deny');
      expect(judge(root, path.join(root, '.harness', 'events.jsonl')), '저널 보호가 풀렸다').toBe('deny');
      fs.rmSync(scratch, { recursive: true, force: true });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('프로젝트가 임시 «안»이면 예외를 쓰지 않는다 — 이웃이 통째로 열리면 상대경로 탈출이 통과한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-orch02-in-'));
    execFileSync(BIN, ['init'], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: 'pipe' });
    const sibling = path.join(path.dirname(root), 'kwh-outside.md');
    expect(judge(root, sibling), '프로젝트가 임시 안일 때 이웃까지 열리면 `../` 탈출이 통과한다')
      .toBe('deny');
  });
});

describe('[USE-03] 못 고치는 것은 못 고친다고 말한다', () => {
  /**
   * 경고 자체는 정확했지만 「무엇을 하면 사라지는가」를 안 적었다. `--repair` 를 「복구」로
   * 기대한 운영자는 경고가 안 사라져 「내가 뭘 잘못했나」 무한 루프에 빠진다.
   */
  it('저널 중간 손상 경고가 --repair 로는 안 지워진다고 말한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-use03-'));
    const run = (args: string[]): string => {
      const r = spawnSync(BIN, args, {
        cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8',
      });
      return r.stdout ?? '';
    };
    run(['init']);
    run(['node', 'upsert', '--id', 'F-1', '--title', 't']);
    const journal = path.join(root, '.harness', 'events.jsonl');
    const lines = fs.readFileSync(journal, 'utf8').split('\n');
    lines.splice(1, 0, '{not json');
    fs.writeFileSync(journal, lines.join('\n'));

    const warn = (JSON.parse(run(['doctor'])) as { warnings?: string[] }).warnings ?? [];
    const corrupt = warn.find(w => /corrupt|손상/.test(w));
    expect(corrupt, '손상 경고 자체가 없다').toBeTruthy();
    expect(corrupt!, '`--repair` 가 못 고친다는 사실이 없다').toMatch(/--repair/);
    expect(corrupt!, '무엇을 해야 하는지 없다').toMatch(/append-only/);
  });
});
