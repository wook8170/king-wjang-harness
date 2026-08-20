import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { readEvents } from '../src/events';
import { upsertNode } from '../src/ledger';
import { createWave } from '../src/wave';
import { submitGate, approveGate } from '../src/gate';
import { evidenceDir } from '../src/paths';
import {
  addDefect, updateDefect, listDefects, openBlockers, renderDefectLedger,
  recordDeployment, listDeployments,
  shipVerdict, renderReleaseChecklist,
  defectsPath, readinessPath, deploymentsPath,
} from '../src/ship';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

const writeDoc = (root: string, rel: string, body: string) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
};

/** 게이트 하나를 measured 근거로 승인 상태까지 올린다. */
const approveShipGate = (root: string, phase: 'P10' | 'P11', rel: string) => {
  writeDoc(root, rel, `${phase} 산출물`);
  submitGate(root, phase, { paths: [rel], evidence: 'measured' });
  approveGate(root, phase);
};

/** 최소 유효 PNG 헤더 + 크기 임계값을 넘는 픽셀 자리 (evidence.test.ts 와 같은 픽스처). */
const fakeCapture = (width = 2880, height = 1800): Buffer => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  return Buffer.concat([sig, ihdr, Buffer.alloc(4096, 0x7a)]);
};

const putCapture = (root: string, waveId: string, name = 'ux-7.png') => {
  const dir = evidenceDir(root, waveId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), fakeCapture());
};

/** UX 웨이브 하나 + 실주행 캡처 + P10·P11 승인까지 끝난, 출하 가능한 루트. */
const shipReadyRoot = () => {
  const root = setup();
  upsertNode(root, { id: 'UX-7', title: '결제 화면', version: 1, status: 'approved' });
  createWave(root, {
    milestone: 'M2-결제', design_refs: ['UX-7'],
    acceptance: ['결제 e2e 그린'], goal: '결제 화면 구현',
  });
  putCapture(root, 'wave-001');
  approveShipGate(root, 'P10', 'docs/harden.md');
  approveShipGate(root, 'P11', 'docs/deploy.md');
  return root;
};

const defect = (over: Partial<Parameters<typeof addDefect>[1]> = {}) => ({
  id: 'SEC-01', severity: 'blocker' as const, title: '세션 토큰이 로그에 남는다',
  evidence: 'src/auth.ts:88', ...over,
});

