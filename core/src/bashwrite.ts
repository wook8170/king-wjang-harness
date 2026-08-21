/**
 * Bash 명령 문자열에서 **쓰기 대상 경로**를 추출한다 (SEC-49·SEC-50·SEC-51).
 *
 * 왜 필요한가 — 출하 검증 `docs/release-readiness/2026-08-21/06-security.md` (e) 절:
 * 훅이 `Write`/`Edit` 는 막으면서 `echo x > src/app.ts` 는 통과시켰다. 그 결과
 * ① 설계 트랙 소스 금지가 리다이렉트 한 줄로 풀리고
 * ② `echo '{"type":"phase-set",...}' >> .harness/events.jsonl` + `doctor --repair` 로
 *    **사람 승인 없이 게이트가 approved** 가 됐다.
 * 이건 「우회하려는 자」가 아니라 **막힌 모델이 자연히 가는 다음 경로**다 — deny 메시지가
 * 직접 그리로 민다. 그래서 범위 밖이 아니라 **누락**이고, 닫아야 한다.
 *
 * **완전 파싱은 불가능하다** — `$(printf ...)`·변수·`eval`·base64 는 정적으로 못 잡는다.
 * 목표는 방탄이 아니라 **모델이 자연히 쓰는 표현을 전부 덮는 것**이다(하네스의 계약은
 * "보안 경계"가 아니라 "사고 방지"다). 그래서 두 겹으로 간다:
 *   (1) 쓰기 구문에서 대상을 추출해 **Write 와 똑같은 판정 함수**로 보낸다(규칙 복제 금지).
 *   (2) 코어 파일 이름이 변형 명령과 함께 등장하면, 대상 추출에 실패해도 막는다(`mentionsCore`).
 *
 * 이 파일은 순수 함수만 둔다 — fs·경로 해석을 하지 않는다. 경로의 의미(루트 안팎·허용 목록)는
 * 호출측 `hook.ts` 가 Write 경로와 **공유하는 한 벌의 규칙**으로 판정한다.
 */

/** 셸 메타문자로 명령을 쪼갠다. 파이프·연쇄·서브셸·개행 전부 새 명령의 시작이다. */
const SEGMENT_SPLIT = /(?:\|\||&&|[;|&\n()])/;

/**
 * 변형(mutating) 가능성이 있는 명령·연산자. 안전망 (2) 의 발화 조건이다.
 * 여기 없는 순수 조회(`cat`·`grep`·`head`)만으로는 코어 파일을 언급해도 막지 않는다 —
 * 디버깅으로 저널을 읽는 것은 정당하고, 그것까지 막으면 사람이 하네스를 꺼버린다.
 */
const MUTATING_TOKENS = [
  '>', '>>', 'tee', 'touch', 'sed', 'rm', 'mv', 'cp', 'dd', 'truncate', 'install',
  'ln', 'chmod', 'chown', 'python', 'python3', 'node', 'perl', 'ruby', 'awk', 'eval',
];

