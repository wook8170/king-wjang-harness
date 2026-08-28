/**
 * [OPS-76] 정책 변조 관측 — 게이트 산출물 해시(`gate.ts` 의 artifactHash)와 **같은 패턴**.
 *
 * SEC-69 가 정책 파일을 에이전트 쓰기 금지로 올렸고, 사람이 터미널에서 직접 고치는 것은
 * 의도된 탈출구로 남겼다. 남은 구멍은 **탐지**다: 사람이 정책을 바꿔도 `doctor` 는 조용했고,
 * 리뷰어가 「왜 이 프로젝트는 설계 트랙에서 소스를 쓸 수 있나」를 알 방법이 없었다.
 *
 * 이 스위트가 무는 것:
 *  (1) 해시가 정책 파일 집합(config.yaml + `.harness/profile/**`)의 함수인가
 *  (2) 베이스라인이 init 에서 고정되는가
 *  (3) 변경이 **warning** 으로 보이는가 (issue 가 아니다 — 복구 대상이 아니고, 정당할 수 있다)
 *  (4) `doctor --accept-policy` 로 정당하게 재고정되는가
 *  (5) 새 이벤트가 EVENT_TYPES 에 등록돼 `doctor --repair` 가 복구를 거부하지 않는가
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { initHarness } from '../src/state';
import { runDoctor } from '../src/doctor';
import { readEvents, KNOWN_EVENT_TYPES } from '../src/events';
import { configPath, statePath } from '../src/paths';
import {
  computePolicyHash, listPolicyFiles, pinPolicy, pinnedPolicy,
} from '../src/policy';
import { submitGate, approveGate } from '../src/gate';
import { handleHook } from '../src/hook';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-pol-'));

/** SEC-75 이후 게이트는 실질 분량(공백 제외 80자)을 요구한다 — 픽스처도 실제 문서여야 한다. */
const SUBSTANTIVE = [
  '# P0 컨셉',
  '',
  '정책 무결 장치가 무엇을 지키는지 적는다. 정책 파일이 바뀌면 훅이 무엇을 막을지가 바뀌므로,',
  '변경 사실 자체가 판정의 입력이다. 이 문서는 그 전제를 게이트 심사 대상으로 올리기 위한 것이다.',
].join('\n');

/** CLI 경로로 초기화한다 — 베이스라인 고정은 init 의 일부다. */
const initViaCli = (): string => {
  const root = tmp();
  const l = vi.spyOn(console, 'log').mockImplementation(() => {});
  const e = vi.spyOn(console, 'error').mockImplementation(() => {});
  run(['init'], root);
  l.mockRestore();
  e.mockRestore();
  return root;
};

/** 사람이 터미널에서 정책을 고치는 상황 — 훅은 이 경로를 보지 않는다(의도된 탈출구). */
const humanEditsPolicy = (root: string, yaml: string) => fs.writeFileSync(configPath(root), yaml);

