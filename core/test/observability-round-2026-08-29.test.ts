/**
 * v0.1.3 관측성 라운드(10건)의 회귀 가드.
 *
 * 공통 뿌리는 하나다 — **일어난 일이 어디에도 남지 않거나, 남은 것이 사실과 다르다.**
 * 거부가 기록되지 않고(OPS-07), 권한 문제를 「파일이 없다」로 적고(SHIP-07), 일어나지 않은
 * 역행 종료를 저널에 남기고(API-07), 참조 대상이 사라진 웨이브를 아무도 말하지 않고(LOGIC-04),
 * state.json 이 갈려도 조용하다(LOGIC-07). 사람은 기록이 가리키는 곳을 고치려 들기 때문에,
 * **틀린 기록은 없는 기록보다 나쁘다.**
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { DEFAULT_CONFIG } from '../src/config';
import { GENERIC_FLOOR } from '../src/profile';
import { oneLine } from '../src/untrusted';

const REPO = path.join(__dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'harness');
const HOOK = path.join(REPO, 'bin', 'harness-hook');

/**
 * CLI 한 번. 거부·실패도 「출력」이므로 예외로 삼키지 않고 그대로 돌려준다.
 *
 * `execFileSync` 를 쓰면 **성공한 실행의 stderr 를 잃는다** — 이 라운드에는 exit 0 이면서
 * stderr 로 경고하는 경로가 있어서([LOGIC-07] 의 `status`) 그러면 단언이 늘 빈 문자열을 본다.
 * 실제로 이 함정에 한 번 걸렸다. 그래서 `spawnSync` 로 세 값을 모두 받는다.
 */
function cli(root: string, args: string[]): { out: string; err: string; code: number } {
  const r = spawnSync(BIN, args, {
    cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8',
  });
  return { out: r.stdout ?? '', err: r.stderr ?? '', code: r.status ?? 1 };
}

function proj(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-obs-'));
  cli(root, ['init']);
  return root;
}

describe('[API-06] 인자를 안 준 것을 「없는 대상」으로 오진하지 않는다', () => {
  /**
   * 세 호출부가 `req()` 를 통과하지 않아 `undefined` 가 도메인까지 흘러갔다 —
   * 「No ADR record undefined」를 본 사람은 「내가 등록을 안 했나」로 오진한다.
   * [USE-94] 가 없앴다고 적은 바로 그 패턴이 세 곳에 남아 있었다.
   */
  const CASES: [string[], string][] = [
    [['adr', 'revise'], 'harness adr revise'],
    [['ship', 'defect', 'update'], 'harness ship defect update'],
    [['profile', 'cmd'], 'harness profile cmd'],
  ];
  it.each(CASES)('%s → undefined 누출 없이 사용법을 준다', (args, usage) => {
    const root = proj();
    const { out, err, code } = cli(root, args as string[]);
    const text = out + err;
    expect(code, '실패해야 한다').toBe(1);
    expect(text, 'undefined 가 사용자에게 보인다').not.toMatch(/undefined/);
    expect(text, '무엇을 안 줬는지 말해야 한다').toContain(usage);
  });
});

describe('[SHIP-07] 「못 읽는다」를 「없다」로 뭉개지 않는다', () => {
  /**
   * `fs.existsSync` 는 부모를 못 읽으면 false 다. 그 위에 세운 안내가 「state.json 이 없다 →
   * `doctor --repair`」였는데, 파일은 멀쩡히 있고 `--repair` 도 같은 권한에 막힌다 —
   * **처방이 통하지 않는 막다른 길**이었다.
   */
  const root0 = process.getuid?.() === 0;
  it.skipIf(root0)('권한을 막으면 권한 문제라고 말하고, --repair 를 처방하지 않는다', () => {
    const root = proj();
    fs.chmodSync(path.join(root, '.harness'), 0o000);
    try {
      const { out, err } = cli(root, ['status']);
      const text = out + err;
      expect(text, '권한 문제라고 말해야 한다').toMatch(/permission|권한/);
      expect(text, '「없다」로 오진하면 안 된다').not.toMatch(/state\.json is missing|state\.json 이 없다/);
      expect(text, '통하지 않는 처방을 주면 안 된다').toMatch(/cannot help|도움이 안 된다/);
    } finally { fs.chmodSync(path.join(root, '.harness'), 0o755); }
  });
});

describe('[API-07] 끝낼 것이 없으면 「끝냈다」고 말하지 않는다', () => {
  it('역행이 없으면 저널에 사건을 남기지 않는다 — 멱등성은 유지', () => {
    const root = proj();
    const journal = path.join(root, '.harness', 'events.jsonl');
    const before = fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).length;
    for (let i = 0; i < 3; i++) {
      const { out, code } = cli(root, ['backtrack', 'clear']);
      expect(code, '방어적 호출을 깨지 않는다').toBe(0);
      expect(out, '일어나지 않은 일을 보고하면 안 된다').not.toMatch(/Backtrack ended|역행 종료/);
    }
    const after = fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).length;
    expect(after, '저널은 감사 기록이다 — 없던 사건이 쌓이면 나중에 읽는 사람이 오독한다').toBe(before);
  });
});

