import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState } from '../src/state';
import { readEvents } from '../src/events';
import { statePath } from '../src/paths';
import {
  computeArtifactHash, submitGate, approveGate, verifyGate,
  invalidateStaleGates, canEnterPhase, setPhaseViaGate,
} from '../src/gate';

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

/** 게이트 하나를 승인 상태까지 올린다 — 전환 규칙 테스트의 공통 준비. */
const approved = (root: string, phase: Parameters<typeof approveGate>[1], rel = 'docs/a.md') => {
  writeDoc(root, rel, `${phase} 산출물`);
  submitGate(root, phase, { paths: [rel], evidence: 'measured' });
  return approveGate(root, phase);
};

describe('computeArtifactHash', () => {
  it('경로 순서와 무관하게 결정적이다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'A');
    writeDoc(root, 'docs/b.md', 'B');
    const h1 = computeArtifactHash(root, ['docs/a.md', 'docs/b.md']);
    const h2 = computeArtifactHash(root, ['docs/b.md', 'docs/a.md']);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('내용이 바뀌면 해시가 바뀐다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'A');
    const before = computeArtifactHash(root, ['docs/a.md']);
    writeDoc(root, 'docs/a.md', 'A 개정');
    expect(computeArtifactHash(root, ['docs/a.md'])).not.toBe(before);
  });

  it('경로가 바뀌면 내용이 같아도 해시가 바뀐다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'same');
    writeDoc(root, 'docs/b.md', 'same');
    expect(computeArtifactHash(root, ['docs/a.md']))
      .not.toBe(computeArtifactHash(root, ['docs/b.md']));
  });

  it('없는 파일은 경로를 밝히며 에러', () => {
    const root = setup();
    expect(() => computeArtifactHash(root, ['docs/없다.md'])).toThrow(/docs\/없다\.md/);
  });
});

describe('submitGate', () => {
  it('해시를 계산해 레코드에 고정하고 저널에 심사 경로를 남긴다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'A');
    const rec = submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'code' });

    expect(rec.status).toBe('submitted');
    expect(rec.evidence).toBe('code');
    expect(rec.artifactHash).toBe(computeArtifactHash(root, ['docs/a.md']));
    expect(rec.submittedAt).toBeTruthy();
    expect(readState(root).gates.P0).toEqual(rec);

    const ev = readEvents(root).at(-1)!;
    expect(ev.type).toBe('gate-submitted');
    expect(ev.data.phase).toBe('P0');
    expect(ev.data.paths).toEqual(['docs/a.md']);
    expect(ev.data.prevStatus).toBe('pending');
  });

  it('심사 대상 경로가 비면 거부', () => {
    expect(() => submitGate(setup(), 'P0', { paths: [], evidence: 'code' }))
      .toThrow(/심사 대상 산출물이 없다/);
  });

  it('없는 산출물은 제출 불가 — 상태도 저널도 변하지 않는다', () => {
    const root = setup();
    expect(() => submitGate(root, 'P0', { paths: ['docs/없다.md'], evidence: 'code' }))
      .toThrow(/docs\/없다\.md/);
    expect(readState(root).gates.P0).toBeUndefined();
    expect(readEvents(root)).toEqual([]);
  });

  it('열거형 밖 근거 등급은 거부', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'A');
    expect(() => submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: '측정됨' as never }))
      .toThrow(/근거 등급/);
  });

  it('승인된 게이트 재제출은 submitted 로 재개방하며 직전 상태를 이벤트에 남긴다', () => {
    const root = setup();
    approved(root, 'P0');
    writeDoc(root, 'docs/a.md', 'P0 산출물 개정');
    const rec = submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'claimed' });

    expect(rec.status).toBe('submitted');
    expect(rec.approvedAt).toBeUndefined();
    expect(readEvents(root).at(-1)!.data.prevStatus).toBe('approved');
  });

  it('변이 순서 계약: writeState 가 실패해도 이벤트는 저널에 남는다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'A');
    // tmp 파일 자리에 디렉토리 → writeState 의 writeFileSync 만 실패한다(readState 는 정상)
    fs.mkdirSync(`${statePath(root)}.tmp-${process.pid}`);
    expect(() => submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'code' })).toThrow();
    expect(readEvents(root).map(e => e.type)).toEqual(['gate-submitted']);
    expect(readState(root).gates.P0).toBeUndefined();
  });
});

