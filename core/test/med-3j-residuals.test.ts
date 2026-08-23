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
import { pathLikeMentions, SHELLS_TAKING_C } from '../src/bashwrite';
import { initHarness, readState, writeState } from '../src/state';
import { handleHook } from '../src/hook';
import { run } from '../src/cli';
import { readJournalForReplay } from '../src/events';
import { validateEvidence } from '../src/evidence';
import { canEnterPhase } from '../src/gate';
import { updateHashEntry } from '../src/hash';
import { createHash } from 'node:crypto';
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

describe('[UX-182] 한 문장 안의 두 이름은 같아야 한다', () => {
  it('게이트 거부문의 괄호가 처방이 가리키는 게이트의 상태를 말한다', () => {
    const root = setup('P0');
    const v = canEnterPhase(root, 'P2');
    expect(v.ok).toBe(false);
    // 「가장 앞의 것부터 P0」이라고 하면서 괄호는 P1 상태를 보여 주면 사람이 헤맨다.
    expect(v.reason).toMatch(/P0 (is currently|는 현재)/);
    expect(v.reason).not.toMatch(/P1 (is currently|는 현재)/);
  });
});

describe('[UX-183] 가리키는 곳이 없는 근거는 근거가 아니다', () => {
  const captureErr = (fn: () => void): string => {
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    try { fn(); } finally { console.error = orig; }
    return lines.join('\n');
  };

  it('없는 경로를 근거로 넣으면 경고한다 — 등재는 막지 않는다', () => {
    const root = setup();
    const msg = captureErr(() => {
      expect(run(['ship', 'defect', 'add', '--id', 'DEF-1', '--severity', 'high',
        '--title', 't', '--evidence', 'does/not/exist.ts:40'], root)).toBe(0);
    });
    expect(msg).toMatch(/does\/not\/exist\.ts/);
  });

  it('있는 경로·URL·경로 아닌 값에는 조용하다 — 경고가 시끄러우면 아무도 안 읽는다', () => {
    const root = setup();
    fs.writeFileSync(path.join(root, 'real.ts'), 'x\n');
    for (const ev of ['real.ts:1', 'https://ci.example/run/1', 'measured by hand']) {
      const msg = captureErr(() => run(['ship', 'defect', 'add', '--id', `D-${ev.length}`,
        '--severity', 'low', '--title', 't', '--evidence', ev], root));
      expect(msg, `쓸데없이 경고했다: ${ev}`).toBe('');
    }
  });
});

describe('[ENG-186] 해시 규율은 한 벌이고, 그 한 벌에 테스트가 있다', () => {
  const h = () => createHash('sha256');
  const digest = (entries: Array<[string, string | null]>): string => {
    const x = h();
    for (const [rel, body] of entries) updateHashEntry(x, rel, body === null ? null : Buffer.from(body));
    return x.digest('hex');
  };

  it('경계 없는 이어붙임을 막는다 — 다른 조합이 같은 해시를 내면 변조가 통과한다', () => {
    // 구분자가 없으면 "a"+"xy" 와 "ax"+"y" 가 같은 바이트열이 된다.
    expect(digest([['a', 'xy']])).not.toBe(digest([['ax', 'y']]));
  });

  it('길이 구분자를 지우면 갈리는 조합 — 감정자의 생존 뮤테이션이 겨눈 자리다', () => {
    expect(digest([['f', 'ab'], ['g', 'c']])).not.toBe(digest([['f', 'a'], ['g', 'bc']]));
  });

  it('★ 길이가 **유일한** 차이인 조합 — 이것이 없으면 뮤테이션이 산다', () => {
    // 위 케이스는 `\0` 구분자만으로도 갈려서, 길이를 지운 뮤테이션이 살아남았다.
    // 길이를 빼면 두 입력이 **같은 바이트열**이 되는 조합이라야 그 절을 실제로 잰다:
    //   길이 있음: `f\0 0\0` + `g\0 3\0 x\0y`   vs   `f\0 3\0 \0g\0x` + ...
    //   길이 없음: `f\0` + `g\0x\0y`              ==   `f\0g\0x\0y`
    const a = digest([['f', ''], ['g', 'x\u0000y']]);
    const b = digest([['f', '\u0000g\u0000x\u0000y']]);
    expect(a, '길이 구분자가 없으면 두 입력이 같은 해시가 된다').not.toBe(b);
  });

  it('「읽지 못했다」와 「비어 있다」를 구분한다', () => {
    expect(digest([['f', null]])).not.toBe(digest([['f', '']]));
  });

  it('같은 입력은 같은 해시다 — 결정적이어야 한다', () => {
    expect(digest([['f', 'x'], ['g', 'y']])).toBe(digest([['f', 'x'], ['g', 'y']]));
  });
});

