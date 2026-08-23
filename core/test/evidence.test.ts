import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { upsertNode } from '../src/ledger';
import { createWave, activateWave } from '../src/wave';
import { recordBaseline } from '../src/design';
import { evidenceDir } from '../src/paths';
import {
  specFileNameFor, captureFileNameFor, generatePlaywrightSpec,
  validateEvidence, pngDimensions, isTwoXCapture,
  buildComparisonPacket, hasMeasuredEvidence,
} from '../src/evidence';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

/**
 * 손으로 만든 최소 유효 PNG 헤더(시그니처 + IHDR). 픽스처 파일에 의존하지 않는다 —
 * 판정이 읽는 것은 앞 24바이트뿐이라 IDAT 없이도 폭·높이 검증에 충분하다.
 */
const pngHeader = (width: number, height: number): Buffer => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);          // IHDR 길이는 항상 13
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;                        // bit depth
  ihdr[17] = 6;                        // color type: RGBA
  return Buffer.concat([sig, ihdr]);
};

/** 크기 임계값을 넘는 '진짜 캡처' 흉내 — 헤더 뒤에 픽셀 데이터 자리를 채운다. */
const fakeCapture = (width = 2880, height = 1800): Buffer =>
  Buffer.concat([pngHeader(width, height), Buffer.alloc(4096, 0x7a)]);

const putEvidence = (root: string, waveId: string, name: string, data: Buffer | string) => {
  const dir = evidenceDir(root, waveId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), data);
  return path.join(dir, name);
};

/** UX-7 노드 + 수용 기준을 가진 웨이브까지 세팅된 루트. */
const uxRoot = () => {
  const root = setup();
  upsertNode(root, { id: 'UX-7', title: '결제 화면', version: 1, status: 'approved' });
  createWave(root, {
    milestone: 'M2-결제', design_refs: ['UX-7'],
    acceptance: ['결제 버튼이 보인다', '카드 입력 오류가 인라인으로 뜬다'], goal: '결제 화면 구현',
  });
  return root;
};

describe('evidence — UX 노드 → Playwright 시나리오 1:1 변환', () => {
  it('specFileNameFor: UX-7 → e2e/ux-7.spec.ts (스펙 §3-5 그대로)', () => {
    expect(specFileNameFor('UX-7')).toBe('e2e/ux-7.spec.ts');
    expect(specFileNameFor('UX-12')).toBe('e2e/ux-12.spec.ts');
    expect(captureFileNameFor('UX-7')).toBe('ux-7.png');
  });

  it('specFileNameFor: UX- 가 아닌 id·경로 문자는 거절', () => {
    expect(() => specFileNameFor('F-1')).toThrow(/UX node id/);
    expect(() => specFileNameFor('UX-../../etc/passwd')).toThrow(/UX node id/);
  });

  it('generatePlaywrightSpec: 결정적이며 캡처 규율(headless · 2x)이 코드에 박혀 있다', () => {
    const root = uxRoot();
    const a = generatePlaywrightSpec(root, 'UX-7', { waveId: 'wave-001' });
    const b = generatePlaywrightSpec(root, 'UX-7', { waveId: 'wave-001' });
    expect(a).toBe(b); // 같은 입력 → 바이트 동일 (시각·난수 금지)
    expect(a).toContain('headless');
    expect(a).toContain('deviceScaleFactor: 2');
    expect(a).toMatch(/headless:\s*true/);
    expect(a).toContain("'.harness', 'evidence', 'wave-001'");
    expect(a).toContain("'ux-7.png'");
    expect(a).toContain('page.screenshot');
  });

  it('generatePlaywrightSpec: 웨이브 수용 기준이 1:1 로 시나리오에 들어온다', () => {
    const root = uxRoot();
    const spec = generatePlaywrightSpec(root, 'UX-7', { waveId: 'wave-001' });
    expect(spec).toContain('결제 버튼이 보인다');
    expect(spec).toContain('카드 입력 오류가 인라인으로 뜬다');
    expect(spec).toContain('TODO(UX-7)'); // placeholder 그린을 숨기지 않는다
  });

  it('generatePlaywrightSpec: 웨이브를 알 수 없으면 안내로 막는다', () => {
    const root = uxRoot();
    expect(() => generatePlaywrightSpec(root, 'UX-7')).toThrow(/웨이브/);
    activateWave(root, 'wave-001');
    expect(generatePlaywrightSpec(root, 'UX-7')).toContain("'wave-001'"); // 활성 웨이브로 해석
  });
});

