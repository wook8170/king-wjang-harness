/**
 * 영문 기본 회귀 가드 — 「산출물에 한국어 0」을 **사람이 손으로 재지 않게** 한다.
 *
 * 왜 필요한가: 라운드 2에서 「생성 문서 i18n 완료 · 산출물 한국어 0」이라고 적었는데
 * 틀렸다. 스윕이 30개 명령에 그쳤고 adr·doctor·gate·mcp·migrate·profile·usage·wave 가
 * 통째로 빠져 있었다. **부분 측정을 전수 측정이라고 부른 것**이 결함이었지,
 * 번역이 어려웠던 게 아니다. 그래서 이 파일은 번역을 검사하는 게 아니라
 * **측정 범위를 코드로 고정한다** — 새 명령이 생기면 자동으로 사정권에 들어온다.
 *
 * 검사 대상은 **하네스가 만든 문자열**이다. 사용자가 넣은 값(노드 제목·수용 기준·
 * 결함 요약)이 한국어인 것은 정상이므로 픽스처는 전부 영문으로 넣는다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { COMMANDS } from '../src/help';

const HANGUL = /[가-힣]/;

/**
 * 스위트 전역은 `HARNESS_LANG=ko` 로 고정돼 있다(setup.ts). 이 파일만 그것을 해제해
 * **기본값(en)** 을 본다 — 기본값을 검사하려면 기본값 상태를 만들어야 한다.
 */
let prevLang: string | undefined;
beforeAll(() => { prevLang = process.env.HARNESS_LANG; delete process.env.HARNESS_LANG; });
afterAll(() => { if (prevLang !== undefined) process.env.HARNESS_LANG = prevLang; });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-en-'));

/** stdout·stderr 를 모두 모은다 — 안내·경고가 stderr 로 가는 명령이 있다. */
function capture(fn: () => void): string {
  const out: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => { out.push(a.map(String).join(' ')); };
  console.error = (...a: unknown[]) => { out.push(a.map(String).join(' ')); };
  try { fn(); } catch (e) { out.push(e instanceof Error ? e.message : String(e)); }
  finally { console.log = log; console.error = err; }
  return out.join('\n');
}