const localProfile = (root: string, yaml: string) => {
  fs.mkdirSync(path.join(root, '.harness/profile'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness/profile/profile.yaml'), yaml);
};

describe('policy: 해시 계산', () => {
  it('정책 파일 목록은 config.yaml + .harness/profile/** 이다', () => {
    const root = initViaCli();
    expect(listPolicyFiles(root)).toEqual(['.harness/config.yaml']);
    localProfile(root, 'name: t\nsource_globs: [src/**]\n');
    fs.writeFileSync(path.join(root, '.harness/profile/commands.yaml'), 'test: npm test\n');
    expect(listPolicyFiles(root)).toEqual([
      '.harness/config.yaml',
      '.harness/profile/commands.yaml',
      '.harness/profile/profile.yaml',
    ]);
  });

  it('같은 내용이면 같은 해시다 (시각·순서에 의존하지 않는다)', () => {
    const root = initViaCli();
    expect(computePolicyHash(root).hash).toBe(computePolicyHash(root).hash);
  });

  it('config.yaml 한 글자만 바뀌어도 해시가 달라진다', () => {
    const root = initViaCli();
    const before = computePolicyHash(root).hash;
    humanEditsPolicy(root, 'profile: generic\ndesign_allowed_prefixes: [""]\n');
    expect(computePolicyHash(root).hash).not.toBe(before);
  });

  it('로컬 프로파일 추가도 정책 변경이다 — 번들보다 우선하므로 같은 무게다', () => {
    const root = initViaCli();
    const before = computePolicyHash(root).hash;
    localProfile(root, 'name: t\nsource_globs: []\ndeploy_commands: []\n');
    expect(computePolicyHash(root).hash).not.toBe(before);
  });

  it('정책 파일 삭제도 잡는다 — 없는 것과 빈 것은 다른 해시다', () => {
    const root = initViaCli();
    const withFile = computePolicyHash(root).hash;
    humanEditsPolicy(root, '');
    const emptyFile = computePolicyHash(root).hash;
    fs.rmSync(configPath(root));
    const noFile = computePolicyHash(root).hash;
    expect(emptyFile).not.toBe(withFile);
    expect(noFile).not.toBe(emptyFile);
  });
});

describe('policy: 베이스라인 고정', () => {
  it('init 이 베이스라인을 고정한다 — policy-pinned 이벤트가 저널에 남는다', () => {
    const root = initViaCli();
    const ev = readEvents(root).find(e => e.type === 'policy-pinned');
    expect(ev).toBeDefined();
    expect(ev!.data.via).toBe('init');
    expect(ev!.data.hash).toBe(computePolicyHash(root).hash);
    expect(pinnedPolicy(root)!.hash).toBe(computePolicyHash(root).hash);
  });

  it('policy-pinned 는 아는 이벤트 타입이다 (미등록이면 doctor 가 복구를 거부한다)', () => {
    expect(KNOWN_EVENT_TYPES.has('policy-pinned')).toBe(true);
  });

  it('재고정은 직전 해시를 함께 남긴다 — 무엇이 무엇으로 바뀌었는지가 감사 대상이다', () => {
    const root = initViaCli();
    const before = computePolicyHash(root).hash;
    humanEditsPolicy(root, 'profile: generic\nterse: true\n');
    const r = pinPolicy(root, 'accept');
    expect(r.changed).toBe(true);
    expect(r.prevHash).toBe(before);
    const ev = readEvents(root).at(-1)!;
    expect(ev.type).toBe('policy-pinned');
    expect(ev.data.via).toBe('accept');
    expect(ev.data.prevHash).toBe(before);
  });

  it('바뀐 게 없으면 저널을 늘리지 않는다 — 중복 이벤트는 잡음이다', () => {
    const root = initViaCli();
    const n = readEvents(root).length;
    const r = pinPolicy(root, 'accept');
    expect(r.changed).toBe(false);
    expect(readEvents(root)).toHaveLength(n);
  });
});

describe('doctor: 정책 변경 탐지', () => {
  it('정책이 그대로면 아무 말도 하지 않는다 — 과경고 금지', () => {
    const r = runDoctor(initViaCli());
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('사람이 정책을 바꾸면 warning 으로 보고한다 (issue 가 아니다)', () => {
    const root = initViaCli();
    humanEditsPolicy(root, 'profile: generic\ndesign_allowed_prefixes: [""]\n');
    const r = runDoctor(root);
    expect(r.warnings.join(' ')).toMatch(/정책/);
    expect(r.issues).toEqual([]);
    // 복구 대상이 아니므로 ok 를 내리지 않는다 — 영구 red 는 경보를 죽인다.
    expect(r.ok).toBe(true);
  });

  it('경고는 재고정 경로를 함께 알려준다 — 정당한 변경도 있다', () => {
    const root = initViaCli();
    humanEditsPolicy(root, 'profile: generic\nterse: true\n');
    expect(runDoctor(root).warnings.join(' ')).toMatch(/--accept-policy/);
  });

  it('베이스라인이 없는 구 프로젝트는 note 로만 안내한다 (warning 아님)', () => {
    const root = tmp();
    initHarness(root); // CLI 를 거치지 않은 = OPS-76 이전에 만들어진 프로젝트
    const r = runDoctor(root);
    expect(r.warnings).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/--accept-policy/);
  });

  it('--accept-policy 가 베이스라인을 재고정하고 경고를 정산한다', () => {
    const root = initViaCli();
    humanEditsPolicy(root, 'profile: generic\ndesign_allowed_prefixes: [".harness/", "docs/", "src/"]\n');
    expect(runDoctor(root).warnings.join(' ')).toMatch(/정책/);

    const accepted = runDoctor(root, { acceptPolicy: true });
    expect(accepted.warnings.join(' ')).not.toMatch(/정책/);
    expect(accepted.notes.join(' ')).toMatch(/정책/);
    // 재고정 후에는 조용하다
    expect(runDoctor(root).warnings).toEqual([]);
    // 그러나 저널에는 남는다 — 리뷰어가 나중에 「언제 무엇이 바뀌었나」를 물을 수 있어야 한다.
    const pins = readEvents(root).filter(e => e.type === 'policy-pinned');
    expect(pins).toHaveLength(2);
    expect(pins[1].data.via).toBe('accept');
  });

  it('정책 이벤트가 있어도 --repair 는 거부되지 않는다 (이벤트 타입 드리프트 회귀)', () => {
    const root = initViaCli();
    humanEditsPolicy(root, 'profile: generic\nterse: true\n');
    pinPolicy(root, 'accept');
    fs.writeFileSync(statePath(root), '{corrupted');
    const r = runDoctor(root, { repair: true });
    expect(r.refused).toBe(false);
    expect(r.repaired).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(/미지 이벤트/);
  });
});

describe('cli: harness doctor --accept-policy', () => {
  /**
   * CLI 게이트는 **두 번째 겹**이다(SHIP-52 의 `HARNESS_ALLOW_FORCE` 와 같은 형태).
   * 훅은 문자열을 보는 장치라 훅을 타지 않는 경로가 남는다 — 적대적 검증이
   * `node <path>/core/dist/cli.js doctor --accept-policy` 로 실제로 통과시켜 탐지 장치를 껐다.
   * 사람이 자기 터미널에서 env 를 켜는 것은 통과 — 그 순간이 「사람의 최종 클릭」이다.
   */
  const withAccept = <T>(fn: () => T): T => {
    const prev = process.env.HARNESS_ACCEPT_POLICY;
    process.env.HARNESS_ACCEPT_POLICY = '1';
    try { return fn(); } finally {
      if (prev === undefined) delete process.env.HARNESS_ACCEPT_POLICY;
      else process.env.HARNESS_ACCEPT_POLICY = prev;
    }
  };

  it('플래그가 실제로 먹는다 — exit 0 이고 저널에 재고정이 남는다', () => {
    const root = initViaCli();
    humanEditsPolicy(root, 'profile: generic\nterse: true\n');
    const l = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = withAccept(() => run(['doctor', '--accept-policy'], root));
    l.mockRestore();
    expect(code).toBe(0);
    expect(readEvents(root).filter(e => e.type === 'policy-pinned').at(-1)!.data.via).toBe('accept');
  });

  it('env 없이는 거부한다 — 훅을 타지 않는 경로에서도 재고정이 막힌다', () => {
    const root = initViaCli();
    humanEditsPolicy(root, 'profile: generic\nterse: true\n');
    const l = vi.spyOn(console, 'log').mockImplementation(() => {});
    const e = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = run(['doctor', '--accept-policy'], root);
    l.mockRestore();
    e.mockRestore();
    expect(code).not.toBe(0);
    expect(readEvents(root).filter(ev => ev.type === 'policy-pinned').length).toBe(1); // init 것 하나뿐
    expect(runDoctor(root).warnings.join(' ')).toMatch(/정책|policy/); // 경고는 그대로 남는다
  });

  it('진단·복구는 env 없이도 통과한다 — 잠그는 것은 수용뿐이다', () => {
    const root = initViaCli();
    const l = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(run(['doctor'], root)).toBe(0);
    expect(run(['doctor', '--repair'], root)).toBe(0);
    l.mockRestore();
  });
});

describe('gate: 승인은 그 시점의 정책을 함께 기록한다', () => {
  /**
   * 승인 시점에 **재고정하지는 않는다** — 산출물에 찍는 도장으로 정책 변경까지 승인되면
   * 사람이 누른 적 없는 것을 승인한 셈이 된다. 대신 그때의 정책 해시를 이벤트에 박아,
   * 「이 게이트는 어떤 정책 아래에서 열렸나」를 나중에 답할 수 있게 한다.
   */
  it('gate-approved 이벤트가 policyHash 를 싣는다', () => {
    const root = initViaCli();
    fs.writeFileSync(path.join(root, 'a.md'), SUBSTANTIVE);
    submitGate(root, 'P0', { paths: ['a.md'], evidence: 'claimed' });
    approveGate(root, 'P0');
    const ev = readEvents(root).at(-1)!;
    expect(ev.type).toBe('gate-approved');
    expect(ev.data.policyHash).toBe(computePolicyHash(root).hash);
  });

  it('승인이 베이스라인을 재고정하지는 않는다 — 드리프트는 계속 보여야 한다', () => {
    const root = initViaCli();
    fs.writeFileSync(path.join(root, 'a.md'), SUBSTANTIVE);
    humanEditsPolicy(root, 'profile: generic\ndesign_allowed_prefixes: [""]\n');
    submitGate(root, 'P0', { paths: ['a.md'], evidence: 'claimed' });
    approveGate(root, 'P0');
    expect(runDoctor(root).warnings.join(' ')).toMatch(/정책/);
  });
});

describe('hook: 에이전트는 정책 드리프트를 스스로 승인할 수 없다', () => {
  const bash = (root: string, command: string) =>
    handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } }) as any;
  const denied = (root: string, command: string): boolean =>
    bash(root, command)?.hookSpecificOutput?.permissionDecision === 'deny';

  it('`harness doctor --accept-policy` 를 막는다', () => {
    const root = initViaCli();
    expect(denied(root, 'harness doctor --accept-policy')).toBe(true);
    expect(denied(root, './bin/harness doctor --accept-policy')).toBe(true);
    expect(denied(root, 'cd /x && harness doctor --repair --accept-policy')).toBe(true);
  });

  /**
   * 앞에 env 할당을 붙이는 것은 가장 값싼 우회다 — 그걸로 풀리면 잠금이 아니다.
   * 명령 위치 인식(HARNESS_CMD_RE)이 `phase set --force` 잠금과 **같은 한 벌**이므로
   * 여기서 막으면 그 잠금도 함께 닫힌다.
   */
  it('env 할당을 앞에 붙여도 막는다', () => {
    const root = initViaCli();
    expect(denied(root, 'HARNESS_LANG=ko harness doctor --accept-policy')).toBe(true);
    expect(denied(root, 'A=1 B=2 harness doctor --accept-policy')).toBe(true);
    expect(denied(root, 'HARNESS_LANG=ko harness phase set P7 --force')).toBe(true);
  });

  it('진단·복구는 그대로 통과한다 — 과차단 금지', () => {
    const root = initViaCli();
    for (const c of [
      'harness doctor',
      'harness doctor --repair',
      'harness doctor --repair --force',
      'harness status',
      'cat .harness/config.yaml',
      'grep design_allowed_prefixes .harness/config.yaml',
    ]) {
      expect(denied(root, c), c).toBe(false);
    }
  });

  /**
   * 개행·접두 명령·래퍼로 잠금이 풀리지 않는다 — SEC-78 이 `--force` 쪽에서 실증한 구멍이
   * 이 잠금에도 그대로 있었다(둘 다 `HARNESS_CMD_RE` 를 쓰고 있었다). 탐지는 **탐지 전용**
   * 패턴(`FORCE_ESCAPE_RE`)으로 옮겨 함께 닫았다.
   */
  it('개행·접두 명령·래퍼로도 풀리지 않는다', () => {
    const root = initViaCli();
    for (const c of [
      'cd /tmp\nharness doctor --accept-policy',
      '\nharness doctor --accept-policy',
      'env HARNESS_LANG=ko harness doctor --accept-policy',
      'sudo harness doctor --accept-policy',
      'nohup harness doctor --accept-policy',
      'bash -c "harness doctor --accept-policy"',
      '`harness doctor --accept-policy`',
      '$(harness doctor --accept-policy)',
    ]) {
      expect(denied(root, c), c).toBe(true);
    }
  });

  /**
   * **계약 변경 (출하 검증 2026-08-27 · [API-01]).**
   *
   * 예전 계약은 「인용부호 안의 언급도 막는다 — 의도된 과차단」이었고, 그 근거는
   * **「방향을 좁히면 `bash -c "..."` 가 열린다」** 였다. 그 전제가 **실측으로 반증됐다.**
   *
   * `commandLines` 는 이미 실행 단위를 환원한다 — 따옴표를 벗기고, `sh -c`·`eval`·`xargs`·
   * `find -exec` 안쪽을 풀고, `time`·`sudo`·`npx`·경로 접두를 벗긴다. 그래서 **「그 줄의
   * 머리가 하네스인가」로 좁혀도** 래퍼 형태가 열리지 않는다(아래 위 `it` 들이 그 증거다 —
   * 백틱·`$()`·`bash -c`·개행·접두 전건이 계속 deny 다).
   *
   * 반면 과차단의 값은 실측으로 컸다: 이 제품의 README·스킬·온보딩 문서가 전부 이 문구를
   * 담고 있어서, 하네스가 켜진 상태에서는 **제품이 자기 문서를 갱신할 수 없었다.** 감사
   * 세션 하나에서 아홉 번 거부됐고 결함 대장의 문장을 우회 표기로 바꿔야 했다.
   *
   * 새 계약: **실행은 막고, 기록은 막지 않는다.** 명령치환(백틱·`$()`)은 인용부호 «안»에
   * 있어도 실행이므로 계속 막힌다 — 그게 이 계약의 경계다.
   */
  it('언급은 통과하고 실행은 막힌다 — 명령치환은 인용부호 안에서도 실행이다', () => {
    const root = initViaCli();
    // 기록(문서화) — 통과해야 한다. 이걸 막으면 제품이 자기 문서를 못 고친다.
    expect(denied(root, 'echo "run harness doctor --accept-policy to re-pin" >> README.md')).toBe(false);
    expect(denied(root, 'echo "run harness phase set P7 --force" >> README.md')).toBe(false);
    expect(denied(root, 'echo "re-pin the policy baseline" >> README.md')).toBe(false);
    // 실행 — 인용부호 안이어도 명령치환은 실제로 돈다.
    expect(denied(root, 'echo `harness doctor --accept-policy`')).toBe(true);
    expect(denied(root, 'echo "`harness doctor --accept-policy`"')).toBe(true);
    expect(denied(root, 'echo $(harness phase set P7 --force)')).toBe(true);
    // 맨몸 실행은 당연히 막힌다.
    expect(denied(root, 'harness doctor --accept-policy')).toBe(true);
    expect(denied(root, 'harness phase set P7 --force')).toBe(true);
  });
});