/** 따옴표를 존중하는 토크나이저. 이스케이프는 다루지 않는다(모델이 쓰는 표현 범위). */
function tokenize(segment: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const isFlag = (t: string): boolean => t.startsWith('-');

/** 경로처럼 보이는 토큰만 후보로 본다 — `sed` 의 스크립트 인자를 파일로 오인하지 않게. */
const looksLikePath = (t: string): boolean =>
  t !== '' && !isFlag(t) && !/^[a-z]+=/.test(t) && (t.includes('/') || /\.[A-Za-z0-9]+$/.test(t));

/**
 * **접두 명령** — 뒤에 오는 진짜 명령을 감싸기만 하는 것들. 독립 감정이 실증한 구멍의
 * 원인이다: `sudo tee src/app.ts` 는 명령 이름이 `sudo` 로 잡혀 `tee` 규칙을 타지 않았고,
 * 그래서 **소스·코어·정책 파일 쓰기가 전 페이즈에서 열렸다**(`sudo tee .harness/events.jsonl`
 * 까지 ALLOW). 리다이렉트(`sudo echo x > f`)는 원문 스캔이 따로 잡아 막혀 있었기 때문에
 * 「접두를 붙이면 열린다」가 명령 계열에서만 조용히 성립했다.
 *
 * 값을 받는 플래그를 함께 건너뛰는 이유는 `xargs` 와 같다 — `nice -n 10 cp a b` 에서 `10` 을
 * 명령으로 오인하면 엉뚱한 것을 판정한다. `timeout 5 cp a b` 처럼 **숫자 인자**를 받는 것도 있다.
 */
export const PREFIX_COMMANDS = new Set([
  'sudo', 'doas', 'env', 'nohup', 'time', 'command', 'exec', 'nice', 'ionice',
  'stdbuf', 'setsid', 'timeout', 'unbuffer', 'script', 'proxychains', 'chroot',
]);

/** 접두 명령이 값으로 받는 플래그. 여기 없는 플래그는 값을 안 받는 것으로 본다. */
const PREFIX_FLAG_TAKES_VALUE = new Set([
  '-u', '-g', '-n', '-C', '-S', '-k', '-i', '-o', '--user', '--group', '--chdir',
  '--signal', '--kill-after', '--adjustment',
]);

/**
 * 명령 이름에서 경로·env 접두·**접두 명령**을 벗긴다 (`sudo -u x /usr/bin/tee` → `tee`).
 * 벗기다가 남는 것이 없으면 이름은 빈 문자열이다 — 그건 판정 대상이 아니다.
 */
function commandName(tokens: string[]): { name: string; args: string[] } {
  let i = 0;
  for (;;) {
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;   // env 대입
    const head = (tokens[i] ?? '').split('/').pop() ?? '';
    if (!PREFIX_COMMANDS.has(head)) break;
    i++;                                                                           // 접두 명령 자체
    while (i < tokens.length) {                                                    // 그 플래그·값
      const t = tokens[i];
      if (isFlag(t)) {
        i += PREFIX_FLAG_TAKES_VALUE.has(t) && i + 1 < tokens.length && !isFlag(tokens[i + 1]) ? 2 : 1;
        continue;
      }
      if (/^\d+(\.\d+)?[smhd]?$/.test(t)) { i++; continue; }                       // `timeout 5`
      break;
    }
  }
  const raw = tokens[i] ?? '';
  return { name: raw.split('/').pop() ?? '', args: tokens.slice(i + 1) };
}

export interface BashWriteScan {
  /**
   * 패치·머지가 **작업트리 어디에 쓸지 명령만 봐서는 알 수 없는** 경우(`git apply <diff>`).
   * 대상이 패치 파일 안에 있어 정적으로 못 뽑는다 — 그래서 경로가 아니라 **사실**을 올린다.
   * 설계 트랙에서는 이것만으로 차단 사유가 된다(구현이 금지된 구간이므로).
   */
  patchesWorkingTree: boolean;
  /** 추출된 쓰기 대상 경로(따옴표 제거, 원문 그대로 — 해석은 호출측). */
  targets: string[];
  /** 변형 명령·연산자가 하나라도 있었는가. 안전망 (2) 의 조건. */
  mutating: boolean;
}

/**
 * 리다이렉트 대상을 뽑는다. `2>&1`·`>&2` 같은 **fd 복제는 파일이 아니다** — `&` 로 시작하는
 * 대상을 걸러내지 않으면 `2>&1` 이 `1` 이라는 파일로 잡혀 오탐이 된다.
 */
function redirectTargets(segment: string): string[] {
  const out: string[] = [];
  // `>|` 는 noclobber 를 무시하는 리다이렉트다 — `>` 와 같은 자리에서 같은 일을 하므로
  // 같은 판정을 받아야 한다. 한 글자 차이로 차단이 풀리면 그건 차단이 아니라 우연이다.
  // `>&` 는 두 얼굴이다: `2>&1` 은 **fd 복제**(파일 아님), `echo x >& out.txt` 는 파일 쓰기다.
  // 그래서 `&` 뒤가 숫자뿐이면 대상에서 뺀다 — 안 그러면 흔한 `2>&1` 이 `1` 이라는 파일로 잡혀
  // 정상 명령이 대량으로 deny 되고, 그러면 사람이 하네스를 꺼버린다(과차단이 곧 방어 0).
  const re = /\d*>>?([|&])?\s*(?:"([^"]*)"|'([^']*)'|([^\s;|&<>()]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    const amp = m[1] === '&';
    const t = m[2] ?? m[3] ?? m[4] ?? '';
    if (amp && /^\d+$/.test(t)) continue; // fd 복제(`2>&1`) — 파일이 아니다
    if (t && !t.startsWith('&')) out.push(t);
  }
  return out;
}