describe('i18n — 기본 언어(en) 출력에 한국어가 없다', () => {
  it('help.ts 레지스트리의 모든 명령/하위명령 도움말', () => {
    const root = tmp();
    capture(() => run(['init'], root));
    const offenders: string[] = [];
    for (const c of COMMANDS) {
      const top = capture(() => run([c.name, '--help'], root));
      if (HANGUL.test(top)) offenders.push(`${c.name} --help`);
      for (const s of c.subs ?? []) {
        const sub = capture(() => run([c.name, s.name, '--help'], root));
        if (HANGUL.test(sub)) offenders.push(`${c.name} ${s.name} --help`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('모든 명령의 무인자·오인자 오류 경로', () => {
    const root = tmp();
    capture(() => run(['init'], root));
    const offenders: string[] = [];
    for (const c of COMMANDS) {
      for (const argv of [[c.name], [c.name, '__bogus__']]) {
        const text = capture(() => run(argv, root));
        if (HANGUL.test(text)) offenders.push(`${argv.join(' ')} → ${text.slice(0, 90)}`);
      }
      for (const s of c.subs ?? []) {
        const text = capture(() => run([c.name, s.name], root));
        if (HANGUL.test(text)) offenders.push(`${c.name} ${s.name} → ${text.slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('생성 문서 — 리뷰 패킷·RTM·허브·릴리스 체크리스트·결함 대장·브리프', () => {
    const root = tmp();
    const c = (argv: string[]) => capture(() => run(argv, root));
    c(['init']);
    c(['node', 'upsert', '--id', 'F-1', '--title', 'Login works']);
    c(['node', 'upsert', '--id', 'UX-7', '--title', 'Checkout screen']);
    c(['wave', 'create', '--goal', 'build login', '--refs', 'F-1', '--acceptance', 'returns 200']);
    c(['wave', 'activate', 'wave-001']);
    c(['ship', 'defect', 'add', '--id', 'SEC-01', '--severity', 'blocker',
       '--title', 'auth bypass', '--evidence', 'src/auth.ts:88']);

    const docs: [string, string[]][] = [
      ['report rtm', ['report', 'rtm']],
      ['report hub', ['report', 'hub']],
      ['report packet P0', ['report', 'packet', 'P0']],
      ['ship checklist', ['ship', 'checklist']],
      ['ship verdict', ['ship', 'verdict']],
      ['ship defect list', ['ship', 'defect', 'list']],
      ['loop brief executor', ['loop', 'brief', 'wave-001', '--for', 'executor']],
      ['loop brief verifier', ['loop', 'brief', 'wave-001', '--for', 'verifier']],
      ['loop next', ['loop', 'next']],
      ['status', ['status']],
      ['doctor', ['doctor']],
      ['trace F-1', ['trace', 'F-1']],
      ['wave list', ['wave', 'list']],
      ['migrate', ['migrate']],
      ['profile show', ['profile', 'show']],
    ];
    const offenders = docs
      .map(([label, argv]) => [label, c(argv)] as const)
      .filter(([, text]) => HANGUL.test(text))
      .map(([label, text]) => `${label} → ${text.match(/.*[가-힣].*/)?.[0]?.slice(0, 110)}`);
    expect(offenders).toEqual([]);
  });

  it('디스크에 남는 산출물 — 웨이브 지시서·결함 대장 사본', () => {
    const root = tmp();
    const c = (argv: string[]) => capture(() => run(argv, root));
    c(['init']);
    c(['node', 'upsert', '--id', 'F-1', '--title', 'Login works']);
    c(['wave', 'create', '--goal', 'build login', '--refs', 'F-1', '--acceptance', 'returns 200']);
    c(['ship', 'defect', 'add', '--id', 'SEC-01', '--severity', 'blocker',
       '--title', 'auth bypass', '--evidence', 'src/auth.ts:88']);

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) { walk(p); continue; }
        if (!/\.(md|ya?ml|json|jsonl|ts|css|js)$/.test(name)) continue;
        const text = fs.readFileSync(p, 'utf8');
        if (HANGUL.test(text)) offenders.push(`${path.relative(root, p)}`);
      }
    };
    walk(path.join(root, '.harness'));
    expect(offenders).toEqual([]);
  });

  /**
   * 오류 경로는 정상 실행으로 도달하지 않는다 — 그래서 **일부러 깨뜨려서** 본다.
   * 이 절이 없으면 「명령을 다 돌렸다」가 「메시지를 다 봤다」로 착각된다(라운드 2의 실패 형태).
   */
  it('일부러 만든 고장 상태의 진단·복구 메시지', () => {
    const root = tmp();
    const c = (argv: string[]) => capture(() => run(argv, root));
    c(['init']);

    const offenders: string[] = [];
    const check = (label: string, text: string): void => {
      if (HANGUL.test(text)) offenders.push(`${label} → ${text.match(/.*[가-힣].*/)?.[0]?.slice(0, 110)}`);
    };

    // (1) state.json 부재 — 재생 복구 경로
    fs.rmSync(path.join(root, '.harness', 'state.json'));
    check('state.json 부재 · doctor', c(['doctor']));
    check('state.json 부재 · status', c(['status']));

    // (2) 저널 손상 — 재생 불신 경로 + 복구 거부
    c(['init']);
    fs.appendFileSync(path.join(root, '.harness', 'events.jsonl'), 'NOT_JSON\n');
    check('저널 손상 · doctor', c(['doctor']));
    check('저널 손상 · doctor --repair', c(['doctor', '--repair']));

    // (3) 미지 이벤트 타입 — 버전 스큐 경로
    fs.appendFileSync(path.join(root, '.harness', 'events.jsonl'),
      JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', type: 'from-the-future', data: {} }) + '\n');
    check('미지 이벤트 · doctor', c(['doctor']));

    // (4) 프로파일 이름 오류 / 미존재
    const cfg = path.join(root, '.harness', 'config.yaml');
    fs.writeFileSync(cfg, 'profile: "bad name!"\n');
    check('프로파일 이름 불량', c(['profile', 'show']));
    fs.writeFileSync(cfg, 'profile: no-such-profile\n');
    check('프로파일 미존재', c(['profile', 'show']));
    fs.writeFileSync(cfg, '');

    // (5) 없는 대상 — 원장·웨이브·ADR·게이트
    check('없는 노드 trace', c(['trace', 'F-404']));
    check('없는 웨이브 활성화', c(['wave', 'activate', 'wave-404']));
    check('활성 웨이브 없이 update', c(['wave', 'update', 'text']));
    check('활성 웨이브 없이 complete', c(['wave', 'complete']));
    check('없는 ADR', c(['adr', 'show', 'ADR-404']));
    check('미제출 게이트 승인', c(['gate', 'approve', 'P0']));
    check('미승인 페이즈 이동', c(['phase', 'set', 'P7']));
    check('없는 참조로 웨이브 생성', c(['wave', 'create', '--goal', 'g', '--refs', 'F-404']));
    check('결함 근거 없음', c(['ship', 'defect', 'add', '--id', 'X-1', '--severity', 'blocker', '--title', 't']));
    check('토큰 파일 없음', c(['design', 'html', 'UX-7']));
    check('증적 없음', c(['evidence', 'check', 'wave-404']));

    expect(offenders).toEqual([]);
  });

  /**
   * [I18N-72] **모델에게 지시를 내리는 계층**이 빠져 있었다. CLI·코어·프로파일만 재고
   * 「i18n 완료」라 불렀는데, 실제로 배포되어 모델을 움직이는 것은 `skills/`·`agents/`·
   * 마켓플레이스 매니페스트다 — 거기에 한글 15,569자가 그대로 있었다. 라운드 2의
   * 「부분 측정을 전수 측정이라 부른 것」이 **같은 뿌리로 한 번 더** 나온 것이라,
   * 이 가드도 목록이 아니라 **디렉토리 전체**를 훑는다(새 스킬이 자동으로 사정권에 든다).
   *
   * 저자 이름(고유명사)만 예외다 — 사람 이름을 번역하는 것은 i18n 이 아니다.
   */
  it('배포되는 지시 계층 — skills/ · agents/ · 플러그인 매니페스트', () => {
    const repo = path.resolve(__dirname, '../..');
    const AUTHOR = '장욱';
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(md|json|ya?ml)$/.test(name)) continue;
        const body = fs.readFileSync(p, 'utf8').split(AUTHOR).join('');
        if (HANGUL.test(body)) offenders.push(path.relative(repo, p));
      }
    };
    walk(path.join(repo, 'skills'));
    walk(path.join(repo, 'agents'));
    walk(path.join(repo, '.claude-plugin'));
    expect(offenders).toEqual([]);
  });

  it('번들 프로파일 — 배포에 실리는 데이터 파일', () => {
    const offenders: string[] = [];
    const profilesDir = path.resolve(__dirname, '../../profiles');
    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) { walk(p); continue; }
        if (HANGUL.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(profilesDir, p));
      }
    };
    walk(profilesDir);
    expect(offenders).toEqual([]);
  });
});
