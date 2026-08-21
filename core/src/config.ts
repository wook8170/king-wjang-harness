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

export function loadConfig(root: string): HarnessConfig {
  const p = configPath(root);
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
