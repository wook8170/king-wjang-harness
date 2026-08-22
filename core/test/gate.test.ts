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
  distinctCharCount, wordCount, submissionSignals,
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
/**
 * 픽스처 문서. **태그만 바꾼 사본이 되면 안 된다** — 게이트는 거의 같은 문서로 다른 게이트를
 * 여는 것을 막으므로(SEC-79 계열), 픽스처도 페이즈마다 실제로 다른 문장을 담아야 한다.
 * 예전 픽스처는 제목만 달랐고, 그것은 이 리포가 실측으로 막기로 한 바로 그 모습이었다.
 */
const TOPIC: Record<string, string> = {
  P0: 'the problem worth solving, the wedge chosen to enter it, and the users who are left unserved today',
  P1: 'the entities of the domain, the invariants each one must hold, and the state transitions the rules permit',
  P2: 'where the module boundaries fall, which ports each module exposes, and what deliberately stays private',
  P3: 'how the feature behaves, every state it can rest in, and the failure paths a user can actually reach',
  P4: 'the design tokens, the full set of component states, and the representative screens assembled from them',
  P5: 'the API contract itself, the error codes callers must handle, and the backward compatibility promised',
  P6: 'the audit of every earlier phase document read against the code that actually shipped, gap by gap',
  P7: 'the build scaffolding, the toolchain pinned for it, and the checks wired into the pipeline itself',
  P8: 'the integration seams between subsystems and the fixtures that keep those seams honest over time',
  P9: 'behaviour under load, the thresholds that decide pass or fail, and exactly how each was measured',
  P10: 'the threat model, the guards standing against it, and every bypass that was actually attempted',
  P11: 'the deployment path end to end, the rollback that undoes it, and what is observed after release',
  P12: 'the ship verdict, the defects still open at that moment, and what is knowingly deferred past release',
  concept: 'why this exists at all and who is left unserved without it',
  domain: 'the entities, their invariants, and which transitions are legal',
  spec: 'the interface, its preconditions, and the errors callers must handle',
  contract: 'the wire format, its compatibility promise, and the deprecation path',
  audit: 'what was re-read against the shipped code and which gaps remain open',
  A: 'the first branch of the fixture tree and the assertions that hang from it',
  B: 'the second branch of the fixture tree, deliberately unlike the first one',
};

const body = (tag: string) => {
  const key = tag.split(' ')[0];
  // 태그마다 **80자 이상 다른** 본문이어야 한다 — 게이트는 이미 심사한 텍스트에 최소치만큼의
  // 새 내용을 얹을 것을 요구하고(SEC-79 계열), 픽스처가 그 잣대를 못 넘으면 규칙이 아니라
  // 픽스처가 거짓말을 한다. 예전 픽스처는 제목만 달랐다.
  const topic = TOPIC[key] ?? `the ${key} decision, the alternatives weighed against it, and the cost accepted`;
  return `# ${tag}\n\nThis document covers ${topic}. `
    + `It records what ${key} settled, which alternatives were rejected and for what reason, and what `
    + `the team accepts as a consequence of ${key}. The evidence sits beside it and is cited by path.\n`;
};

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
    expect(() => setPhaseViaGate(root, 'P1')).toThrow(/승인되지 않았다|not approved/);
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

/**
 * [SEC-79] **실 산출물 0장으로 13게이트가 열렸다** — [SEC-75] 가 2바이트 1장을 닫자
 * 최저가 경로가 「80자짜리 서로 다른 필러 13장」으로 옮겨갔을 뿐 부류는 그대로였다.
 *
 * 여기서 재는 것은 질이 아니라 **구조**다. 그리고 차단 측정은 반드시 「막으면 안 되는 것」과
 * 짝으로 둔다 — 이 리포에서 과차단은 결함과 같은 무게다(사람이 하네스를 꺼 버린다).
 */