/**
 * `xargs` 인자에서 **감싸인 명령**을 뽑는다. xargs 자신의 플래그(와 그 값)를 건너뛴 첫 토큰부터가
 * 실제 명령이다. 값을 받는 플래그를 목록으로 두는 이유: `-I {}` 처럼 값이 분리돼 오면
 * 그 값을 명령으로 오인해 엉뚱한 것을 판정하게 된다.
 */
function innerCommandOf(args: string[]): string[] {
  const takesValue = new Set(['-I', '-i', '-L', '-n', '-P', '-s', '-d', '-E', '--replace', '--max-args',
    '--max-procs', '--delimiter', '--max-chars', '--arg-file', '-a']);
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (!isFlag(a)) break;
    if (takesValue.has(a) && i + 1 < args.length && !isFlag(args[i + 1])) i += 2;
    else i += 1;
  }
  return args.slice(i);
}

export function scanBashWrites(cmd: string): BashWriteScan {
  const targets: string[] = [];
  let mutating = false;
  let patchesWorkingTree = false;

  // 리다이렉트는 세그먼트 분해 전에 원문에서 훑는다 — `>` 자체는 분해 기준이 아니다.
  const redirects = redirectTargets(cmd);
  if (redirects.length > 0) mutating = true;
  targets.push(...redirects);

  for (const segment of cmd.split(SEGMENT_SPLIT)) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;
    const { name, args } = commandName(tokens);
    if (MUTATING_TOKENS.includes(name)) mutating = true;

    const paths = args.filter(looksLikePath);
    // **위치가 경로임을 말해 주는 자리**(cp/mv 의 목적지 등)에서는 `looksLikePath` 를 요구하지
    // 않는다. `cp -r /tmp/x src` 의 `src` 는 슬래시도 확장자도 없지만 분명한 쓰기 대상이고,
    // 그걸 놓치면 디렉토리 이름 하나로 소스 트리를 통째로 덮어쓸 수 있다.
    const operands = args.filter(a => !isFlag(a) && !/^[a-z]+=/.test(a));
    switch (name) {
      case 'tee':
      case 'touch':
      case 'rm':
      case 'truncate':
      case 'unlink':
        // 전부 대상이다. rm 을 포함하는 이유: 저널 삭제는 위조만큼 파괴적이다.
        targets.push(...paths);
        break;
      case 'sed':
      case 'perl':
      case 'ruby':
        // 제자리 편집(-i)일 때만 파일을 건드린다. 스크립트 인자는 따옴표라 looksLikePath 로 걸러진다.
        if (args.some(a => a === '-i' || a.startsWith('-i'))) targets.push(...paths);
        break;
      case 'cp':
      case 'mv':
      case 'install':
        // 목적지는 마지막 피연산자다. 원본은 읽기이므로 대상이 아니다.
        if (operands.length >= 1) targets.push(operands[operands.length - 1]);
        break;
      case 'ln':
        // 심링크는 **링크 이름**이 생기는 자리다(마지막 인자). 대상 파일은 건드리지 않는다.
        if (paths.length >= 2) targets.push(paths[paths.length - 1]);
        break;
      case 'dd':
        for (const a of args) if (a.startsWith('of=')) targets.push(a.slice(3));
        break;
      case 'curl':
      case 'wget': {
        // **받아쓰기**도 쓰기다 — 「참조 구현을 소스로 받아온다」는 막힌 모델이 아주 자연히 가는 길이다.
        // 소문자 `-o`/`--output`(curl)·`-O`/`--output-document`(wget)은 **다음 인자가 대상**이다.
        // curl 의 대문자 `-O` 는 원격 파일명을 그대로 쓰는 플래그라 인자가 대상이 아니다 —
        // 그걸 대상으로 잡으면 URL 이 경로로 잡혀 오탐이 된다.
        const named = name === 'curl' ? ['-o', '--output'] : ['-O', '--output-document', '--output-file'];
        for (let i = 0; i < args.length - 1; i++) {
          if (named.includes(args[i]) && looksLikePath(args[i + 1])) targets.push(args[i + 1]);
        }
        break;
      }
      case 'prettier':
      case 'eslint':
        // 제자리 수정 플래그가 있을 때만 쓰기다(sed -i 와 같은 규칙). `--check`·무플래그 조회는 통과.
        if (args.some(a => a === '--write' || a === '--fix')) targets.push(...paths);
        break;
      case 'patch':
      case 'ed':
      case 'ex':
        // 패치 적용·행 편집기는 인자로 받은 파일을 제자리에서 고친다.
        targets.push(...paths);
        break;
      case 'tar':
      case 'unzip':
      case 'bsdtar': {
        // 전개 디렉토리(`-C` / `-d`)가 대상이다. 아카이브 자체는 읽기다.
        // 플래그 자체가 「여기가 디렉토리다」라고 말하므로 `looksLikePath` 를 요구하지 않는다 —
        // `-C src` 의 `src` 는 슬래시도 확장자도 없지만 분명한 쓰기 대상이다.
        const dirFlag = name === 'unzip' ? '-d' : '-C';
        for (let i = 0; i < args.length - 1; i++) {
          if (args[i] === dirFlag && !isFlag(args[i + 1])) targets.push(args[i + 1]);
        }
        break;
      }
      case 'rsync':
      case 'scp':
        // 목적지는 마지막 피연산자다(cp 와 같은 규칙).
        if (operands.length >= 1) targets.push(operands[operands.length - 1]);
        break;
      case 'sponge':
        // moreutils. 파이프 결과를 파일에 **덮어쓴다** — 이름만 보면 쓰기처럼 안 생겼다.
        targets.push(...operands);
        break;
      case 'vim':
      case 'vi':
      case 'nvim':
        // 배치 모드(`-es`·`-c`·`-S`)는 스크립트로 파일을 고친다. 대화형 실행은 훅이 볼 일이 없다.
        if (args.some(a => /^-(es|s|c|S)$/.test(a) || a === '--cmd')) targets.push(...paths);
        break;
      case 'git': {
        // `git apply`·`git am` 은 **패치 파일 안**에 대상이 있어 정적으로 못 뽑는다.
        // 경로가 아니라 「작업트리를 패치한다」는 사실을 올려 호출측이 페이즈로 판정하게 한다.
        if (args.some(a => a === 'apply' || a === 'am')) { patchesWorkingTree = true; mutating = true; }
        // `git clone <url> <dir>` 은 저장소를 통째로 그 자리에 푼다. URL 은 대상이 아니다.
        const ci = operands.indexOf('clone');
        if (ci >= 0) {
          const rest = operands.slice(ci + 1).filter(a => !/^[a-z][a-z0-9+.-]*:\/\//.test(a) && !a.includes('@'));
          if (rest.length >= 1) targets.push(rest[rest.length - 1]);
        }
        break;
      }
      case 'find': {
        // [SEC-91] `find . -name '*.ts' -exec sed -i "" s/a/b/ {} +` — 진짜 쓰기는 `-exec` 뒤에 있다.
        // xargs 와 같은 구조라 같은 처방을 쓴다: 감싸인 명령을 꺼내 **같은 스캐너로 다시 판정**한다.
        // 대상은 `{}` 라 정적으로 못 뽑으므로, 안쪽이 변형 명령이면 「작업트리를 건드린다」는
        // 사실만 올린다 — `git apply` 와 같은 처리다(경로가 아니라 사실을 올린다).
        for (let i = 0; i < args.length - 1; i++) {
          if (args[i] !== '-exec' && args[i] !== '-execdir' && args[i] !== '-ok' && args[i] !== '-okdir') continue;
          const inner = commandName(args.slice(i + 1));
          if (!inner.name) continue;
          if (MUTATING_TOKENS.includes(inner.name)) { mutating = true; patchesWorkingTree = true; }
          targets.push(...inner.args.filter(looksLikePath));
        }
        break;
      }
      case 'xargs': {
        // xargs 는 진짜 명령을 한 겹 감싼다. 감싼 명령을 그대로 다시 판정하지 않으면
        // `xargs -I{} cp {} src/app.ts` 한 줄로 cp 규칙이 통째로 무의미해진다.
        const inner = innerCommandOf(args);
        if (inner.length > 0) targets.push(...scanBashWrites(inner.join(' ')).targets);
        break;
      }
      default:
        break;
    }
  }

  // 중복 제거 — 같은 대상으로 두 번 deny 사유를 만들 이유가 없다.
  return { targets: [...new Set(targets.filter(Boolean))], mutating, patchesWorkingTree };
}

