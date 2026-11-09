/**
 * P6 감사 규칙 적대 검증의 재현(E8·E9·E12·E13·E31·E35·E36·E37)과 오너 결정 D7~D9 를 고정한다.
 * 각 시험은 수정 전 코드에서 통과되던 우회이거나 막히던 정상 경로다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { auditClosedItems, auditStatus, carryItemGaps, hasCheckableEvidence } from '../src/audit';
import { approveGate, submitGate } from '../src/gate';
import { readEvents, replayState, appendEvent } from '../src/events';
import { handleHook } from '../src/hook';
import { pinPolicy } from '../src/policy';
import { buildReviewPacket, renderRtm } from '../src/report';
import { shipVerdict } from '../src/ship';
import { initHarness, readState, writeState } from '../src/state';
import { run } from '../src/cli';
import { loadConfig } from '../src/config';
import { runDoctor } from '../src/doctor';
import { activateWave, completeWave, createWave, logTurn } from '../src/wave';

const savedLang = process.env.HARNESS_LANG;
beforeEach(() => { process.env.HARNESS_LANG = 'en'; });
afterEach(() => {
  if (savedLang === undefined) delete process.env.HARNESS_LANG;
  else process.env.HARNESS_LANG = savedLang;
});

const write = (root: string, rel: string, body: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
const fresh = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-adv-'));
  initHarness(root);
  write(root, 'docs/design.md', 'The design document under review states every behaviour the product promises to its users, one paragraph at a time.');
  return root;
};
/** 이 판 이전에 시작한 프로젝트: state 에 감사 형식 판이 없다. */
const older = (): string => {
  const root = fresh();
  const { auditFormat: _drop, ...state } = readState(root);
  writeState(root, state);
  return root;
};

const EV = '03-feature.md:88';
const row = (id: string, sev: string, ev = EV): string => `| ${id} | ${sev} | ${ev} | P3 | what is wrong | fix it |`;
const TABLE = ['| ID | Severity | Evidence | Phase | What | Direction |', '|---|---|---|---|---|---|'];
const round = (root: string, n: number, o: { kind?: 'full' | 'short'; findings?: string[]; high?: number; extra?: string } = {}): void => {
  const findings = o.findings ?? [];
  const kind = o.kind ?? 'full';
  write(root, `.harness/audit/audit-r${n}.md`, [
    `Audit-Kind: ${kind}`,
    kind === 'full' ? 'Lenses: logical coherence, ambiguity, blockers, UX walkthrough' : 'structural change: no\n## New risks of this revision\nnone found',
    '## Findings', ...TABLE, ...findings, '', o.extra ?? '', '',
    `HIGH ${o.high ?? findings.filter(f => f.includes('| HIGH |')).length}`, '',
  ].join('\n'));
};
const reconcile = (root: string, n: number, rows: string[], extra = ''): void =>
  write(root, `.harness/audit/reconcile-r${n}.md`, ['| Finding | Severity | Decision | Applied at | Reason |', '|---|---|---|---|---|', ...rows, '', extra, ''].join('\n'));
const applied = (...ids: string[]): string =>
  ['## Application check', '| Item | Sentence | Result |', '|---|---|---|', ...ids.map(i => `| ${i} | the sentence | applied |`)].join('\n');
const submitP6 = (root: string): ReturnType<typeof submitGate> => {
  const names = fs.readdirSync(path.join(root, '.harness/audit'));
  const newest = Math.max(...names.flatMap((f) => { const m = /^audit-r(\d+)\.md$/.exec(f); return m ? [Number(m[1])] : []; }));
  return submitGate(root, 'P6', {
    evidence: 'claimed',
    paths: ['docs/design.md', `.harness/audit/audit-r${newest}.md`,
      ...names.filter(f => /^reconcile-r\d+\.md$/.test(f)).map(f => `.harness/audit/${f}`)],
  });
};
const capture = (fn: () => number): { code: number; text: string } => {
  const out: string[] = [];
  const l = vi.spyOn(console, 'log').mockImplementation(m => { out.push(String(m)); });
  const e = vi.spyOn(console, 'error').mockImplementation(m => { out.push(String(m)); });
  try { return { code: fn(), text: out.join('\n') }; } finally { l.mockRestore(); e.mockRestore(); }
};