describe('SEC-79: 길이만 채운 도배를 구조로 잡는다', () => {
  const PHASES13 = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12'] as const;

  it('원 공격 그대로 — 필러 13장으로 13게이트를 열 수 없다', () => {
    const root = setup();
    let opened = 0;
    PHASES13.forEach((ph, i) => {
      writeDoc(root, `docs/f${i}.md`, 'a'.repeat(80) + String(i));
      try {
        submitGate(root, ph, { paths: [`docs/f${i}.md`], evidence: 'measured' });
        opened++;
      } catch { /* 막히는 것이 정답 */ }
    });
    expect(opened).toBe(0);
  });

  it('거부 문구가 무엇을 셌는지 밝힌다 — 사람이 다음 수를 알 수 있게', () => {
    const root = setup();
    writeDoc(root, 'docs/f.md', 'a'.repeat(120));
    expect(() => submitGate(root, 'P0', { paths: ['docs/f.md'], evidence: 'measured' }))
      .toThrow(/distinct|고유/);
  });

  // ── 막으면 안 되는 것 ──
  const OK: Array<[string, string]> = [
    ['한국어 산문', '이 페이즈의 목표는 사용자가 처음 5분 안에 가치를 보게 하는 것이다. 범위는 온보딩 흐름 하나로 좁힌다. 성공 기준은 첫 세션 완주율이며, 실패 조건은 첫 화면에서의 이탈이다. 다음 페이즈로 넘어가는 조건은 완주율을 실제로 측정해 근거로 붙이는 것이다.'],
    ['일본어(공백 없음)', 'このフェーズの目的は、利用者が最初の五分で価値を体験することである。範囲はオンボーディング導線に絞る。成功基準は初回セッションの完走率とし、失敗条件は最初の画面での離脱とする。'],
    ['중국어(공백 없음)', '本阶段的目标是让用户在最初五分钟内看到价值。范围收敛到单一的新手引导流程。成功标准是首次会话的完成率，失败条件是在第一屏流失。进入下一阶段的条件是完成率的实测。'],
    ['영어 산문', 'The scope of this phase is the onboarding flow. The risk is that users abandon before the first success, so we measure completion of the first session.'],
    ['숫자 위주 표', 'scenario,n,p50,p95\n' + Array.from({ length: 12 }, (_, i) => `row${i},55,${50 + i}.1,${60 + i}.4`).join('\n')],
    ['숫자만(경계 — 고유 10종이지만 낱말이 있다)', '0123456789 '.repeat(20)],
  ];
  it.each(OK)('%s 는 통과한다', (_label, body) => {
    const root = setup();
    writeDoc(root, 'docs/a.md', body);
    expect(() => submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'measured' })).not.toThrow();
  });

  it('바이너리 산출물은 이 규칙의 대상이 아니다 (스크린샷 증적)', () => {
    const root = setup();
    const abs = path.join(root, 'docs', 'shot.png');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 0xab)]));
    expect(() => submitGate(root, 'P0', { paths: ['docs/shot.png'], evidence: 'measured' })).not.toThrow();
  });

  it('두 지표는 AND 다 — 하나만 바닥이면 막지 않는다', () => {
    // 고유 글자는 많지만 낱말이 하나(띄어쓰기 없는 언어의 모습)
    expect(distinctCharCount('가나다라마바사아자차카타파하거너더러머버서어')).toBeGreaterThan(12);
    expect(wordCount('가나다라마바사아자차카타파하거너더러머버서어')).toBe(1);
    // 낱말은 많지만 고유 글자가 적다(숫자 표의 모습)
    expect(wordCount('0123456789 '.repeat(20))).toBe(20);
    expect(distinctCharCount('0123456789 '.repeat(20))).toBe(10);
  });

  it('제출 신호를 잴 수 있다 — 승인자에게 놓을 값', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', 'The scope of this phase is the onboarding flow. The risk is that users '
      + 'abandon before the first success, so we measure completion of the first session.');
    expect(submissionSignals(root, 'P0')).toBeNull();          // 제출 전에는 「없다」
    submitGate(root, 'P0', { paths: ['docs/a.md'], evidence: 'measured' });
    const sig = submissionSignals(root, 'P0')!;
    expect(sig.paths).toHaveLength(1);
    expect(sig.paths[0].rel).toBe('docs/a.md');
    expect(sig.substance).toBeGreaterThan(MIN_SUBSTANCE_CHARS);
    expect(sig.paths[0].missing).toBe(false);
  });
});

/**
 * [SEC-79 계열] 구조 검사를 넣자 최저가 경로가 다시 옮겨갔다 — **진짜처럼 보이는 문서 한 장을
 * 끝 숫자만 바꿔 13장.** 실측으로 13게이트 전건 개통 + `ship verdict` GO 였다.
 * 여기서도 차단과 과차단을 짝으로 고정한다 — 특히 **문서화된 정상 패턴**(P6 총감사가 자기
 * 리포트와 함께 앞 페이즈 산출물을 동반 제출)이 막히면 안 된다.
 */
