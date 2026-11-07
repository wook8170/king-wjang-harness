/**
 * P6 설계 감사 회차 규칙(audit.ts, skills/phase-p6-audit/SKILL.md).
 * 끝나는 조건, 전체 감사 상한, 오너 수용, 시험 전환과 이월, 번복 충돌, 반영 대조, 예전 회차 호환을 고정한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { auditStatus, carryItemGaps, hasCheckableEvidence } from '../src/audit';
import { approveGate, invalidateStaleGates, submitGate } from '../src/gate';
import { readEvents } from '../src/events';
import { pinPolicy } from '../src/policy';
import { buildReviewPacket, renderRtm } from '../src/report';
import { shipVerdict } from '../src/ship';
import { initHarness, readState, writeState } from '../src/state';
import { run } from '../src/cli';
import { activateWave, completeWave, createWave, logTurn } from '../src/wave';

// 판정 문구를 영어로 고정해 잰다.
const savedLang = process.env.HARNESS_LANG;
beforeEach(() => { process.env.HARNESS_LANG = 'en'; });
afterEach(() => {
  if (savedLang === undefined) delete process.env.HARNESS_LANG;
  else process.env.HARNESS_LANG = savedLang;
});

const setupFresh = (cap?: number): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-audit-'));
  initHarness(root);
  if (cap !== undefined) {
    // 상한은 재고정된 값만 쓰인다. 오너가 설정을 고치고 재고정한 상태다.
    fs.appendFileSync(path.join(root, '.harness/config.yaml'), `\naudit_full_round_cap: ${cap}\n`);
    pinPolicy(root, 'accept');
  }
  write(root, 'docs/design.md', 'The design document under review states every behaviour the product promises to its users, one paragraph at a time.');
  return root;
};
const setup = setupFresh;
const write = (root: string, rel: string, body: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

const EV = '03-feature.md:88 · src/a.ts:12';
const row = (id: string, sev: string, evidence = EV): string => `| ${id} | ${sev} | ${evidence} | P3 | what is wrong | fix it |`;

interface RoundOpts {
  kind?: 'full' | 'short';
  findings?: string[];
  high?: number;
  extra?: string;
  structural?: 'yes' | 'no';
}
const round = (root: string, n: number, o: RoundOpts = {}): void => {
  const findings = o.findings ?? [];
  const high = o.high ?? findings.filter(f => f.includes('| HIGH |')).length;
  const kind = o.kind ?? 'full';
  write(root, `.harness/audit/audit-r${n}.md`, [
    `# Audit round ${n}`, `Audit-Kind: ${kind}`,
    kind === 'full' ? 'Lenses: logical coherence, ambiguity, blockers, UX walkthrough' : '',
    kind === 'short' ? `\n## Scope check\nstructural change: ${o.structural ?? 'no'}\n\n## New risks of this revision\nnone found` : '',
    '', '## Findings', '', '| ID | Severity | Evidence | Owning phase | What | Direction |', '|---|---|---|---|---|---|',
    ...findings, '', o.extra ?? '', '', `HIGH ${high}`, '',
  ].join('\n'));
};
const reconcile = (root: string, n: number, rows: string[], extra = ''): void => {
  write(root, `.harness/audit/reconcile-r${n}.md`, [
    `# Reconciliation ${n}`, '| Finding | Severity | Decision | Applied at | Reason |', '|---|---|---|---|---|', ...rows, '', extra, '',
  ].join('\n'));
};
const applied = (...ids: string[]): string =>
  ['## Application check', '| Item | Sentence | Result |', '|---|---|---|', ...ids.map(i => `| ${i} | the sentence | applied |`)].join('\n');

/** 제출 대상: 설계 문서 + 최신 회차 + 있는 처리표 전부. */
const submitP6 = (root: string): ReturnType<typeof submitGate> => {
  const names = fs.readdirSync(path.join(root, '.harness/audit'));
  const newest = Math.max(...names.map(f => /^audit-r(\d+)\.md$/.exec(f)).filter(Boolean).map(m => Number(m![1])));
  return submitGate(root, 'P6', {
    evidence: 'claimed',
    paths: [
      'docs/design.md', `.harness/audit/audit-r${newest}.md`,
      ...names.filter(f => /^reconcile-r\d+\.md$/.test(f)).map(f => `.harness/audit/${f}`),
    ],
  });
};

