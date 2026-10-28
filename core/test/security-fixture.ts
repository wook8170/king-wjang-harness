/**
 * 보안 점검 회차 픽스처 — 출하 게이트(P10·P12)가 현재 버전의 보안 결과를 요구하므로,
 * 게이트를 여는 시험은 통과하는 회차 하나를 먼저 깔아야 한다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadSecurityConfig, writeSecurityReport } from '../src/security';

export const SECURITY_YAML = [
  'version_from: package.json',
  'allow_ports: [9911]',
  'targets:',
  '  - name: web',
  '    url: http://127.0.0.1:9911',
  'roles:',
  '  - name: viewer',
  '    login: { url: "http://127.0.0.1:9911/login", body: \'{"user":"v","password":"${SEC_PW}"}\', token_from: "json:token", use: "Authorization: Bearer {token}" }',
  '  - name: admin',
  '    privileged: true',
  'routes: { file: routes.txt, include: ["^/api/"] }',
  'manual: { file: scenarios.json }',
  'zap: { image: "zaproxy/zap-stable:2.17.0", baseline: [web], active: { target: web, role: viewer } }',
  '',
].join('\n');

const put = (p: string, body: unknown) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
};

/** 회차 원자료(통과하는 형태). `over` 로 파일 하나씩 바꿔 끼운다. */
export function writeRound(dir: string, version: string, over: Record<string, unknown> = {}): void {
  const files: Record<string, unknown> = {
    'run.json': {
      schema: 'security-run/1', version, date: '2026-10-28',
      steps: ['deps', 'headers', 'authz', 'manual', 'zap-baseline', 'zap-active'].map(name => ({ name, status: 'ok' })),
      scans: [{ key: 'baseline-web', file: 'baseline-web.json', name: 'web', kind: 'baseline', target: 'http://127.0.0.1:9911/' }],
    },
    'deps.json': { manager: 'npm', counts: { critical: 0, high: 0, moderate: 0, low: 0 }, advisories: [] },
    'headers.json': { rows: [{ target: 'web', header: 'x-content-type-options', value: 'nosniff', verdict: 'pass' }] },
    'authz.json': { deny_status: [401, 403, 404], rows: [{ role: 'viewer', method: 'GET', path: '/api/admin/users', status: 403 }] },
    'manual.json': { rows: [{ id: 'M-01', category: 'auth', scenario: 'no session', request: 'GET /api/me', expected: [401], actual: 401 }] },
    'zap/baseline-web.json': { site: [{ alerts: [{ pluginid: '10096', name: 'Timestamp Disclosure', riskcode: '1', instances: [{ uri: 'http://127.0.0.1:9911/' }] }] }] },
    ...over,
  };
  for (const [f, body] of Object.entries(files)) if (body !== null) put(path.join(dir, f), body);
}

/** 설정 · 버전 · 통과 회차 · 결과서까지 깐다. 회차 폴더를 돌려준다. */
export function passingSecurityRound(root: string, version = '1.0.0', over: Record<string, unknown> = {}): string {
  put(path.join(root, '.harness', 'profile', 'security.yaml'), SECURITY_YAML);
  put(path.join(root, 'package.json'), { name: 'fixture', version });
  const loaded = loadSecurityConfig(root);
  if (loaded.status !== 'ok') throw new Error(`fixture config: ${JSON.stringify(loaded)}`);
  const dir = path.join(root, '.harness', 'security', version);
  writeRound(dir, version, over);
  writeSecurityReport(root, loaded.config, version);
  return dir;
}
