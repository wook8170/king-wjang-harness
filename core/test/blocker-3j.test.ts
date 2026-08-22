/**
 * 라운드 3-J BLOCKER 회귀 테스트 — [SEC-170] `cd` 정규화.
 *
 * **이번 뿌리는 열거가 아니라 정규화다.** 지난 네 번(`SEC-49`→`SEC-A`→`SEC-100`→`SEC-135`)은
 * 빠진 **도구 이름**이 통로였고 처방은 부류를 넓히는 것이었다. 이번에는 도구가 이미 잡혀 있는데
 * **같은 파일이 다른 이름으로 불렸다**:
 *
 *   `tee .harness/events.jsonl`         → DENY
 *   `cd .harness && tee events.jsonl`   → 통과   ← 같은 파일이다
 *
 * 그래서 도구를 더 열거해도 닫히지 않는다. 판정 **전에** 대상을 가상 cwd 기준으로 정규화한다.
 *
 * 그리고 [SEC-135] 회귀 테스트가 이 변종을 놓친 이유도 함께 못 박는다 —
 * 그 테스트는 **슬래시 있는 형태만** 검사했다. 한 형태를 고정한 테스트는 부류를 못 잡는다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanBashWrites, pathLikeMentions, commandLines, SHELLS_TAKING_C } from '../src/bashwrite';
import { initHarness, readState, writeState } from '../src/state';
import { handleHook } from '../src/hook';
import type { Phase } from '../src/types';

const setup = (phase?: Phase) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-3j-'));
  initHarness(root);
  if (phase) writeState(root, { ...readState(root), phase });
  return root;
};
const bash = (root: string, command: string) =>
  handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } }) as any;
const denied = (out: any): boolean => out?.hookSpecificOutput?.permissionDecision === 'deny';
const reason = (out: any): string => out?.hookSpecificOutput?.permissionDecisionReason ?? '';

describe('[SEC-170] `cd` 뒤의 상대경로도 같은 파일이다', () => {
  it('대상이 가상 cwd 기준으로 정규화된다', () => {
    expect(scanBashWrites('cd .harness && tee events.jsonl').targets).toContain('.harness/events.jsonl');
    expect(scanBashWrites('cd src && touch app.ts').targets).toContain('src/app.ts');
    expect(scanBashWrites('cd .harness && echo x > state.json').targets).toContain('.harness/state.json');
    // `..` 는 접힌다 — 같은 파일이 두 이름을 갖지 않게.
    expect(scanBashWrites('cd .harness && tee ../src/app.ts').targets).toContain('src/app.ts');
    // 여러 번 옮겨도 따라간다.
    expect(scanBashWrites('cd .harness && cd design && tee ledger.yaml').targets)
      .toContain('.harness/design/ledger.yaml');
  });

  it('안전망(pathLikeMentions)도 `cd` 안에서는 낱말을 경로로 본다', () => {
    // 열거 밖 도구는 대상 추출이 안 되고 이 안전망이 유일한 방어다.
    expect(pathLikeMentions('cd src && xxd -r -p payload.hex app.ts')).toContain('src/app.ts');
    expect(pathLikeMentions('cd .harness && xxd -r -p ../p.hex state.json')).toContain('.harness/state.json');
  });

  it('루트에서는 낱말을 경로로 보지 않는다 — 안전망은 조용해야 쓸모가 있다', () => {
    // `cd` 가 없으면 확장자 낱말은 커밋 메시지·로그 문구일 수 있다. 오탐이 폭증하면
    // 사람이 하네스를 꺼버리고, 그 순간 방어는 0 이 된다.
    expect(pathLikeMentions('git commit -m "fix app.ts"')).not.toContain('app.ts');
  });

  it('절대경로는 cwd 와 무관하다', () => {
    expect(scanBashWrites('cd src && tee /tmp/out.txt').targets).toContain('/tmp/out.txt');
  });
});

describe('[SEC-170] 제품 표면 — 무장해제 사슬이 끊긴다', () => {
  const vectors = [
    'cd src && xxd -r -p payload.hex app.ts',
    'cd .harness && xxd -r -p ../p7.hex state.json',
    'cd .harness && xxd -r -p ../c.hex config.yaml',
    'cd .harness && tee events.jsonl < ../x',
    'cd .harness && echo x >> events.jsonl',
    'cd .harness/design && tee ledger.yaml < /tmp/x',
    '(cd .harness; touch state.json)',
    'cd src && cp /tmp/x app.ts',
    'cd src && sed -i s/a/b/ app.ts',
  ];

  it('설계 트랙에서 전건 거부된다', () => {
    const root = setup('P0');
    for (const cmd of vectors) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('변수로 감싼 `cd` 도 하네스 소유 파일 이름은 막는다 — 한 줄로 되살아나면 안 된다', () => {
    const root = setup('P0');
    // `cd` 대상을 정적으로 못 읽으므로 경로로는 판정할 수 없다. 그래도 **이름**은 보인다.
    for (const cmd of [
      'cd $D && tee events.jsonl',
      'cd "$(pwd)/.harness" && tee state.json',
      'cd ~/proj/.harness && echo x > config.yaml',
    ]) {
      const out = bash(root, cmd);
      expect(denied(out), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('구축 트랙에서도 하네스 소유 파일은 막힌다 — 페이즈로 열리는 문이 아니다', () => {
    const root = setup('P7');
    expect(denied(bash(root, 'cd .harness && tee events.jsonl < /tmp/x'))).toBe(true);
    expect(denied(bash(root, 'cd .harness && xxd -r -p /tmp/c.hex config.yaml'))).toBe(true);
  });

  it('거부 사유가 원인을 정확히 말한다', () => {
    const root = setup('P0');
    expect(reason(bash(root, 'cd .harness && tee events.jsonl'))).toMatch(/events\.jsonl/);
  });
});

describe('[SEC-170] 반대 방향 — 과차단 0', () => {
  it('`cd` 뒤 정상 작업은 그대로 통과한다', () => {
    const root = setup('P0');
    for (const cmd of [
      'cd docs && cat notes.md',
      'cd docs && grep -n "app.ts" notes.md',
      'cd src && ls',
      'cd /tmp && tee scratch.txt',            // 프로젝트 밖 — 하네스 소관이 아니다
      'cd build && rm -rf artifacts.tar',      // 프로젝트 안이지만 소스·코어가 아니다
      'cd docs && touch design-notes.md',      // 설계 트랙에서 문서 쓰기는 정상이다
    ]) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });

  it('구축 트랙에서 `cd` 뒤 소스 작업이 열린다', () => {
    const root = setup('P7');
    for (const cmd of ['cd src && touch app.ts', 'cd src && sed -i s/a/b/ app.ts']) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });

  it('동적 `cd` 라도 하네스 소유 파일 이름이 아니면 막지 않는다 — 문은 가장 좁게', () => {
    const root = setup('P7');
    const out = bash(root, 'cd $BUILD && tee output.txt');
    expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
  });
});

describe('[SEC-175] 깊이 캡도 fail-closed — 형제 캡을 하나만 고치면 되살아난다', () => {
  const chain = (root: string, n: number, tail: string): void => {
    // a.sh → b.sh → … → 마지막이 저널을 쓴다. 「한 겹 더」로 방어가 풀리면 안 된다.
    for (let i = 0; i < n - 1; i++) {
      fs.writeFileSync(path.join(root, `s${i}.sh`), `sh s${i + 1}.sh\n`);
    }
    fs.writeFileSync(path.join(root, `s${n - 1}.sh`), tail);
  };

  it('4겹째 스크립트의 저널 쓰기가 통과하지 않는다', () => {
    const root = setup('P0');
    chain(root, 4, 'echo \'{"type":"gate-approved"}\' >> .harness/events.jsonl\n');
    const out = bash(root, 'sh s0.sh');
    expect(denied(out), '4겹 사슬이 통과했다').toBe(true);
    // 사유가 크기 캡과 섞이면 사람이 엉뚱한 것을 고친다.
    expect(reason(out)).toMatch(/겹|levels|deep/);
  });

  it('상한 안쪽 사슬은 본문 판정을 그대로 받는다 — 깊이 캡이 방어를 대신하지 않는다', () => {
    const root = setup('P0');
    chain(root, 3, 'echo \'{"type":"gate-approved"}\' >> .harness/events.jsonl\n');
    const out = bash(root, 'sh s0.sh');
    expect(denied(out)).toBe(true);
    expect(reason(out)).toMatch(/events\.jsonl/);
  });

  it('깊은 사슬은 내용과 무관하게 사실을 말한다 — 안 읽은 것은 통과가 아니다', () => {
    const root = setup('P7');
    chain(root, 4, 'echo hello\n');
    const out = bash(root, 'sh s0.sh');
    // 마지막 단계를 못 읽었으므로 여전히 사실을 말한다. 그것이 fail-closed 의 값이다.
    expect(denied(out)).toBe(true);
    expect(reason(out)).toMatch(/겹|levels|deep/);
  });
});

/**
 * 라운드 3-K BLOCKER 2건. **둘 다 「이름으로 세는 방어」의 실패다.**
 * [SEC-194] 는 파일 이름을, [SEC-195] 는 프로그램 이름을 세고 있었다 —
 * 세는 방어는 언제나 안 센 이름을 남긴다.
 */
