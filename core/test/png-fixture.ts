/**
 * [QUAL-104] **픽스처는 진짜여야 한다.**
 *
 * 여러 테스트가 `'fake'` 같은 문자열을 `.png` 로 써 놓고 「증적이 있다」를 흉내 냈다.
 * 그 픽스처가 곧 이 리포가 막기로 한 모습이었고, 그래서 UX 게이트가 9바이트 텍스트를
 * 통과시키는데도 전건 초록이었다 — **픽스처가 규칙을 거짓말한 세 번째 사례**다.
 * 진짜 증적이 필요한 곳은 전부 이 헬퍼를 쓴다.
 */
import { Buffer } from 'node:buffer';

/** 헤더가 실제로 읽히는 최소 PNG(시그니처 + IHDR). */
export const pngHeader = (width: number, height: number): Buffer => {
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

/** 「빈 캡처 의심」 크기(1KB)를 넘는 진짜 캡처 대역의 PNG. */
export const realPng = (width = 1280, height = 800): Buffer =>
  Buffer.concat([pngHeader(width, height), Buffer.alloc(4096, 0x7a)]);
