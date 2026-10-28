/**
 * 보안 점검 회차 — 설정 · 허용 대상 · 라우트 추출 · 판정 · 결과서(엑셀) · 결함 초안.
 *
 * ## 무엇을 하는가
 *
 * 버전마다 한 번 보안 점검을 돌리고, 그 결과를 **버전 이름의 회차 폴더 하나**에 모은다.
 * 이 모듈은 그 폴더를 읽어 판정하고, 결과서(엑셀)와 판정 요약(`summary.json`)을 만든다.
 * 출하 게이트(P10·P12)와 `ship verdict` 는 「지금 버전의 회차가 통과했는가」를 여기서 묻는다.
 *
 * ## 이 모듈이 하지 않는 것
 *
 * **네트워크와 프로세스를 타지 않는다**(코어 §1 — 순수·로컬·결정적). ZAP·의존성 감사·헤더·권한
 * 호출을 실제로 돌리는 것은 별도 진입점 `security-run.ts`(번들 `core/dist/security-run.js`)다.
 * CLI 와 훅은 그 파일을 import 하지 않는다 — 회귀가 그것을 고정한다. 여기 있는 허용 대상 판정과
 * 라우트 해석은 실행기가 **그대로 가져다 쓴다**(같은 규칙 두 벌을 두지 않는다).
 *
 * ## 판정 기준은 코드에 있다
 *
 * High 0 · 미조치 Medium 0 · 권한 거부 100% · 결과서 존재. 이 문턱은 설정으로 바꿀 수 없다 —
 * 결과를 본 뒤 문턱을 낮추는 것은 판정이 아니라 사후 승인이다(Iron Rule 1).
 *
 * ## 설정은 정책 영역에 있다
 *
 * `.harness/profile/security.yaml` 은 프로젝트 로컬 프로파일 디렉토리(정책 접두사)에 있어 훅이
 * 에이전트 쓰기를 막고 `doctor` 가 해시로 감시한다. 허용 대상 목록이 피판정자의 쓰기 영역에
 * 있으면 운영 주소를 목록에 넣어 스스로 풀 수 있기 때문이다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as YAML from 'yaml';
import { harnessDir } from './paths';
import { tr, langFor } from './tr';
import { pick, type Lang, type Msg } from './i18n';
import { buildXlsx, readXlsx, type Cell, type Sheet } from './xlsx';
import { globToRegExp } from './profile';

type Tr = (m: Msg) => string;
const trFor = (lang: Lang): Tr => (m: Msg) => pick(m, lang);

// ─────────────────────────────────────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────────────────────────────────────

export const securityConfigPath = (root: string) => path.join(harnessDir(root), 'profile', 'security.yaml');
export const DEFAULT_RESULTS_DIR = '.harness/security';
/** 기본 허용 대상 — 루프백뿐이다. 그 밖은 사람이 설정에 적어야 열린다. */
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'];
export const DEFAULT_DENY_STATUSES = [401, 403, 404];

export interface RoleLogin {
  method: string;
  url: string;
  /** 요청 본문. `${ENV}` 자리표시자는 실행 시 환경변수로 채운다 — 비밀값을 파일에 두지 않는다. */
  body?: string;
  headers?: Record<string, string>;
  /** `json:<경로>`(예 `json:token`) 또는 `cookie:<이름>`. */
  token_from: string;
  /** 이후 요청에 붙일 헤더. `{token}` 을 치환한다. 예 `Authorization: Bearer {token}`. */
  use: string;
}

export interface RoleConfig {
  name: string;
  /** 없으면 비로그인 역할이다. */
  login?: RoleLogin;
  /** true 면 권한 거부 전수의 대상이 아니다(관리자 등). */
  privileged?: boolean;
  /**
   * 이 역할이 거부돼야 하는 라우트(정규식). 있으면 `routes.include` 대신 쓴다 — 비로그인은
   * `/api/me` 도 거부돼야 하지만 로그인한 뷰어에게는 정상 응답이어야 하는 것처럼 역할마다 다르다.
   */
  deny?: string[];
}

export interface SecurityConfig {
  applies: boolean;
  /** `applies: false` 일 때 필수. */
  reason?: string;
  version_from: string;
  results_dir: string;
  allow_hosts: string[];
  allow_ports: number[];
  targets: { name: string; url: string }[];
  stack?: { up?: string; down?: string; ready_url?: string; ready_timeout_s?: number };
  roles: RoleConfig[];
  routes?: { command?: string; file?: string; target?: string; include?: string[]; exclude?: string[]; deny_status?: number[] };
  manual?: { file: string; target?: string };
  deps?: { command?: string };
  headers?: { targets?: string[]; require?: string[] };
  zap?: {
    image: string;
    baseline?: string[];
    baseline_minutes?: number;
    active?: { target: string; role?: string; openapi?: string; max_minutes?: number };
    network?: 'auto' | 'host' | 'bridge';
    cpus?: number;
  };
  e2e_ledger?: string[];
}

export type ConfigLoad =
  | { status: 'absent'; path: string }
  | { status: 'invalid'; path: string; errors: string[] }
  | { status: 'ok'; path: string; config: SecurityConfig };

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/**
 * 허용 대상 목록에 올릴 수 있는 이름인가 — **운영·외부 주소를 설정으로 열 수 없게** 한다.
 * 루프백 · 사설 대역(10/8 · 172.16/12 · 192.168/16 · fc00::/7) · 점 없는 이름(도커 서비스명) ·
 * 시험용 최상위 이름(.localhost · .test · .local · .internal · .lan)만 받는다.
 */