const unlabelled = (root: string, n: number, last: string): void =>
  write(root, `.harness/audit/audit-r${n}.md`, `# Round ${n}\n\n## Findings\n${TABLE.join('\n')}\n${row('HIGH-1', 'HIGH', 'F-12')}\n\n${last}\n`);

describe('H1 · D7: 줄 하나를 빼서 검사를 끌 수 없다', () => {
  it('E9: 새 프로젝트의 형식 없는 회차는 끝 줄이 HIGH 0 이어도 거부한다', () => {
    const root = fresh();
    for (let n = 1; n <= 9; n++) unlabelled(root, n, 'HIGH 1');
    unlabelled(root, 10, 'HIGH 0');
    reconcile(root, 9, ['| HIGH-1 | LOW | carried | — | |']);
    expect(auditStatus(root).violations.join('\n')).toMatch(/audit-r10\.md.*Audit-Kind/);
    expect(() => submitP6(root)).toThrow(/Audit-Kind/);
  });

  it('E37: 형식 없는 회차 하나로 승인까지 가지 못한다', () => {
    const root = fresh();
    unlabelled(root, 1, 'HIGH 0');
    expect(() => submitP6(root)).toThrow(/Audit-Kind/);
    expect(readState(root).gates.P6).toBeUndefined();
  });

  it('`harness init` 은 새 형식으로 시작하고 저널에도 남는다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-adv-'));
    capture(() => run(['init'], root));
    expect(readState(root).auditFormat).toEqual({ version: 1, legacyThrough: 0 });
    expect(replayState(readEvents(root)).auditFormat).toEqual({ version: 1, legacyThrough: 0 });
  });

  it('기존 프로젝트: 있던 회차는 그대로 읽고, 다음 회차부터 형식을 요구한다', () => {
    const root = older();
    write(root, '.harness/audit/audit-r1.md', '# Old round with its own table format\n\nHIGH 0\n');
    expect(submitP6(root).status).toBe('submitted');
    expect(readState(root).auditFormat?.legacyThrough).toBe(1);
    write(root, '.harness/audit/audit-r2.md', '# Written after the upgrade without the line\n\nHIGH 0\n');
    expect(() => submitP6(root)).toThrow(/audit-r2\.md.*Audit-Kind/);
  });

  it('세션 시작이 판을 적어, 그 세션에서 쓴 형식 없는 회차는 예전 회차가 되지 못한다', () => {
    const root = older();
    write(root, '.harness/audit/audit-r1.md', '# Old\n\nHIGH 0\n');
    handleHook(root, 'session-start', {});
    expect(readState(root).auditFormat?.legacyThrough).toBe(1);
    write(root, '.harness/audit/audit-r2.md', '# New without the line\n\nHIGH 0\n');
    expect(auditStatus(root).violations.join('\n')).toMatch(/audit-r2\.md/);
  });

  it('뒤에 붙인 기록으로 범위를 넓히지 못하고, 복구해도 판이 남는다', () => {
    const root = older();
    write(root, '.harness/audit/audit-r1.md', '# Old\n\nHIGH 0\n');
    submitP6(root);
    appendEvent(root, 'audit-format-pinned', { version: 1, legacyThrough: 99 });
    expect(replayState(readEvents(root)).auditFormat?.legacyThrough).toBe(1);
    fs.rmSync(path.join(root, '.harness/state.json'));
    runDoctor(root, { repair: true });
    expect(readState(root).auditFormat?.legacyThrough).toBe(1);
  });

  it('에이전트는 state.json 과 저널을 고쳐 판을 낮추지 못한다', () => {
    const root = fresh();
    for (const file of ['.harness/state.json', '.harness/events.jsonl']) {
      const out = handleHook(root, 'pre-tool', { tool_name: 'Write', tool_input: { file_path: path.join(root, file), content: '{}' } }) as any;
      expect(out?.hookSpecificOutput?.permissionDecision).toBe('deny');
    }
    const out = handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command: `sed -i '' 's/"legacyThrough": 0/"legacyThrough": 9/' .harness/state.json` } }) as any;
    expect(out?.hookSpecificOutput?.permissionDecision).toBe('deny');
  });
});

