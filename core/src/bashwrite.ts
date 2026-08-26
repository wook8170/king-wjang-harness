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
/**
 * [SEC-300] **`\`+개행(줄이음)은 셸이 «지우는» 인용소거 규칙이다** — 두 줄을 한 단어로 잇는다.
 * `echo x > .harness/con\⏎fig.yaml` 은 실제로 `.harness/config.yaml` 에 착지한다. 그런데 하네스는
 * 개행을 무조건 세그먼트 경계로 쪼개고, 대상이 `\` 에서 잘려 `.harness/con\` 라는 «항상 허용되는
 * `.harness/` 접두»로 떨어졌다(코어·정책·소스·배포게이트 전부 우회, 끝단 실증). 그래서 **세그먼트로
 * 쪼개기·토큰화 «전»에 줄이음부터 접는다.** 세그먼트/리다이렉트/토큰이 전부 이 정본을 지난 뒤 판정한다.
 * (인용 안 `\`+개행까지 접는 것은 큰따옴표에선 실 bash 와 같고, 작은따옴표 안은 리터럴 개행이라
 * 애초에 보호 파일명과 다른 이름이 된다 — 과차단 0 을 짝으로 확인.)
 */
const foldLineContinuations = (s: string): string => s.replace(/\\\r?\n/g, '');

/**
 * [SEC-300/12차] **ANSI-C 인용 `$'…'` 는 셸이 이스케이프를 «펴는» 인용이다** — 작은따옴표와 달리
 * `\x2e`→`.`, `\056`→`.`, `\n`→개행 처럼 바꾼다. `echo x > .harness/events$'\x2e'jsonl` 은
 * `.harness/events.jsonl` 에 착지하는데, 허용 디렉토리(`.harness/`) «안»의 코어 파일명을 이렇게
 * 조립하면 디렉토리-단위 방어로도 못 막혔다. 그래서 `$'…'` 본문을 실제 값으로 편다.
 */
function decodeAnsiC(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; ) {
    if (body[i] !== '\\') { out += body[i]; i++; continue; }
    const n = body[i + 1];
    if (n === undefined) { out += '\\'; break; }
    let m: RegExpExecArray | null;
    if (n === 'x' && (m = /^[0-9A-Fa-f]{1,2}/.exec(body.slice(i + 2)))) {
      out += String.fromCharCode(parseInt(m[0], 16)); i += 2 + m[0].length; continue;
    }
    if (n === 'u' && (m = /^[0-9A-Fa-f]{1,4}/.exec(body.slice(i + 2)))) {
      out += String.fromCharCode(parseInt(m[0], 16)); i += 2 + m[0].length; continue;
    }
    if (n >= '0' && n <= '7' && (m = /^[0-7]{1,3}/.exec(body.slice(i + 1)))) {
      out += String.fromCharCode(parseInt(m[0], 8) & 0xff); i += 1 + m[0].length; continue;
    }
    const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', '\\': '\\', "'": "'", '"': '"', '?': '?' };
    out += Object.prototype.hasOwnProperty.call(map, n) ? map[n] : n;
    i += 2;
  }
  return out;
}

/**
 * 세그먼트를 셸처럼 토큰으로 나누며 **인용/이스케이프를 해소**한다 — 훅이 「셸이 실제로
 * 착지시킬 경로」를 판정하도록. 따옴표는 벗기고, 역슬래시는 다음 글자를 리터럴로 만든다.
 *
 * [SEC-300] **역슬래시·중간 따옴표가 대상 경로를 잘라 코어·정책 보호를 통째로 비껴갔다.**
 * `echo x > .harness/events\.jsonl` 은 셸에서 `.harness/events.jsonl` 로 착지하는데, 예전
 * tokenize 는 `\` 를 리터럴로 둬 정확 이름 대조가 빗나갔고, redirectTargets 정규식은 아예
 * `.harness/events` 에서 **잘렸다**. 셸이 지우는 것을 훅도 지운다 — 이 정본 하나가 리다이렉트·
 * 명령 인자 두 표면을 다 덮는다(redirectTargets 도 이 함수로 대상을 해소한다).
 */
function tokenize(segment: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  const chars = [...segment];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (quote === "'") { if (ch === "'") quote = null; else cur += ch; continue; }
    if (quote === '"') {
      if (ch === '"') { quote = null; continue; }
      // 큰따옴표 안 역슬래시는 `" \ $ ` `` 앞에서만 이스케이프다.
      if (ch === '\\' && i + 1 < chars.length && '"\\$`'.includes(chars[i + 1])) { cur += chars[i + 1]; i++; continue; }
      cur += ch; continue;
    }
    // [SEC-300/12차] ANSI-C 인용 `$'…'` — 본문의 이스케이프를 실제 값으로 편다(`$'\x2e'`→`.`).
    if (ch === '$' && chars[i + 1] === "'") {
      let j = i + 2; let body = '';
      while (j < chars.length && chars[j] !== "'") {
        if (chars[j] === '\\' && j + 1 < chars.length) { body += chars[j] + chars[j + 1]; j += 2; }
        else { body += chars[j]; j++; }
      }
      cur += decodeAnsiC(body); i = j; continue;   // i=닫는 `'`(또는 끝), 루프 i++ 가 지나간다
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    // 인용 밖 역슬래시 — 다음 글자를 리터럴로(공백 이스케이프면 토큰을 안 나눈다).
    if (ch === '\\' && i + 1 < chars.length) { cur += chars[i + 1]; i++; continue; }
    if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * [ENG-294] **`NAME=VALUE` 는 하나의 규칙이다.** 같은 정규식이 이 파일 세 곳과 `hook.ts` 에
 * 각각 적혀 있었다 — 한 곳만 넓히면 나머지가 조용히 좁은 채로 남는다.
 */
export const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** `-c`·`-lc`·`-xc` — c 가 섞인 플래그 다음이 명령 문자열이다(정본 한 벌). */
const DASH_C_RE = /^-[a-z]*c$/;

/** URL 스킴 — 파일 경로가 아니다(정본 한 벌, 대소문자 무시). */
export const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

const isFlag = (t: string): boolean => t.startsWith('-');

/** `-x` 꼴 짧은 플래그의 시작(정본 한 벌 — `-`+글자, `--long` 은 별도로 걸러 쓴다). */
const SHORT_FLAG_RE = /^-[A-Za-z]/;

/** 경로처럼 보이는 토큰만 후보로 본다 — `sed` 의 스크립트 인자를 파일로 오인하지 않게. */
export const looksLikePath = (t: string): boolean =>
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
/**
 * [COST-260] **가상 cwd 에 길이 상한을 둔다.**
 *
 * `cd x` 를 이어 붙이면 cwd 문자열이 세그먼트 수에 비례해 자라고, 그 문자열을 리다이렉트마다
 * 정규화·결합하므로 전체가 다시 2차가 된다(이진탐색만으로는 안 없어진다).
 * 상한을 넘으면 `null` 을 낸다 — `null` 은 **「어디에 쓰는지 모른다」는 사실**이고 통과가
 * 아니다(`resolveIn` 계약). 즉 상한이 **방어를 되돌리지 않는다**: 모르면 미해결로 올라가고
 * 호출측이 하네스 소유 이름을 그 자리에서 막는다.
 *
 * 4096자는 흔한 `PATH_MAX` 다 — 그보다 깊은 실제 경로는 OS 가 먼저 거절한다.
 */
export const PATH_MAX_GUESS = 4096;
const CWD_MAX = PATH_MAX_GUESS;

function advanceCwd(cwd: Cwd, op: string | undefined): Cwd {
  if (op === undefined || op === '-' || DYNAMIC_CD.test(op)) return null;
  if (op.startsWith('/')) return normalizePath(op);
  if (cwd === null) return null;
  if (cwd.length + op.length + 1 > CWD_MAX) return null;
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
  /**
   * [SEC-279] **`$PWD` 는 모르는 값이 아니다 — 이 세그먼트의 cwd 다.**
   * 훅은 `cd` 를 이미 추적하므로 정확히 풀 수 있다. `$OLDPWD` 는 추적하지 않으므로
   * 아래 「모른다」 경로로 떨어진다(보수적). 기준점을 여기 한 곳에만 둔다.
   *
   * [SEC-300/12차] **`~+`(=$PWD)·`~-`(=$OLDPWD) 물결 축약도 홈이 아니라 cwd 의존**이라 프로젝트
   * «안»으로 편다. `~+` 는 `$PWD` 와 같은 값이라 같은 기준점으로 풀고(아래 정규식에 합류), `~-`
   * (=$OLDPWD)는 추적 안 하므로 「모른다」로 떨어뜨린다 — 홈으로 통과시키면 코어 파일에 착지한다.
   */
  const pwdHead = /^\$\{PWD\}|^\$PWD(?![A-Za-z0-9_])|^~\+(?=\/|$)/.exec(p);
  if (pwdHead !== null) {
    if (cwd === null) return null;                    // cwd 를 못 읽었다 — 「모른다」
    const rest = p.slice(pwdHead[0].length).replace(/^\//, '');
    const joined = rest === '' ? (cwd === '' ? '.' : cwd) : (cwd === '' ? rest : `${cwd}/${rest}`);
    return /[$`]/.test(joined) ? null : normalizePath(joined);
  }
  if (/[$`]/.test(p)) return null;
  if (/^~-(?=\/|$)/.test(p)) return null;               // [12차] $OLDPWD 미추적 — 홈 통과 금지
  if (p.startsWith('/') || p.startsWith('~')) return p; // 절대·홈(`~`·`~user`) — cwd 와 무관하다
  if (cwd === null) return null;
  if (cwd === '') return p; // 프로젝트 루트 — 기존 표기 그대로 둔다(거부문이 명령과 같아 보이게)
  return normalizePath(cwd + '/' + p);
}

/**
 * [SEC-285] `env` 가 지정하는 작업 디렉토리 — `-C DIR`·`--chdir DIR`·`--chdir=DIR`.
 * 접두 명령이 여러 겹이어도(`sudo env -C …`) 훑는다.
 */
function envChdirOf(tokens: string[]): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const head = (tokens[i] ?? '').split('/').pop() ?? '';
    if (head !== 'env') continue;
    for (let k = i + 1; k < tokens.length; k++) {
      const a = tokens[k];
      if (a === '-C' || a === '--chdir') return tokens[k + 1];
      if (a.startsWith('--chdir=')) return a.slice('--chdir='.length);
      if (a.startsWith('-C') && a.length > 2) return a.slice(2);
      if (!isFlag(a) && !ENV_ASSIGN_RE.test(a)) break;   // 감싼 명령이 시작됐다
    }
  }
  return undefined;
}

/** 세그먼트를 **위치와 함께** 끊는다 — 리다이렉트는 원문 위치로 자기 cwd 를 찾아야 한다. */
/**
 * [COST-293] **토큰은 한 번만 만든다.** 세그먼트마다 `tokenize` 를 다시 부르면 깊은 cwd 에서
 * 그 비용이 세그먼트 수에 곱해져 [COST-260] 의 2차가 되살아난다 — 실측 11.7초(가드가 물었다).
 * 여기서 만든 토큰을 호출측이 그대로 쓴다.
 */
function segmentsWithIndex(cmd: string): Array<{ text: string; start: number; cwd: Cwd; tokens: string[] }> {
  const out: Array<{ text: string; start: number; cwd: Cwd; tokens: string[] }> = [];
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
    out.push({ text: cmd.slice(last, i), start: last, cwd: '', tokens: [] });
    last = i + len;
    i += len - 1;
  }
  out.push({ text: cmd.slice(last), start: last, cwd: '', tokens: [] });

  /**
   * [SEC-288] **분기가 끝나면 cwd 는 「갈렸을 수 있다」.**
   * `if …; then cd .harness; else cd src; fi; echo x > config.yaml` 에서 마지막 `cd` 만 보면
   * `src/config.yaml` 로 읽혀 통과한다 — 실제로는 `.harness/config.yaml` 일 수 있다.
   * 그래서 분기·구문 끝 키워드를 만나고 그 전에 `cd` 가 있었으면 **모른다(null)** 로 둔다.
   * 모르면 대상이 미해결로 올라가고 이름 기반 안전망이 받는다.
   */
  const BRANCH_END = new Set(['else', 'elif', 'fi', 'done', 'esac']);
  let cwd: Cwd = '';
  let sawCd = false;
  for (const seg of out) {
    const tokens = tokenize(seg.text);
    seg.tokens = tokens;                                    // [COST-293] 한 번만 만든다
    if (sawCd && tokens.some(t => BRANCH_END.has(t))) cwd = null;
    seg.cwd = cwd;
    if (tokens.length === 0) continue;
    /**
     * [SEC-285] **작업 디렉토리를 바꾸는 것은 `cd` 만이 아니다.**
     * `env -C DIR cmd`·`env --chdir=DIR cmd` 는 감싼 명령을 **그 디렉토리에서** 돌린다 —
     * `env -C .harness sh -c "echo x > config.yaml"` 이 통과했고 정책 파일이 실제로 덮였다.
     * `cd` 와 달리 **그 세그먼트에만** 적용된다(뒤 세그먼트의 cwd 는 그대로다).
     * [SEC-232]·[SEC-259]·[SEC-280] 과 같은 「플래그가 위치를 정한다」 부류의 네 번째다.
     */
    const chdir = envChdirOf(tokens);
    if (chdir !== undefined) seg.cwd = advanceCwd(cwd, chdir);
    const { name, args } = commandName(tokens);
    if (name === 'cd' || name === 'pushd') { cwd = advanceCwd(cwd, args.find(a => !isFlag(a))); sawCd = true; }
  }
  return out;
}

