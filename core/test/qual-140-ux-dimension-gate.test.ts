/**
 * [QUAL-140] **UX 증거 게이트가 「그린 적 없는」 1×1 PNG 로 열렸다.**
 *
 * [QUAL-104] 는 0바이트와 「확장자만 png」를 막았고, 그 처방은 옳았다. 그런데 한 겹이
 * 모자랐다 — 제품은 같은 파일에 대해 이미
 *   "70 bytes (1x1) is too small — most likely a blank screen or a failed capture"
 * 라고 **말하고 있었는데**, 그 판단이 `problems` 에만 실리고 `usable` 에서는 빠지지 않아
 * `wave complete` 가 그대로 통과했다. **검출 로직이 제품 안에 있는데 게이트가 그것을
 * 소비하지 않았다** — 라운드 3-I 효용성 감정자가 실측했다.
 *
 * 두 가지를 함께 고친다.
 *
 * ① **의심을 게이트 기준으로 올린다.** 「보고는 하되 통과시킨다」는 [SEC-137] 이 물었던
 *    「못 봤으니 통과」와 같은 구조다 — 제품이 의심한다고 적은 것을 게이트가 무시하면
 *    그 검사는 장식이다.
 * ② **바이트가 아니라 치수로 잰다.** 크기 문턱은 패딩으로 넘을 수 있다([SEC-137] 이
 *    64KB 캡에서 실증했다). 1×1 에 주석 청크를 채워 2KB 로 만들면 바이트 검사는 통과한다.
 *    치수는 그렇게 못 속인다 — 화면을 실제로 그려야 커진다.
 *
 * 과차단 경계: 문턱은 **실주행 화면이면 반드시 넘는 값**이어야 한다. 어떤 뷰포트도
 * 200px 아래로 찍히지 않으므로 그 값을 쓰고, 정상 캡처가 막히지 않는 것을 아래에서 잰다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { initHarness, readState, writeState } from '../src/state';
import { upsertNode } from '../src/ledger';
import { createWave, activateWave, completeWave } from '../src/wave';
import { validateEvidence, hasMeasuredEvidence } from '../src/evidence';
import { evidenceDir } from '../src/paths';

/** 진짜 PNG 를 만든다 — 헤더 검사는 통과하고 치수만 인자로 정한다. */
function png(w: number, h: number, pad = 0): Buffer {
  const crc = (b: Buffer): Buffer => {
    let c = ~0;
    for (const byte of b) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    const o = Buffer.alloc(4); o.writeUInt32BE((~c) >>> 0); return o;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    return Buffer.concat([len, td, crc(td)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8bit truecolor
  // 실제 스크린샷처럼 **압축이 잘 안 되는** 내용으로 채운다 — 단색으로 채우면 400x300 도
  // 400바이트로 줄어 크기 문턱에 걸린다(진짜 캡처는 수십 KB 다). 결정성을 위해 LCG 를 쓴다.
  const raw = Buffer.alloc(h * (1 + w * 3));
  let seed = 12345;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w * 3; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      raw[y * (1 + w * 3) + 1 + x] = (seed >>> 16) & 0xff;
    }
  }
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
  ];
  // 패딩은 **보조 청크**로 넣는다 — 바이트 문턱은 이렇게 넘길 수 있다는 것이 이 테스트의 논점이다.
  if (pad > 0) parts.push(chunk('tEXt', Buffer.concat([Buffer.from('pad\0', 'ascii'), Buffer.alloc(pad, 0x61)])));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** UX 노드를 참조하는 활성 웨이브 + 증적 파일 한 장. */
function uxWave(shot: Buffer | null): { root: string; dir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-q140-'));
  initHarness(root);
  writeState(root, { ...readState(root), phase: 'P7' });
  upsertNode(root, { id: 'UX-1', title: '화면', version: 1, status: 'approved' });
  const w = createWave(root, {
    milestone: 'M1', design_refs: ['UX-1'], acceptance: ['화면이 보인다'], goal: '화면을 만든다',
  });
  activateWave(root, w.id);
  const dir = evidenceDir(root, readState(root).activeWave!);
  fs.mkdirSync(dir, { recursive: true });
  if (shot) fs.writeFileSync(path.join(dir, 'shot.png'), shot);
  return { root, dir };
}

describe('[QUAL-140] 게이트가 제품 자신의 치수 판정을 소비한다', () => {
  it('1×1 PNG 로는 UX 웨이브를 완료할 수 없다 — 감정자가 개통한 그 파일', () => {
    const { root } = uxWave(png(1, 1));
    expect(() => completeWave(root)).toThrow(/1x1|too small|너무 작다/i);
  });

  it('바이트 패딩으로 크기 문턱을 넘겨도 막힌다 — 치수로 재기 때문이다', () => {
    const { root, dir } = uxWave(png(1, 1, 4096));               // 4KB 넘는 「1×1」
    expect(fs.statSync(path.join(dir, 'shot.png')).size).toBeGreaterThan(1024);
    expect(() => completeWave(root)).toThrow(/1x1|too small|너무 작다/i);
  });

  it('거부문이 왜인지 말한다 — 「증적이 없다」로 뭉개지 않는다', () => {
    const { root } = uxWave(png(1, 1));
    let msg = '';
    try { completeWave(root); } catch (e) { msg = String(e); }
    expect(msg).not.toMatch(/no visual evidence|시각 증적이 없다/);   // 파일은 있다
    expect(msg).toMatch(/shot\.png/);
  });

  it('실주행 크기의 캡처는 그대로 통과한다 — 과차단 0', () => {
    const { root } = uxWave(png(400, 300));
    expect(() => completeWave(root)).not.toThrow();
  });

  it('[UX-160] 0바이트 캡처에 「증적이 없다」고 하지 않는다 — 방금 넣은 사람에게 넣으라는 말', () => {
    const { root, dir } = uxWave(null);
    fs.writeFileSync(path.join(dir, 'shot.png'), '');
    let msg = '';
    try { completeWave(root); } catch (e) { msg = String(e); }
    expect(msg).not.toMatch(/no visual evidence|시각 증적이 없다/);
    expect(msg).toMatch(/0 bytes|0바이트/);
  });

  it('정말 비어 있으면 「증적이 없다」가 맞다 — 두 경우를 뭉치지 않는다', () => {
    const { root, dir } = uxWave(null);
    expect(fs.readdirSync(dir)).toEqual([]);
    let msg = '';
    try { completeWave(root); } catch (e) { msg = String(e); }
    expect(msg).toMatch(/no visual evidence|시각 증적이 없다/);
  });

  it('`evidence check` 와 `wave complete` 가 같은 기준을 쓴다 — 표면마다 다른 말 금지', () => {
    const { root } = uxWave(png(1, 1));
    const id = readState(root).activeWave!;
    const report = validateEvidence(root, id);
    expect(report.usable, '보고는 의심인데 게이트는 통과 — 그 비대칭이 결함이었다').toEqual([]);
    expect(report.problems.join(' ')).toMatch(/1x1/);
    expect(hasMeasuredEvidence(root, id), '출하 판정과도 같은 답이어야 한다').toBe(false);
  });
});