describe('H2: 번복 결정은 오너 앞에 놓인다', () => {
  const conflict = '## Reversal conflicts\n| Item | Closed | New |\n|---|---|---|\n| RC-1 | keep | delete |';
  const decided = (root: string): void => {
    round(root, 1, { extra: conflict });
    reconcile(root, 1, ['| RC-1 | CONFLICT | owner-decided | 05-contract.md:9 [r1] | the owner keeps the row |']);
    round(root, 2, { kind: 'short' });
  };

  it('E8: 승인 묶음에 번복 결정과 사유가 보인다', () => {
    const root = fresh();
    decided(root);
    submitP6(root);
    const packet = buildReviewPacket(root, 'P6');
    expect(packet).toContain('RC-1');
    expect(packet).toContain('the owner keeps the row');
    expect(auditStatus(root).ownerDecisions).toEqual([{ round: 1, id: 'RC-1', reason: 'the owner keeps the row' }]);
  });

  it('승인 이벤트가 번복 결정을 남기고, 승인 전에는 없다', () => {
    const root = fresh();
    decided(root);
    submitP6(root);
    expect(readEvents(root).some(e => 'auditOwnerDecisions' in e.data)).toBe(false);
    approveGate(root, 'P6', 'slash');
    expect(readEvents(root).find(e => e.type === 'gate-approved')?.data.auditOwnerDecisions)
      .toEqual([{ round: 1, id: 'RC-1', reason: 'the owner keeps the row' }]);
  });

  it('사유 없는 오너 결정은 거부한다', () => {
    const root = fresh();
    round(root, 1, { findings: [row('MED-1', 'MED')] });
    reconcile(root, 1, ['| MED-1 | MED | owner-decided | F-3 [r1] | |']);
    expect(auditStatus(root).violations.join('\n')).toMatch(/MED-1.*without a reason/);
  });
});

describe('M1: 표 표기로 HIGH 가 빠지지 않는다', () => {
  it('E31: 렌즈 절을 이어 붙여도 뒤 절의 HIGH 를 센다', () => {
    const root = fresh();
    write(root, '.harness/audit/audit-r1.md', [
      'Audit-Kind: full', 'Lenses: logical coherence, ambiguity, blockers, UX walkthrough',
      '## Findings', ...TABLE, row('MED-1', 'MED'),
      '## Findings — UX walkthrough', ...TABLE, row('HIGH-1', 'HIGH'), '', 'HIGH 0', '',
    ].join('\n'));
    expect(() => submitP6(root)).toThrow(/HIGH 0.*1 HIGH/);
  });

  it('E36: 대소문자와 덧붙인 글자로 HIGH 를 숨기지 못한다', () => {
    const root = fresh();
    round(root, 1, { findings: [row('A-1', 'high'), row('A-2', 'HIGH (provisional)')], high: 0 });
    expect(() => submitP6(root)).toThrow(/HIGH 0.*2 HIGH/);
  });

  it('`Medium` 은 MED 로 읽어 HIGH 로 세지 않는다', () => {
    const root = fresh();
    round(root, 1, { findings: [row('A-1', 'Medium')] });
    reconcile(root, 1, ['| A-1 | MED | not accepted | — | wording |']);
    expect(submitP6(root).status).toBe('submitted');
  });
});

