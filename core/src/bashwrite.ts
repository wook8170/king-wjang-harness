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
  // [EFF-214] `sed`·`awk`·`perl` 은 **이름만으로 변형이 아니다.** `-i` 없는 `sed -n '1,5p' f`·
  // `awk 'NR<3' f` 는 순수 조회인데, 이름으로 `mutating` 을 세우는 바람에 안전망이 발화해
  // **저널을 읽는 것까지 막혔다** — 「디버깅으로 저널을 읽는 것은 정당하다」는 이 파일의
  // 원칙과 정면으로 어긋났다. 제자리 편집(`-i`)일 때만 아래 `case` 에서 세운다.
  '>', '>>', 'tee', 'touch', 'rm', 'mv', 'cp', 'dd', 'truncate', 'install',
  'ln', 'chmod', 'chown', 'python', 'python3', 'node', 'ruby', 'eval',
  // [SEC-101] 없애는 것도 변형이다 — `rmdir` 와 `find … -delete` 가 목록 밖이라
  // 안전망(`mutating` AND 조건)이 아예 걸리지 않았다.
  'rmdir', 'find',
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
 * [SEC-170] **`cd` 는 판정 대상을 바꾼다 — 그래서 판정 전에 정규화해야 한다.**
 *
 * 지난 네 라운드의 우회는 전부 **열거의 실패**였다(`SEC-49`→`SEC-A`→`SEC-100`→`SEC-135`):
 * 빠진 도구 이름이 통로가 됐고, 처방은 부류를 넓히는 것이었다. 이번 것은 다르다 —
 * 도구는 이미 잡혀 있는데 **경로가 다른 이름으로 불렸을 뿐**이다:
 *
 *   `tee .harness/events.jsonl`            → DENY  (보호 목록과 문자열이 같다)
 *   `cd .harness && tee events.jsonl`      → 통과  (같은 파일인데 문자열이 다르다)
 *
 * 보호 대상을 **리터럴 상대경로**로 대조하면 `cd` 한 줄이 그 대조를 통째로 무력화한다.
 * 도구를 아무리 더 열거해도 닫히지 않는다 — 부류가 다르기 때문이다. 그래서 여기서는
 * 세그먼트를 순서대로 걸으며 **가상 작업 디렉토리**를 추적하고, 뽑은 대상을 전부 그 기준으로
 * 정규화한 뒤 판정에 넘긴다.
 *
 * `cd` 대상이 정적으로 안 읽히면(`cd $D`) 그 뒤의 상대경로가 **어디에 떨어지는지 알 수 없다**.
 * 변수 한 줄로 이 방어가 다시 풀리면 안 되므로, 그런 대상은 버리지 않고
 * `unresolvedTargets` 로 올려 호출측이 **파일 이름만으로** 하네스 소유 파일을 지키게 한다.
 * (경로 전체가 아니라 이름만 보는 이유는 과차단을 최소로 두기 위해서다.)
 */
export type Cwd = string | null;

/** 정적으로 못 읽는 `cd` 대상 — 변수·치환·글롭·홈. */
const DYNAMIC_CD = /[$`*?~]/;

/** `.`·`..` 를 접어 경로를 한 가지 표기로 만든다. 같은 파일이 두 이름을 갖지 않게. */
function normalizePath(p: string): string {
  const abs = p.startsWith('/');
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      const top = parts[parts.length - 1];
      if (parts.length > 0 && top !== '..') parts.pop();
      else if (!abs) parts.push('..');
      continue;
    }
    parts.push(seg);
  }
  return (abs ? '/' : '') + parts.join('/');
}

/** `cd` 세그먼트를 만나면 가상 cwd 를 옮긴다. 못 읽는 대상이면 「알 수 없음」으로 떨어진다. */
function advanceCwd(cwd: Cwd, op: string | undefined): Cwd {
  if (op === undefined || op === '-' || DYNAMIC_CD.test(op)) return null;
  if (op.startsWith('/')) return normalizePath(op);
  if (cwd === null) return null;
  return normalizePath((cwd ? cwd + '/' : '') + op);
}

/**
 * 대상을 가상 cwd 기준으로 정규화한다.
 * `null` 은 「어디에 쓰는지 알 수 없다」는 사실이고, 통과가 아니다 — 호출측이 그 사실을 받는다.
 */
function resolveIn(cwd: Cwd, p: string): string | null {
  /**
   * [SEC-198] **변수는 `cd` 에만 붙는 것이 아니다.** [SEC-170] 은 `cd $D` 를 미해결로 올렸는데
   * 대상 **자체**의 변수(`$D/events.jsonl`)는 그대로 리터럴 취급됐다 — 그래서
   * `D=.harness; echo … >> $D/events.jsonl` 한 줄로 저널 위조가 다시 열렸다(다섯 라운드째
   * 같은 부류의 세 번째 표기). 셸이 나중에 펼 값을 여기서 알 수 없으면 **그 사실을 올린다.**
   */
  if (/[$`]/.test(p)) return null;
  if (p.startsWith('/') || p.startsWith('~')) return p; // 절대·홈 — cwd 와 무관하다
  if (cwd === null) return null;
  if (cwd === '') return p; // 프로젝트 루트 — 기존 표기 그대로 둔다(거부문이 명령과 같아 보이게)
  return normalizePath(cwd + '/' + p);
}

/** 세그먼트를 **위치와 함께** 끊는다 — 리다이렉트는 원문 위치로 자기 cwd 를 찾아야 한다. */
function segmentsWithIndex(cmd: string): Array<{ text: string; start: number; cwd: Cwd }> {
  const out: Array<{ text: string; start: number; cwd: Cwd }> = [];
  /**
   * [ENG-226] **따옴표 안의 `&&`·`;` 는 분해 기준이 아니다.**
   *
   * 예전에는 원문을 정규식으로 그냥 쪼갰다. 그래서 `sh -c 'cd src && echo x > app.ts'` 가
   * `sh -c 'cd src ` / ` echo x > app.ts'` 로 갈려 **래퍼 안쪽이 한 덩어리로 보이지 않았고**,
   * `cd` 추적도 대상 정규화도 일어나지 않았다 — 설계 트랙 소스 쓰기가 그대로 통과했다.
   * 토크나이저는 이미 따옴표를 존중한다. 분해도 같은 규칙을 쓴다.
   */
  let last = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    const two = cmd.slice(i, i + 2);
    const len = two === '||' || two === '&&' ? 2 : ';|&\n()'.includes(ch) ? 1 : 0;
    if (len === 0) continue;
    out.push({ text: cmd.slice(last, i), start: last, cwd: '' });
    last = i + len;
    i += len - 1;
  }
  out.push({ text: cmd.slice(last), start: last, cwd: '' });

  let cwd: Cwd = '';
  for (const seg of out) {
    seg.cwd = cwd;
    const tokens = tokenize(seg.text);
    if (tokens.length === 0) continue;
    const { name, args } = commandName(tokens);
    if (name === 'cd' || name === 'pushd') cwd = advanceCwd(cwd, args.find(a => !isFlag(a)));
  }
  return out;
}

