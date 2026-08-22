/**
 * 라운드 3-J MED 회귀 테스트.
 *
 * 세 건의 뿌리가 서로 다르다:
 * - [ENG-172] **같은 질문에 답이 두 벌** — 「이 명령이 실행되는가」를 한 곳은 `runsCommand`,
 *   한 곳은 `cmd.includes` 로 물었고 **이미 갈려 있었다**(언급 과차단 + 이중 공백 미차단).
 * - [EFF-173] **슬래시가 있다고 파일이 아니다** — 이미지 참조·URL·스코프 패키지가 안전망에
 *   잡혀, 출하 트랙의 「신규 파일 금지」가 존재하지 않는 파일을 사유로 정상 배포를 막았다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathLikeMentions } from '../src/bashwrite';
import { initHarness, readState, writeState } from '../src/state';
import { handleHook } from '../src/hook';
import { run } from '../src/cli';
import { readJournalForReplay } from '../src/events';
import type { Phase } from '../src/types';

const setup = (phase?: Phase) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-3jm-'));
  initHarness(root);
  if (phase) writeState(root, { ...readState(root), phase });
  return root;
};

/**
 * 빌드 차단은 **프로파일이 빌드 명령을 알 때만** 발화한다(`generic` 은 `build: ''` 라
 * 일부러 비어 있다 — 모르는 스택의 빌드 명령을 지어내는 것이 안 막는 것보다 나쁘다).
 * 그래서 이 축을 재려면 프로파일을 실제로 심어야 한다 — 안 그러면 규칙이 한 번도 안 도는데
 * 초록이 나온다([ENG-107] 과 같은 부류: 픽스처가 그 절을 발화시키는지 확인해야 한다).
 */
const withBuild = (phase: Phase): string => {
  const root = setup(phase);
  fs.mkdirSync(path.join(root, '.harness/profile'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness/profile/profile.yaml'), 'name: test\nsource_globs:\n  - "src/**"\n');
  fs.writeFileSync(path.join(root, '.harness/profile/commands.yaml'), 'build: npm run build\ntest: npm test\n');
  return root;
};
const bash = (root: string, command: string) =>
  handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } }) as any;
const denied = (out: any): boolean => out?.hookSpecificOutput?.permissionDecision === 'deny';
const reason = (out: any): string => out?.hookSpecificOutput?.permissionDecisionReason ?? '';

describe('[ENG-172] 「명령을 실행하는가」는 한 벌이다', () => {
  it('언급만으로는 빌드 차단이 걸리지 않는다 — 과차단이 곧 방어 0 이다', () => {
    const root = withBuild('P0');
    const out = bash(root, 'echo "run npm run build after P6"');
    expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
  });

  it('공백을 늘려도 빌드 차단이 풀리지 않는다', () => {
    const root = withBuild('P0');
    // `cmd.includes` 는 정규화한 needle 을 **원문**에서 찾아서, 원문 공백이 두 칸이면 놓쳤다.
    expect(denied(bash(root, 'npm  run  build'))).toBe(true);
  });

  it('설계 트랙에서 빌드는 여전히 막힌다', () => {
    expect(denied(bash(withBuild('P0'), 'npm run build'))).toBe(true);
  });

  it('구축 트랙에서는 빌드가 본업이다', () => {
    const out = bash(withBuild('P7'), 'npm run build');
    expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
  });
});

describe('[EFF-173] 슬래시가 있다고 파일이 아니다', () => {
  it('이미지 참조·URL·스코프 패키지는 경로 안전망에 잡히지 않는다', () => {
    expect(pathLikeMentions('docker push registry.io/app:v1')).not.toContain('registry.io/app');
    expect(pathLikeMentions('curl https://example.io/a')).toEqual([]);
    expect(pathLikeMentions('npm i @types/node')).not.toContain('types/node');
  });

  it('진짜 경로는 그대로 잡힌다 — 넓힌 예외가 방어를 덮지 않는다', () => {
    expect(pathLikeMentions('xxd -r -p a.hex src/app.ts')).toContain('src/app.ts');
    expect(pathLikeMentions('python3 -c "open(\'.harness/events.jsonl\',\'a\')"'))
      .toContain('.harness/events.jsonl');
  });

  it('출하 트랙에서 배포 거부 사유는 게이트이지 「신규 파일」이 아니다', () => {
    const root = setup('P12');
    const out = bash(root, 'docker push registry.io/app:v1');
    expect(denied(out)).toBe(true);
    // 원인을 오도하는 거부는 사람을 엉뚱한 곳으로 보낸다.
    expect(reason(out)).not.toMatch(/New files|신규 파일/);
    expect(reason(out)).toMatch(/gate|게이트/);
  });

  it('P12 게이트가 승인되면 배포가 열린다 — 승인 뒤에도 막히면 그건 과차단이다', () => {
    const root = setup('P12');
    const st = readState(root);
    writeState(root, {
      ...st,
      gates: { ...st.gates, P12: { status: 'approved', evidence: 'measured' } as any },
    });
    const out = bash(root, 'docker push registry.io/app:v1');
    expect(denied(out), `승인 뒤에도 막혔다: ${reason(out)}`).toBe(false);
  });
});