describe('SEC-79 계열: 거의 같은 문서로 다른 게이트를 열 수 없다', () => {
  const HDR = '# Phase document\n\n> Template header shared by every phase document here.\n'
    + '> Owner: design track. Review: gate. Evidence grade: measured.\n\n';
  const BASE = 'The scope of this phase is the onboarding flow. The risk is that users abandon '
    + 'before the first success, so we measure completion of the first session and record it here.';

  it('한 글자만 바꾼 사본으로는 두 번째 게이트가 열리지 않는다', () => {
    const root = setup();
    writeDoc(root, 'docs/v0.md', `${BASE}0`);
    writeDoc(root, 'docs/v1.md', `${BASE}1`);
    expect(() => submitGate(root, 'P0', { paths: ['docs/v0.md'], evidence: 'measured' })).not.toThrow();
    expect(() => submitGate(root, 'P1', { paths: ['docs/v1.md'], evidence: 'measured' }))
      .toThrow(/has not already reviewed|이미 심사하지 않은/);
  });

  it('원 공격 규모 그대로 — 13장으로는 한 게이트만 열린다', () => {
    const root = setup();
    const phases = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12'] as const;
    let opened = 0;
    phases.forEach((ph, i) => {
      writeDoc(root, `docs/v${i}.md`, `${BASE}${i}`);
      try { submitGate(root, ph, { paths: [`docs/v${i}.md`], evidence: 'measured' }); opened++; } catch { /* 기대 */ }
    });
    expect(opened).toBe(1);
  });

  // ── 막으면 안 되는 것 ──
  const DIFFERENT: Array<[string, string]> = [
    ['P0', 'Concept. The problem is that new users never reach the first success. The wedge is the onboarding flow, narrowed to one path.'],
    ['P1', 'Domain. Entities are Account, Session and Step. A Session belongs to one Account and advances through ordered Steps.'],
    ['P2', 'Module. The onboarding module owns Step transitions and exposes a single reducer. Persistence sits behind a repository.'],
  ];

  it('공통 템플릿 헤더를 공유하는 서로 다른 문서는 전부 통과한다', () => {
    const root = setup();
    for (const [ph, body] of DIFFERENT) {
      writeDoc(root, `docs/${ph}.md`, HDR + body);
      expect(() => submitGate(root, ph as never, { paths: [`docs/${ph}.md`], evidence: 'measured' })).not.toThrow();
    }
  });

  it('P6 총감사가 앞 페이즈 산출물을 동반 제출하는 정상 패턴이 막히지 않는다', () => {
    const root = setup();
    for (const [ph, body] of DIFFERENT) {
      writeDoc(root, `docs/${ph}.md`, HDR + body);
      submitGate(root, ph as never, { paths: [`docs/${ph}.md`], evidence: 'measured' });
    }
    writeDoc(root, 'docs/audit.md', `${HDR}Audit. Every prior phase document was re-read against the `
      + 'shipped code. Two gaps were found in the contract layer and both are recorded with evidence.');
    expect(() => submitGate(root, 'P6', {
      paths: ['docs/audit.md', 'docs/P0.md', 'docs/P1.md', 'docs/P2.md'], evidence: 'measured',
    })).not.toThrow();
  });

  it('같은 게이트 재제출(개정 루프)은 대상이 아니다', () => {
    const root = setup();
    writeDoc(root, 'docs/v0.md', `${BASE}0`);
    submitGate(root, 'P0', { paths: ['docs/v0.md'], evidence: 'measured' });
    expect(() => submitGate(root, 'P0', { paths: ['docs/v0.md'], evidence: 'measured' })).not.toThrow();
  });

  it('바이너리끼리는 유사도 판정을 하지 않는다 — 스크린샷 오탐 방지', () => {
    const root = setup();
    const png = (n: number) => {
      const abs = path.join(root, 'docs', `s${n}.png`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(400, 0xa0 + n)]));
    };
    png(1); png(2);
    submitGate(root, 'P0', { paths: ['docs/s1.png'], evidence: 'measured' });
    expect(() => submitGate(root, 'P1', { paths: ['docs/s2.png'], evidence: 'measured' })).not.toThrow();
  });
});

/**
 * [SEC-79 계열] 비율 임계로 막던 판을 **절대량**으로 바꾼 이유를 고정한다.
 * 임계가 있으면 그 아래로 지나가는 희석 경로가 생긴다 — 진짜 문서 한 장에 얇은 파일을
 * 하나씩 덧붙이자 게이트가 계속 열렸다(실측 13 → 5). 새 텍스트의 **양**을 재면 희석이 통하지 않는다.
 */