describe('approveGate', () => {
  it('제출되지 않은 게이트는 승인 불가 — submit 을 안내한다', () => {
    expect(() => approveGate(setup(), 'P0')).toThrow(/harness gate submit P0/);
  });

  it('이미 승인된 게이트는 다시 승인 불가', () => {
    const root = setup();
    approved(root, 'P0');
    expect(() => approveGate(root, 'P0')).toThrow(/승인할 수 있는 상태가 아니다/);
  });

  it('승인은 approvedAt 을 붙이고 해시·근거를 보존한다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'A');
    const submitted = submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'claimed' });
    const rec = approveGate(root, 'P0');

    expect(rec.status).toBe('approved');
    expect(rec.approvedAt).toBeTruthy();
    expect(rec.artifactHash).toBe(submitted.artifactHash);
    expect(rec.evidence).toBe('claimed');
    expect(readState(root).gates.P0).toEqual(rec);
  });

  it('설계 트랙은 claimed 근거로도 통과', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'A');
    submitGate(root, 'P4', { paths: ['docs/a.md'], evidence: 'claimed' });
    expect(approveGate(root, 'P4').status).toBe('approved');
  });

  it('출하 트랙(P10·P11·P12)은 measured 아닌 근거를 거부한다 (Iron Rule)', () => {
    for (const phase of ['P10', 'P11', 'P12'] as const) {
      for (const evidence of ['claimed', 'code'] as const) {
        const root = setup();
        writeDoc(root, 'docs/a.md', 'A');
        submitGate(root, phase, { paths: ['docs/a.md'], evidence });
        expect(() => approveGate(root, phase)).toThrow(/measured/);
        expect(readState(root).gates[phase]?.status).toBe('submitted');
      }
    }
  });

  it('출하 트랙도 measured 면 통과', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'A');
    submitGate(root, 'P10', { paths: ['docs/a.md'], evidence: 'measured' });
    expect(approveGate(root, 'P10').status).toBe('approved');
  });

  it('제출 후 산출물이 바뀌면 승인 거부 — 재제출을 안내한다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'A');
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'code' });
    writeDoc(root, 'docs/a.md', 'A 몰래 개정');
    expect(() => approveGate(root, 'P0')).toThrow(/제출 이후 변경/);
    expect(readState(root).gates.P0?.status).toBe('submitted');
  });

  it('저널에 남은 심사 경로 그대로 재계산한다 — 승인 시 인자를 다시 받지 않는다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'A');
    writeDoc(root, 'docs/b.md', 'B');
    submitGate(root, 'P0', { paths: ['docs/a.md', 'docs/b.md'], evidence: 'code' });
    writeDoc(root, 'docs/b.md', 'B 개정'); // 심사 대상 중 하나만 바뀌어도 걸린다
    expect(() => approveGate(root, 'P0')).toThrow(/제출 이후 변경/);
  });

  it('이벤트가 저널에 제출→승인 순서로 쌓인다', () => {
    const root = setup();
    approved(root, 'P0');
    const evs = readEvents(root);
    expect(evs.map(e => e.type)).toEqual(['gate-submitted', 'gate-approved']);
    expect(evs[1].data.phase).toBe('P0');
    expect(evs[1].data.artifactHash).toBe(readState(root).gates.P0?.artifactHash);
  });
});

