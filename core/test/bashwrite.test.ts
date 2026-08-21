/**
 * SEC-49·SEC-50·SEC-51·SHIP-52 회귀 테스트.
 *
 * 출하 검증 `docs/release-readiness/2026-08-21/` 이 찾은 차단 결함 2건을 **재현하는 테스트**다.
 * 위 절반(scanBashWrites)은 순수 추출을, 아래 절반(handleHook)은 실제 판정을 고정한다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanBashWrites, mentionsPath } from '../src/bashwrite';
import { initHarness, readState, writeState } from '../src/state';
import { handleHook } from '../src/hook';
import type { Phase } from '../src/types';

const setup = (phase?: Phase) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-bw-'));
  initHarness(root);
  if (phase) writeState(root, { ...readState(root), phase });
  return root;
};

const bash = (root: string, command: string) =>
  handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } }) as any;

const denied = (out: any): boolean => out?.hookSpecificOutput?.permissionDecision === 'deny';

describe('scanBashWrites: 쓰기 대상 추출', () => {
  const t = (cmd: string) => scanBashWrites(cmd).targets;

  it('리다이렉트 — 덮어쓰기·추가·따옴표', () => {
    expect(t('echo x > src/app.ts')).toContain('src/app.ts');
    expect(t("echo x >> '.harness/events.jsonl'")).toContain('.harness/events.jsonl');
    expect(t('printf "a" > "my dir/a.ts"')).toContain('my dir/a.ts');
  });

  it('heredoc 은 리다이렉트로 잡힌다', () => {
    expect(t('cat > src/app.ts <<EOF\nconst x = 1\nEOF')).toContain('src/app.ts');
  });

  it('fd 복제(2>&1·>&2)는 파일이 아니다', () => {
    expect(t('npm test 2>&1')).toEqual([]);
    expect(t('echo err >&2')).toEqual([]);
  });

  it('tee·touch·rm·truncate 는 전 인자가 대상', () => {
    expect(t('echo x | tee -a src/a.ts src/b.ts')).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts']));
    expect(t('touch src/new.ts')).toContain('src/new.ts');
    expect(t('rm -f .harness/events.jsonl')).toContain('.harness/events.jsonl');
  });

  it('sed 는 -i 일 때만 대상 (읽기 전용 sed 는 아니다)', () => {
    expect(t("sed -i '' s/a/b/ .harness/state.json")).toContain('.harness/state.json');
    expect(t('sed s/a/b/ src/app.ts')).toEqual([]);
  });

  it('cp·mv 는 목적지만, ln 은 링크 이름만', () => {
    expect(t('cp /tmp/evil.ts src/app.ts')).toEqual(['src/app.ts']);
    expect(t('mv a.txt docs/b.txt')).toEqual(['docs/b.txt']);
    expect(t('ln -s /tmp/evil src/link.ts')).toEqual(['src/link.ts']);
  });

  it('dd of=', () => {
    expect(t('dd if=/dev/zero of=src/app.ts')).toContain('src/app.ts');
  });

  it('세그먼트 분해 — 연쇄·파이프·서브셸', () => {
    expect(t('npm run build && touch src/a.ts')).toContain('src/a.ts');
    expect(t('(cd x; touch src/b.ts)')).toContain('src/b.ts');
  });

  it('읽기 전용 명령은 mutating 이 아니다', () => {
    expect(scanBashWrites('cat .harness/events.jsonl | head -3').mutating).toBe(false);
    expect(scanBashWrites('grep phase .harness/state.json').mutating).toBe(false);
  });

  it('mentionsPath 는 코어 파일 언급을 찾는다', () => {
    expect(mentionsPath('python -c "open(\'.harness/events.jsonl\',\'a\')"',
      ['.harness/state.json', '.harness/events.jsonl'])).toBe('.harness/events.jsonl');
    expect(mentionsPath('ls -la', ['.harness/state.json'])).toBeUndefined();
  });
});

describe('SEC-50: 설계 트랙 소스 쓰기가 Bash 로 우회되지 않는다', () => {
  it('리다이렉트·heredoc·touch 전부 deny', () => {
    const root = setup('P0');
    expect(denied(bash(root, 'echo "const x=1" > src/app.ts'))).toBe(true);
    expect(denied(bash(root, 'cat > src/app.ts <<EOF\nx\nEOF'))).toBe(true);
    expect(denied(bash(root, 'touch src/new.ts'))).toBe(true);
    expect(denied(bash(root, 'cp /tmp/x.ts src/app.ts'))).toBe(true);
  });

  it('구축 트랙(P8)에서는 같은 명령이 허용된다', () => {
    const root = setup('P8');
    expect(bash(root, 'echo "const x=1" > src/app.ts')).toBeNull();
  });

  it('루트 밖 쓰기(빌드 로그 등)는 설계 트랙에서도 허용 — 과차단은 하네스를 끄게 만든다', () => {
    const root = setup('P0');
    expect(bash(root, 'npx vitest run > /tmp/test-out.log')).toBeNull();
  });

  it('설계 산출물 경로는 허용', () => {
    const root = setup('P0');
    expect(bash(root, 'echo "# 스펙" > docs/spec.md')).toBeNull();
  });
});

describe('SEC-49·SEC-51: 코어 파일은 셸로도 못 바꾼다 (페이즈 무관)', () => {
  it('저널 append — 게이트 위조의 입구', () => {
    for (const phase of ['P0', 'P8'] as Phase[]) {
      const root = setup(phase);
      const out = bash(root, `echo '{"type":"gate-approved","data":{"phase":"P6"}}' >> .harness/events.jsonl`);
      expect(denied(out)).toBe(true);
    }
  });

  it('state.json 덮어쓰기·sed -i·rm', () => {
    const root = setup('P8');
    expect(denied(bash(root, 'echo x > .harness/state.json'))).toBe(true);
    expect(denied(bash(root, "sed -i '' s/P0/P7/ .harness/state.json"))).toBe(true);
    expect(denied(bash(root, 'rm .harness/events.jsonl'))).toBe(true);
  });

  it('안전망: 구문을 못 읽어도 코어 파일 + 변형 명령이면 deny', () => {
    const root = setup('P8');
    expect(denied(bash(root, `python3 -c "open('.harness/events.jsonl','a').write('x')"`))).toBe(true);
  });

  it('조회는 막지 않는다 — 디버깅까지 막으면 사람이 하네스를 끈다', () => {
    const root = setup('P8');
    expect(bash(root, 'cat .harness/events.jsonl | tail -3')).toBeNull();
    expect(bash(root, 'grep gate-approved .harness/events.jsonl')).toBeNull();
  });
});

describe('SHIP-52: --force 자기해제 경로 차단', () => {
  it('에이전트의 phase set --force 는 deny', () => {
    const root = setup('P0');
    expect(denied(bash(root, 'harness phase set P7 --force'))).toBe(true);
    expect(denied(bash(root, './bin/harness phase set P7 --force'))).toBe(true);
  });

  it('env 를 인라인으로 붙여 우회하는 것도 deny — 인라인으로 켜지면 잠금이 아니다', () => {
    const root = setup('P0');
    expect(denied(bash(root, 'HARNESS_ALLOW_FORCE=1 harness phase set P7 --force'))).toBe(true);
  });

  it('doctor --repair --force 는 페이즈 탈출구가 아니라 통과', () => {
    const root = setup('P0');
    expect(bash(root, 'harness doctor --repair --force')).toBeNull();
  });
});