describe('M2: 전체 회차도 앞 회차의 HIGH 를 다룬다', () => {
  it('E35: 언급하지 않은 전체 회차는 거부한다', () => {
    const root = fresh();
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | not accepted | — | the fixer disagrees |']);
    round(root, 2);
    expect(() => submitP6(root)).toThrow(/does not mention.*HIGH-1/);
  });

  it('언급하면 통과한다', () => {
    const root = fresh();
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | not accepted | — | the fixer disagrees: 03-feature.md:1 |']);
    round(root, 2, { extra: 'HIGH-1: the reason holds at 03-feature.md:1.' });
    expect(submitP6(root).status).toBe('submitted');
  });
});

describe('M4: 상한은 재고정된 값만 믿는다', () => {
  const fourFull = (root: string): void => {
    for (const n of [1, 2, 3, 4]) round(root, n);
  };

  it('E13: 기준선과 다른 상한은 기본값 3 을 쓰고 거부한다', () => {
    const root = fresh();
    pinPolicy(root, 'init');
    fs.appendFileSync(path.join(root, '.harness/config.yaml'), '\naudit_full_round_cap: 9\n');
    fourFull(root);
    const s = auditStatus(root);
    expect(s.cap).toBe(3);
    expect(s.violations.join('\n')).toMatch(/re-pins|accept-policy/);
    expect(() => submitP6(root)).toThrow(/accept-policy/);
  });

  it('기준선이 없어도 믿지 않는다', () => {
    const root = fresh();
    fs.appendFileSync(path.join(root, '.harness/config.yaml'), '\naudit_full_round_cap: 9\n');
    expect(auditStatus(root).cap).toBe(3);
  });

  it('오너가 재고정하면 그 값을 쓴다', () => {
    const root = fresh();
    pinPolicy(root, 'init');
    fs.appendFileSync(path.join(root, '.harness/config.yaml'), '\naudit_full_round_cap: 4\n');
    pinPolicy(root, 'accept');
    fourFull(root);
    expect(auditStatus(root).cap).toBe(4);
    expect(submitP6(root).status).toBe('submitted');
  });

  it('상한과 무관한 정책 변경은 감사 판정을 막지 않는다', () => {
    const root = fresh();
    pinPolicy(root, 'init');
    fs.appendFileSync(path.join(root, '.harness/config.yaml'), '\nblock_raw_values: true\n');
    round(root, 1);
    expect(auditStatus(root).violations).toEqual([]);
  });
});

