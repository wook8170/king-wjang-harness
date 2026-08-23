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

  /**
   * [SEC-101] **`mv` 는 원본도 대상이다** — 이 테스트가 원래 「목적지만」으로 규칙을 고정하고
   * 있었고, 그 고정이 곧 구멍이었다(`mv .harness /tmp/x` 로 하네스 전체가 통과했다).
   * `cp` 는 원본을 남기므로 목적지만이 맞다 — 갈리는 지점은 **원본이 사라지는가**다.
   */
  it('cp 는 목적지만 · mv 는 원본도 · ln 은 링크 이름만', () => {
    expect(t('cp /tmp/evil.ts src/app.ts')).toEqual(['src/app.ts']);
    expect(t('mv a.txt docs/b.txt')).toEqual(['docs/b.txt', 'a.txt']);
    expect(t('mv .harness /tmp/gone')).toContain('.harness');
    expect(t('ln -s /tmp/evil src/link.ts')).toEqual(['src/link.ts']);
  });

  it('dd of=', () => {
    expect(t('dd if=/dev/zero of=src/app.ts')).toContain('src/app.ts');
  });

  it('세그먼트 분해 — 연쇄·파이프·서브셸', () => {
    expect(t('npm run build && touch src/a.ts')).toContain('src/a.ts');
    // [SEC-170] `cd` 는 대상을 바꾼다 — 서브셸 안에서 `cd x` 를 했으면 `src/b.ts` 는
    // 프로젝트의 `src/` 가 아니라 `x/src/` 다. 예전 기대값(`src/b.ts`)은 **구멍을 고정**하고
    // 있었다: 같은 규칙을 뒤집으면 `cd .harness; tee events.jsonl` 이 통과한다.
    expect(t('(cd x; touch src/b.ts)')).toContain('x/src/b.ts');
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
    // SEC-75: 게이트는 실질 내용이 있는 산출물만 받는다 — 픽스처도 실제 문서여야 한다.
    fs.writeFileSync(doc, '# Concept v1\n\nThe product turns design discipline into a '
      + 'hook-enforced pipeline, so a phase opens on approved artifacts and never on a claim. '
      + 'Success is measured as the share of projects that reach ship without bypassing a gate.\n');
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

/**
 * 「막힌 모델이 자연히 가는 다음 경로」에는 **가져와서 쓰는 것**도 있다.
 * `curl -o src/app.ts <url>` 은 리다이렉트도 아니고 알려진 쓰기 명령도 아니었지만
 * 결과는 소스 파일 생성이다 — 설계 트랙에서 참조 구현을 받아오는 것은 아주 흔한 발상이다.
 * `xargs` 는 진짜 명령을 한 겹 감싸서 같은 일을 한다.
 */
describe('bashwrite — 받아쓰기·간접 실행', () => {
  it('curl -o 의 대상', () => {
    expect(scanBashWrites('curl -o src/app.ts https://x/y').targets).toContain('src/app.ts');
  });
  it('curl --output 의 대상', () => {
    expect(scanBashWrites('curl --output src/app.ts https://x/y').targets).toContain('src/app.ts');
  });
  it('curl 은 -O(대문자, 원격 이름 사용)면 대상이 인자가 아니다', () => {
    // `curl -O <url>` 는 URL 의 파일명으로 **현재 디렉토리**에 쓴다 — 인자를 대상으로 삼으면 오탐이다.
    expect(scanBashWrites('curl -O https://x/y.ts').targets).not.toContain('https://x/y.ts');
  });
  it('wget -O 의 대상', () => {
    expect(scanBashWrites('wget -O src/app.ts https://x/y').targets).toContain('src/app.ts');
  });
  it('xargs 로 감싼 cp 의 대상', () => {
    expect(scanBashWrites('echo /tmp/x | xargs -I{} cp {} src/app.ts').targets).toContain('src/app.ts');
  });
  it('prettier --write / eslint --fix 의 대상', () => {
    expect(scanBashWrites('prettier --write src/app.ts').targets).toContain('src/app.ts');
    expect(scanBashWrites('eslint --fix src/app.ts').targets).toContain('src/app.ts');
  });
  it('쓰기 플래그 없는 포맷터·린터는 대상이 없다 (조회는 막지 않는다)', () => {
    expect(scanBashWrites('prettier --check src/app.ts').targets).toEqual([]);
    expect(scanBashWrites('eslint src/app.ts').targets).toEqual([]);
  });
});

/**
 * 「받아쓰기」 다음에는 「**풀어쓰기**」가 있다 — 패치 적용·압축 해제·동기화.
 * 전부 명령 이름만 보면 쓰기처럼 안 생겼지만 결과는 작업트리에 파일이 생기는 것이다.
 */
describe('bashwrite — 풀어쓰기(패치·압축·동기화·행 편집기)', () => {
  it('patch 의 대상 파일', () => {
    expect(scanBashWrites('patch -p1 src/app.ts < /tmp/p.diff').targets).toContain('src/app.ts');
  });
  it('ed 의 대상 파일', () => {
    expect(scanBashWrites('ed src/app.ts').targets).toContain('src/app.ts');
  });
  it('tar -C 의 전개 디렉토리', () => {
    expect(scanBashWrites('tar -x -C src -f /tmp/a.tar').targets).toContain('src');
  });
  it('unzip -d 의 전개 디렉토리', () => {
    expect(scanBashWrites('unzip /tmp/a.zip -d src').targets).toContain('src');
  });
  it('rsync 의 목적지(마지막 경로)', () => {
    expect(scanBashWrites('rsync -a /tmp/x/ src/').targets).toContain('src/');
  });
  it('>& 리다이렉트도 파일 대상이다', () => {
    expect(scanBashWrites('echo x >& src/app.ts').targets).toContain('src/app.ts');
  });
  it('fd 복제(2>&1)는 파일이 아니다 — 오탐 금지', () => {
    expect(scanBashWrites('npm test 2>&1').targets).toEqual([]);
  });
  it('git apply/am 은 작업트리를 패치한다고 표시한다', () => {
    expect(scanBashWrites('git apply /tmp/p.diff').patchesWorkingTree).toBe(true);
    expect(scanBashWrites('git am /tmp/p.mbox').patchesWorkingTree).toBe(true);
    expect(scanBashWrites('git status').patchesWorkingTree).toBe(false);
  });
});

/**
 * **위치가 경로임을 말해 주는 자리**에서는 `looksLikePath` 를 요구하면 안 된다.
 * `cp -r /tmp/x src` 의 `src` 는 슬래시도 확장자도 없어 경로 판별을 통과하지 못했다 —
 * rubric 이 명시적으로 덮는다고 한 cp/mv 규칙에 난 구멍이었다. 디렉토리 이름 하나로
 * 소스 트리를 통째로 덮어쓸 수 있으면 그건 「cp 를 막았다」가 아니다.
 */
describe('bashwrite — 목적지 위치 인자(디렉토리 이름 포함)', () => {
  it('cp 의 목적지가 디렉토리 이름이어도 잡는다', () => {
    expect(scanBashWrites('cp -r /tmp/x src').targets).toContain('src');
  });
  it('mv 의 목적지가 디렉토리 이름이어도 잡는다', () => {
    expect(scanBashWrites('mv /tmp/x src').targets).toContain('src');
  });
  it('rsync 목적지', () => {
    expect(scanBashWrites('rsync -a /tmp/x/ src').targets).toContain('src');
  });
  it('git clone 의 대상 디렉토리', () => {
    expect(scanBashWrites('git clone https://x/y src').targets).toContain('src');
  });
  it('git clone 에 대상이 없으면 URL 을 대상으로 삼지 않는다', () => {
    expect(scanBashWrites('git clone https://x/y').targets).toEqual([]);
  });
  it('sponge 의 대상', () => {
    expect(scanBashWrites('cat /tmp/x | sponge src/a.ts').targets).toContain('src/a.ts');
  });
  it('배치 모드 편집기(vim -es / ex)의 대상', () => {
    expect(scanBashWrites('vim -es -c "w" src/a.ts').targets).toContain('src/a.ts');
  });
  it('플래그는 목적지가 아니다', () => {
    expect(scanBashWrites('cp -r /tmp/x /tmp/y').targets).toEqual(['/tmp/y']);
  });
});

/**
 * [SEC-A] `git apply` 는 대상이 **패치 안**에 있어 이 스캐너가 경로를 못 뽑는다.
 * 그러나 **패치 파일 경로는 인자에 드러나 있다** — 그것을 올려 주면 호출측이 읽어
 * 다른 쓰기와 같은 잣대로 판정할 수 있다. 「감싸인 것을 꺼내 같은 스캐너로 다시」의 패치판.
 */
describe('SEC-A: 패치 파일 경로를 올린다', () => {
  it('git apply <파일> 의 패치 경로를 뽑는다', () => {
    const s = scanBashWrites('git apply forge.patch');
    expect(s.appliesPatch).toBe(true);
    expect(s.patchFiles).toEqual(['forge.patch']);
  });

  it('git am 과 플래그가 섞여도 뽑는다', () => {
    expect(scanBashWrites('git am --3way series.mbox').patchFiles).toEqual(['series.mbox']);
    expect(scanBashWrites('git apply --index --whitespace=fix a.patch').patchFiles).toEqual(['a.patch']);
  });

  it('stdin 으로 들어오면 patchFiles 가 비어 「알 수 없음」이 된다', () => {
    const piped = scanBashWrites('cat forge.patch | git apply');
    expect(piped.appliesPatch).toBe(true);
    expect(piped.patchFiles).toEqual([]);
    // `< 파일` 은 파일이 드러나 있으므로 읽어서 판정한다(연산자 `<` 는 파일이 아니다).
    const redir = scanBashWrites('git apply < forge.patch');
    expect(redir.appliesPatch).toBe(true);
    expect(redir.patchFiles).toEqual(['forge.patch']);
  });

  it('래퍼를 씌워도 재귀로 꺼낸다', () => {
    const s = scanBashWrites('sh -c "git apply forge.patch"');
    expect(s.appliesPatch).toBe(true);
    expect(s.patchFiles).toContain('forge.patch');
  });

  it('패치가 아닌 git 명령은 appliesPatch 가 아니다', () => {
    expect(scanBashWrites('git status').appliesPatch).toBe(false);
    expect(scanBashWrites('git stash pop').appliesPatch).toBe(false);
  });
});
