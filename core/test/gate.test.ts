import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState } from '../src/state';
import { readEvents } from '../src/events';
import { statePath } from '../src/paths';
import { upsertDoc } from '../src/registry';
import {
  computeArtifactHash, submitGate, approveGate, verifyGate,
  invalidateStaleGates, canEnterPhase, setPhaseViaGate, MIN_SUBSTANCE_CHARS,
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

/**
 * 실질성 검사를 통과하는 본문. 태그가 내용을 갈라 게이트마다 다른 해시가 나온다 —
 * 「같은 산출물로 두 게이트」를 픽스처가 우연히 만들지 않게.
 */
const body = (tag: string) => `# ${tag}\n\n`
  + `This document is the ${tag} artifact submitted for gate review. `
  + 'It states the decision, the reasoning behind it, and the consequences the team accepts.\n';

/** 게이트 하나를 승인 상태까지 올린다 — 전환 규칙 테스트의 공통 준비. */
const approved = (root: string, phase: Parameters<typeof approveGate>[1], rel = 'docs/a.md') => {
  writeDoc(root, rel, body(`${phase} 산출물`));
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
    writeDoc(root, 'docs/a.md', body('A'));
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
    writeDoc(root, 'docs/a.md', body('A'));
    expect(() => submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: '측정됨' as never }))
      .toThrow(/근거 등급/);
  });

  it('승인된 게이트 재제출은 submitted 로 재개방하며 직전 상태를 이벤트에 남긴다', () => {
    const root = setup();
    approved(root, 'P0');
    writeDoc(root, 'docs/a.md', body('P0 산출물 개정'));
    const rec = submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'claimed' });

    expect(rec.status).toBe('submitted');
    expect(rec.approvedAt).toBeUndefined();
    expect(readEvents(root).at(-1)!.data.prevStatus).toBe('approved');
  });

  it('변이 순서 계약: writeState 가 실패해도 이벤트는 저널에 남는다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('A'));
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
    writeDoc(root, 'docs/a.md', body('A'));
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
    writeDoc(root, 'docs/a.md', body('A'));
    submitGate(root, 'P4', { paths: ['docs/a.md'], evidence: 'claimed' });
    expect(approveGate(root, 'P4').status).toBe('approved');
  });

  it('출하 트랙(P10·P11·P12)은 measured 아닌 근거를 거부한다 (Iron Rule)', () => {
    for (const phase of ['P10', 'P11', 'P12'] as const) {
      for (const evidence of ['claimed', 'code'] as const) {
        const root = setup();
        writeDoc(root, 'docs/a.md', body('A'));
        submitGate(root, phase, { paths: ['docs/a.md'], evidence });
        expect(() => approveGate(root, phase)).toThrow(/measured/);
        expect(readState(root).gates[phase]?.status).toBe('submitted');
      }
    }
  });

  it('출하 트랙도 measured 면 통과', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('A'));
    submitGate(root, 'P10', { paths: ['docs/a.md'], evidence: 'measured' });
    expect(approveGate(root, 'P10').status).toBe('approved');
  });

  it('제출 후 산출물이 바뀌면 승인 거부 — 재제출을 안내한다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('A'));
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'code' });
    writeDoc(root, 'docs/a.md', 'A 몰래 개정');
    expect(() => approveGate(root, 'P0')).toThrow(/제출 이후 변경/);
    expect(readState(root).gates.P0?.status).toBe('submitted');
  });

  it('저널에 남은 심사 경로 그대로 재계산한다 — 승인 시 인자를 다시 받지 않는다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('A'));
    writeDoc(root, 'docs/b.md', body('B'));
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
    writeDoc(root, 'docs/a.md', body('A'));
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
    writeDoc(root, 'docs/a.md', body('A'));
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
    writeDoc(root, 'docs/a.md', body('A'));
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

// ─────────────────────────────────────────────────────────────────────────────
// SEC-75: 게이트가 산출물의 «내용·구별성»을 검사한다.
// 측정된 결함: 2바이트 파일 한 장으로 12게이트를 전부 열 수 있었다. 여기서는 막아야 할 것과
// **막으면 안 되는 것**을 같은 무게로 잰다 — 정당한 소규모 산출물을 막으면 사람이 하네스를 끈다.
// ─────────────────────────────────────────────────────────────────────────────

/** 이 리포의 최소 실 산출물(213자)보다 작지만 진짜인 ADR — 과차단 기준선. */
const SHORT_ADR = '# ADR-3: Journal format\n\n'
  + '## Context\nThe harness must stay deterministic offline.\n\n'
  + '## Decision\nAppend-only JSONL, not SQLite.\n\n'
  + '## Consequences\nReads are linear; fine under a few thousand rows.\n';

describe('SEC-75 최소 실질성 — 게이트는 «파일이 있다»로 열리지 않는다', () => {
  it('빈 파일은 제출 불가 — 경로를 지목한다', () => {
    const root = setup();
    writeDoc(root, 'docs/x.md', '');
    expect(() => submitGate(root, 'P0', { paths: ['docs/x.md'], evidence: 'code' }))
      .toThrow(/docs\/x\.md/);
  });

  it('공백만 있는 파일도 빈 파일과 같다', () => {
    const root = setup();
    writeDoc(root, 'docs/x.md', '   \n\n\t\n');
    expect(() => submitGate(root, 'P0', { paths: ['docs/x.md'], evidence: 'code' })).toThrow();
  });

  it('2바이트 파일은 제출 불가 — 측정된 결함 그 자체', () => {
    const root = setup();
    writeDoc(root, 'docs/x.md', 'ok');
    expect(() => submitGate(root, 'P0', { paths: ['docs/x.md'], evidence: 'measured' }))
      .toThrow(new RegExp(String(MIN_SUBSTANCE_CHARS)));
  });

  it('출하 트랙도 같다 — 2바이트 measured 로 P10 을 열 수 없다', () => {
    const root = setup();
    writeDoc(root, 'docs/x.md', 'ok');
    expect(() => submitGate(root, 'P10', { paths: ['docs/x.md'], evidence: 'measured' })).toThrow();
    expect(readState(root).gates.P10).toBeUndefined();
  });

  it('길이만 채운 자리표시자는 거부 — TODO·TBD·FIXME 로 도배', () => {
    const root = setup();
    writeDoc(root, 'docs/x.md', '# TODO\n\n' + '- TODO\n- TBD\n- FIXME\n'.repeat(12));
    expect(() => submitGate(root, 'P0', { paths: ['docs/x.md'], evidence: 'code' }))
      .toThrow(/자리표시자|placeholder/);
  });

  it('한국어 자리표시자도 같이 거부한다', () => {
    const root = setup();
    writeDoc(root, 'docs/x.md', '# (미지정)\n\n' + '- 미정\n- 추후\n- TBD\n'.repeat(12));
    expect(() => submitGate(root, 'P0', { paths: ['docs/x.md'], evidence: 'code' }))
      .toThrow(/자리표시자|placeholder/);
  });

  it('거부하면 상태도 저널도 변하지 않는다', () => {
    const root = setup();
    writeDoc(root, 'docs/x.md', 'ok');
    expect(() => submitGate(root, 'P0', { paths: ['docs/x.md'], evidence: 'code' })).toThrow();
    expect(readState(root).gates.P0).toBeUndefined();
    expect(readEvents(root)).toEqual([]);
  });

  // ── 과차단 방지 ────────────────────────────────────────────────────────────
  it('과차단 금지: 짧지만 진짜인 ADR 은 통과한다', () => {
    const root = setup();
    writeDoc(root, 'docs/adr-3.md', SHORT_ADR);
    expect(submitGate(root, 'P2', { paths: ['docs/adr-3.md'], evidence: 'code' }).status)
      .toBe('submitted');
  });

  it('과차단 금지: 판정은 집합 전체 — 큰 문서에 작은 색인이 섞여도 통과', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('concept'));
    writeDoc(root, 'docs/index.md', 'See a.md\n');
    expect(submitGate(root, 'P0', { paths: ['docs/a.md', 'docs/index.md'], evidence: 'code' }).status)
      .toBe('submitted');
  });

  it('과차단 금지: 바이너리 산출물(PNG 캡처)도 산출물이다', () => {
    const root = setup();
    const abs = path.join(root, 'docs/shot.png');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(Array.from({ length: 600 }, (_, i) => i % 256)),
    ]));
    expect(submitGate(root, 'P9', { paths: ['docs/shot.png'], evidence: 'measured' }).status)
      .toBe('submitted');
  });

  it('과차단 금지: 글자가 한 톨도 없는 바이너리 증적도 통과한다 — 자리표시자 규칙이 물면 안 된다', () => {
    const root = setup();
    const abs = path.join(root, 'docs/blob.bin');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // 라틴 문자·숫자가 전혀 없는 바이트열(0x80~0xFF). utf8 로 읽으면 전부 대체문자가 되고,
    // 대체문자는 \p{L} 도 \p{N} 도 아니다 — 잔여가 비어 「자리표시자뿐」으로 오판되기 쉽다.
    fs.writeFileSync(abs, Buffer.from(Array.from({ length: 400 }, (_, i) => 0x80 + (i % 128))));
    expect(submitGate(root, 'P9', { paths: ['docs/blob.bin'], evidence: 'measured' }).status)
      .toBe('submitted');
  });

  it('과차단 금지: 정당하게 짧은 한국어 문단 3문장(공백 제외 91자)이 통과한다 — 임계를 고정하는 시금석', () => {
    const root = setup();
    // 이 문단이 임계 근거 그 자체다. 처음 잡았던 120자는 **이것을 막았다**.
    // 바이트로 세면 273바이트라, 바이트 임계는 언어마다 다른 분량을 요구하게 된다.
    const ko = '# 설계\n\n'
      + '모듈 경계와 의존 그래프를 여기서 확정한다. 각 모듈은 인터페이스로만 서로를 알고, '
      + '공유 상태는 두지 않는다. 이 결정의 대가는 초기 배선 비용이며, 그 대신 한 모듈의 '
      + '변경이 다른 모듈의 테스트를 깨지 않는다.\n';
    expect(ko.replace(/\s/g, '').length).toBe(91);
    expect(ko.replace(/\s/g, '').length).toBeGreaterThanOrEqual(MIN_SUBSTANCE_CHARS);
    writeDoc(root, 'docs/ko.md', ko);
    expect(submitGate(root, 'P0', { paths: ['docs/ko.md'], evidence: 'code' }).status)
      .toBe('submitted');
  });

  it('과차단 금지: 임계는 이 리포의 최소 실 산출물(213자)보다 낮다 — 실측 하한을 막지 않는다', () => {
    expect(MIN_SUBSTANCE_CHARS).toBeLessThan(213);
  });
});