describe('결함 대장 — 기계 정본 defects.yaml, readiness.md 는 렌더 사본', () => {
  it('addDefect 가 저널을 먼저 남기고 yaml 과 readiness.md 를 함께 쓴다', () => {
    const root = setup();
    const rec = addDefect(root, defect());

    expect(rec.status).toBe('open');
    expect(fs.existsSync(defectsPath(root))).toBe(true);
    expect(fs.readFileSync(readinessPath(root), 'utf8')).toContain('SEC-01');

    const ev = readEvents(root).at(-1)!;
    expect(ev.type).toBe('defect-added');
    expect(ev.data.id).toBe('SEC-01');
    expect(ev.data.severity).toBe('blocker');
  });

  it('deferred 를 사유 없이 등록하면 거부한다 — 조용한 유예가 블로커를 실어 보낸다', () => {
    const root = setup();
    expect(() => addDefect(root, defect({ status: 'deferred' }))).toThrow(/사유/);
    expect(listDefects(root)).toEqual([]);
    expect(readEvents(root)).toEqual([]);
  });

  it('deferred 는 사유가 있으면 통과한다', () => {
    const root = setup();
    const rec = addDefect(root, defect({
      severity: 'low', status: 'deferred', deferReason: '출하 후 백로그 — 비차단',
    }));
    expect(rec.status).toBe('deferred');
    expect(rec.deferReason).toBe('출하 후 백로그 — 비차단');
  });

  it('updateDefect 로 deferred 전환도 사유가 없으면 거부하고 상태를 바꾸지 않는다', () => {
    const root = setup();
    addDefect(root, defect());
    const before = readEvents(root).length;
    expect(() => updateDefect(root, 'SEC-01', { status: 'deferred' })).toThrow(/사유/);
    expect(listDefects(root)[0].status).toBe('open');
    expect(readEvents(root)).toHaveLength(before);
  });

  it('updateDefect 는 상태·근거를 갈아끼우고 defect-updated 를 남긴다', () => {
    const root = setup();
    addDefect(root, defect());
    const rec = updateDefect(root, 'SEC-01', { status: 'verified', evidence: 'evidence/e2e.log' });
    expect(rec.status).toBe('verified');
    expect(rec.evidence).toBe('evidence/e2e.log');
    expect(readEvents(root).at(-1)!.type).toBe('defect-updated');
  });

  it('없는 결함 갱신은 id 를 밝히며 거부', () => {
    const root = setup();
    expect(() => updateDefect(root, 'SEC-99', { status: 'fixed' })).toThrow(/SEC-99/);
  });

  it('같은 id 를 두 번 등록하면 거부한다 — 대장에 같은 id 두 줄은 추적 불가', () => {
    const root = setup();
    addDefect(root, defect());
    expect(() => addDefect(root, defect({ title: '다른 제목' }))).toThrow(/SEC-01/);
    expect(listDefects(root)).toHaveLength(1);
  });

  it('근거 없는 결함은 거부한다 — 근거 없는 지적은 발견이 아니라 인상이다', () => {
    const root = setup();
    expect(() => addDefect(root, defect({ evidence: '  ' }))).toThrow(/근거/);
  });

  it('열거형 밖 심각도·상태는 거부', () => {
    const root = setup();
    expect(() => addDefect(root, defect({ severity: '치명' as never }))).toThrow(/심각도/);
    expect(() => addDefect(root, defect({ status: '보류' as never }))).toThrow(/상태/);
  });

  it('openBlockers 는 open 인 blocker 만 센다', () => {
    const root = setup();
    addDefect(root, defect({ id: 'SEC-01' }));                                   // open blocker
    addDefect(root, defect({ id: 'SEC-02', severity: 'high' }));                  // open high
    addDefect(root, defect({ id: 'SEC-03', status: 'fixed' }));                   // fixed blocker
    addDefect(root, defect({ id: 'SEC-04', status: 'verified' }));                // verified blocker
    addDefect(root, defect({ id: 'SEC-05', status: 'deferred', deferReason: '비차단' }));
    expect(openBlockers(root).map(d => d.id)).toEqual(['SEC-01']);
  });

  it('renderDefectLedger 가 yaml 에서 마크다운 표를 찍어낸다', () => {
    const root = setup();
    addDefect(root, defect());
    addDefect(root, defect({
      id: 'PERF-01', severity: 'low', title: '목록 조회 200ms',
      evidence: 'evidence/latency.log', status: 'deferred', deferReason: '출하 후 백로그',
    }));
    const md = renderDefectLedger(root);

    expect(md).toContain('SEC-01');
    expect(md).toContain('BLOCKER');
    expect(md).toContain('src/auth.ts:88');
    expect(md).toContain('출하 후 백로그');
    expect(md).toContain('defects.yaml'); // 정본이 어디인지 문서가 스스로 말한다
    expect(md).toBe(fs.readFileSync(readinessPath(root), 'utf8'));
  });

  it('결함이 없으면 빈 표 대신 아무것도 보증하지 않는다고 적는다', () => {
    expect(renderDefectLedger(setup())).toMatch(/등록된 결함이 없다/);
  });
});

describe('배포 기록 (§3-7)', () => {
  const deployment = {
    version: 'v1.2.0', commitSha: 'cb4b0ac', environment: 'production',
    evidence: ['evidence/smoke.log'],
  };

  it('저널을 먼저 남기고 deployments.yaml 에 적재한다', () => {
    const root = setup();
    const rec = recordDeployment(root, deployment);

    expect(rec.commitSha).toBe('cb4b0ac');
    expect(rec.recordedAt).toBeTruthy();
    expect(fs.existsSync(deploymentsPath(root))).toBe(true);

    const ev = readEvents(root).at(-1)!;
    expect(ev.type).toBe('deployment-recorded');
    expect(ev.data.version).toBe('v1.2.0');
    expect(ev.data.commitSha).toBe('cb4b0ac');
  });

  it('빈 커밋 SHA 는 거부한다 — 어느 배포에 실렸나를 역추적할 수 없다', () => {
    const root = setup();
    expect(() => recordDeployment(root, { ...deployment, commitSha: '   ' })).toThrow(/커밋/);
    expect(listDeployments(root)).toEqual([]);
    expect(readEvents(root)).toEqual([]);
  });

  it('빈 환경·빈 버전도 거부한다', () => {
    const root = setup();
    expect(() => recordDeployment(root, { ...deployment, environment: '' })).toThrow(/환경/);
    expect(() => recordDeployment(root, { ...deployment, version: '' })).toThrow(/버전/);
  });

  it('여러 건이 등록 순서대로 왕복한다', () => {
    const root = setup();
    recordDeployment(root, deployment);
    recordDeployment(root, { ...deployment, version: 'v1.2.1', commitSha: 'deadbee', environment: 'staging' });
    const all = listDeployments(root);

    expect(all.map(d => d.version)).toEqual(['v1.2.0', 'v1.2.1']);
    expect(all[0].evidence).toEqual(['evidence/smoke.log']);
    expect(all[1].environment).toBe('staging');
  });
});