describe('evidence — 증적 검증', () => {
  it('빈 서브디렉토리는 증적이 아니다 (wave.ts 게이트와 같은 기준)', () => {
    const root = setup();
    fs.mkdirSync(path.join(evidenceDir(root, 'wave-001'), 'screenshots'), { recursive: true });
    const empty = validateEvidence(root, 'wave-001');
    expect(empty.files).toHaveLength(0);
    expect(empty.ok).toBe(false);
    expect(empty.problems.join('\n')).toMatch(/디렉토리/);

    putEvidence(root, 'wave-001', 'ux-7.png', fakeCapture());
    const filled = validateEvidence(root, 'wave-001');
    expect(filled.files.map(f => f.name)).toEqual(['ux-7.png']);
    expect(filled.ok).toBe(true);
  });

  it('0바이트 파일은 거절하고 사유를 problems 에 남긴다 (조용히 버리지 않는다)', () => {
    const root = setup();
    putEvidence(root, 'wave-001', 'shot.png', '');
    const r = validateEvidence(root, 'wave-001');
    expect(r.files).toHaveLength(0);
    expect(r.ok).toBe(false);
    expect(r.problems.some(p => p.includes('shot.png') && /0바이트/.test(p))).toBe(true);
  });

  it('증적 디렉토리 자체가 없으면 ok=false + 사유', () => {
    const r = validateEvidence(setup(), 'wave-001');
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/증적 디렉토리/);
  });

  it('의심스럽게 작은 PNG·예상 밖 형식은 세되 problems 로 보고한다', () => {
    const root = setup();
    putEvidence(root, 'wave-001', 'blank.png', pngHeader(100, 100)); // 33바이트 — 빈 캡처 의심
    putEvidence(root, 'wave-001', 'notes.exe', 'x');                 // 증적 형식이 아니다
    const r = validateEvidence(root, 'wave-001');
    // 인정 집합은 wave.ts 게이트와 바이트 동일 — 여기서 더 엄격해지면 게이트와 어긋난다
    expect(r.files.map(f => f.name)).toEqual(['blank.png', 'notes.exe']);
    expect(r.problems.some(p => p.includes('blank.png') && /작다/.test(p))).toBe(true);
    expect(r.problems.some(p => p.includes('notes.exe'))).toBe(true);
  });

  it('dot 파일은 세지 않지만 침묵하지 않는다', () => {
    const root = setup();
    putEvidence(root, 'wave-001', '.DS_Store', 'junk');
    const r = validateEvidence(root, 'wave-001');
    expect(r.files).toHaveLength(0);
    expect(r.problems.some(p => p.includes('.DS_Store'))).toBe(true);
  });

  it('잘못된 웨이브 id 는 경로 탈출 전에 막는다', () => {
    expect(() => validateEvidence(setup(), '../../etc')).toThrow(/Invalid wave id/);
  });
});

describe('evidence — PNG 헤더 판독', () => {
  it('pngDimensions: 실제 픽셀 크기를 돌려주고, PNG 가 아니면 throw 없이 null', () => {
    const root = setup();
    const png = putEvidence(root, 'wave-001', 'shot.png', pngHeader(2880, 1800));
    expect(pngDimensions(png)).toEqual({ width: 2880, height: 1800 });

    const txt = putEvidence(root, 'wave-001', 'log.txt', '이건 PNG 가 아니다');
    expect(pngDimensions(txt)).toBeNull();
    expect(pngDimensions(path.join(root, '없는파일.png'))).toBeNull();

    // 시그니처만 맞고 뒤가 깨진 파일도 throw 하지 않는다
    const broken = putEvidence(root, 'wave-001', 'broken.png',
      Buffer.concat([pngHeader(10, 10).subarray(0, 8), Buffer.alloc(4, 0xff)]));
    expect(pngDimensions(broken)).toBeNull();
  });

  it('isTwoXCapture: 논리 크기를 주면 2배인지 정확히 본다', () => {
    const root = setup();
    const two = putEvidence(root, 'wave-001', '2x.png', pngHeader(2880, 1800));
    const one = putEvidence(root, 'wave-001', '1x.png', pngHeader(1440, 900));
    const odd = putEvidence(root, 'wave-001', 'odd.png', pngHeader(1441, 901));
    const txt = putEvidence(root, 'wave-001', 'log.txt', 'nope');

    expect(isTwoXCapture(two, { width: 1440, height: 900 })).toBe(true);
    expect(isTwoXCapture(one, { width: 1440, height: 900 })).toBe(false);
    expect(isTwoXCapture(two)).toBe(true);   // 지시 없으면 필요조건(짝수 픽셀)만
    expect(isTwoXCapture(odd)).toBe(false);
    expect(isTwoXCapture(txt)).toBe(false);
  });
});