describe('[UTIL-189] 역행 왕복이 실제로 완성된다 — 문을 옮겼으면 그 문이 열려야 한다', () => {
  it('`backtrack` → `phase set` 왕복이 끝난다', () => {
    const root = setup('P12');
    const st = readState(root);
    writeState(root, {
      ...st,
      gates: { ...st.gates, P0: { status: 'approved', evidence: 'measured' } as any,
        P1: { status: 'approved', evidence: 'measured' } as any,
        P2: { status: 'approved', evidence: 'measured' } as any },
    });
    expect(run(['backtrack', 'P2', '--reason', '설계 재검토'], root)).toBe(0);
    expect(run(['phase', 'set', 'P2'], root)).toBe(0);
    // 두 명령이 서로를 가리키기만 하면 지시를 따를수록 루프를 돈다.
    expect(readState(root).phase, '왕복이 완성되지 않았다').toBe('P2');
  });

  it('마커는 도착해도 남는다 — 역행의 목적은 도착이 아니라 개정이다', () => {
    const root = setup('P12');
    const st = readState(root);
    writeState(root, { ...st, gates: { ...st.gates, P0: { status: 'approved', evidence: 'measured' } as any } });
    run(['backtrack', 'P1', '--reason', 'x'], root);
    run(['phase', 'set', 'P1'], root);
    // 동결된 디자인 시스템을 고칠 수 있게 하는 것도 이 마커다(hook 의 `!state.backtrack`).
    expect(readState(root).backtrack).toEqual({ to: 'P1', reason: 'x' });
    expect(run(['backtrack', 'clear'], root)).toBe(0);
    expect(readState(root).backtrack).toBeNull();
  });

  it('마커가 가리키지 않는 페이즈로는 여전히 후진할 수 없다 — 문은 하나만 열렸다', () => {
    const root = setup('P12');
    const captured: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { captured.push(a.map(String).join(' ')); };
    let code = 0;
    try { run(['backtrack', 'P5', '--reason', 'x'], root); code = run(['phase', 'set', 'P2'], root); }
    finally { console.error = orig; }
    expect(code).not.toBe(0);
    expect(readState(root).phase).toBe('P12');
  });
});

describe('[QUAL-200] 시각 증거 게이트는 시각 산출물을 요구한다', () => {
  const evidenceDir = (root: string): string => {
    const d = path.join(root, '.harness/evidence/wave-001');
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  /** 진짜 PNG 한 장 — 치수 문턱을 넘는 최소 실물. */
  const writePng = (file: string, w = 400, h = 300): void => {
    const zlib = require('node:zlib') as typeof import('node:zlib');
    const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)])));
    const chunk = (type: string, data: Buffer): Buffer => {
      const body = Buffer.concat([Buffer.from(type), data]);
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : 0);
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 2;
    fs.writeFileSync(file, Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
    ]));
  };

  it('텍스트 파일은 게이트를 열지 못한다 — 거부문·README·check 가 같은 말을 해야 한다', () => {
    const root = setup('P7');
    fs.writeFileSync(path.join(evidenceDir(root), 'notes.txt'), 'not an image\n');
    const r = validateEvidence(root, 'wave-001');
    expect(r.usable.map(f => f.name), 'txt 가 캡처를 대신했다').toEqual([]);
    expect(r.problems.join('\n')).toMatch(/visual artifact|시각 산출물/);
  });

  it('진짜 캡처는 그대로 연다 — 문턱을 올린 것이 아니라 부류를 맞춘 것이다', () => {
    const root = setup('P7');
    const d = evidenceDir(root);
    fs.writeFileSync(path.join(d, 'notes.txt'), 'context\n');   // 함께 있어도 된다
    writePng(path.join(d, 'shot.png'));
    const r = validateEvidence(root, 'wave-001');
    expect(r.usable.map(f => f.name)).toEqual(['shot.png']);
  });

  it('내보낸 HTML 목업도 산출물이다 — Claude Design 흐름이 그것을 말한다', () => {
    const root = setup('P7');
    fs.writeFileSync(path.join(evidenceDir(root), 'mockup.html'), '<html><body>x</body></html>\n');
    expect(validateEvidence(root, 'wave-001').usable.map(f => f.name)).toEqual(['mockup.html']);
  });
});