describe('SEC-75 구별성 — 산출물 한 장이 여러 게이트를 열 수 없다', () => {
  it('같은 해시로 다른 게이트를 열 수 없다 — 이미 쓴 게이트를 지목한다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('concept'));
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'measured' });
    approveGate(root, 'P0');
    expect(() => submitGate(root, 'P1', { paths: ['docs/a.md'], evidence: 'measured' }))
      .toThrow(/P0/);
  });

  it('한 장으로 전 게이트를 여는 경로가 닫혔다 — P0 하나만 열린다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('concept'));
    const opened: string[] = [];
    for (const phase of ['P0', 'P1', 'P2', 'P3'] as const) {
      try {
        submitGate(root, phase, { paths: ['docs/a.md'], evidence: 'measured' });
        approveGate(root, phase);
        opened.push(phase);
      } catch { /* 막히는 것이 정상 */ }
    }
    expect(opened).toEqual(['P0']);
  });

  it('제출만 된 게이트의 해시도 다른 게이트를 막는다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('concept'));
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'code' });
    expect(() => submitGate(root, 'P1', { paths: ['docs/a.md'], evidence: 'code' })).toThrow(/P0/);
  });

  // ── 과차단 방지 ────────────────────────────────────────────────────────────
  it('과차단 금지: 같은 게이트 재제출은 같은 해시라도 허용 (개정 루프)', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('concept'));
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'claimed' });
    expect(submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'code' }).evidence).toBe('code');
  });

  it('과차단 금지: 내용이 개정되면 다음 페이즈가 다시 심사할 수 있다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('concept'));
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'measured' });
    approveGate(root, 'P0');
    writeDoc(root, 'docs/a.md', `${body('concept')}\n## Domains\nOrders, Billing, Identity.\n`);
    expect(submitGate(root, 'P1', { paths: ['docs/a.md'], evidence: 'measured' }).status)
      .toBe('submitted');
  });

  it('과차단 금지: 이전 산출물에 새 문서를 더한 상위집합은 통과', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('concept'));
    writeDoc(root, 'docs/b.md', body('domain'));
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'measured' });
    approveGate(root, 'P0');
    expect(submitGate(root, 'P1', { paths: ['docs/a.md', 'docs/b.md'], evidence: 'measured' }).status)
      .toBe('submitted');
  });

  it('과차단 금지: 무효화된 게이트의 해시는 더 이상 막지 않는다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('concept'));
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'code' });
    // 산출물이 사라지면 P0 는 무효화된다 — 되돌려 놓으면 그 해시는 자유로워야 한다
    fs.rmSync(path.join(root, 'docs/a.md'));
    invalidateStaleGates(root);
    writeDoc(root, 'docs/a.md', body('concept'));
    expect(submitGate(root, 'P1', { paths: ['docs/a.md'], evidence: 'code' }).status)
      .toBe('submitted');
  });
});