describe('D8 · M5: 시험 전환 HIGH 는 적합성 감사로만 닫힌다', () => {
  const moved = (root: string): void => {
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | test-transfer | F-3 acceptance criterion | only a run shows the race |']);
    round(root, 2, { kind: 'short', extra: '## Classification check\n| Item | Verdict | Why |\n|---|---|---|\n| HIGH-1 | upheld | needs a run |' });
  };
  const token = 'AUD-r1-HIGH-1';
  const conformance = (root: string, n: number, result: string): void =>
    write(root, `.harness/audit/conformance-r${n}.md`, `| Invariant | Result | Where |\n|---|---|---|\n| ${token} the race | ${result} | src/a.ts:3 |\n\nHIGH 0\n`);

  it('E12: 표식을 담은 웨이브를 완료해도 닫히지 않는다', () => {
    const root = fresh();
    moved(root);
    const w = createWave(root, { milestone: 'M-1', goal: 'cover it', acceptance: [`${token} race covered`], design_refs: [] });
    activateWave(root, w.id);
    logTurn(root, 'done');
    completeWave(root);
    expect(carryItemGaps(root).map(c => c.token)).toEqual([token]);
    expect(shipVerdict(root).reasons.join('\n')).toContain(token);
    expect(renderRtm(root)).toMatch(/not marked holds/);
  });

  it('최신 적합성 감사에 holds 로 적히면 닫힌다', () => {
    const root = fresh();
    moved(root);
    conformance(root, 1, 'holds');
    expect(carryItemGaps(root)).toEqual([]);
    expect(shipVerdict(root).reasons.join('\n')).not.toContain(token);
  });

  it('`breaks` 나 더 새 회차의 `breaks` 는 닫지 못한다', () => {
    const root = fresh();
    moved(root);
    conformance(root, 1, 'breaks');
    expect(carryItemGaps(root).map(c => c.token)).toEqual([token]);
    conformance(root, 1, 'holds');
    conformance(root, 2, 'breaks');
    expect(carryItemGaps(root).map(c => c.token)).toEqual([token]);
  });

  it('시험 전환 MED 는 지금처럼 웨이브 수용 기준으로 닫힌다', () => {
    const root = fresh();
    round(root, 1, { findings: [row('MED-1', 'MED')] });
    reconcile(root, 1, ['| MED-1 | MED | test-transfer | P9 check | timing needs a run |']);
    const w = createWave(root, { milestone: 'M-1', goal: 'cover it', acceptance: ['AUD-r1-MED-1 covered'], design_refs: [] });
    activateWave(root, w.id);
    logTurn(root, 'done');
    completeWave(root);
    expect(carryItemGaps(root)).toEqual([]);
  });

  it('L6: 적합성 처리표 이름은 P6 처리표와 겹치지 않는다', () => {
    const root = fresh();
    round(root, 1);
    write(root, '.harness/audit/conformance-reconcile-r1.md', '| CONF-1 | HIGH | carried | F-3 | x |\n');
    expect(auditStatus(root).carryItems).toEqual([]);
    expect(auditStatus(root).violations).toEqual([]);
  });
});

describe('D9: 상한 전에도 위험 수용을 고를 수 있다', () => {
  it('첫 회차의 수용 행으로 제출하고, 효력은 승인에서 생긴다', () => {
    const root = fresh();
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | owner-accepted | — | the owner takes this until v2 |']);
    expect(submitP6(root).status).toBe('submitted');
    expect(buildReviewPacket(root, 'P6')).toContain('the owner takes this until v2');
    expect(readEvents(root).some(e => 'auditAcceptedHighs' in e.data)).toBe(false);
    approveGate(root, 'P6', 'slash');
    expect(readEvents(root).find(e => e.type === 'gate-approved')?.data.auditAcceptedHighs).toHaveLength(1);
  });

  it('사유 없는 수용은 여전히 거부한다', () => {
    const root = fresh();
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | owner-accepted | — | |']);
    expect(() => submitP6(root)).toThrow(/without a reason/);
  });
});

describe('M6: 재확인 절은 실제 오너 결정을 가리켜야 한다', () => {
  const recheck = (line: string): string => `## Owner re-check needed\n${line}`;

  it('E30: 참조 없는 항목은 열린 HIGH 로 센다', () => {
    const root = fresh();
    round(root, 1, { extra: recheck('- the owner decided X, and that loses data at 05-contract.md:9') });
    const s = auditStatus(root);
    expect(s.openHighs.join('\n')).toMatch(/re-check/);
    expect(() => submitP6(root)).toThrow(/re-check/);
  });

  it('처리표에 없는 결정을 가리키면 열린 HIGH 로 센다', () => {
    const root = fresh();
    round(root, 1, { extra: recheck('- r9/RC-7: loses data') });
    expect(auditStatus(root).openHighs).toHaveLength(1);
  });

  it('오너 결정이 아닌 행을 가리키면 열린 HIGH 로 센다', () => {
    const root = fresh();
    round(root, 1, { findings: [row('MED-1', 'MED')] });
    reconcile(root, 1, ['| MED-1 | MED | not accepted | — | wording |']);
    round(root, 2, { kind: 'short', extra: recheck('- r1/MED-1: loses data') });
    expect(auditStatus(root).openHighs).toHaveLength(1);
  });

  it('실제 결정을 가리키면 HIGH 로 세지 않고, `none` 은 항목이 아니다', () => {
    const root = fresh();
    round(root, 1, { extra: '## Reversal conflicts\n| RC-1 | a | b |' });
    reconcile(root, 1, ['| RC-1 | CONFLICT | owner-decided | 05-contract.md:9 [r1] | keep the row |']);
    round(root, 2, { kind: 'short', extra: recheck('- r1/RC-1: this may lose data at 05-contract.md:9') });
    expect(auditStatus(root).openHighs).toEqual([]);
    const other = fresh();
    round(other, 1, { extra: recheck('- none') });
    expect(auditStatus(other).openHighs).toEqual([]);
  });
});