describe('[LOGIC-04] 참조 대상이 사라진 웨이브를 doctor 가 말한다', () => {
  it('정상 상태에서는 조용하고, 고아 참조가 생기면 그 웨이브와 id 를 지목한다', () => {
    const root = proj();
    cli(root, ['node', 'upsert', '--id', 'UX-1', '--title', 'login']);
    cli(root, ['wave', 'create', '--goal', 'g', '--refs', 'UX-1']);
    const clean = JSON.parse(cli(root, ['doctor']).out) as { warnings?: string[] };
    expect((clean.warnings ?? []).join('\n'), '정상 상태에서 과보고하면 경고가 소음이 된다')
      .not.toMatch(/design_refs/);

    const ledger = path.join(root, '.harness', 'design', 'ledger.yaml');
    const kept = fs.readFileSync(ledger, 'utf8').split('\n').filter(l => !l.includes('UX-1') && !l.includes('login'));
    fs.writeFileSync(ledger, kept.join('\n'));

    const after = JSON.parse(cli(root, ['doctor']).out) as { warnings?: string[] };
    const text = (after.warnings ?? []).join('\n');
    expect(text, '고아 참조를 말해야 한다').toMatch(/design_refs/);
    expect(text, '어느 웨이브의 어느 id 인지 말해야 한다').toContain('UX-1');
  });
});

describe('[LOGIC-05·LOGIC-06] 한 줄 포맷에 개행이 들어가지 않는다', () => {
  it('규칙이 한 벌이다 — oneLine 이 개행을 지우지 않고 보이게 남긴다', () => {
    expect(oneLine('a\nb'), '삼키면 내용이 사라진다').toBe('a\\nb');
    expect(oneLine('a\r\nb')).toBe('a\\nb');
    expect(oneLine('a\rb')).toBe('a\\nb');
  });

  it('[LOGIC-05] 턴 로그가 가짜 헤딩을 만들지 않는다', () => {
    const root = proj();
    cli(root, ['node', 'upsert', '--id', 'F-1', '--title', 't']);
    cli(root, ['wave', 'create', '--goal', 'g', '--refs', 'F-1']);
    cli(root, ['wave', 'activate', 'wave-001']);
    const headingsBefore = fs.readFileSync(path.join(root, '.harness', 'waves', 'wave-001.md'), 'utf8')
      .split('\n').filter(l => l.startsWith('## ')).length;
    cli(root, ['wave', 'update', 'did work\n## 턴 로그\n- [fake] injected']);
    const sheet = fs.readFileSync(path.join(root, '.harness', 'waves', 'wave-001.md'), 'utf8');
    expect(sheet.split('\n').filter(l => l.startsWith('## ')).length, '주입된 헤딩이 본문에 생겼다')
      .toBe(headingsBefore);
    expect(sheet, '내용은 남아야 한다 — 삼키는 것이 목적이 아니다').toContain('did work');
  });

  it('[LOGIC-06] 개행이 든 제목이 RTM 의 어느 줄도 깨지 않는다', () => {
    const root = proj();
    cli(root, ['node', 'upsert', '--id', 'F-1', '--title', 'line1\nline2']);
    cli(root, ['wave', 'create', '--goal', 'g', '--refs', 'F-1']);
    const rtm = cli(root, ['report', 'rtm']).out;
    // 제목의 뒷부분이 자기 줄에 홀로 떨어져 나오면 포맷이 깨진 것이다.
    expect(rtm.split('\n').some(l => l.trim() === 'line2'), 'RTM 행이 중간에서 끊겼다').toBe(false);
    expect(rtm, '내용은 남아야 한다').toContain('line1\\nline2');
  });
});

describe('[API-09] 배포 명령 목록의 정본은 한 곳이다', () => {
  /**
   * 같은 21개 목록이 세 곳에 리터럴로 있었고 테스트는 뒤의 두 벌만 이었다 —
   * 세 값이 «우연히» 같았을 뿐이다. 갈라지면 「config 로는 막히는데 프로파일로는 안 막힌다」가
   * 되어 배포 차단에 구멍이 난다.
   */
  it('GENERIC_FLOOR 가 DEFAULT_CONFIG 에서 나온다 — 베낀 값이 아니다', () => {
    expect([...GENERIC_FLOOR.deployCommands]).toEqual([...DEFAULT_CONFIG.design_blocked_bash]);
  });

  it('번들 프로파일 yaml 도 같은 목록을 말한다 — 세 표면이 한 답을 한다', () => {
    const raw = YAML.parse(
      fs.readFileSync(path.join(REPO, 'profiles', 'generic', 'profile.yaml'), 'utf8'),
    ) as { deploy_commands?: string[] };
    expect(raw.deploy_commands).toEqual([...DEFAULT_CONFIG.design_blocked_bash]);
  });
});