export function isPrivateHostName(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (LOOPBACK_HOSTS.includes(h)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (h.includes(':')) return /^f[cd][0-9a-f]{2}:/.test(h) || h === '::1';
  if (!h.includes('.')) return /^[a-z0-9-]+$/.test(h);
  return /\.(localhost|test|local|internal|lan)$/.test(h);
}

export function parseSecurityConfig(raw: unknown): { config?: SecurityConfig; errors: string[] } {
  const errors: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['security.yaml is not a mapping'] };
  }
  const o = raw as Record<string, unknown>;
  const applies = o.applies !== false;
  const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
  if (!applies && !reason) errors.push('`applies: false` needs a `reason` — opting out without one is concealment');
  const allow_hosts = o.allow_hosts === undefined ? [...LOOPBACK_HOSTS] : asStrings(o.allow_hosts);
  for (const h of allow_hosts) {
    if (!isPrivateHostName(h)) {
      errors.push(`allow_hosts: ${h} is not a loopback/private/test name — production and external hosts cannot be allowed`);
    }
  }
  const allow_ports = Array.isArray(o.allow_ports) ? o.allow_ports.map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 65536) : [];
  const targets: { name: string; url: string }[] = [];
  for (const t of Array.isArray(o.targets) ? o.targets : []) {
    const r = t as Record<string, unknown>;
    if (typeof r?.name !== 'string' || typeof r?.url !== 'string') { errors.push('targets[] needs name and url'); continue; }
    targets.push({ name: r.name, url: r.url });
  }
  const roles: RoleConfig[] = [];
  for (const r of Array.isArray(o.roles) ? o.roles : []) {
    const x = r as Record<string, unknown>;
    if (typeof x?.name !== 'string') { errors.push('roles[] needs a name'); continue; }
    const role: RoleConfig = { name: x.name, privileged: x.privileged === true, ...(Array.isArray(x.deny) ? { deny: asStrings(x.deny) } : {}) };
    if (x.login && typeof x.login === 'object') {
      const l = x.login as Record<string, unknown>;
      if (typeof l.url !== 'string' || typeof l.token_from !== 'string' || typeof l.use !== 'string') {
        errors.push(`roles.${x.name}.login needs url, token_from and use`);
      } else {
        if (typeof l.body === 'string' && looksLikeLiteralSecret(l.body)) {
          errors.push(`roles.${x.name}.login.body carries a literal password — use \${ENV_NAME} so the secret stays out of the file and the results`);
        }
        role.login = {
          method: typeof l.method === 'string' ? l.method.toUpperCase() : 'POST',
          url: l.url, token_from: l.token_from, use: l.use,
          ...(typeof l.body === 'string' ? { body: l.body } : {}),
          ...(l.headers && typeof l.headers === 'object' ? { headers: l.headers as Record<string, string> } : {}),
        };
      }
    }
    roles.push(role);
  }
  const zapRaw = o.zap as Record<string, unknown> | undefined;
  let zap: SecurityConfig['zap'];
  if (zapRaw && typeof zapRaw === 'object') {
    const image = String(zapRaw.image ?? '');
    if (!isPinnedImage(image)) errors.push(`zap.image must be pinned to a version tag or digest (got ${JSON.stringify(image)}) — "latest" changes under you`);
    const a = zapRaw.active as Record<string, unknown> | undefined;
    zap = {
      image,
      baseline: asStrings(zapRaw.baseline),
      ...(typeof zapRaw.baseline_minutes === 'number' ? { baseline_minutes: zapRaw.baseline_minutes } : {}),
      ...(a && typeof a.target === 'string' ? {
        active: {
          target: a.target,
          ...(typeof a.role === 'string' ? { role: a.role } : {}),
          ...(typeof a.openapi === 'string' ? { openapi: a.openapi } : {}),
          ...(typeof a.max_minutes === 'number' ? { max_minutes: a.max_minutes } : {}),
        },
      } : {}),
      network: zapRaw.network === 'host' || zapRaw.network === 'bridge' ? zapRaw.network : 'auto',
      ...(typeof zapRaw.cpus === 'number' ? { cpus: zapRaw.cpus } : {}),
    };
  }
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined);
  const routes = obj(o.routes);
  const stack = obj(o.stack);
  const config: SecurityConfig = {
    applies,
    ...(reason ? { reason } : {}),
    version_from: typeof o.version_from === 'string' ? o.version_from : 'package.json',
    results_dir: typeof o.results_dir === 'string' ? o.results_dir : DEFAULT_RESULTS_DIR,
    allow_hosts, allow_ports, targets, roles,
    ...(stack ? {
      stack: {
        ...(typeof stack.up === 'string' ? { up: stack.up } : {}),
        ...(typeof stack.down === 'string' ? { down: stack.down } : {}),
        ...(typeof stack.ready_url === 'string' ? { ready_url: stack.ready_url } : {}),
        ...(typeof stack.ready_timeout_s === 'number' ? { ready_timeout_s: stack.ready_timeout_s } : {}),
      },
    } : {}),
    ...(routes ? {
      routes: {
        ...(typeof routes.command === 'string' ? { command: routes.command } : {}),
        ...(typeof routes.file === 'string' ? { file: routes.file } : {}),
        ...(typeof routes.target === 'string' ? { target: routes.target } : {}),
        include: asStrings(routes.include), exclude: asStrings(routes.exclude),
        deny_status: Array.isArray(routes.deny_status) ? routes.deny_status.map(Number) : [...DEFAULT_DENY_STATUSES],
      },
    } : {}),
    ...(obj(o.manual) && typeof obj(o.manual)!.file === 'string' ? {
      manual: { file: String(obj(o.manual)!.file), ...(typeof obj(o.manual)!.target === 'string' ? { target: String(obj(o.manual)!.target) } : {}) },
    } : {}),
    ...(obj(o.deps) ? { deps: { ...(typeof obj(o.deps)!.command === 'string' ? { command: String(obj(o.deps)!.command) } : {}) } } : {}),
    ...(obj(o.headers) ? { headers: { targets: asStrings(obj(o.headers)!.targets), require: asStrings(obj(o.headers)!.require) } } : {}),
    ...(zap ? { zap } : {}),
    ...(o.e2e_ledger !== undefined ? { e2e_ledger: typeof o.e2e_ledger === 'string' ? [o.e2e_ledger] : asStrings(o.e2e_ledger) } : {}),
  };
  if (applies) {
    for (const t of config.targets) {
      const c = checkTarget(t.url, config);
      if (!c.ok) errors.push(`targets.${t.name}: ${c.reason}`);
    }
    for (const r of roles) {
      if (r.login) { const c = checkTarget(r.login.url, config); if (!c.ok) errors.push(`roles.${r.name}.login.url: ${c.reason}`); }
    }
    if (config.stack?.ready_url) {
      const c = checkTarget(config.stack.ready_url, config);
      if (!c.ok) errors.push(`stack.ready_url: ${c.reason}`);
    }
    const named = [...(zap?.baseline ?? []), ...(zap?.active ? [zap.active.target] : []), ...(config.headers?.targets ?? []),
      ...(config.routes?.target ? [config.routes.target] : []), ...(config.manual?.target ? [config.manual.target] : [])];
    for (const n of named) {
      if (!targets.some(t => t.name === n)) errors.push(`unknown target name: ${n} (declare it under targets)`);
    }
    if (zap?.active?.role && !roles.some(r => r.name === zap!.active!.role)) errors.push(`zap.active.role: unknown role ${zap.active.role}`);
  }
  return { config, errors };
}

/** 로그인 본문에 비밀번호가 글자 그대로 있는가 — `${ENV}` 를 쓰지 않은 password/secret 값. */
function looksLikeLiteralSecret(body: string): boolean {
  return /"(?:password|passwd|pwd|secret|token)"\s*:\s*"(?!\$\{)[^"]+"/i.test(body)
    || /(?:^|&)(?:password|passwd|pwd|secret)=(?!\$\{)[^&]+/i.test(body);
}

