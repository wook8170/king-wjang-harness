/**
 * 스택 프로파일(스펙 §9).
 *
 * **코어는 "무엇을", 프로파일은 "어떻게".** 코어는 추상적으로만 묻는다 — "테스트 돌려",
 * "여기가 소스 경로냐", "이 명령이 배포냐". 구체값은 전부 프로파일이 준다. 이 분리가
 * 무너지는 순간 §4-2 차단 매트릭스는 하드코딩된 Next.js 전용 장치가 되고, 다른 스택에서는
 * 강제가 통째로 헛돈다(막아야 할 것을 안 막거나, 설계 문서 작성을 막거나 — 둘 다 나쁘다).
 *
 * 코어가 이 모듈에 던지는 질문은 셋뿐이다:
 *  - `isSourcePath`  — 설계 트랙(P0~P6) Write/Edit 차단의 입력 (§4-2)
 *  - `isDeployCommand` — 게이트 미승인 배포 차단의 입력 (§4-2)
 *  - `commandFor`    — test/build/deploy/e2e/dev-server 명령 조회 (§9 commands.yaml)
 *
 * ## 해석 순서
 *
 *  1. **프로젝트 로컬** `.harness/profile/` — 있으면 무조건 이긴다. 번들 밖 스택은 §5의
 *     스캐폴딩으로 여기에 생긴다. 번들 쪽으로 되돌리려면 이 디렉토리를 지워라.
 *  2. **번들** `profiles/<이름>/` — 이름은 인자, 없으면 `.harness/config.yaml` 의 `profile`.
 *  3. **번들 generic** — 위가 다 실패했을 때의 바닥.
 *  4. **코드 내장 `GENERIC_FLOOR`** — `profiles/` 자체가 없거나 깨졌을 때의 마지막 바닥.
 *
 * 4단계가 필요한 이유: 이 모듈은 훅 경로에서 불린다. 프로파일을 못 읽었다고 빈 프로파일을
 * 돌려주면 `isSourcePath` 가 전부 false 가 되어 **설계 트랙 차단이 조용히 열린다.** 실패는
 * 항상 더 막는 쪽으로 떨어져야 한다. 그래서 절대 throw 하지 않고, 최악이 generic 이다.
 *
 * ## 관용적 스킵에는 관측 가능성을 함께
 *
 * 깨진 프로파일을 조용히 건너뛰면 사람은 자기 프로파일이 적용된 줄 안다. `loadProfile` 은
 * 훅용(조용한 폴백), `inspectProfile` 은 `problems: string[]` 을 함께 돌려준다 —
 * init·doctor·CLI 가 이걸 사람에게 보여준다.
 *
 * 순수성: 시각·난수 없음. 같은 파일 상태면 같은 결과다.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { harnessDir } from './paths';
import { loadConfig } from './config';
import { pick, DEFAULT_LANG, type Lang, type Msg } from './i18n';

/**
 * 프로파일 진단은 **프로파일 파일을 고치는 사람**이 읽는다. 파일마다 여러 줄이 나오므로
 * 언어를 진입점(`inspectProfile`)에서 한 번 해석해 헬퍼에 함수로 넘긴다.
 */
type Tr = (m: Msg) => string;
const trFor = (lang: Lang): Tr => (m: Msg) => pick(m, lang);

/** 어디서 온 프로파일인가 — 폴백이 일어났는지 사람이 알 수 있어야 한다. */
export type ProfileOrigin = 'local' | 'bundled' | 'floor';

export interface Profile {
  /** profile.yaml 의 `name`. 없으면 디렉토리명. */
  name: string;
  description?: string;
  /** 소스 경로 글롭(루트 상대). §4-2 설계 트랙 쓰기 차단의 정의. */
  sourceGlobs: string[];
  /** 배포로 간주할 명령 조각. 부분문자열로 대조한다. */
  deployCommands: string[];
  /** commands.yaml 매핑. 값이 비면 키 자체가 없는 것으로 취급한다. */
  commands: Record<string, string>;
  /**
   * P4 승인 후 동결할 디자인 시스템 디렉토리(§7). 비면 아무것도 얼지 않는다(= P4 승인 전).
   *
   * **글롭이 아니라 디렉토리 접두사다** (`src/components/ui`, `src/components/ui/**` 아님).
   * 판정은 `tokens.isFrozenPath` 하나가 하고 그건 접두사 대조라, 여기에 글롭을 담으면
   * 동결이 조용히 아무것도 안 얼린다. 이 모듈은 값만 주고 판정을 따로 만들지 않는다 —
   * 판정이 둘이 되는 순간 느슨한 쪽이 정본이 된다.
   */
  designSystemRoots: string[];
  origin: ProfileOrigin;
  /** 프로파일 디렉토리 절대경로. `guidance/`·`rules/` 를 여기서 찾는다. 내장 바닥은 `''`. */
  dir: string;
}