/**
 * 원문 위치가 속한 세그먼트의 가상 cwd.
 *
 * [COST-260] **리다이렉트마다 전 세그먼트를 재순회하면 O(R·S) 다.** `cd x > f` 를 800번
 * 이어 붙인 8KB 명령 하나로 훅이 **15초** 걸렸고, 훅 타임아웃은 10초이며 **타임아웃은
 * fail-open** 이다 — 즉 상한 없는 2차는 그 자체로 방어를 끄는 입력이 된다([COST-228] 이
 * `pathLikeMentions` 에서 고친 것과 **같은 부류가 함수만 옮겨 앉은 것**이다).
 * `segs` 는 `start` 오름차순이므로 이진탐색으로 O(log S) 에 찾는다.
 */
function cwdAt(segs: ReadonlyArray<{ start: number; cwd: Cwd }>, index: number): Cwd {
  let lo = 0;
  let hi = segs.length - 1;
  let cwd: Cwd = '';
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].start <= index) { cwd = segs[mid].cwd; lo = mid + 1; } else { hi = mid - 1; }
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
/**
 * [SEC-280] **「값을 받는 플래그」는 도구마다 다르다 — 평평한 집합은 틀린 모양이었다.**
 *
 * 예전에는 접두 명령 전체에 하나의 집합을 썼고 거기에 `-i` 가 있었다. 그런데 `-i` 는
 * `stdbuf` 에서만 값을 받고 `env`·`sudo` 에서는 **값이 없는 플래그**다(`--ignore-environment`
 * / login shell). 그래서 `env -i sh -c "echo x > .harness/config.yaml"` 에서 walker 가
 * `sh` 를 `-i` 의 값으로 삼켜 **실행 단위를 놓쳤고**, 따옴표 안 문자열이 명령 이름 자리로
 * 올라가 래퍼가 열리지 않았다 — 정책 파일이 실제로 덮였다.
 *
 * [SEC-232]·[SEC-259] 와 같은 부류다: **위치·의미 가정을 도구를 가리지 않고 적었다.**
 * 목록에 없는 접두 명령은 「값 받는 플래그 없음」으로 본다 — 숫자 인자는 아래 `timeout 5`
 * 규칙이 이미 건너뛴다.
 */
const PREFIX_FLAG_VALUE: Record<string, ReadonlySet<string>> = {
  sudo: new Set(['-u', '-g', '-C', '-p', '-D', '-h', '-U', '-r', '-t',
                 '--user', '--group', '--close-from', '--prompt', '--chdir', '--host',
                 '--other-user', '--role', '--type']),
  doas: new Set(['-u', '-C']),
  env: new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string']),
  nice: new Set(['-n', '--adjustment']),
  ionice: new Set(['-c', '-n', '-p', '-P', '-u', '--class', '--classdata', '--pid', '--pgid', '--uid']),
  timeout: new Set(['-k', '-s', '--kill-after', '--signal']),
  stdbuf: new Set(['-i', '-o', '-e', '--input', '--output', '--error']),
  chroot: new Set(['--userspec', '--groups']),
  script: new Set(['-c', '--command', '--logging-format', '-B', '-I', '-O', '-T']),
  npx: new Set(['-p', '-c', '--package', '--call']),
  bunx: new Set(['-p', '--package']),
  pnpx: new Set(['-p', '--package']),
};
const EMPTY_FLAGS: ReadonlySet<string> = new Set();

/**
 * 명령 이름에서 경로·env 접두·**접두 명령**을 벗긴다 (`sudo -u x /usr/bin/tee` → `tee`).
 * 벗기다가 남는 것이 없으면 이름은 빈 문자열이다 — 그건 판정 대상이 아니다.
 */
/**
 * [SEC-288] **셸 «키워드»는 명령이 아니다 — 그 뒤가 명령이다.**
 *
 * `{ cd .harness; echo x > config.yaml; }` 에서 첫 세그먼트는 `{ cd .harness` 다.
 * 예전에는 `{` 를 명령 이름으로 읽어 **`cd` 를 못 봤고**, 그래서 뒤 세그먼트의 대상이
 * 루트 기준(`config.yaml`)으로 풀려 보호를 비껴갔다 — `if …; then cd .harness; …` ·
 * `while …; do cd .harness; …` 도 같다(`then`·`do` 가 이름 자리에 온다).
 * 실측으로 셋 다 통과했다.
 */
const SHELL_KEYWORDS = new Set(['{', '}', 'then', 'else', 'elif', 'do', 'done', 'fi',
  'esac', 'in', '!', 'if', 'while', 'until', 'case']);