describe('evidence — P9 비교 리뷰 패킷', () => {
  const packetRoot = () => {
    const root = uxRoot();
    fs.writeFileSync(path.join(root, 'baseline.png'), fakeCapture(2880, 1800));
    recordBaseline(root, 'UX-7', 'baseline.png');
    putEvidence(root, 'wave-001', 'ux-7.png', fakeCapture(2880, 1800));
    return root;
  };

  it('이미지를 base64 data: URI 로 임베드한다 (외부·상대 경로 이미지 없음)', () => {
    const html = buildComparisonPacket(packetRoot(), { uxNodeId: 'UX-7', waveId: 'wave-001' });
    const srcs = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)].map(m => m[1]);
    expect(srcs).toHaveLength(2); // 기준 + 구현
    expect(srcs.every(s => s.startsWith('data:image/png;base64,'))).toBe(true);
    expect(html).not.toMatch(/<img\b[^>]*\bsrc="(?!data:)/);
    expect(html).not.toMatch(/(src|href)="(https?:)?\/\//); // 외부 리소스 참조 없음
    expect(html).toContain('결제 버튼이 보인다'); // 수용 기준 동봉
    expect(html).not.toContain('비교 불가');
  });

  it('같은 입력이면 바이트 동일 (결정적)', () => {
    const root = packetRoot();
    expect(buildComparisonPacket(root, { uxNodeId: 'UX-7', waveId: 'wave-001' }))
      .toBe(buildComparisonPacket(root, { uxNodeId: 'UX-7', waveId: 'wave-001' }));
  });

  it('기준 이미지가 없으면 반쪽 페이지가 아니라 시끄럽게 말한다', () => {
    const root = uxRoot();
    putEvidence(root, 'wave-001', 'ux-7.png', fakeCapture());
    const html = buildComparisonPacket(root, { uxNodeId: 'UX-7', waveId: 'wave-001' });
    expect(html).toContain('비교 불가');
    expect(html).toMatch(/<title>\[비교 불가\]/);
    expect(html).toMatch(/기준 이미지/);
    expect([...html.matchAll(/<img\b/g)]).toHaveLength(1); // 구현 캡처만
  });

  it('구현 캡처가 없어도 시끄럽게 말한다', () => {
    const root = uxRoot();
    fs.writeFileSync(path.join(root, 'baseline.png'), fakeCapture());
    recordBaseline(root, 'UX-7', 'baseline.png');
    const html = buildComparisonPacket(root, { uxNodeId: 'UX-7', waveId: 'wave-001' });
    expect(html).toContain('비교 불가');
    expect(html).toMatch(/구현 캡처/);
  });
});

describe('evidence — 출하 게이트 지지대', () => {
  it('hasMeasuredEvidence: 빈 증적은 false, 실캡처는 true', () => {
    const root = setup();
    expect(hasMeasuredEvidence(root, 'wave-001')).toBe(false);

    fs.mkdirSync(path.join(evidenceDir(root, 'wave-001'), 'trace'), { recursive: true });
    expect(hasMeasuredEvidence(root, 'wave-001')).toBe(false);

    putEvidence(root, 'wave-001', 'run.log', '테스트 통과함'); // 주장은 측정이 아니다
    expect(hasMeasuredEvidence(root, 'wave-001')).toBe(false);

    putEvidence(root, 'wave-001', 'ux-7.png', fakeCapture());
    expect(hasMeasuredEvidence(root, 'wave-001')).toBe(true);
  });

  it('hasMeasuredEvidence: 빈 화면 의심 PNG 로는 measured 가 되지 않는다', () => {
    const root = setup();
    putEvidence(root, 'wave-001', 'blank.png', pngHeader(1440, 900)); // 33바이트
    expect(hasMeasuredEvidence(root, 'wave-001')).toBe(false);
  });
});