/** §9가 정한 명령 키. 프로파일은 이보다 더 담아도 되고, 덜 담아도 된다. */
export const COMMAND_KEYS = ['test', 'build', 'deploy', 'e2e', 'dev-server'] as const;
export type CommandKey = (typeof COMMAND_KEYS)[number];

const GENERIC = 'generic';

/**
 * 코드 내장 바닥값 — `profiles/generic/profile.yaml` 과 **같은 값이어야 한다**(테스트가 지킨다).
 * deploy_commands 는 `config.ts` 의 `DEFAULT_CONFIG.design_blocked_bash` 와도 같다.
 * 세 곳이 갈라지면 "config 로는 막히는데 프로파일로는 안 막힌다"가 되어 정본이 사라진다.
 */
export const GENERIC_FLOOR: Readonly<Profile> = Object.freeze({
  name: GENERIC,
  description: 'Minimal profile for an undecided stack, or one outside the bundled profiles. '
    + 'The command mapping is left for you to fill in.',
  sourceGlobs: Object.freeze(['src/**', 'lib/**', 'app/**']) as unknown as string[],
  // config.ts 의 DEFAULT_CONFIG.design_blocked_bash 와 **같은 목록을 유지한다** —
  // 갈라지면 「config 로는 막히는데 프로파일로는 안 막힌다」가 되어 정본이 사라진다.
  deployCommands: Object.freeze([
    'docker push',
    'kubectl apply',
    'helm upgrade',
    'helm install',
    'vercel deploy',
    'vercel --prod',
    'netlify deploy',
    'fly deploy',
    'wrangler deploy',
    'serverless deploy',
    'sst deploy',
    'eb deploy',
    'gcloud app deploy',
    'npm publish',
    'yarn publish',
    'pnpm publish',
    'cargo publish',
    'gem push',
    'twine upload',
    'terraform apply',
    'pulumi up',
  ]) as unknown as string[],
  commands: Object.freeze({}) as Record<string, string>,
  designSystemRoots: Object.freeze([]) as unknown as string[],
  origin: 'floor',
  dir: '',
});

/** 프로젝트 로컬 프로파일 자리(§5 — 번들 밖 스택의 스캐폴딩 대상). */
export const localProfileDir = (root: string) => path.join(harnessDir(root), 'profile');

/**
 * 번들 프로파일 디렉토리.
 *
 * vitest 는 `core/src/profile.ts` 를, 배포본은 번들된 `core/dist/cli.js` 를 실행한다.
 * 둘 다 `__dirname` 이 `<repo>/core/{src,dist}` 라 **2단 상위가 같은 `<repo>/profiles`** 다.
 * (tsup 이 cjs 로 번들하므로 `__dirname` 은 양쪽에서 그대로 산다.)
 */
export function bundledProfilesDir(): string {
  return path.resolve(__dirname, '..', '..', 'profiles');
}

// ─────────────────────────────────────────────────────────────────────────────
// 로딩
// ─────────────────────────────────────────────────────────────────────────────

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 경로 탈출·빈 이름 차단. config.yaml 의 `profile` 은 사용자 입력이다. */
const isSafeName = (n: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(n) && n !== '.' && n !== '..';

/** 배열이 아니면 null(= 기본값으로 떨어뜨려라는 신호). 문자열 아닌 항목은 버린다. */
function strList(v: unknown): { list: string[]; dropped: number } | null {
  if (!Array.isArray(v)) return null;
  const list = v.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean);
  return { list, dropped: v.length - list.length };
}

