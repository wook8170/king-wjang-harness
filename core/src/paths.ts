import * as fs from 'node:fs';
import * as path from 'node:path';

export const harnessDir = (root: string) => path.join(root, '.harness');
export const statePath = (root: string) => path.join(harnessDir(root), 'state.json');
export const eventsPath = (root: string) => path.join(harnessDir(root), 'events.jsonl');
export const configPath = (root: string) => path.join(harnessDir(root), 'config.yaml');
export const designDir = (root: string) => path.join(harnessDir(root), 'design');
export const ledgerPath = (root: string) => path.join(designDir(root), 'ledger.yaml');
/** 산출물 레지스트리(DOC-x 노드) — 설계 원장과 나란히 둔다(§3-7). */
export const registryPath = (root: string) => path.join(designDir(root), 'registry.yaml');
/** 게이트 리뷰 패킷 산출 위치(§4-3). */
export const packetsDir = (root: string) => path.join(harnessDir(root), 'packets');
export const wavesDir = (root: string) => path.join(harnessDir(root), 'waves');
export const wavePath = (root: string, id: string) => path.join(wavesDir(root), `${id}.md`);
export const evidenceDir = (root: string, waveId: string) =>
  path.join(harnessDir(root), 'evidence', waveId);
export const runtimeDir = (root: string) => path.join(harnessDir(root), '.runtime');

/**
 * [UX-15] **사람에게 내미는 명령은 사람의 터미널에서 그대로 돌아야 한다.**
 *
 * 플러그인으로 설치되면 이 CLI 는 플러그인 캐시(~/.claude/plugins/cache/... 아래 버전
 * 디렉토리)의 bin/ 에 놓이고 **사용자 셸의 PATH 에는 없다.** 에이전트 세션은 그 경로를 이미
 * export 해 두므로 짧은 이름으로 부를 수 있지만, 그 출력을 복사한 사람의 터미널에서는
 * "command not found" 가 난다. 하필 그렇게 안내되는 것이 게이트 승인이다 — **사람만 실행할
 * 수 있는 명령**이라, 사람이 못 치면 게이트가 열리지 않는다. 실제 사고: P1 제출 뒤 안내문을
 * 그대로 복사한 사용자가 여기서 막혔다.
 *
 * 경로는 **런타임에 푼다**(하드코딩하면 설치 위치·버전이 바뀔 때마다 안내가 거짓말이 된다).
 * __dirname 은 <install>/core/dist(번들) 또는 <install>/core/src(테스트) 이므로 두 단계 위가
 * 설치 루트다 — profile.ts 의 번들 프로파일 경로와 hook.ts 의 harnessProgramFiles 가 이미 같은
 * 가정 위에 서 있다. 심링크는 realpath 로 편다.
 */
let cachedCliPath: string | undefined;

/** 이 프로세스를 돌리고 있는 실행 파일의 절대 경로 — 셸에 그대로 붙여 넣을 수 있는 형태. */
export function harnessCliPath(): string {
  if (cachedCliPath !== undefined) return cachedCliPath;
  const candidate = path.resolve(__dirname, '..', '..', 'bin', 'harness');
  // 못 찾으면 짧은 이름으로 둔다 — 부분 설치에서 안내가 통째로 사라지는 것보다 낫다.
  let resolved = 'harness';
  try {
    if (fs.statSync(candidate).isFile()) resolved = fs.realpathSync(candidate);
  } catch { /* 번들만 떼어 온 설치 — 폴백 */ }
  cachedCliPath = shellQuote(resolved);
  return cachedCliPath;
}

/** 사람이 자기 터미널에 그대로 붙여 넣는 명령 한 줄(절대 경로 포함). */
export function humanCmd(args: string): string {
  return harnessCliPath() + ' ' + args;
}

/** 붙여 넣어 **그대로 도는 것**이 목적이므로 공백·메타문자가 있으면 따옴표로 싼다. */
function shellQuote(p: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/u.test(p) ? p : "'" + p.replace(/'/gu, "'\\''") + "'";
}

/**
 * [SEC-295] **「프로젝트 안인가」는 하나의 규칙이다 — 문구는 표면마다 다르더라도.**
 *
 * 게이트 제출은 루트 밖 경로를 거부한다(「심사자가 리포에서 볼 수 없는 파일에 승인 도장을
 * 찍을 수는 없다」). 그런데 **문서 등록(`doc upsert`)은 받고 있었다** — 그리고 등록된 문서는
 * 그 페이즈의 리뷰 패킷에 「심사 대상」으로 실린다. 실측: `../outside.txt`·`/etc/hosts` 가
 * P0 패킷에 그대로 올라갔다. 같은 질문에 두 답이 있으면 느슨한 쪽이 정본이 된다.
 *
 * 심링크로 밖을 가리키는 경우까지 보려면 실경로로 비교해야 한다. 아직 없는 파일은
 * **존재하는 가장 가까운 조상**까지 풀고 나머지를 다시 붙인다([VAL-134]) — 「없다」를
 * 「밖이다」로 말하면 사람이 무엇을 고쳐야 할지 알 수 없다.
 */
export function realOrNearest(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...rest.reverse()); } catch { /* 위로 */ }
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(p);        // 루트까지 못 풀면 리터럴
    rest.push(path.basename(cur));
    cur = parent;
  }
}

/** 이 경로가 프로젝트 루트 안인가 — 판정만 한다(사유 문구는 호출측이 낸다). */
export function isInsideRoot(root: string, p: string): boolean {
  const rel = path.relative(realOrNearest(root), realOrNearest(path.resolve(root, p)));
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