describe('SEC-79 계열: 새 텍스트의 절대량으로 판정한다', () => {
  const REAL = 'The scope of this phase is the onboarding flow. The risk is that users abandon '
    + 'before the first success, so we measure completion of the first session and record it here.';

  it('얇은 파일을 덧붙여도 새 텍스트가 하한 미만이면 열리지 않는다', () => {
    const root = setup();
    writeDoc(root, 'docs/real.md', REAL);
    writeDoc(root, 'docs/t0.md', 'note 0 filler line that is short.');
    submitGate(root, 'P0', { paths: ['docs/real.md'], evidence: 'measured' });
    expect(() => submitGate(root, 'P1', { paths: ['docs/real.md', 'docs/t0.md'], evidence: 'measured' }))
      .toThrow(/has not already reviewed|이미 심사하지 않은/);
  });

  it('거부 문구가 「얼마나 새로운지」를 수치로 말한다 — 다음 수를 알 수 있게', () => {
    const root = setup();
    writeDoc(root, 'docs/real.md', REAL);
    writeDoc(root, 'docs/t0.md', 'note 0 filler line that is short.');
    submitGate(root, 'P0', { paths: ['docs/real.md'], evidence: 'measured' });
    try {
      submitGate(root, 'P1', { paths: ['docs/real.md', 'docs/t0.md'], evidence: 'measured' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(String((e as Error).message)).toMatch(/\d+/);
      expect(String((e as Error).message)).toContain(String(MIN_SUBSTANCE_CHARS));
    }
  });

  it('새 문서가 하한을 넘으면 동반 제출이 통과한다 — 과차단 0', () => {
    const root = setup();
    writeDoc(root, 'docs/real.md', REAL);
    writeDoc(root, 'docs/new.md', 'Domain model. Entities are Account, Session and Step; a Session '
      + 'belongs to exactly one Account and advances through ordered Steps until it completes or expires.');
    submitGate(root, 'P0', { paths: ['docs/real.md'], evidence: 'measured' });
    expect(() => submitGate(root, 'P1', { paths: ['docs/real.md', 'docs/new.md'], evidence: 'measured' }))
      .not.toThrow();
  });

  it('심사받은 게이트가 하나도 없으면 이 잣대를 대지 않는다 — 첫 제출은 자유롭다', () => {
    const root = setup();
    writeDoc(root, 'docs/a.md', REAL);
    expect(() => submitGate(root, 'P7', { paths: ['docs/a.md'], evidence: 'measured' })).not.toThrow();
  });
});

/**
 * [UTIL-A1 · HIGH] **미래 게이트 선승인으로 트랙을 건너뛸 수 없다.**
 *
 * 예전에는 `canEnterPhase` 가 **직전 하나만** 봤다. 그래서 P0 에서 세 명령으로
 * (`gate submit P6` → `gate approve P6` → `phase set P7`) 설계 트랙 전체를 지나갈 수 있었다 —
 * 제품이 `--force` 를 env 로 잠가 막으려던 바로 그 일이 **잠금 아래로** 일어났다.
 */
describe('UTIL-A1: 앞의 게이트가 전부 승인돼야 페이즈가 열린다', () => {
  const approveAt = (root: string, phase: Parameters<typeof approveGate>[1], rel: string) => {
    writeDoc(root, rel, body(String(phase)));
    submitGate(root, phase, { paths: [rel], evidence: 'measured' });
    approveGate(root, phase);
  };

  it('미래 게이트만 승인해서는 다음 페이즈로 못 간다', () => {
    const root = setup();
    approveAt(root, 'P6', 'docs/p6.md');
    expect(() => setPhaseViaGate(root, 'P7')).toThrow(/P0/);
    expect(readState(root).phase).toBe('P0');
  });

  it('사유가 빠진 게이트를 전부 이름으로 말한다 — 다음 수를 알 수 있게', () => {
    const root = setup();
    approveAt(root, 'P6', 'docs/p6.md');
    const v = canEnterPhase(root, 'P7');
    expect(v.ok).toBe(false);
    for (const p of ['P0', 'P1', 'P2', 'P3', 'P4', 'P5']) expect(v.reason).toContain(p);
  });

  it('중간 하나가 빠져도 막는다 — 사고로 나던 부류', () => {
    const root = setup();
    for (const p of ['P0', 'P1', 'P2'] as const) approveAt(root, p, `docs/${p}.md`);
    approveAt(root, 'P4', 'docs/P4.md');            // P3 를 건너뛰었다
    expect(() => setPhaseViaGate(root, 'P5')).toThrow(/P3/);
  });

  // ── 막으면 안 되는 것 ──
  it('순차로 승인하면 그대로 진행된다 (과차단 0)', () => {
    const root = setup();
    const order = ['P0', 'P1', 'P2', 'P3'] as const;
    order.forEach((p, i) => {
      approveAt(root, p, `docs/${p}.md`);
      setPhaseViaGate(root, PHASES_LIST[i + 1]);
    });
    expect(readState(root).phase).toBe('P4');
  });

  it('P0 은 앞이 없으므로 언제나 들어갈 수 있다', () => {
    expect(canEnterPhase(setup(), 'P0').ok).toBe(true);
  });
});

const PHASES_LIST = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12'] as const;