function readList(
  m: Record<string, unknown>, key: string, fallback: readonly string[],
  yamlPath: string, problems: string[], required: boolean, t: Tr,
): string[] {
  if (!(key in m) || m[key] === null || m[key] === undefined) {
    if (required) {
      problems.push(t({
        en: `${yamlPath}: \`${key}\` is missing — filling in the generic default. Leaving it empty opens `
          + 'that block (§4-2) entirely. Put the values your stack needs',
        ko: `${yamlPath}: \`${key}\` 가 없다 — generic 기본값으로 메운다. `
          + '비워두면 해당 차단(§4-2)이 통째로 열린다. 스택에 맞는 값을 채워라',
      }));
    }
    return [...fallback];
  }
  const parsed = strList(m[key]);
  if (!parsed) {
    problems.push(t({
      en: `${yamlPath}: \`${key}\` must be a list of strings (currently ${typeof m[key]}) — continuing with `
        + `${required ? 'the generic default' : 'an empty list'}`,
      ko: `${yamlPath}: \`${key}\` 는 문자열 목록이어야 한다(현재 ${typeof m[key]}) — `
        + `${required ? 'generic 기본값' : '빈 목록'}으로 진행한다`,
    }));
    return required ? [...fallback] : [];
  }
  if (parsed.dropped > 0) {
    problems.push(t({
      en: `${yamlPath}: ignored ${parsed.dropped} non-string entrie(s) under \`${key}\``,
      ko: `${yamlPath}: \`${key}\` 의 문자열 아닌 항목 ${parsed.dropped}개를 무시했다`,
    }));
  }
  return parsed.list;
}

/** commands.yaml 최상위는 `키: 명령문자열` 매핑이다. 빈 값 = 미정의(정상, 자리표). */
function readCommands(dir: string, problems: string[], t: Tr): Record<string, string> {
  const p = path.join(dir, 'commands.yaml');
  let text: string;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch {
    problems.push(t({
      en: `${p} is missing — continuing without a command mapping. When the core asks for the test, build or `
        + 'deploy command the answer will be "undefined", and every P7–P9 automatic decision falls to a human',
      ko: `${p} 가 없다 — 명령 매핑 없이 진행한다. 코어가 테스트·빌드·배포 명령을 물으면 `
        + '"미정의"로 답하게 되고, P7~P9 자동 판정이 전부 사람에게 넘어온다',
    }));
    return {};
  }

  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (e) {
    problems.push(t({
      en: `failed to parse ${p} (${errMsg(e)}) — continuing without a command mapping`,
      ko: `${p} 파싱 실패(${errMsg(e)}) — 명령 매핑 없이 진행한다`,
    }));
    return {};
  }
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push(t({
      en: `${p}: the top level is not a \`key: command\` mapping — continuing without a command mapping`,
      ko: `${p}: 최상위가 \`키: 명령\` 매핑이 아니다 — 명령 매핑 없이 진행한다`,
    }));
    return {};
  }

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') {
      const cmd = v.trim();
      if (cmd) out[k] = cmd; // 빈 문자열은 자리표 — 미정의로 둔다
      continue;
    }
    if (v === null || v === undefined) continue; // `test:` 만 적은 자리표
    problems.push(t({
      en: `${p}: \`${k}\` must be a command string (currently ${typeof v}) — ignored`,
      ko: `${p}: \`${k}\` 는 명령 문자열이어야 한다(현재 ${typeof v}) — 무시했다`,
    }));
  }
  return out;
}

/** 디렉토리 하나를 프로파일로 읽는다. 읽을 수 없으면 null(사유는 problems 에). */
function readProfileDir(dir: string, origin: ProfileOrigin, problems: string[], t: Tr): Profile | null {
  const yamlPath = path.join(dir, 'profile.yaml');

  let text: string;
  try {
    text = fs.readFileSync(yamlPath, 'utf8');
  } catch (e) {
    problems.push(t({
      en: `cannot read ${yamlPath} (${errMsg(e)}) — skipping this profile`,
      ko: `${yamlPath} 를 읽을 수 없다(${errMsg(e)}) — 이 프로파일을 건너뛴다`,
    }));
    return null;
  }

  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (e) {
    problems.push(t({
      en: `failed to parse ${yamlPath} (${errMsg(e)}) — skipping this profile`,
      ko: `${yamlPath} 파싱 실패(${errMsg(e)}) — 이 프로파일을 건너뛴다`,
    }));
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push(t({
      en: `${yamlPath}: the top level is not a mapping — skipping this profile`,
      ko: `${yamlPath}: 최상위가 매핑이 아니다 — 이 프로파일을 건너뛴다`,
    }));
    return null;
  }
  const m = raw as Record<string, unknown>;

  const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim() : path.basename(dir);
  const description = typeof m.description === 'string' ? m.description.trim() : undefined;

  return {
    name,
    ...(description ? { description } : {}),
    // 소스·배포는 비면 차단이 열리는 쪽이라 generic 기본값으로 메운다(+보고).
    sourceGlobs: readList(m, 'source_globs', GENERIC_FLOOR.sourceGlobs, yamlPath, problems, true, t),
    deployCommands:
      readList(m, 'deploy_commands', GENERIC_FLOOR.deployCommands, yamlPath, problems, true, t),
    // 동결 경로는 비어 있는 것이 정상(=P4 승인 전) — 없다고 보고하지 않는다.
    designSystemRoots: readList(m, 'design_system_roots', [], yamlPath, problems, false, t),
    commands: readCommands(dir, problems, t),
    origin,
    dir,
  };
}