describe('SEC-75 구별성 우회 — 같은 파일을 다르게 «적어서» 두 번째 게이트를 열 수 없다', () => {
  /** P0 를 열어 둔 샌드박스. 두 번째 게이트를 다른 표기로 노려 본다. */
  const p0Opened = (root: string) => {
    writeDoc(root, 'docs/a.md', body('concept'));
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'measured' });
    approveGate(root, 'P0');
  };

  it('해시는 경로의 «표기»가 아니라 «파일»로 정해진다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('concept'));
    const canonical = computeArtifactHash(root, ['docs/a.md']);
    expect(computeArtifactHash(root, ['./docs/a.md'])).toBe(canonical);
    expect(computeArtifactHash(root, ['docs/../docs/a.md'])).toBe(canonical);
    expect(computeArtifactHash(root, ['.//docs//a.md'])).toBe(canonical);
    expect(computeArtifactHash(root, [path.join(root, 'docs/a.md')])).toBe(canonical);
  });

  it('`./` 를 붙여도 막힌다', () => {
    const root = setup();
    p0Opened(root);
    expect(() => submitGate(root, 'P1', { paths: ['./docs/a.md'], evidence: 'measured' }))
      .toThrow(/P0/);
  });

  it('`..` 로 돌아 들어와도 막힌다', () => {
    const root = setup();
    p0Opened(root);
    expect(() => submitGate(root, 'P1', { paths: ['docs/../docs/a.md'], evidence: 'measured' }))
      .toThrow(/P0/);
  });

  it('절대경로로 적어도 막힌다', () => {
    const root = setup();
    p0Opened(root);
    expect(() => submitGate(root, 'P1', {
      paths: [path.join(root, 'docs/a.md')], evidence: 'measured',
    })).toThrow(/P0/);
  });

  it('심링크로 같은 파일을 가리켜도 막힌다', () => {
    const root = setup();
    p0Opened(root);
    fs.symlinkSync(path.join(root, 'docs/a.md'), path.join(root, 'docs/link.md'));
    expect(() => submitGate(root, 'P1', { paths: ['docs/link.md'], evidence: 'measured' }))
      .toThrow(/P0/);
  });

  it('저널에는 정규화된 경로가 남는다 — 승인·검증이 같은 파일을 다시 본다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('concept'));
    submitGate(root, 'P0', { paths: ['./docs/a.md'], evidence: 'code' });
    expect(readEvents(root).at(-1)!.data.paths).toEqual(['docs/a.md']);
    expect(approveGate(root, 'P0').status).toBe('approved');
  });

  // 경로 표기를 접는 것만으로는 얕다 — 실측: `cp docs/a.md docs/b.md` 한 줄이면 다음 게이트가
  // 열렸다. 구별성은 «경로»가 아니라 «내용»에 걸려야 한다.
  it('내용만 같으면 이름이 달라도 막힌다 — 복사본으로 다음 게이트를 열 수 없다', () => {
    const root = setup();
    p0Opened(root);
    fs.copyFileSync(path.join(root, 'docs/a.md'), path.join(root, 'docs/b.md'));
    expect(() => submitGate(root, 'P1', { paths: ['docs/b.md'], evidence: 'measured' }))
      .toThrow(/P0/);
  });

  it('다른 디렉토리로 옮긴 복사본도 막힌다', () => {
    const root = setup();
    p0Opened(root);
    fs.mkdirSync(path.join(root, 'other'));
    fs.copyFileSync(path.join(root, 'docs/a.md'), path.join(root, 'other/a.md'));
    expect(() => submitGate(root, 'P1', { paths: ['other/a.md'], evidence: 'measured' }))
      .toThrow(/P0/);
  });

  it('같은 내용을 여러 장으로 늘려도 막힌다 — 집합은 내용의 집합이다', () => {
    const root = setup();
    p0Opened(root);
    for (const rel of ['docs/c1.md', 'docs/c2.md']) {
      fs.copyFileSync(path.join(root, 'docs/a.md'), path.join(root, rel));
    }
    expect(() => submitGate(root, 'P1', {
      paths: ['docs/c1.md', 'docs/c2.md'], evidence: 'measured',
    })).toThrow(/P0/);
  });

  it('하드링크도 막힌다 — realpath 가 접지 못하는 계열', () => {
    const root = setup();
    p0Opened(root);
    fs.linkSync(path.join(root, 'docs/a.md'), path.join(root, 'docs/hard.md'));
    expect(() => submitGate(root, 'P1', { paths: ['docs/hard.md'], evidence: 'measured' }))
      .toThrow(/P0/);
  });

  it('과차단 금지: 내용이 실제로 달라지면(한 글자라도) 다음 게이트가 열린다', () => {
    const root = setup();
    p0Opened(root);
    fs.appendFileSync(path.join(root, 'docs/a.md'), '\n## Domains\nOrders, Billing, Identity.\n');
    expect(submitGate(root, 'P1', { paths: ['docs/a.md'], evidence: 'measured' }).status)
      .toBe('submitted');
  });

  it('루트 밖 경로는 여전히 거부된다 (SEC-25 회귀 가드)', () => {
    const root = setup();
    expect(() => submitGate(root, 'P0', { paths: ['../../../etc/passwd'], evidence: 'code' }))
      .toThrow(/프로젝트 안에 있어야 한다|inside the project/);
  });
});