describe('[SEC-194] 글롭도 리터럴과 같은 파일을 지목한다', () => {
  const vectors = [
    'printf x >> .harness/e*.jsonl',
    'cp /tmp/badcfg .har*/config.yaml',
    'tee .harness/*.jsonl',
    'cp /tmp/x .harness/design/l*.yaml',
    'cd .harness && tee e*.jsonl',
    'mv /tmp/x .harness/state.jso?',
  ];

  it('보호 파일에 맞는 글롭은 전건 거부된다', () => {
    const root = setup('P0');
    for (const cmd of vectors) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('페이즈와 무관하게 막힌다 — 구축 트랙에서도 저널은 하네스 것이다', () => {
    const root = setup('P7');
    expect(denied(bash(root, 'printf x >> .harness/e*.jsonl'))).toBe(true);
  });

  it('보호 파일에 안 맞는 글롭은 그대로 통과한다 — 과차단은 구조적으로 없다', () => {
    const root = setup('P0');
    for (const cmd of ['cp /tmp/x docs/*.md', 'rm -f build/*.tar', 'grep -rn foo docs/*.md']) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });

  it('거부 사유가 어느 파일에 맞는지 말한다', () => {
    expect(reason(bash(setup('P0'), 'printf x >> .harness/e*.jsonl'))).toMatch(/events\.jsonl/);
  });
});

describe('[SEC-195] 판정기의 프로그램은 피판정자가 복제할 수 없다', () => {
  const install = path.resolve(__dirname, '..', '..');
  const cliJs = path.join(install, 'core', 'dist', 'cli.js');

  it('하네스 프로그램을 복사·리다이렉트로 빼돌리지 못한다', () => {
    const root = setup('P0');
    for (const cmd of [
      `cp ${cliJs} /tmp/x.js`,
      `cp ${path.join(install, 'bin', 'harness')} /tmp/h`,
      `cat ${cliJs} > /tmp/y.js`,
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('읽기는 막지 않는다 — 문제는 사본을 만드는 것이다', () => {
    const out = bash(setup('P0'), `cat ${cliJs}`);
    expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
  });

  it('무관한 복사는 그대로 통과한다', () => {
    const out = bash(setup('P7'), 'cp /tmp/a.js /tmp/b.js');
    expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
  });
});

describe('[SEC-198] 변수는 `cd` 에만 붙지 않는다 — 대상 자체의 변수도 미해결이다', () => {
  it('경로에 변수가 들어간 코어·정책 쓰기가 막힌다', () => {
    const root = setup('P0');
    for (const cmd of [
      'D=.harness; echo x >> $D/events.jsonl',
      'D=.harness; cp /tmp/x $D/config.yaml',
      'echo x >> ${D}/events.jsonl',
      'P=$(pwd); tee $P/.harness/state.json',
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('하네스 소유 이름이 아니면 변수 경로도 막지 않는다 — 문은 가장 좁게', () => {
    const root = setup('P7');
    for (const cmd of ['echo x >> build/$NAME.log', 'cp /tmp/x $HOME/notes.md']) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });
});

describe('[ENG-199] 셸 목록이 한 벌이다 — 두 벌이면 느슨한 쪽이 정본이 된다', () => {
  it('꺼내기가 모르는 셸로 배포 차단을 우회할 수 없다', () => {
    const root = setup('P0');
    for (const cmd of [
      "fish -c 'npm publish'", "ash -c 'npm publish'",
      "busybox sh -c 'npm publish'", "sh -c 'npm publish'",
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('감싼 것이 배포가 아니면 그대로 통과한다', () => {
    const out = bash(setup('P7'), "sh -c 'npm test'");
    expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
  });

  it('두 목록이 같은 정본을 쓴다 — 드리프트를 구조로 막는다', () => {
    // 목록이 갈리면 「볼 수 없는 실행」과 「감싼 것 꺼내기」가 다른 셸 집합을 본다.
    for (const sh of SHELLS_TAKING_C) {
      expect(commandLines(`${sh} -c 'npm publish'`), `${sh} 안쪽을 못 꺼낸다`)
        .toContain('npm publish');
    }
  });
});
