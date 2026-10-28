/**
 * 버전별 보안 점검 — 판정 · 결과서 · 허용 대상 · 라우트 추출 · 출하 게이트 연결.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { initHarness } from '../src/state';
import { submitGate, approveGate } from '../src/gate';
import { shipVerdict } from '../src/ship';
import { run } from '../src/cli';
import {
  checkTarget, parseRoutes, selectRoutes, fillPathParams, parseSecurityConfig, securityVerdict, judgeRound,
  defectCommands, writeSecurityReport, loadSecurityConfig, isPinnedImage, e2eSecurityCases, xlsxName,
} from '../src/security';
import { readXlsx, buildXlsx } from '../src/xlsx';
import { request, TargetRefused, scrubDir, parseAudit, checkHeaders, fillEnv, secrets, runSecurity } from '../src/security-run';
import { passingSecurityRound, writeRound } from './security-fixture';
import { inspectProfile } from '../src/profile';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-sec-'));
  initHarness(root);
  return root;
};
const quiet = <T>(fn: () => T): { v: T; out: string } => {
  const out: string[] = [];
  const l = vi.spyOn(console, 'log').mockImplementation(m => { out.push(String(m)); });
  const e = vi.spyOn(console, 'error').mockImplementation(m => { out.push(String(m)); });
  try { return { v: fn(), out: out.join('\n') }; } finally { l.mockRestore(); e.mockRestore(); }
};
const report = (root: string, version = '1.0.0') => {
  const c = loadSecurityConfig(root);
  if (c.status !== 'ok') throw new Error('config');
  return writeSecurityReport(root, c.config, version);
};
const P10_DOC = '# P10 산출물\n\n보안 점검 회차의 판정과 결함 대장, 재측정 기록을 함께 묶어 출하 판단의 근거로 삼는다. '
  + '권한 거부 전수와 수동 시나리오, 의존성 감사 결과를 같은 회차 폴더에서 읽는다. 오탐으로 수용한 경고는 근거 파일과 줄을 함께 적어 둔다.\n';

describe('판정 — 정상', () => {
  it('통과하는 회차는 통과다 — 결과서 · 요약 · 결함 초안이 생긴다', () => {
    const root = setup();
    const dir = passingSecurityRound(root);
    const v = securityVerdict(root);
    expect(v.reasons).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.version).toBe('1.0.0');
    expect(fs.existsSync(path.join(dir, xlsxName('1.0.0')))).toBe(true);
    const sum = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
    expect(sum.schema).toBe('security-summary/1');
    expect(sum.verdict).toBe('passed');
    expect(Object.keys(sum.checks)).toEqual(['high', 'medium', 'triage', 'authz', 'manual', 'deps', 'headers', 'scans']);
  });

  it('결과서에 시트와 「제3자 진단을 대체하지 않음」 표지가 있다', () => {
    const root = setup();
    const dir = passingSecurityRound(root);
    const wb = readXlsx(fs.readFileSync(path.join(dir, xlsxName('1.0.0'))));
    expect(wb.map(s => s.name)).toEqual(['표지', '요약', '발견 사항', '수동 시나리오', '권한 거부', '자동 점검', '보안 헤더', '의존성']);
    const cover = wb[0].rows.map(r => r.join(' ')).join('\n');
    expect(cover).toContain('제3자');
    expect(cover).toContain('대체하지 않음');
    expect(wb.find(s => s.name === '권한 거부')!.rows[1]).toEqual(['viewer', 'GET', '/api/admin/users', '403', 'PASS']);
  });

  it('같은 입력이면 같은 바이트다(결정적)', () => {
    const sheets = [{ name: 'a', header: ['x'], rows: [['한글\n줄바꿈', 1]] }];
    expect(buildXlsx(sheets).equals(buildXlsx(sheets))).toBe(true);
    expect(readXlsx(buildXlsx(sheets))[0].rows[1]).toEqual(['한글\n줄바꿈', '1']);
  });

  it('e2e 원장이 있으면 보안성 케이스 시트가 붙는다', () => {
    const root = setup();
    passingSecurityRound(root);
    fs.mkdirSync(path.join(root, 'docs/e2e'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/e2e/auth.cases.json'), JSON.stringify([
      { id: 'E-1', scenario: '뷰어가 관리자 API 를 부르면 403', expected: '403' },
      { id: 'E-2', scenario: '대시보드 정렬', expected: '정렬된다' },
      { id: 'E-3', scenario: 'export', tags: ['security'] },
    ]));
    expect(e2eSecurityCases(root, ['docs/e2e/*.cases.json']).map(c => c.id)).toEqual(['E-1', 'E-3']);
    fs.appendFileSync(path.join(root, '.harness/profile/security.yaml'), 'e2e_ledger: docs/e2e/*.cases.json\n');
    const r = report(root);
    const wb = readXlsx(fs.readFileSync(r.xlsx));
    expect(wb.at(-1)!.name).toBe('e2e 보안성 케이스');
    expect(wb.at(-1)!.rows.length).toBe(3);
  });
});

describe('판정 — 결과 없음', () => {
  it('설정이 없으면 미통과이고 무엇을 만들지 말한다', () => {
    const root = setup();
    const v = securityVerdict(root);
    expect(v.ok).toBe(false);
    expect(v.reasons[0]).toContain('security.yaml');
  });

  it('버전을 올렸는데 그 버전 결과가 없으면 미통과다', () => {
    const root = setup();
    passingSecurityRound(root, '1.0.0');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.1.0' }));
    const v = securityVerdict(root);
    expect(v.ok).toBe(false);
    expect(v.reasons.join()).toContain('1.1.0');
  });

  it('단계 결과 파일이 빠지면 그 단계를 사유로 든다', () => {
    const root = setup();
    const dir = passingSecurityRound(root);
    fs.rmSync(path.join(dir, 'authz.json'));
    fs.rmSync(path.join(dir, 'manual.json'));
    report(root);
    const v = securityVerdict(root);
    expect(v.ok).toBe(false);
    expect(v.reasons.some(r => r.includes('권한 거부 결과가 없다'))).toBe(true);
    expect(v.reasons.some(r => r.includes('수동 시나리오 결과가 없다'))).toBe(true);
  });

  it('ZAP 단계가 완료되지 않았으면 미통과다', () => {
    const root = setup();
    const dir = passingSecurityRound(root);
    const runJson = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    runJson.steps.find((s: { name: string }) => s.name === 'zap-active').status = 'error';
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(runJson));
    report(root);
    expect(securityVerdict(root).reasons.join()).toContain('zap-active');
  });

  it('결과서를 만든 뒤 판정 기록을 바꾸면 결과서가 낡았다고 말한다', () => {
    const root = setup();
    const dir = passingSecurityRound(root);
    fs.writeFileSync(path.join(dir, 'triage.yaml'), 'decisions: []\n');
    const v = securityVerdict(root);
    expect(v.ok).toBe(false);
    expect(v.reasons.join()).toContain('낡았다');
  });

  it('applies: false 는 사유가 있어야 하고, 있으면 해당 없음으로 통과한다', () => {
    expect(parseSecurityConfig({ applies: false }).errors.join()).toContain('reason');
    const root = setup();
    fs.mkdirSync(path.join(root, '.harness/profile'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness/profile/security.yaml'), 'applies: false\nreason: CLI library, no network surface\n');
    expect(securityVerdict(root)).toMatchObject({ ok: true, applies: false });
  });
});

describe('판정 — High 있음', () => {
  const highZap = { 'zap/baseline-web.json': { site: [{ alerts: [{ pluginid: '40018', name: 'SQL Injection', riskcode: '3', instances: [{ uri: 'http://127.0.0.1:9911/api/x?q=1' }] }] }] } };

  it('ZAP High 가 있으면 미통과이고 결함 대장 형식으로 낸다', () => {
    const root = setup();
    const dir = passingSecurityRound(root, '1.0.0', highZap);
    const v = securityVerdict(root);
    expect(v.ok).toBe(false);
    expect(v.reasons.join()).toContain('SEC-1.0.0-zap-40018');
    const cmds = defectCommands(judgeRound(root, dir, '1.0.0'), root);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatch(/^harness ship defect add --id SEC-1\.0\.0-zap-40018 --severity high --title 'SQL Injection \(ZAP 40018\)' --evidence '\.harness\/security\/1\.0\.0\/zap\/baseline-web\.json'$/);
    expect(fs.readFileSync(path.join(dir, 'defects.md'), 'utf8')).toContain(cmds[0]);
  });

  it('권한 거부 실패 · 수동 시나리오 실패 · high 의존성은 High 다', () => {
    const root = setup();
    passingSecurityRound(root, '1.0.0', {
      'authz.json': { rows: [{ role: 'viewer', method: 'DELETE', path: '/api/admin/users/{id}', status: 200 }, { role: 'viewer', method: 'GET', path: '/api/admin', status: 403 }] },
      'manual.json': { rows: [{ id: 'M-02', scenario: 'csrf', expected: [403], actual: 200 }] },
      'deps.json': { advisories: [{ package: 'lodash', severity: 'high', title: 'proto pollution' }], counts: { high: 1 } },
    });
    const j = securityVerdict(root).judgement!;
    expect(j.counts.high).toBe(3);
    expect(j.checks.authz).toEqual({ ok: false, value: '1/2' });
    expect(j.reasons.join()).toContain('권한 거부 1/2');
  });

  it('의존성은 critical·high 만 막는다 — moderate·low 만 있으면 통과하고 「기록」으로 남는다', () => {
    const root = setup();
    passingSecurityRound(root, '1.0.0', {
      'deps.json': { advisories: [{ package: 'a', severity: 'moderate', title: 'ReDoS' }, { package: 'b', severity: 'low', title: 'x' }], counts: { moderate: 1, low: 1 } },
    });
    const v = securityVerdict(root);
    expect(v.reasons).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.judgement!.findings.filter(f => f.source === 'deps').map(f => `${f.key} ${f.severity} ${f.status}`)).toEqual(['dep:a Medium recorded', 'dep:b Low recorded']);
    expect(defectCommands(v.judgement!, root)).toEqual([]);
  });

  it('의존성 high · critical 은 판정을 막는다', () => {
    for (const severity of ['high', 'critical']) {
      const root = setup();
      passingSecurityRound(root, '1.0.0', { 'deps.json': { advisories: [{ package: 'c', severity, title: 'RCE' }], counts: { [severity]: 1 } } });
      const v = securityVerdict(root);
      expect(v.ok, severity).toBe(false);
      expect(v.reasons.join()).toContain('SEC-1.0.0-dep-c');
    }
  });

  it('High 는 수용할 수 없다 — 수정이나 오탐만 해결로 본다', () => {
    const root = setup();
    const dir = passingSecurityRound(root, '1.0.0', highZap);
    fs.writeFileSync(path.join(dir, 'triage.yaml'), 'decisions:\n  - key: zap:40018\n    status: accepted\n    reason: later\n    approved_by: owner\n');
    report(root);
    const v = securityVerdict(root);
    expect(v.ok).toBe(false);
    expect(v.reasons.join()).toContain('cannot be accepted');
  });

  it('헤더 누락은 Medium 이고 미조치면 막는다', () => {
    const root = setup();
    passingSecurityRound(root, '1.0.0', { 'headers.json': { rows: [{ target: 'web', header: 'content-security-policy', value: '(none)', verdict: 'fail' }] } });
    const v = securityVerdict(root);
    expect(v.ok).toBe(false);
    expect(v.reasons.join()).toContain('미조치 Medium');
  });
});

describe('판정 — 오탐 수용', () => {
  const med = { 'zap/baseline-web.json': { site: [{ alerts: [{ pluginid: '90003', name: 'SRI Missing', riskcode: '2', instances: [{ uri: 'http://127.0.0.1:9911/' }] }] }] } };

  it('근거 있는 오탐 기록은 통과시키고 결과서에 남긴다', () => {
    const root = setup();
    const dir = passingSecurityRound(root, '1.0.0', med);
    expect(securityVerdict(root).ok).toBe(false);
    fs.writeFileSync(path.join(dir, 'triage.yaml'),
      'decisions:\n  - key: zap:90003\n    status: false-positive\n    reason: the flagged tag is an example string shown to users\n    evidence: src/embed.ts:68\n');
    report(root);
    const v = securityVerdict(root);
    expect(v.reasons).toEqual([]);
    const wb = readXlsx(fs.readFileSync(path.join(dir, xlsxName('1.0.0'))));
    const row = wb.find(s => s.name === '발견 사항')!.rows[1];
    expect(row).toContain('false-positive');
    expect(row.join(' ')).toContain('src/embed.ts:68');
  });

  it('근거 없는 오탐 기록은 받지 않는다', () => {
    const root = setup();
    const dir = passingSecurityRound(root, '1.0.0', med);
    fs.writeFileSync(path.join(dir, 'triage.yaml'), 'decisions:\n  - key: zap:90003\n    status: false-positive\n    reason: looks fine\n');
    report(root);
    expect(securityVerdict(root).reasons.join()).toContain('needs evidence');
  });

  it('Medium 수용은 승인자가 있어야 한다', () => {
    const root = setup();
    const dir = passingSecurityRound(root, '1.0.0', med);
    fs.writeFileSync(path.join(dir, 'triage.yaml'), 'decisions:\n  - key: zap:90003\n    status: accepted\n    reason: r\n');
    report(root);
    expect(securityVerdict(root).reasons.join()).toContain('approved_by');
    fs.writeFileSync(path.join(dir, 'triage.yaml'), 'decisions:\n  - key: zap:90003\n    status: accepted\n    reason: r\n    approved_by: owner 10-28\n');
    report(root);
    expect(securityVerdict(root).ok).toBe(true);
  });
});

describe('허용 대상 밖 주소 차단', () => {
  const policy = { allow_hosts: ['127.0.0.1', 'localhost'], allow_ports: [9911] };

  it('루프백 · 허용 포트만 통과한다', () => {
    expect(checkTarget('http://127.0.0.1:9911/x', policy).ok).toBe(true);
    for (const u of ['https://example.com/', 'http://10.0.0.5:9911/', 'http://127.0.0.1:5180/', 'file:///etc/passwd',
      'http://user:pw@127.0.0.1:9911/', 'http://169.254.169.254/', 'not a url']) {
      expect(checkTarget(u, policy).ok, u).toBe(false);
    }
  });

  it('설정으로도 운영 · 외부 주소를 열 수 없다', () => {
    const r = parseSecurityConfig({ allow_hosts: ['127.0.0.1', 'api.example.com', '8.8.8.8'], targets: [{ name: 'w', url: 'http://127.0.0.1:1/' }] });
    expect(r.errors.filter(e => e.startsWith('allow_hosts'))).toHaveLength(2);
    expect(parseSecurityConfig({ allow_hosts: ['app.test', '192.168.1.2', 'api'] }).errors).toEqual([]);
    expect(parseSecurityConfig({ targets: [{ name: 'prod', url: 'https://shop.example.com/' }] }).errors.join()).toContain('outside the allowed targets');
  });

  it('실행기는 허용 밖 주소에 요청을 보내지 않는다', async () => {
    let hits = 0;
    const srv = http.createServer((_q, s) => { hits++; s.end('ok'); });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    try {
      await expect(request({ allow_hosts: ['127.0.0.1'], allow_ports: [port + 1] }, 'GET', `http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(TargetRefused);
      expect(hits).toBe(0);
      const ok = await request({ allow_hosts: ['127.0.0.1'], allow_ports: [port] }, 'GET', `http://127.0.0.1:${port}/`);
      expect(ok.status).toBe(200);
      expect(hits).toBe(1);
    } finally { srv.close(); }
  });

  it('`harness security target` 이 같은 판정을 낸다(종료 코드 2)', () => {
    const root = setup();
    passingSecurityRound(root);
    expect(quiet(() => run(['security', 'target', 'http://127.0.0.1:9911/'], root)).v).toBe(0);
    const r = quiet(() => run(['security', 'target', 'https://prod.example.com/'], root));
    expect(r.v).toBe(2);
    expect(r.out).toContain('거부');
  });

  it('ZAP 이미지는 버전에 고정해야 한다', () => {
    expect(isPinnedImage('zaproxy/zap-stable:2.17.0')).toBe(true);
    expect(isPinnedImage(`zaproxy/zap-stable@sha256:${'a'.repeat(64)}`)).toBe(true);
    for (const i of ['zaproxy/zap-stable', 'zaproxy/zap-stable:latest', 'localhost:5000/zap']) expect(isPinnedImage(i), i).toBe(false);
  });
});

describe('라우트 자동 추출', () => {
  it('OpenAPI · JSON 목록 · 표 출력을 같은 형태로 편다', () => {
    const openapi = JSON.stringify({ paths: { '/api/a': { get: {}, post: {} }, '/api/b/{id}': { delete: {}, parameters: [] } } });
    expect(parseRoutes(openapi)).toEqual([
      { method: 'GET', path: '/api/a' }, { method: 'POST', path: '/api/a' }, { method: 'DELETE', path: '/api/b/{id}' },
    ]);
    expect(parseRoutes(JSON.stringify(['GET /x', { method: 'put', path: '/y' }, { methods: ['GET', 'HEAD'], url: '/z' }])))
      .toEqual([{ method: 'GET', path: '/x' }, { method: 'PUT', path: '/y' }, { method: 'GET', path: '/z' }, { method: 'HEAD', path: '/z' }]);
    expect(parseRoutes('│ GET    │ /api/users/:id │\nPOST /api/login\nnoise line\nGET /api/users/:id')).toEqual([
      { method: 'POST', path: '/api/login' }, { method: 'GET', path: '/api/users/:id' },
    ]);
  });

  it('새 라우트는 다음 회차 점검 대상에 자동으로 들어간다', () => {
    const before = selectRoutes(parseRoutes('GET /api/admin/a\nGET /health'), ['^/api/'], []);
    const after = selectRoutes(parseRoutes('GET /api/admin/a\nGET /api/admin/new\nGET /health'), ['^/api/'], []);
    expect(after.length - before.length).toBe(1);
    expect(after.map(r => r.path)).toContain('/api/admin/new');
    expect(selectRoutes(after, ['^/api/'], ['new$']).map(r => r.path)).toEqual(['/api/admin/a']);
    expect(fillPathParams('/a/{id}/b/:name/[slug]')).toBe('/a/x/b/x/x');
  });

  it('`harness security routes --from` 가 같은 결과를 낸다', () => {
    const root = setup();
    fs.writeFileSync(path.join(root, 'r.txt'), 'GET /api/a\n');
    const r = quiet(() => run(['security', 'routes', '--from', 'r.txt'], root));
    expect(r.v).toBe(0);
    expect(JSON.parse(r.out)).toEqual([{ method: 'GET', path: '/api/a' }]);
  });
});

describe('실행기 — 라우트 추출부터 권한 거부 전수까지', () => {
  it('목록 명령에 새로 나타난 라우트가 그 회차에 호출되고, 역할별 거부 범위(deny)를 따른다', async () => {
    const seen: string[] = [];
    const srv = http.createServer((q, s) => {
      seen.push(`${q.method} ${q.url} ${q.headers.authorization ? 'auth' : 'anon'}`);
      const authed = q.headers.authorization === 'Bearer T0KEN-viewer';
      if (q.url === '/login') { s.setHeader('content-type', 'application/json'); return s.end('{"token":"T0KEN-viewer"}'); }
      if (q.url === '/api/me') { s.statusCode = authed ? 200 : 401; return s.end(); }
      s.statusCode = q.url === '/api/admin/new' && authed ? 200 : 403;   // 새 라우트에 권한 검사가 빠졌다
      s.end();
    });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    try {
      const root = setup();
      fs.mkdirSync(path.join(root, '.harness/profile'), { recursive: true });
      fs.writeFileSync(path.join(root, 'package.json'), '{"version":"2.0.0"}');
      fs.writeFileSync(path.join(root, 'routes.txt'), 'GET /api/me\nGET /api/admin/a\nDELETE /api/admin/new\nGET /api/admin/new\nGET /health\n');
      fs.writeFileSync(path.join(root, '.harness/profile/security.yaml'), [
        `allow_ports: [${port}]`,
        `targets: [{ name: api, url: "http://127.0.0.1:${port}" }]`,
        'roles:',
        `  - { name: viewer, login: { url: "http://127.0.0.1:${port}/login", body: '{"password":"\${KWH_RUN_PW}"}', token_from: "json:token", use: "Authorization: Bearer {token}" } }`,
        '  - { name: anonymous, deny: ["^/api/"] }',
        'routes: { file: routes.txt, include: ["^/api/admin"] }',
      ].join('\n'));
      process.env.KWH_RUN_PW = 'run-pw-4242';
      const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const code = await runSecurity(root, ['--only', 'authz']).finally(() => err.mockRestore());
      expect(code).toBe(2);                                   // 다른 단계 결과가 없으니 미통과
      const dir = path.join(root, '.harness/security/2.0.0');
      const authz = JSON.parse(fs.readFileSync(path.join(dir, 'authz.json'), 'utf8'));
      const calls = authz.rows.map((r: { role: string; method: string; path: string; status: number }) => `${r.role} ${r.method} ${r.path} ${r.status}`).sort();
      expect(calls).toEqual([
        'anonymous DELETE /api/admin/new 403', 'anonymous GET /api/admin/a 403', 'anonymous GET /api/admin/new 403', 'anonymous GET /api/me 401',
        'viewer DELETE /api/admin/new 200', 'viewer GET /api/admin/a 403', 'viewer GET /api/admin/new 200',
      ]);
      expect(seen.some(l => l.startsWith('GET /health'))).toBe(false);   // 대상이 아닌 라우트는 부르지 않는다
      const v = securityVerdict(root);
      expect(v.reasons.join()).toContain('SEC-2.0.0-authz-viewer-GET-api-admin-new');
      expect(fs.readdirSync(dir).join()).toContain('security-results-2.0.0.xlsx');
      for (const f of fs.readdirSync(dir)) {
        if (fs.statSync(path.join(dir, f)).isFile()) {
          const body = fs.readFileSync(path.join(dir, f)).toString('latin1');
          expect(body, f).not.toContain('run-pw-4242');
          expect(body, f).not.toContain('T0KEN-viewer');
        }
      }
    } finally { srv.close(); delete process.env.KWH_RUN_PW; }
  });
});

describe('실행기 부품', () => {
  it('비밀값은 결과물에서 지운다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-scrub-'));
    fs.mkdirSync(path.join(dir, 'zap'));
    fs.writeFileSync(path.join(dir, 'zap/a.json'), '{"evidence":"Authorization: Bearer tok-SECRET-123"}');
    fs.writeFileSync(path.join(dir, 'run.json'), '{"pw":"Hunter2pw"}');
    expect(scrubDir(dir, ['tok-SECRET-123', 'Hunter2pw'])).toBe(2);
    expect(fs.readFileSync(path.join(dir, 'zap/a.json'), 'utf8')).not.toContain('SECRET');
    expect(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')).toContain('[REDACTED]');
  });

  it('로그인 본문의 비밀번호는 환경변수로만 받는다', () => {
    expect(parseSecurityConfig({ roles: [{ name: 'v', login: { url: 'http://127.0.0.1/l', body: '{"password":"plain"}', token_from: 'json:t', use: 'A: {token}' } }] }).errors.join())
      .toContain('literal password');
    expect(fillEnv('{"p":"${KWH_T_PW}"}', { KWH_T_PW: 'sekret-1' })).toBe('{"p":"sekret-1"}');
    expect(secrets.has('sekret-1')).toBe(true);
    expect(() => fillEnv('${KWH_MISSING_X}', {})).toThrow(/KWH_MISSING_X/);
  });

  it('npm · pnpm 감사 출력을 공통 형태로 읽는다', () => {
    const npm = parseAudit(JSON.stringify({ vulnerabilities: { a: { severity: 'moderate', via: [{ title: 'ReDoS', url: 'u' }], range: '<2' } } }));
    expect(npm.counts.moderate).toBe(1);
    expect(npm.advisories[0]).toMatchObject({ package: 'a', title: 'ReDoS' });
    const pnpm = parseAudit(JSON.stringify({ advisories: { 1: { module_name: 'b', severity: 'high', title: 'x' } } }));
    expect(pnpm.counts.high).toBe(1);
  });

  it('헤더 점검 — 누락 · nosniff 값 · frame-ancestors 대체 · 버전 노출', () => {
    const rows = checkHeaders('web', 'http://127.0.0.1/', {
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'", 'x-content-type-options': 'sniff', server: 'nginx/1.2',
    }, ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy']);
    const v = Object.fromEntries(rows.map(r => [r.header, r.verdict]));
    expect(v).toEqual({ 'content-security-policy': 'pass', 'x-content-type-options': 'fail', 'x-frame-options': 'pass', 'referrer-policy': 'fail', server: 'fail' });
  });
});

describe('출하 게이트 연결', () => {
  it('P10 승인은 현재 버전의 보안 결과를 요구한다', () => {
    const root = setup();
    fs.writeFileSync(path.join(root, 'p10.md'), P10_DOC);
    submitGate(root, 'P10', { paths: ['p10.md'], evidence: 'measured' });
    expect(() => approveGate(root, 'P10')).toThrow(/보안 결과/);
    passingSecurityRound(root);
    expect(approveGate(root, 'P10').status).toBe('approved');
  });

  it('ship verdict 도 같은 문장으로 막고, 버전을 올리면 다시 막는다', () => {
    const root = setup();
    expect(shipVerdict(root).reasons.some(r => r.includes('보안 결과'))).toBe(true);
    passingSecurityRound(root);
    expect(shipVerdict(root).reasons.some(r => r.includes('보안 결과'))).toBe(false);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.1' }));
    expect(shipVerdict(root).reasons.some(r => r.includes('1.0.1'))).toBe(true);
  });

  it('`harness security verdict` 종료 코드 — 통과 0 · 미통과 2', () => {
    const root = setup();
    expect(quiet(() => run(['security', 'verdict'], root)).v).toBe(2);
    passingSecurityRound(root);
    expect(quiet(() => run(['security', 'verdict'], root)).v).toBe(0);
  });

  it('`harness security report` 는 원자료로 결과서를 다시 만든다', () => {
    const root = setup();
    const dir = passingSecurityRound(root);
    fs.rmSync(path.join(dir, xlsxName('1.0.0')));
    expect(quiet(() => run(['security', 'report'], root)).v).toBe(0);
    expect(fs.existsSync(path.join(dir, xlsxName('1.0.0')))).toBe(true);
  });

  it('CLI · 훅은 네트워크를 타는 실행기를 import 하지 않는다(코어 §1)', () => {
    const src = path.resolve(__dirname, '../src');
    for (const f of fs.readdirSync(src).filter(f => f.endsWith('.ts') && f !== 'security-run.ts')) {
      expect(fs.readFileSync(path.join(src, f), 'utf8'), f).not.toMatch(/from '\.\/security-run'/);
    }
    expect(fs.readFileSync(path.join(src, 'security.ts'), 'utf8')).not.toMatch(/child_process|node:https?'/);
  });
});

describe('설정 위치', () => {
  it('security.yaml 만 둔 로컬 프로파일 디렉토리는 번들 프로파일을 가리지 않고 문제로 보고되지 않는다', () => {
    const root = setup();
    passingSecurityRound(root);
    const r = inspectProfile(root);
    expect(r.problems).toEqual([]);
    expect(r.profile.origin).not.toBe('local');
  });
});

describe('회차 원자료 픽스처 자체', () => {
  it('writeRound 는 over 로 파일을 뺄 수 있다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-round-'));
    writeRound(dir, '9.9.9', { 'deps.json': null });
    expect(fs.existsSync(path.join(dir, 'deps.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'run.json'))).toBe(true);
  });
});