describe('L3: 감사자가 받는 것은 코드가 만든 한 벌이다', () => {
  it('처리표에서 닫힌 결정과 반영 대조를 그대로 낸다', () => {
    const root = fresh();
    round(root, 1, { findings: [row('HIGH-1', 'HIGH'), row('MED-1', 'MED')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | accepted | F-3 [r1] | |', '| MED-1 | MED | test-transfer | P9 check | needs a run |'],
      '## Application check\n| Item | Sentence | Result |\n|---|---|---|\n| HIGH-1.1 | first | missing |');
    const c = auditClosedItems(root);
    expect(c.closed.map(x => x.id)).toEqual(['HIGH-1']);
    expect(c.moved.map(x => x.id)).toEqual(['MED-1']);
    expect(c.applicationCheck.join('\n')).toContain('missing');
    expect(JSON.stringify(c)).not.toContain('what is wrong');
  });

  it('`harness audit closed` 로 읽는다', () => {
    const root = fresh();
    round(root, 1);
    const r = capture(() => run(['audit', 'closed'], root));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.text)).toEqual({ closed: [], moved: [], applicationCheck: [] });
  });
});

describe('L4: 예전 형식 최신 회차의 위험 수용', () => {
  const old = (root: string): void => write(root, '.harness/audit/audit-r3.md', '# Old round\n\nHIGH 2\n');

  it('E32: 끝 줄의 HIGH 수만큼 수용 행이 있으면 제출할 수 있고 승인 묶음에 보인다', () => {
    const root = older();
    old(root);
    reconcile(root, 3, ['| R3-H1 | HIGH | owner-accepted | — | owner took it |', '| R3-H2 | HIGH | owner-accepted | — | owner took this too |']);
    expect(submitP6(root).status).toBe('submitted');
    expect(auditStatus(root).acceptedHighs.map(a => a.id)).toEqual(['R3-H1', 'R3-H2']);
    expect(buildReviewPacket(root, 'P6')).toContain('owner took this too');
  });

  it('수가 모자라면 거부한다', () => {
    const root = older();
    old(root);
    reconcile(root, 3, ['| R3-H1 | HIGH | owner-accepted | — | owner took it |']);
    expect(() => submitP6(root)).toThrow(/HIGH 2/);
  });
});

describe('L5: 기존 근거 표기', () => {
  it('설계 문서 번호와 줄(`02:42`)을 근거로 받는다', () => {
    expect(hasCheckableEvidence('02:42')).toBe(true);
    expect(hasCheckableEvidence('02:42(M-3.1)')).toBe(true);
    expect(hasCheckableEvidence('at 12:30')).toBe(false);
    expect(hasCheckableEvidence('2026-11-07 09:30:15')).toBe(false);
  });
});