function floorProfile(): Profile {
  return {
    ...GENERIC_FLOOR,
    sourceGlobs: [...GENERIC_FLOOR.sourceGlobs],
    deployCommands: [...GENERIC_FLOOR.deployCommands],
    designSystemRoots: [...GENERIC_FLOOR.designSystemRoots],
    commands: { ...GENERIC_FLOOR.commands },
  };
}

function resolve(root: string, name?: string, lang: Lang = DEFAULT_LANG): { profile: Profile; problems: string[] } {
  const t = trFor(lang);
  const problems: string[] = [];

  // 이름: 인자 > config.yaml 의 profile > generic.
  const wanted = (typeof name === 'string' && name.trim())
    ? name.trim()
    : (loadConfig(root).profile || GENERIC);

  // (1) 프로젝트 로컬 — 있으면 번들보다 항상 우선.
  const local = localProfileDir(root);
  if (fs.existsSync(local)) {
    if (!isDir(local)) {
      problems.push(t({
        en: `${local} is not a directory — skipping the project-local profile`,
        ko: `${local} 가 디렉토리가 아니다 — 프로젝트 로컬 프로파일을 건너뛴다`,
      }));
    } else {
      const p = readProfileDir(local, 'local', problems, t);
      if (p) return { profile: p, problems };
    }
  }

  const bundled = bundledProfilesDir();

  // (2) 번들 <이름>.
  if (!isSafeName(wanted)) {
    problems.push(
      t({
        en: `The profile name '${wanted}' is invalid (only alphanumerics and . _ - are allowed) — `
          + 'continuing with generic. Fix `profile` in `.harness/config.yaml`',
        ko: `프로파일 이름 '${wanted}' 이 올바르지 않다(영숫자·. _ - 만 허용) — generic 으로 진행한다. `
          + '`.harness/config.yaml` 의 `profile` 을 고쳐라',
      }),
    );
  } else if (isDir(path.join(bundled, wanted))) {
    const p = readProfileDir(path.join(bundled, wanted), 'bundled', problems, t);
    if (p) return { profile: p, problems };
  } else {
    problems.push(
      t({
        en: `Profile '${wanted}' was not found in ${bundled} — continuing with generic. Check the bundled `
          + 'list, or for a stack outside the bundles put a project-local profile in `.harness/profile/`',
        ko: `프로파일 '${wanted}' 를 ${bundled} 에서 찾을 수 없다 — generic 으로 진행한다. `
          + '번들 목록을 확인하거나, 번들 밖 스택이면 `.harness/profile/` 에 프로젝트 로컬 프로파일을 두어라',
      }),
    );
  }

  // (3) 번들 generic.
  if (wanted !== GENERIC && isDir(path.join(bundled, GENERIC))) {
    const p = readProfileDir(path.join(bundled, GENERIC), 'bundled', problems, t);
    if (p) return { profile: p, problems };
  }

  // (4) 코드 내장 바닥 — 여기까지 왔으면 설치본이 깨진 것이다.
  problems.push(
    t({
      en: `Could not read the generic profile in ${bundled} — continuing with the built-in floor values. `
        + 'Check that the plugin installation is intact',
      ko: `${bundled} 의 generic 프로파일을 읽지 못했다 — 코드 내장 바닥값으로 진행한다. `
        + '플러그인 설치본이 온전한지 확인하라',
    }),
  );
  return { profile: floorProfile(), problems };
}