/** 이미지 참조가 버전에 고정됐는가 — `@sha256:` 다이제스트 또는 `latest` 가 아닌 태그. */
export function isPinnedImage(image: string): boolean {
  if (!image) return false;
  if (/@sha256:[0-9a-f]{64}$/.test(image)) return true;
  const slash = image.lastIndexOf('/');
  const colon = image.lastIndexOf(':');
  if (colon <= slash) return false;
  const tag = image.slice(colon + 1);
  return tag !== '' && tag !== 'latest' && tag !== 'stable';
}

export function loadSecurityConfig(root: string): ConfigLoad {
  const p = securityConfigPath(root);
  if (!fs.existsSync(p)) return { status: 'absent', path: p };
  let raw: unknown;
  try {
    raw = YAML.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return { status: 'invalid', path: p, errors: [(e as Error).message] };
  }
  const { config, errors } = parseSecurityConfig(raw);
  if (!config || errors.length > 0) return { status: 'invalid', path: p, errors };
  return { status: 'ok', path: p, config };
}

// ─────────────────────────────────────────────────────────────────────────────
// 허용 대상 확인
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 이 주소로 요청을 보내도 되는가. 실행기는 **모든 요청 전에** 이것을 묻는다.
 * http·https 만, 허용 이름 목록 안의 호스트만, 포트 목록이 있으면 그 포트만.
 */
export function checkTarget(
  url: string, policy: Pick<SecurityConfig, 'allow_hosts' | 'allow_ports'>,
): { ok: true } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, reason: `not a URL: ${url}` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: `only http(s) targets are allowed: ${url}` };
  if (u.username || u.password) return { ok: false, reason: `credentials in the URL would end up in the results: ${u.host}` };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const allowed = policy.allow_hosts.map(h => h.toLowerCase().replace(/^\[|\]$/g, ''));
  if (!allowed.includes(host)) {
    return { ok: false, reason: `host ${host} is outside the allowed targets (${allowed.join(', ')}) — scans run against an isolated local stack only` };
  }
  if (!isPrivateHostName(host)) return { ok: false, reason: `host ${host} is not a loopback/private/test name` };
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  if (policy.allow_ports.length > 0 && !policy.allow_ports.includes(port)) {
    return { ok: false, reason: `port ${port} is outside allow_ports (${policy.allow_ports.join(', ')})` };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 라우트 추출
// ─────────────────────────────────────────────────────────────────────────────

export interface Route { method: string; path: string }
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * 라우트 목록 명령의 출력을 `{method, path}` 목록으로 편다. 받는 형태:
 * OpenAPI 문서(JSON) · `["GET /x", …]` · `[{method, path}, …]` · 줄마다 `METHOD /path`(표 출력 포함).
 * 새 API 가 추가되면 명령 출력에 나타나므로 다음 회차의 권한 점검에 자동으로 들어간다.
 */
export function parseRoutes(text: string): Route[] {
  const out: Route[] = [];
  const push = (m: unknown, p: unknown) => {
    const method = String(m ?? '').toUpperCase();
    const pth = String(p ?? '');
    if (METHODS.includes(method) && pth.startsWith('/')) out.push({ method, path: pth });
  };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'paths' in (parsed as object)) {
    const paths = (parsed as { paths: Record<string, Record<string, unknown>> }).paths ?? {};
    for (const [p, ops] of Object.entries(paths)) for (const m of Object.keys(ops ?? {})) push(m, p);
  } else if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (typeof item === 'string') {
        const m = /^\s*([A-Za-z]+)\s+(\S+)/.exec(item);
        if (m) push(m[1], m[2]);
      } else if (item && typeof item === 'object') {
        const r = item as Record<string, unknown>;
        const methods = Array.isArray(r.methods) ? r.methods : [r.method];
        for (const m of methods) push(m, r.path ?? r.url ?? r.route);
      }
    }
  } else {
    const re = new RegExp(`\\b(${METHODS.join('|')})\\b[\\s|│,:]+(/[^\\s|│,]*)`, 'gi');
    for (const line of text.split('\n')) for (const m of line.matchAll(re)) push(m[1], m[2]);
  }
  const seen = new Set<string>();
  return out
    .filter(r => { const k = `${r.method} ${r.path}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** include(하나라도 맞으면 포함, 비면 전부) · exclude(맞으면 뺌) 정규식으로 고른다. */
export function selectRoutes(routes: Route[], include: string[] = [], exclude: string[] = []): Route[] {
  const inc = include.map(s => new RegExp(s));
  const exc = exclude.map(s => new RegExp(s));
  return routes.filter((r) => {
    const k = `${r.method} ${r.path}`;
    const hit = (re: RegExp) => re.test(r.path) || re.test(k);
    return (inc.length === 0 || inc.some(hit)) && !exc.some(hit);
  });
}

/** 경로 매개변수(`{id}` · `:id` · `[id]`)를 고정값으로 채운다 — 없는 자원이어도 거부 판정에는 충분하다. */
export const fillPathParams = (p: string): string =>
  p.replace(/\{[^}]+\}/g, 'x').replace(/\[[^\]]+\]/g, 'x').replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, 'x');

// ─────────────────────────────────────────────────────────────────────────────
// 버전 · 회차 폴더
// ─────────────────────────────────────────────────────────────────────────────

/** 현재 버전 — `version_from` 이 `.json` 이면 그 `version` 필드, 아니면 첫 줄. */
export function currentVersion(root: string, cfg: Pick<SecurityConfig, 'version_from'>): string {
  const p = path.resolve(root, cfg.version_from);
  let text: string;
  try { text = fs.readFileSync(p, 'utf8'); } catch {
    throw new Error(tr(root, {
      en: `Cannot read the version from ${cfg.version_from} — set \`version_from\` in .harness/profile/security.yaml`,
      ko: `${cfg.version_from} 에서 버전을 읽을 수 없다 — .harness/profile/security.yaml 의 \`version_from\` 을 맞춰라`,
    }));
  }
  let v = '';
  if (p.endsWith('.json')) {
    try { v = String((JSON.parse(text) as { version?: unknown }).version ?? ''); } catch { v = ''; }
  } else {
    v = text.split('\n')[0]?.trim() ?? '';
  }
  return assertVersion(root, v, cfg.version_from);
}

/** 버전 이름은 폴더 이름이 된다 — 경로 문자를 막는다. */
export function assertVersion(root: string, v: string, from: string): string {
  const s = v.trim();
  if (!s || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(s) || s.includes('..')) {
    throw new Error(tr(root, {
      en: `Not a usable version name: ${JSON.stringify(v)} (from ${from}) — it names the results folder, so letters, digits and . _ + - only`,
      ko: `쓸 수 없는 버전 이름: ${JSON.stringify(v)} (${from}) — 결과 폴더 이름이 되므로 영문·숫자·. _ + - 만 쓴다`,
    }));
  }
  return s;
}