function commandName(tokens: string[]): { name: string; args: string[] } {
  let i = 0;
  let lastPrefix = -1;                                                             // [SEC-280] 되돌아갈 자리
  for (;;) {
    while (i < tokens.length && SHELL_KEYWORDS.has(tokens[i])) i++;                // [SEC-288] 키워드
    while (i < tokens.length && ENV_ASSIGN_RE.test(tokens[i])) i++;   // env 대입
    const head = (tokens[i] ?? '').split('/').pop() ?? '';
    if (!PREFIX_COMMANDS.has(head)) break;
    lastPrefix = i;
    const takesValue = PREFIX_FLAG_VALUE[head] ?? EMPTY_FLAGS;                     // [SEC-280] 도구별
    i++;                                                                           // 접두 명령 자체
    while (i < tokens.length) {                                                    // 그 플래그·값
      const t = tokens[i];
      if (isFlag(t)) {
        i += takesValue.has(t) && i + 1 < tokens.length && !isFlag(tokens[i + 1]) ? 2 : 1;
        continue;
      }
      if (/^\d+(\.\d+)?[smhd]?$/.test(t)) { i++; continue; }                       // `timeout 5`
      break;
    }
  }
  /**
   * [SEC-280] **명령 이름에는 공백도 리다이렉트도 없다.** 위 walker 가 어긋나면 따옴표 안
   * 문자열 하나가 이름 자리로 올라오고, `split('/').pop()` 이 그것을 그럴듯한 이름
   * (`config.yaml`)으로 바꿔 **어긋났다는 사실 자체가 사라진다.**
   *
   * 그때는 **마지막 접두 명령 자리로 되돌아간다** — 벗기기가 틀렸다는 뜻이므로 벗기기 전
   * 상태가 더 참에 가깝다(`busybox -c '…'` 처럼 접두 명령이 곧 셸인 경우가 그렇다).
   * 되돌아가도 이름이 안 되면 「모른다」로 둔다 — 그럴듯한 이름을 지어내지 않는다.
   */
  let raw = tokens[i] ?? '';
  if (/[\s<>|]/.test(raw) && lastPrefix >= 0) { i = lastPrefix; raw = tokens[i] ?? ''; }
  if (/[\s<>|]/.test(raw)) return { name: '', args: [] };
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
   * [SEC-308] **미열거 쓰기도구의 슬래시 있는 피연산자.** `xxd`·`openssl`·`csplit`·`split` 처럼
   * 열거 밖 도구는 `mutating` 만 세우고 대상을 안 올린다 — 그 코어/정책 보호가 `scan.targets===0`
   * 게이트 net 에 의존했고, 곁가지 대상 하나로 net 이 꺼졌다. 호출측이 이 목록을 **코어/정책만**
   * 판정해 net 과 무관하게 막는다.
   */
  mutatingOperands: string[];
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

/**
 * 프로그램 텍스트를 받아 실행하는 해석기. 셸만이 아니다 — `python3` 도 stdin 을 읽는다.
 * [SEC-312] **이 집합이 SEC-311 「해석기 프로그램파일 미독」 봉인의 정본이다.** `opaqueExecOf`(파이프
 * 프로그램 판정)와 `interpreterProgramFiles`(프로그램파일 본문 읽기)가 **둘 다 여기서 파생**해야 한다 —
 * 20차 검증이 실증했듯, 여기(`deno`·`bun`)는 「호출측이 읽는다」고 통과시키는데 읽는 쪽이 이 목록보다
 * 좁으면 그 갭으로 위조가 통과한다. 흔한 비셸 해석기를 함께 담는다(tclsh·lua·Rscript). 여기에 없는
 * exotic 해석기(julia·groovy·raku…)는 순수-훅 열거의 한계로 남는다(README 「알려진 한계」·아래 잔여). */
const INTERPRETERS = new Set([
  ...SHELLS_TAKING_C,
  'node', 'nodejs', 'deno', 'bun', 'python', 'python2', 'python3',
  'perl', 'ruby', 'php', 'osascript', 'tclsh', 'lua', 'Rscript',
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
      if (args.some(a => !isFlag(a) && !ENV_ASSIGN_RE.test(a))) continue;

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
  // [SEC-281] 맨 대안에서 **따옴표를 뺀다.** `sh -c "echo x > .harness/config.yaml"` 처럼
  // 리다이렉트가 따옴표 «안»에 있으면 세그먼트 텍스트에서는 닫는 따옴표가 대상에 붙어
  // `.harness/config.yaml"` 이 됐다 — 정확한 이름 대조(`CORE_FILES.includes`)가 조용히 빗나간다.
  /**
   * [SEC-282] **escape 된 따옴표도 따옴표다.**
   * `awk "BEGIN{print \\"x\\" > \\"src/app.ts\\"}"` 처럼 대상이 `\\"…\\"` 로 싸이면
   * 예전 정규식은 맨 대안으로 떨어져 **역슬래시 한 글자**(`\\`)를 대상으로 잡았다 —
   * 진짜 경로가 판정에서 통째로 사라진다(설계 소스 덮어쓰기 실증). awk 안쪽 `>` 만의
   * 문제가 아니다: `echo x > \\"src/app.ts\\"` 도 같았다.
   * 맨 대안에서 역슬래시도 뺀다 — 남은 `\\` 는 경로가 아니라 **추출 실패의 흔적**이고,
   * 그것을 대상으로 올리면 [SEC-207] 의 「못 봤다를 없다로 읽지 않는다」 안전망이 안 뜬다.
   */
  /**
   * [SEC-300] 대상을 **한 토큰으로 통째로** 잡은 뒤 `tokenize` 로 셸 인용/이스케이프를 해소한다.
   * 예전 맨 대안 `[^\s;|&<>()"'\\]+` 은 `"' \` 를 제외해 `.harness/events\.jsonl`·`.harn"ess"/…` 를
   * **잘라** 코어·정책 보호가 통째로 새었다(전 페이즈·degraded 무관, 저널위조→배포게이트까지 실증).
   * 이제 따옴표 span·역슬래시 이스케이프·맨몸 글자의 **런**을 잡아, 셸이 실제로 착지시킬 경로를 판정한다.
   * [SEC-282] `\"…\"`·`\'…\'` (escape 로 감싼 형태)는 안쪽 경로가 대상이라 그대로 쓴다.
   */
  const re = /\d*>>?([|&])?\s*(?:\\"([^"]*)\\"|\\'([^']*)\\'|((?:"[^"]*"|'[^']*'|\\.|[^\s;|&<>()])+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    const amp = m[1] === '&';
    const escaped = m[2] ?? m[3];                       // [SEC-282] escape 로 감싼 안쪽 경로
    const t = escaped ?? (m[4] !== undefined ? (tokenize(m[4])[0] ?? m[4]) : '');
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
/**
 * [ENG-283] **`xargs` 인자 해석은 한 벌이다.**
 *
 * 예전에는 자리표시자를 찾는 쪽과 감싼 명령을 꺼내는 쪽이 **각자 플래그 표**를 들고 있었고,
 * `-i`·`--replace` 에서 답이 갈렸다 — 한쪽은 다음 토큰을 인자로 삼키고 한쪽은 안 삼켰다.
 * 같은 질문에 두 답이 있으면 **느슨한 쪽이 정본이 된다**([ENG-199] 와 같은 판단).
 * 그래서 한 번 훑어 둘 다 낸다.
 *
 * `-I` 만 다음 토큰을 **요구**한다. `-i`·`--replace` 는 인자가 선택이라 맨몸이면 기본 `{}` 다 —
 * 다음 토큰을 삼키면 `xargs -i sh -c …` 에서 `sh` 를 자리표시자로 읽는다(실측으로 뚫렸다).
 */
const XARGS_FLAG_VALUE = new Set(['-L', '-n', '-P', '-s', '-d', '-E', '-a', '--max-args',
  '--max-procs', '--delimiter', '--max-chars', '--arg-file']);

function parseXargs(args: string[]): { mark: string | undefined; rest: string[] } {
  let mark: string | undefined;
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (!isFlag(a)) break;
    if (a === '-I') {
      const next = args[i + 1];
      if (next !== undefined && !isFlag(next)) { mark ??= next; i += 2; continue; }
      mark ??= '{}'; i += 1; continue;
    }
    if (a === '-i' || a === '--replace') { mark ??= '{}'; i += 1; continue; }
    if (a.startsWith('--replace=')) { mark ??= a.slice('--replace='.length); i += 1; continue; }
    if (a.startsWith('-I') && a.length > 2) { mark ??= a.slice(2); i += 1; continue; }
    if (a.startsWith('-i') && a.length > 2) { mark ??= a.slice(2); i += 1; continue; }
    i += XARGS_FLAG_VALUE.has(a) && i + 1 < args.length && !isFlag(args[i + 1]) ? 2 : 1;
  }
  return { mark, rest: args.slice(i) };
}

/** [SEC-281] 치환 자리표시자 — `parseXargs` 한 벌에서 나온다. */
const replaceMarkOf = (args: string[]): string | undefined => parseXargs(args).mark;

/** xargs 가 감싼 진짜 명령 — `parseXargs` 한 벌에서 나온다. */
const innerCommandOf = (args: string[]): string[] => parseXargs(args).rest;

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
 * [SEC-310] **sed 는 `-i` 없이도 프로그램 «안»에서 파일에 쓴다** — `w file`·`W file`·`s///…w file`.
 * `CONDITIONAL_WRITERS.sed` 가 `-i` 만 보던 탓에 `sed 'w .harness/events.jsonl' /dev/null` 이
 * 저널을 절단·위조하는데 조회로 분류돼 통과했다(감정확인 18차, 끝단 실증). 프로그램 문자열에서
 * `w`/`W` 명령의 **대상 파일만** 뽑는다(입력 피연산자는 읽기이므로 올리지 않는다 — `/dev/null` 과차단 방지).
 */
function sedPrograms(args: string[]): string[] {
  const progs: string[] = [];
  let programTaken = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^-[A-Za-z]*e$/.test(a) && i + 1 < args.length) { progs.push(args[i + 1]); programTaken = true; i++; continue; }
    if (a === '--expression' && i + 1 < args.length) { progs.push(args[i + 1]); programTaken = true; i++; continue; }
    if (a.startsWith('--expression=')) { progs.push(a.slice('--expression='.length)); programTaken = true; continue; }
    if (isFlag(a)) continue;
    if (!programTaken) { progs.push(a); programTaken = true; }     // 첫 비플래그 = 프로그램
  }
  return progs;
}