/**
 * 프로파일 + 그 과정에서 삼킨 문제들. init·doctor·CLI 가 사람에게 보여주는 표면이다.
 * 정상 경로에서는 `problems` 가 빈 배열이다.
 */
export function inspectProfile(root: string, name?: string): { profile: Profile; problems: string[] } {
  // 언어 해석 자체가 실패해도 진단은 나와야 한다 — config 를 못 읽으면 기본값(en)으로 간다.
  let lang: Lang = DEFAULT_LANG;
  try { lang = loadConfig(root).lang; } catch { /* 바닥값으로 진행 */ }
  try {
    return resolve(root, name, lang);
  } catch (e) {
    // 여기 오면 안 되지만, 훅은 절대 죽지 않는다.
    return {
      profile: floorProfile(),
      problems: [trFor(lang)({
        en: `exception while resolving the profile (${errMsg(e)}) — using the floor profile`,
        ko: `프로파일 해석 중 예외(${errMsg(e)}) — 바닥값 사용`,
      })],
    };
  }
}

/** 훅·CLI 가 쓰는 조용한 경로. 사유가 필요하면 `inspectProfile`. 절대 throw 하지 않는다. */
export function loadProfile(root: string, name?: string): Profile {
  return inspectProfile(root, name).profile;
}

// ─────────────────────────────────────────────────────────────────────────────
// 질의 — 코어가 실제로 묻는 것들
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 의존성 없는 최소 글롭 → 정규식. `**`(구분자 넘음)·`*`(한 세그먼트)·`?`(한 글자)만 안다.
 * 이 저장소의 런타임 의존은 `yaml` 하나뿐이고 그건 의도다 — 훅이 npm 트리에 인질로 잡히면
 * 강제가 설치 환경에 따라 살았다 죽었다 한다.
 */
function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          re += '(?:[^/]*/)*'; // `**/` 는 디렉토리 0개도 잡는다
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * 루트 상대 posix 경로로 맞춘다. 절대경로가 들어오면 선행 `/` 를 떼고 판정한다 —
 * "판정 불가"를 "소스 아님"으로 흘리면 §4-2 차단에 구멍이 나기 때문이다(더 막는 쪽으로 실패).
 * 호출측은 루트 기준으로 상대화해서 넘기는 것이 정상 경로다.
 */
function normRel(p: unknown): string {
  if (typeof p !== 'string') return '';
  let s = p.replace(/\\/g, '/').trim().replace(/\/{2,}/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  return s.replace(/^\/+/, '');
}

/** 이 경로가 프로파일이 말하는 "소스"인가 — §4-2 설계 트랙 쓰기 차단의 입력. */
export function isSourcePath(profile: Profile, relPath: string): boolean {
  try {
    const rel = normRel(relPath);
    if (!rel) return false;
    return (profile.sourceGlobs ?? []).some(g => {
      const pat = normRel(g);
      return pat ? globToRegExp(pat).test(rel) : false; // 빈 항목이 전체 일치로 번지지 않게
    });
  } catch {
    return false;
  }
}

/** 공백 압축 + 소문자. `vercel   deploy`·`VERCEL DEPLOY` 같은 값싼 우회를 없앤다. */
const normCmd = (s: unknown) =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().toLowerCase() : '';

/** 이 bash 명령이 배포인가 — §4-2 배포 차단의 입력. 부분문자열 대조. */
export function isDeployCommand(profile: Profile, command: string): boolean {
  try {
    const cmd = normCmd(command);
    if (!cmd) return false;
    return (profile.deployCommands ?? []).some(d => {
      const needle = normCmd(d);
      return needle.length > 0 && cmd.includes(needle); // 빈 항목이 전체 차단으로 번지지 않게
    });
  } catch {
    return false;
  }
}

/**
 * test/build/deploy/e2e/dev-server 등의 명령. **없으면 undefined 다 — 지어내지 않는다.**
 * 호출측은 undefined 를 "사람에게 물어라"로 읽어야 한다. 그럴듯한 기본 명령을 박으면
 * P7 CI 그린 판정이 "실행된 적 없는 명령이 실패하지 않았다"로 조용히 통과한다.
 */
export function commandFor(profile: Profile, key: string): string | undefined {
  const v = (profile.commands ?? {})[key];
  // 문자열 검사 하나로 프로토타입 상속 키(constructor·toString)도 함께 걸러진다.
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}