export const roundDir = (root: string, cfg: Pick<SecurityConfig, 'results_dir'>, version: string) =>
  path.resolve(root, cfg.results_dir, version);
export const xlsxName = (version: string) => `security-results-${version}.xlsx`;

/** 판정 입력 파일 — 결과서를 만든 뒤 바뀌면 결과서가 낡은 것이다. */
const INPUT_FILES = ['run.json', 'deps.json', 'headers.json', 'authz.json', 'manual.json', 'triage.yaml'];

export function inputsHash(dir: string): string {
  const h = crypto.createHash('sha256');
  const files = [...INPUT_FILES];
  const zapDir = path.join(dir, 'zap');
  if (fs.existsSync(zapDir)) {
    for (const f of fs.readdirSync(zapDir).filter(f => f.endsWith('.json')).sort()) files.push(`zap/${f}`);
  }
  for (const f of files) {
    let data: Buffer | null = null;
    try { data = fs.readFileSync(path.join(dir, f)); } catch { data = null; }
    h.update(f).update('\0').update(data ? crypto.createHash('sha256').update(data).digest('hex') : 'absent').update('\n');
  }
  return h.digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// 판정
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = 'High' | 'Medium' | 'Low' | 'Info';
export type FindingStatus = 'open' | 'fixed' | 'accepted' | 'false-positive';
const SEV_ORDER: Severity[] = ['High', 'Medium', 'Low', 'Info'];

export interface Finding {
  key: string;
  id: string;
  severity: Severity;
  source: 'zap' | 'deps' | 'headers' | 'authz' | 'manual';
  title: string;
  where: string;
  evidence: string;
  status: FindingStatus;
  reason?: string;
  approvedBy?: string;
}

export interface TriageDecision {
  key: string;
  status: FindingStatus;
  reason?: string;
  evidence?: string;
  approved_by?: string;
}

export interface CheckResult { ok: boolean; value: string }

export interface RoundJudgement {
  version: string;
  dir: string;
  ok: boolean;
  checks: Record<'high' | 'medium' | 'triage' | 'authz' | 'manual' | 'deps' | 'headers' | 'scans', CheckResult>;
  findings: Finding[];
  reasons: string[];
  counts: Record<string, number>;
  triageErrors: string[];
  staleDecisions: string[];
}

const readJson = <T>(p: string): T | undefined => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return undefined; }
};

interface RunFile { schema?: string; version?: string; date?: string; commit?: string; tools?: Record<string, string>; steps?: { name: string; status: string; detail?: string }[]; scans?: { key: string; file: string; name: string; kind: string; target: string; note?: string }[] }
interface DepsFile { manager?: string; command?: string; counts?: Record<string, number>; advisories?: { package: string; severity: string; title?: string; url?: string; range?: string }[] }
interface HeadersFile { rows?: { target: string; url?: string; header: string; value: string; expect?: string; verdict: string }[] }
interface AuthzFile { deny_status?: number[]; rows?: { role: string; method: string; path: string; status: number }[] }
interface ManualFile { rows?: { id: string; category?: string; scenario?: string; request?: string; expected?: number[] | string; actual?: number | string; error?: string }[] }
interface ZapAlert { pluginid: string; name: string; riskcode: string; riskdesc?: string; count?: string; instances?: { uri: string }[]; solution?: string }
interface ZapReport { site?: { '@name'?: string; alerts?: ZapAlert[] }[] }

export function readRound(dir: string) {
  return {
    run: readJson<RunFile>(path.join(dir, 'run.json')),
    deps: readJson<DepsFile>(path.join(dir, 'deps.json')),
    headers: readJson<HeadersFile>(path.join(dir, 'headers.json')),
    authz: readJson<AuthzFile>(path.join(dir, 'authz.json')),
    manual: readJson<ManualFile>(path.join(dir, 'manual.json')),
  };
}

