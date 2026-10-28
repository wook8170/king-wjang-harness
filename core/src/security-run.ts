/**
 * 보안 점검 실행기 — 별도 진입점(`core/dist/security-run.js`).
 *
 * **CLI·훅과 분리된 이유.** 코어(§1)는 네트워크·프로세스를 타지 않는다. 이 파일은 정반대 일을
 * 한다: 격리 스택을 띄우고, 의존성 감사·헤더·권한 거부·수동 시나리오·ZAP 을 돌리고, 결과를 회차
 * 폴더에 쓴다. 그래서 `cli.ts`·`hook.ts` 가 이 파일을 import 하지 않으며 회귀가 그것을 고정한다.
 * 허용 대상 판정 · 라우트 해석 · 판정 · 결과서는 `security.ts` 한 벌을 그대로 쓴다.
 *
 * 사용:
 *   node <plugin>/core/dist/security-run.js [--version <v>] [--only a,b] [--skip a,b]
 *   단계: deps · headers · authz · manual · zap-baseline · zap-active
 * 종료 코드: 0 통과 · 2 미통과 · 1 실행 오류(설정 · 허용 대상 밖 주소 등).
 *
 * 안전장치:
 *  - 모든 HTTP 요청과 ZAP 대상은 보내기 직전에 `checkTarget` 을 거친다. 밖이면 요청 없이 멈춘다.
 *  - 로그인 비밀값은 `${ENV}` 로만 받고, 받은 토큰과 함께 끝에서 결과 폴더 전체에서 지운다.
 *  - 컨테이너는 이름(`kwh-sec-<pid>-<n>`)으로, 스택은 띄운 PID(프로세스 그룹)로 정리한다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import * as https from 'node:https';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  loadSecurityConfig, checkTarget, parseRoutes, selectRoutes, fillPathParams, currentVersion, assertVersion,
  roundDir, writeSecurityReport, DEFAULT_DENY_STATUSES, type SecurityConfig, type RoleConfig,
} from './security';

const STEPS = ['deps', 'headers', 'authz', 'manual', 'zap-baseline', 'zap-active'] as const;
type Step = (typeof STEPS)[number];
interface StepRecord { name: string; status: 'ok' | 'skipped' | 'error'; detail?: string }

export class TargetRefused extends Error {}

const log = (m: string) => process.stderr.write(`[security] ${m}\n`);

// ── HTTP ────────────────────────────────────────────────────────────────────

export interface Resp { status: number; headers: Record<string, string | string[] | undefined>; body: string }

/** 허용 대상 확인을 통과한 주소에만 요청한다. 로컬 시험 스택의 자체 서명 인증서는 받는다. */
export function request(
  cfg: Pick<SecurityConfig, 'allow_hosts' | 'allow_ports'>, method: string, url: string,
  headers: Record<string, string> = {}, body?: string, timeoutMs = 30_000,
): Promise<Resp> {
  const c = checkTarget(url, cfg);
  if (!c.ok) return Promise.reject(new TargetRefused(c.reason));
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(u, {
      method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      rejectUnauthorized: false, timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => { if (chunks.reduce((n, b) => n + b.length, 0) < 65536) chunks.push(d); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${url}`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// ── 비밀값 ──────────────────────────────────────────────────────────────────

export const secrets = new Set<string>();

/** `${NAME}` 를 환경변수로 채우고 그 값을 지울 목록에 올린다. 없으면 실패한다. */
export function fillEnv(s: string, env: NodeJS.ProcessEnv = process.env): string {
  return s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const v = env[name];
    if (v === undefined || v === '') throw new Error(`environment variable ${name} is not set (used by security.yaml)`);
    if (v.length >= 4) secrets.add(v);
    return v;
  });
}

/** 결과 폴더의 글자 파일에서 비밀값을 지운다. 지운 횟수를 돌려준다. */
export function scrubDir(dir: string, values: Iterable<string> = secrets): number {
  const list = [...values].filter(v => v.length >= 4).sort((a, b) => b.length - a.length);
  if (list.length === 0) return 0;
  let n = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(json|html|md|txt|ya?ml|log|xml)$/i.test(e.name)) continue;
      let s = fs.readFileSync(p, 'utf8');
      let changed = false;
      for (const v of list) {
        if (s.includes(v)) { n += s.split(v).length - 1; s = s.split(v).join('[REDACTED]'); changed = true; }
      }
      if (changed) fs.writeFileSync(p, s);
    }
  };
  walk(dir);
  return n;
}

// ── 로그인 ──────────────────────────────────────────────────────────────────

/** 역할의 인증 헤더. 비로그인 역할은 빈 객체. */
export async function loginHeaders(cfg: SecurityConfig, role: RoleConfig): Promise<Record<string, string>> {
  const l = role.login;
  if (!l) return {};
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(l.headers ?? {})) headers[k] = fillEnv(String(v));
  const r = await request(cfg, l.method, l.url, headers, l.body !== undefined ? fillEnv(l.body) : undefined);
  if (r.status < 200 || r.status >= 300) throw new Error(`login for role ${role.name} failed: ${r.status}`);
  let token = '';
  const [kind, key] = [l.token_from.split(':')[0], l.token_from.slice(l.token_from.indexOf(':') + 1)];
  if (kind === 'json') {
    let v: unknown = JSON.parse(r.body);
    for (const part of key.split('.')) v = (v as Record<string, unknown>)?.[part];
    token = typeof v === 'string' ? v : '';
  } else if (kind === 'cookie') {
    const sc = r.headers['set-cookie'];
    for (const c of Array.isArray(sc) ? sc : sc ? [sc] : []) {
      const m = new RegExp(`(?:^|;\\s*)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`).exec(c);
      if (m) token = m[1];
    }
  } else if (kind === 'header') {
    const h = r.headers[key.toLowerCase()];
    token = Array.isArray(h) ? h[0] : h ?? '';
  }
  if (!token) throw new Error(`login for role ${role.name}: no token at ${l.token_from}`);
  secrets.add(token);
  const line = l.use.replace('{token}', token);
  const i = line.indexOf(':');
  return { [line.slice(0, i).trim()]: line.slice(i + 1).trim() };
}

// ── 단계 ────────────────────────────────────────────────────────────────────

const write = (dir: string, name: string, v: unknown) => fs.writeFileSync(path.join(dir, name), `${JSON.stringify(v, null, 1)}\n`);
const targetUrl = (cfg: SecurityConfig, name?: string) => {
  const t = name ? cfg.targets.find(x => x.name === name) : cfg.targets[0];
  if (!t) throw new Error(`no target ${name ?? '(first)'} in security.yaml`);
  return t.url.replace(/\/$/, '');
};

/** 잠금 파일로 패키지 관리자를 고른다. */
export function detectDepsCommand(root: string): { manager: string; command: string } | null {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return { manager: 'pnpm', command: 'pnpm audit --prod --json' };
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return { manager: 'npm', command: 'npm audit --omit=dev --json' };
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return { manager: 'yarn', command: 'yarn npm audit --environment production --json' };
  if (fs.existsSync(path.join(root, 'Cargo.lock'))) return { manager: 'cargo', command: 'cargo audit --json' };
  if (fs.existsSync(path.join(root, 'requirements.txt'))) return { manager: 'pip', command: 'pip-audit -r requirements.txt -f json' };
  if (fs.existsSync(path.join(root, 'go.sum'))) return { manager: 'go', command: 'govulncheck -json ./...' };
  return null;
}

/** npm(7+) · npm6/pnpm(advisories) · pip-audit 출력을 공통 형태로. */
export function parseAudit(text: string): { counts: Record<string, number>; advisories: { package: string; severity: string; title?: string; url?: string; range?: string }[] } {
  const advisories: { package: string; severity: string; title?: string; url?: string; range?: string }[] = [];
  let doc: Record<string, unknown> = {};
  try { doc = JSON.parse(text) as Record<string, unknown>; } catch {
    const last = text.trim().split('\n').reverse().find(l => l.startsWith('{'));
    if (last) { try { doc = JSON.parse(last) as Record<string, unknown>; } catch { /* 아래에서 0 */ } }
  }
  if (doc.vulnerabilities && typeof doc.vulnerabilities === 'object') {
    for (const [pkg, v] of Object.entries(doc.vulnerabilities as Record<string, Record<string, unknown>>)) {
      const via = Array.isArray(v.via) ? v.via.find(x => typeof x === 'object') as Record<string, unknown> | undefined : undefined;
      advisories.push({ package: pkg, severity: String(v.severity ?? 'info'), title: via ? String(via.title ?? '') : `via ${(v.via as unknown[] ?? []).join(', ')}`, url: via ? String(via.url ?? '') : '', range: String(v.range ?? '') });
    }
  } else if (doc.advisories && typeof doc.advisories === 'object') {
    for (const a of Object.values(doc.advisories as Record<string, Record<string, unknown>>)) {
      advisories.push({ package: String(a.module_name ?? ''), severity: String(a.severity ?? 'info'), title: String(a.title ?? ''), url: String(a.url ?? ''), range: String(a.vulnerable_versions ?? '') });
    }
  } else if (Array.isArray(doc.dependencies)) {
    for (const d of doc.dependencies as Record<string, unknown>[]) {
      for (const v of (d.vulns as Record<string, unknown>[] | undefined) ?? []) {
        advisories.push({ package: String(d.name), severity: 'high', title: String(v.id ?? ''), range: String(d.version ?? '') });
      }
    }
  }
  const counts: Record<string, number> = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  for (const a of advisories) counts[a.severity] = (counts[a.severity] ?? 0) + 1;
  return { counts, advisories };
}

function runShell(root: string, command: string, timeoutMs = 600_000): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('sh', ['-c', command], { cwd: root, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

async function stepDeps(root: string, cfg: SecurityConfig, dir: string): Promise<StepRecord> {
  const det = cfg.deps?.command ? { manager: 'custom', command: cfg.deps.command } : detectDepsCommand(root);
  if (!det) return { name: 'deps', status: 'error', detail: 'no lockfile detected — set deps.command' };
  const r = runShell(root, det.command);
  const parsed = parseAudit(r.stdout);
  if (r.code !== 0 && parsed.advisories.length === 0 && !/^\s*\{/.test(r.stdout)) {
    return { name: 'deps', status: 'error', detail: `${det.command} exited ${r.code}: ${r.stderr.slice(0, 300)}` };
  }
  write(dir, 'deps.json', { schema: 'security-deps/1', manager: det.manager, command: det.command, ...parsed });
  return { name: 'deps', status: 'ok', detail: `${det.command} · ${parsed.advisories.length} advisories` };
}

export const DEFAULT_REQUIRED_HEADERS = ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy'];

/** 응답 헤더를 기대 목록과 대조한다. `x-frame-options` 는 CSP frame-ancestors 가 있으면 대신한다. */
export function checkHeaders(target: string, url: string, h: Record<string, string | string[] | undefined>, require: string[]) {
  const get = (k: string) => { const v = h[k]; return Array.isArray(v) ? v.join(', ') : v ?? ''; };
  const req = [...require];
  if (url.startsWith('https:') && !req.includes('strict-transport-security')) req.push('strict-transport-security');
  const rows = req.map((k) => {
    let v = get(k);
    let verdict = v ? 'pass' : 'fail';
    if (k === 'x-content-type-options' && v && v.toLowerCase() !== 'nosniff') verdict = 'fail';
    if (k === 'x-frame-options' && !v && /frame-ancestors/i.test(get('content-security-policy'))) { verdict = 'pass'; v = '(CSP frame-ancestors)'; }
    return { target, url, header: k, value: v || '(none)', expect: k === 'x-content-type-options' ? 'nosniff' : 'present', verdict };
  });
  const server = get('server');
  if (server) rows.push({ target, url, header: 'server', value: server, expect: 'no version', verdict: /\d/.test(server) ? 'fail' : 'pass' });
  const cookies = h['set-cookie'];
  for (const c of Array.isArray(cookies) ? cookies : cookies ? [cookies] : []) {
    const name = c.split('=')[0];
    const ok = /httponly/i.test(c) && /samesite/i.test(c) && (!url.startsWith('https:') || /secure/i.test(c));
    rows.push({ target, url, header: `set-cookie ${name}`, value: c.replace(/=[^;]*/, '=…'), expect: 'HttpOnly; SameSite; Secure(https)', verdict: ok ? 'pass' : 'fail' });
  }
  return rows;
}

async function stepHeaders(cfg: SecurityConfig, dir: string): Promise<StepRecord> {
  const names = cfg.headers?.targets?.length ? cfg.headers.targets : cfg.targets.map(t => t.name);
  const require = cfg.headers?.require?.length ? cfg.headers.require.map(s => s.toLowerCase()) : DEFAULT_REQUIRED_HEADERS;
  const rows: ReturnType<typeof checkHeaders> = [];
  for (const n of names) {
    const url = `${targetUrl(cfg, n)}/`;
    const r = await request(cfg, 'GET', url);
    rows.push(...checkHeaders(n, url, r.headers, require));
  }
  write(dir, 'headers.json', { schema: 'security-headers/1', rows });
  return { name: 'headers', status: 'ok', detail: `${rows.length} checks` };
}

async function stepAuthz(root: string, cfg: SecurityConfig, dir: string, auth: Map<string, Record<string, string>>): Promise<StepRecord> {
  const rc = cfg.routes;
  if (!rc?.command && !rc?.file) return { name: 'authz', status: 'error', detail: 'routes.command or routes.file is not set' };
  let text = '';
  if (rc.command) {
    const r = runShell(root, rc.command, 120_000);
    if (r.code !== 0) return { name: 'authz', status: 'error', detail: `routes.command exited ${r.code}: ${r.stderr.slice(0, 300)}` };
    text = r.stdout;
  } else {
    text = fs.readFileSync(path.resolve(root, rc.file!), 'utf8');
  }
  const all = parseRoutes(text);
  const roles = cfg.roles.filter(r => !r.privileged);
  const perRole = new Map(roles.map(r => [r.name, selectRoutes(all, r.deny ?? rc.include, rc.exclude)]));
  const routes = [...new Map([...perRole.values()].flat().map(r => [`${r.method} ${r.path}`, r])).values()];
  write(dir, 'routes.json', { extracted: all.length, selected: Object.fromEntries(perRole) });
  if (routes.length === 0) return { name: 'authz', status: 'error', detail: `0 routes selected (${all.length} extracted)` };
  const base = targetUrl(cfg, rc.target);
  const deny = rc.deny_status?.length ? rc.deny_status : DEFAULT_DENY_STATUSES;
  const rows: { role: string; method: string; path: string; status: number }[] = [];
  for (const role of roles) {
    for (const rt of perRole.get(role.name) ?? []) {
      const body = ['POST', 'PUT', 'PATCH'].includes(rt.method) ? '{}' : undefined;
      let status = -1;
      try { status = (await request(cfg, rt.method, base + fillPathParams(rt.path), auth.get(role.name) ?? {}, body)).status; } catch (e) {
        if (e instanceof TargetRefused) throw e;
      }
      rows.push({ role: role.name, method: rt.method, path: rt.path, status });
    }
  }
  write(dir, 'authz.json', { schema: 'security-authz/1', deny_status: deny, extracted: all.length, rows });
  return { name: 'authz', status: 'ok', detail: `${rows.length} calls · ${routes.length} routes · ${roles.length} roles` };
}

interface Scenario { id: string; category?: string; scenario?: string; role?: string; method: string; path: string; target?: string; headers?: Record<string, string>; body?: unknown; expect: number[] }

async function stepManual(root: string, cfg: SecurityConfig, dir: string, auth: Map<string, Record<string, string>>): Promise<StepRecord> {
  if (!cfg.manual?.file) return { name: 'manual', status: 'error', detail: 'manual.file is not set' };
  const list = JSON.parse(fs.readFileSync(path.resolve(root, cfg.manual.file), 'utf8')) as Scenario[] | { scenarios: Scenario[] };
  const scenarios = Array.isArray(list) ? list : list.scenarios;
  const rows = [];
  for (const s of scenarios) {
    const base = targetUrl(cfg, s.target ?? cfg.manual.target);
    const headers = { ...(s.role ? auth.get(s.role) ?? {} : {}), ...Object.fromEntries(Object.entries(s.headers ?? {}).map(([k, v]) => [k, fillEnv(String(v))])) };
    const body = s.body === undefined ? undefined : typeof s.body === 'string' ? fillEnv(s.body) : JSON.stringify(s.body);
    const row: Record<string, unknown> = { id: s.id, category: s.category ?? '', scenario: s.scenario ?? '', request: `${s.method.toUpperCase()} ${s.path}${s.role ? ` (${s.role})` : ''}`, expected: s.expect };
    try {
      const r = await request(cfg, s.method.toUpperCase(), base + s.path, headers, body);
      row.actual = r.status;
    } catch (e) {
      if (e instanceof TargetRefused) throw e;
      row.error = (e as Error).message;
    }
    rows.push(row);
  }
  write(dir, 'manual.json', { schema: 'security-manual/1', rows });
  return { name: 'manual', status: 'ok', detail: `${rows.length} scenarios` };
}

// ── ZAP ─────────────────────────────────────────────────────────────────────

let containerSeq = 0;
export const containers = new Set<string>();

/** 컨테이너 안에서 본 대상 주소. 리눅스 host 망은 그대로, 나머지는 host.docker.internal 로. */
export function zapNetwork(cfg: SecurityConfig, platform = process.platform): { args: string[]; rewrite: (u: string) => string } {
  const mode = cfg.zap?.network === 'auto' || !cfg.zap?.network ? (platform === 'linux' ? 'host' : 'bridge') : cfg.zap.network;
  if (mode === 'host') return { args: ['--network', 'host'], rewrite: u => u };
  return {
    args: ['--add-host', 'host.docker.internal:host-gateway'],
    rewrite: (u) => { const x = new URL(u); if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(x.hostname)) x.hostname = 'host.docker.internal'; return x.toString(); },
  };
}

/** ZAP 이 외부로 요청하지 않게 하는 공통 옵션 — 외부 콜백(OAST) 끔 · 업데이트 확인 끔. */
export const ZAP_QUIET = ['-silent', '-config oast.activeScanService=', '-config oast.boast.uri=', '-config start.checkForUpdates=false'];

function docker(args: string[], timeoutMs: number): { code: number; out: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? (r.error ? -1 : 0), out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function ensureImage(image: string): string | null {
  if (docker(['image', 'inspect', image], 60_000).code === 0) return null;
  log(`pulling ${image}`);
  const p = docker(['pull', image], 1_800_000);
  return p.code === 0 ? null : `docker pull ${image} failed: ${p.out.slice(-300)}`;
}

function runZap(cfg: SecurityConfig, dir: string, script: string, scriptArgs: string[], minutes: number): { code: number; log: string } {
  const name = `kwh-sec-${process.pid}-${++containerSeq}`;
  containers.add(name);
  const net = zapNetwork(cfg);
  const args = ['run', '--rm', '--name', name, '--label', 'kwh-security=1', ...(cfg.zap?.cpus ? ['--cpus', String(cfg.zap.cpus)] : []),
    ...net.args, '-v', `${path.join(dir, 'zap')}:/zap/wrk:rw`, cfg.zap!.image, script, ...scriptArgs];
  const r = docker(args, (minutes + 10) * 60_000);
  if (r.code === -1) docker(['rm', '-f', name], 60_000);
  containers.delete(name);
  return { code: r.code, log: r.out };
}

const zEsc = (s: string) => s.replace(/ /g, '\\ ');

async function stepZapBaseline(cfg: SecurityConfig, dir: string, scans: unknown[]): Promise<StepRecord> {
  const z = cfg.zap;
  if (!z?.baseline?.length) return { name: 'zap-baseline', status: 'error', detail: 'zap.baseline lists no target' };
  const err = ensureImage(z.image);
  if (err) return { name: 'zap-baseline', status: 'error', detail: err };
  const net = zapNetwork(cfg);
  const fails: string[] = [];
  for (const n of z.baseline) {
    const url = `${targetUrl(cfg, n)}/`;
    const c = checkTarget(url, cfg);
    if (!c.ok) throw new TargetRefused(c.reason);
    const file = `baseline-${n}.json`;
    const minutes = z.baseline_minutes ?? 1;
    const r = runZap(cfg, dir, 'zap-baseline.py', ['-t', net.rewrite(url), '-m', String(minutes), '-I', '-J', file, '-r', `baseline-${n}.html`, '-z', ZAP_QUIET.join(' ')], minutes);
    fs.writeFileSync(path.join(dir, 'zap', `baseline-${n}.log`), r.log);
    if (r.code >= 3 || r.code < 0 || !fs.existsSync(path.join(dir, 'zap', file))) fails.push(`${n} exit ${r.code}`);
    else scans.push({ key: `baseline-${n}`, file, name: n, kind: 'baseline', target: url, note: `spider ${minutes}m · passive rules` });
  }
  return fails.length ? { name: 'zap-baseline', status: 'error', detail: fails.join(', ') } : { name: 'zap-baseline', status: 'ok', detail: z.image };
}

async function stepZapActive(root: string, cfg: SecurityConfig, dir: string, auth: Map<string, Record<string, string>>, scans: unknown[]): Promise<StepRecord> {
  const a = cfg.zap?.active;
  if (!a) return { name: 'zap-active', status: 'error', detail: 'zap.active is not set' };
  const err = ensureImage(cfg.zap!.image);
  if (err) return { name: 'zap-active', status: 'error', detail: err };
  const base = targetUrl(cfg, a.target);
  const c = checkTarget(`${base}/`, cfg);
  if (!c.ok) throw new TargetRefused(c.reason);
  const net = zapNetwork(cfg);
  const minutes = a.max_minutes ?? 10;
  const hdr = a.role ? auth.get(a.role) ?? {} : {};
  const z = [...ZAP_QUIET, `-config scanner.maxScanDurationInMins=${minutes}`, '-config scanner.maxRuleDurationInMins=2'];
  const [hName, hValue] = Object.entries(hdr)[0] ?? [];
  if (hName) {
    z.push('-config replacer.full_list(0).description=auth', '-config replacer.full_list(0).enabled=true',
      '-config replacer.full_list(0).matchtype=REQ_HEADER', `-config replacer.full_list(0).matchstr=${hName}`,
      '-config replacer.full_list(0).regex=false', `-config replacer.full_list(0).replacement=${zEsc(hValue)}`);
  }
  const file = `active-${a.target}.json`;
  let r: { code: number; log: string };
  if (a.openapi) {
    const spec = JSON.parse(fs.readFileSync(path.resolve(root, a.openapi), 'utf8')) as Record<string, unknown>;
    spec.servers = [{ url: net.rewrite(base) }];
    fs.writeFileSync(path.join(dir, 'zap', 'openapi-target.json'), JSON.stringify(spec));
    r = runZap(cfg, dir, 'zap-api-scan.py', ['-t', '/zap/wrk/openapi-target.json', '-f', 'openapi', '-I', '-J', file, '-r', `active-${a.target}.html`, '-z', z.join(' ')], minutes);
  } else {
    r = runZap(cfg, dir, 'zap-full-scan.py', ['-t', net.rewrite(`${base}/`), '-m', '1', '-I', '-J', file, '-r', `active-${a.target}.html`, '-z', z.join(' ')], minutes);
  }
  fs.writeFileSync(path.join(dir, 'zap', `active-${a.target}.log`), r.log);
  if (r.code >= 3 || r.code < 0 || !fs.existsSync(path.join(dir, 'zap', file))) return { name: 'zap-active', status: 'error', detail: `exit ${r.code}` };
  scans.push({ key: `active-${a.target}`, file, name: a.target, kind: 'active', target: base, note: `${a.openapi ? 'OpenAPI' : 'spider'} · role ${a.role ?? 'anonymous'} · ${minutes}m cap · OAST off` });
  return { name: 'zap-active', status: 'ok', detail: cfg.zap!.image };
}

// ── 스택 ────────────────────────────────────────────────────────────────────

async function stackUp(root: string, cfg: SecurityConfig, dir: string): Promise<ChildProcess | null> {
  const s = cfg.stack;
  if (!s?.up) return null;
  const out = fs.openSync(path.join(dir, 'stack.log'), 'a');
  const child = spawn('sh', ['-c', s.up], { cwd: root, detached: true, stdio: ['ignore', out, out], env: process.env });
  log(`stack up pid ${child.pid}: ${s.up}`);
  if (s.ready_url) {
    const until = Date.now() + (s.ready_timeout_s ?? 60) * 1000;
    for (;;) {
      try { await request(cfg, 'GET', s.ready_url, {}, undefined, 2000); break; } catch (e) {
        if (e instanceof TargetRefused) throw e;
        if (Date.now() > until) throw new Error(`stack not ready at ${s.ready_url} within ${s.ready_timeout_s ?? 60}s`);
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }
  return child;
}

function stackDown(root: string, cfg: SecurityConfig, child: ChildProcess | null): void {
  if (cfg.stack?.down) runShell(root, cfg.stack.down, 120_000);
  if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 이미 끝남 */ } }
  for (const n of containers) docker(['rm', '-f', n], 60_000);
}

// ── 진입점 ──────────────────────────────────────────────────────────────────

const flagVal = (argv: string[], name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

export async function runSecurity(root: string, argv: string[]): Promise<number> {
  const loaded = loadSecurityConfig(root);
  if (loaded.status !== 'ok') {
    log(loaded.status === 'absent' ? `no ${loaded.path}` : `invalid ${loaded.path}: ${loaded.errors.join('; ')}`);
    return 1;
  }
  const cfg = loaded.config;
  if (!cfg.applies) { log(`not applicable: ${cfg.reason}`); return 0; }
  const v = flagVal(argv, 'version');
  const version = v ? assertVersion(root, v, '--version') : currentVersion(root, cfg);
  const only = (flagVal(argv, 'only') ?? '').split(',').filter(Boolean);
  const skip = (flagVal(argv, 'skip') ?? '').split(',').filter(Boolean);
  const want = (s: Step) => (only.length === 0 || only.includes(s)) && !skip.includes(s);
  const dir = roundDir(root, cfg, version);
  fs.mkdirSync(path.join(dir, 'zap'), { recursive: true });
  const runPath = path.join(dir, 'run.json');
  const prev = fs.existsSync(runPath) ? JSON.parse(fs.readFileSync(runPath, 'utf8')) as { steps?: StepRecord[]; scans?: { key: string }[] } : {};
  const steps = new Map<string, StepRecord>((prev.steps ?? []).map(s => [s.name, s]));
  const scans: { key: string }[] = [];
  const keepScans = (prev.scans ?? []).filter(s => !(want('zap-baseline') && s.key.startsWith('baseline-')) && !(want('zap-active') && s.key.startsWith('active-')));
  const commit = runShell(root, 'git rev-parse --short HEAD', 10_000).stdout.trim();
  const zapVer = cfg.zap?.image ?? '';
  let child: ChildProcess | null = null;
  let code = 1;
  const onSignal = () => { stackDown(root, cfg, child); process.exit(130); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    if (want('deps')) steps.set('deps', await stepDeps(root, cfg, dir));
    child = await stackUp(root, cfg, dir);
    const auth = new Map<string, Record<string, string>>();
    for (const r of cfg.roles) auth.set(r.name, await loginHeaders(cfg, r));
    const guard = async (s: Step, fn: () => Promise<StepRecord>) => {
      if (!want(s)) return;
      log(`step ${s}`);
      try { steps.set(s, await fn()); } catch (e) {
        if (e instanceof TargetRefused) throw e;
        steps.set(s, { name: s, status: 'error', detail: (e as Error).message });
      }
    };
    await guard('headers', () => stepHeaders(cfg, dir));
    await guard('authz', () => stepAuthz(root, cfg, dir, auth));
    await guard('manual', () => stepManual(root, cfg, dir, auth));
    await guard('zap-baseline', () => stepZapBaseline(cfg, dir, scans));
    await guard('zap-active', () => stepZapActive(root, cfg, dir, auth, scans));
    code = 0;
  } catch (e) {
    if (e instanceof TargetRefused) log(`REFUSED — no request was sent: ${e.message}`);
    else log(`error: ${(e as Error).message}`);
    code = 1;
  } finally {
    stackDown(root, cfg, child);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
  write(dir, 'run.json', {
    schema: 'security-run/1', version, date: new Date().toISOString().slice(0, 10), commit,
    tools: { zap: zapVer, node: process.version },
    steps: STEPS.map(s => steps.get(s) ?? { name: s, status: 'skipped' }),
    scans: [...keepScans, ...scans],
  });
  const scrubbed = scrubDir(dir);
  if (scrubbed) log(`redacted ${scrubbed} secret occurrence(s) from the results`);
  if (code !== 0) return code;
  const rep = writeSecurityReport(root, cfg, version);
  log(`${rep.judgement.ok ? 'PASSED' : 'NOT PASSED'} — ${path.relative(root, rep.xlsx)}`);
  for (const r of rep.judgement.reasons) log(`  - ${r}`);
  return rep.judgement.ok ? 0 : 2;
}

if (require.main === module) {
  runSecurity(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), process.argv.slice(2))
    .then(c => { process.exitCode = c; })
    .catch((e) => { log(String(e instanceof Error ? e.message : e)); process.exitCode = 1; });
}