function sedWriteTargets(args: string[]): string[] {
  const out: string[] = [];
  for (const p of sedPrograms(args)) {
    // 명령을 `;`·개행·`}` 로 나눈다. `[addr]w file` 또는 `s/…/…/…w file` 의 파일명은 줄 끝까지다.
    for (const raw of p.split(/[;\n}]/)) {
      const stmt = raw.trim();
      const w = /^(?:[0-9$,~+!]+|\/(?:\\.|[^/])*\/[IMm]*)?\s*[wW]\s+(\S.*)$/.exec(stmt);
      if (w) { out.push(w[1].trim()); continue; }
      const sw = /^(?:[0-9$,~+!]+|\/(?:\\.|[^/])*\/[IMm]*)?\s*s(.)(?:\\.|(?!\1).)*\1(?:\\.|(?!\1).)*\1[a-zA-Z0-9]*w\s+(\S.*)$/.exec(stmt);
      if (sw) out.push(sw[2].trim());
    }
  }
  return out;
}

/**
 * [SEC-311] **해석기가 «프로그램을 파일로» 받는 형태의 그 프로그램 파일들.**
 *
 * SEC-92/SEC-219 는 「에이전트가 쓴 스크립트를 실행하면 훅이 그 안을 못 본다」를 **셸에 대해서만**
 * 닫았다(`invokedScriptBodies` 는 셸·`npm run` 본문만 읽는다). 그러나 **비-셸 해석기가 프로그램을
 * «파일»로 받는 형태**(`sed -f prog.sed`·`awk -f prog.awk`·`perl x.pl`·`ruby x.rb`·`python3 x.py`·
 * `node x.js`)는 그 파일 본문을 아무도 읽지 않았다 — 코어 경로가 명령문 텍스트에 없으니 모든 net 이
 * 침묵했고, 그 안 `w .harness/events.jsonl`(sed)·`open(">",core)`(perl)로 저널·출하대장이 위조됐다
 * (감정확인 19차, 끝단 실증). 여기서 그 파일 경로들을 뽑아 호출측이 **셸 본문과 같은 태도**로 읽는다:
 * 루트 안이면 본문을 같은 코어/정책 잣대로 보고, 못 읽으면(캡 초과) fail-closed 로 사실을 고지한다.
 *
 * **프로그램 파일만** 뽑는다(입력·데이터 피연산자가 아니라):
 *  - `sed`/`awk`/`gawk`: `-f FILE`·`--file=FILE`(짧은 조합 `-nf`·붙임 `-fFILE` 포함)가 데려가는 파일.
 *    입력 피연산자(`sed -f p.sed .harness/config.yaml` 의 config)는 **읽기**라 올리지 않는다.
 *  - `perl`/`ruby`/`php`/`python*`/`node`/`nodejs`: **인라인 코드**(`-e`/`-c`/…)가 없을 때에 한해,
 *    경로처럼 생긴 비플래그 피연산자(스크립트 파일과 그 데이터). 인라인이면 피연산자는 데이터이고
 *    그 경우의 코드 판정은 `CONDITIONAL_WRITERS`+`pathLikeMentions` 가 이미 한다.
 *
 * 과독은 무해하다(데이터 파일이 코어를 언급할 일은 없다) — 놓치는 것만 구멍이므로 넉넉히 뽑는다.
 */
const SED_LIKE = new Set(['sed', 'awk', 'gawk']);
/**
 * [SEC-312] **비셸 해석기 집합은 정본(`INTERPRETERS`)에서 파생한다 — 손으로 다시 적지 않는다.**
 * 예전에 이 목록을 손으로 적었더니 `INTERPRETERS` 보다 좁아(`deno`·`bun`·`osascript` 누락) SEC-311
 * 봉인이 그 이름들로 다시 열렸다(20차 검증 실증). `opaqueExecOf` 가 「호출측이 읽는다」고 통과시키는
 * 집합과 **읽는 쪽이 반드시 같아야** 갭이 없다. 규칙이 두 벌이면 느슨한 쪽이 정본이 된다.
 */
const SCRIPT_INTERP = new Set([...INTERPRETERS].filter(n => !(SHELLS_TAKING_C as readonly string[]).includes(n)));

/**
 * [SEC-312] 버전 접미가 붙은 해석기 이름을 정본 이름으로 되돌린다 — `perl5.36`→`perl`·`python3.12`→`python3`
 * (뒤 `.NN` 을 한 번 벗겨 재확인). 접미 없는 이름은 그대로. 20차 검증이 `perl5.36 forge.pl` 로 뚫었다.
 */
const canonicalInterp = (name: string): string => {
  if (SED_LIKE.has(name) || SCRIPT_INTERP.has(name)) return name;
  const base = name.replace(/\d[\d.]*$/, '');
  return SED_LIKE.has(base) || SCRIPT_INTERP.has(base) ? base : name;
};

/** `-abc` 꼴 짧은 플래그 묶음에서 `hit` 글자가 `stop` 글자보다 먼저 나오는가(`--long`·비플래그는 무관). */
function shortFlagHas(tok: string, hit: string, stop: string): boolean {
  if (!SHORT_FLAG_RE.test(tok) || tok.startsWith('--')) return false;
  for (const c of tok.slice(1)) {
    if (hit.includes(c)) return true;
    if (stop.includes(c)) return false;               // 이 플래그가 나머지를 인자로 삼킨다
  }
  return false;
}

/** 이 해석기 호출이 **인라인 코드**(파일이 아니라)로 프로그램을 받는가 — 그러면 피연산자는 데이터다. */
function hasInlineProgram(name: string, args: readonly string[]): boolean {
  switch (name) {
    // perl `-e`/`-E`; `-M…`·`-I…`·`-F…` 등은 나머지를 인자로 삼키므로 그 안의 e 는 코드가 아니다.
    case 'perl': return args.some(a => shortFlagHas(a, 'eE', 'MmIFDCx0'));
    // ruby `-e`(만); `-E`(인코딩)·`-I`·`-r`·`-C`·`-K` 는 인자를 삼킨다.
    case 'ruby': return args.some(a => shortFlagHas(a, 'e', 'IrCEK'));
    case 'php': return args.some(a => shortFlagHas(a, 'rR', ''));
    case 'python': case 'python2': case 'python3':
      return args.some(a => a === '--command' || shortFlagHas(a, 'cm', 'WXQ'));
    // node/bun: `-e`/`-p`/`--eval`/`--print`. bun 은 node 호환 인라인을 받는다.
    case 'node': case 'nodejs': case 'bun':
      return args.some(a => a === '--eval' || a === '--print' || shortFlagHas(a, 'ep', ''));
    case 'osascript': return args.some(a => shortFlagHas(a, 'e', ''));
    // deno 는 인라인이 `deno eval` 서브커맨드(플래그 아님)이고, tclsh/lua/Rscript 는 파일형이 기본이라
    // 인라인 플래그가 없다 — 파일 피연산자를 그대로 읽는 게 안전한 쪽이다(과독 무해).
    default: return false;
  }
}

/** `sed`/`awk` 의 `-f FILE`·`--file=FILE`(조합·붙임 포함)가 데려가는 프로그램 파일들. */
function programFileFlagArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-f' || a === '--file') { if (i + 1 < args.length) { out.push(args[i + 1]); i++; } continue; }
    if (a.startsWith('--file=')) { out.push(a.slice('--file='.length)); continue; }
    if (!a.startsWith('-') || a.startsWith('--')) continue;
    for (let k = 1; k < a.length; k++) {
      const c = a[k];
      if (c === 'f') {                                 // `-f`·`-nf`(다음 토큰) 또는 `-fFILE`·`-nfFILE`(붙임)
        const rest = a.slice(k + 1);
        if (rest.length > 0) out.push(rest);
        else if (i + 1 < args.length) { out.push(args[i + 1]); i++; }
        break;
      }
      // 나머지를 인자로 삼키는 플래그(`-e`프로그램·`-i`접미·`-F`구분자·`-v`대입)에서 멈춘다.
      if ('eiFv'.includes(c)) { if (c === 'e' && k === a.length - 1) i++; break; }
    }
  }
  return out;
}