describe('verifyGate / invalidateStaleGates', () => {
  it('기록 없는 게이트는 ok=false', () => {
    const v = verifyGate(setup(), 'P0');
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/기록이 없다/);
  });

  it('제출·승인 직후에는 ok=true', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'A');
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'code' });
    expect(verifyGate(root, 'P0')).toEqual({ ok: true });
    approveGate(root, 'P0');
    expect(verifyGate(root, 'P0')).toEqual({ ok: true });
  });

  it('승인 후 산출물 변조를 해시 불일치로 감지', () => {
    const root = setup();
    approved(root, 'P0');
    writeDoc(root, 'docs/a.md', '승인 후 몰래 고침');
    const v = verifyGate(root, 'P0');
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/해시 불일치/);
  });

  it('승인 후 산출물이 사라져도 감지', () => {
    const root = setup();
    approved(root, 'P0');
    fs.rmSync(path.join(root, 'docs/a.md'));
    expect(verifyGate(root, 'P0').ok).toBe(false);
  });

  it('invalidateStaleGates 가 변조된 게이트를 invalidated 로 뒤집는다', () => {
    const root = setup();
    approved(root, 'P0');
    writeDoc(root, 'docs/a.md', '승인 후 몰래 고침');

    expect(invalidateStaleGates(root)).toEqual(['P0']);
    const g = readState(root).gates.P0!;
    expect(g.status).toBe('invalidated');
    expect(g.invalidatedReason).toMatch(/해시 불일치/);

    const ev = readEvents(root).at(-1)!;
    expect(ev.type).toBe('gate-invalidated');
    expect(ev.data.phase).toBe('P0');
    expect(ev.data.prevStatus).toBe('approved');
  });

  it('제출 상태의 게이트도 변조되면 무효화된다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'A');
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'code' });
    writeDoc(root, 'docs/a.md', 'A 개정');
    expect(invalidateStaleGates(root)).toEqual(['P0']);
    expect(readState(root).gates.P0?.status).toBe('invalidated');
  });

  it('멀쩡하면 아무것도 뒤집지 않는다 (저널도 조용)', () => {
    const root = setup();
    approved(root, 'P0');
    const before = readEvents(root).length;
    expect(invalidateStaleGates(root)).toEqual([]);
    expect(readState(root).gates.P0?.status).toBe('approved');
    expect(readEvents(root)).toHaveLength(before);
  });

  it('여러 게이트를 페이즈 순서대로 무효화한다', () => {
    const root = setup();
    approved(root, 'P0', 'docs/p0.md');
    approved(root, 'P1', 'docs/p1.md');
    writeDoc(root, 'docs/p1.md', '개정');
    writeDoc(root, 'docs/p0.md', '개정');
    expect(invalidateStaleGates(root)).toEqual(['P0', 'P1']);
  });

  it('무효화는 멱등 — 두 번째 실행은 아무것도 하지 않는다', () => {
    const root = setup();
    approved(root, 'P0');
    writeDoc(root, 'docs/a.md', '개정');
    invalidateStaleGates(root);
    const before = readEvents(root).length;
    expect(invalidateStaleGates(root)).toEqual([]);
    expect(readEvents(root)).toHaveLength(before);
  });

  it('무효화된 게이트의 verifyGate 는 사유를 되돌려준다', () => {
    const root = setup();
    approved(root, 'P0');
    writeDoc(root, 'docs/a.md', '개정');
    invalidateStaleGates(root);
    const v = verifyGate(root, 'P0');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe(readState(root).gates.P0?.invalidatedReason);
  });
});

describe('canEnterPhase / setPhaseViaGate', () => {
  it('P0 은 언제나 들어갈 수 있다', () => {
    expect(canEnterPhase(setup(), 'P0')).toEqual({ ok: true });
  });

  it('직전 게이트가 승인 전이면 막고 경로를 안내한다', () => {
    const root = setup();
    const v = canEnterPhase(root, 'P1');
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/harness gate approve P0/);
    expect(v.reason).toMatch(/산출물 승인/);
  });

  it('제출만 해서는 다음 페이즈로 못 간다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'A');
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'code' });
    expect(canEnterPhase(root, 'P1').ok).toBe(false);
  });

  it('직전 게이트가 승인되면 통과', () => {
    const root = setup();
    approved(root, 'P0');
    expect(canEnterPhase(root, 'P1')).toEqual({ ok: true });
  });

  it('직전 게이트가 무효화되면 다시 막힌다', () => {
    const root = setup();
    approved(root, 'P0');
    writeDoc(root, 'docs/a.md', '개정');
    invalidateStaleGates(root);
    expect(canEnterPhase(root, 'P1').ok).toBe(false);
  });

  it('건너뛰기 금지 — P0 승인만으로 P2 에 갈 수 없다', () => {
    const root = setup();
    approved(root, 'P0');
    expect(canEnterPhase(root, 'P2').ok).toBe(false);
  });

  it('canEnterPhase 는 판정만 한다 — 페이즈를 옮기지 않는다', () => {
    const root = setup();
    approved(root, 'P0');
    canEnterPhase(root, 'P1');
    expect(readState(root).phase).toBe('P0');
  });

  it('setPhaseViaGate 는 승인된 경우에만 전환하고 phase-set 을 남긴다', () => {
    const root = setup();
    approved(root, 'P0');
    setPhaseViaGate(root, 'P1');
    expect(readState(root).phase).toBe('P1');
    const ev = readEvents(root).at(-1)!;
    expect(ev.type).toBe('phase-set');
    expect(ev.data.phase).toBe('P1');
  });

  it('setPhaseViaGate 는 막힌 이유 그대로 던진다', () => {
    const root = setup();
    expect(() => setPhaseViaGate(root, 'P1')).toThrow(/게이트가 승인되지 않았다/);
    expect(readState(root).phase).toBe('P0');
    expect(readEvents(root)).toEqual([]);
  });
});