describe('끝나는 조건', () => {
  it('회차가 없으면 P6 을 제출할 수 없다', () => {
    const root = setup();
    expect(() => submitGate(root, 'P6', { paths: ['docs/design.md'], evidence: 'claimed' })).toThrow(/audit round/i);
    expect(auditStatus(root).next).toBe('run-full-audit');
  });

  it('HIGH 0 이고 지적이 없으면 통과한다', () => {
    const root = setup();
    round(root, 1);
    expect(submitP6(root).status).toBe('submitted');
    expect(auditStatus(root).next).toBe('ready');
  });

  it('HIGH 가 남으면 거부한다', () => {
    const root = setup();
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | not accepted | — | the path is test-only |']);
    expect(() => submitP6(root)).toThrow(/HIGH-1/);
    expect(auditStatus(root).next).toBe('fix-and-reaudit');
  });

  it('HIGH 0 뒤 MED·LOW 를 고치지 않고 처리표에 적으면 네 렌즈 없이 통과한다', () => {
    const root = setup();
    round(root, 1, { findings: [row('MED-1', 'MED'), row('LOW-1', 'LOW')] });
    reconcile(root, 1, ['| MED-1 | MED | carried | F-3 | implementation can settle this |', '| LOW-1 | LOW | not accepted | — | wording only |']);
    expect(submitP6(root).status).toBe('submitted');
  });

  it('HIGH 0 인데 처리표가 없으면 거부한다', () => {
    const root = setup();
    round(root, 1, { findings: [row('MED-1', 'MED')] });
    expect(() => submitP6(root)).toThrow(/reconcile-r1/);
  });

  it('HIGH 0 뒤 문서를 고쳤으면 짧은 재감사를 요구하고, 그 뒤 통과한다', () => {
    const root = setup();
    round(root, 1, { findings: [row('MED-1', 'MED')] });
    reconcile(root, 1, ['| MED-1 | MED | accepted | F-3 · 03-feature.md:9 [r1] | |'], applied('MED-1'));
    expect(() => submitP6(root)).toThrow(/short/);
    expect(auditStatus(root).next).toBe('short-reaudit');
    round(root, 2, { kind: 'short', extra: 'MED-1 was applied as written.' });
    expect(submitP6(root).status).toBe('submitted');
    expect(auditStatus(root).fullRounds).toBe(1);
  });

  it('짧은 재감사에서 나온 HIGH 는 고치고 다시 짧게 본다', () => {
    const root = setup();
    round(root, 1);
    round(root, 2, { kind: 'short', findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 2, ['| HIGH-1 | HIGH | accepted | F-3 [r2] | |'], applied('HIGH-1'));
    expect(() => submitP6(root)).toThrow(/HIGH-1/);
    round(root, 3, { kind: 'short', extra: 'HIGH-1 is fixed.' });
    expect(submitP6(root).status).toBe('submitted');
  });

  it('제출 뒤에 생긴 회차는 승인에서 거부한다', () => {
    const root = setup();
    round(root, 1);
    submitP6(root);
    round(root, 2, { kind: 'short', findings: [row('HIGH-1', 'HIGH')] });
    expect(() => approveGate(root, 'P6')).toThrow(/HIGH-1/);
    expect(readState(root).gates.P6?.status).toBe('submitted');
  });

  it('제출 집합에 최신 회차나 처리표가 빠지면 거부한다', () => {
    const root = setup();
    round(root, 1, { findings: [row('LOW-1', 'LOW')] });
    reconcile(root, 1, ['| LOW-1 | LOW | not accepted | — | wording only |']);
    expect(() => submitGate(root, 'P6', { paths: ['docs/design.md', '.harness/audit/audit-r1.md'], evidence: 'claimed' }))
      .toThrow(/reconcile-r1/);
    expect(() => submitGate(root, 'P6', { paths: ['docs/design.md', '.harness/audit/reconcile-r1.md'], evidence: 'claimed' }))
      .toThrow(/audit-r1/);
  });
});

describe('숫자 위조', () => {
  it('표에 HIGH 가 있는데 끝 줄만 HIGH 0 으로 고치면 거부한다', () => {
    const root = setup();
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')], high: 0 });
    reconcile(root, 1, ['| HIGH-1 | HIGH | not accepted | — | no |']);
    expect(() => submitP6(root)).toThrow(/HIGH 0.*1 HIGH|HIGH 행은 1/);
  });

  it('끝 줄이 HIGH N 이 아니면 거부한다', () => {
    const root = setup();
    round(root, 1);
    fs.appendFileSync(path.join(root, '.harness/audit/audit-r1.md'), 'one more closing remark\n');
    expect(() => submitP6(root)).toThrow(/HIGH N/);
  });

  it('지적 절을 지우면 거부한다', () => {
    const root = setup();
    write(root, '.harness/audit/audit-r1.md', 'Audit-Kind: full\nLenses: logical, ambiguity, blockers, ux\nThe findings section was removed from this file on purpose.\n\nHIGH 0\n');
    expect(() => submitP6(root)).toThrow(/Findings/);
  });

  it('처리표에서 심각도를 낮추면 거부한다', () => {
    const root = setup();
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | MED | carried | F-3 | not that bad |']);
    expect(() => submitP6(root)).toThrow(/Lowering a severity|심각도/);
  });

  it('승인 뒤에 회차 파일을 고치면 해시 검사가 게이트를 무효화한다', () => {
    const root = setup();
    round(root, 1);
    submitP6(root);
    approveGate(root, 'P6');
    fs.appendFileSync(path.join(root, '.harness/audit/audit-r1.md'), '\nHIGH 0\n');
    expect(invalidateStaleGates(root)).toContain('P6');
  });
});

describe('근거', () => {
  it('확인할 수 있는 근거의 형식', () => {
    expect(hasCheckableEvidence('.harness/design/03-feature.md:88')).toBe(true);
    expect(hasCheckableEvidence('repro: `npm test` fails on a clean checkout')).toBe(true);
    expect(hasCheckableEvidence('재현: 두 창에서 동시에 저장')).toBe(true);
    expect(hasCheckableEvidence('UX-7 · S2-3')).toBe(true);
    expect(hasCheckableEvidence('F-12')).toBe(false);
    expect(hasCheckableEvidence('느낌상 위험하다')).toBe(false);
    expect(hasCheckableEvidence('at 12:30')).toBe(false);
  });

  it('근거 없는 HIGH 는 오너 수용으로도 닫히지 않는다', () => {
    const root = setup(1);
    round(root, 1, { findings: [row('HIGH-1', 'HIGH', 'F-12')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | owner-accepted | — | the owner takes it |']);
    expect(() => submitP6(root)).toThrow(/evidence|근거/);
  });
});

describe('짧은 재감사의 형식', () => {
  const base = (root: string): void => {
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | accepted | F-3 [r1] | |'], applied('HIGH-1'));
  };

  it('첫 회차는 짧을 수 없다', () => {
    const root = setup();
    round(root, 1, { kind: 'short' });
    expect(() => submitP6(root)).toThrow(/first round/);
  });

  it('감사자가 구조 변경을 확인하면 거부한다', () => {
    const root = setup();
    base(root);
    round(root, 2, { kind: 'short', structural: 'yes', extra: 'HIGH-1 is fixed.' });
    expect(() => submitP6(root)).toThrow(/structural/);
  });

  it('구조 변경 판정 줄이 없으면 거부한다', () => {
    const root = setup();
    base(root);
    write(root, '.harness/audit/audit-r2.md', 'Audit-Kind: short\n## New risks of this revision\nnone\n## Findings\nHIGH-1 is fixed in the revised paragraph.\n\nHIGH 0\n');
    expect(() => submitP6(root)).toThrow(/structural change/);
  });

  it('새 위험 절이 없으면 거부한다', () => {
    const root = setup();
    base(root);
    write(root, '.harness/audit/audit-r2.md', 'Audit-Kind: short\nstructural change: no\n## Findings\nHIGH-1 is fixed in the revised paragraph.\n\nHIGH 0\n');
    expect(() => submitP6(root)).toThrow(/New risks/);
  });

  it('앞 회차의 HIGH 를 다루지 않으면 거부한다', () => {
    const root = setup();
    base(root);
    round(root, 2, { kind: 'short' });
    expect(() => submitP6(root)).toThrow(/HIGH-1/);
  });

  it('`HIGH-1` 이 `HIGH-10` 언급으로 충족되지 않는다', () => {
    const root = setup();
    base(root);
    round(root, 2, { kind: 'short', extra: 'HIGH-10 only.' });
    expect(() => submitP6(root)).toThrow(/HIGH-1/);
  });

  it('전체 감사에 네 렌즈가 없으면 거부한다', () => {
    const root = setup();
    write(root, '.harness/audit/audit-r1.md', 'Audit-Kind: full\nLenses: logical coherence\n## Findings\nNo finding from the single lens that actually ran.\n\nHIGH 0\n');
    expect(() => submitP6(root)).toThrow(/Lenses/);
  });
});

describe('전체 감사 상한', () => {
  const threeFull = (root: string, lastHigh = true): void => {
    for (const n of [1, 2]) {
      round(root, n, { findings: [row(`HIGH-${n}`, 'HIGH')], extra: n > 1 ? 'HIGH-1 is fixed.' : '' });
      reconcile(root, n, [`| HIGH-${n} | HIGH | accepted | F-3 [r${n}] | |`], applied(`HIGH-${n}`));
    }
    round(root, 3, { findings: lastHigh ? [row('HIGH-3', 'HIGH')] : [], extra: 'HIGH-2 is fixed.' });
  };

  it('기본 상한은 3 이고, 3회 뒤 HIGH 가 남으면 오너 결정으로 넘어간다', () => {
    const root = setup();
    threeFull(root);
    const s = auditStatus(root);
    expect(s).toMatchObject({ fullRounds: 3, cap: 3, capReached: true, next: 'owner-decision', openHighs: ['HIGH-3'] });
    expect(() => submitP6(root)).toThrow(/HIGH-3/);
  });

  it('4번째 전체 감사는 HIGH 0 이어도 거부한다', () => {
    const root = setup();
    threeFull(root);
    reconcile(root, 3, ['| HIGH-3 | HIGH | accepted | F-3 [r3] | |'], applied('HIGH-3'));
    round(root, 4);
    expect(() => submitP6(root)).toThrow(/audit_full_round_cap/);
  });

  it('오너가 상한을 올리면 4번째가 통과한다', () => {
    const root = setup(4);
    threeFull(root);
    reconcile(root, 3, ['| HIGH-3 | HIGH | accepted | F-3 [r3] | |'], applied('HIGH-3'));
    round(root, 4, { extra: 'HIGH-3 is fixed.' });
    expect(submitP6(root).status).toBe('submitted');
  });

  it('상한 뒤에도 짧은 재감사는 허용된다 — 고쳐서 닫는 선택지', () => {
    const root = setup();
    threeFull(root);
    reconcile(root, 3, ['| HIGH-3 | HIGH | accepted | F-3 [r3] | |'], applied('HIGH-3'));
    round(root, 4, { kind: 'short', extra: 'HIGH-3 is fixed.' });
    expect(submitP6(root).status).toBe('submitted');
    expect(auditStatus(root).fullRounds).toBe(3);
  });

  it('잘못된 상한 값은 기본값으로 읽는다', () => {
    const root = setup();
    fs.appendFileSync(path.join(root, '.harness/config.yaml'), '\naudit_full_round_cap: 0\n');
    expect(auditStatus(root).cap).toBe(3);
  });
});

describe('오너 수용', () => {
  const capped = (root: string): void => {
    round(root, 1, { findings: [row('HIGH-1', 'HIGH'), row('MED-1', 'MED')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | owner-accepted | — | the owner takes this risk until v2 |', '| MED-1 | MED | carried | F-3 | later |']);
  };

  it('수용 행이 없으면 상한에 닿아도 닫히지 않는다', () => {
    const root = setup(1);
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | not accepted | — | the fixer disagrees |']);
    expect(() => submitP6(root)).toThrow(/HIGH-1/);
  });

  it('사유 없는 수용은 거부한다', () => {
    const root = setup(1);
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | owner-accepted | — | |']);
    expect(() => submitP6(root)).toThrow(/without a reason|사유/);
  });

  it('수용 행은 승인 묶음에 보이고, 승인 전에는 저널에 수용 기록이 없다', () => {
    const root = setup(1);
    capped(root);
    expect(submitP6(root).status).toBe('submitted');
    const packet = buildReviewPacket(root, 'P6');
    expect(packet).toContain('HIGH-1');
    expect(packet).toContain('the owner takes this risk');
    expect(readEvents(root).some(e => 'auditAcceptedHighs' in e.data)).toBe(false);
  });

  it('사람의 승인이 수용을 저널에 남긴다', () => {
    const root = setup(1);
    capped(root);
    submitP6(root);
    approveGate(root, 'P6', 'slash');
    const ev = readEvents(root).find(e => e.type === 'gate-approved');
    expect(ev?.data.auditAcceptedHighs).toEqual([{ round: 1, id: 'HIGH-1', reason: 'the owner takes this risk until v2' }]);
  });

  it('에이전트 호출로는 승인할 수 없어 수용이 효력을 갖지 못한다', () => {
    const root = setup(1);
    capped(root);
    submitP6(root);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = run(['gate', 'approve', 'P6'], root);
    err.mockRestore(); log.mockRestore();
    expect(code).not.toBe(0);
    expect(readState(root).gates.P6?.status).toBe('submitted');
  });

  it('수용한 HIGH 는 다음 회차가 HIGH 0 이어도 승인 묶음에 남는다', () => {
    const root = setup(1);
    round(root, 1, { findings: [row('HIGH-1', 'HIGH'), row('HIGH-2', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | owner-accepted | — | owner took it |', '| HIGH-2 | HIGH | accepted | F-3 [r1] | |'], applied('HIGH-2'));
    round(root, 2, { kind: 'short', extra: 'HIGH-2 is fixed.' });
    submitP6(root);
    expect(auditStatus(root).acceptedHighs.map(a => a.id)).toEqual(['HIGH-1']);
    expect(buildReviewPacket(root, 'P6')).toContain('owner took it');
  });
});

describe('HIGH 를 이월·시험 전환으로 옮겨 숫자를 줄일 수 없다', () => {
  const moved = (root: string): void => {
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | test-transfer | F-3 acceptance criterion | only a run can show the race |']);
  };

  it('HIGH 는 이월할 수 없다', () => {
    const root = setup();
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | carried | F-3 | later |']);
    expect(() => submitP6(root)).toThrow(/cannot be carried|이월할 수 없다/);
  });

  it('시험 전환한 HIGH 는 다음 감사자 판정 전에는 통과하지 못한다', () => {
    const root = setup();
    moved(root);
    expect(() => submitP6(root)).toThrow(/HIGH-1/);
    expect(auditStatus(root).next).toBe('short-reaudit');
  });

  it('다음 회차에 판정이 없으면 거부한다', () => {
    const root = setup();
    moved(root);
    round(root, 2, { kind: 'short', extra: 'HIGH-1 was mentioned but not judged.' });
    expect(() => submitP6(root)).toThrow(/Classification check/);
  });

  it('감사자가 upheld 하면 HIGH 로 세지 않고 승인 묶음에 보인다', () => {
    const root = setup();
    moved(root);
    round(root, 2, { kind: 'short', extra: '## Classification check\n| Item | Verdict | Why |\n|---|---|---|\n| HIGH-1 | upheld | needs a run |' });
    expect(submitP6(root).status).toBe('submitted');
    expect(auditStatus(root).transferredHighs.map(h => h.id)).toEqual(['HIGH-1']);
    expect(buildReviewPacket(root, 'P6')).toContain('only a run can show the race');
  });

  it('감사자가 뒤집으면 HIGH 행이 있어야 하고, 없으면 거부한다', () => {
    const root = setup();
    moved(root);
    round(root, 2, { kind: 'short', extra: '## Classification check\n| Item | Verdict | Why |\n|---|---|---|\n| HIGH-1 | overturned | the format cannot hold the value: 05-contract.md:9 |' });
    expect(() => submitP6(root)).toThrow(/overturned/);
  });

  it('뒤집힌 HIGH 는 열린 HIGH 로 돌아오고 대장에서 빠진다', () => {
    const root = setup();
    moved(root);
    round(root, 2, {
      kind: 'short', findings: [row('HIGH-1', 'HIGH')],
      extra: '## Classification check\n| Item | Verdict | Why |\n|---|---|---|\n| HIGH-1 | overturned | 05-contract.md:9 |',
    });
    const s = auditStatus(root);
    expect(s.openHighs).toEqual(['HIGH-1']);
    expect(s.carryItems).toEqual([]);
  });

  it('MED 를 수용 기준으로 옮기며 문단을 고쳤으면 짧은 재감사를 요구한다', () => {
    const root = setup();
    round(root, 1, { findings: [row('MED-1', 'MED')] });
    reconcile(root, 1, ['| MED-1 | MED | test-transfer | F-3 03-feature.md:9 [r1] | timing needs a run |']);
    expect(auditStatus(root).next).toBe('short-reaudit');
  });

  it('이월·시험 전환에는 옮긴 곳과 사유가 있어야 한다', () => {
    const root = setup();
    round(root, 1, { findings: [row('MED-1', 'MED'), row('MED-2', 'MED')] });
    reconcile(root, 1, ['| MED-1 | MED | carried | — | later |', '| MED-2 | MED | test-transfer | F-3 | |']);
    const v = auditStatus(root).violations.join('\n');
    expect(v).toMatch(/MED-1.*(target|옮긴 곳)/);
    expect(v).toMatch(/MED-2.*(reason|사유)/);
  });
});

describe('이월 대장과 RTM', () => {
  const carried = (root: string): void => {
    round(root, 1, { findings: [row('MED-1', 'MED'), row('MED-2', 'MED')] });
    reconcile(root, 1, ['| MED-1 | MED | carried | F-3 | reading decided here |', '| MED-2 | MED | test-transfer | P9 check | timing needs a run |']);
  };

  it('처리표에서 대장을 모은다', () => {
    const root = setup();
    carried(root);
    expect(auditStatus(root).carryItems.map(c => c.token)).toEqual(['AUD-r1-MED-1', 'AUD-r1-MED-2']);
  });

  it('완료 웨이브가 없으면 RTM 과 P9 묶음에 드러나고, 시험 전환은 출하 판정을 막는다', () => {
    const root = setup();
    carried(root);
    expect(renderRtm(root)).toContain('AUD-r1-MED-2');
    expect(buildReviewPacket(root, 'P9')).toContain('AUD-r1-MED-2');
    const reasons = shipVerdict(root).reasons.join('\n');
    expect(reasons).toContain('AUD-r1-MED-2');
    expect(reasons).not.toContain('AUD-r1-MED-1');
  });

  it('표식을 수용 기준에 담은 웨이브가 완료되면 비는 항목에서 빠진다', () => {
    const root = setup();
    carried(root);
    const w = createWave(root, { milestone: 'M-1', goal: 'check the timing', acceptance: ['AUD-r1-MED-2 two writers keep the row consistent'], design_refs: [] });
    expect(carryItemGaps(root).map(c => c.token)).toContain('AUD-r1-MED-2');
    activateWave(root, w.id);
    logTurn(root, 'ran the race test');
    completeWave(root);
    expect(carryItemGaps(root).map(c => c.token)).toEqual(['AUD-r1-MED-1']);
  });
});

describe('번복 충돌', () => {
  const conflict = '## Reversal conflicts\n| Item | Closed decision | New direction |\n|---|---|---|\n| RC-1 | keep the row | delete the row |';

  it('HIGH 로 세지 않지만 오너가 고르기 전에는 통과하지 못한다', () => {
    const root = setup();
    round(root, 1, { extra: conflict });
    expect(auditStatus(root).openHighs).toEqual([]);
    expect(() => submitP6(root)).toThrow(/RC-1/);
  });

  it('오너 결정을 처리표에 적으면 그 수정을 짧게 재감사한 뒤 통과한다', () => {
    const root = setup();
    round(root, 1, { extra: conflict });
    reconcile(root, 1, ['| RC-1 | CONFLICT | owner-decided | 05-contract.md:9 [r1] | the owner keeps the row |']);
    expect(() => submitP6(root)).toThrow(/short/);
    round(root, 2, { kind: 'short' });
    expect(submitP6(root).status).toBe('submitted');
  });
});

describe('반영 대조', () => {
  const fixed = (root: string, extra: string): void => {
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | accepted | F-3 [r1] | |'], extra);
    round(root, 2, { kind: 'short', extra: 'HIGH-1 was read in the application check.' });
  };

  it('대조 표가 없으면 재감사를 인정하지 않는다', () => {
    const root = setup();
    fixed(root, '');
    expect(() => submitP6(root)).toThrow(/Application check/);
  });

  it('HIGH 수정의 문장 하나라도 미반영이면 닫히지 않는다', () => {
    const root = setup();
    fixed(root, '## Application check\n| Item | Sentence | Result |\n|---|---|---|\n| HIGH-1.1 | first | applied |\n| HIGH-1.2 | second | missing |');
    expect(() => submitP6(root)).toThrow(/stays open|닫히지 않는다/);
  });

  it('미반영을 고치면 새 HIGH 없이 통과한다', () => {
    const root = setup();
    fixed(root, '## Application check\n| Item | Sentence | Result |\n|---|---|---|\n| HIGH-1.1 | first | applied |\n| HIGH-1.2 | second | applied |');
    expect(submitP6(root).status).toBe('submitted');
    expect(auditStatus(root).rounds[1].high).toBe(0);
  });
});

describe('예전 형식 회차 호환', () => {
  // 이 판 이전에 시작한 프로젝트: state 에 감사 형식 판이 없다.
  const setup = (): string => {
    const root = setupFresh();
    const { auditFormat: _drop, ...state } = readState(root);
    writeState(root, state);
    return root;
  };
  const legacy = (root: string, n: number, last: string): void =>
    write(root, `.harness/audit/audit-r${n}.md`, `# 설계 감사 ${n}라운드\n\n## HIGH\n\n| 묶음 | 내용 |\n|---|---|\n| R${n}-H1 | 예전 표 |\n\n${last}\n`);

  it('형식 줄이 없으면 전체 감사로 세고 끝 줄의 HIGH 를 읽는다', () => {
    const root = setup();
    for (const [n, h] of [[1, 15], [2, 10], [3, 6], [4, 2], [5, 1], [6, 0]] as const) legacy(root, n, `HIGH ${h}`);
    const s = auditStatus(root);
    expect(s.fullRounds).toBe(6);
    expect(s.rounds.every(r => !r.labelled && r.kind === 'full')).toBe(true);
    expect(s.rounds[5].high).toBe(0);
    expect(s.violations).toEqual([]);
    expect(submitP6(root).status).toBe('submitted');
  });

  it('예전 회차의 표와 처리표 표현에 새 형식 검사를 대지 않는다', () => {
    const root = setup();
    legacy(root, 1, 'HIGH 0');
    reconcile(root, 1, ['| L1 | MED | 수용 | 05 SCH-5(152) | 켜진 상태의 정의 |']);
    expect(auditStatus(root).violations).toEqual([]);
  });

  it('최신 예전 회차의 HIGH 가 남으면 거부한다', () => {
    const root = setup();
    legacy(root, 1, 'HIGH 2');
    expect(() => submitP6(root)).toThrow(/HIGH 2/);
  });

  it('끝 줄을 읽을 수 없는 예전 회차는 짧은 재감사를 요구하고, 그러면 통과한다', () => {
    const root = setup();
    legacy(root, 1, '기존 이월 전량 유지.');
    expect(() => submitP6(root)).toThrow(/HIGH N/);
    expect(auditStatus(root).next).toBe('short-reaudit');
    round(root, 2, { kind: 'short' });
    expect(submitP6(root).status).toBe('submitted');
  });

  it('예전 회차가 상한을 넘겨도 새 전체 감사부터 막는다', () => {
    const root = setup();
    for (const n of [1, 2, 3]) legacy(root, n, 'HIGH 0');
    round(root, 4);
    expect(() => submitP6(root)).toThrow(/audit_full_round_cap/);
  });

  it('새 형식 뒤에 형식 없는 회차를 두어 상한을 피할 수 없다', () => {
    const root = setup();
    round(root, 1);
    legacy(root, 2, 'HIGH 0');
    expect(() => submitP6(root)).toThrow(/Audit-Kind/);
  });

  it('이미 승인된 P6 은 업그레이드만으로 무효가 되지 않는다', () => {
    const root = setup();
    legacy(root, 1, 'HIGH 0');
    submitP6(root);
    approveGate(root, 'P6');
    legacy(root, 2, '기존 이월 전량 유지.');
    expect(invalidateStaleGates(root)).toEqual([]);
    expect(readState(root).gates.P6?.status).toBe('approved');
  });
});

describe('harness audit status', () => {
  it('회차 판정을 JSON 으로 출력한다', () => {
    const root = setup();
    round(root, 1);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = run(['audit', 'status'], root);
    const printed = JSON.parse(String(log.mock.calls[0][0])) as { fullRounds: number; next: string };
    log.mockRestore();
    expect(code).toBe(0);
    expect(printed).toMatchObject({ fullRounds: 1, next: 'ready' });
  });
});