/** 원문 위치가 속한 세그먼트의 가상 cwd. */
function cwdAt(segs: ReadonlyArray<{ start: number; cwd: Cwd }>, index: number): Cwd {
  let cwd: Cwd = '';
  for (const seg of segs) {
    if (seg.start > index) break;
    cwd = seg.cwd;
  }
  return cwd;
}

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
  // [EFF-108] 패키지 러너도 감싸기만 한다 — `npx prisma migrate deploy` 의 실행 단위는
  // `prisma migrate deploy` 다. 벗기지 않으면 배포 판정이 러너 한 겹으로 빗나간다.
  // `npm` 은 넣지 않는다 — `npm publish` 는 `npm` 자체가 실행 단위다.
  'npx', 'bunx', 'pnpx',
  // [ENG-217] `busybox` 도 감싸기만 한다 — `busybox sh -c '…'` 의 실행 단위는 `sh -c '…'` 다.
  'busybox',
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
  /**
   * [SEC-A] `git apply <파일>`·`git am <파일>` 의 **패치 파일 경로**.
   *
   * 패치의 대상은 명령이 아니라 패치 **안**에 있다 — 그래서 이 스캐너는 못 뽑는다. 그러나
   * 패치 파일 자체는 인자로 드러나 있으므로, 호출측이 그것을 읽어 대상을 꺼내면 **다른 쓰기와
   * 똑같은 잣대**로 판정할 수 있다. 「감싸인 것을 꺼내 같은 스캐너로 다시」의 패치판이다.
   *
   * 비어 있는데 `patchesWorkingTree` 가 참이면 **패치가 stdin 으로 들어온다는 뜻**이고,
   * 그때는 무엇을 쓰는지 알 길이 없다(호출측이 그 사실로 판정한다).
   */
  patchFiles: string[];
  /** `git apply`·`git am` 이 명령에 있었는가 — 패치 파일 유무와 무관하게 참. */
  appliesPatch: boolean;
  /** 추출된 쓰기 대상 경로(따옴표 제거, 원문 그대로 — 해석은 호출측). */
  targets: string[];
  /** 변형 명령·연산자가 하나라도 있었는가. 안전망 (2) 의 조건. */
  mutating: boolean;
  /**
   * [SEC-100] **프로그램 본문을 명령에서 볼 수 없는 실행.** 값이 있으면 그 형태의 이름이다.
   *
   * `SEC-49`(직접 쓰기) → `SEC-A`(`git apply`) → 이것으로 **세 번째 포장**이고 셋 다 결과가
   * 같다: 저널 위조 → `doctor --repair` → 사람 승인 없이 게이트 개통. 포장을 하나씩 잡는
   * 대신 부류를 잡는다 — 해석기가 프로그램을 **파이프·명령치환·프로세스치환·stdin** 에서
   * 받으면 무엇을 쓸지 정적으로 알 길이 없다.
   *
   * 반대로 **리터럴 프로그램**(`sh -c "npm test"`)과 **스크립트 파일**(`python3 x.py`)은
   * 여기 걸리지 않는다 — 전자는 재귀 스캔이, 후자는 호출측의 본문 이어붙이기가 본다.
   * 「감싸인 것을 꺼내 같은 스캐너로 다시」가 되는 것은 통과시키고, **꺼낼 수 없는 것만** 막는다.
   */
  opaqueExec?: string;
  /**
   * [SEC-170] **어디에 쓰는지 알 수 없는 대상.** `cd $D && tee events.jsonl` 처럼 `cd` 대상을
   * 정적으로 못 읽으면 뒤따르는 상대경로가 어느 디렉토리에 떨어지는지 알 수 없다.
   * 「못 봤으면 통과」는 못 본 만큼 구멍이므로 버리지 않고 사실로 올린다 —
   * 호출측은 이 목록의 **파일 이름**만 보고 하네스 소유 파일을 지킨다(과차단 최소화).
   */
  unresolvedTargets: string[];
  /**
   * [SEC-216] **정적 성분이 하나도 없는 쓰기 대상.** `p=$(…); echo >> $p` 처럼 경로 전체가
   * 실행 시점에 계산되면 리터럴 이름도([SEC-207]) 디렉토리 접두도([SEC-213]) 남지 않는다 —
   * 「볼 수 없는 쓰기」다. `opaqueExec`(볼 수 없는 실행)와 같은 태도로 다룬다.
   */
  blindTargets: string[];
}

/**
 * [ENG-199] **`-c` 로 프로그램 텍스트를 받는 셸의 단일 정본.**
 *
 * 이 목록이 두 벌이었다: `INTERPRETERS`(볼 수 없는 실행 판정)와 `commandLines` 안의 하드코딩
 * 배열(감싼 명령 꺼내기). 갈린 결과가 실측으로 나왔다 — `fish -c "npm publish"`·`ash -c …` 가
 * **설계 트랙 배포 차단을 우회**했다. 꺼내는 쪽이 모르는 셸은 안쪽을 아예 안 본다.
 *
 * 규칙이 두 벌이면 언제나 **느슨한 쪽이 정본이 된다.** 한 벌로 모은다.
 */
export const SHELLS_TAKING_C = [
  'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'ash', 'busybox',
] as const;

/** 프로그램 텍스트를 받아 실행하는 해석기. 셸만이 아니다 — `python3` 도 stdin 을 읽는다. */
const INTERPRETERS = new Set([
  ...SHELLS_TAKING_C,
  'node', 'nodejs', 'deno', 'bun', 'python', 'python2', 'python3',
  'perl', 'ruby', 'php', 'osascript',
]);

/** 해석기가 **리터럴 프로그램**을 인자로 받는 플래그(`sh -c`·`node -e`·`perl -E`). */
const PROGRAM_FLAG = /^-(?:[A-Za-z]*c|e|E|-eval|-command)$/;

/** 인자가 명령치환으로 **시작**하는가. 부분 치환(`cd $(pwd) && npm test`)은 아니다. */
const startsWithSubstitution = (a: string): boolean => a.startsWith('$(') || a.startsWith('`');

/**
 * 프로그램 본문을 볼 수 없는 실행을 찾는다 (SEC-100).
 *
 * `SEGMENT_SPLIT` 을 쓰지 않는 이유: 그것은 괄호에서도 쪼개므로 `eval "$(curl x)"` 의 인자가
 * 조각나 **찾으려는 형태 자체가 사라진다.** 여기서는 파이프 구조를 살려서 쪼갠다 —
 * 「파이프를 받는 것은 그 조각의 **첫** 명령」이라는 사실이 판정의 핵심이기 때문이다.
 */