describe('2차 대조: H1-2 회차 번호는 1 부터다', () => {
  for (const name of ['audit-r0.md', 'audit-r00.md', 'audit-r01.md']) {
    it(`${name} 은 예전 회차로 읽지 않고 거부한다`, () => {
      const root = fresh();
      write(root, `.harness/audit/${name}`, `# Round zero\n\n## Findings\n${TABLE.join('\n')}\n${row('HIGH-1', 'HIGH')}\n\nHIGH 0\n`);
      const s = auditStatus(root);
      expect(s.rounds).toEqual([]);
      expect(s.violations.join('\n')).toContain(name);
      expect(() => submitGate(root, 'P6', { evidence: 'claimed', paths: ['docs/design.md', `.harness/audit/${name}`] })).toThrow(/round numbers start at 1/);
    });
  }

  it('정상 회차가 있어도 0 번 파일을 지나치지 않는다', () => {
    const root = fresh();
    round(root, 1);
    write(root, '.harness/audit/audit-r0.md', '# Zero\n\nHIGH 0\n');
    expect(() => submitP6(root)).toThrow(/round numbers start at 1/);
  });

  it('처리표에도 같은 번호 규칙을 적용한다', () => {
    const root = fresh();
    round(root, 1);
    write(root, '.harness/audit/reconcile-r0.md', '| HIGH-1 | HIGH | owner-accepted | — | hidden |\n');
    expect(auditStatus(root).violations.join('\n')).toContain('reconcile-r0.md');
  });
});

describe('2차 대조: M-2 상한 불일치는 실제로 넘을 때만 막는다', () => {
  const drifted = (): string => {
    const root = fresh();
    fs.appendFileSync(path.join(root, '.harness/config.yaml'), '\naudit_full_round_cap: 5\n');
    pinPolicy(root, 'accept');
    fs.appendFileSync(path.join(root, '.harness/config.yaml'), '\nblock_raw_values: true\n');
    return root;
  };

  it('기본값 안이면 위반 없이 기본값을 쓴다', () => {
    const root = drifted();
    round(root, 1);
    const s = auditStatus(root);
    expect(s).toMatchObject({ cap: 3, violations: [], next: 'ready' });
    expect(loadConfig(root).audit_full_round_cap).toBe(5);
    expect(submitP6(root).status).toBe('submitted');
  });

  it('기본값을 넘으면 재고정을 요구한다', () => {
    const root = drifted();
    for (const n of [1, 2, 3, 4]) round(root, n);
    expect(() => submitP6(root)).toThrow(/accept-policy/);
  });

  it('상한에 닿아도 넘지 않으면 HIGH 를 고칠 길이 막히지 않는다', () => {
    const root = drifted();
    for (const n of [1, 2, 3]) round(root, n);
    expect(auditStatus(root)).toMatchObject({ cap: 3, capReached: true, violations: [] });
  });
});

describe('2차 대조: M-3 재확인 참조 표기', () => {
  const closedRC = (root: string): void => {
    round(root, 1, { extra: '## Reversal conflicts\n| RC-1 | a | b |' });
    reconcile(root, 1, ['| RC-1 | CONFLICT | owner-decided | 05-contract.md:9 [r1] | keep the row |']);
  };
  for (const line of ['- r1/RC-1: why', '- `r1/RC-1`: why', '- (r1/RC-1) why', '- r1/RC-1. why', '- see r1/`RC-1` here']) {
    it(`${line} 는 처리표의 행을 찾는다`, () => {
      const root = fresh();
      closedRC(root);
      round(root, 2, { kind: 'short', extra: `## Owner re-check needed\n${line}` });
      expect(auditStatus(root).openHighs).toEqual([]);
    });
  }

  it('감사자 출력 형식 예시 그대로', () => {
    const root = fresh();
    closedRC(root);
    round(root, 2, { kind: 'short', extra: '## Owner re-check needed\n- r1/RC-1: this owner decision seems to create a risk, 05-contract.md:9' });
    expect(auditStatus(root).openHighs).toEqual([]);
  });

  it('감싸도 처리표에 없으면 열린 HIGH 다', () => {
    const root = fresh();
    closedRC(root);
    round(root, 2, { kind: 'short', extra: '## Owner re-check needed\n- `r1/RC-9`: why' });
    expect(auditStatus(root).openHighs).toHaveLength(1);
  });
});