describe('SEC-75 페이즈 적합성 — 레지스트리가 아는 산출물은 제 페이즈에서만', () => {
  const registerDoc = (root: string, id: string, rel: string, phase: 'P0' | 'P5' | 'P6') => {
    upsertDoc(root, { id, phase, path: rel, version: 1, status: 'draft', linkedNodes: [] });
  };

  it('P0 로 등록된 문서로 P5 게이트를 열 수 없다', () => {
    const root = setup();
    writeDoc(root, 'docs/concept.md', body('concept'));
    registerDoc(root, 'DOC-1', 'docs/concept.md', 'P0');
    expect(() => submitGate(root, 'P5', { paths: ['docs/concept.md'], evidence: 'code' }))
      .toThrow(/P0/);
  });

  // ── 과차단 방지 ────────────────────────────────────────────────────────────
  it('과차단 금지: 레지스트리를 안 쓰는 프로젝트는 그대로 통과한다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('spec'));
    expect(submitGate(root, 'P3', { paths: ['docs/a.md'], evidence: 'code' }).status)
      .toBe('submitted');
  });

  it('과차단 금지: 그 페이즈로 등록된 문서는 통과', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body('contract'));
    registerDoc(root, 'DOC-1', 'docs/a.md', 'P5');
    expect(submitGate(root, 'P5', { paths: ['docs/a.md'], evidence: 'code' }).status)
      .toBe('submitted');
  });

  it('과차단 금지: P6 감사는 자기 리포트에 P0~P5 문서를 동반할 수 있다', () => {
    const root = setup();
    writeDoc(root, 'docs/concept.md', body('concept'));
    writeDoc(root, 'docs/audit-r1.md', body('audit'));
    registerDoc(root, 'DOC-1', 'docs/concept.md', 'P0');
    registerDoc(root, 'DOC-6', 'docs/audit-r1.md', 'P6');
    expect(submitGate(root, 'P6', {
      paths: ['docs/concept.md', 'docs/audit-r1.md'], evidence: 'claimed',
    }).status).toBe('submitted');
  });

  /**
   * 적대적 검증이 잡은 **부분 등록 과차단**. 위 「P6 감사」 가드가 통과했던 것은 리포트를
   * 먼저 P6 로 등록해 두기 때문이었다 — 등록 전이면 같은 제출이 막혔다. 레지스트리를
   * 부분적으로 쓰는 상태(가장 흔한 이행 중 상태)가 정확히 그 경우다.
   */
  it('과차단 금지: 아직 등록 안 한 산출물이 섞여 있으면 통과한다', () => {
    const root = setup();
    writeDoc(root, 'docs/concept.md', body('concept'));
    writeDoc(root, 'docs/audit-r1.md', body('audit'));
    registerDoc(root, 'DOC-1', 'docs/concept.md', 'P0');   // 리포트는 **미등록**
    expect(submitGate(root, 'P6', {
      paths: ['docs/concept.md', 'docs/audit-r1.md'], evidence: 'claimed',
    }).status).toBe('submitted');
  });

  it('그래도 막는다: 제출 전부가 등록돼 있고 이 페이즈가 하나도 없으면 차단', () => {
    const root = setup();
    writeDoc(root, 'docs/concept.md', body('concept'));
    writeDoc(root, 'docs/audit-r1.md', body('audit'));
    registerDoc(root, 'DOC-1', 'docs/concept.md', 'P0');
    registerDoc(root, 'DOC-2', 'docs/audit-r1.md', 'P0');
    expect(() => submitGate(root, 'P5', {
      paths: ['docs/concept.md', 'docs/audit-r1.md'], evidence: 'claimed',
    })).toThrow(/P0/);
  });
});