function readTriage(dir: string): { decisions: TriageDecision[]; error?: string } {
  const p = path.join(dir, 'triage.yaml');
  if (!fs.existsSync(p)) return { decisions: [] };
  try {
    const doc = YAML.parse(fs.readFileSync(p, 'utf8')) as { decisions?: unknown } | null;
    const list = Array.isArray(doc?.decisions) ? doc!.decisions as Record<string, unknown>[] : [];
    return {
      decisions: list.map(d => ({
        key: String(d.key ?? ''),
        status: String(d.status ?? 'open') as FindingStatus,
        ...(d.reason ? { reason: String(d.reason) } : {}),
        ...(d.evidence ? { evidence: String(d.evidence) } : {}),
        ...(d.approved_by ? { approved_by: String(d.approved_by) } : {}),
      })),
    };
  } catch (e) {
    return { decisions: [], error: `triage.yaml: ${(e as Error).message}` };
  }
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
const zapSeverity = (riskcode: string): Severity => (['Info', 'Low', 'Medium', 'High'] as Severity[])[Number(riskcode)] ?? 'Info';
const depSeverity = (s: string): Severity =>
  s === 'critical' || s === 'high' ? 'High' : s === 'moderate' || s === 'medium' ? 'Medium' : s === 'low' ? 'Low' : 'Info';

export const isDenied = (status: number, deny: number[]) => deny.includes(Number(status));
export const manualPassed = (r: { expected?: number[] | string; actual?: number | string; error?: string }): 'PASS' | 'FAIL' | 'ERROR' => {
  if (r.error) return 'ERROR';
  const expected = Array.isArray(r.expected) ? r.expected.map(Number) : String(r.expected ?? '').split(/[/,\s]+/).filter(Boolean).map(Number);
  return expected.includes(Number(r.actual)) ? 'PASS' : 'FAIL';
};

/** 원자료 → 발견 사항(분류 전). 키가 같으면 하나로 묶는다(ZAP 은 규칙 번호 단위). */
function rawFindings(dir: string, version: string): Finding[] {
  const { run, deps, headers, authz, manual } = readRound(dir);
  const out = new Map<string, Finding>();
  const add = (f: Omit<Finding, 'id' | 'status'>) => {
    const prev = out.get(f.key);
    if (prev) {
      if (SEV_ORDER.indexOf(f.severity) < SEV_ORDER.indexOf(prev.severity)) prev.severity = f.severity;
      if (!prev.where.split('\n').includes(f.where)) prev.where = `${prev.where}\n${f.where}`;
      return;
    }
    out.set(f.key, { ...f, id: `SEC-${version}-${slug(f.key.replace(/^[a-z]+:/, m => m.slice(0, -1) + '-'))}`, status: 'open' });
  };
  for (const s of run?.scans ?? []) {
    const rel = `zap/${s.file}`;
    const rep = readJson<ZapReport>(path.join(dir, rel));
    for (const site of rep?.site ?? []) {
      for (const a of site.alerts ?? []) {
        const sev = zapSeverity(a.riskcode);
        if (sev === 'Info') continue;
        add({
          key: `zap:${a.pluginid}`, severity: sev, source: 'zap', title: `${a.name} (ZAP ${a.pluginid})`,
          where: `${s.name}: ${(a.instances ?? []).slice(0, 3).map(i => i.uri).join(' · ')}`, evidence: rel,
        });
      }
    }
  }
  for (const a of deps?.advisories ?? []) {
    const sev = depSeverity(a.severity);
    if (sev === 'Info') continue;
    add({ key: `dep:${a.package}`, severity: sev, source: 'deps', title: `${a.package}: ${a.title ?? a.severity}`, where: a.range ?? '', evidence: 'deps.json' });
  }
  for (const h of headers?.rows ?? []) {
    if (h.verdict !== 'fail') continue;
    add({ key: `header:${h.target}:${h.header.toLowerCase()}`, severity: 'Medium', source: 'headers', title: `${h.header} — ${h.expect ?? 'missing'}`, where: h.url ?? h.target, evidence: 'headers.json' });
  }
  const deny = authz?.deny_status ?? DEFAULT_DENY_STATUSES;
  for (const r of authz?.rows ?? []) {
    if (isDenied(r.status, deny)) continue;
    add({ key: `authz:${r.role}:${r.method} ${r.path}`, severity: 'High', source: 'authz', title: `${r.role} was not denied: ${r.method} ${r.path} → ${r.status}`, where: `${r.method} ${r.path}`, evidence: 'authz.json' });
  }
  for (const r of manual?.rows ?? []) {
    if (manualPassed(r) !== 'FAIL') continue;
    add({ key: `manual:${r.id}`, severity: 'High', source: 'manual', title: `${r.id} ${r.scenario ?? ''}`.trim(), where: r.request ?? '', evidence: 'manual.json' });
  }
  return [...out.values()].sort((a, b) =>
    SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || a.key.localeCompare(b.key));
}

/** 회차 폴더를 판정한다. 결과서·요약의 존재는 보지 않는다(그건 `securityVerdict`). 던지지 않는다. */
export function judgeRound(root: string, dir: string, version: string): RoundJudgement {
  const t = trFor(langFor(root));
  const reasons: string[] = [];
  const triageErrors: string[] = [];
  const findings = rawFindings(dir, version);
  const triage = readTriage(dir);
  if (triage.error) triageErrors.push(triage.error);
  const byKey = new Map(findings.map(f => [f.key, f]));
  const staleDecisions: string[] = [];
  for (const d of triage.decisions) {
    const f = byKey.get(d.key);
    if (!f) { staleDecisions.push(d.key); continue; }
    if (!['open', 'fixed', 'accepted', 'false-positive'].includes(d.status)) { triageErrors.push(`${d.key}: unknown status ${d.status}`); continue; }
    if (d.status !== 'open' && !d.reason) { triageErrors.push(`${d.key}: ${d.status} needs a reason`); continue; }
    if ((d.status === 'false-positive' || d.status === 'fixed') && !d.evidence) {
      triageErrors.push(`${d.key}: ${d.status} needs evidence (file:line, commit or re-run log)`); continue;
    }
    if (d.status === 'accepted') {
      if (f.severity === 'High') { triageErrors.push(`${d.key}: a High finding cannot be accepted — fix it or show it is a false positive`); continue; }
      if (!d.approved_by) { triageErrors.push(`${d.key}: accepting a risk needs approved_by (the person who decided)`); continue; }
    }
    f.status = d.status;
    if (d.reason) f.reason = d.reason;
    if (d.evidence) f.evidence = `${f.evidence} · ${d.evidence}`;
    if (d.approved_by) f.approvedBy = d.approved_by;
  }
  const unresolved = (sev: Severity, ok: FindingStatus[]) => findings.filter(f => f.severity === sev && !ok.includes(f.status));
  const highOpen = unresolved('High', ['fixed', 'false-positive']);
  const medOpen = unresolved('Medium', ['fixed', 'accepted', 'false-positive']);

  const { run, deps, headers, authz, manual } = readRound(dir);
  const step = (name: string) => run?.steps?.find(s => s.name === name);
  const authzRows = authz?.rows ?? [];
  const deny = authz?.deny_status ?? DEFAULT_DENY_STATUSES;
  const denied = authzRows.filter(r => isDenied(r.status, deny)).length;
  const manualRows = manual?.rows ?? [];
  const mFail = manualRows.filter(r => manualPassed(r) === 'FAIL').length;
  const mErr = manualRows.filter(r => manualPassed(r) === 'ERROR').length;
  const scanSteps = ['zap-baseline', 'zap-active'].map(n => ({ n, s: step(n) }));

  const checks: RoundJudgement['checks'] = {
    high: { ok: highOpen.length === 0, value: t({ en: `${highOpen.length} unresolved High`, ko: `미해결 High ${highOpen.length}건` }) },
    medium: { ok: medOpen.length === 0, value: t({ en: `${medOpen.length} unaddressed Medium`, ko: `미조치 Medium ${medOpen.length}건` }) },
    triage: { ok: triageErrors.length === 0, value: t({ en: `${triageErrors.length} invalid triage decision(s)`, ko: `잘못된 판정 기록 ${triageErrors.length}건` }) },
    authz: {
      ok: authzRows.length > 0 && denied === authzRows.length,
      value: authz ? `${denied}/${authzRows.length}` : t({ en: 'no result', ko: '결과 없음' }),
    },
    manual: {
      ok: manualRows.length > 0 && mFail === 0 && mErr === 0,
      value: manual ? t({ en: `${manualRows.length} run · ${mFail} failed · ${mErr} errors`, ko: `${manualRows.length}건 · 실패 ${mFail} · 오류 ${mErr}` }) : t({ en: 'no result', ko: '결과 없음' }),
    },
    deps: {
      ok: !!deps && step('deps')?.status !== 'error',
      value: deps ? Object.entries(deps.counts ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '0' : t({ en: 'no result', ko: '결과 없음' }),
    },
    headers: { ok: !!headers && (headers.rows ?? []).length > 0, value: headers ? `${(headers.rows ?? []).length}` : t({ en: 'no result', ko: '결과 없음' }) },
    scans: {
      ok: scanSteps.every(x => x.s?.status === 'ok'),
      value: scanSteps.map(x => `${x.n} ${x.s?.status ?? t({ en: 'not run', ko: '미실행' })}`).join(' · '),
    },
  };

  if (!run) reasons.push(t({ en: `no run record (run.json) in ${dir}`, ko: `${dir} 에 실행 기록(run.json)이 없다` }));
  for (const f of highOpen) reasons.push(t({ en: `unresolved High: ${f.id} ${f.title}`, ko: `미해결 High: ${f.id} ${f.title}` }));
  for (const f of medOpen) reasons.push(t({ en: `unaddressed Medium: ${f.id} ${f.title}`, ko: `미조치 Medium: ${f.id} ${f.title}` }));
  for (const e of triageErrors) reasons.push(t({ en: `invalid triage: ${e}`, ko: `잘못된 판정 기록: ${e}` }));
  if (!checks.authz.ok) {
    reasons.push(authzRows.length === 0
      ? t({ en: 'no authorization-denial results — every unprivileged role must be refused on every protected route', ko: '권한 거부 결과가 없다 — 권한 없는 역할이 보호 라우트마다 거부되는지 전수로 확인해야 한다' })
      : t({ en: `authorization denial ${denied}/${authzRows.length} — must be 100%`, ko: `권한 거부 ${denied}/${authzRows.length} — 100% 여야 한다` }));
  }
  if (!checks.manual.ok) {
    reasons.push(manualRows.length === 0
      ? t({ en: 'no manual scenario results — write scenarios (manual.file) and run them', ko: '수동 시나리오 결과가 없다 — 시나리오 파일(manual.file)을 쓰고 실행하라' })
      : t({ en: `manual scenarios: ${mFail} failed · ${mErr} errors`, ko: `수동 시나리오 실패 ${mFail} · 오류 ${mErr}` }));
  }
  if (!checks.deps.ok) reasons.push(t({ en: 'no dependency audit result', ko: '의존성 감사 결과가 없다' }));
  if (!checks.headers.ok) reasons.push(t({ en: 'no security header result', ko: '보안 헤더 점검 결과가 없다' }));
  for (const x of scanSteps) {
    if (x.s?.status !== 'ok') {
      reasons.push(t({
        en: `${x.n} did not complete (${x.s?.status ?? 'not run'}${x.s?.detail ? `: ${x.s.detail}` : ''})`,
        ko: `${x.n} 이 완료되지 않았다 (${x.s?.status ?? '미실행'}${x.s?.detail ? `: ${x.s.detail}` : ''})`,
      }));
    }
  }
  const sevCount = (s: Severity) => findings.filter(f => f.severity === s).length;
  return {
    version, dir, ok: reasons.length === 0, checks, findings, reasons, triageErrors, staleDecisions,
    counts: {
      findings: findings.length, high: sevCount('High'), medium: sevCount('Medium'), low: sevCount('Low'),
      manual: manualRows.length, manualFailed: mFail, manualError: mErr,
      authzCalls: authzRows.length, authzDenied: denied,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 결과서(엑셀) · 요약 · 결함 초안
// ─────────────────────────────────────────────────────────────────────────────

const DISCLAIMER: Msg = {
  en: 'Self-assessment — does not replace a third-party security assessment or penetration test.',
  ko: '자체 점검 — 제3자(외부 전문 업체)의 보안 진단 · 침투 시험을 대체하지 않음.',
};

/** e2e 원장에서 보안성 케이스를 고른다 — 표시(`security`·`tags`) 또는 본문 규칙. */
const E2E_SECURITY_RE = /\b(?:auth|csrf|xss|ssrf|csp|cors|injection|permission|forbidden|unauthori[sz]ed|401|403|rate.?limit|brute|token|session|upload|sanitiz)|권한|거부|인증|세션|토큰|위조|변조|무차별|업로드|살균|허용 목록|비회원/i;

export function e2eSecurityCases(root: string, globs: string[]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const g of globs) {
    const abs = path.resolve(root, g);
    const dir = path.dirname(abs);
    const base = path.basename(abs);
    const re = globToRegExp(base);
    let files: string[] = [];
    try { files = fs.readdirSync(dir).filter(f => re.test(f)).sort(); } catch { files = []; }
    for (const f of files) {
      const doc = readJson<unknown>(path.join(dir, f));
      const cases = Array.isArray(doc) ? doc : Array.isArray((doc as { cases?: unknown })?.cases) ? (doc as { cases: unknown[] }).cases : [];
      for (const c of cases as Record<string, unknown>[]) {
        const tags = Array.isArray(c.tags) ? c.tags.map(String) : [];
        const text = ['feature', 'scenario', 'title', 'expected'].map(k => String(c[k] ?? '')).join(' ');
        if (c.security === true || tags.includes('security') || c.module === 'security' || E2E_SECURITY_RE.test(text)) {
          out.push({
            id: String(c.id ?? ''), module: String(c.module ?? path.basename(f).split('.')[0]),
            scenario: String(c.scenario ?? c.title ?? c.feature ?? ''), expected: String(c.expected ?? ''),
            spec: String(c.spec ?? ''), file: path.relative(root, path.join(dir, f)),
          });
        }
      }
    }
  }
  return out;
}

function sheets(root: string, j: RoundJudgement, cfg: SecurityConfig, t: Tr): Sheet[] {
  const { run, deps, headers, authz, manual } = readRound(j.dir);
  const S = (en: string, ko: string) => t({ en, ko });
  const verdictText = j.ok ? S('PASSED', '통과') : S('NOT PASSED', '미통과');
  const cover: Sheet = {
    name: S('Cover', '표지'), header: [S('Security check results', '보안 점검 결과서'), ''], widths: [26, 100],
    rows: [
      [S('Version', '버전'), j.version],
      [S('Date', '점검일'), run?.date ?? ''],
      [S('Commit', '커밋'), run?.commit ?? ''],
      [S('Verdict', '판정'), verdictText],
      [S('Notice', '주의'), t(DISCLAIMER)],
      [S('Scope', '범위'), cfg.targets.map(t => `${t.name} ${t.url}`).join('\n')],
      [S('Tools', '도구'), Object.entries(run?.tools ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n')],
    ],
  };
  const CRIT: Record<string, Msg> = {
    high: { en: 'Unresolved High = 0 (fixed or false positive only)', ko: '미해결 High 0건(수정 · 오탐만 해결로 인정)' },
    medium: { en: 'Unaddressed Medium = 0 (fixed · accepted with approver · false positive)', ko: '미조치 Medium 0건(수정 · 승인자 있는 수용 · 오탐)' },
    triage: { en: 'Every triage decision has its reason and evidence', ko: '판정 기록마다 사유 · 근거가 있다' },
    authz: { en: 'Authorization denial = 100% for unprivileged roles', ko: '권한 없는 역할 거부 100%' },
    manual: { en: 'Manual scenarios: 0 failed · 0 errors', ko: '수동 시나리오 실패 · 오류 0건' },
    deps: { en: 'Dependency audit ran', ko: '의존성 감사 실행' },
    headers: { en: 'Security header check ran', ko: '보안 헤더 점검 실행' },
    scans: { en: 'ZAP baseline and authenticated active scan completed', ko: 'ZAP baseline · 인증 active 점검 완료' },
  };
  const summary: Sheet = {
    name: S('Summary', '요약'), header: [S('Check', '항목'), S('Criterion', '기준'), S('Result', '결과'), S('Pass', '통과')], widths: [12, 60, 40, 8],
    rows: [
      ...Object.entries(j.checks).map(([k, c]) => [k, t(CRIT[k]), c.value, c.ok ? 'O' : 'X'] as Cell[]),
      ['', '', '', ''],
      [S('findings', '발견'), `High ${j.counts.high} · Medium ${j.counts.medium} · Low ${j.counts.low}`, '', ''],
      ...j.reasons.map(r => [S('blocking', '차단 사유'), r, '', ''] as Cell[]),
    ],
  };
  const findings: Sheet = {
    name: S('Findings', '발견 사항'),
    header: ['ID', S('Severity', '위험도'), S('Source', '출처'), S('Title', '내용'), S('Where', '위치'), S('Status', '상태'), S('Reason', '사유'), S('Approved by', '승인자'), S('Evidence', '근거'), S('Key', '키')],
    widths: [30, 10, 9, 50, 50, 14, 50, 14, 40, 30],
    rows: j.findings.map(f => [f.id, f.severity, f.source, f.title, f.where, f.status, f.reason ?? '', f.approvedBy ?? '', f.evidence, f.key]),
  };
  const manualSheet: Sheet = {
    name: S('Manual scenarios', '수동 시나리오'),
    header: ['ID', S('Category', '분류'), S('Scenario', '시나리오'), S('Request', '요청'), S('Expected', '기대'), S('Actual', '실제'), S('Result', '결과')],
    widths: [10, 16, 50, 46, 12, 8, 8],
    rows: (manual?.rows ?? []).map(r => [r.id, r.category ?? '', r.scenario ?? '', r.request ?? '',
      Array.isArray(r.expected) ? r.expected.join('/') : String(r.expected ?? ''), r.error ? r.error : r.actual ?? '', manualPassed(r)]),
  };
  const deny = authz?.deny_status ?? DEFAULT_DENY_STATUSES;
  const authzSheet: Sheet = {
    name: S('Authorization denial', '권한 거부'),
    header: [S('Role', '역할'), S('Method', '메서드'), S('Path', '경로'), S('Status', '응답'), S('Result', '결과')],
    widths: [14, 9, 60, 8, 8],
    rows: (authz?.rows ?? []).map(r => [r.role, r.method, r.path, r.status, isDenied(r.status, deny) ? 'PASS' : 'FAIL']),
  };
  const scanRows: Cell[][] = [];
  for (const s of run?.scans ?? []) {
    const rep = readJson<ZapReport>(path.join(j.dir, 'zap', s.file));
    for (const site of rep?.site ?? []) {
      for (const a of site.alerts ?? []) {
        const uris = [...new Set((a.instances ?? []).map(i => i.uri))].sort();
        scanRows.push([s.name, s.kind, a.pluginid, a.name, zapSeverity(a.riskcode), Number(a.count ?? uris.length),
          uris.slice(0, 5).join('\n') + (uris.length > 5 ? `\n… +${uris.length - 5}` : '')]);
      }
    }
  }
  for (const st of run?.steps ?? []) scanRows.push([`[${st.name}]`, st.status, '', st.detail ?? '', '', '', '']);
  const scansSheet: Sheet = {
    name: S('Automated scans', '자동 점검'),
    header: [S('Scan', '점검'), S('Kind', '종류'), S('Rule', '규칙'), S('Alert', '경고'), S('Risk', '위험도'), S('Count', '건수'), S('URLs (max 5)', '대상 주소(최대 5)')],
    widths: [22, 10, 8, 50, 9, 7, 70], rows: scanRows,
  };
  const headersSheet: Sheet = {
    name: S('Security headers', '보안 헤더'),
    header: [S('Target', '대상'), S('Header', '헤더'), S('Value', '값'), S('Expected', '기대'), S('Result', '결과')],
    widths: [24, 30, 70, 30, 8],
    rows: (headers?.rows ?? []).map(h => [`${h.target} ${h.url ?? ''}`.trim(), h.header, h.value, h.expect ?? '', h.verdict]),
  };
  const depsSheet: Sheet = {
    name: S('Dependencies', '의존성'),
    header: [S('Package', '패키지'), S('Severity', '심각도'), S('Title', '내용'), S('Range', '범위'), 'URL'],
    widths: [30, 10, 60, 24, 50],
    rows: [
      [`${deps?.manager ?? ''} ${deps?.command ?? ''}`.trim(), Object.entries(deps?.counts ?? {}).map(([k, v]) => `${k} ${v}`).join(' · '), '', '', ''],
      ...(deps?.advisories ?? []).map(a => [a.package, a.severity, a.title ?? '', a.range ?? '', a.url ?? '']),
    ],
  };
  const out = [cover, summary, findings, manualSheet, authzSheet, scansSheet, headersSheet, depsSheet];
  if (cfg.e2e_ledger && cfg.e2e_ledger.length > 0) {
    const cases = e2eSecurityCases(root, cfg.e2e_ledger);
    out.push({
      name: S('E2E security cases', 'e2e 보안성 케이스'),
      header: ['ID', S('Module', '모듈'), S('Scenario', '시나리오'), S('Expected', '기대 결과'), 'Spec', S('Ledger', '원장')],
      widths: [20, 12, 50, 50, 36, 30],
      rows: cases.map(c => [c.id, c.module, c.scenario, c.expected, c.spec, c.file]),
    });
  }
  return out;
}

/** `harness ship defect add` 로 그대로 옮길 수 있는 명령 줄 — 미해결 High·Medium 만. */
export function defectCommands(j: RoundJudgement, root?: string): string[] {
  // 근거 경로는 프로젝트 상대로 — 대장은 저장소에 커밋되므로 이 머신의 절대 경로가 남으면 안 된다.
  const where = (p: string) => (root ? path.relative(root, p) : p);
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return j.findings
    .filter(f => (f.severity === 'High' && !['fixed', 'false-positive'].includes(f.status))
      || (f.severity === 'Medium' && !['fixed', 'accepted', 'false-positive'].includes(f.status)))
    .map(f => `harness ship defect add --id ${f.id} --severity ${f.severity === 'High' ? 'high' : 'medium'} `
      + `--title ${q(f.title.slice(0, 160))} --evidence ${q(where(path.join(j.dir, f.evidence.split(' · ')[0])))}`);
}

export interface ReportResult { judgement: RoundJudgement; xlsx: string; summary: string; defects: string }

/** 회차 폴더의 원자료로 결과서 · 요약 · 결함 초안을 만든다. 판정은 `judgeRound` 그대로다. */
export function writeSecurityReport(root: string, cfg: SecurityConfig, version: string): ReportResult {
  const dir = roundDir(root, cfg, version);
  if (!fs.existsSync(dir)) {
    throw new Error(tr(root, {
      en: `No results folder for ${version}: ${dir} — run the security check first (skill security-verify)`,
      ko: `${version} 의 결과 폴더가 없다: ${dir} — 보안 점검을 먼저 돌려라(스킬 security-verify)`,
    }));
  }
  const t = trFor(langFor(root));
  const j = judgeRound(root, dir, version);
  const xlsx = path.join(dir, xlsxName(version));
  fs.writeFileSync(xlsx, buildXlsx(sheets(root, j, cfg, t)));
  const summary = path.join(dir, 'summary.json');
  fs.writeFileSync(summary, `${JSON.stringify({
    schema: 'security-summary/1', version, date: readRound(dir).run?.date ?? '', verdict: j.ok ? 'passed' : 'failed',
    checks: j.checks, counts: j.counts, reasons: j.reasons, staleDecisions: j.staleDecisions,
    xlsx: xlsxName(version), inputsHash: inputsHash(dir), disclaimer: t(DISCLAIMER),
  }, null, 1)}\n`);
  const defects = path.join(dir, 'defects.md');
  const cmds = defectCommands(j, root);
  fs.writeFileSync(defects, [
    `# ${t({ en: 'Defect drafts', ko: '결함 초안' })} — ${version}`, '',
    t({
      en: 'Unresolved High and Medium findings, ready to transcribe into the defect ledger. Register each through the CLI — never hand-edit the ledger.',
      ko: '미해결 High · Medium 발견 사항이다. 결함 대장에 그대로 옮길 수 있다. 대장은 손으로 고치지 말고 아래 명령으로 등록한다.',
    }), '',
    ...(cmds.length ? ['```bash', ...cmds, '```'] : [t({ en: 'None.', ko: '없음.' })]), '',
  ].join('\n'));
  return { judgement: j, xlsx, summary, defects };
}

// ─────────────────────────────────────────────────────────────────────────────
// 게이트 연결
// ─────────────────────────────────────────────────────────────────────────────

export interface SecurityVerdict {
  ok: boolean;
  applies: boolean;
  version?: string;
  dir?: string;
  reasons: string[];
  judgement?: RoundJudgement;
}

/**
 * 「지금 버전의 보안 결과가 통과했는가」. 원자료를 다시 판정하고, 결과서가 **그 자료에서**
 * 만들어졌는지(입력 해시) 본다 — 결과서를 만든 뒤 판정 기록을 고쳤으면 결과서가 낡은 것이다.
 * 던지지 않는다(판정 함수).
 */
export function securityVerdict(root: string, versionOverride?: string): SecurityVerdict {
  const t = trFor(langFor(root));
  const loaded = loadSecurityConfig(root);
  if (loaded.status === 'absent') {
    return {
      ok: false, applies: true, reasons: [t({
        en: 'no security check configuration (.harness/profile/security.yaml) — every version needs a security result before '
          + 'shipping. Write the file (skill security-verify has the template); a product with no network surface sets '
          + '`applies: false` with a `reason`',
        ko: '보안 점검 설정(.harness/profile/security.yaml)이 없다 — 버전마다 보안 결과가 있어야 출하할 수 있다. '
          + '파일을 만들어라(스킬 security-verify 에 견본이 있다). 네트워크 노출이 없는 제품은 `applies: false` 와 `reason` 을 적는다',
      })],
    };
  }
  if (loaded.status === 'invalid') {
    return { ok: false, applies: true, reasons: loaded.errors.map(e => t({ en: `security.yaml: ${e}`, ko: `security.yaml: ${e}` })) };
  }
  const cfg = loaded.config;
  if (!cfg.applies) return { ok: true, applies: false, reasons: [] };
  let version: string;
  try {
    version = versionOverride ? assertVersion(root, versionOverride, '--version') : currentVersion(root, cfg);
  } catch (e) {
    return { ok: false, applies: true, reasons: [(e as Error).message] };
  }
  const dir = roundDir(root, cfg, version);
  if (!fs.existsSync(dir)) {
    return {
      ok: false, applies: true, version, dir, reasons: [t({
        en: `no security result for version ${version} (${path.relative(root, dir)}) — the version changed since the last check, `
          + 'or the check never ran. Run it for this version (skill security-verify)',
        ko: `버전 ${version} 의 보안 결과가 없다 (${path.relative(root, dir)}) — 마지막 점검 뒤 버전이 바뀌었거나 점검을 `
          + '돌린 적이 없다. 이 버전으로 다시 돌려라(스킬 security-verify)',
      })],
    };
  }
  const j = judgeRound(root, dir, version);
  const reasons = [...j.reasons];
  const xlsx = path.join(dir, xlsxName(version));
  const summary = readJson<{ inputsHash?: string }>(path.join(dir, 'summary.json'));
  let readable = false;
  try { readable = readXlsx(fs.readFileSync(xlsx)).length > 0; } catch { readable = false; }
  if (!readable) {
    reasons.push(t({
      en: `the results workbook is missing or unreadable: ${path.relative(root, xlsx)} — run \`harness security report\``,
      ko: `결과서(엑셀)가 없거나 읽을 수 없다: ${path.relative(root, xlsx)} — \`harness security report\` 를 실행하라`,
    }));
  } else if (summary?.inputsHash !== inputsHash(dir)) {
    reasons.push(t({
      en: 'the results workbook is stale — results or triage changed after it was built. Run `harness security report` again',
      ko: '결과서가 낡았다 — 결과서를 만든 뒤 결과나 판정 기록이 바뀌었다. `harness security report` 를 다시 실행하라',
    }));
  }
  return { ok: reasons.length === 0, applies: true, version, dir, reasons, judgement: j };
}

/**
 * 출하 게이트(P10·P12)가 쓰는 한 줄 — 위반이면 사유, 아니면 null. 승인 거부문과 `ship verdict`
 * 사유가 같은 문장이 되도록 한 곳에서 만든다(measuredOnlyViolation 과 같은 형태).
 */
export function securityGateViolation(root: string, phase: string): string | null {
  if (phase !== 'P10' && phase !== 'P12') return null;
  const v = securityVerdict(root);
  if (v.ok) return null;
  const head = v.reasons.slice(0, 5).join(' / ');
  const more = v.reasons.length - 5;
  return tr(root, {
    en: `Gate ${phase} needs a passing security result for the current version${v.version ? ` (${v.version})` : ''}: `
      + head + (more > 0 ? ` (+${more} more)` : ''),
    ko: `게이트 ${phase} 는 현재 버전${v.version ? `(${v.version})` : ''}의 보안 결과 통과가 필요하다: `
      + head + (more > 0 ? ` (외 ${more}건)` : ''),
  });
}