function opaqueExecOf(cmd: string): string | undefined {
  // 프로세스 치환으로 프로그램을 넘기는 형태 — `bash <(curl …)`·`source <(…)`·`. <(…)`
  // [ENG-230] 셸 목록의 **여섯 번째 사본**이 여기 있었다(`ash`·`busybox` 누락).
  // 정본에서 만든다 — 목록을 손으로 또 적지 않는다.
  const runners = [...SHELLS_TAKING_C, 'source', '.'].map(r => r.replace(/[.]/g, '\\.')).join('|');
  const proc = new RegExp(`(?:^|[\\s;&|])(${runners})\\s+(?:-\\S+\\s+)*<\\(`).exec(cmd);
  if (proc) return `${proc[1]} <(…)`;

  // `||` 는 파이프가 아니다 — 쪼개기 전에 자리표시자로 감춰 둔다.
  const OR = '\u0000';
  const parts = cmd.replace(/\|\|/g, OR).split('|');
  for (let i = 0; i < parts.length; i++) {
    const chunks = parts[i].split(OR).join('||').split(/(?:&&|\|\||;|\n)/);
    for (let k = 0; k < chunks.length; k++) {
      const { name, args } = commandName(tokenize(chunks[k]));

      if (name === 'eval') {
        if (args.some(startsWithSubstitution)) return 'eval "$(…)"';
        continue;
      }
      if (!INTERPRETERS.has(name)) continue;

      const flagIdx = args.findIndex(a => PROGRAM_FLAG.test(a));
      if (flagIdx >= 0) {
        const prog = args[flagIdx + 1];
        // 리터럴 프로그램은 재귀 스캔이 본다. 통째 치환일 때만 볼 수 없다.
        if (prog !== undefined && startsWithSubstitution(prog)) return `${name} -c "$(…)"`;
        continue;
      }
      if (args.some(a => /^-[A-Za-z]*s$/.test(a))) return `${name} -s`;
      if (args.includes('/dev/stdin') || args.includes('-')) return `${name} /dev/stdin`;

      // 스크립트 파일을 받았으면 그 파일은 읽을 수 있다(호출측이 본문을 이어 붙인다).
      if (args.some(a => !isFlag(a) && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a))) continue;

      // 인자 없는 해석기가 파이프 뒤에 있다 = 파이프가 곧 프로그램이다.
      if (i > 0 && k === 0) return `${name} ← pipe`;
    }
  }
  return undefined;
}

/**
 * 리다이렉트 대상을 뽑는다. `2>&1`·`>&2` 같은 **fd 복제는 파일이 아니다** — `&` 로 시작하는
 * 대상을 걸러내지 않으면 `2>&1` 이 `1` 이라는 파일로 잡혀 오탐이 된다.
 */
function redirectTargets(segment: string): Array<{ path: string; index: number }> {
  const out: Array<{ path: string; index: number }> = [];
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
    if (t && !t.startsWith('&')) out.push({ path: t, index: m.index });
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

/**
 * [EFF-109] `sed`·`perl`·`ruby` 의 피연산자에서 **프로그램(치환 스크립트)을 뺀 파일들**.
 *
 * `s/x/y/` 는 슬래시가 있어 경로로 보이고, 그걸 대상으로 올리면 출하 트랙의 「새 파일 금지」가
 * 존재하지 않는 파일을 두고 발화한다 — 원인을 오도하는 거부라 사람이 엉뚱한 곳을 고친다.
 *
 * 규칙은 이들 도구의 실제 계약 그대로다:
 *  - `-e`/`-f`(또는 `-pe` 처럼 e 가 섞인 플래그)가 있으면 프로그램은 **그 플래그가 데려간다** →
 *    남은 피연산자는 전부 파일이다.
 *  - 없으면 **첫 피연산자가 프로그램**이고 나머지가 파일이다.
 */
function scriptFiles(name: string, args: string[]): string[] {
  const carriesProgram = (a: string): boolean =>
    /^-[A-Za-z]*[ef]$/.test(a) || (name !== 'sed' && /^-[A-Za-z]*e[A-Za-z]*$/.test(a));
  const operands: string[] = [];
  let programTaken = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (isFlag(a)) {
      if (carriesProgram(a)) { programTaken = true; i++; }      // 다음 토큰이 프로그램이다
      continue;
    }
    operands.push(a);
  }
  const files = programTaken ? operands : operands.slice(1);    // 첫 피연산자가 프로그램
  return files.filter(looksLikePath);
}

/**
 * [COST-111·SEC-B1] **순수 조회로 인정하는 명령** — 화이트리스트다(블랙리스트가 아니다).
 *
 * 이 목록은 두 곳에서 쓰인다: 활동 집계(정산 강제)와 **쓰기 대상 추출의 기본값**.
 * 쓰기 도구를 이름으로 열거하는 방식이 `xxd`·`openssl`·`csplit`·`split` 에서 뚫렸으므로
 * (SEC-B1), 이제 **모르는 명령은 쓸 수 있다고 본다** — 여기 적힌 것만 조회다.
 * 그래서 새 도구가 생겨도 기본값이 안전한 쪽이다.
 *
 * 처음에 `!scanBashWrites().mutating` 으로 재려다 되돌렸다: 그 판정은 「모르겠으면 참」이
 * 안전한 방향이라 **부정으로 쓰면 편향이 뒤집힌다** — `git commit` 이 조회로 잡혔다.
 * 활동 집계에서 빠진 작업 턴은 정산 강제를 조용히 푸므로([SEC-78]), 여기서는
 * **아는 것만 조회로 인정**하고 나머지는 전부 활동으로 센다.
 *
 * 두 조건을 AND 로 묶는다: 이름이 목록에 있고, 스캐너가 변형을 못 봤을 것.
 * 그래서 `echo hi` 는 조회지만 `echo hi > f` 는 활동이고, `sed`·`awk`·`find` 는
 * 변형 토큰이라 애초에 조회로 인정되지 않는다.
 */
/**
 * **모든 형태에서** 조회인 명령만 여기 둔다.
 *
 * [SEC-221] 예전에는 `yq`·`sort`·`awk` 가 여기 있었다. 셋 다 **쓰기 플래그가 있다** —
 * `yq -i`, `sort -o`, `awk -i inplace`. 「이름이 목록에 있으면 조회」로 읽는 순간
 * `yq -i '…' .harness/config.yaml` 한 줄로 정책 파일이 열렸다(끝단까지 실증됐다).
 *
 * 규칙: **쓰기 형태가 하나라도 있는 도구는 이 목록에 못 들어온다.** 그런 도구는 아래
 * `CONDITIONAL_WRITERS` 에 **그 형태와 함께** 적고, 그 형태일 때만 변형으로 본다.
 * 모르는 도구는 여전히 기본값이 「쓸 수 있다」이므로([SEC-B1]) 새 도구가 생겨도 안전한 쪽이다.
 */
const READ_ONLY_HEADS = [
  'ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'egrep', 'fgrep', 'file', 'stat',
  'du', 'df', 'which', 'type', 'printenv', 'date', 'whoami', 'echo',
  'uniq', 'cut', 'column', 'nl', 'basename', 'dirname', 'realpath', 'readlink', 'diff',
  'cmp', 'shasum', 'tree', 'ps', 'uname', 'hostname', 'id', 'groups', 'less', 'more',
];