export function interpreterProgramFiles(cmd: string): string[] {
  const files: string[] = [];
  for (const line of commandLines(cmd)) {
    const toks = line.split(/\s+/);
    const name = canonicalInterp(toks[0] ?? '');            // [SEC-312] 버전접미 정규화
    const args = toks.slice(1);
    if (SED_LIKE.has(name)) files.push(...programFileFlagArgs(args));
    else if (SCRIPT_INTERP.has(name) && !hasInlineProgram(name, args)) {
      // [SEC-313] **인라인이 아니면 피연산자가 곧 프로그램 파일이다 — 파일명 모양을 다시 따지지 않는다.**
      // `looksLikePath` 로 거르면 `python3 pyscript`(무확장자)가 통째로 버려져 미독→통과했다(21차 검증,
      // config.yaml 실덮임). `sed -f prog`(모양 무관 추출)와의 비대칭이었다. 비플래그·비-env 피연산자를
      // 전부 올린다 — 뒤따르는 데이터·서브커맨드(`deno run`)는 없는 파일이라 읽기에서 걸러진다(과독 무해).
      files.push(...args.filter(a => !isFlag(a) && !ENV_ASSIGN_RE.test(a)));
    }
  }
  return files;
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
  /**
   * [EFF-289] **아무것도 쓰지 않는 셸 내장이 「모르는 명령」으로 분류돼 있었다.**
   * `test -f x && cat .harness/config.yaml` · `true; cat …` 처럼 **접두 한 조각**이
   * 명령 전체를 `mutating` 으로 만들고, 그러면 「대상이 없을 때 언급을 본다」 안전망이
   * 발화해 **순수 조회가 「쓸 수 없다」는 사유로** 거부됐다 — 사유까지 사실과 달랐다.
   * 여기 적는 것은 인자를 무엇으로 주든 파일을 만들지 않는 것들만이다
   * (`trap`·`eval`·`exec`·`source` 는 **넣지 않는다** — 남의 명령을 실행한다).
   */
  'true', 'false', ':', 'test', '[', '[[', ']]', 'sleep', 'wait',
  'break', 'continue', 'shift', 'return', 'exit', 'set', 'unset', 'export', 'readonly',
  'local', 'popd', 'dirs', 'jobs', 'umask', 'ulimit', 'times', 'help',
];

/**
 * [SEC-221] **쓰기 형태가 있는 조회 도구** — 그 형태일 때만 변형이다.
 *
 * 값은 「이 플래그가 있으면 쓴다」는 판정이다. 플래그 의미는 도구마다 다르므로
 * (`grep -o` 는 출력 파일이 아니라 only-matching 이다) **일반 규칙으로 뭉갤 수 없고**,
 * 여기 적은 것만 신뢰한다. 적지 않은 도구는 `READ_ONLY_HEADS` 에 없으면 기본값이 변형이다.
 */
const CONDITIONAL_WRITERS: Record<string, (args: readonly string[]) => boolean> = {
  // [SEC-286] 롱폼도 같은 일을 한다 — `sed --in-place=.bak` 은 `-i` 로 시작하지 않아
  // 이 조건을 통째로 비껴갔다. `yq`·`jq` 줄에는 롱폼이 있는데 여기만 빠져 있던
  // **거울 자리 누락**이다(같은 표에서 한 줄만 좁았다).
  sed: a => a.some(x => x === '-i' || x.startsWith('-i') || x.startsWith('--in-place')),
  /**
   * [SEC-270] **인라인 코드는 조회가 아니다.** `perl -e`/`-E`(ruby 도 같다)는 임의 코드를
   * 실행한다 — `perl -e 'unlink ".harness/events.jsonl"'` 로 저널이 지워지고
   * `open(F,">",…)` 로 정책이 덮인다. `-i` 만 보던 조건은 **제자리 편집**만 변형으로 쳤고,
   * 그래서 이 도구가 할 수 있는 일 중 가장 넓은 형태가 조회로 분류됐다.
   *
   * [EFF-214] 가 과차단을 고치며 이 도구들을 조회 쪽으로 옮겼고, [SEC-221] 이 그 목록의
   * 의미를 「모든 형태에서 조회인 것만」으로 바꿨다 — 그런데 `perl` 의 조건 자체가
   * 여전히 좁았다. **같은 부류의 세 번째 재발이다**(`awk -i inplace` · `yq -i` 에 이어).
   *
   * `ruby -e`·`python -c` 는 다른 경로로 이미 막히지만, 여기 함께 적는 이유는 **한 곳에서
   * 같은 답을 내게** 하려는 것이다 — 답이 두 곳에 있으면 언젠가 한쪽만 고쳐진다.
   */
  perl: a => a.some(x => x === '-i' || x.startsWith('-i') || x === '-e' || x === '-E'),
  ruby: a => a.some(x => x === '-i' || x.startsWith('-i') || x === '-e' || x === '-E'),
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
  // [SEC-311] 해석기가 프로그램을 «파일»로 받으면 그 파일이 무엇을 쓰는지 여기선 알 수 없다 —
  // `sed -f prog.sed`·`perl x.pl` 이 조회로 분류돼 활동 집계에서 빠지면 stop 가드 정산 강제가
  // 조용히 풀렸다(감정확인 19차). 프로그램 파일을 실행하는 형태는 조회로 인정하지 않는다.
  if (interpreterProgramFiles(cmd).length > 0) return false;
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
/**
 * [UTIL-239] `${VAR:-기본값}` 의 **기본값은 정적이다.**
 *
 * `${TMPDIR:-/tmp}/x` 는 값을 몰라도 **어디에 떨어지는지는 안다** — 둘 중 하나이고 둘 다
 * 프로젝트 밖이다. 그런데 브레이스 확장을 통째로 「못 보는 것」으로 취급해 전 페이즈에서
 * 막았다. [EFF-227] 이 `mktemp` 관용구에 쓴 논리와 같다: **못 보는 것과 안 보이는 것은 다르다.**
 * 환경변수에 값이 있으면 그것을, 없으면 기본값을 쓴다 — 어느 쪽이든 정적 성분이 생긴다.
 */
function expandBraceDefaults(cmd: string, env: Record<string, string | undefined>): string {
  return cmd.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-)([^}]*)\}/g,
    (_m, name: string, fallback: string) => env[name] ?? fallback);
}

/**
 * [EFF-287] **정적 목록을 도는 `for` 는 읽을 수 있다.**
 *
 * `for f in docs/a.md; do echo x > $f; done` 은 대상이 `$f` 라 「실행 시점에 계산된다」로
 * 떨어져 **문서 쓰기까지 막혔다**. 그런데 목록이 전부 리터럴이면 무엇에 쓰는지 여기서
 * 그대로 보인다 — 몰라서 막는 것과 알 수 있는데 막는 것은 다르다. 과차단은 이 제품에서
 * 결함과 같은 무게이므로([SEC-275] 선례) 볼 수 있는 것은 편다([SEC-216] 과 같은 판단).
 *
 * **정적이 아니면 손대지 않는다** — 변수·치환·글롭·따옴표·중첩이 하나라도 있으면 그대로 두어
 * 기존의 보수적 판정이 그대로 간다. 개수 상한은 명령문 하나가 판정을 부풀리지 않게 한다.
 */
const FOR_LOOP = /\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\n]*?)\s*(?:;|\n)\s*do\b([\s\S]*?)\bdone\b/g;