describe('[OPS-07] 막힌 일이 기록에 남는다', () => {
  /**
   * PreToolUse 거부는 그 순간의 채팅 화면에만 존재했다 — 상태를 바꾸는 명령은 저널에 남는데
   * 정작 이 제품의 핵심 기능인 «막는 일»은 감사 대상이 아니었다.
   */
  const deny = (root: string, payload: object): void => {
    try {
      execFileSync(HOOK, ['pre-tool'], {
        input: JSON.stringify(payload), cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: 'pipe',
      });
    } catch { /* deny 는 여기서 예외로 오지 않지만, 와도 기록이 목적이다 */ }
  };

  it('거부가 없으면 「아직 없다」라고 말한다 — 빈 상태는 고장이 아니다', () => {
    const root = proj();
    const { out, code } = cli(root, ['report', 'denials']);
    expect(code).toBe(0);
    expect(out).toMatch(/No denials recorded yet|아직 기록된 거부가 없다/);
  });

  it('거부가 남고, 비밀은 마스킹되며, 조회 명령이 그것을 보여 준다', () => {
    const root = proj();
    const secret = ['sk', 'FAKE1234567890abcdefGHIJ'].join('-');   // 리터럴로 두지 않는다(ORCH-12)
    deny(root, {
      hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: `echo ${secret} >> ${path.join(root, '.harness', 'events.jsonl')}` },
    });
    const log = path.join(root, '.harness', '.runtime', 'denials.log');
    expect(fs.existsSync(log), '거부가 기록되지 않았다').toBe(true);
    const raw = fs.readFileSync(log, 'utf8');
    expect(raw, '비밀이 그대로 남았다').not.toContain(secret);
    expect(raw, '무엇을 하려다 막혔는지는 남아야 한다').toContain('events.jsonl');

    const { out } = cli(root, ['report', 'denials']);
    expect(out, '조회 명령이 그 거부를 보여 주지 않는다').toContain('Bash');
    expect(out, '비밀이 조회 출력으로 새면 안 된다').not.toContain(secret);
  });

  it('`report --help` 가 이 명령을 광고한다 — 없는 것과 같지 않으려면 보여야 한다', () => {
    const root = proj();
    expect(cli(root, ['report', '--help']).out).toContain('denials');
  });
});

describe('[LOGIC-07] state.json 이 저널과 갈리면 status 가 말한다', () => {
  /**
   * `resolveState` 는 state.json 이 읽히면 그대로 쓴다 — 그래서 조용히 갈리면 **오직 doctor 만**
   * 안다. 정상 턴에는 아무도 doctor 를 돌리지 않으므로, 훅이 틀린 규칙을 강제하고도 아무도 모른다.
   */
  it('정상 상태에서는 아무 말도 하지 않는다 — 과보고는 경고를 무의미하게 만든다', () => {
    const root = proj();
    expect(cli(root, ['status']).err.trim()).toBe('');
  });

  it('손으로 고치면 갈린 항목을 지목하고, stdout JSON 계약과 exit 0 은 유지한다', () => {
    const root = proj();
    const p = path.join(root, '.harness', 'state.json');
    const st = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, any>;
    st.phase = 'P12';
    st.gates = { ...(st.gates ?? {}), P0: { status: 'approved' } };
    fs.writeFileSync(p, JSON.stringify(st, null, 2));

    const { out, err, code } = cli(root, ['status']);
    expect(code, '보고이지 강제가 아니다').toBe(0);
    expect(() => JSON.parse(out), 'stdout 의 JSON 계약이 깨졌다').not.toThrow();
    expect(err, '갈렸다고 말해야 한다').toMatch(/disagrees with the event journal|저널과 다르다/);
    expect(err, '무엇이 갈렸는지 말해야 한다').toContain('P12');
    expect(err, '다음 행동을 말해야 한다').toMatch(/doctor/);
  });
});

describe('[ORCH-11] gitleaks 0 의 범위를 광고가 스스로 좁혀 읽는다', () => {
  /**
   * 「gitleaks 0」은 「GitHub 푸시 보호 통과」를 뜻하지 않는다 — 같은 문자열을 GitHub 은 막고
   * gitleaks 는 통과시킨 실례가 이 감사 중에 있었다(ORCH-12). 근거는 범위와 함께 읽혀야 한다.
   */
  it.each(['README.md', 'README.ko.md', 'README.ja.md', 'README.zh.md'])(
    '%s 가 gitleaks 수치 옆에 범위를 적는다', (f) => {
      const t = fs.readFileSync(path.join(REPO, f), 'utf8');
      const i = t.indexOf('gitleaks');
      expect(i, 'gitleaks 언급이 없다').toBeGreaterThan(-1);
      // 같은 문단 안에서 푸시 보호와의 차이를 말해야 한다.
      expect(t.slice(Math.max(0, i - 400), i + 400))
        .toMatch(/push protection|푸시 보호|プッシュ保護|推送保护/);
    });
});