/**
 * [SEC-221] **쓰기 형태가 있는 조회 도구** — 그 형태일 때만 변형이다.
 *
 * 값은 「이 플래그가 있으면 쓴다」는 판정이다. 플래그 의미는 도구마다 다르므로
 * (`grep -o` 는 출력 파일이 아니라 only-matching 이다) **일반 규칙으로 뭉갤 수 없고**,
 * 여기 적은 것만 신뢰한다. 적지 않은 도구는 `READ_ONLY_HEADS` 에 없으면 기본값이 변형이다.
 */
const CONDITIONAL_WRITERS: Record<string, (args: readonly string[]) => boolean> = {
  sed: a => a.some(x => x === '-i' || x.startsWith('-i')),
  perl: a => a.some(x => x === '-i' || x.startsWith('-i')),
  ruby: a => a.some(x => x === '-i' || x.startsWith('-i')),
  awk: a => a.some(x => x === '-i' || x === '--include' || x === 'inplace'),
  gawk: a => a.some(x => x === '-i' || x === '--include' || x === 'inplace'),
  yq: a => a.some(x => x === '-i' || x === '--inplace' || x === '--in-place'),
  jq: a => a.some(x => x === '-i' || x === '--in-place'),
  sort: a => a.some(x => x === '-o' || x.startsWith('--output')),
  tr: () => false,
};
/** `git` 은 하위명령마다 갈린다 — 조회인 것만 적는다(`commit`·`push` 는 여기 없다). */
const READ_ONLY_GIT = [
  'status', 'log', 'diff', 'show', 'blame', 'branch', 'remote', 'rev-parse', 'describe',
  'ls-files', 'shortlog', 'reflog', 'grep', 'cat-file',
];

export function isReadOnlyCommand(cmd: string): boolean {
  if (cmd.trim() === '') return false;
  const scan = scanBashWrites(cmd);
  if (scan.mutating || scan.opaqueExec || scan.patchesWorkingTree) return false;
  const lines = commandLines(cmd);
  if (lines.length === 0) return false;
  return lines.every(l => {
    const [head, second, ...rest] = l.split(/\s+/);
    if (head === 'git') return second !== undefined && READ_ONLY_GIT.includes(second);
    // [SEC-221] 쓰기 형태가 있는 도구는 그 형태가 아닐 때만 조회다.
    const cond = CONDITIONAL_WRITERS[head];
    if (cond !== undefined) return !cond([second ?? '', ...rest]);
    return READ_ONLY_HEADS.includes(head);
  });
}

/**
 * [SEC-216] **볼 수 있는 대입은 편다.**
 *
 * 여덟 번째 표기(`p=$(echo <base64> | base64 -d); echo … >> $p`)를 막으려면 「끝까지 안 펴지는
 * 쓰기」를 거부해야 하는데, 그러면 `LOG=build/out.log; echo … >> $LOG` 같은 **정상 작업**까지
 * 걸린다. 그래서 먼저 **볼 수 있는 것을 편다** — 같은 명령 안에서 리터럴로 대입된 변수는
 * 치환해 정상 판정으로 보내고, 남는 것만 「진짜로 못 보는 것」으로 다룬다.
 *
 * 과차단을 줄이는 장치이지 방어를 넓히는 장치가 아니다 — 편 결과는 그대로 판정을 받는다.
 */
/**
 * [EFF-227] **`mktemp` 은 정의상 임시 디렉토리를 만든다 — 그건 우리가 아는 사실이다.**
 *
 * `tmpfile=$(mktemp); echo x > $tmpfile` 은 셸에서 가장 흔한 관용구인데, [SEC-216] 의
 * 「볼 수 없는 쓰기」 규칙이 전 페이즈에서 이것을 막았다. 과차단은 이 제품에서 결함과 같은
 * 무게다 — 이 정도로 흔한 관용구가 막히면 사람이 하네스를 끈다.
 *
 * 값 자체는 못 보지만 **어디에 떨어지는지는 안다**: `TMPDIR`(없으면 `/tmp`) 아래다.
 * 프로젝트 밖이므로 하네스 소관이 아니고, 그 자리에 놓인 이름 모를 파일은 판정에서
 * 그대로 허용으로 떨어진다. **모르는 것을 아는 척하지 않고, 아는 것을 모르는 척하지도 않는다.**
 */
const MKTEMP_VALUE = /^\$\(\s*mktemp\b[^)]*\)$|^`\s*mktemp\b[^`]*`$/;

function staticAssignments(cmd: string, env: Record<string, string | undefined> = {}): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of cmd.matchAll(
    /(?:^|[;&|(\s])([A-Za-z_][A-Za-z0-9_]*)=(\$\([^)]*\)|`[^`]*`)/g,
  )) {
    if (!MKTEMP_VALUE.test(m[2]) || out.has(m[1])) continue;
    const tmp = (env.TMPDIR ?? '/tmp').replace(/\/$/, '');
    out.set(m[1], `${tmp}/mktemp-generated`);
  }
  const re = /(?:^|[;&|(\s])([A-Za-z_][A-Za-z0-9_]*)=("[^"$`]*"|'[^'$`]*'|[^\s;|&<>()"'`$]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    const raw = m[2].replace(/^["']|["']$/g, '');
    if (/[$`]/.test(raw)) continue;                  // 값 자체가 동적이면 펼 수 없다
    if (!out.has(m[1])) out.set(m[1], raw);          // 첫 대입만 — 재대입 순서는 알 수 없다
  }
  return out;
}

/**
 * 알고 있는 정적 대입만 명령 문자열에 펴 넣는다. 모르는 변수는 그대로 둔다.
 *
 * `env` 는 **호출측이 준다** — 이 파일은 순수 함수만 두는 것이 계약이라 `process.env` 를
 * 직접 읽지 않는다. 훅이 자기 환경을 넘겨 주면 `$HOME`·`$TMPDIR` 같은 흔한 변수가 펴져
 * **프로젝트 밖 쓰기가 과차단되지 않는다**(그 값은 훅이 실제로 알고 있는 사실이다).
 * 값에 공백·메타문자가 있으면 경로로 보지 않는다 — 펼 수 없는 것을 편 척하지 않는다.
 */