function expandStaticForLoops(cmd: string): string {
  return cmd.replace(FOR_LOOP, (whole: string, name: string, listRaw: string, body: string) => {
    if (/\bfor\b/.test(body)) return whole;                       // 중첩은 손대지 않는다
    const words = listRaw.trim().split(/\s+/).filter(w => w !== '');
    if (words.length === 0 || words.length > 32) return whole;
    if (words.some(w => /[$`*?[\]{}~"']/.test(w))) return whole;   // 정적이 아니다
    const re = new RegExp(`\\$\\{${name}\\}|\\$${name}(?![A-Za-z0-9_])`, 'g');
    return words.map(w => body.replace(re, w)).join(' ; ');
  });
}

export function expandStaticVars(rawCmd: string, env: Record<string, string | undefined> = {}): string {
  // [UTIL-239] 브레이스 기본값을 먼저 편다 — 그래야 아래 치환이 볼 수 있는 정적 성분이 된다.
  const cmd = expandStaticForLoops(expandBraceDefaults(rawCmd, env));
  const vars = staticAssignments(cmd, env);
  const lookup = (name: string): string | undefined => {
    const local = vars.get(name);
    if (local !== undefined) return local;
    /**
     * [SEC-279] **`PWD`·`OLDPWD` 는 훅 프로세스의 값으로 펴지 않는다.**
     *
     * 이 둘은 셸이 유지하는 값이고 `cd` 를 따라간다 — 훅 프로세스의 `process.env.PWD` 는
     * 명령이 실제로 도는 자리와 다를 수 있고, 실제로 달랐다:
     * `cd docs && echo x > $PWD/../.harness/config.yaml` 에서 셸의 `$PWD` 는 `<root>/docs`
     * 라 `..` 가 **루트**인데, 훅은 자기 env 의 `<root>` 로 펴서 `..` 를 **루트 밖(무해)**
     * 으로 읽었다 — [SEC-276] 과 똑같이 **기준점이 어긋나** 정책 파일이 실제로 덮였다.
     * `PWD` 는 아래 `resolveIn` 이 **세그먼트의 가상 cwd** 로 푼다(기준점이 하나여야 한다).
     * 명령문 안의 명시적 대입(`PWD=/x`)은 정적으로 보이므로 그대로 둔다.
     */
    if (name === 'PWD' || name === 'OLDPWD') return undefined;
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
/**
 * [SEC-259] **플래그가 값으로 지정하는 경로**를 한 곳에서 모은다.
 *
 * [SEC-232] 가 `cp -t` 하나를 고쳤지만 같은 모양이 다른 도구에도 있었다 —
 * `tar --directory=DIR`(=`-C` 의 긴 형태) · `rsync --backup-dir=DIR` ·
 * `git clone --separate-git-dir=DIR`. 도구마다 따로 적으면 그것이 곧 다음 사본이고,
 * 이 리포는 사본 드리프트로 여덟 번 뚫렸다. **세 표기를 한 함수가 안다**:
 * `-x VAL` · `-xVAL` · `--name VAL` · `--name=VAL`.
 */
function flagValues(args: readonly string[], names: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    for (const nm of names) {
      if (nm.length === 1) {
        /**
         * [SEC-264] **묶음 단축플래그도 같은 플래그다.** `cp -rt DIR SRC` 는 `-r -t DIR` 이고
         * GNU 가 실제로 그렇게 받는다 — 그런데 `-t` 만 정확히 찾으면 `-rt`·`-ft`·`-Dt`·`-st` 가
         * 통째로 비껴간다([SEC-232]→[SEC-259] 를 잇는 아홉 번째 변종이 정확히 이것이었다).
         * 묶음 안에서 값을 받는 문자가 나오면 **그 뒤 문자열이 값**이고, 뒤가 비면 다음 인자가 값이다.
         * 열거가 아니라 **파싱 규칙**을 따르는 이유는 이 리포가 아홉 번 배운 것과 같다 —
         * 표기를 세는 방식은 항상 다음 표기를 놓친다.
         */
        if (!a.startsWith('--') && a.startsWith('-') && a.length > 1) {
          const at = a.indexOf(nm, 1);
          if (at > 0) {
            const tail = a.slice(at + 1);
            if (tail !== '') out.push(tail);
            else { const v = args[i + 1]; if (v !== undefined && !isFlag(v)) out.push(v); }
          }
        }
      } else {
        if (a === `--${nm}`) { const v = args[i + 1]; if (v !== undefined && !isFlag(v)) out.push(v); }
        else if (a.startsWith(`--${nm}=`)) out.push(a.slice(nm.length + 3));
      }
    }
  }
  return out;
}

function targetDirectory(args: readonly string[]): string | null {
  return flagValues(args, ['t', 'target-directory'])[0] ?? null;
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
 * [SEC-268] **명령 안에서 «곧 생길» 별칭을 텍스트로 추적한다 — 열세 번째는 시간 층이었다.**
 *
 * 열두 표기는 전부 「경로를 어떻게 쓰느냐」(문자열)와 「어느 파일이냐」(inode) 층에 있었고,
 * 두 방어 모두 **판정 시점의 파일시스템**을 읽는다. 그런데 한 Bash 명령은
 * `ln -s .harness ./h && echo x > ./h/config.yaml` 처럼 **별칭을 먼저 만들고 나중에 쓴다** —
 * 판정 시점에 `./h` 는 없으므로 realpath 도 못 풀고 `statSync` 는 ENOENT 라 inode 대조도 안 돈다.
 * 심링크 방어와 하드링크 방어를 **동시에** 넘는다.
 *
 * 파일시스템에 물어서는 못 잡는다. 그러나 **명령문에는 다 적혀 있다** — 무엇을 무엇으로
 * 별칭 짓는지가 텍스트에 있다. 그래서 여기서는 파일시스템 대신 **명령문을 읽는다**:
 * 별칭을 만드는 세그먼트에서 `(별칭 → 원본)` 을 기록하고, 이후 세그먼트의 쓰기 대상이
 * 그 별칭(또는 그 아래 경로)이면 **원본으로도** 대상에 올린다.
 *
 * 과차단이 없는 이유: 별칭이 무해한 곳을 가리키면(`ln -s docs ./d`) 치환 결과도 무해한
 * 경로(`docs/new.md`)라 그대로 통과한다. 치환은 **판정 대상을 늘릴 뿐 판정을 바꾸지 않는다.**
 *
 * 한계는 정직하게: 두 개의 **다른 tool call** 로 나누면 이 절이 못 본다. 다만 그때는 별칭이
 * 실재하므로 realpath·inode 대조가 잡는다 — 두 방어가 서로의 사각을 덮는다.
 */
const LINK_MAKERS = new Set(['ln', 'link']);

/**
 * [SEC-276] 경로의 디렉토리 부분 — 가상 cwd 공간에서. `''` 는 프로젝트 루트다.
 * `path.dirname` 을 쓰지 않는 이유: 이 공간은 OS 경로가 아니라 **루트 기준 정규화 문자열**이고,
 * `path.dirname('')` 은 `'.'` 을 내 루트와 다른 값이 된다.
 */
function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '' : p.slice(0, i);
}

/** `cp` 가 하드링크를 만드는 형태인가 — `-l`·`--link`·`-al` 같은 묶음 포함. */
function cpMakesLink(args: readonly string[]): boolean {
  return args.some(a => a === '--link'
    || (!a.startsWith('--') && a.startsWith('-') && a.includes('l')));
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
  // [SEC-300] 줄이음(`\`+개행)을 세그먼트 분해 전에 접는다 — 셸이 지우는 것을 훅도 지운다.
  // [SEC-216] 볼 수 있는 대입은 먼저 편다 — 그래야 남는 것이 진짜 신호가 된다.
  const cmd = expandStaticVars(foldLineContinuations(rawCmd), env);
  const targets: string[] = [];
  /**
   * [SEC-268] 별칭 맵 — 이 명령 안에서 «곧 생길» 이름과 그것이 가리킬 원본.
   * 세그먼트를 순서대로 도므로, 별칭을 만든 뒤의 세그먼트만 그것을 본다(셸 의미론과 같다).
   */
  const aliases: Array<{ alias: string; real: string; at: number }> = [];
  /** 대상이 원문 어디에서 나왔는지 — 별칭보다 **뒤**의 쓰기만 치환하려면 필요하다. */
  const placed: Array<{ path: string; at: number }> = [];
  /** [SEC-274]·[SEC-276] 링크가 «가리키는 곳» — 링크 종류에 맞는 기준으로 푼 값. */
  const linkSources: Array<{ path: string; at: number }> = [];
  let mutating = false;
  let patchesWorkingTree = false;
  let appliesPatch = false;
  const patchFiles: string[] = [];
  let opaqueExec = opaqueExecOf(cmd);

  const unresolvedTargets: string[] = [];
  /**
   * [SEC-308] 미열거 쓰기도구(`xxd`·`openssl`·`csplit`·`split` …)의 **슬래시 있는 피연산자**.
   * 이 도구들은 `mutating` 만 세우고 대상을 안 올려, 코어/정책 보호가 `scan.targets===0` 게이트
   * net 에만 의존했다 — 곁가지 대상(`2>/tmp/err` 조차) 하나로 net 이 꺼졌다(감정확인 16차).
   * 호출측이 이 목록을 **코어/정책만**(coreOnly) 판정해 net 과 무관하게 막는다. 입력파일까지
   * 들어오지만 코어/정책이 아니면 통과라 과차단이 거의 없다(`cat`·`cp` 는 여기 안 옴 — 읽기/열거).
   */
  const mutatingOperands: string[] = [];
  const segs = segmentsWithIndex(cmd);

  // 리다이렉트는 세그먼트 분해 전에 원문에서 훑는다 — `>` 자체는 분해 기준이 아니고,
  // `2>&1` 의 `&` 가 분해 기준이라 세그먼트로 끊으면 리다이렉트가 반토막 난다.
  // 대신 **매치 위치**로 자기 세그먼트의 cwd 를 찾아 정규화한다([SEC-170]).
  /**
   * [SEC-281] **이 명령 안에서 「실행 시점에 바뀌는」 이름들.**
   * `xargs -I{}` 의 `{}`·`find -exec` 의 `{}` 가 그것이다. 리다이렉트는 세그먼트 분해 전에
   * 원문에서 훑으므로 여기서 한 번 모아 두고, 대상이 그것을 품으면 리터럴이 아니라
   * **「모른다」**로 올린다 — `{}` 를 파일 이름으로 읽으면 어떤 보호 경로에도 안 걸린다.
   */
  const substMarks = new Set<string>();
  for (const seg of segs) {
    const t = seg.tokens;                                   // [COST-293] 이미 만들어 둔 것
    if (t.length === 0) continue;
    const c = commandName(t);
    if (c.name === 'xargs') {
      const mk = replaceMarkOf(c.args);
      if (mk !== undefined && mk !== '') substMarks.add(mk);
    } else if (c.name === 'find' && c.args.some(a => ['-exec', '-execdir', '-ok', '-okdir'].includes(a))) {
      substMarks.add('{}');
    }
  }
  const isSubst = (t: string): boolean => [...substMarks].some(m => t.includes(m));

  const redirects = redirectTargets(cmd);
  if (redirects.length > 0) mutating = true;
  for (const r of redirects) {
    if (isSubst(r.path)) { unresolvedTargets.push(r.path); continue; }
    const resolved = resolveIn(cwdAt(segs, r.index), r.path);
    if (resolved === null) unresolvedTargets.push(r.path);
    else { targets.push(resolved); placed.push({ path: resolved, at: r.index }); }
  }


  for (const seg of segs) {
    const segment = seg.text;
    const firstNew = targets.length;
    const tokens = seg.tokens;                              // [COST-293] 이미 만들어 둔 것
    if (tokens.length === 0) continue;
    const { name, args } = commandName(tokens);
    // [SEC-268] 별칭을 만드는 세그먼트인가 — `ln`·`link`·`cp -l` 계열.
    if (LINK_MAKERS.has(name) || (name === 'cp' && cpMakesLink(args))) {
      const ops = args.filter(a => !isFlag(a) && !/^[a-z]+=/.test(a));
      if (ops.length >= 2) {
        const rawTarget = ops[ops.length - 2];
        const dst = resolveIn(seg.cwd, ops[ops.length - 1]);
        /**
         * [SEC-276] **심링크의 상대 타깃은 「링크가 놓인 자리」 기준으로 풀린다.**
         *
         * 예전에는 타깃도 cwd 기준으로 풀었다. 그런데 `ln -s ../ d/u` 는 링크를 `d/` 안에
         * 만들고, 그 안에서 `../` 는 **루트**를 가리킨다 — 훅은 「루트 밖(무해)」으로 읽고
         * 런타임은 「루트 안(코어)」에 착지해 **깊이만큼 어긋났다.** 그 어긋남으로
         * `echo x > d/u/.harness/config.yaml` 이 통과했다(끝단 실증됨).
         *
         * 하드링크는 다르다 — 그때 상대경로는 **명령을 실행하는 cwd** 기준이라 원래대로 둔다.
         * 절대경로는 둘 다 같으므로 구분할 필요가 없다.
         */
        const symbolicLink = args.some(a => a === '-s' || a === '--symbolic'
          || (!a.startsWith('--') && a.startsWith('-') && !a.startsWith('--') && a.includes('s')));
        const base = symbolicLink && !rawTarget.startsWith('/') && dst !== null
          ? dirOf(dst)
          : seg.cwd;
        const src = resolveIn(base, rawTarget);
        if (src !== null && dst !== null && dst !== src) aliases.push({ alias: dst, real: src, at: seg.start });
        // 소스도 대상으로 올릴 때 같은 기준을 쓴다([SEC-274]) — 두 기준이 갈리면 그것이 사본이다.
        if (src !== null) linkSources.push({ path: src, at: seg.start });
      }
    }
    if (MUTATING_TOKENS.includes(name)) mutating = true;

    // [SEC-170] `cd` 대상을 정적으로 못 읽으면 이 세그먼트의 상대경로가 **어디에 떨어지는지
    // 알 수 없다**. 변수 한 줄(`D=.harness; cd $D && tee events.jsonl`)로 방어가 다시 풀리면
    // 안 되므로, 경로처럼 생긴 인자를 전부 미해결로 올린다 — 호출측은 그중 **하네스 소유
    // 파일 이름**만 막는다(경로 전체가 아니라 이름만 보는 것이 과차단을 최소로 두는 선택이다).
    /**
     * [SEC-291] **조회의 인자는 쓰기 대상이 아니다.** 예전에는 호출측이 이 목록에서
     * 「하네스 소유 파일 «이름»」만 봤으므로 조회 인자가 섞여도 무해했다. 이제는 호출측이
     * 같은 판정 함수에 이름을 물어보므로(설계 트랙은 확장자로도 판정한다) 여기에 조회
     * 인자를 넣으면 `cd $D && cat app.ts` 같은 **읽기가 거부된다.**
     * 그래서 이 세그먼트가 실제로 쓰는 명령일 때만 올린다 — 분류는 아래 기본 분기와 같은 규칙이다.
     */
    const condWriter = CONDITIONAL_WRITERS[name];
    const segmentWrites = condWriter !== undefined
      ? condWriter(args)
      : !READ_ONLY_HEADS.includes(name);
    if (seg.cwd === null && segmentWrites) unresolvedTargets.push(...args.filter(looksLikePath));

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
        /**
         * [SEC-270] **판정은 `CONDITIONAL_WRITERS` 한 곳에서 나온다.** 예전에는 이 자리가
         * `-i` 를 **직접** 물어서, 그 목록을 고쳐도 여기가 안 따라왔다 — 같은 질문에 두 답이
         * 있으면 느슨한 쪽이 정본이 된다(이 리포가 아홉 번 배운 것).
         * `perl -e` 처럼 **인라인 코드**를 받는 형태는 임의 쓰기가 가능하므로, 그때는
         * 스크립트 인자뿐 아니라 **코드 문자열 안의 경로**도 대상으로 올린다.
         */
        if (CONDITIONAL_WRITERS[name]?.(args) === true) {
          mutating = true;
          targets.push(...scriptFiles(name, args));
          const inline = args.filter((a, i) => ['-e', '-E'].includes(args[i - 1] ?? ''));
          for (const code of inline) targets.push(...pathLikeMentions(code));
        }
        // [SEC-310] sed 는 `-i` 없이 프로그램 안 `w`/`W`/`s///w` 로 파일에 쓴다 — 그 대상만 올린다.
        if (name === 'sed') {
          const wt = sedWriteTargets(args);
          if (wt.length > 0) { mutating = true; targets.push(...wt); }
        }
        break;
      case 'cp':
      case 'install': {
        // 목적지는 마지막 피연산자다. 원본은 읽기이므로 대상이 아니다.
        const dir = targetDirectory(args);            // [SEC-232] 단, 플래그가 있으면 그것이 정본이다
        if (dir !== null) { targets.push(...underDir(dir, sourcesFor(operands, dir))); break; }
        if (operands.length >= 1) targets.push(operands[operands.length - 1]);
        /**
         * [SEC-268] **`cp -l` 은 복사가 아니라 하드링크다 — 그때는 원본도 대상이다.**
         * [SEC-263] 이 `ln` 에 세운 규칙(「이 파일에 쓸 수 있는 새 이름을 만드는 것은 그
         * 파일에 쓰는 것과 같은 무게다」)이 `cp` 쪽에는 없어 비대칭이 남았다. 코어 파일은
         * 쓰기 시점 inode 대조가 뒤를 받치지만 **설계 소스는 생성 차단에만 의존**하므로,
         * 생성 동사가 하나 빠지면 그만큼 그대로 열린다.
         */
        if (name === 'cp' && cpMakesLink(args) && operands.length >= 2) {
          targets.push(...operands.slice(0, -1));
        }
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
      case 'ln':
      case 'link': {
        const dir = targetDirectory(args);            // [SEC-232]
        if (dir !== null) { targets.push(...underDir(dir, sourcesFor(operands, dir))); break; }
        // 심링크는 **링크 이름**이 생기는 자리다(마지막 인자). 대상 파일은 건드리지 않는다.
        if (operands.length >= 1) targets.push(operands[operands.length - 1]);
        /**
         * [SEC-263] **하드링크의 소스도 대상이다 — 새 이름이 곧 그 파일이기 때문이다.**
         *
         * 심링크는 `realpath` 가 풀어 주므로 앨리어스에 쓰면 원본이 판정에 올라온다.
         * **하드링크는 풀 링크가 없다** — 같은 inode 를 가리키는 대등한 이름이라
         * `realpath('./alias')` 는 `./alias` 자신을 낸다. 그래서 여섯 라운드 동안 쌓은
         * 경로 문자열 층의 방어가 **원리상 닿지 못한다**(열두 번째 표기).
         *
         * `-s` 가 없으면 하드링크다. 그때는 **소스를 대상으로 올린다** — 「이 파일에 쓸 수
         * 있는 새 이름을 만든다」는 것은 그 파일에 쓰는 것과 같은 무게다.
         * 이미 만들어져 있는 링크는 이 절이 못 잡으므로, 쓰기 시점의 inode 대조가 짝이다.
         */
        /**
         * [SEC-274] **심링크 생성도 소스를 판정에 올린다.**
         *
         * 예전에는 하드링크만 올렸다 — 「심링크는 만들어도 쓰기가 아니고, 그 링크로 쓰면
         * `realpath` 가 잡는다」는 논리였다. 그 논리의 구멍은 **링크를 만든 다음 아카이브에
         * 넣는 것**이다: `ln -s .harness h && tar -cf e.tar h` 로 별칭을 아카이브에 담고,
         * 나중에 전개하면 판정 시점에 별칭이 없어 [SEC-268] 의 텍스트 추적도 비껴간다.
         * 에이전트가 **자력으로** 악성 아카이브를 만드는 4단계 사슬의 첫 칸이 여기였다.
         *
         * 소스를 대상으로 올리면 판정이 알아서 좁힌다 — `.harness` 나 설계 소스를 가리키면
         * 막히고, `docs`·`/tmp` 를 가리키면 그대로 통과한다. 「무엇을 가리키느냐」가 기준이지
         * 「링크를 만드느냐」가 기준이 아니다.
         */
        // [SEC-276] 소스는 위에서 **링크 종류에 맞는 기준**으로 이미 풀어 뒀다(`linkSources`).
        // 여기서 다시 풀면 기준이 두 벌이 되고, 그 차이가 정확히 이 결함이었다.
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
        // [SEC-259] 긴 형태도 같은 뜻이다 — `tar --directory=DIR` 은 `-C DIR` 이고,
        // 예전에는 짧은 형태만 봐서 긴 형태로 쓰면 전개 위치가 판정에서 사라졌다.
        targets.push(...(name === 'unzip'
          ? flagValues(args, ['d'])
          : flagValues(args, ['C', 'directory'])));
        break;
      }
      case 'rsync':
      case 'scp':
        // 목적지는 마지막 피연산자다(cp 와 같은 규칙).
        if (operands.length >= 1) targets.push(operands[operands.length - 1]);
        /**
         * [SEC-259] rsync 는 **목적지 말고도 파일을 쓴다.** 백업본·배치파일·로그·부분파일이
         * 전부 플래그로 자리를 지정받는다. `-t` 처방([SEC-232])을 여기 못 쓰는 이유는
         * rsync 의 `-t` 가 `--times` 라서이지, **위치 가정이 안전해서가 아니다** —
         * 그 구분을 안 하면 「rsync 는 예외」로 남겨 둔 자리가 그대로 구멍이 된다.
         */
        if (name === 'rsync') {
          targets.push(...flagValues(args, [
            'backup-dir', 'write-batch', 'only-write-batch', 'log-file', 'partial-dir', 'temp-dir',
          ]));
        }
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
          const rest = operands.slice(ci + 1).filter(a => !URL_SCHEME_RE.test(a) && !a.includes('@'));
          if (rest.length >= 1) targets.push(rest[rest.length - 1]);
          // [SEC-259] `--separate-git-dir=DIR` 은 저장소 실체를 그 자리에 만든다 — 위치가 아니라 플래그다.
          targets.push(...flagValues(args, ['separate-git-dir']));
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
            if (DASH_C_RE.test(args[i]) && i + 1 < args.length) { inner.push(args[i + 1]); i++; }
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
          /**
           * [SEC-281] **치환 자리표시자는 파일 이름이 아니다.**
           * `xargs -I{} sh -c "echo x > {}" <<< "src/app.ts"` 에서 `{}` 를 리터럴 대상으로
           * 읽으면 판정은 「`{}` 라는 파일에 쓴다」가 되어 **어떤 보호 경로에도 안 걸린다** —
           * 실제로는 stdin 이 준 `src/app.ts` 에 쓴다(설계 소스 덮어쓰기 실증됨).
           * 자리표시자는 `-I` 가 정하므로 이름을 가릴 필요가 없다(`{}`·`%`·`@` 무엇이든).
           * 「모른다」로 올리면 호출측 안전망(이름·언급 기반)이 그대로 받는다.
           */
          const mark = replaceMarkOf(args);
          for (const t of sub.targets) {
            if (mark !== undefined && t.includes(mark)) unresolvedTargets.push(t);
            else targets.push(t);
          }
          unresolvedTargets.push(...sub.unresolvedTargets);
          /**
           * [SEC-281] **거울 자리 — `sh -c` 분기는 올리는데 여기는 안 올렸다.**
           * `echo src/app.ts | xargs -I{} cp /tmp/x {}` 은 감싼 안쪽이 `cp`(변형)인데
           * `mutating` 이 false 로 남아 호출측 안전망이 **하나도 발화하지 않았다.**
           * 안쪽이 변형이면 바깥도 변형이다 — 래퍼는 사실을 가리지 않는다.
           */
          if (sub.mutating) mutating = true;
          if (sub.patchesWorkingTree) patchesWorkingTree = true;
          if (sub.appliesPatch) { appliesPatch = true; patchFiles.push(...sub.patchFiles); }
          opaqueExec ??= sub.opaqueExec;
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
        if (name && !READ_ONLY_HEADS.includes(name) && cond === undefined) {
          mutating = true;
          // [SEC-308/17차] 네비게이션 빌트인(`cd`·`pushd`·`popd`)은 파일을 쓰지 않는다 — 그 인자
          // (`cd .harness`)를 쓰기 대상으로 수집하면 보호 디렉토리 자체가 과차단된다. mutating 은
          // 기존대로 두되(다음 세그먼트 cwd 추적은 별도) 피연산자 수집만 건너뛴다.
          const nav = name === 'cd' || name === 'pushd' || name === 'popd';
          /**
           * [SEC-308/17차] 호출측이 **coreOnly** 로만 보므로 「경로일 수 있는 것」을 넓게 올려도
           * 코어/정책만 막힌다(비-코어는 통과 → `node build.js` 무해). 그래서 세 형태를 다 담는다:
           * ① **위치 피연산자 전부**(슬래시 없어도 — `cd .harness && … events.jsonl` 은 cwd 로 풀면 코어).
           * ② **플래그에 붙은 값**(`-o.harness/x`·`--out=.harness/x`) — 예전엔 flag 라 걸러졌다.
           * ③ **인라인 코드**(`-c`/`-e`) 안의 경로 언급(`python3 -c "open('.harness/events.jsonl')"`).
           * 슬래시-없는-코어(cd basename)·인터프리터코드·flag-attached 세 우회를 함께 닫는다.
           */
          if (!nav) {
            const cand: string[] = [...operands];
            for (let i = 0; i < args.length; i++) {
              const a = args[i];
              const eq = /^--?[A-Za-z][\w-]*=(.+)$/.exec(a);
              if (eq) cand.push(eq[1]);
              else if (SHORT_FLAG_RE.test(a) && a.length > 2) cand.push(a.slice(2));
              if (['-c', '-e', '-E'].includes(a) && i + 1 < args.length) cand.push(...pathLikeMentions(args[i + 1]));
            }
            for (const a of cand) {
              if (a === '' || isFlag(a)) continue;
              const r = resolveIn(seg.cwd, a);
              mutatingOperands.push(r ?? a);
            }
          }
        }
        break;
      }
    }

    // [SEC-170] 이 세그먼트가 올린 대상을 **그 세그먼트의 가상 cwd 기준으로** 정규화한다.
    // 여기서 한 번에 하는 이유: 위 `case` 는 스무 곳이 넘고, 각자 정규화하게 두면
    // 언젠가 한 곳이 빠진다 — 그리고 빠진 한 곳이 그대로 통로가 된다.
    for (let i = firstNew; i < targets.length; i++) {
      const resolved = resolveIn(seg.cwd, targets[i]);
      if (resolved === null) { unresolvedTargets.push(targets[i]); targets[i] = ''; }
      else { targets[i] = resolved; placed.push({ path: resolved, at: seg.start }); }
    }
  }

  /**
   * [SEC-268] **별칭을 지나 원본까지 판정에 올린다.** 이 명령 안에서 `./h → .harness` 로
   * 별칭이 생긴다면, `./h/config.yaml` 에 쓰는 것은 `.harness/config.yaml` 에 쓰는 것이다.
   * 파일시스템은 아직 그 사실을 모르지만 **명령문은 알고 있다.**
   * 치환은 대상을 **늘릴 뿐** 원래 대상을 지우지 않는다 — 판정이 느슨해지지 않게.
   */
  // [SEC-274]·[SEC-276] 링크가 가리키는 곳을 판정 대상으로 올린다.
  for (const { path: p } of linkSources) targets.push(p);

  for (const { alias, real, at } of aliases) {
    for (const { path: t, at: tAt } of placed) {
      // **별칭이 생긴 뒤의 쓰기만** 치환한다. 별칭을 만드는 그 세그먼트가 올린 대상
      // (`ln -s <코어> ./slink` 의 `./slink`)까지 치환하면 **심링크를 만드는 것 자체**가
      // 막힌다 — 만드는 것은 아직 쓰기가 아니고, 그 링크에 쓰면 realpath 가 잡는다.
      if (tAt <= at) continue;
      if (t === alias) targets.push(real);
      else if (t.startsWith(`${alias}/`)) {
        // [SEC-276] `real` 이 빈 문자열이면 링크가 **루트**를 가리킨다(`ln -s ../ d/u`).
        // 그대로 이으면 `/`로 시작하는 절대경로가 되어 루트 밖으로 읽힌다 — 그 어긋남이
        // 정확히 이 결함이었다. 루트일 때는 접두만 벗긴다.
        const rest = t.slice(alias.length + 1);
        targets.push(real === '' ? rest : `${real}/${rest}`);
      }
    }
  }

  // 중복 제거 — 같은 대상으로 두 번 deny 사유를 만들 이유가 없다.
  return {
    targets: [...new Set(targets.filter(Boolean))],
    mutating, patchesWorkingTree, appliesPatch, opaqueExec,
    patchFiles: [...new Set(patchFiles.filter(Boolean))],
    unresolvedTargets: [...new Set(unresolvedTargets.filter(Boolean))],
    mutatingOperands: [...new Set(mutatingOperands.filter(Boolean))],
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

/**
 * [ENG-O1] **배포 판정에 쓸 줄들 — 나누기가 정규화보다 먼저다.**
 *
 * [ENG-236] 이 dry-run 예외를 한 벌로 모았는데도 **개행 구분자에서 다시 갈렸다**:
 * 프로파일 쪽이 `\s+ → ' '` 로 **먼저 정규화**해 두 줄을 한 줄로 만든 뒤 나눴기 때문에,
 * `A --dry-run⏎A` 가 「`--dry-run` 이 있는 한 줄」이 되어 통째로 사면됐다.
 * 규칙이 같아도 **적용 순서가 다르면 답이 갈린다** — 그래서 순서까지 여기 한 곳에 둔다.
 * 호출측 고유의 정규화(대소문자·공백)는 이 함수가 나눈 **뒤에** 붙인다.
 */
export function judgeableLines(cmd: string): string[] {
  return commandLines(cmd).filter(line => !isDryRun(line));
}

export function commandLines(cmd: string): string[] {
  const out: string[] = [];
  // [SEC-300] 줄이음을 세그먼트 분해 전에 접는다 — 배포/인터프리터 판정도 같은 맹점이 있었다.
  for (const segment of foldLineContinuations(cmd).split(SEGMENT_SPLIT)) {
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
        if (DASH_C_RE.test(args[i]) && i + 1 < args.length) { inner.push(args[i + 1]); i++; }
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
      for (const t of seg.tokens) {          // [COST-293] 이미 만들어 둔 것
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
