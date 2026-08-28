import * as fs from 'node:fs';
import * as YAML from 'yaml';
import { configPath } from './paths';
import { isLang, DEFAULT_LANG } from './i18n';
import type { HarnessConfig } from './types';

export const DEFAULT_CONFIG: HarnessConfig = {
  lang: DEFAULT_LANG,
  profile: 'generic',
  remote_control: true,
  terse: false,
  design_allowed_prefixes: ['.harness/', 'docs/'],
  // 스펙 §4-2 1행 「빌드·배포 명령」. 리터럴 5개뿐이던 것을 **계열별로** 넓혔다 — `npm publish`
  // 같은 최빈 배포 명령이 그대로 통과하고 있었다. 부분문자열 대조라 접미 플래그는 적지 않는다.
  // 여기 없는 스택별 명령은 프로파일의 `deploy_commands` 가 채운다(정의는 프로파일 몫, §4-2).
  design_blocked_bash: [
    // 컨테이너·오케스트레이션
    'docker push', 'kubectl apply', 'helm upgrade', 'helm install',
    // PaaS
    'vercel deploy', 'vercel --prod', 'netlify deploy', 'fly deploy', 'wrangler deploy',
    'serverless deploy', 'sst deploy', 'eb deploy', 'gcloud app deploy',
    // 패키지 레지스트리
    'npm publish', 'yarn publish', 'pnpm publish', 'cargo publish', 'gem push', 'twine upload',
    // 인프라
    'terraform apply', 'pulumi up',
  ],
  design_system_frozen_roots: [],
  block_raw_values: false,
};

const asBool = (v: unknown, d: boolean): boolean =>
  typeof v === 'boolean' ? v : v === 'on' || v === 'yes' ? true : v === 'off' || v === 'no' ? false : d;

const asStrArray = (v: unknown, d: string[]): string[] =>
  Array.isArray(v) ? v.map(String) : [...d];

/**
 * [COST-129] **훅 1회당 같은 파일을 세 번 읽고 세 번 파싱하던 것을 한 번으로.**
 *
 * `handleHook`·`loadProfile`·`tr` 이 각자 `loadConfig` 를 부른다. 기본 51B config 에서는
 * 0.06ms × 3 = 0.18ms 라 무시할 수준이지만, **정책 목록이 큰 config 에서는 그렇지 않다** —
 * 66KB config 실측 **37.5ms × 3 = 112ms/호출**로, 훅이 하는 실제 일(인프로세스 p50 0.9ms)을
 * 통째로 압도한다. 「대형에서만 유의」는 「무시해도 된다」가 아니었다.
 *
 * 캐시 키에 **나노초 mtime 과 크기**를 함께 넣는다. 밀리초 해상도로는 같은 밀리초 안에 쓰고
 * 다시 읽는 경우(테스트가 정확히 그렇다) 낡은 값을 준다 — 성능을 위해 정확성을 내주면
 * 그건 최적화가 아니라 버그다. 파일이 바뀌면 키가 달라져 자동으로 다시 읽는다.
 */
const CONFIG_CACHE = new Map<string, { key: string; value: HarnessConfig }>();

function configCacheKey(p: string): string {
  try {
    const st = fs.statSync(p, { bigint: true });
    return `${st.mtimeNs}:${st.size}`;
  } catch {
    return 'absent';
  }
}

export function loadConfig(root: string): HarnessConfig {
  const p = configPath(root);
  const key = configCacheKey(p);
  const hit = CONFIG_CACHE.get(p);
  if (hit && hit.key === key) return hit.value;
  const value = parseConfig(p);
  CONFIG_CACHE.set(p, { key, value });
  return value;
}