describe('[UTIL-176] 뒤로 가는 것은 역행이다 — 조용히 통과하지 않는다', () => {
  const captureErr = (fn: () => void): string => {
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    try { fn(); } finally { console.error = orig; }
    return lines.join('\n');
  };

  it('`phase set` 으로 이전 페이즈에 돌아갈 수 없다', () => {
    const root = setup('P7');
    // 승인된 게이트는 그대로 남으므로, 조용한 후진은 「설계를 고치고 기록 없이 되돌아오기」다.
    let code = 0;
    captureErr(() => { code = run(['phase', 'set', 'P3'], root); });
    expect(code).not.toBe(0);
    expect(readState(root).phase, '후진이 실제로 일어났다').toBe('P7');
  });

  it('거부문이 실재하는 명령을 가리킨다 — 막힌 자리에서 다음 수가 보여야 한다', () => {
    const root = setup('P7');
    const msg = captureErr(() => run(['phase', 'set', 'P3'], root));
    expect(msg).toMatch(/harness backtrack P3 --reason/);
  });

  it('`harness backtrack` 은 그대로 열려 있다 — 문을 없앤 것이 아니라 옮긴 것이다', () => {
    const root = setup('P7');
    expect(run(['backtrack', 'P3', '--reason', '설계 재검토'], root)).toBe(0);
    expect(readState(root).backtrack).toEqual({ to: 'P3', reason: '설계 재검토' });
  });

  it('같은 페이즈로의 `phase set` 은 역행으로 보지 않는다', () => {
    const root = setup('P7');
    const msg = captureErr(() => run(['phase', 'set', 'P7'], root));
    expect(msg).not.toMatch(/backtrack|역행/);
  });
});

describe('[COST-177] 폴백은 손상 저널에서도 싸다 — 가장 필요한 순간에 가장 느리면 안 된다', () => {
  const journal = (root: string, lines: string[]): void => {
    fs.writeFileSync(path.join(root, '.harness/events.jsonl'), lines.join('\n') + '\n');
  };

  it('손상 줄을 세는 결과는 그대로다 — 비용만 뺐지 판정을 바꾸지 않았다', () => {
    const root = setup();
    journal(root, [
      JSON.stringify({ ts: 'T', type: 'phase-set', data: { phase: 'P7' } }),
      '{broken',
      'not json at all',
      JSON.stringify({ ts: 'T', type: 'wave-turn-logged', data: {} }),   // 재생 대상 아님
      JSON.stringify({ ts: 'T', type: 'gate-approved', data: { phase: 'P0' } }),
    ]);
    const j = readJournalForReplay(root);
    expect(j.corruptLines).toBe(2);
    expect(j.events.map(e => e.type)).toEqual(['phase-set', 'gate-approved']);
  });

  it('10만 줄 전부 손상이어도 예외 폭주로 느려지지 않는다', () => {
    const root = setup();
    journal(root, Array.from({ length: 100_000 }, () => '{broken line ' + 'x'.repeat(40)));
    readJournalForReplay(root);                       // 워밍업
    const t0 = Date.now();
    const j = readJournalForReplay(root);
    const ms = Date.now() - t0;
    expect(j.corruptLines).toBe(100_000);
    // 수정 전 실측 p95 573ms(같은 머신). 문턱은 넉넉히 잡는다 — 잡으려는 것은
    // 「줄마다 예외」라는 **부류**이지 특정 머신의 밀리초가 아니다.
    expect(ms, `손상 저널 폴백이 ${ms}ms 걸렸다 — 예외 폭주가 돌아왔는지 보라`).toBeLessThan(200);
  });
});