export function expandStaticVars(cmd: string, env: Record<string, string | undefined> = {}): string {
  const vars = staticAssignments(cmd, env);
  const lookup = (name: string): string | undefined => {
    const local = vars.get(name);
    if (local !== undefined) return local;
    const e = env[name];
    return e !== undefined && e !== '' && !/[\s$`"'<>|;&()]/.test(e) ? e : undefined;
  };
  return cmd.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (whole, a?: string, b?: string) => lookup(a ?? b ?? '') ?? whole);
}

/**
 * [SEC-232] **목적지는 위치가 아니라 플래그가 정한다.**
 *
 * `cp`·`install`·`ln`·`mv` 의 목적지를 「마지막 피연산자」로 고정해 두었는데, GNU 의
 * `-t DIR`(`--target-directory`)은 목적지를 **앞에** 둔다: `cp -t DEST SRC…`.
 * 그래서 훅은 **소스**를 대상으로 오인하고(대개 `/tmp/…` = 루트 밖 = 통과) **진짜 목적지**는
 * 아예 추출하지 않았다 — `cp -t .harness /tmp/config.yaml` 한 줄로 정책 파일이 덮였다.
 *
 * 같은 혼동이 **반대 방향으로도** 틀렸다: `cp -t /tmp/bak src/app.ts` 는 정상 백업(읽기)인데
 * `src/app.ts` 를 쓰기 대상으로 잡아 설계 트랙에서 과차단했다. 방향이 둘 다 틀린 것은
 * 「위치로 목적지를 정한다」는 가정 자체가 틀렸다는 뜻이다.
 *
 * `-T`/`--no-target-directory` 는 「마지막이 목적지」를 명시하는 플래그라 기본 경로 그대로다.
 *
 * **이 헬퍼를 `rsync`·`scp` 에 쓰지 마라 — `-t` 의 뜻이 다르다**(rsync 의 `-t` 는
 * `--times`, 즉 수정시각 보존이다). 플래그 의미는 도구마다 다르다는 것이 [SEC-221] 이
 * 「모든 형태에서 조회인 것만 목록에 둔다」로 정리한 교훈이고, 여기도 같은 선이다.
 */
function targetDirectory(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-t' || a === '--target-directory') return args[i + 1] ?? null;
    if (a.startsWith('--target-directory=')) return a.slice('--target-directory='.length);
    // `-tDIR` 붙여쓰기. `--` 로 시작하는 긴 플래그는 위에서 이미 갈렸다.
    if (a.startsWith('-t') && a.length > 2 && !a.startsWith('--')) return a.slice(2);
  }
  return null;
}

/** `-t DIR` 형태에서 소스들 — 그 DIR 자신(따로 온 피연산자일 때)만 한 번 뺀다. */
function sourcesFor(operands: readonly string[], dir: string): string[] {
  let dropped = false;
  return operands.filter(o => {
    if (!dropped && o === dir) { dropped = true; return false; }
    return true;
  });
}

/**
 * `-t DIR` 이 실제로 만드는 이름들 — 디렉토리 자신과, 그 아래 생기는 각 소스의 basename.
 * 디렉토리만 올리면 `.harness/config.yaml` 같은 **파일 단위** 보호가 발화하지 않는다.
 */
function underDir(dir: string, sources: readonly string[]): string[] {
  const base = dir.replace(/\/+$/, '');
  return [dir, ...sources.map(sourcePath => `${base}/${sourcePath.split('/').pop() ?? sourcePath}`)];
}

export function scanBashWrites(rawCmd: string, env: Record<string, string | undefined> = {}): BashWriteScan {
  // [SEC-216] 볼 수 있는 대입은 먼저 편다 — 그래야 남는 것이 진짜 신호가 된다.
  const cmd = expandStaticVars(rawCmd, env);
  const targets: string[] = [];
  let mutating = false;
  let patchesWorkingTree = false;
  let appliesPatch = false;
  const patchFiles: string[] = [];
  let opaqueExec = opaqueExecOf(cmd);

  const unresolvedTargets: string[] = [];
  const segs = segmentsWithIndex(cmd);

  // 리다이렉트는 세그먼트 분해 전에 원문에서 훑는다 — `>` 자체는 분해 기준이 아니고,
  // `2>&1` 의 `&` 가 분해 기준이라 세그먼트로 끊으면 리다이렉트가 반토막 난다.
  // 대신 **매치 위치**로 자기 세그먼트의 cwd 를 찾아 정규화한다([SEC-170]).
  const redirects = redirectTargets(cmd);
  if (redirects.length > 0) mutating = true;
  for (const r of redirects) {
    const resolved = resolveIn(cwdAt(segs, r.index), r.path);
    if (resolved === null) unresolvedTargets.push(r.path);
    else targets.push(resolved);
  }

  for (const seg of segs) {
    const segment = seg.text;
    const firstNew = targets.length;
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;
    const { name, args } = commandName(tokens);
    if (MUTATING_TOKENS.includes(name)) mutating = true;

    // [SEC-170] `cd` 대상을 정적으로 못 읽으면 이 세그먼트의 상대경로가 **어디에 떨어지는지
    // 알 수 없다**. 변수 한 줄(`D=.harness; cd $D && tee events.jsonl`)로 방어가 다시 풀리면
    // 안 되므로, 경로처럼 생긴 인자를 전부 미해결로 올린다 — 호출측은 그중 **하네스 소유
    // 파일 이름**만 막는다(경로 전체가 아니라 이름만 보는 것이 과차단을 최소로 두는 선택이다).
    if (seg.cwd === null) unresolvedTargets.push(...args.filter(looksLikePath));

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
        // 제자리 편집(-i)일 때만 파일을 건드린다.
        // [EFF-109] **치환 스크립트는 경로가 아니다.** `s/x/y/` 에는 슬래시가 있어서
        // `looksLikePath` 가 참을 내고, 그래서 출하 트랙에서 거짓 「새 파일」 거부가 났다
        // (기존 주석은 「따옴표라 걸러진다」고 적어 뒀지만 토크나이저가 따옴표를 벗긴다).
        if (args.some(a => a === '-i' || a.startsWith('-i'))) {
          mutating = true;                              // [EFF-214] 제자리 편집일 때만 변형이다
          targets.push(...scriptFiles(name, args));
        }
        break;
      case 'cp':
      case 'install': {
        // 목적지는 마지막 피연산자다. 원본은 읽기이므로 대상이 아니다.
        const dir = targetDirectory(args);            // [SEC-232] 단, 플래그가 있으면 그것이 정본이다
        if (dir !== null) { targets.push(...underDir(dir, sourcesFor(operands, dir))); break; }
        if (operands.length >= 1) targets.push(operands[operands.length - 1]);
        break;
      }
      case 'mv': {
        const dir = targetDirectory(args);            // [SEC-232]
        if (dir !== null) {
          const srcs = sourcesFor(operands, dir);
          targets.push(...underDir(dir, srcs));
          targets.push(...srcs);                      // [SEC-101] 원본도 사라진다
          break;
        }
        // 목적지는 마지막 피연산자다.
        if (operands.length >= 1) targets.push(operands[operands.length - 1]);
        // [SEC-101] **원본도 대상이다 — mv 는 원본을 없앤다.** `cp` 와 갈리는 지점이 여기다.
        // `rm -rf .harness` 는 막는데 `mv .harness /tmp/x` 는 통과해 하네스 전체가 한 줄로
        // 사라졌다. 「지운다」를 명령 이름으로 열거하면 언제나 빠진 이름이 있으므로,
        // **보호 대상이 사라지는 것**을 본다.
        if (operands.length >= 2) targets.push(...operands.slice(0, -1));
        break;
      }
      case 'rmdir':
        // 비우는 것도 없애는 것이다(SEC-101 과 같은 이유).
        targets.push(...paths);
        break;
      case 'ln': {
        const dir = targetDirectory(args);            // [SEC-232]
        if (dir !== null) { targets.push(...underDir(dir, sourcesFor(operands, dir))); break; }
        // 심링크는 **링크 이름**이 생기는 자리다(마지막 인자). 대상 파일은 건드리지 않는다.
        if (paths.length >= 2) targets.push(paths[paths.length - 1]);
        break;
      }
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
        if (args.some(a => a === 'apply' || a === 'am')) {
          patchesWorkingTree = true; mutating = true; appliesPatch = true;
          // [SEC-A] 패치 파일 경로는 인자에 드러나 있다 — 호출측이 그것을 읽어 대상을 꺼낸다.
          // `apply`/`am` 자신과 서브커맨드 토큰은 뺀다.
          // 리다이렉트 연산자는 파일이 아니다 — 거르지 않으면 `git apply < ok.patch` 의 `<` 가
          // 「읽을 수 없는 패치」로 잡혀 **정당한 패치까지 막힌다**(과차단).
          patchFiles.push(...operands.filter(
            a => a !== 'apply' && a !== 'am' && a !== 'git' && !/^[<>|&]+$/.test(a),
          ));
        }
        // [SEC-97] **복원 계열도 작업트리에 쓴다.** `git checkout -- src`·`git restore src/app.ts`·
        // `git checkout HEAD~1 -- .harness`·`git stash pop` 은 파일을 되돌려 놓는 쓰기다 —
        // 「되돌리기」라는 이름 때문에 쓰기로 안 보이지만, 결과는 덮어쓰기와 같다.
        // pathspec(`--` 뒤)이 있으면 그것이 대상이고, 없으면 어디에 쓸지 정적으로 모른다
        // → `git apply` 와 같은 처리(경로가 아니라 «작업트리를 건드린다»는 사실을 올린다).
        const RESTORE = ['checkout', 'restore', 'stash', 'reset', 'revert'];
        const verb = operands.find(a => RESTORE.includes(a));
        if (verb !== undefined) {
          const dashdash = args.indexOf('--');
          if (dashdash >= 0 && dashdash + 1 < args.length) {
            targets.push(...args.slice(dashdash + 1).filter(a => !isFlag(a)));
            mutating = true;
          } else if (verb === 'restore') {
            // `git restore <paths>` 는 `--` 없이도 경로를 받는다.
            targets.push(...operands.filter(a => a !== 'restore'));
            mutating = true;
          } else if (verb !== 'stash' || operands.includes('pop') || operands.includes('apply')) {
            patchesWorkingTree = true; mutating = true;
          }
        }
        // `git clone <url> <dir>` 은 저장소를 통째로 그 자리에 푼다. URL 은 대상이 아니다.
        const ci = operands.indexOf('clone');
        if (ci >= 0) {
          const rest = operands.slice(ci + 1).filter(a => !/^[a-z][a-z0-9+.-]*:\/\//.test(a) && !a.includes('@'));
          if (rest.length >= 1) targets.push(rest[rest.length - 1]);
        }
        break;
      }
      /**
       * [ENG-226] **셸 목록의 다섯 번째 사본이 `case` 라벨로 숨어 있었다.**
       * `fish`·`ash`·`busybox` 가 빠져 `ash -c 'cd src && echo x > app.ts'` 가 통과했다 —
       * 래퍼 안쪽이 아예 안 열려서 `cd` 추적도 안 됐다.
       *
       * `case` 라벨은 정본(`SHELLS_TAKING_C`)에서 생성할 수 없다. 그래서 **드리프트를 테스트로
       * 못 박는다** — 정본의 모든 셸에 대해 이 분기가 안쪽을 여는지 전수 검사한다
       * (`blocker-3j.test.ts` [ENG-226]). 라벨이 빠지면 그 테스트가 먼저 깨진다.
       */
      case 'sh':
      case 'bash':
      case 'zsh':
      case 'dash':
      case 'ksh':
      case 'fish':
      case 'ash':
      case 'busybox':
      case 'eval': {
        // [SEC-97] `sh -c "cp /tmp/x src/app.ts"` — **가장 기본 래퍼**인데 안쪽을 안 봤다.
        // 리다이렉트 형태(`bash -c "echo x > src/app.ts"`)만 우연히 막혔다: 리다이렉트는 원문
        // 전체를 훑기 때문이다. 그래서 「래퍼를 씌우면 열린다」가 명령 계열에서만 조용히 성립했다
        // (SEC-90 과 정확히 같은 모양의 사고다).
        // xargs·find 와 같은 처방: 감싸인 문자열을 꺼내 **같은 스캐너로 다시 판정**한다.
        const inner: string[] = [];
        if (name === 'eval') inner.push(...args.filter(a => !isFlag(a)));
        else {
          for (let i = 0; i < args.length; i++) {
            // `-c`·`-lc`·`-xc` 처럼 c 가 섞인 플래그 다음이 명령 문자열이다.
            if (/^-[a-z]*c$/.test(args[i]) && i + 1 < args.length) { inner.push(args[i + 1]); i++; }
          }
        }
        for (const chunk of inner) {
          const sub = scanBashWrites(chunk);
          targets.push(...sub.targets);
          unresolvedTargets.push(...sub.unresolvedTargets);
          if (sub.mutating) mutating = true;
          if (sub.patchesWorkingTree) patchesWorkingTree = true;
          if (sub.appliesPatch) { appliesPatch = true; patchFiles.push(...sub.patchFiles); }
          // 감싼 안쪽이 불투명하면 바깥도 불투명하다 — `sh -c "curl x | sh"`.
          opaqueExec ??= sub.opaqueExec;
        }
        break;
      }
      case 'find': {
        // [SEC-101] `-delete` 는 `-exec rm` 과 같은 일을 **감싸는 명령 없이** 한다 — 그래서
        // 아래 `-exec` 스캔이 아예 걸리지 않았고 `find .harness -delete` 가 통과했다.
        // 삭제 대상은 find 의 시작 경로(첫 피연산자들)다.
        if (args.some(a => a === '-delete')) {
          for (const a of args) {
            if (isFlag(a) || a.startsWith('-')) break;   // 첫 술어(-name 등)를 만나면 경로 끝
            targets.push(a);
          }
        }
        // [SEC-91] `find . -name '*.ts' -exec sed -i "" s/a/b/ {} +` — 진짜 쓰기는 `-exec` 뒤에 있다.
        // xargs 와 같은 구조라 같은 처방을 쓴다: 감싸인 명령을 꺼내 **같은 스캐너로 다시 판정**한다.
        // 대상은 `{}` 라 정적으로 못 뽑으므로, 안쪽이 변형 명령이면 「작업트리를 건드린다」는
        // 사실만 올린다 — `git apply` 와 같은 처리다(경로가 아니라 사실을 올린다).
        for (let i = 0; i < args.length - 1; i++) {
          if (args[i] !== '-exec' && args[i] !== '-execdir' && args[i] !== '-ok' && args[i] !== '-okdir') continue;
          const inner = commandName(args.slice(i + 1));
          if (!inner.name) continue;
          // [EFF-215] 「안쪽이 변형인가」를 **이름 목록으로 다시 묻지 않는다** — 같은 스캐너에
          // 통째로 넘긴다. 이름으로 물었을 때 `sed -i` 가 목록에서 빠지자마자 이 절이 조용해졌고,
          // 그동안 이 벡터를 막아 온 것은 `s/a/b/` 를 **가짜 경로로 오인한 우연**이었다
          // (테스트가 그 우연을 고정하고 있었다 — 초록이 규칙이 옳다는 증거가 아닌 예다).
          const innerScan = scanBashWrites([inner.name, ...inner.args].join(' '));
          if (innerScan.mutating) { mutating = true; patchesWorkingTree = true; }
          targets.push(...innerScan.targets.filter(t => t !== '{}'));
          unresolvedTargets.push(...innerScan.unresolvedTargets);
        }
        break;
      }
      case 'xargs': {
        // xargs 는 진짜 명령을 한 겹 감싼다. 감싼 명령을 그대로 다시 판정하지 않으면
        // `xargs -I{} cp {} src/app.ts` 한 줄로 cp 규칙이 통째로 무의미해진다.
        const inner = innerCommandOf(args);
        if (inner.length > 0) {
          const sub = scanBashWrites(inner.join(' '));
          targets.push(...sub.targets);
          unresolvedTargets.push(...sub.unresolvedTargets);
        }
        break;
      }
      default: {
        /**
         * [SEC-B1] **모르는 명령은 쓸 수 있다고 본다.**
         *
         * 예전에는 여기가 `break` 였다 — 위 `case` 에 이름이 없는 도구는 대상 추출이 아예
         * 안 되고, 리다이렉트도 없으면 `mutating=false` 로 통과했다. 실측으로 뚫린 것들:
         * `xxd -r -p a.hex src/app.ts` · `openssl enc -out src/b.ts` · `csplit -f src/c …` ·
         * `split -l1 in src/d` — 그리고 그중 하나로 `.harness/config.yaml` 을 덮으면
         * **강제 자체가 풀렸다**([SEC-69] 의 재발).
         *
         * 「쓰는 도구」를 열거하는 한 빠진 이름은 계속 생긴다. 그래서 **기본값을 뒤집는다**:
         * 조회라고 아는 것(`READ_ONLY_HEADS`)만 빼고, 나머지 명령의 **경로처럼 생긴 인자**를
         * 쓰기 후보로 올린다. 판정은 늘 그렇듯 호출측(`judgeWritePath`)이 페이즈·프로파일로 한다 —
         * 여기서는 「볼 후보」만 넓힌다.
         *
         * 입력 파일까지 후보에 들어가는 것은 감수한다(예: `xxd -r -p a.hex src/x.ts` 의 `a.hex`).
         * 그 값은 판정에서 대개 허용으로 떨어지고, 반대로 놓치면 소스·코어·정책이 열린다.
         */
        // 대상을 **직접 올리지는 않는다** — `node build.js` 의 `build.js` 처럼 실행 대상이
        // 쓰기 대상으로 오인된다. 대신 `mutating` 만 세워 기존 안전망
        // (`pathLikeMentions` + `mentionsPath(CORE_FILES)`)이 발화하게 한다. 그 안전망은
        // **슬래시가 있는 토큰만** 보므로 `build.js` 같은 낱말은 걸리지 않고,
        // `src/app.ts`·`.harness/config.yaml` 처럼 진짜 경로만 판정으로 간다.
        // [SEC-221] 조회 도구라도 **쓰기 형태**면 변형이고, 그 대상은 판정으로 보낸다.
        const cond = CONDITIONAL_WRITERS[name];
        if (cond?.(args)) {
          mutating = true;
          targets.push(...paths);
          break;
        }
        if (name && !READ_ONLY_HEADS.includes(name) && cond === undefined) mutating = true;
        break;
      }
    }

    // [SEC-170] 이 세그먼트가 올린 대상을 **그 세그먼트의 가상 cwd 기준으로** 정규화한다.
    // 여기서 한 번에 하는 이유: 위 `case` 는 스무 곳이 넘고, 각자 정규화하게 두면
    // 언젠가 한 곳이 빠진다 — 그리고 빠진 한 곳이 그대로 통로가 된다.
    for (let i = firstNew; i < targets.length; i++) {
      const resolved = resolveIn(seg.cwd, targets[i]);
      if (resolved === null) { unresolvedTargets.push(targets[i]); targets[i] = ''; }
      else targets[i] = resolved;
    }
  }

  // 중복 제거 — 같은 대상으로 두 번 deny 사유를 만들 이유가 없다.
  return {
    targets: [...new Set(targets.filter(Boolean))],
    mutating, patchesWorkingTree, appliesPatch, opaqueExec,
    patchFiles: [...new Set(patchFiles.filter(Boolean))],
    unresolvedTargets: [...new Set(unresolvedTargets.filter(Boolean))],
    // [SEC-216] 정적 성분이 **하나도** 없는 쓰기 대상 — 어디에 쓰는지 볼 수 없다.
    blindTargets: [...new Set(unresolvedTargets.filter(t => /^[$`]/.test(t)))],
  };
}