describe('[SEC-204] 탈출구 env 리터럴 백스톱이 실제로 발화한다', () => {
  it('명령에 `HARNESS_ALLOW_FORCE` 가 보이면 이름 없이도 막는다', () => {
    const root = setup('P0');
    // 이 절은 뮤테이션에서 살아남았다 — 다른 규칙이 먼저 잡아 주고 있었기 때문이다.
    // 그 절만 발화하는 입력으로 재야 가드가 실제로 서 있는지 알 수 있다([ENG-107] 부류).
    for (const cmd of [
      'HARNESS_ALLOW_FORCE=1 ./somescript.sh',
      'export HARNESS_ALLOW_FORCE=1',
      'env HARNESS_ALLOW_FORCE=1 /tmp/whatever',
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('비슷하지만 다른 문자열은 막지 않는다', () => {
    const out = bash(setup('P7'), 'echo HARNESS_ALLOW_FORCED_MIGRATION=1');
    expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
  });
});

describe('[COST-228] 안전망이 입력 길이에 선형이다 — 타임아웃은 fail-open 이다', () => {
  it('슬래시 없는 긴 입력에서 2차로 터지지 않는다', () => {
    const cmd = 'cp x y; echo ' + 'a'.repeat(200 * 1024);
    pathLikeMentions(cmd);                       // 워밍업
    const t0 = Date.now();
    pathLikeMentions(cmd);
    const ms = Date.now() - t0;
    // 수정 전 실측: 50KB 에서 이미 3495ms — 10초 훅 타임아웃은 **통과**로 떨어진다.
    // 잡으려는 것은 특정 밀리초가 아니라 「길이의 제곱」이라는 **부류**다.
    expect(ms, `200KB 입력에 ${ms}ms 걸렸다 — 2차 폭발이 돌아왔는지 보라`).toBeLessThan(500);
  });

  it('추출 결과는 그대로다 — 비용만 뺐지 판정을 바꾸지 않았다', () => {
    expect(pathLikeMentions('cd src && xxd -r -p a.hex app.ts')).toEqual(['src/a.hex', 'src/app.ts']);
    expect(pathLikeMentions('cp /tmp/x .harness/events.jsonl'))
      .toEqual(['/tmp/x', '.harness/events.jsonl']);
  });
});

describe('[EFF-231] `--dry-run` 은 배포가 아니다 — 그러나 사면권도 아니다', () => {
  it('dry-run 은 통과한다 — 출하 전에 확인하려고 쓰는 명령이다', () => {
    const root = setup('P0');
    for (const cmd of ['npm publish --dry-run', 'kubectl apply -f x.yaml --dry-run=client']) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });

  it('★ 플래그 하나가 다른 줄의 진짜 배포를 사면하지 않는다', () => {
    // 명령 전체에 한 번 걸면 이 형태로 차단이 통째로 꺼진다.
    expect(denied(bash(setup('P0'), 'npm publish --dry-run; npm publish'))).toBe(true);
  });

  it('진짜 배포는 래퍼를 씌워도 막힌다', () => {
    expect(denied(bash(setup('P0'), "sh -c 'npm publish'"))).toBe(true);
  });
});

describe('[ENG-230] 프로세스치환 감지도 정본 셸 목록을 쓴다', () => {
  it('정본의 모든 셸에서 `<(…)` 형태가 막힌다', () => {
    const root = setup('P0');
    for (const sh of SHELLS_TAKING_C) {
      expect(denied(bash(root, `${sh} <(echo x)`)), `${sh} <(…) 가 통과했다`).toBe(true);
    }
  });
});

/**
 * [EFF-209] **설계 트랙에서 소스를 「읽는」 것은 구현이 아니다.**
 *
 * 라운드 3-L 이 지적한 과차단인데, 처방은 [SEC-221] 이 이미 냈다 — 「모든 형태에서 조회인
 * 도구」와 「플래그로 갈리는 도구」를 나눈 순간 `sed -n`·`awk`·`perl` 의 조회 형태가
 * 조회로 돌아왔다. 그래서 이 블록은 **고침이 아니라 못이다**: 다음에 누가 과차단을 막으려
 * 목록을 다시 손대면(그것이 [EFF-214] 가 만든 사고다) 여기가 먼저 깨진다.
 *
 * 짝을 함께 잰다 — 과차단만 재면 「전부 통과」가 초록이 되기 때문이다.
 */
describe('[EFF-209] 설계 트랙의 소스 조회는 막지 않는다 — 변형만 막는다', () => {
  it('조회 형태는 통과한다 (`.ts`·`.sql` 양쪽)', () => {
    const root = setup('P0');
    for (const cmd of [
      "sed -n '1,20p' src/a.ts",
      "sed -n '/CREATE TABLE/,/;/p' db/schema.sql",
      "awk '/CREATE/{print}' db/schema.sql",
      "perl -ne 'print if /export/' src/a.ts",
      "perl -pe 's/a/b/' src/a.ts",          // `-i` 가 없으면 표준출력이다
      "awk -f tools/q.awk db/schema.sql",    // `-f` 는 스크립트 입력이지 출력이 아니다
      'sort db/schema.sql',
    ]) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });

  it('같은 도구의 변형 형태는 그대로 막힌다', () => {
    const root = setup('P0');
    for (const cmd of [
      "sed -i '' 's/a/b/' src/a.ts",
      "sed -i.bak 's/1/2/' db/schema.sql",
      "perl -i -pe 's/a/b/' src/a.ts",
      "awk -i inplace '{print}' src/a.ts",
      'sort -o db/schema.sql db/schema.sql',
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });
});