describe('출하 판정 (P12 go/no-go)', () => {
  it('전부 깨끗하면 GO', () => {
    const v = shipVerdict(shipReadyRoot());
    expect(v).toEqual({ ok: true, reasons: [] });
  });

  it('같은 입력이면 같은 판정 — 시계·난수가 섞이지 않는다', () => {
    const root = shipReadyRoot();
    expect(shipVerdict(root)).toEqual(shipVerdict(root));
  });

  it('open blocker 가 있으면 NO-GO 이고 결함 id 를 지목한다', () => {
    const root = shipReadyRoot();
    addDefect(root, defect({ id: 'SEC-07', title: '결제 재시도가 이중 청구된다' }));
    const v = shipVerdict(root);

    expect(v.ok).toBe(false);
    expect(v.reasons.some(r => r.includes('SEC-07') && r.includes('결제 재시도가 이중 청구된다'))).toBe(true);
  });

  it('blocker 가 fixed 로만 있으면 NO-GO — 「고쳤다」는 주장이고 재측정이 관측이다', () => {
    const root = shipReadyRoot();
    addDefect(root, defect({ id: 'SEC-08', status: 'fixed' }));
    const v = shipVerdict(root);

    expect(v.ok).toBe(false);
    expect(v.reasons.some(r => r.includes('SEC-08') && /재측정/.test(r))).toBe(true);
  });

  it('P10·P11 게이트가 승인 전이면 NO-GO 이고 게이트를 지목한다', () => {
    const root = setup();
    const v = shipVerdict(root);

    expect(v.ok).toBe(false);
    expect(v.reasons.some(r => r.includes('P10'))).toBe(true);
    expect(v.reasons.some(r => r.includes('P11'))).toBe(true);
  });

  it('출하 게이트 근거가 code 면 NO-GO — measured 를 요구한다', () => {
    const root = shipReadyRoot();
    writeDoc(root, 'docs/ship.md', 'P12 체크리스트');
    submitGate(root, 'P12', { paths: ['docs/ship.md'], evidence: 'code' });
    const v = shipVerdict(root);

    expect(v.ok).toBe(false);
    expect(v.reasons.some(r => r.includes('P12') && r.includes('measured'))).toBe(true);
  });

  it('UX 참조 웨이브에 실주행 캡처가 없으면 NO-GO 이고 웨이브를 지목한다', () => {
    const root = shipReadyRoot();
    fs.rmSync(evidenceDir(root, 'wave-001'), { recursive: true });
    const v = shipVerdict(root);

    expect(v.ok).toBe(false);
    expect(v.reasons.some(r => r.includes('wave-001') && r.includes('UX-7'))).toBe(true);
  });

  it('UX 를 참조하지 않는 웨이브는 증적을 요구하지 않는다', () => {
    const root = shipReadyRoot();
    createWave(root, {
      milestone: 'M3-정산', design_refs: ['F-20'], acceptance: ['정산 배치 그린'], goal: '정산 배치',
    });
    expect(shipVerdict(root).ok).toBe(true);
  });

  it('해석할 수 없는 웨이브는 통과가 아니라 사유로 남는다', () => {
    const root = shipReadyRoot();
    fs.writeFileSync(path.join(root, '.harness', 'waves', 'wave-009.md'), 'frontmatter 없음');
    const v = shipVerdict(root);

    expect(v.ok).toBe(false);
    expect(v.reasons.some(r => r.includes('wave-009'))).toBe(true);
  });
});

describe('릴리스 체크리스트 (P12)', () => {
  it('판정·결함·배포 기록·RTM 미커버 구간을 한 장에 담는다', () => {
    const root = shipReadyRoot();
    upsertNode(root, { id: 'F-12', title: '결제', version: 1, status: 'approved' });
    recordDeployment(root, {
      version: 'v1.2.0', commitSha: 'cb4b0ac', environment: 'production', evidence: ['evidence/smoke.log'],
    });
    const md = renderReleaseChecklist(root);

    expect(md).toContain('출하 가능');
    expect(md).toContain('cb4b0ac');
    expect(md).toContain('F-12');          // RTM 미커버 구간이 실린다
    expect(md).toContain('미커버');
  });

  it('NO-GO 사유를 그대로 싣는다 — 「준비 안 됨」한 줄로 뭉개지 않는다', () => {
    const root = shipReadyRoot();
    addDefect(root, defect({ id: 'SEC-09', title: '관리자 API 인가 누락' }));
    const md = renderReleaseChecklist(root);

    expect(md).toContain('출하 불가');
    expect(md).toContain('SEC-09');
    expect(md).toContain('관리자 API 인가 누락');
  });

  it('배포 기록이 없으면 그렇다고 적는다', () => {
    expect(renderReleaseChecklist(shipReadyRoot())).toMatch(/배포 기록이 없다/);
  });
});