/**
 * 명령 원문에 등장한 **경로처럼 생긴 토큰**을 전부 뽑는다(따옴표 안쪽 포함).
 *
 * 존재 이유: `scanBashWrites` 는 리다이렉트와 알려진 쓰기 명령만 대상을 뽑는다. 그 밖의
 * 변형(`python -c "open('src/x.ts','w')"`, `prettier --write src/app.ts`)은 대상 추출이
 * 실패하고, 그러면 **판정 자체가 일어나지 않는다.** `.harness/` 코어 파일에는 이름 대조
 * 안전망(`mentionsPath`)이 있었지만 설계 트랙 소스에는 없어서, 같은 수법이 코어 파일에는
 * 막히고 소스에는 통과했다 — 방어가 대칭이 아니면 뚫리는 쪽이 정본이 된다.
 *
 * 여기서는 **뽑기만** 한다. 무엇이 금지인지는 호출측(`judgeWritePath`)이 프로파일·페이즈로
 * 판정하고, 호출측은 이 목록을 반드시 `mutating` 과 AND 로 묶어 쓴다 — 그러지 않으면
 * `cat src/app.ts` 같은 순수 조회까지 막혀 사람이 하네스를 꺼버린다.
 *
 * 슬래시가 있는 토큰만 본다. 확장자만 있는 낱말(`app.ts`)까지 넣으면 커밋 메시지·로그 문구가
 * 경로로 잡혀 오탐이 폭증한다 — 안전망은 조용해야 쓸모가 있다.
 */
export function pathLikeMentions(cmd: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z0-9_.\-]*\/[A-Za-z0-9_.\-\/]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    const t = m[0];
    if (isFlag(t) || !looksLikePath(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * 대상 추출이 실패해도 코어 파일을 지키는 안전망 (2).
 * `python -c "open('.harness/events.jsonl','a')..."` 처럼 구문을 못 읽는 경우를 덮는다.
 * 호출측이 `mutating` 과 AND 로 묶어 쓰므로 순수 조회는 걸리지 않는다.
 */
export function mentionsPath(cmd: string, needles: readonly string[]): string | undefined {
  return needles.find(n => cmd.includes(n));
}
