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
import { scanBashWrites, mentionsPath, pathLikeMentions } from '../src/bashwrite';
import { initHarness, readState, writeState } from '../src/state';
import { submitGate, approveGate, invalidateStaleGates } from '../src/gate';
import { replayState, readJournal, readJournalForReplay, appendEvent, EVENT_TYPES } from '../src/events';
import { runDoctor } from '../src/doctor';
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

describe('DET-54: 이벤트 타입 드리프트 — 무효화가 복구로 되살아나지 않는다', () => {
  it('gate-invalidated 가 재생에 반영된다 (복구가 무효화를 되돌리면 안 된다)', () => {
    const root = setup('P0');
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    const doc = path.join(root, 'docs/a.md');
    fs.writeFileSync(doc, 'v1');
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'claimed' });
    approveGate(root, 'P0');
    fs.writeFileSync(doc, 'v2');                 // 승인 후 산출물이 바뀌었다
    expect(invalidateStaleGates(root)).toContain('P0');
    expect(readState(root).gates.P0?.status).toBe('invalidated');

    // 저널만으로 재구성해도 invalidated 여야 한다 — 아니면 `doctor --repair` 가 되살린다.
    expect(replayState(readJournal(root).events).gates.P0?.status).toBe('invalidated');
    expect(replayState(readJournalForReplay(root).events).gates.P0?.status).toBe('invalidated');
  });

  it('하네스가 쓰는 이벤트 타입은 전부 doctor 가 안다 (컴파일 강제 + 실측)', () => {
    const root = setup('P0');
    for (const t of EVENT_TYPES) appendEvent(root, t, {});
    const r = runDoctor(root, {});
    expect(r.warnings.join(' ')).not.toMatch(/미지 이벤트|Unknown event/);
  });
});

/**
 * `>|` 는 noclobber(`set -o noclobber`)를 무시하는 리다이렉트다. `>` 와 같은 자리에서
 * 같은 일을 하므로 **같은 판정**을 받아야 한다 — 한 글자 차이로 설계 트랙 소스 차단이
 * 풀리면 그건 차단이 아니라 우연이다.
 */
describe('bashwrite — noclobber 무시 리다이렉트(>|)', () => {
  it('>| 대상도 쓰기 대상으로 뽑는다', () => {
    expect(scanBashWrites('echo x >| src/app.ts').targets).toContain('src/app.ts');
  });
  it('>>| 는 bash 문법이 아니므로 >> 와 같이 동작하면 된다', () => {
    expect(scanBashWrites('echo x >> src/app.ts').targets).toContain('src/app.ts');
  });
  it('공백 없는 >|파일 도 잡는다', () => {
    expect(scanBashWrites('echo x >|src/app.ts').targets).toContain('src/app.ts');
  });
});

/**
 * 대상 추출이 실패하는 변형 명령(`python -c "open('src/x.ts','w')"`, `prettier --write src/`)을
 * 위한 안전망의 재료. `.harness/` 코어 파일에는 `mentionsPath` 안전망이 이미 있었는데
 * **설계 트랙 소스에는 없어서** 같은 수법이 (b)에서는 막히고 (a)에서는 통과했다.
 * 여기서는 「명령에 등장한 경로처럼 생긴 토큰」만 뽑는다 — 판정은 호출측(judgeWritePath)이 한다.
 */
describe('bashwrite — pathLikeMentions (변형 명령 안전망 재료)', () => {
  it('따옴표 안의 경로도 뽑는다', () => {
    expect(pathLikeMentions(`python3 -c "open('src/i.ts','w')"`)).toContain('src/i.ts');
  });
  it('평범한 인자 경로도 뽑는다', () => {
    expect(pathLikeMentions('prettier --write src/app.ts')).toContain('src/app.ts');
  });
  it('플래그는 경로가 아니다', () => {
    expect(pathLikeMentions('eslint --fix --max-warnings=0')).toEqual([]);
  });
  it('슬래시 없는 낱말은 뽑지 않는다 (오탐 방지)', () => {
    expect(pathLikeMentions('npm test')).toEqual([]);
  });
  it('중복은 한 번만', () => {
    expect(pathLikeMentions('cp src/a.ts src/a.ts').filter(t => t === 'src/a.ts')).toHaveLength(1);
  });
});