describe('2차 대조: L-1 doctor 는 판의 유실을 본다', () => {
  it('저널에 있는 판이 state 에서 사라지면 발산이고, 복구가 되살린다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-adv-'));
    capture(() => run(['init'], root));
    expect(runDoctor(root).issues).toEqual([]);
    const { auditFormat: _drop, ...state } = readState(root);
    writeState(root, state);
    expect(runDoctor(root).issues.join('\n')).toContain('auditFormat');
    runDoctor(root, { repair: true });
    expect(readState(root).auditFormat).toEqual({ version: 1, legacyThrough: 0 });
  });

  it('판을 적기 전의 기존 프로젝트는 발산이 아니다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-adv-'));
    capture(() => run(['init'], root));
    fs.writeFileSync(path.join(root, '.harness/events.jsonl'), '');
    const { auditFormat: _drop, ...state } = readState(root);
    writeState(root, state);
    expect(runDoctor(root).issues.join('\n')).not.toContain('auditFormat');
  });
});

describe('2차 대조: L-3 적합성 판정은 표식별 최신 값이다', () => {
  const token = 'AUD-r1-HIGH-1';
  const moved = (root: string): void => {
    round(root, 1, { findings: [row('HIGH-1', 'HIGH')] });
    reconcile(root, 1, ['| HIGH-1 | HIGH | test-transfer | F-3 acceptance criterion | only a run shows the race |']);
    round(root, 2, { kind: 'short', extra: '## Classification check\n| Item | Verdict | Why |\n|---|---|---|\n| HIGH-1 | upheld | needs a run |' });
  };
  const conf = (root: string, n: number, body: string): void => write(root, `.harness/audit/conformance-r${n}.md`, `${body}\n\nHIGH 0\n`);

  it('더 새 파일이 표식을 적지 않아도 앞 판정이 남는다', () => {
    const root = fresh();
    moved(root);
    conf(root, 1, `| ${token} | holds | src/a.ts:3 |`);
    conf(root, 2, '| other invariant | holds | src/b.ts:3 |');
    expect(carryItemGaps(root)).toEqual([]);
  });

  it('더 새 `breaks` 는 앞의 `holds` 를 덮고, 그 뒤의 `holds` 가 다시 닫는다', () => {
    const root = fresh();
    moved(root);
    conf(root, 1, `| ${token} | holds | src/a.ts:3 |`);
    conf(root, 2, `| ${token} | breaks | src/a.ts:9 |`);
    expect(carryItemGaps(root).map(c => c.token)).toEqual([token]);
    conf(root, 10, `| ${token} | holds | src/a.ts:12 |`);
    expect(carryItemGaps(root)).toEqual([]);
  });

  it('표식이 없는 적합성 파일만으로는 닫히지 않는다', () => {
    const root = fresh();
    moved(root);
    conf(root, 1, '| other invariant | holds | src/b.ts:3 |');
    expect(carryItemGaps(root).map(c => c.token)).toEqual([token]);
  });
});

describe('2차 대조: L-5 시각은 근거가 아니다', () => {
  it.each(['2026-11-07 03:15 run', '2026-11-07T03:15', 'T12:30', '2026-11-07T12:30:15', '00:00', '1-03:15', '103:15', '03:15:20'])('%s 는 받지 않는다', (e) => {
    expect(hasCheckableEvidence(e)).toBe(false);
  });
  it.each(['02:42', '02:42(M-3.1)', '03:15', 'see 05:120', 'src/T12:30', 'core/src/a.ts:12', '.harness/design/03-feature.md:88'])('%s 는 받는다', (e) => {
    expect(hasCheckableEvidence(e)).toBe(true);
  });
});
