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
import { scanBashWrites, pathLikeMentions, commandLines, SHELLS_TAKING_C, isReadOnlyCommand } from '../src/bashwrite';
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

/**
 * 라운드 3-L. **여섯 번째 표기**가 나왔다 — 그리고 이번엔 처방의 방향을 바꿨다.
 * 표기를 세는 대신 **추출이 실패한 사실 자체**를 잡는다.
 */
describe('[SEC-207] 추출이 실패한 것을 「대상 없음」으로 읽지 않는다', () => {
  it('명령치환·중괄호·백틱으로 부순 경로가 전건 거부된다', () => {
    const root = setup('P0');
    for (const cmd of [
      'echo x >> $(echo .harness)/events.jsonl',
      'echo x > $(echo .harness)/state.json',
      'echo x | tee -a .harness/{events,_x}.jsonl',
      'cp /tmp/x `echo .harness`/config.yaml',
      'cp /tmp/x ${HOME}/../$(id -un)/.harness/state.json',
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('펼 수 있는 것은 펴서 본다 — 무관한 중괄호·확장은 그대로 통과', () => {
    const root = setup('P7');
    for (const cmd of ['echo x > build/{a,b}.log', 'echo x >> notes.md', 'cp /tmp/x app/config.yaml']) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });
});

describe('[SEC-208] 「복사 도구」 열거를 지운다 — 정당한 한 형태만 통과시킨다', () => {
  const install = path.resolve(__dirname, '..', '..');
  const cliJs = path.join(install, 'core', 'dist', 'cli.js');

  it('인터프리터로 프로그램을 읽어 옮기는 형태가 막힌다', () => {
    const root = setup('P0');
    for (const cmd of [
      `python3 -c "open('/tmp/x','w').write(open('${cliJs}').read())"`,
      `ruby -e 'IO.write("/tmp/y", IO.read("${cliJs}"))'`,
      `cp ${cliJs} /tmp/x.js`,
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('실행 대상으로 오는 형태는 그대로 열려 있다 — [SEC-96] 이 연 조회 경로', () => {
    const root = setup('P7');
    for (const cmd of [`node ${cliJs} status`, `cat ${cliJs}`, 'node -e "console.log(1)"']) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });
});

describe('[SEC-213] 이름을 조립해도 디렉토리는 남는다 — 일곱 번째 표기', () => {
  it('실행 시점에 조립한 이름이 보호 자리에 떨어지면 거부된다', () => {
    const root = setup('P0');
    for (const cmd of [
      'a=events; b=.jsonl; echo FORGED >> .harness/$a$b',
      'f=config.yaml; sed -i "" s/a/b/ .harness/$f',
      'a=state; echo x > .harness/$a.json',
      'd=design; echo x > .harness/$d/ledger.yaml',
      'a=app; b=.ts; echo x > src/$a$b',
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  /**
   * [QUAL-229] **이 커버리지는 행동을 고정하지, `OWNED_DIRS` 절을 고정하지는 못한다.**
   *
   * 감정자가 「`OWNED_DIRS` 뮤테이션이 생존한다」고 지적했고 그건 사실이다. 그래서 **그 절만
   * 발화하는 입력**을 찾아 봤는데 — 명령치환은 `opaqueExec` 가, 미정의 변수 형태는 경로
   * 안전망이 **먼저** 잡는다. 즉 **그 절이 실제로 짊어지는 입력을 찾지 못했다.**
   *
   * 그러면 둘 중 하나다: 아직 못 찾은 입력이 있거나, **그 절이 이미 중복이거나.**
   * 어느 쪽인지 모르는 채로 「고정했다」고 적지 않는다 — 대장 [QUAL-229] 로 열어 둔다.
   * 아래 검사는 **행동**(이 형태들이 막힌다)을 고정하며, 그것만으로도 값이 있다.
   */
  it('조립한 이름이 보호 자리에 떨어지면 막힌다 (행동 고정 — 절 고정은 아니다)', () => {
    const root = setup('P0');
    for (const cmd of [
      'echo FORGED >> .harness/$(echo events).jsonl',
      'echo x > .harness/design/$(echo ledger).yaml',
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
    // 반대 방향 — 보호 디렉토리가 아니면 같은 형태라도 통과해야 한다.
    const out = bash(setup('P7'), 'echo x > docs/$(echo notes).md');
    expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
  });

  it('보호 자리가 아니면 조립해도 막지 않는다 — 증거 폴더는 열려 있어야 한다', () => {
    const root = setup('P7');
    for (const cmd of [
      'w=wave-001; echo x > .harness/evidence/$w/shot.png',
      'echo x >> build/$NAME.log',
      'echo x >> docs/$TOPIC.md',
    ]) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });
});

describe('[EFF-214] 저널을 읽는 것은 정당하다 — 이름만으로 변형으로 보지 않는다', () => {
  it('제자리 편집이 아닌 텍스트 처리기와 백업은 통과한다', () => {
    const root = setup('P0');
    for (const cmd of [
      "sed -n '1,5p' .harness/config.yaml",
      "awk 'NR<3' .harness/events.jsonl",
      'perl -ne print .harness/config.yaml',
      'cp .harness/events.jsonl /tmp/backup.jsonl',
      'cat .harness/events.jsonl',
    ]) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });

  it('제자리 편집·프로그램 내부 쓰기는 그대로 막힌다 — 넓힌 예외가 방어를 덮지 않는다', () => {
    const root = setup('P0');
    for (const cmd of [
      'sed -i "" s/a/b/ .harness/config.yaml',
      'awk \'BEGIN{print "x" > ".harness/events.jsonl"}\' /dev/null',
      'find . -name "*.ts" -exec sed -i "" s/a/b/ {} +',
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });
});

describe('[SEC-216] 볼 수 없는 쓰기는 통과가 아니다 — 여덟 번째 표기', () => {
  it('경로를 실행 시점에 계산하는 쓰기가 거부된다', () => {
    const root = setup('P0');
    for (const cmd of [
      'p=$(echo Lmhhcm5lc3MvZXZlbnRzLmpzb25s | base64 -d); printf x >> $p',
      'p=`echo .harness/events.jsonl`; echo x >> $p',
      'echo x >> $UNKNOWN_TARGET',
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('볼 수 있는 대입은 펴서 정상 판정으로 보낸다 — 과차단을 줄이는 쪽이 먼저다', () => {
    const root = setup('P7');
    for (const cmd of ['LOG=build/out.log; echo x >> $LOG', 'O=docs/notes.md; echo x >> $O']) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });

  it('펴 보니 보호 파일이면 그대로 막힌다 — 펴는 것은 방어를 넓히지도 좁히지도 않는다', () => {
    expect(denied(bash(setup('P0'), 'D=.harness; echo x >> $D/events.jsonl'))).toBe(true);
  });
});

describe('[SEC-219] 루트 밖 스크립트를 「안 읽었다」로 통과시키지 않는다', () => {
  const outside = (body: string): string => {
    const f = path.join(os.tmpdir(), `kwh-out-${Math.floor(process.hrtime()[1])}.sh`);
    fs.writeFileSync(f, body);
    return f;
  };

  it('프로젝트 밖 스크립트가 하네스 소유 파일을 쓰면 막힌다', () => {
    const root = setup('P0');
    const f = outside('echo "{}" >> .harness/events.jsonl\n');
    try {
      for (const cmd of [`sh ${f}`, `bash ${f}`]) {
        expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
      }
    } finally { fs.rmSync(f, { force: true }); }
  });

  it('하네스를 안 건드리는 밖 스크립트는 그대로 통과한다 — 밖은 원래 소관이 아니다', () => {
    const root = setup('P0');
    const f = outside('echo hello\nmkdir -p /tmp/whatever\n');
    try {
      const out = bash(root, `sh ${f}`);
      expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
    } finally { fs.rmSync(f, { force: true }); }
  });

  it('없는 스크립트는 조용히 넘어간다 — 셸이 알아서 실패한다', () => {
    const out = bash(setup('P0'), 'sh /tmp/kwh-does-not-exist-xyz.sh');
    expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
  });
});

describe('[SEC-221] 「읽기로 분류된 쓰기 도구」 — 아홉 번째 부류', () => {
  it('쓰기 형태의 조회 도구가 코어·정책 파일에 닿지 못한다', () => {
    const root = setup('P0');
    for (const cmd of [
      "yq -i '.x=1' .harness/config.yaml",
      "awk -i inplace '{print}' .harness/config.yaml",
      'sort -o .harness/events.jsonl .harness/events.jsonl',
      "jq -i '.' .harness/state.json",
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('같은 도구의 조회 형태는 그대로 통과한다 — 플래그 의미는 도구마다 다르다', () => {
    const root = setup('P0');
    for (const cmd of [
      "yq '.x' .harness/config.yaml",
      "awk 'NR<3' .harness/events.jsonl",
      'sort .harness/events.jsonl',
      'grep -o foo .harness/config.yaml',   // `-o` 는 출력 파일이 아니다
    ]) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });

  it('모든 형태에서 조회인 것만 목록에 있다 — 쓰기 플래그가 있는 도구는 조건부다', () => {
    // 목록에 쓰기 가능한 도구가 다시 들어오면 이 검사가 깨진다.
    // 플래그는 **도구마다 다르다** — `sort -i` 는 ignore-unprintable 이라 조회다.
    for (const [cmd, label] of [
      ["yq -i '.x=1' .harness/config.yaml", 'yq -i'],
      ["jq -i '.' .harness/state.json", 'jq -i'],
      ['sort -o out .harness/events.jsonl', 'sort -o'],
      ["awk -i inplace '{print}' .harness/config.yaml", 'awk -i inplace'],
      ["sed -i '' s/a/b/ .harness/config.yaml", 'sed -i'],
    ] as const) {
      expect(isReadOnlyCommand(cmd), `${label} 를 조회로 봤다`).toBe(false);
    }
    // 반대 방향 — 같은 도구의 조회 형태는 조회로 남아야 한다.
    expect(isReadOnlyCommand('sort -i .harness/events.jsonl'), 'sort -i 는 조회다').toBe(true);
  });
});

describe('[ENG-226] 따옴표 안의 `&&` 는 분해 기준이 아니다', () => {
  it('정본의 모든 셸에서 래퍼 안쪽이 열린다 — 라벨이 빠지면 여기가 먼저 깨진다', () => {
    const root = setup('P0');
    for (const sh of SHELLS_TAKING_C) {
      const cmd = sh === 'busybox'
        ? `busybox sh -c 'cd src && echo x > app.ts'`
        : `${sh} -c 'cd src && echo x > app.ts'`;
      expect(denied(bash(root, cmd)), `안쪽을 못 열었다: ${cmd}`).toBe(true);
    }
  });

  it('따옴표 안 메타문자를 명령 연쇄로 오인하지 않는다', () => {
    const out = bash(setup('P7'), "echo 'a && b; c'");
    expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
  });
});

describe('[EFF-227] `mktemp` 관용구는 막지 않는다', () => {
  it('가장 흔한 임시파일 관용구가 통과한다', () => {
    const root = setup('P0');
    for (const cmd of ['tmpfile=$(mktemp); echo x > $tmpfile', 't=$(mktemp -d); cp /tmp/a $t/x']) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });

  it('진짜로 못 보는 것은 그대로 막힌다 — 예외가 규칙을 덮지 않는다', () => {
    const root = setup('P0');
    for (const cmd of ['p=$(base64 -d <<< Lg==); echo x >> $p', 'echo x >> $UNKNOWN_T']) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });
});