/**
 * [EFF-108] 명령을 **실행 단위로 정규화**해 돌려준다 — 감싼 것은 꺼내서 함께 넣는다.
 *
 * 왜 필요한가: 배포 명령 차단이 `cmd.includes('npm publish')` 였다. 그래서
 * `grep "npm publish" README.md` 처럼 **읽기만 하는 명령**이 배포로 오판돼 막혔다
 * (설계·구축·미승인 출하 트랙 전부). 과차단은 이 제품에서 결함과 같은 무게다 —
 * 사람이 과차단에 질려 하네스를 끄면 방어는 그 순간 0 이 된다.
 *
 * 반대로 단순히 「앞에서 시작하는가」만 보면 래퍼 한 겹으로 차단이 풀린다
 * (`sh -c "npm publish"`). 그래서 `scanBashWrites` 와 **같은 꺼내기 규칙**을 쓴다:
 * 접두 명령을 벗기고, `sh -c`·`eval`·`xargs`·`find -exec` 의 안쪽을 꺼내 함께 돌려준다.
 */
/**
 * [ENG-N2] **`--dry-run` 이 배포가 아니라는 규칙은 한 벌이어야 한다.**
 *
 * [EFF-231] 이 이 예외를 두 곳에 구현했고 **적용 범위가 갈렸다** — 훅은 줄 단위로 걸러
 * `A --dry-run && A` 의 둘째 줄을 잡았는데, 프로파일 경로는 명령 전체를 한 번에 봐서
 * 플래그가 **어디든** 있으면 전부 사면했다. 그래서 프로파일에만 있는 배포 명령
 * (`prisma migrate deploy` 등)이 그 형태로 출하 전에 실행됐다.
 * 규칙이 두 벌이면 **느슨한 쪽이 정본이 된다** — 이 리포가 셸 목록에서 여섯 번 겪은 것과 같다.
 *
 * 이름이 명확한 플래그만 본다(`-n` 은 도구마다 뜻이 달라 신뢰하지 않는다).
 */
