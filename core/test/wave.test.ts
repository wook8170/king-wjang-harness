import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState } from '../src/state';
import {
  createWave, activateWave, logTurn, completeWave, markStale, readWave, listWaves,
} from '../src/wave';
import { upsertNode, getNode } from '../src/ledger';
import { evidenceDir, wavesDir, wavePath } from '../src/paths';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

/**
 * [ENG-D] 유령 참조 검증이 어댑터 두 벌에서 **도메인(`createWave`)** 으로 내려왔다.
 * 그래서 픽스처도 참조를 **먼저 원장에 등록한 뒤** 웨이브를 만든다 — 예전 픽스처는 어느
 * 표면에서도 만들 수 없는 웨이브를 도메인으로 직접 만들고 있었다.
 */
const mkWave = (
  root: string,
  opts: { milestone: string; design_refs: string[]; acceptance: string[]; goal: string },
) => {
  for (const id of opts.design_refs) {
    if (!getNode(root, id)) upsertNode(root, { id, title: id, version: 1, status: 'approved' });
  }
  return createWave(root, opts);
};

describe('wave', () => {
  it('createWave: 번호 자동 증가, pending으로 생성', () => {
    const root = setup();
    const w1 = mkWave(root, { milestone: 'M1', design_refs: ['F-1'], acceptance: ['테스트 그린'], goal: '로그인' });
    const w2 = mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: '2번' });
    expect(w1.id).toBe('wave-001');
    expect(w2.id).toBe('wave-002');
    expect(readWave(root, 'wave-001').meta.status).toBe('pending');
    expect(listWaves(root)).toHaveLength(2);
  });

  it('activate: 하나만 활성 가능, state.activeWave 갱신', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'b' });
    activateWave(root, 'wave-001');
    expect(readState(root).activeWave).toBe('wave-001');
    expect(() => activateWave(root, 'wave-002')).toThrow(/이미 활성/);
  });

  it('logTurn: 활성 웨이브의 턴 로그에 추가', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    activateWave(root, 'wave-001');
    logTurn(root, '골격 생성, 다음: 핸들러');
    expect(readWave(root, 'wave-001').body).toMatch(/골격 생성, 다음: 핸들러/);
  });

  it('logTurn: 활성 웨이브 없으면 에러', () => {
    expect(() => logTurn(setup(), 'x')).toThrow(/활성 웨이브가 없다/);
  });

  it('activate: 없는 id 는 ENOENT 원문 대신 안내로 막는다 (USE-01)', () => {
    const root = setup();
    expect(() => activateWave(root, 'wave-999')).toThrow(/wave-999/);
    expect(() => activateWave(root, 'wave-999')).toThrow(/wave list/);
    expect(() => activateWave(root, 'wave-999')).not.toThrow(/ENOENT/);
  });

  it('complete: UX 참조 웨이브는 증적 없으면 거부, 있으면 done', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: ['UX-7'], acceptance: [], goal: 'ui' });
    activateWave(root, 'wave-001');
    expect(() => completeWave(root)).toThrow(/시각 증적/);
    fs.mkdirSync(evidenceDir(root, 'wave-001'), { recursive: true });
    fs.writeFileSync(path.join(evidenceDir(root, 'wave-001'), 'shot.png'), 'fake');
    completeWave(root);
    expect(readWave(root, 'wave-001').meta.status).toBe('done');
    expect(readState(root).activeWave).toBeNull();
  });

  it('markStale: status를 stale로', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: ['F-1'], acceptance: [], goal: 'a' });
    markStale(root, 'wave-001');
    expect(readWave(root, 'wave-001').meta.status).toBe('stale');
  });

  it('CRLF frontmatter도 파싱된다', () => {
    const root = setup();
    fs.writeFileSync(path.join(root, '.harness/waves/wave-001.md'),
      '---\r\nid: wave-001\r\nmilestone: M1\r\ndesign_refs: []\r\nstatus: pending\r\nacceptance: []\r\n---\r\n## 턴 로그\r\n');
    expect(readWave(root, 'wave-001').meta.id).toBe('wave-001');
  });

  it('done 웨이브는 재활성 불가', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    activateWave(root, 'wave-001');
    logTurn(root, 'x');
    completeWave(root);
    expect(() => activateWave(root, 'wave-001')).toThrow(/이미 done/);
  });

  it('C1: frontmatter id가 파일명과 어긋나도 다른 파일을 덮지 않는다', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' }); // wave-001
    // wave-002.md를 손편집하되 frontmatter id는 (오기입으로) wave-001로 둔다
    fs.writeFileSync(path.join(wavesDir(root), 'wave-002.md'), [
      '---',
      'id: wave-001', 'milestone: M1', 'design_refs: []',
      'status: pending', 'acceptance: []', '---', '## 턴 로그', '',
    ].join('\n'));
    const before1 = fs.readFileSync(path.join(wavesDir(root), 'wave-001.md'), 'utf8');
    markStale(root, 'wave-002');
    expect(fs.readFileSync(path.join(wavesDir(root), 'wave-001.md'), 'utf8')).toBe(before1);
    expect(readWave(root, 'wave-002').meta.status).toBe('stale');
  });

  it('I2: design_refs가 스칼라 문자열이어도 배열로 정규화되고 증적 가드가 작동한다', () => {
    const root = setup();
    fs.writeFileSync(path.join(wavesDir(root), 'wave-001.md'), [
      '---',
      'id: wave-001', 'milestone: M1', 'design_refs: UX-1',
      'status: pending', 'acceptance: []', '---', '## 턴 로그', '',
    ].join('\n'));
    expect(readWave(root, 'wave-001').meta.design_refs).toEqual(['UX-1']);
    activateWave(root, 'wave-001');
    expect(() => completeWave(root)).toThrow(/시각 증적/);
  });

  it('I3/I4: 깨진 웨이브 파일이 있어도 createWave가 다음 번호로 성공하고 listWaves는 스킵한다', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' }); // wave-001
    fs.writeFileSync(path.join(wavesDir(root), 'wave-002.md'), '깨진 파일 — frontmatter 없음\n');
    const w3 = mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'c' });
    expect(w3.id).toBe('wave-003');
    expect(listWaves(root).map(w => w.id)).toEqual(['wave-001', 'wave-003']);
  });

  it('I5: 활성 웨이브를 markStale하면 activeWave가 비워진다', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    activateWave(root, 'wave-001');
    markStale(root, 'wave-001');
    expect(readState(root).activeWave).toBeNull();
    expect(readWave(root, 'wave-001').meta.status).toBe('stale');
  });

  it('M7: 증적 디렉토리에 숨김파일/빈파일만 있으면 여전히 거부된다', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: ['UX-7'], acceptance: [], goal: 'ui' });
    activateWave(root, 'wave-001');
    const dir = evidenceDir(root, 'wave-001');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.DS_Store'), 'x');
    expect(() => completeWave(root)).toThrow(/시각 증적/);
  });

  it('C2: 웨이브 파일이 삭제돼도 id 는 재발급되지 않는다 (저널이 최댓값을 기억한다)', () => {
    const root = setup();
    const w1 = mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    expect(w1.id).toBe('wave-001');
    fs.rmSync(wavePath(root, 'wave-001'));
    const w2 = mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'b' });
    expect(w2.id).toBe('wave-002');
  });

  it('C2 익스플로잇 회귀: 삭제된 웨이브의 증적을 새 웨이브가 물려받지 못한다', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: ['UX-7'], acceptance: [], goal: 'ui' });
    activateWave(root, 'wave-001');
    fs.mkdirSync(evidenceDir(root, 'wave-001'), { recursive: true });
    fs.writeFileSync(path.join(evidenceDir(root, 'wave-001'), 'shot.png'), 'fake');
    completeWave(root);

    // 브랜치 전환·수동 삭제로 웨이브 파일만 사라진 상황
    fs.rmSync(wavePath(root, 'wave-001'));

    const w = mkWave(root, { milestone: 'M1', design_refs: ['UX-7'], acceptance: [], goal: 'ui 재탕' });
    expect(w.id).toBe('wave-002'); // wave-001 재발급이면 evidence/wave-001 을 물려받는다
    activateWave(root, 'wave-002');
    expect(fs.existsSync(evidenceDir(root, 'wave-002'))).toBe(false);
    expect(() => completeWave(root)).toThrow(/시각 증적/);
  });

  it('C2: 브랜치 되감김 — 저널·웨이브 파일이 없어도 잔존 증적이 있으면 생성을 거부한다', () => {
    const root = setup();
    // git 브랜치 전환 재현: .harness/ 는 커밋 대상이라 events.jsonl 이 waves/ 와 함께
    // 되감긴다. 미커밋 evidence/ 만 untracked 로 살아남는다.
    fs.mkdirSync(evidenceDir(root, 'wave-001'), { recursive: true });
    fs.writeFileSync(path.join(evidenceDir(root, 'wave-001'), 'shot.png'), 'fake');

    expect(() => mkWave(root, { milestone: 'M1', design_refs: ['UX-7'], acceptance: [], goal: 'ui' }))
      .toThrow(/이전 증적/);
    // 거부는 완전해야 한다 — 지시서도 저널 항목도 남기지 않는다
    expect(fs.existsSync(wavePath(root, 'wave-001'))).toBe(false);
    expect(listWaves(root)).toHaveLength(0);

    // 증적을 치우면 정상 생성된다
    fs.rmSync(evidenceDir(root, 'wave-001'), { recursive: true });
    expect(mkWave(root, { milestone: 'M1', design_refs: ['UX-7'], acceptance: [], goal: 'ui' }).id)
      .toBe('wave-001');
  });

  it('C2: 잔존 증적 판정은 UX 게이트와 같은 기준 — 숨김·빈 파일은 생성을 막지 않는다', () => {
    const root = setup();
    fs.mkdirSync(evidenceDir(root, 'wave-001'), { recursive: true });
    fs.writeFileSync(path.join(evidenceDir(root, 'wave-001'), '.DS_Store'), 'x');
    fs.writeFileSync(path.join(evidenceDir(root, 'wave-001'), 'empty.png'), '');
    // 게이트가 증적으로 인정하지 않는 것은 가드도 막지 않는다 (M7 과 동일 기준)
    mkWave(root, { milestone: 'M1', design_refs: ['UX-7'], acceptance: [], goal: 'ui' });
    activateWave(root, 'wave-001');
    expect(() => completeWave(root)).toThrow(/시각 증적/);
  });

  it('증적 게이트: 빈 서브디렉토리는 증적이 아니다 — UX 게이트가 거부한다', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: ['UX-7'], acceptance: [], goal: 'ui' });
    activateWave(root, 'wave-001');
    // stat.size 는 디렉토리에서도 0 이 아니다(macOS 64) — size 만 보면 여기서 통과해 버린다
    fs.mkdirSync(path.join(evidenceDir(root, 'wave-001'), 'sub'), { recursive: true });
    expect(() => completeWave(root)).toThrow(/시각 증적/);
  });

  it('증적 게이트 대칭: 빈 서브디렉토리뿐이면 잔존 증적 가드도 생성을 막지 않는다', () => {
    const root = setup();
    // 게이트가 증적으로 인정하지 않는 것은 가드도 막지 않는다(두 판정은 같은 로직이어야 한다)
    fs.mkdirSync(path.join(evidenceDir(root, 'wave-001'), 'sub'), { recursive: true });
    expect(mkWave(root, { milestone: 'M1', design_refs: ['UX-7'], acceptance: [], goal: 'ui' }).id)
      .toBe('wave-001');
    // 서브디렉토리 "안"의 파일도 증적이 아니다 — 게이트는 여전히 거부한다
    fs.writeFileSync(path.join(evidenceDir(root, 'wave-001'), 'sub', 'shot.png'), 'fake');
    activateWave(root, 'wave-001');
    expect(() => completeWave(root)).toThrow(/시각 증적/);
  });

  it('잠금 안내: 활성 웨이브 지시서가 없으면 ENOENT 원문 대신 doctor 안내로 막는다', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    activateWave(root, 'wave-001');
    fs.rmSync(wavePath(root, 'wave-001')); // 브랜치 전환·수동 삭제

    for (const call of [() => logTurn(root, 'x'), () => completeWave(root)]) {
      expect(call).toThrow(/wave-001/);
      expect(call).toThrow(/doctor --repair/);
      expect(call).not.toThrow(/ENOENT/);
    }
  });

  it('잠금 안내: 파일 부재가 아닌 실패(형식 오류)는 원인을 감추지 않고 그대로 던진다', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    activateWave(root, 'wave-001');
    fs.writeFileSync(wavePath(root, 'wave-001'), 'frontmatter 없는 깨진 파일\n');
    expect(() => logTurn(root, 'x')).toThrow(/형식 오류/);
  });

  it('I4: writeWave는 원자적 쓰기 — waves/ 에 .tmp- 잔여가 없다', () => {
    const root = setup();
    mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    activateWave(root, 'wave-001');
    logTurn(root, 'x');
    const leftovers = fs.readdirSync(wavesDir(root)).filter(f => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });
});