function parseConfig(p: string): HarnessConfig {
  let raw: Record<string, unknown> = {};
  if (fs.existsSync(p)) {
    try {
      raw = (YAML.parse(fs.readFileSync(p, 'utf8')) ?? {}) as Record<string, unknown>;
    } catch {
      raw = {}; // 파싱 불가 config는 무시하고 기본값(더 엄격한 쪽)으로 — 훅은 절대 죽으면 안 된다
    }
  }
  return {
    // 환경변수가 config 를 이긴다 — 일회성 전환을 프로젝트 설정 수정 없이 하게.
    lang: isLang(process.env.HARNESS_LANG) ? process.env.HARNESS_LANG
      : isLang(raw.lang) ? raw.lang : DEFAULT_CONFIG.lang,
    profile: typeof raw.profile === 'string' ? raw.profile : DEFAULT_CONFIG.profile,
    remote_control: asBool(raw.remote_control, DEFAULT_CONFIG.remote_control),
    terse: asBool(raw.terse, DEFAULT_CONFIG.terse),
    design_allowed_prefixes: asStrArray(raw.design_allowed_prefixes, DEFAULT_CONFIG.design_allowed_prefixes),
    design_blocked_bash: asStrArray(raw.design_blocked_bash, DEFAULT_CONFIG.design_blocked_bash),
    design_system_frozen_roots: asStrArray(raw.design_system_frozen_roots, DEFAULT_CONFIG.design_system_frozen_roots),
    block_raw_values: raw.block_raw_values === true,
  };
}

/**
 * [API-03] **제품이 실제로 읽는 키의 정본.** `parseConfig` 가 읽는 키 = 기본값이 있는 키이므로
 * `DEFAULT_CONFIG` 에서 파생한다 — 손으로 적은 두 번째 목록을 두면 키가 하나 늘 때 진단이
 * 「멀쩡한 키를 오타라고」 우기는 오보로 갈린다(이 저장소가 반복해 물린 부류).
 */
export const KNOWN_CONFIG_KEYS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_CONFIG));

export interface ConfigInspection {
  /** 파싱 자체가 실패했거나 매핑이 아닌 경우 — 파일 전체가 무시된다. */
  problems: string[];
  /**
   * [API-03] 파싱은 됐지만 **제품이 읽지 않는** 최상위 키. 오타 하나로 사용자가 적어 둔 차단이
   * 통째로 사라지는데 예전에는 아무 신호도 없었다. 문자열이 아니라 목록으로 돌려주는 이유:
   * 부르는 쪽(doctor)이 문구를 만들고 **판정까지** 정해야 하는데, 문자열을 되파싱하게 하면
   * 그 판정이 문구 변경으로 조용히 깨진다.
   */
  unknownKeys: string[];
  /** 진단 문장이 「어느 파일을 고쳐야 하는지」를 말할 수 있게 경로를 함께 준다. */
  path: string;
}

/**
 * [UX-151] **조용한 폴백을 관측 가능하게 만든다.**
 *
 * `loadConfig` 는 파스 실패를 삼키고 기본값으로 간다 — 훅이 절대 죽으면 안 되기 때문이고,
 * 그 계약은 옳다. 문제는 **아무도 그 사실을 모른다**는 것이었다: 사용자는 자기가 적어 둔
 * 정책이 걸려 있다고 믿는데 실제로는 기본값으로 돌고 있다. 강제가 사라진 것보다
 * **사라진 줄 모르는 것**이 나쁘다.
 *
 * 그래서 판정 경로(훅)는 그대로 조용히 두고, **진단 경로(doctor)** 가 이 함수로 사실을 본다.
 * 프로파일 쪽이 `inspectProfile` 로 이미 쓰는 것과 같은 형태다(표면마다 다른 말을 하지 않게).
 */
export function inspectConfig(root: string): ConfigInspection {
  const p = configPath(root);
  if (!fs.existsSync(p)) return { problems: [], unknownKeys: [], path: p };
  try {
    const parsed = YAML.parse(fs.readFileSync(p, 'utf8'));
    if (parsed !== null && parsed !== undefined && typeof parsed !== 'object') {
      return {
        problems: [`${p}: not a mapping — every key is ignored and defaults are in effect`],
        unknownKeys: [], path: p,
      };
    }
    const unknownKeys = parsed && !Array.isArray(parsed)
      ? Object.keys(parsed as Record<string, unknown>).filter((k) => !KNOWN_CONFIG_KEYS.has(k))
      : [];
    return { problems: [], unknownKeys, path: p };
  } catch (e) {
    return { problems: [`${p}: ${e instanceof Error ? e.message : String(e)}`], unknownKeys: [], path: p };
  }
}