export function isDryRun(line: string): boolean {
  return /(?:^|\s)--dry[-_]?run(?:[=\s]|$)/.test(line);
}

export function commandLines(cmd: string): string[] {
  const out: string[] = [];
  for (const segment of cmd.split(SEGMENT_SPLIT)) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;
    const { name, args } = commandName(tokens);
    if (!name) continue;
    out.push([name, ...args].join(' ').trim());

    // 감싼 안쪽도 실행 단위다.
    const inner: string[] = [];
    if (name === 'eval') inner.push(...args.filter(a => !isFlag(a)));
    else if ((SHELLS_TAKING_C as readonly string[]).includes(name)) {
      for (let i = 0; i < args.length; i++) {
        if (/^-[a-z]*c$/.test(args[i]) && i + 1 < args.length) { inner.push(args[i + 1]); i++; }
      }
    } else if (name === 'xargs') {
      const sub = innerCommandOf(args);
      if (sub.length > 0) inner.push(sub.join(' '));
    } else if (name === 'find') {
      for (let i = 0; i < args.length - 1; i++) {
        if (['-exec', '-execdir', '-ok', '-okdir'].includes(args[i])) {
          inner.push(args.slice(i + 1).filter(a => a !== ';' && a !== '+' && a !== '{}').join(' '));
        }
      }
    }
    for (const chunk of inner) out.push(...commandLines(chunk));
  }
  return out;
}

