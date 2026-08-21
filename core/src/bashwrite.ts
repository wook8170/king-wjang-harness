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

/** 명령 이름에서 경로·env 접두를 벗긴다 (`/usr/bin/tee` → `tee`). */
function commandName(tokens: string[]): { name: string; args: string[] } {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++; // env 접두
  const raw = tokens[i] ?? '';
  return { name: raw.split('/').pop() ?? '', args: tokens.slice(i + 1) };
}

export interface BashWriteScan {
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
  const re = /\d*>>?\|?\s*(?:"([^"]*)"|'([^']*)'|([^\s;|&<>()]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    const t = m[1] ?? m[2] ?? m[3] ?? '';
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
        // 목적지는 마지막 경로 인자다. 원본은 읽기이므로 대상이 아니다.
        if (paths.length >= 1) targets.push(paths[paths.length - 1]);
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
  return { targets: [...new Set(targets.filter(Boolean))], mutating };
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
