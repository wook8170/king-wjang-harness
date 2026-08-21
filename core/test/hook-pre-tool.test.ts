import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState, writeState } from '../src/state';
import { handleHook } from '../src/hook';
import type { Phase } from '../src/types';

const setup = (phase?: Phase) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  if (phase) writeState(root, { ...readState(root), phase });
  return root;
};

const write = (root: string, p: string) => handleHook(root, 'pre-tool', {
  tool_name: 'Write', tool_input: { file_path: path.join(root, p) },
}) as any;

describe('hook: pre-tool 차단 매트릭스 (잔여)', () => {
  it('설계 페이즈: docs/와 루트 md는 허용', () => {
    const root = setup('P3');
    expect(write(root, 'docs/노트.md')).toBeNull();
    expect(write(root, 'progress.md')).toBeNull();
  });

  it('설계 페이즈: 배포성 Bash 차단', () => {
    const out = handleHook(setup('P0'), 'pre-tool', {
      tool_name: 'Bash', tool_input: { command: 'docker push registry/app:1' },
    }) as any;
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('설계 페이즈: 일반 Bash(테스트 실행 등)는 허용', () => {
    expect(handleHook(setup('P0'), 'pre-tool', {
      tool_name: 'Bash', tool_input: { command: 'npx vitest run' },
    })).toBeNull();
  });

  it('구축 페이즈(P8): 소스 쓰기 허용', () => {
    expect(write(setup('P8'), 'src/index.ts')).toBeNull();
  });

  it('구축 페이즈: 설계 문서 직접 수정 차단 + backtrack 안내', () => {
    const out = write(setup('P8'), '.harness/design/03-feature.md');
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/backtrack/);
  });

  it('구축 페이즈 + backtrack 중이면 설계 문서 수정 허용', () => {
    const root = setup('P8');
    writeState(root, { ...readState(root), backtrack: { to: 'P3', reason: '스키마 결함' } });
    expect(write(root, '.harness/design/03-feature.md')).toBeNull();
  });

  it('읽기 도구(Read)는 어느 페이즈든 무간섭', () => {
    expect(handleHook(setup('P0'), 'pre-tool', {
      tool_name: 'Read', tool_input: { file_path: '/x/src/a.ts' },
    })).toBeNull();
  });

  it('출하 페이즈(P11)도 설계 문서 직접 수정은 차단된다', () => {
    const out = write(setup('P11'), '.harness/design/00-concept.md');
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

/**
 * [SEC-69] **판정기의 정책이 피판정자의 쓰기 영역 안에 있으면 그건 판정이 아니다.**
 *
 * 설계 트랙 차단은 `.harness/config.yaml` 의 `design_allowed_prefixes` **allow-list** 로 한다.
 * 그 파일이 쓰기 허용이었으므로 빈 문자열 접두사 한 줄이면 모든 경로에 매치돼 강제가 통째로
 * 꺼졌고, `doctor` 도 깨끗하다고 답했다 — 사후 탐지조차 안 됐다.
 *
 * 개별 우회 경로를 하나 더 막는 문제가 아니라 **신뢰 경계**의 문제라, 정책 파일을 코어 파일과
 * 같은 등급으로 올린다: 직접 쓰기는 막고 변경은 harness 명령을 거친다.
 */
describe('pre-tool: 정책 파일 자기 무장해제 차단 (SEC-69)', () => {
  const denied = (root: string, payload: object): boolean => {
    const out = handleHook(root, 'pre-tool', payload as any) as any;
    return out?.hookSpecificOutput?.permissionDecision === 'deny';
  };

  it('Write 로 config.yaml 을 직접 못 고친다', () => {
    const root = setup();
    expect(denied(root, { tool_name: 'Write', tool_input: { file_path: path.join(root, '.harness/config.yaml') } })).toBe(true);
  });

  it('셸 리다이렉트로도 못 고친다', () => {
    const root = setup();
    expect(denied(root, { tool_name: 'Bash', tool_input: { command: 'echo x > .harness/config.yaml' } })).toBe(true);
  });

  it('프로젝트 로컬 프로파일도 정책이므로 같은 보호를 받는다', () => {
    const root = setup();
    expect(denied(root, { tool_name: 'Write', tool_input: { file_path: path.join(root, '.harness/profile/profile.yaml') } })).toBe(true);
    expect(denied(root, { tool_name: 'Bash', tool_input: { command: 'echo x > .harness/profile/commands.yaml' } })).toBe(true);
  });

  it('설계 산출물은 그대로 쓸 수 있다 — 과차단 금지', () => {
    const root = setup();
    expect(denied(root, { tool_name: 'Write', tool_input: { file_path: path.join(root, '.harness/design/x.md') } })).toBe(false);
    expect(denied(root, { tool_name: 'Write', tool_input: { file_path: path.join(root, '.harness/packets/P0.md') } })).toBe(false);
  });
});

/**
 * [SEC-70] 스펙 §4-2 매트릭스 **2·3행이 통째로 미구현**이었다. 13페이즈 중 P7~P12 여섯 개에
 * 강제가 하나도 없어서, 「Design→Build→Ship 물리 강제」가 실측상 설계 트랙 경로
 * 화이트리스트 하나로 축소돼 있었다.
 *
 * | 페이즈 | 스펙이 요구하는 차단 |
 * |---|---|
 * | P7~P9 | 설계 문서 직접 수정(backtrack 없이) · 배포 명령 · 동결 경로 |
 * | P10~P12 | 신규 기능 코드 · 게이트 미승인 배포 |
 */
describe('pre-tool: 구축·출하 트랙 강제 (SEC-70, 스펙 §4-2 2·3행)', () => {
  const at = (phase: Phase) => setup(phase);
  const deniedOn = (root: string, payload: object): boolean => {
    const out = handleHook(root, 'pre-tool', payload as any) as any;
    return out?.hookSpecificOutput?.permissionDecision === 'deny';
  };
  const bash = (root: string, command: string) => deniedOn(root, { tool_name: 'Bash', tool_input: { command } });
  const writeAt = (root: string, p: string) =>
    deniedOn(root, { tool_name: 'Write', tool_input: { file_path: path.join(root, p) } });

  describe('P7~P9 (구축)', () => {
    it('배포 명령을 막는다', () => {
      const root = at('P8');
      expect(bash(root, 'vercel deploy')).toBe(true);
      expect(bash(root, 'docker push registry/app:1')).toBe(true);
    });
    it('설계 문서 직접 수정을 막는다 — backtrack 이 정식 경로', () => {
      expect(writeAt(at('P8'), '.harness/design/spec.md')).toBe(true);
    });
    it('backtrack 중이면 설계 문서를 고칠 수 있다', () => {
      const root = at('P8');
      writeState(root, { ...readState(root), backtrack: { from: 'P8', to: 'P4', reason: 'r', at: 't' } as any });
      expect(writeAt(root, '.harness/design/spec.md')).toBe(false);
    });
    it('소스·테스트는 그대로 쓸 수 있다 — 구축 트랙의 본업', () => {
      const root = at('P8');
      expect(writeAt(root, 'src/app.ts')).toBe(false);
      expect(writeAt(root, 'test/app.test.ts')).toBe(false);
      expect(bash(root, 'npm test')).toBe(false);
    });
  });

  describe('P10~P12 (출하)', () => {
    it('신규 기능 코드를 막는다 — 없던 파일을 새로 만드는 것', () => {
      expect(writeAt(at('P11'), 'src/brand-new.ts')).toBe(true);
    });
    it('이미 있는 파일 수정은 허용한다 — 결함 대장 항목 수정이 출하 트랙의 본업', () => {
      const root = at('P11');
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src/existing.ts'), 'x\n');
      expect(writeAt(root, 'src/existing.ts')).toBe(false);
    });
    it('게이트 미승인 배포를 막는다', () => {
      expect(bash(at('P11'), 'vercel deploy')).toBe(true);
    });
    it('현재 페이즈 게이트가 승인되면 배포를 허용한다', () => {
      const root = at('P11');
      const st = readState(root);
      writeState(root, { ...st, gates: { ...st.gates, P11: { status: 'approved', evidence: 'measured' } as any } });
      expect(bash(root, 'vercel deploy')).toBe(false);
    });
  });
});

/**
 * 스펙 §4-2 **1행** 「P0~P6 차단: 소스 Write/Edit 전부, **빌드·배포 명령**」에서 배포 목록이
 * 리터럴 5개(docker push · kubectl apply · vercel/netlify/fly deploy)뿐이라 실제 배포 명령이
 * 그대로 통과했고, **빌드 명령 차단은 아예 없었다**.
 */
describe('pre-tool: 설계 트랙 빌드·배포 명령 (스펙 §4-2 1행)', () => {
  const bashDenied = (root: string, command: string): boolean => {
    const out = handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } } as any) as any;
    return out?.hookSpecificOutput?.permissionDecision === 'deny';
  };

  it('패키지 배포 명령을 막는다', () => {
    const root = setup('P2');
    for (const c of ['npm publish', 'pnpm publish', 'cargo publish', 'twine upload dist/*']) {
      expect(bashDenied(root, c), c).toBe(true);
    }
  });

  it('인프라 배포 명령을 막는다', () => {
    const root = setup('P2');
    for (const c of ['terraform apply', 'helm upgrade x ./c', 'wrangler deploy', 'serverless deploy']) {
      expect(bashDenied(root, c), c).toBe(true);
    }
  });

  it('프로파일이 정의한 빌드 명령을 막는다 — 구현 전이라 빌드할 것이 없다', () => {
    const root = setup('P2');
    fs.mkdirSync(path.join(root, '.harness/profile'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness/profile/profile.yaml'),
      'name: t\ndescription: t\nsource_globs: [src/**]\ndeploy_commands: []\ndesign_system_roots: []\n');
    fs.writeFileSync(path.join(root, '.harness/profile/commands.yaml'), 'build: npm run build\ntest: npm test\n');
    expect(bashDenied(root, 'npm run build')).toBe(true);
    expect(bashDenied(root, 'npm test')).toBe(false); // 테스트는 리서치의 일부라 막지 않는다
  });

  it('구축 트랙에서는 빌드가 본업이라 통과한다', () => {
    const root = setup('P8');
    fs.mkdirSync(path.join(root, '.harness/profile'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness/profile/profile.yaml'),
      'name: t\ndescription: t\nsource_globs: [src/**]\ndeploy_commands: []\ndesign_system_roots: []\n');
    fs.writeFileSync(path.join(root, '.harness/profile/commands.yaml'), 'build: npm run build\n');
    expect(bashDenied(root, 'npm run build')).toBe(false);
  });

  it('흔한 조회·개발 명령은 막지 않는다 — 과차단 금지', () => {
    const root = setup('P2');
    for (const c of ['git status', 'npm ls', 'git push origin feature', 'cat README.md']) {
      expect(bashDenied(root, c), c).toBe(false);
    }
  });
});

/**
 * 자기호출 인식 정규식(`HARNESS_CMD_RE`)이 **개행과 흔한 접두 명령을 안 봤다.**
 * `cd /tmp\nharness phase set P7 --force` 는 훅을 그냥 통과했다.
 *
 * 실제 피해는 방어 심층 덕에 막혔다 — CLI 의 `HARNESS_ALLOW_FORCE` 게이트가 2차로 거부한다.
 * 그래도 고치는 이유: **두 겹이 다 살아 있어야 방어 심층이다.** 한 겹이 이미 뚫려 있으면
 * 다른 한 겹에 실수가 생기는 순간 그대로 열린다. 그리고 같은 정규식을 쓰는 새 잠금
 * (`doctor --accept-policy` 같은)은 2차 방어선이 없을 수 있다.
 *
 * 같은 이유로 stop 가드의 자기호출 제외도 이 정규식을 쓴다 — 개행 한 줄로 턴 전체가
 * 활동 집계에서 빠지면 정산 강제가 조용히 풀린다.
 */
describe('pre-tool: 자기호출 인식이 개행·접두 명령에 뚫리지 않는다', () => {
  const bashDenied = (root: string, command: string): boolean => {
    const out = handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } } as any) as any;
    return out?.hookSpecificOutput?.permissionDecision === 'deny';
  };

  const FORCE = 'harness phase set P7 --force';
  for (const [label, cmd] of [
    ['평문', FORCE],
    ['개행 접두', `cd /tmp\n${FORCE}`],
    ['선행 개행', `\n${FORCE}`],
    ['env 접두', `env FOO=1 ${FORCE}`],
    ['sudo 접두', `sudo ${FORCE}`],
    ['nohup 접두', `nohup ${FORCE}`],
    ['time 접두', `time ${FORCE}`],
    ['백틱 안', `echo \`${FORCE}\``],
    ['$() 안', `echo $(${FORCE})`],
    ['bash -c 래퍼', `bash -c "${FORCE}"`],
    ['절대경로 + 개행', `cd /tmp\n/abs/bin/${FORCE}`],
  ] as const) {
    it(`${label} 형태를 막는다`, () => {
      expect(bashDenied(setup('P0'), cmd)).toBe(true);
    });
  }

  it('과차단 금지 — harness 를 언급만 하는 명령은 통과한다', () => {
    const root = setup('P0');
    for (const c of [
      'git commit -m "harness 도입"',
      'cat README.md | grep harness',
      'echo "phase set --force 는 쓰지 마라" >> notes.md',
      'ls harness-notes/',
    ]) {
      expect(bashDenied(root, c), c).toBe(false);
    }
  });
});