/**
 * 이 명령이 `phrase` 를 **실행하는가**(언급이 아니라). 호출측이 배포·빌드 판정에 쓴다.
 * 낱말 경계까지 본다 — `npm publish` 가 `npm publishing` 을 무는 일은 없어야 한다.
 */
export function runsCommand(cmd: string, phrase: string): boolean {
  const p = phrase.trim();
  if (!p) return false;
  return commandLines(cmd).some(l => l === p || l.startsWith(`${p} `));
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
/** `s/x/y/`·`y/abc/xyz/` 같은 sed·perl 치환 스크립트 — 경로처럼 보이지만 파일이 아니다. */
const SUBSTITUTION_SCRIPT = /^[sy]\/[^/]*\/[^/]*\/[gimIpe0-9]*$/;

export function pathLikeMentions(cmd: string): string[] {
  const out: string[] = [];
  const add = (t: string): void => { if (t && !out.includes(t)) out.push(t); };

  for (const seg of segmentsWithIndex(cmd)) {
    /**
     * [COST-228] **탐욕 접두는 슬래시 없는 긴 입력에서 2차로 터진다.**
     *
     * 예전 정규식은 `[A-Za-z0-9_.-]*\/…` 였다. 슬래시가 없는 긴 낱말에서 접두가 매 위치마다
     * 되짚어(backtrack) **입력 길이의 제곱**으로 늘었다 — 실측 2KB 2.6ms · 10KB 138ms ·
     * 50KB 3495ms. 훅에는 10초 타임아웃이 있고 **타임아웃은 fail-open** 이라,
     * 충분히 긴 명령 하나로 이 안전망이 통째로 꺼졌다. **비용 캡이 방어를 되돌리는** 부류다.
     *
     * 슬래시를 먼저 찾고 **거기서 뒤로 걸어** 접두를 모은다 — 각 문자를 상수 번만 본다.
     */
    const text = seg.text;
    const re = /\/[A-Za-z0-9_.\-\/]*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      let from = m.index;
      while (from > 0 && /[A-Za-z0-9_.\-]/.test(text[from - 1])) from--;
      const t = text.slice(from, m.index + m[0].length);
      re.lastIndex = from + t.length;
      if (isFlag(t) || !looksLikePath(t)) continue;
      // [EFF-109] **치환 스크립트는 경로가 아니다.** `s/x/y/` 는 슬래시가 있어 이 안전망에
      // 잡혔고, 출하 트랙의 「새 파일 금지」가 존재하지 않는 그 「경로」를 두고 발화했다 —
      // 원인을 오도하는 거부는 사람을 엉뚱한 곳으로 보낸다. 주 추출기(`scriptFiles`)만
      // 고치면 이쪽이 남으므로 **두 곳 다** 같은 사실을 알아야 한다.
      if (SUBSTITUTION_SCRIPT.test(t)) continue;
      // [EFF-173] **슬래시가 있다고 파일인 것은 아니다.** 컨테이너 이미지 참조·URL·스코프
      // 패키지는 전부 슬래시를 갖는다. 그것들이 이 안전망에 잡히면 출하 트랙의 「신규 파일
      // 금지」가 **게이트 승인 뒤에도** `docker push registry.io/app:v1` 을 막았다 —
      // 그것도 존재하지 않는 「파일」을 사유로 들면서. 과차단은 이 제품에서 결함과 같은
      // 무게다. 토큰만 봐서는 못 가리므로 **앞뒤 한 글자**를 본다(정규식이 `:`·`@` 에서
      // 끊기기 때문에 토큰 자체에는 그 흔적이 남지 않는다).
      const before = text[from - 1] ?? '';
      const after = text[from + t.length] ?? '';
      if (after === ':') continue;                       // `registry.io/app:v1` · `host:port`
      if (before === '@' || before === ':') continue;    // `@scope/pkg` · `https://host/path`
      const resolved = resolveIn(seg.cwd, t);
      if (resolved !== null) add(resolved);
    }

    // [SEC-170] **`cd` 안에서는 낱말도 경로다.** 슬래시만 보는 규칙은 `cd src` 뒤의 `app.ts`
    // 를 못 본다 — 그리고 그것이 이 안전망을 통째로 끄는 한 줄이었다. 여기서만 확장자 낱말을
    // 받아들이는 이유는 **`cd` 로 디렉토리가 정해진 세그먼트에서만** 그 낱말이 진짜 경로임을
    // 알 수 있기 때문이다(루트에서는 커밋 메시지·로그 문구가 경로로 잡혀 오탐이 폭증한다).
    if (seg.cwd !== null && seg.cwd !== '') {
      for (const t of tokenize(seg.text)) {
        if (t.includes('/') || isFlag(t) || !looksLikePath(t)) continue;
        if (SUBSTITUTION_SCRIPT.test(t)) continue;
        const resolved = resolveIn(seg.cwd, t);
        if (resolved !== null) add(resolved);
      }
    }
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
